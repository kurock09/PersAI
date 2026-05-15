import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { type AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeDocumentJobRunRequest,
  RuntimeDocumentJobRunResult
} from "@persai/runtime-contract";
import { RuntimeExecutionAdmissionService } from "./runtime-execution-admission.service";
import { RuntimeDocumentProviderAdapterService } from "./runtime-document-provider-adapter.service";

const DOCUMENT_JOB_RUN_KEY_PREFIX = "document-job-run";

@Injectable()
export class RuntimeDocumentJobRunService {
  constructor(
    private readonly runtimeExecutionAdmissionService: RuntimeExecutionAdmissionService,
    private readonly runtimeDocumentProviderAdapterService: RuntimeDocumentProviderAdapterService
  ) {}

  async run(input: RuntimeDocumentJobRunRequest): Promise<RuntimeDocumentJobRunResult> {
    return this.runtimeExecutionAdmissionService.runWithAdmission("background", async () => {
      const bundle = this.parseBundle(input.runtimeBundleDocument);
      if (bundle.metadata.assistantId !== input.assistantId) {
        throw new BadRequestException("runtimeBundleDocument assistantId does not match request.");
      }
      if (bundle.metadata.workspaceId !== input.workspaceId) {
        throw new BadRequestException("runtimeBundleDocument workspaceId does not match request.");
      }

      const toolRunKey = this.buildDocumentJobRunKey(input);
      this.buildDirectToolCall(input, toolRunKey);
      return this.runtimeDocumentProviderAdapterService.run({
        bundle,
        request: input
      });
    });
  }

  private buildDirectToolCall(
    input: RuntimeDocumentJobRunRequest,
    toolRunKey: string
  ): ProviderGatewayToolCall {
    return {
      id: `${toolRunKey}:tool`,
      name: input.directToolExecution.toolCode,
      arguments: {
        descriptorMode: input.directToolExecution.descriptorMode,
        ...input.directToolExecution.request
      } as Record<string, unknown>
    };
  }

  private parseBundle(document: string): AssistantRuntimeBundle {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      throw new BadRequestException("runtimeBundleDocument must be valid JSON.");
    }
    const row = this.asObject(parsed);
    if (
      row === null ||
      this.asObject(row.metadata) === null ||
      this.asObject(row.runtime) === null ||
      this.asObject(row.promptConstructor) === null
    ) {
      throw new BadRequestException("runtimeBundleDocument has an invalid runtime bundle shape.");
    }
    return parsed as AssistantRuntimeBundle;
  }

  private buildDocumentJobRunKey(input: RuntimeDocumentJobRunRequest): string {
    const digest = createHash("sha256")
      .update(`${input.job.id}:${input.job.docId}:${input.job.versionId}:${input.job.provider}`)
      .digest("hex")
      .slice(0, 16);
    return `${DOCUMENT_JOB_RUN_KEY_PREFIX}:${input.job.id}:${digest}`;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
