import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeCompiledOrdinaryPromptSections,
  AssistantRuntimePromptConstructor,
  AssistantRuntimePromptDocuments
} from "@persai/runtime-bundle";
import { buildAssistantRuntimePromptStablePrefix as toStablePrefix } from "@persai/runtime-bundle";
import type { RuntimeToolPolicy } from "@persai/runtime-contract";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import { normalizeAssistantGender } from "./assistant-gender";
import {
  renderEnabledSkillsPromptBlock,
  type EnabledSkillPromptCard
} from "./enabled-skills-prompt-materialization";
import type { VoiceDnaResolved } from "./voice-dna-modulator";

export interface PromptTemplateMap {
  system?: string | null;
  soul?: string | null;
  user?: string | null;
  identity?: string | null;
  enabled_skills?: string | null;
  tools?: string | null;
  agents?: string | null;
  heartbeat?: string | null;
  presence?: string | null;
  router_classifier?: string | null;
  skill_state_classifier?: string | null;
  preview_bootstrap?: string | null;
  welcome_bootstrap?: string | null;
  bootstrap?: string | null;
}

@Injectable()
export class CompilePromptConstructorService {
  private readonly logger = new Logger(CompilePromptConstructorService.name);

  compile(params: {
    publishedVersion: AssistantPublishedVersion;
    userContext: {
      displayName: string | null;
      birthday: string | null;
      gender: string | null;
      locale: string;
      timezone: string;
    };
    toolPolicies: RuntimeToolPolicy[];
    enabledSkillCards?: EnabledSkillPromptCard[];
    promptTemplates: PromptTemplateMap;
    /**
     * Resolved Voice DNA (archetype × traits × locale → ready-to-render).
     * `null` when the published version has no archetype snapshot (legacy
     * assistants pre-V1, or fresh assistants before first archetype pick).
     */
    voiceDna?: VoiceDnaResolved | null;
  }): {
    promptDocuments: AssistantRuntimePromptDocuments;
    promptConstructor: AssistantRuntimePromptConstructor;
  } {
    const voiceDna = params.voiceDna ?? null;
    const promptDocuments: AssistantRuntimePromptDocuments = {
      soul: this.generateSoulPrompt(
        params.publishedVersion,
        params.promptTemplates.soul ?? null,
        voiceDna
      ),
      user: this.generateUserPrompt(params.userContext, params.promptTemplates.user ?? null),
      identity: this.generateIdentityPrompt(
        params.publishedVersion,
        params.promptTemplates.identity ?? null
      ),
      enabledSkills: this.generateEnabledSkillsPrompt(
        params.enabledSkillCards ?? [],
        params.promptTemplates.enabled_skills ?? null
      ),
      tools: this.generateToolsPrompt(params.toolPolicies, params.promptTemplates.tools ?? null),
      agents: this.generateAgentsPrompt(params.promptTemplates.agents ?? null),
      heartbeat: this.generateHeartbeatPrompt(params.promptTemplates.heartbeat ?? null),
      presence: this.generatePresencePrompt(params.promptTemplates.presence ?? null),
      routerClassifier:
        this.normalizeOptionalText(params.promptTemplates.router_classifier ?? null) ?? "",
      skillStateClassifier:
        this.normalizeOptionalText(params.promptTemplates.skill_state_classifier ?? null) ?? "",
      preview: this.generatePreviewPrompt(
        params.publishedVersion,
        params.userContext,
        params.promptTemplates.preview_bootstrap ?? null,
        voiceDna
      ),
      welcome: this.generateWelcomePrompt(
        params.publishedVersion,
        params.userContext,
        params.promptTemplates.welcome_bootstrap ?? params.promptTemplates.bootstrap ?? null,
        voiceDna
      )
    };

    const ordinarySections: AssistantRuntimeCompiledOrdinaryPromptSections = {
      assistantIdentity:
        params.publishedVersion.snapshotDisplayName === null
          ? null
          : `Assistant display name: ${params.publishedVersion.snapshotDisplayName}`,
      userIdentity:
        params.userContext.displayName === null
          ? null
          : `User display name: ${params.userContext.displayName}`,
      locale: `User locale: ${params.userContext.locale}`,
      timezone: `User timezone: ${params.userContext.timezone}`,
      personaInstructions: this.normalizeOptionalText(params.publishedVersion.snapshotInstructions),
      soul: promptDocuments.soul,
      user: promptDocuments.user,
      identity: promptDocuments.identity,
      enabledSkills: promptDocuments.enabledSkills ?? "",
      tools: promptDocuments.tools,
      agents: promptDocuments.agents,
      // ADR-074 P1: heartbeat lives outside the cached system prefix; the runtime renders it into
      // a separate per-turn developer message (it is intentionally absent from `systemPrompt` /
      // `stablePrefix`). It is still surfaced here for any consumer that needs the raw text.
      heartbeat: promptDocuments.heartbeat
    };

    const systemPrompt = this.generateSystemPrompt(
      ordinarySections,
      params.promptTemplates.system ?? null
    );

    return {
      promptDocuments,
      promptConstructor: {
        ordinary: {
          sections: ordinarySections,
          systemPrompt: systemPrompt.length > 0 ? systemPrompt : null,
          stablePrefix: toStablePrefix(systemPrompt)
        },
        onboarding: {
          previewTurnPrompt: promptDocuments.preview,
          welcomeTurnPrompt: promptDocuments.welcome,
          firstTurnPrompt: promptDocuments.welcome
        }
      }
    };
  }

