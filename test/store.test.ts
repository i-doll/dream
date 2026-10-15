import { mkdtemp, mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectPaths } from "../src/paths.ts";
import { acquireLock, fingerprint, pendingSessions, promote, readState, releaseLock, rollback, writeState } from "../src/store.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "dream-store-"));
  const projectDir = join(root, "projects", "-home-me-proj");
  await mkdir(join(projectDir, "memory"), { recursive: true });
  const p = projectPaths(projectDir, join(root, "dreams"));
  return { root, p };
}

describe("pendingSessions", () => {
  it("lists transcripts modified after the last dream, newest first", async () => {
    const { p } = await setup();
    for (const [name, at] of [["old", 1_000], ["mid", 3_000], ["new", 5_000]] as const) {
      const f = join(p.projectDir, `${name}.jsonl`);
      await writeFile(f, "{}");
      await utimes(f, at, at);
    }
    const sessions = await pendingSessions(p, 2_000_000);
    expect(sessions.map((s) => s.id)).toEqual(["new", "mid"]);
  });
});

describe("lock", () => {
  it("is exclusive while the holder lives and reclaimable once it dies", async () => {
    const { p } = await setup();
    expect(await acquireLock(p)).toBe(true);
    expect(await acquireLock(p)).toBe(false);
    await writeFile(p.lockPath, "999999999");
    expect(await acquireLock(p)).toBe(true);
    await releaseLock(p);
    expect(await acquireLock(p)).toBe(true);
  });
});

describe("promote and rollback", () => {
  it("swaps the output in, keeps the old memory, and restores it on rollback", async () => {
    const { p } = await setup();
    await writeFile(join(p.memoryDir, "old.md"), "old");
    const runDir = join(p.runsDir, "drm_1");
    await mkdir(join(runDir, "output"), { recursive: true });
    await writeFile(join(runDir, "output", "new.md"), "new");
    await writeState(p, {
      lastConsolidatedAt: 0,
      dreams: [{ id: "drm_1", status: "completed" } as never],
    });

    await promote(p, runDir);
    expect(await readdir(p.memoryDir)).toEqual(["new.md"]);
    expect(await readFile(join(runDir, "before", "old.md"), "utf8")).toBe("old");

    const rolled = await rollback(p);
    expect(rolled).toBe("drm_1");
    expect(await readdir(p.memoryDir)).toEqual(["old.md"]);
    expect((await readState(p)).dreams[0]!.rolled_back_at).toBeTruthy();
    expect(await rollback(p)).toBeNull();
  });
});

describe("fingerprint", () => {
  it("changes when a memory file changes", async () => {
    const { p } = await setup();
    await writeFile(join(p.memoryDir, "a.md"), "a");
    const before = await fingerprint(p.memoryDir);
    await writeFile(join(p.memoryDir, "a.md"), "changed");
    expect(await fingerprint(p.memoryDir)).not.toBe(before);
  });
});
