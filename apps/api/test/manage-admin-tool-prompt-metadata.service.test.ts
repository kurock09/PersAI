import assert from "node:assert/strict";
import {
  buildSyntheticToolMetadataPromptTemplateId,
  HIDDEN_PROMPT_TEMPLATE_DEFAULTS
} from "../prisma/bootstrap-preset-data";
import { ManageAdminToolPromptMetadataService } from "../src/modules/workspace-management/application/manage-admin-tool-prompt-metadata.service";

async function run(): Promise<void> {
  {
    assert.equal(
      Object.keys(HIDDEN_PROMPT_TEMPLATE_DEFAULTS).every((id) => id.length <= 32),
      true
    );
  }

  {
    let bumped = 0;
    const service = new ManageAdminToolPromptMetadataService(
      {
        async findAll() {
          return [];
        },
        async findById() {
          return null;
        },
        async update() {
          throw new Error("not used");
        },
        async upsert(id: string, template: string) {
          return {
            id,
            template,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      },
      {
        async listToolsForPlanActivationView() {
          return [];
        },
        async listToolsForPromptMetadata() {
          return [
            {
              toolCode: "web_search",
              displayName: "Web Search",
              description: "Catalog description",
              modelDescription: "Search the public web.",
              modelUsageGuidance: "Use for fresh external facts.",
              toolClass: "utility",
              capabilityGroup: "knowledge",
              policyClass: "plan_managed",
              catalogStatus: "active"
            }
          ];
        },
        async updateToolPromptMetadata(toolCode: string, patch: Record<string, unknown>) {
          return {
            toolCode,
            displayName: "Web Search",
            description: "Catalog description",
            modelDescription: patch.modelDescription as string,
            modelUsageGuidance: patch.modelUsageGuidance as string,
            toolClass: "utility" as const,
            capabilityGroup: "knowledge" as const,
            policyClass: "plan_managed" as const,
            catalogStatus: "active" as const
          };
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

    const listed = await service.list("admin-user");
    assert.equal(listed.length, 7);
    assert.equal(listed[0]?.toolCode, "summarize_context");
    assert.equal(listed[6]?.toolCode, "web_search");

    const updated = await service.update("admin-user", "web_search", {
      modelDescription: "Search current public web information.",
      modelUsageGuidance: "Use for links and recent external facts."
    });
    assert.equal(updated.modelDescription, "Search current public web information.");
    assert.equal(updated.modelUsageGuidance, "Use for links and recent external facts.");
    assert.equal(bumped, 1);
  }

  {
    let bumped = 0;
    let storedDescription = "";
    let storedGuidance = "";
    const summarizeDescriptionId = buildSyntheticToolMetadataPromptTemplateId(
      "summarize_context",
      "description"
    );
    const summarizeGuidanceId = buildSyntheticToolMetadataPromptTemplateId(
      "summarize_context",
      "usage_guidance"
    );
    const service = new ManageAdminToolPromptMetadataService(
      {
        async findAll() {
          return [
            {
              id: summarizeDescriptionId,
              template: storedDescription,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            {
              id: summarizeGuidanceId,
              template: storedGuidance,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ];
        },
        async findById() {
          return null;
        },
        async update() {
          throw new Error("not used");
        },
        async upsert(id: string, template: string) {
          if (id === summarizeDescriptionId) {
            storedDescription = template;
          } else if (id === summarizeGuidanceId) {
            storedGuidance = template;
          }
          return {
            id,
            template,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      },
      {
        async listToolsForPlanActivationView() {
          return [];
        },
        async listToolsForPromptMetadata() {
          return [];
        },
        async updateToolPromptMetadata() {
          throw new Error("not used");
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

    const updated = await service.update("admin-user", "summarize_context", {
      modelDescription: "Short summary.",
      modelUsageGuidance: "Use only when needed."
    });
    assert.equal(updated.toolCode, "summarize_context");
    assert.equal(updated.modelDescription, "Short summary.");
    assert.equal(updated.modelUsageGuidance, "Use only when needed.");
    assert.equal(bumped, 1);
  }

  {
    const service = new ManageAdminToolPromptMetadataService(
      {
        async findAll() {
          return [];
        },
        async findById() {
          return null;
        },
        async update() {
          throw new Error("not used");
        },
        async upsert(id: string, template: string) {
          return {
            id,
            template,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      },
      {
        async listToolsForPlanActivationView() {
          return [];
        },
        async listToolsForPromptMetadata() {
          return [];
        },
        async updateToolPromptMetadata() {
          throw new Error('Tool "missing_tool" not found.');
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
      () => service.update("admin-user", "missing_tool", { modelDescription: "x" }),
      /Tool "missing_tool" does not exist/
    );
  }

  {
    let touchedCatalog = false;
    const service = new ManageAdminToolPromptMetadataService(
      {
        async findAll() {
          return [];
        },
        async findById() {
          return null;
        },
        async update() {
          throw new Error("not used");
        },
        async upsert(id: string, template: string) {
          return {
            id,
            template,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }
      },
      {
        async listToolsForPlanActivationView() {
          return [];
        },
        async listToolsForPromptMetadata() {
          return [];
        },
        async updateToolPromptMetadata() {
          touchedCatalog = true;
          throw new Error("not used");
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
      () => service.update("admin-user", "read_file", { modelDescription: "legacy" }),
      /Tool "read_file" does not exist/
    );
    assert.equal(touchedCatalog, false);
  }
}

void run();
