export const WORKSPACE_TOOL_DAILY_USAGE_REPOSITORY = Symbol("WorkspaceToolDailyUsageRepository");

export type DailyUsageRecord = {
  workspaceId: string;
  toolCode: string;
  date: Date;
  callCount: number;
};

export interface WorkspaceToolDailyUsageRepository {
  incrementAndGet(workspaceId: string, toolCode: string): Promise<number>;
  getUsageForDate(workspaceId: string, toolCode: string, date: Date): Promise<number>;
}
