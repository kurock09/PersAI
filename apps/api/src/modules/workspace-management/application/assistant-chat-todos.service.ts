import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  PERSAI_RUNTIME_TODO_WRITE_STATUSES,
  RUNTIME_CHAT_PLAN_WINDOW_MAX,
  type PersaiRuntimeTodoWriteStatus,
  type PersaiRuntimeTodoWriteOrigin,
  type RuntimeTodoItem
} from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import type { AssistantChatSurface } from "../domain/assistant-chat.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

/**
 * ADR-125 — server-side hard ceiling on rows per chat. Any `add` that would
 * cross this is rejected with `cap_exceeded`. See also `SOFT_ACTIVE_CAP`.
 */
const HARD_ACTIVE_CAP = 500;

/**
 * ADR-125 — soft advisory cap; once crossed we still apply the mutation but
 * surface a `warning` so the model knows the plan is getting unwieldy. The
 * model is free to keep adding; older items simply roll out of the prompt
 * window (which is capped at RUNTIME_CHAT_PLAN_WINDOW_MAX).
 */
const SOFT_ACTIVE_CAP = 200;

const MAX_CONTENT_LENGTH = 240;

const MAX_ADD_ITEMS_PER_CALL = 50;

export type AssistantChatTodosChannel = "web" | "telegram";

export interface AssistantChatTodosAddItemInput {
  content: string;
  parentId?: string | null;
  status?: PersaiRuntimeTodoWriteStatus;
}

export type AssistantChatTodosActionInput =
  | { kind: "add"; items: AssistantChatTodosAddItemInput[] }
  | {
      kind: "update";
      id: string;
      content?: string;
      status?: PersaiRuntimeTodoWriteStatus;
      parentId?: string | null;
    }
  | { kind: "complete"; id: string }
  | { kind: "remove"; id: string }
  | { kind: "clear" };

export interface AssistantChatTodosApplyInput {
  assistantId: string;
  channel: AssistantChatTodosChannel;
  surfaceThreadKey: string;
  action: AssistantChatTodosActionInput;
}

export interface AssistantChatTodosApplyResult {
  action: "applied" | "skipped";
  reason: string | null;
  warning: string | null;
  todos: RuntimeTodoItem[];
  windowed: boolean;
  /** Total number of rows in the chat plan after the mutation. */
  totalCount: number;
  /** Chat id resolved during the call — exposed so callers can audit. */
  chatId: string;
}

export interface AssistantChatTodosSeedSkillScenarioInput {
  assistantId: string;
  channel: AssistantChatTodosChannel;
  surfaceThreadKey: string;
  /** UUID of the skill engagement scenario originated from (or null if unknown). */
  skillId: string | null;
  /** Human-readable label persisted on each seeded row so the UI/projection can render attribution. */
  skillLabel: string | null;
  scenarioKey: string;
  /** Stable deterministic key the runtime computes; (chatId, seedKey) is unique. */
  seedKey: string;
  /** Scenario step directives in scenario order. */
  directives: string[];
}

export type AssistantChatTodosSeedSkillScenarioOutcome =
  | { kind: "seeded"; chatId: string; insertedCount: number; todos: RuntimeTodoItem[] }
  | { kind: "already_seeded"; chatId: string }
  | { kind: "skipped"; chatId: string; reason: "no_directives" | "cap_exceeded" };

export interface AssistantChatTodosWindowInput {
  chatId: string;
}

export interface AssistantChatTodosWindowResult {
  todos: RuntimeTodoItem[];
  windowed: boolean;
  totalCount: number;
}

/**
 * Internal row shape used during ordering / window selection. Kept private
 * because the API returns only the projected `RuntimeTodoItem` view.
 */
interface TodoRow {
  id: string;
  parentId: string | null;
  content: string;
  status: PersaiRuntimeTodoWriteStatus;
  origin: PersaiRuntimeTodoWriteOrigin;
  seedSkillLabel: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

@Injectable()
export class AssistantChatTodosService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  async resolveChatIdFromSurfaceThread(
    assistantId: string,
    channel: AssistantChatTodosChannel,
    surfaceThreadKey: string
  ): Promise<{ chatId: string; assistantId: string }> {
    const surface = this.resolveSurface(channel);
    const chat = await this.assistantChatRepository.findChatBySurfaceThread(
      assistantId,
      surface,
      surfaceThreadKey
    );
    if (chat === null) {
      throw new NotFoundException(
        `Chat not found for assistant=${assistantId} channel=${channel} thread=${surfaceThreadKey}`
      );
    }
    return { chatId: chat.id, assistantId: chat.assistantId };
  }

