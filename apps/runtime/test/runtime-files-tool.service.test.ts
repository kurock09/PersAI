import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeOutputArtifact,
  RuntimeSandboxJobRequest,
  RuntimeSandboxJobResult
} from "@persai/runtime-contract";
import { RuntimeAssistantFileRegistryService } from "../src/modules/turns/runtime-assistant-file-registry.service";
import { RuntimeFilesToolService } from "../src/modules/turns/runtime-files-tool.service";

function createBundle(): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    },
    runtime: {
      sandbox: {
        enabled: true,
        maxSingleFileWriteBytes: 1024,
        maxWorkspaceBytesPerJob: 2048,
        maxPersistedArtifactsPerJob: 4,
        maxFileCountPerJob: 8,
        maxDirectoryCountPerJob: 4,
        maxProcessRuntimeMs: 1000,
        maxCpuMsPerJob: 1000,
        maxMemoryBytesPerJob: 1024 * 1024,
        maxConcurrentProcesses: 2,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
        networkAccessEnabled: false,
        artifactMimeAllowlist: ["text/plain"],
        webMaxOutboundBytes: 4096,
        telegramMaxOutboundBytes: 4096,
        sandboxJobsPerDay: null,
        maxArtifactSendCountPerTurn: 2
      }
    },
    governance: {
      toolPolicies: [
        {
          toolCode: "files",
          displayName: "Files",
          description: "Unified file tool.",
          usageGuidance: null,
          kind: "plan",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        }
      ]
    }
  } as AssistantRuntimeBundle;
}

class FakeSandboxClientService {
  calls: RuntimeSandboxJobRequest[] = [];

  isConfigured(): boolean {
    return true;
  }

  async waitForCompletion(input: RuntimeSandboxJobRequest): Promise<RuntimeSandboxJobResult> {
    this.calls.push(input);
    return {
      jobId: "sandbox-job-1",
      status: "completed",
      toolCode: input.toolCode,
      reason: null,
      warning: null,
      violationCode: null,
      violationMessage: null,
      exitCode: null,
      stdout: null,
      stderr: null,
      content: "file body",
      files: [
        {
          relativePath: "reports/report.txt",
          displayName: "report.txt",
          mimeType: "text/plain",
          sizeBytes: 64,
          logicalSizeBytes: 64,
          fileRef: {
            fileRef: "file-ref-1",
            origin: "uploaded_attachment",
            sourceToolCode: "files",
            objectKey: "assistant-media/uploads/file-ref-1/report.txt",
            relativePath: "reports/report.txt",
            displayName: "report.txt",
            mimeType: "text/plain",
            sizeBytes: 64,
            logicalSizeBytes: 64
          }
        }
      ]
    };
  }
}

async function run(): Promise<void> {
  const prisma = {
    assistantFile: {
      async findMany() {
        return [
          {
            id: "file-ref-1",
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            sandboxJobId: null,
            origin: "uploaded_attachment" as const,
            sourceToolCode: null,
            objectKey: "assistant-media/uploads/file-ref-1/report.txt",
            relativePath: "reports/report.txt",
            displayName: "report.txt",
            mimeType: "text/plain",
            sizeBytes: BigInt(64),
            logicalSizeBytes: BigInt(64),
            sha256: null,
            metadata: null,
            createdAt: new Date("2026-04-19T12:00:00.000Z")
          }
        ];
      },
      async findFirst() {
        return {
          id: "file-ref-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          sandboxJobId: null,
          origin: "uploaded_attachment" as const,
          sourceToolCode: null,
          objectKey: "assistant-media/uploads/file-ref-1/report.txt",
          relativePath: "reports/report.txt",
          displayName: "report.txt",
          mimeType: "text/plain",
          sizeBytes: BigInt(64),
          logicalSizeBytes: BigInt(64),
          sha256: null,
          metadata: null,
          createdAt: new Date("2026-04-19T12:00:00.000Z")
        };
      }
    }
  };
  const registry = new RuntimeAssistantFileRegistryService(prisma as never);
  const sandboxClientService = new FakeSandboxClientService();
  const service = new RuntimeFilesToolService(
    registry,
    sandboxClientService as never,
    {
      async queueResolvedSelection(): Promise<{
        artifacts: RuntimeOutputArtifact[];
        queuedArtifacts: number;
        reason: string | null;
        warning: string | null;
        isError: boolean;
      }> {
        return {
          artifacts: [],
          queuedArtifacts: 0,
          reason: null,
          warning: null,
          isError: false
        };
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, currentCount: 0, limit: 10 };
      }
    } as never
  );

  const searchResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-search",
      name: "files",
      arguments: {
        action: "search",
        query: "report"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-1",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(searchResult.isError, false);
  assert.equal(searchResult.payload.action, "results");
  assert.equal(searchResult.payload.items[0]?.fileRef, "file-ref-1");

  const readResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-read",
      name: "files",
      arguments: {
        action: "read",
        fileRef: "file-ref-1"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-2",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(readResult.isError, false);
  assert.equal(readResult.payload.requestedAction, "read");
  assert.equal(readResult.payload.action, "read");
  assert.equal(readResult.payload.content, "file body");
  assert.equal(sandboxClientService.calls.at(-1)?.toolCode, "files");
  assert.equal(sandboxClientService.calls.at(-1)?.args.action, "read");
  assert.deepEqual(sandboxClientService.calls.at(-1)?.mountedFileRefs, ["file-ref-1"]);
}

void run();
