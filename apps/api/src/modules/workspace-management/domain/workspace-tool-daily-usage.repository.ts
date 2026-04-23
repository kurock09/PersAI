export const WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY = Symbol("WorkspaceToolDailyUsageRepository");

export type DailyUsageRecord = {
  workspaceId: string;
  toolCode: string;
  date: Date;
  callCount: number;
};

/**
 * ADR-074 Slice L1.1 — both `incrementAndGet` and `consumeWithinLimit`
 * now accept an optional `units` weight (defaults to 1). This lets cost
 * tools that legitimately produce N artifacts per single tool call (the
 * canonical case is `image_generate({ count: N })` where OpenAI bills
 * per generated image) advance the daily counter by the requested
 * artifact count instead of by 1. Without this, a single
 * `image_generate(count=4)` invocation would consume one quota unit but
 * incur four units of provider cost — exactly the founder live
 * observation that drove L1.1.
 */
export interface WorkspaceToolDailyUsageRepository {
  incrementAndGet(workspaceId: string, toolCode: string, units?: number): Promise<number>;
  getUsageForDate(workspaceId: string, toolCode: string, date: Date): Promise<number>;
  consumeWithinLimit(
    workspaceId: string,
    toolCode: string,
    dailyCallLimit: number,
    units?: number
  ): Promise<{ allowed: boolean; currentCount: number }>;
}
