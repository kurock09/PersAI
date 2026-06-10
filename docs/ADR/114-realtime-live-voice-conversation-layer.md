# ADR-114: ElevenLabs realtime live voice conversation

## Status

Proposed orchestration program. Baseline SHA: `643effa6` on `main`; working tree was already dirty at ADR creation time with unrelated web chat media/docs edits and the landed Slice 1 substrate. This ADR is a planning artifact only; implementation must start from an explicitly accepted baseline for the chosen slice.

This ADR has been revised twice. It first replaced an early transcript-bridge direction with an ElevenLabs-owned-conversation design. It now adopts the final target:

```text
ElevenLabs Agent      = realtime audio engine only (STT, VAD, turn-taking, interruption, TTS)
PersAI (Custom LLM)   = the single brain: existing fast streaming chat answers each spoken turn
```

The earlier "ElevenLabs built-in LLM + PersAI hidden action tool" design is **superseded**. It created two brains (ElevenLabs conversational LLM plus PersAI action backend), a lossy `intent` seam on every action, and post-session chat-context loss. The Custom LLM design removes all three: there is one brain (PersAI), every spoken turn is a real PersAI chat turn, and there is no separate action tool.

The parent agent acts as orchestrator/auditor. Implementation should be assigned to bounded GPT-5.4 subagents and audited before acceptance.

## Product Requirement

The product needs real realtime voice conversation inside the current PersAI chat:

- live audio conversation, not voice notes;
- interruption and natural turn-taking;
- short, fast answers in the user's language (the platform is bilingual ru/en);
- the saved PersAI ElevenLabs voice;
- access to the same PersAI capabilities: images, documents, files, memory, tasks, status, and visible chat persistence.

This must not become:

- `finalized transcript -> ordinary PersAI web turn -> final text -> TTS`;
- text streaming plus standalone TTS outside the realtime agent (this loses turn-taking and interruption);
- a second assistant whose business logic lives in the ElevenLabs dashboard.

## Decision

ElevenLabs Agent owns only the realtime audio engine:

- ASR/STT;
- voice activity detection and endpointing;
- turn-taking;
- interruption / barge-in;
- TTS voice output;
- the persistent realtime session/loop transport.

The Agent is configured with **Custom LLM** pointing at a PersAI endpoint. ElevenLabs does not run its own conversational brain.

PersAI is the single brain and owns everything else:

- an OpenAI-compatible streaming `chat/completions` Custom LLM endpoint that ElevenLabs calls for each spoken turn;
- mapping the live session to the correct PersAI chat/user/assistant;
- running PersAI's existing fast streaming chat turn (same persona, memory, tools) to answer;
- streaming tokens back so ElevenLabs voices the reply in realtime;
- native persistence: because each spoken turn is a real PersAI chat turn, history, memory, files, and artifacts are saved through the existing chat path;
- native actions: image/document/file/memory/task work happens through PersAI's existing tools and background jobs inside the turn, not through a separate voice action tool;
- per-session voice selection via the saved assistant `voiceProfile.elevenlabs.voiceId`.

The live voice path is:

```text
User starts live voice
  PersAI creates a live session (Slice 1 substrate) and mints an ElevenLabs credential
  ElevenLabs Agent opens the realtime audio session
    voice override: conversation_config_override.tts.voice_id = selected assistant voiceId
    language override follows the resolved user/assistant locale (ru/en)
  Loop (until stop):
    ElevenLabs does STT + endpointing + turn-taking
    On each completed user turn, ElevenLabs calls the PersAI Custom LLM endpoint (streaming)
    PersAI maps session -> chat, runs its fast streaming chat turn, streams tokens back
    ElevenLabs voices the streamed reply (TTS); user can interrupt (barge-in)
    Heavy/slow work is dispatched to existing PersAI async jobs; the turn streams a short
      spoken acknowledgement and the visible result lands in the chat asynchronously
  User stops live voice
```

Every spoken turn is an ordinary PersAI chat turn, so the chat is continuous after the session with no separate transcript bridge.

## PersAI Custom LLM Endpoint

