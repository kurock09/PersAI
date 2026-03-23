export type AssistantRuntimeErrorCode =
  | "runtime_unreachable"
  | "auth_failure"
  | "timeout"
  | "invalid_response"
  | "runtime_degraded";

export class AssistantRuntimeAdapterError extends Error {
  constructor(
    public readonly code: AssistantRuntimeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AssistantRuntimeAdapterError";
  }
}

export interface AssistantRuntimePreflightResult {
  live: boolean;
  ready: boolean;
  checkedAt: string;
}

export interface AssistantRuntimeApplyInput {
  assistantId: string;
  publishedVersionId: string;
  contentHash: string;
  openclawBootstrap: unknown;
  openclawWorkspace: unknown;
  reapply: boolean;
}

export interface AssistantRuntimeAdapter {
  preflight(): Promise<AssistantRuntimePreflightResult>;
  applyMaterializedSpec(input: AssistantRuntimeApplyInput): Promise<void>;
}

export const ASSISTANT_RUNTIME_ADAPTER = Symbol("ASSISTANT_RUNTIME_ADAPTER");
