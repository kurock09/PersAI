/**
 * ADR-109 Slice 5 / Slice 5b — focused unit tests for ManageWorkspaceVideoPersonasService.
 *
 * All external dependencies are stubbed in-memory; no Prisma client is used.
 *
 * Coverage (Slice 5 — original):
 *  1. Happy-path create — VC debit + ledger event + persona row inserted with heygenAvatarId
 *  2. Persona limit reached → throws persona_limit_reached (pre-check fires, HeyGen never called)
 *  3. Duplicate name (case-insensitive) → throws persona_duplicate_name (pre-check fires, HeyGen never called)
 *  4. Voice not found in cached shortlist → throws voice_not_found
 *  5. Insufficient VC balance → throws vcoin_balance_exhausted (pre-check fires, HeyGen never called)
 *  6. Archive (soft-delete) sets archived=true with archivedAt
 *  7. Archive of non-existent persona → throws NotFoundException
 *  8. cost=0 → skips ledger + debit entirely
 *  9. Storage save runs AFTER transaction commits (spy confirms ordering)
 *
 * Coverage (Slice 5b — new):
 * 10. HeyGen call fails → persona NOT created, no ledger event, no VC debit, exception propagated
 * 11. HeyGen succeeds but tx fails (race — duplicate name inside tx) → orphan warning logged, exception propagates
 * 12. Pre-check rejects (limit) → HeyGen is NEVER called
 * 13. Pre-check rejects (duplicate name) → HeyGen is NEVER called
 * 14. Pre-check rejects (balance) → HeyGen is NEVER called
 *
 * Coverage (Audit fixup A):
 * 15. listPersonas → items do NOT expose heygenAvatarId (invariant #5)
 * 16. Conditional debit: tx-side balance check fails (race) → vcoin_balance_exhausted + orphan warning
 * 17. Non-guard tx error → orphan warning emitted, original error re-thrown
 */

import assert from "node:assert/strict";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { ManageWorkspaceVideoPersonasService } from "../src/modules/workspace-management/application/heygen/manage-workspace-video-personas.service";
import type {
  WorkspaceVideoPersonaRecord,
  WorkspaceVideoPersonaRepository
} from "../src/modules/workspace-management/domain/workspace-video-persona.repository";
import type { WorkspaceVcoinBalanceRepository } from "../src/modules/workspace-management/domain/workspace-vcoin-balance.repository";
import type { WorkspaceVcoinLedgerEventRepository } from "../src/modules/workspace-management/domain/workspace-vcoin-ledger-event.repository";
import type { HeyGenProviderGatewayClient } from "../src/modules/workspace-management/application/heygen/heygen-provider-gateway.client";

// ─── Test helpers ───────────────────────────────────────────────────────────

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const VOICE_ID = "en-US-Amy";
const VOICE_DISPLAY_NAME = "Amy";
const MOCK_AVATAR_ID = "ava-test-1";

function makePersonaRecord(
  overrides: Partial<WorkspaceVideoPersonaRecord> = {}
): WorkspaceVideoPersonaRecord {
  return {
    id: "persona-test-id",
    workspaceId: WORKSPACE_ID,
    displayName: "Test Persona",
    displayNameLower: "test persona",
    portraitImageUrl: "/api/persona-portrait/ws/pid/hash.jpg",
    portraitImageStorageKey: "workspaces/ws/personas/pid/portrait/current",
    heygenVoiceId: VOICE_ID,
    heygenVoiceLabel: VOICE_DISPLAY_NAME,
    heygenAvatarId: MOCK_AVATAR_ID,
    archived: false,
    archivedAt: null,
    createdAt: new Date("2026-06-04T22:00:00.000Z"),
    updatedAt: new Date("2026-06-04T22:00:00.000Z"),
    ...overrides
  };
}

/**
 * Create a minimal portrait image buffer (1-pixel JPEG for testing).
 * validatePersaiMediaFile uses magic bytes to detect JPEG.
 */
function makeJpegBuffer(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9
  ]);
}

function makePortraitFile() {
  return {
    buffer: makeJpegBuffer(),
    mimeType: "image/jpeg",
    originalFilename: "portrait.jpg"
  };
}