  async applyAction(input: AssistantChatTodosApplyInput): Promise<AssistantChatTodosApplyResult> {
    const { chatId, assistantId } = await this.resolveChatIdFromSurfaceThread(
      input.assistantId,
      input.channel,
      input.surfaceThreadKey
    );
    return this.applyActionForChat({ chatId, assistantId, action: input.action });
  }

  async applyActionForChat(input: {
    chatId: string;
    assistantId: string;
    action: AssistantChatTodosActionInput;
  }): Promise<AssistantChatTodosApplyResult> {
    switch (input.action.kind) {
      case "add":
        return this.handleAdd(input.chatId, input.assistantId, input.action.items);
      case "update":
        return this.handleUpdate(input.chatId, input.assistantId, input.action);
      case "complete":
        return this.handleComplete(input.chatId, input.assistantId, input.action.id);
      case "remove":
        return this.handleRemove(input.chatId, input.assistantId, input.action.id);
      case "clear":
        return this.handleClear(input.chatId, input.assistantId);
    }
  }

  async readWindow(input: AssistantChatTodosWindowInput): Promise<AssistantChatTodosWindowResult> {
    const rows = await this.loadAllRows(input.chatId);
    const selection = selectChatPlanWindow(rows);
    return {
      todos: selection.todos,
      windowed: selection.windowed,
      totalCount: rows.length
    };
  }

  /**
   * ADR-125 Slice 2 — seed the scenario's directives as todos in the current
   * chat, embedded under the deepest in_progress todo or as top-level items.
   *
   * Idempotency: Slice 1 placed a `UNIQUE (chat_id, seed_key)` index on the
   * table, which means N seeded rows must each carry a distinct `seed_key`.
   * We honor that by deriving per-row keys from the runtime-supplied
   * `seedKey` (all N step rows share the same `seedKey`) and treating any
   * pre-existing row with `(chatId, seedKey) = (current, seedKey)` as proof the
   * scenario has already been seeded. Concurrent re-engages from two runtime
   * pods are made safe by running the existence check + inserts inside the same
   * Prisma transaction.
   *
   * Failures here MUST NOT block the engage flow upstream — the runtime calls
   * this after `updateSkillState` already succeeded and only warn-logs any
   * thrown error.
   */
  async seedSkillScenarioTodos(
    input: AssistantChatTodosSeedSkillScenarioInput
  ): Promise<AssistantChatTodosSeedSkillScenarioOutcome> {
    const scenarioKey = this.normalizeIdentifier(input.scenarioKey, "scenarioKey");
    const seedKey = this.normalizeIdentifier(input.seedKey, "seedKey");
    const skillId = input.skillId === null ? null : this.normalizeOptionalIdentifier(input.skillId);
    const skillLabel = this.normalizeOptionalLabel(input.skillLabel);

    if (!Array.isArray(input.directives)) {
      throw new BadRequestException("directives must be an array of strings.");
    }
    const normalizedDirectives = this.normalizeScenarioDirectives(input.directives);
    if (normalizedDirectives.length === 0) {
      const { chatId } = await this.resolveChatIdFromSurfaceThread(
        input.assistantId,
        input.channel,
        input.surfaceThreadKey
      );
      return { kind: "skipped", chatId, reason: "no_directives" };
    }

    const { chatId, assistantId } = await this.resolveChatIdFromSurfaceThread(
      input.assistantId,
      input.channel,
      input.surfaceThreadKey
    );

    return await this.prisma.$transaction(async (tx) => {
      const alreadySeeded = await tx.assistantChatTodo.findFirst({
        where: { chatId, seedKey },
        select: { id: true }
      });
      if (alreadySeeded !== null) {
        return { kind: "already_seeded" as const, chatId };
      }

      const existing = await this.loadAllRowsTx(tx, chatId);

      if (existing.length + normalizedDirectives.length > HARD_ACTIVE_CAP) {
        return { kind: "skipped" as const, chatId, reason: "cap_exceeded" as const };
      }

      const parentId = this.resolveDeepestInProgressParentId(existing);

      const bucket: string | "__root__" = parentId ?? "__root__";
      let sortOrderCursor = 0;
      for (const row of existing) {
        const rowBucket = row.parentId ?? "__root__";
        if (rowBucket === bucket && row.sortOrder > sortOrderCursor) {
          sortOrderCursor = row.sortOrder;
        }
      }

      const createdRows: TodoRow[] = [];
      for (let index = 0; index < normalizedDirectives.length; index += 1) {
        const directive = normalizedDirectives[index]!;
        sortOrderCursor += 1;
        const created = await tx.assistantChatTodo.create({
          data: {
            chatId,
            assistantId,
            parentId,
            content: directive,
            status: "pending",
            origin: "scenario_seeded",
            seedSkillId: skillId,
            seedSkillLabel: skillLabel,
            seedScenarioKey: scenarioKey,
            seedKey,
            sortOrder: sortOrderCursor
          },
          select: this.todoSelect()
        });
        createdRows.push(this.mapRow(created));
      }

      const finalRows = [...existing, ...createdRows];
      const window = selectChatPlanWindow(finalRows);
      const insertedIds = new Set(createdRows.map((row) => row.id));
      const todosForResult = window.todos.filter((todo) => insertedIds.has(todo.id));
      return {
        kind: "seeded" as const,
        chatId,
        insertedCount: createdRows.length,
        todos: todosForResult
      };
    });
  }

