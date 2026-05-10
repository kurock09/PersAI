import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import {
  InternalRuntimeBackgroundTaskClientService,
  type InternalRuntimeBackgroundTaskEvaluationOutcome
} from "./internal-runtime-background-task.client.service";
import { readRuntimeAssignmentStateFromMaterializedLayers } from "./runtime-assignment";
import { NotificationIntentService } from "./notifications/notification-intent.service";

const IDLE_REENGAGEMENT_POLL_INTERVAL_MS = 15 * 60_000;
const IDLE_REENGAGEMENT_BATCH_SIZE = 12;
const RECENT_MESSAGE_LIMIT = 10;

// ADR-090: Maximum LLM evaluation attempts per user-message snapshot.
// After MAX_ATTEMPTS the marker is closed until the user sends a new message.
const MAX_ATTEMPTS = 2;

// ADR-090: Backoff schedule for transient errors (ms). Capped at 10 minutes.
const ERROR_BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000];

const DEFAULT_IDLE_HOURS = 24;
const DEFAULT_COOLDOWN_HOURS = 72;
const DEFAULT_LLM_INSTRUCTION = [
  "Decide whether to send a short, warm reengagement message after the user has been away.",
  "Use the recent conversation context and active open loops. Push only when it is genuinely helpful.",
  "The message must be one brief user-facing sentence, non-pushy, no guilt, no exact idle duration."
].join("\n");

// ADR-090: pg_try_advisory_xact_lock id — unique across all scheduler locks.
// Derived from: SELECT hashtext('persai-idle-reengagement-scheduler').
const IDLE_REENGAGEMENT_SCHEDULER_LOCK_ID = 5_203_916_748_291_034n;

// ADR-090: When the runtime returns 409 (session busy), defer the next
// evaluation by this many ms without burning a MAX_ATTEMPTS attempt.
const RUNTIME_SESSION_BUSY_DEFER_MS = 60_000;

// ADR-090: Outer transaction wrapping {advisory-lock, claim batch, evaluate
// candidates}. Sized to comfortably cover the longest expected runtime LLM
// call. NOTE: this transaction holds a Prisma pool connection for its entire
// duration; see "pool-vs-HTTP trade-off" comment near tick().
const SCHEDULER_TICK_TRANSACTION_TIMEOUT_MS = 10 * 60_000;

// ADR-090: Fallback used when the failed-attempt counter runs past the end of
// the explicit ERROR_BACKOFF_MS schedule (defensive — should not normally fire
// since MAX_ATTEMPTS exits the marker before we get there).
const ERROR_BACKOFF_FALLBACK_MS = 60_000;

// ADR-090: How many active "open loops" to surface to the LLM in the context
// packet. Hard cap so the prompt stays bounded regardless of memory growth.
const OPEN_LOOPS_CONTEXT_LIMIT = 5;

type IdleCandidate = {
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  surfaceThreadKey: string;
  latestUserMessageAt: Date;
  idleHours: number;
  cooldownHours: number;
  llmInstruction: string;
  existingMarkerAttempts: number;
};

