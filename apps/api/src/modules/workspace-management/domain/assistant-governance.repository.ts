import type { AssistantGovernance } from "./assistant-governance.entity";

export const ASSISTANT_GOVERNANCE_REPOSITORY = Symbol("ASSISTANT_GOVERNANCE_REPOSITORY");

export interface AssistantGovernanceRepository {
  findByAssistantId(assistantId: string): Promise<AssistantGovernance | null>;
  createBaseline(assistantId: string): Promise<AssistantGovernance>;
  appendMemoryControlForgetMarker(
    assistantId: string,
    marker: Record<string, unknown>
  ): Promise<void>;
}
