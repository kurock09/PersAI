/**
 * Step 6 D1: canonical control-plane envelope for assistant memory governance.
 * Runtime memory behavior stays in OpenClaw; this object is the explicit contract
 * surfaced via materialization (`openclawWorkspace.memoryControl`) and API `governance.memoryControl`.
 */
export const PERSAI_MEMORY_CONTROL_SCHEMA_V1 = "persai.memoryControl.v1" as const;

/**
 * Default MVP policy: global memory readable across surfaces; writes only from trusted 1:1 surfaces.
 * Baseline write surface is `web`; Telegram/WhatsApp/MAX direct surfaces are reserved for channel slices (E*).
 */
export function createDefaultMemoryControlEnvelope(): Record<string, unknown> {
  return {
    schema: PERSAI_MEMORY_CONTROL_SCHEMA_V1,
    policy: {
      globalMemoryReadAllSurfaces: true,
      allowedGlobalWriteSurfaces: ["web"],
      trustedOneToOneGlobalWriteSurfaces: ["web"],
      denyGroupSourcedGlobalWrites: true
    },
    sourceClassification: {
      schemaVersion: 1,
      globalWriteRequiresTrust: "trusted_1to1",
      groupSourcedGlobalWriteClass: "group",
      trustedDirectThreadClass: "trusted_1to1"
    },
    provenance: {
      schemaVersion: 1,
      requireSurfaceTag: true,
      requireChannelTagWhenPresent: true
    },
    visibilityHooks: {
      exposeSourceMetadataToUser: true
    },
    forgetRequestMarkers: [],
    audit: {
      delegateToGovernanceAuditHook: true
    }
  };
}
