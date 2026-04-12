import { Injectable } from "@nestjs/common";
import type {
  ProviderGatewayImageContentBlock,
  ProviderGatewayMessageContent,
  ProviderGatewayPdfContentBlock,
  ProviderGatewayTextMessage,
  RuntimeAttachmentRef,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import { RuntimeStatePrismaService } from "../runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

const MAX_CANONICAL_CONTEXT_MESSAGES = 20;
const MAX_DIRECT_PROVIDER_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024;
type HydratedCanonicalSurface = Extract<
  RuntimeTurnRequest["conversation"]["channel"],
  "web" | "telegram"
>;

function toHydratedCanonicalSurface(
  channel: RuntimeTurnRequest["conversation"]["channel"]
): HydratedCanonicalSurface | null {
  return channel === "web" || channel === "telegram" ? channel : null;
}

type CanonicalChatMessageRow = {
  id: string;
  author: "user" | "assistant" | "system";
  content: string;
  attachments: CanonicalChatAttachmentRow[];
};

type CanonicalChatAttachmentRow = {
  id: string;
  attachmentType: "image" | "audio" | "voice" | "video" | "document" | "tool_output";
  originalFilename: string | null;
  mimeType: string;
  storagePath: string;
  sizeBytes: number;
  transcription: string | null;
  metadata: Record<string, unknown> | null;
};

type DirectProviderContentBlock = ProviderGatewayImageContentBlock | ProviderGatewayPdfContentBlock;

type DirectInputAttachmentCandidate = {
  source: "canonical" | "runtime";
  referenceKey: string;
  kind: "image" | "pdf";
  objectKey: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
};

type DirectInputSelection = {
  blocks: DirectProviderContentBlock[];
  directCanonicalAttachmentIds: Set<string>;
  directImageCount: number;
  directPdfCount: number;
};

@Injectable()
export class TurnContextHydrationService {
  constructor(
    private readonly prisma: RuntimeStatePrismaService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async buildMessages(input: RuntimeTurnRequest): Promise<ProviderGatewayTextMessage[]> {
    const canonicalSurface = toHydratedCanonicalSurface(input.conversation.channel);
    if (canonicalSurface === null) {
      return [await this.createCurrentUserMessage(input)];
    }

    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        assistantId: input.conversation.assistantId,
        surface: canonicalSurface,
        surfaceThreadKey: input.conversation.externalThreadKey
      },
      select: {
        id: true
      }
    });
    if (chat === null) {
      return [await this.createCurrentUserMessage(input)];
    }

    const storedMessagesRaw = await this.prisma.assistantChatMessage.findMany({
      where: {
        chatId: chat.id,
        assistantId: input.conversation.assistantId
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        author: true,
        content: true,
        attachments: {
          where: {
            processingStatus: "ready"
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            attachmentType: true,
            originalFilename: true,
            mimeType: true,
            storagePath: true,
            sizeBytes: true,
            transcription: true,
            metadata: true
          }
        }
      }
    });
    const storedMessages: CanonicalChatMessageRow[] = storedMessagesRaw.map((message) => ({
      id: message.id,
      author: message.author,
      content: message.content,
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        attachmentType: attachment.attachmentType,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        storagePath: attachment.storagePath,
        sizeBytes: Number(attachment.sizeBytes),
        transcription: attachment.transcription,
        metadata: attachment.metadata as Record<string, unknown> | null
      }))
    }));

    const hydrated = await this.hydrateCanonicalWebMessages(storedMessages, input);
    return hydrated.length > 0 ? hydrated : [await this.createCurrentUserMessage(input)];
  }

  private async hydrateCanonicalWebMessages(
    storedMessages: CanonicalChatMessageRow[],
    input: RuntimeTurnRequest
  ): Promise<ProviderGatewayTextMessage[]> {
    const hydrated: ProviderGatewayTextMessage[] = [];
    let currentMessageFound = false;

    for (const message of storedMessages) {
      if (message.author === "system") {
        continue;
      }
      if (message.content.trim().length === 0 && message.attachments.length === 0) {
        continue;
      }

      const isCurrentInboundMessage = message.id === input.idempotencyKey;
      if (isCurrentInboundMessage) {
        currentMessageFound = true;
      }
      const content = await this.buildHydratedMessageContent({
        author: message.author,
        baseContent: isCurrentInboundMessage ? input.message.text : message.content,
        attachments: message.attachments,
        fallbackAttachments: isCurrentInboundMessage ? input.message.attachments : [],
        allowDirectAttachmentInput: isCurrentInboundMessage && message.author === "user"
      });

      if (message.author === "assistant") {
        hydrated.push({
          role: "assistant",
          content
        });
        continue;
      }

      hydrated.push({
        role: "user",
        content
      });
    }

    if (!currentMessageFound) {
      hydrated.push(await this.createCurrentUserMessage(input));
    }

    return hydrated.slice(-MAX_CANONICAL_CONTEXT_MESSAGES);
  }

  private async createCurrentUserMessage(
    input: RuntimeTurnRequest
  ): Promise<ProviderGatewayTextMessage> {
    return {
      role: "user",
      content: await this.buildHydratedMessageContent({
        author: "user",
        baseContent: input.message.text,
        attachments: [],
        fallbackAttachments: input.message.attachments,
        allowDirectAttachmentInput: true
      })
    };
  }

  private async buildHydratedMessageContent(input: {
    author: CanonicalChatMessageRow["author"];
    baseContent: string;
    attachments: CanonicalChatAttachmentRow[];
    fallbackAttachments: RuntimeAttachmentRef[];
    allowDirectAttachmentInput: boolean;
  }): Promise<ProviderGatewayMessageContent> {
    const directInputSelection = input.allowDirectAttachmentInput
      ? await this.buildDirectInputSelection(input.attachments, input.fallbackAttachments)
      : this.createEmptyDirectInputSelection();
    const textContent = this.buildHydratedMessageTextContent({
      ...input,
      directCanonicalAttachmentIds: directInputSelection.directCanonicalAttachmentIds,
      directImageCount: directInputSelection.directImageCount,
      directPdfCount: directInputSelection.directPdfCount
    });

    if (directInputSelection.blocks.length === 0) {
      return textContent;
    }

    return [
      {
        type: "text",
        text: textContent
      },
      ...directInputSelection.blocks
    ];
  }

  private buildHydratedMessageTextContent(input: {
    author: CanonicalChatMessageRow["author"];
    baseContent: string;
    attachments: CanonicalChatAttachmentRow[];
    fallbackAttachments: RuntimeAttachmentRef[];
    directCanonicalAttachmentIds: Set<string>;
    directImageCount: number;
    directPdfCount: number;
  }): string {
    const totalImageCount =
      input.attachments.length > 0
        ? input.attachments.filter((attachment) => attachment.mimeType.startsWith("image/")).length
        : input.fallbackAttachments.filter((attachment) => attachment.mimeType.startsWith("image/"))
            .length;
    const totalPdfCount =
      input.attachments.length > 0
        ? input.attachments.filter((attachment) => attachment.mimeType === "application/pdf").length
        : input.fallbackAttachments.filter(
            (attachment) => attachment.mimeType === "application/pdf"
          ).length;
    const attachmentLines =
      input.attachments.length > 0
        ? input.attachments.map((attachment) =>
            this.formatCanonicalAttachmentLine(
              attachment,
              input.directCanonicalAttachmentIds.has(attachment.id)
            )
          )
        : input.fallbackAttachments.map((attachment) =>
            this.formatRuntimeAttachmentLine(attachment)
          );

    if (attachmentLines.length === 0) {
      return input.baseContent;
    }

    const attachmentBlock = this.buildAttachmentBlock({
      title: input.author === "assistant" ? "Assistant attachments" : "Files attached by user",
      lines: attachmentLines,
      totalImageCount,
      directImageCount: input.directImageCount,
      totalPdfCount,
      directPdfCount: input.directPdfCount
    });
    const baseContent =
      input.baseContent.trim().length > 0
        ? input.baseContent
        : input.author === "assistant"
          ? "Assistant sent attachments."
          : "User sent attachments only.";
    return `${attachmentBlock}\n${baseContent}`;
  }

  private async buildDirectInputSelection(
    attachments: CanonicalChatAttachmentRow[],
    fallbackAttachments: RuntimeAttachmentRef[]
  ): Promise<DirectInputSelection> {
    const selection = this.createEmptyDirectInputSelection();
    const candidates =
      attachments.length > 0
        ? attachments
            .map((attachment) => this.toCanonicalDirectInputCandidate(attachment))
            .filter((candidate): candidate is DirectInputAttachmentCandidate => candidate !== null)
        : fallbackAttachments
            .map((attachment) => this.toRuntimeDirectInputCandidate(attachment))
            .filter((candidate): candidate is DirectInputAttachmentCandidate => candidate !== null);

    let totalBytes = 0;
    for (const candidate of candidates) {
      if (
        candidate.sizeBytes <= 0 ||
        candidate.sizeBytes > MAX_DIRECT_PROVIDER_ATTACHMENT_BYTES ||
        totalBytes + candidate.sizeBytes > MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES
      ) {
        continue;
      }

      const buffer = await this.mediaObjectStorage.downloadObject(candidate.objectKey);
      if (buffer === null || buffer.length === 0) {
        continue;
      }
      if (
        buffer.length > MAX_DIRECT_PROVIDER_ATTACHMENT_BYTES ||
        totalBytes + buffer.length > MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES
      ) {
        continue;
      }

      selection.blocks.push(this.toDirectProviderContentBlock(candidate, buffer));
      totalBytes += buffer.length;
      if (candidate.source === "canonical") {
        selection.directCanonicalAttachmentIds.add(candidate.referenceKey);
      }
      if (candidate.kind === "image") {
        selection.directImageCount += 1;
      } else {
        selection.directPdfCount += 1;
      }
    }

    return selection;
  }

  private toCanonicalDirectInputCandidate(
    attachment: CanonicalChatAttachmentRow
  ): DirectInputAttachmentCandidate | null {
    if (attachment.mimeType.startsWith("image/")) {
      return {
        source: "canonical",
        referenceKey: attachment.id,
        kind: "image",
        objectKey: attachment.storagePath,
        mimeType: attachment.mimeType,
        filename: attachment.originalFilename,
        sizeBytes: attachment.sizeBytes
      };
    }
    if (attachment.mimeType === "application/pdf") {
      return {
        source: "canonical",
        referenceKey: attachment.id,
        kind: "pdf",
        objectKey: attachment.storagePath,
        mimeType: attachment.mimeType,
        filename: attachment.originalFilename,
        sizeBytes: attachment.sizeBytes
      };
    }
    return null;
  }

  private toRuntimeDirectInputCandidate(
    attachment: RuntimeAttachmentRef
  ): DirectInputAttachmentCandidate | null {
    if (attachment.mimeType.startsWith("image/")) {
      return {
        source: "runtime",
        referenceKey: attachment.attachmentId,
        kind: "image",
        objectKey: attachment.objectKey,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
        sizeBytes: attachment.sizeBytes
      };
    }
    if (attachment.mimeType === "application/pdf") {
      return {
        source: "runtime",
        referenceKey: attachment.attachmentId,
        kind: "pdf",
        objectKey: attachment.objectKey,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
        sizeBytes: attachment.sizeBytes
      };
    }
    return null;
  }

  private toDirectProviderContentBlock(
    candidate: DirectInputAttachmentCandidate,
    buffer: Buffer
  ): DirectProviderContentBlock {
    if (candidate.kind === "image") {
      return {
        type: "image",
        mimeType: candidate.mimeType,
        dataBase64: buffer.toString("base64"),
        filename: candidate.filename
      };
    }

    return {
      type: "pdf",
      mimeType: "application/pdf",
      dataBase64: buffer.toString("base64"),
      filename: candidate.filename
    };
  }

  private createEmptyDirectInputSelection(): DirectInputSelection {
    return {
      blocks: [],
      directCanonicalAttachmentIds: new Set<string>(),
      directImageCount: 0,
      directPdfCount: 0
    };
  }

  private formatCanonicalAttachmentLine(
    attachment: CanonicalChatAttachmentRow,
    suppressContentPreview = false
  ): string {
    const name = attachment.originalFilename ? ` "${attachment.originalFilename}"` : "";
    const extras: string[] = [];
    if (attachment.transcription) {
      extras.push(`transcription: "${attachment.transcription.slice(0, 500)}"`);
    }
    if (!suppressContentPreview) {
      const contentPreview = this.readStoredAttachmentContentPreview(attachment.metadata);
      if (contentPreview !== null) {
        extras.push(`content preview: "${contentPreview}"`);
      }
    }
    const extrasStr = extras.length > 0 ? `, ${extras.join(", ")}` : "";
    return `- attachment (${attachment.attachmentType}${name}${extrasStr})`;
  }

  private formatRuntimeAttachmentLine(attachment: RuntimeAttachmentRef): string {
    const name = attachment.filename ? ` "${attachment.filename}"` : "";
    return `- attachment (${attachment.kind}${name})`;
  }

  private buildAttachmentBlock(input: {
    title: string;
    lines: string[];
    totalImageCount: number;
    directImageCount: number;
    totalPdfCount: number;
    directPdfCount: number;
  }): string {
    const block = [`[${input.title}:`, ...input.lines];
    if (input.totalImageCount > 0) {
      if (input.directImageCount === input.totalImageCount) {
        block.push(
          "Image attachments are included as direct model image input. Use the visible contents plus any attachment metadata and message text."
        );
      } else if (input.directImageCount > 0) {
        block.push(
          "Some image attachments are included as direct model image input when within the request-size budget. For any others, do not guess visual details not described in the attachment metadata or message text."
        );
      } else {
        block.push(
          "Image attachments are present. Do not guess visual details that are not described in the attachment metadata or message text."
        );
      }
    }
    if (input.totalPdfCount > 0) {
      if (input.directPdfCount === input.totalPdfCount) {
        block.push(
          "PDF attachments are included as direct model document input. Use the document contents plus any attachment metadata and message text."
        );
      } else if (input.directPdfCount > 0) {
        block.push(
          "Some PDF attachments are included as direct model document input when within the request-size budget. For any others, rely on attachment metadata and content preview when available."
        );
      } else {
        block.push(
          "PDF attachments are present. Use only attachment metadata and content preview when available; do not assume unseen layout or figures."
        );
      }
    }
    block.push("Use the attachment metadata, transcription, and content preview when available.]");
    return block.join("\n");
  }

  private readStoredAttachmentContentPreview(
    metadata: Record<string, unknown> | null | undefined
  ): string | null {
    const preview = metadata?.contentPreview;
    return typeof preview === "string" && preview.trim().length > 0 ? preview : null;
  }
}
