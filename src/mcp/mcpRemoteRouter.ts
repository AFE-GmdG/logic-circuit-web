import type McpBridgeRequest from "../types/mcp/mcpBridgeRequest";
import type McpBridgeResponse from "../types/mcp/mcpBridgeResponse";
import type McpRemoteConnectionState from "../types/mcp/mcpRemoteConnectionState";
import type McpRemoteSharedState from "../types/mcp/mcpRemoteSharedState";
import type McpWorkerCommand from "../types/mcp/mcpWorkerCommand";
import type McpWorkerEvent from "../types/mcp/mcpWorkerEvent";

import {
  MCP_EVENT_ACK,
  MCP_EVENT_BYE,
  MCP_EVENT_ERROR,
  MCP_EVENT_HELLO,
  MCP_EVENT_PING,
  MCP_EVENT_PONG,
  MCP_EVENT_REQUEST,
  MCP_EVENT_RESPONSE,
} from "./mcpEvents";

export type McpTabPort = {
  postMessage: (event: McpWorkerEvent) => void;
};

export type McpRemoteSocket = {
  send: (text: string) => void;
  close: (code?: number, reason?: string) => void;
};

export type McpSocketFactory = (callbacks: {
  wsUrl?: string;
  onOpen: () => void;
  onMessage: (raw: string) => void;
  onClose: (code: number, reason: string) => void;
}) => McpRemoteSocket;

type McpRemoteRouterOptions = {
  socketFactory: McpSocketFactory;
  resolveWsUrl?: (sidecarBaseUrl?: string) => string;
  heartbeatIntervalMs?: number;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
};

const WS_CLOSE_UNAUTHORIZED = 4001;

// Zentraler Router für Multi-Tab-Koordination (im SharedWorker oder im Single-Tab-Fallback)
class McpRemoteRouter {
  readonly #socketFactory: McpSocketFactory;
  readonly #resolveWsUrl?: (sidecarBaseUrl?: string) => string;
  readonly #heartbeatIntervalMs: number;
  readonly #baseReconnectDelayMs: number;
  readonly #maxReconnectDelayMs: number;
  readonly #tabs = new Map<string, McpTabPort>();
  readonly #pendingRequests = new Map<string, string>();

