import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimeModelRole,
  ProviderGatewayTextGenerateRequest
} from "@persai/runtime-contract";
import {
  ProviderGatewayClientService,
  ProviderGatewaySafetyRejectedError
} from "./provider-gateway.client.service";

type NativeManagedProvider = "openai" | "anthropic";
type ProviderSelection = { provider: NativeManagedProvider; model: string };

const IMAGE_SAFETY_REWRITE_OUTPUT_SCHEMA = {
  name: "image_provider_safety_rewrite",
  description: "Safer rewrite for a benign image prompt after provider safety rejection.",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      safePrompt: {
        type: "string",
        minLength: 1
      }
    },
    required: ["safePrompt"]
  },
  strict: true
} satisfies NonNullable<ProviderGatewayTextGenerateRequest["outputSchema"]>;

export async function rewritePromptAfterProviderSafetyReject(input: {
  bundle: AssistantRuntimeBundle;
  providerGatewayClientService: ProviderGatewayClientService;
  requestId: string;
  toolCode: "image_generate" | "image_edit";
  originalPrompt: string;
  failure: ProviderGatewaySafetyRejectedError;
}): Promise<
  | {
      ok: true;
      rewrittenPrompt: string;
      retryWarning: string;
    }
  | {
      ok: false;
      failureWarning: string;
    }
> {
  const providerSelection = resolveProviderSelection(input.bundle, "system_tool");
  if (providerSelection === null) {
    return {
      ok: false,
      failureWarning:
        `${describeOriginalSafetyReject(input.failure)} ` +
        "PersAI could not prepare one safer paraphrase because no rewrite model is configured."
    };
  }

  try {
    const response = await input.providerGatewayClientService.generateText({
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: [
        "You rewrite image prompts after an upstream provider safety rejection.",
        "Preserve the user's benign visual intent, style goal, and important constraints.",
        "Remove or generalize wording that can trigger provider safety or policy rejection.",
        "If the prompt references a copyrighted or branded character/persona, replace it with a generic descriptive equivalent while keeping the intended vibe.",
        "Do not refuse. Do not mention policy, safety, refusal, or moderation in the rewritten prompt.",
        "Return only the requested JSON object."
      ].join(" "),
      maxOutputTokens: 180,
      outputSchema: IMAGE_SAFETY_REWRITE_OUTPUT_SCHEMA,
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            {
              toolCode: input.toolCode,
              originalPrompt: input.originalPrompt,
              providerRejectionMessage: input.failure.message,
              providerRequestId: input.failure.requestId
            },
            null,
            2
          )
        }
      ],
      requestMetadata: {
        classification: "main_turn",
        runtimeRequestId: `${input.requestId}:${input.toolCode}:safety-rewrite`,
        runtimeSessionId: null,
        toolLoopIteration: null,
        compactionToolCode: null
      }
    });
    const rewrittenPrompt = parseSafePrompt(response.text);
    if (rewrittenPrompt === null) {
      return {
        ok: false,
        failureWarning:
          `${describeOriginalSafetyReject(input.failure)} ` +
          "PersAI could not prepare one valid safer paraphrase."
      };
    }
    if (normalizeText(rewrittenPrompt) === normalizeText(input.originalPrompt)) {
      return {
        ok: false,
        failureWarning:
          `${describeOriginalSafetyReject(input.failure)} ` +
          "PersAI could not prepare a meaningfully safer paraphrase."
      };
    }
    return {
      ok: true,
      rewrittenPrompt,
      retryWarning: `${describeOriginalSafetyReject(input.failure)} Retrying once with a safer phrasing.`
    };
  } catch (error) {
    return {
      ok: false,
      failureWarning:
        `${describeOriginalSafetyReject(input.failure)} ` +
        `PersAI could not prepare one safer paraphrase${
          error instanceof Error && error.message.trim().length > 0
            ? `: ${error.message.trim()}`
            : "."
        }`
    };
  }
}

export function buildImageSafetyRetryFailureWarning(input: {
  originalFailure: ProviderGatewaySafetyRejectedError;
  retryError: unknown;
}): string {
  if (input.retryError instanceof ProviderGatewaySafetyRejectedError) {
    const secondRequestId =
      input.retryError.requestId === null ? "" : ` Retry request id ${input.retryError.requestId}.`;
    return (
      `${describeOriginalSafetyReject(input.originalFailure)} ` +
      "The single retry with a safer phrasing was also rejected by the provider safety system." +
      secondRequestId
    );
  }

  return (
    `${describeOriginalSafetyReject(input.originalFailure)} ` +
    `The single retry with a safer phrasing did not complete${
      input.retryError instanceof Error && input.retryError.message.trim().length > 0
        ? `: ${input.retryError.message.trim()}`
        : "."
    }`
  );
}

function parseSafePrompt(text: string | null): string | null {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { safePrompt?: unknown };
    return typeof parsed.safePrompt === "string" && parsed.safePrompt.trim().length > 0
      ? parsed.safePrompt.trim()
      : null;
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function describeOriginalSafetyReject(failure: ProviderGatewaySafetyRejectedError): string {
  const requestIdText = failure.requestId === null ? "" : ` Request id ${failure.requestId}.`;
  return `The provider rejected the original image prompt under its safety system.${requestIdText}`;
}

function resolveProviderSelection(
  bundle: AssistantRuntimeBundle,
  modelRole: PersaiRuntimeModelRole
): ProviderSelection | null {
  const direct = resolveModelSlotSelection(bundle, modelRole);
  if (direct !== null) {
    return direct;
  }
  const normal = resolveModelSlotSelection(bundle, "normal_reply");
  if (normal !== null) {
    return normal;
  }
  const primaryPath = asObject(asObject(bundle.runtime.runtimeProviderRouting)?.primaryPath);
  if (primaryPath?.active === false) {
    return null;
  }
  const primaryProvider = asNativeManagedProvider(primaryPath?.providerKey);
  const primaryModel = asNonEmptyString(primaryPath?.modelKey);
  if (primaryProvider !== null && primaryModel !== null) {
    return { provider: primaryProvider, model: primaryModel };
  }
  const profilePrimary = asObject(asObject(bundle.runtime.runtimeProviderProfile)?.primary);
  const profileProvider = asNativeManagedProvider(profilePrimary?.provider);
  const profileModel = asNonEmptyString(profilePrimary?.model);
  return profileProvider !== null && profileModel !== null
    ? { provider: profileProvider, model: profileModel }
    : null;
}

function resolveModelSlotSelection(
  bundle: AssistantRuntimeBundle,
  modelRole: PersaiRuntimeModelRole
): ProviderSelection | null {
  const routing = asObject(bundle.runtime.runtimeProviderRouting);
  const modelSlots = asObject(routing?.modelSlots);
  const slotKey =
    modelRole === "premium_reply"
      ? "premiumReply"
      : modelRole === "reasoning"
        ? "reasoning"
        : modelRole === "system_tool"
          ? "systemTool"
          : modelRole === "retrieval"
            ? "retrieval"
            : "normalReply";
  const slot = asObject(modelSlots?.[slotKey]);
  const provider = asNativeManagedProvider(slot?.providerKey);
  const model = asNonEmptyString(slot?.modelKey);
  return provider !== null && model !== null ? { provider, model } : null;
}

function asNativeManagedProvider(value: unknown): NativeManagedProvider | null {
  return value === "openai" || value === "anthropic" ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
