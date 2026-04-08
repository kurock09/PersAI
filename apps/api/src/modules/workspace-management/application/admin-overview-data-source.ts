import os from "node:os";
import type { AdminOverviewDataSource } from "./overview-dashboard.types";

export function resolveAdminOverviewDataSource(): AdminOverviewDataSource {
  const instanceId =
    process.env.POD_NAME?.trim() ||
    process.env.HOSTNAME?.trim() ||
    os.hostname().trim() ||
    "api-local";
  const podIp = process.env.POD_IP?.trim() || null;

  return {
    scope: "api_instance_local",
    instanceId,
    podIp
  };
}
