#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

process.chdir(repoRoot);

const APP_METADATA = {
  api: {
    service: "api",
    workspace: "@persai/api",
    relPath: "apps/api",
    dockerfile: "apps/api/Dockerfile",
    valuesKey: "api",
    buildArgs: ""
  },
  runtime: {
    service: "runtime",
    workspace: "@persai/runtime",
    relPath: "apps/runtime",
    dockerfile: "apps/runtime/Dockerfile",
    valuesKey: "runtime",
    buildArgs: ""
  },
  web: {
    service: "web",
    workspace: "@persai/web",
    relPath: "apps/web",
    dockerfile: "apps/web/Dockerfile",
    valuesKey: "web",
    buildArgs: "web"
  },
  "provider-gateway": {
    service: "provider-gateway",
    workspace: "@persai/provider-gateway",
    relPath: "apps/provider-gateway",
    dockerfile: "apps/provider-gateway/Dockerfile",
    valuesKey: "providerGateway",
    buildArgs: ""
  },
  sandbox: {
    service: "sandbox",
    workspace: "@persai/sandbox",
    relPath: "apps/sandbox",
    dockerfile: "apps/sandbox/Dockerfile",
    valuesKey: "sandbox",
    buildArgs: ""
  }
};

const args = parseArgs(process.argv.slice(2));
const baseRef = args.base ?? "";
const headRef = args.head ?? "HEAD";
const eventName = args.event ?? process.env.GITHUB_EVENT_NAME ?? "pull_request";
const changedFilesOverride = args["changed-files"] ?? "";
const outputPath = args["github-output"] ?? process.env.GITHUB_OUTPUT ?? "";
const summaryPath = args["github-step-summary"] ?? process.env.GITHUB_STEP_SUMMARY ?? "";

const workspaceProjects = loadWorkspaceProjects();
const workspaceProjectsById = new Map(workspaceProjects.map((project) => [project.id, project]));
const dependentsGraph = buildDependentsGraph(workspaceProjects);
const allProjectIds = workspaceProjects.map((project) => project.id);
const allAppIds = workspaceProjects
  .filter((project) => project.kind === "app")
  .map((project) => project.id);
const deployableAppIds = allAppIds.filter((projectId) =>
  Object.prototype.hasOwnProperty.call(APP_METADATA, projectId)
);

