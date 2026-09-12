# Sandbox, project config and MCP passthrough

Everything here was measured against `@cursor/sdk` 1.0.31 with a real agent, in
a fixture repo containing an `AGENTS.md`, a `.agents/skills/` skill and a
project `.cursor/mcp.json`. None of it is inferred from documentation.

## Capability matrix

| | sandbox on | sandbox off |
| --- | --- | --- |
| write files in `cwd` | yes | yes |
| `webSearch` / `webFetch` | yes | yes |
| `AGENTS.md`, `.cursor/rules`, `.agents/skills` | yes | yes |
| project MCP servers | **no** | yes |
| shell network (`curl`, `npm i`, `git push`) | **no** | yes |

## Why the sandbox is off by default

With the sandbox on, an MCP tool call fails with:

> Local SDK runs cannot request interactive approval for this MCP tool call.
> Keep the action within the configured sandbox policy or Smart Auto Review's
> auto-approval boundary, or re-run without sandboxing/autoReview enabled.

Headless SDK runs cannot prompt anyone for approval, so anything requiring it
fails closed. The MCP server was discovered correctly — `settingSources` did
its job — but its tools could not execute.

Since project MCP passthrough is a requirement here, and most real tasks need
network access to install or fetch something, `sandbox` defaults to `false`.
Pass `sandbox: true` per spawn for untrusted or exploratory work, accepting
that MCP and network go away with it.

`autoReview` has the same approval problem and is left off.

The real safety control is `readOnly: true`, which is orthogonal: it runs the
agent in plan mode with `edit`, `delete`, `applyAgentDiff`, `piEdit` and
`piWrite` disallowed. Use it for research and review agents.

There is **no `write` tool** in the SDK's vocabulary — file creation goes
through `edit`. Naming a tool that does not exist makes `Agent.create` throw
before the run starts, so the list is pinned in `src/agent-options.js` and
covered by a test. `Agent.create`'s error message dumps the full valid
vocabulary, which is the most reliable way to check a name.

## What loads automatically

Rules and skills come from a workspace scan, **not** from `settingSources`, and
load with no configuration at all. The scan walks up the directory tree:

| source | needs third-party extensibility? |
| --- | --- |
| `AGENTS.md` | no |
| `.cursor/rules/**/*.mdc`, `.cursorrules`, `.cursorignore` | no |
| `.cursor/skills`, `.cursor/skills-cursor` | no |
| `.agents/skills` | no |
| `.cursor/agents` (subagents) | no |
| `.claude/skills`, `.claude/agents`, `CLAUDE.md`, `CLAUDE.local.md` | yes |
| `.grok/skills`, `.codex/skills` | yes |

Note `.agents/skills` is joined as a literal lowercase path. On a
case-sensitive filesystem `.agents/SKILLS` will not be found.

## What needs settingSources

MCP servers, and only MCP servers:

- `"project"` → `.cursor/mcp.json`
- `"user"` → `~/.cursor/mcp.json`
- `"plugins"` → plugin-managed servers

The SDK default is inline-only, meaning no project MCP servers at all. This
server always passes `["project", "user", "plugins"]`.
