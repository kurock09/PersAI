import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONTENT_CHARS = 64_000;
const EVENT_KINDS = new Set([
  "stable_snapshot",
  "conversation",
  "assistant_tool_call",
  "tool_result",
  "catalog_describe",
  "context_revision"
]);
const EVENT_ROLES = new Set(["system", "developer", "user", "assistant", "tool"]);

export type DeepSeekAppendTraceEvent = {
  ordinal: number;
  sourceKey: string;
  kind: string;
  role: string;
  contentText: string | null;
  contentJson: unknown | null;
  stateKey: string | null;
  revision: number | null;
  supersedes: string | null;
};

type TraceState = {
  activeEpoch: number;
  nextOrdinal: number;
  configHash: string;
  events: DeepSeekAppendTraceEvent[];
};

@Injectable()
export class DeepSeekChatAppendTraceService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  parseRead(payload: unknown): { assistantChatId: string } {
    return { assistantChatId: this.parseChatId(payload, ["assistantChatId"]) };
  }

  parseAppend(payload: unknown): {
    assistantChatId: string;
    epoch: number;
    expectedOrdinal: number;
    events: DeepSeekAppendTraceEvent[];
  } {
    const row = this.object(payload, ["assistantChatId", "epoch", "expectedOrdinal", "events"]);
    const events = this.parseEvents(row.events);
    return {
      assistantChatId: this.parseUuid(row.assistantChatId, "assistantChatId"),
      epoch: this.nonNegativeInteger(row.epoch, "epoch", false),
      expectedOrdinal: this.nonNegativeInteger(row.expectedOrdinal, "expectedOrdinal", true),
      events
    };
  }

  parseReset(payload: unknown): {
    assistantChatId: string;
    expectedEpoch: number;
    configHash: string;
    seedEvents: DeepSeekAppendTraceEvent[];
  } {
    const row = this.object(payload, [
      "assistantChatId",
      "expectedEpoch",
      "configHash",
      "seedEvents"
    ]);
    return {
      assistantChatId: this.parseUuid(row.assistantChatId, "assistantChatId"),
      expectedEpoch: this.nonNegativeInteger(row.expectedEpoch, "expectedEpoch", true),
      configHash: this.boundedString(row.configHash, "configHash", 64, true),
      seedEvents: this.parseEvents(row.seedEvents)
    };
  }

  parseClear(payload: unknown): { assistantChatId: string; expectedEpoch: number } {
    const row = this.object(payload, ["assistantChatId", "expectedEpoch"]);
    return {
      assistantChatId: this.parseUuid(row.assistantChatId, "assistantChatId"),
      expectedEpoch: this.nonNegativeInteger(row.expectedEpoch, "expectedEpoch", true)
    };
  }

  async read(input: { assistantChatId: string }): Promise<TraceState | null> {
    const trace = await this.prisma.deepSeekChatAppendTrace.findUnique({
      where: { chatId: input.assistantChatId },
      include: { events: { orderBy: { ordinal: "asc" } } }
    });
    return trace === null ? null : this.toState(trace);
  }

  async append(input: {
    assistantChatId: string;
    epoch: number;
    expectedOrdinal: number;
    events: DeepSeekAppendTraceEvent[];
  }): Promise<TraceState> {
    return this.prisma.$transaction(
      async (tx) => {
        const trace = await this.lockOrCreate(tx, input.assistantChatId);
        if (trace.activeEpoch !== input.epoch)
          throw new ConflictException("DeepSeek trace epoch changed.");

        const existing = await tx.deepSeekChatAppendTraceEvent.findMany({
          where: {
            chatId: input.assistantChatId,
            epoch: input.epoch,
            sourceKey: { in: input.events.map((event) => event.sourceKey) }
          },
          orderBy: { ordinal: "asc" }
        });
        if (existing.length > 0) {
          if (existing.length !== input.events.length) {
            throw new ConflictException("DeepSeek trace append idempotency keys conflict.");
          }
          const persistedBySourceKey = new Map(existing.map((event) => [event.sourceKey, event]));
          const replayMatches = input.events.every((event) =>
            this.isExactIdempotentReplay(persistedBySourceKey.get(event.sourceKey), event)
          );
          if (!replayMatches) {
            throw new ConflictException("DeepSeek trace append idempotency payload conflicts.");
          }
          return this.readLocked(tx, input.assistantChatId);
        }
        if (trace.nextOrdinal !== input.expectedOrdinal) {
          throw new ConflictException("DeepSeek trace ordinal changed.");
        }
        await tx.deepSeekChatAppendTraceEvent.createMany({
          data: input.events.map((event, index) => ({
            chatId: input.assistantChatId,
            epoch: input.epoch,
            ordinal: input.expectedOrdinal + index,
            sourceKey: event.sourceKey,
            kind: event.kind,
            role: event.role,
            contentText: event.contentText,
            contentJson:
              event.contentJson === null
                ? Prisma.DbNull
                : (event.contentJson as Prisma.InputJsonValue),
            stateKey: event.stateKey,
            revision: event.revision,
            supersedes: event.supersedes
          }))
        });
        await tx.deepSeekChatAppendTrace.update({
          where: { chatId: input.assistantChatId },
          data: { nextOrdinal: input.expectedOrdinal + input.events.length }
        });
        return this.readLocked(tx, input.assistantChatId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async reset(input: {
    assistantChatId: string;
    expectedEpoch: number;
    configHash: string;
    seedEvents: DeepSeekAppendTraceEvent[];
  }): Promise<TraceState> {
    return this.prisma.$transaction(
      async (tx) => {
        const trace = await this.lockOrCreate(tx, input.assistantChatId);
        if (trace.activeEpoch !== input.expectedEpoch)
          throw new ConflictException("DeepSeek trace epoch changed.");
        const nextEpoch = trace.activeEpoch + 1;
        await tx.deepSeekChatAppendTraceEvent.deleteMany({
          where: { chatId: input.assistantChatId }
        });
        await tx.deepSeekChatAppendTrace.update({
          where: { chatId: input.assistantChatId },
          data: {
            activeEpoch: nextEpoch,
            nextOrdinal: input.seedEvents.length,
            configHash: input.configHash
          }
        });
        if (input.seedEvents.length > 0) {
          await tx.deepSeekChatAppendTraceEvent.createMany({
            data: input.seedEvents.map((event, ordinal) => ({
              chatId: input.assistantChatId,
              epoch: nextEpoch,
              ordinal,
              sourceKey: event.sourceKey,
              kind: event.kind,
              role: event.role,
              contentText: event.contentText,
              contentJson:
                event.contentJson === null
                  ? Prisma.DbNull
                  : (event.contentJson as Prisma.InputJsonValue),
              stateKey: event.stateKey,
              revision: event.revision,
              supersedes: event.supersedes
            }))
          });
        }
        return this.readLocked(tx, input.assistantChatId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async clear(input: { assistantChatId: string; expectedEpoch: number }): Promise<TraceState> {
    return this.reset({ ...input, configHash: "", seedEvents: [] });
  }

  private async lockOrCreate(tx: Prisma.TransactionClient, chatId: string) {
    const chat = await tx.assistantChat.findUnique({ where: { id: chatId }, select: { id: true } });
    if (chat === null) throw new NotFoundException("Assistant chat not found.");
    await tx.$queryRaw`SELECT "id" FROM "assistant_chats" WHERE "id" = ${chatId}::uuid FOR UPDATE`;
    return tx.deepSeekChatAppendTrace.upsert({
      where: { chatId },
      create: { chatId },
      update: {}
    });
  }

  private async readLocked(tx: Prisma.TransactionClient, chatId: string): Promise<TraceState> {
    const trace = await tx.deepSeekChatAppendTrace.findUniqueOrThrow({
      where: { chatId },
      include: { events: { orderBy: { ordinal: "asc" } } }
    });
    return this.toState(trace);
  }

  private toState(trace: {
    activeEpoch: number;
    nextOrdinal: number;
    configHash: string;
    events: Array<
      Omit<DeepSeekAppendTraceEvent, "contentJson"> & { contentJson: Prisma.JsonValue | null }
    >;
  }): TraceState {
    return {
      activeEpoch: trace.activeEpoch,
      nextOrdinal: trace.nextOrdinal,
      configHash: trace.configHash,
      events: trace.events.map((event) => ({ ...event, contentJson: event.contentJson }))
    };
  }

  private isExactIdempotentReplay(
    persisted:
      | (Omit<DeepSeekAppendTraceEvent, "contentJson"> & {
          contentJson: Prisma.JsonValue | null;
        })
      | undefined,
    submitted: DeepSeekAppendTraceEvent
  ): boolean {
    return (
      persisted !== undefined &&
      persisted.sourceKey === submitted.sourceKey &&
      persisted.kind === submitted.kind &&
      persisted.role === submitted.role &&
      persisted.contentText === submitted.contentText &&
      this.jsonSemanticallyEqual(persisted.contentJson, submitted.contentJson) &&
      persisted.stateKey === submitted.stateKey &&
      persisted.revision === submitted.revision &&
      persisted.supersedes === submitted.supersedes
    );
  }

  private jsonSemanticallyEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(this.normalizeJson(left)) === JSON.stringify(this.normalizeJson(right));
  }

  private normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.normalizeJson(entry));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, this.normalizeJson(entry)])
      );
    }
    return value;
  }

  private parseEvents(value: unknown): DeepSeekAppendTraceEvent[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
      throw new BadRequestException("DeepSeek trace events are invalid.");
    }
    const sourceKeys = new Set<string>();
    return value.map((entry) => {
      const row = this.object(entry, [
        "sourceKey",
        "kind",
        "role",
        "contentText",
        "contentJson",
        "stateKey",
        "revision",
        "supersedes"
      ]);
      const sourceKey = this.boundedString(row.sourceKey, "sourceKey", 256, true);
      if (sourceKeys.has(sourceKey))
        throw new BadRequestException("DeepSeek trace source keys must be unique.");
      sourceKeys.add(sourceKey);
      const kind = this.boundedString(row.kind, "kind", 64, true);
      const role = this.boundedString(row.role, "role", 32, true);
      if (!EVENT_KINDS.has(kind) || !EVENT_ROLES.has(role)) {
        throw new BadRequestException("DeepSeek trace event kind or role is invalid.");
      }
      const contentText =
        row.contentText === null
          ? null
          : this.boundedString(row.contentText, "contentText", MAX_CONTENT_CHARS, false);
      const contentJson = row.contentJson ?? null;
      if (contentText === null && contentJson === null)
        throw new BadRequestException("DeepSeek trace event content is required.");
      if (contentJson !== null && JSON.stringify(contentJson).length > MAX_CONTENT_CHARS) {
        throw new BadRequestException("DeepSeek trace event JSON is too large.");
      }
      return {
        ordinal: 0,
        sourceKey,
        kind,
        role,
        contentText,
        contentJson,
        stateKey:
          row.stateKey === null ? null : this.boundedString(row.stateKey, "stateKey", 256, false),
        revision:
          row.revision === null ? null : this.nonNegativeInteger(row.revision, "revision", true),
        supersedes:
          row.supersedes === null
            ? null
            : this.boundedString(row.supersedes, "supersedes", 256, false)
      };
    });
  }

  private parseChatId(payload: unknown, keys: string[]): string {
    return this.parseUuid(this.object(payload, keys).assistantChatId, "assistantChatId");
  }

  private object(value: unknown, allowed: string[]): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new BadRequestException("DeepSeek trace payload is invalid.");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !allowed.includes(key)))
      throw new BadRequestException("DeepSeek trace payload is invalid.");
    return row;
  }

  private parseUuid(value: unknown, field: string): string {
    if (typeof value !== "string" || !UUID_RE.test(value))
      throw new BadRequestException(`DeepSeek trace ${field} is invalid.`);
    return value;
  }

  private nonNegativeInteger(value: unknown, field: string, allowZero: boolean): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < (allowZero ? 0 : 1))
      throw new BadRequestException(`DeepSeek trace ${field} is invalid.`);
    return value;
  }

  private boundedString(value: unknown, field: string, max: number, nonEmpty: boolean): string {
    if (typeof value !== "string" || value.length > max || (nonEmpty && value.length === 0))
      throw new BadRequestException(`DeepSeek trace ${field} is invalid.`);
    return value;
  }
}
