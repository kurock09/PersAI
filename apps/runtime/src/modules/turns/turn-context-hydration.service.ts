import { Injectable } from "@nestjs/common";
import type {
  ProviderGatewayTextMessage,
  RuntimeAttachmentRef,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import { RuntimeStatePrismaService } from "../runtime-state/infrastructure/persistence/runtime-state-prisma.service";

const MAX_CANONICAL_WEB_CONTEXT_MESSAGES = 20;

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
  transcription: string | null;
  metadata: Record<string, unknown> | null;
};

@Injectable()
export class TurnContextHydrationService {
  constructor(private readonly prisma: RuntimeStatePrismaService) {}

  async buildMessages(input: RuntimeTurnRequest): Promise<ProviderGatewayTextMessage[]> {
    if (input.conversation.channel !== "web") {
      return [this.createCurrentUserMessage(input)];
    }

    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        assistantId: input.conversation.assistantId,
        surface: "web",
        surfaceThreadKey: input.conversation.externalThreadKey
      },
      select: {
        id: true
      }
    });
    if (chat === null) {
      return [this.createCurrentUserMessage(input)];
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
        transcription: attachment.transcription,
        metadata: attachment.metadata as Record<string, unknown> | null
      }))
    }));

    const hydrated = this.hydrateCanonicalWebMessages(storedMessages, input);
    return hydrated.length > 0 ? hydrated : [this.createCurrentUserMessage(input)];
  }

  private hydrateCanonicalWebMessages(
    storedMessages: CanonicalChatMessageRow[],
    input: RuntimeTurnRequest
  ): ProviderGatewayTextMessage[] {
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
      const content = this.buildHydratedMessageContent({
        author: message.author,
        baseContent: isCurrentInboundMessage ? input.message.text : message.content,
        attachments: message.attachments,
        fallbackAttachments: isCurrentInboundMessage ? input.message.attachments : []
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
      hydrated.push(this.createCurrentUserMessage(input));
    }

    return hydrated.slice(-MAX_CANONICAL_WEB_CONTEXT_MESSAGES);
  }

  private createCurrentUserMessage(input: RuntimeTurnRequest): ProviderGatewayTextMessage {
    return {
      role: "user",
      content: this.buildHydratedMessageContent({
        author: "user",
        baseContent: input.message.text,
        attachments: [],
        fallbackAttachments: input.message.attachments
      })
    };
  }

  private buildHydratedMessageContent(input: {
    author: CanonicalChatMessageRow["author"];
    baseContent: string;
    attachments: CanonicalChatAttachmentRow[];
    fallbackAttachments: RuntimeAttachmentRef[];
  }): string {
    const attachmentLines =
      input.attachments.length > 0
        ? input.attachments.map((attachment) => this.formatCanonicalAttachmentLine(attachment))
        : input.fallbackAttachments.map((attachment) =>
            this.formatRuntimeAttachmentLine(attachment)
          );

    if (attachmentLines.length === 0) {
      return input.baseContent;
    }

    const attachmentBlock = this.buildAttachmentBlock({
      title: input.author === "assistant" ? "Assistant attachments" : "Files attached by user",
      lines: attachmentLines,
      hasImageAttachments:
        input.attachments.some((attachment) => attachment.attachmentType === "image") ||
        input.fallbackAttachments.some((attachment) => attachment.kind === "image")
    });
    const baseContent =
      input.baseContent.trim().length > 0
        ? input.baseContent
        : input.author === "assistant"
          ? "Assistant sent attachments."
          : "User sent attachments only.";
    return `${attachmentBlock}\n${baseContent}`;
  }

  private formatCanonicalAttachmentLine(attachment: CanonicalChatAttachmentRow): string {
    const name = attachment.originalFilename ? ` "${attachment.originalFilename}"` : "";
    const extras: string[] = [];
    if (attachment.transcription) {
      extras.push(`transcription: "${attachment.transcription.slice(0, 500)}"`);
    }
    const contentPreview = this.readStoredAttachmentContentPreview(attachment.metadata);
    if (contentPreview !== null) {
      extras.push(`content preview: "${contentPreview}"`);
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
    hasImageAttachments: boolean;
  }): string {
    const block = [`[${input.title}:`, ...input.lines];
    if (input.hasImageAttachments) {
      block.push(
        "Image attachments are present. Do not guess visual details that are not described in the attachment metadata or message text."
      );
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
