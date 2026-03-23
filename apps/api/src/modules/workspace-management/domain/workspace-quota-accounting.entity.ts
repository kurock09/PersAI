export type WorkspaceQuotaDimension =
  | "token_budget"
  | "cost_or_token_driving_tool_class"
  | "active_web_chats_cap";

export type WorkspaceQuotaAccountingState = {
  id: string;
  workspaceId: string;
  tokenBudgetUsed: bigint;
  tokenBudgetLimit: bigint | null;
  costOrTokenDrivingToolClassUnitsUsed: number;
  costOrTokenDrivingToolClassUnitsLimit: number | null;
  activeWebChatsCurrent: number;
  activeWebChatsLimit: number | null;
  lastComputedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
