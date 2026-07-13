/**
 * Repository paths that can affect root-context application image builds.
 *
 * Dev Image Publish builds from context `.` and the four Node Dockerfiles use
 * `COPY . .`; keep these shared roots aligned with pnpm-workspace.yaml and the
 * root inputs already treated as build fanout by detect-affected.
 */
export const ROOT_WORKSPACE_BUILD_INPUT_FILES = Object.freeze([
  ".dockerignore",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml"
]);

export const ROOT_WORKSPACE_BUILD_INPUT_DIRECTORIES = Object.freeze([
  "packages",
  "extensions",
  "services",
  "scripts/smoke"
]);

export const ADR146_DEFERRED_RESUME_APP_DIRECTORIES = Object.freeze([
  "apps/api",
  "apps/web",
  "apps/runtime",
  "apps/provider-gateway"
]);

export const ADR146_DEFERRED_RESUME_IMAGE_TREE_PATHS = Object.freeze([
  ...ADR146_DEFERRED_RESUME_APP_DIRECTORIES,
  ...ROOT_WORKSPACE_BUILD_INPUT_DIRECTORIES,
  ...ROOT_WORKSPACE_BUILD_INPUT_FILES
]);
