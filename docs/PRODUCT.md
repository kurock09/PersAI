# PRODUCT
# PersAI Product

## Status

This document describes the intended product truth for PersAI at the current planning stage.

It is used as the product-level source of direction for implementation work in this repository.

It is not a final legal, pricing, or enterprise commitments document.  
It is the operational product description that engineering and AI coding sessions should follow unless a more specific approved ADR or slice prompt overrides a local detail.

---

## Product Summary

PersAI is a SaaS platform for personal AI assistants.

The product is not just a chat UI over an LLM.  
The product is a managed assistant platform where each user gets a persistent assistant that can be configured, published, updated, observed, and used across surfaces.

The assistant is not treated as a temporary conversation session.  
The assistant is treated as a governed product entity with lifecycle, memory policy, tools policy, channels, quotas, runtime state, and admin visibility.

PersAI uses OpenClaw as the behavior/runtime engine.  
PersAI backend remains the governance and control plane.

### Core product idea

A user should feel that they have **their own assistant**, not just access to a model.

That assistant should:
- have a recognizable personality,
- preserve continuity over time,
- use tools when useful,
- operate across supported surfaces,
- remain controllable by the user,
- remain governable by the platform,
- and remain stable under lifecycle changes like publish, rollback, reset, and platform updates.

---

## Product Vision

PersAI aims to become a platform where users can create, configure, and rely on a persistent AI assistant that feels personal, useful, and alive, while the platform remains safe, governable, and operationally manageable.

The long-term product is:
- multi-user,
- assistant-centric,
- channel-capable,
- tools-capable,
- memory-aware,
- operations-friendly,
- and extensible without rewriting the core.

The product should not evolve into a backend-controlled routing machine that destroys assistant naturalness.  
It also should not devolve into an ungoverned runtime black box that the platform cannot safely manage.

---

## Product Principles

### 1. Assistant-first product
The main object of the product is the assistant, not the raw chat session.

### 2. OpenClaw-first behavior
OpenClaw is responsible for runtime behavior:
- assistant behavior,
- memory behavior,
- tool execution,
- task/reminder execution,
- channel behavior,
- runtime/session context.

### 3. Backend-first governance
PersAI backend is responsible for:
- lifecycle,
- ownership,
- policies,
- quotas,
- billing hooks,
- secret governance,
- audit,
- rollout,
- runtime apply status,
- admin operations.

### 4. Human feeling without platform chaos
The system should feel natural and assistant-like to users, but the platform must remain observable, governable, and safe.

### 5. Draft/publish model over live mutation
Assistant changes are not applied as uncontrolled live mutations.
Users edit draft state.  
Published versions are explicit.  
Runtime application is explicit.  
Rollback and reset are explicit.

### 6. Channel-agnostic architecture
The product may launch channels in sequence, but the architecture must not become specific to a single messaging platform.

### 7. Tools are a governed system
Tools are not just a boolean list.  
They are a governed mini-system with catalog, capabilities, policy, quotas, and kill switches.

### 8. Soft user experience, explicit system truth
The product should not expose raw internals by default, but it must not hide core truth from users:
- publish/apply state,
- meaningful degradation,
- important assistant updates,
- memory controls,
- chat deletion semantics,
- and quota boundaries should all be honest.

---

## MVP Product Shape

### MVP core rule
**1 user = 1 assistant**

This is a product rule for MVP.

It does **not** mean the architecture should hardcode the assistant into the user model.  
The assistant remains its own domain entity.

### Assistant ownership model
The assistant is:
- **user-primary**
- **workspace-scoped**

That means:
- each assistant has a primary user,
- each assistant belongs to a workspace scope,
- the MVP user experience is “your assistant,”
- but the data model is future-ready for broader workspace-based evolution.

### Primary user surfaces in MVP
- Web control surface
- Web chat
- Telegram delivery/interaction surface

### Next required external channel after Telegram
- WhatsApp

