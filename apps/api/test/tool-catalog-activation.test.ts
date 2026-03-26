import assert from "node:assert/strict";
import { ResolveEffectiveToolAvailabilityService } from "../src/modules/workspace-management/application/resolve-effective-tool-availability.service";
import type { ToolCatalogRepository } from "../src/modules/workspace-management/domain/tool-catalog.repository";

type ToolCatalogRepoStub = Pick<ToolCatalogRepository, "listToolsForPlanActivationView">;

function createService(
  toolCatalogRepo: ToolCatalogRepoStub
): ResolveEffectiveToolAvailabilityService {
  return new ResolveEffectiveToolAvailabilityService(toolCatalogRepo as ToolCatalogRepository);
}

async function run(): Promise<void> {
  const repoStub: ToolCatalogRepoStub = {
    async listToolsForPlanActivationView() {
      return [
        {
          toolCode: "web_search",
          displayName: "Web Search",
          description: "Provider-backed external web lookup tool.",
          toolClass: "cost_driving",
          capabilityGroup: "knowledge",
          catalogStatus: "active",
          planActivationStatus: "active"
        },
        {
          toolCode: "memory_get",
          displayName: "Memory Get",
          description: "Safe snippet read from memory files with optional offset/lines.",
          toolClass: "utility",
          capabilityGroup: "workspace_ops",
          catalogStatus: "active",
          planActivationStatus: "active"
        }
      ];
    }
  };

  const service = createService(repoStub);
  const resolved = await service.execute({
    effectiveCapabilities: {
      schema: "persai.effectiveCapabilities.v1",
      derivedFrom: {
        planCode: "starter_trial",
        planStatus: "active",
        governanceSchema: null
      },
      subscription: {
        source: "workspace_subscription",
        status: "trialing",
        planCode: "starter_trial",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      },
      toolClasses: {
        costDriving: {
          allowed: false,
          quotaGoverned: true
        },
        utility: {
          allowed: true,
          quotaGoverned: true
        }
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: true,
        whatsapp: false,
        max: false
      },
      mediaClasses: {
        text: true,
        image: false,
        audio: false,
        video: false,
        file: false
      }
    }
  });

  assert.equal(resolved.schema, "persai.effectiveToolAvailability.v2");
  assert.equal(resolved.toolClasses.utility.activation, "active");
  assert.equal(resolved.toolClasses.costDriving.activation, "inactive");
  assert.equal(
    resolved.tools.find((tool) => tool.code === "memory_get")?.effectiveActivation,
    "active"
  );
  assert.equal(
    resolved.tools.find((tool) => tool.code === "web_search")?.effectiveActivation,
    "inactive"
  );
}

void run();
