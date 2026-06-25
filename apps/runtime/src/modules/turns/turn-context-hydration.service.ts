import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayImageContentBlock,
  ProviderGatewayMessageContent,
  ProviderGatewayMessageContentBlock,
  ProviderGatewayPdfContentBlock,
  ProviderGatewayTextMessage,
  RuntimeAttachmentRef,
  RuntimeFileHandle,
  RuntimeOutputArtifact,
  RuntimeConversationAddress,
  RuntimeTodoItem,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import { RUNTIME_CHAT_PLAN_WINDOW_MAX } from "@persai/runtime-contract";
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
  formatDurableMemoryCoreStableBlock,
  formatSharedCompactionStableBlock
} from "./prompt-cache-stable-blocks";
import { renderCrossSessionCarryOverBlock } from "./cross-session-carry-over-renderer";
import { renderPresenceBlock } from "./presence-renderer";
import { parseStoredReusableCompactionState } from "./shared-compaction-state";
import {
  formatCurrentMessageAttachmentLabel,
  shouldLabelCurrentMessageAttachments
} from "./current-message-attachment-labels";
import { readFilesToolEffectivePreviewLimits } from "./runtime-file-capabilities";

const MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024;
const MIN_HYDRATED_MEMORY_ITEMS = 3;
const MAX_HYDRATED_MEMORY_ITEMS = 10;
const MIN_HYDRATED_MEMORY_TOTAL_CHARS = 400;
const MAX_HYDRATED_MEMORY_TOTAL_CHARS = 1800;
/** ADR-100 Piece 2 — how many most-recent assistant messages to scan for discovered paths. */
const RECENT_FILE_DISCOVERY_MESSAGE_WINDOW = 5;
/** ADR-100 Piece 2 — max distinct discovered paths surfaced from message metadata. */
const RECENT_DISCOVERED_FILE_PATH_CAP = 6;
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

/**
 * ADR-125 Slice 1 — render the windowed chat plan as the body of the
 * `<persai_chat_plan>` volatile block. Returns null when there are no items
 * to render (caller already filters on `todos.length === 0`, but this guard
 * keeps the helper safe for direct use in tests). Hierarchy is preserved by
 * indenting child rows under their parent; items whose parent is not in the
 * window are rendered at the same indent as top-level (the window selector
 * guarantees parents are co-located when possible, but we degrade gracefully
 * if a parent was dropped).
 *
 * Output shape (one line per item):
 *   <optional scenario lifecycle hint>
 *   - [<status>] <content> — by id <id>
 *     - [<status>] <child content> — by id <id>
 *   + N more
 *
 * The `+ N more` tail appears only when the window truncated the plan.
 */
export function renderChatPlanBlock(
  todos: readonly RuntimeTodoItem[],
  truncatedCount: number
): string | null {
  if (todos.length === 0) return null;
  if (todos.length > RUNTIME_CHAT_PLAN_WINDOW_MAX) {
    throw new Error(
      `renderChatPlanBlock received ${String(todos.length)} todos, above the window cap ${String(RUNTIME_CHAT_PLAN_WINDOW_MAX)}.`
    );
  }
  const idsInWindow = new Set(todos.map((todo) => todo.id));
  const lines: string[] = [];
  for (const todo of todos) {
    const indent = todo.parentId !== null && idsInWindow.has(todo.parentId) ? "  " : "";
    const statusLabel = renderChatPlanStatusLabel(todo.status);
    const safeContent = todo.content.trim().replace(/\s+/g, " ");
    lines.push(`${indent}- [${statusLabel}] ${safeContent} — by id ${todo.id}`);
  }
  if (truncatedCount > 0) {
    lines.push(`+ ${String(truncatedCount)} more`);
  }
  return lines.join("\n");
}

function renderChatPlanStatusLabel(status: RuntimeTodoItem["status"]): string {
  switch (status) {
    case "pending":
      return " ";
    case "in_progress":
      return "~";
    case "completed":
      return "x";
  }
}

type CanonicalChatMessageRow = {
  id: string;
  author: "user" | "assistant" | "system";
  content: string;
  createdAt: Date | null;
  attachments: CanonicalChatAttachmentRow[];
  /** ADR-100 Piece 2 — optional JSONB metadata from the message row; may contain discoveredFilePaths. */
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
  blocks: ProviderGatewayMessageContentBlock[];
};

type PreparedDirectProviderAttachmentPayload = {
  buffer: Buffer;
  mimeType: string;
};

type ReusableCompactionSummary = {
  summaryText: string;
  summarizedMessageCount: number;
  preservedRecentMessageCount: number;
};

