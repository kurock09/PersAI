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
    code: "reminder_task",
    displayName: "Reminder Task",
    description: "Create and manage reminders.",
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
    ]
  });

  assert.deepEqual(
    toolPolicies.map((tool) => ({
      toolCode: tool.toolCode,
      kind: tool.kind,
      executionMode: tool.executionMode,
      usageRule: tool.usageRule,
      enabled: tool.enabled,
      visibleToModel: tool.visibleToModel,
      dailyCallLimit: tool.dailyCallLimit
    })),
    [
      {
        toolCode: "web_search",
        kind: "plan",
        executionMode: "inline",
        usageRule: "allowed",
        enabled: true,
        visibleToModel: true,
        dailyCallLimit: 20
      },
      {
        toolCode: "image_generate",
        kind: "plan",
        executionMode: "worker",
        usageRule: "forbidden",
        enabled: false,
        visibleToModel: false,
        dailyCallLimit: 5
      },
      {
        toolCode: "reminder_task",
        kind: "plan",
        executionMode: "worker",
        usageRule: "allowed",
        enabled: true,
        visibleToModel: true,
        dailyCallLimit: null
      },
      {
        toolCode: "persai_tool_quota_status",
        kind: "system",
        executionMode: "inline",
        usageRule: "allowed",
        enabled: true,
        visibleToModel: true,
        dailyCallLimit: null
      },
      {
        toolCode: "cron",
        kind: "internal",
        executionMode: "worker",
        usageRule: "forbidden",
        enabled: true,
        visibleToModel: false,
        dailyCallLimit: null
      }
    ]
  );

  const markdown = buildRuntimeToolPoliciesMarkdown(toolPolicies);
  assert.match(markdown, /## Active Plan Tools/);
  assert.match(markdown, /\*\*web_search\*\* — inline, allowed \(daily limit: 20\)/);
  assert.match(markdown, /\*\*reminder_task\*\* — worker, allowed/);
  assert.match(markdown, /## Active System Tools/);
  assert.match(markdown, /\*\*persai_tool_quota_status\*\* — inline, allowed/);
  assert.match(markdown, /## Disabled Tools/);
  assert.match(markdown, /~~image_generate~~ — worker, forbidden on current plan/);
  assert.doesNotMatch(markdown, /cron/);
}

void run();
