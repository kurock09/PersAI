const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const compiledPreviewPath = path.join(
  appRoot,
  "dist/apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.js"
);
const sourcePreviewPath = path.join(
  appRoot,
  "src/modules/workspace-management/application/preview-assistant-setup.service.ts"
);

function readRequiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

const compiledPreview = readRequiredFile(compiledPreviewPath, "compiled setup preview service");
const sourcePreview = readRequiredFile(sourcePreviewPath, "source setup preview service");

if (!sourcePreview.includes("ResolveActiveAssistantService")) {
  throw new Error("Source setup preview service is missing ResolveActiveAssistantService.");
}

if (!compiledPreview.includes("ResolveActiveAssistantService")) {
  throw new Error("Compiled setup preview service is missing ResolveActiveAssistantService.");
}

if (compiledPreview.includes("findByUserId")) {
  throw new Error("Compiled setup preview service still references findByUserId.");
}
