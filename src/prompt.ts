import { join } from "node:path";
import { claudeDir } from "./paths.ts";

export type PromptInput = {
  memoryDir: string;
  sessionsDir: string;
  sessionCount: number;
  projectCwd: string | null;
  today: string;
  instructions?: string;
};

export function dreamPrompt(i: PromptInput): string {
  const claudeMds = [join(claudeDir, "CLAUDE.md"), ...(i.projectCwd ? [join(i.projectCwd, "CLAUDE.md")] : [])];
  return `# Dream: memory consolidation

You are performing a dream: a reflective pass over a Claude Code project's memory. Read the existing memories alongside recent session digests, then leave behind a reorganized memory folder: duplicates merged, stale or contradicted entries replaced with the latest truth, and new durable insights added. Future sessions load this folder to orient quickly.

Today is ${i.today}.
Memory folder (edit this in place; it is a private copy, the live one is untouched until you finish): \`${i.memoryDir}\`
Session digests (${i.sessionCount} files; each header gives the session's dates): \`${i.sessionsDir}\`
${i.projectCwd ? `Project working directory (read-only, for checking whether remembered files, functions and flags still exist): \`${i.projectCwd}\`` : ""}
Instruction files whose contents must not be duplicated into memory: ${claudeMds.map((p) => `\`${p}\``).join(", ")} (and anything they @-import).

You can Read, Glob and Grep anywhere, but Write and Edit only inside the memory folder. Delete a memory file with the delete_memory tool.

## Memory format

Each memory is one markdown file at the top level of the memory folder, on one topic, with this frontmatter:

\`\`\`
---
name: kebab-case-slug
description: one specific line saying what this memory is about
metadata:
  type: user | feedback | project | reference
---
\`\`\`

Keep existing extra metadata keys (such as originSessionId) when you edit a file. Types:
- user: who the user is, their role, expertise and working preferences.
- feedback: guidance the user gave on how to work, both corrections and confirmed approaches. Include **Why:** and **How to apply:** lines.
- project: ongoing work, goals, decisions or constraints that the code and git history do not record. Use absolute dates.
- reference: pointers to external resources (URLs, dashboards, issue trackers, channels).

Do not save: anything already in the instruction files above, ephemeral task state, code structure or past fixes the repo already records, secrets or credentials.

\`MEMORY.md\` is the index Claude Code loads into every session. One line per memory, under ~150 characters: \`- [Title](file.md) — one-line hook\`. Keep it under 200 lines and 25KB. Never put memory content in it.

## Phase 1: orient
List the memory folder, read MEMORY.md, and skim every topic file so you improve them rather than create near-duplicates.

## Phase 2: gather signal
Read the session digests. Look for: corrections the user made, preferences they stated or confirmed, decisions with their reasons, facts about ongoing work, and things that recurred across sessions. A digest line \`USER:\` is the user; \`CLAUDE:\` is the assistant; \`[Tool] …\` lines trace what was done. Weigh repeated or emphatic signal above one-offs. If a memory names a file, function or flag, check the project directory before keeping that claim.

## Phase 3: consolidate
- Merge duplicates and near-duplicates into one file.
- When two memories, or a memory and a newer session, disagree, keep the newest truth and fix the file at its source.
- Convert relative dates ("yesterday", "last week") to absolute dates.
- Delete memories that are stale, superseded, or belong in the instruction files.
- Add new memories for durable insights from the sessions.
- Keep each file focused and short; split a file that covers two topics.

## Phase 4: prune and index
Rewrite MEMORY.md so it lists exactly the memory files that exist, one line each. Remove pointers to deleted files.

Finish with a brief summary of what you merged, updated, added and deleted. If the memory was already tight and the sessions held nothing new, change nothing and say so.${
    i.instructions ? `\n\n## Additional instructions\n${i.instructions}` : ""
  }
`;
}
