import assert from "node:assert/strict";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { ManageWorkspaceVideoClonedVoicesService } from "../src/modules/workspace-management/application/heygen/manage-workspace-video-cloned-voices.service";
import type {
  WorkspaceVideoClonedVoiceRecord,
  WorkspaceVideoClonedVoiceRepository
} from "../src/modules/workspace-management/domain/workspace-video-cloned-voice.repository";
import type { WorkspaceVcoinBalanceRepository } from "../src/modules/workspace-management/domain/workspace-vcoin-balance.repository";
import type { WorkspaceVcoinLedgerEventRepository } from "../src/modules/workspace-management/domain/workspace-vcoin-ledger-event.repository";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

function makeAudioBuffer(): Buffer {
  return Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21]);
}

function makeRow(
  overrides: Partial<WorkspaceVideoClonedVoiceRecord> = {}
): WorkspaceVideoClonedVoiceRecord {
  const now = new Date("2026-06-07T15:00:00.000Z");
  return {
    id: "00000000-0000-0000-0000-000000000101",
    workspaceId: WORKSPACE_ID,
    displayName: "Brand Voice",
    displayNameLower: "brand voice",
    heygenVoiceCloneId: null,
    languageHint: "en",
    status: "pending",
    isDefault: false,
    previewAudioUrl: null,
    sourceMetadata: {},
    archived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makeHarness(options?: {
  limit?: number;
  cost?: number;
  balanceVc?: number;
  providerFailure?: Error;
  providerResult?: { voiceCloneId: string; previewAudioUrl: string | null };
  seedRows?: WorkspaceVideoClonedVoiceRecord[];
  failFinalizeDebit?: boolean;
  failConfigDirtyMark?: boolean;
}) {
  const limit = options?.limit ?? 5;
  const cost = options?.cost ?? 50;
  const state = {
    rows: [...(options?.seedRows ?? [])],
    balanceVc: options?.balanceVc ?? 120,
    ledgerEvents: [] as Array<{ kind: string; amountVc: number; referenceKey: string }>,
    providerCalls: 0,
    debitCalls: 0,
    configDirtyMarks: 0
  };

  const repo: WorkspaceVideoClonedVoiceRepository = {
    async countActiveForWorkspace(workspaceId: string) {
      return state.rows.filter((row) => row.workspaceId === workspaceId && !row.archived).length;
    },
    async findActiveByLowerName(workspaceId: string, lowerName: string) {
      return (
        state.rows.find(
          (row) =>
            row.workspaceId === workspaceId && row.displayNameLower === lowerName && !row.archived
        ) ?? null
      );
    },
    async findById(workspaceId: string, clonedVoiceId: string) {
      return (
        state.rows.find((row) => row.workspaceId === workspaceId && row.id === clonedVoiceId) ??
        null
      );
    },
    async listActive(workspaceId: string) {
      return state.rows.filter((row) => row.workspaceId === workspaceId && !row.archived);
    },
    async create(input) {
      const row = makeRow({
        id: input.id,
        workspaceId: input.workspaceId,
        displayName: input.displayName,
        displayNameLower: input.displayNameLower,
        languageHint: input.languageHint ?? null,
        status: input.status ?? "pending",
        isDefault: input.isDefault ?? false,
        previewAudioUrl: input.previewAudioUrl ?? null,
        sourceMetadata:
          (input.sourceMetadata as WorkspaceVideoClonedVoiceRecord["sourceMetadata"]) ?? {}
      });
      state.rows.push(row);
      return row;
    },
    async update(input) {
      const row = state.rows.find(
        (entry) =>
          entry.workspaceId === input.workspaceId &&
          entry.id === input.clonedVoiceId &&
          !entry.archived
      );
      if (row === undefined) {
        return null;
      }
      if (input.heygenVoiceCloneId !== undefined) row.heygenVoiceCloneId = input.heygenVoiceCloneId;
      if (input.languageHint !== undefined) row.languageHint = input.languageHint;
      if (input.status !== undefined) row.status = input.status;
      if (input.isDefault !== undefined) row.isDefault = input.isDefault;
      if (input.previewAudioUrl !== undefined) row.previewAudioUrl = input.previewAudioUrl;
      if (input.sourceMetadata !== undefined) {
        row.sourceMetadata =
          input.sourceMetadata as WorkspaceVideoClonedVoiceRecord["sourceMetadata"];
      }
      row.updatedAt = new Date();
      return row;
    },
    async setDefault(workspaceId: string, clonedVoiceId: string) {
      const target = state.rows.find(
        (row) => row.workspaceId === workspaceId && row.id === clonedVoiceId && !row.archived
      );
      if (target === undefined) {
        return null;
      }
      for (const row of state.rows) {
        if (row.workspaceId === workspaceId && !row.archived) {
          row.isDefault = row.id === clonedVoiceId;
        }
      }
      return target;
    },
    async archive(workspaceId: string, clonedVoiceId: string) {
      const row = state.rows.find(
        (entry) => entry.workspaceId === workspaceId && entry.id === clonedVoiceId
      );
      if (row === undefined) {
        return null;
      }
      row.archived = true;
      row.archivedAt = new Date();
      row.isDefault = false;
      return row;
    }
  };

  const balanceRepo: WorkspaceVcoinBalanceRepository = {
    async getOrCreate() {
      return { workspaceId: WORKSPACE_ID, balanceVc: state.balanceVc };
    },
    async credit() {
      return { workspaceId: WORKSPACE_ID, balanceVc: state.balanceVc };
    },
    async debit() {
      state.debitCalls += 1;
      return { workspaceId: WORKSPACE_ID, balanceVc: state.balanceVc };
    }
  };

  const ledgerRepo: WorkspaceVcoinLedgerEventRepository = {
    async recordEvent(input) {
      state.ledgerEvents.push({
        kind: input.kind,
        amountVc: input.amountVc,
        referenceKey: input.referenceKey
      });
      return { recorded: true };
    }
  };

  const prisma = {
    async $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
      return fn(prisma);
    },
    workspaceVcoinBalance: {
      async updateMany(args: {
        where: { balanceVc: { gte: number } };
        data: { balanceVc: { decrement: number } };
      }) {
        if (options?.failFinalizeDebit === true || state.balanceVc < args.where.balanceVc.gte) {
          return { count: 0 };
        }
        state.balanceVc -= args.data.balanceVc.decrement;
        state.debitCalls += 1;
        return { count: 1 };
      },
      async findUnique() {
        return { workspaceId: WORKSPACE_ID, balanceVc: state.balanceVc };
      }
    },
    assistant: {
      async updateMany() {
        if (options?.failConfigDirtyMark === true) {
          throw new Error("config-dirty write failed");
        }
        state.configDirtyMarks += 1;
        return { count: 1 };
      }
    }
  };

  const service = new ManageWorkspaceVideoClonedVoicesService(
    repo,
    balanceRepo,
    ledgerRepo,
    {
      async execute() {
        return {
          heygenVoiceCloneWorkspaceLimit: limit,
          heygenVoiceCloneCreationVcoin: cost
        };
      }
    } as never,
    prisma as never,
    {
      async createVoiceClone() {
        state.providerCalls += 1;
        if (options?.providerFailure !== undefined) {
          throw options.providerFailure;
        }
        return (
          options?.providerResult ?? {
            voiceCloneId: "heygen-clone-1",
            previewAudioUrl: "https://cdn.heygen.com/clone-preview.mp3"
          }
        );
      }
    } as never
  );

  return { service, state };
}

async function run(): Promise<void> {
  // Test 1: successful clone becomes ready and debits exactly once.
  {
    const { service, state } = makeHarness();
    const result = await service.createClonedVoice({
      workspaceId: WORKSPACE_ID,
      displayName: "Brand Voice",
      audioFile: {
        buffer: makeAudioBuffer(),
        mimeType: "audio/mpeg",
        originalFilename: "voice.mp3"
      },
      languageHint: "en",
      removeBackgroundNoise: true
    });
    assert.equal(state.providerCalls, 1);
    assert.equal(state.debitCalls, 1);
    assert.equal(state.ledgerEvents.length, 1);
    assert.equal(state.ledgerEvents[0]?.kind, "voice_clone_creation");
    assert.equal(result.clonedVoice.status, "ready");
    assert.equal(result.walletBalanceVc, 70);
    assert.equal(state.rows[0]?.status, "ready");
    assert.equal(state.rows[0]?.heygenVoiceCloneId, "heygen-clone-1");
    console.log("✓ Test 1: success marks cloned voice ready and debits VC once");
  }

  // Test 2: failed provider clone marks row failed and does not debit.
  {
    const { service, state } = makeHarness({
      providerFailure: new ServiceUnavailableException({
        error: { code: "heygen_unavailable", message: "HeyGen unavailable" }
      })
    });
    await assert.rejects(
      () =>
        service.createClonedVoice({
          workspaceId: WORKSPACE_ID,
          displayName: "Broken Voice",
          audioFile: {
            buffer: makeAudioBuffer(),
            mimeType: "audio/mpeg",
            originalFilename: "voice.mp3"
          }
        }),
      (error: unknown) => error instanceof ServiceUnavailableException
    );
    assert.equal(state.debitCalls, 0);
    assert.equal(state.ledgerEvents.length, 0);
    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0]?.status, "failed");
    console.log("✓ Test 2: failed clone stores failed row and does not debit VC");
  }

  // Test 3: workspace limit is enforced before provider call.
  {
    const { service, state } = makeHarness({
      limit: 1,
      seedRows: [makeRow({ id: "00000000-0000-0000-0000-000000000201", status: "ready" })]
    });
    await assert.rejects(
      () =>
        service.createClonedVoice({
          workspaceId: WORKSPACE_ID,
          displayName: "Second Voice",
          audioFile: {
            buffer: makeAudioBuffer(),
            mimeType: "audio/mpeg",
            originalFilename: "voice.mp3"
          }
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = error.getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "cloned_voice_limit_reached");
        return true;
      }
    );
    assert.equal(state.providerCalls, 0);
    console.log("✓ Test 3: create enforces workspace cloned-voice limit");
  }

  // Test 4: duplicate name is enforced before provider call.
  {
    const { service, state } = makeHarness({
      seedRows: [
        makeRow({
          id: "00000000-0000-0000-0000-000000000202",
          displayName: "Existing Voice",
          displayNameLower: "existing voice",
          status: "ready"
        })
      ]
    });
    await assert.rejects(
      () =>
        service.createClonedVoice({
          workspaceId: WORKSPACE_ID,
          displayName: "Existing Voice",
          audioFile: {
            buffer: makeAudioBuffer(),
            mimeType: "audio/mpeg",
            originalFilename: "voice.mp3"
          }
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = error.getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "cloned_voice_duplicate_name");
        return true;
      }
    );
    assert.equal(state.providerCalls, 0);
    console.log("✓ Test 4: create enforces duplicate cloned-voice name");
  }

  // Test 5: archive is a soft delete.
  {
    const existing = makeRow({ id: "00000000-0000-0000-0000-000000000301", status: "ready" });
    const { service, state } = makeHarness({ seedRows: [existing] });
    const result = await service.archiveClonedVoice({
      workspaceId: WORKSPACE_ID,
      clonedVoiceId: existing.id
    });
    assert.equal(result.archived, true);
    assert.equal(state.rows[0]?.archived, true);
    assert.equal(state.configDirtyMarks, 1);
    console.log("✓ Test 5: delete archives the cloned voice and marks assistants config-dirty");
  }

  // Test 6: archive still succeeds when config-dirty marking fails.
  {
    const existing = makeRow({ id: "00000000-0000-0000-0000-000000000302", status: "ready" });
    const { service, state } = makeHarness({
      seedRows: [existing],
      failConfigDirtyMark: true
    });
    const result = await service.archiveClonedVoice({
      workspaceId: WORKSPACE_ID,
      clonedVoiceId: existing.id
    });
    assert.equal(result.archived, true);
    assert.equal(state.rows[0]?.archived, true);
    assert.equal(state.configDirtyMarks, 0);
    console.log("✓ Test 6: archive remains successful when assistants config-dirty marking fails");
  }

  // Test 7: set-default leaves exactly one active default.
  {
    const first = makeRow({
      id: "00000000-0000-0000-0000-000000000401",
      displayName: "Voice One",
      displayNameLower: "voice one",
      status: "ready",
      isDefault: true
    });
    const second = makeRow({
      id: "00000000-0000-0000-0000-000000000402",
      displayName: "Voice Two",
      displayNameLower: "voice two",
      status: "ready",
      isDefault: false
    });
    const { service, state } = makeHarness({ seedRows: [first, second] });
    const result = await service.setDefaultClonedVoice({
      workspaceId: WORKSPACE_ID,
      clonedVoiceId: second.id
    });
    assert.equal(result.clonedVoice.id, second.id);
    const activeDefaults = state.rows.filter((row) => !row.archived && row.isDefault);
    assert.equal(activeDefaults.length, 1);
    assert.equal(activeDefaults[0]?.id, second.id);
    console.log("✓ Test 7: set-default keeps exactly one active default");
  }

  // Test 8: set-default rejects missing rows.
  {
    const { service } = makeHarness();
    await assert.rejects(
      () =>
        service.setDefaultClonedVoice({
          workspaceId: WORKSPACE_ID,
          clonedVoiceId: "00000000-0000-0000-0000-000000000999"
        }),
      (error: unknown) => error instanceof NotFoundException
    );
    console.log("✓ Test 8: set-default rejects missing cloned voices");
  }

  console.log("manage-workspace-video-cloned-voices.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
