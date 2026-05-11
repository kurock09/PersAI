import assert from "node:assert/strict";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import {
  RuntimeExecutionAdmissionService,
  classifyInteractiveExecutionClass,
  type RuntimeExecutionAdmissionPolicy
} from "../src/modules/turns/runtime-execution-admission.service";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function waitForTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createPolicy(
  overrides?: Partial<RuntimeExecutionAdmissionPolicy>
): RuntimeExecutionAdmissionPolicy {
  const reservedSlots = {
    interactive_light: 1,
    interactive_heavy: 0,
    background: 0,
    ...overrides?.reservedSlots
  };
  return {
    maxConcurrent: 2,
    queueTimeoutMs: 200,
    maxQueuePerClass: 8,
    ...overrides,
    reservedSlots
  };
}

export async function runRuntimeExecutionAdmissionServiceTest(): Promise<void> {
  assert.equal(
    classifyInteractiveExecutionClass({
      selectedModelRole: "normal_reply",
      deepModeEnabled: false,
      attachmentCount: 0,
      openMediaJobCount: 0,
      visibleToolPolicies: []
    }),
    "interactive_light"
  );
  assert.equal(
    classifyInteractiveExecutionClass({
      selectedModelRole: "reasoning",
      deepModeEnabled: false,
      attachmentCount: 0,
      openMediaJobCount: 0,
      visibleToolPolicies: []
    }),
    "interactive_heavy"
  );
  assert.equal(
    classifyInteractiveExecutionClass({
      selectedModelRole: "normal_reply",
      deepModeEnabled: false,
      attachmentCount: 0,
      openMediaJobCount: 0,
      visibleToolPolicies: [
        {
          toolCode: "browser",
          displayName: "Browser",
          description: "Use browser",
          kind: "plan",
          executionMode: "worker",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: true,
          dailyCallLimit: null
        }
      ]
    }),
    "interactive_heavy"
  );

  {
    const observability = new RuntimeObservabilityService();
    const service = new RuntimeExecutionAdmissionService(observability).setPolicyForTest(
      createPolicy({
        maxConcurrent: 2,
        reservedSlots: {
          interactive_light: 1,
          interactive_heavy: 0,
          background: 0
        }
      })
    );
    const order: string[] = [];
    const heavyHold = deferred<void>();
    const lightHold = deferred<void>();
    const heavyOne = service.runWithAdmission("interactive_heavy", async () => {
      order.push("heavy-1");
      await heavyHold.promise;
      return "heavy-1";
    });
    await waitForTick();
    const heavyTwo = service.runWithAdmission("interactive_heavy", async () => {
      order.push("heavy-2");
      return "heavy-2";
    });
    const lightOne = service.runWithAdmission("interactive_light", async () => {
      order.push("light-1");
      await lightHold.promise;
      return "light-1";
    });
    await waitForTick();
    assert.deepEqual(order, ["heavy-1", "light-1"]);
    lightHold.resolve();
    assert.equal(await lightOne, "light-1");
    await waitForTick();
    assert.deepEqual(order, ["heavy-1", "light-1", "heavy-2"]);
    heavyHold.resolve();
    assert.equal(await heavyOne, "heavy-1");
    assert.equal(await heavyTwo, "heavy-2");
  }

  {
    const observability = new RuntimeObservabilityService();
    const service = new RuntimeExecutionAdmissionService(observability).setPolicyForTest(
      createPolicy({
        maxConcurrent: 1,
        reservedSlots: {
          interactive_light: 0,
          interactive_heavy: 0,
          background: 0
        }
      })
    );
    const order: string[] = [];
    const hold = deferred<void>();
    const background = service.runWithAdmission("background", async () => {
      order.push("background-1");
      await hold.promise;
      return "background-1";
    });
    await waitForTick();
    const heavy = service.runWithAdmission("interactive_heavy", async () => {
      order.push("heavy-1");
      return "heavy-1";
    });
    const light = service.runWithAdmission("interactive_light", async () => {
      order.push("light-1");
      return "light-1";
    });
    const heavyTwo = service.runWithAdmission("interactive_heavy", async () => {
      order.push("heavy-2");
      return "heavy-2";
    });
    hold.resolve();
    assert.equal(await background, "background-1");
    assert.equal(await light, "light-1");
    assert.equal(await heavy, "heavy-1");
    assert.equal(await heavyTwo, "heavy-2");
    assert.deepEqual(order, ["background-1", "light-1", "heavy-1", "heavy-2"]);
  }

  {
    const observability = new RuntimeObservabilityService();
    const service = new RuntimeExecutionAdmissionService(observability).setPolicyForTest(
      createPolicy({
        maxConcurrent: 1,
        queueTimeoutMs: 20,
        reservedSlots: {
          interactive_light: 0,
          interactive_heavy: 0,
          background: 0
        }
      })
    );
    const hold = deferred<void>();
    const running = service.runWithAdmission("interactive_light", async () => {
      await hold.promise;
      return "running";
    });
    await waitForTick();
    await assert.rejects(
      () => service.runWithAdmission("background", async () => "blocked"),
      /timed out/
    );
    hold.resolve();
    assert.equal(await running, "running");
    const snapshot = observability.getSnapshot();
    const backgroundQueue = snapshot.executionQueueSeries.find(
      (series) => series.executionClass === "background"
    );
    assert.equal(backgroundQueue?.timedOut, 1);
  }
}
