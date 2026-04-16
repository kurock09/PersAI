export type AssistantMaterializationSourceAction = "publish" | "rollback" | "reset";

export type AssistantMaterializedSpec = {
  id: string;
  assistantId: string;
  publishedVersionId: string;
  sourceAction: AssistantMaterializationSourceAction;
  algorithmVersion: number;
  materializedAtConfigGeneration: number;
  layers: unknown;
  runtimeBundle: unknown | null;
  assistantConfig: unknown;
  assistantWorkspace: unknown;
  layersDocument: string;
  runtimeBundleDocument: string | null;
  runtimeBundleHash: string | null;
  assistantConfigDocument: string;
  assistantWorkspaceDocument: string;
  contentHash: string;
  createdAt: Date;
};
