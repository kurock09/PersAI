import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { RequestContextValues } from "./request-context.types";

@Injectable()
export class RequestContextStore {
  private readonly storage = new AsyncLocalStorage<RequestContextValues>();

  run<T>(context: RequestContextValues, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContextValues | undefined {
    return this.storage.getStore();
  }
}
