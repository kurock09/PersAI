import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";

const MAX_RUNTIME_OPEN_LOOP_REFS = 100;

export interface ListRuntimeOpenLoopRefsInput {
  assistantId: string;
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
    const requestId = this.asNullableString(row.requestId);
    const unknownKeys = Object.keys(row).filter(
      (key) => key !== "assistantId" && key !== "requestId"
    );
    if (assistantId === null || unknownKeys.length > 0) {
      throw new BadRequestException("open-loop-refs payload is invalid.");
    }
    return { assistantId, requestId };
  }

  async execute(input: ListRuntimeOpenLoopRefsInput): Promise<ListRuntimeOpenLoopRefsResult> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    const [rows, totalUnresolvedOpenLoops] = await Promise.all([
      this.assistantMemoryRegistryRepository.findLatestActiveOpenLoopsByAssistantUser(
        assistant.id,
        assistant.userId,
        MAX_RUNTIME_OPEN_LOOP_REFS
      ),
      this.assistantMemoryRegistryRepository.countActiveOpenLoopsByAssistantUser(
        assistant.id,
        assistant.userId
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
