# ADR-066: Telegram Tier-Aware Ingress Proxy

## Status

Accepted

## Context

Telegram delivers bot webhooks to a single URL per assistant (`https://bot.persai.dev/telegram-webhook/{assistantId}`). The GKE Ingress rule for `bot.persai.dev` was hardcoded to route ALL webhook traffic to the `openclaw-free-shared-restricted-sandbox` service regardless of the assistant's runtime tier.

This means:

- grammY bot instances for all tiers (free, paid, isolated) live in free-shared pod memory.
- Telegram media downloads consume free-shared pod resources even for paid/isolated users.
- Free-shared pod OOM or restart takes down Telegram for all users.
- The tier separation that exists for web-chat, cron, media, and internal API calls does not apply to the Telegram channel entry point.

The LLM agent turn itself was already tier-aware (PersAI API resolves tier and routes `sendChannelTurn` to the correct pool), but the webhook reception, bot lifecycle, owner gating, and media handling were all pinned to free-shared.

## Decision

PersAI API acts as a transparent reverse proxy for Telegram webhooks:

1. GKE Ingress routes `bot.persai.dev/telegram-webhook` to the PersAI API service (`api:3001`) instead of any OpenClaw pool.
2. A new `TelegramWebhookProxyController` receives the raw Telegram update, extracts `assistantId` from the path, resolves the effective runtime tier from the materialized spec, and forwards the complete HTTP request (body + headers) to the correct OpenClaw pool's `/telegram-webhook/{assistantId}` endpoint.
3. OpenClaw pods continue to handle `/telegram-webhook/{assistantId}` identically — grammY, owner gate, media, turn request — they just receive traffic from the API proxy instead of directly from GKE Ingress.

This is a PersAI-only transport/ingress fix. No OpenClaw code changes are needed.

## Alternatives considered

**Per-tier Ingress rules**: Not feasible because Telegram registers a single webhook URL per bot. The URL contains `assistantId`, not tier. Tier resolution requires a database lookup that GKE Ingress cannot perform.

**Dedicated Telegram gateway service**: Adds operational complexity (new deployment, service, monitoring) for the same logic the API already has. Not justified at current scale.

**Accept current architecture**: Fails at 200+ Telegram-connected assistants as grammY instances exhaust free-shared pod memory, and a single pod failure affects all tiers.

## Consequences

- One additional network hop per Telegram webhook (~5-10ms). Telegram allows up to 60s response time.
- PersAI API pod receives Telegram webhook traffic. The proxy is stateless byte-forwarding; no parsing, no LLM, no DB writes beyond tier lookup.
- Telegram bots do not need re-registration. The external webhook URL (`https://bot.persai.dev/telegram-webhook/{assistantId}`) is unchanged.
- grammY bot instances now run on the correct tier pod. Free-shared pod only manages free-tier Telegram bots.
- The stale note "Telegram/webhook ingress follows the active free shared physical pool during cutover" in `runtime-tier-security-policy.ts` is removed.