// Guard: only execute as a CLI when run directly (not when imported by tests).
const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const diffFiles = changedFilesOverride
    ? parseChangedFiles(changedFilesOverride)
    : getChangedFiles(baseRef, headRef, eventName);
  const result = detectAffected(diffFiles);

  if (outputPath) {
    writeGithubOutput(outputPath, result);
  }

  if (summaryPath) {
    writeGithubSummary(summaryPath, result);
  }

  const output = {
    baseRef: result.baseRef,
    headRef: result.headRef,
    changedFiles: result.changedFiles,
    flags: {
      docsOnly: result.docsOnly,
      testOnly: result.testOnly,
      runHelmValidation: result.runHelmValidation,
      migrationChanged: result.migrationChanged,
      requiresIntegration: result.requiresIntegration,
      requiresFullCi: result.requiresFullCi
    },
    risks: result.riskReasons,
    affectedProjects: result.affectedProjects,
    appTestTargets: result.appTestTargets,
    deployServices: result.deployServices,
    summary: result.summary
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function detectAffected(changedFiles) {
  const changedProjectIds = new Set();
  const ciTargetIds = new Set();
  const appTestTargetIds = new Set();
  const deployTargetIds = new Set();
  const deployReasons = new Map();
  const riskReasons = new Set();

  let runHelmValidation = false;
  let migrationChanged = false;
  let ciConfigChanged = false;
  let hasCodeLikeChange = false;
  let hasDocLikeChange = false;
  let hasNonTestCodeChange = false;

  for (const file of changedFiles) {
    const normalized = normalizePath(file);
    const classification = classifyFile(normalized);

    if (classification.isDocumentation) {
      hasDocLikeChange = true;
    } else {
      hasCodeLikeChange = true;
    }

    if (!classification.isDocumentation && !classification.isTestOnly) {
      hasNonTestCodeChange = true;
    }

    if (classification.runHelmValidation) {
      runHelmValidation = true;
    }

    if (classification.ciConfigChanged) {
      ciConfigChanged = true;
      riskReasons.add("ci-config");
    }

    if (classification.migrationChanged) {
      migrationChanged = true;
      riskReasons.add("schema-or-migration");
    }

    for (const risk of classification.risks) {
      riskReasons.add(risk);
    }

    for (const projectId of classification.projects) {
      changedProjectIds.add(projectId);
      ciTargetIds.add(projectId);
    }

    for (const projectId of classification.testTargets) {
      appTestTargetIds.add(projectId);
      ciTargetIds.add(projectId);
    }

    for (const appId of classification.deployTargets) {
      deployTargetIds.add(appId);
      const reasons = deployReasons.get(appId) ?? new Set();
      reasons.add(classification.deployReason ?? "direct-change");
      deployReasons.set(appId, reasons);
    }
  }

  if (migrationChanged) {
    for (const projectId of ["api", "runtime", "sandbox"]) {
      if (workspaceProjectsById.has(projectId)) {
        ciTargetIds.add(projectId);
        appTestTargetIds.add(projectId);
        deployTargetIds.add(projectId);
        const reasons = deployReasons.get(projectId) ?? new Set();
        reasons.add("schema-or-migration");
        deployReasons.set(projectId, reasons);
      }
    }
  }

  if (!changedFiles.length && eventName === "workflow_dispatch") {
    for (const appId of deployableAppIds) {
      ciTargetIds.add(appId);
      appTestTargetIds.add(appId);
      deployTargetIds.add(appId);
      const reasons = deployReasons.get(appId) ?? new Set();
      reasons.add("manual-dispatch");
      deployReasons.set(appId, reasons);
    }
  }

  const docsOnly = changedFiles.length > 0 && !hasCodeLikeChange && !runHelmValidation;
  const testOnly =
    changedFiles.length > 0 &&
    hasCodeLikeChange &&
    !hasNonTestCodeChange &&
    !runHelmValidation &&
    !migrationChanged;

  const requiresIntegration =
    migrationChanged ||
    hasRisk(riskReasons, [
      "auth",
      "billing",
      "runtime-concurrency",
      "contracts-boundary",
      "runtime-boundary"
    ]);

  const requiresFullCi =
    ciConfigChanged ||
    migrationChanged ||
    hasRisk(riskReasons, ["auth", "billing", "runtime-concurrency", "root-workspace"]);

  const affectedProjects = sortProjects(ciTargetIds).map(toProjectOutput);
  const appTestTargets = sortProjects(appTestTargetIds)
    .filter((project) => project.kind === "app")
    .map(toProjectOutput);
  const deployServices = sortAppIds(deployTargetIds).map((appId) => {
    const metadata = APP_METADATA[appId];
    return {
      service: metadata.service,
      workspace: metadata.workspace,
      dockerfile: metadata.dockerfile,
      valuesKey: metadata.valuesKey,
      buildArgs: metadata.buildArgs,
      reasons: Array.from(deployReasons.get(appId) ?? []).sort()
    };
  });

  const summary = buildSummary({
    changedFiles,
    affectedProjects,
    appTestTargets,
    deployServices,
    docsOnly,
    testOnly,
    runHelmValidation,
    migrationChanged,
    requiresIntegration,
    requiresFullCi,
    riskReasons: Array.from(riskReasons).sort()
  });

  return {
    baseRef,
    headRef,
    changedFiles,
    docsOnly,
    testOnly,
    runHelmValidation,
    migrationChanged,
    requiresIntegration,
    requiresFullCi,
    riskReasons: Array.from(riskReasons).sort(),
    affectedProjects,
    appTestTargets,
    deployServices,
    summary
  };
}

function classifyFile(file) {
  const projects = new Set();
  const testTargets = new Set();
  const deployTargets = new Set();
  const risks = new Set();

  const appMatch = file.match(/^apps\/([^/]+)\/(.*)$/);
  const packageMatch = file.match(/^(packages|services)\/([^/]+)\/(.*)$/);
  const isMarkdown = file.endsWith(".md");
  const isDocumentation =
    file.startsWith("docs/") || isMarkdown || file === "AGENTS.md" || file === "README.md";
  const isWorkflow = file.startsWith(".github/workflows/");
  const isCiScript = file.startsWith("scripts/ci/");
  const isHelmOrGitOps = file.startsWith("infra/helm/") || file.startsWith("infra/dev/gitops/");
  const isInfraDoc = file.startsWith("infra/") && file.endsWith(".md");
  const isTestOnly = isAppTestFile(file) || isPackageTestFile(file);
  const isRootWorkspaceFile = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".dockerignore"
  ]).has(file);

  if (isHelmOrGitOps) {
    return {
      projects,
      testTargets,
      deployTargets,
      risks,
      isDocumentation: false,
      isTestOnly: false,
      runHelmValidation: true,
      ciConfigChanged: false,
      migrationChanged: false,
      deployReason: ""
    };
  }

  if (isWorkflow || isCiScript) {
    if (
      file === ".github/workflows/dev-image-publish.yml" ||
      file === "scripts/ci/detect-affected.mjs"
    ) {
      deployTargets.add("web");
    }
    return {
      projects,
      testTargets,
      deployTargets,
      risks,
      isDocumentation: false,
      isTestOnly: false,
      runHelmValidation: false,
      ciConfigChanged: true,
      migrationChanged: false,
      deployReason: deployTargets.size > 0 ? "deploy-pipeline-change" : ""
    };
  }

  if (isRootWorkspaceFile) {
    for (const projectId of allProjectIds) {
      projects.add(projectId);
      if (workspaceProjectsById.get(projectId)?.kind === "app") {
        testTargets.add(projectId);
      }
    }
    for (const appId of deployableAppIds) {
      deployTargets.add(appId);
    }
    risks.add("root-workspace");
    return {
      projects,
      testTargets,
      deployTargets,
      risks,
      isDocumentation: false,
      isTestOnly: false,
      runHelmValidation: false,
      ciConfigChanged: false,
      migrationChanged: false,
      deployReason: "root-workspace"
    };
  }

  if (appMatch) {
    const appId = appMatch[1];
    const rest = appMatch[2];
    if (!workspaceProjectsById.has(appId)) {
      return emptyClassification(isDocumentation || isInfraDoc, isTestOnly);
    }

    const appDocumentationOnly = isDocumentation || isInfraDoc;
    if (appDocumentationOnly && !isTestOnly) {
      return emptyClassification(true, false);
    }

    projects.add(appId);
    testTargets.add(appId);

    const migrationChanged =
      appId === "api" &&
      (rest.startsWith("prisma/") ||
        rest.endsWith("schema.prisma") ||
        rest.includes("/migrations/"));

    if (!isDocumentation && !isTestOnly) {
      if (APP_METADATA[appId]) {
        deployTargets.add(appId);
      }
    }

    addRiskFlags(file, risks);

    return {
      projects,
      testTargets,
      deployTargets,
      risks,
      isDocumentation: appDocumentationOnly,
      isTestOnly,
      runHelmValidation: false,
      ciConfigChanged: false,
      migrationChanged,
      deployReason: migrationChanged ? "schema-or-migration" : "direct-app-change"
    };
  }

  if (packageMatch) {
    const packageId = packageMatch[2];
    const rest = packageMatch[3];
    if (!workspaceProjectsById.has(packageId)) {
      return emptyClassification(isDocumentation || isInfraDoc, isTestOnly);
    }

    const isPackageDoc = isDocumentation || isInfraDoc;
    const onlyTests = isPackageDoc ? false : isTestOnly;
    const deployFromPackageChange = !onlyTests && packageId !== "eslint-config";

    if (!isPackageDoc) {
      projects.add(packageId);
      for (const dependentId of collectDependents(packageId, dependentsGraph)) {
        projects.add(dependentId);
        if (workspaceProjectsById.get(dependentId)?.kind === "app") {
          testTargets.add(dependentId);
          if (deployFromPackageChange && APP_METADATA[dependentId]) {
            deployTargets.add(dependentId);
          }
        }
      }

      if (
        packageId === "contracts" ||
        rest === "openapi.yaml" ||
        rest.startsWith("src/generated/")
      ) {
        risks.add("contracts-boundary");
      }

      if (packageId === "runtime-contract" || packageId === "runtime-bundle") {
        risks.add("runtime-boundary");
      }
    }

    return {
      projects,
      testTargets,
      deployTargets,
      risks,
      isDocumentation: isPackageDoc,
      isTestOnly: onlyTests,
      runHelmValidation: false,
      ciConfigChanged: false,
      migrationChanged: false,
      deployReason: "shared-package-change"
    };
  }

  return emptyClassification(isDocumentation || isInfraDoc, isTestOnly);
}

