import assert from "node:assert/strict";
import type { EffectiveToolAvailabilityState } from "../src/modules/workspace-management/application/effective-tool-availability.types";
import { resolveRuntimeToolPolicies } from "../src/modules/workspace-management/application/runtime-tool-policy";
import { TOOL_CATALOG } from "../prisma/tool-catalog-data";

const FILES_CATALOG_ROW = TOOL_CATALOG.find((tool) => tool.code === "files");
assert.ok(FILES_CATALOG_ROW, "files catalog row must exist for policy-owner tests");

const tools = [
  {
    code: "web_search",
    displayName: "Web Search",
    description: "Search the public web.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "knowledge",
    toolClass: "cost_driving",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "active",
    effectiveActivation: "active",
    visibleInPlanEditor: true
  },
  {
    code: "image_generate",
    displayName: "Image Generate",
    description: "Generate an image.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "communication",
    toolClass: "cost_driving",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "inactive",
    effectiveActivation: "inactive",
    visibleInPlanEditor: true
  },
  {
    code: "image_edit",
    displayName: "Image Edit",
    description: "Edit an image.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "communication",
    toolClass: "cost_driving",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "inactive",
    effectiveActivation: "inactive",
    visibleInPlanEditor: true
  },
  {
    code: "video_generate",
    displayName: "Video Generate",
    description: "Generate a short video clip.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "communication",
    toolClass: "cost_driving",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "inactive",
    effectiveActivation: "inactive",
    visibleInPlanEditor: true
  },
  {
    code: "scheduled_action",
    displayName: "Scheduled Action",
    description: "Create and manage user reminders or hidden assistant actions.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "workspace_ops",
    toolClass: "utility",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "active",
    effectiveActivation: "active",
    visibleInPlanEditor: true
  },
  {
    code: "document",
    displayName: "Document",
    description: "Create and revise documents.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "workspace_ops",
    toolClass: "cost_driving",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "active",
    effectiveActivation: "active",
    visibleInPlanEditor: true
  },
  {
    code: "files",
    displayName: "Files",
    description: "Unified assistant file tool.",
    modelDescription: FILES_CATALOG_ROW?.modelDescription ?? null,
    modelUsageGuidance: FILES_CATALOG_ROW?.modelUsageGuidance ?? null,
    capabilityGroup: "workspace_ops",
    toolClass: "utility",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "active",
    effectiveActivation: "active",
    visibleInPlanEditor: true
  },
  {
    code: "grep",
    displayName: "Grep",
    description: "Workspace content search.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "workspace_ops",
    toolClass: "utility",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "active",
    effectiveActivation: "active",
    visibleInPlanEditor: true
  },
  {
    code: "glob",
    displayName: "Glob",
    description: "Workspace filename discovery.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "workspace_ops",
    toolClass: "utility",
    policyClass: "plan_managed",
    catalogStatus: "active",
    planActivationStatus: "active",
    effectiveActivation: "active",
    visibleInPlanEditor: true
  },
  {
    code: "persai_tool_quota_status",
    displayName: "Quota Status",
    description: "Check remaining quota.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "workspace_ops",
    toolClass: "utility",
    policyClass: "platform_managed",
    catalogStatus: "active",
    planActivationStatus: "active",
    effectiveActivation: "active",
    visibleInPlanEditor: false
  },
  {
    code: "cron",
    displayName: "Cron",
    description: "Internal scheduler bridge.",
    modelDescription: null,
    modelUsageGuidance: null,
    capabilityGroup: "automation",
    toolClass: "utility",
    policyClass: "hidden_internal",
    catalogStatus: "active",
    planActivationStatus: "active",
    effectiveActivation: "active",
    visibleInPlanEditor: false
  }
] satisfies EffectiveToolAvailabilityState["tools"];

