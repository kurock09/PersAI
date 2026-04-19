import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayImageContentBlock,
  ProviderGatewayMessageContent,
  ProviderGatewayPdfContentBlock,
  ProviderGatewayTextMessage,
  RuntimeAttachmentRef,
  RuntimeConversationAddress,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { RuntimeStatePrismaService } from "../runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import { RuntimeStateKeyspaceService } from "../runtime-state/runtime-state-keyspace.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import {
  estimateProviderGatewayMessageTokens,
  resolveRuntimeContextHydrationConfig,
  resolveSharedCompactionSummaryCharBudget
} from "./runtime-context-hydration-policy";
import {
  formatDurableMemoryStableBlock,
  formatSharedCompactionStableBlock
} from "./prompt-cache-stable-blocks";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";
import { parseStoredReusableCompactionState } from "./shared-compaction-state";

const MAX_DIRECT_PROVIDER_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024;
const MIN_HYDRATED_MEMORY_ITEMS = 3;
const MAX_HYDRATED_MEMORY_ITEMS = 10;
const MIN_HYDRATED_MEMORY_TOTAL_CHARS = 400;
const MAX_HYDRATED_MEMORY_TOTAL_CHARS = 1800;
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

type ReusableCompactionSummary = {
  summaryText: string;
  summarizedMessageCount: number;
};

type HydratedMemoryRow = {
  summary: string;
  sourceType: "web_chat" | "memory_write";
  sourceLabel: string | null;
  createdAt: Date;
};

export interface RuntimeCompactionMessageSource {
  messages: ProviderGatewayTextMessage[];
  summarizedMessageCount: number;
  preservedRecentMessageCount: number;
}

@Injectable()
export class TurnContextHydrationService {
  constructor(
    private readonly prisma: RuntimeStatePrismaService,
    private readonly runtimeStatePostgresService: RuntimeStatePostgresService,
    private readonly runtimeStateKeyspaceService: RuntimeStateKeyspaceService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly runtimeAssistantFileRegistryService: RuntimeAssistantFileRegistryService
  ) {}

  async buildMessages(
    input: RuntimeTurnRequest,
    bundle: AssistantRuntimeBundle
  ): Promise<ProviderGatewayTextMessage[]> {
    const contextHydration = resolveRuntimeContextHydrationConfig(bundle);
    const canonicalSurface = toHydratedCanonicalSurface(input.conversation.channel);
    if (canonicalSurface === null) {
      return [await this.createCurrentUserMessage(input)];
    }

    const storedMessages = await this.loadCanonicalChatMessages(input.conversation);
    const durableMemoryMessage = await this.loadDurableMemoryContextMessage(
      input.conversation.assistantId,
      contextHydration
    );
    if (storedMessages === null) {
      const currentUserMessage = await this.createCurrentUserMessage(input);
      return durableMemoryMessage === null
        ? [currentUserMessage]
        : this.limitHydratedMessages([durableMemoryMessage, currentUserMessage], contextHydration, {
            preserveLeadingMessageCount: 1
          });
    }

    const hydrated = await this.hydrateCanonicalWebMessages(
      storedMessages,
      input,
      durableMemoryMessage,
      contextHydration
    );
    if (hydrated.length > 0) {
      return hydrated;
    }
    const currentUserMessage = await this.createCurrentUserMessage(input);
    return durableMemoryMessage === null
      ? [currentUserMessage]
      : this.limitHydratedMessages([durableMemoryMessage, currentUserMessage], contextHydration, {
          preserveLeadingMessageCount: 1
        });
  }

