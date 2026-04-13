import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { SendNativeWebChatTurnService } from "./send-native-web-chat-turn.service";

const SCHEDULED_ACTION_THREAD_PREFIX = "system:scheduled-action:";

function stringifyPayload(value: Record<string, unknown> | null): string {
  if (value === null) {
    return "{}";
  }
  return JSON.stringify(value, null, 2);
}

function buildScheduledActionPrompt(input: {
  title: string;
  actionType: string;
  actionPayload: Record<string, unknown> | null;
  payloadText: string;
}): string {
  return [
    "This is a hidden assistant-side scheduled action.",
    "Nothing from this turn is shown directly to the user.",
    'If a user-visible follow-up is truly helpful, create a separate scheduled_action with audience="user".',
    "Do not assume the user needs a message if quiet internal state updates are enough.",
    "",
    `Title: ${input.title}`,
    `Action type: ${input.actionType}`,
    `Action payload JSON: ${stringifyPayload(input.actionPayload)}`,
    "",
    "Scheduled action context:",
    input.payloadText
  ].join("\n");
}

@Injectable()
export class RunScheduledAssistantActionService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
    private readonly sendNativeWebChatTurnService: SendNativeWebChatTurnService
  ) {}

  async execute(input: {
    assistantId: string;
    externalRef: string;
    title: string;
    actionType: string;
    actionPayload: Record<string, unknown> | null;
    payloadText: string;
    runAtMs: number;
  }): Promise<void> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    const publishedVersionId = assistant.applyAppliedVersionId?.trim() ?? "";
    if (!publishedVersionId) {
      throw new ServiceUnavailableException(
        "Assistant has no applied published version for scheduled assistant actions."
      );
    }
    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );
    await this.sendNativeWebChatTurnService.execute({
      assistantId: assistant.id,
      publishedVersionId,
      runtimeTier,
      surfaceThreadKey: `${SCHEDULED_ACTION_THREAD_PREFIX}${input.externalRef}`,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      userMessageId: `scheduled-action:${input.externalRef}:${String(input.runAtMs)}`,
      userMessage: buildScheduledActionPrompt({
        title: input.title,
        actionType: input.actionType,
        actionPayload: input.actionPayload,
        payloadText: input.payloadText
      }),
      attachments: [],
      currentTimeIso: new Date(input.runAtMs).toISOString()
    });
  }
}
