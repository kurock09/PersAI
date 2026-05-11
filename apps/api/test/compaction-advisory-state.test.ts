import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompactionAdvisoryDedupeKey,
  DEFAULT_COMPACTION_ADVISORY_SUPPRESSION_MINUTES,
  isLatestAutoCompactionWeak,
  isCompactionExhaustedAdvisoryPayload,
  isCompactionExhaustedAtPlanLimit,
  resolveCompactionAdvisorySuppressionMinutes
} from "../src/modules/workspace-management/application/compaction-advisory-state";

test("marks compaction exhausted only at plan limit with repeated auto-compaction", () => {
  assert.equal(
    isCompactionExhaustedAtPlanLimit({
      currentTokens: 24_000,
      totalTokensFresh: true,
      reserveTokens: 24_000,
      autoCompactionEnabled: true,
      recentAutoCompactionStreak: 3,
      latestAutoCompactionWeak: false
    }),
    true
  );
  assert.equal(
    isCompactionExhaustedAtPlanLimit({
      currentTokens: 23_999,
      totalTokensFresh: true,
      reserveTokens: 24_000,
      autoCompactionEnabled: true,
      recentAutoCompactionStreak: 3,
      latestAutoCompactionWeak: false
    }),
    false
  );
  assert.equal(
    isCompactionExhaustedAtPlanLimit({
      currentTokens: 24_000,
      totalTokensFresh: false,
      reserveTokens: 24_000,
      autoCompactionEnabled: true,
      recentAutoCompactionStreak: 3,
      latestAutoCompactionWeak: false
    }),
    false
  );
});

test("treats repeated weak auto-compaction as exhausted even below the reserve line", () => {
  assert.equal(
    isLatestAutoCompactionWeak({
      latestCompactionBaselineTokens: 11_144,
      currentTokens: 9_612,
      totalTokensFresh: true
    }),
    true
  );
  assert.equal(
    isCompactionExhaustedAtPlanLimit({
      currentTokens: 9_612,
      totalTokensFresh: true,
      reserveTokens: 24_000,
      autoCompactionEnabled: true,
      recentAutoCompactionStreak: 3,
      latestAutoCompactionWeak: true
    }),
    true
  );
  assert.equal(
    isCompactionExhaustedAtPlanLimit({
      currentTokens: 9_612,
      totalTokensFresh: true,
      reserveTokens: 24_000,
      autoCompactionEnabled: true,
      recentAutoCompactionStreak: 2,
      latestAutoCompactionWeak: true
    }),
    false
  );
});

test("does not relabel a previously healthy compaction from stale later token growth", () => {
  assert.equal(
    isLatestAutoCompactionWeak({
      latestCompactionBaselineTokens: 10_000,
      currentTokens: 7_000,
      totalTokensFresh: true
    }),
    false
  );
  assert.equal(
    isLatestAutoCompactionWeak({
      latestCompactionBaselineTokens: null,
      currentTokens: 8_500,
      totalTokensFresh: true
    }),
    false
  );
});

test("resolves compaction advisory suppression minutes from config first", () => {
  assert.equal(
    resolveCompactionAdvisorySuppressionMinutes({
      policyCooldownMinutes: 60,
      config: { compactionAdvisorySuppressionMinutes: 180 }
    }),
    180
  );
  assert.equal(
    resolveCompactionAdvisorySuppressionMinutes({
      policyCooldownMinutes: 45,
      config: {}
    }),
    45
  );
  assert.equal(
    resolveCompactionAdvisorySuppressionMinutes({
      policyCooldownMinutes: null,
      config: {}
    }),
    DEFAULT_COMPACTION_ADVISORY_SUPPRESSION_MINUTES
  );
});

test("builds compaction advisory dedupe key by suppression window", () => {
  const first = buildCompactionAdvisoryDedupeKey({
    assistantId: "assistant-1",
    surface: "telegram",
    surfaceThreadKey: "thread-1",
    suppressionMinutes: 60,
    now: new Date("2026-05-11T10:05:00.000Z")
  });
  const second = buildCompactionAdvisoryDedupeKey({
    assistantId: "assistant-1",
    surface: "telegram",
    surfaceThreadKey: "thread-1",
    suppressionMinutes: 60,
    now: new Date("2026-05-11T10:55:00.000Z")
  });
  const third = buildCompactionAdvisoryDedupeKey({
    assistantId: "assistant-1",
    surface: "telegram",
    surfaceThreadKey: "thread-1",
    suppressionMinutes: 60,
    now: new Date("2026-05-11T11:05:00.000Z")
  });
  assert.equal(first, second);
  assert.notEqual(first, third);
});

test("recognizes compaction exhausted advisory payloads", () => {
  assert.equal(
    isCompactionExhaustedAdvisoryPayload({ advisoryKind: "compaction_exhausted" }),
    true
  );
  assert.equal(isCompactionExhaustedAdvisoryPayload({ advisoryKind: "quota_warning" }), false);
  assert.equal(isCompactionExhaustedAdvisoryPayload(null), false);
});
