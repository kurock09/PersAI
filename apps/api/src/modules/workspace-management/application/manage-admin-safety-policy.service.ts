import { BadRequestException, Injectable } from "@nestjs/common";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { EvaluateInboundSafetyPrecheckService } from "./evaluate-inbound-safety-precheck.service";
import {
  SAFETY_HEURISTIC_RULE_REPOSITORY,
  SAFETY_POLICY_SETTINGS_REPOSITORY,
  type SafetyHeuristicRuleRepository,
  type SafetyHeuristicRuleUpsertInput,
  type SafetyPolicySettingsRepository,
  type SafetyPolicySettingsUpdateInput
} from "../domain/safety-policy.repository";
import type {
  SafetyHeuristicLocale,
  SafetyHeuristicPack,
  SafetyHeuristicPatternType,
  SafetyHeuristicRule,
  SafetyPolicySettings
} from "../domain/safety-policy.types";
import { Inject } from "@nestjs/common";

const PACKS = new Set<SafetyHeuristicPack>([
  "violence_extremism_explicit",
  "hack_abuse_request",
  "unsolicited_adult_spam",
  "structural_abuse_signal"
]);
const LOCALES = new Set<SafetyHeuristicLocale>(["any", "ru", "en"]);
const PATTERN_TYPES = new Set<SafetyHeuristicPatternType>(["literal", "regex"]);

