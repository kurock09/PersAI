import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaWorkspaceVideoClonedVoiceRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-workspace-video-cloned-voice.repository";

type Row = {
  id: string;
  workspaceId: string;
  displayName: string;
  displayNameLower: string;
  heygenVoiceCloneId: string | null;
  languageHint: string | null;
  status: "pending" | "ready" | "failed";
  isDefault: boolean;
  previewAudioUrl: string | null;
  sourceMetadata: Prisma.JsonValue;
  archived: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeHarness() {
  const rows: Row[] = [];
  let tick = 0;

  const nextDate = () => new Date(Date.UTC(2026, 5, 7, 12, 0, tick++));

  const delegate = {
    async count(args: { where: { workspaceId: string; archived: boolean } }) {
      return rows.filter(
        (row) => row.workspaceId === args.where.workspaceId && row.archived === args.where.archived
      ).length;
    },
    async findFirst(args: {
      where: Partial<Pick<Row, "id" | "workspaceId" | "displayNameLower" | "archived">>;
    }) {
      return (
        rows.find((row) => {
          if (args.where.id !== undefined && row.id !== args.where.id) {
            return false;
          }
          if (args.where.workspaceId !== undefined && row.workspaceId !== args.where.workspaceId) {
            return false;
          }
          if (
            args.where.displayNameLower !== undefined &&
            row.displayNameLower !== args.where.displayNameLower
          ) {
            return false;
          }
          if (args.where.archived !== undefined && row.archived !== args.where.archived) {
            return false;
          }
          return true;
        }) ?? null
      );
    },
    async findMany(args: {
      where: { workspaceId: string; archived: boolean };
      orderBy: { createdAt: "asc" | "desc" };
    }) {
      return rows
        .filter(
          (row) =>
            row.workspaceId === args.where.workspaceId && row.archived === args.where.archived
        )
        .sort((left, right) =>
          args.orderBy.createdAt === "asc"
            ? left.createdAt.getTime() - right.createdAt.getTime()
            : right.createdAt.getTime() - left.createdAt.getTime()
        );
    },
    async create(args: {
      data: {
        id: string;
        workspaceId: string;
        displayName: string;
        displayNameLower: string;
        heygenVoiceCloneId: string | null;
        languageHint: string | null;
        status: "pending" | "ready" | "failed";
        isDefault: boolean;
        previewAudioUrl: string | null;
        sourceMetadata: Prisma.InputJsonValue;
      };
    }) {
      const duplicate = rows.find(
        (row) =>
          row.workspaceId === args.data.workspaceId &&
          row.displayNameLower === args.data.displayNameLower
      );
      if (duplicate !== undefined) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test"
        });
      }
      const now = nextDate();
      const row: Row = {
        id: args.data.id,
        workspaceId: args.data.workspaceId,
        displayName: args.data.displayName,
        displayNameLower: args.data.displayNameLower,
        heygenVoiceCloneId: args.data.heygenVoiceCloneId,
        languageHint: args.data.languageHint,
        status: args.data.status,
        isDefault: args.data.isDefault,
        previewAudioUrl: args.data.previewAudioUrl,
        sourceMetadata: args.data.sourceMetadata as Prisma.JsonValue,
        archived: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now
      };
      rows.push(row);
      return row;
    },
    async update(args: {
      where: { id: string };
      data: Partial<{
        archived: boolean;
        archivedAt: Date;
        isDefault: boolean;
        heygenVoiceCloneId: string | null;
        languageHint: string | null;
        status: "pending" | "ready" | "failed";
        previewAudioUrl: string | null;
        sourceMetadata: Prisma.JsonValue;
      }>;
    }) {
      const row = rows.find((entry) => entry.id === args.where.id);
      if (row === undefined) {
        throw new Error("row not found");
      }
      if ("archived" in args.data) {
        row.archived = args.data.archived;
      }
      if ("archivedAt" in args.data) {
        row.archivedAt = args.data.archivedAt;
      }
      if ("isDefault" in args.data) {
        row.isDefault = (args.data as { isDefault: boolean }).isDefault;
      }
      if ("heygenVoiceCloneId" in args.data) {
        row.heygenVoiceCloneId = args.data.heygenVoiceCloneId ?? null;
      }
      if ("languageHint" in args.data) {
        row.languageHint = args.data.languageHint ?? null;
      }
      if ("status" in args.data && args.data.status !== undefined) {
        row.status = args.data.status;
      }
      if ("previewAudioUrl" in args.data) {
        row.previewAudioUrl = args.data.previewAudioUrl ?? null;
      }
      if ("sourceMetadata" in args.data && args.data.sourceMetadata !== undefined) {
        row.sourceMetadata = args.data.sourceMetadata;
      }
      row.updatedAt = nextDate();
      return row;
    },
    async updateMany(args: {
      where: { workspaceId: string; archived: boolean; isDefault?: boolean };
      data: { isDefault: boolean };
    }) {
      let count = 0;
      for (const row of rows) {
        if (row.workspaceId !== args.where.workspaceId || row.archived !== args.where.archived) {
          continue;
        }
        if (args.where.isDefault !== undefined && row.isDefault !== args.where.isDefault) {
          continue;
        }
        row.isDefault = args.data.isDefault;
        row.updatedAt = nextDate();
        count += 1;
      }
      return { count };
    }
  };

  const prisma = {
    workspaceVideoClonedVoice: delegate
  };

  return {
    repo: new PrismaWorkspaceVideoClonedVoiceRepository(prisma as never),
    tx: prisma as never
  };
}

