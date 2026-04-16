import assert from "node:assert/strict";
import { CompilePromptConstructorService } from "../src/modules/workspace-management/application/compile-prompt-constructor.service";

async function run(): Promise<void> {
  const service = new CompilePromptConstructorService();

  const compiled = service.compile({
    publishedVersion: {
      id: "version-1",
      assistantId: "assistant-1",
      version: 1,
      snapshotDisplayName: "Nova",
      snapshotInstructions: "Be warm and grounded.",
      snapshotTraits: { warmth: 80, initiative: 55 },
      snapshotAvatarEmoji: "🌟",
      snapshotAvatarUrl: null,
      snapshotAssistantGender: "female",
      snapshotVoiceProfile: null,
      publishedByUserId: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    },
    userContext: {
      displayName: "Alex",
      birthday: "1995-06-15",
      gender: "male",
      locale: "en-US",
      timezone: "Europe/Moscow"
    },
    toolPolicies: [
      {
        toolCode: "web_search",
        displayName: "Web Search",
        description: "Search the public web for current external facts.",
        usageGuidance: "Use this for fresh facts and links.",
        kind: "plan",
        executionMode: "inline",
        usageRule: "allowed",
        enabled: true,
        visibleToModel: true,
        visibleInPlanEditor: true,
        dailyCallLimit: 30
      }
    ],
    memoryControl: {},
    tasksControl: {},
    promptTemplates: {
      soul: "# Core Persona\n\n{{instructions_block}}",
      user: "# User Context\n\n{{user_name_line}}",
      identity: "# Identity\n\n{{assistant_name}}",
      tools: "# Tool Runtime\n\n{{tools_catalog_block}}",
      agents: "# Governance\n\n{{memory_policy_block}}\n{{tasks_policy_block}}",
      heartbeat: "# Task Heartbeat\n\n{{tasks_heartbeat_hint}}",
      bootstrap:
        "# First Conversation\n\nYour name is {{assistant_name}}. Say hello to {{human_name}}."
    }
  });

  assert.match(compiled.promptDocuments.tools, /web_search/);
  assert.match(compiled.promptDocuments.tools, /Use this for fresh facts and links/);
  assert.match(compiled.promptConstructor.ordinary.systemPrompt ?? "", /Core Persona/);
  assert.match(
    compiled.promptConstructor.ordinary.systemPrompt ?? "",
    /Search the public web for current external facts/
  );
  assert.equal(
    compiled.promptConstructor.onboarding.firstTurnPrompt,
    "# First Conversation\n\nYour name is Nova. Say hello to Alex."
  );
}

void run();
