import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManagePersonaArchetypesService } from "../../application/manage-persona-archetypes.service";
import type {
  PersonaArchetype,
  PersonaArchetypeBehaviors,
  PersonaArchetypeExample,
  PersonaArchetypePatchInput,
  PersonaArchetypeVoiceParams
} from "../../domain/persona-archetype.entity";

interface PersonaArchetypeStateDto {
  key: string;
  displayOrder: number;
  label: { ru: string; en: string };
  description: { ru: string; en: string };
  voice: {
    sentenceLength: "short" | "medium" | "long";
    pace: "slow" | "normal" | "quick";
    irony: number;
  };
  openingsAllowed: { ru: string[]; en: string[] };
  openingsForbidden: { ru: string[]; en: string[] };
  behaviors: {
    whenUserUpset: { ru: string; en: string };
    whenUserExcited: { ru: string; en: string };
    whenUserTired: { ru: string; en: string };
    whenUserAngry: { ru: string; en: string };
  };
  silenceRule: { ru: string; en: string };
  examples: Array<{
    context: { ru: string; en: string };
    reply: { ru: string; en: string };
  }>;
  defaultTraits: Record<string, number>;
  updatedAt: string;
}

const SENTENCE_LENGTHS = ["short", "medium", "long"] as const;
const PACES = ["slow", "normal", "quick"] as const;

@Controller("api/v1/admin/persona-archetypes")
export class AdminPersonaArchetypesController {
  constructor(private readonly managePersonaArchetypesService: ManagePersonaArchetypesService) {}

  @Get()
  async list(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    archetypes: PersonaArchetypeStateDto[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const archetypes = await this.managePersonaArchetypesService.listForAdmin(userId);
    return {
      requestId: req.requestId ?? null,
      archetypes: archetypes.map((archetype) => this.toDto(archetype))
    };
  }

  @Patch(":key")
  async patch(
    @Req() req: RequestWithPlatformContext,
    @Param("key") key: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; archetype: PersonaArchetypeStateDto }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.parsePatchInput(body);
    const archetype = await this.managePersonaArchetypesService.patch(userId, key, input);
    return { requestId: req.requestId ?? null, archetype: this.toDto(archetype) };
  }

  @Post(":key/reset-to-default")
  async resetToDefault(
    @Req() req: RequestWithPlatformContext,
    @Param("key") key: string
  ): Promise<{ requestId: string | null; archetype: PersonaArchetypeStateDto }> {
    const userId = this.resolveRequestUserId(req);
    const archetype = await this.managePersonaArchetypesService.resetToDefault(userId, key);
    return { requestId: req.requestId ?? null, archetype: this.toDto(archetype) };
  }

  private toDto(archetype: PersonaArchetype): PersonaArchetypeStateDto {
    return {
      key: archetype.key,
      displayOrder: archetype.displayOrder,
      label: archetype.label,
      description: archetype.description,
      voice: archetype.voice,
      openingsAllowed: archetype.openingsAllowed,
      openingsForbidden: archetype.openingsForbidden,
      behaviors: archetype.behaviors,
      silenceRule: archetype.silenceRule,
      examples: archetype.examples,
      defaultTraits: archetype.defaultTraits,
      updatedAt: archetype.updatedAt.toISOString()
    };
  }

  private parsePatchInput(body: unknown): PersonaArchetypePatchInput {
    if (typeof body !== "object" || body === null) {
      throw new BadRequestException("Request body must be a JSON object.");
    }
    const raw = body as Record<string, unknown>;
    const input: PersonaArchetypePatchInput = {};

    if (raw.displayOrder !== undefined) {
      if (typeof raw.displayOrder !== "number" || !Number.isFinite(raw.displayOrder)) {
        throw new BadRequestException("displayOrder must be a finite number.");
      }
      input.displayOrder = raw.displayOrder;
    }
    if (raw.label !== undefined) {
      input.label = this.parseLocalizedString(raw.label, "label");
    }
    if (raw.description !== undefined) {
      input.description = this.parseLocalizedString(raw.description, "description");
    }
    if (raw.voice !== undefined) input.voice = this.parseVoice(raw.voice);
    if (raw.openingsAllowed !== undefined) {
      input.openingsAllowed = this.parseLocalizedStringArray(
        raw.openingsAllowed,
        "openingsAllowed"
      );
    }
    if (raw.openingsForbidden !== undefined) {
      input.openingsForbidden = this.parseLocalizedStringArray(
        raw.openingsForbidden,
        "openingsForbidden"
      );
    }
    if (raw.behaviors !== undefined) {
      input.behaviors = this.parseBehaviors(raw.behaviors);
    }
    if (raw.silenceRule !== undefined) {
      input.silenceRule = this.parseLocalizedString(raw.silenceRule, "silenceRule");
    }
    if (raw.examples !== undefined) input.examples = this.parseExamples(raw.examples);
    if (raw.defaultTraits !== undefined) {
      input.defaultTraits = this.parseDefaultTraits(raw.defaultTraits);
    }

    if (Object.keys(input).length === 0) {
      throw new BadRequestException("At least one archetype field must be provided.");
    }
    return input;
  }

