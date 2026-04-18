import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import { RuntimeSendMediaToUserService } from "../src/modules/turns/runtime-send-media-to-user.service";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

type TurnExecutionStateTestAccess = {
  artifacts: RuntimeOutputArtifact[];
};

type TurnExecutionServiceTestAccess = {
  createTurnExecutionState(): TurnExecutionStateTestAccess;
  applyToolExecutionOutcome(
    turnState: TurnExecutionStateTestAccess,
    outcome: {
      exchange: {
        toolCall: {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
        toolResult: {
          toolCallId: string;
          name: string;
          content: string;
          isError: boolean;
        };
      };
      payload: {
        toolCode: string;
        executionMode: "inline";
        action: "queued";
        reason: null;
        warning: null;
        fileRefs: string[];
        artifactIds: string[];
        queuedArtifacts: number;
      };
      artifacts: RuntimeOutputArtifact[];
    }
  ): void;
};

function createBundle(overrides?: {
  maxArtifactSendCountPerTurn?: number;
  artifactMimeAllowlist?: string[];
  webMaxOutboundBytes?: number;
  telegramMaxOutboundBytes?: number;
}): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    },
    runtime: {
      sandbox: {
        enabled: true,
        artifactMimeAllowlist: overrides?.artifactMimeAllowlist ?? ["image/png", "text/plain"],
        webMaxOutboundBytes: overrides?.webMaxOutboundBytes ?? 10_000,
        telegramMaxOutboundBytes: overrides?.telegramMaxOutboundBytes ?? 10_000,
        maxArtifactSendCountPerTurn: overrides?.maxArtifactSendCountPerTurn ?? 1
      }
    },
    governance: {
      toolPolicies: [
        {
          toolCode: "send_media_to_user",
          executionMode: "inline",
          enabled: true,
          visibleToModel: true,
          usageRule: "allowed",
          dailyCallLimit: null
        }
      ]
    }
  } as AssistantRuntimeBundle;
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
  const service = new RuntimeSendMediaToUserService(
    {
      sandboxFileRef: {
        async findMany(input: {
          where: {
            id: { in: string[] };
            assistantId: string;
            workspaceId: string;
          };
        }) {
          assert.equal(input.where.assistantId, "assistant-1");
          assert.equal(input.where.workspaceId, "workspace-1");
          return input.where.id.in.includes("file-ref-1")
            ? [
                {
                  id: "file-ref-1",
                  objectKey: "assistant-media/sandbox/jobs/job-1/report.txt",
                  displayName: "report.txt",
                  relativePath: "reports/report.txt",
                  mimeType: "text/plain",
                  sizeBytes: BigInt(64)
                }
              ]
            : [];
        }
      }
    } as never,
    {
      async consumeToolDailyLimit() {
        return {
          allowed: true,
          currentCount: 1,
          limit: 10
        };
      }
    } as never
  );

  const currentArtifact = createArtifact();
  const queuedExistingArtifact = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-1",
      name: "send_media_to_user",
      arguments: {
        artifactIds: [currentArtifact.artifactId],
        caption: "Updated caption"
      }
    } as never,
    currentArtifacts: [currentArtifact],
    channel: "web"
  });

  assert.equal(queuedExistingArtifact.isError, false);
  assert.equal(queuedExistingArtifact.payload.action, "queued");
  assert.equal(queuedExistingArtifact.payload.reason, null);
  assert.equal(queuedExistingArtifact.artifacts.length, 1);
  assert.equal(queuedExistingArtifact.artifacts[0]?.artifactId, currentArtifact.artifactId);
  assert.equal(queuedExistingArtifact.artifacts[0]?.caption, "Updated caption");

  const queuedFileRef = await service.executeToolCall({
    bundle: createBundle({ maxArtifactSendCountPerTurn: 1 }),
    toolCall: {
      id: "tool-call-file-ref",
      name: "send_media_to_user",
      arguments: {
        fileRefs: ["file-ref-1"],
        caption: "Sandbox output",
        filename: "custom-report.txt"
      }
    } as never,
    currentArtifacts: [],
    channel: "web"
  });

  assert.equal(queuedFileRef.isError, false);
  assert.equal(queuedFileRef.payload.action, "queued");
  assert.equal(queuedFileRef.artifacts.length, 1);
  assert.equal(queuedFileRef.artifacts[0]?.kind, "file");
  assert.equal(
    queuedFileRef.artifacts[0]?.objectKey,
    "assistant-media/sandbox/jobs/job-1/report.txt"
  );
  assert.equal(queuedFileRef.artifacts[0]?.filename, "custom-report.txt");
  assert.equal(queuedFileRef.artifacts[0]?.caption, "Sandbox output");

  const blockedMime = await service.executeToolCall({
    bundle: createBundle({ artifactMimeAllowlist: ["text/plain"] }),
    toolCall: {
      id: "tool-call-2",
      name: "send_media_to_user",
      arguments: {
        artifactIds: [currentArtifact.artifactId]
      }
    } as never,
    currentArtifacts: [currentArtifact],
    channel: "web"
  });

  assert.equal(blockedMime.isError, true);
  assert.equal(blockedMime.payload.action, "skipped");
  assert.equal(blockedMime.payload.reason, "send_media_resolution_failed");
  assert.match(blockedMime.payload.warning ?? "", /Mime type "image\/png" is blocked/);

  const blockedChannelBytes = await service.executeToolCall({
    bundle: createBundle({ webMaxOutboundBytes: 100 }),
    toolCall: {
      id: "tool-call-3",
      name: "send_media_to_user",
      arguments: {
        artifactIds: [currentArtifact.artifactId]
      }
    } as never,
    currentArtifacts: [currentArtifact],
    channel: "web"
  });

  assert.equal(blockedChannelBytes.isError, true);
  assert.equal(blockedChannelBytes.payload.action, "skipped");
  assert.equal(blockedChannelBytes.payload.reason, "channel_size_limit_exceeded");
  assert.match(blockedChannelBytes.payload.warning ?? "", /above the channel cap of 100 bytes/);

  const empty = {} as never;
  const turnExecutionService = new TurnExecutionService(
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty
  );
  const turnExecutionTestAccess = turnExecutionService as unknown as TurnExecutionServiceTestAccess;
  const turnState = turnExecutionTestAccess.createTurnExecutionState();
  turnState.artifacts.push(currentArtifact);
  turnExecutionTestAccess.applyToolExecutionOutcome(turnState, {
    exchange: {
      toolCall: {
        id: "tool-call-4",
        name: "send_media_to_user",
        arguments: {}
      },
      toolResult: {
        toolCallId: "tool-call-4",
        name: "send_media_to_user",
        content: "{}",
        isError: false
      }
    },
    payload: {
      toolCode: "send_media_to_user",
      executionMode: "inline",
      action: "queued",
      reason: null,
      warning: null,
      fileRefs: [],
      artifactIds: [currentArtifact.artifactId],
      queuedArtifacts: 1
    },
    artifacts: [
      {
        ...currentArtifact,
        caption: "Updated caption"
      },
      createArtifact({
        artifactId: "artifact-2",
        kind: "file",
        objectKey: "assistant-media/sandbox/output.txt",
        mimeType: "text/plain",
        filename: "output.txt"
      })
    ]
  });

  assert.equal(turnState.artifacts.length, 2);
  assert.equal(turnState.artifacts[0]?.artifactId, currentArtifact.artifactId);
  assert.equal(turnState.artifacts[0]?.caption, "Updated caption");
  assert.equal(turnState.artifacts[1]?.artifactId, "artifact-2");
}

void run();