### Future-ready surface model must also account for:
- MAX bot
- MAX mini-app
- system notification surfaces
- web surfaces

---

## What the User Gets

A user gets a persistent assistant they can:
- create,
- configure,
- publish,
- update,
- rollback,
- reset,
- chat with,
- connect to supported surfaces,
- and manage over time.

The user should not feel like they are repeatedly starting from zero.

The user experience should make it clear that the assistant has:
- a configuration,
- a current live state,
- memory behavior,
- tools behavior,
- limits,
- and change history.

---

## What the Product Is Not

PersAI is not:
- a thin wrapper over a single prompt,
- a generic “chat with AI” app only,
- a backend router that micromanages every tool call,
- a raw OpenClaw file editor for users,
- a one-channel bot product,
- or a platform where assistant behavior is governed by hardcoded backend branching logic.

PersAI also is not promising maximum hostile-tenant isolation by default in MVP.  
It is a real multi-user SaaS with assistant-scoped isolation and governance, but default runtime topology is pooled unless dedicated isolation is explicitly needed.

---

## Product Architecture Truth

### Control plane
PersAI backend is the control plane.

It owns:
- assistant identity,
- ownership,
- draft state,
- published versions,
- rollback/reset semantics,
- apply state,
- quotas and capabilities,
- policy envelope,
- channel/integration bindings,
- secret references,
- audit and admin control.

### Runtime plane
OpenClaw is the runtime plane.

It owns:
- behavior execution,
- runtime memory usage,
- tool execution,
- reminders/tasks/triggers execution,
- conversational flow,
- surface behavior,
- active runtime/session context.

### Important boundary rule
Backend must not reimplement OpenClaw behavior.  
OpenClaw must not become the product source of truth for lifecycle/governance.

---

## Assistant Lifecycle

The assistant lifecycle is a core product concept.

### Lifecycle states and concepts
- assistant exists as a persistent entity
- assistant has draft state
- assistant can produce immutable published versions
- runtime applies published versions
- runtime state may succeed, fail, degrade, or be rolled back

### Required lifecycle actions
- Create
- Edit draft
- Publish
- Rollback
- Reset

### Meaning of publish
Publish creates a new immutable published version.

### Meaning of apply
Apply means the runtime has attempted to accept and use the published version.

Publish and apply are not the same thing.

### Meaning of rollback
Rollback returns the assistant to a previous published version.

### Meaning of reset
Reset creates a “new assistant state” without destroying the surrounding platform attachment layer unless policy explicitly requires it.

Reset should typically preserve:
- ownership,
- billing scope,
- secret bindings,
- integration attachment layer.

Reset should typically reset:
- persona/config,
- draft,
- published state,
- runtime state,
- and memory according to policy.

---

## Persona and Character

The assistant must feel personal.

### Product rule
Character/persona is user-facing and editable, but it is not implemented as raw backend routing logic.

### Product model
- backend stores canonical persona spec
- OpenClaw executes personality in runtime
- persona is materialized into OpenClaw-native bootstrap/workspace outputs
- the product does not expose raw runtime internals as the default editing model

### User-facing editing model
The product should provide:
- a simple persona editor,
- an advanced configuration layer,
- and a controlled expert instructions layer for stronger users.

The product should not expose raw OpenClaw bootstrap files as the default UX.

---

## Memory

Memory is part of the assistant experience, but it must remain governable.

### Product memory model
PersAI uses a hybrid memory model:
- OpenClaw owns runtime memory behavior
- backend owns memory control layer

### Backend memory control layer includes
- memory policy
- audit
- provenance/source metadata
- visibility hooks
- forget/delete markers
- user controls

### Memory policy
- global memory may be read in all chats
- global memory may only be written from trusted 1:1 surfaces
- group-sourced writes to global memory are denied

### User memory controls in MVP
- Memory Center
- “Do not remember this”
- delete/forget selected memory
- basic source/type visibility

The product should give users trust and control without making memory a raw engineering console.

