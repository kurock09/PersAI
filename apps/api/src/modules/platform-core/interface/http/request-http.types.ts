import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

export interface RequestWithPlatformContext extends IncomingMessage {
  headers: IncomingHttpHeaders;
  method?: string;
  url?: string;
  originalUrl?: string;
  requestId?: string;
  userId?: string | null;
  workspaceId?: string | null;
}

export interface ResponseWithPlatformContext extends ServerResponse<IncomingMessage> {
  statusCode: number;
}

export type NextRequestFunction = () => void;
