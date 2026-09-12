# Configuration

The shipped defaults encode one set of opinions: Grok 4.6, high effort, never
the fast tier, no sandbox. They suit the workload this was built for — handing
cheap models the work a frontier model does not need — but they are opinions,
not universal answers. Every one is an environment variable.

Set them in the `env` block of your MCP server entry:

```json
{
  "mcpServers": {
    "cursor-agents": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cursor-agents-mcp/src/mcp-server.js"],
      "env": { "CURSOR_AGENTS_MODEL": "grok-4.5", "CURSOR_AGENTS_EFFORT": "low" }
    }
  }
}
```

| Variable | Default | Effect |
| --- | --- | --- |
| `CURSOR_AGENTS_MODEL` | `grok-4.6` | Base model when `spawn` names none. |
| `CURSOR_AGENTS_EFFORT` | `high` | Reasoning effort when `spawn` names none. |
| `CURSOR_AGENTS_SANDBOX` | `false` | Default sandbox state. On blocks all MCP tools and shell network. |
| `CURSOR_AGENTS_ALLOW_FAST` | `false` | Permit the ~2x-price fast tier without `allowFast` per call. |
| `CURSOR_AGENTS_SETTING_SOURCES` | `project,user,plugins` | Which MCP server layers load. |
| `CURSOR_AGENTS_KEY_WARN_DAYS` | `14` | Days before key expiry the status line warns. |
| `CURSOR_AGENTS_STATE_ROOT` | `~/.cursor-agents-mcp` | Where agent records live. |

A per-call argument always beats the environment: `spawn({ model, effort,
sandbox, allowFast })` overrides these for that agent.

## Notes

**Booleans fail closed.** `1`, `true`, `yes` and `on` are true; anything else,
including a typo, is false. A misspelled `CURSOR_AGENTS_SANDBOX` leaves the
sandbox off rather than silently enabling something you did not ask for — and
the same rule means a typo never quietly permits the expensive fast tier.

**`fast` stays pinned either way.** Raising `CURSOR_AGENTS_ALLOW_FAST` removes
the guard rail; it does not make fast the default. The variant is still written
explicitly on every call, because Cursor's own default is the expensive one.
See [models.md](models.md).

**Model validation is not a closed list.** Effort values are checked for the
models whose tiers are known (`grok-4.5`, `grok-4.6`); any other model id is
passed to the SDK untouched, so a model this repo has never heard of still
works. Cost estimation is the exception — it reports nothing rather than a
wrong number for an unpriced model.

**Defaults are read per call**, not frozen at import, so an embedder can change
the environment between runs.
