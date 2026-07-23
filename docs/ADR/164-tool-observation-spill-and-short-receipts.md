# ADR-164: Tool observation spill and short receipts

## Status

**Open 2026-07-23 — docs lock after founder live diagnosis (landing / DOM
loop).** Baseline: `fa3dbc11` (`origin/main` tip at open).

Parent orchestrates, audits, and commits. Implementation and independent
audits use **`cursor-grok-4.5-high-fast` only**. Terra / Sonnet / Sol / Opus
are forbidden for ADR-164 implementation subagents.

**Delivery shape:** one program → foundation → OUT wave → IN wave → one
independent CLEAN audit → full local gate → one push/deploy → live acceptance.
No intermediate deploys. No dual serializers, silent mid-loop truncate, or
tool-specific one-off hacks.

Amends the mid-loop reading of ADR-161 “append full”: full protocol pairs
remain, but oversized **bodies** leave the wire for session spill files.
ADR-161 micro-clear (50%) and session compaction (100%) stay; ADR-143/156
remain closed and are not reopened as mid-loop dual windows. Keep ADR-164
commits separate from ADR-161 A5 evidence and ADR-162.

## Context

Live turn `267b9d13` (kimi-k3) showed ~23 tool-loop iterations of near-duplicate
“пишу лендинг…” narration while `hydratedHistoryChars ≈ 8.5M` with one history
frame ≈ **8.45M characters**. That is not “8M tokens” and not “Kimi is dumb”:
ADR-161 mid-loop append-full re-serialized a multi‑MB tool payload (typically
`files.write` **arguments** and/or large observation results) on every
iteration. Leading agent products append the **protocol** but keep large
payloads off the wire (receipt + disk).

Founder direction (2026-07-23):

- Do not “just truncate.”
- Long OUT → session temp file; model-facing history gets path + short summary.
- Long IN (e.g. HTML write body) must execute once, then history keeps a stub /
  receipt, not the blob on every replay.
- Spill files are model-addressable and **hidden from user Working Files**.
- Re-`files.read` of a spill must obey the same threshold (else the loop
  returns through read).

## Decision

### 1. Wire vs disk

| Layer | Truth |
| --- | --- |
| **Disk (session)** | Full oversized args/results may persist under `.tool-spill/` (and real write targets for `files.write`) |
| **Wire (provider `toolHistory` / prior replay)** | Only short bodies ≤ threshold **or** a **receipt** (path + summary + counts) |
| **Canonical chat `tool_exchanges`** | Store what the model saw on the wire (receipt/stub). Do not re-hydrate multi‑MB blobs into future turns |

“Append full” (ADR-161) means: append every tool-call ↔ tool-result **pair**
with honest status. It does **not** mean replaying multi‑MB JSON every round.

### 2. Receipt shape (single schema)

Model-facing oversized exchange uses one receipt family (JSON tool result
and/or stubbed arguments), including at least:

- `status`: `ok` | `error` (errors stay informative; never bare-mask)
- `tool` / optional `action`
- `bytes` or `chars`
- `path`: absolute workspace path under session `.tool-spill/` (or the real
  write path when the body already lives there)
- `summary`: 1–2 lines of meaning (≤ ~2k chars total receipt preferred)
- optional `sha256`, `truncated: true`, `spillKind: "args" | "result" | "both"`

No second ad-hoc string format per tool beyond this schema.

### 3. Thresholds (one rule)

| Constant | Value | Role |
| --- | --- | --- |
| `TOOL_WIRE_SOFT_MAX_CHARS` | **8000** | Serialized tool-result JSON or retained tool-call arguments above this → spill + receipt/stub |
| Receipt `summary` | ≤ **2000** chars | Human/model skim inside the receipt |

Small exchanges under the soft max stay full on the wire (no spill noise).

### 4. Spill path + hide from user files

```
/workspace/assistants/<assistantStableKey>/sessions/<sessionId>/.tool-spill/<requestId>/<toolCallId>.{in|out}.<ext>
```

Shared contract helper (mirror ADR-150 install-layer):

- `isToolSpillPath(path)` in `@persai/runtime-contract`
- Excluded from Working Files UI, `files.list`, `files.search`, `grep`/`glob`
  listing walks, and metadata upsert pollution — same spirit as
  `isSessionInstallLayerPath`
- Model **may** `files.read` / `preview` / targeted `grep` by exact path from
  the receipt
- Lifecycle: session-scoped; cleaned with session / idle TTL (no forever junk)

### 5. Tool coverage (audit lock — no junk scope)

#### BOTH (args stub after success + result spill when oversized)

| Tool | Notes |
| --- | --- |
| `files` | IN: stub `write.content` after success; OUT: spill oversized `read`/`preview` (and large list/search) |
| `shell` / `exec` | IN: stub huge command/heredoc after success; OUT: spill oversized stdout/stderr; background `jobRef` already receipt → leave |
| `script` | IN/OUT uncapped JSON → spill both when over threshold |

