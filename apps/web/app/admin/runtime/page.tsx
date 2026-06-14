"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Loader2, Save, Server } from "lucide-react";
import type {
  AdminRuntimeProviderSettingsRequest,
  AdminRuntimeProviderSettingsState,
  ManagedRuntimeCatalogProvider,
  ManagedRuntimeProvider,
  RuntimeVideoAspectRatio,
  RuntimeVideoGenerateSize,
  RuntimeProviderModelCatalogByProviderState,
  RuntimeProviderModelProfileState,
  RuntimeVideoModelKind
} from "@persai/contracts";
import { applyDerivedTokenMeteredWeights, formatTokenMeteredWeight } from "@persai/types";
import {
  getAdminRuntimeProviderSettings,
  putAdminRuntimeProviderSettings
} from "@/app/app/assistant-api-client";
import { InboundSafetyPolicyPanel } from "./inbound-safety-policy-panel";
import { RuntimeCard, RuntimeFold } from "./runtime-layout";
import { cn } from "@/app/lib/utils";

const Fold = RuntimeFold;
const Card = RuntimeCard;

type RuntimeProviderBillingModeState = RuntimeProviderModelProfileState["billingMode"];
type RuntimeProviderPriceMetadataState = RuntimeProviderModelProfileState["providerPriceMetadata"];
type RuntimeProviderModelProfileForMode<M extends RuntimeProviderBillingModeState> = Extract<
  RuntimeProviderModelProfileState,
  { billingMode: M }
>;
type RuntimeProviderPriceMetadataMerger = (
  current: RuntimeProviderPriceMetadataState
) => RuntimeProviderPriceMetadataState;
type RuntimeVideoDurationConstraintState =
  | { kind: "allowed_list"; values: number[] }
  | {
      kind: "range";
      min: number;
      max: number;
      step: number | null;
      preferredValues: number[] | null;
    };
type RuntimeVideoAspectRatioOptionState = {
  aspectRatio: RuntimeVideoAspectRatio;
  size: RuntimeVideoGenerateSize;
  providerValue: string | null;
};
type RuntimeVideoModelParametersState = {
  duration: RuntimeVideoDurationConstraintState;
  aspectRatios: RuntimeVideoAspectRatioOptionState[];
  referenceImageSupported: boolean;
  audioCapabilities: ("silent" | "provider_native_audio" | "voice_control")[];
  inputCapabilities: ("text" | "single_reference_image" | "multi_image" | "omni")[];
  providerParameters: {
    mode?: string | null;
    sound?: "on" | "off" | null;
    audio?: boolean | null;
    resolution?: "720p" | "1080p" | "4k" | null;
    aspectRatio?: "auto" | "16:9" | "9:16" | "1:1" | "4:5" | "5:4" | null;
    engine?: "avatar_iv" | "avatar_v" | null;
  } | null;
};
type RuntimeProviderModelProfileWithVideo = RuntimeProviderModelProfileState & {
  videoModelParameters?: RuntimeVideoModelParametersState | null;
};
type HeyGenTalkingAvatarProviderParameters = {
  resolution: (typeof HEYGEN_TALKING_AVATAR_RESOLUTIONS)[number];
  aspectRatio: (typeof HEYGEN_TALKING_AVATAR_ASPECT_RATIOS)[number];
  engine: (typeof HEYGEN_TALKING_AVATAR_ENGINES)[number];
};

const ACTIVE_VIDEO_AUDIO_CAPABILITIES = [
  "silent",
  "provider_native_audio",
  "voice_control"
] as const satisfies RuntimeVideoModelParametersState["audioCapabilities"];
const ACTIVE_VIDEO_INPUT_CAPABILITIES = [
  "text",
  "single_reference_image",
  "multi_image"
] as const satisfies Exclude<RuntimeVideoModelParametersState["inputCapabilities"], "omni">;
const HEYGEN_TALKING_AVATAR_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
const HEYGEN_TALKING_AVATAR_ASPECT_RATIOS = ["auto", "16:9", "9:16", "1:1", "4:5", "5:4"] as const;
const HEYGEN_TALKING_AVATAR_ENGINES = ["avatar_v", "avatar_iv"] as const;

/** Accepts `0.075` and `0,075` while typing; incomplete fragments like `0.` stay in the field until blur. */
export function normalizeDecimalInputText(raw: string): string {
  return raw.trim().replace(/\s+/g, "").replace(",", ".");
}

export function parseDecimalInputText(raw: string): number | null {
  const normalized = normalizeDecimalInputText(raw);
  if (normalized.length === 0) {
    return null;
  }
  if (normalized === "." || normalized.endsWith(".")) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDecimalInputValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const asString = String(value);
  if (asString.includes("e") || asString.includes("E")) {
    return value.toFixed(6).replace(/\.?0+$/, "");
  }
  return asString;
}