---

## Tools

Tools are a first-class product system.

### Product rule
OpenClaw executes tools.  
Backend governs the tool system.

### Tools must be modeled as
- tool catalog
- capability groups/classes
- policy envelope
- quotas
- per-surface allowances
- transparency level
- kill switches
- dependency/meta layer

The product must not turn backend into a tool router.

---

## Tasks, Reminders, and Triggers

Tasks are part of the assistant product, not just hidden runtime magic.

### Product model
- OpenClaw executes tasks/reminders/triggers
- backend stores meta/control layer

### Backend control layer includes
- ownership
- source/surface (metadata for user-facing Tasks Center; execution routing stays OpenClaw)
- status (control-plane labels for visibility; runtime execution state stays OpenClaw)
- enable/disable
- cancel
- commercial plan quotas **must not** use tasks/reminders/triggers as a billable dimension (see `tasks_control.commercialQuota.tasksExcludedFromPlanQuotas` in backend governance)
- audit
- visibility

### User-facing MVP
The product should include a basic Tasks Center where the user can:
- see active/inactive items,
- see next run,
- cancel or disable,
- understand status,
- understand source/surface at a basic level.

Step 6 D5 implements this as the **Tasks** section in the assistant editor (registry-backed APIs + pause / stop / turn back on).

The product should not try to become a full no-code automation builder in MVP.

---

## Channels and Surfaces

The product must not assume “one assistant = one chat surface”.

### Product architecture model
PersAI uses:
- integration provider
- surface type
- assistant binding

### Examples of supported/future surfaces
- web chat
- telegram bot
- whatsapp business
- max bot
- max miniapp
- system notifications

### MVP rollout
- Web is the primary control surface
- Web chat is the first interactive chat surface
- Telegram is the first external delivery/interaction surface
- WhatsApp is the next required channel after Telegram
- MAX must be considered in architecture now, even if not implemented yet

### Telegram in MVP
Telegram is an interaction/delivery surface, not the main assistant configuration surface.

---

## Chats and History

Chat is important, but chat is not the whole product.

### Product model
Backend stores canonical user-facing chat records:
- chat list
- messages/history
- rename/archive/delete
- retention
- ownership

OpenClaw stores:
- runtime session/context
- active conversational state

### Conversation model
There is shared assistant-level activity continuity, but surface-specific threads must remain distinct.

The product must not collapse all surfaces into one giant magical global chat.

### Chat deletion model
- Archive = remove from active list
- Delete = hard delete with confirmation

Delete should be honest.  
It should not secretly behave like archive.

---

## Web UX

### Assistant home/dashboard
The assistant home should not be just a blank chat screen.

It should show:
- assistant status
- lifecycle state
- summary of the assistant
- relevant activity/update markers
- quick paths to edit, publish, rollback, reset
- limits summary

### Editor model
The assistant editor should be section-based, not one giant page and not only a wizard.

Expected sections include:
- General / Persona
- Memory
- Tools & Integrations
- Channels
- Limits / Safety summary
- Publish history

### Setup model
The product should support both:
- Quick start
- Advanced setup

Both create or modify draft state.  
Neither bypasses lifecycle.

### Publish/apply UX
Users should see a truthful but human-friendly state model, for example:
- Draft has changes
- Publishing
- Published
- Applying
- Live
- Failed to apply
- Rollback available

---

## Transparency and Errors

### Default transparency
The product should use human-friendly transparency:
- short explanations,
- concise tool/action summary,
- no raw dumps,
- no internal chain of thought.

### Advanced transparency
More detail can be exposed in advanced modes for users and in deeper views for admins/support.

### Error model
Errors and degradation should be:
- honest,
- human,
- actionable where possible,
- not full of raw technical internals.

The system should try to degrade gracefully.

---

## Limits, Pricing Hooks, and Governance

### Limits in MVP
The product should support:
- token budget
- tool quotas
- active web chats cap

