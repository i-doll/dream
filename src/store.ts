import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectPaths } from "./paths.ts";

/** Mirrors the hosted `dream` resource, with local paths in place of store ids. */
export type DreamRecord = {
  type: "dream";
  id: string;
  status: "running" | "completed" | "failed" | "skipped";
  inputs: [{ type: "memory_dir"; path: string }, { type: "sessions"; session_ids: string[] }];
  outputs: { type: "memory_dir"; path: string }[];
  model: string;
  instructions: string | null;
  created_at: string;
  ended_at: string | null;
  rolled_back_at?: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  cost_usd: number;
  summary: string | null;
  error: { type: string; message: string } | null;
};

export type State = { lastConsolidatedAt: number; dreams: DreamRecord[] };

const KEEP_RUNS = 10;

export async function readState(p: ProjectPaths): Promise<State> {
  try {
    return JSON.parse(await readFile(p.statePath, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { lastConsolidatedAt: 0, dreams: [] };
    throw err;
  }
}

export async function writeState(p: ProjectPaths, state: State): Promise<void> {
  await mkdir(p.home, { recursive: true });
  const tmp = `${p.statePath}.${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, p.statePath);
}

export type Session = { id: string; path: string; mtimeMs: number };

/** Transcripts touched since `since` (ms), newest first. */
export async function pendingSessions(p: ProjectPaths, since: number): Promise<Session[]> {
  const names = (await readdir(p.projectDir)).filter((n) => n.endsWith(".jsonl"));
  const sessions = await Promise.all(
    names.map(async (n) => {
      const path = join(p.projectDir, n);
      return { id: n.slice(0, -".jsonl".length), path, mtimeMs: (await stat(path)).mtimeMs };
    }),
  );
  return sessions.filter((s) => s.mtimeMs > since).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** One dream per project at a time. A lock left by a dead process is taken over. */
export async function acquireLock(p: ProjectPaths): Promise<boolean> {
  await mkdir(p.home, { recursive: true });
  try {
    const fh = await open(p.lockPath, "wx");
    await fh.writeFile(String(process.pid));
    await fh.close();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const holder = Number(await readFile(p.lockPath, "utf8").catch(() => "0"));
    if (holder && alive(holder)) return false;
    await writeFile(p.lockPath, String(process.pid));
    return true;
  }
}

export async function releaseLock(p: ProjectPaths): Promise<void> {
  await rm(p.lockPath, { force: true });
}

/** Changes whenever any file in the folder is added, removed or rewritten. */
export async function fingerprint(dir: string): Promise<string> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const path = join(e.parentPath, e.name);
          const s = await stat(path);
          return `${path}:${s.size}:${s.mtimeMs}`;
        }),
    );
    return files.sort().join("\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

const exists = (path: string) => stat(path).then(() => true, () => false);

/** Moves the live memory to `<run>/before` and the dream's output into its place. */
export async function promote(p: ProjectPaths, runDir: string): Promise<void> {
  const before = join(runDir, "before");
  const hadMemory = await exists(p.memoryDir);
  if (hadMemory) await rename(p.memoryDir, before);
  try {
    await rename(join(runDir, "output"), p.memoryDir);
  } catch (err) {
    if (hadMemory) await rename(before, p.memoryDir);
    throw err;
  }
}

/** Undoes the most recent applied dream. Returns its id, or null when there is nothing to undo. */
export async function rollback(p: ProjectPaths): Promise<string | null> {
  const state = await readState(p);
  const dream = state.dreams.findLast((d) => d.status === "completed" && !d.rolled_back_at);
  if (!dream) return null;
  const runDir = join(p.runsDir, dream.id);
  const before = join(runDir, "before");
  if (await exists(p.memoryDir)) await rename(p.memoryDir, join(runDir, "rolled-back"));
  if (await exists(before)) await rename(before, p.memoryDir);
  dream.rolled_back_at = new Date().toISOString();
  await writeState(p, state);
  return dream.id;
}

/** Deletes run folders (snapshots, digests) beyond the newest KEEP_RUNS. */
export async function pruneRuns(p: ProjectPaths): Promise<void> {
  const runs = (await readdir(p.runsDir).catch(() => [] as string[])).sort();
  for (const old of runs.slice(0, -KEEP_RUNS)) await rm(join(p.runsDir, old), { recursive: true, force: true });
}
