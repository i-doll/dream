#!/usr/bin/env node
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.ts";
import { isDue, runDream } from "./dream.ts";
import { install, uninstall } from "./install.ts";
import { dreamsDir, projectKey, projectPaths, projectsDir } from "./paths.ts";
import { pendingSessions, readState, rollback } from "./store.ts";

const USAGE = `dream: local memory consolidation for Claude Code

  dream install            run dreams automatically after Claude Code sessions
  dream uninstall          stop running them
  dream run [dir]          dream now for a project (default: the current directory)
      --force              skip the time and session thresholds
  dream status [dir]       show past dreams; with no dir, every project
  dream rollback [dir]     restore the memory from before the last dream
  dream hook               (used by the SessionEnd hook)
`;

/** Accepts a working directory or a ~/.claude/projects/<key> folder. */
function resolveProject(arg?: string) {
  const path = resolve(arg ?? process.cwd());
  return projectPaths(dirname(path) === projectsDir ? path : resolve(projectsDir, projectKey(path)));
}

/** SessionEnd hook: start a detached dream when the project is due, and return at once. */
async function hook() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { transcript_path: transcript } = JSON.parse(input) as { transcript_path?: string };
  if (!transcript) return;
  const p = projectPaths(dirname(transcript));
  // Scratch worktrees and temp dirs get their own project folders; they have nothing worth keeping.
  if (p.key.startsWith("-tmp-")) return;
  if (!(await isDue(p, await loadConfig())).due) return;

  await mkdir(p.home, { recursive: true });
  const out = openSync(p.logPath, "a");
  spawn(process.execPath, [process.argv[1]!, "run", p.projectDir], {
    detached: true,
    stdio: ["ignore", out, out],
  }).unref();
}

async function run(arg: string | undefined, force: boolean) {
  const p = resolveProject(arg);
  const record = await runDream(p, await loadConfig(), {
    force,
    log: (line) => console.log(`[${new Date().toISOString()}] ${p.key} ${line}`),
  });
  if (!record) return;
  const cost = `$${record.cost_usd.toFixed(2)}`;
  if (record.status === "completed") console.log(`${record.id} completed (${cost})\n\n${record.summary}`);
  else {
    console.log(`${record.id} ${record.status} (${cost}): ${record.error?.type} ${record.error?.message}`);
    process.exitCode = 1;
  }
}

async function status(arg: string | undefined) {
  const keys = arg ? [resolveProject(arg).key] : await readdir(dreamsDir).catch(() => [] as string[]);
  const config = await loadConfig();
  for (const key of keys.filter((k) => k.startsWith("-"))) {
    const p = projectPaths(resolve(projectsDir, key));
    const state = await readState(p);
    const pending = await pendingSessions(p, state.lastConsolidatedAt).catch(() => []);
    console.log(`${key}  ${pending.length} new sessions (dreams at ${config.minSessions})`);
    for (const d of state.dreams.slice(arg ? -10 : -1)) {
      const note = d.rolled_back_at ? " (rolled back)" : d.error ? `: ${d.error.type}` : "";
      console.log(`  ${d.created_at.slice(0, 16)}  ${d.id}  ${d.status}${note}  ${d.inputs[1].session_ids.length} sessions  $${d.cost_usd.toFixed(2)}`);
    }
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { force: { type: "boolean", default: false }, help: { type: "boolean", short: "h" } },
});
const [command, arg] = positionals;

switch (values.help ? "help" : command) {
  case "hook":
    // A failing hook must never get in the way of Claude Code exiting.
    await hook().catch((err) => console.error(`dream hook: ${err}`));
    break;
  case "run":
    await run(arg, values.force);
    break;
  case "status":
    await status(arg);
    break;
  case "rollback": {
    const p = resolveProject(arg);
    const id = await rollback(p);
    console.log(id ? `restored ${basename(p.memoryDir)} from before ${id}` : "nothing to roll back");
    break;
  }
  case "install":
    console.log(await install(resolve(process.argv[1]!)));
    break;
  case "uninstall":
    console.log(await uninstall());
    break;
  default:
    console.log(USAGE);
    if (command && command !== "help") process.exitCode = 2;
}
