import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { AssistantLiveVoiceRelayTicketService } from "../../application/assistant-live-voice-relay-ticket.service";
import type { RelayWebSocketLike } from "../../application/assistant-live-voice-relay-connection";
import { pumpRelayConnection } from "../../application/assistant-live-voice-relay-connection";
import { ElevenlabsLiveVoiceClient } from "../../application/elevenlabs/elevenlabs-live-voice.client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";

const RELAY_PATH = "/api/v1/assistant/live-voice/relay";
const RELAY_IDLE_TIMEOUT_MS = 30_000;
const RELAY_MAX_DURATION_MS = 30 * 60_000;
const RELAY_UPSTREAM_OPEN_TIMEOUT_MS = 15_000;

@Injectable()
export class AssistantLiveVoiceRelayGateway
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AssistantLiveVoiceRelayGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private httpServer: HttpServer | null = null;
  private readonly upgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    void this.handleUpgrade(req, socket, head);
  };

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly assistantLiveVoiceRelayTicketService: AssistantLiveVoiceRelayTicketService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly elevenlabsLiveVoiceClient: ElevenlabsLiveVoiceClient
  ) {}

  onApplicationBootstrap(): void {
    this.httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.httpServer.on("upgrade", this.upgradeHandler);
  }

  onApplicationShutdown(): void {
    this.httpServer?.off("upgrade", this.upgradeHandler);
    this.wss.close();
  }

  private async handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== RELAY_PATH) {
      return;
    }

    const ticket = requestUrl.searchParams.get("ticket") ?? "";
    const verified = await this.assistantLiveVoiceRelayTicketService.verify(ticket);
    if (verified === null) {
      this.rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    const session = await this.prisma.assistantLiveVoiceSession.findUnique({
      where: { id: verified.sessionId }
    });
    if (session === null) {
      this.rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (session.userId !== verified.userId || session.status !== "active") {
      this.rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    let signedUrl: string;
    try {
      const credential = await this.elevenlabsLiveVoiceClient.issueCredential({
        agentId: session.elevenlabsAgentId,
        transportProtocol: "websocket"
      });
      if (credential.transportProtocol !== "websocket") {
        throw new Error("ElevenLabs live voice relay requires websocket transport.");
      }
      signedUrl = credential.signedUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to mint relay upstream URL.";
      this.logger.error(
        `Live voice relay upstream credential failed for session ${session.id}: ${message}`
      );
      this.rejectUpgrade(socket, 502, "Bad Gateway");
      return;
    }

    const upstream = new WebSocket(signedUrl);
    let settled = false;
    let openTimeout: NodeJS.Timeout | null = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      this.logger.warn(`Live voice relay upstream open timeout for session ${session.id}.`);
      upstream.terminate();
      this.rejectUpgrade(socket, 502, "Bad Gateway");
    }, RELAY_UPSTREAM_OPEN_TIMEOUT_MS);

    const clearOpenTimeout = (): void => {
      if (openTimeout !== null) {
        clearTimeout(openTimeout);
        openTimeout = null;
      }
    };

    upstream.once("error", (error) => {
      if (settled) {
        this.logger.warn(
          `Live voice relay upstream post-connect error for session ${session.id}: ${error.message}`
        );
        return;
      }
      settled = true;
      clearOpenTimeout();
      this.logger.warn(
        `Live voice relay upstream connect error for session ${session.id}: ${error.message}`
      );
      upstream.terminate();
      this.rejectUpgrade(socket, 502, "Bad Gateway");
    });

    upstream.once("open", () => {
      if (settled) {
        upstream.close();
        return;
      }
      settled = true;
      clearOpenTimeout();
      this.wss.handleUpgrade(req, socket, head, (clientWs) => {
        const startedAt = Date.now();
        this.logger.log(`Live voice relay connected for session ${session.id}.`);
        const dispose = pumpRelayConnection({
          client: toRelaySocket(clientWs),
          upstream: toRelaySocket(upstream),
          idleTimeoutMs: RELAY_IDLE_TIMEOUT_MS,
          maxDurationMs: RELAY_MAX_DURATION_MS,
          logger: {
            debug: (message) => this.logger.debug(`${message} session=${session.id}`),
            warn: (message) => this.logger.warn(`${message} session=${session.id}`)
          }
        });
        const logClose = (source: string, code?: number): void => {
          const durationMs = Date.now() - startedAt;
          this.logger.log(
            `Live voice relay disconnected for session ${session.id}: source=${source} code=${String(code ?? "")} durationMs=${String(durationMs)}`
          );
        };
        clientWs.once("close", (code) => {
          logClose("client", code);
          dispose();
        });
        upstream.once("close", (code) => {
          logClose("upstream", code);
          dispose();
        });
        clientWs.once("error", (error) => {
          this.logger.warn(
            `Live voice relay client websocket error for session ${session.id}: ${error.message}`
          );
        });
      });
    });
  }

  private rejectUpgrade(socket: Socket, statusCode: number, message: string): void {
    if (!socket.writable) {
      socket.destroy();
      return;
    }
    socket.write(
      `HTTP/1.1 ${String(statusCode)} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
    socket.destroy();
  }
}

function toRelaySocket(socket: WebSocket): RelayWebSocketLike {
  return {
    get readyState() {
      return socket.readyState;
    },
    get OPEN() {
      return WebSocket.OPEN;
    },
    on(event, cb) {
      socket.on(event, cb as never);
      return this;
    },
    send(data, opts, cb) {
      socket.send(data as never, opts ?? {}, cb);
    },
    close(code, reason) {
      socket.close(code, reason);
    }
  };
}
