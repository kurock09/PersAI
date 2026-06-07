import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AssistantMemoryRegistryItem } from "../domain/assistant-memory-registry-item.entity";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import { KnowledgeModelPolicyService } from "./knowledge-model-policy.service";

// Bound the working set so post-compaction consolidation stays cheap.
const MAX_CONSOLIDATION_ITEMS = 200;
// Keep each embeddings round-trip comfortably below provider batch ceilings.
const EMBEDDING_BATCH_SIZE = 100;
// Collapse only near-identical memories, not merely related ones.
const NEAR_DUPLICATE_COSINE_THRESHOLD = 0.92;
// Time-bound contextual memories decay after 45 days without a fresh touch.
const DECAY_TIME_BOUND_CONTEXTUAL_MS = 45 * 24 * 60 * 60 * 1000;

export type ConsolidationOutcome = {
  embedded: number;
  mergedSuperseded: number;
  prunedDecayed: number;
  durationMs: number;
};

@Injectable()
export class ConsolidateAssistantMemoryService {
  private readonly logger = new Logger(ConsolidateAssistantMemoryService.name);

  constructor(
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly memoryRepository: AssistantMemoryRegistryRepository,
    private readonly knowledgeModelPolicyService: KnowledgeModelPolicyService,
    private readonly knowledgeEmbeddingService: KnowledgeEmbeddingService
  ) {}