function emptyClassification(isDocumentation, isTestOnly) {
  return {
    projects: new Set(),
    testTargets: new Set(),
    deployTargets: new Set(),
    risks: new Set(),
    isDocumentation,
    isTestOnly,
    runHelmValidation: false,
    ciConfigChanged: false,
    migrationChanged: false,
    deployReason: ""
  };
}

function addRiskFlags(file, risks) {
  const lowered = file.toLowerCase();

  if (
    lowered.includes("identity-access") ||
    lowered.includes("clerk") ||
    lowered.includes("/auth") ||
    lowered.includes("sign-in") ||
    lowered.includes("sign-up")
  ) {
    risks.add("auth");
  }

  if (
    lowered.includes("billing") ||
    lowered.includes("payment") ||
    lowered.includes("subscription") ||
    lowered.includes("cloudpayments")
  ) {
    risks.add("billing");
  }

  if (
    lowered.startsWith("apps/runtime/") &&
    [
      "turn-execution",
      "admission",
      "queue",
      "scheduler",
      "background-task",
      "media-job",
      "concurr",
      "fairness"
    ].some((token) => lowered.includes(token))
  ) {
    risks.add("runtime-concurrency");
  }
}

function buildSummary({
  changedFiles,
  affectedProjects,
  appTestTargets,
  deployServices,
  docsOnly,
  testOnly,
  runHelmValidation,
  migrationChanged,
  requiresIntegration,
  requiresFullCi,
  riskReasons
}) {
  const parts = [];
  parts.push(`changed-files=${changedFiles.length}`);
  parts.push(`checks=${affectedProjects.map((project) => project.workspace).join(",") || "none"}`);
  parts.push(`tests=${appTestTargets.map((project) => project.workspace).join(",") || "none"}`);
  parts.push(`deploy=${deployServices.map((service) => service.service).join(",") || "none"}`);
  if (docsOnly) {
    parts.push("docs-only=true");
  }
  if (testOnly) {
    parts.push("test-only=true");
  }
  if (runHelmValidation) {
    parts.push("helm-validation=true");
  }
  if (migrationChanged) {
    parts.push("migration-path=true");
  }
  if (requiresIntegration) {
    parts.push("integration=true");
  }
  if (requiresFullCi) {
    parts.push("full-ci=true");
  }
  if (riskReasons.length > 0) {
    parts.push(`risk=${riskReasons.join(",")}`);
  }
  return parts.join(" | ");
}

