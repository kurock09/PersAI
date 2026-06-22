import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req
} from "@nestjs/common";
import {
  PERSAI_RUNTIME_TODO_WRITE_ACTIONS,
  PERSAI_RUNTIME_TODO_WRITE_STATUSES,
  type PersaiRuntimeTodoWriteAction,
  type PersaiRuntimeTodoWriteStatus,
  type RuntimeTodoItem
} from "@persai/runtime-contract";
import {
  AssistantChatTodosService,
  type AssistantChatTodosActionInput,
  type AssistantChatTodosApplyResult,
  type AssistantChatTodosChannel,
  type AssistantChatTodosSeedSkillScenarioOutcome
} from "../../application/assistant-chat-todos.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

interface ApplyResponse {
  ok: true;
  chatId: string;
  action: "applied" | "skipped";
  reason: string | null;
  warning: string | null;
  todos: RuntimeTodoItem[];
  windowed: boolean;
  totalCount: number;
}

interface WindowResponse {
  ok: true;
  chatId: string;
  todos: RuntimeTodoItem[];
  windowed: boolean;
  totalCount: number;
}

interface SeedSkillScenarioResponse {
  ok: true;
  chatId: string;
  outcome:
    | { kind: "seeded"; insertedCount: number; todos: RuntimeTodoItem[] }
    | { kind: "already_seeded" }
    | { kind: "skipped"; reason: "no_directives" | "cap_exceeded" };
}

@Controller("api/v1/internal/runtime/chat-todos")
export class InternalRuntimeChatTodosController {
  constructor(private readonly assistantChatTodosService: AssistantChatTodosService) {}

  @HttpCode(200)
  @Post("apply")
  async apply(@Req() req: InternalRequestLike, @Body() body: unknown): Promise<ApplyResponse> {
    this.assertAuthorized(req);
    const parsed = this.parseApplyBody(body);
    const result = await this.assistantChatTodosService.applyAction(parsed);
    return this.toApplyResponse(result);
  }

  @Get("window")
  async readWindow(
    @Req() req: InternalRequestLike,
    @Query("assistantId") assistantId: string,
    @Query("channel") channel: string,
    @Query("surfaceThreadKey") surfaceThreadKey: string
  ): Promise<WindowResponse> {
    this.assertAuthorized(req);
    const normalized = {
      assistantId: this.asNonEmptyString(assistantId, "assistantId"),
      channel: this.asChannel(channel),
      surfaceThreadKey: this.asNonEmptyString(surfaceThreadKey, "surfaceThreadKey")
    };
    const result = await this.assistantChatTodosService.readWindowForSurfaceThread(normalized);
    return {
      ok: true,
      chatId: result.chatId,
      todos: result.todos,
      windowed: result.windowed,
      totalCount: result.totalCount
    };
  }

  @HttpCode(200)
  @Post("seed-skill-scenario")
  async seedSkillScenario(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<SeedSkillScenarioResponse> {
    this.assertAuthorized(req);
    const parsed = this.parseSeedSkillScenarioBody(body);
    const outcome = await this.assistantChatTodosService.seedSkillScenarioTodos(parsed);
    return this.toSeedSkillScenarioResponse(outcome);
  }

  private toSeedSkillScenarioResponse(
    outcome: AssistantChatTodosSeedSkillScenarioOutcome
  ): SeedSkillScenarioResponse {
    if (outcome.kind === "seeded") {
      return {
        ok: true,
        chatId: outcome.chatId,
        outcome: {
          kind: "seeded",
          insertedCount: outcome.insertedCount,
          todos: outcome.todos
        }
      };
    }
    if (outcome.kind === "already_seeded") {
      return { ok: true, chatId: outcome.chatId, outcome: { kind: "already_seeded" } };
    }
    return {
      ok: true,
      chatId: outcome.chatId,
      outcome: { kind: "skipped", reason: outcome.reason }
    };
  }

  private parseSeedSkillScenarioBody(body: unknown): {
    assistantId: string;
    channel: AssistantChatTodosChannel;
    surfaceThreadKey: string;
    skillId: string | null;
    skillLabel: string | null;
    scenarioKey: string;
    seedKey: string;
    directives: string[];
  } {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException("Invalid chat-todos seed-skill-scenario request body.");
    }
    const row = body as Record<string, unknown>;
    const assistantId = this.asNonEmptyString(row.assistantId, "assistantId");
    const channel = this.asChannel(row.channel);
    const surfaceThreadKey = this.asNonEmptyString(row.surfaceThreadKey, "surfaceThreadKey");
    const skillId = this.asOptionalString(row.skillId, "skillId");
    const skillLabel = this.asOptionalString(row.skillLabel, "skillLabel");
    const scenarioKey = this.asNonEmptyString(row.scenarioKey, "scenarioKey");
    const seedKey = this.asNonEmptyString(row.seedKey, "seedKey");
    if (!Array.isArray(row.directives)) {
      throw new BadRequestException("directives must be an array of strings.");
    }
    const directives: string[] = [];
    for (let index = 0; index < row.directives.length; index += 1) {
      const entry = row.directives[index];
      if (typeof entry !== "string") {
        throw new BadRequestException(`directives[${index}] must be a string.`);
      }
      directives.push(entry);
    }
    return {
      assistantId,
      channel,
      surfaceThreadKey,
      skillId,
      skillLabel,
      scenarioKey,
      seedKey,
      directives
    };
  }

