# ADR-114: Realtime live voice conversation layer

## Status

Proposed orchestration program. Baseline SHA: `643effa6` on `main`; working tree was already dirty at ADR creation time with unrelated web chat media/docs edits. This ADR is a planning artifact only; implementation must start from an explicitly accepted baseline for the chosen slice.

This ADR is intended to be executed by GPT-5.4 implementation subagents. The parent agent acts as orchestrator/auditor: it assigns bounded slice prompts, reviews diffs, verifies tests, reconciles docs, and does not directly write production code for implementation slices unless the operator explicitly changes that rule.

## Context

PersAI already has a mature voice-adjacent stack:

- ordinary voice notes: web `MediaRecorder` records audio, API transcribes it, the text enters the normal chat turn, and the audio persists as a chat attachment;
- chat TTS: runtime exposes a synchronous `tts` worker tool, provider-gateway calls the configured speech provider, and delivered audio is persisted through the existing media/file flow;
- ElevenLabs chat voice: ADR-113 made ElevenLabs the primary expressive TTS quality path using `eleven_v3`, saved assistant `voiceProfile.elevenlabs.voiceId`, a curated voice catalog, and the premium voice picker;
- assistant intelligence: `TurnExecutionService` owns the PersAI-native tool loop, context hydration, memory, knowledge, image/video/document/tools, budgets, fallback, usage accounting, and persistence hooks;
- economics: provider/runtime calls already emit normalized `RuntimeBillingFacts`; API resolves provider catalog pricing and writes `model_cost_ledger_events` for supported purposes including `stt` and `tts`.

The missing product layer is not "better voice notes" and not another batch TTS path. The missing layer is a premium realtime voice conversation mode inside the current chat: one continuous live voice session where the user can speak naturally for several turns, interrupt the assistant, ask follow-ups, and command the same PersAI assistant to use tools, generate/edit media, update artifacts, and persist the result in chat history.

ElevenLabs documentation identifies the relevant product as **ElevenLabs Conversational AI / ElevenAgents**. The low-level custom integration uses `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=...` with signed URLs for private agents. The platform provides realtime ASR, turn-taking, interruptions, streaming audio, final user transcripts, agent response/correction events, VAD, contextual updates, dynamic variables, client/server tool events, and a **Speech Engine / Custom LLM** path where a custom agent exposes OpenAI-compatible streaming endpoints (`/v1/chat/completions` or `/v1/responses`).

## Decision

Build realtime live voice as an additive layer over the existing PersAI assistant stack.

The canonical architecture is:

```text
ElevenLabs Conversational AI = realtime voice engine
PersAI runtime/API = brain, context, tools, billing, history, persistence
```

Do not create a second assistant and do not duplicate PersAI tools inside ElevenLabs as a parallel source of truth. ElevenLabs owns low-latency voice transport, ASR/TTS, turn-taking, interruption, and the selected assistant voice. PersAI continues to own reasoning, context construction, tool execution, quota/billing truth, approvals, artifacts, and chat history.

A live voice session is one user-visible conversation session, but internally it contains multiple PersAI turns:

```text
Live voice session starts
  user final transcript #1 -> PersAI runtime turn #1 -> voice response/tool result/history
  user final transcript #2 -> PersAI runtime turn #2 -> voice response/tool result/history
  user final transcript #3 -> PersAI runtime turn #3 -> voice response/tool result/history
Live voice session stops
```

This preserves the current runtime lease/idempotency/persistence model while giving the user one continuous realtime conversation.

## Product UX Contract

### Mobile

- The composer keeps one voice action slot.
- Short tap switches the armed voice mode, like Telegram-style mode switching:
  - `mic` armed: ordinary voice note mode;
  - `live` armed: realtime live voice mode.
- Long press on `mic` records the existing ordinary voice note.
- Long press on `live` starts realtime live voice.
- Once live voice starts, no sheet or call screen opens. The current chat remains visible, subtly fades/softens, a custom premium realtime animation appears above the chat/composer, and a clear `Stop` control ends the session.
- The user can keep talking across multiple turns until pressing `Stop` or reaching a timeout.

### Desktop

- Desktop should not rely primarily on a hidden long-press gesture.
- The composer should expose an equally explicit but minimal `Mic | Live` affordance or a premium morphing voice control.
- Starting live voice should be a deliberate click/press on `Live`, not a modal wizard.
- The active session uses the same minimal overlay language as mobile: chat remains in context, animation indicates realtime voice activity, and `Stop` is always visible.

### Live States

The visible state language must stay calm and sparse:

- `connecting`
- `listening`
- `speaking`
- `working` for PersAI tools/actions
- `needs_approval` for risky actions
- `recovering` for reconnect/fallback
- `unavailable` for honest fallback

Do not expose noisy internal states. Do not confuse live voice with ordinary mic/voice note or existing TTS playback.

## Architecture

### Preferred Integration

