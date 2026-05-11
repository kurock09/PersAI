import { AsyncLocalStorage } from "node:async_hooks";
import { ConflictException, Injectable, Logger } from "@nestjs/common";
import type { PersaiRuntimeModelRole, RuntimeToolPolicy } from "@persai/runtime-contract";
import { RuntimeObservabilityService } from "../observability/runtime-observability.service";

export const RUNTIME_EXECUTION_CLASSES = [
  "interactive_light",
  "interactive_heavy",
  "background"
] as const;

export type RuntimeExecutionClass = (typeof RUNTIME_EXECUTION_CLASSES)[number];

export interface RuntimeExecutionAdmissionPolicy {
  maxConcurrent: number;
  queueTimeoutMs: number;
  maxQueuePerClass: number;
  reservedSlots: Record<RuntimeExecutionClass, number>;
}

export interface RuntimeInteractiveExecutionAdmissionDescriptor {
  selectedModelRole: PersaiRuntimeModelRole;
  deepModeEnabled: boolean;
  attachmentCount: number;
  openMediaJobCount: number;
  visibleToolPolicies: RuntimeToolPolicy[];
}

export const DEFAULT_RUNTIME_EXECUTION_ADMISSION_POLICY: RuntimeExecutionAdmissionPolicy = {
  // Keep enough shared headroom for the existing two-replica dev shape while
  // still giving each execution class a non-zero floor under mixed load.
  maxConcurrent: 12,
  queueTimeoutMs: 12_000,
  maxQueuePerClass: 32,
  reservedSlots: {
    interactive_light: 2,
    interactive_heavy: 1,
    background: 1
  }
};

type RuntimeAdmissionGrant = {
  executionClass: RuntimeExecutionClass;
  token: string;
};

type QueuedAdmissionRequest = {
  executionClass: RuntimeExecutionClass;
  enqueuedAtMs: number;
  token: string;
  settled: boolean;
  resolve: (grant: RuntimeAdmissionGrant) => void;
  reject: (error: Error) => void;
};

const SHARED_EXECUTION_CLASS_ORDER: RuntimeExecutionClass[] = [
  "interactive_light",
  "interactive_heavy",
  "background"
];

function assertPolicy(policy: RuntimeExecutionAdmissionPolicy): void {
  if (!Number.isInteger(policy.maxConcurrent) || policy.maxConcurrent <= 0) {
    throw new Error("Runtime execution admission maxConcurrent must be a positive integer.");
  }
  if (!Number.isInteger(policy.queueTimeoutMs) || policy.queueTimeoutMs <= 0) {
    throw new Error("Runtime execution admission queueTimeoutMs must be a positive integer.");
  }
  if (!Number.isInteger(policy.maxQueuePerClass) || policy.maxQueuePerClass <= 0) {
    throw new Error("Runtime execution admission maxQueuePerClass must be a positive integer.");
  }
  const reservedTotal = RUNTIME_EXECUTION_CLASSES.reduce((sum, executionClass) => {
    const reserved = policy.reservedSlots[executionClass];
    if (!Number.isInteger(reserved) || reserved < 0) {
      throw new Error(
        `Runtime execution admission reserved slot count must be a non-negative integer for "${executionClass}".`
      );
    }
    return sum + reserved;
  }, 0);
  if (reservedTotal > policy.maxConcurrent) {
    throw new Error(
      `Runtime execution admission reserved slots (${String(reservedTotal)}) exceed maxConcurrent (${String(policy.maxConcurrent)}).`
    );
  }
}

export function classifyInteractiveExecutionClass(
  descriptor: RuntimeInteractiveExecutionAdmissionDescriptor
): RuntimeExecutionClass {
  const hasHeavyModelRole = descriptor.selectedModelRole === "reasoning";
  const hasHeavyInput = descriptor.deepModeEnabled || descriptor.attachmentCount > 0;
  const hasOpenMediaJobs = descriptor.openMediaJobCount > 0;
  const exposesHeavyTools = descriptor.visibleToolPolicies.some(
    (policy) =>
      policy.enabled === true &&
      policy.visibleToModel === true &&
      policy.usageRule === "allowed" &&
      (policy.executionMode === "worker" || policy.executionMode === "sandbox")
  );
  return hasHeavyModelRole || hasHeavyInput || hasOpenMediaJobs || exposesHeavyTools
    ? "interactive_heavy"
    : "interactive_light";
}

