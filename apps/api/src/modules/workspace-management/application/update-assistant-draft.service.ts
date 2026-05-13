import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type UpdateAssistantDraftInput
} from "../domain/assistant.repository";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import {
  applyAssistantGenderVoiceDefaults,
  normalizeAssistantVoiceProfile,
  parseAssistantVoiceProfileInput
} from "./assistant-voice-profile";
import {
  normalizeAssistantGender,
  VALID_ASSISTANT_GENDERS,
  type AssistantGender
} from "./assistant-gender";
import type { RuntimeAssistantVoiceProfile } from "@persai/runtime-contract";

export interface UpdateAssistantDraftRequest {
  displayName?: string | null;
  instructions?: string | null;
  traits?: Record<string, number> | null;
  avatarEmoji?: string | null;
  avatarUrl?: string | null;
  assistantGender?: string | null;
  voiceProfile?: RuntimeAssistantVoiceProfile | null;
  archetypeKey?: string | null;
}

const DRAFT_FIELD_MAX_LENGTHS: Record<string, number> = {
  displayName: 100,
  instructions: 50_000,
  avatarUrl: 2048,
  avatarEmoji: 8,
  archetypeKey: 64
};

function normalizeOptionalDraftField(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string, null, or omitted.`);
  }

  const trimmed = value.trim();
  const maxLen = DRAFT_FIELD_MAX_LENGTHS[fieldName];
  if (maxLen !== undefined && trimmed.length > maxLen) {
    throw new BadRequestException(
      `${fieldName} must be at most ${maxLen} characters (got ${trimmed.length}).`
    );
  }

  return trimmed;
}

const CONTENT_ADDRESSED_AVATAR_URL_PATTERN = /^\/api\/avatar\/[a-f0-9]{8,64}(?:\.[a-z0-9]{2,8})?$/i;
const STATIC_PRESET_AVATAR_URL_PATTERN = /^\/avatar-presets\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp)$/i;

/**
 * ADR-076 Slice 4 — assistant avatars are stored content-addressed under
 * `/api/avatar/<hash>.<ext>` and that path is what surfaces in lifecycle
 * state. Any draft mutation that round-trips this URL (assistant settings
 * "Save", setup wizard "Create" after upload) PATCHes the same value back,
 * so the validator must accept it. Legacy callers that still supply absolute
 * URLs continue to require https:// for defense in depth.
 */
function validateAvatarUrl(url: string): void {
  if (
    CONTENT_ADDRESSED_AVATAR_URL_PATTERN.test(url) ||
    STATIC_PRESET_AVATAR_URL_PATTERN.test(url)
  ) {
    return;
  }
  if (!url.startsWith("https://")) {
    throw new BadRequestException(
      "avatarUrl must be a server-issued /api/avatar/<hash>.<ext> path, a /avatar-presets/<name> asset, or use the https:// scheme."
    );
  }
  try {
    new URL(url);
  } catch {
    throw new BadRequestException("avatarUrl must be a valid URL.");
  }
}

@Injectable()
export class UpdateAssistantDraftService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseInput(payload: unknown): UpdateAssistantDraftRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Draft payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const displayName = normalizeOptionalDraftField(body.displayName, "displayName");
    const instructions = normalizeOptionalDraftField(body.instructions, "instructions");
    const avatarEmoji = normalizeOptionalDraftField(body.avatarEmoji, "avatarEmoji");
    const avatarUrl = normalizeOptionalDraftField(body.avatarUrl, "avatarUrl");
    if (typeof avatarUrl === "string") {
      validateAvatarUrl(avatarUrl);
    }
    const assistantGender = this.parseOptionalAssistantGender(body.assistantGender);
    const voiceProfile = this.parseOptionalVoiceProfile(body.voiceProfile);
    const traits = this.parseOptionalTraits(body.traits);
    const archetypeKey = normalizeOptionalDraftField(body.archetypeKey, "archetypeKey");

    if (
      displayName === undefined &&
      instructions === undefined &&
      traits === undefined &&
      avatarEmoji === undefined &&
      avatarUrl === undefined &&
      assistantGender === undefined &&
      voiceProfile === undefined &&
      archetypeKey === undefined
    ) {
      throw new BadRequestException("At least one draft field must be provided.");
    }

    return {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(traits !== undefined ? { traits } : {}),
      ...(avatarEmoji !== undefined ? { avatarEmoji } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(assistantGender !== undefined ? { assistantGender } : {}),
      ...(voiceProfile !== undefined ? { voiceProfile } : {}),
      ...(archetypeKey !== undefined ? { archetypeKey } : {})
    };
  }

  async execute(
    userId: string,
    request: UpdateAssistantDraftRequest
  ): Promise<AssistantLifecycleState> {
    const existingAssistant = await this.assistantRepository.findByUserId(userId);
    if (existingAssistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const nextAssistantGender = normalizeAssistantGender(
      request.assistantGender === undefined
        ? existingAssistant.draftAssistantGender
        : request.assistantGender
    );
    const nextVoiceProfile =
      request.voiceProfile !== undefined || request.assistantGender !== undefined
        ? applyAssistantGenderVoiceDefaults({
            assistantGender: nextAssistantGender,
            voiceProfile: normalizeAssistantVoiceProfile(
              request.voiceProfile === undefined
                ? existingAssistant.draftVoiceProfile
                : request.voiceProfile
            )
          })
        : undefined;

    const nextDraft: UpdateAssistantDraftInput = {
      draftDisplayName:
        request.displayName === undefined
          ? existingAssistant.draftDisplayName
          : request.displayName,
      draftInstructions:
        request.instructions === undefined
          ? existingAssistant.draftInstructions
          : request.instructions,
      ...(request.traits !== undefined ? { draftTraits: request.traits } : {}),
      ...(request.avatarEmoji !== undefined ? { draftAvatarEmoji: request.avatarEmoji } : {}),
      ...(request.avatarUrl !== undefined ? { draftAvatarUrl: request.avatarUrl } : {}),
      ...(request.assistantGender !== undefined
        ? { draftAssistantGender: request.assistantGender }
        : {}),
      ...(nextVoiceProfile !== undefined ? { draftVoiceProfile: nextVoiceProfile } : {}),
      ...(request.archetypeKey !== undefined ? { draftArchetypeKey: request.archetypeKey } : {})
    };

    const updatedAssistant = await this.assistantRepository.updateDraft(userId, nextDraft);
    if (updatedAssistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(updatedAssistant.id);
    const governance = await this.assistantGovernanceRepository.findByAssistantId(
      updatedAssistant.id
    );
    const materialization = await this.assistantMaterializedSpecRepository.findLatestByAssistantId(
      updatedAssistant.id
    );
    await this.appendAssistantAuditEventService.execute({
      workspaceId: updatedAssistant.workspaceId,
      assistantId: updatedAssistant.id,
      actorUserId: userId,
      eventCategory: "assistant_lifecycle",
      eventCode: "assistant.draft_updated",
      summary: "Assistant draft updated.",
      details: {
        changedFields: {
          displayName: existingAssistant.draftDisplayName !== updatedAssistant.draftDisplayName,
          instructions: existingAssistant.draftInstructions !== updatedAssistant.draftInstructions,
          voiceProfile:
            JSON.stringify(existingAssistant.draftVoiceProfile) !==
            JSON.stringify(updatedAssistant.draftVoiceProfile)
        }
      }
    });

    return toAssistantLifecycleState(
      updatedAssistant,
      latestPublishedVersion,
      governance,
      materialization
    );
  }

  private parseOptionalTraits(value: unknown): Record<string, number> | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("traits must be an object mapping trait names to numbers.");
    }
    const traits = value as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [key, val] of Object.entries(traits)) {
      if (typeof val !== "number" || val < 0 || val > 100) {
        throw new BadRequestException(`traits.${key} must be a number between 0 and 100.`);
      }
      result[key] = val;
    }
    return result;
  }

  private parseOptionalAssistantGender(value: unknown): AssistantGender | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "string") {
      throw new BadRequestException("assistantGender must be a string, null, or omitted.");
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new BadRequestException(
        "assistantGender must be a non-empty string, null, or omitted."
      );
    }
    if (!VALID_ASSISTANT_GENDERS.includes(normalized as AssistantGender)) {
      throw new BadRequestException("assistantGender must be one of male, female, or neutral.");
    }
    return normalized as AssistantGender;
  }

  private parseOptionalVoiceProfile(
    value: unknown
  ): RuntimeAssistantVoiceProfile | null | undefined {
    const parsed = parseAssistantVoiceProfileInput(value);
    if (parsed instanceof Error) {
      throw new BadRequestException(parsed.message);
    }
    return parsed;
  }
}
