import { Inject, Injectable } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { AssistantLifecycleState } from "./assistant-lifecycle.types";
import { toAssistantLifecycleState } from "./assistant-lifecycle.mapper";

@Injectable()
export class GetAssistantByUserIdService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository
  ) {}

  async execute(userId: string): Promise<AssistantLifecycleState | null> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    return assistant ? toAssistantLifecycleState(assistant) : null;
  }
}
