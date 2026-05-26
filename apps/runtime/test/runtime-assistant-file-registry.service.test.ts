import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuntimeAssistantFileRegistryService } from "../src/modules/turns/runtime-assistant-file-registry.service";

type RegistryRow = {
  id: string;
  assistantId: string;
  workspaceId: string;
  sandboxJobId: string | null;
  origin: "uploaded_attachment" | "runtime_output" | "sandbox_output";
  sourceToolCode: string | null;
  objectKey: string;
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: bigint;
  logicalSizeBytes: bigint | null;
  sha256: string | null;
  metadata: unknown;
  createdAt: Date;
};

function makeRow(overrides: Partial<RegistryRow> & { id: string }): RegistryRow {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    sandboxJobId: null,
    origin: "uploaded_attachment",
    sourceToolCode: null,
    objectKey: `assistant-media/uploads/${overrides.id}.jpg`,
    relativePath: `uploads/${overrides.id}.jpg`,
    displayName: `${overrides.id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: BigInt(100),
    logicalSizeBytes: BigInt(100),
    sha256: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function buildPrismaMock(rows: RegistryRow[]) {
  return {
    assistantFile: {
      async findMany(input?: {
        where?: {
          assistantId?: string;
          workspaceId?: string;
          OR?: Array<Record<string, unknown>>;
        };
        orderBy?: unknown;
        take?: number;
      }) {
        let filtered = rows.filter((row) => {
          if (
            input?.where?.assistantId !== undefined &&
            row.assistantId !== input.where.assistantId
          ) {
            return false;
          }
          if (
            input?.where?.workspaceId !== undefined &&
            row.workspaceId !== input.where.workspaceId
          ) {
            return false;
          }
          if (input?.where?.OR === undefined) {
            return true;
          }
          return input.where.OR.some((condition) => {
            for (const [field, matcher] of Object.entries(condition)) {
              if (
                matcher !== null &&
                typeof matcher === "object" &&
                "contains" in (matcher as Record<string, unknown>)
              ) {
                const token = String((matcher as { contains: unknown }).contains).toLowerCase();
                if (field === "displayName") {
                  return (row.displayName ?? "").toLowerCase().includes(token);
                }
                if (field === "relativePath") {
                  return row.relativePath.toLowerCase().includes(token);
                }
              }
              if (
                field === "metadata" &&
                matcher !== null &&
                typeof matcher === "object" &&
                "string_contains" in (matcher as Record<string, unknown>)
              ) {
                const token = String(
                  (matcher as { string_contains: unknown }).string_contains
                ).toLowerCase();
                const summary =
                  row.metadata !== null &&
                  typeof row.metadata === "object" &&
                  !Array.isArray(row.metadata) &&
                  typeof (row.metadata as Record<string, unknown>)["semanticSummary"] === "string"
                    ? (
                        (row.metadata as Record<string, unknown>)["semanticSummary"] as string
                      ).toLowerCase()
                    : "";
                return summary.includes(token);
              }
            }
            return false;
          });
        });

        if (input?.take !== undefined) {
          filtered = filtered.slice(0, input.take);
        }
        return filtered;
      },

      async findFirst() {
        return rows[0] ?? null;
      },

      async upsert(input: {
        where: {
          assistantId_workspaceId_origin_objectKey: {
            assistantId: string;
            workspaceId: string;
            origin: RegistryRow["origin"];
            objectKey: string;
          };
        };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) {
        const key = input.where.assistantId_workspaceId_origin_objectKey;
        const existingIndex = rows.findIndex(
          (row) =>
            row.assistantId === key.assistantId &&
            row.workspaceId === key.workspaceId &&
            row.origin === key.origin &&
            row.objectKey === key.objectKey
        );
        if (existingIndex >= 0) {
          const existing = rows[existingIndex]!;
          const updated: RegistryRow = {
            ...existing,
            relativePath: String(input.update.relativePath),
            displayName:
              typeof input.update.displayName === "string" ? input.update.displayName : null,
            mimeType: String(input.update.mimeType),
            sizeBytes: input.update.sizeBytes as bigint,
            logicalSizeBytes: (input.update.logicalSizeBytes as bigint | null) ?? null,
            sha256: typeof input.update.sha256 === "string" ? input.update.sha256 : existing.sha256,
            metadata:
              input.update.metadata !== null && typeof input.update.metadata === "object"
                ? input.update.metadata
                : null
          };
          rows[existingIndex] = updated;
          return updated;
        }
        const created = makeRow({
          id: `created-${String(rows.length + 1)}`,
          assistantId: String(input.create.assistantId),
          workspaceId: String(input.create.workspaceId),
          origin: input.create.origin as RegistryRow["origin"],
          sourceToolCode:
            typeof input.create.sourceToolCode === "string" ? input.create.sourceToolCode : null,
          objectKey: String(input.create.objectKey),
          relativePath: String(input.create.relativePath),
          displayName:
            typeof input.create.displayName === "string" ? input.create.displayName : null,
          mimeType: String(input.create.mimeType),
          sizeBytes: input.create.sizeBytes as bigint,
          logicalSizeBytes: (input.create.logicalSizeBytes as bigint | null) ?? null,
          sha256: typeof input.create.sha256 === "string" ? input.create.sha256 : null,
          metadata:
            input.create.metadata !== null && typeof input.create.metadata === "object"
              ? input.create.metadata
              : null
        });
        rows.push(created);
        return created;
      }
    }
  };
}

function buildService(
  rows: RegistryRow[],
  options?: { downloadedObject?: Buffer | null }
): RuntimeAssistantFileRegistryService {
  return new RuntimeAssistantFileRegistryService(
    buildPrismaMock(rows) as never,
    {
      async downloadObject() {
        return options?.downloadedObject ?? null;
      }
    } as never
  );
}

describe("RuntimeAssistantFileRegistryService.search – multi-token ranking", () => {
  test("multi-token query surfaces the best semantic match even if not all tokens match", async () => {
    const rowHoodie = makeRow({
      id: "hoodie-row",
      displayName: "photo.jpg",
      relativePath: "uploads/photo.jpg",
      metadata: {
        semanticSummary: "мужчина в синем худи и кепке, на улице, среди зелени",
        semanticSummarySource: "generation_request"
      },
      createdAt: new Date("2026-04-01T00:00:00.000Z")
    });
    const rowUnrelated = makeRow({
      id: "unrelated-row",
      displayName: "invoice.pdf",
      relativePath: "uploads/invoice.pdf",
      metadata: { semanticSummary: "счёт-фактура за аренду офиса" },
      createdAt: new Date("2026-04-02T00:00:00.000Z")
    });

    const service = buildService([rowHoodie, rowUnrelated]);

    const results = await service.search({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      query: "худи природа кепка фото",
      limit: 10
    });

    assert.ok(results.length >= 1, "should return at least one result");
    assert.equal(results[0]?.fileRef, "hoodie-row", "hoodie row must rank first");
  });

  test("two rows with the same token-hit score rank by createdAt desc", async () => {
    const rowOld = makeRow({
      id: "old-row",
      displayName: "sunset.jpg",
      relativePath: "uploads/sunset.jpg",
      metadata: { semanticSummary: "закат над горами" },
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    });
    const rowNew = makeRow({
      id: "new-row",
      displayName: "sunset2.jpg",
      relativePath: "uploads/sunset2.jpg",
      metadata: { semanticSummary: "закат над морем" },
      createdAt: new Date("2026-03-01T00:00:00.000Z")
    });

    // Both rows match "закат" (1 token hit each).
    // The mock returns rows in the order provided; but we order by createdAt desc.
    // The mock does not sort, so we rely on the service's in-memory sort respecting Prisma's ordering.
    // Since the mock preserves insertion order and we pass oldRow first, the service
    // must still return newRow first if scores tie and newRow.createdAt > oldRow.createdAt.
    // We pass newRow second so Prisma-desc ordering would put newRow first anyway —
    // simulate that by passing rows newest-first as Prisma would return them.
    const service = buildService([rowNew, rowOld]);

    const results = await service.search({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      query: "закат",
      limit: 10
    });

    assert.equal(results[0]?.fileRef, "new-row", "newer row must come first on equal score");
  });

  test("row matching 3 tokens ranks above row matching 1 token", async () => {
    const rowWeakEn = makeRow({
      id: "weak-en",
      displayName: "photo.jpg",
      relativePath: "uploads/photo.jpg",
      metadata: { semanticSummary: "a man in blue hoodie" },
      createdAt: new Date("2026-04-10T00:00:00.000Z")
    });
    const rowStrongEn = makeRow({
      id: "strong-en",
      displayName: "nature-cap.jpg",
      relativePath: "uploads/nature/cap.jpg",
      metadata: { semanticSummary: "man in hoodie and cap outdoors in nature" },
      createdAt: new Date("2026-04-01T00:00:00.000Z")
    });

    const service = buildService([rowWeakEn, rowStrongEn]);

    const results = await service.search({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      query: "hoodie cap nature",
      limit: 10
    });

    assert.ok(results.length >= 2, "should return both rows");
    assert.equal(results[0]?.fileRef, "strong-en", "higher-scoring row must rank first");
  });

  test("query with only short tokens falls back to single-substring search without throwing", async () => {
    const row = makeRow({
      id: "row-1",
      displayName: "a.jpg",
      relativePath: "uploads/a.jpg",
      metadata: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    });

    const service = buildService([row]);

    // "?" is 1 character — below the 2-char threshold, so tokens = []; fallback path.
    await assert.doesNotReject(async () => {
      await service.search({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        query: "?",
        limit: 5
      });
    });

    // "a" is also 1 character → same fallback.
    await assert.doesNotReject(async () => {
      await service.search({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        query: "a",
        limit: 5
      });
    });
  });

  test("token dedupe does not inflate score", async () => {
    const rowHoodie = makeRow({
      id: "hoodie-dedup",
      displayName: "photo.jpg",
      relativePath: "uploads/photo.jpg",
      metadata: { semanticSummary: "мужчина в синем худи, на улице" },
      createdAt: new Date("2026-04-01T00:00:00.000Z")
    });
    const rowOther = makeRow({
      id: "other-dedup",
      displayName: "другое.jpg",
      relativePath: "uploads/другое.jpg",
      metadata: { semanticSummary: "совсем другое" },
      createdAt: new Date("2026-04-02T00:00:00.000Z")
    });

    const service = buildService([rowOther, rowHoodie]);

    // "худи худи худи" should dedupe to a single "худи" token → score 1 for rowHoodie.
    const results = await service.search({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      query: "худи худи худи",
      limit: 10
    });

    assert.equal(results[0]?.fileRef, "hoodie-dedup", "hoodie row should rank first");
    assert.equal(results.length, 1, "only one row matches");
  });

  test("limit is respected after ranking", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({
        id: `row-${i}`,
        displayName: `report-${i}.txt`,
        relativePath: `uploads/report-${i}.txt`,
        metadata: { semanticSummary: `financial report number ${i}` },
        createdAt: new Date(2026, 0, i + 1)
      })
    );

    const service = buildService(rows);

    const results = await service.search({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      query: "financial report",
      limit: 3
    });

    assert.equal(results.length, 3, "limit=3 must be respected");
  });
});

describe("RuntimeAssistantFileRegistryService.toRuntimeFileRef", () => {
  test("includes createdAt, strict authorLabel, and the longer semantic summary hint", () => {
    const service = buildService([]);
    const summary = "x".repeat(140);
    const runtimeFileRef = service.toRuntimeFileRef(
      makeRow({
        id: "file-1",
        origin: "sandbox_output",
        metadata: { semanticSummary: summary },
        createdAt: new Date("2026-05-26T14:32:00.000Z")
      }) as never
    );

    assert.equal(runtimeFileRef.createdAt, "2026-05-26T14:32:00.000Z");
    assert.equal(runtimeFileRef.authorLabel, "sandbox");
    assert.equal(runtimeFileRef.semanticSummaryHint?.length, 120);
  });
});

describe("RuntimeAssistantFileRegistryService.ensureAttachmentBackedFile", () => {
  test("preserves existing semantic metadata on update when no new summary is provided", async () => {
    const rows = [
      makeRow({
        id: "existing-file",
        origin: "uploaded_attachment",
        objectKey: "assistant-media/uploads/source.jpg",
        metadata: {
          attachmentId: "attachment-old",
          semanticSummary: "Existing upload summary.",
          semanticSummarySource: "upload_micro_description",
          customField: "keep-me"
        }
      })
    ];
    const service = buildService(rows, {
      downloadedObject: Buffer.from("updated-object")
    });

    const record = await service.ensureAttachmentBackedFile({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      origin: "uploaded_attachment",
      referenceId: "attachment-new",
      objectKey: "assistant-media/uploads/source.jpg",
      filename: "source.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 123
    });

    assert.equal(record.fileRef, "existing-file");
    assert.deepEqual(record.metadata, {
      attachmentId: "attachment-new",
      semanticSummary: "Existing upload summary.",
      semanticSummarySource: "upload_micro_description",
      customField: "keep-me"
    });
  });
});
