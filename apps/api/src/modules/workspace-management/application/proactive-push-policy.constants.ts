// ADR-074 Slice T1 — Frequency safeguards: the FIVE policy constants. They
// live in code (not in the database, not on plan rows, not in any admin
// surface — Principle 1) so changing them is a deploy + ADR cycle, never a
// per-workspace toggle.
//
// These are the single source of truth for the proactive-push policy gate.
// Both `ProactivePushPolicyService` (production) and the scheduler integration
// tests import directly from this module.

/**
 * Minimum spacing between two user-visible scheduled-action dispatches for
 * the SAME task row, measured in hours. Enforced via "defer to
 * `lastFiredAt + MIN_INTERVAL_HOURS`" — never silently dropped.
 */
export const MIN_INTERVAL_HOURS = 48;

/**
 * Quiet-hours window in the user's local timezone (24-hour clock,
 * end-exclusive at the start side, start-exclusive at the end side):
 * `[QUIET_HOURS_START_LOCAL, 24:00) ∪ [00:00, QUIET_HOURS_END_LOCAL)`.
 *
 * Pushes that would otherwise fire inside this window are deferred to the
 * next `QUIET_HOURS_END_LOCAL:00` local — never silently dropped.
 */
export const QUIET_HOURS_START_LOCAL = 22;
export const QUIET_HOURS_END_LOCAL = 9;

/**
 * Number of consecutive pushes (per task row) without a user reply within
 * `ANSWERED_WINDOW_HOURS` that triggers the auto-mute. The first
 * unanswered push only updates the counter; the second one trips the mute.
 */
export const AUTO_MUTE_AFTER_UNANSWERED = 2;

/**
 * How long the auto-mute defers further pushes for the muted task row,
 * measured in days. Reset early on ANY user-initiated message (broader
 * than "an answer to this specific push" — see ADR-074 Slice T1 hard
 * constraint #10).
 */
export const AUTO_MUTE_DURATION_DAYS = 14;

/**
 * Window after `lastFiredAt` during which a user reply counts as having
 * answered THIS specific push for the purposes of the unanswered counter.
 * Auto-mute release is independent of this window — any user-initiated
 * message at any time resets the counter.
 */
export const ANSWERED_WINDOW_HOURS = 24;
