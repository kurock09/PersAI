import assert from "node:assert/strict";
import { ManageAdminToolPromptMetadataService } from "../src/modules/workspace-management/application/manage-admin-tool-prompt-metadata.service";

async function run(): Promise<void> {
  {
    let bumped = 0;
    const service = new ManageAdminToolPromptMetadataService(
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
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.toolCode, "web_search");

    const updated = await service.update("admin-user", "web_search", {
      modelDescription: "Search current public web information.",
      modelUsageGuidance: "Use for links and recent external facts."
    });
    assert.equal(updated.modelDescription, "Search current public web information.");
    assert.equal(updated.modelUsageGuidance, "Use for links and recent external facts.");
    assert.equal(bumped, 1);
  }

  {
    const service = new ManageAdminToolPromptMetadataService(
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
}

void run();
