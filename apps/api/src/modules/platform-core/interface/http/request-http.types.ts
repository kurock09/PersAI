import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

export interface RequestResolvedAppUser {
  id: string;
  clerkUserId: string;
  email: string;
  displayName: string | null;
}

export interface RequestWithPlatformContext extends IncomingMessage {
  headers: IncomingHttpHeaders;
  method?: string;
  url?: string;
  originalUrl?: string;
  requestId?: string;
  userId?: string | null;
  workspaceId?: string | null;
  resolvedAppUser?: RequestResolvedAppUser;
}

export interface ResponseWithPlatformContext extends ServerResponse<IncomingMessage> {
  statusCode: number;
}

export type NextRequestFunction = () => void;