  async execute(params: {
    assistantId: string;
    workspaceId: string;
    requestId?: string | null;
  }): Promise<ConsolidationOutcome> {
    const startedAt = Date.now();
    const outcome: ConsolidationOutcome = {
      embedded: 0,
      mergedSuperseded: 0,
      prunedDecayed: 0,
      durationMs: 0
    };

    try {
      const memories = await this.loadActiveMemories(params.assistantId);
      if (memories.length === 0) {
        outcome.durationMs = Date.now() - startedAt;
        return outcome;
      }

      const currentEmbeddingModelKey = await this.resolveEmbeddingModelKey(params.assistantId);
      const embeddingStep = await this.refreshEmbeddings({
        assistantId: params.assistantId,
        currentEmbeddingModelKey,
        memories
      });
      outcome.embedded = embeddingStep.embedded;

      if (!embeddingStep.skipMerge) {
        outcome.mergedSuperseded = await this.mergeNearDuplicates({
          assistantId: params.assistantId,
          currentEmbeddingModelKey,
          memories
        });
      }

      outcome.prunedDecayed = await this.pruneDecayedMemories({
        assistantId: params.assistantId,
        memories
      });
    } catch (error) {
      this.logger.warn(
        `Assistant memory consolidation aborted for assistant ${params.assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    outcome.durationMs = Date.now() - startedAt;
    return outcome;
  }

  private async loadActiveMemories(assistantId: string): Promise<AssistantMemoryRegistryItem[]> {
    try {
      return await this.memoryRepository.listActiveForConsolidation(
        assistantId,
        MAX_CONSOLIDATION_ITEMS
      );
    } catch (error) {
      this.logger.warn(
        `Assistant memory consolidation could not load active memories for assistant ${assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  }

  private async resolveEmbeddingModelKey(assistantId: string): Promise<string | null> {
    try {
      return await this.knowledgeModelPolicyService.resolveAssistantEmbeddingModelKey(assistantId);
    } catch (error) {
      this.logger.warn(
        `Assistant memory consolidation could not resolve embedding model key for assistant ${assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async refreshEmbeddings(params: {
    assistantId: string;
    currentEmbeddingModelKey: string | null;
    memories: AssistantMemoryRegistryItem[];
  }): Promise<{ embedded: number; skipMerge: boolean }> {
    if (params.currentEmbeddingModelKey === null) {
      return { embedded: 0, skipMerge: true };
    }

    const candidates = params.memories.filter(
      (memory) =>
        memory.embeddingVector === null ||
        memory.embeddingModelKey !== params.currentEmbeddingModelKey
    );
    if (candidates.length === 0) {
      return { embedded: 0, skipMerge: false };
    }

    let embedded = 0;
    let anyReturnedEmbedding = false;

    for (let offset = 0; offset < candidates.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      let embeddings: Array<number[] | null> = batch.map(() => null);
      try {
        const result = await this.knowledgeEmbeddingService.generateEmbeddings({
          modelKey: params.currentEmbeddingModelKey,
          texts: batch.map((memory) => memory.summary)
        });
        embeddings = result.embeddings;
      } catch (error) {
        this.logger.warn(
          `Assistant memory consolidation embedding batch failed for assistant ${params.assistantId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      for (let index = 0; index < batch.length; index += 1) {
        const memory = batch[index];
        const embedding = embeddings[index] ?? null;
        if (memory === undefined || embedding === null) {
          continue;
        }
        anyReturnedEmbedding = true;
        try {
          const updated = await this.memoryRepository.updateEmbeddingById(
            memory.id,
            params.assistantId,
            embedding,
            params.currentEmbeddingModelKey
          );
          if (!updated) {
            continue;
          }
          memory.embeddingVector = embedding;
          memory.embeddingModelKey = params.currentEmbeddingModelKey;
          memory.embeddingGeneratedAt = new Date();
          embedded += 1;
        } catch (error) {
          this.logger.warn(
            `Assistant memory consolidation could not persist embedding for memory ${memory.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }

    return {
      embedded,
      skipMerge: !anyReturnedEmbedding
    };
  }

  private async mergeNearDuplicates(params: {
    assistantId: string;
    currentEmbeddingModelKey: string | null;
    memories: AssistantMemoryRegistryItem[];
  }): Promise<number> {
    if (params.currentEmbeddingModelKey === null) {
      return 0;
    }

    let mergedSuperseded = 0;
    const supersededIds = new Set<string>();
    const candidates = params.memories.filter(
      (memory) =>
        memory.embeddingVector !== null &&
        memory.embeddingModelKey === params.currentEmbeddingModelKey &&
        !isMergeProtectedOpenLoop(memory)
    );

    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      const left = candidates[leftIndex];
      if (left === undefined || supersededIds.has(left.id) || left.embeddingVector === null) {
        continue;
      }

      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const right = candidates[rightIndex];
        if (
          right === undefined ||
          supersededIds.has(right.id) ||
          right.embeddingVector === null ||
          left.kind !== right.kind
        ) {
          continue;
        }

        const similarity = cosineSimilarity(left.embeddingVector, right.embeddingVector);
        if (similarity < NEAR_DUPLICATE_COSINE_THRESHOLD) {
          continue;
        }

        const { survivor, loser } = chooseSurvivor(left, right);
        try {
          const updated = await this.memoryRepository.markSupersededById(
            loser.id,
            params.assistantId,
            survivor.id
          );
          if (!updated) {
            continue;
          }
          loser.supersededAt = new Date();
          loser.supersededByMemoryId = survivor.id;
          supersededIds.add(loser.id);
          mergedSuperseded += 1;
        } catch (error) {
          this.logger.warn(
            `Assistant memory consolidation could not supersede memory ${loser.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          continue;
        }

        if (loser.id === left.id) {
          break;
        }
      }
    }

    return mergedSuperseded;
  }

  private async pruneDecayedMemories(params: {
    assistantId: string;
    memories: AssistantMemoryRegistryItem[];
  }): Promise<number> {
    const now = Date.now();
    let prunedDecayed = 0;

    for (const memory of params.memories) {
      if (!shouldDecayPrune(memory, now)) {
        continue;
      }
      try {
        const updated = await this.memoryRepository.markForgottenById(
          memory.id,
          params.assistantId
        );
        if (!updated) {
          continue;
        }
        memory.forgottenAt = new Date();
        prunedDecayed += 1;
      } catch (error) {
        this.logger.warn(
          `Assistant memory consolidation could not prune memory ${memory.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return prunedDecayed;
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude <= 0 || rightMagnitude <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function chooseSurvivor(
  left: AssistantMemoryRegistryItem,
  right: AssistantMemoryRegistryItem
): {
  survivor: AssistantMemoryRegistryItem;
  loser: AssistantMemoryRegistryItem;
} {
  const comparison = compareMergePriority(left, right);
  return comparison <= 0 ? { survivor: right, loser: left } : { survivor: left, loser: right };
}

function compareMergePriority(
  left: AssistantMemoryRegistryItem,
  right: AssistantMemoryRegistryItem
): number {
  const classDelta = compareNumbers(memoryClassPriority(left), memoryClassPriority(right));
  if (classDelta !== 0) {
    return classDelta;
  }

  const confidenceDelta = compareNumbers(left.confidence ?? 0, right.confidence ?? 0);
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }

  const createdAtDelta = compareNumbers(left.createdAt.getTime(), right.createdAt.getTime());
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return right.id.localeCompare(left.id);
}

function compareNumbers(left: number, right: number): number {
  if (left === right) {
    return 0;
  }
  return left > right ? 1 : -1;
}

function memoryClassPriority(memory: AssistantMemoryRegistryItem): number {
  return memory.memoryClass === "core" ? 1 : 0;
}

function isMergeProtectedOpenLoop(memory: AssistantMemoryRegistryItem): boolean {
  return memory.kind === "open_loop" && memory.resolvedAt === null;
}

function shouldDecayPrune(memory: AssistantMemoryRegistryItem, nowMs: number): boolean {
  if (memory.memoryClass !== "contextual") {
    return false;
  }
  if (memory.durability === "identity" || memory.stability !== "time_bound") {
    return false;
  }
  if (memory.supersededAt !== null || memory.forgottenAt !== null) {
    return false;
  }
  if (isMergeProtectedOpenLoop(memory)) {
    return false;
  }
  const effectiveLastTouch = memory.lastUsedAt ?? memory.createdAt;
  return nowMs - effectiveLastTouch.getTime() > DECAY_TIME_BOUND_CONTEXTUAL_MS;
}
