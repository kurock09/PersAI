import type { RuntimeTurnToolInvocation } from "@persai/runtime-contract";

export type ClientRuntimeTurnToolInvocation = Omit<RuntimeTurnToolInvocation, "billingFacts">;

export function stripToolInvocationsForClient(
  invocations: readonly RuntimeTurnToolInvocation[]
): ClientRuntimeTurnToolInvocation[] {
  return invocations.map(({ billingFacts: _ignored, ...rest }) => rest);
}
