import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestContextStore } from "../../infrastructure/request-context/request-context.store";
import { NextRequestFunction, RequestWithPlatformContext, ResponseWithPlatformContext } from "./request-http.types";

const REQUEST_ID_HEADER = "x-request-id";

function toHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContextStore: RequestContextStore) {}

  use(req: RequestWithPlatformContext, res: ResponseWithPlatformContext, next: NextRequestFunction): void {
    const incomingRequestId = toHeaderString(req.headers[REQUEST_ID_HEADER]);
    const requestId = incomingRequestId && incomingRequestId.trim().length > 0 ? incomingRequestId : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    this.requestContextStore.run(
      {
        requestId,
        userId: null,
        workspaceId: null
      },
      () => {
        next();
      }
    );
  }
}
