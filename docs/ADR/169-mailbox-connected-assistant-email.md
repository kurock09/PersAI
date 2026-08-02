# ADR-169 — Mailbox-connected assistant email (OAuth XOAUTH2)

- Status: **implemented locally 2026-08-01** (S1–S5 landed); Mail.ru and
  Yandex OAuth/connectivity have been live-exercised, and the bounded
  SMTP-permission repair is local pending verification/deploy; first
  cross-app audit repair fixed locally 2026-08-02 in `apps/api` + `apps/web`
  (`4638f1fe`, see "Audit repair"); second audit repair fixed locally
  2026-08-02 (see "Second audit repair" — deploy + S6 authenticated live
  acceptance still pending. `Admin > Tools` now renders the four
  Mail.ru/Yandex OAuth credential fields with the server-resolved redirect
  URI to register, but the founder still needs to register the OAuth
  applications with each provider and enter the resulting client id/secret
  before a real end-to-end send can be exercised).
- Date: 2026-08-01
- Supersedes: the sender-verification layer of ADR-168 only. The `email_send`
  tool, its plan/limit/audit mechanics, and the Integrations card survive.

## Context

ADR-168 shipped a working `email_send` tool: the assistant composed and sent a
real message, and it arrived. It arrived in Spam, under a "sender is not
authenticated" banner, shown as "via pm.mtasv.net".

That is not a delivery bug. ADR-168 verified the sender **address** through
Postmark Sender Signatures and then sent through the PersAI Postmark account.
Postmark therefore signs with its own domain, so for the customer's domain
neither DKIM nor SPF aligns and DMARC fails. Measured on the founder's own
domain during acceptance:

| Record for `agse.ru`     | State                                                             |
| ------------------------ | ----------------------------------------------------------------- |
| SPF                      | `include:_spf.mail.ru`, `include:spf.unisender.com` — no Postmark |
| DKIM `pm._domainkey`     | absent                                                            |
| Return-Path `pm-bounces` | absent                                                            |
| DMARC                    | `p=quarantine`                                                    |

With `p=quarantine` the receiving side is required to quarantine that message.
Any customer who enables the tool today reproduces this exactly.

The obvious remedy — Postmark domain authentication (DKIM TXT + Return-Path
CNAME) — is what ADR-168 explicitly excluded, and it is the wrong default for
this product: PersAI targets 1000+ small businesses whose DNS is typically held
by whoever built their website. Requiring every customer to become a mail
administrator before an assistant can send one email is a sales blocker, not a
setup step.

## Decisions

**D1 — Customer mail leaves through the customer's own mailbox.** The workspace
connects an existing mailbox over OAuth and PersAI sends through that
provider's SMTP with SASL XOAUTH2. The provider signs with its own
infrastructure, so authentication, alignment, and reputation are the mailbox
provider's, not ours. The sent message lands in the customer's own Sent folder
and replies arrive in their own inbox.

**D2 — Postmark keeps exactly its ADR-088 role**: the platform notification
transport for PersAI-owned mail from `persai.dev`. It is never used for
assistant-composed customer mail. `PostmarkEmailSendClientService` stays; it
backs notifications.

**D3 — v1 providers are Mail.ru and Yandex; Google is a later slice.** Both
verified against vendor documentation at opening:

| Provider | Scopes                     | SMTP endpoint              |
| -------- | -------------------------- | -------------------------- |
| Mail.ru  | `userinfo`, `mail.imap`    | `smtp.mail.ru:465` (SSL)   |
| Yandex   | `mail:smtp`, `login:email` | `smtp.yandex.ru:465` (SSL) |

Google is deferred and, when it lands, goes through the Gmail API with the
`gmail.send` scope rather than SMTP: SMTP access requires the restricted
`https://mail.google.com/` scope, whose approval demands demonstrated full
utilization of full-mailbox access that PersAI does not need and would not get.

**D4 — Sender identity is the connected mailbox.** `From` is the mailbox
address; only the display name is editable. There is no address-entry field and
no verification email, because ownership is proven by the OAuth grant itself.

