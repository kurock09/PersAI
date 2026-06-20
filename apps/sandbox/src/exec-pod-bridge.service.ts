import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { KubeConfig, CoreV1Api, Exec, V1Status } from "@kubernetes/client-node";
import type { SandboxConfig } from "@persai/config";
import type { RuntimeSandboxPolicy } from "@persai/runtime-contract";
import { SANDBOX_CONFIG } from "./sandbox-config";

export type PodExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  execPodName: string;
};

type BridgeError = Error & { code: string; blocked: boolean };

function createBridgeError(code: string, message: string, blocked = true): BridgeError {
  const error = new Error(message) as BridgeError;
  error.code = code;
  error.blocked = blocked;
  return error;
}

function posixSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function posixCommandArray(parts: string[]): string {
  return parts.map(posixSingleQuote).join(" ");
}

function extractExitCode(status: V1Status): number {
  if (status.status === "Success") {
    return 0;
  }
  const cause = status.details?.causes?.find((c) => c.reason === "ExitCode");
  if (cause?.message !== undefined && cause.message !== null) {
    const parsed = parseInt(cause.message, 10);
    return isNaN(parsed) ? 1 : parsed;
  }
  return 1;
}

class LimitedCollector extends Writable {
  private readonly chunks: Buffer[] = [];
  private totalBytes = 0;
  limitError: BridgeError | null = null;

  constructor(
    private readonly limitBytes: number,
    private readonly limitCode: string,
    private readonly limitMessage: string
  ) {
    super();
  }