function writeGithubOutput(outputPath, result) {
  const lines = [];
  writeOutputValue(lines, "docs_only", String(result.docsOnly));
  writeOutputValue(lines, "test_only", String(result.testOnly));
  writeOutputValue(lines, "run_helm_validation", String(result.runHelmValidation));
  writeOutputValue(lines, "migration_changed", String(result.migrationChanged));
  writeOutputValue(lines, "requires_integration", String(result.requiresIntegration));
  writeOutputValue(lines, "requires_full_ci", String(result.requiresFullCi));
  writeOutputValue(lines, "summary", result.summary);
  writeOutputValue(lines, "risk_reasons_json", JSON.stringify(result.riskReasons));
  writeOutputValue(lines, "affected_projects_json", JSON.stringify(result.affectedProjects));
  writeOutputValue(lines, "app_test_targets_json", JSON.stringify(result.appTestTargets));
  writeOutputValue(lines, "deploy_services_json", JSON.stringify(result.deployServices));
  writeOutputValue(
    lines,
    "deploy_service_names_csv",
    result.deployServices.map((service) => service.service).join(",")
  );
  writeOutputValue(lines, "changed_files_json", JSON.stringify(result.changedFiles));
  writeFileSync(outputPath, lines.join(""), { flag: "a" });
}

