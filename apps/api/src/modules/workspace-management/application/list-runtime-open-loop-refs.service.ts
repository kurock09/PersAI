import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";

const MAX_RUNTIME_OPEN_LOOP_REFS = 100;

export interface ListRuntimeOpenLoopRefsInput {
  assistantId: string;
  /** ADR-120 Slice 2 — current canonical chat id; refs are scoped to it. */
  chatId: string | null;
  requestId: string | null;
}

export interface RuntimeOpenLoopRefRow {
  id: string;
  summary: string;
  createdAt: string;
}

export interface ListRuntimeOpenLoopRefsResult {
  unresolvedOpenLoops: RuntimeOpenLoopRefRow[];
  totalUnresolvedOpenLoops: number;
}

@Injectable()
export class ListRuntimeOpenLoopRefsService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly assistantMemoryRegistryRepository: AssistantMemoryRegistryRepository
  ) {}

  parseInput(payload: unknown): ListRuntimeOpenLoopRefsInput {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("open-loop-refs payload must be an object.");
    }
    const row = payload as Record<string, unknown>;
    const assistantId = this.asNonEmptyString(row.assistantId);
    const chatId = this.asNullableString(row.chatId);
    const requestId = this.asNullableString(row.requestId);
    const unknownKeys = Object.keys(row).filter(
      (key) => key !== "assistantId" && key !== "chatId" && key !== "requestId"
    );
    if (assistantId === null || unknownKeys.length > 0) {
      throw new BadRequestException("open-loop-refs payload is invalid.");
    }
    return { assistantId, chatId, requestId };
  }

  async execute(input: ListRuntimeOpenLoopRefsInput): Promise<ListRuntimeOpenLoopRefsResult> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    // ADR-120 Slice 2 — without a current chat to scope to, there are no
    // in-chat open loops to surface. Return empty instead of an assistant-wide
    // list so a loop from another chat can never enter the current prompt.
    if (input.chatId === null) {
      return {
        unresolvedOpenLoops: [],
        totalUnresolvedOpenLoops: 0
      };
    }
    const [rows, totalUnresolvedOpenLoops] = await Promise.all([
      this.assistantMemoryRegistryRepository.findLatestActiveOpenLoopsByAssistantUserChat(
        assistant.id,
        assistant.userId,
        input.chatId,
        MAX_RUNTIME_OPEN_LOOP_REFS
      ),
      this.assistantMemoryRegistryRepository.countActiveOpenLoopsByAssistantUserChat(
        assistant.id,
        assistant.userId,
        input.chatId
      )
    ]);
    return {
      unresolvedOpenLoops: rows.map((row) => ({
        id: row.id,
        summary: row.summary,
        createdAt: row.createdAt.toISOString()
      })),
      totalUnresolvedOpenLoops
    };
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asNullableString(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return this.asNonEmptyString(value);
  }
}