  async buildCompactionMessages(input: {
    conversation: RuntimeConversationAddress;
    keepRecentMessageCount: number;
  }): Promise<RuntimeCompactionMessageSource> {
    const storedMessages = await this.loadCanonicalChatMessages(input.conversation);
    if (storedMessages === null) {
      return {
        messages: [],
        summarizedMessageCount: 0,
        preservedRecentMessageCount: 0
      };
    }

    const hydratableMessages = storedMessages.filter((message) =>
      this.isHydratableCanonicalMessage(message)
    );
    const keepRecentMessageCount = Math.max(0, input.keepRecentMessageCount);
    const summaryBoundary = Math.max(0, hydratableMessages.length - keepRecentMessageCount);
    const summarizedSourceMessages = hydratableMessages.slice(0, summaryBoundary);
    const messages: ProviderGatewayTextMessage[] = [];

    for (const message of summarizedSourceMessages) {
      const content = await this.buildHydratedMessageContent({
        assistantId: input.conversation.assistantId,
        workspaceId: input.conversation.workspaceId,
        author: message.author,
        baseContent: message.content,
        attachments: message.attachments,
        fallbackAttachments: [],
        allowDirectAttachmentInput: false
      });
      messages.push({
        role: this.toProviderRole(message.author),
        content
      });
    }

    return {
      messages,
      summarizedMessageCount: summarizedSourceMessages.length,
      preservedRecentMessageCount: hydratableMessages.length - summarizedSourceMessages.length
    };
  }

  private async hydrateCanonicalWebMessages(
    storedMessages: CanonicalChatMessageRow[],
    input: RuntimeTurnRequest,
    durableMemoryMessage: ProviderGatewayTextMessage | null,
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>
  ): Promise<ProviderGatewayTextMessage[]> {
    const hydratableMessages = storedMessages.filter((message) =>
      this.isHydratableCanonicalMessage(message)
    );
    const reusableSummary = await this.loadReusableCompactionSummary(
      input.conversation,
      contextHydration
    );
    if (reusableSummary === null) {
      const hydratedMessages = await this.hydrateCanonicalMessageSequence(
        hydratableMessages,
        input,
        contextHydration
      );
      if (durableMemoryMessage === null) {
        return hydratedMessages;
      }
      return this.limitHydratedMessages(
        [durableMemoryMessage, ...hydratedMessages],
        contextHydration,
        {
          preserveLeadingMessageCount: 1
        }
      );
    }

    const summaryBoundary = Math.min(
      reusableSummary.summarizedMessageCount,
      hydratableMessages.length
    );
    if (summaryBoundary <= 0) {
      const hydratedMessages = await this.hydrateCanonicalMessageSequence(
        hydratableMessages,
        input,
        contextHydration
      );
      if (durableMemoryMessage === null) {
        return hydratedMessages;
      }
      return this.limitHydratedMessages(
        [durableMemoryMessage, ...hydratedMessages],
        contextHydration,
        {
          preserveLeadingMessageCount: 1
        }
      );
    }

    const recentMessages = hydratableMessages.slice(summaryBoundary);
    const hydratedRecentMessages = await this.hydrateCanonicalMessageSequence(
      recentMessages,
      input,
      contextHydration
    );
    const prefixMessages: ProviderGatewayTextMessage[] = [];
    if (durableMemoryMessage !== null) {
      prefixMessages.push(durableMemoryMessage);
    }
    prefixMessages.push({
      role: "assistant",
      content: this.formatReusableCompactionSummary(reusableSummary.summaryText)
    });
    return this.limitHydratedMessages(
      [...prefixMessages, ...hydratedRecentMessages],
      contextHydration,
      {
        preserveLeadingMessageCount: prefixMessages.length
      }
    );
  }

  private async hydrateCanonicalMessageSequence(
    messages: CanonicalChatMessageRow[],
    input: RuntimeTurnRequest,
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>
  ): Promise<ProviderGatewayTextMessage[]> {
    const hydrated: ProviderGatewayTextMessage[] = [];
    let currentMessageFound = false;

    for (const message of messages) {
      const isCurrentInboundMessage = message.id === input.idempotencyKey;
      if (isCurrentInboundMessage) {
        currentMessageFound = true;
      }
      const content = await this.buildHydratedMessageContent({
        assistantId: input.conversation.assistantId,
        workspaceId: input.conversation.workspaceId,
        author: message.author,
        baseContent: isCurrentInboundMessage ? input.message.text : message.content,
        attachments: message.attachments,
        fallbackAttachments: isCurrentInboundMessage ? input.message.attachments : [],
        allowDirectAttachmentInput: isCurrentInboundMessage && message.author === "user"
      });

      hydrated.push({
        role: this.toProviderRole(message.author),
        content
      });
    }

    if (!currentMessageFound) {
      hydrated.push(await this.createCurrentUserMessage(input));
    }

    return this.limitHydratedMessages(hydrated, contextHydration);
  }

