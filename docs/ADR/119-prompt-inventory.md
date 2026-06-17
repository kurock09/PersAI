# ADR-119 Prompt Inventory

Scope: ADR-119 Slice 0 architecture inventory and reachability ledger.

Baseline: provider-gateway hotfix handoff says the latest completed checkpoint is SHA `7637ba48`; current worktree was clean before this file was created.

Rules for this ledger:

- Existing files are read-only.
- Citations use `relative/path:LINE` or `relative/path:LINE_START-LINE_END`.
- "Cached prefix" means the materialized `bundle.promptConstructor.ordinary.systemPrompt` that `apps/runtime` passes as `ProviderGatewayTextGenerateRequest.systemPrompt`.
- "Developer tail" means `ProviderGatewayTextGenerateRequest.developerInstructions`.
- "Volatile rail" means `ProviderGatewayTextMessage.cacheRole === "volatile_context"`.

## Section 1 — Prompt-section writers (cached prefix today)

### W1 — Prompt template map and top-level compile

- Writer: `CompilePromptConstructorService.compile`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:38-142`.
- Output: materializes `promptDocuments` for `soul`, `user`, `identity`, `enabledSkills`, `tools`, `agents`, `heartbeat`, `presence`, router classifiers, preview, welcome; then assembles `promptConstructor.ordinary.systemPrompt` and `stablePrefix`.
- Current format: Markdown/prose blocks with template placeholders.
- ADR-119 zone: dispatcher for BP1/BP2/BP3 plus volatile-adjacent `heartbeat`/`presence` raw docs.
- Cache-byte stability: stable only if inputs are stable; depends on published snapshot, user context, prompt templates, tool policies, enabled Skill cards, and Voice DNA.
- Notes: `heartbeat` is explicitly kept out of the cached prefix by comment and raw document storage at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:116-120`.

### W2 — Persona / soul prompt

- Writer: `CompilePromptConstructorService.generateSoulPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:167-258`.
- Output: `# Core Persona`, `# Gendered self-reference`, `# Voice`, openings, emotion behavior, silence, voice examples, traits, and `## Instructions`.
- Current format: Markdown headings, bullets, prose.
- ADR-119 zone: BP1 `<voice>` and `<character_notes>`.
- Cache-byte stability: depends on `snapshotDisplayName`, `snapshotAssistantGender`, `snapshotTraits`, `snapshotInstructions`, and resolved `voiceDna`.
- Duplicate risk: creates `instructionsBlock` from `pv.snapshotInstructions` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:174-176`.

### W3 — Voice example renderer

- Writer: `CompilePromptConstructorService.renderVoiceExamplesBlock`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:267-272`.
- Output: `Example N:` Markdown/prose pairs.
- Current format: Markdown-ish example rows.
- ADR-119 zone: BP1 `<voice><examples>`.
- Cache-byte stability: depends on resolved Voice DNA examples.

### W4 — Personality traits renderer

- Writer: `CompilePromptConstructorService.renderTraitsBlock`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:274-281`.
- Output: `## Personality Traits` plus `- **trait**: N/100`.
- Current format: Markdown heading and bullets.
- ADR-119 zone: BP1 `<voice>` trait fields.
- Cache-byte stability: depends on `snapshotTraits`.

### W5 — User prompt

- Writer: `CompilePromptConstructorService.generateUserPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:283-310`.
- Output: `# User Context` with name, birthday, gender, locale, timezone.
- Current format: Markdown heading and bullets.
- ADR-119 zone: BP1 `<user>`.
- Cache-byte stability: depends on user display name, birthday, gender, locale, timezone.
- Volatile note: user locale/timezone are stable per materialization, but current local time does not belong here.

### W6 — Identity prompt

- Writer: `CompilePromptConstructorService.generateIdentityPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:312-333`.
- Output: `# Identity` with assistant name, gender, avatar emoji, avatar URL.
- Current format: Markdown heading and bullets.
- ADR-119 zone: BP1 `<identity>`.
- Cache-byte stability: depends on published assistant snapshot fields.

### W7 — Enabled Skills wrapper

- Writer: `CompilePromptConstructorService.generateEnabledSkillsPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:335-349`.
- Output: interpolates `{{skill_cards_block}}` or returns rendered Skill cards.
- Current format: Markdown block produced by W16-W18.
- ADR-119 zone: BP3 `<enabled_skills>`.
- Cache-byte stability: depends on enabled Skill assignments and active SkillScenario catalog resolved at materialization time.

### W8 — Tools template selector

- Writer: `CompilePromptConstructorService.generateToolsPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:351-366`.
- Output: DB-backed `tools` template only; strips legacy `{{tools_catalog_block}}`.
- Current format: Markdown selection guide from `bootstrap-preset-data.ts`.
- ADR-119 zone: BP2 `<tool_usage_policy>`.
- Cache-byte stability: template-stable; does not depend on per-turn tool availability.
- Single-seat note: comment says the DB `tools` prompt template is the single selection-guide owner at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:351-355`.

### W9 — Agents / memory policy template

- Writer: `CompilePromptConstructorService.generateAgentsPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:368-370`.
- Output: raw `agents` prompt template.
- Current format: Markdown `# Memory Policy`.
- ADR-119 zone: BP2 `<memory_protocol>`.
- Cache-byte stability: template-stable.

### W10 — Heartbeat / background task template

- Writer: `CompilePromptConstructorService.generateHeartbeatPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:372-374`.
- Output: raw `heartbeat` template.
- Current format: Markdown `# Background Task Evaluation`.
- ADR-119 zone: not normal cached prefix; background-worker prompt / developer-tail adjacent.
- Cache-byte stability: stable as raw template; not in ordinary cached system prompt.

### W11 — Presence template

- Writer: `CompilePromptConstructorService.generatePresencePrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:376-385`.
- Output: raw `presence` template with time placeholders preserved for runtime.
- Current format: Markdown `# Sense of Time`.
- ADR-119 zone: volatile `<persai_environment>`, not BP.
- Cache-byte stability: compile artifact stable because placeholders are not interpolated here.
- Volatile note: comment says placeholders are rendered downstream so the cached compile artefact stays time-invariant at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:376-382`.

### W12 — System prompt assembler

- Writer: `CompilePromptConstructorService.generateSystemPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:387-430`.
- Output: interpolates system template or joins ordinary sections.
- Current format: one Markdown blob.
- ADR-119 zone: all current cached prefix zones.
- Cache-byte stability: depends on all ordinary section bytes; explicitly excludes `heartbeat_block` and `route_control_block` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:391-412`.
- Persona duplicate note: inserts `persona_instructions_block` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:397-412` and fallback includes `ordinarySections.personaInstructions` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:415-429`.

### W13 — Preview prompt

- Writer: `CompilePromptConstructorService.generatePreviewPrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:450-484`.
- Output: setup preview prompt.
- Current format: Markdown/prose.
- ADR-119 zone: onboarding, not ordinary cached prefix.
- Cache-byte stability: depends on published persona and user display name.

### W14 — Welcome prompt

- Writer: `CompilePromptConstructorService.generateWelcomePrompt`.
- Location: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:486-519`.
- Output: first-conversation bootstrap prompt.
- Current format: Markdown/prose.
- ADR-119 zone: onboarding, not ordinary cached prefix.
- Cache-byte stability: depends on published persona and user display name.

### W15 — Enabled Skill card resolver

- Writer: `resolveEnabledSkillPromptCards`.
- Location: `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts:67-94`.
- Output: bounded Skill prompt card objects.
- Current format: data normalized for Markdown rendering.
- ADR-119 zone: BP3 `<enabled_skills>`.
- Cache-byte stability: depends on active Skill rows, assignment status, plan limit, locale, tags, instruction card, and scenarios.
- Current cache issue: includes full `body`, `guardrails`, `examples` at `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts:88-92`.

### W16 — Enabled Skills block renderer

- Writer: `renderEnabledSkillsPromptBlock`.
- Location: `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts:96-110`.
- Output: `# Enabled Skills` intro plus cards.
- Current format: Markdown heading, prose intro.
- ADR-119 zone: BP3 `<enabled_skills>`.
- Cache-byte stability: stable only until Skill catalog/assignment/scenario data changes.