The core integration is one PersAI endpoint, OpenAI-compatible streaming `chat/completions`, that ElevenLabs Custom LLM calls per turn. It is a **thin transport adapter only**: it forwards the spoken turn into the existing PersAI streaming chat and pipes the streamed answer back out. It must not modify, fork, or reimplement any PersAI chat logic.

Requirements:

- **Auth/binding:** authenticate the ElevenLabs request and bind it to a durable live session (Slice 1), resolving the owning chat/user/assistant server-side. Do not trust client-supplied identity.
- **Source of truth:** the PersAI chat is the source of conversation truth. Use the latest user utterance from the request as the new user turn and let the existing chat path build context, not the messages array ElevenLabs sends.
- **Reuse the brain as-is:** call the existing fast PersAI streaming chat path unchanged (same persona/prompt/memory/tool surface). Do not build a parallel prompt, history, or tool catalog, and do not edit the existing prompt, model selection, tools, memory, or persistence.
- **Just stream:** subscribe to the existing chat token stream and re-emit it in the OpenAI-compatible streaming shape ElevenLabs expects, as fast as possible.
- **Cancellation:** on barge-in/turn abort, cancel/unsubscribe promptly so the in-flight chat turn stops streaming.
- **Bounded/provider-safe:** stream only voice-appropriate assistant content; never leak provider secrets or raw internal runtime dumps over the wire.

Reused as-is (existing behavior, do not touch): the current PersAI chat path's prompt, model, tools, memory, persistence, and its existing offloading of heavy work (image/document rendering, web search, long reasoning, multi-page reading) to async jobs. The adapter neither adds nor changes them.

Deferred polish (NOT part of this slice or the core ADR path): a live-mode short prompt, a dedicated fast model, and explicit TTFT tuning. These are intentionally postponed until the whole ADR works end-to-end on the existing chat path; the live conversation must first work using the current chat path unchanged, and optimization comes later.

## Language

The conversation language follows the resolved user/assistant locale (ru or en), not a hardcoded single language. Locale resolution reuses existing PersAI locale truth. The ElevenLabs `language` override is set per session from that locale, and PersAI replies in the user's language because it is the same brain as ordinary chat.

## Persistence

Live voice results are visible in normal PersAI chat history because each spoken turn is an ordinary PersAI chat turn.

Persist (already native to the chat path):

- visible user and assistant turn messages;
- artifacts/files/images/documents produced by actions;
- honest accepted/in-progress/completed/failed statuses where useful;
- durable live session metadata needed for support/audit.

Do not persist by default:

- raw ElevenLabs realtime/control payloads;
- raw audio;
- VAD/interruption event firehose.

A separate readable full audio transcript is out of scope and would require its own explicit design.

## Transport And Relay

Direct browser/mobile -> ElevenLabs must not be the only architecture.

For private agents, current ElevenLabs docs support:

- WebRTC voice sessions using backend-minted conversation tokens;
- WebSocket sessions using backend-minted signed URLs;
- `conversation_config_override` for per-session voice/language/first-message overrides (must be enabled in the agent security settings);
- Custom LLM pointing at an external OpenAI-compatible endpoint.

Because ElevenLabs can be blocked or unreliable in Russia, PersAI must support an architecture where realtime audio/control traffic goes through a PersAI-owned relay/proxy in a reachable region such as NL/GKE/dev cluster:

```text
browser/mobile
  -> PersAI realtime relay/proxy
  -> ElevenLabs Agent (realtime audio engine)
       -> PersAI Custom LLM endpoint (brain)
```

The relay/proxy must:

- keep ElevenLabs credentials server-side;
- preserve realtime audio/control semantics;
- expose reconnect/timeout/observability hooks;
- not become another assistant brain.

If the data model/config needs to distinguish direct vs relay route, use the explicit route field from Slice 1. Do not secretly overload `webrtc` or `websocket` to mean relay.

## Cost And Quota

This ADR does not define user billing changes.