### Enforcement model
Backend is the source of truth for quotas and policy.  
OpenClaw receives and respects the allowed capability/quota envelope.

### Abuse handling
The product should support:
- backend/API rate limits
- per-user throttles
- per-assistant throttles
- channel-specific anti-flood
- quota-aware slowdown or temporary block
- admin override/unblock paths

---

## Admin and Operations

The product requires internal control surfaces, not just user-facing UI.

### Admin access model
- primary user controls their assistant
- platform admins have governed access by role
- collaborator/shared assistant access is out of MVP scope

### Admin roles
Expected role directions:
- ops admin
- business admin
- security admin
- super admin

Dangerous actions should require step-up confirmation.

### Admin product surfaces
The platform should include:
- ops cockpit
- business cockpit baseline
- append-only audit log
- system notification channel for admins

### Admin system notifications
Admins should work primarily in web, but critical system notifications should reach them in a connected notification channel.

In MVP these notifications may remain explicitly system-style rather than fully persona-styled.

---

## Platform Updates and Rollout

The platform itself will evolve over time.  
That must not break assistant trust.

### Product rule
Platform-managed layers should be separate from user-owned assistant versions.

### Update behavior
Platform updates should:
- apply automatically,
- apply softly,
- use progressive rollout,
- support rollback,
- not overwrite user draft state.

### User visibility
Users do not need to manually re-publish to receive platform improvements.  
But the product should leave a light trace when meaningful assistant updates happened.

---

## Security and Secrets

### Product secret model
Backend/vault/KMS policy is the source of truth for secret lifecycle.

OpenClaw receives runtime-resolved secret access through approved secret delivery mechanisms.

### Required properties
- rotation
- revoke
- TTL
- audit
- emergency revoke

The product must not devolve into `.env`-style ad hoc secret sprawl for multi-user assistant integrations.

---

## Compliance and Retention Baseline

MVP must still have a real baseline.

The product must define:
- privacy baseline
- retention baseline
- delete baseline
- audit baseline
- secret handling baseline

It is acceptable for MVP to stop short of full enterprise-grade compliance, but it is not acceptable to leave core data handling undefined.

---

## Implementation Truth for AI Coding Sessions

When AI coding assistants work in this repo, they should follow these product truths:

1. Build the assistant as a governed product entity.
2. Keep OpenClaw as the behavior/runtime plane.
3. Do not rebuild assistant behavior in backend.
4. Do not bypass draft/publish/apply lifecycle.
5. Do not make chat the first architectural truth.
6. Do not make Telegram the domain center.
7. Do not expose raw runtime/bootstrap internals as the default UX.
8. Do not reduce tools to random flags or reduce memory to uncontrolled runtime opacity.
9. Do not weaken admin/audit/rollout foundations once they exist.
10. Preserve prior completed slices unless the current slice explicitly requires a small, documented correction.

---

## Near-Term Execution Order

The intended near-term implementation order is:

1. Assistant Platform Core
2. Assistant User Control Surface
3. Web Chat Core
4. Memory and Tasks Control
5. Tools, Channels, and Integrations
6. Admin, Audit, and Operations
7. Hardening and Recovery

### The assistant platform must be built in this order of truth:
- lifecycle first
- materialization second
- runtime apply third
- control UI fourth
- chat fifth
- channel expansion after that

This is critical.  
The product must not become chat-first in architecture before assistant lifecycle and control-plane truth exist.

---

## Final Product Statement

PersAI is a managed platform for persistent personal AI assistants.

It combines:
- assistant identity,
- lifecycle,
- memory policy,
- tools governance,
- multi-surface delivery,
- runtime continuity,
- platform safety,
- and operational control

into a product where the assistant feels personal and alive, while the platform remains reliable, governable, and scalable.

The user should feel:
“I have my own assistant.”

The platform should be able to say:
“We know what this assistant is, what version is live, what it is allowed to do, what changed, and how to safely operate it.”