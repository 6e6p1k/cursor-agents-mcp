/**
 * @file The `steer` and `stop` tools — reaching into a run that is in flight.
 *
 * Both work by appending to the agent's control log, which its runner polls.
 * A control log rather than a socket keeps the runner addressable from any
 * process, including one started after it. See docs/architecture.md.
 */

import { appendLine, readStatus, TERMINAL_STATES } from "../store.js";

/**
 * Appends a control request for an agent's runner to pick up.
 *
 * @param {string} id Short agent id.
 * @param {"steer"|"cancel"} op The requested operation.
 * @param {string} [text] Message body, for `steer`.
 * @returns {Promise<void>} Resolves once the request is on disk.
 */
async function pushControl(id, op, text) {
  await appendLine(id, "control", { seq: Date.now(), t: Date.now(), op, text });
}

/**
 * Asserts that an agent is currently running.
 *
 * @param {string} id Short agent id.
 * @returns {Promise<any>} The agent's status document.
 * @throws {Error} If the agent is unknown or already in a terminal state.
 */
async function requireRunning(id) {
  const status = await readStatus(id);
  if (!status) throw new Error(`unknown agent ${id}`);
  if (TERMINAL_STATES.includes(status.state)) {
    throw new Error(`Agent ${id} already ${status.state}. Use follow_up to send it more work.`);
  }
  return status;
}

/**
 * Injects a message into a turn that is still running.
 *
 * Unlike stopping and resuming, this keeps the agent's current turn alive, so
 * work already done is not thrown away.
 *
 * @param {object} input Tool arguments.
 * @param {string} input.id Short agent id.
 * @param {string} input.text Message to inject.
 * @returns {Promise<object>} Confirmation of the queued request.
 * @throws {Error} If the agent is unknown or no longer running.
 */
export async function steer(input) {
  await requireRunning(input.id);
  await pushControl(input.id, "steer", input.text);
  return {
    id: input.id,
    queued: "steer",
    note: "Delivered to the live turn within ~0.5s. The agent keeps its current work.",
  };
}

/**
 * Cancels an agent's current run, leaving the agent resumable.
 *
 * @param {object} input Tool arguments.
 * @param {string} input.id Short agent id.
 * @returns {Promise<object>} Confirmation of the queued request.
 * @throws {Error} If the agent is unknown or no longer running.
 */
export async function stop(input) {
  await requireRunning(input.id);
  await pushControl(input.id, "cancel");
  return {
    id: input.id,
    queued: "cancel",
    note: "The agent stays resumable — follow_up continues it with full context.",
  };
}
