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
        activationStatus: "active"
      },
      {
        toolCode: "image_generate",
        dailyCallLimit: 5,
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
      }
    },
    knowledgeAccessEnabled: true
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
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "scheduled_action" && tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "image_generate" && !tool.enabled));
  assert.ok(toolPolicies.some((tool) => tool.toolCode === "cron" && !tool.visibleToModel));
  assert.equal(
    toolPolicies.filter((tool) => tool.toolCode === "quota_status").length,
    1,
    "quota_status should be emitted only once even when legacy inventory aliases exist"
  );

  const markdown = buildRuntimeToolPoliciesMarkdown(toolPolicies);
  assert.match(markdown, /\*\*`summarize_context`\*\*\nCreate a concise shared-context summary/);
  assert.match(markdown, /\*\*`quota_status`\*\*\nRead live PersAI quota status/);
  assert.match(
    markdown,
    /\*\*`knowledge_search`\*\*\nSearch assistant-owned or PersAI-owned knowledge/
  );
  assert.match(markdown, /\*\*`web_search`\*\*\nSearch the public web\./);
  assert.match(
    markdown,
    /\*\*`scheduled_action`\*\*\nCreate and manage user reminders or hidden assistant actions\./
  );
  assert.doesNotMatch(markdown, /cron/);
  assert.doesNotMatch(markdown, /image_generate/);
}

void run();
