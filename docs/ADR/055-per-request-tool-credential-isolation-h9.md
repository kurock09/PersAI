# ADR-055: Per-request tool credential isolation via AsyncLocalStorage (H9)

## Status
Accepted

## Context
PersAI materializes per-assistant tool credentials (Tavily, Firecrawl, OpenAI
image/TTS/embeddings API keys) into `openclawBootstrap.governance.toolCredentialRefs`.
At chat time the OpenClaw Gateway resolves these refs, then **injects them into
`process.env`** before each agent turn and deletes them in `finally`.

`process.env` is a single mutable object shared by the entire Node.js process.
When two concurrent agent turns write different values to `process.env.TAVILY_API_KEY`,
the later write silently overwrites the earlier one. At 1000+ concurrent users this
produces:

- **Credential cross-leak** — User A's request reads User B's API key.
- **Billing mismatch** — quota is charged against the wrong subscription.
- **Tool failures** — `finally` of one turn deletes the key mid-flight for another.

A partial precedent already exists: H7b moved `PERSAI_TOOL_DENY` and `workspaceDir`
into `persaiRuntimeRequestContext` (an `AsyncLocalStorage<PersaiRuntimeRequestCtx>`
instance in `src/agents/persai-runtime-context.ts`), eliminating the same race for
the tool deny list.

### Audit findings (pre-change)

| Env var | Set by PersAI runtime | Read by OpenClaw tool code | Race? |
|---|---|---|---|
| `TAVILY_API_KEY` | Yes | `extensions/tavily/src/config.ts` | **Yes** |
| `FIRECRAWL_API_KEY` | Yes | `extensions/firecrawl/src/config.ts`, `src/agents/tools/web-fetch.ts` | **Yes** |
| `OPENAI_IMAGE_GEN_API_KEY` | Yes | nowhere | Dead injection |
| `OPENAI_TTS_API_KEY` | Yes | nowhere | Dead injection |
| `OPENAI_EMBEDDINGS_API_KEY` | Yes | nowhere | Dead injection |
| `PERSAI_AGENT_WORKSPACE_DIR` | Yes | Already covered by context (H8k) | Redundant |

## Decision
1. Extend `PersaiRuntimeRequestCtx` with `toolCredentials?: Map<string, string>`.
2. Expose `getPersaiToolCredential(envVar)` helper from a new
   `openclaw/plugin-sdk/persai-credential` subpath so extensions can import it
   without violating the `no-src-outside-plugin-sdk` lint boundary.
3. Stop mutating `process.env` in `persai-runtime-agent-turn.ts` — pass
   `resolvedToolCredentials` through the `runtimeCtx` bag into
   `persaiRuntimeRequestContext.run()`.
4. Patch the three credential resolution sites (Tavily config, Firecrawl config,
   web-fetch) to read `getPersaiToolCredential(…)` before falling back to
   `process.env` (CLI-mode compatibility).
5. Remove the now-unnecessary `injectToolCredentials`, `cleanupInjectedEnv`
   functions and `PERSAI_AGENT_WORKSPACE_DIR` save/restore (already in context).

## Consequences
### Positive
- Zero shared mutable state for credentials — safe at any concurrency level.
- Consistent pattern: toolDenyList, workspaceDir, and toolCredentials all live
  in the same per-request context.
- `finally` blocks collapse to nothing (sync/telegram) or stream-only cleanup.
- Dead `OPENAI_*` injections no longer pollute `process.env`.

### Negative
- Extensions must import a new plugin-sdk subpath to read per-request
  credentials; adds one lightweight dependency to the resolution chain.
- Non-PersAI CLI still falls back to `process.env`, so the `process.env` reads
  remain (harmless — CLI is single-user, no concurrent turns).

## Alternatives considered
- **Mutex/lock per assistant** — blocks concurrency, defeats async model.
- **Worker threads per request** — heavy overhead, breaks shared config.
- **Proxy `process.env`** — fragile ES Proxy hack, global side-effects.
