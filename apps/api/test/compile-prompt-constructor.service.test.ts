import assert from "node:assert/strict";
import { PROMPT_TEMPLATE_DEFAULTS } from "../prisma/bootstrap-preset-data";
import { CompilePromptConstructorService } from "../src/modules/workspace-management/application/compile-prompt-constructor.service";

const baseInput = () => ({
  publishedVersion: {
    id: "version-1",
    assistantId: "assistant-1",
    version: 1,
    snapshotDisplayName: "Nova",
    snapshotInstructions: "Be warm and grounded.",
    snapshotTraits: { warmth: 80, initiative: 55 },
    snapshotAvatarEmoji: "🌟",
    snapshotAvatarUrl: null,
    snapshotAssistantGender: "female" as const,
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
      kind: "system" as const,
      executionMode: "inline" as const,
      usageRule: "allowed" as const,
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
      kind: "plan" as const,
      executionMode: "inline" as const,
      usageRule: "allowed" as const,
      enabled: true,
      visibleToModel: true,
      visibleInPlanEditor: true,
      dailyCallLimit: 30
    }
  ]
});

async function runTemplatedCompile(): Promise<void> {
  const service = new CompilePromptConstructorService();
  const compiled = service.compile({
    ...baseInput(),
    enabledSkillCards: [
      {
        id: "skill-1",
        name: "Accountant",
        description: "Accounting support",
        category: "finance",
        tags: ["tax", "books"],
        iconEmoji: "🧾",
        title: "Accounting mode",
        body: "Use accounting knowledge carefully.",
        guardrails: ["No legal guarantees"],
        examples: ["Explain tax categories"]
      }
    ],
    promptTemplates: {
      system: `{{assistant_identity_block}}

{{enabled_skills_block}}

{{tools_block}}

{{soul_block}}

{{agents_block}}

{{heartbeat_block}}`,
      soul: "# Core Persona\n\n{{instructions_block}}",
      user: "# User Context\n\n{{user_name_line}}",
      identity: "# Identity\n\n{{assistant_name}}",
      enabled_skills: "{{skill_cards_block}}",
      tools: `Native tool runtime:

Use only the machine-readable tools declared for this turn.
Do not rely on old TOOLS.md text, catalog alias names, or undeclared helpers.
When you need multiple independent tool results, return them in a single response so they can run in parallel; keep dependent calls separate.

{{tools_catalog_block}}`,
      agents: "# Governance\n\nUse memory_write carefully.\nUse scheduled_action carefully.",
      heartbeat: "# Task Heartbeat\n\nStay quiet unless a user-visible follow-up is warranted.",
      preview_bootstrap:
        "# Character Preview\n\nShow {{assistant_name}}'s personality when talking to {{human_name}}.",
      welcome_bootstrap:
        "# First Conversation\n\nYour name is {{assistant_name}}. Say hello to {{human_name}}."
    }
  });

  const systemPrompt = compiled.promptConstructor.ordinary.systemPrompt ?? "";

  assert.match(systemPrompt, /Core Persona/);
  assert.match(systemPrompt, /Enabled Skills/);
  assert.match(systemPrompt, /Accounting mode/);
  assert.match(systemPrompt, /Native tool runtime/);
  assert.match(systemPrompt, /Governance/);

  // ADR-074 P1: heartbeat MUST live outside the cached system prefix.
  assert.doesNotMatch(systemPrompt, /Task Heartbeat/);
  assert.doesNotMatch(systemPrompt, /Stay quiet unless a user-visible follow-up/);
  assert.match(
    compiled.promptDocuments.heartbeat,
    /Stay quiet unless a user-visible follow-up/,
    "heartbeat document must still carry the heartbeat text for runtime developer-message rendering"
  );

  // ADR-074 P1: tool catalog markdown is replaced by provider-native tool definitions; the
  // template-driven `{{tools_catalog_block}}` placeholder must resolve to nothing.
  assert.doesNotMatch(systemPrompt, /web_search/);
  assert.doesNotMatch(systemPrompt, /summarize_context/);
  assert.doesNotMatch(compiled.promptDocuments.tools, /web_search/);
  assert.doesNotMatch(compiled.promptDocuments.tools, /summarize_context/);
  assert.match(compiled.promptDocuments.tools, /Native tool runtime/);
  assert.match(compiled.promptDocuments.tools, /run in parallel; keep dependent calls separate/);

  assert.equal(
    compiled.promptConstructor.ordinary.stablePrefix?.text,
    compiled.promptConstructor.ordinary.systemPrompt
  );
  assert.match(compiled.promptConstructor.ordinary.stablePrefix?.hash ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(systemPrompt, /# User Context/);

  assert.equal(
    compiled.promptConstructor.onboarding.previewTurnPrompt,
    "# Character Preview\n\nShow Nova's personality when talking to Alex."
  );
  assert.equal(
    compiled.promptConstructor.onboarding.welcomeTurnPrompt,
    "# First Conversation\n\nYour name is Nova. Say hello to Alex."
  );
  assert.equal(
    compiled.promptConstructor.onboarding.firstTurnPrompt,
    "# First Conversation\n\nYour name is Nova. Say hello to Alex."
  );
}

async function runCachedPrefixInvariant(): Promise<void> {
  // ADR-074 P1 invariant: changing only the heartbeat must not change the cached system prefix.
  const service = new CompilePromptConstructorService();
  const input = baseInput();
  const templates = {
    system: `{{assistant_identity_block}}

{{tools_block}}

{{soul_block}}

{{agents_block}}

{{heartbeat_block}}`,
    soul: "# Core Persona\n\n{{instructions_block}}",
    tools: "Native tool runtime placeholder.",
    agents: "# Governance",
    heartbeat: "Heartbeat A",
    preview_bootstrap: "preview",
    welcome_bootstrap: "welcome"
  };
  const a = service.compile({ ...input, promptTemplates: { ...templates } });
  const b = service.compile({
    ...input,
    promptTemplates: { ...templates, heartbeat: "Heartbeat B — totally different per-turn payload" }
  });

  assert.equal(
    a.promptConstructor.ordinary.systemPrompt,
    b.promptConstructor.ordinary.systemPrompt,
    "system prompt must be byte-stable when only heartbeat changes"
  );
  assert.equal(
    a.promptConstructor.ordinary.stablePrefix?.hash,
    b.promptConstructor.ordinary.stablePrefix?.hash,
    "stable prefix hash must be identical when only heartbeat changes"
  );
  assert.notEqual(
    a.promptDocuments.heartbeat,
    b.promptDocuments.heartbeat,
    "heartbeat document still varies per turn (it is the per-turn payload)"
  );
}

// ADR-074 Slice T1: presence is a NEW per-turn developer-tail block. It MUST
// behave like heartbeat with respect to the cached system prefix:
//   * the rendered presence text must NEVER appear in `systemPrompt`
//   * mutating the presence template MUST NOT change `systemPrompt` /
//     `stablePrefix.hash`
//   * the compiled presence document IS the (updated) per-turn template text
async function runPresenceCachedPrefixInvariant(): Promise<void> {
  const service = new CompilePromptConstructorService();
  const input = baseInput();
  const templates = {
    system: `{{assistant_identity_block}}

{{tools_block}}

{{soul_block}}

{{agents_block}}

{{heartbeat_block}}`,
    soul: "# Core Persona\n\n{{instructions_block}}",
    tools: "Native tool runtime placeholder.",
    agents: "# Governance",
    heartbeat: "Heartbeat A",
    presence: "# Sense of Time A\n\n- placeholder: {{current_local_time}}",
    preview_bootstrap: "preview",
    welcome_bootstrap: "welcome"
  };
  const a = service.compile({ ...input, promptTemplates: { ...templates } });
  const b = service.compile({
    ...input,
    promptTemplates: {
      ...templates,
      presence: "# Sense of Time B — TOTALLY different per-turn payload {{current_local_weekday}}"
    }
  });

  assert.equal(
    a.promptConstructor.ordinary.systemPrompt,
    b.promptConstructor.ordinary.systemPrompt,
    "system prompt must be byte-stable when only the presence template changes"
  );
  assert.equal(
    a.promptConstructor.ordinary.stablePrefix?.hash,
    b.promptConstructor.ordinary.stablePrefix?.hash,
    "stable prefix hash must be identical when only the presence template changes"
  );
  const systemPrompt = a.promptConstructor.ordinary.systemPrompt ?? "";
  assert.doesNotMatch(
    systemPrompt,
    /Sense of Time/,
    "presence text must NOT leak into systemPrompt"
  );
  assert.doesNotMatch(
    systemPrompt,
    /current_local_time|current_local_weekday/,
    "presence placeholders must NOT leak into systemPrompt"
  );
  assert.notEqual(
    a.promptDocuments.presence,
    b.promptDocuments.presence,
    "presence document still varies per template (it is the per-turn payload, with placeholders unresolved)"
  );
  assert.match(
    a.promptDocuments.presence,
    /\{\{current_local_time\}\}/,
    "compile path must NOT pre-interpolate presence placeholders; runtime renderer owns that"
  );
}

async function runFallbackCompile(): Promise<void> {
  // Without any custom prompt template the legacy concatenation path runs.
  // ADR-074 P1: heartbeat must still be excluded from the fallback systemPrompt, but the legacy
  // tool-policies markdown remains as a safety net so a fresh DB without seed rows still carries
  // tool guidance into the prompt.
  const service = new CompilePromptConstructorService();
  const compiled = service.compile({
    ...baseInput(),
    promptTemplates: {}
  });
  const systemPrompt = compiled.promptConstructor.ordinary.systemPrompt ?? "";
  assert.match(systemPrompt, /summarize_context/, "fallback path keeps tool-policy markdown");
  assert.doesNotMatch(
    systemPrompt,
    /Stay quiet unless a user-visible follow-up/,
    "fallback path still excludes heartbeat from systemPrompt"
  );
}

async function runDefaultPromptTemplateCompile(): Promise<void> {
  const service = new CompilePromptConstructorService();
  const compiled = service.compile({
    ...baseInput(),
    promptTemplates: { ...PROMPT_TEMPLATE_DEFAULTS }
  });
  const systemPrompt = compiled.promptConstructor.ordinary.systemPrompt ?? "";
  const soulPrompt = compiled.promptDocuments.soul;
  const previewPrompt = compiled.promptConstructor.onboarding.previewTurnPrompt;
  const welcomePrompt = compiled.promptConstructor.onboarding.welcomeTurnPrompt;

  assert.match(
    systemPrompt,
    /Add follow-up actions only when there is a genuinely useful next step/,
    "default system prompt should discourage unnecessary quick actions"
  );
  assert.match(
    systemPrompt,
    /1-2 short plain-text bullet items/,
    "default system prompt must cap quick actions to a small count"
  );
  assert.match(
    systemPrompt,
    /Never write follow-up actions from the assistant's point of view/,
    "default system prompt must forbid assistant-voice quick actions"
  );
  assert.match(
    soulPrompt,
    /female -> use feminine forms like "поняла", "подобрала", "сделала"/,
    "default soul prompt must spell out feminine Russian self-reference guidance"
  );
  assert.match(
    previewPrompt,
    /Write one short first-person intro message/,
    "default preview prompt should ask the assistant to introduce itself"
  );
  assert.match(
    previewPrompt,
    /setup preview, not in a real first live chat/,
    "default preview prompt should stay explicitly separate from the real first chat"
  );
  assert.match(
    welcomePrompt,
    /Telegram, PDF\/PPT creation, image creation\/editing, Skills, knowledge base, reminders, memory/,
    "default welcome prompt should surface standout PersAI capabilities"
  );
  assert.match(
    welcomePrompt,
    /Do not produce a long wall of text, checklist, or FAQ/,
    "default welcome prompt should stay concise and avoid outdated long-form onboarding"
  );
}

async function run(): Promise<void> {
  await runTemplatedCompile();
  await runCachedPrefixInvariant();
  await runPresenceCachedPrefixInvariant();
  await runFallbackCompile();
  await runDefaultPromptTemplateCompile();
}

void run();
