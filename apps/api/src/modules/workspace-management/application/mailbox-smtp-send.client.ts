import { Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";

const MAILBOX_SMTP_CONNECTION_TIMEOUT_MS = 10_000;
const MAILBOX_SMTP_GREETING_TIMEOUT_MS = 10_000;
const MAILBOX_SMTP_SOCKET_TIMEOUT_MS = 15_000;

export type MailboxSmtpTransportOptions = {
  host: string;
  port: number;
  user: string;
  accessToken: string;
};

export type MailboxSmtpMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

export type MailboxSmtpTransporter = {
  sendMail(message: MailboxSmtpMessage): Promise<{ messageId?: string }>;
  close(): void;
};

/**
 * ADR-169 D10 — the one place `nodemailer` is constructed. Kept behind this
 * factory (rather than called inline in `MailboxSmtpSendClientService`) so
 * tests can substitute a fake transporter without a network stack.
 */
@Injectable()
export class NodemailerMailboxSmtpTransportFactory {
  createTransport(options: MailboxSmtpTransportOptions): MailboxSmtpTransporter {
    return nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: true,
      auth: {
        type: "OAuth2",
        user: options.user,
        accessToken: options.accessToken
      },
      connectionTimeout: MAILBOX_SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: MAILBOX_SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: MAILBOX_SMTP_SOCKET_TIMEOUT_MS
    });
  }
}

export type MailboxSmtpSendOutcome =
  | { kind: "success"; messageId: string }
  | { kind: "network_error"; message: string }
  | { kind: "rejected"; message: string; responseCode: number | null };

/**
 * ADR-169 D10 — SMTP XOAUTH2 transport for the connected mailbox, mirroring
 * `PostmarkEmailSendClientService`'s conventions: a discriminated result
 * union instead of thrown errors, structured `{ event, ... }` logging, and
 * transport-only responsibility — it never resolves secrets and never
 * touches Prisma. One recipient, one plain-text body, one send per call.
 */
@Injectable()
export class MailboxSmtpSendClientService {
  constructor(private readonly transportFactory: NodemailerMailboxSmtpTransportFactory) {}

  async send(
    params: MailboxSmtpTransportOptions & MailboxSmtpMessage
  ): Promise<MailboxSmtpSendOutcome> {
    const transporter = this.transportFactory.createTransport({
      host: params.host,
      port: params.port,
      user: params.user,
      accessToken: params.accessToken
    });

    try {
      const info = await transporter.sendMail({
        from: params.from,
        to: params.to,
        subject: params.subject,
        text: params.text
      });
      return { kind: "success", messageId: info.messageId ?? "" };
    } catch (err) {
      const responseCode = this.readResponseCode(err);
      const message = err instanceof Error ? err.message : String(err);
      if (responseCode !== null) {
        return { kind: "rejected", message, responseCode };
      }
      return { kind: "network_error", message };
    } finally {
      transporter.close();
    }
  }

  /** SMTP-protocol rejections (auth, DATA, quota/rate) carry `responseCode`; connection/timeout failures do not. */
  private readResponseCode(err: unknown): number | null {
    if (typeof err !== "object" || err === null || !("responseCode" in err)) {
      return null;
    }
    const value = (err as { responseCode?: unknown }).responseCode;
    return typeof value === "number" ? value : null;
  }
}
