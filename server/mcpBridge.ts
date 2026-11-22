import type McpBridgeRequest from "../src/types/mcp/mcpBridgeRequest.ts";
import type McpBridgeResponse from "../src/types/mcp/mcpBridgeResponse.ts";

import {
  MCP_EVENT_ACK,
  MCP_EVENT_BYE,
  MCP_EVENT_HELLO,
  MCP_EVENT_REQUEST,
  MCP_EVENT_RESPONSE,
} from "../src/mcp/mcpEvents.ts";

// Minimale Sicht auf einen Browser-Client (entkoppelt von Vite für Tests und alternative Transporte)
export type McpBridgeClient = {
  send: (event: string, payload?: unknown) => void;
  socket?: {
    once: (event: "close", listener: () => void) => void;
  };
};

// Minimale Sicht auf einen WebSocket-Event-Kanal (z. B. Vite HMR server.ws)
export type McpWebSocketChannel = {
  on: (event: string, listener: (data: unknown, client: McpBridgeClient) => void) => void;
};

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export const NO_BROWSER_SESSION_MESSAGE =
  "Keine aktive LogicCircuit-Browsersitzung gefunden. Bitte http://localhost:5173 im Browser öffnen.";

// Kennzeichnet Aufrufe, für die keine Browsersitzung angemeldet ist
export class NoBrowserSessionError extends Error {
  constructor() {
    super(NO_BROWSER_SESSION_MESSAGE);
    this.name = "NoBrowserSessionError";
  }
}

// Vermittelt Werkzeugaufrufe zwischen Dev-Server und angemeldeten Browsersitzungen.
// Die zuletzt angemeldete Sitzung ist die aktive Gegenstelle; Antworten werden per ID zugeordnet.
class McpBridge {
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #trackedClients = new WeakSet<object>();
  #clients: McpBridgeClient[] = [];
  #nextRequestId = 1;

  constructor(timeoutMs = 15000) {
    this.#timeoutMs = timeoutMs;
  }

  get isConnected(): boolean {
    return this.#clients.length > 0;
  }

  get clientCount(): number {
    return this.#clients.length;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  // Meldet eine Browsersitzung an (bzw. macht sie erneut zur aktiven Sitzung)
  registerClient(client: McpBridgeClient): void {
    this.#clients = [...this.#clients.filter((c) => c !== client), client];
    client.send(MCP_EVENT_ACK, {});
  }

  // Meldet eine Browsersitzung ab
  unregisterClient(client: McpBridgeClient): void {
    this.#clients = this.#clients.filter((c) => c !== client);
  }

  // Ordnet eine Browser-Antwort dem wartenden Aufruf zu
  handleResponse(response: McpBridgeResponse): void {
    if (!response || typeof response.id !== "string") {
      return;
    }
    const pending = this.#pending.get(response.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(response.id);
    if (typeof response.error === "string") {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  // Sendet einen Werkzeugaufruf an die aktive Browsersitzung und wartet auf die Antwort
  call(method: string, params?: unknown): Promise<unknown> {
    const client = this.#clients.at(-1);
    if (!client) {
      return Promise.reject(new NoBrowserSessionError());
    }

    const id = String(this.#nextRequestId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.#pending.delete(id);
          reject(new Error(`Zeitüberschreitung: Browser hat "${method}" nicht innerhalb von ${this.#timeoutMs} ms beantwortet.`));
        },
        this.#timeoutMs,
      );
      this.#pending.set(id, { resolve, reject, timer });

      const request: McpBridgeRequest = { id, method, params };
      client.send(MCP_EVENT_REQUEST, request);
    });
  }

  // Bindet die Bridge an den HMR-WebSocket-Server von Vite
  attach(ws: McpWebSocketChannel): void {
    ws.on(MCP_EVENT_HELLO, (_data: unknown, client) => {
      this.registerClient(client);
      if (!this.#trackedClients.has(client) && client.socket) {
        this.#trackedClients.add(client);
        client.socket.once("close", () => {
          this.unregisterClient(client);
        });
      }
    });

    ws.on(MCP_EVENT_BYE, (_data: unknown, client) => {
      this.unregisterClient(client);
    });

    ws.on(MCP_EVENT_RESPONSE, (data: unknown) => {
      this.handleResponse(data as McpBridgeResponse);
    });
  }
}

export default McpBridge;
