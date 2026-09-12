# Visibility: the task panel and the status line

Two separate mechanisms, because they answer different questions.

## The background task panel

Claude Code's background task panel is fed by its own background Bash shells.
An MCP server cannot register anything into it — there is no protocol for that.

The bridge is to have Claude run the CLI as a background task:

```
node <repo>/bin/cursor-agents.js attach ag_7f3k2m --title "port auth tests"
```

**The row is labelled from the Bash tool's `description`, not from the command
line.** `spawn` returns `attachDescription` (the agent's title) for exactly this
purpose; pass it verbatim. Passing a generic description instead labels the row
with the plumbing — "Attach to the cursor agent" — which tells the user nothing
about what is running.

The process does nothing but poll the agent's status file and exit when the run
reaches a terminal state. Two things fall out of that:

- it appears in the task panel while the agent runs
- **its exit re-invokes the orchestrator**, so the agent reports back without
  anyone polling for it

That second point is what makes async delegation actually work. Without it the
orchestrator has to either block on `wait` or guess when to check.

On exit it prints a tight report — state, elapsed, the agent's final answer
(capped), and the transcript path. Around eight lines.

## The status line

Answers "what is running right now" for the human, continuously, with no tool
call. Add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/cursor-agents-mcp/bin/cursor-agents.js statusline",
    "refreshInterval": 5
  }
}
```

Renders as:

```
⚡ 2 grok · port auth tests 3m12s · audit dashboard perf 47s
```

The minted Cursor SDK login key lasts 90 days by default. When it is missing,
already expired, or within 14 days of expiry, a warning is appended — and still
prints when no agent is running, so a lapsed key cannot go unnoticed:

```
⚠ SDK key expires in 5d
⚡ 2 grok · port auth tests 3m12s · ⚠ SDK key expires in 5d
```

It prints nothing when no agent is running and the key is healthy, so the
segment disappears rather than showing a zero. `Cursor.auth.status()` is a
local read of `~/.cursor/sdk/auth.json`; a failure to read it is ignored so
the agent segment still renders.

`refreshInterval` matters: status line updates are otherwise event-driven and
go quiet while the main session is idle — which is exactly when background
agents are working. Five seconds keeps elapsed times honest.

There is no cost to any of this. The status line is a local script; it makes no
model call and consumes no tokens.

It deliberately shows every running agent rather than only this session's,
since agents outlive the session that spawned them.

## For humans at a terminal

```
cursor-agents ls [--active]    one line per agent
cursor-agents log <id>         that agent's digest
```