async function run(): Promise<void> {
  const toolPolicies = resolveRuntimeToolPolicies({
    tools,
    planToolQuotaPolicy: [
      {
        toolCode: "web_search",
        dailyCallLimit: 20,
        perTurnCap: 2,
        maxFilePreviewBytes: null,
        maxFilePreviewEdgePx: null,
        activationStatus: "active"
      },
      {
        toolCode: "image_generate",
        dailyCallLimit: 5,
        perTurnCap: null,
        maxFilePreviewBytes: null,
        maxFilePreviewEdgePx: null,
        activationStatus: "inactive"
      },
      {
        toolCode: "files",
        dailyCallLimit: 20,
        perTurnCap: null,
        maxFilePreviewBytes: 1_048_576,
        maxFilePreviewEdgePx: 1024,
        activationStatus: "active"
      }
    ],
    toolCredentialRefs: {
      web_search: {
        refKey: "tool_web_search",
        secretRef: { source: "env", provider: "tavily", id: "tool_web_search" },
        configured: true,
        providerId: "tavily"
      },
      web_fetch: {
        refKey: "tool_web_fetch",
        secretRef: { source: "env", provider: "firecrawl", id: "tool_web_fetch" },
        configured: true,
        providerId: "firecrawl"
      },
      document: {
        refKey: "persai:persai-runtime:tool/document/gamma/api-key",
        secretRef: {
          source: "persai",
          provider: "persai-runtime",
          id: "tool/document/gamma/api-key"
        },
        configured: true,
        providerId: "gamma"
      }
    },
    knowledgeAccessEnabled: true,
    sandboxEnabled: true
  });

  assert.ok(toolPolicies.some((tool) => tool.toolCode === "summarize_context" && tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "compact_context" && tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "memory_write" && tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "quota_status" && tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "knowledge_search" && tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "knowledge_fetch" && tool.enabled));
  assert.ok(
    toolPolicies.some(
      (tool) => tool.toolCode === "web_search" && tool.enabled && tool.dailyCallLimit === 20
    )
  );
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "document" && tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "scheduled_action" && tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "files" && tool.enabled));
  // ADR-123 Slice 7 — grep/glob are inline workspace tools, available wherever
  // the sandbox workspace is (sandboxEnabled), with executionMode "inline".
  const grepPolicy = toolPolicies.find((tool) => tool.toolCode === "grep");
  assert.ok(grepPolicy?.enabled, "grep must be enabled when active + sandboxEnabled");
  assert.equal(grepPolicy?.executionMode, "inline", "grep executionMode must be inline");
  const globPolicy = toolPolicies.find((tool) => tool.toolCode === "glob");
  assert.ok(globPolicy?.enabled, "glob must be enabled when active + sandboxEnabled");
  assert.equal(globPolicy?.executionMode, "inline", "glob executionMode must be inline");
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "image_generate" && !tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "cron" && !tool.visibleToModel));

  // ADR-074 Slice L1 — per-tool perTurnCap from PlanCatalogToolActivation is
  // surfaced into the runtime tool policy so the bundle compile pipeline can
  // ship it to the runtime, where it overrides TOOL_HARD_CAP_PER_TURN.
  const webSearchPolicy = toolPolicies.find((tool) => tool.toolCode === "web_search");
  assert.equal(webSearchPolicy?.perTurnCap, 2, "web_search perTurnCap is propagated");
  const imageGeneratePolicy = toolPolicies.find((tool) => tool.toolCode === "image_generate");
  assert.equal(
    imageGeneratePolicy?.perTurnCap,
    null,
    "image_generate perTurnCap is null when not overridden"
  );
  // Synthetic / platform / hidden-internal policies never carry a perTurnCap;
  // they fall back to TOOL_HARD_CAP_PER_TURN code defaults at runtime.
  const compactPolicy = toolPolicies.find((tool) => tool.toolCode === "compact_context");
  assert.equal(compactPolicy?.perTurnCap, null, "synthetic policies have null perTurnCap");
  const cronPolicy = toolPolicies.find((tool) => tool.toolCode === "cron");
  assert.equal(cronPolicy?.perTurnCap, null, "hidden-internal policies have null perTurnCap");
  const filesPolicy = toolPolicies.find((tool) => tool.toolCode === "files");
  // ADR-128 Slice 4 — flat workspace. The description/usage guidance no longer
  // mentions /workspace/input/, /workspace/outbound/self/, or role-based regions.
  assert.match(
    filesPolicy?.description ?? "",
    /Path-driven file operations on the single flat `\/workspace\/` namespace/
  );
  assert.equal(
    filesPolicy?.description ?? "",
    FILES_CATALOG_ROW?.modelDescription ?? "",
    "files description must flow from the catalog owner without a runtime-policy shadow override"
  );
  assert.match(filesPolicy?.description ?? "", /exact listed `\/workspace\/\.\.\.` path/);
  assert.match(
    filesPolicy?.description ?? "",
    /never reconstruct paths from displayName\/filename/
  );
  assert.doesNotMatch(filesPolicy?.description ?? "", /\/workspace\/<filename>/);
  assert.doesNotMatch(filesPolicy?.description ?? "", /\/workspace\/input/);
  assert.doesNotMatch(filesPolicy?.description ?? "", /\/workspace\/outbound/);
  assert.doesNotMatch(filesPolicy?.description ?? "", /write-and-send|files\.send|files\.search/);
  assert.doesNotMatch(filesPolicy?.description ?? "", /coming soon/i);
  assert.match(filesPolicy?.usageGuidance ?? "", /^WHEN TO USE:/m);
  assert.equal(
    filesPolicy?.usageGuidance ?? "",
    FILES_CATALOG_ROW?.modelUsageGuidance ?? "",
    "files usage guidance must flow from the catalog owner without a runtime-policy shadow override"
  );
  assert.match(filesPolicy?.usageGuidance ?? "", /exact path from the Working Files block/);
  assert.match(
    filesPolicy?.usageGuidance ?? "",
    /Do not reconstruct upload paths from displayName\/filename/
  );
  assert.doesNotMatch(filesPolicy?.usageGuidance ?? "", /\/workspace\/<filename>/);
  assert.doesNotMatch(
    filesPolicy?.usageGuidance ?? "",
    /use exec or shell|use grep|use glob|use document/i
  );
  assert.doesNotMatch(filesPolicy?.usageGuidance ?? "", /\/workspace\/input/);
  assert.doesNotMatch(filesPolicy?.usageGuidance ?? "", /\/workspace\/outbound/);
  assert.match(filesPolicy?.usageGuidance ?? "", /^EXAMPLES:/m);
  assert.match(filesPolicy?.usageGuidance ?? "", /^GOTCHAS:/m);
  assert.match(filesPolicy?.usageGuidance ?? "", /six actions|Six actions/i);
  assert.match(filesPolicy?.usageGuidance ?? "", /action:"attach"/);
  assert.doesNotMatch(filesPolicy?.usageGuidance ?? "", /coming soon/i);
  assert.doesNotMatch(
    filesPolicy?.usageGuidance ?? "",
    /files\.write_and_send|files\.inspect|files\.send/
  );
  assert.equal(filesPolicy?.maxFilePreviewBytes, 1_048_576);
  assert.equal(filesPolicy?.maxFilePreviewEdgePx, 1024);
  assert.equal(
    toolPolicies.filter((tool) => tool.toolCode === "quota_status").length,
    1,
    "quota_status should be emitted only once even when synthetic and catalog policies overlap"
  );
  assert.equal(toolPolicies.filter((tool) => tool.toolCode === "files").length, 1);

  const videoTools = tools.map((tool) =>
    tool.code === "video_generate"
      ? { ...tool, planActivationStatus: "active", effectiveActivation: "active" }
      : tool.code === "image_generate" || tool.code === "image_edit"
        ? { ...tool, planActivationStatus: "active", effectiveActivation: "active" }
        : tool
  );
  const videoToolPolicies = resolveRuntimeToolPolicies({
    tools: videoTools,
    planToolQuotaPolicy: [],
    toolCredentialRefs: {
      video_generate: {
        refKey: "tool_video_generate_runway",
        secretRef: {
          source: "persai",
          provider: "persai-runtime",
          id: "tool/video_generate/runway/api-key"
        },
        configured: true,
        providerId: "runway"
      },
      image_generate: {
        refKey: "tool_image_generate_runway",
        secretRef: {
          source: "persai",
          provider: "persai-runtime",
          id: "tool/video_generate/runway/api-key"
        },
        configured: true,
        providerId: "runway"
      },
      image_edit: {
        refKey: "tool_image_edit_kling",
        secretRef: {
          source: "persai",
          provider: "persai-runtime",
          id: "tool/video_generate/kling/api-key"
        },
        configured: true,
        providerId: "kling"
      }
    },
    knowledgeAccessEnabled: true,
    sandboxEnabled: true
  });
  assert.ok(
    videoToolPolicies.some((tool) => tool.toolCode === "video_generate" && tool.enabled),
    "video_generate should be enabled for configured Runway refs"
  );
  assert.ok(
    videoToolPolicies.some((tool) => tool.toolCode === "image_generate" && !tool.enabled),
    "image_generate must remain OpenAI-only"
  );
  assert.ok(
    videoToolPolicies.some((tool) => tool.toolCode === "image_edit" && !tool.enabled),
    "image_edit must remain OpenAI-only"
  );

  const unsupportedVideoPolicies = resolveRuntimeToolPolicies({
    tools: videoTools,
    planToolQuotaPolicy: [],
    toolCredentialRefs: {
      video_generate: {
        refKey: "tool_video_generate_unknown",
        secretRef: {
          source: "persai",
          provider: "persai-runtime",
          id: "tool/video_generate/unknown/api-key"
        },
        configured: true,
        providerId: "unknown-provider"
      }
    },
    knowledgeAccessEnabled: true,
    sandboxEnabled: true
  });
  assert.ok(
    unsupportedVideoPolicies.some((tool) => tool.toolCode === "video_generate" && !tool.enabled),
    "unsupported video providers must stay hidden"
  );
}

void run();
