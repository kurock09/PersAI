export type AssistantTaskRegistrySourceSurface = "web";

export type AssistantTaskRegistryControlStatus = "active" | "disabled" | "cancelled";

export type AssistantTaskRegistryItem = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  title: string;
  sourceSurface: AssistantTaskRegistrySourceSurface;
  sourceLabel: string | null;
  controlStatus: AssistantTaskRegistryControlStatus;
  nextRunAt: Date | null;
  disabledAt: Date | null;
  cancelledAt: Date | null;
  externalRef: string | null;
  createdAt: Date;
  updatedAt: Date;
};
