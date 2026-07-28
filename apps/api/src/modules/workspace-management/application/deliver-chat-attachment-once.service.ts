import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AttachmentType } from "@prisma/client";
import type { RuntimeBillingFacts } from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type ChatAttachmentDeliveryIdentity =
  | {
      kind: "media";
      artifactId?: string | null;
      /** Canonical workspace path for the produced artifact (preferred). */
      workspaceArtifactPath: string;
      /** Extra path aliases (e.g. renamed persisted storagePath). */
      additionalWorkspacePaths?: string[];
    }
  | {
      kind: "document";
      docId: string;
      versionId?: string | null;
      versionNumber?: number | null;
    };

export type DeliverChatAttachmentOnceInput = {
  messageId: string;
  chatId: string;
  assistantId: string;
  workspaceId: string;
  attachmentType: AttachmentType;
  storagePath: string;
  thumbnailStoragePath?: string | null;
  posterStoragePath?: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: bigint;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  transcription?: string | null;
  billingFacts?: RuntimeBillingFacts | null;
  metadata: Record<string, unknown>;
  clientTurnId?: string | null;
  clientAttachmentId?: string | null;
  deliveryIdentity: ChatAttachmentDeliveryIdentity;
};

export type DeliverChatAttachmentOnceOutcome = {
  alreadyDelivered: boolean;
  attachment: {
    id: string;
    storagePath: string | null;
    metadata: Record<string, unknown> | null;
  };
  delivery: {
    kind: "new" | "existing";
    canonicalKey: string;
  };
};

type NormalizedDeliveryIdentity = {
  canonicalKey: string;
  keys: string[];
  workspacePaths: string[];
};

export function normalizeChatAttachmentDeliveryIdentity(
  input: ChatAttachmentDeliveryIdentity
): NormalizedDeliveryIdentity {
  if (input.kind === "document") {
    const version =
      typeof input.versionId === "string" && input.versionId.trim().length > 0
        ? `id:${input.versionId.trim()}`
        : typeof input.versionNumber === "number" && Number.isInteger(input.versionNumber)
          ? `number:${String(input.versionNumber)}`
          : null;
    if (input.docId.trim().length === 0 || version === null) {
      throw new Error("Document delivery identity requires docId and version identity.");
    }
    const canonicalKey = `document:${input.docId.trim()}:${version}`;
    return { canonicalKey, keys: [canonicalKey], workspacePaths: [] };
  }
  const path = input.workspaceArtifactPath.trim();
  if (path.length === 0) {
    throw new Error("Media delivery identity requires a canonical workspace artifact path.");
  }
  const workspacePaths = [
    path,
    ...(input.additionalWorkspacePaths ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry !== path)
  ];
  const artifactId =
    typeof input.artifactId === "string" && input.artifactId.trim().length > 0
      ? input.artifactId.trim()
      : null;
  const workspaceKeys = workspacePaths.map((entry) => `media:workspace:${entry}`);
  const canonicalKey = artifactId === null ? workspaceKeys[0]! : `media:artifact:${artifactId}`;
  return {
    canonicalKey,
    keys: artifactId === null ? workspaceKeys : [canonicalKey, ...workspaceKeys],
    workspacePaths
  };
}

/** Pure match for process-local filters and MediaDelivery early already-delivered skip. */
export function attachmentMatchesDeliveryIdentity(
  attachment: { storagePath: string | null; metadata: unknown },
  deliveryIdentity: ChatAttachmentDeliveryIdentity
): boolean {
  const identity = normalizeChatAttachmentDeliveryIdentity(deliveryIdentity);
  return matchesNormalizedIdentity({
    storagePath: attachment.storagePath,
    metadata: attachment.metadata,
    keys: identity.keys,
    workspacePaths: identity.workspacePaths
  });
}