@Injectable()
export class RuntimeExecutionAdmissionService {
  private readonly logger = new Logger(RuntimeExecutionAdmissionService.name);
  private readonly asyncContext = new AsyncLocalStorage<RuntimeAdmissionGrant>();
  private readonly queuedByClass = new Map<RuntimeExecutionClass, QueuedAdmissionRequest[]>(
    RUNTIME_EXECUTION_CLASSES.map((executionClass) => [executionClass, []])
  );
  private readonly inFlightByClass = new Map<RuntimeExecutionClass, number>(
    RUNTIME_EXECUTION_CLASSES.map((executionClass) => [executionClass, 0])
  );
  private roundRobinCursor = 0;
  private policy: RuntimeExecutionAdmissionPolicy = DEFAULT_RUNTIME_EXECUTION_ADMISSION_POLICY;

  constructor(private readonly runtimeObservabilityService: RuntimeObservabilityService) {
    this.applyPolicy(DEFAULT_RUNTIME_EXECUTION_ADMISSION_POLICY);
  }

  getPolicy(): RuntimeExecutionAdmissionPolicy {
    return this.policy;
  }

  setPolicyForTest(policy: RuntimeExecutionAdmissionPolicy): this {
    this.applyPolicy(policy);
    return this;
  }

  async runWithAdmission<T>(
    executionClass: RuntimeExecutionClass,
    execute: () => Promise<T>
  ): Promise<T> {
    const currentGrant = this.asyncContext.getStore();
    if (currentGrant !== undefined) {
      return execute();
    }

    const grant = await this.acquire(executionClass);
    try {
      return await this.asyncContext.run(grant, execute);
    } finally {
      this.release(grant);
    }
  }

  runStreamWithAdmission<T>(
    executionClass: RuntimeExecutionClass,
    createStream: () => AsyncGenerator<T>
  ): AsyncGenerator<T> {
    return this.createAdmittedStream(executionClass, createStream);
  }

  private async *createAdmittedStream<T>(
    executionClass: RuntimeExecutionClass,
    createStream: () => AsyncGenerator<T>
  ): AsyncGenerator<T> {
    const currentGrant = this.asyncContext.getStore();
    if (currentGrant !== undefined) {
      yield* createStream();
      return;
    }

    const grant = await this.acquire(executionClass);
    try {
      const stream = this.asyncContext.run(grant, createStream);
      yield* stream;
    } finally {
      this.release(grant);
    }
  }

