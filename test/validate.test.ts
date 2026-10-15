import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateMemory } from "../src/validate.ts";

const memo = (name: string) => `---\nname: ${name}\ndescription: one line about ${name}\nmetadata:\n  type: feedback\n---\n\nBody.\n`;

async function dir(files: Record<string, string>) {
  const d = await mkdtemp(join(tmpdir(), "dream-validate-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(d, path, ".."), { recursive: true });
    await writeFile(join(d, path), content);
  }
  return d;
}

describe("validateMemory", () => {
  it("accepts a tidy store", async () => {
    const d = await dir({ "MEMORY.md": "- [A](a.md) — hook\n", "a.md": memo("a") });
    expect(await validateMemory(d, 1)).toEqual({ ok: true, errors: [], files: 1 });
  });

  it("rejects index links to missing files", async () => {
    const d = await dir({ "MEMORY.md": "- [A](a.md) — hook\n- [B](b.md) — gone\n", "a.md": memo("a") });
    const r = await validateMemory(d, 1);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("b.md");
  });

  it("rejects memory files without name and description frontmatter", async () => {
    const d = await dir({ "MEMORY.md": "- [A](a.md) — hook\n", "a.md": "just text" });
    expect((await validateMemory(d, 1)).ok).toBe(false);
  });

  it("rejects an index over 200 lines", async () => {
    const index = Array.from({ length: 201 }, () => "- [A](a.md) — hook").join("\n");
    const d = await dir({ "MEMORY.md": index, "a.md": memo("a") });
    expect((await validateMemory(d, 1)).ok).toBe(false);
  });

  it("rejects wiping out a store that had memories", async () => {
    const d = await dir({});
    const r = await validateMemory(d, 4);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("no memories");
  });

  it("accepts an empty output for an empty input", async () => {
    expect((await validateMemory(await dir({}), 0)).ok).toBe(true);
  });
});
