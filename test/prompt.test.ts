import { describe, expect, it } from "vitest";
import { dreamPrompt } from "../src/prompt.ts";

const base = {
  memoryDir: "/m",
  sessionsDir: "/s",
  sessionCount: 2,
  originsDir: "/o",
  originCount: 1,
  projectCwd: null,
  today: "2026-10-15",
};

describe("dreamPrompt", () => {
  it("includes every memory so the critique sees them all", () => {
    const prompt = dreamPrompt({ ...base, memories: [{ path: "a.md", content: "always use tabs" }] });
    expect(prompt).toContain('<memory path="a.md">\nalways use tabs\n</memory>');
    expect(prompt).toContain("## Phase 3: critique existing memories");
  });

  it("leaves memories out when they are too large to include", () => {
    expect(dreamPrompt({ ...base, memories: null })).not.toContain("## Current memories");
  });
});
