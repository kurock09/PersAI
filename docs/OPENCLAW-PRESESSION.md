# OPENCLAW-PRESESSION

## Purpose

This file defines the required OpenClaw reading pack before starting a new coding session in this repository.

Goal: keep all agents aligned on runtime boundary, operating model, and session behavior.

## Mandatory pre-session pack (must-read)

1. [Gateway Architecture](https://docs.openclaw.ai/concepts/architecture.md)
2. [Session Management](https://docs.openclaw.ai/concepts/session.md)
3. [Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference.md)
4. [Gateway Security](https://docs.openclaw.ai/gateway/security/index.md)
5. [Sub-Agents](https://docs.openclaw.ai/tools/subagents.md)
6. [Default AGENTS.md](https://docs.openclaw.ai/reference/AGENTS.default.md)
7. [Transcript Hygiene](https://docs.openclaw.ai/reference/transcript-hygiene.md)

## Role-based optional reading

Read these only when the current slice needs them.

### Runtime/Ops

- [Gateway Runbook](https://docs.openclaw.ai/gateway/index.md)
- [Health Checks](https://docs.openclaw.ai/gateway/health.md)
- [Troubleshooting](https://docs.openclaw.ai/gateway/troubleshooting.md)
- [Remote Access](https://docs.openclaw.ai/gateway/remote.md)

### Channels

- [Chat Channels](https://docs.openclaw.ai/channels/index.md)
- [Telegram](https://docs.openclaw.ai/channels/telegram.md)
- [WhatsApp](https://docs.openclaw.ai/channels/whatsapp.md)
- [Channel Routing](https://docs.openclaw.ai/channels/channel-routing.md)

### Tools/Plugins

- [Tools and Plugins](https://docs.openclaw.ai/tools/index.md)
- [Skills](https://docs.openclaw.ai/tools/skills.md)
- [Building Plugins](https://docs.openclaw.ai/plugins/building-plugins.md)

### API/Providers

- [OpenAPI](https://docs.openclaw.ai/api-reference/openapi.json)
- [Provider Directory](https://docs.openclaw.ai/providers/index.md)
- [OpenAI Provider](https://docs.openclaw.ai/providers/openai.md)

## 60-second pre-session checklist

- Runtime boundary is clear: PersAI backend is control plane, OpenClaw is runtime plane.
- Current slice does not bypass draft/publish/apply lifecycle.
- No backend-domain leakage of OpenClaw internals.
- Session/tool behavior assumptions are validated against current OpenClaw docs.
- Any runtime-contract change is reflected in PersAI docs before code changes.

## Update rule

When this pack changes:

- update this file first,
- add a note in `docs/CHANGELOG.md`,
- add a note in `docs/SESSION-HANDOFF.md`,
- and keep `AGENTS.md` mandatory reading order aligned.
