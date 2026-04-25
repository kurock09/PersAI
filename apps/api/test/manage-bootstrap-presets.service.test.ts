import assert from "node:assert/strict";
import { VISIBLE_PROMPT_TEMPLATE_DEFAULTS } from "../prisma/bootstrap-preset-data";
import { ManagePromptTemplatesService } from "../src/modules/workspace-management/application/manage-bootstrap-presets.service";

type PresetRow = {
  id: string;
  template: string;
  createdAt: Date;
  updatedAt: Date;
};

function preset(id: string, template: string): PresetRow {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return { id, template, createdAt: now, updatedAt: now };
}

async function run(): Promise<void> {
  {
    const rows: PresetRow[] = [preset("soul", "custom soul")];
    const upsertedIds: string[] = [];
    const service = new ManagePromptTemplatesService(
      {
        async findAll() {
          return [...rows].sort((a, b) => a.id.localeCompare(b.id));
        },
        async findById(id: string) {
          return rows.find((row) => row.id === id) ?? null;
        },
        async update(id: string, template: string) {
          const idx = rows.findIndex((row) => row.id === id);
          if (idx < 0) throw new Error("not found");
          rows[idx] = { ...rows[idx]!, template, updatedAt: new Date("2026-01-02T00:00:00.000Z") };
          return rows[idx]!;
        },
        async upsert(id: string, template: string) {
          upsertedIds.push(id);
          const existing = rows.find((row) => row.id === id);
          if (existing) {
            existing.template = template;
            existing.updatedAt = new Date("2026-01-02T00:00:00.000Z");
            return existing;
          }
          const created = preset(id, template);
          rows.push(created);
          return created;
        }
      },
      {
        async assertCanReadAdminSurface() {
          return undefined;
        }
      } as never,
      {
        async execute() {
          return undefined;
        }
      } as never
    );

    const all = await service.getAll("admin-user");
    assert.deepEqual(
      all.map((row) => row.id),
      Object.keys(VISIBLE_PROMPT_TEMPLATE_DEFAULTS).sort(),
      "getAll should backfill missing default template ids"
    );
    assert.equal(
      rows.find((row) => row.id === "soul")?.template,
      "custom soul",
      "existing edited templates must not be overwritten during backfill"
    );
    assert.equal(
      upsertedIds.includes("soul"),
      false,
      "already existing ids must not be upserted during default backfill"
    );
  }

  {
    const service = new ManagePromptTemplatesService(
      {
        async findAll() {
          return [];
        },
        async findById() {
          return null;
        },
        async update() {
          throw new Error("update should not be called for invalid ids");
        },
        async upsert() {
          throw new Error("upsert should not be called for invalid ids");
        }
      },
      {
        async assertCanReadAdminSurface() {
          return undefined;
        }
      } as never,
      {
        async execute() {
          return undefined;
        }
      } as never
    );

    await assert.rejects(
      () => service.update("admin-user", "not_a_real_template", "x"),
      /Prompt template "not_a_real_template" does not exist/
    );
  }

  {
    let bumped = 0;
    let saved: PresetRow | null = null;
    const service = new ManagePromptTemplatesService(
      {
        async findAll() {
          return [];
        },
        async findById() {
          return null;
        },
        async update() {
          throw new Error("update should not be used; upsert is canonical");
        },
        async upsert(id: string, template: string) {
          saved = preset(id, template);
          return saved;
        }
      },
      {
        async assertCanReadAdminSurface() {
          return undefined;
        }
      } as never,
      {
        async execute() {
          bumped += 1;
        }
      } as never
    );

    const result = await service.update("admin-user", "tools", "new tools template");
    assert.equal(result.id, "tools");
    assert.equal(result.template, "new tools template");
    assert.equal(saved?.id, "tools");
    assert.equal(bumped, 1, "successful updates should bump config generation");
  }

  {
    let bumped = 0;
    let savedTemplate = "";
    const service = new ManagePromptTemplatesService(
      {
        async findAll() {
          return [];
        },
        async findById() {
          return null;
        },
        async update() {
          throw new Error("update should not be used; upsert is canonical");
        },
        async upsert(id: string, template: string) {
          savedTemplate = template;
          return preset(id, template);
        }
      },
      {
        async assertCanReadAdminSurface() {
          return undefined;
        }
      } as never,
      {
        async execute() {
          bumped += 1;
        }
      } as never
    );

    const result = await service.resetToDefault("admin-user", "agents");
    assert.equal(result.template, VISIBLE_PROMPT_TEMPLATE_DEFAULTS.agents);
    assert.equal(savedTemplate, VISIBLE_PROMPT_TEMPLATE_DEFAULTS.agents);
    assert.equal(bumped, 1, "successful reset should bump config generation");
  }
}

void run();