  #socket: McpRemoteSocket | null = null;
  #socketOpen = false;
  #desiredConnected = false;
  #connectionState: McpRemoteConnectionState = "off";
  #activeTabId: string | null = null;
  #sessionId: string | null = null;
  #reconnectToken: string | null = null;
  #accessKey = "";
  #sidecarBaseUrl: string | undefined;
  #lastError: string | null = null;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: McpRemoteRouterOptions) {
    this.#socketFactory = options.socketFactory;
    this.#resolveWsUrl = options.resolveWsUrl;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25000;
    this.#baseReconnectDelayMs = options.baseReconnectDelayMs ?? 1000;
    this.#maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
  }

  getState(): McpRemoteSharedState {
    return {
      connectionState: this.#connectionState,
      activeTabId: this.#activeTabId,
      connectedTabCount: this.#tabs.size,
      sessionId: this.#sessionId,
      error: this.#lastError,
      sidecarBaseUrl: this.#sidecarBaseUrl ?? null,
    };
  }

  handleCommand(command: McpWorkerCommand, port?: McpTabPort): void {
    switch (command.type) {
      case "register-tab":
        if (port) {
          this.registerTab(command.tabId, port);
        }
        break;
      case "unregister-tab":
        this.unregisterTab(command.tabId);
        break;
      case "connect":
        this.connect(command.tabId, command.accessKey, command.sidecarBaseUrl);
        break;
      case "disconnect":
        this.disconnect();
        break;
      case "claim-active-tab":
        this.claimActiveTab(command.tabId);
        break;
      case "tool-response":
        this.forwardToolResponse(command.response);
        break;
    }
  }

  registerTab(tabId: string, port: McpTabPort): void {
    this.#tabs.set(tabId, port);
    this.#broadcastState();
  }

  unregisterTab(tabId: string): void {
    if (!this.#tabs.has(tabId)) {
      return;
    }
    this.#tabs.delete(tabId);

    for (const [reqId, assignedTabId] of this.#pendingRequests.entries()) {
      if (assignedTabId === tabId) {
        this.#pendingRequests.delete(reqId);
        this.#sendSocketEnvelope(MCP_EVENT_RESPONSE, {
          id: reqId,
          error: "Der aktive Browser-Tab wurde geschlossen, bevor der Werkzeugaufruf abgeschlossen war.",
        });
      }
    }

    if (this.#activeTabId === tabId) {
      this.#activeTabId = null;
    }

    if (this.#tabs.size === 0 && (this.#desiredConnected || this.#socket !== null)) {
      this.disconnect();
      return;
    }

    this.#broadcastState();
  }

  connect(tabId: string, accessKey?: string, sidecarBaseUrl?: string): void {
    const normalizedKey = (accessKey ?? "").trim();
    const normalizedUrl = sidecarBaseUrl?.trim() || undefined;
    const keyChanged = normalizedKey !== this.#accessKey;
    const urlChanged = normalizedUrl !== this.#sidecarBaseUrl;

    if (urlChanged && this.#socket) {
      this.disconnect();
    }

    this.#accessKey = normalizedKey;
    this.#sidecarBaseUrl = normalizedUrl;
    this.#desiredConnected = true;
    this.#lastError = null;
    if (this.#tabs.has(tabId)) {
      this.#activeTabId = tabId;
    }

    if ((keyChanged || urlChanged) && !this.#socketOpen) {
      this.#sessionId = null;
      this.#reconnectToken = null;
    }

    if (this.#socket) {
      this.#broadcastState();
      return;
    }

    this.#clearReconnectTimer();
    this.#openSocket();
  }

  disconnect(): void {
    this.#desiredConnected = false;
    this.#clearReconnectTimer();
    this.#clearPingTimer();
    this.#pendingRequests.clear();

    if (this.#socket) {
      const socket = this.#socket;
      this.#socket = null;
      if (this.#socketOpen) {
        try {
          socket.send(JSON.stringify({ event: MCP_EVENT_BYE, payload: {} }));
        } catch (_error) {
          // Ignorieren, falls Socket bereits schließt
        }
      }
      this.#socketOpen = false;
      try {
        socket.close(1000, "Client disconnect");
      } catch (_error) {
        // Ignorieren
      }
    }

    this.#connectionState = "off";
    this.#activeTabId = null;
    this.#sessionId = null;
    this.#reconnectToken = null;
    this.#lastError = null;
    this.#reconnectAttempt = 0;
    this.#broadcastState();
  }

  claimActiveTab(tabId: string): void {
    if (!this.#tabs.has(tabId)) {
      return;
    }
    this.#activeTabId = tabId;
    this.#broadcastState();
  }

  forwardToolResponse(response: McpBridgeResponse): void {
    this.#pendingRequests.delete(response.id);
    this.#sendSocketEnvelope(MCP_EVENT_RESPONSE, response);
  }

  #openSocket(): void {
    this.#connectionState = "connecting";
    this.#broadcastState();

    let socketRef: McpRemoteSocket | null = null;
    try {
      const wsUrl = this.#resolveWsUrl?.(this.#sidecarBaseUrl);
      socketRef = this.#socketFactory({
        wsUrl,
        onOpen: () => {
          if (this.#socket !== socketRef) {
            return;
          }
          this.#socketOpen = true;
          this.#reconnectAttempt = 0;

          const helloPayload: Record<string, string> = {};
          if (this.#sessionId && this.#reconnectToken) {
            helloPayload.sessionId = this.#sessionId;
            helloPayload.reconnectToken = this.#reconnectToken;
          }
          if (this.#accessKey.length > 0) {
            helloPayload.accessKey = this.#accessKey;
          }
          this.#sendSocketEnvelope(MCP_EVENT_HELLO, helloPayload);
          this.#startPingTimer();
        },
        onMessage: (raw) => {
          if (this.#socket !== socketRef) {
            return;
          }
          this.#handleSocketMessage(raw);
        },
        onClose: (code) => {
          if (this.#socket !== socketRef) {
            return;
          }
          this.#handleSocketClose(code);
        },
      });
      this.#socket = socketRef;
    } catch (error) {
      this.#socket = null;
      this.#socketOpen = false;
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#connectionState = "error";
      this.#broadcastState();
    }
  }

  #handleSocketMessage(raw: string): void {
    let envelope: { event?: unknown; payload?: unknown };
    try {
      envelope = JSON.parse(raw) as { event?: unknown; payload?: unknown };
    } catch (_error) {
      return;
    }

    switch (envelope.event) {
      case MCP_EVENT_ACK: {
        const payload = (envelope.payload ?? {}) as { sessionId?: unknown; reconnectToken?: unknown };
        this.#sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
        this.#reconnectToken = typeof payload.reconnectToken === "string" ? payload.reconnectToken : null;
        this.#connectionState = "connected";
        this.#lastError = null;
        this.#broadcastState();
        break;
      }
      case MCP_EVENT_ERROR: {
        const payload = (envelope.payload ?? {}) as { error?: unknown };
        this.#lastError = typeof payload.error === "string"
          ? payload.error
          : "Unbekannter Fehler vom Remote-MCP-Server.";
        this.#connectionState = "error";
        this.#broadcastState();
        break;
      }
      case MCP_EVENT_PONG:
        break;
      case MCP_EVENT_REQUEST: {
        const request = envelope.payload as McpBridgeRequest;
        if (!request || typeof request.id !== "string") {
          return;
        }
        const targetPort = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : undefined;
        if (!targetPort || !this.#activeTabId) {
          this.#sendSocketEnvelope(MCP_EVENT_RESPONSE, {
            id: request.id,
            error: "Kein aktiver Browser-Tab für MCP ausgewählt. Bitte im gewünschten Tab aktivieren.",
          });
          return;
        }
        this.#pendingRequests.set(request.id, this.#activeTabId);
        targetPort.postMessage({ type: "execute-request", request });
        break;
      }
      default:
        break;
    }
  }

  #handleSocketClose(code: number): void {
    this.#clearPingTimer();
    this.#socket = null;
    this.#socketOpen = false;
    this.#pendingRequests.clear();

    if (!this.#desiredConnected) {
      this.#connectionState = "off";
      this.#broadcastState();
      return;
    }

    if (code === WS_CLOSE_UNAUTHORIZED) {
      this.#desiredConnected = false;
      this.#sessionId = null;
      this.#reconnectToken = null;
      this.#connectionState = "error";
      this.#lastError = this.#lastError ?? "Ungültiger oder fehlender Zugangsschlüssel (MCP_ACCESS_KEY).";
      this.#broadcastState();
      return;
    }

    this.#connectionState = "connecting";
    this.#broadcastState();

    const delay = Math.min(
      this.#maxReconnectDelayMs,
      this.#baseReconnectDelayMs * 2 ** Math.min(this.#reconnectAttempt, 5),
    );
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#desiredConnected && !this.#socket) {
        this.#openSocket();
      }
    }, delay);
  }

  #sendSocketEnvelope(event: string, payload: unknown): void {
    if (!this.#socket || !this.#socketOpen) {
      return;
    }
    this.#socket.send(JSON.stringify({ event, payload }));
  }

  #startPingTimer(): void {
    this.#clearPingTimer();
    if (this.#heartbeatIntervalMs <= 0) {
      return;
    }
    this.#pingTimer = setInterval(() => {
      this.#sendSocketEnvelope(MCP_EVENT_PING, {});
    }, this.#heartbeatIntervalMs);
  }

  #clearPingTimer(): void {
    if (this.#pingTimer !== null) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #broadcastState(): void {
    const state = this.getState();
    for (const port of this.#tabs.values()) {
      port.postMessage({ type: "state", state });
    }
  }
}

export default McpRemoteRouter;