**D5 — Fail-closed behaviour is unchanged from ADR-168.** With no connected
mailbox the tool performs no network call and returns `skipped` plus guidance
naming Settings → Интеграции → Email. The model-facing contract, arguments,
per-turn cap, plan daily limit, and audit event are untouched.

**D6 — Tokens reuse the existing encrypted secret store, not the Telegram
envelope.** Investigation at opening corrected two assumptions. First,
`manager: "backend_vault_kms"` is not a KMS: `PlatformRuntimeProviderSecretStoreService`
encrypts values with AES-256-GCM into a Postgres table using a key derived from
the `RUNTIME_PROVIDER_SECRETS_MASTER_KEY` env var, and its `providerKey` is an
arbitrary caller-chosen string. Second, the `persai.secretRefs.v1` envelope is
per-**assistant** and Telegram-specific (`refs.telegram_bot_token` on
`AssistantGovernance`), while the mailbox is per-**workspace**.

So OAuth refresh/access tokens are stored through
`PlatformRuntimeProviderSecretStoreService` under
`mailbox_oauth:${workspaceId}`, and their lifecycle metadata (provider, status,
expiry, last four) lives on `WorkspaceEmailSenderIdentity`. The per-assistant
`secretRefs` envelope is deliberately not extended — forcing a workspace-scoped
mailbox into an assistant-scoped envelope would invent a scope conflict.

**D7 — `WorkspaceEmailSenderIdentity` is repurposed, not replaced.** Postmark
signature columns are dropped; provider, mailbox address, display name, token
state, and connection state are added. One connected mailbox per workspace in
v1, matching ADR-168's one-sender rule.

**D11 — Two routes with deliberately opposite auth.** The connect-initiate
route is Clerk-authenticated and must be registered in
`CLERK_AUTHENTICATED_ROUTES`, or it silently answers 401 forever. The provider
redirect target is hit by Mail.ru/Yandex with no Clerk session, so it stays out
of that registry by design and authenticates itself with a single-use,
expiring `state` bound to the workspace — the same self-guarding shape the
Telegram and CloudPayments webhook controllers already use. There is no
"public route" declaration in this codebase: anything absent from the Clerk
registry is already unauthenticated, so the `state` check is the only guard
and must be written as such.

**D8 — Sending stays synchronous inside the turn** through the existing
internal API endpoint. Only the transport inside
`InternalRuntimeEmailSendService` changes.

**D10 — SMTP client.** `apps/api` has no SMTP client today (Postmark is plain
HTTP), so S3 adds `nodemailer` to `apps/api` with XOAUTH2 auth rather than
hand-rolling SASL and MIME encoding. A dependency change puts the push on the
full-CI path by the repo's own escalation rules; that is expected, not a
surprise to work around.

**D9 — Provider quota failures are reported honestly.** Provider daily limits
sit above our own `dailyCallLimit`; a provider rejection surfaces as a
`skipped` result naming the provider limit, never as a silent success.

## Removed by this ADR (S5, landed)

- `postmark-account-senders.client.ts` (Sender Signatures API) and
  `assistant-email-sender-identity.service.ts`.
- The `assistant-integrations-email-sender` controller and its four routes
  (`GET`/`POST`/`POST /resend`/`DELETE` on
  `/api/v1/assistant/integrations/email-sender`), their OpenAPI paths/schemas,
  the regenerated typed client, and their `CLERK_AUTHENTICATED_ROUTES` entries.
- The `notification/email/postmark/account-token` credential
  (`notification_email_postmark_account`) and its Admin Tools field/copy.
- The ADR-168 address-confirmation columns/enum on
  `WorkspaceEmailSenderIdentity` — `status`, `postmarkSignatureId`,
  `requestedAt`, `verifiedAt`, `WorkspaceEmailSenderIdentityStatus` — dropped
  by a hand-written migration. `email`/`displayName`/`lastErrorReason` and the
  table itself survive, repurposed for the connected mailbox.
- Address-confirmation polling and its UI/i18n in the Email card (superseded
  by the S4 mailbox-connect card).

## Non-goals