// ADR-120 Slice 1 — durable memory hydration now produces ONLY the stable core
// block (`durable_memory_core`, primacy zone). The always-on pushed contextual
// short-memory block was retired; cross-chat recall is pull-only via the
// `knowledge_search` `memory` source.
type DurableMemoryHydration = {
  coreMessage: ProviderGatewayTextMessage | null;
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
    private readonly persaiInternalApiClient: PersaiInternalApiClientService
  ) {}

  async buildMessages(
    input: RuntimeTurnRequest,
    bundle: AssistantRuntimeBundle
  ): Promise<ProviderGatewayTextMessage[]> {
    const contextHydration = resolveRuntimeContextHydrationConfig(bundle);
    const directInputPreviewLimits = readFilesToolEffectivePreviewLimits(
      bundle.governance?.toolPolicies?.find((policy) => policy.toolCode === "files") ?? null
    );
    const canonicalSurface = toHydratedCanonicalSurface(input.conversation.channel);
    if (canonicalSurface === null) {
      return [await this.createCurrentUserMessage(input, directInputPreviewLimits)];
    }

    const storedMessages = await this.loadCanonicalChatMessages(input.conversation);
    const chatRowMeta = await this.loadAssistantChatRowMeta(input.conversation);
    const durableMemory = await this.loadDurableMemoryHydration(
      input.conversation.assistantId,
      input.message.text,
      contextHydration,
      chatRowMeta?.id ?? null
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
      const currentUserMessage = await this.createCurrentUserMessage(
        input,
        directInputPreviewLimits
      );
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
      contextHydration,
      directInputPreviewLimits
    );
    if (hydrated.length > 0) {
      return hydrated;
    }
    const currentUserMessage = await this.createCurrentUserMessage(input, directInputPreviewLimits);
    return this.composeWithCarryOverDurableMemoryAndConversation(
      carryOver,
      durableMemory,
      [currentUserMessage],
      contextHydration
    );
  }

  async listAvailableWorkingFileHandles(input: {
    conversation: RuntimeConversationAddress;
    currentAttachments: RuntimeAttachmentRef[];
    currentFileHandles?: RuntimeFileHandle[];
    currentArtifacts?: RuntimeOutputArtifact[];
  }): Promise<RuntimeFileHandle[]> {
    const refs = new Map<string, RuntimeFileHandle>();
    const appearanceOrder: string[] = [];
    const pushAppearance = (storagePath: string): void => {
      if (!appearanceOrder.includes(storagePath)) {
        appearanceOrder.push(storagePath);
      }
    };

    const existingStickyAliases = this.collectExistingStickyAliases(input.currentFileHandles ?? []);
    const upsertWorkingFileHandle = (file: RuntimeFileHandle): void => {
      const existing = refs.get(file.storagePath);
      if (existing === undefined) {
        refs.set(file.storagePath, {
          ...file,
          aliases: file.aliases ?? []
        });
        return;
      }
      refs.set(file.storagePath, {
        ...existing,
        ...file,
        aliases: existing.aliases ?? []
      });
    };

    const storedMessages = await this.loadCanonicalChatMessages(input.conversation);
    if (storedMessages !== null) {
      for (const message of storedMessages) {
        for (const attachment of message.attachments) {
          if (this.shouldSuppressHistoricalWorkingFileAttachment(attachment)) {
            continue;
          }
          const handle = this.canonicalAttachmentToRuntimeFileHandle(
            attachment,
            input.conversation.workspaceId,
            message.author === "assistant" ? "model" : "user"
          );
          if (handle === null) {
            continue;
          }
          upsertWorkingFileHandle(handle);
          pushAppearance(handle.storagePath);
        }
      }
    }

    for (const attachment of input.currentAttachments) {
      const handle = this.runtimeAttachmentToFileHandle(attachment, input.conversation.workspaceId);
      if (handle === null) {
        continue;
      }
      upsertWorkingFileHandle(handle);
      pushAppearance(handle.storagePath);
    }

    for (const artifact of input.currentArtifacts ?? []) {
      if (typeof artifact.storagePath !== "string" || artifact.storagePath.trim().length === 0) {
        continue;
      }
      const handle: RuntimeFileHandle = {
        storagePath: artifact.storagePath.trim(),
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes ?? 0,
        displayName: artifact.filename,
        workspaceId: input.conversation.workspaceId,
        authorLabel: "model",
        sourceToolCode: artifact.sourceToolCode ?? null
      };
      upsertWorkingFileHandle(handle);
      pushAppearance(handle.storagePath);
    }

    for (const fileHandle of input.currentFileHandles ?? []) {
      upsertWorkingFileHandle(fileHandle);
      pushAppearance(fileHandle.storagePath);
    }

    await this.injectRecentDiscoveredFilePaths(input.conversation, refs, pushAppearance);

    return this.assignStickyAliasesToWorkingFileRefs(
      [...refs.values()],
      appearanceOrder,
      existingStickyAliases
    );
  }

  private shouldSuppressHistoricalWorkingFileAttachment(
    attachment: CanonicalChatAttachmentRow
  ): boolean {
    if (attachment.attachmentType === "audio" || attachment.attachmentType === "voice") {
      return true;
    }
    return attachment.mimeType.trim().toLowerCase().startsWith("audio/");
  }

  /**
   * ADR-100 Piece 2 — scans the last RECENT_FILE_DISCOVERY_MESSAGE_WINDOW
   * assistant messages for `metadata.discoveredFilePaths`, joins
   * `workspace_file_metadata.shortDescription` for semantic hints, drops paths
   * with no metadata row silently, dedupes against already-present Working
   * Files entries, and upserts survivors with stable `file #N` / `image #N`
   * aliases.
   */
  private async injectRecentDiscoveredFilePaths(
    conversation: RuntimeConversationAddress,
    refs: Map<string, RuntimeFileHandle>,
    pushAppearance: (storagePath: string) => void
  ): Promise<void> {
    const canonicalSurface = toHydratedCanonicalSurface(conversation.channel);
    if (canonicalSurface === null) {
      return;
    }

    const storedMessages = await this.loadCanonicalChatMessages(conversation);
    if (storedMessages === null || storedMessages.length === 0) {
      return;
    }

    const candidatePaths: string[] = [];
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
      const rawPaths = meta?.discoveredFilePaths;
      if (!Array.isArray(rawPaths)) {
        continue;
      }
      for (const path of rawPaths) {
        if (
          typeof path === "string" &&
          path.trim().length > 0 &&
          !candidatePaths.includes(path.trim())
        ) {
          candidatePaths.push(path.trim());
        }
      }
    }

    if (candidatePaths.length === 0) {
      return;
    }

    const cappedPaths = candidatePaths.slice(0, RECENT_DISCOVERED_FILE_PATH_CAP);
    const newPaths = cappedPaths.filter((path) => !refs.has(path));
    if (newPaths.length === 0) {
      return;
    }

    let descriptions: Array<{ path: string; shortDescription: string | null }> = [];
    try {
      descriptions = await this.persaiInternalApiClient.listWorkspaceFileShortDescriptions({
        workspaceId: conversation.workspaceId,
        paths: newPaths
      });
    } catch (error) {
      this.logger.warn(
        `recent_discovered_file_paths_lookup_failed workspaceId=${conversation.workspaceId} reason=${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    const descriptionByPath = new Map(
      descriptions.map((row) => [row.path, row.shortDescription] as const)
    );

    for (const storagePath of newPaths) {
      if (!descriptionByPath.has(storagePath)) {
        continue;
      }
      const shortDescription = descriptionByPath.get(storagePath) ?? null;
      const displayName = storagePath.split("/").pop() ?? null;
      const handle: RuntimeFileHandle = {
        storagePath,
        mimeType: "application/octet-stream",
        sizeBytes: 0,
        displayName,
        workspaceId: conversation.workspaceId,
        authorLabel: "sandbox",
        semanticSummaryHint: shortDescription
      };
      refs.set(storagePath, {
        ...(refs.get(storagePath) ?? handle),
        ...handle,
        aliases: refs.get(storagePath)?.aliases ?? []
      });
      pushAppearance(storagePath);
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
    // (M3, stable, turn-0-only). Both are cache-stable; the rolling-session-synopsis
    // block is inserted by the canonical-web hydration path between core and the
    // conversation when a prior in-thread compaction exists. ADR-120 Slice 1 retired
    // the per-turn `durable_memory_contextual` block, so the prefix is now entirely stable.
    const prefix: ProviderGatewayTextMessage[] = [];
    if (durableMemory.coreMessage !== null) {
      prefix.push(durableMemory.coreMessage);
    }
    if (carryOver !== null) {
      prefix.push(carryOver.message);
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
      const content = this.withTruncationMarker(
        await this.buildHydratedMessageContent({
          assistantId: input.conversation.assistantId,
          workspaceId: input.conversation.workspaceId,
          author: message.author,
          baseContent: message.content,
          attachments: message.attachments,
          fallbackAttachments: [],
          allowDirectAttachmentInput: false
        }),
        message
      );
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
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>,
    directInputPreviewLimits: ReturnType<typeof readFilesToolEffectivePreviewLimits>
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
        contextHydration,
        directInputPreviewLimits
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
        contextHydration,
        directInputPreviewLimits
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
      contextHydration,
      directInputPreviewLimits
    );
    // Stable prefix order: durable_memory_core (stable) ->
    // cross_session_carry_over (stable, turn-0-only — typically NOT present
    // here because the in-thread compaction implies prior turns; left in
    // place for symmetry / paranoia) -> rolling_session_synopsis (stable).
    // ADR-120 Slice 1 retired the per-turn `durable_memory_contextual` block,
    // so the whole hydrated prefix is now cache-stable.
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
  // Returns the rendered text to be inserted into the per-turn developer tail,
  // or `null` when the bundle has no
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
    // ADR-120 Slice 2 — open-loop refs are scoped to the current chat. Resolve
    // the canonical chat id; surfaces without one (or before the chat row is
    // materialised) have no in-chat loops to surface, so the block is omitted.
    const currentChatId = (await this.loadAssistantChatRowMeta(input.conversation))?.id ?? null;
    if (currentChatId === null) {
      return null;
    }
    try {
      const outcome = await this.persaiInternalApiClient.listActiveOpenLoopRefs({
        assistantId: input.conversation.assistantId,
        chatId: currentChatId,
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

  /**
   * ADR-125 Slice 1 — composes the volatile `<persai_chat_plan>` block from
   * the current windowed chat plan. Returns null when:
   * - the internal API client is unconfigured (no plan to fetch)
   * - the conversation surface is not a canonical chat surface (preview, etc.)
   * - the chat has no todos (empty window — block is omitted, no chatter)
   *
   * The block is emitted as a `ProviderGatewayTextMessage` with
   * `cacheRole: "volatile_context"` and `volatileKind: "chat_plan"` so the
   * provider clients wrap the content with the `<persai_chat_plan>` tag.
   */
  async buildChatPlanBlock(input: RuntimeTurnRequest): Promise<{
    block: ProviderGatewayTextMessage;
    todos: readonly RuntimeTodoItem[];
  } | null> {
    if (!this.persaiInternalApiClient.isConfigured()) {
      return null;
    }
    const canonicalSurface = toHydratedCanonicalSurface(input.conversation.channel);
    if (canonicalSurface === null) {
      return null;
    }
    const externalThreadKey = input.conversation.externalThreadKey;
    if (typeof externalThreadKey !== "string" || externalThreadKey.trim().length === 0) {
      return null;
    }
    try {
      const outcome = await this.persaiInternalApiClient.readChatPlanWindow({
        assistantId: input.conversation.assistantId,
        channel: canonicalSurface,
        surfaceThreadKey: externalThreadKey
      });
      if (outcome.todos.length === 0) {
        return null;
      }
      const truncatedCount = Math.max(outcome.totalCount - outcome.todos.length, 0);
      const content = renderChatPlanBlock(outcome.todos, truncatedCount);
      if (content === null) {
        return null;
      }
      return {
        block: {
          role: "user",
          content,
          cacheRole: "volatile_context",
          volatileKind: "chat_plan"
        },
        todos: outcome.todos
      };
    } catch (error) {
      this.logger.warn(
        `Chat plan window lookup failed; continuing without plan block. error=${this.describeError(error)}`
      );
      return null;
    }
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
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>,
    directInputPreviewLimits: ReturnType<typeof readFilesToolEffectivePreviewLimits>
  ): Promise<ProviderGatewayTextMessage[]> {
    const hydrated: ProviderGatewayTextMessage[] = [];
    let currentMessageFound = false;

    for (const message of messages) {
      const isCurrentInboundMessage = message.id === input.idempotencyKey;
      if (isCurrentInboundMessage) {
        currentMessageFound = true;
      }
      const rawContent = await this.buildHydratedMessageContent({
        assistantId: input.conversation.assistantId,
        workspaceId: input.conversation.workspaceId,
        author: message.author,
        baseContent: isCurrentInboundMessage ? input.message.text : message.content,
        attachments: message.attachments,
        fallbackAttachments: isCurrentInboundMessage ? input.message.attachments : [],
        allowDirectAttachmentInput: isCurrentInboundMessage && message.author === "user",
        directInputPreviewLimits
      });
      // ADR-122 Slice 3: apply truncation marker to prior (non-current) assistant
      // messages flagged as partial or truncated so the model does not continue them.
      const content = !isCurrentInboundMessage
        ? this.withTruncationMarker(rawContent, message)
        : rawContent;

      hydrated.push({
        role: this.toProviderRole(message.author),
        content:
          isCurrentInboundMessage || message.author !== "user"
            ? content
            : this.withTelegramGroupSenderContext(content, message, input)
      });
    }

    if (!currentMessageFound) {
      hydrated.push(await this.createCurrentUserMessage(input, directInputPreviewLimits));
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
          attachmentType: attachment.attachmentType,
          originalFilename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          storagePath: attachment.storagePath ?? "",
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
    contextHydration: ReturnType<typeof resolveRuntimeContextHydrationConfig>,
    currentChatId: string | null
  ): Promise<DurableMemoryHydration> {
    if (contextHydration.knowledgeHydrationBudget <= 0) {
      return { coreMessage: null };
    }
    if (!this.persaiInternalApiClient.isConfigured()) {
      this.logger.warn(
        "PersAI internal API is not configured; durable memory hydration is disabled for this turn."
      );
      return { coreMessage: null };
    }

    const maxHydratedMemoryItems = this.resolveHydratedMemoryItemLimit(
      contextHydration.knowledgeHydrationBudget
    );
    const maxHydratedMemoryTotalChars = this.resolveHydratedMemoryCharBudget(
      contextHydration.knowledgeHydrationBudget
    );

    let outcome;
    try {
      outcome = await this.persaiInternalApiClient.hydrateMemoryForTurn({
        assistantId
      });
    } catch (error) {
      this.logger.warn(
        `Memory hydration request failed; continuing without durable memory. error=${this.describeError(error)}`
      );
      return { coreMessage: null };
    }

    const coreItems = this.dedupeHydratedItems(outcome.core);

    const coreMessage = this.buildCoreMemoryMessage(coreItems, {
      itemBudget: maxHydratedMemoryItems,
      charBudget: maxHydratedMemoryTotalChars,
      currentChatId
    });

    return { coreMessage };
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
    budget: { itemBudget: number; charBudget: number; currentChatId: string | null }
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

  private takeMemoryLines(
    items: InternalHydratedDurableMemoryItem[],
    budget: { itemBudget: number; charBudget: number; currentChatId: string | null }
  ): string[] {
    const lines: string[] = [];
    let totalChars = 0;
    let sawPastChat = false;
    for (const item of items) {
      const sourceMarker = this.resolveMemorySourceMarker(item, budget.currentChatId);
      const label = this.resolveMemoryLabel(item, sourceMarker);
      const line = `- [${label}] ${item.summary.trim()}`;
      if (line.length === 0) {
        continue;
      }
      if (lines.length >= budget.itemBudget || totalChars + line.length > budget.charBudget) {
        break;
      }
      lines.push(line);
      totalChars += line.length;
      if (sourceMarker === "past chat") {
        sawPastChat = true;
      }
    }
    const sourceNote =
      'Items marked "past chat" came from another conversation. If details are needed, use chat/context search instead of assuming they happened here.';
    if (sawPastChat && totalChars + sourceNote.length <= budget.charBudget) {
      lines.push(sourceNote);
    }
    return lines;
  }

  private resolveMemorySourceMarker(
    item: InternalHydratedDurableMemoryItem,
    currentChatId: string | null
  ): "this chat" | "past chat" | null {
    if (currentChatId === null || item.chatId === null) {
      return null;
    }
    return item.chatId === currentChatId ? "this chat" : "past chat";
  }

  private resolveMemoryLabel(
    item: InternalHydratedDurableMemoryItem,
    sourceMarker: "this chat" | "past chat" | null
  ): string {
    const baseLabel = this.resolveMemoryBaseLabel(item);
    return sourceMarker === null ? baseLabel : `${sourceMarker} · ${baseLabel}`;
  }

  private resolveMemoryBaseLabel(item: InternalHydratedDurableMemoryItem): string {
    if (item.sourceLabel && item.sourceLabel.trim().length > 0) {
      return item.sourceLabel.trim();
    }
    if (item.sourceType === "memory_write") {
      return item.kind === null ? "Durable memory" : `Durable memory: ${item.kind}`;
    }
    return "Conversation memory";
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

  /**
   * ADR-122 Slice 3 — truncation guard: appends a short language-neutral marker
   * to the hydrated content of a prior assistant message whose metadata.status
   * is "partial" (client abort / stall) or "truncated" (max_tokens ceiling),
   * so the model treats it as unfinished and does NOT continue it.
   *
   * Only acts on `author === "assistant"` messages. Only acts on string content
   * (assistant messages produced by the runtime are always plain text with no
   * direct-input blocks). Idempotent: the marker is never stored in the DB
   * (it is appended only during hydration); since content is rebuilt from the
   * stored message each turn, the marker cannot be doubled.
   */
  private withTruncationMarker(
    content: ProviderGatewayMessageContent,
    message: CanonicalChatMessageRow
  ): ProviderGatewayMessageContent {
    if (message.author !== "assistant") {
      return content;
    }
    const status = message.metadata?.status;
    if (status !== "partial" && status !== "truncated") {
      return content;
    }
    if (typeof content !== "string") {
      return content;
    }
    const MARKER = "\n\n[Note: the previous answer was interrupted before completion.]";
    if (content.includes(MARKER)) {
      return content;
    }
    return content + MARKER;
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
    input: RuntimeTurnRequest,
    directInputPreviewLimits: ReturnType<typeof readFilesToolEffectivePreviewLimits>
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
        allowDirectAttachmentInput: true,
        directInputPreviewLimits
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
    directInputPreviewLimits?: ReturnType<typeof readFilesToolEffectivePreviewLimits>;
  }): Promise<ProviderGatewayMessageContent> {
    const previewLimits =
      input.directInputPreviewLimits ?? readFilesToolEffectivePreviewLimits(null);
    const directInputSelection = input.allowDirectAttachmentInput
      ? await this.buildDirectInputSelection(
          input.workspaceId,
          input.attachments,
          input.fallbackAttachments,
          previewLimits
        )
      : this.createEmptyDirectInputSelection();
    const textContent = await this.buildHydratedMessageTextContent(input);

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
    workspaceId: string,
    attachments: CanonicalChatAttachmentRow[],
    fallbackAttachments: RuntimeAttachmentRef[],
    previewLimits: ReturnType<typeof readFilesToolEffectivePreviewLimits>
  ): Promise<DirectInputSelection> {
    const maxAttachmentBytes = previewLimits.effectiveMaxPreviewBytes;
    const maxImageEdgePx = previewLimits.effectiveMaxPreviewEdgePx;
    const selection = this.createEmptyDirectInputSelection();
    const candidates =
      attachments.length > 0
        ? attachments
            .map((attachment) => this.toCanonicalDirectInputCandidate(attachment))
            .filter((candidate): candidate is DirectInputAttachmentCandidate => candidate !== null)
        : fallbackAttachments
            .map((attachment) => this.toRuntimeDirectInputCandidate(attachment))
            .filter((candidate): candidate is DirectInputAttachmentCandidate => candidate !== null);

    const visualCandidates = candidates.filter(
      (candidate) => candidate.kind === "image" || candidate.kind === "pdf"
    );
    const labelDirectAttachments = shouldLabelCurrentMessageAttachments(visualCandidates.length);
    let visualCandidateOrdinal = 0;
    let totalBytes = 0;
    for (const candidate of candidates) {
      const isVisualCandidate = candidate.kind === "image" || candidate.kind === "pdf";
      if (isVisualCandidate) {
        visualCandidateOrdinal += 1;
      }
      if (
        candidate.sizeBytes <= 0 ||
        (candidate.kind !== "image" &&
          (candidate.sizeBytes > maxAttachmentBytes ||
            totalBytes + candidate.sizeBytes > MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES))
      ) {
        continue;
      }

      const buffer = await this.downloadDirectInputAttachmentBytes(
        workspaceId,
        candidate.objectKey
      );
      if (buffer === null || buffer.length === 0) {
        continue;
      }
      if (
        buffer.length > maxAttachmentBytes ||
        totalBytes + buffer.length > MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES
      ) {
        continue;
      }
      const prepared = await this.prepareDirectProviderAttachmentPayload(
        candidate,
        buffer,
        maxImageEdgePx
      );
      if (prepared === null) {
        continue;
      }
      if (
        prepared.buffer.length > maxAttachmentBytes ||
        totalBytes + prepared.buffer.length > MAX_DIRECT_PROVIDER_ATTACHMENT_TOTAL_BYTES
      ) {
        continue;
      }

      if (labelDirectAttachments && isVisualCandidate) {
        selection.blocks.push({
          type: "text",
          text: formatCurrentMessageAttachmentLabel(visualCandidateOrdinal, visualCandidates.length)
        });
      }
      selection.blocks.push(this.toDirectProviderContentBlock(candidate, prepared));
      totalBytes += prepared.buffer.length;
    }

    return selection;
  }

  private async downloadDirectInputAttachmentBytes(
    workspaceId: string,
    objectKey: string
  ): Promise<Buffer | null> {
    if (objectKey.startsWith("/workspace/")) {
      return await this.mediaObjectStorage.downloadByWorkspacePath({
        workspaceId,
        storagePath: objectKey
      });
    }
    return await this.mediaObjectStorage.downloadObject(objectKey);
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
    if (attachment.mimeType === "application/pdf" || attachment.mimeType === "application/x-pdf") {
      return {
        source: "canonical",
        referenceKey: attachment.id,
        kind: "pdf",
        objectKey: attachment.storagePath,
        mimeType: "application/pdf",
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
        objectKey: attachment.storagePath,
        mimeType: attachment.mimeType,
        filename: attachment.displayName,
        sizeBytes: attachment.sizeBytes
      };
    }
    if (attachment.mimeType === "application/pdf" || attachment.mimeType === "application/x-pdf") {
      return {
        source: "runtime",
        referenceKey: attachment.attachmentId,
        kind: "pdf",
        objectKey: attachment.storagePath,
        mimeType: "application/pdf",
        filename: attachment.displayName,
        sizeBytes: attachment.sizeBytes
      };
    }
    return null;
  }

  private toDirectProviderContentBlock(
    candidate: DirectInputAttachmentCandidate,
    payload: PreparedDirectProviderAttachmentPayload
  ): DirectProviderContentBlock {
    if (candidate.kind === "image") {
      return {
        type: "image",
        mimeType: payload.mimeType,
        dataBase64: payload.buffer.toString("base64"),
        filename: candidate.filename
      };
    }

    return {
      type: "pdf",
      mimeType: "application/pdf",
      dataBase64: payload.buffer.toString("base64"),
      filename: candidate.filename
    };
  }

  private async prepareDirectProviderAttachmentPayload(
    candidate: DirectInputAttachmentCandidate,
    buffer: Buffer,
    maxImageEdgePx: number
  ): Promise<PreparedDirectProviderAttachmentPayload | null> {
    if (candidate.kind !== "image") {
      return {
        buffer,
        mimeType: candidate.mimeType
      };
    }
    try {
      const sharpModule = await import("sharp");
      const sharp = sharpModule.default;
      const metadata = await sharp(buffer).metadata();
      const width = typeof metadata.width === "number" ? metadata.width : null;
      const height = typeof metadata.height === "number" ? metadata.height : null;
      if (
        width === null ||
        height === null ||
        (width <= maxImageEdgePx && height <= maxImageEdgePx)
      ) {
        return {
          buffer,
          mimeType: candidate.mimeType
        };
      }
      const resized = await sharp(buffer)
        .rotate()
        .resize(maxImageEdgePx, maxImageEdgePx, {
          fit: "inside",
          withoutEnlargement: true
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      return {
        buffer: resized,
        mimeType: "image/jpeg"
      };
    } catch (error) {
      this.logger.warn(
        `ordinary_vision_resize_failed reference=${candidate.referenceKey} message=${error instanceof Error ? error.message : String(error)}`
      );
      return {
        buffer,
        mimeType: candidate.mimeType
      };
    }
  }

  private createEmptyDirectInputSelection(): DirectInputSelection {
    return {
      blocks: []
    };
  }

  private canonicalAttachmentToRuntimeFileHandle(
    attachment: CanonicalChatAttachmentRow,
    workspaceId: string,
    authorLabel: "user" | "model"
  ): RuntimeFileHandle | null {
    const storagePath = attachment.storagePath.trim();
    if (storagePath.length === 0) {
      return null;
    }
    return {
      storagePath,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      displayName: attachment.originalFilename,
      workspaceId,
      authorLabel
    };
  }

  private runtimeAttachmentToFileHandle(
    attachment: RuntimeAttachmentRef,
    workspaceId: string
  ): RuntimeFileHandle | null {
    const storagePath = attachment.storagePath.trim();
    if (storagePath.length === 0) {
      return null;
    }
    return {
      storagePath,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      displayName: attachment.displayName,
      workspaceId,
      authorLabel: "user"
    };
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

  private isAssistantGeneratedFile(file: Pick<RuntimeFileHandle, "authorLabel">): boolean {
    return file.authorLabel === "model" || file.authorLabel === "sandbox";
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

  private assignStickyAliasesToWorkingFileRefs(
    files: RuntimeFileHandle[],
    appearanceOrder: string[],
    existingStickyAliases: Map<
      string,
      {
        fileAlias: string | null;
        imageAlias: string | null;
        fileOrdinal: number | null;
        imageOrdinal: number | null;
      }
    >
  ): RuntimeFileHandle[] {
    const fileById = new Map(files.map((file) => [file.storagePath, file] as const));
    const orderedIds: string[] = [];
    const seen = new Set<string>();
    const pushOrderedId = (storagePath: string): void => {
      if (seen.has(storagePath) || !fileById.has(storagePath)) {
        return;
      }
      seen.add(storagePath);
      orderedIds.push(storagePath);
    };

    const stickyIds = [...existingStickyAliases.entries()]
      .filter(([storagePath]) => fileById.has(storagePath))
      .sort((left, right) => {
        const leftOrdinal = left[1].fileOrdinal ?? Number.MAX_SAFE_INTEGER;
        const rightOrdinal = right[1].fileOrdinal ?? Number.MAX_SAFE_INTEGER;
        return leftOrdinal - rightOrdinal;
      })
      .map(([storagePath]) => storagePath);
    for (const storagePath of stickyIds) {
      pushOrderedId(storagePath);
    }
    for (const storagePath of appearanceOrder) {
      pushOrderedId(storagePath);
    }
    const remaining = files
      .filter((file) => !seen.has(file.storagePath))
      .sort((left, right) => {
        const createdAtDiff =
          this.parseRuntimeFileHandleCreatedAtMs(left.createdAt) -
          this.parseRuntimeFileHandleCreatedAtMs(right.createdAt);
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return left.storagePath.localeCompare(right.storagePath);
      });
    for (const file of remaining) {
      pushOrderedId(file.storagePath);
    }

    let nextFileOrdinal = Math.max(
      0,
      ...[...existingStickyAliases.values()].map((entry) => entry.fileOrdinal ?? 0)
    );
    let nextImageOrdinal = Math.max(
      0,
      ...[...existingStickyAliases.values()].map((entry) => entry.imageOrdinal ?? 0)
    );

    return orderedIds
      .map((storagePath) => fileById.get(storagePath))
      .filter((file): file is RuntimeFileHandle => file !== undefined)
      .map((file) => {
        const sticky = existingStickyAliases.get(file.storagePath);
        const aliases: string[] = [];
        if (file.mimeType.trim().toLowerCase().startsWith("image/")) {
          aliases.push(sticky?.imageAlias ?? `image #${String(++nextImageOrdinal)}`);
        }
        aliases.push(sticky?.fileAlias ?? `file #${String(++nextFileOrdinal)}`);
        return {
          ...file,
          aliases
        };
      });
  }

  private collectExistingStickyAliases(files: RuntimeFileHandle[]): Map<
    string,
    {
      fileAlias: string | null;
      imageAlias: string | null;
      fileOrdinal: number | null;
      imageOrdinal: number | null;
    }
  > {
    const entries = new Map<
      string,
      {
        fileAlias: string | null;
        imageAlias: string | null;
        fileOrdinal: number | null;
        imageOrdinal: number | null;
      }
    >();
    for (const file of files) {
      let fileAlias: string | null = null;
      let imageAlias: string | null = null;
      let fileOrdinal: number | null = null;
      let imageOrdinal: number | null = null;
      for (const alias of file.aliases ?? []) {
        const parsedFileOrdinal = this.parseStickyAliasOrdinal(alias, "file");
        if (parsedFileOrdinal !== null && fileAlias === null) {
          fileAlias = alias;
          fileOrdinal = parsedFileOrdinal;
          continue;
        }
        const parsedImageOrdinal = this.parseStickyAliasOrdinal(alias, "image");
        if (parsedImageOrdinal !== null && imageAlias === null) {
          imageAlias = alias;
          imageOrdinal = parsedImageOrdinal;
        }
      }
      if (fileAlias !== null || imageAlias !== null) {
        entries.set(file.storagePath, {
          fileAlias,
          imageAlias,
          fileOrdinal,
          imageOrdinal
        });
      }
    }
    return entries;
  }

  private parseStickyAliasOrdinal(alias: string, kind: "file" | "image"): number | null {
    const match = alias
      .trim()
      .toLowerCase()
      .match(new RegExp(`^${kind} #(\\d+)$`, "i"));
    if (match === null) {
      return null;
    }
    const parsed = Number.parseInt(match[1] ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private parseRuntimeFileHandleCreatedAtMs(createdAt: string | undefined): number {
    if (typeof createdAt !== "string" || createdAt.trim().length === 0) {
      return 0;
    }
    const parsed = Date.parse(createdAt);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
