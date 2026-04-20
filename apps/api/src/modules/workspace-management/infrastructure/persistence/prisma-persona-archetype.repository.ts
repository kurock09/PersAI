import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PersonaArchetype as PrismaPersonaArchetype } from "@prisma/client";
import type {
  PersonaArchetype,
  PersonaArchetypeBehaviors,
  PersonaArchetypeExample,
  PersonaArchetypeLocalized,
  PersonaArchetypePatchInput,
  PersonaArchetypeTraitKey,
  PersonaArchetypeUpsertInput,
  PersonaArchetypeVoiceParams
} from "../../domain/persona-archetype.entity";
import type { PersonaArchetypeRepository } from "../../domain/persona-archetype.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaPersonaArchetypeRepository implements PersonaArchetypeRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findAll(): Promise<PersonaArchetype[]> {
    const rows = await this.prisma.personaArchetype.findMany({
      orderBy: [{ displayOrder: "asc" }, { key: "asc" }]
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  async findByKey(key: string): Promise<PersonaArchetype | null> {
    const row = await this.prisma.personaArchetype.findUnique({ where: { key } });
    return row ? this.mapToDomain(row) : null;
  }

  async upsertIfMissing(input: PersonaArchetypeUpsertInput): Promise<PersonaArchetype> {
    const row = await this.prisma.personaArchetype.upsert({
      where: { key: input.key },
      update: {},
      create: this.toCreatePayload(input)
    });
    return this.mapToDomain(row);
  }

  async upsertOverwrite(input: PersonaArchetypeUpsertInput): Promise<PersonaArchetype> {
    const payload = this.toCreatePayload(input);
    const row = await this.prisma.personaArchetype.upsert({
      where: { key: input.key },
      update: payload,
      create: payload
    });
    return this.mapToDomain(row);
  }

  async patch(key: string, input: PersonaArchetypePatchInput): Promise<PersonaArchetype> {
    const data: Prisma.PersonaArchetypeUpdateInput = {};
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;
    if (input.label !== undefined) {
      data.label = input.label as unknown as Prisma.InputJsonValue;
    }
    if (input.description !== undefined) {
      data.description = input.description as unknown as Prisma.InputJsonValue;
    }
    if (input.voice !== undefined) {
      data.voice = input.voice as unknown as Prisma.InputJsonValue;
    }
    if (input.openingsAllowed !== undefined) {
      data.openingsAllowed = input.openingsAllowed as unknown as Prisma.InputJsonValue;
    }
    if (input.openingsForbidden !== undefined) {
      data.openingsForbidden = input.openingsForbidden as unknown as Prisma.InputJsonValue;
    }
    if (input.behaviors !== undefined) {
      data.behaviors = input.behaviors as unknown as Prisma.InputJsonValue;
    }
    if (input.silenceRule !== undefined) {
      data.silenceRule = input.silenceRule as unknown as Prisma.InputJsonValue;
    }
    if (input.examples !== undefined) {
      data.examples = input.examples as unknown as Prisma.InputJsonValue;
    }
    if (input.defaultTraits !== undefined) {
      data.defaultTraits = input.defaultTraits as unknown as Prisma.InputJsonValue;
    }

    try {
      const row = await this.prisma.personaArchetype.update({
        where: { key },
        data
      });
      return this.mapToDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new NotFoundException(`Persona archetype "${key}" does not exist.`);
      }
      throw error;
    }
  }

  private toCreatePayload(input: PersonaArchetypeUpsertInput): Prisma.PersonaArchetypeCreateInput {
    return {
      key: input.key,
      displayOrder: input.displayOrder,
      label: input.label as unknown as Prisma.InputJsonValue,
      description: input.description as unknown as Prisma.InputJsonValue,
      voice: input.voice as unknown as Prisma.InputJsonValue,
      openingsAllowed: input.openingsAllowed as unknown as Prisma.InputJsonValue,
      openingsForbidden: input.openingsForbidden as unknown as Prisma.InputJsonValue,
      behaviors: input.behaviors as unknown as Prisma.InputJsonValue,
      silenceRule: input.silenceRule as unknown as Prisma.InputJsonValue,
      examples: input.examples as unknown as Prisma.InputJsonValue,
      defaultTraits: input.defaultTraits as unknown as Prisma.InputJsonValue
    };
  }

  private mapToDomain(row: PrismaPersonaArchetype): PersonaArchetype {
    return {
      key: row.key,
      displayOrder: row.displayOrder,
      label: row.label as unknown as PersonaArchetypeLocalized<string>,
      description: row.description as unknown as PersonaArchetypeLocalized<string>,
      voice: row.voice as unknown as PersonaArchetypeVoiceParams,
      openingsAllowed: row.openingsAllowed as unknown as PersonaArchetypeLocalized<string[]>,
      openingsForbidden: row.openingsForbidden as unknown as PersonaArchetypeLocalized<string[]>,
      behaviors: row.behaviors as unknown as PersonaArchetypeBehaviors,
      silenceRule: row.silenceRule as unknown as PersonaArchetypeLocalized<string>,
      examples: row.examples as unknown as PersonaArchetypeExample[],
      defaultTraits: row.defaultTraits as unknown as Record<PersonaArchetypeTraitKey, number>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
