import { Injectable, Logger } from "@nestjs/common";
import type { BillingLifecycleFactPayload } from "../templates/billing/billing-lifecycle-fact-payload";
import renderGraceEnding from "../templates/billing/grace-ending.template";
import renderGraceEndingShort from "../templates/billing/grace-ending.short.template";
import renderGraceExpired from "../templates/billing/grace-expired.template";
import renderGraceExpiredShort from "../templates/billing/grace-expired.short.template";
import renderPaymentRecovered from "../templates/billing/payment-recovered.template";
import renderPaymentRecoveredShort from "../templates/billing/payment-recovered.short.template";
import renderPaymentActivated from "../templates/billing/payment-activated.template";
import renderPaymentActivatedShort from "../templates/billing/payment-activated.short.template";
import renderRenewalFailed from "../templates/billing/renewal-failed.template";
import renderRenewalFailedShort from "../templates/billing/renewal-failed.short.template";
import renderRenewalSucceeded from "../templates/billing/renewal-succeeded.template";
import renderRenewalSucceededShort from "../templates/billing/renewal-succeeded.short.template";
import renderTrialEnding from "../templates/billing/trial-ending.template";
import renderTrialEndingShort from "../templates/billing/trial-ending.short.template";
import renderTrialExpired from "../templates/billing/trial-expired.template";
import renderTrialExpiredShort from "../templates/billing/trial-expired.short.template";
import type { NotificationIntentRecord, RenderedPayload } from "../notification-platform.types";

/**
 * Template renderer: renders notifications from versioned templates addressed
 * by templateId. Required for transactional, operational, and administrative
 * notification classes. Templates are deterministic and audit-safe.
 * ADR-088 §Core principles #3.
 *
 * Slice 1: renders the billing.payment_recovered MJML template and serves as
 * the registry for all future templates. The compiled HTML for each template
 * is loaded at service-init time from the compiled templates directory.
 */
@Injectable()
export class TemplateRendererService {
  private readonly logger = new Logger(TemplateRendererService.name);

  private readonly templates: Map<string, TemplateDefinition> = new Map([
    [
      "billing.trial_ending",
      { id: "billing.trial_ending", kind: "billing", render: renderTrialEnding }
    ],
    [
      "billing.trial_ending.short",
      { id: "billing.trial_ending.short", kind: "billing", render: renderTrialEndingShort }
    ],
    [
      "billing.trial_expired",
      { id: "billing.trial_expired", kind: "billing", render: renderTrialExpired }
    ],
    [
      "billing.trial_expired.short",
      { id: "billing.trial_expired.short", kind: "billing", render: renderTrialExpiredShort }
    ],
    [
      "billing.renewal_failed",
      { id: "billing.renewal_failed", kind: "billing", render: renderRenewalFailed }
    ],
    [
      "billing.renewal_failed.short",
      { id: "billing.renewal_failed.short", kind: "billing", render: renderRenewalFailedShort }
    ],
    [
      "billing.grace_ending",
      { id: "billing.grace_ending", kind: "billing", render: renderGraceEnding }
    ],
    [
      "billing.grace_ending.short",
      { id: "billing.grace_ending.short", kind: "billing", render: renderGraceEndingShort }
    ],
    [
      "billing.grace_expired",
      { id: "billing.grace_expired", kind: "billing", render: renderGraceExpired }
    ],
    [
      "billing.grace_expired.short",
      { id: "billing.grace_expired.short", kind: "billing", render: renderGraceExpiredShort }
    ],
    [
      "billing.payment_recovered",
      { id: "billing.payment_recovered", kind: "billing", render: renderPaymentRecovered }
    ],
    [
      "billing.payment_recovered.short",
      {
        id: "billing.payment_recovered.short",
        kind: "billing",
        render: renderPaymentRecoveredShort
      }
    ],
    [
      "billing.payment_activated",
      { id: "billing.payment_activated", kind: "billing", render: renderPaymentActivated }
    ],
    [
      "billing.payment_activated.short",
      {
        id: "billing.payment_activated.short",
        kind: "billing",
        render: renderPaymentActivatedShort
      }
    ],
    [
      "billing.renewal_succeeded",
      { id: "billing.renewal_succeeded", kind: "billing", render: renderRenewalSucceeded }
    ],
    [
      "billing.renewal_succeeded.short",
      {
        id: "billing.renewal_succeeded.short",
        kind: "billing",
        render: renderRenewalSucceededShort
      }
    ]
  ]);

  async render(intent: NotificationIntentRecord): Promise<RenderedPayload> {
    const templateId = intent.templateId;
    if (!templateId) {
      this.logger.warn({
        event: "template_renderer.no_template_id",
        intentId: intent.id,
        source: intent.source
      });
      return { body: `Notification: ${intent.source}` };
    }

    const template = this.templates.get(templateId);
    if (!template) {
      this.logger.warn({
        event: "template_renderer.template_not_found",
        intentId: intent.id,
        templateId
      });
      return { body: `Notification: ${intent.source}` };
    }

    return this.renderTemplate(template, intent.factPayload);
  }

  /**
   * Dry-run render for preview endpoint — same logic, no side effects.
   */
  async preview(
    templateId: string,
    factPayload: Record<string, unknown>
  ): Promise<RenderedPayload> {
    const template = this.templates.get(templateId);
    if (!template) {
      return { body: `[template not found: ${templateId}]` };
    }
    return this.renderTemplate(template, factPayload);
  }

  listTemplateIds(): string[] {
    return Array.from(this.templates.keys());
  }

  private renderTemplate(
    template: TemplateDefinition,
    factPayload: Record<string, unknown>
  ): RenderedPayload {
    const locale =
      typeof factPayload["locale"] === "string" &&
      factPayload["locale"].toLowerCase().startsWith("en")
        ? "en"
        : "ru";
    const rendered = template.render(factPayload as BillingLifecycleFactPayload, locale);
    return {
      subject: rendered.subject,
      body: rendered.plainText,
      html: rendered.html,
      plainText: rendered.plainText
    };
  }
}

type TemplateDefinition = {
  id: string;
  kind: "billing";
  render: (
    facts: BillingLifecycleFactPayload,
    locale: "ru" | "en"
  ) => { subject: string; html: string; plainText: string };
};
