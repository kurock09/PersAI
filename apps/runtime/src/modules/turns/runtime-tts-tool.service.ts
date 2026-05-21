import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_TTS_TEXT_CHARS,
  PERSAI_RUNTIME_TTS_DELIVERY_KINDS,
  PERSAI_RUNTIME_TTS_PROVIDER_IDS,
  PERSAI_RUNTIME_TTS_TONE_TAGS,
  type PersaiRuntimeTtsDeliveryKind,
  type PersaiRuntimeTtsProviderId,
  type ProviderGatewayToolCall,
  type RuntimeOutputArtifact,
  type RuntimeToolPolicy,
  type RuntimeTtsRequest,
  type RuntimeTtsToolResult
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";

export interface RuntimeTtsToolExecutionResult {
  payload: RuntimeTtsToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeTtsToolService {
  constructor(
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly runtimeAssistantFileRegistryService: RuntimeAssistantFileRegistryService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
  }): Promise<RuntimeTtsToolExecutionResult> {
    const request = this.readTtsArguments(params.toolCall.arguments, params.bundle);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: "tts",
          executionMode: "worker",
          provider: null,
          model: null,
          requestedText: null,
          toneTag: null,
          deliveryKind: null,
          artifact: null,
          attemptedProviders: [],
          usage: null,
          action: "skipped",
          reason: "invalid_arguments",
          warning: request.message
        },
        artifacts: [],
        isError: true
      };
    }

    const policy = this.resolveAllowedWorkerToolPolicy(params.bundle, "tts");
    if (policy === null) {
      return {
        payload: {
          toolCode: "tts",
          executionMode: "worker",
          provider: null,
          model: null,
          requestedText: request.text,
          toneTag: request.toneTag,
          deliveryKind: request.deliveryKind,
          artifact: null,
          attemptedProviders: [],
          usage: null,
          action: "skipped",
          reason: "tool_unavailable",
          warning: null
        },
        artifacts: [],
        isError: false
      };
    }

    const credentialChain = this.resolveConfiguredCredentialChain(params.bundle, "tts");
    if (credentialChain.length === 0) {
      return {
        payload: {
          toolCode: "tts",
          executionMode: "worker",
          provider: null,
          model: null,
          requestedText: request.text,
          toneTag: request.toneTag,
          deliveryKind: request.deliveryKind,
          artifact: null,
          attemptedProviders: [],
          usage: null,
          action: "skipped",
          reason: "credential_not_configured",
          warning: null
        },
        artifacts: [],
        isError: false
      };
    }

    // ADR-074 L1.1 — always count the call for observability, even when
    // the plan does not configure a daily cap. The runtime forwards the
    // locally-observed `dailyCallLimit` (which may be null) and the API
    // both enforces the live plan and increments the daily counter.
    const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
      assistantId: params.bundle.metadata.assistantId,
      toolCode: "tts",
      dailyCallLimit: policy.dailyCallLimit
    });
    if (!quotaOutcome.allowed) {
      return {
        payload: {
          toolCode: "tts",
          executionMode: "worker",
          provider: credentialChain[0]?.providerId ?? null,
          model: null,
          requestedText: request.text,
          toneTag: request.toneTag,
          deliveryKind: request.deliveryKind,
          artifact: null,
          attemptedProviders: [],
          usage: null,
          action: "skipped",
          reason: quotaOutcome.code,
          warning: quotaOutcome.message
        },
        artifacts: [],
        isError: false
      };
    }

    const attemptedProviders: PersaiRuntimeTtsProviderId[] = [];
    const warnings: string[] = [];

    for (const credential of credentialChain) {
      attemptedProviders.push(credential.providerId);
      try {
        const providerResult = await this.providerGatewayClientService.generateSpeech({
          text: request.text,
          locale: params.bundle.persona.voiceProfile.defaultLocale,
          toneTag: request.toneTag,
          deliveryKind: request.deliveryKind,
          assistantGender: params.bundle.persona.assistantGender,
          traits: params.bundle.persona.traits,
          voiceProfile: params.bundle.persona.voiceProfile,
          credential: {
            toolCode: "tts",
            secretId: credential.secretRef.id,
            providerId: credential.providerId
          }
        });
        const artifact = await this.persistGeneratedArtifact({
          assistantId: params.bundle.metadata.assistantId,
          workspaceId: params.bundle.metadata.workspaceId,
          sessionId: params.sessionId,
          requestId: params.requestId,
          provider: providerResult.provider,
          deliveryKind: providerResult.deliveryKind,
          bytesBase64: providerResult.bytesBase64,
          mimeType: providerResult.mimeType,
          billingFacts: providerResult.billingFacts
        });
        return {
          payload: {
            toolCode: "tts",
            executionMode: "worker",
            provider: providerResult.provider,
            model: providerResult.model,
            requestedText: request.text,
            toneTag: request.toneTag,
            deliveryKind: providerResult.deliveryKind,
            artifact,
            attemptedProviders,
            usage: providerResult.usage,
            action: "generated",
            reason: null,
            warning: this.combineWarnings(
              ...warnings,
              providerResult.warning,
              attemptedProviders.length > 1
                ? `Used fallback provider "${providerResult.provider}".`
                : null
            )
          },
          artifacts: [artifact],
          isError: false
        };
      } catch (error) {
        warnings.push(
          `${credential.providerId} failed: ${error instanceof Error ? error.message : "Speech generation failed."}`
        );
      }
    }

    return {
      payload: {
        toolCode: "tts",
        executionMode: "worker",
        provider: attemptedProviders.at(-1) ?? null,
        model: null,
        requestedText: request.text,
        toneTag: request.toneTag,
        deliveryKind: request.deliveryKind,
        artifact: null,
        attemptedProviders,
        usage: null,
        action: "skipped",
        reason: "speech_generation_failed",
        warning: this.combineWarnings(...warnings)
      },
      artifacts: [],
      isError: true
    };
  }

  private readTtsArguments(
    args: Record<string, unknown>,
    bundle: AssistantRuntimeBundle
  ): (RuntimeTtsRequest & { deliveryKind: PersaiRuntimeTtsDeliveryKind }) | Error {
    const unknownKeys = Object.keys(args).filter(
      (key) => key !== "text" && key !== "toneTag" && key !== "deliveryKind"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }

    const text = this.asNonEmptyString(args.text);
    if (text === null) {
      return new Error("text must be a non-empty string");
    }
    if (text.length > MAX_RUNTIME_TTS_TEXT_CHARS) {
      return new Error(`text must be at most ${String(MAX_RUNTIME_TTS_TEXT_CHARS)} characters`);
    }

    const toneTag =
      typeof args.toneTag === "string" && this.isToneTag(args.toneTag) ? args.toneTag : null;
    if (toneTag === null) {
      return new Error(`toneTag must be one of ${PERSAI_RUNTIME_TTS_TONE_TAGS.join(", ")}`);
    }

    const deliveryKind =
      args.deliveryKind === undefined || args.deliveryKind === null
        ? bundle.persona.voiceProfile.deliveryKind
        : typeof args.deliveryKind === "string" && this.isDeliveryKind(args.deliveryKind)
          ? args.deliveryKind
          : null;
    if (deliveryKind === null) {
      return new Error(
        `deliveryKind must be one of ${PERSAI_RUNTIME_TTS_DELIVERY_KINDS.join(", ")} when provided`
      );
    }

    return {
      toolCode: "tts",
      text,
      toneTag,
      deliveryKind
    };
  }

  private async persistGeneratedArtifact(input: {
    assistantId: string;
    workspaceId: string;
    sessionId: string;
    requestId: string;
    provider: PersaiRuntimeTtsProviderId;
    deliveryKind: PersaiRuntimeTtsDeliveryKind;
    bytesBase64: string;
    mimeType: string;
    billingFacts: RuntimeOutputArtifact["billingFacts"];
  }): Promise<RuntimeOutputArtifact> {
    if (!input.mimeType.startsWith("audio/")) {
      throw new Error(`Speech provider returned unsupported MIME type "${input.mimeType}".`);
    }
    const buffer = Buffer.from(input.bytesBase64, "base64");
    if (buffer.length === 0) {
      throw new Error("Speech provider returned an empty audio payload.");
    }

    const artifactId = randomUUID();
    const extension = this.extensionFromMimeType(input.mimeType);
    const objectKey = this.mediaObjectStorage.buildRuntimeOutputObjectKey({
      assistantId: input.assistantId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      artifactId,
      extension
    });
    const stored = await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer,
      mimeType: input.mimeType
    });
    const filename = this.resolveFilename(input.deliveryKind, input.provider, extension);
    const file = await this.runtimeAssistantFileRegistryService.ensureAttachmentBackedFile({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      origin: "runtime_output",
      referenceId: artifactId,
      objectKey: stored.objectKey,
      filename,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes
    });
    const runtimeFileRef = this.runtimeAssistantFileRegistryService.toRuntimeFileRef(file);

    return {
      artifactId,
      fileRef: runtimeFileRef.fileRef,
      file: runtimeFileRef,
      kind: "audio",
      objectKey: stored.objectKey,
      mimeType: stored.mimeType,
      filename,
      sizeBytes: stored.sizeBytes,
      voiceNote: input.deliveryKind === "voice_note",
      billingFacts: input.billingFacts ?? null
    };
  }

  private resolveFilename(
    deliveryKind: PersaiRuntimeTtsDeliveryKind,
    provider: PersaiRuntimeTtsProviderId,
    extension: string
  ): string {
    if (deliveryKind === "voice_note") {
      return `voice-note-${provider}.${extension}`;
    }
    return `speech-${provider}.${extension}`;
  }

  private resolveAllowedWorkerToolPolicy(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
    if (
      policy === null ||
      policy.visibleToModel !== true ||
      policy.enabled !== true ||
      policy.usageRule !== "allowed" ||
      policy.executionMode !== "worker"
    ) {
      return null;
    }
    return policy;
  }

  private resolveConfiguredCredentialChain(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): Array<AssistantRuntimeBundleToolCredentialRef & { providerId: PersaiRuntimeTtsProviderId }> {
    const primary = bundle.governance.toolCredentialRefs[toolCode] ?? null;
    const candidates = primary === null ? [] : [primary, ...(primary.fallbacks ?? [])];
    const resolved: Array<
      AssistantRuntimeBundleToolCredentialRef & { providerId: PersaiRuntimeTtsProviderId }
    > = [];
    const seenKeys = new Set<string>();

    for (const candidate of candidates) {
      if (
        candidate.configured !== true ||
        typeof candidate.secretRef.id !== "string" ||
        candidate.secretRef.id.trim().length === 0
      ) {
        continue;
      }
      const providerId = this.resolveTtsProviderId(candidate.providerId ?? null);
      if (providerId === null) {
        continue;
      }
      const dedupeKey = `${providerId}:${candidate.secretRef.id.trim()}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);
      resolved.push({
        ...candidate,
        providerId,
        secretRef: {
          ...candidate.secretRef,
          id: candidate.secretRef.id.trim()
        }
      });
    }

    return resolved;
  }

  private resolveTtsProviderId(providerId: string | null): PersaiRuntimeTtsProviderId | null {
    return providerId !== null && this.isProviderId(providerId) ? providerId : null;
  }

  private combineWarnings(...warnings: Array<string | null | undefined>): string | null {
    const normalized = warnings
      .flatMap((warning) => (warning ?? "").split("\n"))
      .map((warning) => warning.trim())
      .filter((warning) => warning.length > 0);
    return normalized.length > 0 ? normalized.join(" ") : null;
  }

  private extensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case "audio/mpeg":
      case "audio/mp3":
        return "mp3";
      case "audio/wav":
        return "wav";
      case "audio/mp4":
      case "audio/aac":
        return "m4a";
      case "audio/ogg":
      case "audio/opus":
      case "audio/x-opus+ogg":
      default:
        return "ogg";
    }
  }

  private isToneTag(value: string): value is RuntimeTtsRequest["toneTag"] {
    return PERSAI_RUNTIME_TTS_TONE_TAGS.includes(value as RuntimeTtsRequest["toneTag"]);
  }

  private isDeliveryKind(value: string): value is PersaiRuntimeTtsDeliveryKind {
    return PERSAI_RUNTIME_TTS_DELIVERY_KINDS.includes(value as PersaiRuntimeTtsDeliveryKind);
  }

  private isProviderId(value: string): value is PersaiRuntimeTtsProviderId {
    return PERSAI_RUNTIME_TTS_PROVIDER_IDS.includes(value as PersaiRuntimeTtsProviderId);
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