  private async loadCanonicalChatMessages(
    conversation: RuntimeConversationAddress
  ): Promise<CanonicalChatMessageRow[] | null> {
    const canonicalSurface = toHydratedCanonicalSurface(conversation.channel);
    if (canonicalSurface === null) {
      return null;
    }

    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        assistantId: conversation.assistantId,
        surface: canonicalSurface,
        surfaceThreadKey: conversation.externalThreadKey
      },
      select: {
        id: true
      }
    });
    if (chat === null) {
      return null;
    }

    const storedMessagesRaw = await this.prisma.assistantChatMessage.findMany({
      where: {
        chatId: chat.id,
        assistantId: conversation.assistantId
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

    return storedMessagesRaw.map((message) => ({
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
  }

  private isHydratableCanonicalMessage(message: CanonicalChatMessageRow): boolean {
    if (message.author === "system") {
      return false;
    }
    return !(message.content.trim().length === 0 && message.attachments.length === 0);
  }

  private async loadReusableCompactionSummary(
    conversation: RuntimeConversationAddress,
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>
  ): Promise<ReusableCompactionSummary | null> {
    const conversationKey = this.runtimeStateKeyspaceService.createConversationKey(conversation);
    const session =
      await this.runtimeStatePostgresService.findSessionByConversationKey(conversationKey);
    if (session === null) {
      return null;
    }

    const latestCompaction = await this.runtimeStatePostgresService.findLatestSessionCompaction(
      session.id
    );
    return this.parseReusableCompactionSummary(
      latestCompaction?.summaryPayload,
      resolveSharedCompactionSummaryCharBudget(contextHydration)
    );
  }

  private parseReusableCompactionSummary(
    payload: unknown,
    summaryCharBudget: number
  ): ReusableCompactionSummary | null {
    const parsed = parseStoredReusableCompactionState(payload, summaryCharBudget);
    if (parsed === null) {
      return null;
    }

    return {
      summaryText: parsed.summaryText,
      summarizedMessageCount: parsed.summarizedMessageCount
    };
  }

  private resolveHydratedMemoryItemLimit(knowledgeHydrationBudget: number): number {
    return Math.max(
      MIN_HYDRATED_MEMORY_ITEMS,
      Math.min(MAX_HYDRATED_MEMORY_ITEMS, Math.ceil(knowledgeHydrationBudget / 500))
    );
  }

  private resolveHydratedMemoryCharBudget(knowledgeHydrationBudget: number): number {
    return Math.max(
      Math.min(knowledgeHydrationBudget, MIN_HYDRATED_MEMORY_TOTAL_CHARS),
      Math.min(MAX_HYDRATED_MEMORY_TOTAL_CHARS, Math.floor(knowledgeHydrationBudget / 2))
    );
  }

  private async loadDurableMemoryContextMessage(
    assistantId: string,
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>
  ): Promise<ProviderGatewayTextMessage | null> {
    if (contextHydration.knowledgeHydrationBudget <= 0) {
      return null;
    }
    const maxHydratedMemoryItems = this.resolveHydratedMemoryItemLimit(
      contextHydration.knowledgeHydrationBudget
    );
    const maxHydratedMemoryTotalChars = this.resolveHydratedMemoryCharBudget(
      contextHydration.knowledgeHydrationBudget
    );
    const rows = (await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        summary: true,
        sourceType: true,
        sourceLabel: true,
        createdAt: true
      },
      take: maxHydratedMemoryItems * 2
    })) as HydratedMemoryRow[];

    if (rows.length === 0) {
      return null;
    }

    const dedupedRows = [...rows]
      .sort((left, right) => {
        if (left.sourceType !== right.sourceType) {
          return left.sourceType === "memory_write" ? -1 : 1;
        }
        return right.createdAt.getTime() - left.createdAt.getTime();
      })
      .filter((row, index, collection) => {
        const normalized = row.summary.trim().toLowerCase();
        if (normalized.length === 0) {
          return false;
        }
        return (
          collection.findIndex(
            (candidate) => candidate.summary.trim().toLowerCase() === normalized
          ) === index
        );
      });

    let totalChars = 0;
    const lines: string[] = [];
    for (const row of dedupedRows) {
      const label = row.sourceLabel?.trim().length
        ? row.sourceLabel.trim()
        : row.sourceType === "memory_write"
          ? "Durable memory"
          : "Conversation memory";
      const line = `- [${label}] ${row.summary.trim()}`;
      if (line.length === 0) {
        continue;
      }
      if (
        lines.length >= maxHydratedMemoryItems ||
        totalChars + line.length > maxHydratedMemoryTotalChars
      ) {
        break;
      }
      lines.push(line);
      totalChars += line.length;
    }

    if (lines.length === 0) {
      return null;
    }

    return {
      role: "assistant",
      content: formatDurableMemoryStableBlock(lines)
    };
  }

  private toProviderRole(author: CanonicalChatMessageRow["author"]): "user" | "assistant" {
    return author === "assistant" ? "assistant" : "user";
  }

  private formatReusableCompactionSummary(summaryText: string): string {
    return formatSharedCompactionStableBlock(summaryText);
  }

  private limitHydratedMessages(
    messages: ProviderGatewayTextMessage[],
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>,
    options?: { preserveLeadingMessageCount?: number }
  ): ProviderGatewayTextMessage[] {
    if (messages.length === 0) {
      return messages;
    }

    const preserveLeadingMessageCount = Math.max(
      0,
      Math.min(options?.preserveLeadingMessageCount ?? 0, messages.length)
    );
    const targetBudget = Math.max(1, contextHydration.targetContextBudget);
    const selectedIndexes = new Set<number>();
    let consumedBudget = 0;

    for (let index = 0; index < preserveLeadingMessageCount; index += 1) {
      selectedIndexes.add(index);
      consumedBudget += estimateProviderGatewayMessageTokens(messages[index]!);
    }

    let selectedTrailingCount = 0;
    for (let index = messages.length - 1; index >= preserveLeadingMessageCount; index -= 1) {
      const tokens = estimateProviderGatewayMessageTokens(messages[index]!);
      const mustKeepTrailing = index === messages.length - 1 && selectedTrailingCount === 0;
      if (consumedBudget + tokens > targetBudget && !mustKeepTrailing) {
        break;
      }
      selectedIndexes.add(index);
      selectedTrailingCount += 1;
      consumedBudget += tokens;
    }

    return messages.filter((_, index) => selectedIndexes.has(index));
  }

  private async createCurrentUserMessage(
    input: RuntimeTurnRequest
  ): Promise<ProviderGatewayTextMessage> {
    return {
      role: "user",
      content: await this.buildHydratedMessageContent({
        assistantId: input.conversation.assistantId,
        workspaceId: input.conversation.workspaceId,
        author: "user",
        baseContent: input.message.text,
        attachments: [],
        fallbackAttachments: input.message.attachments,
        allowDirectAttachmentInput: true
      })
    };
  }

  private async buildHydratedMessageContent(input: {
    assistantId: string;
    workspaceId: string;
    author: CanonicalChatMessageRow["author"];
    baseContent: string;
    attachments: CanonicalChatAttachmentRow[];
    fallbackAttachments: RuntimeAttachmentRef[];
    allowDirectAttachmentInput: boolean;
  }): Promise<ProviderGatewayMessageContent> {
    const directInputSelection = input.allowDirectAttachmentInput
      ? await this.buildDirectInputSelection(input.attachments, input.fallbackAttachments)
      : this.createEmptyDirectInputSelection();
    const textContent = await this.buildHydratedMessageTextContent({
      ...input,
      directCanonicalAttachmentIds: directInputSelection.directCanonicalAttachmentIds,
      directImageCount: directInputSelection.directImageCount,
      directPdfCount: directInputSelection.directPdfCount,
      showCurrentTurnImageOrdinals: input.allowDirectAttachmentInput && input.author === "user"
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

  private async buildHydratedMessageTextContent(input: {
    assistantId: string;
    workspaceId: string;
    author: CanonicalChatMessageRow["author"];
    baseContent: string;
    attachments: CanonicalChatAttachmentRow[];
    fallbackAttachments: RuntimeAttachmentRef[];
    directCanonicalAttachmentIds: Set<string>;
    directImageCount: number;
    directPdfCount: number;
    showCurrentTurnImageOrdinals: boolean;
  }): Promise<string> {
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
        ? await this.formatCanonicalAttachmentLines(
            input.assistantId,
            input.workspaceId,
            input.author,
            input.attachments,
            input.directCanonicalAttachmentIds,
            input.showCurrentTurnImageOrdinals
          )
        : await this.formatRuntimeAttachmentLines(
            input.assistantId,
            input.workspaceId,
            input.fallbackAttachments,
            input.showCurrentTurnImageOrdinals
          );

    if (attachmentLines.length === 0) {
      return input.baseContent;
    }

    if (input.author === "assistant") {
      return this.buildAssistantMessageWithAttachmentSummary(input.baseContent, attachmentLines);
    }

    const attachmentBlock = this.buildAttachmentBlock({
      title: "Files attached by user",
      lines: attachmentLines,
      totalImageCount,
      directImageCount: input.directImageCount,
      totalPdfCount,
      directPdfCount: input.directPdfCount,
      showCurrentTurnImageOrdinals: input.showCurrentTurnImageOrdinals
    });
    const baseContent =
      input.baseContent.trim().length > 0 ? input.baseContent : "User sent attachments only.";
    return `${attachmentBlock}\n${baseContent}`;
  }

  private buildAssistantMessageWithAttachmentSummary(
    baseContent: string,
    attachmentLines: string[]
  ): string {
    const descriptors = attachmentLines.map((line) => this.toAttachmentSummaryDescriptor(line));
    const attachmentSummary =
      descriptors.length === 1
        ? `Assistant sent an attachment: ${descriptors[0]}.`
        : `Assistant sent attachments: ${descriptors.join("; ")}.`;

    if (baseContent.trim().length > 0) {
      return `${baseContent}\n\n${attachmentSummary}`;
    }

    return attachmentSummary;
  }

  private async formatCanonicalAttachmentLines(
    assistantId: string,
    workspaceId: string,
    author: CanonicalChatMessageRow["author"],
    attachments: CanonicalChatAttachmentRow[],
    directCanonicalAttachmentIds: Set<string>,
    showCurrentTurnImageOrdinals: boolean
  ): Promise<string[]> {
    let imageOrdinal = 0;
    return await Promise.all(
      attachments.map((attachment) => {
        const imageIndex =
          showCurrentTurnImageOrdinals && attachment.mimeType.startsWith("image/")
            ? (imageOrdinal += 1)
            : null;
        return this.formatCanonicalAttachmentLine({
          assistantId,
          workspaceId,
          origin: author === "user" ? "uploaded_attachment" : "runtime_output",
          referenceId: attachment.id,
          objectKey: attachment.storagePath,
          filename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          attachmentType: attachment.attachmentType,
          transcription: attachment.transcription,
          metadata: attachment.metadata,
          suppressContentPreview: directCanonicalAttachmentIds.has(attachment.id),
          imageIndex
        });
      })
    );
  }

  private async formatRuntimeAttachmentLines(
    assistantId: string,
    workspaceId: string,
    attachments: RuntimeAttachmentRef[],
    showCurrentTurnImageOrdinals: boolean
  ): Promise<string[]> {
    let imageOrdinal = 0;
    return await Promise.all(
      attachments.map((attachment) => {
        const imageIndex =
          showCurrentTurnImageOrdinals && attachment.mimeType.startsWith("image/")
            ? (imageOrdinal += 1)
            : null;
        return this.formatRuntimeAttachmentLine(assistantId, workspaceId, attachment, imageIndex);
      })
    );
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

  private async formatCanonicalAttachmentLine(input: {
    assistantId: string;
    workspaceId: string;
    origin: "uploaded_attachment" | "runtime_output";
    referenceId: string;
    objectKey: string;
    filename: string | null;
    mimeType: string;
    sizeBytes: number;
    attachmentType: CanonicalChatAttachmentRow["attachmentType"];
    transcription: string | null;
    metadata: Record<string, unknown> | null;
    suppressContentPreview?: boolean;
    imageIndex?: number | null;
  }): Promise<string> {
    const name = input.filename ? ` "${input.filename}"` : "";
    const extras: string[] = [];
    if (input.transcription) {
      extras.push(`transcription: "${input.transcription.slice(0, 500)}"`);
    }
    const fileRef = await this.ensureAttachmentFileRef({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      origin: input.origin,
      referenceId: input.referenceId,
      objectKey: input.objectKey,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes
    });
    extras.push(`fileRef: "${fileRef}"`);
    if (!input.suppressContentPreview) {
      const contentPreview = this.readStoredAttachmentContentPreview(input.metadata);
      if (contentPreview !== null) {
        extras.push(`content preview: "${contentPreview}"`);
      }
    }
    const extrasStr = extras.length > 0 ? `, ${extras.join(", ")}` : "";
    const kind =
      input.attachmentType === "image" && input.imageIndex !== null
        ? `image #${String(input.imageIndex)}`
        : input.attachmentType;
    return `- attachment (${kind}${name}${extrasStr})`;
  }

  private async formatRuntimeAttachmentLine(
    assistantId: string,
    workspaceId: string,
    attachment: RuntimeAttachmentRef,
    imageIndex: number | null = null
  ): Promise<string> {
    const name = attachment.filename ? ` "${attachment.filename}"` : "";
    const fileRef =
      attachment.fileRef ??
      (await this.ensureAttachmentFileRef({
        assistantId,
        workspaceId,
        origin: "uploaded_attachment",
        referenceId: attachment.attachmentId,
        objectKey: attachment.objectKey,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes
      }));
    const kind =
      attachment.kind === "image" && imageIndex !== null
        ? `image #${String(imageIndex)}`
        : attachment.kind;
    return `- attachment (${kind}${name}, fileRef: "${fileRef}")`;
  }

  private toAttachmentSummaryDescriptor(line: string): string {
    if (line.startsWith("- attachment (") && line.endsWith(")")) {
      return line.slice("- attachment (".length, -1);
    }
    return line.replace(/^- /, "");
  }

  private buildAttachmentBlock(input: {
    title: string;
    lines: string[];
    totalImageCount: number;
    directImageCount: number;
    totalPdfCount: number;
    directPdfCount: number;
    showCurrentTurnImageOrdinals: boolean;
  }): string {
    const block = [`[${input.title}:`, ...input.lines];
    if (input.showCurrentTurnImageOrdinals && input.totalImageCount > 1) {
      block.push(
        "Current-turn image attachments are numbered image #1, image #2, and so on in this list. Use those numbers when a tool needs an explicit source or reference image."
      );
    }
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
    block.push(
      "When you need to resend or operate on an existing attachment, prefer its fileRef instead of guessing from the filename alone."
    );
    block.push("Use the attachment metadata, transcription, and content preview when available.]");
    return block.join("\n");
  }

  private async ensureAttachmentFileRef(input: {
    assistantId: string;
    workspaceId: string;
    origin: "uploaded_attachment" | "runtime_output";
    referenceId: string;
    objectKey: string;
    filename: string | null;
    mimeType: string;
    sizeBytes: number;
  }): Promise<string> {
    const file = await this.runtimeAssistantFileRegistryService.ensureAttachmentBackedFile(input);
    return file.fileRef;
  }

  private readStoredAttachmentContentPreview(
    metadata: Record<string, unknown> | null | undefined
  ): string | null {
    const preview = metadata?.contentPreview;
    return typeof preview === "string" && preview.trim().length > 0 ? preview : null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
