import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { install, uninstall } from "../src/install.ts";

const existing = {
  autoMemoryEnabled: false,
  hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "zj-agent-state claude done" }] }] },
};

async function settingsFile(content: object) {
  const path = join(await mkdtemp(join(tmpdir(), "dream-install-")), "settings.json");
  await writeFile(path, JSON.stringify(content, null, 2));
  return path;
}
const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));

describe("install", () => {
  it("adds the hook beside existing ones and turns auto-memory on", async () => {
    const path = await settingsFile(existing);
    await install("/opt/dream/src/cli.ts", path);
    const s = await read(path);
    expect(s.autoMemoryEnabled).toBe(true);
    expect(s.hooks.SessionEnd).toHaveLength(2);
    expect(s.hooks.SessionEnd[1].hooks[0].command).toBe("/opt/dream/src/cli.ts hook");
  });

  it("is idempotent", async () => {
    const path = await settingsFile(existing);
    await install("/opt/dream/src/cli.ts", path);
    await install("/opt/dream/src/cli.ts", path);
    expect((await read(path)).hooks.SessionEnd).toHaveLength(2);
  });

  it("uninstall removes only its own hook", async () => {
    const path = await settingsFile(existing);
    await install("/opt/dream/src/cli.ts", path);
    await uninstall(path);
    const s = await read(path);
    expect(s.hooks.SessionEnd).toEqual(existing.hooks.SessionEnd);
  });
});
