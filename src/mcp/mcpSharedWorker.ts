import type McpWorkerCommand from "../types/mcp/mcpWorkerCommand";

import { toWebSocketUrl } from "../utils/sidecarStorage";

import { MCP_WS_PATH } from "./mcpEvents";
import McpRemoteRouter, { type McpTabPort } from "./mcpRemoteRouter";

type SharedWorkerGlobalScopeLike = {
  location: Location;
  onconnect: ((event: MessageEvent) => void) | null;
};

function resolveWorkerWsUrl(loc: Location, sidecarBaseUrl?: string): string {
  const trimmed = sidecarBaseUrl?.trim();
  if (trimmed && trimmed.length > 0) {
    return toWebSocketUrl(trimmed, MCP_WS_PATH);
  }
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}${MCP_WS_PATH}`;
}

const workerScope = globalThis as unknown as SharedWorkerGlobalScopeLike;

const router = new McpRemoteRouter({
  resolveWsUrl: (sidecarBaseUrl) => resolveWorkerWsUrl(workerScope.location, sidecarBaseUrl),
  socketFactory: ({ wsUrl, onOpen, onMessage, onClose }) => {
    const ws = new WebSocket(wsUrl ?? resolveWorkerWsUrl(workerScope.location));
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
  },
});

// Verbindet jeden Browser-Tab über einen eigenen MessagePort mit dem zentralen Router
workerScope.onconnect = (connectEvent: MessageEvent): void => {
  const port = connectEvent.ports[0];
  if (!port) {
    return;
  }

  let registeredTabId: string | null = null;
  const tabPort: McpTabPort = {
    postMessage: (event) => port.postMessage(event),
  };

  port.onmessage = (messageEvent: MessageEvent<McpWorkerCommand>): void => {
    const command = messageEvent.data;
    if (!command || typeof command.type !== "string") {
      return;
    }

    if (command.type === "register-tab") {
      registeredTabId = command.tabId;
      router.registerTab(command.tabId, tabPort);
      return;
    }

    if (command.type === "unregister-tab") {
      if (registeredTabId === command.tabId) {
        registeredTabId = null;
      }
      router.unregisterTab(command.tabId);
      port.close();
      return;
    }

    router.handleCommand(command, tabPort);
  };

  port.onmessageerror = (): void => {
    if (registeredTabId) {
      router.unregisterTab(registeredTabId);
      registeredTabId = null;
    }
  };

  port.start();
};
