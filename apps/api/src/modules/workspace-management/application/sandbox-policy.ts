import { BadRequestException } from "@nestjs/common";
import {
  DEFAULT_RUNTIME_SANDBOX_POLICY,
  type RuntimeSandboxPolicy
} from "@persai/runtime-contract";

export const PERSAI_PLAN_SANDBOX_POLICY_SCHEMA = "persai.planSandbox.v1";

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toLoosePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function toLooseNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function toLooseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toLooseNullablePositiveInteger(value: unknown, fallback: number | null): number | null {
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function toLooseMimeAllowlist(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase());
  return normalized.length > 0 ? normalized : fallback;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive integer.`);
  }
  return value;
}

function parseNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function parseNullablePositiveInteger(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive integer or null.`);
  }
  return value;
}

function parseBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new BadRequestException(`${fieldName} must be a boolean.`);
  }
  return value;
}

function parseMimeAllowlist(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an array of mime strings.`);
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase());
  if (normalized.length === 0) {
    throw new BadRequestException(`${fieldName} must contain at least one mime string.`);
  }
  return normalized;
}

function normalizePolicy(policy: RuntimeSandboxPolicy): RuntimeSandboxPolicy {
  return {
    ...policy,
    maxSingleFileWriteBytes: Math.min(
      policy.maxSingleFileWriteBytes,
      policy.maxWorkspaceBytesPerJob
    ),
    maxPersistedArtifactsPerJob: Math.min(
      policy.maxPersistedArtifactsPerJob,
      policy.maxFileCountPerJob
    ),
    maxArtifactSendCountPerTurn: Math.min(
      policy.maxArtifactSendCountPerTurn,
      policy.maxPersistedArtifactsPerJob
    )
  };
}

function assertPolicyBounds(policy: RuntimeSandboxPolicy, fieldName: string): void {
  if (policy.maxSingleFileWriteBytes > policy.maxWorkspaceBytesPerJob) {
    throw new BadRequestException(
      `${fieldName}.maxSingleFileWriteBytes must be less than or equal to ${fieldName}.maxWorkspaceBytesPerJob.`
    );
  }
  if (policy.maxPersistedArtifactsPerJob > policy.maxFileCountPerJob) {
    throw new BadRequestException(
      `${fieldName}.maxPersistedArtifactsPerJob must be less than or equal to ${fieldName}.maxFileCountPerJob.`
    );
  }
  if (policy.maxArtifactSendCountPerTurn > policy.maxPersistedArtifactsPerJob) {
    throw new BadRequestException(
      `${fieldName}.maxArtifactSendCountPerTurn must be less than or equal to ${fieldName}.maxPersistedArtifactsPerJob.`
    );
  }
}

export function createDefaultPlanSandboxPolicy(): RuntimeSandboxPolicy {
  return { ...DEFAULT_RUNTIME_SANDBOX_POLICY };
}

export function resolveStoredPlanSandboxPolicy(value: unknown): RuntimeSandboxPolicy {
  const row = asObject(value);
  if (row === null) {
    return createDefaultPlanSandboxPolicy();
  }
  return normalizePolicy({
    enabled: toLooseBoolean(row.enabled, DEFAULT_RUNTIME_SANDBOX_POLICY.enabled),
    maxSingleFileWriteBytes: toLoosePositiveInteger(
      row.maxSingleFileWriteBytes,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxSingleFileWriteBytes
    ),
    maxWorkspaceBytesPerJob: toLoosePositiveInteger(
      row.maxWorkspaceBytesPerJob,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxWorkspaceBytesPerJob
    ),
    maxPersistedArtifactsPerJob: toLoosePositiveInteger(
      row.maxPersistedArtifactsPerJob,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxPersistedArtifactsPerJob
    ),
    maxFileCountPerJob: toLoosePositiveInteger(
      row.maxFileCountPerJob,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxFileCountPerJob
    ),
    maxDirectoryCountPerJob: toLoosePositiveInteger(
      row.maxDirectoryCountPerJob,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxDirectoryCountPerJob
    ),
    maxProcessRuntimeMs: toLoosePositiveInteger(
      row.maxProcessRuntimeMs,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxProcessRuntimeMs
    ),
    maxCpuMsPerJob: toLoosePositiveInteger(
      row.maxCpuMsPerJob,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxCpuMsPerJob
    ),
    maxMemoryBytesPerJob: toLoosePositiveInteger(
      row.maxMemoryBytesPerJob,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxMemoryBytesPerJob
    ),
    maxConcurrentProcesses: toLoosePositiveInteger(
      row.maxConcurrentProcesses,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxConcurrentProcesses
    ),
    maxStdoutBytes: toLooseNonNegativeInteger(
      row.maxStdoutBytes,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxStdoutBytes
    ),
    maxStderrBytes: toLooseNonNegativeInteger(
      row.maxStderrBytes,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxStderrBytes
    ),
    networkAccessEnabled: toLooseBoolean(
      row.networkAccessEnabled,
      DEFAULT_RUNTIME_SANDBOX_POLICY.networkAccessEnabled
    ),
    artifactMimeAllowlist: toLooseMimeAllowlist(
      row.artifactMimeAllowlist,
      DEFAULT_RUNTIME_SANDBOX_POLICY.artifactMimeAllowlist
    ),
    webMaxOutboundBytes: toLoosePositiveInteger(
      row.webMaxOutboundBytes,
      DEFAULT_RUNTIME_SANDBOX_POLICY.webMaxOutboundBytes
    ),
    telegramMaxOutboundBytes: toLoosePositiveInteger(
      row.telegramMaxOutboundBytes,
      DEFAULT_RUNTIME_SANDBOX_POLICY.telegramMaxOutboundBytes
    ),
    sandboxJobsPerDay: toLooseNullablePositiveInteger(
      row.sandboxJobsPerDay,
      DEFAULT_RUNTIME_SANDBOX_POLICY.sandboxJobsPerDay
    ),
    maxArtifactSendCountPerTurn: toLoosePositiveInteger(
      row.maxArtifactSendCountPerTurn,
      DEFAULT_RUNTIME_SANDBOX_POLICY.maxArtifactSendCountPerTurn
    )
  });
}

export function parsePlanSandboxPolicy(
  value: unknown,
  fieldName = "sandboxPolicy"
): RuntimeSandboxPolicy {
  const row = asObject(value);
  if (row === null) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  const policy: RuntimeSandboxPolicy = {
    enabled: parseBoolean(row.enabled, `${fieldName}.enabled`),
    maxSingleFileWriteBytes: parsePositiveInteger(
      row.maxSingleFileWriteBytes,
      `${fieldName}.maxSingleFileWriteBytes`
    ),
    maxWorkspaceBytesPerJob: parsePositiveInteger(
      row.maxWorkspaceBytesPerJob,
      `${fieldName}.maxWorkspaceBytesPerJob`
    ),
    maxPersistedArtifactsPerJob: parsePositiveInteger(
      row.maxPersistedArtifactsPerJob,
      `${fieldName}.maxPersistedArtifactsPerJob`
    ),
    maxFileCountPerJob: parsePositiveInteger(
      row.maxFileCountPerJob,
      `${fieldName}.maxFileCountPerJob`
    ),
    maxDirectoryCountPerJob: parsePositiveInteger(
      row.maxDirectoryCountPerJob,
      `${fieldName}.maxDirectoryCountPerJob`
    ),
    maxProcessRuntimeMs: parsePositiveInteger(
      row.maxProcessRuntimeMs,
      `${fieldName}.maxProcessRuntimeMs`
    ),
    maxCpuMsPerJob: parsePositiveInteger(row.maxCpuMsPerJob, `${fieldName}.maxCpuMsPerJob`),
    maxMemoryBytesPerJob: parsePositiveInteger(
      row.maxMemoryBytesPerJob,
      `${fieldName}.maxMemoryBytesPerJob`
    ),
    maxConcurrentProcesses: parsePositiveInteger(
      row.maxConcurrentProcesses,
      `${fieldName}.maxConcurrentProcesses`
    ),
    maxStdoutBytes: parseNonNegativeInteger(row.maxStdoutBytes, `${fieldName}.maxStdoutBytes`),
    maxStderrBytes: parseNonNegativeInteger(row.maxStderrBytes, `${fieldName}.maxStderrBytes`),
    networkAccessEnabled: parseBoolean(
      row.networkAccessEnabled,
      `${fieldName}.networkAccessEnabled`
    ),
    artifactMimeAllowlist: parseMimeAllowlist(
      row.artifactMimeAllowlist,
      `${fieldName}.artifactMimeAllowlist`
    ),
    webMaxOutboundBytes: parsePositiveInteger(
      row.webMaxOutboundBytes,
      `${fieldName}.webMaxOutboundBytes`
    ),
    telegramMaxOutboundBytes: parsePositiveInteger(
      row.telegramMaxOutboundBytes,
      `${fieldName}.telegramMaxOutboundBytes`
    ),
    sandboxJobsPerDay: parseNullablePositiveInteger(
      row.sandboxJobsPerDay,
      `${fieldName}.sandboxJobsPerDay`
    ),
    maxArtifactSendCountPerTurn: parsePositiveInteger(
      row.maxArtifactSendCountPerTurn,
      `${fieldName}.maxArtifactSendCountPerTurn`
    )
  };
  assertPolicyBounds(policy, fieldName);
  return normalizePolicy(policy);
}

export function toPlanSandboxPolicyDocument(policy: RuntimeSandboxPolicy): Record<string, unknown> {
  return {
    schema: PERSAI_PLAN_SANDBOX_POLICY_SCHEMA,
    enabled: policy.enabled,
    maxSingleFileWriteBytes: policy.maxSingleFileWriteBytes,
    maxWorkspaceBytesPerJob: policy.maxWorkspaceBytesPerJob,
    maxPersistedArtifactsPerJob: policy.maxPersistedArtifactsPerJob,
    maxFileCountPerJob: policy.maxFileCountPerJob,
    maxDirectoryCountPerJob: policy.maxDirectoryCountPerJob,
    maxProcessRuntimeMs: policy.maxProcessRuntimeMs,
    maxCpuMsPerJob: policy.maxCpuMsPerJob,
    maxMemoryBytesPerJob: policy.maxMemoryBytesPerJob,
    maxConcurrentProcesses: policy.maxConcurrentProcesses,
    maxStdoutBytes: policy.maxStdoutBytes,
    maxStderrBytes: policy.maxStderrBytes,
    networkAccessEnabled: policy.networkAccessEnabled,
    artifactMimeAllowlist: policy.artifactMimeAllowlist,
    webMaxOutboundBytes: policy.webMaxOutboundBytes,
    telegramMaxOutboundBytes: policy.telegramMaxOutboundBytes,
    sandboxJobsPerDay: policy.sandboxJobsPerDay,
    maxArtifactSendCountPerTurn: policy.maxArtifactSendCountPerTurn
  };
}
