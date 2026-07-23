import { spawn } from "node:child_process";
import path from "node:path";

const tsxCliPath = require.resolve("tsx/cli");

const TESTS: Array<{ modulePath: string; exportName: string }> = [
  { modulePath: "./runtime-config.test.ts", exportName: "runRuntimeConfigTest" },
  {
    modulePath: "./runtime-bundle-coordinator.service.test.ts",
    exportName: "runRuntimeBundleCoordinatorServiceTest"
  },
  {
    modulePath: "./runtime-bundle-registry.service.test.ts",
    exportName: "runRuntimeBundleRegistryServiceTest"
  },
  {
    modulePath: "./runtime-bundle-auto-refresh.service.test.ts",
    exportName: "runRuntimeBundleAutoRefreshServiceTest"
  },
  {
    modulePath: "./runtime-state-keyspace.service.test.ts",
    exportName: "runRuntimeStateKeyspaceServiceTest"
  },
  {
    modulePath: "./runtime-state-postgres.service.test.ts",
    exportName: "runRuntimeStatePostgresServiceTest"
  },
  {
    modulePath: "./runtime-state-redis.service.test.ts",
    exportName: "runRuntimeStateRedisServiceTest"
  },
  {
    modulePath: "./provider-gateway.client.service.test.ts",
    exportName: "runProviderGatewayClientServiceTest"
  },
  {
    modulePath: "./runtime-media-transcription.service.test.ts",
    exportName: "runRuntimeMediaTranscriptionServiceTest"
  },
  {
    modulePath: "./runtime-background-task-evaluation.service.test.ts",
    exportName: "runRuntimeBackgroundTaskEvaluationServiceTest"
  },
  {
    modulePath: "./runtime-background-task-evaluation.service.test.ts",
    exportName: "runQuotaAdvisoryClassificationTest"
  },
  {
    modulePath: "./runtime-background-task-evaluation.service.test.ts",
    exportName: "runUniqueExternalThreadKeyTest"
  },
  {
    modulePath: "./runtime-background-task-evaluation.service.test.ts",
    exportName: "runLegacyThreadKeyFallbackTest"
  },
  {
    modulePath: "./runtime-background-task-evaluation.service.test.ts",
    exportName: "runEmptyAttemptIdFallsBackToLegacyKeyTest"
  },
  {
    modulePath: "./runtime-quota-status-tool.service.test.ts",
    exportName: "runRuntimeQuotaStatusToolServiceTest"
  },
  {
    modulePath: "./runtime-scheduled-action-tool.service.test.ts",
    exportName: "runRuntimeScheduledActionToolServiceTest"
  },
  { modulePath: "./runtime-tts-tool.service.test.ts", exportName: "runRuntimeTtsToolServiceTest" },
  {
    modulePath: "./runtime-browser-tool.service.test.ts",
    exportName: "runRuntimeBrowserToolServiceTest"
  },
  {
    modulePath: "./runtime-await-tool.service.test.ts",
    exportName: "runRuntimeAwaitToolServiceTest"
  },
  {
    modulePath: "./adr157-image-perception-wire.test.ts",
    exportName: "runAdr157ImagePerceptionWireTest"
  },
  {
    modulePath: "./persai-internal-api-async-job-status.test.ts",
    exportName: "runPersaiInternalApiAsyncJobStatusTest"
  },
  {
    modulePath: "./runtime-video-generate-tool.service.test.ts",
    exportName: "runRuntimeVideoGenerateToolServiceTest"
  },
  {
    modulePath: "./runtime-memory-write-tool.service.test.ts",
    exportName: "runRuntimeMemoryWriteToolServiceTest"
  },
  {
    modulePath: "./runtime-todo-write-tool.service.test.ts",
    exportName: "runRuntimeTodoWriteToolServiceTest"
  },
  {
    modulePath: "./runtime-skill-tool.service.test.ts",
    exportName: "runRuntimeSkillToolServiceTest"
  },
  {
    modulePath: "./runtime-script-tool.service.test.ts",
    exportName: "runRuntimeScriptToolServiceTest"
  },
  {
    modulePath: "./runtime-script-browser-broker.service.test.ts",
    exportName: "runRuntimeScriptBrowserBrokerServiceTest"
  },
  {
    modulePath: "./build-active-scenario-block.service.test.ts",
    exportName: "runBuildActiveScenarioBlockServiceTest"
  },
  { modulePath: "./session-store.service.test.ts", exportName: "runSessionStoreServiceTest" },
  { modulePath: "./session-lease.service.test.ts", exportName: "runSessionLeaseServiceTest" },
  {
    modulePath: "./session-compaction.service.test.ts",
    exportName: "runSessionCompactionServiceTest"
  },
  { modulePath: "./idempotency.service.test.ts", exportName: "runIdempotencyServiceTest" },
  { modulePath: "./adr149-receipt-reconcile.test.ts", exportName: "runAdr149ReceiptReconcileTest" },
  {
    modulePath: "./adr149-tool-abort-on-stop.test.ts",
    exportName: "runAdr149ToolAbortOnStopTest"
  },
  { modulePath: "./turn-acceptance.service.test.ts", exportName: "runTurnAcceptanceServiceTest" },
  {
    modulePath: "./prompt-cache-stable-blocks.test.ts",
    exportName: "runPromptCacheStableBlocksTest"
  },
  {
    modulePath: "./prompt-cache-stable-prefix-guard.test.ts",
    exportName: "runPromptCacheStablePrefixGuardTest"
  },
  {
    modulePath: "./cross-session-carry-over-renderer.test.ts",
    exportName: "runCrossSessionCarryOverRendererTest"
  },
  { modulePath: "./relative-time-formatter.test.ts", exportName: "runRelativeTimeFormatterTest" },
  { modulePath: "./presence-renderer.test.ts", exportName: "runPresenceRendererTest" },
  {
    modulePath: "./turn-context-hydration.service.test.ts",
    exportName: "runTurnContextHydrationServiceTest"
  },
  {
    modulePath: "./turn-context-hydration.service.test.ts",
    exportName: "runChatPlanBlockTest"
  },
  { modulePath: "./tool-budget-policy.test.ts", exportName: "runToolBudgetPolicyTest" },
  {
    modulePath: "./assemble-working-notes-and-answer.test.ts",
    exportName: "runAssembleWorkingNotesAndAnswerTest"
  },
  {
    modulePath: "./build-system-reminder-blocks.service.test.ts",
    exportName: "runBuildSystemReminderBlocksServiceTest"
  },
  {
    modulePath: "./sanitize-tool-result-for-model.test.ts",
    exportName: "runSanitizeToolResultForModelTest"
  },
  {
    modulePath: "./project-tool-exchanges-for-model.test.ts",
    exportName: "runProjectToolExchangesForModelTest"
  },
  {
    modulePath: "./tool-observation-spill.test.ts",
    exportName: "runToolObservationSpillTest"
  },
  {
    modulePath: "./prior-tool-exchange-replay.test.ts",
    exportName: "runPriorToolExchangeReplayTest"
  },
  {
    modulePath: "./deepseek-tool-loop-developer-freeze.test.ts",
    exportName: "runDeepseekToolLoopDeveloperFreezeTest"
  },
  { modulePath: "./turn-execution.service.test.ts", exportName: "runTurnExecutionServiceTest" },
  {
    modulePath: "./turn-execution.service.test.ts",
    exportName: "runTurnExecutionAwaitDispatchTest"
  },
  {
    modulePath: "./turn-execution.service.test.ts",
    exportName: "runAsyncContinuationAcceptanceTest"
  },
  {
    modulePath: "./turn-execution.service.test.ts",
    exportName: "runAdr151TurnDispatchIntegrationTest"
  },
  { modulePath: "./turn-execution.service.test.ts", exportName: "runRecentPdfsHintTests" },
  {
    modulePath: "./turn-finalization.service.test.ts",
    exportName: "runTurnFinalizationServiceTest"
  },
  {
    modulePath: "./turn-lease-heartbeat.service.test.ts",
    exportName: "runTurnLeaseHeartbeatServiceTest"
  },
  {
    modulePath: "./internal-runtime-document-jobs.controller.test.ts",
    exportName: "runInternalRuntimeDocumentJobsControllerTest"
  },
  { modulePath: "./turn-routing.service.test.ts", exportName: "runTurnRoutingServiceTest" },
  {
    modulePath: "./execution-profile-resolver.test.ts",
    exportName: "runExecutionProfileResolverTest"
  },
  {
    modulePath: "./native-tool-projection.test.ts",
    exportName: "runNativeToolProjectionTest"
  },
  {
    modulePath: "./catalog-tool-wire-expansion.test.ts",
    exportName: "runCatalogToolWireExpansionTest"
  },
  {
    modulePath: "./runtime-tool-contract-describe.test.ts",
    exportName: "runRuntimeToolContractDescribeTest"
  },
  {
    modulePath: "./catalog-tool-wire-budget.test.ts",
    exportName: "runCatalogToolWireBudgetTest"
  },
  {
    modulePath: "./catalog-tool-turn-metrics.test.ts",
    exportName: "runCatalogToolTurnMetricsTest"
  },
  {
    modulePath: "./native-tool-projection.test.ts",
    exportName: "runMediaPromptFragmentsSanityTest"
  },
  {
    modulePath: "./native-tool-projection.test.ts",
    exportName: "runAdr119Slice7DescriptorTests"
  },
  {
    modulePath: "./native-tool-projection.test.ts",
    exportName: "runAdr119Invariantstest"
  },
  {
    modulePath: "./adr119-golden-prompt-snapshot.test.ts",
    exportName: "runAdr119GoldenPromptSnapshotTest"
  },
  {
    modulePath: "./runtime-document-provider-adapter.service.test.ts",
    exportName: "runRuntimeDocumentProviderAdapterServiceTest"
  },
  {
    modulePath: "./runtime-document-tool.service.test.ts",
    exportName: "runRuntimeDocumentToolServiceTest"
  },
  {
    modulePath: "./model-output-budget.test.ts",
    exportName: "runModelOutputBudgetTest"
  },
  {
    modulePath: "./runtime-text-only-multimodal-sanitizer.test.ts",
    exportName: "runRuntimeTextOnlyMultimodalSanitizerTest"
  }
];

function runOneTest(modulePath: string, exportName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const absoluteModulePath = path.resolve(__dirname, modulePath);
    const child = spawn(
      process.execPath,
      [tsxCliPath, path.resolve(__dirname, "run-one.ts"), absoluteModulePath, exportName],
      {
        cwd: path.resolve(__dirname, ".."),
        stdio: "inherit",
        env: process.env
      }
    );
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Runtime test ${path.basename(modulePath)} (${exportName}) failed with code ${
            code ?? "null"
          } signal ${signal ?? "none"}.`
        )
      );
    });
  });
}

async function run(): Promise<void> {
  for (const test of TESTS) {
    await runOneTest(test.modulePath, test.exportName);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
