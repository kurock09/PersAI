import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RuntimeSkillDecisionState } from "@persai/runtime-contract";
import type { AssistantChatSurface } from "../domain/assistant-chat.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { createAssistantInboundValidationError } from "./assistant-inbound-error";
import {
  lockAssistantRoleRows,
  lockRoleSkillRow,
  lockSkillRow
} from "./assistant-skill-mutation-locks";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RELEASE_CANDIDATE_ATTEMPTS = 3;
const RELEASE_CANDIDATE_CHANGED = Symbol("release_candidate_changed");

export type SkillStateInput = {
  assistantId: string;
  channel: string;
  surfaceThreadKey: string;
  action: "engage" | "release";
  expectedRoleId: string;
  skillId?: string | null;
  scenarioKey?: string | null;
};

export type SkillStateEngageResult = {
  action: "engaged";
  skillId: string;
  skillDisplayName: string;
  scenarioKey: string | null;
  scenarioDisplayName: string | null;
};

export type SkillStateReleaseResult = {
  action: "released";
  previousSkillId: string | null;
};

export type SkillStateStaleResult = {
  action: "stale";
  applied: false;
  code: "stale_assistant_role_snapshot";
  message: string;
};

export type SkillStateResult =
  | SkillStateEngageResult
  | SkillStateReleaseResult
  | SkillStateStaleResult;

type LockedAssistantSkillStateRow = {
  id: string;
  roleId: string;
};

type LockedAssistantChatSkillStateRow = {
  id: string;
  skillDecisionState: unknown;
  skillRetrievalState: unknown;
};

type LockedSkillStateRow = {
  id: string;
  name: unknown;
  status: "draft" | "active" | "archived";
  archivedAt: Date | null;
};

@Injectable()
export class InternalRuntimeSkillStateService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async apply(input: SkillStateInput): Promise<SkillStateResult> {
    const assistantId = this.requireUuid(
      input.assistantId,
      "runtime_skill_state_invalid_assistant_id",
      "assistantId must be a valid UUID."
    );
    const expectedRoleId = this.requireUuid(
      input.expectedRoleId,
      "runtime_skill_state_invalid_expected_role_id",
      "expectedRoleId must be a valid UUID."
    );
    const engageSkillId = input.action === "engage" ? input.skillId?.trim() || null : null;
    if (input.action === "engage" && engageSkillId === null) {
      throw new BadRequestException("skillId is required for engage action.");
    }
    if (engageSkillId !== null) {
      this.requireUuid(
        engageSkillId,
        "runtime_skill_state_invalid_skill_id",
        "skillId must be a valid UUID."
      );
    }
    const surface = this.resolveChannel(input.channel);
    if (surface === null) {
      throw new BadRequestException(`Unsupported channel: ${input.channel}`);
    }
    if (input.action === "engage") {
      const outcome = await this.applyWithCandidate({
        input,
        assistantId,
        expectedRoleId,
        surface,
        targetSkillId: engageSkillId,
        releaseCandidate: false
      });
      return outcome === RELEASE_CANDIDATE_CHANGED ? this.staleResult() : outcome;
    }

