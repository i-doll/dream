import { createSdkMcpServer, query, tool, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "./config.ts";
import type { ProjectPaths } from "./paths.ts";
import { dreamPrompt } from "./prompt.ts";
import {
  acquireLock,
  fingerprint,
  pendingSessions,
  promote,
  pruneRuns,
  readState,
  releaseLock,
  writeState,
  type DreamRecord,
  type Session,
} from "./store.ts";
import { digestTranscript } from "./transcript.ts";
import { memoryFiles, originSessionIds, validateMemory } from "./validate.ts";

export type Due = { due: true; sessions: Session[] } | { due: false; reason: string };

/** Whether a project has gone long enough, with enough new sessions, to dream. */
export async function isDue(p: ProjectPaths, config: Config): Promise<Due> {
  const { lastConsolidatedAt } = await readState(p);
  const hours = (Date.now() - lastConsolidatedAt) / 3_600_000;
  if (hours < config.minHours) return { due: false, reason: `last dream ${hours.toFixed(1)}h ago, need ${config.minHours}h` };
  const sessions = await pendingSessions(p, lastConsolidatedAt);
  if (sessions.length < config.minSessions) {
    return { due: false, reason: `${sessions.length} new sessions, need ${config.minSessions}` };
  }
  return { due: true, sessions };
}

const inside = (root: string, path: string) => {
  const rel = relative(root, resolve(root, path));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
};

/** The working directory a transcript was recorded in, for checking memories against the code. */
async function transcriptCwd(path: string): Promise<string | null> {
  const text = await readFile(path, "utf8");
  const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
  if (!cwd) return null;
  const dir = JSON.parse(`"${cwd}"`) as string;
  return (await stat(dir).then((s) => s.isDirectory(), () => false)) ? dir : null;
}

// Above this, memory contents stay out of the prompt and the agent opens files itself.
const INLINE_MEMORY_MAX_CHARS = 150_000;

async function readMemories(dir: string) {
  const memories = [];
  let total = 0;
  for (const path of ["MEMORY.md", ...(await memoryFiles(dir))]) {
    const content = await readFile(join(dir, path), "utf8").catch(() => null);
    if (content === null) continue;
    total += content.length;
    if (total > INLINE_MEMORY_MAX_CHARS) return null;
    memories.push({ path, content });
  }
  return memories;
}

const newId = () => `drm_${new Date().toISOString().replace(/[-:.]/g, "")}${randomBytes(3).toString("hex")}`;

export type RunOptions = { force?: boolean; log?: (line: string) => void };

/**
 * Runs one dream for a project: copies its memory, has Claude consolidate the copy
 * against recent transcripts, validates the result, and swaps it in. Returns null
 * when another dream holds the lock or the project is not due.
 */
export async function runDream(p: ProjectPaths, config: Config, opts: RunOptions = {}): Promise<DreamRecord | null> {
  const log = opts.log ?? ((line) => console.log(line));
  if (!(await acquireLock(p))) {
    log("another dream is running for this project");
    return null;
  }
  try {
    const startedAt = Date.now();
    const state = await readState(p);
    const due = await isDue(p, config);
    if (!due.due && !opts.force) {
      log(`not due: ${due.reason}`);
      return null;
    }
    const sessions = (due.due ? due.sessions : await pendingSessions(p, state.lastConsolidatedAt)).slice(0, config.maxSessions);

    const id = newId();
    const runDir = join(p.runsDir, id);
    const outputDir = join(runDir, "output");
    const sessionsDir = join(runDir, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const inputFingerprint = await fingerprint(p.memoryDir);
    const inputFiles = (await memoryFiles(p.memoryDir)).length;
    await cp(p.memoryDir, outputDir, { recursive: true }).catch(async (err) => {
      if (err.code !== "ENOENT") throw err;
      await mkdir(outputDir);
    });
    for (const s of sessions) {
      await writeFile(join(sessionsDir, `${s.id}.md`), digestTranscript(await readFile(s.path, "utf8"), s.id));
    }
    // The sessions existing memories came from, when their transcripts still exist,
    // so the critique can check what the user actually said.
    const originsDir = join(runDir, "origins");
    await mkdir(originsDir);
    const inputIds = new Set(sessions.map((s) => s.id));
    let originCount = 0;
    for (const originId of new Set((await originSessionIds(p.memoryDir)).values())) {
      if (inputIds.has(originId)) continue;
      const jsonl = await readFile(join(p.projectDir, `${originId}.jsonl`), "utf8").catch(() => null);
      if (jsonl === null) continue;
      await writeFile(join(originsDir, `${originId}.md`), digestTranscript(jsonl, originId));
      originCount++;
    }

    const record: DreamRecord = {
      type: "dream",
      id,
      status: "running",
      inputs: [
        { type: "memory_dir", path: p.memoryDir },
        { type: "sessions", session_ids: sessions.map((s) => s.id) },
      ],
      outputs: [],
      model: config.model,
      instructions: config.instructions ?? null,
      created_at: new Date(startedAt).toISOString(),
      ended_at: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      cost_usd: 0,
      summary: null,
      deletions: [],
      error: null,
    };
    state.dreams.push(record);
    await writeState(p, state);
    log(`${id}: dreaming over ${inputFiles} memories and ${sessions.length} sessions with ${config.model}`);

    const finish = async (patch: Partial<DreamRecord>) => {
      Object.assign(record, patch, { ended_at: new Date().toISOString() });
      await writeState(p, state);
      return record;
    };

    let result: SDKResultMessage | undefined;
    try {
      result = await consolidate({ outputDir, sessionsDir, originsDir, originCount, sessions, config, log, deletions: record.deletions });
    } catch (err) {
      return await finish({ status: "failed", error: { type: "internal_error", message: String(err) } });
    }
    record.usage = {
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_read_input_tokens: result.usage.cache_read_input_tokens,
      cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
    };
    record.cost_usd = result.total_cost_usd;
    if (result.subtype !== "success" || result.is_error) {
      return await finish({ status: "failed", error: { type: result.subtype, message: "the dream agent stopped early" } });
    }
    record.summary = result.result;

    const check = await validateMemory(outputDir, inputFiles);
    if (!check.ok) {
      return await finish({ status: "failed", error: { type: "invalid_output", message: check.errors.join("; ") } });
    }
    if ((await fingerprint(p.memoryDir)) !== inputFingerprint) {
      // A live session wrote memory while we dreamed. Don't clobber it; the next tick retries.
      return await finish({ status: "failed", error: { type: "input_memory_changed", message: "memory changed during the dream" } });
    }

    await promote(p, runDir);
    await rm(sessionsDir, { recursive: true, force: true });
    await rm(originsDir, { recursive: true, force: true });
    state.lastConsolidatedAt = startedAt;
    await finish({ status: "completed", outputs: [{ type: "memory_dir", path: p.memoryDir }] });
    await pruneRuns(p);
    return record;
  } finally {
    await releaseLock(p);
  }
}

type ConsolidateInput = {
  outputDir: string;
  sessionsDir: string;
  originsDir: string;
  originCount: number;
  sessions: Session[];
  config: Config;
  log: (line: string) => void;
  /** Filled in as the agent deletes memories. */
  deletions: { path: string; reason: string }[];
};

async function consolidate(i: ConsolidateInput): Promise<SDKResultMessage> {
  const { outputDir, sessions, config, log } = i;
  const memoryServer = createSdkMcpServer({
    name: "memory",
    tools: [
      tool(
        "delete_memory",
        "Delete one memory file from the memory folder. The reason is shown to the user in the dream's record.",
        { path: z.string(), reason: z.string().describe("One sentence: why this memory should not exist.") },
        async ({ path, reason }) => {
          if (!inside(outputDir, path)) return { content: [{ type: "text", text: "Refused: path is outside the memory folder." }], isError: true };
          const rel = relative(outputDir, resolve(outputDir, path));
          await rm(resolve(outputDir, path), { force: true });
          i.deletions.push({ path: rel, reason });
          log(`  deleted ${rel}: ${reason}`);
          return { content: [{ type: "text", text: `Deleted ${rel}` }] };
        },
      ),
    ],
  });

  const projectCwd = sessions[0] ? await transcriptCwd(sessions[0].path) : null;
  const prompt = dreamPrompt({
    memoryDir: outputDir,
    sessionsDir: i.sessionsDir,
    sessionCount: sessions.length,
    originsDir: i.originsDir,
    originCount: i.originCount,
    memories: await readMemories(outputDir),
    projectCwd,
    today: new Date().toISOString().slice(0, 10),
    instructions: config.instructions,
  });

  let result: SDKResultMessage | undefined;
  for await (const msg of query({
    prompt,
    options: {
      cwd: outputDir,
      model: config.model,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      mcpServers: { memory: memoryServer },
      // No filesystem settings: the user's hooks (including the one that starts dreams) stay out.
      settingSources: [],
      persistSession: false,
      maxBudgetUsd: config.maxBudgetUsd,
      canUseTool: async (name, input) => {
        if (["Read", "Glob", "Grep", "mcp__memory__delete_memory"].includes(name)) return { behavior: "allow", updatedInput: input };
        if ((name === "Write" || name === "Edit") && typeof input.file_path === "string" && inside(outputDir, input.file_path)) {
          return { behavior: "allow", updatedInput: input };
        }
        return { behavior: "deny", message: `Only Write/Edit inside ${outputDir} are allowed in a dream.` };
      },
    },
  })) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          log(`  ${block.name} ${String(input.file_path ?? input.path ?? input.pattern ?? "")}`);
        }
      }
    } else if (msg.type === "result") {
      result = msg;
    }
  }
  if (!result) throw new Error("the dream agent ended without a result");
  return result;
}