function makeHeyGenGatewayClient(opts: {
  avatarId?: string;
  failWith?: Error;
  callCount?: number[];
}): HeyGenProviderGatewayClient {
  return {
    async createPhotoAvatar() {
      if (opts.callCount !== undefined) {
        opts.callCount.push(1);
      }
      if (opts.failWith !== undefined) {
        throw opts.failWith;
      }
      return { avatarId: opts.avatarId ?? MOCK_AVATAR_ID };
    }
  } as HeyGenProviderGatewayClient;
}

function makeVoiceCatalog() {
  return {
    async getMaterializedVoiceCatalog() {
      return {
        provider: "heygen" as const,
        fetchedAt: new Date().toISOString(),
        shortlist: [
          {
            voiceKey: "en-US-Amy",
            providerVoiceId: VOICE_ID,
            displayName: VOICE_DISPLAY_NAME,
            locale: "en-US",
            gender: "female" as const,
            description: null,
            styleTags: [],
            previewAudioUrl: null
          }
        ]
      };
    }
  };
}

/**
 * Build a service with all dependencies stubbed. Each stub can be overridden.
 */
function makeService(opts: {
  activePersonaCount?: number;
  duplicateNameExists?: boolean;
  personaLimit?: number;
  personaCreationCost?: number;
  walletBalance?: number;
  failStorage?: boolean;
  existingPersonaForArchive?: WorkspaceVideoPersonaRecord | null;
  ledgerEvents?: Array<Record<string, unknown>>;
  debits?: Array<Record<string, unknown>>;
  insertedPersonas?: WorkspaceVideoPersonaRecord[];
  heygenClient?: HeyGenProviderGatewayClient;
}) {
  const {
    activePersonaCount = 0,
    duplicateNameExists = false,
    personaLimit = 10,
    personaCreationCost = 20,
    walletBalance = 100,
    failStorage = false,
    existingPersonaForArchive = null,
    ledgerEvents = [],
    debits = [],
    insertedPersonas = [],
    heygenClient = makeHeyGenGatewayClient({})
  } = opts;

  const personaRepository: WorkspaceVideoPersonaRepository = {
    async countActiveForWorkspace() {
      return activePersonaCount;
    },
    async findActiveByLowerName(_workspaceId, _lower, _tx) {
      return duplicateNameExists ? makePersonaRecord() : null;
    },
    async findById(_workspaceId, personaId, _tx) {
      if (existingPersonaForArchive !== null && existingPersonaForArchive.id === personaId) {
        return existingPersonaForArchive;
      }
      return null;
    },
    async listActive(_workspaceId) {
      return [];
    },
    async create(input, _tx) {
      const record = makePersonaRecord({
        id: input.id,
        displayName: input.displayName,
        displayNameLower: input.displayNameLower,
        heygenVoiceId: input.heygenVoiceId,
        heygenVoiceLabel: input.heygenVoiceLabel,
        heygenAvatarId: input.heygenAvatarId
      });
      insertedPersonas.push(record);
      return record;
    },
    async archive(_workspaceId, personaId, _tx) {
      if (existingPersonaForArchive !== null && existingPersonaForArchive.id === personaId) {
        return { ...existingPersonaForArchive, archived: true, archivedAt: new Date() };
      }
      return null;
    }
  };

  const vcoinBalanceRepository: WorkspaceVcoinBalanceRepository = {
    async getOrCreate() {
      return { workspaceId: WORKSPACE_ID, balanceVc: walletBalance };
    },
    async credit() {
      return { workspaceId: WORKSPACE_ID, balanceVc: walletBalance + 100 };
    },
    async debit(input) {
      const amount = (input as { amountVc: number }).amountVc;
      debits.push({ amountVc: amount });
      return { workspaceId: WORKSPACE_ID, balanceVc: walletBalance - amount };
    }
  };

  const ledgerEventRepository: WorkspaceVcoinLedgerEventRepository = {
    async recordEvent(input) {
      ledgerEvents.push({
        kind: input.kind,
        amountVc: input.amountVc,
        referenceKey: input.referenceKey
      });
      return { recorded: true };
    }
  };

  const storageCalls: string[] = [];
  const mediaObjectStorage = {
    async saveObject(input: { objectKey: string }) {
      if (failStorage) {
        throw new Error("Storage unavailable (simulated)");
      }
      storageCalls.push(input.objectKey);
    }
  };

  const resolvePlatformRuntimeProviderSettingsService = {
    async execute() {
      return {
        heygenPersonaWorkspaceLimit: personaLimit,
        heygenPersonaCreationVcoin: personaCreationCost
      };
    }
  };

  const prisma = {
    async $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
      return fn(prisma);
    },
    workspaceVcoinBalance: {
      async findUnique() {
        return { workspaceId: WORKSPACE_ID, balanceVc: walletBalance };
      },
      async updateMany(args: { where: { balanceVc: { gte: number } } }) {
        // Conditional debit: succeed only when balance >= cost.
        const succeeded = walletBalance >= args.where.balanceVc.gte;
        return { count: succeeded ? 1 : 0 };
      }
    }
  };

  const service = new ManageWorkspaceVideoPersonasService(
    personaRepository,
    vcoinBalanceRepository,
    ledgerEventRepository,
    resolvePlatformRuntimeProviderSettingsService as never,
    makeVoiceCatalog() as never,
    mediaObjectStorage as never,
    prisma as never,
    heygenClient
  );

  return { service, ledgerEvents, debits, insertedPersonas, storageCalls };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // Test 1: Happy-path create with VC cost > 0
  {
    const ledgerEvents: Array<Record<string, unknown>> = [];
    const updateManyCalls: Array<Record<string, unknown>> = [];
    const storageCalls: string[] = [];
    const insertedPersonas: WorkspaceVideoPersonaRecord[] = [];
    const heygenCallCount: number[] = [];

    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace() {
        return 0;
      },
      async findActiveByLowerName() {
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [];
      },
      async create(input) {
        const record = makePersonaRecord({
          id: input.id,
          displayName: input.displayName,
          displayNameLower: input.displayNameLower,
          heygenVoiceId: input.heygenVoiceId,
          heygenVoiceLabel: input.heygenVoiceLabel,
          heygenAvatarId: input.heygenAvatarId
        });
        insertedPersonas.push(record);
        return record;
      },
      async archive() {
        return null;
      }
    };

    const vcoinBalanceRepository: WorkspaceVcoinBalanceRepository = {
      async getOrCreate() {
        return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
      },
      async credit() {
        return { workspaceId: WORKSPACE_ID, balanceVc: 200 };
      },
      async debit() {
        return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
      }
    };

    const ledgerEventRepository: WorkspaceVcoinLedgerEventRepository = {
      async recordEvent(input) {
        ledgerEvents.push({
          kind: input.kind,
          amountVc: input.amountVc,
          referenceKey: input.referenceKey
        });
        return { recorded: true };
      }
    };

    const prisma = {
      async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
        return fn({
          workspaceVcoinBalance: {
            async findUnique() {
              return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
            },
            async updateMany(args: {
              where: { balanceVc: { gte: number } };
              data: { balanceVc: { decrement: number } };
            }) {
              updateManyCalls.push({
                gte: args.where.balanceVc.gte,
                decrement: args.data.balanceVc.decrement
              });
              return { count: 1 };
            }
          }
        });
      }
    };

    const heygenClient = makeHeyGenGatewayClient({
      callCount: heygenCallCount,
      avatarId: MOCK_AVATAR_ID
    });

    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      vcoinBalanceRepository,
      ledgerEventRepository,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 20 };
        }
      } as never,
      makeVoiceCatalog() as never,
      {
        async saveObject(input: { objectKey: string }) {
          storageCalls.push(input.objectKey);
        }
      } as never,
      prisma as never,
      heygenClient
    );

    const result = await service.createPersona({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      displayName: "My Persona",
      portraitImageFile: makePortraitFile(),
      heygenVoiceId: VOICE_ID
    });

    assert.equal(result.persona.heygenVoiceId, VOICE_ID);
    assert.equal(result.persona.heygenVoiceLabel, VOICE_DISPLAY_NAME);
    assert.equal(result.persona.displayName, "My Persona");
    assert.equal(result.storageWarning, null);
    assert.ok(result.walletBalanceVc !== undefined);
    // HeyGen was called exactly once
    assert.equal(heygenCallCount.length, 1, "HeyGen must be called exactly once");
    // Persona row inserted with non-null heygenAvatarId
    assert.equal(insertedPersonas.length, 1);
    assert.equal(
      insertedPersonas[0]!["heygenAvatarId"],
      MOCK_AVATAR_ID,
      "Persona must have the HeyGen avatar ID"
    );
    // Ledger event recorded
    assert.equal(ledgerEvents.length, 1);
    assert.equal(ledgerEvents[0]!["kind"], "persona_creation");
    assert.equal(ledgerEvents[0]!["amountVc"], -20);
    // Conditional debit via updateMany with balance >= cost guard
    assert.equal(updateManyCalls.length, 1, "conditional debit must fire once");
    assert.equal(updateManyCalls[0]!["gte"], 20, "conditional WHERE must require balance >= cost");
    assert.equal(updateManyCalls[0]!["decrement"], 20, "conditional debit must decrement by cost");
    // Storage written AFTER tx
    assert.equal(storageCalls.length, 1);
    console.log("✓ Test 1: happy-path create with VC cost, heygenAvatarId populated");
  }

  // Test 2: Persona limit reached (pre-check fires, HeyGen never called)
  {
    const heygenCallCount: number[] = [];
    const { service } = makeService({
      activePersonaCount: 10,
      personaLimit: 10,
      heygenClient: makeHeyGenGatewayClient({ callCount: heygenCallCount })
    });
    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "X",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "persona_limit_reached");
        return true;
      }
    );
    assert.equal(heygenCallCount.length, 0, "HeyGen must NOT be called when pre-check rejects");
    console.log("✓ Test 2: persona_limit_reached (pre-check fires, HeyGen skipped)");
  }

  // Test 3: Duplicate name (pre-check fires, HeyGen never called)
  {
    const heygenCallCount: number[] = [];
    const { service } = makeService({
      duplicateNameExists: true,
      heygenClient: makeHeyGenGatewayClient({ callCount: heygenCallCount })
    });
    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Duplicate",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "persona_duplicate_name");
        return true;
      }
    );
    assert.equal(heygenCallCount.length, 0, "HeyGen must NOT be called when pre-check rejects");
    console.log("✓ Test 3: persona_duplicate_name (pre-check fires, HeyGen skipped)");
  }

  // Test 4: Voice not found in cached shortlist
  {
    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace() {
        return 0;
      },
      async findActiveByLowerName() {
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [];
      },
      async create(input) {
        return makePersonaRecord({ id: input.id, heygenAvatarId: input.heygenAvatarId });
      },
      async archive() {
        return null;
      }
    };
    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      {
        async getOrCreate() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async credit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async debit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
        }
      } as never,
      {
        async recordEvent() {
          return { recorded: true };
        }
      } as never,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 20 };
        }
      } as never,
      {
        async getMaterializedVoiceCatalog() {
          return {
            provider: "heygen" as const,
            fetchedAt: new Date().toISOString(),
            shortlist: []
          };
        }
      } as never,
      {
        async saveObject() {
          /* noop */
        }
      } as never,
      {
        async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
          return fn({});
        }
      } as never,
      makeHeyGenGatewayClient({})
    );
    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Voice Test",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: "bad-voice-id"
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "voice_not_found");
        return true;
      }
    );
    console.log("✓ Test 4: voice_not_found");
  }

  // Test 5: Insufficient VC balance → pre-check fires, HeyGen never called
  {
    const heygenCallCount: number[] = [];
    const { service } = makeService({
      walletBalance: 5, // less than cost=20
      personaCreationCost: 20,
      heygenClient: makeHeyGenGatewayClient({ callCount: heygenCallCount })
    });

    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Balance Test",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "vcoin_balance_exhausted");
        return true;
      }
    );
    assert.equal(
      heygenCallCount.length,
      0,
      "HeyGen must NOT be called when balance pre-check rejects"
    );
    console.log("✓ Test 5: vcoin_balance_exhausted (pre-check fires, HeyGen skipped)");
  }

  // Test 6: Archive (soft-delete) sets archived=true with archivedAt
  {
    const existingPersona = makePersonaRecord({ id: "persona-to-archive", archived: false });
    const { service } = makeService({ existingPersonaForArchive: existingPersona });
    const result = await service.archivePersona({
      workspaceId: WORKSPACE_ID,
      personaId: "persona-to-archive"
    });
    assert.equal(result.archived, true);
    assert.equal(result.personaId, "persona-to-archive");
    console.log("✓ Test 6: archive sets archived=true");
  }

  // Test 7: Archive of non-existent persona → throws NotFoundException
  {
    const { service } = makeService({ existingPersonaForArchive: null });
    await assert.rejects(
      () => service.archivePersona({ workspaceId: WORKSPACE_ID, personaId: "does-not-exist" }),
      (err: Error) => {
        assert.ok(err instanceof NotFoundException);
        const body = (err as NotFoundException).getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "persona_not_found");
        return true;
      }
    );
    console.log("✓ Test 7: archive of non-existent → persona_not_found");
  }

  // Test 8: cost=0 → skips ledger + debit entirely
  {
    const ledgerEvents: Array<Record<string, unknown>> = [];
    const debits: Array<Record<string, unknown>> = [];

    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace() {
        return 0;
      },
      async findActiveByLowerName() {
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [];
      },
      async create(input) {
        return makePersonaRecord({
          id: input.id,
          displayName: input.displayName,
          heygenAvatarId: input.heygenAvatarId
        });
      },
      async archive() {
        return null;
      }
    };

    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      {
        async getOrCreate() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 0 };
        },
        async credit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 0 };
        },
        async debit(input) {
          debits.push({ amountVc: (input as { amountVc: number }).amountVc });
          return { workspaceId: WORKSPACE_ID, balanceVc: 0 };
        }
      } as never,
      {
        async recordEvent(input: { kind: string; amountVc: number }) {
          ledgerEvents.push({ kind: input.kind });
          return { recorded: true };
        }
      } as never,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 0 };
        }
      } as never,
      makeVoiceCatalog() as never,
      {
        async saveObject() {
          /* noop */
        }
      } as never,
      {
        async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
          return fn({});
        }
      } as never,
      makeHeyGenGatewayClient({})
    );

    await service.createPersona({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      displayName: "Free Persona",
      portraitImageFile: makePortraitFile(),
      heygenVoiceId: VOICE_ID
    });

    assert.equal(ledgerEvents.length, 0, "No ledger event when cost=0");
    assert.equal(debits.length, 0, "No debit when cost=0");
    console.log("✓ Test 8: cost=0 skips ledger + debit");
  }

  // Test 9: Storage save runs AFTER transaction commits (ordering: tx commits first, then storage)
  {
    const txCommitted = { value: false };
    const storageCalledAfterTx: boolean[] = [];

    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace() {
        return 0;
      },
      async findActiveByLowerName() {
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [];
      },
      async create(input) {
        return makePersonaRecord({ id: input.id, heygenAvatarId: input.heygenAvatarId });
      },
      async archive() {
        return null;
      }
    };

    const prisma = {
      async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
        const result = await fn({
          workspaceVcoinBalance: {
            async findUnique() {
              return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
            },
            async updateMany() {
              return { count: 1 };
            }
          }
        });
        txCommitted.value = true;
        return result;
      }
    };

    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      {
        async getOrCreate() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async credit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async debit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
        }
      } as never,
      {
        async recordEvent() {
          return { recorded: true };
        }
      } as never,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 20 };
        }
      } as never,
      makeVoiceCatalog() as never,
      {
        async saveObject() {
          storageCalledAfterTx.push(txCommitted.value);
        }
      } as never,
      prisma as never,
      makeHeyGenGatewayClient({})
    );

    await service.createPersona({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      displayName: "Storage Order Test",
      portraitImageFile: makePortraitFile(),
      heygenVoiceId: VOICE_ID
    });

    assert.equal(storageCalledAfterTx.length, 1);
    assert.equal(storageCalledAfterTx[0], true, "Storage save must run AFTER transaction commits");
    console.log("✓ Test 9: storage save runs AFTER transaction commits");
  }

  // ── Slice 5b new tests ─────────────────────────────────────────────────────

  // Test 10: HeyGen call fails → persona NOT created, no ledger event, no VC debit
  {
    const insertedPersonas: WorkspaceVideoPersonaRecord[] = [];
    const ledgerEvents: Array<Record<string, unknown>> = [];
    const debits: Array<Record<string, unknown>> = [];

    const failingHeygenClient = makeHeyGenGatewayClient({
      failWith: new ServiceUnavailableException({
        error: { code: "heygen_unavailable", message: "HeyGen is down (simulated)" }
      })
    });

    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace() {
        return 0;
      },
      async findActiveByLowerName() {
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [];
      },
      async create(input) {
        const record = makePersonaRecord({ id: input.id, heygenAvatarId: input.heygenAvatarId });
        insertedPersonas.push(record);
        return record;
      },
      async archive() {
        return null;
      }
    };

    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      {
        async getOrCreate() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async credit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async debit(input) {
          debits.push({ amountVc: (input as { amountVc: number }).amountVc });
          return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
        }
      } as never,
      {
        async recordEvent(input: { kind: string; amountVc: number }) {
          ledgerEvents.push({ kind: input.kind });
          return { recorded: true };
        }
      } as never,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 20 };
        }
      } as never,
      makeVoiceCatalog() as never,
      {
        async saveObject() {
          /* noop */
        }
      } as never,
      {
        async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
          return fn({});
        }
      } as never,
      failingHeygenClient
    );

    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "HeyGen Fail Test",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof ServiceUnavailableException);
        return true;
      }
    );

    assert.equal(insertedPersonas.length, 0, "No persona must be created when HeyGen fails");
    assert.equal(ledgerEvents.length, 0, "No ledger event when HeyGen fails");
    assert.equal(debits.length, 0, "No debit when HeyGen fails");
    console.log("✓ Test 10: HeyGen call fails → persona NOT created, no ledger/debit");
  }

  // Test 11: HeyGen succeeds but tx fails (race — duplicate name inside tx) → orphan warning
  {
    let warnLogged = false;
    const heygenCallCount: number[] = [];

    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace(_workspaceId, _tx) {
        // Pre-check (no tx) says 0, re-check inside tx also says 0
        return 0;
      },
      async findActiveByLowerName(_workspaceId, _lower, _tx) {
        // Pre-check (no tx arg) says null, but inside tx a race caused a duplicate to appear
        if (_tx !== undefined) {
          return makePersonaRecord({ displayNameLower: "race persona" });
        }
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [];
      },
      async create(input) {
        return makePersonaRecord({ id: input.id, heygenAvatarId: input.heygenAvatarId });
      },
      async archive() {
        return null;
      }
    };

    const prisma = {
      async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
        return fn({
          workspaceVcoinBalance: {
            async findUnique() {
              return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
            },
            async updateMany() {
              return { count: 1 };
            }
          }
        });
      }
    };

    // Capture logger.warn calls
    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      {
        async getOrCreate() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async credit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async debit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
        }
      } as never,
      {
        async recordEvent() {
          return { recorded: true };
        }
      } as never,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 20 };
        }
      } as never,
      makeVoiceCatalog() as never,
      {
        async saveObject() {
          /* noop */
        }
      } as never,
      prisma as never,
      makeHeyGenGatewayClient({ callCount: heygenCallCount })
    );

    // Patch the logger to intercept warn calls
    const originalWarn = (
      service as unknown as { logger: { warn: (msg: string) => void } }
    ).logger.warn.bind((service as unknown as { logger: { warn: (msg: string) => void } }).logger);
    (service as unknown as { logger: { warn: (msg: string) => void } }).logger.warn = (
      msg: string
    ) => {
      if (msg.includes("Orphan HeyGen avatar")) {
        warnLogged = true;
      }
      originalWarn(msg);
    };

    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Race Persona",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "persona_duplicate_name");
        return true;
      }
    );

    assert.equal(heygenCallCount.length, 1, "HeyGen was called before the tx");
    assert.equal(
      warnLogged,
      true,
      "Orphan avatar warning must be logged when tx fails after HeyGen success"
    );
    console.log(
      "✓ Test 11: HeyGen succeeds but tx fails (race) → orphan warning logged, exception propagates"
    );
  }

  // Test 12: Pre-check rejects (limit) → HeyGen is NEVER called
  {
    const heygenCallCount: number[] = [];
    const { service } = makeService({
      activePersonaCount: 10,
      personaLimit: 10,
      heygenClient: makeHeyGenGatewayClient({ callCount: heygenCallCount })
    });

    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Limit Test",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      }
    );

    assert.equal(
      heygenCallCount.length,
      0,
      "HeyGen must NOT be called when limit pre-check rejects"
    );
    console.log("✓ Test 12: pre-check limit → HeyGen never called");
  }

  // Test 13: Pre-check rejects (duplicate name) → HeyGen is NEVER called
  {
    const heygenCallCount: number[] = [];
    const { service } = makeService({
      duplicateNameExists: true,
      heygenClient: makeHeyGenGatewayClient({ callCount: heygenCallCount })
    });

    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Dup Name Test",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      }
    );

    assert.equal(
      heygenCallCount.length,
      0,
      "HeyGen must NOT be called when duplicate-name pre-check rejects"
    );
    console.log("✓ Test 13: pre-check duplicate name → HeyGen never called");
  }

  // Test 14: Pre-check rejects (balance) → HeyGen is NEVER called
  {
    const heygenCallCount: number[] = [];
    const { service } = makeService({
      walletBalance: 5,
      personaCreationCost: 20,
      heygenClient: makeHeyGenGatewayClient({ callCount: heygenCallCount })
    });

    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Balance Gate Test",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      }
    );

    assert.equal(
      heygenCallCount.length,
      0,
      "HeyGen must NOT be called when balance pre-check rejects"
    );
    console.log("✓ Test 14: pre-check balance → HeyGen never called");
  }

  // Test 15: listPersonas does NOT expose heygenAvatarId (invariant #5)
  {
    const heygenAvatarId = "ava-secret-id";
    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace() {
        return 1;
      },
      async findActiveByLowerName() {
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [makePersonaRecord({ heygenAvatarId })];
      },
      async create(input) {
        return makePersonaRecord({ id: input.id, heygenAvatarId: input.heygenAvatarId });
      },
      async archive() {
        return null;
      }
    };

    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      {
        async getOrCreate() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async credit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async debit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
        }
      } as never,
      {
        async recordEvent() {
          return { recorded: true };
        }
      } as never,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 20 };
        }
      } as never,
      makeVoiceCatalog() as never,
      {
        async saveObject() {
          /* noop */
        }
      } as never,
      {
        async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
          return fn({});
        }
      } as never,
      makeHeyGenGatewayClient({})
    );

    const { personas } = await service.listPersonas({ workspaceId: WORKSPACE_ID });
    assert.equal(personas.length, 1);
    assert.ok(
      !("heygenAvatarId" in (personas[0] as object)),
      "heygenAvatarId must NOT be present in list item (invariant #5)"
    );
    console.log("✓ Test 15: listPersonas does NOT expose heygenAvatarId");
  }

  // Test 16: Conditional debit — tx-side race (count=0 from conditional update) → vcoin_balance_exhausted + orphan warning
  {
    let warnLogged = false;
    const heygenCallCount: number[] = [];

    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace() {
        return 0;
      },
      async findActiveByLowerName() {
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [];
      },
      async create(input) {
        return makePersonaRecord({ id: input.id, heygenAvatarId: input.heygenAvatarId });
      },
      async archive() {
        return null;
      }
    };

    // Simulate the conditional debit returning count=0 (race lost).
    const prisma = {
      async $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
        return fn(prisma);
      },
      workspaceVcoinBalance: {
        async findUnique() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async updateMany() {
          // Simulate race: another request already debited — conditional WHERE failed.
          return { count: 0 };
        }
      }
    };

    const vcoinBalanceRepository: WorkspaceVcoinBalanceRepository = {
      async getOrCreate() {
        return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
      },
      async credit() {
        return { workspaceId: WORKSPACE_ID, balanceVc: 200 };
      },
      async debit() {
        return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
      }
    };

    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      vcoinBalanceRepository,
      {
        async recordEvent() {
          return { recorded: true };
        }
      } as never,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 20 };
        }
      } as never,
      makeVoiceCatalog() as never,
      {
        async saveObject() {
          /* noop */
        }
      } as never,
      prisma as never,
      makeHeyGenGatewayClient({ callCount: heygenCallCount })
    );

    (service as unknown as { logger: { warn: (msg: string) => void } }).logger.warn = (
      msg: string
    ) => {
      if (msg.includes("Orphan HeyGen avatar")) {
        warnLogged = true;
      }
    };

    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Race Debit",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.ok(err instanceof BadRequestException);
        const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
        assert.equal(body["code"], "vcoin_balance_exhausted");
        return true;
      }
    );
    assert.equal(heygenCallCount.length, 1, "HeyGen was called (pre-checks passed)");
    assert.equal(
      warnLogged,
      true,
      "Orphan warning must be logged when conditional debit loses race"
    );
    console.log("✓ Test 16: conditional debit race → vcoin_balance_exhausted + orphan warning");
  }

  // Test 17: Non-guard tx error → orphan warning emitted, original error re-thrown
  {
    let warnLogged = false;
    const heygenCallCount: number[] = [];
    const unexpectedError = new Error("Simulated Prisma constraint violation");

    const personaRepository: WorkspaceVideoPersonaRepository = {
      async countActiveForWorkspace() {
        return 0;
      },
      async findActiveByLowerName() {
        return null;
      },
      async findById() {
        return null;
      },
      async listActive() {
        return [];
      },
      async create() {
        throw unexpectedError;
      },
      async archive() {
        return null;
      }
    };

    const prisma = {
      async $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
        return fn(prisma);
      },
      workspaceVcoinBalance: {
        async findUnique() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async updateMany() {
          return { count: 1 };
        }
      }
    };

    const service = new ManageWorkspaceVideoPersonasService(
      personaRepository,
      {
        async getOrCreate() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 100 };
        },
        async credit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 200 };
        },
        async debit() {
          return { workspaceId: WORKSPACE_ID, balanceVc: 80 };
        }
      } as never,
      {
        async recordEvent() {
          return { recorded: true };
        }
      } as never,
      {
        async execute() {
          return { heygenPersonaWorkspaceLimit: 10, heygenPersonaCreationVcoin: 20 };
        }
      } as never,
      makeVoiceCatalog() as never,
      {
        async saveObject() {
          /* noop */
        }
      } as never,
      prisma as never,
      makeHeyGenGatewayClient({ callCount: heygenCallCount })
    );

    (service as unknown as { logger: { warn: (msg: string) => void } }).logger.warn = (
      msg: string
    ) => {
      if (msg.includes("Orphan HeyGen avatar")) {
        warnLogged = true;
      }
    };

    await assert.rejects(
      () =>
        service.createPersona({
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          displayName: "Infra Error Test",
          portraitImageFile: makePortraitFile(),
          heygenVoiceId: VOICE_ID
        }),
      (err: Error) => {
        assert.equal(err, unexpectedError, "Original error must propagate unchanged");
        return true;
      }
    );
    assert.equal(heygenCallCount.length, 1, "HeyGen was called before the infra error");
    assert.equal(
      warnLogged,
      true,
      "Orphan warning must fire for any tx failure after HeyGen success"
    );
    console.log("✓ Test 17: non-guard tx error → orphan warning + original error re-thrown");
  }

  console.log("\nmanage-workspace-video-personas.service: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
