export function shouldLabelCurrentMessageAttachments(totalVisualAttachments: number): boolean {
  return totalVisualAttachments > 1;
}

export function formatCurrentMessageAttachmentLabel(ordinal: number, total: number): string {
  return (
    `Current message attachment ${String(ordinal)} of ${String(total)}. ` +
    "This index applies only to attachments in the current user message; " +
    "Working Files sticky aliases (image #N, file #N) are separate."
  );
}
