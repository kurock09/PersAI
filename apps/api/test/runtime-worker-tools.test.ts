import assert from "node:assert/strict";
import type { RuntimeToolPolicy } from "@persai/runtime-contract";
import { buildRuntimeWorkerToolsConfig } from "../src/modules/workspace-management/application/runtime-worker-tools";

const TOOL_POLICIES = [
  {
    toolCode: "web_search",
    displayName: "Web Search",
    description: "Search the web.",
    kind: "plan",
    executionMode: "inline",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: true,
    dailyCallLimit: 20
  },
  {
    toolCode: "browser",
    displayName: "Browser",
    description: "Navigate and interact with web pages.",
    kind: "plan",
    executionMode: "worker",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: true,
    dailyCallLimit: null
  },
  {
    toolCode: "image_generate",
    displayName: "Image Generate",
    description: "Generate images.",
    kind: "plan",
    executionMode: "worker",
    usageRule: "forbidden",
    enabled: false,
    visibleToModel: false,
    visibleInPlanEditor: true,
    dailyCallLimit: 5
  },
  {
    toolCode: "tts",
    displayName: "Text to Speech",
    description: "Generate speech audio.",
    kind: "plan",
    executionMode: "worker",
    usageRule: "forbidden",
    enabled: false,
    visibleToModel: false,
    visibleInPlanEditor: true,
    dailyCallLimit: null
  },
  {
    toolCode: "reminder_task",
    displayName: "Reminder Task",
    description: "Create and manage reminders.",
    kind: "plan",
    executionMode: "worker",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: true,
    dailyCallLimit: null
  },
  {
    toolCode: "cron",
    displayName: "Cron",
    description: "Internal scheduler bridge.",
    kind: "internal",
    executionMode: "worker",
    usageRule: "forbidden",
    enabled: true,
    visibleToModel: false,
    visibleInPlanEditor: false,
    dailyCallLimit: null
  }
] satisfies RuntimeToolPolicy[];

async function run(): Promise<void> {
  const workerTools = buildRuntimeWorkerToolsConfig(TOOL_POLICIES);

  assert.deepEqual(workerTools, {
    tools: [
      {
        toolCode: "browser",
        family: "browser_interaction",
        outcomeKind: "structured_output",
        timeoutMs: 120000,
        confirmationRule: "required_for_mutations",
        supportsProviderRouting: true,
        failureBehavior: "surface_error"
      },
      {
        toolCode: "image_generate",
        family: "media_generation",
        outcomeKind: "artifact_refs",
        timeoutMs: 180000,
        confirmationRule: "none",
        supportsProviderRouting: true,
        failureBehavior: "surface_error"
      },
      {
        toolCode: "tts",
        family: "media_generation",
        outcomeKind: "artifact_refs",
        timeoutMs: 60000,
        confirmationRule: "none",
        supportsProviderRouting: true,
        failureBehavior: "surface_error"
      },
      {
        toolCode: "reminder_task",
        family: "scheduled_action",
        outcomeKind: "state_mutation",
        timeoutMs: 30000,
        confirmationRule: "required_for_mutations",
        supportsProviderRouting: false,
        failureBehavior: "retry_then_surface_error"
      },
      {
        toolCode: "cron",
        family: "internal_scheduler",
        outcomeKind: "state_mutation",
        timeoutMs: 30000,
        confirmationRule: "none",
        supportsProviderRouting: false,
        failureBehavior: "retry_then_surface_error"
      }
    ]
  });

  assert.throws(
    () =>
      buildRuntimeWorkerToolsConfig([
        ...TOOL_POLICIES,
        {
          toolCode: "video_generate",
          displayName: "Video Generate",
          description: "Generate a video.",
          kind: "plan",
          executionMode: "worker",
          usageRule: "forbidden",
          enabled: false,
          visibleToModel: false,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        }
      ]),
    /Missing explicit runtime worker-tool baseline/
  );
}

void run();