  private async acquire(executionClass: RuntimeExecutionClass): Promise<RuntimeAdmissionGrant> {
    const queue = this.queuedByClass.get(executionClass);
    if (queue === undefined) {
      throw new Error(`Unknown runtime execution class "${executionClass}".`);
    }
    if (queue.length >= this.policy.maxQueuePerClass) {
      this.runtimeObservabilityService.recordExecutionAdmissionRejected(executionClass);
      throw new ConflictException(
        `Runtime admission queue is full for ${executionClass.replaceAll("_", " ")} work.`
      );
    }

    const token = `${executionClass}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    return await new Promise<RuntimeAdmissionGrant>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const request: QueuedAdmissionRequest = {
        executionClass,
        enqueuedAtMs: Date.now(),
        token,
        settled: false,
        resolve: (grant) => {
          if (request.settled) {
            return;
          }
          request.settled = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          resolve(grant);
        },
        reject: (error) => {
          if (request.settled) {
            return;
          }
          request.settled = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          reject(error);
        }
      };
      queue.push(request);
      this.runtimeObservabilityService.recordExecutionAdmissionQueued(executionClass, queue.length);
      this.dispatchQueuedRequests();

      timeoutId = setTimeout(() => {
        const removed = this.removeQueuedRequest(request);
        if (!removed) {
          return;
        }
        this.runtimeObservabilityService.recordExecutionAdmissionTimedOut(
          executionClass,
          Date.now() - request.enqueuedAtMs
        );
        this.logger.warn(
          `runtime_execution_queue_timeout executionClass=${executionClass} waitMs=${String(
            Date.now() - request.enqueuedAtMs
          )} queued=${String(this.queuedByClass.get(executionClass)?.length ?? 0)}`
        );
        request.reject(
          new ConflictException(
            `Runtime admission wait timed out for ${executionClass.replaceAll("_", " ")} work.`
          )
        );
      }, this.policy.queueTimeoutMs);
    });
  }

  private release(grant: RuntimeAdmissionGrant): void {
    const current = this.inFlightByClass.get(grant.executionClass) ?? 0;
    if (current > 0) {
      this.inFlightByClass.set(grant.executionClass, current - 1);
    }
    this.runtimeObservabilityService.recordExecutionAdmissionFinished(grant.executionClass);
    this.dispatchQueuedRequests();
  }

  private dispatchQueuedRequests(): void {
    while (this.totalInFlightCount() < this.policy.maxConcurrent) {
      const nextClass = this.selectNextDispatchClass();
      if (nextClass === null) {
        return;
      }
      const queue = this.queuedByClass.get(nextClass);
      const request = queue?.shift();
      if (request === undefined) {
        continue;
      }
      if (request.settled) {
        continue;
      }
      const nextInFlight = (this.inFlightByClass.get(nextClass) ?? 0) + 1;
      this.inFlightByClass.set(nextClass, nextInFlight);
      const waitMs = Math.max(0, Date.now() - request.enqueuedAtMs);
      this.runtimeObservabilityService.recordExecutionAdmissionStarted(nextClass, waitMs);
      request.resolve({
        executionClass: nextClass,
        token: request.token
      });
    }
  }

  private selectNextDispatchClass(): RuntimeExecutionClass | null {
    const reservedCandidates = this.executionClassesWithQueuedRequests().filter(
      (executionClass) => {
        const reserved = this.policy.reservedSlots[executionClass];
        return (this.inFlightByClass.get(executionClass) ?? 0) < reserved;
      }
    );
    if (reservedCandidates.length > 0) {
      return this.pickRoundRobinCandidate(reservedCandidates);
    }

    if (this.sharedSlotsInUse() >= this.sharedSlotCapacity()) {
      return null;
    }

    const sharedCandidates = this.executionClassesWithQueuedRequests();
    if (sharedCandidates.length === 0) {
      return null;
    }
    return this.pickRoundRobinCandidate(sharedCandidates);
  }

  private executionClassesWithQueuedRequests(): RuntimeExecutionClass[] {
    return SHARED_EXECUTION_CLASS_ORDER.filter(
      (executionClass) => (this.queuedByClass.get(executionClass)?.length ?? 0) > 0
    );
  }

  private pickRoundRobinCandidate(
    candidates: RuntimeExecutionClass[]
  ): RuntimeExecutionClass | null {
    if (candidates.length === 0) {
      return null;
    }
    const startIndex = this.roundRobinCursor;
    for (let offset = 0; offset < SHARED_EXECUTION_CLASS_ORDER.length; offset += 1) {
      const classIndex = (startIndex + offset) % SHARED_EXECUTION_CLASS_ORDER.length;
      const executionClass = SHARED_EXECUTION_CLASS_ORDER[classIndex];
      if (executionClass !== undefined && candidates.includes(executionClass)) {
        this.roundRobinCursor = (classIndex + 1) % SHARED_EXECUTION_CLASS_ORDER.length;
        return executionClass;
      }
    }
    return candidates[0] ?? null;
  }

  private sharedSlotCapacity(): number {
    return (
      this.policy.maxConcurrent -
      RUNTIME_EXECUTION_CLASSES.reduce(
        (sum, executionClass) => sum + this.policy.reservedSlots[executionClass],
        0
      )
    );
  }

  private sharedSlotsInUse(): number {
    return this.totalInFlightCount() - this.reservedSlotsInUse();
  }

  private reservedSlotsInUse(): number {
    return RUNTIME_EXECUTION_CLASSES.reduce((sum, executionClass) => {
      return (
        sum +
        Math.min(
          this.inFlightByClass.get(executionClass) ?? 0,
          this.policy.reservedSlots[executionClass]
        )
      );
    }, 0);
  }

  private totalInFlightCount(): number {
    return RUNTIME_EXECUTION_CLASSES.reduce(
      (sum, executionClass) => sum + (this.inFlightByClass.get(executionClass) ?? 0),
      0
    );
  }

  private removeQueuedRequest(request: QueuedAdmissionRequest): boolean {
    const queue = this.queuedByClass.get(request.executionClass);
    if (queue === undefined) {
      return false;
    }
    const index = queue.indexOf(request);
    if (index === -1) {
      return false;
    }
    queue.splice(index, 1);
    return true;
  }

  private applyPolicy(policy: RuntimeExecutionAdmissionPolicy): void {
    assertPolicy(policy);
    this.policy = policy;
    this.runtimeObservabilityService.setExecutionAdmissionPolicy(policy);
  }
}
