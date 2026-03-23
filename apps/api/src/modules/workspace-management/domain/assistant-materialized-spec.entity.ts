export type AssistantMaterializationSourceAction = "publish" | "rollback" | "reset";

export type AssistantMaterializedSpec = {
  id: string;
  assistantId: string;
  publishedVersionId: string;
  sourceAction: AssistantMaterializationSourceAction;
  algorithmVersion: number;
  layers: unknown;
  openclawBootstrap: unknown;
  openclawWorkspace: unknown;
  layersDocument: string;
  openclawBootstrapDocument: string;
  openclawWorkspaceDocument: string;
  contentHash: string;
  createdAt: Date;
};
