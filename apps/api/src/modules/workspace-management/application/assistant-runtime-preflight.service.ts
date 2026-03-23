import { Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter,
  type AssistantRuntimePreflightResult
} from "./assistant-runtime-adapter.types";

@Injectable()
export class AssistantRuntimePreflightService {
  constructor(
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter
  ) {}

  async execute(): Promise<AssistantRuntimePreflightResult> {
    return this.assistantRuntimeAdapter.preflight();
  }
}
