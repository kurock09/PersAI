import { Injectable } from "@nestjs/common";
import type {
  SafetyHeuristicLocale as PrismaSafetyHeuristicLocale,
  SafetyHeuristicPack as PrismaSafetyHeuristicPack,
  SafetyHeuristicPatternType as PrismaSafetyHeuristicPatternType,
  SafetyHeuristicRule as PrismaSafetyHeuristicRule,
  SafetyPolicySettings as PrismaSafetyPolicySettings
} from "@prisma/client";
import type {
  SafetyHeuristicRuleRepository,
  SafetyHeuristicRuleUpsertInput,
  SafetyPolicySettingsRepository,
  SafetyPolicySettingsUpdateInput
} from "../../domain/safety-policy.repository";
import type {
  SafetyHeuristicLocale,
  SafetyHeuristicPack,
  SafetyHeuristicPatternType,
  SafetyHeuristicRule,
  SafetyPolicySettings
} from "../../domain/safety-policy.types";
import { SAFETY_POLICY_SETTINGS_ID } from "../../domain/safety-policy.types";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

function mapPack(value: PrismaSafetyHeuristicPack): SafetyHeuristicPack {
  return value;
}

function mapLocale(value: PrismaSafetyHeuristicLocale): SafetyHeuristicLocale {
  return value;
}

function mapPatternType(value: PrismaSafetyHeuristicPatternType): SafetyHeuristicPatternType {
  return value;
}

function mapRule(row: PrismaSafetyHeuristicRule): SafetyHeuristicRule {
  return {
    id: row.id,
    signalId: row.signalId,
    pack: mapPack(row.pack),
    locale: mapLocale(row.locale),
    patternType: mapPatternType(row.patternType),
    pattern: row.pattern,
    weight: row.weight,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parsePackAllowlist(value: unknown): SafetyHeuristicPack[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<SafetyHeuristicPack>([
    "violence_extremism_explicit",
    "hack_abuse_request",
    "unsolicited_adult_spam",
    "structural_abuse_signal"
  ]);
  return value.filter(
    (entry): entry is SafetyHeuristicPack =>
      typeof entry === "string" && allowed.has(entry as SafetyHeuristicPack)
  );
}

function mapSettings(row: PrismaSafetyPolicySettings): SafetyPolicySettings {
  return {
    id: row.id,
    syncHoldTimeoutMs: row.syncHoldTimeoutMs,
    instantBlockPackAllowlist: parsePackAllowlist(row.instantBlockPackAllowlist),
    moderationModelId: row.moderationModelId,
    contour2Enabled: row.contour2Enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

@Injectable()
export class PrismaSafetyHeuristicRuleRepository implements SafetyHeuristicRuleRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async listEnabledRules(): Promise<SafetyHeuristicRule[]> {
    const rows = await this.prisma.safetyHeuristicRule.findMany({
      where: { enabled: true },
      orderBy: [{ pack: "asc" }, { signalId: "asc" }]
    });
    return rows.map(mapRule);
  }

  async listRules(filter?: {
    pack?: SafetyHeuristicPack;
    locale?: SafetyHeuristicLocale;
    enabled?: boolean;
  }): Promise<SafetyHeuristicRule[]> {
    const rows = await this.prisma.safetyHeuristicRule.findMany({
      where: {
        ...(filter?.pack === undefined ? {} : { pack: filter.pack }),
        ...(filter?.locale === undefined ? {} : { locale: filter.locale }),
        ...(filter?.enabled === undefined ? {} : { enabled: filter.enabled })
      },
      orderBy: [{ pack: "asc" }, { signalId: "asc" }]
    });
    return rows.map(mapRule);
  }

  async replaceAllRules(rules: SafetyHeuristicRuleUpsertInput[]): Promise<SafetyHeuristicRule[]> {
    const signalIds = rules.map((rule) => rule.signalId);
    await this.prisma.$transaction(async (tx) => {
      await tx.safetyHeuristicRule.deleteMany({
        where:
          signalIds.length === 0
            ? {}
            : {
                signalId: { notIn: signalIds }
              }
      });
      for (const rule of rules) {
        await tx.safetyHeuristicRule.upsert({
          where: { signalId: rule.signalId },
          create: {
            signalId: rule.signalId,
            pack: rule.pack,
            locale: rule.locale,
            patternType: rule.patternType,
            pattern: rule.pattern,
            weight: rule.weight,
            enabled: rule.enabled
          },
          update: {
            pack: rule.pack,
            locale: rule.locale,
            patternType: rule.patternType,
            pattern: rule.pattern,
            weight: rule.weight,
            enabled: rule.enabled
          }
        });
      }
    });
    return this.listRules();
  }
}

@Injectable()
export class PrismaSafetyPolicySettingsRepository implements SafetyPolicySettingsRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async getSettings(): Promise<SafetyPolicySettings> {
    const row = await this.prisma.safetyPolicySettings.upsert({
      where: { id: SAFETY_POLICY_SETTINGS_ID },
      create: { id: SAFETY_POLICY_SETTINGS_ID },
      update: {}
    });
    return mapSettings(row);
  }

  async updateSettings(input: SafetyPolicySettingsUpdateInput): Promise<SafetyPolicySettings> {
    const row = await this.prisma.safetyPolicySettings.upsert({
      where: { id: SAFETY_POLICY_SETTINGS_ID },
      create: {
        id: SAFETY_POLICY_SETTINGS_ID,
        syncHoldTimeoutMs: input.syncHoldTimeoutMs,
        instantBlockPackAllowlist: input.instantBlockPackAllowlist,
        moderationModelId: input.moderationModelId,
        contour2Enabled: input.contour2Enabled
      },
      update: {
        syncHoldTimeoutMs: input.syncHoldTimeoutMs,
        instantBlockPackAllowlist: input.instantBlockPackAllowlist,
        moderationModelId: input.moderationModelId,
        contour2Enabled: input.contour2Enabled
      }
    });
    return mapSettings(row);
  }
}
