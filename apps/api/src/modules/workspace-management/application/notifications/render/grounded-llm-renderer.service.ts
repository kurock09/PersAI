import { Injectable, Logger } from "@nestjs/common";
import { stripReminderContextSnapshot } from "../../build-reminder-context-snapshot.service";
import type { NotificationIntentRecord, RenderedPayload } from "../notification-platform.types";

/**
 * Grounded LLM renderer.
 * Only allowed for 'conversational' notification class.
 * In Slice 1: provides the interface and a dry-run implementation that
 * returns a preview without calling the real LLM. Real LLM calls are wired
 * in Slice 2 when conversational producers migrate.
 * ADR-088 §Core principles #3.
 */
@Injectable()
export class GroundedLlmRendererService {
  private readonly logger = new Logger(GroundedLlmRendererService.name);

  /**
   * Render a conversational notification using grounded LLM.
   * When `factPayload.pushText` is already present (pre-rendered by the active-turn
   * producer, e.g. QuotaAdvisoryFollowUpService), it is used directly to avoid a
   * redundant LLM call. Otherwise a fallback preview body is assembled from the
   * factPayload keys (real LLM call to be wired in a future slice).
   */
  async render(intent: NotificationIntentRecord): Promise<RenderedPayload> {
    if (intent.class !== "conversational") {
      this.logger.warn({
        event: "grounded_llm_renderer.wrong_class",
        intentId: intent.id,
        class: intent.class
      });
    }

    const preRendered = intent.factPayload["pushText"];
    if (typeof preRendered === "string" && preRendered.trim().length > 0) {
      // Defence-in-depth: the producer should already strip internal
      // reminder-context snapshots before persisting the intent (see
      // handle-internal-cron-fire), but if any future producer forgets to,
      // we still must not deliver the runtime brief verbatim to the user.
      const body = stripReminderContextSnapshot(preRendered);
      if (body.length === 0) {
        this.logger.warn({
          event: "grounded_llm_renderer.empty_after_context_strip",
          intentId: intent.id,
          source: intent.source
        });
        return { body: "Reminder", plainText: "Reminder" };
      }
      this.logger.log({
        event: "grounded_llm_renderer.used_pre_rendered",
        intentId: intent.id,
        source: intent.source,
        contextSnapshotStripped: preRendered.length !== body.length
      });
      return { body, plainText: body };
    }

    return this.dryRun(intent.factPayload, intent.renderInstructionRef);
  }

  /**
   * Dry-run preview — same as render but never sends.
   * Used by the POST /preview admin endpoint.
   */
  async preview(
    factPayload: Record<string, unknown>,
    renderInstructionRef?: string | null
  ): Promise<RenderedPayload> {
    return this.dryRun(factPayload, renderInstructionRef);
  }

  private dryRun(
    factPayload: Record<string, unknown>,
    renderInstructionRef?: string | null
  ): Promise<RenderedPayload> {
    // In Slice 1 this is a structured preview — no real LLM call.
    // The body is assembled from factPayload keys for display purposes.
    const instruction = renderInstructionRef ?? "(no instruction set)";
    const factsText = Object.entries(factPayload)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");

    const body = [
      `[Grounded LLM preview — dry-run, no real delivery]`,
      `Instruction ref: ${instruction}`,
      `Facts:\n${factsText}`
    ].join("\n\n");

    return Promise.resolve({ body, plainText: body, metadata: { dryRun: true } });
  }
}
