import process from "node:process";
import { runScenario } from "./lib/harness";
import { listScenarioIds, loadScenario } from "./lib/scenario";
import { loadSmokeEnv } from "./lib/workspace";

interface CliArgs {
  scenarioIds: string[];
  all: boolean;
  updateBaseline: boolean;
  threadSuffix?: string;
  help: boolean;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`PersAI smoke harness

Usage:
  pnpm smoke:run --scenario <id> [--scenario <id> ...] [--update-baseline] [--thread-suffix <s>]
  pnpm smoke:run-all [--update-baseline] [--thread-suffix <s>]

Required env:
  SMOKE_USER_BEARER             Clerk bearer token for the test user.
  PERSAI_INTERNAL_API_TOKEN     Internal token to call /api/v1/internal/smoke/turn-receipts.
  SMOKE_ASSISTANT_ID            assistantId whose receipts the harness will read.

Optional env:
  SMOKE_API_BASE_URL            Default: http://127.0.0.1:3001 (local apps/api).
  SMOKE_ARTIFACTS_DIR           Default: scripts/smoke/artifacts.
  SMOKE_FETCH_TIMEOUT_MS        Default: 120000.
  SMOKE_RECEIPT_POLL_TIMEOUT_MS Default: 30000.
  SMOKE_RECEIPT_POLL_INTERVAL_MS Default: 500.
  SMOKE_SURFACE_THREAD_PREFIX   Default: smoke.

Flags:
  --scenario <id>   Run a single scenario (repeatable).
  --all             Run every scenario in scripts/smoke/scenarios/.
  --update-baseline Persist this run's summary as the new baseline.
  --thread-suffix   Use a deterministic suffix instead of a random one.
  --help            Show this help.
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    scenarioIds: [],
    all: false,
    updateBaseline: false,
    help: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--all") {
      args.all = true;
      continue;
    }
    if (arg === "--update-baseline") {
      args.updateBaseline = true;
      continue;
    }
    if (arg === "--scenario") {
      const value = argv[++i];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error("--scenario requires a value.");
      }
      args.scenarioIds.push(value.trim());
      continue;
    }
    if (arg === "--thread-suffix") {
      const value = argv[++i];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error("--thread-suffix requires a value.");
      }
      args.threadSuffix = value.trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  let scenarioIds = args.scenarioIds;
  if (args.all) {
    scenarioIds = await listScenarioIds();
  }
  if (scenarioIds.length === 0) {
    printHelp();
    throw new Error("No scenarios selected. Pass --scenario <id> or --all.");
  }
  const env = loadSmokeEnv();

  let exitCode = 0;
  for (const scenarioId of scenarioIds) {
    const scenario = await loadScenario(scenarioId);
    const result = await runScenario({
      scenario,
      env,
      updateBaseline: args.updateBaseline,
      ...(args.threadSuffix === undefined ? {} : { threadKeyOverride: args.threadSuffix })
    });
    if (result.summary.totals.failed > 0) {
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
