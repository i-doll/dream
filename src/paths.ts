import { homedir } from "node:os";
import { basename, join } from "node:path";

export const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
export const projectsDir = join(claudeDir, "projects");
export const dreamsDir = join(claudeDir, "dreams");
export const settingsPath = join(claudeDir, "settings.json");

/** Claude Code's folder name for a working directory: every non-alphanumeric becomes "-". */
export function projectKey(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Where Claude Code keeps one project's transcripts, and where its memory lives. */
export function projectPaths(projectDir: string, root = dreamsDir) {
  const key = basename(projectDir);
  const home = join(root, key);
  return {
    key,
    projectDir,
    memoryDir: join(projectDir, "memory"),
    home,
    statePath: join(home, "state.json"),
    lockPath: join(home, "lock"),
    logPath: join(home, "dream.log"),
    runsDir: join(home, "runs"),
  };
}

export type ProjectPaths = ReturnType<typeof projectPaths>;