  private asOptionalString(value: unknown, label: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      throw new BadRequestException(`${label} must be a string or null.`);
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private toApplyResponse(result: AssistantChatTodosApplyResult): ApplyResponse {
    return {
      ok: true,
      chatId: result.chatId,
      action: result.action,
      reason: result.reason,
      warning: result.warning,
      todos: result.todos,
      windowed: result.windowed,
      totalCount: result.totalCount
    };
  }

  private parseApplyBody(body: unknown): {
    assistantId: string;
    channel: AssistantChatTodosChannel;
    surfaceThreadKey: string;
    action: AssistantChatTodosActionInput;
  } {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException("Invalid chat-todos apply request body.");
    }
    const row = body as Record<string, unknown>;
    const assistantId = this.asNonEmptyString(row.assistantId, "assistantId");
    const channel = this.asChannel(row.channel);
    const surfaceThreadKey = this.asNonEmptyString(row.surfaceThreadKey, "surfaceThreadKey");
    const action = this.parseActionPayload(row.action);
    return { assistantId, channel, surfaceThreadKey, action };
  }

  private parseActionPayload(value: unknown): AssistantChatTodosActionInput {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new BadRequestException("action must be an object.");
    }
    const row = value as Record<string, unknown>;
    const kindRaw = typeof row.kind === "string" ? row.kind.trim() : null;
    if (
      kindRaw === null ||
      !PERSAI_RUNTIME_TODO_WRITE_ACTIONS.includes(kindRaw as PersaiRuntimeTodoWriteAction)
    ) {
      throw new BadRequestException(
        `action.kind must be one of ${PERSAI_RUNTIME_TODO_WRITE_ACTIONS.join(", ")}.`
      );
    }
    const kind = kindRaw as PersaiRuntimeTodoWriteAction;
    switch (kind) {
      case "add":
        return { kind: "add", items: this.parseAddItems(row.items) };
      case "update":
        return {
          kind: "update",
          id: this.asNonEmptyString(row.id, "action.id"),
          ...this.parseOptionalString(row.content, "action.content", "content"),
          ...this.parseOptionalStatus(row.status, "action.status", "status"),
          ...this.parseOptionalParentField(row.parentId)
        };
      case "complete":
        return { kind: "complete", id: this.asNonEmptyString(row.id, "action.id") };
      case "remove":
        return { kind: "remove", id: this.asNonEmptyString(row.id, "action.id") };
      case "clear":
        return { kind: "clear" };
    }
  }

  private parseAddItems(value: unknown): Array<{
    content: string;
    parentId: string | null;
    status?: PersaiRuntimeTodoWriteStatus;
  }> {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException("action.items must be a non-empty array.");
    }
    return value.map((entry, index) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new BadRequestException(`action.items[${index}] must be an object.`);
      }
      const row = entry as Record<string, unknown>;
      const content = this.asNonEmptyString(row.content, `action.items[${index}].content`);
      const parentId =
        row.parentId === undefined || row.parentId === null
          ? null
          : typeof row.parentId === "string"
            ? row.parentId.trim() || null
            : null;
      const status =
        row.status === undefined
          ? undefined
          : typeof row.status === "string" &&
              PERSAI_RUNTIME_TODO_WRITE_STATUSES.includes(
                row.status as PersaiRuntimeTodoWriteStatus
              )
            ? (row.status as PersaiRuntimeTodoWriteStatus)
            : (() => {
                throw new BadRequestException(
                  `action.items[${index}].status must be one of ${PERSAI_RUNTIME_TODO_WRITE_STATUSES.join(
                    ", "
                  )}.`
                );
              })();
      const item: {
        content: string;
        parentId: string | null;
        status?: PersaiRuntimeTodoWriteStatus;
      } = { content, parentId };
      if (status !== undefined) item.status = status;
      return item;
    });
  }

  private parseOptionalString(
    value: unknown,
    label: string,
    field: "content"
  ): Partial<Record<"content", string>> {
    if (value === undefined) return {};
    if (typeof value !== "string") {
      throw new BadRequestException(`${label} must be a string.`);
    }
    return { [field]: value } as Partial<Record<"content", string>>;
  }

  private parseOptionalStatus(
    value: unknown,
    label: string,
    field: "status"
  ): Partial<Record<"status", PersaiRuntimeTodoWriteStatus>> {
    if (value === undefined) return {};
    if (
      typeof value !== "string" ||
      !PERSAI_RUNTIME_TODO_WRITE_STATUSES.includes(value as PersaiRuntimeTodoWriteStatus)
    ) {
      throw new BadRequestException(
        `${label} must be one of ${PERSAI_RUNTIME_TODO_WRITE_STATUSES.join(", ")}.`
      );
    }
    return { [field]: value as PersaiRuntimeTodoWriteStatus };
  }

  private parseOptionalParentField(value: unknown): Partial<{ parentId: string | null }> {
    if (value === undefined) return {};
    if (value === null) return { parentId: null };
    if (typeof value !== "string") {
      throw new BadRequestException("action.parentId must be a string or null.");
    }
    const trimmed = value.trim();
    return { parentId: trimmed.length === 0 ? null : trimmed };
  }

  private asChannel(value: unknown): AssistantChatTodosChannel {
    if (value === "web" || value === "telegram") {
      return value;
    }
    throw new BadRequestException('channel must be "web" or "telegram".');
  }

  private asNonEmptyString(value: unknown, label: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(`${label} must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`${label} must be a non-empty string.`);
    }
    return trimmed;
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime chat-todos endpoints.",
      "Internal runtime chat-todos authorization failed."
    );
  }
}
