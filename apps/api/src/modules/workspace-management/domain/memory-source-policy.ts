/**
 * Step 6 D3: explicit global memory source/trust policy (control plane).
 * Not documented only by convention — evaluated in application services before registry writes / list reads.
 */

export type MemoryTransportSurface = "web";

/** How the originating audience/thread is classified for global memory registry writes. */
export type MemorySourceTrustClass = "trusted_1to1" | "group";

export type GlobalMemoryWriteAttemptContext = {
  transportSurface: MemoryTransportSurface;
  sourceTrust: MemorySourceTrustClass;
};

function policySection(envelope: Record<string, unknown>): Record<string, unknown> {
  const p = envelope.policy;
  if (p !== null && typeof p === "object" && !Array.isArray(p)) {
    return p as Record<string, unknown>;
  }
  return {};
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function getAllowedGlobalWriteSurfaces(policy: Record<string, unknown>): string[] {
  return asStringArray(policy.allowedGlobalWriteSurfaces, ["web"]);
}

function getTrustedOneToOneGlobalWriteSurfaces(policy: Record<string, unknown>): string[] {
  const explicit = asStringArray(policy.trustedOneToOneGlobalWriteSurfaces, []);
  if (explicit.length > 0) {
    return explicit;
  }
  return getAllowedGlobalWriteSurfaces(policy);
}

/**
 * Global memory may be surfaced/read across product surfaces when policy allows.
 */
export function isGlobalMemoryReadAllowed(effectiveMemoryControl: Record<string, unknown>): boolean {
  const policy = policySection(effectiveMemoryControl);
  if (policy.globalMemoryReadAllSurfaces === false) {
    return false;
  }
  return true;
}

export type GlobalMemoryWritePolicyResult =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

/**
 * Enforces: group-sourced global writes denied (when configured),
 * only trusted_1to1 contexts may write,
 * surface must be both allowed and explicitly trusted for 1:1 global write.
 */
export function evaluateGlobalMemoryWritePolicy(
  effectiveMemoryControl: Record<string, unknown>,
  ctx: GlobalMemoryWriteAttemptContext
): GlobalMemoryWritePolicyResult {
  const policy = policySection(effectiveMemoryControl);
  const denyGroup = policy.denyGroupSourcedGlobalWrites !== false;

  if (ctx.sourceTrust === "group") {
    if (denyGroup) {
      return {
        allowed: false,
        code: "memory_group_global_write_denied",
        message:
          "Global memory cannot be written from group or non-1:1 sources under current policy."
      };
    }
    return {
      allowed: false,
      code: "memory_group_write_not_supported",
      message: "Group-sourced global memory writes are not supported."
    };
  }

  if (ctx.sourceTrust !== "trusted_1to1") {
    return {
      allowed: false,
      code: "memory_write_requires_trusted_1to1",
      message: "Global memory writes require a trusted 1:1 source classification."
    };
  }

  const allowedSurfaces = getAllowedGlobalWriteSurfaces(policy);
  const trustedSurfaces = getTrustedOneToOneGlobalWriteSurfaces(policy);

  if (!allowedSurfaces.includes(ctx.transportSurface)) {
    return {
      allowed: false,
      code: "memory_surface_not_allowed_for_global_write",
      message: `Surface "${ctx.transportSurface}" is not allowed for global memory writes.`
    };
  }

  if (!trustedSurfaces.includes(ctx.transportSurface)) {
    return {
      allowed: false,
      code: "memory_surface_not_trusted_1to1_for_global_write",
      message: `Surface "${ctx.transportSurface}" is not in the trusted 1:1 global write list.`
    };
  }

  return { allowed: true };
}

/** Web chat transport in MVP: single-user thread → trusted 1:1 for global registry writes. */
export const WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT: GlobalMemoryWriteAttemptContext = {
  transportSurface: "web",
  sourceTrust: "trusted_1to1"
};