### W17 — Single Skill card renderer

- Writer: `renderSkillCard`.
- Location: `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts:112-161`.
- Output: `## N. Title`, Skill ID, display name, summary, category, tags, body, guardrails, examples, scenario list.
- Current format: Markdown headings, bullets, prose.
- ADR-119 zone: BP3 `<enabled_skills>` for compact catalog; long body/guardrails/examples should move to tool result.
- Cache-byte stability: depends on all rendered Skill fields and scenarios.

### W18 — Scenario catalog resolver

- Writer: `resolveEnabledSkillScenariosForBundle`.
- Location: `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts:167-190`.
- Output: `RuntimeBundleSkillScenario[]` grouped by Skill id.
- Current format: data; rendered by W17 as `Available scenarios:`.
- ADR-119 zone: BP3 compact scenario catalog for `first_step_preview`; full steps should remain volatile.
- Cache-byte stability: changes when active SkillScenario rows change.

### W19 — Voice DNA modulator

- Writer: `modulateVoiceDna`.
- Location: `apps/api/src/modules/workspace-management/application/voice-dna-modulator.ts:105-162`.
- Output: resolved archetype label/description, sentence length, pace, irony, openings, behavior text, silence rule, examples, traits.
- Current format: data consumed by W2/W3.
- ADR-119 zone: BP1 `<voice>`.
- Cache-byte stability: depends on archetype row, locale, and `snapshotTraits`.

### W20 — Synthetic tool prompt metadata defaults

- Writer: `SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS`, `withOverrides`, `buildSyntheticPromptToolOverrideMap`.
- Location: `apps/api/src/modules/workspace-management/application/prompt-constructor-tool-metadata.ts:47-117`, `apps/api/src/modules/workspace-management/application/prompt-constructor-tool-metadata.ts:137-165`, `apps/api/src/modules/workspace-management/application/prompt-constructor-tool-metadata.ts:200-218`.
- Output: descriptions and usage guidance for synthetic tools (`memory_write`, `quota_status`, `knowledge_search`, `knowledge_fetch`, compaction tools).
- Current format: tool metadata strings, later projected into provider tool descriptions.
- ADR-119 zone: BP2 tool descriptor surface, not `tools` selection guide.
- Cache-byte stability: depends on prompt template override rows loaded during materialization, not per-turn state.

### W21 — Tool prompt metadata state helpers

- Writer: `readToolPromptMetadataState`, `buildToolPromptMetadataState`, `patchToolPromptMetadataState`.
- Location: `apps/api/src/modules/workspace-management/application/tool-prompt-metadata.ts:29-37`, `apps/api/src/modules/workspace-management/application/tool-prompt-metadata.ts:40-66`, `apps/api/src/modules/workspace-management/application/tool-prompt-metadata.ts:68-91`.
- Output: persisted catalog `modelDescription` / `modelUsageGuidance` override state.
- Current format: data stored in provider hints.
- ADR-119 zone: BP2 tool descriptor surface.
- Cache-byte stability: changes when admin changes tool prompt metadata.

### W22 — Seeded visible prompt templates

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:33-288`.
- Output: default templates for `system`, `soul`, `user`, `identity`, `enabled_skills`, `agents`, `tools`, `heartbeat`, `presence`, router classifiers, preview, welcome.
- Current format: Markdown/prose template strings.
- ADR-119 zone: BP1/BP2/BP3 plus onboarding/background/volatile templates.
- Cache-byte stability: template-version stable until seed/default changes or DB overrides differ.

### W23 — Seeded `system` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:34-70`.
- Output: concatenates identity/user/locale/timezone/persona/soul/user/identity/enabled skills/response contract/tools/agents.
- Current format: Markdown blob with placeholders.
- ADR-119 zone: whole cached prefix; Slice 1 must split logical BP metadata.
- Cache-byte stability: stable only after interpolation of ordinary sections.

### W24 — Seeded `soul` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.soul`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:72-108`.
- Output: Core Persona, gendered self-reference, Voice, openings, emotion, silence, examples, traits block, instructions block.
- Current format: Markdown headings and placeholders.
- ADR-119 zone: BP1 `<voice>` + `<character_notes>`.
- Cache-byte stability: depends on persona values; includes `{{instructions_block}}` at `apps/api/prisma/bootstrap-preset-data.ts:107-108`.

### W25 — Seeded `user` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.user`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:110-119`.
- Output: User Context.
- Current format: Markdown heading and bullets.
- ADR-119 zone: BP1 `<user>`.
- Cache-byte stability: depends on user/workspace profile.

### W26 — Seeded `identity` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.identity`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:121-126`.
- Output: assistant name, gender, avatar.
- Current format: Markdown heading and bullets.
- ADR-119 zone: BP1 `<identity>`.
- Cache-byte stability: depends on published snapshot.

### W27 — Seeded `enabled_skills` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.enabled_skills`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:128`.
- Output: passthrough `{{skill_cards_block}}`.
- Current format: no wrapper beyond W16.
- ADR-119 zone: BP3 `<enabled_skills>`.
- Cache-byte stability: depends on W16-W18.

### W28 — Seeded `agents` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.agents`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:130-135`.
- Output: Memory Policy.
- Current format: Markdown heading and bullets.
- ADR-119 zone: BP2 `<memory_protocol>`.
- Cache-byte stability: template-stable.

### W29 — Seeded `tools` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.tools`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:137-184`.
- Output: Native Tool Runtime selection guide with Images, Knowledge/Web, Documents, Memory/Tasks, Files, Skills, Deferred media honesty.
- Current format: Markdown heading, subsections, bullets.
- ADR-119 zone: BP2 `<tool_usage_policy>`.
- Cache-byte stability: template-stable; single canonical seat for selection guide.
- ADR-118 Skills line: `## Skills` is present at `apps/api/prisma/bootstrap-preset-data.ts:174-180`.

### W30 — Seeded `heartbeat` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.heartbeat`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:186-193`.
- Output: Background Task Evaluation.
- Current format: Markdown heading and bullets.
- ADR-119 zone: background-worker instructions, not normal cached prefix.
- Cache-byte stability: template-stable.

### W31 — Seeded `presence` template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.presence`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:195-203`.
- Output: Sense of Time with placeholders.
- Current format: Markdown heading and bullets.
- ADR-119 zone: volatile `<persai_environment>`.
- Cache-byte stability: raw template stable; rendered bytes per turn are volatile.

### W32 — Seeded router classifier template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.router_classifier`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:205-224`.
- Output: hidden early router prompt.
- Current format: prose and bullets.
- ADR-119 zone: not cached user-facing prefix; system-tool provider prompt.
- Cache-byte stability: template-stable.

### W33 — Seeded skill state classifier template

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.skill_state_classifier`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:226-240`.
- Output: hidden Skill-state classifier prompt.
- Current format: prose and bullets.
- ADR-119 zone: historical residual; ADR-118 deleted caller path, but template remains seeded.
- Cache-byte stability: template-stable.

### W34 — Seeded onboarding templates

- Writer: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.preview_bootstrap`, `welcome_bootstrap`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:242-287`.
- Output: setup preview and first conversation prompts.
- Current format: Markdown/prose.
- ADR-119 zone: onboarding, not ordinary cached prefix.
- Cache-byte stability: depends on template and interpolated assistant/user values.

### W35 — Hidden synthetic tool template defaults

