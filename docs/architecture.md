# Architecture

## The shape

Three kinds of process, sharing state only through files on disk:

```
Claude Code
  └─ MCP server (src/mcp-server.js)      thin, stateless, dies with the session
       └─ spawns ──▶ runner (src/runner.js)   one per turn, DETACHED
                          │
                          ▼
             ~/.cursor-agents-mcp/agents/<id>/
                          ▲
       ┌──────────────────┴──────────────────┐
   CLI `attach`                      CLI `statusline`
   (background task bridge)          (status line segment)
```

No agent work happens in the MCP server. It writes a record, forks a runner,
and returns.

## Why runners are detached

A stdio MCP server is spawned per Claude Code session and killed when that
session ends. If a run lived inside it, closing a session would kill a
twenty-minute refactor mid-write.

Runners are spawned with `detached: true` and immediately `unref()`'d, with
stdio pointed at a log file rather than an inherited pipe that could close
underneath them. The consequences are all good ones:

- a run survives the session that started it, and survives an MCP restart
- any process can inspect any agent, including ones it never launched
- the status line and the CLI need no IPC channel, just read access

## Why files instead of IPC

Every reader (MCP server, `attach`, `statusline`, a human running `ls`) needs
the same view, and readers come and go at arbitrary times. A socket would need
a discovery mechanism, a reconnect story, and a server that outlives its
clients. A directory needs none of that.

JSON documents are rewritten atomically — write to a temp file, then rename —
because readers poll them while a runner writes. Append-only logs need no such
care: a torn final line is simply skipped and picked up on the next read.

## One SDK store per agent

The SDK's default local store is SQLite laid out as `{root}/index.db` plus
`{root}/agents/<id>/store.db`. That shared `index.db` is a process-wide lock:
starting two runners at the same moment fails both with `database is locked`,
which makes parallel agents — the main reason to delegate at all — impossible.

Each runner therefore gets its own `JsonlLocalAgentStore`, rooted inside that
agent's record directory. Nothing is shared, so nothing contends. This is safe
because exactly one runner ever touches a given agent: `follow_up` refuses to
start a turn while one is in flight.

Verified with four agents running concurrently for three minutes.

## The record

```
~/.cursor-agents-mcp/agents/ag_7f3k2m/
├── meta.json            immutable: title, model, cwd, sdkAgentId, sessionId
├── status.json          mutable: state, runId, lastActivity, usage, turns
├── digest.jsonl         one line per meaningful action  (what `inspect` reads)
├── events.jsonl         every raw SDK message           (shell-greppable)
├── control.jsonl        inbound steer/cancel requests
├── pending-prompt.txt   the prompt for the turn about to start
├── result.md            final assistant text
└── runner.log           runner stdout/stderr
```

`state` is one of `starting`, `running`, `finished`, `error`, `cancelled`.

## Control flow into a live run

`steer` and `stop` append to `control.jsonl`; the runner polls it every 500ms
and applies requests to the in-flight `Run`. A log rather than a signal because
`steer` carries a payload, and a log rather than a socket so any process can
issue a request — including one started after the runner.

A runner begins reading the control log from its current end, not from the
start. The log is append-only and shared across every turn of an agent, so a
runner that started at zero would replay the previous turn's cancel and kill
its own fresh run — which is exactly what happened before `latestSeq` was
introduced.

`steer` maps to the SDK's `run.steer()`, which injects a message into a turn
that is still executing. It does not discard work in progress, which is what
makes it preferable to cancelling and re-prompting.

## Turn lifecycle

1. `spawn` creates the record, writes the prompt, forks a runner with `create`.
2. The runner calls `Agent.create`, stores the SDK's agent id in `meta.json`,
   and streams the run into `events.jsonl` / `digest.jsonl`.
3. On completion it writes `result.md` and a terminal `state`.
4. `follow_up` writes a new prompt, resets `state` to `starting`, and forks a
   runner with `resume`, which calls `Agent.resume(sdkAgentId)`.

Step 4's status reset happens *before* the tool returns. Without it a caller
that immediately waits or attaches would observe the previous turn's terminal
state and conclude the new turn had already finished.
