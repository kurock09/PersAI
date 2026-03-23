import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter,
  AssistantRuntimeAdapterError,
  type AssistantRuntimePreflightResult
} from "./assistant-runtime-adapter.types";

@Injectable()
export class AssistantRuntimePreflightService {
  constructor(
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter
  ) {}

  async execute(): Promise<AssistantRuntimePreflightResult> {
    try {
      return await this.assistantRuntimeAdapter.preflight();
    } catch (error) {
      if (error instanceof AssistantRuntimeAdapterError) {
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
