/**
 * Whether a media tool should enqueue an async media job instead of running
 * sync in the turn loop.
 *
 * - media-job worker threads: never defer (the worker *is* the job)
 * - ordinary threads: defer image_generate / image_edit / video_generate (and
 *   other media) so the model waits via `await` instead of blocking the loop
 *
 * ADR-165 originally special-cased sync image present; that D1 was rolled back —
 * ordinary image tools defer again like video. Mid-loop chat present (when any)
 * is a delivery/UI concern, not a sync-tool exception.
 */
export function shouldDeferMediaToolExecution(input: { externalThreadKey: string }): boolean {
  return !input.externalThreadKey.startsWith("system:media-job:");
}
