import type McpBridgeRequest from "../types/mcp/mcpBridgeRequest";
import type McpBridgeResponse from "../types/mcp/mcpBridgeResponse";
import type McpBridgeStatus from "../types/mcp/mcpBridgeStatus";
import type McpRemoteSharedState from "../types/mcp/mcpRemoteSharedState";
import type McpWorkerCommand from "../types/mcp/mcpWorkerCommand";
import type McpWorkerEvent from "../types/mcp/mcpWorkerEvent";

import { resolveEffectiveSidecarBaseUrl, toWebSocketUrl } from "../utils/sidecarStorage";

import { MCP_WS_PATH } from "./mcpEvents";
import McpRemoteRouter, { type McpSocketFactory } from "./mcpRemoteRouter";

type McpRemoteClientOptions = {
  tabId?: string;
  useSharedWorker?: boolean;
  workerFactory?: () => SharedWorker;
  socketFactory?: McpSocketFactory;
};

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveRemoteWsUrl(
  locOrBaseUrl?: { protocol: string; host: string; baseUrl?: string } | string,
): string {
  if (typeof locOrBaseUrl === "string") {
    const effective = resolveEffectiveSidecarBaseUrl({ customBaseUrl: locOrBaseUrl });
    return effective ? toWebSocketUrl(effective, MCP_WS_PATH) : "";
  }
  if (locOrBaseUrl?.baseUrl) {
    const effective = resolveEffectiveSidecarBaseUrl({
      customBaseUrl: locOrBaseUrl.baseUrl,
      location: locOrBaseUrl,
    });
    return effective ? toWebSocketUrl(effective, MCP_WS_PATH) : "";
  }
  if (locOrBaseUrl) {
    const protocol = locOrBaseUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${locOrBaseUrl.host}${MCP_WS_PATH}`;
  }
  const effective = resolveEffectiveSidecarBaseUrl();
  return effective ? toWebSocketUrl(effective, MCP_WS_PATH) : "";
}

export function mapRemoteStateToBridgeStatus(state: McpRemoteSharedState, tabId: string): McpBridgeStatus {
  switch (state.connectionState) {
    case "off":
      return "remote-off";
    case "connecting":
      return "remote-connecting";
    case "error":
      return "remote-error";
    case "connected":
      return state.activeTabId === tabId ? "remote-active-self" : "remote-active-other";
  }
}

function createBrowserSocketFactory(): McpSocketFactory {
  return ({ wsUrl, onOpen, onMessage, onClose }) => {
    const targetUrl = wsUrl ?? resolveRemoteWsUrl();
    const ws = new WebSocket(targetUrl);
    ws.addEventListener("open", () => {
      onOpen();
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        onMessage(event.data);
      }
    });
    ws.addEventListener("close", (event) => {
      onClose(event.code, event.reason);
    });
    return {
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
    };
  };
}

// Client-Abstraktion für Remote MCP: nutzt SharedWorker und fällt bei Bedarf auf Single-Tab-WebSocket zurück
class McpRemoteClient {
  readonly #tabId: string;
  readonly #isSharedWorkerSupported: boolean;
  readonly #stateListeners = new Set<(state: McpRemoteSharedState) => void>();
  readonly #requestListeners = new Set<(request: McpBridgeRequest) => void>();

  #workerPort: MessagePort | null = null;
  #fallbackRouter: McpRemoteRouter | null = null;
  #state: McpRemoteSharedState = {
    connectionState: "off",
    activeTabId: null,
    connectedTabCount: 1,
    sessionId: null,
    error: null,
  };
  #disposed = false;

  constructor(options: McpRemoteClientOptions = {}) {
    this.#tabId = options.tabId ?? createTabId();
    const sharedWorkerAvailable = options.useSharedWorker ?? (
      typeof SharedWorker !== "undefined" || Boolean(options.workerFactory)
    );
    this.#isSharedWorkerSupported = sharedWorkerAvailable;

    if (sharedWorkerAvailable) {
      try {
        const worker = options.workerFactory
          ? options.workerFactory()
          : new SharedWorker(new URL("./mcpSharedWorker.ts", import.meta.url), {
            type: "module",
            name: "logic-circuit-mcp",
          });
        this.#workerPort = worker.port;
        worker.port.onmessage = (event: MessageEvent<McpWorkerEvent>) => {
          this.#handleWorkerEvent(event.data);
        };
        worker.onerror = () => {
          this.#updateState({
            ...this.#state,
            connectionState: "error",
            error: "SharedWorker konnte nicht gestartet werden.",
          });
        };
        worker.port.start();
        this.#postCommand({ type: "register-tab", tabId: this.#tabId });
        return;
      } catch (_error) {
        // Fallback auf Single-Tab-WebSocket, falls SharedWorker blockiert ist
        this.#workerPort = null;
      }
    }

    const router = new McpRemoteRouter({
      resolveWsUrl: (sidecarBaseUrl) => resolveRemoteWsUrl(sidecarBaseUrl),
      socketFactory: options.socketFactory ?? createBrowserSocketFactory(),
    });
    this.#fallbackRouter = router;
    router.registerTab(this.#tabId, {
      postMessage: (event) => {
        this.#handleWorkerEvent(event);
      },
    });
  }

  get tabId(): string {
    return this.#tabId;
  }

  get isSharedWorkerSupported(): boolean {
    return this.#isSharedWorkerSupported && this.#workerPort !== null;
  }

  get state(): McpRemoteSharedState {
    return this.#state;
  }

  onStateChange(listener: (state: McpRemoteSharedState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  onRequest(listener: (request: McpBridgeRequest) => void): () => void {
    this.#requestListeners.add(listener);
    return () => {
      this.#requestListeners.delete(listener);
    };
  }

  connect(accessKey?: string, sidecarBaseUrl?: string): void {
    this.#postCommand({ type: "connect", tabId: this.#tabId, accessKey, sidecarBaseUrl });
  }

  disconnect(): void {
    this.#postCommand({ type: "disconnect" });
  }

  claimActiveTab(): void {
    this.#postCommand({ type: "claim-active-tab", tabId: this.#tabId });
  }

  sendResponse(response: McpBridgeResponse): void {
    this.#postCommand({ type: "tool-response", response });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#postCommand({ type: "unregister-tab", tabId: this.#tabId });
    if (this.#workerPort) {
      this.#workerPort.close();
      this.#workerPort = null;
    }
    this.#fallbackRouter = null;
    this.#stateListeners.clear();
    this.#requestListeners.clear();
  }

  #postCommand(command: McpWorkerCommand): void {
    if (this.#workerPort) {
      this.#workerPort.postMessage(command);
    } else if (this.#fallbackRouter) {
      this.#fallbackRouter.handleCommand(command);
    }
  }

  #handleWorkerEvent(event: McpWorkerEvent): void {
    if (!event || typeof event.type !== "string") {
      return;
    }
    if (event.type === "state") {
      this.#updateState(event.state);
    } else if (event.type === "execute-request") {
      for (const listener of this.#requestListeners) {
        listener(event.request);
      }
    }
  }

  #updateState(next: McpRemoteSharedState): void {
    this.#state = next;
    for (const listener of this.#stateListeners) {
      listener(next);
    }
  }
}

export default McpRemoteClient;
