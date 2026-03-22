# НЕ УТВЕРЖДЕННЫЙ ПЛАН

> Статус: **Draft / Не утверждено**
>  
> Документ фиксирует согласованное рабочее видение по PersAI x OpenClaw и не является финальным архитектурным решением до отдельного утверждения.

## 1) Цель

Построить SaaS платформу персональных ассистентов, где:

- 1 пользователь = 1 ассистент (MVP).
- Ассистент работает 24/7.
- Поведение, память, инструменты и каналовые механики максимально остаются в OpenClaw.
- Backend управляет тарифами, лимитами, безопасностью, lifecycle и операциями.

## 2) Принципы

- **OpenClaw-first behavior:** persona, память, tool execution, channel behavior.
- **Backend-first governance:** billing, quota policy, secrets, orchestration, admin ops.
- Backend не переписывает ответы ассистента, а задает policy-рамки.
- Изменения конфигов/шаблонов идут через versioned publish + rollback.

## 3) Scope

### MVP

- Onboarding ассистента: quick start + advanced.
- Create/Edit/Publish/Reset.
- Web Chat как основная пользовательская зона.
- Telegram integration.
- Тарифы и лимиты: токены + tools + active web chats.
- Admin console (ops + business).

### После MVP (обязательно)

- Multi-channel expansion после Telegram.
- Следующий обязательный канал: WhatsApp.
- Архитектура сразу channel-agnostic, чтобы не делать форки логики на каждый канал.

## 4) Runtime и изоляция

- Принята модель **A (hybrid)**:
  - dedicated слой (container-per-user),
  - pooled слой (shared workers).
- Pod-per-user не обязателен по умолчанию, применяется при top/enterprise требованиях.

## 5) Workspace и bootstrap

- Каноника профиля/политик хранится в backend.
- Runtime получает материализованную workspace-копию для OpenClaw.
- Наполнение bootstrap: данные пользователя + системные шаблоны PersAI.
- Модель: backend как source-of-truth шаблонов, runtime как совместимый материализатор.

## 6) Env и secrets (multi-user)

- `.env` используется только для платформенных значений (DB, queue, observability, KMS и т.п.).
- Пользовательские секреты (channel/provider tokens) не хранятся в `.env` и не попадают во frontend.
- Source-of-truth секретов: backend vault/KMS.
- OpenClaw получает секреты через SecretRef-подход (предпочтительно `exec`, fallback `file`, локально `env`).
- Применение секретов должно быть fail-fast на активных поверхностях и с понятной диагностикой.
- Для каждого ассистента используется изолированный namespace секретов (tenant/user/assistant scope).
- Обязательны rotation/revoke/TTL/audit и emergency revoke flow.
- В логах и аудитах хранятся только идентификаторы/фингерпринты секретов, но не их значения.

## 7) Память и человечность

- Global memory читается во всех чатах.
- Запись в global memory: только Web Chat + Direct.
- Запись из групп в глобальную память: deny.
- В UI: Memory Center + быстрый action "Do not remember this".
- Reasoning/internal chain пользователю не показывается.

## 8) Tool clarity

- Default: human-friendly прозрачность (краткий лог 1-2 шага, без raw dumps).
- Ошибки tools: эмпатичный ответ + предложенное действие.
- Advanced transparency доступна пользователю.
- Debug-детализация для админов.

## 9) Тарифы и лимиты

- Source-of-truth тарифов: backend.
- Лимиты:
  - tokens budget,
  - tool quotas (voice/image/search/tasks),
  - active web chats cap.
- Порог "активного чата" задается админом (N дней).
- При достижении chat cap: блок создания нового чата + понятная подсказка.

## 10) Пользовательский UI

- Стиль: гибрид (SaaS clarity + эмоциональные ассистентные зоны).
- Главный блок dashboard: состояние ассистента.
- Web chat list в стиле GPT: rename/archive/delete + дата создания.
- Delete чата: hard delete с подтверждением.
- Messenger-зона: отдельный блок; Telegram группы в user UI не отображаются и не читаются.
- Лимитные предупреждения: web + канал.

## 11) Админка

- Cockpit: ops + business.
- Realtime: stream для критичных метрик, polling для остального.
- Runbook actions: pause/resume, restart runtime, reapply policy.
- Опасные действия: step-up подтверждение.
- Topology view: dedicated/pool.
- Global feature kill switches.
- Immutable append-only audit log.
- У каждого админа есть личный ассистент и обязательный канал системных уведомлений.

## 12) Инциденты и надежность

- Auto-restart + auto-degrade + alerts.
- Multi-provider fallback matrix.
- User-facing incident communication: статус в UI и канале.
- Progressive rollout policy changes (5% -> 25% -> 100%) + rollback.

## 13) Риски (утвержденные подходы)

- Unit economics: полный COGS.
- Abuse: rate limits + anti-flood + auto-throttle.
- Billing edge cases: prorate + mid-cycle transitions.
- Compliance baseline с MVP: privacy/toS/retention/delete/audit.
- Recovery/ownership transfer: формализованные flow.
- Quality drift: eval gates перед rollout.
- Secret lifecycle: centralized rotation/revoke/TTL/audit + emergency revoke.

## 14) Этапы

1. Governance contracts (policy schema, RBAC, audit contract).
2. Assistant lifecycle core (create/edit/reset/publish/rollback).
3. Runtime apply pipeline и health state model.
4. Quotas + billing enforcement.
5. User web chat UX + memory controls.
6. Telegram integration flow.
7. Admin ops console.
8. Quality gates + progressive rollout.
9. Security/recovery hardening (включая secrets lifecycle).
10. Multi-channel expansion (WhatsApp first).

## 15) Критерии готовности MVP

- Пользователь создает ассистента и получает value быстро.
- Edit/publish предсказуемы, rollback работает.
- Reset создает "нового" ассистента без потери интеграций.
- Память работает по policy (global read, group write deny).
- Секреты не хранятся в пользовательских `.env`; применяются через централизованный secret lifecycle.
- Лимиты прозрачны пользователю и управляемы админом.
- Админка дает возможность быстро стабилизировать инцидент.
- Все критичные действия аудируются.

---

**Документ остается неутвержденным до отдельного решения о принятии.**
