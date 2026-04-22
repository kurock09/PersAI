import { Injectable, Logger } from "@nestjs/common";
import type { AssistantPreferredNotificationChannel as PrismaPreferredNotificationChannel } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

// ADR-074 Slice T2 — auto-route T1 pushes to first-bound notification channel.
//
// Channels we are willing to auto-select. Mirrors the
// `AssistantPreferredNotificationChannel` enum minus the `web` default
// (which is the value we are *promoting away from*). Today only `telegram`
// has a bind flow that calls this helper; `whatsapp` is included so that
// when the WA bind lands it can call the same helper without changes here.
const AUTO_SELECTABLE_CHANNELS = new Set<PrismaPreferredNotificationChannel>([
  "telegram",
  "whatsapp"
]);

export type AutoSelectNotificationChannelDecisionReason =
  /** D-marker was NULL and current channel differed; promotion happened. */
  | "auto_set"
  /** D-marker already non-NULL — user has made an explicit choice we honor. */
  | "already_chosen"
  /**
   * D-marker was NULL but `preferredNotificationChannel` already equals the
   * binding channel (e.g. backfill ran first, or a manual prior set without
   * timestamp via legacy code path). We still write `chosenAt` so the next
   * call short-circuits on `already_chosen`, but no channel change.
   */
  | "channel_already_matches"
  /** Helper called for an assistantId that does not exist. Best-effort no-op. */
  | "assistant_not_found";

export interface AutoSelectNotificationChannelOnBindRequest {
  assistantId: string;
  bindingChannel: PrismaPreferredNotificationChannel;
}

export interface AutoSelectNotificationChannelOnBindResult {
  changed: boolean;
  reason: AutoSelectNotificationChannelDecisionReason;
}

@Injectable()
export class AutoSelectNotificationChannelOnBindService {
  private readonly logger = new Logger(AutoSelectNotificationChannelOnBindService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async execute(
    request: AutoSelectNotificationChannelOnBindRequest
  ): Promise<AutoSelectNotificationChannelOnBindResult> {
    if (!AUTO_SELECTABLE_CHANNELS.has(request.bindingChannel)) {
      // Belt-and-suspenders: callers should never pass `web` here. If they
      // do, treat as no-op (we can't "promote" to the default).
      this.logger.warn(
        `AutoSelectNotificationChannelOnBind called with non-promotable channel "${request.bindingChannel}" for assistant ${request.assistantId}; ignoring.`
      );
      return { changed: false, reason: "already_chosen" };
    }

    const assistant = await this.prisma.assistant.findUnique({
      where: { id: request.assistantId },
      select: {
        preferredNotificationChannel: true,
        preferredNotificationChannelChosenAt: true
      }
    });
    if (assistant === null) {
      // Best-effort: a missing assistant during a bind flow is a real bug
      // elsewhere, but it must not roll back the bind itself. Log and bail.
      this.logger.warn(
        `AutoSelectNotificationChannelOnBind: assistant ${request.assistantId} not found; skipping auto-select.`
      );
      return { changed: false, reason: "assistant_not_found" };
    }

    if (assistant.preferredNotificationChannelChosenAt !== null) {
      return { changed: false, reason: "already_chosen" };
    }

    const now = new Date();
    // ADR-074 Slice T2 hard constraint: conditional update via `updateMany`
    // with the `chosenAt IS NULL` predicate replicated in `where`. This is
    // the atomic compare-and-set that protects against the (vanishingly
    // narrow) race where two bind hooks fire concurrently for the same
    // assistant. The first hook flips `chosenAt`; the second `updateMany`
    // matches zero rows and returns `count: 0`, which we surface as
    // `already_chosen`.
    const updated = await this.prisma.assistant.updateMany({
      where: {
        id: request.assistantId,
        preferredNotificationChannelChosenAt: null
      },
      data: {
        preferredNotificationChannel: request.bindingChannel,
        preferredNotificationChannelChosenAt: now
      }
    });

    if (updated.count === 0) {
      // Lost the race against a concurrent helper invocation or a manual
      // preference update. Either way, an explicit choice now exists and we
      // must respect it.
      return { changed: false, reason: "already_chosen" };
    }

    if (assistant.preferredNotificationChannel === request.bindingChannel) {
      // Channel was already correct; we wrote the timestamp marker so the
      // next call short-circuits, but the user-visible preference did not
      // change.
      return { changed: false, reason: "channel_already_matches" };
    }

    return { changed: true, reason: "auto_set" };
  }
}
