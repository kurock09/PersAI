import { runRuntimeConfigTest } from "./runtime-config.test";
import { runRuntimeBundleCoordinatorServiceTest } from "./runtime-bundle-coordinator.service.test";
import { runRuntimeBundleRegistryServiceTest } from "./runtime-bundle-registry.service.test";
import { runRuntimeStateKeyspaceServiceTest } from "./runtime-state-keyspace.service.test";
import { runRuntimeStatePostgresServiceTest } from "./runtime-state-postgres.service.test";
import { runRuntimeStateRedisServiceTest } from "./runtime-state-redis.service.test";
import { runProviderGatewayClientServiceTest } from "./provider-gateway.client.service.test";
import { runSessionLeaseServiceTest } from "./session-lease.service.test";
import { runSessionCompactionServiceTest } from "./session-compaction.service.test";
import { runSessionStoreServiceTest } from "./session-store.service.test";
import { runIdempotencyServiceTest } from "./idempotency.service.test";
import { runTurnAcceptanceServiceTest } from "./turn-acceptance.service.test";
import { runTurnContextHydrationServiceTest } from "./turn-context-hydration.service.test";
import { runTurnExecutionServiceTest } from "./turn-execution.service.test";
import { runTurnFinalizationServiceTest } from "./turn-finalization.service.test";
import { runTurnLeaseHeartbeatServiceTest } from "./turn-lease-heartbeat.service.test";
import { runRuntimeMediaTranscriptionServiceTest } from "./runtime-media-transcription.service.test";
import { runRuntimeQuotaStatusToolServiceTest } from "./runtime-quota-status-tool.service.test";
import { runRuntimeTtsToolServiceTest } from "./runtime-tts-tool.service.test";
import { runRuntimeVideoGenerateToolServiceTest } from "./runtime-video-generate-tool.service.test";

async function run(): Promise<void> {
  await runRuntimeConfigTest();
  await runRuntimeBundleCoordinatorServiceTest();
  await runRuntimeBundleRegistryServiceTest();
  await runRuntimeStateKeyspaceServiceTest();
  await runRuntimeStatePostgresServiceTest();
  await runRuntimeStateRedisServiceTest();
  await runProviderGatewayClientServiceTest();
  await runRuntimeMediaTranscriptionServiceTest();
  await runRuntimeQuotaStatusToolServiceTest();
  await runRuntimeTtsToolServiceTest();
  await runRuntimeVideoGenerateToolServiceTest();
  await runSessionStoreServiceTest();
  await runSessionLeaseServiceTest();
  await runSessionCompactionServiceTest();
  await runIdempotencyServiceTest();
  await runTurnAcceptanceServiceTest();
  await runTurnContextHydrationServiceTest();
  await runTurnExecutionServiceTest();
  await runTurnFinalizationServiceTest();
  await runTurnLeaseHeartbeatServiceTest();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