export function parseRouterTriggerTerms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\r\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function formatRouterTriggerTerms(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

export function buildRouterPrecheckRuleOverrides(input: {
  continueTermsText: string;
  retrievalTermsText: string;
  reasoningTermsText: string;
  premiumTermsText: string;
  toolTermsText: string;
  productPriorityTermsText: string;
  webPriorityTermsText: string;
  personalPriorityTermsText: string;
}): AdminRuntimeProviderSettingsRequest["routerPolicy"]["precheckRuleOverrides"] {
  const overrides = {
    continueTerms: parseRouterTriggerTerms(input.continueTermsText),
    retrievalTerms: parseRouterTriggerTerms(input.retrievalTermsText),
    reasoningTerms: parseRouterTriggerTerms(input.reasoningTermsText),
    premiumTerms: parseRouterTriggerTerms(input.premiumTermsText),
    toolTerms: parseRouterTriggerTerms(input.toolTermsText),
    productPriorityTerms: parseRouterTriggerTerms(input.productPriorityTermsText),
    webPriorityTerms: parseRouterTriggerTerms(input.webPriorityTermsText),
    personalPriorityTerms: parseRouterTriggerTerms(input.personalPriorityTermsText)
  };
  return Object.values(overrides).some((entries) => entries.length > 0) ? overrides : null;
}

function parseBoundedIntegerField(
  value: string,
  label: string,
  bounds: { min: number; max: number }
): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a whole number.`);
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed < bounds.min || parsed > bounds.max) {
    throw new Error(`${label} must be between ${String(bounds.min)} and ${String(bounds.max)}.`);
  }
  return parsed;
}

export function buildSkillRoutingPolicyInput(input: {
  initialCheckUserMessageIndexText: string;
  backgroundRecheckIntervalMessagesText: string;
}): AdminRuntimeProviderSettingsRequest["skillRoutingPolicy"] {
  return {
    initialCheckUserMessageIndex: parseBoundedIntegerField(
      input.initialCheckUserMessageIndexText,
      "Initial background skill check",
      { min: 1, max: 20 }
    ),
    backgroundRecheckIntervalMessages: parseBoundedIntegerField(
      input.backgroundRecheckIntervalMessagesText,
      "Background skill recheck interval",
      { min: 1, max: 50 }
    )
  };
}

function modeLabel(mode: AdminRuntimeProviderSettingsState["mode"]): string {
  return mode === "global_settings" ? "Global settings" : "Unconfigured default";
}

function providerLabel(provider: ManagedRuntimeProvider | ManagedRuntimeCatalogProvider): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "runway":
      return "Runway";
    case "kling":
      return "Kling";
    case "heygen":
      return "HeyGen";
  }
}

const MANAGED_CATALOG_PROVIDERS = [
  "openai",
  "anthropic",
  "runway",
  "kling",
  "heygen"
] as const satisfies readonly ManagedRuntimeCatalogProvider[];

function isVideoOnlyCatalogProvider(provider: ManagedRuntimeCatalogProvider): boolean {
  return provider === "runway" || provider === "kling" || provider === "heygen";
}

function createDefaultVideoModelParameters(
  provider: ManagedRuntimeCatalogProvider | null
): RuntimeVideoModelParametersState {
  if (provider === "heygen") {
    return {
      // Compatibility envelope only. HeyGen duration is derived from
      // speechText; quality/aspect/engine live in providerParameters below.
      duration: { kind: "range", min: 1, max: 600, step: 1, preferredValues: [15, 30, 60] },
      aspectRatios: [
        { aspectRatio: "16:9", size: "1280x720", providerValue: "16:9" },
        { aspectRatio: "9:16", size: "720x1280", providerValue: "9:16" }
      ],
      referenceImageSupported: true,
      audioCapabilities: ["silent"],
      inputCapabilities: ["text", "single_reference_image"],
      providerParameters: {
        resolution: "1080p",
        aspectRatio: "auto",
        engine: "avatar_v"
      }
    };
  }
  if (provider === "kling") {
    return {
      duration: { kind: "range", min: 3, max: 15, step: 1, preferredValues: [4, 8, 12] },
      aspectRatios: [
        { aspectRatio: "16:9", size: "1280x720", providerValue: "16:9" },
        { aspectRatio: "9:16", size: "720x1280", providerValue: "9:16" }
      ],
      referenceImageSupported: true,
      audioCapabilities: ["silent", "provider_native_audio", "voice_control"],
      inputCapabilities: ["text", "single_reference_image", "multi_image"],
      providerParameters: { mode: "pro", sound: "off" }
    };
  }
  return {
    duration: { kind: "allowed_list", values: [5, 8, 10] },
    aspectRatios: [
      { aspectRatio: "16:9", size: "1280x720", providerValue: "1280:720" },
      { aspectRatio: "9:16", size: "720x1280", providerValue: "720:1280" }
    ],
    referenceImageSupported: true,
    audioCapabilities: ["silent"],
    inputCapabilities: ["text", "single_reference_image"],
    providerParameters: null
  };
}

function compactVideoProviderParameters(
  value: RuntimeVideoModelParametersState["providerParameters"]
): RuntimeVideoModelParametersState["providerParameters"] {
  if (value === null) {
    return null;
  }
  const mode = value.mode?.trim() ? value.mode.trim() : null;
  const sound = value.sound ?? null;
  const audio = typeof value.audio === "boolean" ? value.audio : null;
  const resolution = HEYGEN_TALKING_AVATAR_RESOLUTIONS.includes(
    value.resolution as (typeof HEYGEN_TALKING_AVATAR_RESOLUTIONS)[number]
  )
    ? value.resolution
    : null;
  const aspectRatio = HEYGEN_TALKING_AVATAR_ASPECT_RATIOS.includes(
    value.aspectRatio as (typeof HEYGEN_TALKING_AVATAR_ASPECT_RATIOS)[number]
  )
    ? value.aspectRatio
    : null;
  const engine = HEYGEN_TALKING_AVATAR_ENGINES.includes(
    value.engine as (typeof HEYGEN_TALKING_AVATAR_ENGINES)[number]
  )
    ? value.engine
    : null;
  return mode === null &&
    sound === null &&
    audio === null &&
    resolution === null &&
    aspectRatio === null &&
    engine === null
    ? null
    : {
        ...(mode === null ? {} : { mode }),
        ...(sound === null ? {} : { sound }),
        ...(audio === null ? {} : { audio }),
        ...(resolution === null ? {} : { resolution }),
        ...(aspectRatio === null ? {} : { aspectRatio }),
        ...(engine === null ? {} : { engine })
      };
}

export function normalizeVideoModelParametersForSlice2(
  value: RuntimeVideoModelParametersState
): RuntimeVideoModelParametersState {
  const audioCapabilities = new Set<RuntimeVideoModelParametersState["audioCapabilities"][number]>(
    value.audioCapabilities.filter(
      (entry): entry is (typeof ACTIVE_VIDEO_AUDIO_CAPABILITIES)[number] =>
        ACTIVE_VIDEO_AUDIO_CAPABILITIES.includes(entry)
    )
  );
  audioCapabilities.add("silent");
  if (!audioCapabilities.has("provider_native_audio")) {
    audioCapabilities.delete("voice_control");
  }

  const inputCapabilities = new Set<
    Extract<
      RuntimeVideoModelParametersState["inputCapabilities"][number],
      "text" | "single_reference_image" | "multi_image"
    >
  >(
    value.inputCapabilities.filter(
      (entry): entry is (typeof ACTIVE_VIDEO_INPUT_CAPABILITIES)[number] =>
        ACTIVE_VIDEO_INPUT_CAPABILITIES.includes(
          entry as (typeof ACTIVE_VIDEO_INPUT_CAPABILITIES)[number]
        )
    )
  );
  inputCapabilities.add("text");
  if (value.referenceImageSupported) {
    inputCapabilities.add("single_reference_image");
  } else {
    inputCapabilities.delete("single_reference_image");
    inputCapabilities.delete("multi_image");
  }

  let providerParameters = compactVideoProviderParameters(value.providerParameters);
  if (providerParameters?.sound === "on" && !audioCapabilities.has("provider_native_audio")) {
    providerParameters = compactVideoProviderParameters({
      ...providerParameters,
      sound: "off"
    });
  }
  if (providerParameters?.audio === true && !audioCapabilities.has("provider_native_audio")) {
    providerParameters = compactVideoProviderParameters({
      ...providerParameters,
      audio: false
    });
  }

  return {
    ...value,
    audioCapabilities: Array.from(audioCapabilities),
    inputCapabilities: Array.from(inputCapabilities),
    providerParameters
  };
}

export function validateVideoModelParametersForSlice2(
  value: RuntimeVideoModelParametersState
): string | null {
  const audioCapabilities = new Set(value.audioCapabilities);
  const inputCapabilities = new Set(value.inputCapabilities);
  if (inputCapabilities.has("omni")) {
    return 'Omni input is deferred and unsupported in ADR-107 Slice 2. Remove "omni" before saving.';
  }
  if (audioCapabilities.has("voice_control") && !audioCapabilities.has("provider_native_audio")) {
    return '"voice_control" requires "provider_native_audio".';
  }
  if (inputCapabilities.has("single_reference_image") !== value.referenceImageSupported) {
    return '"single_reference_image" must match the Reference image supported setting.';
  }
  if (inputCapabilities.has("multi_image") && !value.referenceImageSupported) {
    return '"multi_image" requires Reference image supported.';
  }
  if (value.providerParameters?.sound === "on" && !audioCapabilities.has("provider_native_audio")) {
    return 'providerParameters.sound="on" requires "provider_native_audio".';
  }
  if (value.providerParameters?.audio === true && !audioCapabilities.has("provider_native_audio")) {
    return 'providerParameters.audio=true requires "provider_native_audio".';
  }
  return null;
}

function normalizeCatalogForSlice2(
  catalog: RuntimeProviderModelCatalogByProviderState
): RuntimeProviderModelCatalogByProviderState {
  const normalizeProviderCatalog = (provider: ManagedRuntimeCatalogProvider) => ({
    models: catalog[provider].models.map((profile) => {
      if (!profile.capabilities.includes("video")) {
        return profile;
      }
      const withVideo = profile as RuntimeProviderModelProfileWithVideo;
      return {
        ...profile,
        videoModelParameters: normalizeVideoModelParametersForSlice2(
          withVideo.videoModelParameters ?? createDefaultVideoModelParameters(provider)
        )
      };
    })
  });
  return {
    openai: normalizeProviderCatalog("openai"),
    anthropic: normalizeProviderCatalog("anthropic"),
    runway: normalizeProviderCatalog("runway"),
    kling: normalizeProviderCatalog("kling"),
    heygen: normalizeProviderCatalog("heygen")
  };
}

function assertCatalogSupportsSlice2(catalog: RuntimeProviderModelCatalogByProviderState): void {
  for (const provider of MANAGED_CATALOG_PROVIDERS) {
    for (const profile of catalog[provider].models) {
      if (!profile.capabilities.includes("video")) {
        continue;
      }
      const message = validateVideoModelParametersForSlice2(
        (profile as RuntimeProviderModelProfileWithVideo).videoModelParameters ??
          createDefaultVideoModelParameters(provider)
      );
      if (message !== null) {
        throw new Error(`Video model "${profile.model || "draft"}": ${message}`);
      }
    }
  }
}

function withVideoModelParameters(
  profile: RuntimeProviderModelProfileState,
  provider: ManagedRuntimeCatalogProvider | null
): RuntimeProviderModelProfileState {
  const profileWithVideo = profile as RuntimeProviderModelProfileWithVideo;
  if (!profile.capabilities.includes("video")) {
    return {
      ...profile,
      videoModelParameters: null
    } as unknown as RuntimeProviderModelProfileState;
  }
  return {
    ...profile,
    videoModelParameters:
      profileWithVideo.videoModelParameters ?? createDefaultVideoModelParameters(provider)
  } as unknown as RuntimeProviderModelProfileState;
}

function clampCatalogIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(index)), length - 1);
}

export function formatCatalogEntryLabel(
  profile: RuntimeProviderModelProfileState,
  index: number
): string {
  const key = profile.model.trim() || `Draft ${index + 1}`;
  const label = profile.displayLabel?.trim();
  const status = profile.active ? "active" : "inactive";
  const parts = [key];
  if (label && label !== key) {
    parts.push(label);
  }
  parts.push(status, profile.billingMode);
  return parts.join(" · ");
}

function createDefaultProviderPriceMetadata(
  billingMode: "token_metered"
): RuntimeProviderModelProfileForMode<"token_metered">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: "time_metered"
): RuntimeProviderModelProfileForMode<"time_metered">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: "text_chars_metered"
): RuntimeProviderModelProfileForMode<"text_chars_metered">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: "fixed_operation"
): RuntimeProviderModelProfileForMode<"fixed_operation">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: "tiered_operation"
): RuntimeProviderModelProfileForMode<"tiered_operation">["providerPriceMetadata"];
function createDefaultProviderPriceMetadata(
  billingMode: RuntimeProviderBillingModeState
): RuntimeProviderPriceMetadataState;
function createDefaultProviderPriceMetadata(
  billingMode: RuntimeProviderBillingModeState
): RuntimeProviderPriceMetadataState {
  switch (billingMode) {
    case "token_metered":
      return {
        currency: "USD",
        tokenPricing: {
          inputPer1M: 0,
          cacheCreationInputPer1M: 0,
          cachedInputPer1M: 0,
          outputPer1M: 0
        }
      };
    case "time_metered":
      return {
        currency: "USD",
        timePricing: {
          unit: "minute",
          pricePerUnit: 0
        }
      };
    case "text_chars_metered":
      return {
        currency: "USD",
        textCharsPricing: {
          pricePer1MChars: 0
        }
      };
    case "fixed_operation":
      return {
        currency: "USD",
        fixedOperationPricing: {
          unitLabel: null,
          pricePerOperation: 0
        }
      };
    case "tiered_operation":
      return {
        currency: "USD",
        tieredOperationPricing: {
          unitLabel: null,
          tiers: []
        }
      };
  }
}

function replacePriceMetadata(
  profile: RuntimeProviderModelProfileState,
  providerPriceMetadata: RuntimeProviderPriceMetadataState
): RuntimeProviderModelProfileState {
  switch (profile.billingMode) {
    case "token_metered":
      return {
        ...profile,
        providerPriceMetadata:
          "tokenPricing" in providerPriceMetadata
            ? providerPriceMetadata
            : createDefaultProviderPriceMetadata("token_metered")
      };
    case "time_metered":
      return {
        ...profile,
        providerPriceMetadata:
          "timePricing" in providerPriceMetadata
            ? providerPriceMetadata
            : createDefaultProviderPriceMetadata("time_metered")
      };
    case "text_chars_metered":
      return {
        ...profile,
        providerPriceMetadata:
          "textCharsPricing" in providerPriceMetadata
            ? providerPriceMetadata
            : createDefaultProviderPriceMetadata("text_chars_metered")
      };
    case "fixed_operation":
      return {
        ...profile,
        providerPriceMetadata:
          "fixedOperationPricing" in providerPriceMetadata
            ? providerPriceMetadata
            : createDefaultProviderPriceMetadata("fixed_operation")
      };
    case "tiered_operation":
      return {
        ...profile,
        providerPriceMetadata:
          "tieredOperationPricing" in providerPriceMetadata
            ? providerPriceMetadata
            : createDefaultProviderPriceMetadata("tiered_operation")
      };
  }
}

function cloneProviderPriceMetadata(
  profile: RuntimeProviderModelProfileForMode<"token_metered">
): RuntimeProviderModelProfileForMode<"token_metered">["providerPriceMetadata"];
function cloneProviderPriceMetadata(
  profile: RuntimeProviderModelProfileForMode<"time_metered">
): RuntimeProviderModelProfileForMode<"time_metered">["providerPriceMetadata"];
function cloneProviderPriceMetadata(
  profile: RuntimeProviderModelProfileForMode<"text_chars_metered">
): RuntimeProviderModelProfileForMode<"text_chars_metered">["providerPriceMetadata"];
function cloneProviderPriceMetadata(
  profile: RuntimeProviderModelProfileForMode<"fixed_operation">
): RuntimeProviderModelProfileForMode<"fixed_operation">["providerPriceMetadata"];
function cloneProviderPriceMetadata(
  profile: RuntimeProviderModelProfileForMode<"tiered_operation">
): RuntimeProviderModelProfileForMode<"tiered_operation">["providerPriceMetadata"];
function cloneProviderPriceMetadata(
  profile: RuntimeProviderModelProfileState
): RuntimeProviderPriceMetadataState {
  switch (profile.billingMode) {
    case "token_metered":
      return {
        currency: profile.providerPriceMetadata.currency,
        tokenPricing: { ...profile.providerPriceMetadata.tokenPricing }
      };
    case "time_metered":
      return {
        currency: profile.providerPriceMetadata.currency,
        timePricing: { ...profile.providerPriceMetadata.timePricing }
      };
    case "text_chars_metered":
      return {
        currency: profile.providerPriceMetadata.currency,
        textCharsPricing: { ...profile.providerPriceMetadata.textCharsPricing }
      };
    case "fixed_operation":
      return {
        currency: profile.providerPriceMetadata.currency,
        fixedOperationPricing: { ...profile.providerPriceMetadata.fixedOperationPricing }
      };
    case "tiered_operation":
      return {
        currency: profile.providerPriceMetadata.currency,
        tieredOperationPricing: {
          ...profile.providerPriceMetadata.tieredOperationPricing,
          tiers: profile.providerPriceMetadata.tieredOperationPricing.tiers.map((tier) => ({
            ...tier
          }))
        }
      };
  }
}

function createInactiveDuplicateProfile(
  profile: RuntimeProviderModelProfileState
): RuntimeProviderModelProfileState {
  switch (profile.billingMode) {
    case "token_metered":
      return {
        ...profile,
        active: false,
        effectiveFrom: null,
        effectiveTo: null,
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
    case "time_metered":
      return {
        ...profile,
        active: false,
        effectiveFrom: null,
        effectiveTo: null,
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
    case "text_chars_metered":
      return {
        ...profile,
        active: false,
        effectiveFrom: null,
        effectiveTo: null,
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
    case "fixed_operation":
      return {
        ...profile,
        active: false,
        effectiveFrom: null,
        effectiveTo: null,
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
    case "tiered_operation":
      return {
        ...profile,
        active: false,
        effectiveFrom: null,
        effectiveTo: null,
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
  }
}

function createArchivedProfile(
  profile: RuntimeProviderModelProfileState
): RuntimeProviderModelProfileState {
  switch (profile.billingMode) {
    case "token_metered":
      return {
        ...profile,
        active: false,
        effectiveTo: profile.effectiveTo ?? createArchiveTimestamp(),
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
    case "time_metered":
      return {
        ...profile,
        active: false,
        effectiveTo: profile.effectiveTo ?? createArchiveTimestamp(),
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
    case "text_chars_metered":
      return {
        ...profile,
        active: false,
        effectiveTo: profile.effectiveTo ?? createArchiveTimestamp(),
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
    case "fixed_operation":
      return {
        ...profile,
        active: false,
        effectiveTo: profile.effectiveTo ?? createArchiveTimestamp(),
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
    case "tiered_operation":
      return {
        ...profile,
        active: false,
        effectiveTo: profile.effectiveTo ?? createArchiveTimestamp(),
        providerPriceMetadata: cloneProviderPriceMetadata(profile)
      };
  }
}

function createArchiveTimestamp(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  ).toISOString();
}

function createEmptyCatalog(): RuntimeProviderModelCatalogByProviderState {
  return {
    openai: { models: [] },
    anthropic: { models: [] },
    runway: { models: [] },
    kling: { models: [] },
    heygen: { models: [] }
  };
}

function inferBillingModeForCapabilities(
  capabilities: RuntimeProviderModelProfileState["capabilities"]
): RuntimeProviderModelProfileState["billingMode"] {
  if (capabilities.includes("chat")) {
    return "token_metered";
  }
  if (capabilities.includes("speech_to_text")) {
    return "time_metered";
  }
  if (capabilities.includes("text_to_speech")) {
    return "text_chars_metered";
  }
  if (capabilities.includes("video")) {
    return "time_metered";
  }
  return "fixed_operation";
}

function kindForProvider(provider: ManagedRuntimeCatalogProvider | null): RuntimeVideoModelKind {
  return provider === "heygen" ? "talking_avatar" : "cinematic";
}

function createModelProfile(
  capability: RuntimeProviderModelProfileState["capabilities"][number] = "chat",
  provider: ManagedRuntimeCatalogProvider | null = null
): RuntimeProviderModelProfileState {
  const capabilities = [capability];
  const billingMode = inferBillingModeForCapabilities(capabilities);
  const base = {
    model: "",
    capabilities,
    kind: kindForProvider(provider),
    active: true,
    effectiveFrom: null,
    effectiveTo: null,
    inputTokenWeight: 1,
    cachedInputTokenWeight: 1,
    outputTokenWeight: 1,
    displayLabel: null,
    notes: null
  };
  switch (billingMode) {
    case "token_metered":
      return withVideoModelParameters(
        {
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("token_metered")
        },
        provider
      );
    case "time_metered":
      return withVideoModelParameters(
        {
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("time_metered")
        },
        provider
      );
    case "text_chars_metered":
      return withVideoModelParameters(
        {
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("text_chars_metered")
        },
        provider
      );
    case "fixed_operation":
      return withVideoModelParameters(
        {
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("fixed_operation")
        },
        provider
      );
    case "tiered_operation":
      return withVideoModelParameters(
        {
          ...base,
          billingMode,
          providerPriceMetadata: createDefaultProviderPriceMetadata("tiered_operation")
        },
        provider
      );
  }
}

function rebuildProfileForBillingMode(
  profile: RuntimeProviderModelProfileState,
  billingMode: RuntimeProviderBillingModeState
): RuntimeProviderModelProfileState {
  const base = {
    model: profile.model,
    capabilities: profile.capabilities,
    kind: profile.kind,
    active: profile.active,
    effectiveFrom: profile.effectiveFrom,
    effectiveTo: profile.effectiveTo,
    inputTokenWeight: profile.inputTokenWeight,
    cachedInputTokenWeight: profile.cachedInputTokenWeight,
    outputTokenWeight: profile.outputTokenWeight,
    displayLabel: profile.displayLabel,
    notes: profile.notes,
    videoModelParameters:
      (profile as RuntimeProviderModelProfileWithVideo).videoModelParameters ?? null
  };
  switch (billingMode) {
    case "token_metered":
      return {
        ...base,
        billingMode,
        providerPriceMetadata: {
          ...createDefaultProviderPriceMetadata("token_metered"),
          currency: profile.providerPriceMetadata.currency
        }
      };
    case "time_metered":
      return {
        ...base,
        billingMode,
        providerPriceMetadata: {
          ...createDefaultProviderPriceMetadata("time_metered"),
          currency: profile.providerPriceMetadata.currency
        }
      };
    case "text_chars_metered":
      return {
        ...base,
        billingMode,
        providerPriceMetadata: {
          ...createDefaultProviderPriceMetadata("text_chars_metered"),
          currency: profile.providerPriceMetadata.currency
        }
      };
    case "fixed_operation":
      return {
        ...base,
        billingMode,
        providerPriceMetadata: {
          ...createDefaultProviderPriceMetadata("fixed_operation"),
          currency: profile.providerPriceMetadata.currency
        }
      };
    case "tiered_operation":
      return {
        ...base,
        billingMode,
        providerPriceMetadata: {
          ...createDefaultProviderPriceMetadata("tiered_operation"),
          currency: profile.providerPriceMetadata.currency
        }
      };
  }
}

function withDerivedCatalogWeights(
  catalog: RuntimeProviderModelCatalogByProviderState
): RuntimeProviderModelCatalogByProviderState {
  return {
    openai: {
      models: catalog.openai.models.map((profile) =>
        applyDerivedTokenMeteredWeights(withVideoModelParameters(profile, "openai"))
      )
    },
    anthropic: {
      models: catalog.anthropic.models.map((profile) =>
        applyDerivedTokenMeteredWeights(withVideoModelParameters(profile, "anthropic"))
      )
    },
    runway: {
      models: catalog.runway.models.map((profile) =>
        applyDerivedTokenMeteredWeights(withVideoModelParameters(profile, "runway"))
      )
    },
    kling: {
      models: catalog.kling.models.map((profile) =>
        applyDerivedTokenMeteredWeights(withVideoModelParameters(profile, "kling"))
      )
    },
    heygen: {
      models: catalog.heygen.models.map((profile) =>
        applyDerivedTokenMeteredWeights(withVideoModelParameters(profile, "heygen"))
      )
    }
  };
}

function buildCatalogFallback(
  availableModelsByProvider: AdminRuntimeProviderSettingsState["availableModelsByProvider"]
): RuntimeProviderModelCatalogByProviderState {
  return {
    openai: {
      models: (availableModelsByProvider?.openai ?? []).map((model) => ({
        ...createModelProfile("chat"),
        model
      }))
    },
    anthropic: {
      models: (availableModelsByProvider?.anthropic ?? []).map((model) => ({
        ...createModelProfile("chat"),
        model
      }))
    },
    runway: {
      models: []
    },
    kling: {
      models: []
    },
    heygen: {
      models: []
    }
  };
}

function findModelProfile(
  profiles: RuntimeProviderModelProfileState[],
  model: string
): RuntimeProviderModelProfileState | null {
  const normalized = model.trim();
  if (normalized.length === 0) {
    return null;
  }
  return (
    profiles.find((profile) => profile.model === normalized && profile.active) ??
    profiles.find((profile) => profile.model === normalized) ??
    null
  );
}

function deriveChatModelOptions(
  catalog: RuntimeProviderModelCatalogByProviderState,
  provider: ManagedRuntimeProvider
): string[] {
  const deduped = new Set<string>();
  for (const profile of catalog[provider].models) {
    const model = profile.model.trim();
    if (!profile.active || !profile.capabilities.includes("chat") || model.length === 0) {
      continue;
    }
    deduped.add(model);
  }
  return Array.from(deduped);
}

function deriveAvailableModelsByProvider(
  catalog: RuntimeProviderModelCatalogByProviderState
): AdminRuntimeProviderSettingsRequest["availableModelsByProvider"] {
  return {
    openai: deriveChatModelOptions(catalog, "openai"),
    anthropic: deriveChatModelOptions(catalog, "anthropic")
  };
}

function modelProfileCostLabel(profile: RuntimeProviderModelProfileState | null): string {
  if (profile === null) {
    return "No active model profile selected.";
  }
  return `${profile.billingMode} • input ${profile.inputTokenWeight} / cached ${profile.cachedInputTokenWeight} / output ${profile.outputTokenWeight}`;
}

function formatIsoDateForInput(value: string | null): string {
  return value === null ? "" : value.slice(0, 10);
}

function parseDateInputValue(value: string): string | null {
  if (value.trim().length === 0) {
    return null;
  }
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function formatJsonField(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJsonField<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

export default function AdminRuntimePage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<AdminRuntimeProviderSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [primaryProvider, setPrimaryProvider] = useState<ManagedRuntimeProvider>("openai");
  const [primaryModel, setPrimaryModel] = useState("");
  const [fallbackProvider, setFallbackProvider] = useState<ManagedRuntimeProvider>("openai");
  const [fallbackModel, setFallbackModel] = useState("");
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [routingFastModelKey, setRoutingFastModelKey] = useState("");
  const [routerEnabled, setRouterEnabled] = useState(false);
  const [routerMode, setRouterMode] =
    useState<AdminRuntimeProviderSettingsState["routerPolicy"]["mode"]>("shadow");
  const [routerFallbackMode, setRouterFallbackMode] =
    useState<AdminRuntimeProviderSettingsState["routerPolicy"]["classifierFailureFallbackMode"]>(
      "normal"
    );
  const [routerClarifyOnMissingContext, setRouterClarifyOnMissingContext] = useState(true);
  const [analyzeUploadsOnB2cUpload, setAnalyzeUploadsOnB2cUpload] = useState(false);
  const [routerContinueTermsText, setRouterContinueTermsText] = useState("");
  const [routerRetrievalTermsText, setRouterRetrievalTermsText] = useState("");
  const [routerReasoningTermsText, setRouterReasoningTermsText] = useState("");
  const [routerPremiumTermsText, setRouterPremiumTermsText] = useState("");
  const [routerToolTermsText, setRouterToolTermsText] = useState("");
  const [routerProductPriorityTermsText, setRouterProductPriorityTermsText] = useState("");
  const [routerWebPriorityTermsText, setRouterWebPriorityTermsText] = useState("");
  const [routerPersonalPriorityTermsText, setRouterPersonalPriorityTermsText] = useState("");
  const [
    skillRoutingInitialCheckUserMessageIndexText,
    setSkillRoutingInitialCheckUserMessageIndexText
  ] = useState("3");
  const [
    skillRoutingBackgroundRecheckIntervalMessagesText,
    setSkillRoutingBackgroundRecheckIntervalMessagesText
  ] = useState("5");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [vcoinExchangeRateText, setVcoinExchangeRateText] = useState("20");
  const [heygenPersonaWorkspaceLimitText, setHeygenPersonaWorkspaceLimitText] = useState("10");
  const [heygenPersonaCreationVcoinText, setHeygenPersonaCreationVcoinText] = useState("20");
  const modelCatalogRef = useRef<RuntimeProviderModelCatalogByProviderState>(createEmptyCatalog());
  const [modelCatalogByProvider, setModelCatalogByProvider] =
    useState<RuntimeProviderModelCatalogByProviderState>(createEmptyCatalog());
  const [selectedCatalogIndexByProvider, setSelectedCatalogIndexByProvider] = useState<
    Record<ManagedRuntimeCatalogProvider, number>
  >({ openai: 0, anthropic: 0, runway: 0, kling: 0, heygen: 0 });
  const [newCatalogCapabilityByProvider, setNewCatalogCapabilityByProvider] = useState<
    Record<ManagedRuntimeCatalogProvider, RuntimeProviderModelProfileState["capabilities"][number]>
  >({ openai: "chat", anthropic: "chat", runway: "video", kling: "video", heygen: "video" });
  modelCatalogRef.current = modelCatalogByProvider;

  useEffect(() => {
    setSelectedCatalogIndexByProvider((current) => ({
      openai: clampCatalogIndex(current.openai, modelCatalogByProvider.openai.models.length),
      anthropic: clampCatalogIndex(
        current.anthropic,
        modelCatalogByProvider.anthropic.models.length
      ),
      runway: clampCatalogIndex(current.runway, modelCatalogByProvider.runway.models.length),
      kling: clampCatalogIndex(current.kling, modelCatalogByProvider.kling.models.length),
      heygen: clampCatalogIndex(current.heygen, modelCatalogByProvider.heygen.models.length)
    }));
  }, [modelCatalogByProvider]);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const res = await getAdminRuntimeProviderSettings(token);
      setSettings(res);
      if (res.primary) {
        setPrimaryProvider(res.primary.provider);
        setPrimaryModel(res.primary.model);
      }
      if (res.fallback) {
        setFallbackEnabled(true);
        setFallbackProvider(res.fallback.provider);
        setFallbackModel(res.fallback.model);
      } else {
        setFallbackEnabled(false);
        setFallbackModel("");
      }
      setRoutingFastModelKey(res.routingFastModelKey ?? "");
      setRouterEnabled(res.routerPolicy.enabled);
      setRouterMode(res.routerPolicy.mode);
      setRouterFallbackMode(res.routerPolicy.classifierFailureFallbackMode);
      setRouterClarifyOnMissingContext(res.routerPolicy.clarifyOnMissingContext);
      setAnalyzeUploadsOnB2cUpload(res.routerPolicy.analyzeUploadsOnB2cUpload);
      setRouterContinueTermsText(
        formatRouterTriggerTerms(res.routerPolicy.precheckRuleOverrides?.continueTerms)
      );
      setRouterRetrievalTermsText(
        formatRouterTriggerTerms(res.routerPolicy.precheckRuleOverrides?.retrievalTerms)
      );
      setRouterReasoningTermsText(
        formatRouterTriggerTerms(res.routerPolicy.precheckRuleOverrides?.reasoningTerms)
      );
      setRouterPremiumTermsText(
        formatRouterTriggerTerms(res.routerPolicy.precheckRuleOverrides?.premiumTerms)
      );
      setRouterToolTermsText(
        formatRouterTriggerTerms(res.routerPolicy.precheckRuleOverrides?.toolTerms)
      );
      setRouterProductPriorityTermsText(
        formatRouterTriggerTerms(res.routerPolicy.precheckRuleOverrides?.productPriorityTerms)
      );
      setRouterWebPriorityTermsText(
        formatRouterTriggerTerms(res.routerPolicy.precheckRuleOverrides?.webPriorityTerms)
      );
      setRouterPersonalPriorityTermsText(
        formatRouterTriggerTerms(res.routerPolicy.precheckRuleOverrides?.personalPriorityTerms)
      );
      setSkillRoutingInitialCheckUserMessageIndexText(
        String(res.skillRoutingPolicy.initialCheckUserMessageIndex)
      );
      setSkillRoutingBackgroundRecheckIntervalMessagesText(
        String(res.skillRoutingPolicy.backgroundRecheckIntervalMessages)
      );
      setModelCatalogByProvider(
        withDerivedCatalogWeights(
          normalizeCatalogForSlice2(
            res.availableModelCatalogByProvider ??
              buildCatalogFallback(res.availableModelsByProvider)
          )
        )
      );
      setVcoinExchangeRateText(String(res.vcoinExchangeRate ?? 20));
      setHeygenPersonaWorkspaceLimitText(String(res.heygenPersonaWorkspaceLimit ?? 10));
      setHeygenPersonaCreationVcoinText(String(res.heygenPersonaCreationVcoin ?? 20));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load runtime settings.");
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableModelsForSelect = {
    openai: deriveChatModelOptions(modelCatalogByProvider, "openai"),
    anthropic: deriveChatModelOptions(modelCatalogByProvider, "anthropic")
  } satisfies AdminRuntimeProviderSettingsRequest["availableModelsByProvider"];
  const primaryModelProfile = findModelProfile(
    modelCatalogByProvider[primaryProvider].models,
    primaryModel
  );
  const fallbackModelProfile = fallbackEnabled
    ? findModelProfile(modelCatalogByProvider[fallbackProvider].models, fallbackModel)
    : null;
  const routingFastModelProfile = findModelProfile(
    modelCatalogByProvider[primaryProvider].models,
    routingFastModelKey
  );

  const handleSave = useCallback(async () => {
    const token = await getToken();
    if (!token || !settings) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const parsedModelCatalog = normalizeCatalogForSlice2(modelCatalogRef.current);
      assertCatalogSupportsSlice2(parsedModelCatalog);
      const parsedCatalog = deriveAvailableModelsByProvider(parsedModelCatalog);

      if (!parsedCatalog[primaryProvider].includes(primaryModel.trim())) {
        throw new Error("Primary model must be selected from the listed catalog.");
      }
      if (
        fallbackEnabled &&
        fallbackModel.trim().length > 0 &&
        !parsedCatalog[fallbackProvider].includes(fallbackModel.trim())
      ) {
        throw new Error("Fallback model must be selected from the listed catalog.");
      }
      if (
        routingFastModelKey.trim().length > 0 &&
        !parsedCatalog[primaryProvider].includes(routingFastModelKey.trim())
      ) {
        throw new Error(
          "Fast routing model must be selected from the active primary-provider catalog."
        );
      }

      const precheckRuleOverrides = buildRouterPrecheckRuleOverrides({
        continueTermsText: routerContinueTermsText,
        retrievalTermsText: routerRetrievalTermsText,
        reasoningTermsText: routerReasoningTermsText,
        premiumTermsText: routerPremiumTermsText,
        toolTermsText: routerToolTermsText,
        productPriorityTermsText: routerProductPriorityTermsText,
        webPriorityTermsText: routerWebPriorityTermsText,
        personalPriorityTermsText: routerPersonalPriorityTermsText
      });
      const skillRoutingPolicy = buildSkillRoutingPolicyInput({
        initialCheckUserMessageIndexText: skillRoutingInitialCheckUserMessageIndexText,
        backgroundRecheckIntervalMessagesText: skillRoutingBackgroundRecheckIntervalMessagesText
      });
      if (routerEnabled && routingFastModelKey.trim().length === 0) {
        throw new Error("Fast routing model is required when the router is enabled.");
      }

      const parsedVcoinExchangeRate = parseInt(vcoinExchangeRateText, 10);
      if (
        !Number.isInteger(parsedVcoinExchangeRate) ||
        parsedVcoinExchangeRate <= 0 ||
        isNaN(parsedVcoinExchangeRate)
      ) {
        throw new Error("VC exchange rate must be a positive integer.");
      }
      const parsedPersonaWorkspaceLimit = parseInt(heygenPersonaWorkspaceLimitText, 10);
      if (
        !Number.isInteger(parsedPersonaWorkspaceLimit) ||
        parsedPersonaWorkspaceLimit <= 0 ||
        isNaN(parsedPersonaWorkspaceLimit)
      ) {
        throw new Error("HeyGen persona limit must be a positive integer.");
      }
      const parsedPersonaCreationVcoin = parseInt(heygenPersonaCreationVcoinText, 10);
      if (
        !Number.isInteger(parsedPersonaCreationVcoin) ||
        parsedPersonaCreationVcoin < 0 ||
        isNaN(parsedPersonaCreationVcoin)
      ) {
        throw new Error("HeyGen persona creation cost must be a non-negative integer.");
      }
      const request: AdminRuntimeProviderSettingsRequest = {
        primary: { provider: primaryProvider, model: primaryModel.trim() },
        ...(fallbackEnabled && fallbackModel.trim()
          ? { fallback: { provider: fallbackProvider, model: fallbackModel.trim() } }
          : { fallback: null }),
        routingFastModelKey:
          routingFastModelKey.trim().length > 0 ? routingFastModelKey.trim() : null,
        routerPolicy: {
          enabled: routerEnabled,
          mode: routerMode,
          classifierFailureFallbackMode: routerFallbackMode,
          clarifyOnMissingContext: routerClarifyOnMissingContext,
          analyzeUploadsOnB2cUpload,
          precheckRuleOverrides
        },
        skillRoutingPolicy,
        availableModelsByProvider: parsedCatalog,
        availableModelCatalogByProvider: parsedModelCatalog,
        providerKeys: {
          ...(openaiKey ? { openai: openaiKey } : {}),
          ...(anthropicKey ? { anthropic: anthropicKey } : {})
        },
        vcoinExchangeRate: parsedVcoinExchangeRate,
        heygenPersonaWorkspaceLimit: parsedPersonaWorkspaceLimit,
        heygenPersonaCreationVcoin: parsedPersonaCreationVcoin
      };
      await putAdminRuntimeProviderSettings(token, request);
      setFeedback("Saved successfully. Changes propagate lazily after save.");
      setOpenaiKey("");
      setAnthropicKey("");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Save failed.");
    }
    setSaving(false);
  }, [
    anthropicKey,
    fallbackEnabled,
    fallbackModel,
    fallbackProvider,
    getToken,
    load,
    modelCatalogByProvider,
    analyzeUploadsOnB2cUpload,
    routerClarifyOnMissingContext,
    routerContinueTermsText,
    routerEnabled,
    routerFallbackMode,
    routerMode,
    routerPremiumTermsText,
    routerReasoningTermsText,
    routerRetrievalTermsText,
    routerToolTermsText,
    routerProductPriorityTermsText,
    routerWebPriorityTermsText,
    routerPersonalPriorityTermsText,
    skillRoutingBackgroundRecheckIntervalMessagesText,
    skillRoutingInitialCheckUserMessageIndexText,
    routingFastModelKey,
    openaiKey,
    primaryModel,
    primaryProvider,
    settings,
    vcoinExchangeRateText,
    heygenPersonaWorkspaceLimitText,
    heygenPersonaCreationVcoinText
  ]);

  const updateCatalogProfile = useCallback(
    (
      provider: ManagedRuntimeCatalogProvider,
      index: number,
      updater: (profile: RuntimeProviderModelProfileState) => RuntimeProviderModelProfileState
    ) => {
      setModelCatalogByProvider((current) => ({
        ...current,
        [provider]: {
          models: current[provider].models.map((profile, profileIndex) =>
            profileIndex === index ? applyDerivedTokenMeteredWeights(updater(profile)) : profile
          )
        }
      }));
    },
    []
  );

  const addCatalogProfile = useCallback(
    (
      provider: ManagedRuntimeCatalogProvider,
      capability: RuntimeProviderModelProfileState["capabilities"][number]
    ) => {
      setModelCatalogByProvider((current) => {
        const nextIndex = current[provider].models.length;
        setSelectedCatalogIndexByProvider((selected) => ({
          ...selected,
          [provider]: nextIndex
        }));
        return {
          ...current,
          [provider]: {
            models: [
              ...current[provider].models,
              createModelProfile(
                isVideoOnlyCatalogProvider(provider) ? "video" : capability,
                provider
              )
            ]
          }
        };
      });
    },
    []
  );

  const duplicateCatalogProfile = useCallback(
    (provider: ManagedRuntimeCatalogProvider, index: number) => {
      setModelCatalogByProvider((current) => {
        const source = current[provider].models[index];
        if (!source) {
          return current;
        }
        const duplicate = createInactiveDuplicateProfile(source);
        const nextModels = [...current[provider].models];
        nextModels.splice(index + 1, 0, duplicate);
        setSelectedCatalogIndexByProvider((selected) => ({
          ...selected,
          [provider]: index + 1
        }));
        return {
          ...current,
          [provider]: { models: nextModels }
        };
      });
    },
    []
  );

  const archiveCatalogProfile = useCallback(
    (provider: ManagedRuntimeCatalogProvider, index: number) => {
      setModelCatalogByProvider((current) => {
        const source = current[provider].models[index];
        if (!source) {
          return current;
        }
        if (source.model.trim().length === 0) {
          const nextModels = current[provider].models.filter(
            (_, profileIndex) => profileIndex !== index
          );
          setSelectedCatalogIndexByProvider((selected) => ({
            ...selected,
            [provider]: clampCatalogIndex(selected[provider], nextModels.length)
          }));
          return {
            ...current,
            [provider]: {
              models: nextModels
            }
          };
        }
        const nextModels = [...current[provider].models];
        nextModels[index] = createArchivedProfile(source);
        return {
          ...current,
          [provider]: {
            models: nextModels
          }
        };
      });
    },
    []
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-2.5 px-1 pb-24">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Server className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-bold tracking-tight text-text">Runtime</h1>
        </div>
      </div>

      {settings && (
        <div className="flex flex-wrap items-center gap-1.5 rounded border border-border/40 bg-surface px-2.5 py-1.5 text-[10px] text-text-muted">
          <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-semibold text-accent">
            {modeLabel(settings.mode)}
          </span>
          <span>Global provider and model routing for the active native runtime.</span>
          <span>
            Plan-level tier selection and native context-hydration budgets still live in{" "}
            <span className="font-mono text-text">Admin &gt; Plans</span>.
          </span>
          <span>
            Runway and Kling catalog rows are operator readiness only in this slice and do not make
            video execution live by themselves.
          </span>
          {settings.notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      )}

      <Fold t="Model Routing" open>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Card title="Primary">
            <ProviderSelect value={primaryProvider} onChange={setPrimaryProvider} />
            <ModelSelect
              label="Model"
              value={primaryModel}
              onChange={setPrimaryModel}
              options={availableModelsForSelect[primaryProvider]}
              emptyLabel="Select from available models"
            />
            <p className="text-[10px] text-text-subtle">
              Token weights: {modelProfileCostLabel(primaryModelProfile)}
            </p>
          </Card>
          <Card
            title="Graceful Fallback"
            trailing={
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-text-subtle">
                <input
                  type="checkbox"
                  checked={fallbackEnabled}
                  onChange={(event) => setFallbackEnabled(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-accent"
                />
                Enabled
              </label>
            }
          >
            {fallbackEnabled ? (
              <>
                <ProviderSelect value={fallbackProvider} onChange={setFallbackProvider} />
                <ModelSelect
                  label="Model"
                  value={fallbackModel}
                  onChange={setFallbackModel}
                  options={availableModelsForSelect[fallbackProvider]}
                  emptyLabel="Select from available models"
                />
                <p className="text-[10px] text-text-subtle">
                  Token weights: {modelProfileCostLabel(fallbackModelProfile)}
                </p>
              </>
            ) : (
              <p className="text-[10px] text-text-muted">
                Keep this off unless you really want degraded runtime fallback.
              </p>
            )}
          </Card>
        </div>
      </Fold>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <Card title="Skill Routing Cadence">
          <Field
            label="First background check after user message #"
            value={skillRoutingInitialCheckUserMessageIndexText}
            onChange={setSkillRoutingInitialCheckUserMessageIndexText}
            placeholder="3"
            type="number"
          />
          <Field
            label="Background recheck interval in user messages"
            value={skillRoutingBackgroundRecheckIntervalMessagesText}
            onChange={setSkillRoutingBackgroundRecheckIntervalMessagesText}
            placeholder="5"
            type="number"
          />
          <p className="text-[10px] text-text-subtle">
            This only controls background auto-skill monitoring cadence. It does not change normal
            routing when no skills are assigned.
          </p>
          <p className="text-[10px] text-text-subtle">
            Skill cadence and sticky retrieval still apply to assistants with enabled skills even if
            the early smart router toggle is off.
          </p>
        </Card>
        <Card title="Skill Retrieval Policy">
          <p className="text-[10px] text-text-subtle">
            Active skills now use a sticky retrieval policy: close follow-ups can reuse cached refs,
            medium drift can refresh search only, and ambiguous turns can still use the helper
            rerank path.
          </p>
          <p className="text-[10px] text-text-subtle">
            The cadence block on the left controls when background skill drift checks fire; the
            retrieval layer decides how much search/reranking work is needed inside the active
            skill.
          </p>
        </Card>
      </div>

      <Fold t="Provider Model Catalog">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {MANAGED_CATALOG_PROVIDERS.map((provider) => {
            const models = modelCatalogByProvider[provider].models;
            const selectedIndex = clampCatalogIndex(
              selectedCatalogIndexByProvider[provider],
              models.length
            );
            const selectedProfile = models[selectedIndex] ?? null;
            const catalogEntryLabel = `${providerLabel(provider)} catalog entry`;
            const videoOnlyProvider = isVideoOnlyCatalogProvider(provider);

            return (
              <Card key={provider} title={providerLabel(provider)}>
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                      <SelectField
                        label={catalogEntryLabel}
                        value={models.length > 0 ? String(selectedIndex) : ""}
                        onChange={(value) => {
                          const parsed = Number.parseInt(value, 10);
                          if (!Number.isFinite(parsed)) {
                            return;
                          }
                          setSelectedCatalogIndexByProvider((current) => ({
                            ...current,
                            [provider]: clampCatalogIndex(parsed, models.length)
                          }));
                        }}
                        options={
                          models.length > 0
                            ? models.map((profile, index) => ({
                                value: String(index),
                                label: formatCatalogEntryLabel(profile, index)
                              }))
                            : [{ value: "", label: "No catalog entries yet" }]
                        }
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-1.5">
                      {videoOnlyProvider ? (
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-text-muted">
                            New entry type
                          </label>
                          <div className="rounded border border-border/60 bg-surface-raised px-2.5 py-2 text-[10px] text-text-muted">
                            Video only
                          </div>
                        </div>
                      ) : (
                        <SelectField
                          label="New entry type"
                          value={newCatalogCapabilityByProvider[provider]}
                          onChange={(value) =>
                            setNewCatalogCapabilityByProvider((current) => ({
                              ...current,
                              [provider]:
                                value as RuntimeProviderModelProfileState["capabilities"][number]
                            }))
                          }
                          options={[
                            { value: "chat", label: "Chat" },
                            { value: "image", label: "Image" },
                            { value: "video", label: "Video" },
                            { value: "speech_to_text", label: "Speech to text" },
                            { value: "text_to_speech", label: "Text to speech" }
                          ]}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          addCatalogProfile(provider, newCatalogCapabilityByProvider[provider])
                        }
                        className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent hover:border-accent/60"
                      >
                        Add model
                      </button>
                    </div>
                  </div>

                  {selectedProfile === null ? (
                    <p className="rounded border border-dashed border-border/60 bg-surface-raised/40 px-2.5 py-3 text-[10px] text-text-subtle">
                      No catalog entries yet.{" "}
                      {videoOnlyProvider
                        ? `Click Add model to create the first video catalog row for ${providerLabel(provider)}.`
                        : `Choose a type and click Add model to create the first version row for ${providerLabel(provider)}.`}
                    </p>
                  ) : (
                    <ModelProfileEditor
                      key={`${provider}:${selectedProfile.model || "draft"}:${selectedIndex}`}
                      provider={provider}
                      profile={selectedProfile}
                      onChange={(nextProfile) =>
                        updateCatalogProfile(provider, selectedIndex, () => nextProfile)
                      }
                      onProviderPriceMetadataChange={(merge) =>
                        updateCatalogProfile(provider, selectedIndex, (currentProfile) => {
                          const currentMeta =
                            currentProfile.providerPriceMetadata ??
                            createDefaultProviderPriceMetadata(currentProfile.billingMode);
                          return replacePriceMetadata(currentProfile, merge(currentMeta));
                        })
                      }
                      onDuplicate={() => duplicateCatalogProfile(provider, selectedIndex)}
                      onArchive={() => archiveCatalogProfile(provider, selectedIndex)}
                      vcoinExchangeRate={settings?.vcoinExchangeRate ?? 20}
                    />
                  )}

                  <p className="text-[10px] text-text-subtle">
                    {provider === "heygen"
                      ? "Talking-avatar video provider for ADR-109. Catalog rows arrive in Slice 2b (capability axis pending). Save is supported now; rows remain empty."
                      : videoOnlyProvider
                        ? `${providerLabel(provider)} rows stay video-only here and do not appear in primary, fallback, or router chat selectors. Catalog readiness in this page does not enable live execution by itself.`
                        : "Active `chat` rows feed the same downstream model picks as before. Inactive rows stay in the catalog for version history and do not appear in selectors. Archive versions instead of deleting historical truth."}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </Fold>

      <Fold t="Router Policy">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Card
            title="Early Smart Router"
            trailing={
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-text-subtle">
                <input
                  type="checkbox"
                  checked={routerEnabled}
                  onChange={(event) => setRouterEnabled(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-accent"
                />
                Enabled
              </label>
            }
          >
            <ModelSelect
              label="Fast routing model"
              value={routingFastModelKey}
              onChange={setRoutingFastModelKey}
              options={availableModelsForSelect[primaryProvider]}
              emptyLabel="Select from primary-provider catalog"
            />
            <div className="rounded border border-border/40 bg-background px-2 py-1 text-[10px] text-text-subtle">
              <div>
                Normal reply: {primaryModel || "Select primary model"} -{" "}
                {modelProfileCostLabel(primaryModelProfile)}
              </div>
              <div>
                Premium reply: {primaryModel || "Select primary model"} -{" "}
                {modelProfileCostLabel(primaryModelProfile)}
              </div>
              <div>
                Reasoning: {routingFastModelKey || "Select fast routing model"} -{" "}
                {modelProfileCostLabel(routingFastModelProfile)}
              </div>
            </div>
            <SelectField
              label="Mode"
              value={routerMode}
              onChange={(value) =>
                setRouterMode(value as AdminRuntimeProviderSettingsState["routerPolicy"]["mode"])
              }
              options={[
                { value: "shadow", label: "Shadow - decide and observe only" },
                { value: "active", label: "Active - route before main model call" }
              ]}
            />
            <SelectField
              label="Classifier failure fallback"
              value={routerFallbackMode}
              onChange={(value) =>
                setRouterFallbackMode(
                  value as AdminRuntimeProviderSettingsState["routerPolicy"]["classifierFailureFallbackMode"]
                )
              }
              options={[
                { value: "normal", label: "Normal reply" },
                { value: "premium", label: "Premium reply" },
                { value: "reasoning", label: "Reasoning" }
              ]}
            />
            <label className="flex items-center gap-2 text-[10px] text-text-muted">
              <input
                type="checkbox"
                checked={routerClarifyOnMissingContext}
                onChange={(event) => setRouterClarifyOnMissingContext(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
              Ask for clarification when the router detects missing context.
            </label>
            <label className="flex items-center gap-2 text-[10px] text-text-muted">
              <input
                type="checkbox"
                checked={analyzeUploadsOnB2cUpload}
                onChange={(event) => setAnalyzeUploadsOnB2cUpload(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
              Analyze uploads in B2C chats. Project chats always analyze uploads.
            </label>
          </Card>
          <Card title="Editable Precheck Triggers">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TextareaField
                label="Continue shortcuts"
                value={routerContinueTermsText}
                onChange={setRouterContinueTermsText}
                placeholder={"ok\ncontinue\ngo ahead"}
              />
              <TextareaField
                label="Retrieval hints"
                value={routerRetrievalTermsText}
                onChange={setRouterRetrievalTermsText}
                placeholder={"find in docs\nsearch knowledge"}
              />
              <TextareaField
                label="Reasoning requests"
                value={routerReasoningTermsText}
                onChange={setRouterReasoningTermsText}
                placeholder={"architecture\ntrade-offs\nroot cause"}
              />
              <TextareaField
                label="Premium writing"
                value={routerPremiumTermsText}
                onChange={setRouterPremiumTermsText}
                placeholder={"rewrite\nemail\ncover letter"}
              />
              <div className="sm:col-span-2">
                <TextareaField
                  label="Tool or browsing hints"
                  value={routerToolTermsText}
                  onChange={setRouterToolTermsText}
                  placeholder={"browse\nlatest news\ngenerate image"}
                />
              </div>
              <TextareaField
                label="Personal-first priority"
                value={routerPersonalPriorityTermsText}
                onChange={setRouterPersonalPriorityTermsText}
                placeholder={"i\nmy\nour\nremember"}
              />
              <TextareaField
                label="Product-first priority"
                value={routerProductPriorityTermsText}
                onChange={setRouterProductPriorityTermsText}
                placeholder={"plan\ntariff\nquota\nlimit"}
              />
              <div className="sm:col-span-2">
                <TextareaField
                  label="Web-first priority"
                  value={routerWebPriorityTermsText}
                  onChange={setRouterWebPriorityTermsText}
                  placeholder={"latest\ntoday\nweather\ncurrent"}
                />
              </div>
            </div>
            <p className="text-[10px] text-text-subtle">
              Add one phrase per line. These lists only tune the deterministic precheck layer and
              override the built-in router defaults when filled without touching JSON. The three
              priority lists steer ordinary (non-skill) retrieval order between personal, product,
              and web sources. If you want to change the LLM router prompt itself, edit it
              separately in <span className="font-mono">Admin &gt; Prompt Constructor</span>.
            </p>
          </Card>
        </div>
      </Fold>

      <Fold t="API Keys">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Card title="OpenAI">
            <Field
              label="API key"
              value={openaiKey}
              onChange={setOpenaiKey}
              type="password"
              autoComplete="new-password"
              placeholder={
                settings?.providerKeys.openai.configured
                  ? `Configured ••••${settings.providerKeys.openai.lastFour ?? ""}`
                  : "sk-..."
              }
            />
            <p className="text-[10px] text-text-subtle">
              {settings?.providerKeys.openai.configured
                ? `${providerLabel("openai")} key is already configured. Leave blank to keep it.`
                : "Required when OpenAI is selected and no stored key exists yet."}
            </p>
          </Card>
          <Card title="Anthropic">
            <Field
              label="API key"
              value={anthropicKey}
              onChange={setAnthropicKey}
              type="password"
              autoComplete="new-password"
              placeholder={
                settings?.providerKeys.anthropic.configured
                  ? `Configured ••••${settings.providerKeys.anthropic.lastFour ?? ""}`
                  : "sk-ant-..."
              }
            />
            <p className="text-[10px] text-text-subtle">
              {settings?.providerKeys.anthropic.configured
                ? `${providerLabel("anthropic")} key is already configured. Leave blank to keep it.`
                : "Required when Anthropic is selected and no stored key exists yet."}
            </p>
          </Card>
        </div>
      </Fold>

      <Fold t="Vcoin Economy">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <Card title="VC Exchange Rate">
            <Field
              label="VC per 1 USD"
              value={vcoinExchangeRateText}
              onChange={setVcoinExchangeRateText}
              type="number"
            />
            <p className="text-[10px] text-text-subtle">
              Platform-level integer exchange rate. Default 20 (1 USD = 20 VC, 1 VC = $0.05).
            </p>
          </Card>
          <Card title="HeyGen persona limit per workspace">
            <Field
              label="Max active personas"
              value={heygenPersonaWorkspaceLimitText}
              onChange={setHeygenPersonaWorkspaceLimitText}
              type="number"
            />
            <p className="text-[10px] text-text-subtle">
              Maximum non-archived video personas per workspace. Default 10.
            </p>
          </Card>
          <Card title="HeyGen persona creation cost (VC)">
            <Field
              label="Cost per persona (VC)"
              value={heygenPersonaCreationVcoinText}
              onChange={setHeygenPersonaCreationVcoinText}
              type="number"
            />
            <p className="text-[10px] text-text-subtle">
              VC debited from the workspace wallet when a persona is created. 0 = free. Default 20
              (≈ $1.00 at default rate). 1 VC ≈ $0.05
            </p>
          </Card>
        </div>
      </Fold>

      <InboundSafetyPolicyPanel />

      <div className="sticky bottom-0 z-10 -mx-2 rounded-xl border border-border/70 bg-surface/95 px-3 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-text-subtle">
            Runtime settings are global platform policy. Save applies provider/model/optimization
            updates together.
          </p>
          <div className="flex items-center gap-2">
            {feedback && <p className="text-[10px] text-text-muted">{feedback}</p>}
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex cursor-pointer items-center gap-1 rounded border border-accent bg-accent px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderSelect({
  value,
  onChange
}: {
  value: ManagedRuntimeProvider;
  onChange: (v: ManagedRuntimeProvider) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">Provider</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ManagedRuntimeProvider)}
        aria-label="Provider"
        className="persai-select w-full"
      >
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
    </div>
  );
}

function ModelSelect({
  label,
  value,
  onChange,
  options,
  emptyLabel
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  emptyLabel: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="persai-select w-full"
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModelProfileEditor({
  provider,
  profile,
  onChange,
  onProviderPriceMetadataChange,
  onDuplicate,
  onArchive,
  vcoinExchangeRate = 20
}: {
  provider: ManagedRuntimeCatalogProvider;
  profile: RuntimeProviderModelProfileState;
  onChange: (profile: RuntimeProviderModelProfileState) => void;
  onProviderPriceMetadataChange: (merge: RuntimeProviderPriceMetadataMerger) => void;
  onDuplicate: () => void;
  onArchive: () => void;
  vcoinExchangeRate?: number;
}) {
  const isDiscardableDraft = profile.model.trim().length === 0;
  const archiveActionDisabled = !isDiscardableDraft && !profile.active;
  const videoOnlyProvider = isVideoOnlyCatalogProvider(provider);
  const editableCapabilities = videoOnlyProvider
    ? (["video"] as const)
    : (["chat", "image", "video", "speech_to_text", "text_to_speech"] as const);

  const setCapabilities = (
    capability: RuntimeProviderModelProfileState["capabilities"][number]
  ) => {
    const hasCapability = profile.capabilities.includes(capability);
    const nextCapabilities = hasCapability
      ? profile.capabilities.filter((entry) => entry !== capability)
      : [...profile.capabilities, capability];
    if (nextCapabilities.length === 0) {
      return;
    }
    onChange({
      ...profile,
      capabilities: nextCapabilities
    });
  };

  return (
    <div className="space-y-2 rounded border border-border/50 bg-background/60 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
              profile.active
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-border/70 bg-surface-raised text-text-subtle"
            )}
          >
            {profile.active ? "Active" : "Inactive"}
          </span>
          <span className="text-[10px] text-text-muted">
            {providerLabel(provider)} • {profile.billingMode}
          </span>
          <span
            className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
            aria-label="Capability kind"
          >
            {provider === "heygen" ? "Talking Avatar" : "Cinematic"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onDuplicate}
            aria-label={`Duplicate version ${profile.model || "draft"}`}
            className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted hover:border-border-strong hover:text-text"
          >
            Duplicate version
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={archiveActionDisabled}
            aria-label={`${
              isDiscardableDraft ? "Discard draft" : "Archive version"
            } ${profile.model || "draft"}`}
            className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-300"
          >
            {isDiscardableDraft ? "Discard draft" : profile.active ? "Archive version" : "Archived"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field
          label="Model key"
          value={profile.model}
          onChange={(value) => onChange({ ...profile, model: value })}
          placeholder="gpt-5.4"
        />
        <Field
          label="Display label"
          value={profile.displayLabel ?? ""}
          onChange={(value) =>
            onChange({ ...profile, displayLabel: value.trim().length > 0 ? value : null })
          }
          placeholder="GPT 5.4"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SelectField
          label="Billing mode"
          value={profile.billingMode}
          onChange={(value) =>
            onChange(
              rebuildProfileForBillingMode(profile, value as RuntimeProviderBillingModeState)
            )
          }
          options={[
            { value: "token_metered", label: "Token metered" },
            { value: "time_metered", label: "Time metered" },
            { value: "text_chars_metered", label: "Text chars metered" },
            { value: "fixed_operation", label: "Fixed operation" },
            { value: "tiered_operation", label: "Tiered operation" }
          ]}
        />
        <label className="flex items-center gap-2 pt-5 text-[10px] text-text-muted">
          <input
            type="checkbox"
            checked={profile.active}
            onChange={(event) => onChange({ ...profile, active: event.target.checked })}
            className="h-3.5 w-3.5 rounded border-border accent-accent"
          />
          Active in downstream selectors
        </label>
      </div>

      {videoOnlyProvider && (
        <p className="text-[10px] text-text-subtle">
          {providerLabel(provider)} is a video-only catalog provider in ADR-106 Slice 3. Keep
          capability scoped to video here; chat routing remains OpenAI/Anthropic-only.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {editableCapabilities.map((capability) => (
          <label
            key={capability}
            className="flex items-center gap-1 rounded border border-border/60 bg-surface-raised px-2 py-1 text-[10px] text-text-muted"
          >
            <input
              type="checkbox"
              checked={profile.capabilities.includes(capability)}
              onChange={() => setCapabilities(capability)}
              disabled={videoOnlyProvider}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            {capability}
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field
          label="Effective from"
          value={formatIsoDateForInput(profile.effectiveFrom)}
          onChange={(value) => onChange({ ...profile, effectiveFrom: parseDateInputValue(value) })}
          type="date"
        />
        <Field
          label="Effective to"
          value={formatIsoDateForInput(profile.effectiveTo)}
          onChange={(value) => onChange({ ...profile, effectiveTo: parseDateInputValue(value) })}
          type="date"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {profile.billingMode === "token_metered" ? (
          <>
            <DerivedWeightField label="Input weight" value={profile.inputTokenWeight} />
            <DerivedWeightField
              label="Cached input weight"
              value={profile.cachedInputTokenWeight}
            />
            <DerivedWeightField label="Output weight" value={profile.outputTokenWeight} />
            <p className="text-[10px] text-text-subtle sm:col-span-3">
              Quota weights are derived from token prices below. Input is always 1; cached and
              output update automatically when prices change.
            </p>
          </>
        ) : (
          <>
            <NumberField
              label="Input weight"
              value={profile.inputTokenWeight}
              onChange={(value) => onChange({ ...profile, inputTokenWeight: value })}
            />
            <NumberField
              label="Cached input weight"
              value={profile.cachedInputTokenWeight}
              onChange={(value) => onChange({ ...profile, cachedInputTokenWeight: value })}
            />
            <NumberField
              label="Output weight"
              value={profile.outputTokenWeight}
              onChange={(value) => onChange({ ...profile, outputTokenWeight: value })}
            />
          </>
        )}
      </div>

      <PriceMetadataEditor
        profile={profile}
        onChange={onProviderPriceMetadataChange}
        vcoinExchangeRate={vcoinExchangeRate}
      />

      {profile.capabilities.includes("video") && (
        <VideoModelParametersEditor
          provider={provider}
          value={
            (profile as RuntimeProviderModelProfileWithVideo).videoModelParameters ??
            createDefaultVideoModelParameters(provider)
          }
          onChange={(videoModelParameters) =>
            onChange({
              ...profile,
              videoModelParameters
            } as unknown as RuntimeProviderModelProfileState)
          }
        />
      )}

      <div>
        <label className="mb-1 block text-[10px] font-medium text-text-muted">Notes</label>
        <textarea
          value={profile.notes ?? ""}
          onChange={(event) =>
            onChange({
              ...profile,
              notes: event.target.value.trim().length > 0 ? event.target.value : null
            })
          }
          rows={2}
          className="w-full rounded border border-border bg-surface-raised px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
          placeholder="Optional operator note"
        />
      </div>
    </div>
  );
}

function VideoModelParametersEditor({
  provider,
  value,
  onChange
}: {
  provider: ManagedRuntimeCatalogProvider;
  value: RuntimeVideoModelParametersState;
  onChange: (value: RuntimeVideoModelParametersState) => void;
}) {
  const normalized = normalizeVideoModelParametersForSlice2(value);
  if (provider === "heygen") {
    return (
      <HeyGenTalkingAvatarParametersEditor
        value={normalized}
        onChange={(next) => onChange(normalizeVideoModelParametersForSlice2(next))}
      />
    );
  }
  const validationMessage = validateVideoModelParametersForSlice2(normalized);
  const durationValues =
    normalized.duration.kind === "allowed_list"
      ? normalized.duration.values.join(", ")
      : [
          normalized.duration.min,
          normalized.duration.max,
          normalized.duration.step ?? "",
          normalized.duration.preferredValues?.join(", ") ?? ""
        ].join(", ");
  const audioCapabilities = new Set(normalized.audioCapabilities);
  const inputCapabilities = new Set(normalized.inputCapabilities);
  const updateAudioCapability = (
    capability: (typeof ACTIVE_VIDEO_AUDIO_CAPABILITIES)[number],
    enabled: boolean
  ) => {
    const next = new Set(normalized.audioCapabilities);
    if (capability === "silent") {
      next.add("silent");
    } else if (enabled) {
      next.add(capability);
      if (capability === "voice_control") {
        next.add("provider_native_audio");
      }
    } else {
      next.delete(capability);
      if (capability === "provider_native_audio") {
        next.delete("voice_control");
      }
    }
    onChange(
      normalizeVideoModelParametersForSlice2({
        ...normalized,
        audioCapabilities: Array.from(next)
      })
    );
  };
  const updateInputCapability = (
    capability: (typeof ACTIVE_VIDEO_INPUT_CAPABILITIES)[number],
    enabled: boolean
  ) => {
    const next = new Set(normalized.inputCapabilities);
    if (capability === "text") {
      next.add("text");
    } else if (enabled) {
      next.add(capability);
      next.add("single_reference_image");
    } else {
      next.delete(capability);
    }
    onChange(
      normalizeVideoModelParametersForSlice2({
        ...normalized,
        inputCapabilities: Array.from(next)
      })
    );
  };
  return (
    <div className="space-y-2 rounded border border-border/50 bg-surface-raised/70 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">
          Video model parameters
        </h4>
        <button
          type="button"
          onClick={() => onChange(createDefaultVideoModelParameters(provider))}
          className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted hover:border-border-strong hover:text-text"
        >
          Reset provider defaults
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SelectField
          label="Duration mode"
          value={normalized.duration.kind}
          onChange={(kind) =>
            onChange({
              ...normalized,
              duration:
                kind === "range"
                  ? { kind: "range", min: 3, max: 15, step: 1, preferredValues: [4, 8, 12] }
                  : { kind: "allowed_list", values: [5, 8, 10] }
            })
          }
          options={[
            { value: "allowed_list", label: "Allowed list" },
            { value: "range", label: "Range" }
          ]}
        />
        <Field
          label={
            normalized.duration.kind === "allowed_list"
              ? "Allowed seconds, comma-separated"
              : "Range min, max, step, preferred"
          }
          value={durationValues}
          onChange={(raw) => {
            const parts = raw
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean);
            if (normalized.duration.kind === "allowed_list") {
              const values = parts
                .map((entry) => Number.parseInt(entry, 10))
                .filter(Number.isFinite);
              onChange({ ...normalized, duration: { kind: "allowed_list", values } });
              return;
            }
            const [minRaw, maxRaw, stepRaw, preferredRaw] = parts;
            const min = Number.parseInt(minRaw ?? "3", 10);
            const max = Number.parseInt(maxRaw ?? "15", 10);
            const step = stepRaw ? Number.parseInt(stepRaw, 10) : null;
            const preferredValues =
              preferredRaw === undefined
                ? null
                : preferredRaw
                    .split(/\s+/)
                    .map((entry) => Number.parseInt(entry, 10))
                    .filter(Number.isFinite);
            onChange({
              ...normalized,
              duration: {
                kind: "range",
                min: Number.isFinite(min) ? min : 3,
                max: Number.isFinite(max) ? max : 15,
                step: Number.isFinite(step) ? step : null,
                preferredValues
              }
            });
          }}
          placeholder={normalized.duration.kind === "allowed_list" ? "5, 8, 10" : "3, 15, 1, 5 10"}
        />
      </div>
      <label className="flex items-center gap-2 text-[10px] text-text-muted">
        <input
          type="checkbox"
          checked={normalized.referenceImageSupported}
          aria-label="Reference image supported"
          onChange={(event) =>
            onChange(
              normalizeVideoModelParametersForSlice2({
                ...normalized,
                referenceImageSupported: event.target.checked
              })
            )
          }
          className="h-3.5 w-3.5 rounded border-border accent-accent"
        />
        Reference image supported
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1 rounded border border-border/50 bg-bg/40 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
            Audio capabilities
          </p>
          <label className="flex items-center gap-2 text-[11px] text-text">
            <input
              type="checkbox"
              checked
              disabled
              aria-label="Silent"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Silent
          </label>
          <label className="flex items-center gap-2 text-[11px] text-text">
            <input
              type="checkbox"
              checked={audioCapabilities.has("provider_native_audio")}
              aria-label="Provider native audio"
              onChange={(event) =>
                updateAudioCapability("provider_native_audio", event.target.checked)
              }
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Provider native audio
          </label>
          <label className="flex items-center gap-2 text-[11px] text-text">
            <input
              type="checkbox"
              checked={audioCapabilities.has("voice_control")}
              aria-label="Voice control"
              onChange={(event) => updateAudioCapability("voice_control", event.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Voice control
          </label>
          <p className="text-[10px] text-text-subtle">
            Voice control is a stricter capability than provider-native audio and cannot stand
            alone.
          </p>
        </div>
        <div className="space-y-1 rounded border border-border/50 bg-bg/40 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
            Input capabilities
          </p>
          <label className="flex items-center gap-2 text-[11px] text-text">
            <input
              type="checkbox"
              checked
              disabled
              aria-label="Text"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Text
          </label>
          <label className="flex items-center gap-2 text-[11px] text-text">
            <input
              type="checkbox"
              checked={inputCapabilities.has("single_reference_image")}
              disabled
              aria-label="Single reference image"
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Single reference image
          </label>
          <label className="flex items-center gap-2 text-[11px] text-text">
            <input
              type="checkbox"
              checked={inputCapabilities.has("multi_image")}
              aria-label="Multi-image"
              onChange={(event) => updateInputCapability("multi_image", event.target.checked)}
              disabled={!normalized.referenceImageSupported}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Multi-image
          </label>
          <p className="text-[10px] text-text-subtle">
            `single_reference_image` follows the reference-image toggle automatically. Omni stays
            deferred and is not editable in Slice 2.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <JsonTextareaField
          label="Aspect ratios JSON"
          value={normalized.aspectRatios}
          onCommit={(next) =>
            onChange({
              ...normalized,
              aspectRatios: next
            })
          }
          placeholder='[{"aspectRatio":"16:9","size":"1280x720","providerValue":"16:9"}]'
        />
        <JsonTextareaField
          label="Provider parameters JSON"
          value={normalized.providerParameters}
          onCommit={(next) =>
            onChange(
              normalizeVideoModelParametersForSlice2({
                ...normalized,
                providerParameters: next
              })
            )
          }
          placeholder='{"mode":"pro","sound":"off"}'
        />
      </div>
      {validationMessage ? <p className="text-[10px] text-amber-300">{validationMessage}</p> : null}
      <p className="text-[10px] text-text-subtle">
        These fields are persisted into the materialized runtime catalog and are required before
        `video_generate` can normalize duration, size, reference images, and provider-native
        options.
      </p>
    </div>
  );
}

function resolveHeyGenProviderParameters(
  value: RuntimeVideoModelParametersState
): HeyGenTalkingAvatarProviderParameters {
  const providerParameters = value.providerParameters ?? {};
  const resolution =
    providerParameters.resolution === "720p" ||
    providerParameters.resolution === "1080p" ||
    providerParameters.resolution === "4k"
      ? providerParameters.resolution
      : "1080p";
  const aspectRatio =
    providerParameters.aspectRatio === "auto" ||
    providerParameters.aspectRatio === "16:9" ||
    providerParameters.aspectRatio === "9:16" ||
    providerParameters.aspectRatio === "1:1" ||
    providerParameters.aspectRatio === "4:5" ||
    providerParameters.aspectRatio === "5:4"
      ? providerParameters.aspectRatio
      : "auto";
  const engine =
    providerParameters.engine === "avatar_iv" || providerParameters.engine === "avatar_v"
      ? providerParameters.engine
      : "avatar_v";
  return {
    resolution,
    aspectRatio,
    engine
  };
}

function buildHeyGenTalkingAvatarModelParameters(input: {
  current: RuntimeVideoModelParametersState;
  providerParameters: HeyGenTalkingAvatarProviderParameters;
}): RuntimeVideoModelParametersState {
  return {
    ...input.current,
    // These fields are compatibility metadata for the shared video model
    // catalog shape. They are not presented as HeyGen controls because HeyGen
    // talking-avatar duration comes from speechText and audio comes from the
    // selected voice.
    duration: { kind: "range", min: 1, max: 600, step: 1, preferredValues: [15, 30, 60] },
    aspectRatios: [
      { aspectRatio: "16:9", size: "1280x720", providerValue: "16:9" },
      { aspectRatio: "9:16", size: "720x1280", providerValue: "9:16" }
    ],
    referenceImageSupported: true,
    audioCapabilities: ["silent"],
    inputCapabilities: ["text", "single_reference_image"],
    providerParameters: {
      resolution: input.providerParameters.resolution,
      aspectRatio: input.providerParameters.aspectRatio,
      engine: input.providerParameters.engine
    }
  };
}

function HeyGenTalkingAvatarParametersEditor({
  value,
  onChange
}: {
  value: RuntimeVideoModelParametersState;
  onChange: (value: RuntimeVideoModelParametersState) => void;
}) {
  const providerParameters = resolveHeyGenProviderParameters(value);
  const update = (patch: Partial<HeyGenTalkingAvatarProviderParameters>) => {
    onChange(
      buildHeyGenTalkingAvatarModelParameters({
        current: value,
        providerParameters: {
          ...providerParameters,
          ...patch
        }
      })
    );
  };
  return (
    <div className="space-y-2 rounded border border-border/50 bg-surface-raised/70 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">
          HeyGen talking-avatar parameters
        </h4>
        <button
          type="button"
          onClick={() => onChange(createDefaultVideoModelParameters("heygen"))}
          className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted hover:border-border-strong hover:text-text"
        >
          Reset HeyGen defaults
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SelectField
          label="Resolution"
          value={providerParameters.resolution ?? "1080p"}
          onChange={(resolution) =>
            update({ resolution: resolution as NonNullable<typeof providerParameters.resolution> })
          }
          options={HEYGEN_TALKING_AVATAR_RESOLUTIONS.map((resolution) => ({
            value: resolution,
            label: resolution
          }))}
        />
        <SelectField
          label="Aspect ratio"
          value={providerParameters.aspectRatio ?? "auto"}
          onChange={(aspectRatio) =>
            update({
              aspectRatio: aspectRatio as NonNullable<typeof providerParameters.aspectRatio>
            })
          }
          options={HEYGEN_TALKING_AVATAR_ASPECT_RATIOS.map((aspectRatio) => ({
            value: aspectRatio,
            label: aspectRatio === "auto" ? "auto (source/default)" : aspectRatio
          }))}
        />
        <SelectField
          label="Engine"
          value={providerParameters.engine ?? "avatar_v"}
          onChange={(engine) =>
            update({ engine: engine as NonNullable<typeof providerParameters.engine> })
          }
          options={HEYGEN_TALKING_AVATAR_ENGINES.map((engine) => ({
            value: engine,
            label: engine
          }))}
        />
      </div>
      <p className="text-[10px] text-text-subtle">
        HeyGen does not use the cinematic duration/audio/input controls. Duration follows
        `speechText`; audio is the selected HeyGen voice; persona/photo input is handled by
        `personaId` or `portraitImageAlias`.
      </p>
    </div>
  );
}

function PriceMetadataEditor({
  profile,
  onChange,
  vcoinExchangeRate = 20
}: {
  profile: RuntimeProviderModelProfileState;
  onChange: (merge: RuntimeProviderPriceMetadataMerger) => void;
  vcoinExchangeRate?: number;
}) {
  const pricing =
    profile.providerPriceMetadata ?? createDefaultProviderPriceMetadata(profile.billingMode);
  const tokenPricing = "tokenPricing" in pricing ? pricing.tokenPricing : null;
  const timePricing = "timePricing" in pricing ? pricing.timePricing : null;
  const fixedOperationPricing =
    "fixedOperationPricing" in pricing ? pricing.fixedOperationPricing : null;
  const tieredOperationPricing =
    "tieredOperationPricing" in pricing ? pricing.tieredOperationPricing : null;
  return (
    <div className="space-y-2 rounded border border-border/50 bg-surface-raised/70 p-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SelectField
          label="Currency"
          value="USD"
          onChange={() => onChange((current) => ({ ...current, currency: "USD" }))}
          options={[{ value: "USD", label: "USD" }]}
        />
      </div>

      {profile.billingMode === "token_metered" && tokenPricing && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <NumberField
            label="Input / 1M"
            value={tokenPricing.inputPer1M}
            onChange={(next) =>
              onChange((current) => {
                if (!("tokenPricing" in current)) {
                  return current;
                }
                return {
                  ...current,
                  tokenPricing: { ...current.tokenPricing, inputPer1M: next }
                };
              })
            }
          />
          <NumberField
            label="Cached / 1M"
            value={tokenPricing.cachedInputPer1M}
            onChange={(next) =>
              onChange((current) => {
                if (!("tokenPricing" in current)) {
                  return current;
                }
                return {
                  ...current,
                  tokenPricing: { ...current.tokenPricing, cachedInputPer1M: next }
                };
              })
            }
          />
          <NumberField
            label="Output / 1M"
            value={tokenPricing.outputPer1M}
            onChange={(next) =>
              onChange((current) => {
                if (!("tokenPricing" in current)) {
                  return current;
                }
                return {
                  ...current,
                  tokenPricing: { ...current.tokenPricing, outputPer1M: next }
                };
              })
            }
          />
        </div>
      )}

      {profile.billingMode === "time_metered" && timePricing && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SelectField
            label="Time unit"
            value={timePricing.unit}
            onChange={(unit) =>
              onChange((current) => {
                if (!("timePricing" in current)) {
                  return current;
                }
                return {
                  ...current,
                  timePricing: { ...current.timePricing, unit: unit as "second" | "minute" }
                };
              })
            }
            options={[
              { value: "second", label: "Second" },
              { value: "minute", label: "Minute" }
            ]}
          />
          <div>
            <NumberField
              label="Price / unit"
              value={timePricing.pricePerUnit}
              onChange={(next) =>
                onChange((current) => {
                  if (!("timePricing" in current)) {
                    return current;
                  }
                  return {
                    ...current,
                    timePricing: { ...current.timePricing, pricePerUnit: next }
                  };
                })
              }
            />
            <span className="text-xs text-muted-foreground">1 USD = {vcoinExchangeRate} VC</span>
          </div>
        </div>
      )}

      {profile.billingMode === "text_chars_metered" && "textCharsPricing" in pricing && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-1">
          <NumberField
            label="Price / 1M chars"
            value={pricing.textCharsPricing.pricePer1MChars}
            onChange={(next) =>
              onChange((current) => {
                if (!("textCharsPricing" in current)) {
                  return current;
                }
                return {
                  ...current,
                  textCharsPricing: {
                    ...current.textCharsPricing,
                    pricePer1MChars: next
                  }
                };
              })
            }
          />
        </div>
      )}

      {profile.billingMode === "fixed_operation" && fixedOperationPricing && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field
            label="Operation label"
            value={fixedOperationPricing.unitLabel ?? ""}
            onChange={(unitLabel) =>
              onChange((current) => {
                if (!("fixedOperationPricing" in current)) {
                  return current;
                }
                return {
                  ...current,
                  fixedOperationPricing: {
                    ...current.fixedOperationPricing,
                    unitLabel: unitLabel.trim().length > 0 ? unitLabel : null
                  }
                };
              })
            }
            placeholder="render"
          />
          <NumberField
            label="Price / operation"
            value={fixedOperationPricing.pricePerOperation}
            onChange={(next) =>
              onChange((current) => {
                if (!("fixedOperationPricing" in current)) {
                  return current;
                }
                return {
                  ...current,
                  fixedOperationPricing: {
                    ...current.fixedOperationPricing,
                    pricePerOperation: next
                  }
                };
              })
            }
          />
        </div>
      )}

      {profile.billingMode === "tiered_operation" && tieredOperationPricing && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field
              label="Tier unit label"
              value={tieredOperationPricing.unitLabel ?? ""}
              onChange={(unitLabel) =>
                onChange((current) => {
                  if (!("tieredOperationPricing" in current)) {
                    return current;
                  }
                  return {
                    ...current,
                    tieredOperationPricing: {
                      ...current.tieredOperationPricing,
                      unitLabel: unitLabel.trim().length > 0 ? unitLabel : null
                    }
                  };
                })
              }
              placeholder="image"
            />
            <div className="flex items-end">
              <button
                type="button"
                onClick={() =>
                  onChange((current) => {
                    if (!("tieredOperationPricing" in current)) {
                      return current;
                    }
                    return {
                      ...current,
                      tieredOperationPricing: {
                        ...current.tieredOperationPricing,
                        tiers: [
                          ...current.tieredOperationPricing.tiers,
                          { label: "", matchValue: null, price: 0 }
                        ]
                      }
                    };
                  })
                }
                className="rounded border border-border/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted hover:border-border-strong hover:text-text"
              >
                Add tier
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {tieredOperationPricing.tiers.map((tier, tierIndex) => (
              <div
                key={`${tier.label || "tier"}:${tierIndex}`}
                className="grid grid-cols-1 gap-2 rounded border border-border/40 bg-background/60 p-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]"
              >
                <Field
                  label="Tier label"
                  value={tier.label}
                  onChange={(label) =>
                    onChange((current) => {
                      if (!("tieredOperationPricing" in current)) {
                        return current;
                      }
                      return {
                        ...current,
                        tieredOperationPricing: {
                          ...current.tieredOperationPricing,
                          tiers: current.tieredOperationPricing.tiers.map((entry, entryIndex) =>
                            entryIndex === tierIndex ? { ...entry, label } : entry
                          )
                        }
                      };
                    })
                  }
                  placeholder="hd"
                />
                <Field
                  label="Match value"
                  value={tier.matchValue ?? ""}
                  onChange={(matchValue) =>
                    onChange((current) => {
                      if (!("tieredOperationPricing" in current)) {
                        return current;
                      }
                      return {
                        ...current,
                        tieredOperationPricing: {
                          ...current.tieredOperationPricing,
                          tiers: current.tieredOperationPricing.tiers.map((entry, entryIndex) =>
                            entryIndex === tierIndex
                              ? {
                                  ...entry,
                                  matchValue: matchValue.trim().length > 0 ? matchValue : null
                                }
                              : entry
                          )
                        }
                      };
                    })
                  }
                  placeholder="1024x1024"
                />
                <NumberField
                  label="Price"
                  value={tier.price}
                  onChange={(next) =>
                    onChange((current) => {
                      if (!("tieredOperationPricing" in current)) {
                        return current;
                      }
                      return {
                        ...current,
                        tieredOperationPricing: {
                          ...current.tieredOperationPricing,
                          tiers: current.tieredOperationPricing.tiers.map((entry, entryIndex) =>
                            entryIndex === tierIndex ? { ...entry, price: next } : entry
                          )
                        }
                      };
                    })
                  }
                />
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() =>
                      onChange((current) => {
                        if (!("tieredOperationPricing" in current)) {
                          return current;
                        }
                        return {
                          ...current,
                          tieredOperationPricing: {
                            ...current.tieredOperationPricing,
                            tiers: current.tieredOperationPricing.tiers.filter(
                              (_, entryIndex) => entryIndex !== tierIndex
                            )
                          }
                        };
                      })
                    }
                    className="rounded border border-rose-500/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {tieredOperationPricing.tiers.length === 0 && (
              <p className="text-[10px] text-text-subtle">
                Add tiers for size, quality, duration, or any other provider-billed variant.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete = "off"
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="persai-field-control w-full"
      />
    </div>
  );
}

function DerivedWeightField({ label, value }: { label: string; value: number }) {
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-[10px] font-medium text-text-muted">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        readOnly
        value={formatTokenMeteredWeight(value)}
        className="persai-field-control w-full cursor-default bg-surface-raised/80 text-text-muted"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const inputId = useId();
  const isFocusedRef = useRef(false);
  const [draft, setDraft] = useState(() => formatDecimalInputValue(value));

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(formatDecimalInputValue(value));
    }
  }, [value]);

  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-[10px] font-medium text-text-muted">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        value={draft}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (next.length > 0 && !/^[\d.,]*$/.test(next)) {
            return;
          }
          setDraft(next);
          const parsed = parseDecimalInputText(next);
          if (parsed !== null && parsed >= 0) {
            onChange(parsed);
          }
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          const parsed = parseDecimalInputText(draft);
          const final = parsed !== null && parsed >= 0 ? parsed : 0;
          onChange(final);
          setDraft(formatDecimalInputValue(final));
        }}
        aria-label={label}
        autoComplete="off"
        className="persai-field-control w-full"
      />
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        rows={5}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full resize-y rounded border border-border bg-surface-raised px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
      />
    </div>
  );
}

function JsonTextareaField<T>({
  label,
  value,
  onCommit,
  placeholder
}: {
  label: string;
  value: T;
  onCommit: (value: T) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(formatJsonField(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(formatJsonField(value));
    setError(null);
  }, [value]);

  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          try {
            const parsed = parseJsonField<T>(draft, label);
            onCommit(parsed);
            setDraft(formatJsonField(parsed));
            setError(null);
          } catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : `${label} is invalid.`);
          }
        }}
        aria-label={label}
        placeholder={placeholder}
        rows={5}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full resize-y rounded border border-border bg-surface-raised px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
      />
      {error && <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="persai-select w-full"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
