# Tool surface

Seven tools. Nothing blocks unless you ask it to.

## spawn

Starts a detached agent and returns immediately with an id.

| field | required | notes |
| --- | --- | --- |
| `title` | yes | Short imperative phrase. Shown in the task panel and status line. |
| `prompt` | yes | Must be self-contained — the agent shares none of the orchestrator's context. |
| `cwd` | no | Defaults to the server's working directory. |
| `model` | no | `grok-4.6` (default) or `grok-4.5`. |
| `effort` | no | `low`/`medium`/`high`(default)/`xhigh`. |
| `readOnly` | no | Plan mode, writes disallowed. |
| `sandbox` | no | Off by default; see docs/sandbox-and-passthrough.md. |
| `allowFast` | no | Required to select the double-price tier. |

The reply includes an `attachCommand`. Running it via Bash with
`run_in_background: true` is the intended way to track the agent — see
docs/statusline.md.

## follow_up

`{ id, prompt }` — another turn on an existing agent, with its full
conversation intact. Verified to work: an agent asked afterwards which regex it
had used answered correctly without re-reading the file.

Cheaper and better than spawning a fresh agent whenever work builds on what an
agent already did. Requires the agent to have finished; use `steer` for a live
run.

## list

`{ scope, activeOnly }` — one line per agent with state, elapsed time, cost and
latest activity.

`scope` is `session` (default), `cwd`, or `all`. Session scope means "spawned
by this MCP server instance", which is the same lifetime as the Claude Code
session, since one server is spawned per session.

Agents outlive their session, so `all` is genuinely useful rather than clutter.

## inspect

`{ id, since, includeResult }` — the compact digest for one agent. Pass the
`since` value from the previous reply to get only new activity. See
docs/context-economy.md.

## wait

`{ ids, mode, timeoutSec }` — blocks until the named agents reach a terminal
state.

**This blocks the entire orchestrator turn.** MCP is request/response; there is
no way for a tool call to hang without hanging its caller. Prefer the
background-task bridge and use this only when there is genuinely nothing else
to do. Default 120s, capped at 600s, and it returns progress rather than
nothing when it times out.

## steer

`{ id, text }` — injects a message into a turn that is still running, via the
SDK's `run.steer()`. The agent keeps the work it has already done, which makes
this strictly better than stopping and re-prompting. Delivered within ~500ms.

## stop

`{ id }` — cancels the current run. The agent stays resumable through
`follow_up` with its context intact.