@Injectable()
export class PersaiIdleReengagementSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersaiIdleReengagementSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly internalRuntimeBackgroundTaskClientService: InternalRuntimeBackgroundTaskClientService,
    private readonly notificationIntentService: NotificationIntentService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(IDLE_REENGAGEMENT_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueIdleReengagementBatch(limit = IDLE_REENGAGEMENT_BATCH_SIZE): Promise<number> {
    const batchTraceId = randomUUID();
    const candidates = await this.findDueCandidates(limit);
    for (const candidate of candidates) {
      await this.processCandidate(candidate, batchTraceId);
    }
    return candidates.length;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.scheduleNext(IDLE_REENGAGEMENT_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      // ADR-090: Single-leader guard. Only one API pod processes idle candidates
      // at a time. pg_try_advisory_xact_lock is released automatically when the
      // transaction commits or rolls back, guaranteeing no stale locks.
      //
      // Pool-vs-HTTP trade-off: this transaction stays open for the entire
      // batch — including outbound runtime LLM calls inside
      // processDueIdleReengagementBatch. That keeps the leader semantics
      // simple and lock release safe, but it pins one Prisma pool connection
      // per leader for up to SCHEDULER_TICK_TRANSACTION_TIMEOUT_MS. Batch size
      // (IDLE_REENGAGEMENT_BATCH_SIZE) is intentionally small so the pinned
      // connection count stays bounded across all three schedulers. If we
      // ever need more parallelism, the right move is to split lock
      // acquisition (short tx) from candidate processing (no tx) using a
      // dedicated lease row instead of relaxing the lock here.
      await this.prisma.$transaction(
        async (tx) => {
          const lockResult = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${IDLE_REENGAGEMENT_SCHEDULER_LOCK_ID}::bigint) AS locked
          `;
          if (!lockResult[0]?.locked) {
            return;
          }
          const processed = await this.processDueIdleReengagementBatch();
          if (processed > 0) {
            this.logger.log(`Processed ${processed} idle reengagement candidate(s).`);
          }
        },
        { timeout: SCHEDULER_TICK_TRANSACTION_TIMEOUT_MS }
      );
    } catch (error) {
      this.logger.error(
        `Idle reengagement scheduler tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      this.running = false;
      this.scheduleNext(IDLE_REENGAGEMENT_POLL_INTERVAL_MS);
    }
  }

  // ADR-090: Candidate qualification now uses AssistantIdleEvaluationMarker as
  // the primary cooldown/attempt-budget source of truth. A candidate qualifies IFF:
  //   1. latestUserMessage exists
  //   2. now - latestUserMessageAt >= idleHours
  //   3. no marker OR marker.latestUserMessageAtSnapshot < latestUserMessageAt (new message)
  //   4. marker.attemptsForCurrentUserMessage < MAX_ATTEMPTS
  //   5. marker.nextEligibleEvaluationAt IS NULL OR <= now
  //
  // The notificationIntent cooldown filter is kept as a secondary guard only.
  private async findDueCandidates(limit: number): Promise<IdleCandidate[]> {
    const policies = await this.prisma.notificationPolicy.findMany({
      where: { source: "idle_reengagement", enabled: true },
      orderBy: { updatedAt: "asc" },
      take: Math.max(1, Math.floor(limit))
    });

    const candidates: IdleCandidate[] = [];
    const now = Date.now();
    for (const policy of policies) {
      const config =
        typeof policy.config === "object" && policy.config !== null && !Array.isArray(policy.config)
          ? (policy.config as Record<string, unknown>)
          : {};
      const idleHours =
        typeof config["idleHours"] === "number" && config["idleHours"] > 0
          ? config["idleHours"]
          : DEFAULT_IDLE_HOURS;
      const cooldownHours =
        typeof config["cooldownHours"] === "number" && config["cooldownHours"] > 0
          ? config["cooldownHours"]
          : DEFAULT_COOLDOWN_HOURS;
      const llmInstruction =
        typeof config["llmInstruction"] === "string" && config["llmInstruction"].trim()
          ? config["llmInstruction"].trim()
          : DEFAULT_LLM_INSTRUCTION;

      // Pre-ADR-090 inherited bug fix (surgical, scope: this query only).
      // The previous shape `where: {}` returned the 12 globally-oldest-by-
      // updatedAt assistants regardless of whether they could possibly
      // qualify as idle. If those 12 happened to be assistants with closed
      // markers (attempts exhausted, waiting for a new user message), the
      // qualification pass would return 0 candidates and starve every
      // genuinely-idle assistant behind them tick after tick. Now we
      // pre-filter at the SQL layer to assistants that have at least one
      // non-archived chat containing a user message older than the policy's
      // idleHours threshold. The fine-grained qualification (latest user
      // message exactly, marker state, cooldown intent) continues in the
      // loop below — the holistic rewrite is scoped under ADR-091 Session 2.
      const idleCutoff = new Date(now - idleHours * 60 * 60 * 1000);
      const assistants = await this.prisma.assistant.findMany({
        where: {
          chats: {
            some: {
              archivedAt: null,
              messages: {
                some: { author: "user", createdAt: { lte: idleCutoff } }
              }
            }
          }
        },
        select: { id: true, userId: true, workspaceId: true },
        orderBy: { updatedAt: "asc" },
        take: Math.max(1, Math.floor(limit))
      });
      for (const assistant of assistants) {
        if (candidates.length >= limit) {
          return candidates;
        }
        const latestUserMessage = await this.prisma.assistantChatMessage.findFirst({
          where: {
            assistantId: assistant.id,
            author: "user",
            chat: { archivedAt: null }
          },
          orderBy: { createdAt: "desc" },
          select: {
            createdAt: true,
            chat: {
              select: {
                id: true,
                surface: true,
                surfaceThreadKey: true
              }
            }
          }
        });
        if (latestUserMessage === null) {
          continue;
        }

        // Condition 2: idle long enough
        const idleMs = now - latestUserMessage.createdAt.getTime();
        if (idleMs < idleHours * 60 * 60 * 1000) {
          continue;
        }

        // Condition 3–5: check durable marker
        const marker = await this.prisma.assistantIdleEvaluationMarker.findUnique({
          where: {
            assistantId_chatId: {
              assistantId: assistant.id,
              chatId: latestUserMessage.chat.id
            }
          },
          select: {
            latestUserMessageAtSnapshot: true,
            attemptsForCurrentUserMessage: true,
            nextEligibleEvaluationAt: true
          }
        });

        // ADR-090: When a new user message has arrived since the marker's
        // snapshot, the attempt budget is reset to zero for the new window.
        // Otherwise the marker's stored attempts apply.
        let attemptsForThisWindow = 0;
        if (marker !== null) {
          const snapshotMs = marker.latestUserMessageAtSnapshot.getTime();
          const latestMs = latestUserMessage.createdAt.getTime();

          if (snapshotMs >= latestMs) {
            // Same snapshot: check attempt budget and backoff window.
            if (marker.attemptsForCurrentUserMessage >= MAX_ATTEMPTS) {
              continue;
            }
            if (
              marker.nextEligibleEvaluationAt !== null &&
              marker.nextEligibleEvaluationAt.getTime() > now
            ) {
              continue;
            }
            attemptsForThisWindow = marker.attemptsForCurrentUserMessage;
          }
          // If snapshot < latestUserMessageAt: new user message opened a fresh
          // window → attemptsForThisWindow stays at 0.
        }

        // Secondary guard: existing active/delivered intent within cooldown window
        const cooldownSince = new Date(now - cooldownHours * 60 * 60 * 1000);
        const recentIdleIntent = await this.prisma.notificationIntent.findFirst({
          where: {
            assistantId: assistant.id,
            source: "idle_reengagement",
            createdAt: { gte: cooldownSince },
            lifecycleStatus: {
              in: ["pending", "claimed", "delivered", "deferred_quiet_hours", "deferred_rate_limit"]
            }
          },
          select: { id: true }
        });
        if (recentIdleIntent !== null) {
          continue;
        }

        candidates.push({
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId,
          chatId: latestUserMessage.chat.id,
          surface: latestUserMessage.chat.surface as "web" | "telegram",
          surfaceThreadKey: latestUserMessage.chat.surfaceThreadKey,
          latestUserMessageAt: latestUserMessage.createdAt,
          idleHours,
          cooldownHours,
          llmInstruction,
          existingMarkerAttempts: attemptsForThisWindow
        });
      }
    }
    return candidates;
  }

  private async processCandidate(candidate: IdleCandidate, batchTraceId: string): Promise<void> {
    const assistant = await this.assistantRepository.findById(candidate.assistantId);
    if (assistant === null) {
      return;
    }
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      return;
    }

    const contextPacket = await this.buildContextPacket(candidate);
    const dedupeKey = this.buildDedupeKey(candidate);
    // ADR-090: unique per-evaluation attempt id so each call runs in its own
    // synthetic runtime session and never conflicts with a parallel evaluation.
    const evaluationAttemptId = randomUUID();

    const outcome = await this.internalRuntimeBackgroundTaskClientService.evaluate({
      assistantId: candidate.assistantId,
      workspaceId: candidate.workspaceId,
      runtimeTier:
        readRuntimeAssignmentStateFromMaterializedLayers(spec.layers)?.effectiveTier ??
        "free_shared_restricted",
      runtimeBundleDocument: spec.runtimeBundleDocument,
      task: {
        id: dedupeKey,
        title: "Idle reengagement",
        brief: [
          "Decide whether PersAI should send one proactive idle reengagement notification now.",
          "Use the compact context packet. Return push only when a short, warm message would be genuinely helpful.",
          "Never mention the exact idle duration, never guilt the user, and avoid needy or sales-like language.",
          "Admin instruction:",
          candidate.llmInstruction,
          "Context packet:",
          JSON.stringify(contextPacket, null, 2)
        ].join("\n"),
        scheduleJson: null,
        pushPolicyJson: {
          source: "idle_reengagement",
          requiredOutput: {
            decision: "push | no_push | complete",
            pushText: "short warm user-facing text only when decision=push"
          }
        },
        scheduledRunAt: new Date().toISOString(),
        runCount: candidate.existingMarkerAttempts,
        lastRunStatus: null,
        lastRunAt: null,
        evaluationAttemptId
      }
    });

    await this.recordEvaluation(candidate, dedupeKey, contextPacket, outcome, batchTraceId);
  }

  private async buildContextPacket(candidate: IdleCandidate): Promise<Record<string, unknown>> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: candidate.assistantId },
      select: {
        draftDisplayName: true,
        draftTraits: true,
        user: { select: { displayName: true } },
        workspace: { select: { locale: true, timezone: true } }
      }
    });
    const recentMessages = await this.prisma.assistantChatMessage.findMany({
      where: { chatId: candidate.chatId },
      orderBy: { createdAt: "desc" },
      take: RECENT_MESSAGE_LIMIT,
      select: { author: true, content: true, createdAt: true }
    });
    const openLoops = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId: candidate.assistantId,
        kind: "open_loop",
        resolvedAt: null,
        forgottenAt: null
      },
      orderBy: { createdAt: "desc" },
      take: OPEN_LOOPS_CONTEXT_LIMIT,
      select: { summary: true, createdAt: true }
    });

    return {
      assistant: {
        id: candidate.assistantId,
        displayName: assistant?.draftDisplayName ?? null,
        voiceTraits: assistant?.draftTraits ?? null
      },
      user: {
        id: candidate.userId,
        displayName: assistant?.user?.displayName ?? null,
        locale: assistant?.workspace?.locale ?? null,
        timezone: assistant?.workspace?.timezone ?? null
      },
      idle: {
        bucket: this.toIdleBucket(candidate.latestUserMessageAt),
        latestUserMessageAt: candidate.latestUserMessageAt.toISOString(),
        cooldownHours: candidate.cooldownHours
      },
      targetThread: {
        chatId: candidate.chatId,
        surface: candidate.surface,
        surfaceThreadKey: candidate.surfaceThreadKey
      },
      recentMessages: recentMessages.reverse().map((message) => ({
        author: message.author,
        content: message.content.slice(0, 1_000),
        createdAt: message.createdAt.toISOString()
      })),
      activeOpenLoops: openLoops.map((item) => ({
        summary: item.summary,
        createdAt: item.createdAt.toISOString()
      })),
      adminInstruction: candidate.llmInstruction,
      outputSchema: {
        decision: "push | no_push | complete",
        reason: "short internal reason",
        pushText: "required only for push"
      }
    };
  }

  // ADR-090: After each evaluate(), upsert the durable marker to record the
  // attempt. State transitions:
  //   push/complete → attempts = MAX_ATTEMPTS (closed until new user message)
  //   no_push       → attempts++ (close if >= MAX_ATTEMPTS)
  //   deferred      → no attempt increment; reschedule 60s from now
  //   error         → attempts++; backoff based on attempt count
  private async recordEvaluation(
    candidate: IdleCandidate,
    dedupeKey: string,
    contextPacket: Record<string, unknown>,
    outcome: InternalRuntimeBackgroundTaskEvaluationOutcome,
    batchTraceId: string
  ): Promise<void> {
    const now = new Date();
    const snapshot = candidate.latestUserMessageAt;

    if (!outcome.ok) {
      // ADR-090: 409 busy — do not burn an attempt, just defer.
      if (outcome.deferred) {
        await this.upsertMarker({
          candidate,
          snapshot,
          lastDecision: "deferred",
          attemptsForCurrentUserMessage: candidate.existingMarkerAttempts,
          nextEligibleEvaluationAt: new Date(now.getTime() + RUNTIME_SESSION_BUSY_DEFER_MS)
        });
        return;
      }

      // Transient/permanent error — burn attempt, apply backoff.
      const newAttempts = candidate.existingMarkerAttempts + 1;
      const backoffMs =
        ERROR_BACKOFF_MS[Math.min(newAttempts - 1, ERROR_BACKOFF_MS.length - 1)] ??
        ERROR_BACKOFF_FALLBACK_MS;
      await this.upsertMarker({
        candidate,
        snapshot,
        lastDecision: "error",
        attemptsForCurrentUserMessage: newAttempts,
        nextEligibleEvaluationAt:
          newAttempts < MAX_ATTEMPTS ? new Date(now.getTime() + backoffMs) : null
      });
      this.logger.warn(
        `Idle reengagement evaluation failed for assistant ${candidate.assistantId}: ${outcome.message}`
      );
      return;
    }

    const result = outcome.result;
    const decision = result.decision;
    // ADR-090: A `push` decision is only honoured if the model actually returned
    // pushText. A blank-text "push" must not close the evaluation window —
    // otherwise a misformatted LLM response would silently consume the user's
    // entire idle window with no notification ever delivered.
    const usablePushText =
      decision === "push" &&
      typeof result.pushText === "string" &&
      result.pushText.trim().length > 0
        ? result.pushText.trim()
        : null;
    const isUsablePush = usablePushText !== null;

    if (isUsablePush || decision === "complete") {
      // Close the window — no more attempts until the user sends a new message.
      await this.upsertMarker({
        candidate,
        snapshot,
        lastDecision: decision,
        attemptsForCurrentUserMessage: MAX_ATTEMPTS,
        nextEligibleEvaluationAt: null
      });
    } else {
      // no_push, or a malformed push without pushText.
      const newAttempts = candidate.existingMarkerAttempts + 1;
      await this.upsertMarker({
        candidate,
        snapshot,
        lastDecision: decision === "push" ? "push_missing_text" : "no_push",
        attemptsForCurrentUserMessage: newAttempts,
        nextEligibleEvaluationAt: null
      });
      if (decision === "push") {
        this.logger.warn(
          `Idle reengagement push decision returned without pushText for assistant ${candidate.assistantId}; treated as no_push.`
        );
      }
    }

    if (usablePushText === null) {
      return;
    }
    const pushText = usablePushText;

    await this.notificationIntentService.createIntent({
      workspaceId: candidate.workspaceId,
      assistantId: candidate.assistantId,
      userId: candidate.userId,
      source: "idle_reengagement",
      class: "conversational",
      priority: "skippable",
      renderStrategy: "grounded_llm",
      factPayload: {
        pushText,
        decision: result.decision,
        rationale: result.rationale,
        confidence: result.confidence,
        contextPacket
      },
      dedupeKey,
      surface: candidate.surface,
      surfaceThreadKey: candidate.surfaceThreadKey,
      chatId: candidate.chatId,
      traceId: batchTraceId
    });
  }

  private async upsertMarker(input: {
    candidate: IdleCandidate;
    snapshot: Date;
    lastDecision: string;
    attemptsForCurrentUserMessage: number;
    nextEligibleEvaluationAt: Date | null;
  }): Promise<void> {
    await this.prisma.assistantIdleEvaluationMarker.upsert({
      where: {
        assistantId_chatId: {
          assistantId: input.candidate.assistantId,
          chatId: input.candidate.chatId
        }
      },
      create: {
        workspaceId: input.candidate.workspaceId,
        assistantId: input.candidate.assistantId,
        chatId: input.candidate.chatId,
        latestUserMessageAtSnapshot: input.snapshot,
        lastDecision: input.lastDecision,
        attemptsForCurrentUserMessage: input.attemptsForCurrentUserMessage,
        nextEligibleEvaluationAt: input.nextEligibleEvaluationAt
      },
      update: {
        latestUserMessageAtSnapshot: input.snapshot,
        lastDecision: input.lastDecision,
        attemptsForCurrentUserMessage: input.attemptsForCurrentUserMessage,
        nextEligibleEvaluationAt: input.nextEligibleEvaluationAt
      }
    });
  }

  private buildDedupeKey(candidate: IdleCandidate): string {
    return [
      "idle_reengagement",
      candidate.assistantId,
      candidate.chatId,
      candidate.latestUserMessageAt.toISOString()
    ].join(":");
  }

  private toIdleBucket(latestUserMessageAt: Date): string {
    const idleHours = Math.max(
      1,
      Math.floor((Date.now() - latestUserMessageAt.getTime()) / 3_600_000)
    );
    if (idleHours < 48) {
      return "24h_plus";
    }
    if (idleHours < 168) {
      return "48h_plus";
    }
    return "7d_plus";
  }
}
