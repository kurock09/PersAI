import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";

const LIVE_VOICE_RELAY_TICKET_PROVIDER_KEY = "tool_live_voice_relay_ticket";
export const LIVE_VOICE_RELAY_TICKET_TTL_MS = 120_000;

type RelayTicketPayload = {
  sid: string;
  uid: string;
  exp: number;
};

@Injectable()
export class AssistantLiveVoiceRelayTicketService {
  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async issue(input: {
    sessionId: string;
    userId: string;
  }): Promise<{ ticket: string; expiresAt: string }> {
    const secret = await this.requireSecret();
    const exp = this.getNowMs() + this.getTtlMs();
    const payload: RelayTicketPayload = {
      sid: input.sessionId,
      uid: input.userId,
      exp
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = signRelayPayload(encodedPayload, secret).toString("base64url");
    return {
      ticket: `${encodedPayload}.${signature}`,
      expiresAt: new Date(exp).toISOString()
    };
  }

  async verify(ticket: string): Promise<{ sessionId: string; userId: string } | null> {
    try {
      if (typeof ticket !== "string" || ticket.length === 0) {
        return null;
      }
      const separatorIndex = ticket.indexOf(".");
      if (separatorIndex <= 0 || separatorIndex !== ticket.lastIndexOf(".")) {
        return null;
      }
      const encodedPayload = ticket.slice(0, separatorIndex);
      const encodedSignature = ticket.slice(separatorIndex + 1);
      if (encodedPayload.length === 0 || encodedSignature.length === 0) {
        return null;
      }
      const secret = await this.resolveSecret();
      if (secret === null) {
        return null;
      }
      const providedSignature = Buffer.from(encodedSignature, "base64url");
      const expectedSignature = signRelayPayload(encodedPayload, secret);
      if (providedSignature.length !== expectedSignature.length) {
        return null;
      }
      if (!timingSafeEqual(providedSignature, expectedSignature)) {
        return null;
      }
      const payload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8")
      ) as Partial<RelayTicketPayload>;
      if (
        typeof payload.sid !== "string" ||
        payload.sid.trim().length === 0 ||
        typeof payload.uid !== "string" ||
        payload.uid.trim().length === 0 ||
        typeof payload.exp !== "number" ||
        !Number.isFinite(payload.exp)
      ) {
        return null;
      }
      if (payload.exp <= this.getNowMs()) {
        return null;
      }
      return {
        sessionId: payload.sid,
        userId: payload.uid
      };
    } catch {
      return null;
    }
  }

  private async requireSecret(): Promise<string> {
    const secret = await this.resolveSecret();
    if (secret === null) {
      throw new Error("Live voice relay ticket secret is not configured.");
    }
    return secret;
  }

  private async resolveSecret(): Promise<string | null> {
    const secret =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        LIVE_VOICE_RELAY_TICKET_PROVIDER_KEY
      );
    if (secret === null) {
      return null;
    }
    const trimmed = secret.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  protected getNowMs(): number {
    return Date.now();
  }

  protected getTtlMs(): number {
    return LIVE_VOICE_RELAY_TICKET_TTL_MS;
  }
}

function signRelayPayload(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}