function matchesNormalizedIdentity(input: {
  storagePath: string | null;
  metadata: unknown;
  keys: string[];
  workspacePaths: string[];
}): boolean {
  // Legacy rows (pre-deliveryIdentity stamp) still dedupe by exact storage path.
  if (typeof input.storagePath === "string" && input.workspacePaths.includes(input.storagePath)) {
    return true;
  }
  if (
    input.metadata === null ||
    typeof input.metadata !== "object" ||
    Array.isArray(input.metadata)
  ) {
    return false;
  }
  const deliveryIdentity = (input.metadata as Record<string, unknown>).deliveryIdentity;
  if (
    deliveryIdentity === null ||
    typeof deliveryIdentity !== "object" ||
    Array.isArray(deliveryIdentity)
  ) {
    return false;
  }
  const row = deliveryIdentity as Record<string, unknown>;
  const candidates = [
    typeof row.canonicalKey === "string" ? row.canonicalKey : null,
    ...(Array.isArray(row.aliases)
      ? row.aliases.filter((entry): entry is string => typeof entry === "string")
      : [])
  ];
  return candidates.some((candidate) => candidate !== null && input.keys.includes(candidate));
}

function asMetadata(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

@Injectable()
export class DeliverChatAttachmentOnceService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async execute(input: DeliverChatAttachmentOnceInput): Promise<DeliverChatAttachmentOnceOutcome> {
    const identity = normalizeChatAttachmentDeliveryIdentity(input.deliveryIdentity);
    return this.prisma.$transaction(async (tx) => {
      // The canonical assistant-message row is the serialization key. This avoids
      // a unique-index/migration while safely covering identity aliases in JSON.
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM assistant_chat_messages WHERE id = ${input.messageId}::uuid FOR UPDATE`
      );
      if (locked.length !== 1) {
        throw new NotFoundException("chat_message_not_found");
      }

      const existing = await tx.assistantChatMessageAttachment.findMany({
        where: { messageId: input.messageId },
        select: { id: true, storagePath: true, metadata: true }
      });
      const duplicate = existing.find((attachment) =>
        matchesNormalizedIdentity({
          storagePath: attachment.storagePath,
          metadata: attachment.metadata,
          keys: identity.keys,
          workspacePaths: identity.workspacePaths
        })
      );
      if (duplicate !== undefined) {
        return {
          alreadyDelivered: true,
          attachment: {
            id: duplicate.id,
            storagePath: duplicate.storagePath,
            metadata: asMetadata(duplicate.metadata)
          },
          delivery: { kind: "existing", canonicalKey: identity.canonicalKey }
        };
      }

      const attachment = await tx.assistantChatMessageAttachment.create({
        data: {
          messageId: input.messageId,
          chatId: input.chatId,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          attachmentType: input.attachmentType,
          storagePath: input.storagePath,
          thumbnailStoragePath: input.thumbnailStoragePath ?? null,
          posterStoragePath: input.posterStoragePath ?? null,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          durationMs: input.durationMs ?? null,
          width: input.width ?? null,
          height: input.height ?? null,
          processingStatus: "ready",
          transcription: input.transcription ?? null,
          billingFactsJson:
            input.billingFacts === null || input.billingFacts === undefined
              ? Prisma.DbNull
              : (input.billingFacts as unknown as Prisma.InputJsonValue),
          metadata: {
            ...input.metadata,
            deliveryIdentity: {
              canonicalKey: identity.canonicalKey,
              aliases: identity.keys
            }
          } as Prisma.InputJsonValue,
          clientTurnId: input.clientTurnId ?? null,
          clientAttachmentId: input.clientAttachmentId ?? null
        },
        select: { id: true, storagePath: true, metadata: true }
      });
      return {
        alreadyDelivered: false,
        attachment: {
          id: attachment.id,
          storagePath: attachment.storagePath,
          metadata: asMetadata(attachment.metadata)
        },
        delivery: { kind: "new", canonicalKey: identity.canonicalKey }
      };
    });
  }
}
