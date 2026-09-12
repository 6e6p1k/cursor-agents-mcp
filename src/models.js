/**
 * @file Model selection and the fast-variant guard.
 *
 * The SDK's model namespace is not the CLI's, and Cursor's default variant for
 * every Grok model is the `fast` one, which costs roughly double. Both traps are
 * handled here so no caller can hit them by accident. See docs/models.md.
 */

import { loadConfig } from "./config.js";

/** Efforts accepted per model id; grok-4.6 alone offers `xhigh`. */
const EFFORTS_BY_MODEL = {
  "grok-4.6": ["low", "medium", "high", "xhigh"],
  "grok-4.5": ["low", "medium", "high"],
};

/**
 * Builds a `ModelSelection` for the Cursor SDK, refusing the costly fast tier
 * unless it was asked for by name.
 *
 * @param {object} [opts] Selection inputs.
 * @param {string} [opts.model] Base model id, e.g. `grok-4.6`. Defaults to
 *   `CURSOR_AGENTS_MODEL`. CLI-style ids such as `cursor-grok-4.6-high` are
 *   normalised, since the SDK rejects them.
 * @param {string} [opts.effort] One of `low`, `medium`, `high`, `xhigh`.
 * @param {boolean} [opts.allowFast] Opt in to the fast variant.
 * @returns {{id: string, params: Array<{id: string, value: string}>}} A model
 *   selection with `fast` always pinned explicitly.
 * @throws {Error} If the effort is not offered by the chosen model.
 */
export function resolveModel(opts = {}) {
  const defaults = loadConfig();
  const id = normaliseModelId(opts.model ?? defaults.model);
  const effort = opts.effort ?? defaults.effort;

  const allowed = EFFORTS_BY_MODEL[id];
  if (allowed && !allowed.includes(effort)) {
    throw new Error(
      `Model ${id} does not offer effort "${effort}". Available: ${allowed.join(", ")}.`,
    );
  }

  return {
    id,
    params: [
      { id: "effort", value: effort },
      // Pinned on every call: Cursor marks fast=true as the default variant, so
      // omitting this silently buys the roughly-double-price tier.
      { id: "fast", value: opts.allowFast ? "true" : "false" },
    ],
  };
}

/**
 * Converts a CLI-style model id into the SDK's namespace.
 *
 * The CLI exposes flattened ids (`cursor-grok-4.6-high-fast`); the SDK wants a
 * base id plus params and rejects the flattened form outright.
 *
 * @param {string} raw Model id in either namespace.
 * @returns {string} The SDK base model id.
 */
export function normaliseModelId(raw) {
  let id = String(raw).trim();
  id = id.replace(/^cursor-/, "");
  id = id.replace(/-(low|medium|high|xhigh)(-fast)?$/, "");
  id = id.replace(/-fast$/, "");
  return id;
}

/**
 * Reports whether a caller-supplied model id asks for the fast tier.
 *
 * @param {string} raw Model id in either namespace.
 * @returns {boolean} True when the id carries a `fast` suffix.
 */
export function requestsFastTier(raw) {
  return /-fast$/.test(String(raw).trim());
}

/**
 * Per-million-token prices in USD, by base model id.
 *
 * Cursor bills the non-fast Grok tiers identically; the fast tiers are not
 * listed because `resolveModel` refuses them without explicit consent, and a
 * wrong price is worse than an absent one.
 */
const PRICING = {
  "grok-4.6": { input: 2, cacheRead: 0.5, output: 6 },
  "grok-4.5": { input: 2, cacheRead: 0.5, output: 6 },
};

/**
 * Estimates what a run cost, from its token counts.
 *
 * The SDK's stream reports token counts only — `TokenUsage` carries no price —
 * so this applies the published per-model rates. Cached reads are billed at a
 * quarter of the input rate and are counted separately from fresh input.
 *
 * @param {string} modelId Base model id, e.g. `grok-4.6`.
 * @param {{inputTokens?: number, outputTokens?: number, cacheReadTokens?: number}} [usage]
 *   Token counts from the run.
 * @returns {number|null} Estimated USD, or null when the model is unpriced or
 *   no usage was reported.
 */
export function estimateCostUsd(modelId, usage) {
  const rates = PRICING[modelId];
  if (!rates || !usage) return null;

  const cacheRead = usage.cacheReadTokens ?? 0;
  // inputTokens is inclusive of cached reads, which bill at the lower rate.
  const freshInput = Math.max(0, (usage.inputTokens ?? 0) - cacheRead);
  const output = usage.outputTokens ?? 0;
  if (freshInput + cacheRead + output === 0) return null;

  return (freshInput * rates.input + cacheRead * rates.cacheRead + output * rates.output) / 1_000_000;
}

/**
 * Extracts the display family from a model id.
 *
 * Used to label the status line. The segment before the first version number
 * is the vendor family: `grok-4.6` is grok, `claude-opus-5` is claude.
 *
 * @param {string} [id] Base model id.
 * @returns {string|null} The family, or null when the id is missing.
 */
export function modelFamily(id) {
  if (!id) return null;
  const [family] = String(id).split("-");
  return family || null;
}
