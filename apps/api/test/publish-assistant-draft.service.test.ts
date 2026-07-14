import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HttpStatus } from "@nestjs/common";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import type { AssistantRoleAssignmentOutcome } from "../src/modules/workspace-management/application/manage-assistant-roles.service";
import { PublishAssistantDraftService } from "../src/modules/workspace-management/application/publish-assistant-draft.service";

const ASSISTANT_ID = "00000000-0000-4000-8000-000000000101";
const OWNER_ID = "00000000-0000-4000-8000-000000000102";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000103";
const CURRENT_ROLE_ID = "00000000-0000-4000-8000-000000000104";
const TARGET_ROLE_ID = "00000000-0000-4000-8000-000000000105";

function createAssistant(userId = OWNER_ID) {
  return {
    id: ASSISTANT_ID,
    userId,
    workspaceId: WORKSPACE_ID,
    draftDisplayName: "PersAI Bot",
    draftInstructions: "Be helpful.",
    draftTraits: { warmth: 80 },
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftVoiceProfile: null,
    draftArchetypeKey: null,
    draftUpdatedAt: new Date("2026-07-14T08:00:00.000Z"),
    applyStatus: "succeeded" as const,
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    roleId: CURRENT_ROLE_ID,
    sandboxEgressMode: "restricted",
    createdAt: new Date("2026-07-14T08:00:00.000Z"),
    updatedAt: new Date("2026-07-14T08:00:00.000Z")
  };
}

function createPublishedVersion() {
  return {
    id: "published-1",
    assistantId: ASSISTANT_ID,
    version: 1,
    snapshotDisplayName: "PersAI Bot",
    snapshotInstructions: "Be helpful.",
    snapshotTraits: { warmth: 80 },
    snapshotAvatarEmoji: null,
    snapshotAvatarUrl: null,
    snapshotAssistantGender: null,
    snapshotVoiceProfile: null,
    snapshotArchetypeKey: null,
    snapshotVoiceDna: null,
    publishedByUserId: OWNER_ID,
    createdAt: new Date("2026-07-14T08:01:00.000Z")
  };
}

type HarnessOptions = {
  assistant?: ReturnType<typeof createAssistant>;
  roleOutcome?: AssistantRoleAssignmentOutcome;
  roleError?: Error;
  failPublishAudit?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const assistant = options.assistant ?? createAssistant();
  const publishedVersion = createPublishedVersion();
  const roleOutcome: AssistantRoleAssignmentOutcome = options.roleOutcome ?? {
    kind: "updated",
    value: { assistantId: ASSISTANT_ID, roleId: TARGET_ROLE_ID }
  };
  const calls: string[] = [];
  let committedVersion = false;
  let committedApplyPending = false;
  let transactionObject: object | null = null;
  let roleTransactionObject: object | null = null;
  let roleInput: Record<string, unknown> | null = null;

  const tx = {
    assistantPublishedVersion: {
      async findFirst() {
        calls.push("version:read");
        return null;
      },
      async create() {
        calls.push("version:create");
        return publishedVersion;
      }
    },
    assistantAuditEvent: {
      async create() {
        calls.push("publish:audit");
        if (options.failPublishAudit) {
          throw new Error("publish audit failed");
        }
      }
    },
    assistant: {
      async update() {
        calls.push("apply:pending");
        return assistant;
      }
    }
  };

  const prisma = {
    async $transaction<T>(callback: (client: typeof tx) => Promise<T>): Promise<T> {
      calls.push("transaction:begin");
      transactionObject = tx;
      try {
        const result = await callback(tx);
        if (calls.includes("version:create")) committedVersion = true;
        if (calls.includes("apply:pending")) committedApplyPending = true;
        calls.push("transaction:commit");
        return result;
      } catch (error) {
        calls.push("transaction:rollback");
        throw error;
      }
    }
  };

  const service = new PublishAssistantDraftService(
    prisma as never,
    {
      async findById() {
        return assistant;
      }
    } as never,
    {
      async findByAssistantId() {
        return null;
      }
    } as never,
    {
      async findLatestByAssistantId() {
        return null;
      }
    } as never,
    {
      async findByAssistantProviderSurface() {
        return null;
      }
    } as never,
    {
      async execute() {
        calls.push("materialize");
      }
    } as never,
    {
      async execute() {
        calls.push("apply");
      }
    } as never,
    {
      async resolveByAssistantId() {
        return null;
      }
    } as never,
    {} as never,
    {} as never,
    {
      async findByKey() {
        return null;
      }
    } as never,
    {
      async execute() {
        return {
          assistantId: assistant.id,
          workspaceId: assistant.workspaceId,
          assistant
        };
      }
    } as never,
    {
      parseAssistantId(value: unknown) {
        return String(value);
      },
      parseUpdateInput(value: { roleKey: unknown }) {
        return { roleKey: String(value.roleKey) };
      },
      async applyRoleSelectionInTransaction(
        client: object,
        input: Record<string, unknown>
      ): Promise<AssistantRoleAssignmentOutcome> {
        calls.push("role:apply");
        roleTransactionObject = client;
        roleInput = input;
        if (options.roleError) throw options.roleError;
        return roleOutcome;
      }
    } as never
  );

  return {
    service,
    calls,
    publishedVersion,
    get transactionObject() {
      return transactionObject;
    },
    get roleTransactionObject() {
      return roleTransactionObject;
    },
    get roleInput() {
      return roleInput;
    },
    get committedVersion() {
      return committedVersion;
    },
    get committedApplyPending() {
      return committedApplyPending;
    }
  };
}

