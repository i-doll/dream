import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Claude Code loads MEMORY.md into every session and truncates it past these limits.
const INDEX_MAX_LINES = 200;
const INDEX_MAX_BYTES = 25_000;

export type Validation = { ok: boolean; errors: string[]; files: number };

/** Markdown memory files under `dir`, relative paths, excluding the MEMORY.md index. */
export async function memoryFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
      .filter((p) => p !== "MEMORY.md" && !p.split("/").some((seg) => seg.startsWith(".")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Checks a dream's output before it may replace the live memory folder. */
export async function validateMemory(dir: string, inputFileCount: number): Promise<Validation> {
  const errors: string[] = [];
  const files = await memoryFiles(dir);

  if (files.length === 0 && inputFileCount > 0) {
    errors.push(`output has no memories but the input had ${inputFileCount}`);
  }

  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
    if (!fm || !/^name:\s*\S/m.test(fm) || !/^description:\s*\S/m.test(fm)) {
      errors.push(`${file}: missing frontmatter with name and description`);
    }
  }

  if (files.length > 0) {
    let index = "";
    try {
      index = await readFile(join(dir, "MEMORY.md"), "utf8");
    } catch {
      errors.push("MEMORY.md is missing");
    }
    if (index.split("\n").length > INDEX_MAX_LINES) errors.push(`MEMORY.md is over ${INDEX_MAX_LINES} lines`);
    if (Buffer.byteLength(index) > INDEX_MAX_BYTES) errors.push(`MEMORY.md is over ${INDEX_MAX_BYTES} bytes`);
    for (const [, target] of index.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
      if (!files.includes(target!)) errors.push(`MEMORY.md links to ${target}, which does not exist`);
    }
  }

  return { ok: errors.length === 0, errors, files: files.length };
}

/** Maps each memory file to the session it was first saved in, where its frontmatter records one. */
export async function originSessionIds(dir: string): Promise<Map<string, string>> {
  const origins = new Map<string, string>();
  for (const file of await memoryFiles(dir)) {
    const id = /^\s*originSessionId:\s*["']?([\w-]+)/m.exec(await readFile(join(dir, file), "utf8"))?.[1];
    if (id) origins.set(file, id);
  }
  return origins;
}