async function runCreateListArchiveRoundTrip(): Promise<void> {
  const { repo, tx } = makeHarness();
  const created = await repo.create(
    {
      id: "00000000-0000-0000-0000-000000000101",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      displayName: "Brand Voice",
      displayNameLower: "brand voice",
      heygenVoiceCloneId: null,
      languageHint: "en",
      status: "pending",
      isDefault: true,
      previewAudioUrl: "https://cdn.example.test/voice-preview.mp3",
      sourceMetadata: {
        rightsConfirmed: true,
        source: { kind: "upload", mimeType: "audio/mpeg" }
      }
    },
    tx
  );

  assert.equal(created.status, "pending");
  assert.equal(created.isDefault, true);
  assert.deepEqual(created.sourceMetadata, {
    rightsConfirmed: true,
    source: { kind: "upload", mimeType: "audio/mpeg" }
  });
  assert.equal(
    await repo.countActiveForWorkspace("00000000-0000-0000-0000-000000000001"),
    1,
    "active count should include the created row"
  );

  const listed = await repo.listActive("00000000-0000-0000-0000-000000000001");
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.displayName, "Brand Voice");

  const foundByLowerName = await repo.findActiveByLowerName(
    "00000000-0000-0000-0000-000000000001",
    "brand voice"
  );
  assert.equal(foundByLowerName?.id, created.id);

  const archived = await repo.archive(
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000101"
  );
  assert.equal(archived?.archived, true);
  assert.ok(archived?.archivedAt instanceof Date);
  assert.equal(
    await repo.countActiveForWorkspace("00000000-0000-0000-0000-000000000001"),
    0,
    "active count should exclude archived rows"
  );
  assert.equal(
    (await repo.listActive("00000000-0000-0000-0000-000000000001")).length,
    0,
    "archived rows should not appear in listActive"
  );
  assert.equal(
    await repo.findActiveByLowerName("00000000-0000-0000-0000-000000000001", "brand voice"),
    null,
    "archived rows should not resolve through findActiveByLowerName"
  );

  const foundArchived = await repo.findById(
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000101"
  );
  assert.equal(foundArchived?.archived, true, "findById should still return archived rows");
}

async function runDuplicateNameIsRejectedWithinWorkspace(): Promise<void> {
  const { repo, tx } = makeHarness();
  await repo.create(
    {
      id: "00000000-0000-0000-0000-000000000201",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      displayName: "Narrator",
      displayNameLower: "narrator"
    },
    tx
  );

  await assert.rejects(
    () =>
      repo.create(
        {
          id: "00000000-0000-0000-0000-000000000202",
          workspaceId: "00000000-0000-0000-0000-000000000001",
          displayName: "NARRATOR",
          displayNameLower: "narrator"
        },
        tx
      ),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    "duplicate lowercased display name should surface the DB uniqueness error"
  );
}

async function runSameNameAllowedAcrossWorkspaces(): Promise<void> {
  const { repo, tx } = makeHarness();
  await repo.create(
    {
      id: "00000000-0000-0000-0000-000000000301",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      displayName: "Shared Voice",
      displayNameLower: "shared voice"
    },
    tx
  );
  await repo.create(
    {
      id: "00000000-0000-0000-0000-000000000302",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      displayName: "Shared Voice",
      displayNameLower: "shared voice",
      status: "ready",
      heygenVoiceCloneId: "heygen-clone-302"
    },
    tx
  );

  assert.equal(await repo.countActiveForWorkspace("00000000-0000-0000-0000-000000000001"), 1);
  assert.equal(await repo.countActiveForWorkspace("00000000-0000-0000-0000-000000000002"), 1);
}

async function runInvalidUuidLookupsReturnNull(): Promise<void> {
  const { repo } = makeHarness();
  assert.equal(await repo.findById("00000000-0000-0000-0000-000000000001", "not-a-uuid"), null);
  assert.equal(await repo.archive("00000000-0000-0000-0000-000000000001", "not-a-uuid"), null);
}

async function runUpdateAndSetDefaultFlow(): Promise<void> {
  const { repo, tx } = makeHarness();
  await repo.create(
    {
      id: "00000000-0000-0000-0000-000000000401",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      displayName: "Voice A",
      displayNameLower: "voice a",
      status: "pending",
      isDefault: true
    },
    tx
  );
  await repo.create(
    {
      id: "00000000-0000-0000-0000-000000000402",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      displayName: "Voice B",
      displayNameLower: "voice b",
      status: "pending",
      isDefault: false
    },
    tx
  );

  const updated = await repo.update(
    {
      workspaceId: "00000000-0000-0000-0000-000000000001",
      clonedVoiceId: "00000000-0000-0000-0000-000000000402",
      status: "ready",
      heygenVoiceCloneId: "heygen-clone-402",
      previewAudioUrl: "https://cdn.example.test/voice-b.mp3",
      sourceMetadata: { provider: { status: "complete" } }
    },
    tx
  );
  assert.equal(updated?.status, "ready");
  assert.equal(updated?.heygenVoiceCloneId, "heygen-clone-402");
  assert.equal(updated?.previewAudioUrl, "https://cdn.example.test/voice-b.mp3");

  const defaulted = await repo.setDefault(
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000402",
    tx
  );
  assert.equal(defaulted?.isDefault, true);

  const listed = await repo.listActive("00000000-0000-0000-0000-000000000001", tx);
  const activeDefaults = listed.filter((row) => row.isDefault);
  assert.equal(activeDefaults.length, 1);
  assert.equal(activeDefaults[0]?.id, "00000000-0000-0000-0000-000000000402");
}

async function run(): Promise<void> {
  await runCreateListArchiveRoundTrip();
  await runDuplicateNameIsRejectedWithinWorkspace();
  await runSameNameAllowedAcrossWorkspaces();
  await runInvalidUuidLookupsReturnNull();
  await runUpdateAndSetDefaultFlow();
  console.log("workspace-video-cloned-voice.repository: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
