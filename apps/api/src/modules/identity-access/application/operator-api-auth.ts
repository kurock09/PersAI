import { timingSafeEqual } from "node:crypto";
import type { ApiConfig } from "@persai/config";

export type OperatorApiAuthConfig = Pick<
  ApiConfig,
  "PERSAI_OPERATOR_TOKEN" | "PERSAI_OPERATOR_ACTOR_USER_ID" | "PERSAI_OPERATOR_ACTOR_EMAIL"
>;

export function readOperatorApiAuthFromEnv(env: NodeJS.ProcessEnv): OperatorApiAuthConfig {
  return {
    PERSAI_OPERATOR_TOKEN: env.PERSAI_OPERATOR_TOKEN,
    PERSAI_OPERATOR_ACTOR_USER_ID: env.PERSAI_OPERATOR_ACTOR_USER_ID,
    PERSAI_OPERATOR_ACTOR_EMAIL: env.PERSAI_OPERATOR_ACTOR_EMAIL
  };
}

export function isOperatorApiAuthConfigured(config: OperatorApiAuthConfig): boolean {
  const token = config.PERSAI_OPERATOR_TOKEN?.trim() ?? "";
  if (token.length === 0) {
    return false;
  }
  const actorUserId = config.PERSAI_OPERATOR_ACTOR_USER_ID?.trim() ?? "";
  const actorEmail = config.PERSAI_OPERATOR_ACTOR_EMAIL?.trim().toLowerCase() ?? "";
  return actorUserId.length > 0 || actorEmail.length > 0;
}

export function verifyOperatorApiToken(token: string, configuredToken: string): boolean {
  const received = Buffer.from(token, "utf8");
  const expected = Buffer.from(configuredToken, "utf8");
  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(received, expected);
}
