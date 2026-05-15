import assert from "node:assert/strict";
import type { EffectiveToolAvailabilityState } from "../src/modules/workspace-management/application/effective-tool-availability.types";
import {
  buildRuntimeToolPoliciesMarkdown,
  resolveRuntimeToolPolicies
} from "../src/modules/workspace-management/application/runtime-tool-policy";

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
        activationStatus: "active"
      },
      {
        toolCode: "image_generate",
        dailyCallLimit: 5,
        perTurnCap: null,
        activationStatus: "inactive"
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
        refKey: "tool_document_pdfmonkey",
        secretRef: { source: "env", provider: "pdfmonkey", id: "tool_document_pdfmonkey" },
        configured: true,
        providerId: "pdfmonkey",
        fallbacks: [
          {
            refKey: "tool_document_gamma",
            secretRef: { source: "env", provider: "gamma", id: "tool_document_gamma" },
            configured: true,
            providerId: "gamma"
          }
        ]
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
  assert.match(filesPolicy?.description ?? "", /write-and-send/);
  assert.match(filesPolicy?.usageGuidance ?? "", /files\.write_and_send when the user asks/);
  assert.match(filesPolicy?.usageGuidance ?? "", /filename is only a delivery-name override/);
  assert.match(filesPolicy?.usageGuidance ?? "", /Do not claim a file was sent unless/);
  assert.equal(
    toolPolicies.filter((tool) => tool.toolCode === "quota_status").length,
    1,
    "quota_status should be emitted only once even when synthetic and catalog policies overlap"
  );
  assert.equal(toolPolicies.filter((tool) => tool.toolCode === "files").length, 1);

  const markdown = buildRuntimeToolPoliciesMarkdown(toolPolicies);
  assert.match(markdown, /\*\*`summarize_context`\*\*\nCreate a concise shared-context summary/);
  assert.match(markdown, /\*\*`quota_status`\*\*\nRead live PersAI quota status/);
  assert.match(
    markdown,
    /non-media daily tool counters, main quota buckets, monthly media quotas, and checkout-link creation/
  );
  assert.match(
    markdown,
    /\*\*`knowledge_search`\*\*\nSearch assistant-owned or PersAI-owned knowledge/
  );
  assert.match(markdown, /\*\*`web_search`\*\*\nSearch the public web\./);
  assert.match(markdown, /\*\*`document`\*\*\nCreate and revise documents\./);
  assert.match(
    markdown,
    /\*\*`scheduled_action`\*\*\nCreate and manage user reminders or hidden assistant actions\./
  );
  assert.match(
    markdown,
    /\*\*`files`\*\*\nList, search, inspect, read, write, write-and-send, edit, delete, or send assistant-managed files/
  );
  assert.doesNotMatch(markdown, /cron/);
  assert.doesNotMatch(markdown, /image_generate/);
}

void run();
