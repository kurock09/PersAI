import { HttpException } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  ProviderGatewayHttpError,
  ProviderGatewayTimeoutError
} from "./provider-gateway.client.service";

export type NativeManagedProvider = "openai" | "anthropic";

export type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
};

const RETRYABLE_STREAM_FAILURE_CODES = new Set([
  "provider_stream_failed",
  "provider_stream_ended",
  "provider_invalid_response"
]);

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNativeManagedProvider(value: unknown): NativeManagedProvider | null {
  return value === "openai" || value === "anthropic" ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveRuntimeTextFallbackSelection(
  bundle: AssistantRuntimeBundle
): ProviderSelection | null {
  const routing = asObject(bundle.runtime.runtimeProviderRouting);
  const fallbackMatrix = Array.isArray(routing?.fallbackMatrix) ? routing.fallbackMatrix : [];
  const failureEntry = fallbackMatrix
    .map((entry) => asObject(entry))
    .find((entry) => entry?.trigger === "provider_failure_or_timeout");
  if (failureEntry?.eligible !== true) {
    return null;
  }
  const target = asObject(failureEntry.target);
  const provider = asNativeManagedProvider(target?.providerKey);
  const model = asNonEmptyString(target?.modelKey);
  return provider !== null && model !== null ? { provider, model } : null;
}

export function sameProviderSelection(
  left: ProviderSelection,
  right: ProviderSelection | null
): boolean {
  return right !== null && left.provider === right.provider && left.model === right.model;
}

export function isRetryableRuntimeTextFailure(error: unknown): boolean {
  if (error instanceof ProviderGatewayTimeoutError) {
    return true;
  }
  if (error instanceof ProviderGatewayHttpError) {
    return error.httpStatus >= 500;
  }
  if (error instanceof HttpException) {
    return error.getStatus() >= 500;
  }
  return false;
}

export function isRetryableRuntimeTextStreamFailureCode(code: string | null | undefined): boolean {
  return typeof code === "string" && RETRYABLE_STREAM_FAILURE_CODES.has(code);
}
