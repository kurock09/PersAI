import type {
  AssistantMaterializedSpec,
  AssistantMaterializationSourceAction
} from "./assistant-materialized-spec.entity";

export const ASSISTANT_MATERIALIZED_SPEC_REPOSITORY = Symbol(
  "ASSISTANT_MATERIALIZED_SPEC_REPOSITORY"
);

export interface CreateAssistantMaterializedSpecInput {
  assistantId: string;
  publishedVersionId: string;
  sourceAction: AssistantMaterializationSourceAction;
  algorithmVersion: number;
  materializedAtConfigGeneration: number;
  layers: unknown;
  runtimeBundle: unknown;
  assistantConfig: unknown;
  assistantWorkspace: unknown;
  layersDocument: string;
  runtimeBundleDocument: string;
  runtimeBundleHash: string;
  assistantConfigDocument: string;
  assistantWorkspaceDocument: string;
  contentHash: string;
}

export interface AssistantMaterializedSpecRepository {
  findLatestByAssistantId(assistantId: string): Promise<AssistantMaterializedSpec | null>;
  findByPublishedVersionId(publishedVersionId: string): Promise<AssistantMaterializedSpec | null>;
  create(input: CreateAssistantMaterializedSpecInput): Promise<AssistantMaterializedSpec>;
}