  override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
    this.totalBytes += chunk.length;
    this.chunks.push(chunk);
    if (this.totalBytes > this.limitBytes && this.limitError === null) {
      this.limitError = createBridgeError(this.limitCode, this.limitMessage);
    }
    callback();
  }

  collect(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

@Injectable()
export class ExecPodBridgeService {
  private readonly logger = new Logger(ExecPodBridgeService.name);
  private readonly kc: KubeConfig;
  private readonly k8sApi: CoreV1Api;
  private readonly execApi: Exec;

  constructor(@Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig) {
    this.kc = new KubeConfig();
    this.kc.loadFromCluster();
    this.k8sApi = this.kc.makeApiClient(CoreV1Api);
    this.execApi = new Exec(this.kc);
  }

  async runInPod(options: {
    jobId: string;
    runtimeSessionId: string | null;
    workspaceRoot: string;
    absoluteCwd: string;
    command: string;
    args: string[];
    policy: RuntimeSandboxPolicy;
  }): Promise<PodExecResult> {
    const podName = this.buildPodName(options.jobId);
    const namespace = this.config.SANDBOX_EXEC_NAMESPACE;
    const startedAt = Date.now();

    this.logger.log(
      `exec_pod_create job=${options.jobId} pod=${podName} session=${options.runtimeSessionId ?? "none"}`
    );

    await this.createExecPod(podName, namespace, options.policy);
    try {
      await this.waitForPodRunning(podName, namespace, options.policy.maxProcessRuntimeMs);
      await this.pushWorkspace(podName, namespace, options.workspaceRoot);
      const podCwd = this.toPodCwd(options.workspaceRoot, options.absoluteCwd);
      const result = await this.execCommand(podName, namespace, {
        command: options.command,
        args: options.args,
        podCwd,
        policy: options.policy
      });
      await this.pullWorkspace(podName, namespace, options.workspaceRoot);
      return {
        ...result,
        durationMs: Date.now() - startedAt,
        execPodName: podName
      };
    } finally {
      await this.deletePod(podName, namespace);
    }
  }

  private buildPodName(jobId: string): string {
    const sanitized = jobId.replace(/-/g, "").slice(0, 32).toLowerCase();
    return `exec-${sanitized}`;
  }

  private toPodCwd(workspaceRoot: string, absoluteCwd: string): string {
    if (absoluteCwd === workspaceRoot) {
      return "/workspace";
    }
    const relPart = absoluteCwd
      .substring(workspaceRoot.length)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    return relPart.length > 0 ? `/workspace/${relPart}` : "/workspace";
  }

  private async createExecPod(
    podName: string,
    namespace: string,
    policy: RuntimeSandboxPolicy
  ): Promise<void> {
    const image = this.config.SANDBOX_EXEC_IMAGE;
    const runtimeClassName = this.config.SANDBOX_EXEC_RUNTIME_CLASS_NAME;
    const nodeSelectorValue = this.config.SANDBOX_EXEC_NODE_SELECTOR_VALUE;
    const memMb = Math.ceil(policy.maxMemoryBytesPerJob / (1024 * 1024));
    const memLimit = `${Math.max(memMb, 64)}Mi`;
    const memRequest = `${Math.min(Math.max(memMb, 64), 256)}Mi`;

    try {
      await this.k8sApi.createNamespacedPod({
        namespace,
        body: {
          apiVersion: "v1",
          kind: "Pod",
          metadata: {
            name: podName,
            namespace,
            labels: {
              "app.kubernetes.io/name": "exec-pod",
              "app.kubernetes.io/component": "sandbox-exec"
            }
          },
          spec: {
            runtimeClassName,
            automountServiceAccountToken: false,
            restartPolicy: "Never",
            nodeSelector: {
              workload: nodeSelectorValue
            },
            tolerations: [
              {
                key: "sandbox.gke.io/runtime",
                operator: "Equal",
                value: "gvisor",
                effect: "NoSchedule"
              }
            ],
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000
            },
            volumes: [
              {
                name: "workspace",
                emptyDir: {
                  sizeLimit: "256Mi"
                }
              },
              {
                name: "tmp",
                emptyDir: {
                  sizeLimit: "64Mi"
                }
              }
            ],
            containers: [
              {
                name: "exec",
                image,
                command: ["/bin/sh", "-c", "sleep infinity"],
                env: this.buildProxyEnv(),
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: {
                    drop: ["ALL"]
                  },
                  seccompProfile: {
                    type: "RuntimeDefault"
                  }
                },
                resources: {
                  requests: {
                    cpu: "250m",
                    memory: memRequest
                  },
                  limits: {
                    cpu: "2",
                    memory: memLimit
                  }
                },
                volumeMounts: [
                  {
                    name: "workspace",
                    mountPath: "/workspace"
                  },
                  {
                    name: "tmp",
                    mountPath: "/tmp"
                  }
                ]
              }
            ]
          }
        }
      });
    } catch (error) {
      throw createBridgeError(
        "process_spawn_failed",
        `Failed to create exec pod: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async waitForPodRunning(
    podName: string,
    namespace: string,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      let phase: string | undefined;
      try {
        const pod = await this.k8sApi.readNamespacedPod({ name: podName, namespace });
        phase = pod.status?.phase;
      } catch (error) {
        throw createBridgeError(
          "process_spawn_failed",
          `Failed to read exec pod status: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (phase === "Running") {
        return;
      }
      if (phase === "Failed" || phase === "Succeeded" || phase === "Unknown") {
        throw createBridgeError(
          "process_spawn_failed",
          `Exec pod entered terminal phase before Running: ${phase}`
        );
      }

      if (Date.now() >= deadline) {
        throw createBridgeError(
          "process_timeout",
          `Timed out waiting for exec pod to reach Running state after ${String(timeoutMs)}ms.`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private async pushWorkspace(
    podName: string,
    namespace: string,
    workspaceRoot: string
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tarChild = spawn("tar", ["-cf", "-", "-C", workspaceRoot, "."], {
        stdio: ["ignore", "pipe", "ignore"]
      });

      const statusReceived = { value: false };
      this.execApi
        .exec(
          namespace,
          podName,
          "exec",
          ["tar", "-xf", "-", "-C", "/workspace"],
          null,
          null,
          tarChild.stdout,
          false,
          (status: V1Status) => {
            statusReceived.value = true;
            if (extractExitCode(status) !== 0) {
              reject(
                createBridgeError(
                  "process_spawn_failed",
                  `Workspace tar push failed: ${status.message ?? "non-zero exit"}`
                )
              );
            } else {
              resolve();
            }
          }
        )
        .then((ws) => {
          ws.on("close", () => {
            if (!statusReceived.value) {
              reject(
                createBridgeError(
                  "process_spawn_failed",
                  "Workspace push WebSocket closed without status"
                )
              );
            }
          });
          ws.on("error", (err: Error) => {
            reject(
              createBridgeError(
                "process_spawn_failed",
                `Workspace push WebSocket error: ${err.message}`
              )
            );
          });
        })
        .catch(reject);

      tarChild.on("error", (err: Error) => {
        reject(
          createBridgeError("process_spawn_failed", `Local tar failed during push: ${err.message}`)
        );
      });
    });
  }

  private async execCommand(
    podName: string,
    namespace: string,
    options: {
      command: string;
      args: string[];
      podCwd: string;
      policy: RuntimeSandboxPolicy;
    }
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const execArgs = [
      "/bin/sh",
      "-c",
      `cd ${posixSingleQuote(options.podCwd)} && ${posixCommandArray([options.command, ...options.args])}`
    ];

    const stdoutCollector = new LimitedCollector(
      options.policy.maxStdoutBytes,
      "stdout_limit_exceeded",
      `Sandbox stdout exceeded ${String(options.policy.maxStdoutBytes)} bytes.`
    );
    const stderrCollector = new LimitedCollector(
      options.policy.maxStderrBytes,
      "stderr_limit_exceeded",
      `Sandbox stderr exceeded ${String(options.policy.maxStderrBytes)} bytes.`
    );

    const resultPromise = new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const statusReceived = { value: false };

        this.execApi
          .exec(
            namespace,
            podName,
            "exec",
            execArgs,
            stdoutCollector,
            stderrCollector,
            null,
            false,
            (status: V1Status) => {
              statusReceived.value = true;
              const limitErr = stdoutCollector.limitError ?? stderrCollector.limitError;
              if (limitErr !== null) {
                reject(limitErr);
                return;
              }
              resolve({
                exitCode: extractExitCode(status),
                stdout: stdoutCollector.collect(),
                stderr: stderrCollector.collect()
              });
            }
          )
          .then((ws) => {
            ws.on("close", () => {
              if (!statusReceived.value) {
                const limitErr = stdoutCollector.limitError ?? stderrCollector.limitError;
                if (limitErr !== null) {
                  reject(limitErr);
                } else {
                  reject(
                    createBridgeError(
                      "sandbox_failed",
                      "Exec WebSocket closed without status",
                      false
                    )
                  );
                }
              }
            });
            ws.on("error", (err: Error) => {
              reject(
                createBridgeError("sandbox_failed", `Exec WebSocket error: ${err.message}`, false)
              );
            });
          })
          .catch(reject);
      }
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            createBridgeError(
              "process_timeout",
              `Sandbox process exceeded ${String(options.policy.maxProcessRuntimeMs)}ms.`
            )
          ),
        options.policy.maxProcessRuntimeMs
      )
    );

    return Promise.race([resultPromise, timeoutPromise]);
  }

  private async pullWorkspace(
    podName: string,
    namespace: string,
    workspaceRoot: string
  ): Promise<void> {
    const tarBytes = await this.collectTarFromPod(podName, namespace);
    await this.extractTarToWorkspace(tarBytes, workspaceRoot);
  }

  private async collectTarFromPod(podName: string, namespace: string): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stdoutCollector = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          chunks.push(chunk);
          callback();
        }
      });

      const statusReceived = { value: false };
      this.execApi
        .exec(
          namespace,
          podName,
          "exec",
          ["tar", "-cf", "-", "-C", "/workspace", "."],
          stdoutCollector,
          null,
          null,
          false,
          (status: V1Status) => {
            statusReceived.value = true;
            if (extractExitCode(status) !== 0) {
              reject(
                createBridgeError(
                  "sandbox_failed",
                  `Workspace tar pull failed: ${status.message ?? "non-zero exit"}`,
                  false
                )
              );
            } else {
              resolve(Buffer.concat(chunks));
            }
          }
        )
        .then((ws) => {
          ws.on("close", () => {
            if (!statusReceived.value) {
              reject(
                createBridgeError(
                  "sandbox_failed",
                  "Workspace pull WebSocket closed without status",
                  false
                )
              );
            }
          });
          ws.on("error", (err: Error) => {
            reject(
              createBridgeError(
                "sandbox_failed",
                `Workspace pull WebSocket error: ${err.message}`,
                false
              )
            );
          });
        })
        .catch(reject);
    });
  }

  private async extractTarToWorkspace(tarBytes: Buffer, workspaceRoot: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const extractChild = spawn("tar", ["-xf", "-", "-C", workspaceRoot], {
        stdio: ["pipe", "ignore", "pipe"]
      });
      const stderrChunks: Buffer[] = [];
      extractChild.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      extractChild.on("error", (err: Error) => {
        reject(
          createBridgeError("sandbox_failed", `Local tar extract failed: ${err.message}`, false)
        );
      });
      extractChild.on("close", (exitCode: number | null) => {
        if (exitCode === 0) {
          resolve();
        } else {
          const stderrMsg = Buffer.concat(stderrChunks).toString("utf8").trim();
          reject(
            createBridgeError(
              "sandbox_failed",
              `Local tar extract exited ${String(exitCode)}: ${stderrMsg}`,
              false
            )
          );
        }
      });
      extractChild.stdin?.end(tarBytes);
    });
  }

  private async deletePod(podName: string, namespace: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedPod({ name: podName, namespace });
      this.logger.log(`exec_pod_deleted pod=${podName}`);
    } catch (error) {
      this.logger.warn(
        `exec_pod_delete_failed pod=${podName} error=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private buildProxyEnv(): Array<{ name: string; value: string }> {
    const proxyUrl = this.config.SANDBOX_EXEC_EGRESS_PROXY_URL;
    if (proxyUrl.length === 0) {
      return [];
    }
    const noProxy = this.config.SANDBOX_EXEC_NO_PROXY;
    const vars: Array<{ name: string; value: string }> = [
      { name: "HTTP_PROXY", value: proxyUrl },
      { name: "HTTPS_PROXY", value: proxyUrl },
      { name: "http_proxy", value: proxyUrl },
      { name: "https_proxy", value: proxyUrl }
    ];
    if (noProxy.length > 0) {
      vars.push({ name: "NO_PROXY", value: noProxy });
      vars.push({ name: "no_proxy", value: noProxy });
    }
    return vars;
  }
}