Provider-cost accounting may later record ElevenLabs realtime audio (STT/TTS) usage from provider-verified usage/duration. The PersAI Custom LLM turns are ordinary PersAI chat turns and are already covered by existing PersAI model/tool/runtime accounting; do not double-count them. Local wall-clock stop timing is support metadata, not settlement truth.

## Product UX Contract

### Mobile

- The composer keeps one voice action slot.
- Short tap switches armed mode: `mic` vs `live`.
- Long press on `mic` records the existing ordinary voice note.
- Long press on `live` starts realtime live voice. Release does not stop the session.
- The chat remains visible; no full call screen is required.
- A compact premium animation and clear `Stop` control show the active live session.

### Desktop

- Desktop gets an explicit minimal `Mic | Live` or equivalent live affordance.
- Starting live voice is deliberate.
- `Stop` is always visible during a live session.

### States

Visible states should stay sparse:

- `connecting`;
- `listening`;
- `speaking`;
- `working` (an async PersAI action is in progress);
- `recovering`;
- `unavailable`.

UI must remain disabled/hidden until the session substrate, Custom LLM endpoint, and transport paths are real.

## Non-Goals

- Replacing ordinary voice notes.
- Replacing chat TTS.
- Rebuilding PersAI tools inside the ElevenLabs dashboard.
- Running a heavy full PersAI retrieval/tool turn inline on every spoken utterance.
- Standalone text-stream-to-TTS outside the realtime agent (loses turn-taking/interruption).
- Storing raw session audio by default.
- Treating direct browser/mobile -> ElevenLabs as the only supported transport.
- A separate ElevenLabs-owned conversational brain.

## Execution Model

This is an orchestrator-run program:

1. Re-read this ADR and current handoff before each implementation slice.
2. Use GPT-5.4 implementation subagents for code.
3. Parent agent audits diffs before acceptance.
4. Update `SESSION-HANDOFF`, `CHANGELOG`, `API-BOUNDARY`, `DATA-MODEL`, and `TEST-PLAN` whenever contract/data/API truth changes.
5. Do not commit or push unless explicitly requested.

## Slice Plan

### Slice 1 — Live session substrate (landed)

**Type:** backend foundation. **Deploy:** required before UI.

Already in the working tree:

- durable `assistant_live_voice_sessions`;
- authenticated start/status/stop;
- server-side ElevenLabs credential issuance (conversation token / signed URL);
- selected `voiceProfile.elevenlabs.voiceId` snapshot;
- operator readiness settings (enabled, agentId, transportProtocol, explicit transportRoute);
- non-billing local duration/failure metadata.

No action execution, no UI, no transcript bridge.

### Slice 2 — PersAI Custom LLM endpoint

**Type:** backend vertical (core). **Deploy:** required before UI.

Add the OpenAI-compatible streaming `chat/completions` endpoint that ElevenLabs Custom LLM calls. Thin transport adapter only — no changes to PersAI chat logic, prompt, models, tools, memory, persistence, or async-job behavior:

- authenticate/bind the request to a durable live session and resolve owning chat/user/assistant;
- treat the PersAI chat as conversation source of truth; take the latest utterance as the new user turn;
- call the existing fast PersAI streaming chat path unchanged (persona/prompt/memory/tools), no parallel brain;
- re-emit the existing chat token stream in the OpenAI-compatible shape ElevenLabs expects, as fast as possible;
- cancel/unsubscribe promptly on barge-in/turn abort so the in-flight chat turn stops;
- never leak secrets or raw runtime dumps.

Reused as-is (existing behavior, untouched): the current chat prompt/model/tools/memory/persistence and its existing heavy-work-to-async-jobs offloading. Deferred polish (NOT this slice): live-mode short prompt, dedicated fast model, TTFT tuning — postponed until the ADR works end-to-end on the existing chat path.

Focused tests must prove: the endpoint calls the existing chat path (no parallel prompt/tool builder, no edits to chat logic), ordinary chat behavior is unchanged, cancellation is honored, and responses stream in the expected OpenAI-compatible shape.

### Slice 3 — Session-bound client transport config + override readiness

**Type:** backend vertical. **Deploy:** required before UI.