- No IMAP or mailbox reading of any kind.
- No HTML, attachments, cc/bcc, or multiple recipients — still one plain-text
  message to one recipient.
- No Postmark domain authentication path, for customers or for PersAI.
- No bulk sending, campaigns, sequences, or scheduling.
- No change to ADR-088 platform notifications.

## Slices

- **S1** (landed) — contracts, schema migration, secret-ref envelope
  extension. `WorkspaceEmailOAuthState` (single-use CSRF `state`) and the
  mailbox columns on `WorkspaceEmailSenderIdentity` (`provider`,
  `mailboxStatus`, `tokenExpiresAt`, `connectedAt`) shipped additively in
  migration `20260801160000_adr169_s1_mailbox_oauth`, alongside the four
  `MAILBOX_OAUTH_CREDENTIAL_IDS` (Mail.ru/Yandex client id + secret).
- **S2** (landed) — OAuth connect/callback/disconnect for Mail.ru and Yandex
  (`AssistantEmailMailboxService`, `HandleMailboxOAuthCallbackService`),
  including the redirect URI registration and single-use CSRF `state`
  handling; the connect-initiate/read/disconnect routes are in
  `CLERK_AUTHENTICATED_ROUTES`, the provider callback is not (D11).
- **S3** (landed) — `MailboxTokenLifecycleService` (pre-send refresh, revoked
  grant → `mailboxStatus=token_invalid`) and `MailboxSmtpSendClientService`
  (nodemailer + XOAUTH2) replaced the Postmark call inside
  `InternalRuntimeEmailSendService`; provider quota rejections map to an
  honest `skipped`, never a silent success (D9).
- **S4** (landed) — the Email integration card rebuilt around "connect
  mailbox" / connection state / disconnect, with a provider choice and a
  plain reconnect prompt for `token_invalid` instead of a generic error.
- **S5** (landed) — deleted the ADR-168 Postmark sender-signature layer:
  `PostmarkAccountSendersClientService`, `AssistantEmailSenderIdentityService`,
  the `assistant-integrations-email-sender` controller and its four routes,
  their OpenAPI paths/schemas and regenerated typed client, the
  `notification/email/postmark/account-token` credential and its Admin Tools
  copy, and the now-dead `status`/`postmarkSignatureId`/`requestedAt`/
  `verifiedAt` columns and `WorkspaceEmailSenderIdentityStatus` enum (migration
  `20260801170000_adr169_s5_drop_postmark_sender_signature_layer`). Docs
  reconciled; ADR-168 marked superseded in its sender-verification part only.
  Slice notes carried from the opening investigation: `apps/web` has no existing
  "leave to an external consent page and come back" integration flow — Telegram
  pastes a token and WhatsApp/MAX are stubs — so S4 is new UI state-machine work
  rather than a copy. And `apps/runtime` does not auto-discover tests: any new
  runtime test file must be added to the explicit `TESTS` array in
  `test/run-suite-isolated.ts` or it silently never runs, which has already
  allowed one regression to ship.

- **S6** — independent audits, full gate, one push, deploy, live acceptance:
  a real assistant-sent message that arrives in Inbox with no authentication
  warning.
- **S7 (deferred)** — Google via Gmail API `gmail.send`.

## Audit repair — 2026-08-02

Two independent audits of the S1–S5 implementation found real product gaps in
**both** `apps/api` and `apps/web`, landed in one commit (`4638f1fe`). An
earlier version of this section said the gaps were "all inside `apps/web`"
with the `apps/api` findings "covered separately" — that was false (one
commit changed both) and is corrected here; `apps/runtime` genuinely had zero
findings from either audit.

The `apps/api` side: `MailboxTokenLifecycleService.isExpiringSoon(null)` used
to read an unknown token expiry as "no evidence a refresh is needed" — an
unrevoked-but-never-refreshed mailbox could go stale forever. Flipped to treat
unknown expiry as due-for-refresh. A new per-workspace `mailbox-refresh:` lock
(reusing `SchedulerLeaseService.acquireOrCreate`, the same mechanism
`ChatWakeCoordinator` uses for `async-catchup:*`) serializes concurrent
refreshes, because both providers rotate refresh tokens on use: without it, a
losing concurrent call would present the winner's already-consumed refresh
token and get misread as a revoked grant. `markTokenInvalid` became public so
`InternalRuntimeEmailSendService` can reach the same fail-closed destination
when the SMTP layer classifies a send-time rejection as an authentication
failure.

