/**
 * @file Environment-driven defaults.
 *
 * The shipped defaults encode one set of opinions — Grok, high effort, no fast
 * tier, no sandbox. They are reasonable, but they are opinions, and a tool
 * other people run should not bake them in. Every one is overridable here
 * without touching code. See docs/configuration.md.
 *
 * Defaults are read per call rather than frozen at import so an embedder can
 * change the environment between runs, and so tests need no module reloading.
 */

/** Values treated as true in a boolean environment variable. */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Reads a string environment variable.
 *
 * @param {string} name Variable name.
 * @param {string} fallback Value used when unset or empty.
 * @returns {string} The configured value.
 */
function str(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

/**
 * Reads a boolean environment variable.
 *
 * Anything other than a recognised truthy word counts as false, so a typo fails
 * closed rather than silently enabling something.
 *
 * @param {string} name Variable name.
 * @param {boolean} fallback Value used when unset or empty.
 * @returns {boolean} The configured value.
 */
function bool(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Reads a positive-integer environment variable.
 *
 * @param {string} name Variable name.
 * @param {number} fallback Value used when unset, empty or unparseable.
 * @returns {number} The configured value.
 */
function int(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads a comma-separated list environment variable.
 *
 * @param {string} name Variable name.
 * @param {string[]} fallback Value used when unset or empty.
 * @returns {string[]} The configured value, trimmed and blank-filtered.
 */
function list(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

/**
 * Resolves the current configuration from the environment.
 *
 * @returns {{model: string, effort: string, sandbox: boolean,
 *   allowFast: boolean, settingSources: string[], keyWarnDays: number}}
 *   Effective settings, with the shipped defaults where unset.
 */
export function loadConfig() {
  return {
    model: str("CURSOR_AGENTS_MODEL", "grok-4.6"),
    effort: str("CURSOR_AGENTS_EFFORT", "high"),
    sandbox: bool("CURSOR_AGENTS_SANDBOX", false),
    // Off by default because the fast tier costs roughly double. Operators who
    // want speed over cost can flip it without editing code.
    allowFast: bool("CURSOR_AGENTS_ALLOW_FAST", false),
    settingSources: list("CURSOR_AGENTS_SETTING_SOURCES", ["project", "user", "plugins"]),
    keyWarnDays: int("CURSOR_AGENTS_KEY_WARN_DAYS", 14),
  };
}
