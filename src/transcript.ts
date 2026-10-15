type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown>; content?: unknown };
type Entry = {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  timestamp?: string;
  aiTitle?: string;
  message?: { content?: string | Block[] };
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const stripReminders = (s: string) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();

/** The one argument that says what a tool call was for. */
function toolSummary(input: Record<string, unknown> = {}): string {
  for (const key of ["file_path", "command", "pattern", "url", "query", "description", "prompt", "skill"]) {
    if (typeof input[key] === "string") return clip(input[key] as string, 160).replace(/\s+/g, " ");
  }
  return "";
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b: Block) => b.text ?? "").join(" ");
  return "";
}

/**
 * Turns one Claude Code JSONL transcript into a compact markdown digest: what the
 * user said, what Claude said, and a one-line trace of each tool call. Tool output
 * is cut to a short preview; thinking, meta and subagent records are dropped.
 */
export function digestTranscript(jsonl: string, sessionId: string, maxChars = 80_000): string {
  let title = "";
  let first = "";
  let last = "";
  const lines: string[] = [];

  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    let e: Entry;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    if (e.type === "ai-title" && e.aiTitle) title = e.aiTitle;
    if ((e.type !== "user" && e.type !== "assistant") || e.isMeta || e.isSidechain) continue;
    if (e.timestamp) {
      first ||= e.timestamp;
      last = e.timestamp;
    }

    const content = e.message?.content;
    const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);
    for (const b of blocks) {
      if (b.type === "text" && b.text) {
        const text = e.type === "user" ? stripReminders(b.text) : b.text;
        if (text) lines.push(e.type === "user" ? `USER: ${clip(text, 4000)}` : `CLAUDE: ${clip(text, 2000)}`);
      } else if (b.type === "tool_use") {
        lines.push(`  [${b.name}] ${toolSummary(b.input)}`);
      } else if (b.type === "tool_result") {
        const preview = resultText(b.content).replace(/\s+/g, " ").trim();
        if (preview) lines.push(`    → ${clip(preview, 200)}`);
      }
    }
  }

  const span = first ? `${first.slice(0, 16).replace("T", " ")} – ${last.slice(0, 16).replace("T", " ")} UTC` : "";
  const header = `# Session ${sessionId}${title ? `: ${title}` : ""}\n${span}\n\n`;
  let body = lines.join("\n");
  if (header.length + body.length > maxChars) {
    // Keep both ends: the opening states the task, the end holds the corrections and outcome.
    const budget = maxChars - header.length - 40;
    const head = Math.floor(budget * 0.3);
    body = `${body.slice(0, head)}\n\n[… middle of session omitted …]\n\n${body.slice(body.length - (budget - head))}`;
  }
  return header + body + "\n";
}
