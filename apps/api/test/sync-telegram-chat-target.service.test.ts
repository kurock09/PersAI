import assert from "node:assert/strict";
import { SyncTelegramChatTargetService } from "../src/modules/workspace-management/application/sync-telegram-chat-target.service";
import {
  AutoSelectNotificationChannelOnBindService,
  type AutoSelectNotificationChannelOnBindRequest,
  type AutoSelectNotificationChannelOnBindResult
} from "../src/modules/workspace-management/application/auto-select-notification-channel-on-bind.service";

// ADR-074 Slice T2 — integration tests covering the bind-completion hook
// inside SyncTelegramChatTargetService. The helper itself is unit-tested
// separately; here we only verify that the wiring fires on the correct
// branch (claimOwner + private chat) and is defensive against helper
// failures (best-effort, must not break the bind).

class FakeBindingRepository {
  patchCalls: Array<{
    assistantId: string;
    provider: string;
    surface: string;
    patch: Record<string, unknown>;
  }> = [];

  async patchMetadata(
    assistantId: string,
    provider: string,
    surface: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    this.patchCalls.push({ assistantId, provider, surface, patch });
  }
}

class FakeAutoSelectHelper {
  calls: AutoSelectNotificationChannelOnBindRequest[] = [];
  /** When non-null, the helper throws on next call to simulate failure. */
  throwOnNext: Error | null = null;
  /** Last result the helper should return. */
  result: AutoSelectNotificationChannelOnBindResult = {
    changed: true,
    reason: "auto_set"
  };

  async execute(
    request: AutoSelectNotificationChannelOnBindRequest
  ): Promise<AutoSelectNotificationChannelOnBindResult> {
    this.calls.push(request);
    if (this.throwOnNext !== null) {
      const error = this.throwOnNext;
      this.throwOnNext = null;
      throw error;
    }
    return this.result;
  }
}

function makeService(
  binding: FakeBindingRepository,
  helper: FakeAutoSelectHelper
): SyncTelegramChatTargetService {
  // Cast through unknown — the fakes implement only the methods exercised by
  // the service-under-test; the rest of the interfaces are not relevant.
  return new SyncTelegramChatTargetService(
    binding as unknown as ConstructorParameters<typeof SyncTelegramChatTargetService>[0],
    helper as unknown as AutoSelectNotificationChannelOnBindService
  );
}

const BASE_INPUT = {
  assistantId: "assistant-1",
  telegramChatId: "1001",
  chatType: "private" as const,
  title: null as string | null,
  username: "alex",
  telegramUserId: 42,
  systemWelcomeSentAt: null,
  runtimeHealth: null,
  runtimeHealthMessage: null
};

async function runOwnerClaimPrivateTriggersAutoSelect(): Promise<void> {
  const binding = new FakeBindingRepository();
  const helper = new FakeAutoSelectHelper();
  const service = makeService(binding, helper);

  await service.execute({ ...BASE_INPUT, claimOwner: true });

  assert.equal(binding.patchCalls.length, 1);
  assert.equal(
    binding.patchCalls[0].patch.telegramOwnerClaimStatus,
    "claimed",
    "owner-claim metadata is persisted before helper runs"
  );
  assert.equal(helper.calls.length, 1);
  assert.deepEqual(helper.calls[0], {
    assistantId: "assistant-1",
    bindingChannel: "telegram"
  });
}

async function runNonClaimMetadataRefreshDoesNotTriggerAutoSelect(): Promise<void> {
  // claimOwner=false, isPrivate=true: a runtime-health refresh on an
  // already-claimed bot. Must NOT touch preference.
  const binding = new FakeBindingRepository();
  const helper = new FakeAutoSelectHelper();
  const service = makeService(binding, helper);

  await service.execute({
    ...BASE_INPUT,
    claimOwner: false,
    runtimeHealth: "ok"
  });

  assert.equal(binding.patchCalls.length, 1);
  assert.equal(
    helper.calls.length,
    0,
    "non-claim metadata refresh must not auto-select notification channel"
  );
}

async function runGroupChatClaimDoesNotTriggerAutoSelect(): Promise<void> {
  // claimOwner=true but chatType=group: the bot was added to a group, not
  // claimed in DM. There is no telegramDmChatId in the patch and the user's
  // notification preference is unrelated.
  const binding = new FakeBindingRepository();
  const helper = new FakeAutoSelectHelper();
  const service = makeService(binding, helper);

  await service.execute({
    ...BASE_INPUT,
    chatType: "supergroup",
    title: "Team Group",
    claimOwner: true
  });

  assert.equal(binding.patchCalls.length, 1);
  assert.equal(
    binding.patchCalls[0].patch.telegramOwnerClaimStatus,
    undefined,
    "group-chat update must not flip owner-claim status"
  );
  assert.equal(helper.calls.length, 0, "group-chat path must not auto-select notification channel");
}

async function runHelperFailureDoesNotBreakBind(): Promise<void> {
  // The bind itself must succeed even if the auto-select helper throws.
  // We verify by asserting (a) patchMetadata was called and (b) execute
  // resolved without rethrowing.
  const binding = new FakeBindingRepository();
  const helper = new FakeAutoSelectHelper();
  helper.throwOnNext = new Error("simulated db blip");
  const service = makeService(binding, helper);

  await service.execute({ ...BASE_INPUT, claimOwner: true });

  assert.equal(binding.patchCalls.length, 1, "bind metadata still persisted");
  assert.equal(helper.calls.length, 1, "helper was attempted exactly once");
}

async function runOrderingMetadataPatchHappensBeforeAutoSelect(): Promise<void> {
  // The auto-select helper must run AFTER the binding metadata is
  // persisted, so any subsequent TelegramThreadChannelAdapter resolution
  // sees the new telegramDmChatId. We approximate by recording call order.
  const order: string[] = [];
  class OrderedBinding extends FakeBindingRepository {
    override async patchMetadata(
      assistantId: string,
      provider: string,
      surface: string,
      patch: Record<string, unknown>
    ): Promise<void> {
      order.push("patchMetadata");
      await super.patchMetadata(assistantId, provider, surface, patch);
    }
  }
  class OrderedHelper extends FakeAutoSelectHelper {
    override async execute(
      request: AutoSelectNotificationChannelOnBindRequest
    ): Promise<AutoSelectNotificationChannelOnBindResult> {
      order.push("autoSelect");
      return super.execute(request);
    }
  }
  const binding = new OrderedBinding();
  const helper = new OrderedHelper();
  const service = makeService(binding, helper);

  await service.execute({ ...BASE_INPUT, claimOwner: true });

  assert.deepEqual(order, ["patchMetadata", "autoSelect"]);
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["owner-claim + private chat → auto-select fires", runOwnerClaimPrivateTriggersAutoSelect],
    [
      "non-claim metadata refresh → auto-select does not fire",
      runNonClaimMetadataRefreshDoesNotTriggerAutoSelect
    ],
    ["group-chat claim → auto-select does not fire", runGroupChatClaimDoesNotTriggerAutoSelect],
    ["helper failure does not break the bind", runHelperFailureDoesNotBreakBind],
    [
      "patchMetadata happens before auto-select (ordering invariant)",
      runOrderingMetadataPatchHappensBeforeAutoSelect
    ]
  ];

  let failures = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`fail - ${name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exitCode = 1;
  }
}

void main();