#### RECEIPT_OUT (result spill only)

| Tool | Notes |
| --- | --- |
| `browser` | `snapshot` / `act` page content + elements |
| `web_fetch` | document content (today up to 50k) |
| `knowledge_fetch` | full mode (admin ceil up to 500k) |
| `grep` / `glob` | large match/path tables |
| `knowledge_search` | when inlined document/section bodies present |
| `web_search` | only when hits/summary exceed threshold |

#### STUB_ARGS_AFTER (OUT already short)

| Tool | Notes |
| --- | --- |
| `files.write` | body already on target path |
| `document.render` | prefer `contentPath`; stub inline `content` after accept |
| `presentation` | stub large `prompt` / `outline` / `instructions` after accept |
| `tts` | stub `text` after accept |
| `image_generate` / `image_edit` | stub only if prompt/seriesItems exceed threshold; job OUT already short |

#### NONE (do not spill)

`await`, `todo_write`, `memory_write`, `skill` engage/release, media/document/
presentation/image/video **job receipts** (`pending_delivery` + `jobRef`),
short `files.attach`/`delete` acks, quota checkout acks, compaction tools
under existing caps.

#### SPECIAL

Catalog `{action:"describe"}`: keep one capped contract path; do **not** invent
a second describe channel or spill every describe by default. If a single
schema dump exceeds threshold, spill **once** with a stable receipt — no dual
describe APIs.

### 6. Re-read loop guard

`files.read` / `preview` of spill (or any large file) uses the **same** soft
max: over threshold → receipt + spill (or bounded slice), never re-inject the
full body into mid-loop history. Model reads with `maxBytes` / preview when it
needs slices.

### 7. Projection debt to reconcile (one serializer)

Today:

- Mid-loop: full sanitized exchanges (ADR-161 A1)
- Hydrate micro-clear: compactors + 600-char arg stubs
- Files sanitize: `MAX_MODEL_VISIBLE_FILES_CONTENT_CHARS = 16_000`

ADR-164 chooses **spill + short receipt** as the insert-time wire rule for
oversized bodies. Do not keep a parallel mid-body truncate that fights spill.
Hydrate micro-clear remains post-turn only (ADR-161). Remove dual mid-loop
paths.

### 8. Provider scope

All chat-routing providers (OpenAI, Anthropic, DeepSeek, Kimi). Spill is a
**runtime wire hygiene** layer before gateway serialization — not a Kimi fix.

## Non-goals

- Reopening ADR-143/156 mid-loop dual full/compact/mask windows
- Mid-loop silent char-tail truncate as the primary design
- Showing `.tool-spill/` in user Files UI
- Spilling job handles / `await` / tiny tools
- Changing async ConversationalPublish / ADR-162
- Completing ADR-161 A5 cache evidence in this ADR (re-run after wire change)

## Implementation phases

| Phase | Work |
| --- | --- |
| **P0** | This ADR + handoff/changelog/AGENTS + ADR-161 pointer amend |
| **P1** | Contract `isToolSpillPath` + spill writer + receipt builder + apply hook on tool-history insert; hide from list/search/glob/grep/Working Files |
| **P2** | OUT wave: `shell`/`exec`, `files.read`/`preview`, `web_fetch`, `knowledge_fetch`, `grep`/`glob`, `browser` snapshot/act, `script.output` |
| **P3** | IN wave: `files.write` arg stub; `document`/`presentation`/`tts`/`script.input`; image prompts if over threshold |
| **P4** | Prior-turn replay uses stored wire receipts (no resurrecting old MB blobs); focused tests |
| **P5** | Independent Grok audit CLEAN → full gate → one push → deploy → live (landing HTML + browser snapshot: no MB `hydratedHistory` frame) |

## Acceptance

1. After oversized `files.write`, next tool-loop request does **not** contain
   the HTML body in `tool_calls.arguments`.
2. Oversized browser/web_fetch/knowledge_fetch/shell/grep results appear as
   receipts with `.tool-spill/` paths.
3. `.tool-spill/` absent from user Working Files / `files.list`.
4. Model can `files.read` spill path; if still huge, gets another receipt/slice
   — not a second MB wire frame.
5. Tools in NONE list unchanged in behavior.
6. No dual mid-loop compactors left beside spill.

## Risks

- Model ignores path → receipt `summary` must be informative
- Cache prefix bytes change → ADR-161 A5 must be re-measured after deploy
- DB may still hold older full exchanges historically; wire projection must
  not revive them

## References

- Live evidence: turn `267b9d13`, gateway `provider_cache_zone`
  `hydratedHistoryChars` / `hydratedHistoryFrameChars`
- ADR-161 founder amendment (append-full + micro-clear) — wire meaning amended here
- ADR-150 install-layer hide pattern — mirror for `.tool-spill/`
- ADR-143/156 — closed; not reopened
