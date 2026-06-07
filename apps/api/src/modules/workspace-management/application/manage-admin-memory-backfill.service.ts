import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { isObviouslyNonDurableMemorySummary } from "./memory-summary.util";
import type {
  AssistantMemoryRegistryDurability,
  AssistantMemoryRegistryItem,
  AssistantMemoryRegistryStability
} from "../domain/assistant-memory-registry-item.entity";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";

const MAX_BACKFILL_SCAN = 1000;
const SAMPLE_LIMIT = 20;

export type ManageAdminMemoryBackfillInput = {
  assistantId: string;
};

export type MemoryBackfillImpact = {
  assistantId: string;
  scannedActive: number;
  reclassifyCoreToContextual: {
    count: number;
    sample: Array<{
      id: string;
      summary: string;
      durability: AssistantMemoryRegistryDurability | null;
      stability: AssistantMemoryRegistryStability | null;
    }>;
  };
  pruneTrivialWebChat: {
    count: number;
    sample: Array<{
      id: string;
      summary: string;
    }>;
  };
};

export type MemoryBackfillResult = {
  assistantId: string;
  reclassified: number;
  pruned: number;
  scannedActive: number;
};

type MemoryBackfillAnalysis = {
  scannedActive: number;
  reclassifyCandidates: AssistantMemoryRegistryItem[];
  pruneCandidates: AssistantMemoryRegistryItem[];
};

@Injectable()
export class ManageAdminMemoryBackfillService {
  constructor(
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly assistantMemoryRegistryRepository: Pick<
      AssistantMemoryRegistryRepository,
      "listActiveForBackfill" | "reclassifyMemoryClassById" | "markForgottenById"
    >,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseInput(body: unknown): ManageAdminMemoryBackfillInput {
    try {
      return parseMemoryBackfillInput(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid memory backfill request."
      );
    }
  }

  async preview(
    userId: string,
    input: ManageAdminMemoryBackfillInput
  ): Promise<MemoryBackfillImpact> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const analysis = await this.computeAnalysis(input.assistantId);
    return {
      assistantId: input.assistantId,
      scannedActive: analysis.scannedActive,
      reclassifyCoreToContextual: {
        count: analysis.reclassifyCandidates.length,
        sample: analysis.reclassifyCandidates.slice(0, SAMPLE_LIMIT).map((row) => ({
          id: row.id,
          summary: row.summary,
          durability: row.durability,
          stability: row.stability
        }))
      },
      pruneTrivialWebChat: {
        count: analysis.pruneCandidates.length,
        sample: analysis.pruneCandidates.slice(0, SAMPLE_LIMIT).map((row) => ({
          id: row.id,
          summary: row.summary
        }))
      }
    };
  }

  async apply(
    userId: string,
    input: ManageAdminMemoryBackfillInput,
    stepUpToken: string | null
  ): Promise<MemoryBackfillResult> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.memory_backfill.apply",
      stepUpToken
    );
    const analysis = await this.computeAnalysis(input.assistantId);

    let pruned = 0;
    for (const row of analysis.pruneCandidates) {
      if (
        await this.assistantMemoryRegistryRepository.markForgottenById(row.id, input.assistantId)
      ) {
        pruned += 1;
      }
    }

    let reclassified = 0;
    for (const row of analysis.reclassifyCandidates) {
      if (
        await this.assistantMemoryRegistryRepository.reclassifyMemoryClassById(
          row.id,
          input.assistantId,
          "contextual"
        )
      ) {
        reclassified += 1;
      }
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId:
        analysis.pruneCandidates[0]?.workspaceId ??
        analysis.reclassifyCandidates[0]?.workspaceId ??
        null,
      assistantId: input.assistantId,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.memory_backfill.apply",
      summary: "Admin applied safe assistant memory backfill.",
      details: {
        assistantId: input.assistantId,
        reclassified,
        pruned,
        scannedActive: analysis.scannedActive
      }
    });

    return {
      assistantId: input.assistantId,
      reclassified,
      pruned,
      scannedActive: analysis.scannedActive
    };
  }

  private async computeAnalysis(assistantId: string): Promise<MemoryBackfillAnalysis> {
    const rows = await this.assistantMemoryRegistryRepository.listActiveForBackfill(
      assistantId,
      MAX_BACKFILL_SCAN
    );
    const pruneCandidates: AssistantMemoryRegistryItem[] = [];
    const reclassifyCandidates: AssistantMemoryRegistryItem[] = [];
    for (const row of rows) {
      if (this.shouldPruneTrivialWebChat(row)) {
        pruneCandidates.push(row);
        continue;
      }
      if (this.shouldReclassifyLegacyCore(row)) {
        reclassifyCandidates.push(row);
      }
    }
    return {
      scannedActive: rows.length,
      pruneCandidates,
      reclassifyCandidates
    };
  }

  private shouldReclassifyLegacyCore(row: AssistantMemoryRegistryItem): boolean {
    return (
      row.memoryClass === "core" && !(row.durability === "identity" && row.stability === "stable")
    );
  }

  private shouldPruneTrivialWebChat(row: AssistantMemoryRegistryItem): boolean {
    return row.sourceType === "web_chat" && isObviouslyNonDurableMemorySummary(row.summary);
  }
}

export function parseMemoryBackfillInput(body: unknown): ManageAdminMemoryBackfillInput {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object.");
  }
  const assistantIdValue = (body as Record<string, unknown>).assistantId;
  if (typeof assistantIdValue !== "string" || assistantIdValue.trim().length === 0) {
    throw new Error("assistantId is required.");
  }
  return {
    assistantId: assistantIdValue.trim()
  };
}
