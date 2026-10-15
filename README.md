# dream

A local version of [Managed Agents Dreams](https://platform.claude.com/docs/en/managed-agents/dreams) for Claude Code's auto-memory. After you use a project for a while, Claude rereads its memory folder alongside your recent sessions. It merges duplicates, replaces stale or contradicted entries with what's true now, and adds what the sessions taught it.

It runs on your Claude Code login through the Agent SDK. No API key, no research preview.

## Install

Needs Node 24 or newer, which runs the TypeScript directly.

```sh
pnpm install
./src/cli.ts install
```

`install` adds a `SessionEnd` hook to `~/.claude/settings.json` and sets `autoMemoryEnabled: true`, since dreams curate the memory folders that setting turns on. Nothing else needs doing. After any session ends, the hook checks whether that project is due. If it is, a dream starts in the background and the session still exits immediately.

A project is due when its last dream was at least 24 hours ago and at least 3 transcripts have changed since then. These are the same defaults Claude Code's built-in `autoDream` uses. That built-in sits behind a server-side flag, which is why this exists.

## What a dream does

1. Takes a per-project lock, copies `~/.claude/projects/<project>/memory/` into a staging folder, and condenses each new transcript into a short digest. The digest keeps your messages and Claude's replies and gives each tool call one line.
2. Runs Claude on the staging copy. It can read anything but can write only inside that copy, and it doesn't load your settings or hooks.
3. Validates the result. Every memory needs `name` and `description` frontmatter, every link in `MEMORY.md` has to resolve, the index has to stay under 200 lines and 25 KB, and a store that had memories can't come back empty.
4. If a live session changed the memory in the meantime, the dream is dropped and the next one retries. Otherwise the old folder moves to `~/.claude/dreams/<project>/runs/<id>/before` and the new one takes its place.

## Commands

```sh
./src/cli.ts status            # every project: new sessions, last dream
./src/cli.ts status .          # this project's last 10 dreams
./src/cli.ts run [dir] --force # dream now, ignoring the thresholds
./src/cli.ts rollback [dir]    # put back the memory from before the last dream
./src/cli.ts uninstall         # remove the hook; auto-memory stays on
```

Background runs log to `~/.claude/dreams/<project>/dream.log`. `state.json` beside it keeps a ledger of dreams, each shaped like the hosted API's `dream` resource with inputs, outputs, usage, cost and summary. The 10 newest runs keep their `before` snapshots.

## Configuration

Optional, in `~/.claude/dreams/config.json`:

```json
{
  "model": "claude-sonnet-5-5",
  "minHours": 24,
  "minSessions": 3,
  "maxSessions": 100,
  "maxBudgetUsd": 5,
  "instructions": "Focus on coding-style preferences; ignore one-off debugging notes."
}
```

`instructions` steers a dream the same way it does on the hosted API.

## Develop

```sh
pnpm typecheck
pnpm test
```
