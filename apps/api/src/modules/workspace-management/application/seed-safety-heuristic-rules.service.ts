import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SAFETY_HEURISTIC_RULE_SEEDS } from "../../../../prisma/safety-heuristic-rules-seed";
import { EvaluateInboundSafetyPrecheckService } from "./evaluate-inbound-safety-precheck.service";
import {
  SAFETY_HEURISTIC_RULE_REPOSITORY,
  type SafetyHeuristicRuleRepository
} from "../domain/safety-policy.repository";
import { Inject } from "@nestjs/common";

@Injectable()
export class SeedSafetyHeuristicRulesService implements OnModuleInit {
  private readonly logger = new Logger(SeedSafetyHeuristicRulesService.name);

  constructor(
    @Inject(SAFETY_HEURISTIC_RULE_REPOSITORY)
    private readonly safetyHeuristicRuleRepository: SafetyHeuristicRuleRepository,
    private readonly evaluateInboundSafetyPrecheckService: EvaluateInboundSafetyPrecheckService
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.syncSeedRules();
      await this.evaluateInboundSafetyPrecheckService.reloadPolicyCache();
    } catch (error) {
      this.logger.warn(
        `Safety heuristic seed failed (non-fatal): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async syncSeedRules(): Promise<void> {
    const existing = await this.safetyHeuristicRuleRepository.listRules();
    const existingSignalIds = new Set(existing.map((rule) => rule.signalId));
    const missingSeeds = SAFETY_HEURISTIC_RULE_SEEDS.filter(
      (seed) => !existingSignalIds.has(seed.signalId)
    );
    if (missingSeeds.length === 0) {
      return;
    }
    await this.safetyHeuristicRuleRepository.replaceAllRules([
      ...existing.map((rule) => ({
        signalId: rule.signalId,
        pack: rule.pack,
        locale: rule.locale,
        patternType: rule.patternType,
        pattern: rule.pattern,
        weight: rule.weight,
        enabled: rule.enabled
      })),
      ...missingSeeds.map((seed) => ({
        signalId: seed.signalId,
        pack: seed.pack,
        locale: seed.locale,
        patternType: seed.patternType,
        pattern: seed.pattern,
        weight: seed.weight,
        enabled: true
      }))
    ]);
    this.logger.log(`Safety heuristic rules seeded: ${missingSeeds.length} new entries`);
  }
}