ElevenLabs applies per-conversation `conversation_config_override`, `custom_llm_extra_body`, and `dynamic_variables` from the CLIENT at `Conversation.startSession`, not from the server-minted token (the token only authorizes). So the server's job is to compute and return the exact session-bound config the client must apply:

- extend the `start` response with a `clientConfig` block: `agentId`, `connectionType` (from transportProtocol), `overrides` (`tts.voiceId` = snapped assistant voiceId, `agent.language` = resolved user/assistant locale via existing locale resolution), and `customLlmExtraBody = { persaiLiveVoiceSessionId }` so the Custom LLM endpoint (Slice 2) binds to the right session;
- keep server-side credential issuance (Slice 1) as-is (conversation token / signed URL);
- direct ElevenLabs WebRTC/WebSocket only for now (`transportRoute=relay` still returns the honest unavailable until the relay slice lands);
- document the operator precondition: the agent must have `platform_settings.overrides.conversation_config_override` enabled for `tts.voice_id` and `agent.language`;
- close the auth gap: the live-voice user routes (`start`/`status`/`stop`) must be in the authenticated (Clerk) route allowlist; the machine Custom LLM ingress route must stay OUT of it (it self-authenticates via the ingress secret).

This slice is backend-only and additive to the typed contract. No relay, no UI.

### Slice 4 — WebSocket relay (blocked/unreliable regions)

**Type:** backend vertical (relay embedded in `apps/api`). **Deploy:** required for RU reachability.

Decision: the relay is a **transparent WebSocket reverse proxy embedded in `apps/api`**, not a new service and not a WebRTC media relay. WebRTC/LiveKit media relaying needs TURN/SFU infrastructure and is explicitly **deferred** to a future slice; the direct WebRTC path is unchanged for reachable clients. The relay is always available as a **fallback** so the eventual client autopick (Slice 5: try direct, fall back to relay) has a target.