@Injectable()
export class ManageAdminSafetyPolicyService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    @Inject(SAFETY_HEURISTIC_RULE_REPOSITORY)
    private readonly safetyHeuristicRuleRepository: SafetyHeuristicRuleRepository,
    @Inject(SAFETY_POLICY_SETTINGS_REPOSITORY)
    private readonly safetyPolicySettingsRepository: SafetyPolicySettingsRepository,
    private readonly evaluateInboundSafetyPrecheckService: EvaluateInboundSafetyPrecheckService
  ) {}

  async listHeuristicRules(
    actorUserId: string,
    filter?: { pack?: string; locale?: string; enabled?: string }
  ): Promise<SafetyHeuristicRule[]> {
    await this.adminAuthorizationService.assertCanManageAbuseControls(actorUserId);
    return this.safetyHeuristicRuleRepository.listRules({
      ...(filter?.pack !== undefined && PACKS.has(filter.pack as SafetyHeuristicPack)
        ? { pack: filter.pack as SafetyHeuristicPack }
        : {}),
      ...(filter?.locale !== undefined && LOCALES.has(filter.locale as SafetyHeuristicLocale)
        ? { locale: filter.locale as SafetyHeuristicLocale }
        : {}),
      ...(filter?.enabled === "true"
        ? { enabled: true }
        : filter?.enabled === "false"
          ? { enabled: false }
          : {})
    });
  }

  async replaceHeuristicRules(actorUserId: string, body: unknown): Promise<SafetyHeuristicRule[]> {
    await this.adminAuthorizationService.assertCanManageAbuseControls(actorUserId);
    const rules = this.parseHeuristicRulesBody(body);
    const saved = await this.safetyHeuristicRuleRepository.replaceAllRules(rules);
    await this.evaluateInboundSafetyPrecheckService.reloadPolicyCache();
    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId,
      eventCategory: "admin",
      eventCode: "admin.safety_policy_updated",
      summary: "Updated inbound safety heuristic rules.",
      details: {
        ruleCount: saved.length
      }
    });
    return saved;
  }

  async getSettings(actorUserId: string): Promise<SafetyPolicySettings> {
    await this.adminAuthorizationService.assertCanManageAbuseControls(actorUserId);
    return this.safetyPolicySettingsRepository.getSettings();
  }

  async updateSettings(actorUserId: string, body: unknown): Promise<SafetyPolicySettings> {
    await this.adminAuthorizationService.assertCanManageAbuseControls(actorUserId);
    const input = this.parseSettingsBody(body);
    const saved = await this.safetyPolicySettingsRepository.updateSettings(input);
    await this.evaluateInboundSafetyPrecheckService.reloadPolicyCache();
    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId,
      eventCategory: "admin",
      eventCode: "admin.safety_policy_updated",
      summary: "Updated inbound safety policy settings.",
      details: {
        syncHoldTimeoutMs: saved.syncHoldTimeoutMs,
        contour2Enabled: saved.contour2Enabled
      }
    });
    return saved;
  }

  private parseHeuristicRulesBody(body: unknown): SafetyHeuristicRuleUpsertInput[] {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const rules = (body as Record<string, unknown>).rules;
    if (!Array.isArray(rules)) {
      throw new BadRequestException("rules must be an array.");
    }
    return rules.map((entry, index) => this.parseHeuristicRule(entry, index));
  }

  private parseHeuristicRule(entry: unknown, index: number): SafetyHeuristicRuleUpsertInput {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new BadRequestException(`rules[${index}] must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.signalId !== "string" || row.signalId.trim().length === 0) {
      throw new BadRequestException(`rules[${index}].signalId is required.`);
    }
    if (typeof row.pack !== "string" || !PACKS.has(row.pack as SafetyHeuristicPack)) {
      throw new BadRequestException(`rules[${index}].pack is invalid.`);
    }
    const locale =
      row.locale === undefined
        ? "any"
        : typeof row.locale === "string" && LOCALES.has(row.locale as SafetyHeuristicLocale)
          ? (row.locale as SafetyHeuristicLocale)
          : (() => {
              throw new BadRequestException(`rules[${index}].locale is invalid.`);
            })();
    const patternType =
      row.patternType === undefined
        ? "literal"
        : typeof row.patternType === "string" &&
            PATTERN_TYPES.has(row.patternType as SafetyHeuristicPatternType)
          ? (row.patternType as SafetyHeuristicPatternType)
          : (() => {
              throw new BadRequestException(`rules[${index}].patternType is invalid.`);
            })();
    if (typeof row.pattern !== "string" || row.pattern.trim().length === 0) {
      throw new BadRequestException(`rules[${index}].pattern is required.`);
    }
    if (
      typeof row.weight !== "number" ||
      !Number.isInteger(row.weight) ||
      row.weight < 1 ||
      row.weight > 10
    ) {
      throw new BadRequestException(`rules[${index}].weight must be an integer from 1 to 10.`);
    }
    return {
      signalId: row.signalId.trim(),
      pack: row.pack as SafetyHeuristicPack,
      locale,
      patternType,
      pattern: row.pattern.trim(),
      weight: row.weight,
      enabled: row.enabled === undefined ? true : row.enabled === true
    };
  }

  private parseSettingsBody(body: unknown): SafetyPolicySettingsUpdateInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    if (
      typeof row.syncHoldTimeoutMs !== "number" ||
      !Number.isInteger(row.syncHoldTimeoutMs) ||
      row.syncHoldTimeoutMs < 0 ||
      row.syncHoldTimeoutMs > 10_000
    ) {
      throw new BadRequestException("syncHoldTimeoutMs must be an integer between 0 and 10000.");
    }
    if (typeof row.moderationModelId !== "string" || row.moderationModelId.trim().length === 0) {
      throw new BadRequestException("moderationModelId is required.");
    }
    if (typeof row.contour2Enabled !== "boolean") {
      throw new BadRequestException("contour2Enabled must be a boolean.");
    }
    const allowlistRaw = row.instantBlockPackAllowlist;
    if (!Array.isArray(allowlistRaw)) {
      throw new BadRequestException("instantBlockPackAllowlist must be an array.");
    }
    const instantBlockPackAllowlist = allowlistRaw.map((entry, index) => {
      if (typeof entry !== "string" || !PACKS.has(entry as SafetyHeuristicPack)) {
        throw new BadRequestException(`instantBlockPackAllowlist[${index}] is invalid.`);
      }
      return entry as SafetyHeuristicPack;
    });
    return {
      syncHoldTimeoutMs: row.syncHoldTimeoutMs,
      moderationModelId: row.moderationModelId.trim(),
      contour2Enabled: row.contour2Enabled,
      instantBlockPackAllowlist
    };
  }
}
