export type Assistant = {
  id: string;
  userId: string;
  workspaceId: string;
  draftDisplayName: string | null;
  draftInstructions: string | null;
  draftUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