const request = {
  assistantId: ASSISTANT_ID,
  expectedRoleKey: "persai_default",
  roleKey: "writer"
};

describe("PublishAssistantDraftService transaction", () => {
  test("passes the exact outer transaction and role assignment values before publish writes", async () => {
    const harness = createHarness();
    const result = await harness.service.execute(OWNER_ID, request);

    assert.equal(harness.roleTransactionObject, harness.transactionObject);
    assert.deepEqual(harness.roleInput, {
      assistantId: ASSISTANT_ID,
      workspaceId: WORKSPACE_ID,
      ownerUserId: OWNER_ID,
      actorUserId: OWNER_ID,
      expectedCurrentRoleId: CURRENT_ROLE_ID,
      expectedRoleKey: "persai_default",
      roleKey: "writer"
    });
    assert.deepEqual(harness.calls.slice(0, 6), [
      "transaction:begin",
      "role:apply",
      "version:read",
      "version:create",
      "publish:audit",
      "apply:pending"
    ]);
    assert.equal(result.latestPublishedVersion?.id, harness.publishedVersion.id);
  });

  test("publishes idempotently when expected and desired roles are the same", async () => {
    const harness = createHarness({
      roleOutcome: {
        kind: "updated",
        value: { assistantId: ASSISTANT_ID, roleId: CURRENT_ROLE_ID }
      }
    });
    await harness.service.execute(OWNER_ID, {
      assistantId: ASSISTANT_ID,
      expectedRoleKey: "persai_default",
      roleKey: "persai_default"
    });
    assert.equal(harness.committedVersion, true);
    assert.equal(harness.committedApplyPending, true);
  });

  test("returns stable conflict on retry and never publishes stale role state", async () => {
    const harness = createHarness({
      roleOutcome: { kind: "retry", currentRoleId: TARGET_ROLE_ID }
    });
    await assert.rejects(
      () => harness.service.execute(OWNER_ID, request),
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.getStatus() === HttpStatus.CONFLICT &&
        error.errorObject.code === "assistant_publish_role_conflict"
    );
    assert.deepEqual(harness.calls, ["transaction:begin", "role:apply", "transaction:commit"]);
    assert.equal(harness.committedVersion, false);
    assert.equal(harness.committedApplyPending, false);
  });

  test("continues publish only after an updated role assignment outcome", async () => {
    const harness = createHarness({
      roleOutcome: {
        kind: "updated",
        value: { assistantId: ASSISTANT_ID, roleId: TARGET_ROLE_ID }
      }
    });
    await harness.service.execute(OWNER_ID, request);
    assert.equal(harness.committedVersion, true);
    assert.equal(harness.committedApplyPending, true);
    assert.equal(harness.roleInput?.roleKey, "writer");
  });

  test("rolls back publish/version/apply-pending writes when the outer transaction fails", async () => {
    const harness = createHarness({ failPublishAudit: true });
    await assert.rejects(() => harness.service.execute(OWNER_ID, request), /publish audit failed/);
    assert.equal(harness.calls.at(-1), "transaction:rollback");
    assert.equal(harness.committedVersion, false);
    assert.equal(harness.committedApplyPending, false);
    assert.equal(harness.calls.includes("materialize"), false);
  });

  test("rejects invalid active target role before any publish write", async () => {
    const harness = createHarness({
      roleError: new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "assistant_role_invalid_key",
        category: "validation",
        message: "roleKey must reference an active Assistant Role."
      })
    });
    await assert.rejects(
      () => harness.service.execute(OWNER_ID, request),
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.errorObject.code === "assistant_role_invalid_key"
    );
    assert.equal(harness.calls.includes("version:create"), false);
    assert.equal(harness.calls.at(-1), "transaction:rollback");
  });

  test("denies a non-owner before opening the publish transaction", async () => {
    const harness = createHarness({ assistant: createAssistant("different-owner") });
    await assert.rejects(
      () => harness.service.execute(OWNER_ID, request),
      (error: unknown) =>
        error instanceof ApiErrorHttpException &&
        error.errorObject.code === "assistant_role_forbidden"
    );
    assert.deepEqual(harness.calls, []);
  });

  test("parses only the exact expected-role publish command", () => {
    const harness = createHarness();
    assert.deepEqual(harness.service.parseInput(request), request);
    assert.throws(() =>
      harness.service.parseInput({
        assistantId: ASSISTANT_ID,
        roleKey: "writer"
      })
    );
    assert.throws(() => harness.service.parseInput({ ...request, extra: true }));
  });
});
