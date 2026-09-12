# cursor-agents-mcp

An MCP server that lets Claude Code delegate work to Cursor SDK agents — Grok
by default — as **detached, reusable, inspectable** background jobs.

The point is cost. Frontier Claude models are expensive for work that does not
need them. This hands that work to a cheaper model without giving up the
orchestration, and without the orchestrator paying to read the result.

## What it does

- **Async by default.** `spawn` returns an id immediately. Nothing blocks.
- **Agents are reusable.** `follow_up` sends another turn with the full prior
  conversation intact, instead of starting over.
- **Agents are inspectable.** `list` for the overview, `inspect` for a compact
  per-agent digest that is never a transcript.
- **Agents are steerable.** `steer` injects into a live turn without discarding
  its work; `stop` cancels but leaves the agent resumable.
- **Runs survive the session.** Runners are detached, so closing Claude Code
  does not kill a refactor in progress.
- **Visible without asking.** A background-task bridge puts each agent in
  Claude Code's task panel and notifies the orchestrator on completion; a
  status line shows what is running.
- **Project config is honored.** `AGENTS.md`, `.cursor/rules`, `.agents/skills`
  and `.cursor/mcp.json` all work.

## Setup

Requires Node 22.13+ and a Cursor account.

```bash
npm install
```

Authenticate the SDK — note this is **separate** from the `cursor-agent` CLI
login, which it will not reuse:

```bash
node -e "import('@cursor/sdk').then(m => m.Cursor.auth.login({ apiKeyName: 'cursor-agents-mcp' }))"
```

That mints a 90-day key into `~/.cursor/sdk/auth.json`. A non-expiring key from
the Cursor dashboard in `CURSOR_API_KEY` works too.

Register with Claude Code, in `~/.claude.json`:

```json
{
  "mcpServers": {
    "cursor-agents": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cursor-agents-mcp/src/mcp-server.js"]
    }
  }
}
```

For the status line, see [docs/statusline.md](docs/statusline.md).

## Docs

| | |
| --- | --- |
| [architecture.md](docs/architecture.md) | Process model, the on-disk record, why runners are detached |
| [tools.md](docs/tools.md) | The seven tools and their arguments |
| [context-economy.md](docs/context-economy.md) | Why no tool returns a transcript |
| [models.md](docs/models.md) | Model namespaces, the fast-tier trap, 4.5 vs 4.6 |
| [sandbox-and-passthrough.md](docs/sandbox-and-passthrough.md) | Measured capability matrix; what loads automatically |
| [statusline.md](docs/statusline.md) | Task panel bridge and status line setup |

## Development

```bash
npm test        # unit tests
npm run typecheck
```

State lives in `~/.cursor-agents-mcp/`, overridable with
`CURSOR_AGENTS_STATE_ROOT`.
