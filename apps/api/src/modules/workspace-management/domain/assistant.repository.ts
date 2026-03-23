import type { Assistant } from "./assistant.entity";

export const ASSISTANT_REPOSITORY = Symbol("ASSISTANT_REPOSITORY");

export interface AssistantRepository {
  findByUserId(userId: string): Promise<Assistant | null>;
}