- Writer: `HIDDEN_PROMPT_TEMPLATE_DEFAULTS`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:290-315`.
- Output: synthetic tool descriptions and usage guidance.
- Current format: prose strings.
- ADR-119 zone: BP2 provider tool descriptor surface.
- Cache-byte stability: template-stable unless admin overrides.

### W36 — Tool catalog modelUsageGuidance

- Writer: `TOOL_CATALOG`.
- Location: `apps/api/prisma/tool-catalog-data.ts:18-274`.
- Output: catalog `modelDescription` and `modelUsageGuidance` per tool.
- Current format: prose strings.
- ADR-119 zone: BP2 tool descriptor surface, not the selection guide.
- Cache-byte stability: seed/catalog stable; admin overrides can change descriptor bytes.
- Required field citations:
  - `web_search`: `apps/api/prisma/tool-catalog-data.ts:19-31`.
  - `web_fetch`: `apps/api/prisma/tool-catalog-data.ts:32-45`.
  - `image_generate`: `apps/api/prisma/tool-catalog-data.ts:46-58`.
  - `image_edit`: `apps/api/prisma/tool-catalog-data.ts:59-73`.
  - `video_generate`: `apps/api/prisma/tool-catalog-data.ts:74-87`.
  - `document`: `apps/api/prisma/tool-catalog-data.ts:88-101`.
  - `tts`: `apps/api/prisma/tool-catalog-data.ts:102-114`.
  - `browser`: `apps/api/prisma/tool-catalog-data.ts:115-128`.
  - legacy `memory_search`: `apps/api/prisma/tool-catalog-data.ts:129-143`.
  - legacy `memory_get`: `apps/api/prisma/tool-catalog-data.ts:144-155`.
  - `cron`: `apps/api/prisma/tool-catalog-data.ts:156-166`.
  - `scheduled_action`: `apps/api/prisma/tool-catalog-data.ts:167-178`.
  - `background_task`: `apps/api/prisma/tool-catalog-data.ts:179-191`.
  - `persai_workspace_attach`: `apps/api/prisma/tool-catalog-data.ts:192-203`.
  - `persai_tool_quota_status`: `apps/api/prisma/tool-catalog-data.ts:204-217`.
  - `files`: `apps/api/prisma/tool-catalog-data.ts:218-234`.
  - `exec`: `apps/api/prisma/tool-catalog-data.ts:235-247`.
  - `shell`: `apps/api/prisma/tool-catalog-data.ts:248-259`.
  - `skill`: `apps/api/prisma/tool-catalog-data.ts:260-273`.

### W37 — Runtime native tool projection

- Writer: `projectRuntimeNativeTools`.
- Location: `apps/runtime/src/modules/turns/native-tool-projection.ts:216-410`.
- Output: provider tool definitions array.
- Current format: JSON schema plus `description` strings.
- ADR-119 zone: BP2 tool descriptor surface.
- Cache-byte stability: depends on runtime bundle tool policy/credentials and enabled Skills; per-turn knowledge source allowlists can alter projected knowledge tools at `apps/runtime/src/modules/turns/native-tool-projection.ts:232-239`.
- Skill byte-stability note: Skill tool omitted when no Skills are enabled, and schema is byte-stable per turn at `apps/runtime/src/modules/turns/native-tool-projection.ts:397-403`.

### W38 — Runtime Skill tool descriptor

- Writer: `createSkillToolDefinition`.
- Location: `apps/runtime/src/modules/turns/native-tool-projection.ts:1647-1680`.
- Output: `skill` provider function descriptor and schema.
- Current format: provider tool description prose plus JSON schema properties.
- ADR-119 zone: BP2 tool descriptor surface.
- Cache-byte stability: stable per turn; depends on `RuntimeToolPolicy.description`/`usageGuidance`.

### W39 — Tool descriptor description merger

- Writer: `resolveToolDefinitionDescription`.
- Location: `apps/runtime/src/modules/turns/native-tool-projection.ts:1702-1706`.
- Output: concatenates policy description and usage guidance.
- Current format: one prose description string.
- ADR-119 zone: BP2 tool descriptor surface.
- Cache-byte stability: depends on materialized `RuntimeToolPolicy`.

### W40 — Runtime system prompt forwarding

- Writer: `TurnExecutionService.buildProviderRequest` and `buildSystemPrompt`.
- Location: `apps/runtime/src/modules/turns/turn-execution.service.ts:1870-1901`, `apps/runtime/src/modules/turns/turn-execution.service.ts:1903-1918`.
- Output: provider request `systemPrompt`; background-worker alternate system prompt.
- Current format: ordinary cached prefix string or one prose background-worker string.
- ADR-119 zone: cached prefix dispatch and background-worker special case.
- Cache-byte stability: ordinary path forwards bundle `promptConstructor.ordinary.systemPrompt`; background path is fixed code text.

### W41 — Runtime developer instruction assembler

- Writer: `TurnExecutionService.buildBaseDeveloperInstructionSections`.
- Location: `apps/runtime/src/modules/turns/turn-execution.service.ts:1920-1976`.
- Output: developer-tail sections: project contract, visible working notes, channel context, routing hints, open-loop refs, working files, retrieved knowledge, open media/document jobs, delivery updates, presence, delivery contract.
- Current format: Markdown headings/prose via provider `developerInstructions`.
- ADR-119 zone: much of this should become volatile `<persai_retrieved_knowledge>`, `<persai_environment>`, and reminders; not BP.
- Cache-byte stability: intentionally per-turn variable, outside cached prefix.

### W42 — Runtime channel context developer section

- Writer: `TurnExecutionService.buildChannelContextDeveloperSection`.
- Location: `apps/runtime/src/modules/turns/turn-execution.service.ts:1978-2014`.
- Output: Telegram channel/sender/group/voice context.
- Current format: Markdown `## Channel Context`.
- ADR-119 zone: volatile `<persai_environment>` or channel-context sibling.
- Cache-byte stability: per-turn/channel variable; developer tail.

### W43 — Runtime retrieved knowledge developer section

- Writer: `TurnExecutionService.buildRetrievedKnowledgeContextDeveloperSection`.
- Location: `apps/runtime/src/modules/turns/turn-execution.service.ts:2023-2027`.
- Output: `context.renderedBlock`.
- Current format: pre-rendered Markdown/prose block from retrieval orchestrator.
- ADR-119 zone: volatile `<persai_retrieved_knowledge>`.
- Cache-byte stability: per-turn variable; not using `volatileKind` today.

### W44 — Runtime working files developer section

- Writer: `TurnExecutionService.buildWorkingFilesDeveloperSection`.
- Location: `apps/runtime/src/modules/turns/turn-execution.service.ts:2029-2061`.
- Output: `## Working Files`, file roles, aliases, and guardrails.
- Current format: Markdown heading, bullets/numbered lines.
- ADR-119 zone: volatile environment/tool context, not BP.
- Cache-byte stability: per-turn file state; developer tail.

### W45 — Runtime open media/document/job updates sections

- Writers: `buildOpenMediaJobsDeveloperSection`, `buildJobDeliveryUpdatesDeveloperSection`, `buildOpenDocumentJobsDeveloperSection`.
- Locations: `apps/runtime/src/modules/turns/turn-execution.service.ts:2108-2136`, `apps/runtime/src/modules/turns/turn-execution.service.ts:2138-2180`, `apps/runtime/src/modules/turns/turn-execution.service.ts:2182-2206`.
- Output: job status truth and delivery guards.
- Current format: Markdown headings and numbered lines.
- ADR-119 zone: volatile environment/system-reminder candidates.
- Cache-byte stability: per-turn variable; developer tail.

### W46 — Runtime early routing hints

