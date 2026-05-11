#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const args = parseArgs(process.argv.slice(2));
const filePath = args.file
  ? path.resolve(repoRoot, args.file)
  : path.join(repoRoot, "infra", "helm", "values-dev.yaml");
const sha = args.sha;
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

const serviceToSection = {
  api: "api",
  runtime: "runtime",
  web: "web",
  "provider-gateway": "providerGateway",
  sandbox: "sandbox"
};

const targetSections = new Set(
  services.map((service) => {
    const section = serviceToSection[service];
    if (!section) {
      throw new Error(`Unsupported service: ${service}`);
    }
    return section;
  })
);

const lines = readFileSync(filePath, "utf8").split(/\r?\n/u);
let currentSection = "";
let inImageBlock = false;
const updatedSections = new Set();

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const topLevelMatch = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*$/u);
  if (topLevelMatch) {
    currentSection = topLevelMatch[1];
    inImageBlock = false;
    continue;
  }

  if (!targetSections.has(currentSection)) {
    continue;
  }

  if (line === "  image:") {
    inImageBlock = true;
    continue;
  }

  if (inImageBlock && /^  [A-Za-z]/u.test(line)) {
    inImageBlock = false;
  }

  if (inImageBlock && /^    tag:\s*/u.test(line)) {
    lines[index] = line.replace(/^    tag:\s*.*/u, `    tag: ${sha}`);
    updatedSections.add(currentSection);
    inImageBlock = false;
  }
}

for (const section of targetSections) {
  if (!updatedSections.has(section)) {
    throw new Error(`Expected to update image tag for section "${section}".`);
  }
}

writeFileSync(filePath, `${lines.join("\n")}\n`);
process.stdout.write(`Pinned ${Array.from(updatedSections).sort().join(", ")} to ${sha}.\n`);

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