  async readWindowForSurfaceThread(input: {
    assistantId: string;
    channel: AssistantChatTodosChannel;
    surfaceThreadKey: string;
  }): Promise<AssistantChatTodosWindowResult & { chatId: string }> {
    const { chatId } = await this.resolveChatIdFromSurfaceThread(
      input.assistantId,
      input.channel,
      input.surfaceThreadKey
    );
    const window = await this.readWindow({ chatId });
    return { ...window, chatId };
  }

  private async handleAdd(
    chatId: string,
    assistantId: string,
    items: AssistantChatTodosAddItemInput[]
  ): Promise<AssistantChatTodosApplyResult> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException("add action requires at least one item.");
    }
    if (items.length > MAX_ADD_ITEMS_PER_CALL) {
      throw new BadRequestException(
        `add action cannot exceed ${MAX_ADD_ITEMS_PER_CALL} items per call.`
      );
    }

    const normalizedItems = items.map((item) => this.normalizeAddItem(item));

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadAllRowsTx(tx, chatId);
      if (existing.length + normalizedItems.length > HARD_ACTIVE_CAP) {
        return {
          action: "skipped" as const,
          reason: "cap_exceeded",
          warning: null,
          finalRows: existing
        };
      }

      const parentIdsRequested = new Set(
        normalizedItems
          .map((item) => item.parentId)
          .filter((parentId): parentId is string => parentId !== null)
      );
      if (parentIdsRequested.size > 0) {
        const existingIds = new Set(existing.map((row) => row.id));
        for (const requestedParentId of parentIdsRequested) {
          if (!existingIds.has(requestedParentId)) {
            throw new BadRequestException(
              `parentId "${requestedParentId}" does not exist in this chat.`
            );
          }
          const parent = existing.find((row) => row.id === requestedParentId);
          if (parent && parent.status === "completed") {
            throw new BadRequestException(
              `parentId "${requestedParentId}" is completed; cannot attach new children.`
            );
          }
        }
      }

      const sortOrderCursorByParent = new Map<string | "__root__", number>();
      for (const row of existing) {
        const bucket = row.parentId ?? "__root__";
        const current = sortOrderCursorByParent.get(bucket) ?? 0;
        if (row.sortOrder > current) {
          sortOrderCursorByParent.set(bucket, row.sortOrder);
        }
      }

      const inProgressByParent = new Map<string | "__root__", boolean>();
      for (const row of existing) {
        if (row.status === "in_progress") {
          inProgressByParent.set(row.parentId ?? "__root__", true);
        }
      }

      let warning: string | null = null;
      let coercedInProgressCount = 0;

      const createdRows: TodoRow[] = [];

      for (const item of normalizedItems) {
        const bucket: string | "__root__" = item.parentId ?? "__root__";
        const nextOrder = (sortOrderCursorByParent.get(bucket) ?? 0) + 1;
        sortOrderCursorByParent.set(bucket, nextOrder);

        let effectiveStatus: PersaiRuntimeTodoWriteStatus = item.status;
        if (effectiveStatus === "in_progress" && inProgressByParent.get(bucket) === true) {
          effectiveStatus = "pending";
          coercedInProgressCount += 1;
        }
        if (effectiveStatus === "in_progress") {
          inProgressByParent.set(bucket, true);
        }

        const created = await tx.assistantChatTodo.create({
          data: {
            chatId,
            assistantId,
            parentId: item.parentId,
            content: item.content,
            status: effectiveStatus,
            origin: "model_authored",
            sortOrder: nextOrder
          },
          select: this.todoSelect()
        });
        createdRows.push(this.mapRow(created));
      }

      if (coercedInProgressCount > 0) {
        warning =
          coercedInProgressCount === 1
            ? "1 new item was coerced to pending because another sibling is already in_progress."
            : `${coercedInProgressCount} new items were coerced to pending because another sibling is already in_progress.`;
      }

      const finalRows = [...existing, ...createdRows];
      if (warning === null && finalRows.length > SOFT_ACTIVE_CAP) {
        warning = `Chat plan now has ${finalRows.length} active items, above the soft cap of ${SOFT_ACTIVE_CAP}. Older items will roll out of the visible window.`;
      }
      return { action: "applied" as const, reason: null, warning, finalRows };
    });

    return this.buildResult(chatId, result);
  }

  private async handleUpdate(
    chatId: string,
    _assistantId: string,
    payload: {
      id: string;
      content?: string;
      status?: PersaiRuntimeTodoWriteStatus;
      parentId?: string | null;
    }
  ): Promise<AssistantChatTodosApplyResult> {
    const normalizedContent =
      payload.content === undefined ? undefined : this.normalizeContent(payload.content);
    const normalizedStatus =
      payload.status === undefined ? undefined : this.normalizeStatus(payload.status);
    const reparent = payload.parentId !== undefined;
    const normalizedParentId = reparent ? this.normalizeOptionalParentId(payload.parentId) : null;

    if (normalizedContent === undefined && normalizedStatus === undefined && !reparent) {
      throw new BadRequestException(
        "update action requires at least one of content, status, parentId."
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadAllRowsTx(tx, chatId);
      const target = existing.find((row) => row.id === payload.id);
      if (!target) {
        throw new NotFoundException(`Todo "${payload.id}" not found in this chat.`);
      }

      if (target.status === "completed") {
        return {
          action: "skipped" as const,
          reason: "completed_immutable",
          warning: null,
          finalRows: existing
        };
      }

      const data: Prisma.AssistantChatTodoUpdateInput = {};
      let nextParentId: string | null = target.parentId;
      let nextStatus: PersaiRuntimeTodoWriteStatus = target.status;

      if (normalizedContent !== undefined) {
        data.content = normalizedContent;
      }

      if (reparent) {
        if (normalizedParentId !== null) {
          const parent = existing.find((row) => row.id === normalizedParentId);
          if (!parent) {
            throw new BadRequestException(
              `parentId "${normalizedParentId}" does not exist in this chat.`
            );
          }
          if (parent.status === "completed") {
            throw new BadRequestException(
              `parentId "${normalizedParentId}" is completed; cannot attach as parent.`
            );
          }
          if (this.wouldCreateCycle(existing, payload.id, normalizedParentId)) {
            throw new BadRequestException(
              `Reparenting "${payload.id}" under "${normalizedParentId}" would create a cycle.`
            );
          }
        }
        data.parent =
          normalizedParentId === null
            ? { disconnect: true }
            : { connect: { id: normalizedParentId } };
        nextParentId = normalizedParentId;
      }

      const warning: string | null = null;

      if (normalizedStatus !== undefined) {
        if (normalizedStatus === "completed") {
          const openChildren = existing.filter(
            (row) => row.parentId === payload.id && row.status !== "completed"
          );
          if (openChildren.length > 0) {
            return {
              action: "skipped" as const,
              reason: "children_open",
              warning: null,
              finalRows: existing
            };
          }
          data.status = "completed";
          data.completedAt = new Date();
          nextStatus = "completed";
        } else if (normalizedStatus === "in_progress") {
          const siblingInProgress = existing.find(
            (row) =>
              row.id !== payload.id && row.parentId === nextParentId && row.status === "in_progress"
          );
          if (siblingInProgress) {
            return {
              action: "skipped" as const,
              reason: "sibling_in_progress",
              warning: null,
              finalRows: existing
            };
          }
          data.status = "in_progress";
          nextStatus = "in_progress";
        } else {
          data.status = "pending";
          nextStatus = "pending";
        }
      }

      const updated = await tx.assistantChatTodo.update({
        where: { id: payload.id },
        data,
        select: this.todoSelect()
      });
      const mappedUpdated = this.mapRow(updated);
      const finalRows = existing.map((row) => (row.id === payload.id ? mappedUpdated : row));

      void nextStatus;

      return { action: "applied" as const, reason: null, warning, finalRows };
    });

    return this.buildResult(chatId, result);
  }

  private async handleComplete(
    chatId: string,
    _assistantId: string,
    id: string
  ): Promise<AssistantChatTodosApplyResult> {
    return this.handleUpdate(chatId, _assistantId, { id, status: "completed" });
  }

  private async handleRemove(
    chatId: string,
    _assistantId: string,
    id: string
  ): Promise<AssistantChatTodosApplyResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadAllRowsTx(tx, chatId);
      const target = existing.find((row) => row.id === id);
      if (!target) {
        throw new NotFoundException(`Todo "${id}" not found in this chat.`);
      }
      await tx.assistantChatTodo.delete({ where: { id } });
      const removedIds = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const row of existing) {
          if (row.parentId !== null && removedIds.has(row.parentId) && !removedIds.has(row.id)) {
            removedIds.add(row.id);
            grew = true;
          }
        }
      }
      const finalRows = existing.filter((row) => !removedIds.has(row.id));
      return { action: "applied" as const, reason: null, warning: null, finalRows };
    });
    return this.buildResult(chatId, result);
  }

  private async handleClear(
    chatId: string,
    _assistantId: string
  ): Promise<AssistantChatTodosApplyResult> {
    await this.prisma.assistantChatTodo.deleteMany({ where: { chatId } });
    return this.buildResult(chatId, {
      action: "applied",
      reason: null,
      warning: null,
      finalRows: []
    });
  }

  private async loadAllRows(chatId: string): Promise<TodoRow[]> {
    const rows = await this.prisma.assistantChatTodo.findMany({
      where: { chatId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: this.todoSelect()
    });
    return rows.map((row) => this.mapRow(row));
  }

  private async loadAllRowsTx(tx: Prisma.TransactionClient, chatId: string): Promise<TodoRow[]> {
    const rows = await tx.assistantChatTodo.findMany({
      where: { chatId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: this.todoSelect()
    });
    return rows.map((row) => this.mapRow(row));
  }

  private todoSelect() {
    return {
      id: true,
      parentId: true,
      content: true,
      status: true,
      origin: true,
      seedSkillLabel: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true
    } as const;
  }

  private mapRow(row: {
    id: string;
    parentId: string | null;
    content: string;
    status: PersaiRuntimeTodoWriteStatus;
    origin: PersaiRuntimeTodoWriteOrigin;
    seedSkillLabel: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }): TodoRow {
    return {
      id: row.id,
      parentId: row.parentId,
      content: row.content,
      status: row.status,
      origin: row.origin,
      seedSkillLabel: row.seedSkillLabel,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt
    };
  }

  private buildResult(
    chatId: string,
    result: {
      action: "applied" | "skipped";
      reason: string | null;
      warning: string | null;
      finalRows: TodoRow[];
    }
  ): AssistantChatTodosApplyResult {
    const selection = selectChatPlanWindow(result.finalRows);
    return {
      action: result.action,
      reason: result.reason,
      warning: result.warning,
      todos: selection.todos,
      windowed: selection.windowed,
      totalCount: result.finalRows.length,
      chatId
    };
  }

  private normalizeAddItem(item: AssistantChatTodosAddItemInput): {
    content: string;
    parentId: string | null;
    status: PersaiRuntimeTodoWriteStatus;
  } {
    const content = this.normalizeContent(item.content);
    const parentId = this.normalizeOptionalParentId(item.parentId);
    let status: PersaiRuntimeTodoWriteStatus = "pending";
    if (item.status !== undefined) {
      const normalized = this.normalizeStatus(item.status);
      if (normalized === "completed") {
        throw new BadRequestException("Cannot start a new todo with status=completed.");
      }
      status = normalized;
    }
    return { content, parentId, status };
  }

  private normalizeContent(value: unknown): string {
    if (typeof value !== "string") {
      throw new BadRequestException("content must be a string.");
    }
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0) {
      throw new BadRequestException("content must be a non-empty string.");
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(`content exceeds the ${MAX_CONTENT_LENGTH}-char limit.`);
    }
    return trimmed;
  }

  private normalizeStatus(value: unknown): PersaiRuntimeTodoWriteStatus {
    if (
      typeof value === "string" &&
      PERSAI_RUNTIME_TODO_WRITE_STATUSES.includes(value as PersaiRuntimeTodoWriteStatus)
    ) {
      return value as PersaiRuntimeTodoWriteStatus;
    }
    throw new BadRequestException(
      `status must be one of ${PERSAI_RUNTIME_TODO_WRITE_STATUSES.join(", ")}.`
    );
  }

  private normalizeOptionalParentId(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException("parentId must be a string or null.");
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return trimmed;
  }

  private normalizeIdentifier(value: unknown, label: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(`${label} must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`${label} must be a non-empty string.`);
    }
    return trimmed;
  }

  private normalizeOptionalIdentifier(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      throw new BadRequestException("identifier must be a string or null.");
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private normalizeOptionalLabel(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      throw new BadRequestException("skillLabel must be a string or null.");
    }
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0) return null;
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      return `${trimmed.slice(0, MAX_CONTENT_LENGTH - 1)}…`;
    }
    return trimmed;
  }

  /**
   * Trim each directive, collapse whitespace, drop empty entries, and
   * hard-cut anything over `MAX_CONTENT_LENGTH` with an ellipsis. Server-side
   * truncation keeps a single oversized scenario step from failing the whole
   * batch and matches the runtime client expectation.
   */
  private normalizeScenarioDirectives(values: readonly unknown[]): string[] {
    const out: string[] = [];
    for (const raw of values) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim().replace(/\s+/g, " ");
      if (trimmed.length === 0) continue;
      if (trimmed.length > MAX_CONTENT_LENGTH) {
        out.push(`${trimmed.slice(0, MAX_CONTENT_LENGTH - 1)}…`);
      } else {
        out.push(trimmed);
      }
    }
    return out;
  }

  /**
   * Walk the in_progress chain top-down. The handleAdd invariant guarantees
   * at most one in_progress sibling per parent bucket, so descending greedily
   * yields a single deepest node. Returns null when no in_progress todo exists,
   * which signals top-level attachment.
   */
  private resolveDeepestInProgressParentId(rows: readonly TodoRow[]): string | null {
    const inProgressByParent = new Map<string | "__root__", TodoRow>();
    for (const row of rows) {
      if (row.status !== "in_progress") continue;
      const bucket: string | "__root__" = row.parentId ?? "__root__";
      if (!inProgressByParent.has(bucket)) {
        inProgressByParent.set(bucket, row);
      }
    }

    let cursor: TodoRow | undefined = inProgressByParent.get("__root__");
    if (cursor === undefined) {
      return null;
    }
    const visited = new Set<string>();
    while (cursor !== undefined) {
      if (visited.has(cursor.id)) break;
      visited.add(cursor.id);
      const child = inProgressByParent.get(cursor.id);
      if (child === undefined) {
        return cursor.id;
      }
      cursor = child;
    }
    return cursor?.id ?? null;
  }

  private resolveSurface(channel: string): AssistantChatSurface {
    if (channel === "web" || channel === "telegram") {
      return channel;
    }
    throw new BadRequestException(`Unsupported channel: ${channel}`);
  }

  private wouldCreateCycle(rows: TodoRow[], movingId: string, candidateParentId: string): boolean {
    if (movingId === candidateParentId) return true;
    const parentByChild = new Map<string, string | null>();
    for (const row of rows) {
      parentByChild.set(row.id, row.parentId);
    }
    const movingDescendants = new Set<string>();
    const queue: string[] = [movingId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const row of rows) {
        if (row.parentId === current && !movingDescendants.has(row.id)) {
          movingDescendants.add(row.id);
          queue.push(row.id);
        }
      }
    }
    let cursor: string | null | undefined = candidateParentId;
    const seen = new Set<string>();
    while (cursor !== null && cursor !== undefined) {
      if (cursor === movingId) return true;
      if (movingDescendants.has(cursor)) return true;
      if (seen.has(cursor)) {
        throw new ServiceUnavailableException(
          `Cycle detected in existing chat plan involving "${cursor}".`
        );
      }
      seen.add(cursor);
      cursor = parentByChild.get(cursor) ?? null;
    }
    return false;
  }
}

/**
 * ADR-125 window selector. Window rule:
 * `(all in_progress) + (most recent ~6 pending) + (most recent ~2 completed)`,
 * ordered by `sortOrder` within parent buckets, with each child co-located
 * under its parent (no orphans). Total capped at RUNTIME_CHAT_PLAN_WINDOW_MAX.
 * Exported so the reinjection block builder, the response window, and tests
 * all use the same logic.
 */
export function selectChatPlanWindow(
  rows: {
    id: string;
    parentId: string | null;
    content: string;
    status: PersaiRuntimeTodoWriteStatus;
    origin: PersaiRuntimeTodoWriteOrigin;
    seedSkillLabel: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }[]
): { todos: RuntimeTodoItem[]; windowed: boolean } {
  if (rows.length === 0) {
    return { todos: [], windowed: false };
  }

  const orderedRows = [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const byId = new Map(orderedRows.map((row) => [row.id, row] as const));

  const selectedIds = new Set<string>();
  const inProgressIds: string[] = [];
  const pendingIds: string[] = [];
  const completedIds: string[] = [];

  for (const row of orderedRows) {
    if (row.status === "in_progress") {
      inProgressIds.push(row.id);
    } else if (row.status === "pending") {
      pendingIds.push(row.id);
    } else {
      completedIds.push(row.id);
    }
  }

  const completedMostRecent = [...completedIds].sort((a, b) => {
    const left = byId.get(a)?.completedAt ?? byId.get(a)?.updatedAt ?? new Date(0);
    const right = byId.get(b)?.completedAt ?? byId.get(b)?.updatedAt ?? new Date(0);
    return right.getTime() - left.getTime();
  });

  const tryAdd = (id: string): boolean => {
    if (selectedIds.has(id)) return true;
    if (selectedIds.size >= RUNTIME_CHAT_PLAN_WINDOW_MAX) return false;
    selectedIds.add(id);
    const row = byId.get(id);
    if (row && row.parentId !== null && byId.has(row.parentId) && !selectedIds.has(row.parentId)) {
      if (selectedIds.size >= RUNTIME_CHAT_PLAN_WINDOW_MAX) {
        selectedIds.delete(id);
        return false;
      }
      const parentAdded = tryAdd(row.parentId);
      if (!parentAdded) {
        selectedIds.delete(id);
        return false;
      }
    }
    return true;
  };

  for (const id of inProgressIds) {
    if (!tryAdd(id)) break;
  }
  for (const id of pendingIds.slice(0, 6)) {
    if (!tryAdd(id)) break;
  }
  for (const id of completedMostRecent.slice(0, 2)) {
    if (!tryAdd(id)) break;
  }

  const renderedRows: RuntimeTodoItem[] = [];
  const visited = new Set<string>();

  const renderSubtree = (rootId: string): void => {
    if (visited.has(rootId)) return;
    const root = byId.get(rootId);
    if (!root) return;
    visited.add(rootId);
    renderedRows.push({
      id: root.id,
      parentId: root.parentId,
      content: root.content,
      status: root.status,
      origin: root.origin,
      seedSkillLabel: root.seedSkillLabel
    });
    const children = orderedRows.filter(
      (candidate) => candidate.parentId === rootId && selectedIds.has(candidate.id)
    );
    for (const child of children) {
      renderSubtree(child.id);
    }
  };

  const topLevelSelected = orderedRows.filter(
    (row) => selectedIds.has(row.id) && (row.parentId === null || !selectedIds.has(row.parentId))
  );
  for (const top of topLevelSelected) {
    renderSubtree(top.id);
  }
  for (const row of orderedRows) {
    if (selectedIds.has(row.id)) renderSubtree(row.id);
  }

  return {
    todos: renderedRows,
    windowed: rows.length > renderedRows.length
  };
}
