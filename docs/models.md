# Models

## Two namespaces, and the SDK rejects the wrong one

The Cursor CLI exposes flattened model ids: `cursor-grok-4.6-high-fast`. The
SDK does not accept them at all — it wants a base id plus parameters:

```js
{ id: "grok-4.6", params: [{ id: "effort", value: "high" }, { id: "fast", value: "false" }] }
```

`normaliseModelId` in `src/models.js` converts CLI-style ids, so callers that
know only the CLI spelling still work.

## The fast-tier trap

Cursor marks `effort=high, fast=true` as the **default variant** for both Grok
models. Passing a bare model id therefore selects the expensive tier silently.

| variant | input | cache read | output |
| --- | --- | --- | --- |
| grok-4.6 | $2/M | $0.50/M | $6/M |
| grok-4.5 | $2/M | $0.50/M | $6/M |
| grok-4.6 fast | $4/M | $1/M | $12/M |
| grok-4.5 fast | $4/M | $1/M | **$18/M** |

`resolveModel` therefore pins `fast` explicitly on every call, and `spawn`
rejects a fast-suffixed model id unless `allowFast: true` is passed. That flag
is meant for explicit user consent, not for the orchestrator's own judgement.

Note that `grok-4.5` fast is the most expensive option on the board — a higher
output price than any other Grok variant, for the older model.

## 4.6 versus 4.5

Non-fast 4.5 and 4.6 are **priced identically**, so there is no cost argument
for the older model. 4.6 beats 4.5 on every benchmark xAI reports, with the
largest gains on exactly the agentic workloads this server is for: DeepSWE
+11.9, Terminal-Bench +10.3, APEX-Agents +10.4.

4.5 is faster to first token and has a lower cached-input rate. That is the
only reason to pick it.

Default: `grok-4.6`.

## Effort

`low`, `medium`, `high`, `xhigh` — except `grok-4.5`, which has no `xhigh`.
`resolveModel` rejects an effort the chosen model does not offer rather than
letting the backend fail later.

Default is `high`. Measured latency floor at `high` for a trivial prompt is
about sixteen seconds, so genuinely simple work should pass `effort: "low"`.

## Discovering the catalogue

`Cursor.models.list()` returns every model available to the account, with its
parameter definitions and variants. Model availability differs between the CLI,
the SDK and the editor, so trust that call over any hardcoded list.

## Cost reporting

`list` shows an estimated dollar cost per agent. The SDK's stream reports token
counts only — `TokenUsage` carries no price — so `estimateCostUsd` applies the
rates in the table above, billing `cacheReadTokens` at the cached rate and the
remainder of `inputTokens` at the fresh rate.

It is an estimate, hence the `~`. Only the non-fast Grok tiers are priced;
anything else reports nothing rather than a wrong number. `Agent.getUsage()`
returns Cursor's own authoritative dollar figure if you need exactness.
