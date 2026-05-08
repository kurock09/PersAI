import { Injectable, Logger } from "@nestjs/common";
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
      "billing.payment_recovered",
      {
        id: "billing.payment_recovered",
        subjectTemplate: "Your PersAI subscription has been restored",
        bodyTemplate: billingPaymentRecoveredTemplate
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

    const facts = intent.factPayload;
    const subject = interpolate(template.subjectTemplate, facts);
    const html = interpolate(template.bodyTemplate, facts);
    const plainText = htmlToPlainText(html);

    return { subject, body: plainText, html, plainText };
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
    const subject = interpolate(template.subjectTemplate, factPayload);
    const html = interpolate(template.bodyTemplate, factPayload);
    const plainText = htmlToPlainText(html);
    return { subject, body: plainText, html, plainText };
  }

  listTemplateIds(): string[] {
    return Array.from(this.templates.keys());
  }
}

type TemplateDefinition = {
  id: string;
  subjectTemplate: string;
  bodyTemplate: string;
};

/**
 * Compiled billing.payment_recovered template (Slice 1 first template).
 * A future build step will compile MJML → HTML at build time.
 * For Slice 1 this is an inline HTML template compiled from the MJML source.
 */
const billingPaymentRecoveredTemplate = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Payment Recovered</title></head>
<body style="font-family:sans-serif;background:#f8f8f8;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px">
    <h2 style="color:#1a1a1a;margin-bottom:8px">Subscription Restored</h2>
    <p style="color:#555">Hi,</p>
    <p style="color:#555">
      Your PersAI subscription payment was successfully processed and your access has been fully restored.
    </p>
    <table style="width:100%;border-top:1px solid #eee;margin-top:24px;padding-top:16px">
      <tr><td style="color:#888;font-size:13px">Plan</td><td style="text-align:right;font-size:13px;color:#1a1a1a">{{planCode}}</td></tr>
      <tr><td style="color:#888;font-size:13px">Amount</td><td style="text-align:right;font-size:13px;color:#1a1a1a">{{amount}} {{currency}}</td></tr>
      <tr><td style="color:#888;font-size:13px">Next renewal</td><td style="text-align:right;font-size:13px;color:#1a1a1a">{{periodEndsAt}}</td></tr>
    </table>
    <p style="color:#888;font-size:12px;margin-top:32px">
      You are receiving this email because you have an active PersAI subscription.
      <br>To manage notifications, visit your account settings.
    </p>
  </div>
</body>
</html>`;

function interpolate(template: string, facts: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = facts[key];
    return val !== undefined && val !== null ? String(val) : "";
  });
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
