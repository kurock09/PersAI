import { MAILBOX_OAUTH_CREDENTIAL_IDS } from "./tool-credential-settings";

export type MailboxOAuthProviderId = "mailru" | "yandex";

export type MailboxOAuthProviderConfig = {
  id: MailboxOAuthProviderId;
  label: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  /** Field on the provider's userinfo JSON response holding the mailbox address. */
  userInfoEmailField: string;
  scopes: string[];
  /** PersAI-managed runtime secret ids, resolved via resolveSecretValueById only. */
  clientIdSecretId: string;
  clientSecretSecretId: string;
  /** Reserved for the S3 SMTP XOAUTH2 transport; unused by the S2 OAuth flow. */
  smtp: { host: string; port: number };
};

/**
 * ADR-169 D3 — the two v1 mailbox providers, verified against vendor
 * documentation at ADR opening. Kept as data so no provider-specific
 * branching leaks into the connect/callback services.
 */
export const MAILBOX_OAUTH_PROVIDERS: Record<MailboxOAuthProviderId, MailboxOAuthProviderConfig> = {
  mailru: {
    id: "mailru",
    label: "Mail.ru",
    authorizationEndpoint: "https://oauth.mail.ru/login",
    tokenEndpoint: "https://oauth.mail.ru/token",
    userInfoEndpoint: "https://oauth.mail.ru/userinfo",
    userInfoEmailField: "email",
    scopes: ["userinfo", "mail.imap"],
    clientIdSecretId: MAILBOX_OAUTH_CREDENTIAL_IDS.mailru_client_id,
    clientSecretSecretId: MAILBOX_OAUTH_CREDENTIAL_IDS.mailru_client_secret,
    smtp: { host: "smtp.mail.ru", port: 465 }
  },
  yandex: {
    id: "yandex",
    label: "Yandex",
    authorizationEndpoint: "https://oauth.yandex.ru/authorize",
    tokenEndpoint: "https://oauth.yandex.ru/token",
    userInfoEndpoint: "https://login.yandex.ru/info",
    userInfoEmailField: "default_email",
    scopes: ["mail:smtp"],
    clientIdSecretId: MAILBOX_OAUTH_CREDENTIAL_IDS.yandex_client_id,
    clientSecretSecretId: MAILBOX_OAUTH_CREDENTIAL_IDS.yandex_client_secret,
    smtp: { host: "smtp.yandex.ru", port: 465 }
  }
};

export const MAILBOX_OAUTH_PROVIDER_IDS: MailboxOAuthProviderId[] = ["mailru", "yandex"];

export function isMailboxOAuthProviderId(value: string): value is MailboxOAuthProviderId {
  return value === "mailru" || value === "yandex";
}
