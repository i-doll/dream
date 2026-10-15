import { describe, expect, it } from "vitest";
import { digestTranscript } from "../src/transcript.ts";

const line = (o: object) => JSON.stringify(o);
const ts = "2026-10-11T14:22:05.339Z";

describe("digestTranscript", () => {
  it("keeps the conversation and drops tool output noise", () => {
    const jsonl = [
      line({ type: "ai-title", aiTitle: "Issue #173 potential cause" }),
      line({ type: "user", timestamp: ts, message: { content: "Never lock main in a worktree." } }),
      line({
        type: "assistant",
        timestamp: ts,
        message: {
          content: [
            { type: "thinking", thinking: "private" },
            { type: "text", text: "Understood." },
            { type: "tool_use", name: "Bash", input: { command: "git worktree list" } },
          ],
        },
      }),
      line({
        type: "user",
        timestamp: ts,
        message: { content: [{ type: "tool_result", content: "x".repeat(5000) }] },
      }),
    ].join("\n");

    const out = digestTranscript(jsonl, "sess-1");

    expect(out).toContain("# Session sess-1: Issue #173 potential cause");
    expect(out).toContain("USER: Never lock main in a worktree.");
    expect(out).toContain("CLAUDE: Understood.");
    expect(out).toContain("[Bash] git worktree list");
    expect(out).not.toContain("private");
    expect(out).not.toContain("x".repeat(300));
  });

  it("skips meta, sidechain and system-reminder text", () => {
    const jsonl = [
      line({ type: "user", isMeta: true, message: { content: "meta caveat" } }),
      line({ type: "user", isSidechain: true, message: { content: "subagent chatter" } }),
      line({ type: "user", message: { content: "<system-reminder>noise</system-reminder>real ask" } }),
    ].join("\n");

    const out = digestTranscript(jsonl, "s");

    expect(out).not.toContain("meta caveat");
    expect(out).not.toContain("subagent chatter");
    expect(out).not.toContain("noise");
    expect(out).toContain("USER: real ask");
  });

  it("tolerates malformed lines", () => {
    expect(() => digestTranscript("{not json\n" + line({ type: "user", message: { content: "ok" } }), "s")).not.toThrow();
  });

  it("caps the digest by cutting the middle", () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      line({ type: "user", message: { content: `message ${i} ${"y".repeat(500)}` } }),
    ).join("\n");

    const out = digestTranscript(many, "s", 20_000);

    expect(out.length).toBeLessThan(21_000);
    expect(out).toContain("message 0 ");
    expect(out).toContain("message 399 ");
    expect(out).toContain("[… middle of session omitted …]");
  });
});
