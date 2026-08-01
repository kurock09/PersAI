# ADR-169 — Mailbox-connected assistant email (OAuth XOAUTH2)

- Status: **open** (documentation only at opening)
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

| Provider | Scopes                  | SMTP endpoint              |
| -------- | ----------------------- | -------------------------- |
| Mail.ru  | `userinfo`, `mail.imap` | `smtp.mail.ru:465` (SSL)   |
| Yandex   | `mail:smtp`             | `smtp.yandex.ru:465` (SSL) |

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

## Removed by this ADR

- `postmark-account-senders.client.ts` (Sender Signatures API).
- The `notification/email/postmark/account-token` credential and its Admin
  field.
- Address-confirmation polling and its UI/i18n in the Email card.

## Non-goals

- No IMAP or mailbox reading of any kind.
- No HTML, attachments, cc/bcc, or multiple recipients — still one plain-text
  message to one recipient.
- No Postmark domain authentication path, for customers or for PersAI.
- No bulk sending, campaigns, sequences, or scheduling.
- No change to ADR-088 platform notifications.

## Slices

- **S1** — contracts, schema migration, secret-ref envelope extension.
- **S2** — OAuth connect/callback/disconnect for Mail.ru and Yandex, including
  the redirect URI registration and CSRF `state` handling.
- **S3** — SMTP XOAUTH2 transport with pre-send token refresh, replacing the
  Postmark call inside the internal send service.
- **S4** — Email card rebuilt around "connect mailbox", connection state, and
  disconnect.
- **S5** — deletion of the Postmark sender-signature layer and docs
  reconciliation (ADR-168 marked superseded in its sender-verification part).
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