- Writer: `TurnExecutionService.buildTurnRoutingPrompt`.
- Location: `apps/runtime/src/modules/turns/turn-execution.service.ts:2208-2269`.
- Output: `## Early Routing Hints`.
- Current format: Markdown/prose.
- ADR-119 zone: volatile environment/reminder or possibly removed after tool policy priority order.
- Cache-byte stability: route-decision variable; developer tail.

### W47 — Runtime presence renderer

- Writer: `renderPresenceBlock`.
- Location: `apps/runtime/src/modules/turns/presence-renderer.ts:59-77`.
- Output: interpolated sense-of-time block.
- Current format: Markdown template from W31.
- ADR-119 zone: volatile `<persai_environment>`.
- Cache-byte stability: explicitly volatile; same inputs produce same output but `now` changes per turn.

### W48 — Cross-session carry-over renderer

- Writer: `renderCrossSessionCarryOverBlock`.
- Location: `apps/runtime/src/modules/turns/cross-session-carry-over-renderer.ts:48-140`.
- Output: continuity block with synopses, open loops, and usage rules.
- Current format: Markdown headings, bullets, numbered lines.
- ADR-119 zone: memory context; stable first-turn hydrated block today.
- Cache-byte stability: content-hash stable for same carry-over data; not per-turn after first thread turn.

### W49 — Prompt cache stable block formatters

- Writers: `formatDurableMemoryCoreStableBlock`, `formatDurableMemoryContextualBlock`, `formatSharedCompactionStableBlock`, `formatCrossSessionCarryOverStableBlock`.
- Location: `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts:70-85`.
- Output: durable memory core, contextual memory, rolling synopsis, cross-session carry-over prompt blocks.
- Current format: bracket headers plus prose notes.
- ADR-119 zone: memory protocol / volatile memory split.
- Cache-byte stability: core/carry-over/synopsis stable by hash; contextual is explicitly non-stable.

### W50 — Active scenario volatile block renderer

- Writer: `BuildActiveScenarioBlockService.buildBlock`, `renderActiveScenarioBlock`, `appendStepDetails`.
- Location: `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts:27-70`, `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts:73-102`.
- Output: `## Active Scenario: ...`, steps, recommended tool, guards, exit condition.
- Current format: Markdown/prose.
- ADR-119 zone: volatile `<persai_active_scenario>`.
- Cache-byte stability: not prefix; depends on active skill/scenario state.

## Section 2 — Volatile-context end-to-end path (memory today, future scenario/knowledge/environment/system-reminder)

### Kind K1 — `memory`

- Status: exists today.
- Runtime production:
  - Core memory stable block is produced by `buildCoreMemoryMessage` and `formatDurableMemoryCoreStableBlock`; contextual memory is produced by `buildContextualMemoryMessage` at `apps/runtime/src/modules/turns/turn-context-hydration.service.ts:1390-1411`.
  - The contextual message sets `cacheRole: "volatile_context"` at `apps/runtime/src/modules/turns/turn-context-hydration.service.ts:1404-1411`.
- Contract boundary:
  - `ProviderGatewayTextMessage.cacheRole?: "volatile_context"` at `packages/runtime-contract/src/index.ts:3015-3026`.
  - `volatileKind` absent or `"memory"` maps to memory wrappers at `packages/runtime-contract/src/index.ts:3027-3034`.
- Runtime insertion:
  - `TurnExecutionService.prepareTurnExecution` builds hydrated messages before active scenario injection at `apps/runtime/src/modules/turns/turn-execution.service.ts:603-616`.
- Anthropic emission:
  - `buildAnthropicMessages` removes volatile messages from normal history and reinserts them before the current user question at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:483-549`.
  - `buildAnthropicVolatileContextMessage` uses `recent_short_memory` when `volatileKind` is absent/non-scenario at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763`.
- OpenAI emission:
  - `buildOpenAIInputItems` removes volatile messages and inserts one developer item before the current question at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1349-1410`.
  - `buildOpenAIVolatileContextItem` emits `<persai_contextual_memory>` for non-scenario messages at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1452`.
- Future ADR-119 change:
  - Add provenance to memory writes and render `<persai_memory>` instead of legacy `<recent_short_memory>` / `<persai_contextual_memory>`.
  - Required code changes: widen `ProviderGatewayTextMessage.volatileKind` in `packages/runtime-contract/src/index.ts:3015-3034`; add memory XML renderer near `apps/runtime/src/modules/turns/turn-context-hydration.service.ts:1390-1411` or new service; update switch logic in `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763` and `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1452`.

### Kind K2 — `active_scenario`

- Status: exists since ADR-118 Slice 4.
- Runtime production:
  - `BuildActiveScenarioBlockService.buildBlock` returns role `user`, `cacheRole: "volatile_context"`, `volatileKind: "active_scenario"` at `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts:27-70`.
  - Current content is prose Markdown rendered by `renderActiveScenarioBlock` at `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts:73-93`.
- Runtime insertion:
  - Scenario block is prepended before memory at `apps/runtime/src/modules/turns/turn-execution.service.ts:607-616`.
- Contract boundary:
  - `volatileKind?: "memory" | "active_scenario"` at `packages/runtime-contract/src/index.ts:3027-3034`.
- Anthropic emission:
  - `buildAnthropicVolatileContextMessage` maps `active_scenario` to `<active_scenario>` inside `<persai_runtime_context>` at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763`.
- OpenAI emission:
  - `buildOpenAIVolatileContextItem` maps `active_scenario` to `<persai_active_scenario>` developer item at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1439`.
- Future ADR-119 change:
  - Rewrite `renderActiveScenarioBlock` to structured XML with step fields.
  - Add `expectedUserResponse`, `nextStepTrigger`, `recoveryGuidance` to `RuntimeBundleSkillScenarioStep` at `packages/runtime-contract/src/index.ts:2996-3002`.

### Kind K3 — `retrieved_knowledge`

- Status: does not exist as `volatileKind` today.
- Current production:
  - `resolveRetrievedKnowledgeContext` is called during preparation and then planned at `apps/runtime/src/modules/turns/turn-execution.service.ts:653-665`.
  - The resulting context is passed into developer sections at `apps/runtime/src/modules/turns/turn-execution.service.ts:677-689`.
  - `buildRetrievedKnowledgeContextDeveloperSection` returns `context.renderedBlock` at `apps/runtime/src/modules/turns/turn-execution.service.ts:2023-2027`.
- Current provider boundary:
  - It enters provider requests through `developerInstructions`, not `ProviderGatewayTextMessage.cacheRole`.
  - `developerInstructions` is serialized in `buildProviderRequest` at `apps/runtime/src/modules/turns/turn-execution.service.ts:1884-1893`.
- Anthropic emission:
  - If history breakpoint suffix mode applies, developer instructions are wrapped as `<persai_developer_instructions>` at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:614-643`; otherwise they can be system blocks via `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:591-604`.
- OpenAI emission:
  - Developer instructions are appended as role `developer` at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1394-1408`.
- Gap:
  - No `volatileKind: "retrieved_knowledge"` in `packages/runtime-contract/src/index.ts:3027-3034`.
  - No provider wrapper for `<persai_retrieved_knowledge>` in Anthropic/OpenAI switch points.
- Exact change required:
  - Extend `ProviderGatewayTextMessage.volatileKind` in `packages/runtime-contract/src/index.ts:3027-3034`.
  - Move `buildRetrievedKnowledgeContextDeveloperSection` output from developer tail to a `ProviderGatewayTextMessage` built before provider request assembly near `apps/runtime/src/modules/turns/turn-execution.service.ts:653-689`.
  - Add wrapper branches in `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763` and `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1452`.

### Kind K4 — `environment`