The `apps/web` side, fixed the same commit:

- **OAuth return was silent.** The callback always redirects the browser to
  `/app/chat?mailboxConnect=success|error` (every failure mode — expired or
  replayed `state`, missing OAuth app credentials, provider rejection, an
  unresolved address — degrades to `error`), but nothing in `apps/web` read
  that parameter; a returning user landed on a bare chat screen. `chat/page.tsx`
  now reads it once on mount, reopens Settings on the Integrations section
  (reusing the existing `openSettings(section)`/`initialSection` deep-link
  mechanism — no new plumbing), does a fresh mailbox read, shows an honest
  success/failure message in the card's existing feedback line, and strips
  the param via the same one-shot `router.replace` pattern already used for
  `settings=limits` and the billing return banner.
- **"Try again" was dishonest during setup.** `handleConnectEmailMailbox` now
  distinguishes the backend's `mailbox_oauth_credentials_unavailable` code
  (thrown fail-closed while the founder has not yet registered the OAuth
  apps) from a genuine transient failure, with its own message stating that
  retrying will not help.
- **The founder had no UI to enter the OAuth credentials at all.** `Admin >
Tools` returned the four `mailbox_oauth_{mailru,yandex}_client_{id,secret}`
  credential ids from the server but rendered no section for them. A
  "Mailbox-connected email" section was added following the existing
  per-section pattern, including the exact redirect URI to register with each
  provider (below) — without this, the feature could not be turned on at all,
  regardless of S1–S5 being otherwise complete.
- **A failed status read looked identical to "not connected".** The Email
  card now renders a neutral could-not-load state with retry instead of
  falling through to the connect-a-mailbox prompt when the initial `GET`
  throws.
- **Two small honesty nits.** The collapsed card now shows the mailbox
  address in the `token_invalid` state too (not just when connected), so the
  user can tell which mailbox needs reconnecting; the Mail.ru and Yandex
  connect buttons are now both `primary`-styled (previously only Mail.ru
  was), matching D3's stated absence of a provider preference.

**Redirect URI to register with each provider** (dev):
`https://api.persai.dev/api/v1/public/integrations/email-mailbox/callback` —
`PERSAI_PUBLIC_API_BASE_URL` (`infra/helm/values-dev.yaml`:
`https://api.persai.dev`) joined with the fixed callback path resolved by
`resolveMailboxOAuthCallbackRedirectUri` in `mailbox-oauth-redirect.ts`. Now
shown in the new `Admin > Tools` section as well, so the founder does not
need to derive it from source.

**Residual, not fixed here:** the native mobile shell (ADR-075, a separate
repository) restricts in-webview navigation to an allowlist that does not
include the Mail.ru/Yandex authorization domains, so the connect redirect is
unverified on the Capacitor build. This is a mobile-shell-repo concern, not an
`apps/web` defect, and is out of this repo's fix scope.

Verification (first audit repair, `4638f1fe`): `apps/web` lint and typecheck
clean; `assistant-settings.test.tsx` (extended, 99/99) and `chat/page.test.tsx`
(extended, 16/16) pass; `prettier --check` clean on every touched source/i18n
file (the pre-existing prose in this ADR and in
`SESSION-HANDOFF.md`/`CHANGELOG.md` predates Prettier coverage of
`docs/**/*.md` and was left as-is rather than machine-reflowed). Deploy and
authenticated live acceptance (S6) remain pending; the OAuth applications
remain unregistered — this repair does not change that.

## Second audit repair — 2026-08-02

A re-audit of the `4638f1fe` repair found four more real gaps, all fixed
locally:

