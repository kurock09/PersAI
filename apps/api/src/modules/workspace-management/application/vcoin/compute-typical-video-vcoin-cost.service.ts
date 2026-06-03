import { Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "../resolve-platform-runtime-provider-settings.service";
import { TYPICAL_VIDEO_SECONDS } from "./typical-video-seconds";

/**
 * ADR-108 Slice 7 — fallback typical video duration used when the workspace
 * has no rolling-30-day video history. Value MUST match `TYPICAL_VIDEO_SECONDS`
 * from the Slice 6a marketing constant so both surfaces use the same baseline.
 */
const TYPICAL_VIDEO_SECONDS_FALLBACK = TYPICAL_VIDEO_SECONDS; // 5

/**
 * ADR-108 Slice 7 — computes the approximate Vcoin cost of a "typical"
 * `video_generate` job for the advisor copy displayed in the runtime
 * `quota_status` tool result.
 *
 * Algorithm:
 *   1. Query rolling 30-day arithmetic-mean `durationSeconds` from
 *      `model_cost_ledger_events` for this workspace + purpose
 *      `video_generation`. Treat NULL / empty as "no history".
 *   2. Compute platform-average USD/sec from active time-metered video
 *      catalog rows (same source as `manage-admin-plans.service.ts`).
 *   3. `typicalUsdMicros = round(avgSeconds * avgUsdPerSecond * 1_000_000)`
 *      `typicalCostVc = ceil(typicalUsdMicros * vcoinExchangeRate / 1_000_000)`
 *      (mirrors `compute-video-vcoin-cost.ts` BigInt ceil pattern).
 *   4. If no workspace history → use `TYPICAL_VIDEO_SECONDS_FALLBACK` and
 *      set `fromPlatformFallback: true`.
 *   5. If no active video catalog pricing → return all nulls.
 *
 * No VC debits, no I/O mutations. Degrades gracefully on any DB error.
 */
@Injectable()
export class ComputeTypicalVideoVcoinCostService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService
  ) {}

  async resolveTypicalVideoVcoinCost(input: {
    workspaceId: string;
    vcoinExchangeRate: number;
  }): Promise<{
    typicalSeconds: number | null;
    typicalCostVc: number | null;
    fromPlatformFallback: boolean;
  }> {
    const [avgSecondsResult, settings] = await Promise.all([
      this.queryAvgDurationSeconds(input.workspaceId),
      this.resolvePlatformRuntimeProviderSettingsService.execute()
    ]);

    const avgUsdPerSecond = this.computeAvgVideoUsdPerSecond(
      settings.availableModelCatalogByProvider
    );
    if (avgUsdPerSecond === null) {
      // No active video catalog pricing — cannot compute typical cost.
      return { typicalSeconds: null, typicalCostVc: null, fromPlatformFallback: false };
    }

    const hasHistory =
      avgSecondsResult !== null && Number.isFinite(avgSecondsResult) && avgSecondsResult > 0;
    const fromPlatformFallback = !hasHistory;
    const typicalSeconds = hasHistory ? avgSecondsResult! : TYPICAL_VIDEO_SECONDS_FALLBACK;

    const typicalCostVc = this.computeTypicalCostVc(
      typicalSeconds,
      avgUsdPerSecond,
      input.vcoinExchangeRate
    );

    return {
      typicalSeconds: hasHistory ? typicalSeconds : null,
      typicalCostVc,
      fromPlatformFallback
    };
  }

  private async queryAvgDurationSeconds(workspaceId: string): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ avg_seconds: number | null }>>`
        SELECT AVG((raw_usage->'metering'->>'durationSeconds')::float) AS avg_seconds
        FROM model_cost_ledger_events
        WHERE workspace_id = ${workspaceId}::uuid
          AND purpose = 'video_generation'
          AND occurred_at >= NOW() - INTERVAL '30 days'
      `;
      const first = rows[0];
      if (first === undefined || first.avg_seconds === null) {
        return null;
      }
      return typeof first.avg_seconds === "number" && Number.isFinite(first.avg_seconds)
        ? first.avg_seconds
        : null;
    } catch {
      return null;
    }
  }

  private computeAvgVideoUsdPerSecond(
    catalogByProvider: import("../runtime-provider-profile").RuntimeProviderModelCatalogByProvider
  ): number | null {
    const samples: number[] = [];
    for (const providerCatalog of Object.values(catalogByProvider)) {
      for (const profile of providerCatalog.models) {
        if (
          profile.active &&
          profile.capabilities.includes("video") &&
          profile.billingMode === "time_metered"
        ) {
          const { pricePerUnit, unit } = profile.providerPriceMetadata.timePricing;
          const perSecond = unit === "minute" ? pricePerUnit / 60 : pricePerUnit;
          samples.push(perSecond);
        }
      }
    }
    if (samples.length === 0) {
      return null;
    }
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  /**
   * Mirrors the BigInt ceil division pattern from `compute-video-vcoin-cost.ts`
   * (ADR-108 §53: per-job cost is rounded up, not round-half-up).
   *
   * Formula:
   *   usdMicros = round(seconds * usdPerSecond * 1_000_000)
   *   costVc    = ceil(usdMicros * exchangeRate / 1_000_000)
   */
  private computeTypicalCostVc(
    seconds: number,
    avgUsdPerSecond: number,
    vcoinExchangeRate: number
  ): number {
    const usdMicrosFloat = seconds * avgUsdPerSecond * 1_000_000;
    const usdMicros = BigInt(Math.max(0, Math.round(usdMicrosFloat)));
    if (usdMicros === 0n) {
      return 0;
    }
    const ONE_USD_IN_MICROS = 1_000_000n;
    const rate = BigInt(Math.round(vcoinExchangeRate));
    const numerator = usdMicros * rate;
    const vcCostBig = (numerator + ONE_USD_IN_MICROS - 1n) / ONE_USD_IN_MICROS;
    return Number(vcCostBig);
  }
}
