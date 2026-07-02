/**
 * ADR-130 Slice 1 — shared prompt-budget guardrails.
 *
 * Exported via `@persai/runtime-contract` so API and runtime share one
 * prompt-budget source of truth.
 */
export const ENABLED_SKILLS_BUDGET_CHARS = 4_500;
export const STABLE_PREFIX_BUDGET_CHARS = 10_000;
export const ENABLED_SKILLS_SCENARIO_ROW_CAP = 32;
export const SKILL_SUMMARY_CAP = 160;
export const SKILL_WHEN_TO_USE_CAP = 200;
