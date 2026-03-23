import { Inject, Injectable } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { Assistant } from "../domain/assistant.entity";

@Injectable()
export class GetAssistantByUserIdService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository
  ) {}

  async execute(userId: string): Promise<Assistant | null> {
    return this.assistantRepository.findByUserId(userId);
  }
}
