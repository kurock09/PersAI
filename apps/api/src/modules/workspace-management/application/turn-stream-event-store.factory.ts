import { loadApiConfig } from "@persai/config";
import { MemoryTurnStreamEventStore } from "./memory-turn-stream-event-store";
import { RedisTurnStreamEventStore } from "./redis-turn-stream-event-store";
import type { TurnStreamEventStore } from "./turn-stream-event-store";

export function resolveTurnCoordinationRedisUrl(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  try {
    const config = loadApiConfig(env);
    const url = config.PERSAI_TURN_COORDINATION_REDIS_URL ?? config.BROWSER_BRIDGE_REDIS_URL;
    return url?.trim() ? url.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Prod: Redis when coordination URL is set; otherwise in-memory (single process). */
export function createTurnStreamEventStore(
  env: NodeJS.ProcessEnv = process.env
): TurnStreamEventStore {
  const url = resolveTurnCoordinationRedisUrl(env);
  if (url !== undefined) {
    return new RedisTurnStreamEventStore(url);
  }
  return new MemoryTurnStreamEventStore();
}
