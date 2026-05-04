import type { PlatformRuntimeProviderKeyMetadata } from "./platform-runtime-provider-settings";

export const CLOUDPAYMENTS_API_SECRET_STORAGE_KEY = "billing_cloudpayments__api_secret" as const;
export const CLOUDPAYMENTS_PUBLIC_TERMINAL_ID_STORAGE_KEY =
  "billing_cloudpayments__public_terminal_id" as const;

export type BillingProviderKey = "cloudpayments";

export type BillingProviderCredentialStatus = {
  providerKey: BillingProviderKey;
  displayName: "CloudPayments";
  apiSecret: {
    configured: boolean;
    lastFour: string | null;
    updatedAt: string | null;
  };
  publicTerminalId: {
    configured: boolean;
    lastFour: string | null;
    updatedAt: string | null;
  };
  description: string;
};

export type AdminBillingProviderCredentialsState = {
  schema: "persai.adminBillingProviderCredentials.v1";
  providers: BillingProviderCredentialStatus[];
  notes: string[];
};

export type UpdateBillingProviderCredentialsInput = {
  providers: Partial<
    Record<
      BillingProviderKey,
      {
        apiSecret?: string;
        publicTerminalId?: string;
      }
    >
  >;
};

const MAX_KEY_LENGTH = 512;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function normalizeSecret(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new Error(`${path} must be at most ${String(MAX_KEY_LENGTH)} characters.`);
  }
  if (containsControlCharacters(trimmed)) {
    throw new Error(`${path} contains invalid control characters.`);
  }
  return trimmed;
}

export function parseUpdateBillingProviderCredentialsInput(
  body: unknown
): UpdateBillingProviderCredentialsInput {
  if (!isObject(body)) {
    throw new Error("Request body must be an object.");
  }
  const providersRaw = body.providers;
  if (!isObject(providersRaw)) {
    throw new Error("providers must be an object.");
  }

  const providers: UpdateBillingProviderCredentialsInput["providers"] = {};
  const cloudpaymentsRaw = providersRaw.cloudpayments;
  if (isObject(cloudpaymentsRaw)) {
    const apiSecret = normalizeSecret(
      cloudpaymentsRaw.apiSecret,
      "providers.cloudpayments.apiSecret"
    );
    const publicTerminalId = normalizeSecret(
      cloudpaymentsRaw.publicTerminalId,
      "providers.cloudpayments.publicTerminalId"
    );
    if (apiSecret !== undefined || publicTerminalId !== undefined) {
      providers.cloudpayments = {
        ...(apiSecret === undefined ? {} : { apiSecret }),
        ...(publicTerminalId === undefined ? {} : { publicTerminalId })
      };
    }
  } else if (cloudpaymentsRaw !== undefined && cloudpaymentsRaw !== null) {
    throw new Error("providers.cloudpayments must be an object.");
  }

  return { providers };
}

export function buildAdminBillingProviderCredentialsState(params: {
  cloudpaymentsApiSecretMetadata: PlatformRuntimeProviderKeyMetadata;
  cloudpaymentsPublicTerminalIdMetadata: PlatformRuntimeProviderKeyMetadata;
}): AdminBillingProviderCredentialsState {
  return {
    schema: "persai.adminBillingProviderCredentials.v1",
    providers: [
      {
        providerKey: "cloudpayments",
        displayName: "CloudPayments",
        apiSecret: {
          configured: params.cloudpaymentsApiSecretMetadata.configured,
          lastFour: params.cloudpaymentsApiSecretMetadata.lastFour,
          updatedAt: params.cloudpaymentsApiSecretMetadata.updatedAt
        },
        publicTerminalId: {
          configured: params.cloudpaymentsPublicTerminalIdMetadata.configured,
          lastFour: params.cloudpaymentsPublicTerminalIdMetadata.lastFour,
          updatedAt: params.cloudpaymentsPublicTerminalIdMetadata.updatedAt
        },
        description:
          "CloudPayments widget public terminal id is exposed only through checkout payloads; API Secret stays server-only for trusted webhook verification and billing API work."
      }
    ],
    notes: [
      "Billing provider secrets are managed globally for the active PersAI billing path.",
      "Raw billing secrets are write-only and stored encrypted in PersAI.",
      "CloudPayments API Secret is required for trusted webhook verification.",
      "CloudPayments Public Terminal ID is required for the production widget checkout path."
    ]
  };
}