- Status: does not exist as `volatileKind` today.
- Current production:
  - Raw presence template is preserved by API compile at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:376-385`.
  - Runtime computes `presenceBlock` at `apps/runtime/src/modules/turns/turn-execution.service.ts:618-621`.
  - `renderPresenceBlock` interpolates time and weekday at `apps/runtime/src/modules/turns/presence-renderer.ts:59-77`.
  - Presence is inserted into developer sections at `apps/runtime/src/modules/turns/turn-execution.service.ts:1956-1974`.
- Current provider boundary:
  - Enters through `developerInstructions`, not `volatileKind`.
- Gap:
  - No `volatileKind: "environment"` in `packages/runtime-contract/src/index.ts:3027-3034`.
  - No `<persai_environment>` wrapper in provider clients.
- Exact change required:
  - Extend contract union at `packages/runtime-contract/src/index.ts:3027-3034`.
  - Build a volatile message from `presenceBlock` instead of adding `{ key: "presence" }` in `apps/runtime/src/modules/turns/turn-execution.service.ts:1962-1975`.
  - Add provider wrapper branches in `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763` and `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1452`.

### Kind K5 — `system-reminder`

- Status: does not exist today.
- Current closest analogs:
  - Delivery invariant appears as constant `DELIVERY_HONESTY_CONTRACT` at `apps/runtime/src/modules/turns/turn-execution.service.ts:348-349`.
  - It is appended to developer sections at `apps/runtime/src/modules/turns/turn-execution.service.ts:1962-1975`.
  - Tool-loop follow-up developer sections are rebuilt after tool history at `apps/runtime/src/modules/turns/turn-execution.service.ts:3749-3803`.
- Current provider boundary:
  - No dedicated volatile message; developer instructions only.
- Gap:
  - No `volatileKind: "system_reminder"` or `"system-reminder"` in `packages/runtime-contract/src/index.ts:3027-3034`.
  - No runtime service that emits conditional reminders.
  - No provider wrapper for `<system-reminder>`.
- Exact change required:
  - Add new runtime service near `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts:27-70` pattern.
  - Extend contract union at `packages/runtime-contract/src/index.ts:3027-3034`.
  - Insert reminders in `TurnExecutionService.prepareTurnExecution` after active scenario and before memory near `apps/runtime/src/modules/turns/turn-execution.service.ts:607-616`.
  - Add provider wrapper branches at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763` and `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1452`.

## Section 3 — Selection guide single-seat verification

- Canonical seat: `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.tools`.
- Location: `apps/api/prisma/bootstrap-preset-data.ts:137-184`.
- Current marker: starts with `# Native Tool Runtime — Selection Guide` at `apps/api/prisma/bootstrap-preset-data.ts:137`.
- Current content:
  - Images/media rules: `apps/api/prisma/bootstrap-preset-data.ts:141-149`.
  - Knowledge/Web rules: `apps/api/prisma/bootstrap-preset-data.ts:151-155`.
  - Documents rules: `apps/api/prisma/bootstrap-preset-data.ts:157-161`.
  - Memory/Tasks rules: `apps/api/prisma/bootstrap-preset-data.ts:163-167`.
  - Files rules: `apps/api/prisma/bootstrap-preset-data.ts:169-172`.
  - Skills rules: `apps/api/prisma/bootstrap-preset-data.ts:174-180`.
  - Deferred media honesty: `apps/api/prisma/bootstrap-preset-data.ts:182-184`.
- Single-source golden invariant:
  - Test asserts the `tools` seed contains `# Native Tool Runtime — Selection Guide` at `apps/runtime/test/native-tool-projection.test.ts:1730-1734`.
  - Test asserts `agents` stays `# Memory Policy` at `apps/runtime/test/native-tool-projection.test.ts:1735-1739`.
  - Test asserts `# Tasks Policy` is not reintroduced at `apps/runtime/test/native-tool-projection.test.ts:1740-1744`.
- ADR-118 Slice 7 Skills rule:
  - Present after `## Files` and before `## Deferred media honesty` at `apps/api/prisma/bootstrap-preset-data.ts:169-184`.
  - Golden test asserts `## Skills`, `# Enabled Skills`, exact `Skill ID`, no display-name substitution, engage signature, scenario example, release signature, and exactly one occurrence at `apps/runtime/test/native-tool-projection.test.ts:1745-1788`.

## Section 4 — Persona compiler duplication audit (the [F1] failure mode)

- First render of `snapshotInstructions`:
  - Source assignment: `personaInstructions: this.normalizeOptionalText(params.publishedVersion.snapshotInstructions)` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:98-110`.
  - System template interpolation: `persona_instructions_block: ordinarySections.personaInstructions` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:397-404`.
  - Fallback join also includes `ordinarySections.personaInstructions` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:415-421`.
  - Seeded system template places `{{persona_instructions_block}}` before `{{soul_block}}` at `apps/api/prisma/bootstrap-preset-data.ts:34-45`.
- Second render of `snapshotInstructions`:
  - `generateSoulPrompt` creates `instructionsBlock` from the same `pv.snapshotInstructions` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:172-176`.
  - Template path passes that block into `{{instructions_block}}` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:209-215`.
  - Fallback path appends the same `instructionsBlock` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:253-256`.
  - Seeded `soul` template includes `{{instructions_block}}` after `{{traits_block}}` at `apps/api/prisma/bootstrap-preset-data.ts:104-108`.
- Literal duplicate confirmation:
  - Both first and second renders use the exact same source field `publishedVersion.snapshotInstructions`: first via `params.publishedVersion.snapshotInstructions` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:109`, second via `pv.snapshotInstructions` at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:174-176`.
- Archetype-driven structured fields alongside the duplicate:
  - Voice vars include archetype label, sentence length, pace, irony, openings, behavior, silence, examples at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:178-193`.
  - Fallback renders `- **Archetype**`, `## Voice`, sentence length, pace, irony, openings, emotion, silence, examples at `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:223-246`.
  - Seeded `soul` template declares `# Voice`, sentence length, pace, irony, openings, behavior, silence, examples at `apps/api/prisma/bootstrap-preset-data.ts:86-105`.
- Slice 1 deletion target:
  - Delete top-level `persona_instructions_block` insertion from the ordinary system prompt: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:397-404` and fallback `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:415-421`.
  - Delete `{{persona_instructions_block}}` from seeded `system`: `apps/api/prisma/bootstrap-preset-data.ts:34-45`.
  - Keep a single render inside the new `<character_notes>` block, replacing `instructionsBlock` creation/render in `generateSoulPrompt`: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:174-176`, `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:209-215`, `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:253-256`.

## Section 5 — Provider-side cache-marker state today

### Anthropic

- Request payload calls `buildAnthropicSystemBlocks` for non-streaming at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:133-143`.
- Streaming does the same at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:230-239`.
- `buildAnthropicSystemBlocks` returns `string | AnthropicSystemTextBlock[] | null` at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:564-566`.
- Current behavior:
  - If no developer suffix and no prompt cache, returns one system string at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:585-590`.
  - If prompt cache or developer block exists, emits an array with a single system text block and optional `cache_control` on the whole system prompt at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:591-604`.
  - Moving history breakpoint is applied to an assistant message block at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:656-714`.
- Slice 2 implication:
  - Current code does not split `systemPrompt` into 3 typed BP blocks; it has at most one system block cache marker plus moving history.
- Parallel-tool flag:
  - `toAnthropicToolChoice` only emits `{ type: "auto" }` or a named tool at `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:795-810`.
  - No source match for `disable_parallel_tool_use` in `anthropic-provider.client.ts` spot-check output.

### OpenAI

- Non-streaming request sends `systemPrompt` as separate `payload.instructions` at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:193-199`.
- Streaming request sends `systemPrompt` as separate `payload.instructions` at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:974-981`.
- Developer-tail is appended as a role `developer` input item at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1394-1408`.
- Prompt cache key/retention is applied to payload at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1502-1513`.
- Slice 2 implication:
  - ADR-119 mandates moving cached system prompt into `input[]` developer role for cache-friendliness; current code still uses `instructions`.
