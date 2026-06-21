import { HttpException } from "@nestjs/common";
import type {
  ProviderGatewayTextErrorKind,
  ProviderGatewayTextErrorResponse,
  ProviderGatewayTextFailedEvent
} from "@persai/runtime-contract";

type NativeManagedProvider = "openai" | "anthropic" | "deepseek";

type ClassifiedProviderTextError = {
  status: number | null;
  code: string;
  message: string;
  providerErrorKind: ProviderGatewayTextErrorKind | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  providerErrorStatus: number | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStatusCode(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function normalizeForMatching(...parts: Array<string | null>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function isContextWindowExceeded(message: string | null): boolean {
  const normalized = normalizeForMatching(message);
  return (
    normalized.includes("exceeds the context window") ||
    normalized.includes("context window") ||
    normalized.includes("maximum context length") ||
    normalized.includes("too many tokens")
  );
}

function classifyProviderTextError(input: {
  status: number | null;
  code: string | null;
  type: string | null;
  message: string | null;
}): ProviderGatewayTextErrorKind {
  const normalized = normalizeForMatching(input.code, input.type, input.message);

  if (input.status === 408 || includesAny(normalized, ["timed out", "timeout"])) {
    return "timeout";
  }
  if (
    input.status === 402 ||
    includesAny(normalized, [
      "insufficient_quota",
      "insufficient_balance",
      "quota",
      "billing",
      "unpaid balance",
      "credit balance",
      "payment required"
    ])
  ) {
    return "billing_quota";
  }
  if (
    input.status === 401 ||
    input.status === 403 ||
    includesAny(normalized, [
      "authentication_error",
      "permission_error",
      "invalid_api_key",
      "api key",
      "auth",
      "credential",
      "forbidden",
      "permission",
      "account unavailable",
      "account deactivated",
      "organization_deactivated",
      "account suspended"
    ])
  ) {
    return "provider_auth";
  }
  if (
    input.status === 529 ||
    includesAny(normalized, ["overloaded_error", "overloaded", "overload", "capacity"])
  ) {
    return "capacity";
  }
  if (
    input.status === 429 ||
    includesAny(normalized, ["rate limit", "rate_limit", "too many requests"])
  ) {
    return "rate_limit";
  }
  if (
    input.status === 400 ||
    isContextWindowExceeded(input.message) ||
    includesAny(normalized, [
      "invalid_request",
      "unsupported parameter",
      "unsupported_parameter",
      "malformed",
      "schema",
      "bad request"
    ])
  ) {
    return "invalid_request";
  }
  if (input.status !== null && input.status >= 500) {
    return "server_error";
  }
  return "unknown";
}

function extractRawProviderTextError(error: unknown): {
  status: number | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  message: string | null;
} {
  const row = asObject(error);
  const nestedError =
    asObject(row?.error) ??
    asObject(row?.body) ??
    asObject(asObject(row?.body)?.error) ??
    asObject(row?.response) ??
    asObject(asObject(row?.response)?.error);
  return {
    status:
      asStatusCode(row?.status) ??
      asStatusCode(asObject(row?.response)?.status) ??
      asStatusCode(nestedError?.status),
    providerErrorCode: asNonEmptyString(nestedError?.code) ?? asNonEmptyString(row?.code),
    providerErrorType: asNonEmptyString(nestedError?.type) ?? asNonEmptyString(row?.type),
    message: asNonEmptyString(nestedError?.message) ?? asNonEmptyString(row?.message)
  };
}

function defaultProviderTextErrorCode(kind: ProviderGatewayTextErrorKind): string {
  switch (kind) {
    case "billing_quota":
      return "provider_billing_quota";
    case "rate_limit":
      return "provider_rate_limited";
    case "capacity":
      return "provider_capacity_unavailable";
    case "provider_auth":
      return "provider_auth_unavailable";
    case "invalid_request":
      return "provider_invalid_request";
    case "timeout":
      return "provider_timeout";
    case "server_error":
      return "provider_server_error";
    case "unknown":
    default:
      return "provider_request_failed";
  }
}

export function classifyProviderTextErrorFromUnknown(
  provider: NativeManagedProvider,
  error: unknown,
  fallbackMessage: string
): ClassifiedProviderTextError {
  const extracted = extractRawProviderTextError(error);
  const providerErrorKind = classifyProviderTextError({
    status: extracted.status,
    code: extracted.providerErrorCode,
    type: extracted.providerErrorType,
    message: extracted.message
  });
  const code = isContextWindowExceeded(extracted.message)
    ? "provider_context_window_exceeded"
    : (extracted.providerErrorCode ??
      extracted.providerErrorType ??
      defaultProviderTextErrorCode(providerErrorKind));
  return {
    status: extracted.status,
    code,
    message: extracted.message ?? fallbackMessage,
    providerErrorKind,
    providerErrorCode: extracted.providerErrorCode,
    providerErrorType: extracted.providerErrorType,
    providerErrorStatus: extracted.status
  };
}

export function toProviderTextHttpException(
  provider: NativeManagedProvider,
  error: unknown,
  fallbackMessage: string
): HttpException {
  const classified = classifyProviderTextErrorFromUnknown(provider, error, fallbackMessage);
  const body: ProviderGatewayTextErrorResponse = {
    error: {
      code: classified.code,
      message: classified.message,
      providerErrorKind: classified.providerErrorKind ?? null,
      providerErrorCode: classified.providerErrorCode ?? null,
      providerErrorType: classified.providerErrorType ?? null,
      providerErrorStatus: classified.providerErrorStatus ?? null
    }
  };
  return new HttpException(body, classified.status ?? 503);
}

export function toProviderTextFailedEvent(
  provider: NativeManagedProvider,
  error: unknown,
  fallbackMessage: string
): ProviderGatewayTextFailedEvent {
  const classified = classifyProviderTextErrorFromUnknown(provider, error, fallbackMessage);
  return {
    type: "failed",
    code: classified.code,
    message: classified.message,
    providerErrorKind: classified.providerErrorKind ?? null,
    providerErrorCode: classified.providerErrorCode ?? null,
    providerErrorType: classified.providerErrorType ?? null,
    providerErrorStatus: classified.providerErrorStatus ?? null
  };
}
