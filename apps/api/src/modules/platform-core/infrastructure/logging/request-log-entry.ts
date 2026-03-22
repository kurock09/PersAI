export interface RequestLogEntry {
  requestId: string;
  userId: string | null;
  workspaceId: string | null;
  path: string;
  method: string;
  status: number;
  latencyMs: number;
}
