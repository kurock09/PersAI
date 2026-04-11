import { Injectable } from "@nestjs/common";

export interface RuntimeObservabilitySnapshot {
  warmRequests: number;
  warmReplacements: number;
  invalidateRequests: number;
  invalidatedBundles: number;
  evictedBundles: number;
  lastWarmedAt: string | null;
  lastInvalidatedAt: string | null;
}

type RecordWarmInput = {
  replaced: boolean;
  evictedCount: number;
  warmedAt: string;
};

type RecordInvalidationInput = {
  invalidatedCount: number;
  invalidatedAt: string;
};

@Injectable()
export class RuntimeObservabilityService {
  private warmRequests = 0;
  private warmReplacements = 0;
  private invalidateRequests = 0;
  private invalidatedBundles = 0;
  private evictedBundles = 0;
  private lastWarmedAt: string | null = null;
  private lastInvalidatedAt: string | null = null;

  recordWarm(input: RecordWarmInput): void {
    this.warmRequests += 1;
    if (input.replaced) {
      this.warmReplacements += 1;
    }
    this.evictedBundles += input.evictedCount;
    this.lastWarmedAt = input.warmedAt;
  }

  recordInvalidation(input: RecordInvalidationInput): void {
    this.invalidateRequests += 1;
    this.invalidatedBundles += input.invalidatedCount;
    this.lastInvalidatedAt = input.invalidatedAt;
  }

  getSnapshot(): RuntimeObservabilitySnapshot {
    return {
      warmRequests: this.warmRequests,
      warmReplacements: this.warmReplacements,
      invalidateRequests: this.invalidateRequests,
      invalidatedBundles: this.invalidatedBundles,
      evictedBundles: this.evictedBundles,
      lastWarmedAt: this.lastWarmedAt,
      lastInvalidatedAt: this.lastInvalidatedAt
    };
  }
}