Use ElevenLabs Conversational AI as the realtime speech engine with PersAI as the custom agent/LLM bridge.

The bridge should expose an OpenAI-compatible streaming endpoint backed by PersAI runtime, rather than moving PersAI tool definitions into ElevenLabs dashboard as independent business logic. If ElevenLabs requires limited client/server tools for conversation control, they must be thin bridge tools only, not duplicate implementations of PersAI `image_generate`, `files`, `document`, memory, billing, or other runtime tools.

### Session Start

API starts a live voice session for the current authenticated user/chat/assistant:

- resolve active assistant and workspace;
- verify plan/feature entitlement, concurrency, and quota preflight;
- resolve saved assistant voice profile, especially `voiceProfile.elevenlabs.voiceId`;
- build a compact session context packet: chat id, assistant id, workspace id, locale/timezone, current chat summary/last relevant turns, current files/artifacts references, plan/premium state, and voice/tool policy;
- obtain a signed ElevenLabs Conversational AI URL from server-side credentials;
- create durable session metadata for auditing, billing correlation, reconnect, and finalization.

### Runtime Turns Inside Session

Each finalized user utterance becomes a normal PersAI runtime turn with additional live voice metadata:

- channel/surface: `web_live_voice`;
- live session id and ElevenLabs conversation id;
- source transcript from ElevenLabs ASR;
- optional current VAD/interruption metadata;
- no user audio attachment by default unless product later chooses to persist session recordings;
- full model tool exposure remains governed by the existing runtime bundle/tool policy.

The runtime response is streamed back through the live voice bridge. If the turn uses tools, PersAI tool events drive the `working` / `needs_approval` live UI states and the usual chat persistence/delivery logic.

### Persistence

Live voice is not ephemeral. Every committed utterance/result must persist into the existing chat history:

- user transcript message;
- assistant response text;
- produced artifacts and files;
- tool outputs where the existing chat/tool surfaces already persist them;
- corrections for interrupted assistant speech when needed;
- session metadata sufficient for support/audit.

History should read like a normal chat after the session ends. It should not become a dump of raw audio chunks or low-level realtime events.

### Billing and Quota

Realtime voice economics must use the existing provider catalog and ledger architecture.

Add only the missing billing facts/contracts needed for live voice:

- ElevenLabs Conversational AI / Speech Engine session duration as time-metered provider usage;
- optional ElevenLabs realtime STT/Scribe fallback as `speech_to_text` time-metered usage;
- existing PersAI runtime chat/tool usage stays recorded through current `usageAccounting`, tool billing facts, and media/tool ledgers;
- avoid double charging when a transcript came from the realtime session and no fallback STT call was made;
- tie all events to workspace, assistant, user, chat, live session id, provider, model/capability, and source event id.

The ADR does not change user-facing quota semantics by itself; implementation slices must explicitly state which existing quota dimensions gate live voice and whether a new plan entitlement is required.

### Fallbacks

Fallback must be honest and product-safe:

- if live session cannot start, offer ordinary voice note fallback;
- if realtime transcript fails for a single utterance, optionally retry with ElevenLabs STT/Scribe first, then existing OpenAI STT path if configured;
- if voice output fails, keep the PersAI turn result as text and persist it;
- if PersAI runtime/tool execution fails, speak and persist the same honest error class used by chat, not a fake successful voice response.

## Non-Goals

- Replacing the existing `tts` worker tool.
- Replacing ordinary voice notes.
- Replacing PersAI runtime/tool execution with an ElevenLabs-hosted assistant.
- Duplicating PersAI tools in ElevenLabs as independent implementations.
- Rebuilding chat persistence, memory, knowledge, image/video/document tools, or billing from scratch.
- Adding raw session recording retention by default.
- Adding OpenAI Realtime API as the primary route for this feature; OpenAI Realtime may be evaluated separately, but this ADR chooses ElevenLabs Conversational AI because the product requires the saved premium assistant voice and ElevenLabs turn-taking speed.

## Execution Model

This is an orchestrator-run program. The parent agent must:

1. start each implementation session by re-reading this ADR and the current handoff/changelog;
2. launch GPT-5.4 implementation subagents with specific slice prompts;
3. require subagents to return changed files, tests, risks, and any deviations from this ADR;
4. audit produced diffs before accepting them;
5. run focused tests and the relevant AGENTS verification gate;
6. update docs/handoff/changelog in the same slice when contracts, data model, billing, or UX truth changes.

Do not create tiny PR-churn slices. Each slice below is intentionally broad enough to land a coherent vertical without duplicating logic.

## Slice Plan

### Slice 0 — Final pre-implementation design audit

**Type:** read-only + ADR refinement if needed.  
**Deploy:** no.

Confirm the exact ElevenLabs product path before code:

