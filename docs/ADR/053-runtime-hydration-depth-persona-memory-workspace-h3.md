# ADR-053: Runtime hydration depth — persona, memory, per-user workspace (H3)

## Status

Accepted

## Context

H2 solved tool credential refs and quota limits. However, the assistant runtime still has critical gaps:

1. **Persona is a thin string.** PersAI sends `instructions` as `extraSystemPrompt` — a flat string injected under a misleading "Group Chat Context" header. OpenClaw has a sophisticated character system (`SOUL.md`, `IDENTITY.md`) that is completely bypassed.

2. **No per-user workspace isolation.** All PersAI users share a single OpenClaw workspace (`~/.openclaw/workspace/`). User A's `MEMORY.md` is User B's `MEMORY.md`. At pod restart, everything is lost.

3. **Memory is disconnected.** PersAI stores truncated chat summaries in `AssistantMemoryRegistryItem` (Postgres). OpenClaw has its own file-based memory system (`MEMORY.md`, `memory/YYYY-MM-DD.md`, vector search). These are completely separate — the user's Memory Center shows dead summaries, not what the assistant actually remembers.

4. **Rich UI data is lost.** Setup wizard collects traits (5 sliders), avatar, birthday, gender — but only sends a flattened `instructions` string. Structured persona data never reaches the backend.

5. **Chat history not loaded.** Messages are stored in the database but the UI never loads them when reopening an existing thread.

## Decision

### Three-layer architecture

```
PersAI DB (structured)  →  Materialization (Markdown)  →  Per-user workspace (files)
  traits: JSON                  SOUL.md                     ~/.openclaw/workspaces/persai/<id>/SOUL.md
  avatarEmoji: String           IDENTITY.md                 ~/.openclaw/workspaces/persai/<id>/IDENTITY.md
  birthday: Date                USER.md                     ...
```

1. **PersAI stores structured data** in Postgres (editable by UI): traits JSON, avatar emoji/URL, birthday, gender.

2. **Materialization generates 7 Markdown bootstrap documents** from structured DB data:
   - `SOUL.md` — persona, traits, instructions
   - `USER.md` — user context (name, birthday, timezone, locale)
   - `IDENTITY.md` — assistant name, avatar
   - `TOOLS.md` — available tools, activation status, daily limits
   - `AGENTS.md` — governance, capabilities, channels, memory/tasks policy
   - `HEARTBEAT.md` — tasks/reminders
   - `BOOTSTRAP.md` — first-run greeting (write-once)

3. **OpenClaw apply handler writes files** to a per-user workspace directory. OpenClaw's native `# Project Context` bootstrap injection reads them — no custom code needed for system prompt assembly.

### Per-user workspace isolation

Each assistant gets a dedicated workspace directory resolved from `assistantId`. The root is configurable via `PERSAI_WORKSPACE_ROOT` env var:
- Dev: `~/.openclaw/workspaces` (local filesystem)
- Prod: `/mnt/workspaces` (GCS FUSE CSI mount to `persai-agent-workspaces` bucket)

### Memory delegation

- PersAI stops writing truncated summaries to `AssistantMemoryRegistryItem`. OpenClaw's memory system owns the truth within each user's workspace.
- New OpenClaw memory management API (5 endpoints): list, add, edit, forget, search.
- PersAI Memory Center proxies to OpenClaw for full user control over what the assistant remembers.
- Users can add, edit, search, and delete memories through the UI and in-chat actions.

### `extraSystemPrompt` elimination

Replace the thin `extraSystemPrompt` string with native bootstrap file injection. OpenClaw's `loadWorkspaceBootstrapFiles` already reads `SOUL.md` and adds the "embody its persona and tone" directive. No changes needed to OpenClaw core system prompt assembly.

## Consequences

### Positive

- Each user gets an isolated sandbox — memory, persona, and workspace files are truly per-user.
- Persona is rich and natively consumed by OpenClaw through its existing character system.
- Memory is real and user-controllable — the Memory Center shows what the assistant actually knows.
- GCS FUSE provides durable, scalable storage without code changes to OpenClaw's filesystem operations.
- Bootstrap files are a natural extension of OpenClaw's existing architecture, not a custom hack.

### Trade-offs

- GCS FUSE adds latency (~5-15ms per file operation) compared to local filesystem.
- The backfill of tool activations for pre-H2 plans runs lazily on first admin list load.
- `BOOTSTRAP.md` write-once semantics require careful handling to avoid overwriting on reapply.

## Schema changes

- `AppUser`: `birthday` (Date?), `gender` (VarChar(32)?)
- `Assistant`: `draftTraits` (JsonB?), `draftAvatarEmoji` (VarChar(8)?), `draftAvatarUrl` (Text?)
- `AssistantPublishedVersion`: `snapshotTraits` (JsonB?), `snapshotAvatarEmoji` (VarChar(8)?), `snapshotAvatarUrl` (Text?)

## Out of scope

- Native mobile app
- Multi-assistant per user
- Per-category memory privacy controls (future governance extension)
- Billing/payment integration
- WhatsApp/MAX delivery (H4/H5)

## Relation to prior ADRs

- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — H3 continues P2 deeper workspace-session hydration
- [ADR-049](049-platform-admin-runtime-control-plane-phasing.md) — H3 is the next approved slice
- [ADR-052](052-tool-credential-refs-and-tool-quota-limits-h2.md) — H2 tool policies continue to work alongside H3 bootstrap files