- Parallel-tool flag:
  - Non-streaming sets `payload.parallel_tool_calls = true` whenever tools are present at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:203-206`.
  - Streaming sets `payload.parallel_tool_calls = true` whenever tools are present at `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:985-988`.
  - There is no conditional `false` path today.

## Section 6 — Materialized published version metadata surface

### Prompt-participating fields in the runtime bundle

- `metadata.assistantId`, `workspaceId`, `publishedVersionId`, `publishedVersion`, `algorithmVersion`, `configGeneration`: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:920-928`.
- `persona.displayName`, `instructions`, `traits`, `avatarEmoji`, `avatarUrl`, `assistantGender`, `voiceProfile`: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:929-937`.
- `userContext`: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:938`.
- `runtime.runtimeProviderProfile`, `runtime.runtimeProviderRouting`, model keys, router policy, context hydration, shared compaction, knowledge access, worker tools, browser, sandbox, tool budgets: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:939-958`.
- `governance.effectiveCapabilities`, `toolAvailability`, `memoryControl`, `tasksControl`, `toolCredentialRefs`, `documentProviderConfig`, `toolPolicies`, quota/audit: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:959-976`.
- `channels.bindings` and `channels.telegram`: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:977-995`.
- `skills.enabled[].id/name/description/category/tags/iconEmoji/scenarios`: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:996-1005`.
- `promptDocuments.soul/user/identity/enabledSkills/tools/agents/backgroundTaskEvaluation/heartbeat/presence/routerClassifier/skillStateClassifier/preview/welcome/bootstrap`: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:1007-1022`.
- `promptConstructor`: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:1023`.
- `runtimeBundleDocument` and `runtimeBundleHash`: `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:1026-1044`.

### Natural compileMode metadata place

- Add to `compileAssistantRuntimeBundle` input near `promptConstructor: compiledPromptConstructor.promptConstructor` at `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:1007-1023`.
- Logical shape:
  - `promptConstructor.ordinary.compileMode = "adr119_xml_zoned"`.
  - `promptConstructor.ordinary.cacheBreakpoints = [{ key:"bp1", endOffset }, { key:"bp2", endOffset }, { key:"bp3", endOffset }]`.
- Reason:
  - Runtime already forwards `bundle.promptConstructor.ordinary.systemPrompt` in `buildSystemPrompt` at `apps/runtime/src/modules/turns/turn-execution.service.ts:1903-1918`.
  - Provider request construction already has one place to pass extra cache metadata at `apps/runtime/src/modules/turns/turn-execution.service.ts:1870-1901`.

### `configDirtyAt` triggers

- Materialization clears it after writing the materialized spec at `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:472-475`.
- Staleness check reads it at `apps/api/src/modules/workspace-management/application/ensure-assistant-materialized-spec-current.service.ts:197-202`.
- Skill admin update/archive marks assigned assistants dirty:
  - `apps/api/src/modules/workspace-management/application/manage-admin-skills.service.ts:174-179`.
  - `apps/api/src/modules/workspace-management/application/manage-admin-skills.service.ts:198-200`.
  - helper writes `configDirtyAt` at `apps/api/src/modules/workspace-management/application/manage-admin-skills.service.ts:619-627`.
- Scenario admin create/update/archive marks assigned assistants dirty:
  - `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:103-120`.
  - `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:148-172`.
  - `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:193-199`.
  - helper writes `configDirtyAt` at `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:209-217`.
- User Skill assignment changes mark assistant dirty at `apps/api/src/modules/workspace-management/application/manage-assistant-skills.service.ts:173-176`.
- Other config dirty writers found: subscription state, Telegram config/secrets, video personas/cloned voices, plan overrides at `apps/api/src/modules/workspace-management/application/resolve-effective-subscription-state.service.ts:637-640`, `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts:195-198`, `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts:218-221`, `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts:171-174`, `apps/api/src/modules/workspace-management/application/manage-admin-assistant-plan-override.service.ts:99-102`.

## Section 7 — Future slice hit lists

### Slice 1 — XML compile output + persona deduplication

Files to modify:

- `apps/api/prisma/bootstrap-preset-data.ts` (`VISIBLE_PROMPT_TEMPLATE_DEFAULTS`, `apps/api/prisma/bootstrap-preset-data.ts:33-288`) — rewrite `system`, `soul`, `user`, `identity`, `enabled_skills`, `tools`, `agents`, `heartbeat`, `presence` to balanced XML.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts` (`generateSoulPrompt`, `generateSystemPrompt`, `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:167-258`, `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:387-430`) — emit `<voice>` and `<character_notes>`, delete duplicate top-level `persona_instructions_block`.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` (`compileAssistantRuntimeBundle` call, `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:1007-1023`) — carry compile metadata.
- `packages/runtime-bundle/src/index.ts` (not read in this slice; add `compileMode`/breakpoint metadata to prompt constructor type) — bundle schema owner.

Files to create:

- `apps/api/test/bootstrap-preset-data.xml-balance.test.ts` — balance seeded XML tags.
- `apps/api/test/compile-prompt-constructor.xml.test.ts` — snapshot and duplicate assertions.

Files to delete:

- None.

Tests to add or update:

- `apps/api/test/compile-prompt-constructor.service.test.ts` — assert `snapshotInstructions` once, `<voice>` adjacent to `<character_notes>`.
- `apps/api/test/materialize-assistant-published-version.service.test.ts` — assert compile metadata present.

### Slice 2 — Provider cache markers + parallel-tool-calls discipline

Files to modify:

- `packages/runtime-contract/src/index.ts` (`ProviderGatewayTextGenerateRequest`, `packages/runtime-contract/src/index.ts:3159-3179`) — add `skillsEnabled` and cache breakpoint metadata.
- `apps/runtime/src/modules/turns/turn-execution.service.ts` (`buildProviderRequest`, `apps/runtime/src/modules/turns/turn-execution.service.ts:1870-1901`) — pass `skillsEnabled` and breakpoints.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` (`buildAnthropicSystemBlocks`, `toAnthropicToolChoice`, `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:564-605`, `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:795-810`) — split system into 3 typed blocks and set `disable_parallel_tool_use`.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts` (`generateText`, `streamText`, `buildOpenAIInputItems`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:193-206`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:974-988`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1349-1410`) — move system prompt into developer input and set `parallel_tool_calls: false` when Skills enabled.

Files to create:

- None.

Files to delete:

- None.

Tests to add or update:

- `apps/provider-gateway/test/anthropic-provider.client.test.ts` — 3 cache markers, `disable_parallel_tool_use`.
- `apps/provider-gateway/test/openai-provider.client.test.ts` — no `instructions`, developer input prefix, `parallel_tool_calls: false`.
- `apps/runtime/test/turn-execution.service.test.ts` — request carries skills/cache metadata.

### Slice 3 — Skills progressive disclosure + first_step_preview

Files to modify:

- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts` (`resolveEnabledSkillPromptCards`, `renderSkillCard`, `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts:67-161`) — remove body/guardrails/examples from prefix; render compact XML catalog and first-step preview.
- `packages/runtime-contract/src/index.ts` (`RuntimeBundleSkillScenarioStep`, `packages/runtime-contract/src/index.ts:2996-3002`) — add first-step preview source field or scenario field as agreed.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` (`resolveEnabledSkillScenariosForBundle`, `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:1796-1827`) — map new scenario field into bundle.
- `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts` (not read; Skill tool result owner) — return full instruction card body/guardrails/examples on engage.

Files to create:

- Prisma migration/backfill if `first_step_preview` is stored outside `steps` JSON.

Files to delete:

- Possibly delete `MAX_RENDERED_BODY_CHARS`, `MAX_RENDERED_GUARDRAILS`, `MAX_RENDERED_EXAMPLES` if no longer used in prompt path at `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts:61-65`.

Tests to add or update:

- `apps/api/test/enabled-skills-prompt-materialization.test.ts` — compact XML and prefix shrink assertion.
- `apps/runtime/test/runtime-skill-tool.service.test.ts` — engage result carries full Skill details.

### Slice 4 — Volatile scenario block XML format

Files to modify:

- `packages/runtime-contract/src/index.ts` (`RuntimeBundleSkillScenarioStep`, `RuntimeSkillDecisionState`, `packages/runtime-contract/src/index.ts:533-540`, `packages/runtime-contract/src/index.ts:2996-3002`) — add step fields and optional current step state.
- `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts` (`renderActiveScenarioBlock`, `appendStepDetails`, `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts:73-102`) — emit `<persai_active_scenario>` XML.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` (`buildAnthropicVolatileContextMessage`, `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763`) — ensure scenario wrapper remains correct with XML body.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts` (`buildOpenAIVolatileContextItem`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1439`) — ensure no double-conflicting tags.
- `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts` (`create/update`, `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:103-172`) — validate new step fields if API type lives there.

