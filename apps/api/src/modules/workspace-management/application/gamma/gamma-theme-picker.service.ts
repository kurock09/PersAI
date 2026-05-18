import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type { ProviderGatewayTextGenerateRequest } from "@persai/runtime-contract";
import { ResolvePlatformRuntimeProviderSettingsService } from "../resolve-platform-runtime-provider-settings.service";
import { GammaThemeCatalogService } from "./gamma-theme-catalog.service";
import type { GammaThemeCatalogEntry, GammaThemePickerResult } from "./gamma-theme.types";

const GAMMA_THEME_PICKER_TIMEOUT_MS = 30_000;
const GAMMA_THEME_PICKER_MAX_OUTPUT_TOKENS = 400;

const GAMMA_THEME_PICKER_OUTPUT_SCHEMA = {
  name: "gamma_theme_picker",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["themeId", "reason"],
    properties: {
      themeId: {
        type: ["string", "null"]
      },
      reason: {
        type: "string"
      }
    }
  }
} as const;

@Injectable()
export class GammaThemePickerService {
  private readonly logger = new Logger(GammaThemePickerService.name);

  constructor(
    private readonly gammaThemeCatalogService: GammaThemeCatalogService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService
  ) {}

  async pickTheme(input: {
    prompt: string;
    instructions?: string | null;
    sourceUserMessageText: string;
    visualStyle?: string | null;
    imagePolicy?: string | null;
    visualDensity?: string | null;
  }): Promise<GammaThemePickerResult> {
    const themes = await this.gammaThemeCatalogService.listStandardThemes();
    if (themes.length === 0) {
      return { themeId: null, reason: null };
    }

    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_PROVIDER_GATEWAY_BASE_URL?.trim();
    if (!baseUrl) {
      return { themeId: null, reason: null };
    }
    const runtimeSettings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    if (runtimeSettings.primary === null) {
      return { themeId: null, reason: null };
    }

    const request: ProviderGatewayTextGenerateRequest = {
      provider: runtimeSettings.primary.provider,
      model: runtimeSettings.primary.model,
      systemPrompt: [
        "You choose a Gamma presentation theme for a deferred document job.",
        "Return only JSON matching the schema.",
        "Pick exactly one themeId from the supplied catalog when a theme clearly fits the presentation request.",
        "Return themeId null when no catalog theme is a good fit or the request is ambiguous.",
        "Never invent theme ids.",
        "Treat the user's real presentation context as primary: audience, topic, formality, age, and visual intent matter more than generic popularity.",
        "For school, classroom, student, lesson, biology, history, geography, or educational decks, prefer themes that feel clear, friendly, readable, and age-appropriate; avoid themes that feel overly dark, corporate, aggressive, or luxury-brand unless the request explicitly asks for that.",
        "For investor, startup, sales, board, or executive decks, prefer confident premium modern themes with stronger contrast and sharper business polish.",
        "For formal reports, proposals, and professional explainers, prefer calm, trustworthy, readable themes over playful or loud themes.",
        "For creative, food, lifestyle, travel, or storytelling decks, warmer or more expressive themes are appropriate when the request suggests it.",
        "If visualStyle, imagePolicy, or visualDensity hints are present, use them as strong guidance. Do not let text-heavy or text-only hints force a stale-looking theme unless the request explicitly wants that."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: [
            "Presentation request:",
            input.sourceUserMessageText,
            "",
            `Tool prompt: ${input.prompt}`,
            input.instructions ? `Extra instructions: ${input.instructions}` : null,
            input.visualStyle ? `Visual style hint: ${input.visualStyle}` : null,
            input.imagePolicy ? `Image policy hint: ${input.imagePolicy}` : null,
            input.visualDensity ? `Visual density hint: ${input.visualDensity}` : null,
            "",
            "Selection rules:",
            "- Optimize for how the finished deck should feel in real use, not just for matching literal keywords.",
            "- School and educational decks should usually feel clean, approachable, and readable rather than harsh or overly corporate.",
            "- Business and investor decks can be bolder and more premium, but should still stay presentation-native and credible.",
            "- If no theme is clearly better than the workspace default, return themeId null.",
            "",
            "Gamma theme catalog (themeId | name | tones | colors):",
            ...themes.map((theme) => this.formatThemeLine(theme))
          ]
            .filter((line): line is string => typeof line === "string" && line.length > 0)
            .join("\n")
        }
      ],
      maxOutputTokens: GAMMA_THEME_PICKER_MAX_OUTPUT_TOKENS,
      outputSchema: GAMMA_THEME_PICKER_OUTPUT_SCHEMA,
      requestMetadata: {
        classification: "document_presentation_theme_picker",
        runtimeRequestId: null,
        runtimeSessionId: null,
        toolLoopIteration: null,
        compactionToolCode: null
      }
    };

    try {
      const response = await this.postJson(
        new URL("/api/v1/providers/generate-text", baseUrl).toString(),
        request,
        GAMMA_THEME_PICKER_TIMEOUT_MS
      );
      const parsed = this.parsePickerOutput(response.text ?? "", themes);
      if (parsed.themeId !== null) {
        this.logger.log(
          `[gamma-theme-picker] selected themeId=${parsed.themeId} reason=${parsed.reason ?? "(none)"}`
        );
      }
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[gamma-theme-picker] picker LLM failed: ${message}`);
      return { themeId: null, reason: null };
    }
  }

  private formatThemeLine(theme: GammaThemeCatalogEntry): string {
    const tones = theme.toneKeywords.length > 0 ? theme.toneKeywords.slice(0, 8).join(", ") : "n/a";
    const colors =
      theme.colorKeywords.length > 0 ? theme.colorKeywords.slice(0, 8).join(", ") : "n/a";
    return `${theme.id} | ${theme.name} | tones: ${tones} | colors: ${colors}`;
  }

  private parsePickerOutput(
    text: string,
    themes: GammaThemeCatalogEntry[]
  ): GammaThemePickerResult {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { themeId: null, reason: null };
    }
    const unfenced = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    let payload: unknown;
    try {
      payload = JSON.parse(unfenced) as unknown;
    } catch {
      return { themeId: null, reason: null };
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return { themeId: null, reason: null };
    }
    const row = payload as Record<string, unknown>;
    const reason = typeof row.reason === "string" ? row.reason.trim() : null;
    const themeIdRaw = row.themeId;
    if (themeIdRaw === null) {
      return { themeId: null, reason };
    }
    if (typeof themeIdRaw !== "string" || themeIdRaw.trim().length === 0) {
      return { themeId: null, reason };
    }
    const themeId = themeIdRaw.trim();
    const known = themes.some((theme) => theme.id === themeId);
    return known ? { themeId, reason } : { themeId: null, reason };
  }

  private async postJson(
    url: string,
    body: ProviderGatewayTextGenerateRequest,
    timeoutMs: number
  ): Promise<{ text?: string | null }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
          bodyText.trim().length > 0
            ? `HTTP ${String(response.status)}: ${bodyText.trim()}`
            : `HTTP ${String(response.status)}`
        );
      }
      return (await response.json()) as { text?: string | null };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
