import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dreamsDir } from "./paths.ts";

export type Config = {
  model: string;
  /** Hours since the last dream before another may start. */
  minHours: number;
  /** New transcripts since the last dream before another may start. */
  minSessions: number;
  /** Upper bound on transcripts per dream, newest first (the hosted API caps at 100). */
  maxSessions: number;
  maxBudgetUsd: number;
  /** Extra steering, same role as `instructions` on the hosted API. */
  instructions?: string;
};

export const defaults: Config = {
  model: "claude-sonnet-5-5",
  minHours: 24,
  minSessions: 3,
  maxSessions: 100,
  maxBudgetUsd: 5,
};

/** Reads ~/.claude/dreams/config.json over the defaults; a missing file means defaults. */
export async function loadConfig(): Promise<Config> {
  try {
    const raw = JSON.parse(await readFile(join(dreamsDir, "config.json"), "utf8"));
    return { ...defaults, ...raw };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaults;
    throw err;
  }
}
