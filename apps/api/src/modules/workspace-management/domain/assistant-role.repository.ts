import type { AssistantRole } from "./assistant-role.entity";

export const ASSISTANT_ROLE_REPOSITORY = Symbol("ASSISTANT_ROLE_REPOSITORY");

export interface AssistantRoleRepository {
  findById(id: string): Promise<AssistantRole | null>;
  findByKey(key: string): Promise<AssistantRole | null>;
  findActiveCatalog(): Promise<AssistantRole[]>;
}
