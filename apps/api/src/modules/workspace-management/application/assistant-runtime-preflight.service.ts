import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_FACADE,
  type AssistantRuntimeFacade,
  AssistantRuntimeError,
  type AssistantRuntimePreflightResult
} from "./assistant-runtime.facade";
import type { RuntimeTier } from "./runtime-assignment";

@Injectable()
export class AssistantRuntimePreflightService {
  constructor(
    @Inject(ASSISTANT_RUNTIME_FACADE)
    private readonly assistantRuntime: AssistantRuntimeFacade
  ) {}

  async execute(runtimeTier?: RuntimeTier): Promise<AssistantRuntimePreflightResult> {
    try {
      return await this.assistantRuntime.preflight(runtimeTier);
    } catch (error) {
      if (error instanceof AssistantRuntimeError) {
        return {
          live: false,
          ready: false,
          checkedAt: new Date().toISOString()
        };
      }

      throw error;
    }
  }
}
