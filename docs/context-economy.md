# Context economy

Delegating to a cheaper model only saves anything if the orchestrator does not
then read everything the cheap model produced. A transcript pasted back into
Claude's context moves the cost; it does not remove it.

So the rule here: **no tool ever returns a transcript.**

## The digest

`digest.jsonl` holds one line per meaningful action. A complete run typically
reduces to five to ten lines:

```
» I'll inspect slug.js and repo conventions, then fix slugify.
— glob
— read AGENTS.md
— read slug.js
— edit slug.js
» slugify now strips punctuation and collapses repeated spaces.
```

That is a real run, at roughly eighty tokens.

Three things make it that small:

**Assistant text is coalesced.** The SDK streams assistant messages as
individual token deltas — fifty-six of them in the run above. Digesting each
one produced a line per word. The runner buffers deltas and flushes one entry
per turn, immediately before the tool call they explain.

**Paths are workspace-relative.** Agents report absolute paths, which dominate
a line and tell the orchestrator nothing it does not know.

**Noise is dropped.** `thinking` messages, still-running tool calls (their
completion always follows), and bare lifecycle transitions like `RUNNING` all
produce no line. Status messages carrying an actual explanation are kept.

## The `since` cursor

Every `inspect` reply ends with `since=<seq>`. Passing it back returns only
what happened after the last look, so polling an agent costs a couple of lines
rather than re-reading its whole history.

## The escape hatch

`events.jsonl` holds every raw SDK message, and `inspect` names its path. When
the digest is genuinely insufficient, reach for it with shell tools — `grep`,
`jq`, `sed` — and pull only what is needed.

This is deliberately the awkward path. It is one line of JSON per event and
will happily consume a context window if read whole.

## Future: a change registry

Edit and write tool calls carry file paths, and the SDK returns `RunGitInfo`
per run. A per-file view of what an agent changed — diff-shaped, browsable
without reading the transcript — is cheap to build from data already recorded.
Not built yet.
