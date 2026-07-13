#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPinDevImageTags,
  PIN_DEV_IMAGE_SERVICE_TO_SECTION
} from "./pin-dev-image-tags-lib.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const args = parseArgs(process.argv.slice(2));
const filePath = args.file
  ? path.resolve(repoRoot, args.file)
  : path.join(repoRoot, "infra", "helm", "values-dev.yaml");
const sha = args.sha;
const dryRun = args["dry-run"] === "true";
const services = (args.services ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!sha) {
  throw new Error("Missing required --sha argument.");
}

if (services.length === 0) {
  process.stdout.write("No services requested for tag pinning.\n");
  process.exit(0);
}

const fileText = readFileSync(filePath, "utf8");
const updated = applyPinDevImageTags(fileText, services, sha);
const updatedSections = [
  ...new Set(
    services.map((service) => {
      const section = PIN_DEV_IMAGE_SERVICE_TO_SECTION[service];
      if (!section) {
        throw new Error(`Unsupported service: ${service}`);
      }
      return section;
    })
  )
].sort();

if (!dryRun) {
  writeFileSync(filePath, updated);
}
process.stdout.write(
  `${dryRun ? "Validated" : "Pinned"} ${updatedSections.join(", ")} to ${sha}.\n`
);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) {
      continue;
    }
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
