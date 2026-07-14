export type AssistantRoleStatus = "draft" | "active" | "archived";

export type AssistantRoleLocalizedText = Record<string, string>;

export type AssistantRole = {
  id: string;
  key: string;
  name: AssistantRoleLocalizedText;
  description: AssistantRoleLocalizedText;
  mission: AssistantRoleLocalizedText;
  category: string;
  iconEmoji: string | null;
  color: string | null;
  status: AssistantRoleStatus;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
};