  private interpolateTemplate(
    template: string,
    variables: Record<string, string | null | undefined>
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      if (value === null || value === undefined || value.trim().length === 0) {
        result = result
          .split("\n")
          .filter((line) => !line.includes(placeholder))
          .join("\n");
      } else {
        result = result.replaceAll(placeholder, value);
      }
    }
    return result;
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private generateSoulPrompt(
    pv: AssistantPublishedVersion,
    template: string | null,
    voiceDna: VoiceDnaResolved | null
  ): string {
    const assistantGender = normalizeAssistantGender(pv.snapshotAssistantGender);
    const traitsBlock = this.renderTraitsBlock(pv.snapshotTraits);
    const instructionsBlock = pv.snapshotInstructions
      ? `## Instructions\n\n${pv.snapshotInstructions}\n`
      : "";

    if (template) {
      const voiceVars: Record<string, string | null> = voiceDna
        ? {
            archetype_label_line: `- **Archetype**: ${voiceDna.archetypeLabel}`,
            voice_sentence_length: voiceDna.voice.sentenceLength,
            voice_pace: voiceDna.voice.pace,
            voice_irony: String(voiceDna.voice.irony),
            voice_openings_allowed: this.formatPhraseList(voiceDna.openingsAllowed),
            voice_openings_forbidden: this.formatPhraseList(voiceDna.openingsForbidden),
            voice_when_user_upset: voiceDna.behaviors.whenUserUpset,
            voice_when_user_excited: voiceDna.behaviors.whenUserExcited,
            voice_when_user_tired: voiceDna.behaviors.whenUserTired,
            voice_when_user_angry: voiceDna.behaviors.whenUserAngry,
            voice_silence_rule: voiceDna.silenceRule,
            voice_examples_block: this.renderVoiceExamplesBlock(voiceDna.examples)
          }
        : {
            archetype_label_line: null,
            voice_sentence_length: null,
            voice_pace: null,
            voice_irony: null,
            voice_openings_allowed: null,
            voice_openings_forbidden: null,
            voice_when_user_upset: null,
            voice_when_user_excited: null,
            voice_when_user_tired: null,
            voice_when_user_angry: null,
            voice_silence_rule: null,
            voice_examples_block: null
          };

      return this.interpolateTemplate(template, {
        assistant_name: pv.snapshotDisplayName ?? "an assistant",
        assistant_gender_line: assistantGender ? `- **Gender**: ${assistantGender}` : null,
        ...voiceVars,
        traits_block: traitsBlock,
        instructions_block: instructionsBlock
      });
    }

    const lines: string[] = ["# Core Persona", ""];
    lines.push(`You are **${pv.snapshotDisplayName ?? "an assistant"}**.`);
    if (assistantGender) {
      lines.push(`- **Gender**: ${assistantGender}`);
    }
    if (voiceDna) {
      lines.push(`- **Archetype**: ${voiceDna.archetypeLabel}`);
      lines.push("");
      lines.push("## Voice");
      lines.push(`- Sentence length: ${voiceDna.voice.sentenceLength}`);
      lines.push(`- Pace: ${voiceDna.voice.pace}`);
      lines.push(`- Irony: ${String(voiceDna.voice.irony)}/100`);
      lines.push("");
      lines.push("## How you may open");
      lines.push(`Allowed: ${this.formatPhraseList(voiceDna.openingsAllowed)}.`);
      lines.push(`Forbidden: ${this.formatPhraseList(voiceDna.openingsForbidden)}.`);
      lines.push("");
      lines.push("## Behavior under emotion");
      lines.push(`- When the user is upset: ${voiceDna.behaviors.whenUserUpset}`);
      lines.push(`- When the user is excited: ${voiceDna.behaviors.whenUserExcited}`);
      lines.push(`- When the user is tired: ${voiceDna.behaviors.whenUserTired}`);
      lines.push(`- When the user is angry: ${voiceDna.behaviors.whenUserAngry}`);
      lines.push("");
      lines.push("## Silence");
      lines.push(voiceDna.silenceRule);
      lines.push("");
      lines.push("## How you actually sound");
      lines.push(this.renderVoiceExamplesBlock(voiceDna.examples));
      lines.push("");
    }
    lines.push("");
    if (traitsBlock) {
      lines.push(traitsBlock);
      lines.push("");
    }
    if (instructionsBlock) {
      lines.push(instructionsBlock);
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }

  private formatPhraseList(items: string[]): string {
    return items
      .filter((item) => item.trim().length > 0)
      .map((item) => `"${item.replace(/"/g, '\\"')}"`)
      .join(", ");
  }

  private renderVoiceExamplesBlock(examples: Array<{ context: string; reply: string }>): string {
    if (examples.length === 0) return "";
    return examples
      .map((ex, idx) => `Example ${idx + 1}:\n- ${ex.context}\n- You: ${ex.reply}`)
      .join("\n\n");
  }

  private renderTraitsBlock(traits: Record<string, number> | null): string {
    if (!traits || Object.keys(traits).length === 0) return "";
    const lines = ["## Personality Traits", ""];
    for (const [trait, value] of Object.entries(traits)) {
      lines.push(`- **${trait}**: ${String(value)}/100`);
    }
    return lines.join("\n");
  }

  private generateUserPrompt(
    userCtx: {
      displayName: string | null;
      birthday: string | null;
      gender: string | null;
      locale: string;
      timezone: string;
    },
    template: string | null
  ): string {
    if (template) {
      return this.interpolateTemplate(template, {
        user_name_line: userCtx.displayName ? `- **Name**: ${userCtx.displayName}` : null,
        user_birthday_line: userCtx.birthday ? `- **Birthday**: ${userCtx.birthday}` : null,
        user_gender_line: userCtx.gender ? `- **Gender**: ${userCtx.gender}` : null,
        user_locale: userCtx.locale,
        user_timezone: userCtx.timezone
      });
    }

    const lines: string[] = ["# User Context", ""];
    if (userCtx.displayName) lines.push(`- **Name**: ${userCtx.displayName}`);
    if (userCtx.birthday) lines.push(`- **Birthday**: ${userCtx.birthday}`);
    if (userCtx.gender) lines.push(`- **Gender**: ${userCtx.gender}`);
    lines.push(`- **Locale**: ${userCtx.locale}`);
    lines.push(`- **Timezone**: ${userCtx.timezone}`);
    return lines.join("\n");
  }

  private generateIdentityPrompt(pv: AssistantPublishedVersion, template: string | null): string {
    const assistantGender = normalizeAssistantGender(pv.snapshotAssistantGender);
    if (template) {
      return this.interpolateTemplate(template, {
        assistant_name: pv.snapshotDisplayName ?? "Assistant",
        assistant_gender_line: assistantGender ? `- **Gender**: ${assistantGender}` : null,
        assistant_avatar_emoji_line: pv.snapshotAvatarEmoji
          ? `- **Avatar**: ${pv.snapshotAvatarEmoji}`
          : null,
        assistant_avatar_url_line: pv.snapshotAvatarUrl
          ? `- **Avatar URL**: ${pv.snapshotAvatarUrl}`
          : null
      });
    }

    const lines: string[] = ["# Identity", ""];
    lines.push(`- **Name**: ${pv.snapshotDisplayName ?? "Assistant"}`);
    if (assistantGender) lines.push(`- **Gender**: ${assistantGender}`);
    if (pv.snapshotAvatarEmoji) lines.push(`- **Avatar**: ${pv.snapshotAvatarEmoji}`);
    if (pv.snapshotAvatarUrl) lines.push(`- **Avatar URL**: ${pv.snapshotAvatarUrl}`);
    return lines.join("\n");
  }

  private generateEnabledSkillsPrompt(
    cards: EnabledSkillPromptCard[],
    template: string | null
  ): string {
    const skillCardsBlock = renderEnabledSkillsPromptBlock(cards);
    if (skillCardsBlock.length === 0) {
      return "";
    }
    if (template) {
      return this.interpolateTemplate(template, {
        skill_cards_block: skillCardsBlock
      });
    }
    return skillCardsBlock;
  }

  private generateToolsPrompt(_toolPolicies: RuntimeToolPolicy[], template: string | null): string {
    // ADR-074 P1 / ADR-117 Slice 4: native provider tool definitions already carry the tool
    // descriptor surface, and the DB `tools` prompt template is the single selection-guide owner.
    // If a custom template still references `{{tools_catalog_block}}`, the placeholder is stripped
    // because the value resolves to null in `interpolateTemplate`.
    if (template) {
      return this.interpolateTemplate(template, {
        tools_catalog_block: null
      });
    }

    this.logger.warn(
      "Prompt template 'tools' is missing; emitting an empty tools block without the legacy markdown fallback."
    );
    return "";
  }

  private generateAgentsPrompt(template: string | null): string {
    return this.normalizeOptionalText(template) ?? "";
  }

  private generateHeartbeatPrompt(template: string | null): string {
    return this.normalizeOptionalText(template) ?? "";
  }

  // ADR-074 Slice T1: presence is a NEW sibling of heartbeat. Like heartbeat it lives entirely
  // in the per-turn developer-tail (never in `systemPrompt` / `stablePrefix`), so this method
  // simply returns the raw template text. The four `{{...}}` placeholders inside the template
  // (`time_since_last_user_message_in_thread`, `time_since_last_user_message_anywhere`,
  // `current_local_time`, `current_local_weekday`) are interpolated downstream by the runtime
  // presence renderer with per-turn values; we deliberately do NOT pre-interpolate any of them
  // here so the cached compile artefact stays time-invariant.
  private generatePresencePrompt(template: string | null): string {
    return this.normalizeOptionalText(template) ?? "";
  }

  private generateSystemPrompt(
    ordinarySections: AssistantRuntimeCompiledOrdinaryPromptSections,
    template: string | null
  ): string {
    // ADR-074 P1: the cached system prefix is intentionally free of per-turn variability.
    // - `heartbeat_block` is rendered downstream as a developer message at the tail of every
    //   provider request (so future T1 dynamic time fields cannot invalidate the cached prefix).
    // - `route_control_block` is also a developer-message tail rendered by the runtime.
    // Both placeholders are passed as null so legacy custom templates that still reference them
    // simply drop the placeholder line in `interpolateTemplate` instead of leaking a literal token.
    if (template) {
      return this.interpolateTemplate(template, {
        assistant_identity_block: ordinarySections.assistantIdentity,
        user_identity_block: ordinarySections.userIdentity,
        locale_block: ordinarySections.locale,
        timezone_block: ordinarySections.timezone,
        persona_instructions_block: ordinarySections.personaInstructions,
        soul_block: ordinarySections.soul,
        user_block: ordinarySections.user,
        identity_block: ordinarySections.identity,
        enabled_skills_block: ordinarySections.enabledSkills,
        route_control_block: null,
        tools_block: ordinarySections.tools,
        agents_block: ordinarySections.agents,
        heartbeat_block: null
      }).trim();
    }

    return [
      ordinarySections.assistantIdentity,
      ordinarySections.userIdentity,
      ordinarySections.locale,
      ordinarySections.timezone,
      ordinarySections.personaInstructions,
      this.normalizeOptionalText(ordinarySections.soul),
      this.normalizeOptionalText(ordinarySections.user),
      this.normalizeOptionalText(ordinarySections.identity),
      this.normalizeOptionalText(ordinarySections.enabledSkills),
      this.normalizeOptionalText(ordinarySections.tools),
      this.normalizeOptionalText(ordinarySections.agents)
    ]
      .filter((section): section is string => section !== null)
      .join("\n\n");
  }

  private renderTraitsSummaryLine(traits: Record<string, number> | null): string | null {
    return traits && Object.keys(traits).length > 0
      ? `They set your personality to: ${Object.entries(traits)
          .map(([trait, value]) => `${trait}: ${String(value)}/100`)
          .join(", ")}.`
      : null;
  }

  private renderVoiceSummaryLine(
    voiceDna: VoiceDnaResolved | null,
    fallbackTraits: Record<string, number> | null
  ): string | null {
    if (voiceDna) {
      return `Your voice is **${voiceDna.archetypeLabel}** — ${voiceDna.archetypeDescription} (sentence length: ${voiceDna.voice.sentenceLength}, pace: ${voiceDna.voice.pace}, irony: ${String(voiceDna.voice.irony)}/100).`;
    }
    return this.renderTraitsSummaryLine(fallbackTraits);
  }

  private generatePreviewPrompt(
    pv: AssistantPublishedVersion,
    userCtx: { displayName: string | null },
    template: string | null,
    voiceDna: VoiceDnaResolved | null
  ): string {
    const assistantName = pv.snapshotDisplayName ?? "Assistant";
    const humanName = userCtx.displayName ?? "your human";
    const voiceSummaryLine = this.renderVoiceSummaryLine(voiceDna, pv.snapshotTraits);
    const traitSummaryLine = this.renderTraitsSummaryLine(pv.snapshotTraits);

    if (template) {
      return this.interpolateTemplate(template, {
        assistant_name: assistantName,
        human_name: humanName,
        voice_summary_line: voiceSummaryLine,
        traits_summary_line: traitSummaryLine
      });
    }

    return [
      "# Character Preview",
      "",
      `You are testing how **${assistantName}** should sound before launch.`,
      "",
      `You are talking to **${humanName}** in a setup preview, not in a real first conversation.`,
      voiceSummaryLine,
      "",
      "Reply with one short natural sample message that clearly shows the assistant's tone, warmth, initiative, and style.",
      "Do not say that you just came online, were created, or are meeting for the first time."
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
      .trimEnd();
  }

  private generateWelcomePrompt(
    pv: AssistantPublishedVersion,
    userCtx: { displayName: string | null },
    template: string | null,
    voiceDna: VoiceDnaResolved | null
  ): string {
    const assistantName = pv.snapshotDisplayName ?? "Assistant";
    const humanName = userCtx.displayName ?? "your human";
    const voiceSummaryLine = this.renderVoiceSummaryLine(voiceDna, pv.snapshotTraits);
    const traitSummaryLine = this.renderTraitsSummaryLine(pv.snapshotTraits);

    if (template) {
      return this.interpolateTemplate(template, {
        assistant_name: assistantName,
        human_name: humanName,
        voice_summary_line: voiceSummaryLine,
        traits_summary_line: traitSummaryLine
      });
    }

    return [
      "# First Conversation",
      "",
      "You just came online for the first time.",
      "",
      `Your name is **${assistantName}**. Your human's name is **${humanName}**.`,
      voiceSummaryLine,
      "",
      "Introduce yourself naturally. Don't interrogate - just talk."
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
      .trimEnd();
  }
}
