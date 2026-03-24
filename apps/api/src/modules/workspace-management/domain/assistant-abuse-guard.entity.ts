export type AbuseSurface = "web_chat" | "telegram" | "whatsapp" | "max";

export type AssistantAbuseGuardState = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  surface: AbuseSurface;
  windowStartedAt: Date;
  requestCount: number;
  slowedUntil: Date | null;
  blockedUntil: Date | null;
  blockReason: string | null;
  adminOverrideUntil: Date | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type AssistantAbuseAssistantState = {
  id: string;
  assistantId: string;
  surface: AbuseSurface;
  windowStartedAt: Date;
  requestCount: number;
  slowedUntil: Date | null;
  blockedUntil: Date | null;
  blockReason: string | null;
  adminOverrideUntil: Date | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