- WS upgrade endpoint in `apps/api` (e.g. `GET /api/v1/assistant/live-voice/relay` via the underlying HTTP server's `upgrade` event, `ws` library, `noServer` mode, path-filtered) that:
  - authenticates with a short-lived, session-bound **relay ticket** (stateless HMAC over `sessionId|userId|exp`, signed with a managed `tool/live_voice/relay_ticket/secret`; no DB column/migration), and confirms the session is still `active`;
  - mints the ElevenLabs **websocket signed URL server-side** at connect time (credentials never reach the browser) and opens the upstream WS;
  - **transparently pumps** text + binary frames in both directions; on either-side close/error, idle timeout, or max-duration it tears down both sockets and de-registers (no leaks);
- `start` additively returns `clientConfig.relay = { path, ticket, expiresAt }` whenever live voice is ready (fallback for everyone), and a `clientConfig.preferRelay` flag = true when the platform `transportRoute=relay` (primary). When `preferRelay` is true the direct ElevenLabs credential is not pre-minted (direct is presumed blocked); otherwise the direct path/credential from Slice 1-3 is byte-for-byte unchanged;
- the client opens the relay by handing the ElevenLabs JS SDK the relay URL as its websocket `signedUrl`; `conversation_initiation_client_data` (overrides + `custom_llm_extra_body.persaiLiveVoiceSessionId`) flows through the proxy unchanged;
- reconnect/timeout/observability and credential secrecy; relay must not become another assistant brain or alter chat logic.

Deferred to a later slice: WebRTC-over-relay (TURN/SFU), and the relay running as its own deploy unit if audio volume ever justifies it.

### Slice 4b — Live Voice credentials (consolidation + admin entry)

**Type:** backend + admin UI hygiene. **Deploy:** required for operator setup.

Three secrets back live voice; one is from ElevenLabs, two are PersAI-internal:

- the ElevenLabs account API key is **consolidated** onto the existing shared TTS slot `tool/tts/elevenlabs/api-key`. The separate `tool/live_voice/elevenlabs/api-key` slot is **removed** (ElevenLabs uses one account-level `xi-api-key` for both TTS and Conversational AI; the duplicate forced double entry). The live-voice ElevenLabs client now reads the TTS slot;
- `tool/live_voice/custom_llm_ingress/secret` — PersAI-generated shared secret. Configured **both** in PersAI (we verify the `Authorization: Bearer` on the Custom LLM ingress) **and** in the ElevenLabs Agent's Custom LLM "API Key" field (ElevenLabs sends it);
- `tool/live_voice/relay_ticket/secret` — PersAI-generated server-only secret used to sign relay tickets; **never** leaves PersAI / never configured in ElevenLabs;
- Admin → Tools gains a **Live Voice** section so an operator can enter the two internal secrets in the UI (they were previously catalog-registered but unsurfaced). Internal-secret fields offer client-side **generate** (CSPRNG) and **copy**, plus a short hint on where each value goes (ingress → ElevenLabs Custom LLM; relay → server-only).

### Slice 5 — Web/mobile live UX

**Type:** product UI. **Deploy:** required.

Enable the UI only after Slices 2-3 are real (relay optional per region):

- mobile `mic/live` mode switch;
- desktop live affordance;
- live overlay/animation;
- stop/recover/unavailable/working states;
- audio focus with existing voice previews/TTS;
- no regression to ordinary voice notes, text chat, streaming, or TTS.

### Slice 6 — Admin readiness + relay ingress + live UX rework (landed)

**Type:** operability + product UI + infra. **Deploy:** required.

- new admin-only readiness surface `GET/PUT /api/v1/admin/runtime/live-voice` editing only the `live_voice_settings` column (`enabled`, `agentId`, `transportProtocol`, `transportRoute`) with no provider-profile replace / config-generation bump / materialization rollout; `PUT` step-up gated under `admin.runtime_provider_settings.update`; it is an operator raw-fetch surface, intentionally not in the OpenAPI contract;
- `Admin -> Tools -> Live Voice` edits enable + Agent ID + direct/relay route next to the two internal secrets, so enabling/switching transport no longer requires a direct DB edit;
- production relay routing fix: the GCE ingress on host `persai.dev` routes `/api/v1/assistant/live-voice/relay` straight to the `api` backend (the Next.js web service proxies HTTP `/api/v1` but not WS upgrades), fixing the relay WS 1006 failure;
- live UX rework: compact non-blocking floating indicator (pulse + status + transport badge + Stop, auto-dismissing error/unavailable) instead of a full-screen overlay; composer live entry reveals on hover/focus next to the mic on desktop and stays a small persistent entry on touch (the hold-to-record voice-note gesture is untouched).

### Slice 7 — PROD hardening and smoke

**Type:** hardening. **Deploy:** required.

- concurrency/session limits;
- stale session cleanup;
- provider-cost reconciliation for ElevenLabs audio once provider truth exists (no double-count of PersAI turns);
- support metadata;
- live smoke with real ElevenLabs voice and conversation in both supported languages (ru/en);
- docs/test plan updates.

## Future Option — direct vs Custom LLM

The Custom LLM design is the primary target. If latency on the PersAI conversational path ever proves unacceptable for live voice, a fast lightweight conversational model variant (still PersAI-owned) is the mitigation, not a return to a separate ElevenLabs-owned brain. The session substrate, transport, relay, and UI slices remain valid regardless.

## Acceptance Criteria

- User can start one realtime live voice session in an existing chat.
- ElevenLabs uses the saved PersAI ElevenLabs voice via per-session override.
- The conversation runs in the user's language (ru/en).
- PersAI answers every spoken turn through its existing fast streaming chat (one brain, no second LLM).
- Interruption/barge-in and natural turn-taking work.
- Heavy actions run as native PersAI tools/jobs; visible results/artifacts land in normal chat.
- The conversation persists as ordinary PersAI chat turns; chat context is continuous after the session.
- Ordinary text chat, streaming, voice notes, TTS, voice previews, files, documents, images, and project behavior remain intact.
- Direct and relay/proxy transport paths are represented honestly.
- No separate ElevenLabs conversational brain and no separate voice action tool exist.
