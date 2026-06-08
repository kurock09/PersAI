import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayImageContentBlock,
  ProviderGatewayMessageContent,
  ProviderGatewayPdfContentBlock,
  ProviderGatewayTextMessage,
  RuntimeAttachmentRef,
  RuntimeFileRef,
  RuntimeOutputArtifact,
  RuntimeConversationAddress,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { RuntimeStatePrismaService } from "../runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import { RuntimeStateKeyspaceService } from "../runtime-state/runtime-state-keyspace.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import {
  PersaiInternalApiClientService,
  type InternalCrossSessionCarryOverOpenLoop,
  type InternalHydratedDurableMemoryItem
} from "./persai-internal-api.client.service";
import {
  estimateProviderGatewayMessageTokens,
  resolveRuntimeContextHydrationConfig,
  resolveSharedCompactionSummaryCharBudget
} from "./runtime-context-hydration-policy";
import {
  formatCrossSessionCarryOverStableBlock,
  formatDurableMemoryContextualBlock,
  formatDurableMemoryCoreStableBlock,
  formatSharedCompactionStableBlock
} from "./prompt-cache-stable-blocks";
import { renderCrossSessionCarryOverBlock } from "./cross-session-carry-over-renderer";
import { renderPresenceBlock } from "./presence-renderer";
import {
  RuntimeAssistantFileRegistryService,
  type RuntimeAssistantFileRecord
} from "./runtime-assistant-file-registry.service";
import { parseStoredReusableCompactionState } from "./shared-compaction-state";

const MAX_DIRECT_PROVIDER_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024;
const MIN_HYDRATED_MEMORY_ITEMS = 3;
const MAX_HYDRATED_MEMORY_ITEMS = 10;
const MIN_HYDRATED_MEMORY_TOTAL_CHARS = 400;
const MAX_HYDRATED_MEMORY_TOTAL_CHARS = 1800;
const MAX_RECENT_IMAGE_TOOL_MESSAGES = 8;
const MAX_RECENT_IMAGE_TOOL_ATTACHMENTS = 6;
const MAX_RECENT_DOCUMENT_SOURCE_ATTACHMENTS = 4;
/** ADR-100 Piece 2 — how many most-recent assistant messages to scan for discovered file ids. */
const RECENT_FILE_DISCOVERY_MESSAGE_WINDOW = 5;
/** ADR-100 Piece 2 — hard cap on Working Files entries injected from discovery history. */
const MAX_RECENT_DISCOVERED_FILES = 6;
const MAX_OPEN_LOOP_REFS_DEVELOPER_ITEMS = 5;
const MAX_OPEN_LOOP_REF_SUMMARY_CHARS = 72;
const MAX_OPEN_LOOP_REF_SELECTION_TOKENS = 12;
const OPEN_LOOP_REF_TOKEN_MIN_LENGTH = 2;
const OPEN_LOOP_REF_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "plan",
  "loop",
  "open",
  "closed",
  "close",
  "user",
  "need",
  "нужно",
  "надо",
  "петлю",
  "петля",
  "закрой",
  "закрыть",
  "план",
  "история",
  "there",
  "from"
]);
// ADR-074 F1: Postgres uuid columns reject any non-UUID literal in `WHERE`
// clauses with `Inconsistent column data: Error creating UUID, …`. We use this
// guard before passing `RuntimeTurnRequest.idempotencyKey` (free-form string)
// into a Prisma uuid column comparison. Exported for the regression unit
// test that pins the exact set of rejected shapes.
const UUID_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuidLikeIdempotencyKey(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_LIKE_REGEX.test(value);
}
type HydratedCanonicalSurface = Extract<
  RuntimeTurnRequest["conversation"]["channel"],
  "web" | "telegram"
>;

function toHydratedCanonicalSurface(
  channel: RuntimeTurnRequest["conversation"]["channel"]
): HydratedCanonicalSurface | null {
  return channel === "web" || channel === "telegram" ? channel : null;
}

function renderOpenLoopRefsDeveloperBlock(
  openLoops: InternalCrossSessionCarryOverOpenLoop[],
  totalUnresolvedOpenLoops: number
): string | null {
  const rows = openLoops
    .map((row) => {
      const summary = normalizeOpenLoopRefSummary(row.summary);
      return summary === null ? null : `${row.id} | ${summary}`;
    })
    .filter((row): row is string => row !== null);
  if (rows.length === 0) {
    return null;
  }
  const lines = [
    "## Open Loop Refs",
    "Server-owned refs for unresolved open loops. Use an exact `ref` only when the user clearly confirms that specific loop is resolved.",
    'Do not invent refs and do not say a loop is closed unless `memory_write({ action: "close", ref })` returns `action: "closed"`.'
  ];
  for (const row of rows) {
    lines.push(`- ${row}`);
  }
  if (totalUnresolvedOpenLoops > rows.length) {
    lines.push(`- ... ${totalUnresolvedOpenLoops - rows.length} more unresolved loops omitted.`);
  }
  return lines.join("\n");
}

function selectRelevantOpenLoopRefsForDeveloperBlock(input: {
  openLoops: InternalCrossSessionCarryOverOpenLoop[];
  currentUserMessage: string;
}): InternalCrossSessionCarryOverOpenLoop[] {
  const queryTokens = tokenizeOpenLoopRefText(input.currentUserMessage);
  const scored = input.openLoops.map((row, index) => ({
    row,
    index,
    overlapScore: scoreOpenLoopRefCandidate(queryTokens, row.summary),
    createdAtMs: parseOpenLoopCreatedAt(row.createdAt)
  }));
  scored.sort((left, right) => {
    if (right.overlapScore !== left.overlapScore) {
      return right.overlapScore - left.overlapScore;
    }
    if (right.createdAtMs !== left.createdAtMs) {
      return right.createdAtMs - left.createdAtMs;
    }
    return left.index - right.index;
  });
  return scored.slice(0, MAX_OPEN_LOOP_REFS_DEVELOPER_ITEMS).map((entry) => entry.row);
}

