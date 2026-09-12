/**
 * @file Turning Cursor SDK auth status into a status-line warning.
 *
 * The minted login key lasts 90 days by default and the server dies silently
 * when it lapses. This module is pure so the statusline can inject a clock
 * and the tests never touch `~/.cursor/sdk/auth.json`. See docs/statusline.md.
 */

/** Days before expiry at which the status line warns, absent configuration. */
export const DEFAULT_WARN_WITHIN_DAYS = 14;

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds a status-line warning from an SDK auth-status snapshot.
 *
 * @param {any} auth Result of `Cursor.auth.status()`, or a test double.
 * @param {number} now Epoch milliseconds treated as the current time.
 * @param {number} [warnWithinDays] Days before expiry at which to start warning.
 * @returns {string|null} A short warning, or null when there is nothing to flag.
 */
export function authExpiryWarning(auth, now, warnWithinDays = DEFAULT_WARN_WITHIN_DAYS) {
  if (!auth || typeof auth !== "object") return null;

  if (auth.status === "logged-out") return "⚠ SDK logged out";
  if (auth.status !== "logged-in") return null;

  const expiresAt = auth.apiKeyExpiresAtMs;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;

  if (expiresAt <= now) return "⚠ SDK key expired";

  const remaining = expiresAt - now;
  if (remaining > warnWithinDays * DAY_MS) return null;

  return `⚠ SDK key expires in ${Math.ceil(remaining / DAY_MS)}d`;
}
