import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";

@Injectable()
export class ManageAssistantAvatarService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async upload(params: {
    userId: string;
    fileBuffer: Buffer;
    mimeType: string;
    originalFilename: string;
    avatarUrl: string;
  }): Promise<{ avatarUrl: string }> {
    const assistant = await this.assistantRepository.findByUserId(params.userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const validated = await validatePersaiMediaFile({
      buffer: params.fileBuffer,
      mimeType: params.mimeType,
      originalFilename: params.originalFilename,
      surface: "chat_upload"
    });
    const assistantPrefix = this.mediaObjectStorage.buildAssistantPrefix(assistant.id);
    await this.mediaObjectStorage.deletePrefix(`${assistantPrefix}avatar/`);
    await this.mediaObjectStorage.saveObject({
      objectKey: `${assistantPrefix}avatar/current`,
      buffer: params.fileBuffer,
      mimeType: validated.effectiveMimeType
    });

    const updated = await this.assistantRepository.updateDraft(params.userId, {
      draftDisplayName: assistant.draftDisplayName,
      draftInstructions: assistant.draftInstructions,
      draftAvatarUrl: params.avatarUrl
    });
    if (updated === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    return { avatarUrl: params.avatarUrl };
  }

  async download(userId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    return this.mediaObjectStorage.downloadObject(
      `${this.mediaObjectStorage.buildAssistantPrefix(assistant.id)}avatar/current`
    );
  }
}
