"use client";

import { useState } from "react";
import type { SupportTicketAttachment } from "../assistant-api-client";
import {
  AuthenticatedAttachmentImage,
  useAuthenticatedBlobUrl
} from "./authenticated-attachment-image";
import { ImageLightbox } from "./image-lightbox";
import { cn } from "@/app/lib/utils";

export function SupportAttachmentThumbs({
  attachments,
  resolveUrl
}: {
  attachments: SupportTicketAttachment[];
  resolveUrl: (attachmentId: string) => string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const imageAttachments = attachments.filter((item) => item.mimeType.startsWith("image/"));
  if (imageAttachments.length === 0) {
    return null;
  }

  const active = imageAttachments.find((item) => item.id === openId) ?? null;
  const activeSrc = active ? resolveUrl(active.id) : null;
  const { blobUrl: lightboxBlobUrl } = useAuthenticatedBlobUrl(openId ? activeSrc : null);

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {imageAttachments.map((attachment) => (
          <button
            key={attachment.id}
            type="button"
            onClick={() => setOpenId(attachment.id)}
            className={cn(
              "h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-surface",
              "transition hover:border-accent/40 hover:ring-2 hover:ring-accent/20"
            )}
          >
            <AuthenticatedAttachmentImage
              src={resolveUrl(attachment.id)}
              alt={attachment.fileName ?? "attachment"}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
      {active && lightboxBlobUrl && (
        <ImageLightbox
          open={openId !== null}
          src={lightboxBlobUrl}
          downloadUrl={lightboxBlobUrl}
          filename={active.fileName ?? undefined}
          alt={active.fileName ?? "attachment"}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