function scoreOpenLoopRefCandidate(queryTokens: Set<string>, summary: string): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const summaryTokens = tokenizeOpenLoopRefText(summary);
  let overlap = 0;
  for (const token of queryTokens) {
    if (summaryTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function tokenizeOpenLoopRefText(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= OPEN_LOOP_REF_TOKEN_MIN_LENGTH && !OPEN_LOOP_REF_STOPWORDS.has(token)
    )
    .slice(0, MAX_OPEN_LOOP_REF_SELECTION_TOKENS);
  return new Set(tokens);
}

function parseOpenLoopCreatedAt(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function pruneClosedOpenLoopRefsDeveloperBlock(
  block: string | null,
  closedRefs: readonly string[]
): string | null {
  if (block === null || closedRefs.length === 0) {
    return block;
  }
  const closedRefSet = new Set(closedRefs);
  const lines = block.split("\n");
  const nextLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      return true;
    }
    const pipeIndex = trimmed.indexOf(" | ");
    if (pipeIndex < 0) {
      return true;
    }
    const ref = trimmed.slice(2, pipeIndex).trim();
    return !closedRefSet.has(ref);
  });
  const hasRefRows = nextLines.some((line) => line.trim().startsWith("- ") && line.includes(" | "));
  return hasRefRows ? nextLines.join("\n") : null;
}

