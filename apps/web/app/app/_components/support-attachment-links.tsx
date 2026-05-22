"use client";

import { Paperclip } from "lucide-react";
import type { SupportTicketAttachment } from "../assistant-api-client";

export function SupportAttachmentLinks({
  attachments
}: {
  attachments: SupportTicketAttachment[];
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <ul className="mt-1.5 space-y-1">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-muted"
        >
          <Paperclip className="h-3 w-3 shrink-0 text-text-subtle" aria-hidden />
          <span className="truncate" title={attachment.fileName ?? undefined}>
            {attachment.fileName?.trim() || "attachment"}
          </span>
        </li>
      ))}
    </ul>
  );
}