- **P1 — a spam/policy rejection locked out a healthy mailbox.**
  `MailboxSmtpSendClientService.isAuthRejection` classified `535` OR any
  `5.7.x` enhanced-status text as a revoked grant, but Mail.ru/Yandex both
  return `5.7.1` for ordinary content/policy/spam rejection at RCPT/DATA too.
  Reclassified on nodemailer's authoritative `err.code === "EAUTH"` (set only
  on real authentication-failure paths by `_formatError`), optionally
  corroborated by `err.command` starting with `AUTH`/`API` when supplied.
- **P1 — the founder-facing redirect URI was a duplicated frontend literal.**
  `apps/web/app/admin/tools/page.tsx` hardcoded `https://api.persai.dev` +
  the callback path instead of the server-resolved value, which is empty in
  base Helm `values.yaml` for any other environment. The Admin Tools
  credentials response now carries a server-resolved
  `mailboxOAuthRedirectUri: string | null` (added to
  `packages/contracts/openapi.yaml` — the first OpenAPI coverage for
  `/admin/runtime/tool-credentials` GET, typed client regenerated); the page
  renders that string, with an honest "not available" state when the env var
  is unset. `mailbox-oauth-redirect.ts`'s two accepted env var names are
  settled on the one wired in `infra/helm` (`PERSAI_PUBLIC_API_BASE_URL`);
  the unwired `PERSAI_API_PUBLIC_BASE_URL` fallback is deleted from that
  file only (a same-named fallback in the unrelated ADR-140 browser-bridge
  controller was left alone — different feature, not part of this finding).
- **P2 — a provider that omits `expires_in` on refresh made every send
  refresh again.** `isExpiringSoon(null)` returning `true` meant a refresh
  response that also omits `expires_in` recorded `tokenExpiresAt: null`, so
  every subsequent send would refresh again. A bounded local
  `MAILBOX_REFRESH_ASSUMED_TTL_MS` (5 minutes — explicitly a local
  assumption, never presented as provider-reported truth) is recorded
  instead.
- **P2 — the refresh-lock acquire timeout was shorter than the operation it
  waits on.** The 5s acquire timeout was shorter than the 10s provider
  refresh HTTP call it guards, so a losing concurrent sender could time out
  while the winner's own refresh would have succeeded. The acquire timeout
  is now derived from the HTTP timeout it guards plus a margin (15s).

Deploy and authenticated live acceptance (S6) remain pending; the OAuth
applications remain unregistered — this repair does not change that.

## Live Yandex OAuth repair — 2026-08-02

The first authenticated Yandex authorization completed its provider redirect
and token exchange, then failed closed at the mailbox identity lookup with
`mailbox_oauth.email_unresolved`: the initial implementation requested only
`mail:smtp`, which authorizes SMTP delivery but does not grant Yandex ID the
`default_email` field used to identify the connected mailbox. The provider
also requires multiple requested scopes to be comma-separated, while the
generic request builder had joined them with spaces.

Yandex now requests space-delimited `mail:smtp login:email`, as its official
authorization-code documentation requires. Mail.ru retains its space-delimited
`userinfo mail.imap` request,
but its `userinfo` endpoint requires `access_token` as a query parameter,
not the generic Bearer header: the first live Mail.ru authorization likewise
completed, then logged `mailbox_oauth.email_unresolved` until the transport
was corrected. Focused tests lock Yandex's scopes/delimiter and each
provider's userinfo token transport. The Yandex OAuth application must enable
both matching permissions. This repair is pending deploy and renewed
authenticated acceptance for both providers.

## Risks

- **Provider app moderation.** Mail.ru and Yandex both require a registered
  OAuth application; approval time is outside our control and gates S6.
- **Provider daily limits** are far below transactional-ESP volumes. Acceptable
  for assistant-composed mail; it is not a campaign tool.
- **User-side token revocation** must degrade to the same `skipped` + guidance
  path rather than an error.
- **Redirect URI** must be registered per environment; a mismatch fails the
  OAuth exchange with an opaque provider error.

## Orchestration

Parent agent orchestrates, audits, and commits. Implementation subagents use
`claude-sonnet-5-thinking-high`, as in ADR-168. One push at the end of the
program, after audits and the full gate. Keep ADR-169 commits separate from
ADR-161/162.