  private parseLocalizedString(value: unknown, fieldName: string): { ru: string; en: string } {
    if (typeof value !== "object" || value === null) {
      throw new BadRequestException(`${fieldName} must be an object with "ru" and "en" strings.`);
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.ru !== "string" || typeof obj.en !== "string") {
      throw new BadRequestException(`${fieldName}.ru and ${fieldName}.en must be strings.`);
    }
    return { ru: obj.ru, en: obj.en };
  }

  private parseLocalizedStringArray(
    value: unknown,
    fieldName: string
  ): { ru: string[]; en: string[] } {
    if (typeof value !== "object" || value === null) {
      throw new BadRequestException(
        `${fieldName} must be an object with "ru" and "en" string arrays.`
      );
    }
    const obj = value as Record<string, unknown>;
    return {
      ru: this.parseStringArray(obj.ru, `${fieldName}.ru`),
      en: this.parseStringArray(obj.en, `${fieldName}.en`)
    };
  }

  private parseStringArray(value: unknown, fieldName: string): string[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an array of strings.`);
    }
    return value.map((item, idx) => {
      if (typeof item !== "string") {
        throw new BadRequestException(`${fieldName}[${String(idx)}] must be a string.`);
      }
      return item;
    });
  }

  private parseVoice(value: unknown): PersonaArchetypeVoiceParams {
    if (typeof value !== "object" || value === null) {
      throw new BadRequestException("voice must be an object.");
    }
    const obj = value as Record<string, unknown>;
    if (
      typeof obj.sentenceLength !== "string" ||
      !(SENTENCE_LENGTHS as readonly string[]).includes(obj.sentenceLength)
    ) {
      throw new BadRequestException(
        `voice.sentenceLength must be one of ${SENTENCE_LENGTHS.join(", ")}.`
      );
    }
    if (typeof obj.pace !== "string" || !(PACES as readonly string[]).includes(obj.pace)) {
      throw new BadRequestException(`voice.pace must be one of ${PACES.join(", ")}.`);
    }
    if (typeof obj.irony !== "number" || obj.irony < 0 || obj.irony > 100) {
      throw new BadRequestException("voice.irony must be a number between 0 and 100.");
    }
    return {
      sentenceLength: obj.sentenceLength as (typeof SENTENCE_LENGTHS)[number],
      pace: obj.pace as (typeof PACES)[number],
      irony: obj.irony
    };
  }

  private parseBehaviors(value: unknown): PersonaArchetypeBehaviors {
    if (typeof value !== "object" || value === null) {
      throw new BadRequestException("behaviors must be an object.");
    }
    const obj = value as Record<string, unknown>;
    return {
      whenUserUpset: this.parseLocalizedString(obj.whenUserUpset, "behaviors.whenUserUpset"),
      whenUserExcited: this.parseLocalizedString(obj.whenUserExcited, "behaviors.whenUserExcited"),
      whenUserTired: this.parseLocalizedString(obj.whenUserTired, "behaviors.whenUserTired"),
      whenUserAngry: this.parseLocalizedString(obj.whenUserAngry, "behaviors.whenUserAngry")
    };
  }

  private parseExamples(value: unknown): PersonaArchetypeExample[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("examples must be an array.");
    }
    return value.map((item, idx) => {
      if (typeof item !== "object" || item === null) {
        throw new BadRequestException(`examples[${String(idx)}] must be an object.`);
      }
      const obj = item as Record<string, unknown>;
      return {
        context: this.parseLocalizedString(obj.context, `examples[${String(idx)}].context`),
        reply: this.parseLocalizedString(obj.reply, `examples[${String(idx)}].reply`)
      };
    });
  }

  private parseDefaultTraits(value: unknown): Record<string, number> {
    if (typeof value !== "object" || value === null) {
      throw new BadRequestException("defaultTraits must be an object.");
    }
    const out: Record<string, number> = {};
    for (const [key, num] of Object.entries(value as Record<string, unknown>)) {
      if (typeof num !== "number" || num < 0 || num > 100) {
        throw new BadRequestException(`defaultTraits.${key} must be a number between 0 and 100.`);
      }
      out[key] = num;
    }
    return out;
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
