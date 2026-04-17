import { Injectable } from "@nestjs/common";
import type {
  AssistantRuntimeCompiledOrdinaryPromptSections,
  AssistantRuntimePromptConstructor,
  AssistantRuntimePromptDocuments
} from "@persai/runtime-bundle";
import type { RuntimeToolPolicy } from "@persai/runtime-contract";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import { normalizeAssistantGender } from "./assistant-gender";
import { buildRuntimeToolPoliciesMarkdown } from "./runtime-tool-policy";

export interface PromptTemplateMap {
  system?: string | null;
  soul?: string | null;
  user?: string | null;
  identity?: string | null;
  tools?: string | null;
  agents?: string | null;
  heartbeat?: string | null;
  preview_bootstrap?: string | null;
  welcome_bootstrap?: string | null;
  bootstrap?: string | null;
}

@Injectable()
export class CompilePromptConstructorService {
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
    promptTemplates: PromptTemplateMap;
  }): {
    promptDocuments: AssistantRuntimePromptDocuments;
    promptConstructor: AssistantRuntimePromptConstructor;
  } {
    const promptDocuments: AssistantRuntimePromptDocuments = {
      soul: this.generateSoulPrompt(params.publishedVersion, params.promptTemplates.soul ?? null),
      user: this.generateUserPrompt(params.userContext, params.promptTemplates.user ?? null),
      identity: this.generateIdentityPrompt(
        params.publishedVersion,
        params.promptTemplates.identity ?? null
      ),
      tools: this.generateToolsPrompt(params.toolPolicies, params.promptTemplates.tools ?? null),
      agents: this.generateAgentsPrompt(params.promptTemplates.agents ?? null),
      heartbeat: this.generateHeartbeatPrompt(params.promptTemplates.heartbeat ?? null),
      preview: this.generatePreviewPrompt(
        params.publishedVersion,
        params.userContext,
        params.promptTemplates.preview_bootstrap ?? null
      ),
      welcome: this.generateWelcomePrompt(
        params.publishedVersion,
        params.userContext,
        params.promptTemplates.welcome_bootstrap ?? params.promptTemplates.bootstrap ?? null
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
      tools: promptDocuments.tools,
      agents: promptDocuments.agents,
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
          systemPrompt: systemPrompt.length > 0 ? systemPrompt : null
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

  private generateSoulPrompt(pv: AssistantPublishedVersion, template: string | null): string {
    const assistantGender = normalizeAssistantGender(pv.snapshotAssistantGender);
    const traitsBlock = this.renderTraitsBlock(pv.snapshotTraits);
    const instructionsBlock = pv.snapshotInstructions
      ? `## Instructions\n\n${pv.snapshotInstructions}\n`
      : "";

    if (template) {
      return this.interpolateTemplate(template, {
        assistant_name: pv.snapshotDisplayName ?? "an assistant",
        assistant_gender_line: assistantGender ? `- **Gender**: ${assistantGender}` : null,
        traits_block: traitsBlock,
        instructions_block: instructionsBlock
      });
    }

    const lines: string[] = ["# Core Persona", ""];
    lines.push(`You are **${pv.snapshotDisplayName ?? "an assistant"}**.`);
    if (assistantGender) {
      lines.push(`- **Gender**: ${assistantGender}`);
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

  private generateToolsPrompt(toolPolicies: RuntimeToolPolicy[], template: string | null): string {
    const catalog = buildRuntimeToolPoliciesMarkdown(toolPolicies);
    if (template) {
      return this.interpolateTemplate(template, {
        tools_catalog_block: catalog
      });
    }

    return catalog;
  }

  private generateAgentsPrompt(template: string | null): string {
    return this.normalizeOptionalText(template) ?? "";
  }

  private generateHeartbeatPrompt(template: string | null): string {
    return this.normalizeOptionalText(template) ?? "";
  }

  private generateSystemPrompt(
    ordinarySections: AssistantRuntimeCompiledOrdinaryPromptSections,
    template: string | null
  ): string {
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
        tools_block: ordinarySections.tools,
        agents_block: ordinarySections.agents,
        heartbeat_block: ordinarySections.heartbeat
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
      this.normalizeOptionalText(ordinarySections.tools),
      this.normalizeOptionalText(ordinarySections.agents),
      this.normalizeOptionalText(ordinarySections.heartbeat)
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

  private generatePreviewPrompt(
    pv: AssistantPublishedVersion,
    userCtx: { displayName: string | null },
    template: string | null
  ): string {
    const assistantName = pv.snapshotDisplayName ?? "Assistant";
    const humanName = userCtx.displayName ?? "your human";
    const traitSummaryLine = this.renderTraitsSummaryLine(pv.snapshotTraits);

    if (template) {
      return this.interpolateTemplate(template, {
        assistant_name: assistantName,
        human_name: humanName,
        traits_summary_line: traitSummaryLine
      });
    }

    return [
      "# Character Preview",
      "",
      `You are testing how **${assistantName}** should sound before launch.`,
      "",
      `You are talking to **${humanName}** in a setup preview, not in a real first conversation.`,
      traitSummaryLine,
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
    template: string | null
  ): string {
    const assistantName = pv.snapshotDisplayName ?? "Assistant";
    const humanName = userCtx.displayName ?? "your human";
    const traitSummaryLine = this.renderTraitsSummaryLine(pv.snapshotTraits);

    if (template) {
      return this.interpolateTemplate(template, {
        assistant_name: assistantName,
        human_name: humanName,
        traits_summary_line: traitSummaryLine
      });
    }

    return [
      "# First Conversation",
      "",
      "You just came online for the first time.",
      "",
      `Your name is **${assistantName}**. Your human's name is **${humanName}**.`,
      traitSummaryLine,
      "",
      "Introduce yourself naturally. Don't interrogate - just talk."
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
      .trimEnd();
  }
}
