import assert from "node:assert/strict";
import { createDefaultMemoryControlEnvelope } from "../src/modules/workspace-management/domain/assistant-memory-control.defaults";
import {
  evaluateGlobalMemoryWritePolicy,
  isGlobalMemoryReadAllowed,
  WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
} from "../src/modules/workspace-management/domain/memory-source-policy";

const base = createDefaultMemoryControlEnvelope();

assert.equal(isGlobalMemoryReadAllowed(base), true);

const denyRead = {
  ...base,
  policy: { ...(base.policy as object), globalMemoryReadAllSurfaces: false }
};
assert.equal(isGlobalMemoryReadAllowed(denyRead), false);

const okWeb = evaluateGlobalMemoryWritePolicy(base, WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT);
assert.equal(okWeb.allowed, true);

const groupDenied = evaluateGlobalMemoryWritePolicy(base, {
  transportSurface: "web",
  sourceTrust: "group"
});
assert.equal(groupDenied.allowed, false);

const surfaceRemoved = {
  ...base,
  policy: {
    ...(base.policy as Record<string, unknown>),
    allowedGlobalWriteSurfaces: [],
    trustedOneToOneGlobalWriteSurfaces: []
  }
};
const noSurface = evaluateGlobalMemoryWritePolicy(
  surfaceRemoved,
  WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
);
assert.equal(noSurface.allowed, false);

console.log("memory-source-policy tests passed");