    for (let attempt = 1; attempt <= MAX_RELEASE_CANDIDATE_ATTEMPTS; attempt += 1) {
      const candidateChat = await this.prisma.assistantChat.findFirst({
        where: {
          assistantId,
          surface,
          surfaceThreadKey: input.surfaceThreadKey
        },
        select: { skillDecisionState: true }
      });
      if (candidateChat === null) {
        throw new NotFoundException(
          `Chat not found for assistant=${assistantId} channel=${input.channel} thread=${input.surfaceThreadKey}`
        );
      }
      const candidateState = this.normalizeDecisionState(candidateChat.skillDecisionState);
      const candidateSkillId =
        candidateState?.status === "active" ? candidateState.activeSkillId : null;
      if (candidateSkillId !== null && !UUID_PATTERN.test(candidateSkillId)) {
        return this.staleResult();
      }
      const outcome = await this.applyWithCandidate({
        input,
        assistantId,
        expectedRoleId,
        surface,
        targetSkillId: candidateSkillId,
        releaseCandidate: true
      });
      if (outcome !== RELEASE_CANDIDATE_CHANGED) {
        return outcome;
      }
    }
    return this.staleResult();
  }

  private async applyWithCandidate(params: {
    input: SkillStateInput;
    assistantId: string;
    expectedRoleId: string;
    surface: AssistantChatSurface;
    targetSkillId: string | null;
    releaseCandidate: boolean;
  }): Promise<SkillStateResult | typeof RELEASE_CANDIDATE_CHANGED> {
    return this.prisma.$transaction(async (tx) => {
      let skill: LockedSkillStateRow | null = null;
      if (params.targetSkillId !== null) {
        await lockSkillRow(tx, params.targetSkillId);
        skill = await tx.skill.findUnique({
          where: { id: params.targetSkillId },
          select: {
            id: true,
            name: true,
            status: true,
            archivedAt: true
          }
        });
        if (skill === null || skill.status !== "active" || skill.archivedAt !== null) {
          return this.staleResult();
        }
      }

      const lockedRoles = await lockAssistantRoleRows(tx, [params.expectedRoleId]);
      const expectedRole = lockedRoles[0];
      if (expectedRole === undefined || expectedRole.status !== "active") {
        return this.staleResult();
      }
      const assistantRows = await tx.$queryRaw<LockedAssistantSkillStateRow[]>(Prisma.sql`
        SELECT "id", "role_id" AS "roleId"
        FROM "assistants"
        WHERE "id" = ${params.assistantId}::uuid
        FOR UPDATE
      `);
      const assistant = assistantRows[0];
      if (assistant === undefined) {
        throw new NotFoundException(`Assistant not found: ${params.assistantId}`);
      }
      if (assistant.roleId !== params.expectedRoleId) {
        return this.staleResult();
      }

      const chatRows = await tx.$queryRaw<LockedAssistantChatSkillStateRow[]>(Prisma.sql`
        SELECT
          "id",
          "skill_decision_state" AS "skillDecisionState",
          "skill_retrieval_state" AS "skillRetrievalState"
        FROM "assistant_chats"
        WHERE "assistant_id" = ${params.assistantId}::uuid
          AND "surface" = ${params.surface}::"AssistantChatSurface"
          AND "surface_thread_key" = ${params.input.surfaceThreadKey}
        FOR UPDATE
      `);
      const chat = chatRows[0];
      if (chat === undefined) {
        throw new NotFoundException(
          `Chat not found for assistant=${params.assistantId} channel=${params.input.channel} thread=${params.input.surfaceThreadKey}`
        );
      }
      const currentState = this.normalizeDecisionState(chat.skillDecisionState);
      if (params.releaseCandidate) {
        const lockedSkillId = currentState?.status === "active" ? currentState.activeSkillId : null;
        if (lockedSkillId !== params.targetSkillId) {
          return RELEASE_CANDIDATE_CHANGED;
        }
      }

      if (params.targetSkillId !== null) {
        const roleSkillLinked = await lockRoleSkillRow(tx, assistant.roleId, params.targetSkillId);
        if (!roleSkillLinked) {
          return this.staleResult();
        }
      }

      if (params.input.action === "release") {
        const nextState: RuntimeSkillDecisionState = {
          status: "inactive",
          activeSkillId: null,
          activeSkillName: null,
          activeScenarioKey: null,
          activeScenarioDisplayName: null,
          topicSummary: currentState?.topicSummary ?? null
        };
        await tx.assistantChat.update({
          where: { id: chat.id },
          data: {
            skillDecisionState: nextState as unknown as Prisma.InputJsonValue,
            skillRetrievalState: Prisma.DbNull
          }
        });
        return { action: "released", previousSkillId: params.targetSkillId };
      }

      const skillId = params.targetSkillId as string;
      const scenarioKey = params.input.scenarioKey?.trim() || null;
      const scenario =
        scenarioKey === null
          ? null
          : await tx.skillScenario.findFirst({
              where: { skillId, key: scenarioKey },
              select: { displayName: true }
            });
      const skillDisplayName = this.resolveSkillDisplayName(skill?.name);
      const scenarioDisplayName =
        scenario === null ? null : this.resolveSkillDisplayName(scenario.displayName);
      const nextState: RuntimeSkillDecisionState = {
        status: "active",
        activeSkillId: skillId,
        activeSkillName: skillDisplayName,
        activeScenarioKey: scenarioKey,
        activeScenarioDisplayName: scenarioDisplayName,
        topicSummary: currentState?.topicSummary ?? null
      };
      const retrievalState = this.normalizeRetrievalActiveSkillId(chat.skillRetrievalState);
      await tx.assistantChat.update({
        where: { id: chat.id },
        data: {
          skillDecisionState: nextState as unknown as Prisma.InputJsonValue,
          ...(retrievalState !== null && retrievalState !== skillId
            ? { skillRetrievalState: Prisma.DbNull }
            : {})
        }
      });
      return {
        action: "engaged",
        skillId,
        skillDisplayName,
        scenarioKey,
        scenarioDisplayName
      };
    });
  }

  private staleResult(): SkillStateStaleResult {
    return {
      action: "stale",
      applied: false,
      code: "stale_assistant_role_snapshot",
      message:
        "Assistant role changed while this turn was running. Durable skill state was not persisted."
    };
  }

  private requireUuid(value: string, code: string, message: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) {
      throw createAssistantInboundValidationError(code, message);
    }
    return normalized;
  }

  private normalizeDecisionState(value: unknown): RuntimeSkillDecisionState | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const status = row.status === "active" || row.status === "inactive" ? row.status : null;
    if (status === null) {
      return null;
    }
    return {
      status,
      activeSkillId:
        status === "active" && typeof row.activeSkillId === "string" ? row.activeSkillId : null,
      activeSkillName:
        status === "active" && typeof row.activeSkillName === "string" ? row.activeSkillName : null,
      activeScenarioKey:
        status === "active" && typeof row.activeScenarioKey === "string"
          ? row.activeScenarioKey
          : null,
      activeScenarioDisplayName:
        status === "active" && typeof row.activeScenarioDisplayName === "string"
          ? row.activeScenarioDisplayName
          : null,
      topicSummary: typeof row.topicSummary === "string" ? row.topicSummary : null
    };
  }

  private normalizeRetrievalActiveSkillId(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const activeSkillId = (value as Record<string, unknown>).activeSkillId;
    return typeof activeSkillId === "string" && activeSkillId.length > 0 ? activeSkillId : null;
  }

  private resolveChannel(channel: string): AssistantChatSurface | null {
    if (channel === "web" || channel === "telegram") {
      return channel;
    }
    return null;
  }

  private resolveSkillDisplayName(name: unknown): string {
    if (typeof name === "string") {
      return name;
    }
    if (name !== null && typeof name === "object" && !Array.isArray(name)) {
      const localized = name as Record<string, unknown>;
      if (typeof localized.ru === "string" && localized.ru.trim().length > 0) {
        return localized.ru;
      }
      if (typeof localized.en === "string" && localized.en.trim().length > 0) {
        return localized.en;
      }
      const first = Object.values(localized).find(
        (value) => typeof value === "string" && (value as string).trim().length > 0
      );
      if (typeof first === "string") {
        return first;
      }
    }
    return "Skill";
  }
}