function normalizeOpenLoopRefSummary(summary: string): string | null {
  const trimmed = summary.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= MAX_OPEN_LOOP_REF_SUMMARY_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_OPEN_LOOP_REF_SUMMARY_CHARS - 1).trimEnd()}...`;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

type CanonicalChatMessageRow = {
  id: string;
  author: "user" | "assistant" | "system";
  content: string;
  createdAt: Date | null;
  attachments: CanonicalChatAttachmentRow[];
  /** ADR-100 Piece 2 — optional JSONB metadata from the message row; may contain discoveredFileRefIds. */
  metadata?: Record<string, unknown> | null;
};

// ADR-074 Slice M3.2 — minimal `assistant_chats` row metadata needed to
// evaluate the long-idle re-trigger and per-thread cooldown gates.
// `lastMessageAt` is the canonical "freshness" cell already maintained by
// the chat-message persistence path and is used as the idle-since anchor.
// `lastCrossSessionCarryOverAt` is the new bookkeeping cell introduced by
// M3.2 and is bumped fire-and-forget by the runtime after each non-empty
// carry-over render.
type AssistantChatRowMeta = {
  id: string;
  lastMessageAt: Date | null;
  lastCrossSessionCarryOverAt: Date | null;
};

type CanonicalChatAttachmentRow = {
  id: string;
  assistantFileId: string | null;
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
  preservedRecentMessageCount: number;
};

type DurableMemoryHydration = {
  coreMessage: ProviderGatewayTextMessage | null;
  contextualMessage: ProviderGatewayTextMessage | null;
};

// ADR-074 Slice M3 — output of the cross-session continuity carry-over
// fetch + render. `null` = no block this turn (either not turn 0, the
// fetch failed gracefully, or both lists were empty after filtering).
type CrossSessionCarryOverHydration = {
  message: ProviderGatewayTextMessage;
};

export interface RuntimeCompactionMessageSource {
  messages: ProviderGatewayTextMessage[];
  summarizedMessageCount: number;
  preservedRecentMessageCount: number;
}

@Injectable()
export class TurnContextHydrationService {
  private readonly logger = new Logger(TurnContextHydrationService.name);

  constructor(
    private readonly prisma: RuntimeStatePrismaService,
    private readonly runtimeStatePostgresService: RuntimeStatePostgresService,
    private readonly runtimeStateKeyspaceService: RuntimeStateKeyspaceService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly runtimeAssistantFileRegistryService: RuntimeAssistantFileRegistryService,
    private readonly persaiInternalApiClient: PersaiInternalApiClientService
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
    const chatRowMeta = await this.loadAssistantChatRowMeta(input.conversation);
    const durableMemory = await this.loadDurableMemoryHydration(
      input.conversation.assistantId,
      input.message.text,
      contextHydration
    );
    // ADR-074 Slice M3 + M3.2 — the cross-session continuity carry-over block
    // fires when EITHER the current turn is the first turn of a brand-new
    // thread (M3, cooldown-exempt) OR the most recent stored user message is
    // older than `crossSessionCarryOverIdleHours` AND the per-thread cooldown
    // (`crossSessionCarryOverCooldownHours`) has elapsed since the last fire
    // (M3.2). The post-compaction sub-trigger is intentionally OUT OF SCOPE
    // (founder 2026-04-22): re-firing the magic block in the middle of a
    // live conversation just because auto-compaction silently ran would
    // feel like the assistant "suddenly remembers" things mid-flow.
    const fireDecision = this.shouldFireCrossSessionCarryOver({
      storedMessages,
      input,
      contextHydration,
      chatRowMeta
    });
    const carryOver = fireDecision.shouldFire
      ? await this.loadCrossSessionCarryOverHydration(input, contextHydration)
      : null;
    if (carryOver !== null && chatRowMeta !== null) {
      this.markCrossSessionCarryOverFiredFireAndForget({
        assistantChatId: chatRowMeta.id,
        firedAt: new Date(),
        requestId: input.requestId
      });
    }
    if (storedMessages === null) {
      const currentUserMessage = await this.createCurrentUserMessage(input);
      return this.composeWithCarryOverDurableMemoryAndConversation(
        carryOver,
        durableMemory,
        [currentUserMessage],
        contextHydration
      );
    }

    const hydrated = await this.hydrateCanonicalWebMessages(
      storedMessages,
      input,
      durableMemory,
      carryOver,
      contextHydration
    );
    if (hydrated.length > 0) {
      return hydrated;
    }
    const currentUserMessage = await this.createCurrentUserMessage(input);
    return this.composeWithCarryOverDurableMemoryAndConversation(
      carryOver,
      durableMemory,
      [currentUserMessage],
      contextHydration
    );
  }

  async listAvailableImageToolAttachments(input: {
    conversation: RuntimeConversationAddress;
    currentAttachments: RuntimeAttachmentRef[];
  }): Promise<RuntimeAttachmentRef[]> {
    let currentImageOrdinal = 0;
    let currentAttachmentOrdinal = 0;
    const currentImages = this.dedupeRuntimeAttachments(
      input.currentAttachments
        .filter((attachment) => attachment.kind === "image")
        .map((attachment) => ({
          ...attachment,
          aliases: this.mergeAliases(
            attachment.aliases,
            `current attachment #${String(++currentAttachmentOrdinal)}`,
            `current image #${String(++currentImageOrdinal)}`
          )
        }))
    );
    const canonicalSurface = toHydratedCanonicalSurface(input.conversation.channel);
    if (canonicalSurface === null) {
      return currentImages;
    }

    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        assistantId: input.conversation.assistantId,
        surface: canonicalSurface,
        surfaceThreadKey: input.conversation.externalThreadKey
      },
      select: { id: true }
    });
    if (chat === null) {
      return currentImages;
    }

    const recentMessages = await this.prisma.assistantChatMessage.findMany({
      where: {
        chatId: chat.id,
        assistantId: input.conversation.assistantId,
        attachments: {
          some: {
            processingStatus: "ready",
            attachmentType: "image"
          }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_RECENT_IMAGE_TOOL_MESSAGES,
      select: {
        author: true,
        attachments: {
          where: {
            processingStatus: "ready",
            attachmentType: "image"
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            assistantFileId: true,
            originalFilename: true,
            mimeType: true,
            storagePath: true,
            sizeBytes: true
          }
        }
      }
    });
    let previousAttachmentOrdinal = 0;
    let previousImageOrdinal = 0;
    let lastGeneratedImageAssigned = false;
    const recentImages: RuntimeAttachmentRef[] = [];
    for (const message of recentMessages) {
      for (const attachment of message.attachments) {
        if (!attachment.mimeType.startsWith("image/")) {
          continue;
        }
        const aliases = [
          `previous attachment #${String(++previousAttachmentOrdinal)}`,
          `previous image #${String(++previousImageOrdinal)}`
        ];
        const record = await this.resolveAttachmentFileRecord(
          input.conversation.assistantId,
          input.conversation.workspaceId,
          {
            attachmentId: attachment.id,
            fileRef: attachment.assistantFileId,
            objectKey: attachment.storagePath,
            filename: attachment.originalFilename,
            mimeType: attachment.mimeType,
            sizeBytes: Number(attachment.sizeBytes)
          },
          message.author === "assistant" ? "runtime_output" : "uploaded_attachment"
        );
        if (
          !lastGeneratedImageAssigned &&
          record !== null &&
          this.isAssistantGeneratedFile(record)
        ) {
          aliases.unshift("last generated image");
          lastGeneratedImageAssigned = true;
        }
        recentImages.push(
          this.toImageToolAttachmentRef(
            {
              attachmentId: attachment.id,
              filename: attachment.originalFilename,
              mimeType: attachment.mimeType,
              objectKey: attachment.storagePath,
              sizeBytes: Number(attachment.sizeBytes)
            },
            aliases
          )
        );
        if (recentImages.length >= MAX_RECENT_IMAGE_TOOL_ATTACHMENTS) {
          return this.dedupeRuntimeAttachments([...currentImages, ...recentImages]);
        }
      }
    }
    return this.dedupeRuntimeAttachments([...currentImages, ...recentImages]);
  }

  async listAvailableDocumentSourceAttachments(input: {
    conversation: RuntimeConversationAddress;
    currentAttachments: RuntimeAttachmentRef[];
  }): Promise<RuntimeAttachmentRef[]> {
    let currentAttachmentOrdinal = 0;
    const currentSources = input.currentAttachments
      .filter((attachment) => this.isDocumentSourceAttachmentMime(attachment.mimeType))
      .map((attachment) => ({
        ...attachment,
        aliases: this.mergeAliases(
          attachment.aliases,
          `current attachment #${String(++currentAttachmentOrdinal)}`
        )
      }));

    const storedMessages = await this.loadCanonicalChatMessages(input.conversation);
    if (storedMessages === null) {
      return this.dedupeRuntimeAttachments(currentSources);
    }

    let previousAttachmentOrdinal = 0;
    const previousSources: RuntimeAttachmentRef[] = [];
    for (const message of [...storedMessages].reverse()) {
      if (message.author !== "user") {
        continue;
      }
      for (const attachment of [...message.attachments].reverse()) {
        if (!this.isDocumentSourceAttachmentMime(attachment.mimeType)) {
          continue;
        }
        previousSources.push({
          attachmentId: attachment.id,
          kind: "file",
          objectKey: attachment.storagePath,
          mimeType: attachment.mimeType,
          filename: attachment.originalFilename,
          sizeBytes: attachment.sizeBytes,
          fileRef: attachment.assistantFileId,
          aliases: [`previous attachment #${String(++previousAttachmentOrdinal)}`]
        });
        if (previousSources.length >= MAX_RECENT_DOCUMENT_SOURCE_ATTACHMENTS) {
          return this.dedupeRuntimeAttachments([...currentSources, ...previousSources]);
        }
      }
    }

    return this.dedupeRuntimeAttachments([...currentSources, ...previousSources]);
  }

  async listAvailableWorkingFileRefs(input: {
    conversation: RuntimeConversationAddress;
    currentAttachments: RuntimeAttachmentRef[];
    currentFileRefs?: RuntimeFileRef[];
    currentArtifacts?: RuntimeOutputArtifact[];
  }): Promise<RuntimeFileRef[]> {
    const refs = new Map<string, RuntimeFileRef>();

    let currentAttachmentOrdinal = 0;
    let currentImageOrdinal = 0;
    for (const attachment of input.currentAttachments) {
      const runtimeFileRef = await this.resolveRuntimeFileRefForAttachment(
        input.conversation.assistantId,
        input.conversation.workspaceId,
        attachment
      );
      if (runtimeFileRef === null) {
        continue;
      }
      const aliases = [`current attachment #${String(++currentAttachmentOrdinal)}`];
      if (attachment.kind === "image") {
        aliases.unshift(`current image #${String(++currentImageOrdinal)}`);
      }
      this.upsertWorkingFileRef(refs, runtimeFileRef, aliases);
    }

    const storedMessages = await this.loadCanonicalChatMessages(input.conversation);
    if (storedMessages !== null) {
      let previousAttachmentOrdinal = 0;
      let previousImageOrdinal = 0;
      let lastGeneratedFileAssigned = false;
      let lastGeneratedImageAssigned = false;
      for (const message of [...storedMessages].reverse()) {
        for (const attachment of [...message.attachments].reverse()) {
          const record = await this.resolveAttachmentFileRecord(
            input.conversation.assistantId,
            input.conversation.workspaceId,
            {
              attachmentId: attachment.id,
              fileRef: attachment.assistantFileId,
              objectKey: attachment.storagePath,
              filename: attachment.originalFilename,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes
            },
            message.author === "assistant" ? "runtime_output" : "uploaded_attachment"
          );
          if (record === null) {
            continue;
          }
          const aliases = [`previous attachment #${String(++previousAttachmentOrdinal)}`];
          if (attachment.mimeType.startsWith("image/")) {
            aliases.unshift(`previous image #${String(++previousImageOrdinal)}`);
          }
          if (!lastGeneratedFileAssigned && this.isAssistantGeneratedFile(record)) {
            aliases.unshift("last generated file");
            lastGeneratedFileAssigned = true;
          }
          if (
            this.isAssistantGeneratedFile(record) &&
            attachment.mimeType.startsWith("image/") &&
            !lastGeneratedImageAssigned
          ) {
            aliases.unshift("last generated image");
            lastGeneratedImageAssigned = true;
          }
          this.upsertWorkingFileRef(
            refs,
            this.runtimeAssistantFileRegistryService.toRuntimeFileRef(record),
            aliases
          );
        }
      }
    }

    const currentGeneratedArtifacts = input.currentArtifacts ?? [];
    let generatedFileOrdinal = 0;
    let generatedImageOrdinal = 0;
    for (let index = currentGeneratedArtifacts.length - 1; index >= 0; index -= 1) {
      const artifact = currentGeneratedArtifacts[index]!;
      const aliases = [`generated file #${String(++generatedFileOrdinal)}`];
      if (artifact.kind === "image") {
        aliases.unshift(`generated image #${String(++generatedImageOrdinal)}`);
      }
      if (index === currentGeneratedArtifacts.length - 1) {
        aliases.unshift("last generated file");
        if (artifact.kind === "image") {
          aliases.unshift("last generated image");
        }
      }
      this.upsertWorkingFileRef(refs, artifact.file, aliases);
    }

    let currentFileOrdinal = 0;
    for (const fileRef of input.currentFileRefs ?? []) {
      this.upsertWorkingFileRef(refs, fileRef, [`current file #${String(++currentFileOrdinal)}`]);
    }

    // ADR-100 Piece 2 — inject recent discovered files from the last K assistant
    // messages into Working Files so the model can reference them without
    // re-calling the files tool.
    await this.injectRecentDiscoveredFileRefs(input.conversation, refs);

    return [...refs.values()];
  }

  /**
   * ADR-100 Piece 2 — scans the last RECENT_FILE_DISCOVERY_MESSAGE_WINDOW
   * assistant messages for `metadata.discoveredFileRefIds`, fetches the
   * corresponding AssistantFile rows (single bounded query), drops missing
   * rows silently, dedupes against already-present Working Files entries,
   * and upserts survivors as `recent file #N` (most-recent-first, 1-based,
   * cap MAX_RECENT_DISCOVERED_FILES). The `semanticSummaryHint` is populated
   * from `AssistantFile.metadata.semanticSummary` via the registry mapper.
   */
  private async injectRecentDiscoveredFileRefs(
    conversation: RuntimeConversationAddress,
    refs: Map<string, RuntimeFileRef>
  ): Promise<void> {
    const canonicalSurface = toHydratedCanonicalSurface(conversation.channel);
    if (canonicalSurface === null) {
      return;
    }

    const storedMessages = await this.loadCanonicalChatMessages(conversation);
    if (storedMessages === null || storedMessages.length === 0) {
      return;
    }

    // Collect distinct discovered file ref ids, most-recent-first, across
    // the last K assistant messages that have non-empty discoveredFileRefIds.
    const candidateIds: string[] = [];
    let assistantMessagesScanned = 0;
    for (const message of [...storedMessages].reverse()) {
      if (message.author !== "assistant") {
        continue;
      }
      if (assistantMessagesScanned >= RECENT_FILE_DISCOVERY_MESSAGE_WINDOW) {
        break;
      }
      assistantMessagesScanned += 1;
      const meta = message.metadata;
      const rawIds = meta?.discoveredFileRefIds;
      if (!Array.isArray(rawIds)) {
        continue;
      }
      for (const id of rawIds) {
        if (typeof id === "string" && id.trim().length > 0 && !candidateIds.includes(id)) {
          candidateIds.push(id);
        }
      }
    }

    if (candidateIds.length === 0) {
      return;
    }

    // Drop ids that are already present in Working Files — the existing alias
    // wins; we do not add a duplicate `recent file #N` entry.
    const newIds = candidateIds.filter((id) => !refs.has(id));
    if (newIds.length === 0) {
      return;
    }

    // Fetch corresponding AssistantFile rows (single bounded query). Any id
    // whose row no longer exists is silently dropped.
    const records = await this.runtimeAssistantFileRegistryService.listByFileRefs({
      assistantId: conversation.assistantId,
      workspaceId: conversation.workspaceId,
      fileRefs: newIds
    });

    // Upsert surviving records, most-recent-first, capped at
    // MAX_RECENT_DISCOVERED_FILES. Semantic hints come directly from the registry.
    let recentFileOrdinal = 0;
    for (const record of records) {
      if (recentFileOrdinal >= MAX_RECENT_DISCOVERED_FILES) {
        break;
      }
      recentFileOrdinal += 1;
      const baseFileRef = this.runtimeAssistantFileRegistryService.toRuntimeFileRef(record);
      this.upsertWorkingFileRef(refs, baseFileRef, [`recent file #${String(recentFileOrdinal)}`]);
    }
  }

  private composeWithCarryOverDurableMemoryAndConversation(
    carryOver: CrossSessionCarryOverHydration | null,
    durableMemory: DurableMemoryHydration,
    conversationMessages: ProviderGatewayTextMessage[],
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>
  ): ProviderGatewayTextMessage[] {
    const prefix = this.buildStablePrefix(carryOver, durableMemory);
    if (prefix.length === 0) {
      return conversationMessages;
    }
    return this.limitHydratedMessages([...prefix, ...conversationMessages], contextHydration, {
      preserveLeadingMessageCount: prefix.length
    });
  }

  private buildStablePrefix(
    carryOver: CrossSessionCarryOverHydration | null,
    durableMemory: DurableMemoryHydration
  ): ProviderGatewayTextMessage[] {
    // Order is fixed: durable_memory_core (M1, stable) -> cross_session_carry_over
    // (M3, stable, turn-0-only) -> durable_memory_contextual (per-turn,
    // non-stable). The rolling-session-synopsis block is inserted by the
    // canonical-web hydration path between core and contextual when a prior
    // in-thread compaction exists; that path doesn't apply at turn 0 by
    // construction, so the M3 block doesn't compete with it.
    const prefix: ProviderGatewayTextMessage[] = [];
    if (durableMemory.coreMessage !== null) {
      prefix.push(durableMemory.coreMessage);
    }
    if (carryOver !== null) {
      prefix.push(carryOver.message);
    }
    if (durableMemory.contextualMessage !== null) {
      prefix.push(durableMemory.contextualMessage);
    }
    return prefix;
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
    durableMemory: DurableMemoryHydration,
    carryOver: CrossSessionCarryOverHydration | null,
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
      return this.composeWithCarryOverDurableMemoryAndConversation(
        carryOver,
        durableMemory,
        hydratedMessages,
        contextHydration
      );
    }

    const summaryBoundary = Math.min(
      reusableSummary.summarizedMessageCount,
      hydratableMessages.length
    );
    const expectedCompactedMessageCount =
      reusableSummary.summarizedMessageCount + reusableSummary.preservedRecentMessageCount;
    if (summaryBoundary <= 0 || expectedCompactedMessageCount > hydratableMessages.length) {
      const hydratedMessages = await this.hydrateCanonicalMessageSequence(
        hydratableMessages,
        input,
        contextHydration
      );
      return this.composeWithCarryOverDurableMemoryAndConversation(
        carryOver,
        durableMemory,
        hydratedMessages,
        contextHydration
      );
    }

    const recentMessages = hydratableMessages.slice(summaryBoundary);
    const hydratedRecentMessages = await this.hydrateCanonicalMessageSequence(
      recentMessages,
      input,
      contextHydration
    );
    // Stable prefix order: durable_memory_core (stable) ->
    // cross_session_carry_over (stable, turn-0-only — typically NOT present
    // here because the in-thread compaction implies prior turns; left in
    // place for symmetry / paranoia) -> rolling_session_synopsis (stable)
    // -> durable_memory_contextual (non-stable, per-turn). The contextual
    // block is intentionally placed AFTER the synopsis so the contiguous
    // stable prefix walked by `resolveLeadingHydratedPromptCacheStableBlockTokens`
    // keeps the cache key stable across turns even when the contextual
    // relevance set rotates.
    const prefixMessages: ProviderGatewayTextMessage[] = [];
    if (durableMemory.coreMessage !== null) {
      prefixMessages.push(durableMemory.coreMessage);
    }
    if (carryOver !== null) {
      prefixMessages.push(carryOver.message);
    }
    prefixMessages.push({
      role: "assistant",
      content: this.formatReusableCompactionSummary(reusableSummary.summaryText)
    });
    if (durableMemory.contextualMessage !== null) {
      prefixMessages.push(durableMemory.contextualMessage);
    }
    return this.limitHydratedMessages(
      [...prefixMessages, ...hydratedRecentMessages],
      contextHydration,
      {
        preserveLeadingMessageCount: prefixMessages.length
      }
    );
  }

  private isFirstTurnOfThread(
    storedMessages: CanonicalChatMessageRow[] | null,
    input: RuntimeTurnRequest
  ): boolean {
    if (storedMessages === null) {
      return true;
    }
    const priorMessages = storedMessages.filter(
      (message) => message.id !== input.idempotencyKey && this.isHydratableCanonicalMessage(message)
    );
    return priorMessages.length === 0;
  }

  // ADR-074 Slice M3.2 — combined trigger predicate. Returns whether the
  // current turn should fetch+render the cross-session carry-over block, and
  // — for telemetry / future expansion — which sub-trigger fired.
  //
  // Sub-triggers (founder-trim 2026-04-22, post-compaction is OUT):
  //   * `thread_first_turn` — turn 0 of a brand-new thread; cooldown-exempt.
  //   * `long_idle` — the previous user message in this thread is older
  //     than `crossSessionCarryOverIdleHours` AND the thread has not fired
  //     a carry-over within the last `crossSessionCarryOverCooldownHours`.
  //
  // The decision is a pure function of `storedMessages`, the cooldown row,
  // and the resolved hydration config; no I/O. The hydration call site is
  // still allowed to bail (e.g. internal API not configured, both lists
  // empty after filtering) — in which case nothing fires and the cooldown
  // bookkeeping cell is intentionally NOT bumped.
  private shouldFireCrossSessionCarryOver(args: {
    storedMessages: CanonicalChatMessageRow[] | null;
    input: RuntimeTurnRequest;
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>;
    chatRowMeta: AssistantChatRowMeta | null;
  }): { shouldFire: boolean; subTrigger: "thread_first_turn" | "long_idle" | null } {
    const { storedMessages, input, contextHydration, chatRowMeta } = args;

    if (this.isFirstTurnOfThread(storedMessages, input)) {
      return { shouldFire: true, subTrigger: "thread_first_turn" };
    }

    const idleHours = contextHydration.crossSessionCarryOverIdleHours;
    const cooldownHours = contextHydration.crossSessionCarryOverCooldownHours;
    if (
      !Number.isFinite(idleHours) ||
      idleHours <= 0 ||
      !Number.isFinite(cooldownHours) ||
      cooldownHours <= 0 ||
      chatRowMeta === null ||
      chatRowMeta.lastMessageAt === null
    ) {
      return { shouldFire: false, subTrigger: null };
    }

    const now = Date.now();
    const idleMs = idleHours * 60 * 60 * 1000;
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    const previousUserMessageAt =
      this.resolvePreviousUserMessageAt(storedMessages, input) ?? chatRowMeta.lastMessageAt;
    const idleElapsedMs = now - previousUserMessageAt.getTime();
    if (idleElapsedMs < idleMs) {
      return { shouldFire: false, subTrigger: null };
    }
    const lastFired = chatRowMeta.lastCrossSessionCarryOverAt;
    if (lastFired !== null && now - lastFired.getTime() < cooldownMs) {
      return { shouldFire: false, subTrigger: null };
    }
    return { shouldFire: true, subTrigger: "long_idle" };
  }

  private resolvePreviousUserMessageAt(
    storedMessages: CanonicalChatMessageRow[] | null,
    input: RuntimeTurnRequest
  ): Date | null {
    if (storedMessages === null) {
      return null;
    }
    for (let index = storedMessages.length - 1; index >= 0; index--) {
      const message = storedMessages[index];
      if (
        message === undefined ||
        message.id === input.idempotencyKey ||
        message.author !== "user" ||
        !this.isHydratableCanonicalMessage(message)
      ) {
        continue;
      }
      if (message.createdAt instanceof Date) {
        return message.createdAt;
      }
    }
    return null;
  }

  // ADR-074 Slice M3.2 — fire-and-forget bookkeeping bump. Failures are
  // intentionally swallowed (logged as WARN) so that a transient internal
  // API hiccup cannot fail the user-visible turn over a missed cooldown
  // write. Idempotency lives on the API side (the SQL writer only advances
  // the cell when `firedAt` is strictly newer than the stored value), so
  // duplicate calls under retry are safe.
  private markCrossSessionCarryOverFiredFireAndForget(input: {
    assistantChatId: string;
    firedAt: Date;
    requestId: string | null;
  }): void {
    void this.persaiInternalApiClient
      .markCrossSessionCarryOverFired({
        assistantChatId: input.assistantChatId,
        firedAt: input.firedAt.toISOString(),
        requestId: input.requestId
      })
      .catch((error) => {
        this.logger.warn(
          `Cross-session carry-over cooldown bookkeeping failed; continuing. assistantChatId=${input.assistantChatId} error=${this.describeError(error)}`
        );
      });
  }

  // ADR-074 Slice T1 — compute the per-turn "presence" developer-tail block.
  //
  // Returns the rendered text to be inserted between `routingGuidance` and
  // `heartbeat` in `developerInstructions`, or `null` when the bundle has no
  // presence template (e.g. legacy bundle compiled before T1) or the channel
  // does not have a canonical chat row (no in-thread baseline available).
  //
  // Hard constraint #6: reuse the M3.2 cross-thread `lastUserMessageAt` data
  // path. We do NOT add a new repository method; we compose two direct Prisma
  // reads against `AssistantChatMessage` (in-thread + cross-thread for this
  // assistant) using the runtime's existing `RuntimeStatePrismaService`.
  async computePresenceBlock(
    input: RuntimeTurnRequest,
    bundle: AssistantRuntimeBundle
  ): Promise<string | null> {
    const template = bundle.promptDocuments.presence;
    if (typeof template !== "string" || template.trim().length === 0) {
      return null;
    }
    const canonicalSurface = toHydratedCanonicalSurface(input.conversation.channel);
    if (canonicalSurface === null) {
      // Non-canonical channels (e.g. preview) don't carry a thread-aware
      // baseline; presence requires the four fields to render together, so
      // we skip the block rather than half-render it.
      return null;
    }
    let lastUserMessageInThreadAt: Date | null = null;
    let lastUserMessageAnywhereAt: Date | null = null;
    // ADR-074 F1: `AssistantChatMessage.id` is a Postgres `uuid` column, but
    // `RuntimeTurnRequest.idempotencyKey` is a free-form string — for example
    // scheduled actions pass `"scheduled-action:<externalRef>:<runAtMs>"`. The
    // previous `id: { not: input.idempotencyKey }` clause crashed with
    // `Inconsistent column data: Error creating UUID, … found 's' at 1` on
    // EVERY non-UUID idempotency key (i.e. essentially every turn driven by a
    // scheduled action), the catch swallowed it, and the presence block silently
    // rendered with null timestamps — fully defeating T1 sense-of-time. Only
    // apply the exclusion when the key is actually shaped like a UUID; the
    // column-by-column comparison stays safe for the legitimate web-chat case
    // where the user message ID is a UUID created upstream.
    const excludeInboundMessageId = isUuidLikeIdempotencyKey(input.idempotencyKey)
      ? input.idempotencyKey
      : null;
    try {
      const chat = await this.prisma.assistantChat.findFirst({
        where: {
          assistantId: input.conversation.assistantId,
          surface: canonicalSurface,
          surfaceThreadKey: input.conversation.externalThreadKey
        },
        select: { id: true }
      });
      if (chat !== null) {
        const inThread = await this.prisma.assistantChatMessage.findFirst({
          where: {
            chatId: chat.id,
            assistantId: input.conversation.assistantId,
            author: "user",
            ...(excludeInboundMessageId === null ? {} : { id: { not: excludeInboundMessageId } })
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { createdAt: true }
        });
        lastUserMessageInThreadAt = inThread?.createdAt ?? null;
      }
      const anywhere = await this.prisma.assistantChatMessage.findFirst({
        where: {
          assistantId: input.conversation.assistantId,
          author: "user",
          ...(excludeInboundMessageId === null ? {} : { id: { not: excludeInboundMessageId } })
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true }
      });
      lastUserMessageAnywhereAt = anywhere?.createdAt ?? null;
    } catch (error) {
      // Presence is a soft awareness signal; if the lookup fails for a
      // transient reason we still render the time/weekday fields rather
      // than dropping the entire block, mirroring the cross-session
      // carry-over fail-soft pattern.
      this.logger.warn(
        `Presence baseline lookup failed; rendering with null timestamps. error=${this.describeError(error)}`
      );
    }
    return renderPresenceBlock({
      template,
      now: new Date(),
      timezone: bundle.userContext.timezone,
      locale: bundle.userContext.locale,
      lastUserMessageInThreadAt,
      lastUserMessageAnywhereAt
    });
  }

  async computeOpenLoopRefsDeveloperBlock(input: RuntimeTurnRequest): Promise<string | null> {
    if (!this.persaiInternalApiClient.isConfigured()) {
      return null;
    }
    try {
      const outcome = await this.persaiInternalApiClient.listActiveOpenLoopRefs({
        assistantId: input.conversation.assistantId,
        requestId: input.requestId
      });
      return renderOpenLoopRefsDeveloperBlock(
        selectRelevantOpenLoopRefsForDeveloperBlock({
          openLoops: outcome.unresolvedOpenLoops,
          currentUserMessage: input.message.text
        }),
        outcome.totalUnresolvedOpenLoops
      );
    } catch (error) {
      this.logger.warn(
        `Open-loop refs lookup failed; continuing without resolver block. error=${this.describeError(error)}`
      );
      return null;
    }
  }

  pruneClosedOpenLoopRefsDeveloperBlock(
    block: string | null,
    closedRefs: readonly string[]
  ): string | null {
    return pruneClosedOpenLoopRefsDeveloperBlock(block, closedRefs);
  }

  // ADR-074 Slice M3.2 — fetch the per-thread cooldown bookkeeping row.
  // Returns `null` for surfaces that don't have a canonical chat row (in
  // which case the long-idle path is unavailable and only the
  // `thread_first_turn` sub-trigger can fire) or when the chat row has not
  // yet been materialised.
  private async loadAssistantChatRowMeta(
    conversation: RuntimeConversationAddress
  ): Promise<AssistantChatRowMeta | null> {
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
        id: true,
        lastMessageAt: true,
        lastCrossSessionCarryOverAt: true
      }
    });
    if (chat === null) {
      return null;
    }
    return {
      id: chat.id,
      lastMessageAt: chat.lastMessageAt,
      lastCrossSessionCarryOverAt: chat.lastCrossSessionCarryOverAt
    };
  }

  private async loadCrossSessionCarryOverHydration(
    input: RuntimeTurnRequest,
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>
  ): Promise<CrossSessionCarryOverHydration | null> {
    if (!this.persaiInternalApiClient.isConfigured()) {
      this.logger.warn(
        "PersAI internal API is not configured; cross-session carry-over is disabled for this turn."
      );
      return null;
    }
    const ttlDays = contextHydration.crossSessionCarryOverTtlDays;
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
      return null;
    }
    let outcome;
    try {
      outcome = await this.persaiInternalApiClient.findCrossSessionCarryOver({
        assistantId: input.conversation.assistantId,
        ttlDays,
        excludeRuntimeSessionId: null,
        requestId: input.requestId
      });
    } catch (error) {
      this.logger.warn(
        `Cross-session carry-over fetch failed; continuing without M3 block. error=${this.describeError(error)}`
      );
      return null;
    }
    const rendered = renderCrossSessionCarryOverBlock({
      recentSynopses: outcome.recentSynopses,
      unresolvedOpenLoops: outcome.unresolvedOpenLoops,
      now: new Date()
    });
    if (rendered === null) {
      return null;
    }
    return {
      message: {
        role: "assistant",
        content: formatCrossSessionCarryOverStableBlock(rendered.bodyText)
      }
    };
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
        content:
          isCurrentInboundMessage || message.author !== "user"
            ? content
            : this.withTelegramGroupSenderContext(content, message, input)
      });
    }

    if (!currentMessageFound) {
      hydrated.push(await this.createCurrentUserMessage(input));
    }

    return this.limitHydratedMessages(hydrated, contextHydration);
  }

  private withTelegramGroupSenderContext(
    content: ProviderGatewayTextMessage["content"],
    message: CanonicalChatMessageRow,
    input: RuntimeTurnRequest
  ): ProviderGatewayTextMessage["content"] {
    if (typeof content !== "string") {
      return content;
    }
    if (input.conversation.channel !== "telegram" || input.conversation.mode !== "group") {
      return content;
    }
    const sender = this.resolveTelegramMessageSenderLabel(message.metadata);
    if (sender === null) {
      return content;
    }
    return [`Telegram sender: ${sender}`, content].join("\n");
  }

  private resolveTelegramMessageSenderLabel(
    metadata: Record<string, unknown> | null | undefined
  ): string | null {
    const telegram =
      metadata !== null &&
      metadata !== undefined &&
      typeof metadata.telegram === "object" &&
      metadata.telegram !== null &&
      !Array.isArray(metadata.telegram)
        ? (metadata.telegram as Record<string, unknown>)
        : null;
    if (telegram === null) {
      return null;
    }
    const displayName = normalizeOptionalString(telegram.fromDisplayName);
    const username = normalizeOptionalString(telegram.fromUsername);
    const userId = normalizeOptionalString(telegram.fromUserId);
    if (displayName !== null && username !== null) {
      return `${displayName} (@${username})`;
    }
    if (displayName !== null) {
      return displayName;
    }
    if (username !== null) {
      return `@${username}`;
    }
    if (userId !== null) {
      return `Telegram user ${userId}`;
    }
    return null;
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
        createdAt: true,
        metadata: true,
        attachments: {
          where: {
            processingStatus: "ready"
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            assistantFileId: true,
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
      createdAt: message.createdAt instanceof Date ? message.createdAt : null,
      metadata: this.asObject(message.metadata),
      attachments: message.attachments
        .filter((attachment) => {
          const metadata = this.asObject(attachment.metadata);
          return metadata?.fileDeleted !== true;
        })
        .map((attachment) => ({
          id: attachment.id,
          assistantFileId: attachment.assistantFileId,
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
      summarizedMessageCount: parsed.summarizedMessageCount,
      preservedRecentMessageCount: parsed.payload.preservedRecentMessageCount
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

  private async loadDurableMemoryHydration(
    assistantId: string,
    _userQuery: string,
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>
  ): Promise<DurableMemoryHydration> {
    if (contextHydration.knowledgeHydrationBudget <= 0) {
      return { coreMessage: null, contextualMessage: null };
    }
    if (!this.persaiInternalApiClient.isConfigured()) {
      this.logger.warn(
        "PersAI internal API is not configured; durable memory hydration is disabled for this turn."
      );
      return { coreMessage: null, contextualMessage: null };
    }

    const maxHydratedMemoryItems = this.resolveHydratedMemoryItemLimit(
      contextHydration.knowledgeHydrationBudget
    );
    const maxHydratedMemoryTotalChars = this.resolveHydratedMemoryCharBudget(
      contextHydration.knowledgeHydrationBudget
    );
    // Reserve roughly half of the per-turn memory item budget for recent
    // short-memory entries; the remainder is implicitly available for the
    // always-on core block that is hashed into the stable cache prefix.
    const contextualLimit = Math.max(0, Math.floor(maxHydratedMemoryItems / 2));

    let outcome;
    try {
      outcome = await this.persaiInternalApiClient.hydrateMemoryForTurn({
        assistantId,
        contextualLimit
      });
    } catch (error) {
      this.logger.warn(
        `Memory hydration request failed; continuing without durable memory. error=${this.describeError(error)}`
      );
      return { coreMessage: null, contextualMessage: null };
    }

    const coreItems = this.dedupeHydratedItems(outcome.core);
    const contextualItems = this.dedupeHydratedItems(outcome.contextual).filter(
      (item) => !coreItems.some((coreItem) => coreItem.id === item.id)
    );

    const coreMessage = this.buildCoreMemoryMessage(coreItems, {
      itemBudget: maxHydratedMemoryItems,
      charBudget: maxHydratedMemoryTotalChars
    });
    const remainingCharBudget = Math.max(
      0,
      maxHydratedMemoryTotalChars - this.estimateBlockCharCost(coreMessage)
    );
    const contextualMessage = this.buildContextualMemoryMessage(contextualItems, {
      itemBudget: Math.max(0, maxHydratedMemoryItems - (coreMessage === null ? 0 : 1)),
      charBudget: remainingCharBudget
    });

    return { coreMessage, contextualMessage };
  }

  private dedupeHydratedItems(
    items: InternalHydratedDurableMemoryItem[]
  ): InternalHydratedDurableMemoryItem[] {
    const seen = new Set<string>();
    const result: InternalHydratedDurableMemoryItem[] = [];
    for (const item of items) {
      const normalized = item.summary.trim().toLowerCase();
      if (normalized.length === 0) {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(item);
    }
    return result;
  }

  private buildCoreMemoryMessage(
    items: InternalHydratedDurableMemoryItem[],
    budget: { itemBudget: number; charBudget: number }
  ): ProviderGatewayTextMessage | null {
    const lines = this.takeMemoryLines(items, budget);
    if (lines.length === 0) {
      return null;
    }
    return {
      role: "assistant",
      content: formatDurableMemoryCoreStableBlock(lines)
    };
  }

  private buildContextualMemoryMessage(
    items: InternalHydratedDurableMemoryItem[],
    budget: { itemBudget: number; charBudget: number }
  ): ProviderGatewayTextMessage | null {
    if (budget.itemBudget <= 0 || budget.charBudget <= 0) {
      return null;
    }
    const lines = this.takeMemoryLines(items, budget);
    if (lines.length === 0) {
      return null;
    }
    return {
      role: "assistant",
      content: formatDurableMemoryContextualBlock(lines),
      // ADR-110: per-turn recent short memory is volatile and must never sit inside the
      // cached prompt prefix. The typed flag lets each provider client reposition it next to the
      // latest user message without relying on fragile string matching of the block header.
      cacheRole: "volatile_context"
    };
  }

  private takeMemoryLines(
    items: InternalHydratedDurableMemoryItem[],
    budget: { itemBudget: number; charBudget: number }
  ): string[] {
    const lines: string[] = [];
    let totalChars = 0;
    for (const item of items) {
      const label = this.resolveMemoryLabel(item);
      const line = `- [${label}] ${item.summary.trim()}`;
      if (line.length === 0) {
        continue;
      }
      if (lines.length >= budget.itemBudget || totalChars + line.length > budget.charBudget) {
        break;
      }
      lines.push(line);
      totalChars += line.length;
    }
    return lines;
  }

  private resolveMemoryLabel(item: InternalHydratedDurableMemoryItem): string {
    if (item.sourceLabel && item.sourceLabel.trim().length > 0) {
      return item.sourceLabel.trim();
    }
    if (item.sourceType === "memory_write") {
      return item.kind === null ? "Durable memory" : `Durable memory: ${item.kind}`;
    }
    return "Conversation memory";
  }

  private estimateBlockCharCost(message: ProviderGatewayTextMessage | null): number {
    if (message === null || typeof message.content !== "string") {
      return 0;
    }
    return message.content.length;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    if (typeof error === "string") {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "unknown_error";
    }
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
    if (input.baseContent.trim().length > 0) {
      return input.baseContent;
    }
    const hasAttachments = input.attachments.length > 0 || input.fallbackAttachments.length > 0;
    if (input.author === "user" && hasAttachments) {
      return "User sent attachments only.";
    }
    return "";
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

  private toImageToolAttachmentRef(
    input: {
      attachmentId: string;
      objectKey: string;
      mimeType: string;
      filename: string | null;
      sizeBytes: number;
    },
    aliases: string[] | null = null
  ): RuntimeAttachmentRef {
    return {
      attachmentId: input.attachmentId,
      kind: "image",
      objectKey: input.objectKey,
      mimeType: input.mimeType,
      filename: input.filename,
      sizeBytes: input.sizeBytes,
      ...(aliases === null ? {} : { aliases })
    };
  }

  private dedupeRuntimeAttachments(attachments: RuntimeAttachmentRef[]): RuntimeAttachmentRef[] {
    const deduped = new Map<string, RuntimeAttachmentRef>();
    for (const attachment of attachments) {
      const dedupeKey = `${attachment.attachmentId}:${attachment.objectKey}`;
      const existing = deduped.get(dedupeKey);
      if (existing !== undefined) {
        deduped.set(dedupeKey, {
          ...existing,
          aliases: this.mergeAliases(existing.aliases, ...(attachment.aliases ?? []))
        });
        continue;
      }
      deduped.set(dedupeKey, attachment);
    }
    return [...deduped.values()];
  }

  private async resolveRuntimeFileRefForAttachment(
    assistantId: string,
    workspaceId: string,
    attachment: RuntimeAttachmentRef
  ): Promise<RuntimeFileRef | null> {
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
    const record = await this.runtimeAssistantFileRegistryService.findByFileRef({
      assistantId,
      workspaceId,
      fileRef
    });
    if (record === null) {
      return null;
    }
    return this.runtimeAssistantFileRegistryService.toRuntimeFileRef(record);
  }

  private async resolveAttachmentFileRecord(
    assistantId: string,
    workspaceId: string,
    attachment: {
      attachmentId: string;
      fileRef: string | null;
      objectKey: string;
      filename: string | null;
      mimeType: string;
      sizeBytes: number;
    },
    fallbackOrigin: "uploaded_attachment" | "runtime_output"
  ): Promise<RuntimeAssistantFileRecord | null> {
    const fileRef =
      attachment.fileRef ??
      (await this.ensureAttachmentFileRef({
        assistantId,
        workspaceId,
        origin: fallbackOrigin,
        referenceId: attachment.attachmentId,
        objectKey: attachment.objectKey,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes
      }));
    return this.runtimeAssistantFileRegistryService.findByFileRef({
      assistantId,
      workspaceId,
      fileRef
    });
  }

  private isAssistantGeneratedFile(file: Pick<RuntimeFileRef, "origin">): boolean {
    return file.origin !== "uploaded_attachment";
  }

  private isDocumentSourceAttachmentMime(mimeType: string): boolean {
    const normalized = mimeType.trim().toLowerCase();
    return (
      normalized.startsWith("text/") ||
      normalized === "application/pdf" ||
      normalized === "application/x-pdf" ||
      normalized === "application/json" ||
      normalized === "application/x-ndjson" ||
      normalized === "application/xml" ||
      normalized === "application/x-yaml" ||
      normalized === "application/yaml" ||
      normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  }

  private upsertWorkingFileRef(
    target: Map<string, RuntimeFileRef>,
    fileRef: RuntimeFileRef,
    aliases: string[]
  ): void {
    const existing = target.get(fileRef.fileRef);
    if (existing === undefined) {
      target.set(fileRef.fileRef, {
        ...fileRef,
        aliases: this.mergeAliases(fileRef.aliases, ...aliases)
      });
      return;
    }
    target.set(fileRef.fileRef, {
      ...existing,
      aliases: this.mergeAliases(existing.aliases, fileRef.aliases ?? [], ...aliases)
    });
  }

  private mergeAliases(
    existing: string[] | null | undefined,
    ...next: Array<string | string[] | null | undefined>
  ): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const alias of [...(existing ?? []), ...next.flatMap((value) => value ?? [])]) {
      const normalized = alias.trim().toLowerCase();
      if (normalized.length === 0 || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(alias);
    }
    return merged;
  }
}
