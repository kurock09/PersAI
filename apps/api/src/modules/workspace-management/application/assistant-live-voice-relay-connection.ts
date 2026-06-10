type RelayCloseListener = (code?: number, reason?: Buffer) => void;
type RelayErrorListener = (error: Error) => void;
type RelayMessageListener = (data: unknown, isBinary: boolean) => void;

export interface RelayWebSocketLike {
  readonly readyState: number;
  readonly OPEN: number;
  on(event: "message", cb: RelayMessageListener): this;
  on(event: "close", cb: RelayCloseListener): this;
  on(event: "error", cb: RelayErrorListener): this;
  send(data: unknown, opts?: { binary?: boolean }, cb?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
}

export type RelayPumpLogger = {
  debug?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
};

export function pumpRelayConnection(input: {
  client: RelayWebSocketLike;
  upstream: RelayWebSocketLike;
  idleTimeoutMs: number;
  maxDurationMs: number;
  logger?: RelayPumpLogger;
}): () => void {
  const { client, upstream, idleTimeoutMs, maxDurationMs, logger } = input;

  let disposed = false;
  let idleTimer: NodeJS.Timeout | null = null;
  let maxDurationTimer: NodeJS.Timeout | null = null;

  const clearTimers = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (maxDurationTimer !== null) {
      clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
  };

  const safeClose = (socket: RelayWebSocketLike, code?: number, reason?: string): void => {
    if (socket.readyState === socket.OPEN) {
      socket.close(code, reason);
    }
  };

  const dispose = (reason: string, code?: number, closeReason?: string): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearTimers();
    logger?.debug?.(reason);
    safeClose(client, code, closeReason);
    safeClose(upstream, code, closeReason);
  };

  const resetIdleTimer = (): void => {
    if (disposed) {
      return;
    }
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      dispose("Live voice relay idle timeout reached.", 4000, "idle timeout");
    }, idleTimeoutMs);
  };

  const forward = (
    source: RelayWebSocketLike,
    target: RelayWebSocketLike,
    direction: string
  ): RelayMessageListener => {
    return (data, isBinary) => {
      if (disposed) {
        return;
      }
      resetIdleTimer();
      if (target.readyState !== target.OPEN) {
        dispose(
          `Live voice relay target closed before forwarding ${direction}.`,
          1011,
          "target closed"
        );
        return;
      }
      target.send(data, { binary: isBinary }, (error?: Error) => {
        if (error !== undefined) {
          logger?.warn?.(`Live voice relay send failed for ${direction}: ${error.message}`);
          dispose(`Live voice relay send failed for ${direction}.`, 1011, "send failed");
        }
      });
      void source;
    };
  };

  client.on("message", forward(client, upstream, "client->upstream"));
  upstream.on("message", forward(upstream, client, "upstream->client"));

  client.on("close", () => {
    dispose("Live voice relay client closed.", 1000, "client closed");
  });
  upstream.on("close", () => {
    dispose("Live voice relay upstream closed.", 1000, "upstream closed");
  });

  client.on("error", (error) => {
    logger?.warn?.(`Live voice relay client error: ${error.message}`);
    dispose("Live voice relay client errored.", 1011, "client error");
  });
  upstream.on("error", (error) => {
    logger?.warn?.(`Live voice relay upstream error: ${error.message}`);
    dispose("Live voice relay upstream errored.", 1011, "upstream error");
  });

  resetIdleTimer();
  maxDurationTimer = setTimeout(() => {
    dispose("Live voice relay max duration reached.", 4001, "max duration");
  }, maxDurationMs);

  return () => {
    dispose("Live voice relay disposed.", 1000, "disposed");
  };
}
