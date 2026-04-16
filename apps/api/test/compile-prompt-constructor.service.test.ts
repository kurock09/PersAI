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
        toolCode: "summarize_context",
        displayName: "Summarize Context",
        description:
          "Create a concise shared-context summary for the current session without changing later-turn compaction state.",
        usageGuidance:
          "Use when the user explicitly asks to summarize earlier context or when you need a temporary summary to continue reasoning.",
        kind: "system",
        executionMode: "inline",
        usageRule: "allowed",
        enabled: true,
        visibleToModel: true,
        visibleInPlanEditor: false,
        dailyCallLimit: null
      },
      {
        toolCode: "web_search",
        displayName: "Web Search",
        description: "Search the public web through the currently configured search provider.",
        usageGuidance:
          "Use this when you need sources or links about a topic and do not already have one exact URL to fetch.",
        kind: "plan",
        executionMode: "inline",
        usageRule: "allowed",
        enabled: true,
        visibleToModel: true,
        visibleInPlanEditor: true,
        dailyCallLimit: 30
      }
    ],
    promptTemplates: {
      system: `{{assistant_identity_block}}

{{tools_block}}

{{soul_block}}

{{agents_block}}

{{heartbeat_block}}`,
      soul: "# Core Persona\n\n{{instructions_block}}",
      user: "# User Context\n\n{{user_name_line}}",
      identity: "# Identity\n\n{{assistant_name}}",
      tools: "{{tools_catalog_block}}",
      agents: "# Governance\n\nUse memory_write carefully.\nUse scheduled_action carefully.",
      heartbeat: "# Task Heartbeat\n\nStay quiet unless a user-visible follow-up is warranted.",
      bootstrap:
        "# First Conversation\n\nYour name is {{assistant_name}}. Say hello to {{human_name}}."
    }
  });

  assert.match(compiled.promptDocuments.tools, /web_search/);
  assert.match(compiled.promptDocuments.tools, /summarize_context/);
  assert.match(
    compiled.promptDocuments.tools,
    /Use this when you need sources or links about a topic/
  );
  assert.match(compiled.promptConstructor.ordinary.systemPrompt ?? "", /Core Persona/);
  assert.match(
    compiled.promptConstructor.ordinary.systemPrompt ?? "",
    /\*\*`summarize_context`\*\*\nCreate a concise shared-context summary/
  );
  assert.doesNotMatch(compiled.promptConstructor.ordinary.systemPrompt ?? "", /# User Context/);
  assert.equal(
    compiled.promptConstructor.onboarding.firstTurnPrompt,
    "# First Conversation\n\nYour name is Nova. Say hello to Alex."
  );
}

void run();
