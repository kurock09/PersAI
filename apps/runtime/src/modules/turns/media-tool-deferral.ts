/**
 * ADR-165 — whether a media tool should enqueue an async media job instead of
 * running sync in the turn loop.
 *
 * - media-job worker threads: never defer
 * - image_generate / image_edit: never defer (sync in-loop present)
 * - video_generate (and other non-image media): defer on ordinary threads
 */
export function shouldDeferMediaToolExecution(input: {
  externalThreadKey: string;
  toolCode?: string;
}): boolean {
  if (input.externalThreadKey.startsWith("system:media-job:")) {
    return false;
  }
  if (input.toolCode === "image_generate" || input.toolCode === "image_edit") {
    return false;
  }
  return true;
}
