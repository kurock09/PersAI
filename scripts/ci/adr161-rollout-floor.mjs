/**
 * ADR-161 temporary rollout verification. DELETE IN RELEASE C.
 *
 * `--validate` is deploy-truth only: renders Helm and rejects impossible A/B
 * combinations. `--probe` additionally checks the currently selected pods'
 * exact images and /ready capability markers before a phase transition.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const valuesPath = path.join(repoRoot, "infra/helm/values-dev.yaml");
const readyFetchProgram = [
  'const [url] = process.argv.slice(1);',
  'const response = await fetch(url, {',
  '  headers: { accept: "application/json" },',
  '  signal: AbortSignal.timeout(5000)',
  "});",
  'process.stdout.write(await response.text());'
].join("\n");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}

function selectedTag(values, service) {
  return values[service].image.tag || values.global.images.tag;
}

function assertFloor(values, floorKey, service) {
  const floor = values.adr161TextUsageRollout[floorKey];
  if (!floor.active) return;
  assert.ok(floor.imageTag, `${floorKey} needs an exact imageTag`);
  assert.ok(
    floor.approvedImageTags.includes(floor.imageTag),
    `${floorKey} must approve its floor tag`
  );
  assert.ok(
    floor.approvedImageTags.includes(selectedTag(values, service)),
    `${service} image is not approved by ${floorKey}`
  );
}

function validate(values) {
  const rollout = values.adr161TextUsageRollout;
  assertFloor(values, "runtimeConsumerFloor", "runtime");
  assertFloor(values, "apiConsumerFloor", "api");
  assertFloor(values, "providerGatewayProducerFloor", "providerGateway");
  assertFloor(values, "runtimeProducerFloor", "runtime");
  if (rollout.providerGatewayV2Producer) {
    assert.ok(rollout.runtimeConsumerFloor.active, "B1 needs the runtime consumer floor");
    assert.ok(rollout.providerGatewayProducerFloor.active, "B1 needs the provider producer floor");
  }
  if (rollout.runtimeV2Producer) {
    assert.ok(rollout.apiConsumerFloor.active, "B2 needs the API consumer floor");
    assert.ok(rollout.runtimeProducerFloor.active, "B2 needs the runtime producer floor");
  }
}

function expectedImage(values, service) {
  const tag = selectedTag(values, service);
  return `${values.global.images.registryHost}/${values.global.images.projectId}/${values.global.images.repository}/${values[service].image.name}:${tag}`;
}

export function buildReadyExecArgs(namespace, podName, service, port) {
  return [
    "-n",
    namespace,
    "exec",
    podName,
    "-c",
    service,
    "--",
    "node",
    "--input-type=module",
    "-e",
    readyFetchProgram,
    `http://127.0.0.1:${port}/ready`
  ];
}

export function parseReadyResponse(raw, service, podName) {
  try {
    return JSON.parse(raw);
  } catch {
    const suffix = raw.trim() ? `: ${raw.trim()}` : "";
    throw new Error(`${service}/${podName} returned malformed /ready JSON${suffix}`);
  }
}

export function assertReadyResponse(response, service, podName) {
  assert.equal(
    response.ready === true || response.status === "ready",
    true,
    `${service}/${podName} is not ready: ${JSON.stringify(response)}`
  );
}

function ready(values, service, port) {
  const namespace = values.global.namespace;
  const pod = JSON.parse(
    run("kubectl", [
      "-n",
      namespace,
      "get",
      "pods",
      "-l",
      `app.kubernetes.io/name=${service}`,
      "-o",
      "json"
    ])
  );
  assert.ok(pod.items.length > 0, `${service} has no pods`);
  const responses = [];
  for (const item of pod.items) {
    assert.equal(item.status.phase, "Running", `${service}/${item.metadata.name} is not Running`);
    const image = item.spec.containers.find((container) => container.name === service)?.image;
    assert.equal(
      image,
      expectedImage(values, service),
      `${service}/${item.metadata.name} image mismatch`
    );
    const response = parseReadyResponse(
      run("kubectl", buildReadyExecArgs(namespace, item.metadata.name, service, port)),
      service,
      item.metadata.name
    );
    assertReadyResponse(response, service, item.metadata.name);
    responses.push(response);
  }
  return responses;
}

export function main(args = process.argv.slice(2)) {
  const probe = args.includes("--probe");
  const values = yaml.parse(readFileSync(valuesPath, "utf8"));
  validate(values);
  run("helm", [
    "lint",
    "infra/helm",
    "-f",
    "infra/helm/values.yaml",
    "-f",
    "infra/helm/values-dev.yaml"
  ]);
  run("helm", [
    "template",
    "persai-dev",
    "infra/helm",
    "-f",
    "infra/helm/values.yaml",
    "-f",
    "infra/helm/values-dev.yaml"
  ]);

  if (probe) {
    for (const runtime of ready(values, "runtime", 3012)) {
      assert.equal(runtime.capabilities?.textUsageV2Consumer, true);
      assert.equal(
        runtime.capabilities?.textUsageV2Producer,
        values.adr161TextUsageRollout.runtimeV2Producer
      );
    }
    for (const api of ready(values, "api", 3001)) {
      assert.equal(api.capabilities?.textUsageV2Consumer, true);
    }
    for (const gateway of ready(values, "provider-gateway", 3011)) {
      assert.equal(
        gateway.capabilities?.textUsageV2Producer,
        values.adr161TextUsageRollout.providerGatewayV2Producer
      );
    }
  }

  console.log(`ADR-161 rollout floor ${probe ? "probe" : "validation"} passed`);
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main();
}
