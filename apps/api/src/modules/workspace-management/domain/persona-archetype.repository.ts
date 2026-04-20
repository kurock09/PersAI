import type {
  PersonaArchetype,
  PersonaArchetypePatchInput,
  PersonaArchetypeUpsertInput
} from "./persona-archetype.entity";

export const PERSONA_ARCHETYPE_REPOSITORY = Symbol("PERSONA_ARCHETYPE_REPOSITORY");

export interface PersonaArchetypeRepository {
  findAll(): Promise<PersonaArchetype[]>;
  findByKey(key: string): Promise<PersonaArchetype | null>;
  /**
   * Insert-only upsert: if the row already exists, leave it untouched.
   * Used by the lazy seeder to populate fresh databases without overwriting
   * admin edits.
   */
  upsertIfMissing(input: PersonaArchetypeUpsertInput): Promise<PersonaArchetype>;
  /** Force-overwrite — used by the admin "Reset to default" action. */
  upsertOverwrite(input: PersonaArchetypeUpsertInput): Promise<PersonaArchetype>;
  patch(key: string, input: PersonaArchetypePatchInput): Promise<PersonaArchetype>;
}
