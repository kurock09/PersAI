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

export interface AssistantRuntimeWebChatTurnInput {
  assistantId: string;
  publishedVersionId: string;
  chatId: string;
  surfaceThreadKey: string;
  userMessageId: string;
  userMessage: string;
}

export interface AssistantRuntimeWebChatTurnResult {
  assistantMessage: string;
  respondedAt: string;
}

export interface AssistantRuntimeWebChatTurnStreamChunk {
  type: "delta" | "thinking" | "done";
  delta?: string;
  accumulated?: string;
  respondedAt?: string;
}

export interface AssistantRuntimeAdapter {
  preflight(): Promise<AssistantRuntimePreflightResult>;
  applyMaterializedSpec(input: AssistantRuntimeApplyInput): Promise<void>;
  cleanupWorkspace(assistantId: string): Promise<void>;
  sendWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult>;
  streamWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk>;
}

export const ASSISTANT_RUNTIME_ADAPTER = Symbol("ASSISTANT_RUNTIME_ADAPTER");
