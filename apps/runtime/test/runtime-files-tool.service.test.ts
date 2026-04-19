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
        ...(overrides?.maxArtifactSendCountPerTurn === undefined
          ? {}
          : {
              maxArtifactSendCountPerTurn: overrides.maxArtifactSendCountPerTurn
            })
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
    const producedFiles =
      input.args.action === "delete"
        ? []
        : [
            {
              relativePath: "reports/report.txt",
              displayName: "report.txt",
              mimeType: "text/plain",
              sizeBytes: 64,
              logicalSizeBytes: 64,
              fileRef: {
                fileRef: "file-ref-1",
                origin: "uploaded_attachment" as const,
                sourceToolCode: "files",
                objectKey: "assistant-media/uploads/file-ref-1/report.txt",
                relativePath: "reports/report.txt",
                displayName: "report.txt",
                mimeType: "text/plain",
                sizeBytes: 64,
                logicalSizeBytes: 64
              }
            }
          ];
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
      files: producedFiles
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
  const canonicalRows = [
    {
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
    },
    {
      id: "file-ref-root",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      origin: "sandbox_output" as const,
      sourceToolCode: "files",
      objectKey: "assistant-media/runtime-output/hello_test.txt",
      relativePath: "hello_test.txt",
      displayName: "hello_test.txt",
      mimeType: "text/plain",
      sizeBytes: BigInt(17),
      logicalSizeBytes: BigInt(17),
      sha256: null,
      metadata: null,
      createdAt: new Date("2026-04-19T12:01:00.000Z")
    },
    {
      id: "file-ref-kb",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      origin: "uploaded_attachment" as const,
      sourceToolCode: null,
      objectKey: "assistant-media/uploads/kb/KB.txt",
      relativePath: "uploads/94ec8468-10ce-4761-9065-2498de7130ee/KB.txt",
      displayName: "KB.txt",
      mimeType: "text/plain",
      sizeBytes: BigInt(42),
      logicalSizeBytes: BigInt(42),
      sha256: null,
      metadata: null,
      createdAt: new Date("2026-04-19T12:02:00.000Z")
    },
    {
      id: "file-ref-artifact",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      origin: "sandbox_output" as const,
      sourceToolCode: "files",
      objectKey: "assistant-media/artifacts/file-ref-artifact/hello.txt",
      relativePath: "artifacts/2dc36f9f-6046-4e82-a081-2e7125c7e448/hello.txt",
      displayName: "hello.txt",
      mimeType: "text/plain",
      sizeBytes: BigInt(21),
      logicalSizeBytes: BigInt(21),
      sha256: null,
      metadata: null,
      createdAt: new Date("2026-04-19T12:03:00.000Z")
    }
  ];
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
          return canonicalRows;
        }
        if (ids.some((id) => id.includes("/"))) {
          throw new Error(
            "Inconsistent column data: Error creating UUID, invalid character: expected an optional prefix of urn:uuid: followed by [0-9a-fA-F-], found u at 1"
          );
        }
        return canonicalRows.filter((row) => ids.includes(row.id));
      },
      async findFirst(input?: {
        where?: {
          id?: string;
          relativePath?: string;
          assistantId?: string;
          workspaceId?: string;
        };
      }) {
        const where = input?.where;
        return (
          canonicalRows.find((row) => {
            if (where?.assistantId !== undefined && where.assistantId !== row.assistantId) {
              return false;
            }
            if (where?.workspaceId !== undefined && where.workspaceId !== row.workspaceId) {
              return false;
            }
            if (where?.id !== undefined) {
              return where.id === row.id;
            }
            if (where?.relativePath !== undefined) {
              return where.relativePath === row.relativePath;
            }
            return true;
          }) ?? null
        );
      }
    }
  };
  const registry = new RuntimeAssistantFileRegistryService(
    prisma as never,
    {
      async downloadObject() {
        return null;
      }
    } as never
  );
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

  const listRoot = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-list-root",
      name: "files",
      arguments: {
        action: "list"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-1a",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(listRoot.isError, false);
  assert.equal(listRoot.payload.action, "listed");
  assert.match(listRoot.payload.content ?? "", /Available entries in "\."/);
  assert.match(listRoot.payload.content ?? "", /Workspace folders: reports\//);
  assert.match(listRoot.payload.content ?? "", /Service folders: artifacts\/, uploads\//);
  assert.match(listRoot.payload.content ?? "", /Workspace:/);
  assert.match(listRoot.payload.content ?? "", /hello_test\.txt/);
  assert.deepEqual(listRoot.payload.fileRefs, ["file-ref-root"]);

  const listUploadsRecursive = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-list-uploads",
      name: "files",
      arguments: {
        action: "list",
        path: "uploads",
        recursive: true
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-1b",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(listUploadsRecursive.isError, false);
  assert.equal(listUploadsRecursive.payload.action, "listed");
  assert.match(listUploadsRecursive.payload.content ?? "", /Available files in "uploads"/);
  assert.match(listUploadsRecursive.payload.content ?? "", /Uploads:/);
  assert.match(listUploadsRecursive.payload.content ?? "", /KB\.txt/);
  assert.doesNotMatch(
    listUploadsRecursive.payload.content ?? "",
    /94ec8468-10ce-4761-9065-2498de7130ee/
  );
  assert.deepEqual(listUploadsRecursive.payload.fileRefs, ["file-ref-kb"]);
  assert.equal(
    listUploadsRecursive.payload.items[0]?.relativePath,
    "uploads/94ec8468-10ce-4761-9065-2498de7130ee/KB.txt"
  );

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

  const deleteResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-delete",
      name: "files",
      arguments: {
        action: "delete",
        path: "artifacts",
        recursive: true
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-1",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(deleteResult.isError, false);
  assert.equal(deleteResult.payload.requestedAction, "delete");
  assert.equal(deleteResult.payload.action, "deleted");
  assert.equal(deleteResult.payload.fileRefs.length, 0);
  assert.equal(sandboxClientService.calls.at(-1)?.args.action, "delete");
  assert.equal(sandboxClientService.calls.at(-1)?.args.path, "artifacts");
  assert.equal(sandboxClientService.calls.at(-1)?.args.recursive, true);

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

  const writeAndSendResult = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-write-and-send",
      name: "files",
      arguments: {
        action: "write_and_send",
        path: "reports/report.txt",
        content: "fresh sandbox output",
        caption: "Delivered in one step",
        filename: "report-one-step.txt"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4aa",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(writeAndSendResult.isError, false);
  assert.equal(writeAndSendResult.payload.requestedAction, "write_and_send");
  assert.equal(writeAndSendResult.payload.action, "written_and_queued");
  assert.equal(writeAndSendResult.payload.fileRefs[0], "file-ref-1");
  assert.equal(writeAndSendResult.artifacts.length, 1);
  assert.equal(writeAndSendResult.artifacts[0]?.filename, "report-one-step.txt");
  assert.equal(writeAndSendResult.artifacts[0]?.caption, "Delivered in one step");
  assert.equal(sandboxClientService.calls.at(-1)?.args.action, "write");

  const writeWithFilenameFallback = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-write-filename-fallback",
      name: "files",
      arguments: {
        action: "write",
        filename: "draft.txt",
        content: "saved from filename fallback"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4aaa",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(writeWithFilenameFallback.isError, false);
  assert.equal(writeWithFilenameFallback.payload.requestedAction, "write");
  assert.equal(writeWithFilenameFallback.payload.action, "written");
  assert.equal(sandboxClientService.calls.at(-1)?.args.action, "write");
  assert.equal(sandboxClientService.calls.at(-1)?.args.path, "draft.txt");

  const writeAndSendFilenameFallback = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-write-and-send-filename-fallback",
      name: "files",
      arguments: {
        action: "write_and_send",
        filename: "fallback-report.txt",
        content: "written from filename fallback",
        caption: "Fallback send"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4aab",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(writeAndSendFilenameFallback.isError, false);
  assert.equal(writeAndSendFilenameFallback.payload.requestedAction, "write_and_send");
  assert.equal(writeAndSendFilenameFallback.payload.action, "written_and_queued");
  assert.equal(writeAndSendFilenameFallback.artifacts[0]?.filename, "fallback-report.txt");
  assert.equal(writeAndSendFilenameFallback.artifacts[0]?.caption, "Fallback send");
  assert.equal(sandboxClientService.calls.at(-1)?.args.action, "write");
  assert.equal(sandboxClientService.calls.at(-1)?.args.path, "fallback-report.txt");

  const blockedWriteAndSend = await service.executeToolCall({
    bundle: createBundle({
      webMaxOutboundBytes: 10,
      maxArtifactSendCountPerTurn: 1
    }),
    toolCall: {
      id: "tool-call-write-and-send-blocked",
      name: "files",
      arguments: {
        action: "write_and_send",
        path: "reports/report.txt",
        content: "fresh sandbox output"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4ab",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(blockedWriteAndSend.isError, true);
  assert.equal(blockedWriteAndSend.payload.requestedAction, "write_and_send");
  assert.equal(blockedWriteAndSend.payload.action, "skipped");
  assert.equal(blockedWriteAndSend.payload.reason, "channel_size_limit_exceeded");
  assert.equal(blockedWriteAndSend.artifacts.length, 0);

  const sendFileRefWithDefaultCap = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-send-default-cap",
      name: "files",
      arguments: {
        action: "send",
        fileRefs: ["file-ref-1"]
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4b",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(sendFileRefWithDefaultCap.isError, false);
  assert.equal(sendFileRefWithDefaultCap.payload.action, "queued");

  const missingGet = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-get-missing",
      name: "files",
      arguments: {
        action: "get",
        fileRef: "missing-file-ref"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4c",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(missingGet.isError, true);
  assert.equal(missingGet.payload.action, "skipped");
  assert.equal(missingGet.payload.reason, "file_not_found");

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

  const invalidFileRefSend = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-invalid-file-ref-send",
      name: "files",
      arguments: {
        action: "send",
        fileRefs: ["uploads/94ec8468-10ce-4761-9065-2498de7130ee/KB.txt"]
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-7",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(invalidFileRefSend.isError, true);
  assert.equal(invalidFileRefSend.payload.action, "skipped");
  assert.equal(invalidFileRefSend.payload.reason, "files_failed");
  assert.match(invalidFileRefSend.payload.warning ?? "", /fileRefs are invalid/i);
}

void run();