- Speech Engine / Custom LLM bridge vs direct WebSocket + server-side bridge;
- signed URL and private agent requirements;
- event payloads needed for transcript/audio/interruption/tool visibility;
- pricing model and provider catalog shape for Conversational AI;
- whether the selected `voiceProfile.elevenlabs.voiceId` can be applied per conversation or requires agent/voice configuration management.

Exit with a short implementation brief. If findings contradict this ADR, amend the ADR before implementation.

### Slice 1 — Provider/API session substrate, contracts, and billing foundation

**Type:** backend foundation.  
**Deploy:** required before live UI can work.

Add the shared contract and backend substrate for live voice:

- runtime-contract/API contract types for live voice session start/stop/events;
- server-side ElevenLabs signed URL creation and session metadata;
- provider-gateway or API-owned ElevenLabs Conversational AI client boundary, following existing provider isolation patterns;
- admin credential/config support for Conversational AI agent id/API key if not covered by current ElevenLabs TTS credential truth;
- provider catalog/billing facts additions for time-metered live voice and optional ElevenLabs STT fallback;
- durable session/event rows only where needed for replay-safe billing/support;
- no tool duplication and no UI feature yet.

Focused tests must cover auth, entitlement/preflight, signed URL secrecy, billing facts normalization, ledger idempotency, and failure mapping.

### Slice 2 — PersAI runtime bridge and multi-turn persistence

**Type:** backend vertical.  
**Deploy:** required.

Connect finalized live utterances to the existing PersAI turn loop:

- expose the OpenAI-compatible custom LLM/Speech Engine endpoint or equivalent bridge backed by PersAI runtime;
- map each finalized user transcript to a normal PersAI runtime turn with live session metadata;
- keep `TurnExecutionService` as the owner of context hydration, tool exposure, budgets, and tool execution;
- persist user transcript, assistant text, tool/artifact results, and interruption corrections into existing chat history;
- stream/return assistant text to the live voice layer for speech output;
- surface tool progress and approval-required states as live events without making ElevenLabs the tool system.

Focused tests must cover multi-utterance session behavior, tool calls across turns, generated artifacts, interruption correction, idempotency/retry, and chat history after session stop.

### Slice 3 — Web/mobile realtime voice UX and audio client

**Type:** product UI vertical.  
**Deploy:** required.

Implement the premium live voice entry and session UI:

- mobile short-tap `mic/live` armed-mode switch;
- mobile long-press on `mic` keeps ordinary voice note behavior;
- mobile long-press on `live` starts live voice;
- desktop minimal explicit `Mic | Live` or morphing live control;
- live animation above the existing chat, no sheet/fullscreen call UI;
- `Stop`, interruption handling, reconnect/fallback messaging, and muted/blocked states;
- audio capture/playback queue with cleanup on interruption and session close;
- no regression to existing voice note tests and no confusion with TTS playback.

Focused tests must cover mobile gesture semantics, desktop control semantics, permission denied, unavailable fallback, session stop cleanup, and ordinary voice note preservation.

### Slice 4 — PROD hardening, observability, and live smoke

**Type:** end-to-end hardening.  
**Deploy:** required.

Make the feature production-ready:

- concurrency/session limits and stale-session cleanup;
- quota/admission enforcement for live sessions and internal PersAI turns;
- error taxonomy aligned with existing chat/voice failures;
- billing reconciliation checks for realtime duration plus PersAI runtime/tool usage;
- support-friendly session metadata without storing raw audio by default;
- dashboard/admin visibility only where needed for operators;
- docs updates: architecture, API boundary, data model, test plan, changelog, handoff;
- live dev smoke for mobile and desktop using a real saved ElevenLabs assistant voice.

Exit requires focused tests, relevant typecheck/lint, and a documented manual smoke script.

## Open Questions for Slice 0

1. Can ElevenLabs Conversational AI apply the existing saved `voiceProfile.elevenlabs.voiceId` per session, or do we need an agent-per-voice/config update strategy?
2. Is Speech Engine / Custom LLM low-latency enough when PersAI runtime performs multi-tool turns, and what response timing should the voice layer speak during long tool work?
3. Which plan entitlement gates live voice: existing premium voice entitlement, a new live voice entitlement, or both?
4. Should PersAI persist optional transcript-only session summaries at stop, or rely entirely on per-utterance chat messages?
5. Which risky tool actions require visual confirmation in live voice, and can the existing approval/control surfaces be reused?

## Acceptance Criteria

- A user can start one live voice session inside an existing chat and speak through multiple turns without leaving the session.
- The selected PersAI ElevenLabs assistant voice is used for live speech.
- The assistant has the same tool capabilities as ordinary chat, subject to existing policy and approval rules.
- Results are visible in normal chat history after the session.
- Ordinary voice notes and TTS continue to work unchanged.
- Realtime voice usage and PersAI runtime/tool usage are billed through existing ledger patterns without double charging.
- Fallbacks are honest and do not pretend realtime succeeded when it did not.
- The implementation remains PersAI-native and does not introduce a second assistant/tool source of truth.
