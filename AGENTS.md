# Agent conventions

Node ESM (`"type": "module"`), Node 22+. Prefer the stdlib and existing deps (`@cursor/sdk`, MCP SDK); add a dependency only with a strong reason.

Keep source files under ~400 lines; split by responsibility (e.g. `agent-options.js` exists so it can be unit-tested without importing `runner.js`).

## Documentation in code

Every exported function gets a JSDoc block: one-line summary, `@param` for each parameter, `@returns`, and `@throws` when it can throw. Match the style in `src/models.js` (`resolveModel`, `estimateCostUsd`) and `src/digest.js` (`digestMessage`, `describeArgs`).

Inline comments are for non-obvious *why* only, one or two lines — never narrate the next statement. Good examples already in tree:

- `resolveModel` pins `fast` because Cursor defaults it to `true`
- `digestMessage` skips `running` tool calls so completion does not double every line
- `agentOptions` uses a per-agent `JsonlLocalAgentStore` to avoid SQLite lock contention

Architecture, rationale, and how-it-works belong in `docs/` (one file per subsystem), not in source comments. `@file` headers may point there (see `src/digest.js` → `docs/context-economy.md`). Subsystem index: README.md § Docs.

## Tests and checks

Tests use `node:test` (`describe` / `it`) with `node:assert/strict` — see `test/models.test.js`. Logic changes ship with tests.

Before finishing: `npm test` and `npx tsc -p tsconfig.json` must both pass.

## `src/` map

| Module | Responsibility |
| --- | --- |
| `mcp-server.js` | MCP stdio entry: advertise tools and dispatch; no agent work in-process |
| `runner.js` | Detached process that owns one Cursor agent for one turn |
| `store.js` | Atomic read/write of agent records on disk |
| `paths.js` | On-disk layout under the state root |
| `agent-options.js` | Map a stored record to `Agent.create` / `Agent.resume` options |
| `models.js` | Model id normalisation, effort/fast guard, cost estimate |
| `digest.js` | Compact one-line-per-action view of the SDK stream |
| `auth-status.js` | SDK auth expiry → status-line warning |
