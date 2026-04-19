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

function createBundle(overrides?: {
  artifactMimeAllowlist?: string[];
  webMaxOutboundBytes?: number;
  telegramMaxOutboundBytes?: number;
  maxArtifactSendCountPerTurn?: number;
}): AssistantRuntimeBundle {
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
        artifactMimeAllowlist: overrides?.artifactMimeAllowlist ?? ["image/png", "text/plain"],
        webMaxOutboundBytes: overrides?.webMaxOutboundBytes ?? 4096,
        telegramMaxOutboundBytes: overrides?.telegramMaxOutboundBytes ?? 4096,
        sandboxJobsPerDay: null,
        maxArtifactSendCountPerTurn: overrides?.maxArtifactSendCountPerTurn ?? 2
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

function createArtifact(overrides?: Partial<RuntimeOutputArtifact>): RuntimeOutputArtifact {
  return {
    artifactId: "artifact-1",
    kind: "image",
    objectKey: "assistant-media/runtime-output/generated.png",
    mimeType: "image/png",
    filename: "generated.png",
    sizeBytes: 128,
    voiceNote: false,
    ...overrides
  };
}

async function run(): Promise<void> {
  const canonicalRow = {
    id: "file-ref-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    sandboxJobId: null,
    origin: "uploaded_attachment" as const,
    sourceToolCode: "files",
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
  const prisma = {
    assistantFile: {
      async findMany(input?: {
        where?: {
          id?: { in: string[] };
          assistantId?: string;
          workspaceId?: string;
        };
      }) {
        const ids = input?.where?.id?.in;
        if (ids === undefined) {
          return [canonicalRow];
        }
        return ids.includes("file-ref-1") ? [canonicalRow] : [];
      },
      async findFirst() {
        return canonicalRow;
      }
    }
  };
  const registry = new RuntimeAssistantFileRegistryService(prisma as never);
  const sandboxClientService = new FakeSandboxClientService();
  const service = new RuntimeFilesToolService(
    registry,
    sandboxClientService as never,
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
  assert.equal(sandboxClientService.calls.at(-1)?.args.path, "reports/report.txt");
  assert.deepEqual(sandboxClientService.calls.at(-1)?.mountedFileRefs, []);

  const currentArtifact = createArtifact();
  const sendCurrentArtifact = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-send-artifact",
      name: "files",
      arguments: {
        action: "send",
        artifactIds: [currentArtifact.artifactId],
        caption: "Updated caption"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-3",
    currentArtifacts: [currentArtifact],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(sendCurrentArtifact.isError, false);
  assert.equal(sendCurrentArtifact.payload.requestedAction, "send");
  assert.equal(sendCurrentArtifact.payload.action, "queued");
  assert.equal(sendCurrentArtifact.artifacts.length, 1);
  assert.equal(sendCurrentArtifact.artifacts[0]?.artifactId, currentArtifact.artifactId);
  assert.equal(sendCurrentArtifact.artifacts[0]?.caption, "Updated caption");

  const sendFileRef = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-send-file-ref",
      name: "files",
      arguments: {
        action: "send",
        fileRefs: ["file-ref-1"],
        caption: "Sandbox output",
        filename: "custom-report.txt"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(sendFileRef.isError, false);
  assert.equal(sendFileRef.payload.action, "queued");
  assert.equal(sendFileRef.artifacts.length, 1);
  assert.equal(sendFileRef.artifacts[0]?.kind, "file");
  assert.equal(
    sendFileRef.artifacts[0]?.objectKey,
    "assistant-media/uploads/file-ref-1/report.txt"
  );
  assert.equal(sendFileRef.artifacts[0]?.filename, "custom-report.txt");
  assert.equal(sendFileRef.artifacts[0]?.caption, "Sandbox output");

  const blockedMime = await service.executeToolCall({
    bundle: createBundle({
      artifactMimeAllowlist: ["text/plain"],
      maxArtifactSendCountPerTurn: 1
    }),
    toolCall: {
      id: "tool-call-blocked-mime",
      name: "files",
      arguments: {
        action: "send",
        artifactIds: [currentArtifact.artifactId]
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-5",
    currentArtifacts: [currentArtifact],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(blockedMime.isError, true);
  assert.equal(blockedMime.payload.action, "skipped");
  assert.equal(blockedMime.payload.reason, "files_failed");
  assert.match(blockedMime.payload.warning ?? "", /Mime type "image\/png" is blocked/);

  const blockedChannelBytes = await service.executeToolCall({
    bundle: createBundle({
      webMaxOutboundBytes: 100,
      maxArtifactSendCountPerTurn: 1
    }),
    toolCall: {
      id: "tool-call-blocked-bytes",
      name: "files",
      arguments: {
        action: "send",
        artifactIds: [currentArtifact.artifactId]
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-6",
    currentArtifacts: [currentArtifact],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(blockedChannelBytes.isError, true);
  assert.equal(blockedChannelBytes.payload.action, "skipped");
  assert.equal(blockedChannelBytes.payload.reason, "channel_size_limit_exceeded");
  assert.match(blockedChannelBytes.payload.warning ?? "", /above the channel cap of 100 bytes/);
}

void run();