Files to create:

- None unless new renderer helper is split from the service.

Files to delete:

- Old prose `## Active Scenario` rendering lines in `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts:77-90`.

Tests to add or update:

- `apps/runtime/test/build-active-scenario-block.service.test.ts` — XML step fields.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts` and `apps/provider-gateway/test/openai-provider.client.test.ts` — wrappers.

### Slice 5 — system-reminder protocol

Files to modify:

- `apps/api/prisma/bootstrap-preset-data.ts` (`system`/`tools`/new reminders template, `apps/api/prisma/bootstrap-preset-data.ts:33-184`) — add `<reminders_protocol>`.
- `packages/runtime-contract/src/index.ts` (`ProviderGatewayTextMessage.volatileKind`, `packages/runtime-contract/src/index.ts:3027-3034`) — add `system_reminder`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts` (`prepareTurnExecution`, `apps/runtime/src/modules/turns/turn-execution.service.ts:603-616`) — insert reminders after scenario before memory/current user.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` (`buildAnthropicVolatileContextMessage`, `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763`) — emit `<system-reminder>`.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts` (`buildOpenAIVolatileContextItem`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1452`) — emit `<system-reminder>`.

Files to create:

- `apps/runtime/src/modules/turns/build-system-reminder.service.ts` — compose active scenario tick, reference image, tool budget warnings.
- `apps/runtime/test/build-system-reminder.service.test.ts` — unit tests.

Files to delete:

- None.

Tests to add or update:

- `apps/runtime/test/turn-execution.service.test.ts` — reminder insertion order.
- Provider-gateway tests for wrapper.

### Slice 6 — Selection guide XML priority order with Skills first

Files to modify:

- `apps/api/prisma/bootstrap-preset-data.ts` (`tools`, `apps/api/prisma/bootstrap-preset-data.ts:137-184`) — rewrite to `<tool_usage_policy>` with `<priority_order>` and Skills first.
- `apps/runtime/test/native-tool-projection.test.ts` (`ADR-117 golden`, `apps/runtime/test/native-tool-projection.test.ts:1730-1788`) — update assertions to XML form and Skills first.
- `apps/web/app/admin/presets/page.test.tsx` (not read) — update preset preview expectations.

Files to create:

- None.

Files to delete:

- None.

Tests to add or update:

- Add assertion that `<priority_order>` item 1 is Skills.
- Preserve assertion that `# Tasks Policy` is absent.

### Slice 7 — Tool description rewrite

Files to modify:

- `apps/api/prisma/tool-catalog-data.ts` (`TOOL_CATALOG`, `apps/api/prisma/tool-catalog-data.ts:18-274`) — rewrite high-traffic `modelDescription` / `modelUsageGuidance`.
- `apps/runtime/src/modules/turns/native-tool-projection.ts` (`resolveToolDefinitionDescription`, create tool functions, `apps/runtime/src/modules/turns/native-tool-projection.ts:216-410`, `apps/runtime/src/modules/turns/native-tool-projection.ts:431-1680`, `apps/runtime/src/modules/turns/native-tool-projection.ts:1702-1706`) — render structured descriptor text.
- `apps/api/src/modules/workspace-management/application/tool-prompt-metadata.ts` (`buildToolPromptMetadataState`, `apps/api/src/modules/workspace-management/application/tool-prompt-metadata.ts:40-66`) — ensure overrides stay compatible with structured defaults.

Files to create:

- None unless structured descriptor helper is split out.

Files to delete:

- None.

Tests to add or update:

- `apps/api/test/seed-tool-catalog.test.ts` — descriptor section assertions.
- `apps/runtime/test/native-tool-projection.test.ts` — projected structured sections.

### Slice 8 — Response contract restructure

Files to modify:

- `apps/api/prisma/bootstrap-preset-data.ts` (`system` response contract, `apps/api/prisma/bootstrap-preset-data.ts:52-67`) — replace flat list with `<response_contract><must/><prefer/>`.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts` (`generateSystemPrompt`, `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:387-430`) — preserve interpolation but validate new tag balance.
- `apps/web/app/admin/presets/page.test.tsx` (not read) — preset copy expectations.

Files to create:

- None.

Files to delete:

- Old flat response contract lines in `apps/api/prisma/bootstrap-preset-data.ts:52-67`.

Tests to add or update:

- `apps/api/test/compile-prompt-constructor.service.test.ts` — response contract XML snapshot.

### Slice 9 — Memory protocol + provenance schema

Files to modify:

- `apps/api/prisma/schema.prisma` (not read) — add memory provenance enum/column.
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` (`buildContextualMemoryMessage`, `apps/runtime/src/modules/turns/turn-context-hydration.service.ts:1390-1411`) — render provenance XML or delegate.
- `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts` (`formatDurableMemoryCoreStableBlock`, `formatDurableMemoryContextualBlock`, `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts:70-77`) — align memory XML format.
- `packages/runtime-contract/src/index.ts` (`ProviderGatewayTextMessage.volatileKind`, `packages/runtime-contract/src/index.ts:3027-3034`) — possibly rename memory wrapper semantics.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` (`buildAnthropicVolatileContextMessage`, `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763`) — memory wrapper change.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts` (`buildOpenAIVolatileContextItem`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1452`) — memory wrapper change.

Files to create:

- Prisma migration `adr119_memory_provenance`.
- Optional `apps/runtime/src/modules/turns/build-retrieved-memory-block.service.ts`.

Files to delete:

- Legacy memory wrapper literals after replacement: `<recent_short_memory>` and `<persai_contextual_memory>` branches.

Tests to add or update:

- API memory write tests for provenance.
- Runtime memory hydration render tests.
- Provider-gateway wrapper tests.

### Slice 10 — Admin UI for new scenario fields

Files to modify:

- `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts` (`createScenario`, `updateScenario`, `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:103-172`) — validate/persist new fields.
- `packages/runtime-contract/src/index.ts` (`RuntimeBundleSkillScenarioStep`, `packages/runtime-contract/src/index.ts:2996-3002`) — type shape if not done in Slice 4.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` (`resolveEnabledSkillScenariosForBundle`, `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:1796-1827`) — map fields into bundle.
- `apps/web/app/admin/skills/page.tsx` (not read) — scenario editor fields and preview.

Files to create:

- None.

Files to delete:

- None.

Tests to add or update:

- `apps/api/test/manage-skill-scenarios.service.test.ts` — validation/persistence.
- `apps/web/app/admin/skills/page.test.tsx` — editor fields and preview parity.

### Slice 11 — Golden tests + docs + ADR closure

Files to modify:

- `apps/runtime/test/native-tool-projection.test.ts` (`golden selection guide`, `apps/runtime/test/native-tool-projection.test.ts:1730-1788`) — confirm final single-seat invariants.
- `apps/api/test/compile-prompt-constructor.service.test.ts` — full prompt snapshot and persona single-render.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts` — cache markers and parallel flag.
- `apps/provider-gateway/test/openai-provider.client.test.ts` — developer input and parallel flag.
- `docs/ARCHITECTURE.md` — add three-zone prompt architecture.
- `docs/API-BOUNDARY.md` — document volatile XML kinds.
- `docs/DATA-MODEL.md` — document memory provenance and SkillScenario step fields.
- `docs/TEST-PLAN.md` — add ADR-119 golden tests.
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md` — closure handoff.
- `docs/ADR/119-prompt-architecture-and-2026-context-engineering.md` — close only in Slice 11, not this inventory.

Files to create:

- Snapshot fixture for materialized prompt if repo pattern prefers committed fixture.

Files to delete:

- None unless old tests become obsolete.

Tests to add or update:

- Golden prompt snapshot.
- Cache prefix byte-stability across Skill engage/release, memory write, retrieved knowledge.
- Provider flag assertions.
- Memory provenance assertions.

## Section 8 — Risks and surprises uncovered during inventory

R1. ADR assumes active scenario exists but implies wrappers are future work.

- ADR-119 assumes active scenario is a future volatile kind in parts of Slice 4/5 language.
- Code shows `volatileKind: "active_scenario"` already exists in contract and both provider clients: `packages/runtime-contract/src/index.ts:3027-3034`, `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:733-763`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1418-1439`.
- Recommended adjustment: ADR text should say Slice 4 rewrites format and extends fields, not introduces the kind from zero.

R2. Retrieved knowledge is not on the volatile rail.

- ADR assumes volatile context kinds can all ride the same rail.
- Code shows retrieved knowledge is developer-tail text from `buildRetrievedKnowledgeContextDeveloperSection`, not `ProviderGatewayTextMessage`: `apps/runtime/src/modules/turns/turn-execution.service.ts:2023-2027`.
- Recommended adjustment: Slice 4/9 hit list should include moving retrieved knowledge out of `developerInstructions`.

R3. Presence/environment is already deliberately outside prefix, but not via volatileKind.

- ADR assumes environment is a future volatile block.
- Code shows presence is a raw template compiled stable and rendered per turn into developer tail: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:376-385`, `apps/runtime/src/modules/turns/presence-renderer.ts:59-77`, `apps/runtime/src/modules/turns/turn-execution.service.ts:1956-1974`.
- Recommended adjustment: Slice 5 should migrate, not invent, the environment path.

R4. OpenAI currently uses `instructions`, contrary to ADR-119 cache target.

- ADR mandates `developer` role inside `input[]`.
- Code uses `payload.instructions = input.systemPrompt` in both non-streaming and streaming: `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:197-199`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:979-981`.
- Recommended adjustment: Slice 2 should be explicit that this is a request-shape migration with behavior risk.

R5. OpenAI explicitly enables parallel tool calls today.

- ADR assumes flags need to be set when Skills enabled.
- Code currently sets `parallel_tool_calls = true` whenever tools exist: `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:203-206`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:985-988`.
- Recommended adjustment: Slice 2 tests need both enabled-Skills false/true cases to prevent accidental global disable if that is not intended.

R6. Anthropic has only one system cache marker today.

- ADR assumes Slice 2 extends to 3 BP boundaries.
- Code currently marks the whole `systemPrompt` as one `cache_control` block when prompt cache exists: `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:591-604`.
- Recommended adjustment: compile metadata must include exact offsets or pre-split text; provider cannot infer semantic boundaries safely from current blob.

R7. `skill_state_classifier` prompt template remains seeded.

- ADR-118 deleted classifier caller path, but template still exists at `apps/api/prisma/bootstrap-preset-data.ts:226-240`.
- Code materializes it into `promptDocuments.skillStateClassifier` at `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts:1017-1018`.
- Recommended adjustment: ADR-119 closure or separate cleanup should decide whether to delete the obsolete template, because it is prompt-surface-adjacent even if unused.

R8. Enabled Skills prefix currently includes full instruction bodies.

- ADR says progressive disclosure should shrink prefix.
- Code renders `card.body`, `guardrails`, and `examples` at `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts:128-140`.
- Recommended adjustment: Slice 3 must ensure `skill({engage})` returns all fields removed from the prefix in the same deploy.

R9. System prompt background-worker special case is outside ADR-119's three BP model.

- ADR focuses ordinary materialized prompt.
- Code has a separate hardcoded background-worker system prompt at `apps/runtime/src/modules/turns/turn-execution.service.ts:1903-1913`.
- Recommended adjustment: Slice 1/11 tests should specify whether background-worker prompt is excluded or should receive XML wrappers.

R10. Provider volatile batching assumes all volatile messages share the same kind.

- ADR wants several volatile context kinds in ordered sequence.
- OpenAI batching comment says all volatile messages in a batch share the same kind, but `buildOpenAIInputItems` currently passes all volatile messages as one batch: `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1390-1393`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1425-1427`.
- Recommended adjustment: before adding multiple kinds, provider clients must group/sort volatile messages by kind or preserve individual wrappers.

## Section 9 — Reachability ledger spot-checks

1. Claim: `snapshotInstructions` is rendered through both `personaInstructions` and `instructionsBlock`.
   - Grep: `personaInstructions|instructionsBlock|generateSystemPrompt|generateSoulPrompt`.
   - Proof: `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:109`, `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:174-176`, `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:403`, `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts:420`.

2. Claim: `tools` template is the Native Tool Runtime selection guide and includes `## Skills`.
   - Grep: `tools:\s*\`# Native Tool Runtime|## Skills|# Memory Policy|# Tasks Policy`.
   - Proof: `apps/api/prisma/bootstrap-preset-data.ts:130-137`, `apps/api/prisma/bootstrap-preset-data.ts:174-176`.

3. Claim: contract volatile union only supports memory and active scenario.
   - Grep: `volatileKind?: "memory" | "active_scenario"|cacheRole?: "volatile_context"|ProviderGatewayTextMessage`.
   - Proof: `packages/runtime-contract/src/index.ts:3015-3034`.

4. Claim: Anthropic emits `<recent_short_memory>` or `<active_scenario>`.
   - Grep: `recent_short_memory|active_scenario|buildAnthropicSystemBlocks|disable_parallel_tool_use`.
   - Proof: `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:564-566`, `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:736-738`.

5. Claim: OpenAI uses `instructions` for system prompt and sets parallel tool calls true.
   - Grep: `persai_contextual_memory|persai_active_scenario|parallel_tool_calls|payload.instructions`.
   - Proof: `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:197-205`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:979-987`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts:1432-1451`.

6. Claim: runtime inserts active scenario before memory and builds presence/retrieved-knowledge developer sections.
   - Grep: `buildActiveScenarioBlockService|buildRetrievedKnowledgeContextDeveloperSection|presenceBlock|buildSystemPrompt`.
   - Proof: `apps/runtime/src/modules/turns/turn-execution.service.ts:607-618`, `apps/runtime/src/modules/turns/turn-execution.service.ts:1941-1956`, `apps/runtime/src/modules/turns/turn-execution.service.ts:2023-2027`.

7. Claim: scenario admin operations bump `configDirtyAt`.
   - Grep: `markAssignedAssistantsDirty|configDirtyAt`.
   - Proof: `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:119`, `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:171`, `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:198`, `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts:209-217`.

8. Claim: ADR-117 golden test asserts selection guide and Skills single-seat invariants.
   - Grep: `## Skills|Skill ID|Tasks Policy|Native Tool Runtime`.
   - Proof: `apps/runtime/test/native-tool-projection.test.ts:1730-1744`, `apps/runtime/test/native-tool-projection.test.ts:1745-1788`.
