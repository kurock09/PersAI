import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeOutputArtifact,
  RuntimeSandboxJobRequest,
  RuntimeSandboxJobResult,
  RuntimeToolPolicy
} from "@persai/runtime-contract";
import { RuntimeAssistantFileRegistryService } from "../src/modules/turns/runtime-assistant-file-registry.service";
import { RuntimeFilesToolService } from "../src/modules/turns/runtime-files-tool.service";

function createBundle(overrides?: {
  artifactMimeAllowlist?: string[];
  webMaxOutboundBytes?: number;
  telegramMaxOutboundBytes?: number;
  maxArtifactSendCountPerTurn?: number;
  toolPolicies?: RuntimeToolPolicy[];
}): AssistantRuntimeBundle {
  const defaultFilesPolicy: RuntimeToolPolicy = {
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
  };
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
      toolPolicies: overrides?.toolPolicies ?? [defaultFilesPolicy]
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
    fileRef: "file-ref-generated-1",
    file: {
      fileRef: "file-ref-generated-1",
      origin: "runtime_output",
      sourceToolCode: null,
      objectKey: "assistant-media/runtime-output/generated.png",
      relativePath: "artifacts/artifact-1/generated.png",
      displayName: "generated.png",
      mimeType: "image/png",
      sizeBytes: 128,
      logicalSizeBytes: 128
    },
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
      metadata: {
        semanticSummary: "Quarterly revenue report for the EMEA region.",
        semanticSummarySource: "generation_request"
      },
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
      id: "file-ref-uploaded-pdf",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      origin: "uploaded_attachment" as const,
      sourceToolCode: null,
      objectKey: "assistant-media/uploads/tz/TZ.pdf",
      relativePath: "uploads/bdf7ec74-23fa-4a47-98cd-8ccb3726d92a/TZ.pdf",
      displayName: "ТЗ.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(2048),
      logicalSizeBytes: BigInt(2048),
      sha256: null,
      metadata: null,
      createdAt: new Date("2026-04-19T12:02:30.000Z")
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
    },
    {
      id: "file-ref-artifact-copy",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      origin: "runtime_output" as const,
      sourceToolCode: null,
      objectKey: "assistant-media/runtime-output/hello-copy.txt",
      relativePath: "artifacts/64b30d1b-c01b-4bc0-874c-f65de135b8b6/hello.txt",
      displayName: "hello.txt",
      mimeType: "text/plain",
      sizeBytes: BigInt(21),
      logicalSizeBytes: BigInt(21),
      sha256: null,
      metadata: null,
      createdAt: new Date("2026-04-19T12:03:30.000Z")
    },
    {
      id: "file-ref-generated-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      sandboxJobId: null,
      origin: "runtime_output" as const,
      sourceToolCode: null,
      objectKey: "assistant-media/runtime-output/generated.png",
      relativePath: "artifacts/artifact-1/generated.png",
      displayName: "generated.png",
      mimeType: "image/png",
      sizeBytes: BigInt(128),
      logicalSizeBytes: BigInt(128),
      sha256: null,
      metadata: null,
      createdAt: new Date("2026-04-19T12:04:00.000Z")
    }
  ];
  const prisma = {
    assistantFile: {
      async findMany(input?: {
        where?: {
          id?: { in: string[] };
          assistantId?: string;
          workspaceId?: string;
          OR?: Array<Record<string, unknown>>;
        };
        take?: number;
      }) {
        const ids = input?.where?.id?.in;
        if (ids === undefined) {
          const filtered = canonicalRows.filter((row) => {
            if (
              input?.where?.assistantId !== undefined &&
              input.where.assistantId !== row.assistantId
            ) {
              return false;
            }
            if (
              input?.where?.workspaceId !== undefined &&
              input.where.workspaceId !== row.workspaceId
            ) {
              return false;
            }
            if (input?.where?.OR === undefined) {
              return true;
            }
            const queries = input.where.OR.flatMap((condition) =>
              Object.values(condition).flatMap((value) => {
                if (value !== null && typeof value === "object" && "contains" in value) {
                  return [String((value as { contains: unknown }).contains).toLowerCase()];
                }
                return [];
              })
            );
            return queries.some((query) =>
              [
                row.id,
                row.displayName ?? "",
                row.relativePath,
                row.objectKey,
                typeof row.metadata?.semanticSummary === "string"
                  ? row.metadata.semanticSummary
                  : ""
              ].some((value) => value.toLowerCase().includes(query))
            );
          });
          return input?.take === undefined ? filtered : filtered.slice(0, input.take);
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
  const mediaObjectStorage = {
    objects: new Map<string, Buffer>([
      ["assistant-media/runtime-output/generated.png", Buffer.from("fake-png-bytes")],
      ["assistant-media/uploads/tz/TZ.pdf", Buffer.from("fake-pdf-bytes")]
    ]),
    async downloadObject(objectKey: string) {
      return this.objects.get(objectKey) ?? null;
    }
  };
  const registry = new RuntimeAssistantFileRegistryService(
    prisma as never,
    mediaObjectStorage as never
  );
  const sandboxClientService = new FakeSandboxClientService();
  const service = new RuntimeFilesToolService(
    registry,
    sandboxClientService as never,
    {
      async consumeToolDailyLimit() {
        return { allowed: true, currentCount: 0, limit: 10 };
      },
      async extractAssistantFileText(input: { fileRef: string }) {
        return {
          extracted: true,
          file: {
            fileRef: input.fileRef,
            displayName: "ТЗ.pdf",
            relativePath: "uploads/bdf7ec74-23fa-4a47-98cd-8ccb3726d92a/TZ.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048
          },
          text: "Extracted PDF text",
          markdown: null,
          note: null,
          provider: null,
          quality: {
            status: "ok",
            score: 0.95,
            reasonCodes: [],
            textChars: 18
          },
          cached: false
        };
      }
    } as never,
    mediaObjectStorage as never
  );

  function toRuntimeFileRefWithAliases(
    rowId: string,
    aliases: string[],
    fileOverrides?: { mimeType?: string; sizeBytes?: number }
  ) {
    const row = canonicalRows.find((entry) => entry.id === rowId);
    assert.ok(row !== undefined);
    return {
      ...registry.toRuntimeFileRef({
        fileRef: row.id,
        assistantId: row.assistantId,
        workspaceId: row.workspaceId,
        sandboxJobId: row.sandboxJobId,
        origin: row.origin,
        sourceToolCode: row.sourceToolCode,
        objectKey: row.objectKey,
        relativePath: row.relativePath,
        displayName: row.displayName,
        mimeType: fileOverrides?.mimeType ?? row.mimeType,
        sizeBytes: fileOverrides?.sizeBytes ?? Number(row.sizeBytes),
        logicalSizeBytes: row.logicalSizeBytes === null ? null : Number(row.logicalSizeBytes),
        sha256: row.sha256,
        metadata: row.metadata,
        createdAt: row.createdAt
      }),
      aliases
    };
  }

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
  assert.equal(
    searchResult.payload.items[0]?.semanticSummaryHint,
    "Quarterly revenue report for the EMEA region."
  );
  assert.deepEqual(
    searchResult.payload.items[0]?.aliases,
    ["file #1"],
    "ADR-112 Slice 5: search items get sticky file alias"
  );
  assert.equal(searchResult.payload.item?.aliases?.[0], "file #1");
  assert.ok(
    Array.isArray(searchResult.discoveredFileRefs) && searchResult.discoveredFileRefs.length > 0,
    "ADR-100 follow-up: search returns non-empty discoveredFileRefs"
  );
  assert.equal(searchResult.discoveredFileRefs?.[0]?.fileRef, "file-ref-1");
  assert.deepEqual(
    searchResult.discoveredFileRefs?.[0]?.aliases,
    ["file #1"],
    "ADR-100 follow-up: discoveredFileRefs aliases match items aliases"
  );

  const semanticSearchResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-search-semantic",
      name: "files",
      arguments: {
        action: "search",
        query: "EMEA region"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-1",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(semanticSearchResult.isError, false);
  assert.equal(semanticSearchResult.payload.items[0]?.fileRef, "file-ref-1");

  const imageSearchResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-search-image",
      name: "files",
      arguments: {
        action: "search",
        query: "generated.png"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-1z",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(imageSearchResult.isError, false);
  assert.equal(imageSearchResult.payload.items[0]?.fileRef, "file-ref-generated-1");
  assert.deepEqual(
    imageSearchResult.payload.items[0]?.aliases,
    ["image #1", "file #1"],
    "ADR-112 Slice 5: image search items get both sticky image and file aliases"
  );
  assert.deepEqual(imageSearchResult.discoveredFileRefs?.[0]?.aliases, ["image #1", "file #1"]);

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
  assert.match(listUploadsRecursive.payload.content ?? "", /ТЗ\.pdf/);
  assert.doesNotMatch(
    listUploadsRecursive.payload.content ?? "",
    /94ec8468-10ce-4761-9065-2498de7130ee/
  );
  assert.deepEqual(listUploadsRecursive.payload.fileRefs, ["file-ref-kb", "file-ref-uploaded-pdf"]);
  assert.equal(
    listUploadsRecursive.payload.items[0]?.relativePath,
    "uploads/94ec8468-10ce-4761-9065-2498de7130ee/KB.txt"
  );

  const readUploadedPdfByQuery = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-read-uploaded-pdf",
      name: "files",
      arguments: {
        action: "read",
        query: "ТЗ"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-1c",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(readUploadedPdfByQuery.isError, false);
  assert.equal(readUploadedPdfByQuery.payload.action, "read");
  assert.equal(readUploadedPdfByQuery.payload.item?.fileRef, "file-ref-uploaded-pdf");
  assert.equal(readUploadedPdfByQuery.payload.content, "Extracted PDF text");
  assert.equal(readUploadedPdfByQuery.payload.charCount, 18);
  assert.equal(readUploadedPdfByQuery.payload.truncated, false);
  assert.deepEqual(readUploadedPdfByQuery.payload.extractionQuality, {
    status: "ok",
    score: 0.95,
    reasonCodes: [],
    textChars: 18
  });
  assert.equal(readUploadedPdfByQuery.payload.extractionCached, false);
  assert.match(readUploadedPdfByQuery.payload.warning ?? "", /Extracted text/);
  assert.deepEqual(
    readUploadedPdfByQuery.payload.item?.aliases,
    ["file #1"],
    "ADR-112 Slice 5: read on a non-image registry file gets a sticky file alias"
  );
  assert.equal(readUploadedPdfByQuery.discoveredFileRefs?.length, 1);
  assert.equal(readUploadedPdfByQuery.discoveredFileRefs?.[0]?.fileRef, "file-ref-uploaded-pdf");
  assert.deepEqual(readUploadedPdfByQuery.discoveredFileRefs?.[0]?.aliases, ["file #1"]);
  assert.equal(sandboxClientService.calls.length, 0);

  const ambiguousGet = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-get-ambiguous",
      name: "files",
      arguments: {
        action: "get",
        query: "hello"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-1d",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(ambiguousGet.isError, true);
  assert.equal(ambiguousGet.payload.reason, "ambiguous_file_query");
  assert.deepEqual(
    ambiguousGet.payload.items.map((item) => item.fileRef),
    ["file-ref-root", "file-ref-artifact"]
  );

  const readResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-read",
      name: "files",
      arguments: {
        action: "read",
        alias: "file #1"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-2",
    currentArtifacts: [],
    currentFileRefs: [],
    availableWorkingFileRefs: [toRuntimeFileRefWithAliases("file-ref-1", ["file #1"])],
    channel: "web"
  });
  assert.equal(readResult.isError, false);
  assert.equal(readResult.payload.requestedAction, "read");
  assert.equal(readResult.payload.action, "read");
  assert.equal(readResult.payload.content, "file body");
  assert.equal(sandboxClientService.calls.at(-1)?.toolCode, "files");
  assert.equal(sandboxClientService.calls.at(-1)?.args.action, "read");
  assert.equal(sandboxClientService.calls.at(-1)?.args.fileRef, "file-ref-1");
  assert.equal(sandboxClientService.calls.at(-1)?.args.path, "reports/report.txt");
  assert.deepEqual(sandboxClientService.calls.at(-1)?.mountedFileRefs, ["file-ref-1"]);

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
  const generatedFileRefRow = canonicalRows.find((row) => row.id === currentArtifact.fileRef);
  assert.ok(generatedFileRefRow !== undefined);
  const sendCurrentGeneratedFile = await service.executeToolCall({
    bundle: createBundle({
      artifactMimeAllowlist: ["image/png"],
      maxArtifactSendCountPerTurn: 1
    }),
    toolCall: {
      id: "tool-call-send-artifact",
      name: "files",
      arguments: {
        action: "send",
        aliases: ["image #1"],
        caption: "Updated caption"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-3",
    currentArtifacts: [currentArtifact],
    currentFileRefs: [toRuntimeFileRefWithAliases(generatedFileRefRow.id, ["image #1"])],
    availableWorkingFileRefs: [
      {
        ...toRuntimeFileRefWithAliases(generatedFileRefRow.id, ["image #1"]),
        aliases: ["image #1", "file #1"]
      }
    ],
    channel: "web"
  });
  assert.equal(sendCurrentGeneratedFile.isError, false);
  assert.equal(sendCurrentGeneratedFile.payload.requestedAction, "send");
  assert.equal(sendCurrentGeneratedFile.payload.action, "queued");
  assert.equal(sendCurrentGeneratedFile.artifacts.length, 1);
  assert.equal(sendCurrentGeneratedFile.artifacts[0]?.fileRef, currentArtifact.fileRef);
  assert.equal(sendCurrentGeneratedFile.artifacts[0]?.caption, "Updated caption");

  const sendAliasedFile = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-send-aliased-file",
      name: "files",
      arguments: {
        action: "send",
        aliases: ["file #1"],
        caption: "Sandbox output",
        filename: "custom-report.txt"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4",
    currentArtifacts: [],
    currentFileRefs: [],
    availableWorkingFileRefs: [toRuntimeFileRefWithAliases("file-ref-1", ["file #1"])],
    channel: "web"
  });
  assert.equal(sendAliasedFile.isError, false);
  assert.equal(sendAliasedFile.payload.action, "queued");
  assert.equal(sendAliasedFile.artifacts.length, 1);
  assert.equal(sendAliasedFile.artifacts[0]?.kind, "file");
  assert.equal(
    sendAliasedFile.artifacts[0]?.objectKey,
    "assistant-media/uploads/file-ref-1/report.txt"
  );
  assert.equal(sendAliasedFile.artifacts[0]?.filename, "custom-report.txt");
  assert.equal(sendAliasedFile.artifacts[0]?.caption, "Sandbox output");

  const getPrefersStickyAliases = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-get-sticky-aliases",
      name: "files",
      arguments: {
        action: "get",
        alias: "file #1"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4-sticky",
    currentArtifacts: [],
    currentFileRefs: [
      toRuntimeFileRefWithAliases("file-ref-1", ["current file #1", "file #1", "recent file #1"])
    ],
    availableWorkingFileRefs: [toRuntimeFileRefWithAliases("file-ref-1", ["file #1"])],
    channel: "web"
  });
  assert.equal(getPrefersStickyAliases.isError, false);
  assert.deepEqual(getPrefersStickyAliases.payload.item?.aliases, ["file #1"]);
  assert.equal(getPrefersStickyAliases.payload.action, "fetched");
  const getInspectContent = JSON.parse(getPrefersStickyAliases.payload.content ?? "{}") as {
    capabilities: string[];
    effectiveMaxPreviewBytes: number;
  };
  assert.deepEqual(getInspectContent.capabilities, ["text"]);
  assert.equal(getInspectContent.effectiveMaxPreviewBytes, 8_388_608);

  const inspectImage = await service.executeToolCall({
    bundle: createBundle({
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
          dailyCallLimit: null,
          maxFilePreviewBytes: 256,
          maxFilePreviewEdgePx: 512
        }
      ]
    }),
    toolCall: {
      id: "tool-call-inspect-image",
      name: "files",
      arguments: {
        action: "inspect",
        alias: "image #1"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-inspect-image",
    currentArtifacts: [],
    currentFileRefs: [
      toRuntimeFileRefWithAliases("file-ref-generated-1", ["image #1"], {
        mimeType: "image/png",
        sizeBytes: 128
      })
    ],
    availableWorkingFileRefs: [
      toRuntimeFileRefWithAliases("file-ref-generated-1", ["image #1"], {
        mimeType: "image/png",
        sizeBytes: 128
      })
    ],
    channel: "web"
  });
  assert.equal(inspectImage.isError, false);
  assert.equal(inspectImage.payload.action, "inspected");
  const inspectImageContent = JSON.parse(inspectImage.payload.content ?? "{}") as {
    capabilities: string[];
    effectiveMaxPreviewBytes: number;
    effectiveMaxPreviewEdgePx: number;
  };
  assert.deepEqual(inspectImageContent.capabilities, ["visual"]);
  assert.equal(inspectImageContent.effectiveMaxPreviewBytes, 256);
  assert.equal(inspectImageContent.effectiveMaxPreviewEdgePx, 512);

  const previewImage = await service.executeToolCall({
    bundle: createBundle({
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
          dailyCallLimit: null,
          maxFilePreviewBytes: 256,
          maxFilePreviewEdgePx: 512
        }
      ]
    }),
    toolCall: {
      id: "tool-call-preview-image",
      name: "files",
      arguments: {
        action: "preview",
        alias: "image #1",
        instruction: "Describe the scene."
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-preview-image",
    currentArtifacts: [],
    currentFileRefs: [
      toRuntimeFileRefWithAliases("file-ref-generated-1", ["image #1"], {
        mimeType: "image/png",
        sizeBytes: 128
      })
    ],
    availableWorkingFileRefs: [
      toRuntimeFileRefWithAliases("file-ref-generated-1", ["image #1"], {
        mimeType: "image/png",
        sizeBytes: 128
      })
    ],
    channel: "web"
  });
  assert.equal(previewImage.isError, false);
  assert.equal(previewImage.payload.action, "previewed");
  assert.ok(previewImage.pendingFilePreviewBlocks !== undefined);
  assert.ok(previewImage.pendingFilePreviewBlocks!.length >= 2);
  assert.equal(previewImage.pendingFilePreviewBlocks![0]?.type, "text");
  assert.equal(previewImage.pendingFilePreviewBlocks![1]?.type, "image");
  const previewAck = JSON.parse(previewImage.payload.content ?? "{}") as {
    alias: string;
    mimeType: string;
    visualKind: string;
    instruction: string;
  };
  assert.equal(previewAck.alias, "image #1");
  assert.equal(previewAck.mimeType, "image/png");
  assert.equal(previewAck.visualKind, "image");
  assert.equal(previewAck.instruction, "Describe the scene.");

  const previewOversize = await service.executeToolCall({
    bundle: createBundle({
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
          dailyCallLimit: null,
          maxFilePreviewBytes: 64
        }
      ]
    }),
    toolCall: {
      id: "tool-call-preview-oversize",
      name: "files",
      arguments: {
        action: "preview",
        alias: "file #1"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-preview-oversize",
    currentArtifacts: [],
    currentFileRefs: [],
    availableWorkingFileRefs: [
      toRuntimeFileRefWithAliases("file-ref-uploaded-pdf", ["file #1"], {
        mimeType: "application/pdf",
        sizeBytes: 2048
      })
    ],
    channel: "web"
  });
  assert.equal(previewOversize.isError, true);
  assert.equal(previewOversize.payload.reason, "preview_size_limit");
  assert.equal(previewOversize.pendingFilePreviewBlocks, undefined);

  const previewUnsupported = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-preview-unsupported",
      name: "files",
      arguments: {
        action: "preview",
        alias: "file #1"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-preview-unsupported",
    currentArtifacts: [],
    currentFileRefs: [],
    availableWorkingFileRefs: [toRuntimeFileRefWithAliases("file-ref-1", ["file #1"])],
    channel: "web"
  });
  assert.equal(previewUnsupported.isError, true);
  assert.equal(previewUnsupported.payload.reason, "preview_unsupported");

  const sendWithMissingPluralAlias = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-send-missing-plural-alias",
      name: "files",
      arguments: {
        action: "send",
        aliases: ["file #1", "file #9"]
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4aa0",
    currentArtifacts: [],
    currentFileRefs: [],
    availableWorkingFileRefs: [toRuntimeFileRefWithAliases("file-ref-1", ["file #1"])],
    channel: "web"
  });
  assert.equal(sendWithMissingPluralAlias.isError, true);
  assert.equal(sendWithMissingPluralAlias.payload.action, "skipped");
  assert.equal(sendWithMissingPluralAlias.payload.reason, "file_alias_not_found");

  const sendAmbiguousDuplicateByQuery = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-send-duplicate-query",
      name: "files",
      arguments: {
        action: "send",
        query: "hello.txt"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4a",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(sendAmbiguousDuplicateByQuery.isError, true);
  assert.equal(sendAmbiguousDuplicateByQuery.payload.action, "skipped");
  assert.equal(sendAmbiguousDuplicateByQuery.payload.reason, "ambiguous_file_query");

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

  const sendAliasWithDefaultCap = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-send-alias-default-cap",
      name: "files",
      arguments: {
        action: "send",
        aliases: ["file #1"]
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-4b",
    currentArtifacts: [],
    currentFileRefs: [],
    availableWorkingFileRefs: [toRuntimeFileRefWithAliases("file-ref-1", ["file #1"])],
    channel: "web"
  });
  assert.equal(sendAliasWithDefaultCap.isError, false);
  assert.equal(sendAliasWithDefaultCap.payload.action, "queued");

  const missingGet = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-get-missing",
      name: "files",
      arguments: {
        action: "get",
        alias: "missing alias"
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
  assert.equal(missingGet.payload.reason, "file_alias_not_found");

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
        aliases: ["image #1"]
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-5",
    currentArtifacts: [currentArtifact],
    currentFileRefs: [],
    availableWorkingFileRefs: [toRuntimeFileRefWithAliases("file-ref-generated-1", ["image #1"])],
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
        aliases: ["image #1"]
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-6",
    currentArtifacts: [currentArtifact],
    currentFileRefs: [],
    availableWorkingFileRefs: [toRuntimeFileRefWithAliases("file-ref-generated-1", ["image #1"])],
    channel: "web"
  });
  assert.equal(blockedChannelBytes.isError, true);
  assert.equal(blockedChannelBytes.payload.action, "skipped");
  assert.equal(blockedChannelBytes.payload.reason, "channel_size_limit_exceeded");
  assert.match(blockedChannelBytes.payload.warning ?? "", /above the channel cap of 100 bytes/);

  const invalidAliasSend = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-invalid-alias-send",
      name: "files",
      arguments: {
        action: "send",
        alias: "file-ref-generated-by-model"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-7",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(invalidAliasSend.isError, true);
  assert.equal(invalidAliasSend.payload.action, "skipped");
  assert.equal(invalidAliasSend.payload.reason, "file_alias_not_found");

  // Multi-token search: query contains multiple tokens where the only signal
  // is `semanticSummary`. "EMEA" and "revenue" both appear in the semanticSummary
  // of file-ref-1 but neither appears in displayName or relativePath.
  const multiTokenSearchResult = await service.executeToolCall({
    bundle: createBundle(),
    toolCall: {
      id: "tool-call-search-multi-token",
      name: "files",
      arguments: {
        action: "search",
        query: "EMEA revenue quarterly"
      }
    } as ProviderGatewayToolCall,
    sessionId: "session-1",
    requestId: "request-multi-token-1",
    currentArtifacts: [],
    currentFileRefs: [],
    channel: "web"
  });
  assert.equal(multiTokenSearchResult.isError, false);
  assert.equal(multiTokenSearchResult.payload.action, "results");
  assert.equal(
    multiTokenSearchResult.payload.items[0]?.fileRef,
    "file-ref-1",
    "multi-token search must surface the file whose only signal is semanticSummary"
  );
}

void run();
