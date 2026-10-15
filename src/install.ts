import { readFile, writeFile } from "node:fs/promises";
import { settingsPath } from "./paths.ts";

type HookGroup = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
type Settings = { autoMemoryEnabled?: boolean; hooks?: Record<string, HookGroup[]> };

const isOurs = (g: HookGroup) => g.hooks.some((h) => / hook$/.test(h.command) && h.command.includes("dream"));

async function edit(path: string, change: (s: Settings) => void) {
  const settings: Settings = JSON.parse(await readFile(path, "utf8"));
  change(settings);
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Registers `<cli> hook` on SessionEnd and turns on auto-memory, which dreams curate. */
export async function install(cliPath: string, path = settingsPath): Promise<string> {
  await edit(path, (s) => {
    s.autoMemoryEnabled = true;
    s.hooks ??= {};
    const groups = (s.hooks.SessionEnd ?? []).filter((g) => !isOurs(g));
    s.hooks.SessionEnd = [...groups, { hooks: [{ type: "command", command: `${cliPath} hook`, timeout: 10 }] }];
  });
  return `Installed. Dreams start after a session ends once a project is due. Settings: ${path}`;
}

/** Removes the hook. Leaves auto-memory on, since the memory folders are useful without dreams. */
export async function uninstall(path = settingsPath): Promise<string> {
  await edit(path, (s) => {
    const groups = (s.hooks?.SessionEnd ?? []).filter((g) => !isOurs(g));
    if (s.hooks) s.hooks.SessionEnd = groups;
  });
  return `Uninstalled. Auto-memory is still on; set autoMemoryEnabled to false in ${path} to turn it off.`;
}