function writeGithubSummary(summaryPath, result) {
  const lines = [
    "## detect-affected",
    "",
    `- Summary: \`${result.summary}\``,
    `- Full CI required: \`${result.requiresFullCi}\``,
    `- Integration required: \`${result.requiresIntegration}\``,
    `- Helm validation: \`${result.runHelmValidation}\``,
    `- Migration path: \`${result.migrationChanged}\``,
    `- Affected checks: ${
      result.affectedProjects.map((project) => `\`${project.workspace}\``).join(", ") || "none"
    }`,
    `- Deploy services: ${
      result.deployServices.map((service) => `\`${service.service}\``).join(", ") || "none"
    }`,
    ""
  ];
  writeFileSync(summaryPath, `${lines.join("\n")}\n`, { flag: "a" });
}

function writeOutputValue(lines, key, value) {
  const marker = `EOF_${key.toUpperCase()}`;
  lines.push(`${key}<<${marker}\n${value}\n${marker}\n`);
}

function getChangedFiles(base, head, event) {
  const resolvedHead = head || "HEAD";
  if (!base) {
    return [];
  }

  const separator = event === "push" ? ".." : "...";
  const diffSpec = `${base}${separator}${resolvedHead}`;
  const stdout = execGit(["diff", "--name-only", diffSpec]);
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseChangedFiles(raw) {
  return raw
    .split(/[,\r\n]+/u)
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);
}

function loadWorkspaceProjects() {
  const projects = [];
  for (const relDir of ["apps", "packages", "services"]) {
    const absDir = path.join(repoRoot, relDir);
    if (!existsSync(absDir)) {
      continue;
    }

    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(absDir, entry.name, "package.json");
      if (!existsSync(packageJsonPath)) {
        continue;
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      const id = entry.name;
      const localDeps = collectLocalDependencies(packageJson);
      projects.push({
        id,
        workspace: packageJson.name,
        kind: relDir === "apps" ? "app" : relDir === "packages" ? "package" : "service",
        relPath: normalizePath(path.join(relDir, entry.name)),
        localDeps
      });
    }
  }
  return projects;
}

function collectLocalDependencies(packageJson) {
  const deps = new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const record = packageJson[field] ?? {};
    for (const [name, version] of Object.entries(record)) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        deps.add(name);
      }
    }
  }
  return Array.from(deps);
}

function buildDependentsGraph(projects) {
  const byWorkspace = new Map(projects.map((project) => [project.workspace, project.id]));
  const graph = new Map(projects.map((project) => [project.id, new Set()]));

  for (const project of projects) {
    for (const dependencyName of project.localDeps) {
      const dependencyId = byWorkspace.get(dependencyName);
      if (!dependencyId) {
        continue;
      }
      graph.get(dependencyId)?.add(project.id);
    }
  }

  return graph;
}

function collectDependents(projectId, graph) {
  const visited = new Set();
  const queue = [projectId];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependentId of graph.get(current) ?? []) {
      if (visited.has(dependentId)) {
        continue;
      }
      visited.add(dependentId);
      queue.push(dependentId);
    }
  }

  return visited;
}

function sortProjects(projectIds) {
  return Array.from(projectIds)
    .map((projectId) => workspaceProjectsById.get(projectId))
    .filter(Boolean)
    .sort((left, right) => left.workspace.localeCompare(right.workspace));
}

function sortAppIds(projectIds) {
  return Array.from(projectIds).sort((left, right) => left.localeCompare(right));
}

function toProjectOutput(project) {
  return {
    id: project.id,
    kind: project.kind,
    workspace: project.workspace,
    relPath: project.relPath
  };
}

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

function execGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function normalizePath(filePath) {
  return filePath.replace(/\\/gu, "/");
}

function hasRisk(risks, expectedRisks) {
  return expectedRisks.some((risk) => risks.has(risk));
}

function isAppTestFile(file) {
  return (
    /^apps\/[^/]+\/test\//u.test(file) ||
    /^apps\/[^/]+\/.*\.test\.[^/]+$/u.test(file) ||
    /^apps\/[^/]+\/vitest\.config\./u.test(file)
  );
}

function isPackageTestFile(file) {
  return (
    /^(packages|services)\/[^/]+\/test\//u.test(file) ||
    /^(packages|services)\/[^/]+\/.*\.test\.[^/]+$/u.test(file)
  );
}

export { detectAffected };
