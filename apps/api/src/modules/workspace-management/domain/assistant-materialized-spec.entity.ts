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
  openclawBootstrap: unknown;
  openclawWorkspace: unknown;
  layersDocument: string;
  runtimeBundleDocument: string | null;
  runtimeBundleHash: string | null;
  openclawBootstrapDocument: string;
  openclawWorkspaceDocument: string;
  contentHash: string;
  createdAt: Date;
};
