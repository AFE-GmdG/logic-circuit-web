import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import {
  COLLAB_HTTP_BASE_PATH,
  COLLAB_WS_PATH,
} from "../src/collab/collabEvents.ts";

import readCollabConfigFromEnv, { toPublicCollabRuntimeConfig } from "./collabConfig.ts";
import CollabSignalingRelay from "./collabSignalingRelay.ts";
import attachCollabWebSocket from "./collabWsHandler.ts";
import WebSocketConnection from "./webSocketConnection.ts";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function isSameHostOrigin(req: IncomingMessage, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.trim().length === 0) {
    return false;
  }
  const normalizedOrigin = origin.trim().replace(/\/+$/, "");
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(normalizedOrigin);
  }
  try {
    const originHost = new URL(normalizedOrigin).host.toLowerCase();
    const hostHeader = (req.headers.host ?? "").trim().toLowerCase();
    return hostHeader.length > 0 && originHost === hostHeader;
  } catch (_error) {
    return false;
  }
}

// Vite-Plugin: stellt im lokalen Dev-Server /__collab/config und das WebSocket-Signaling unter /ws-collab bereit
const vitePluginCollab = (): Plugin => ({
  name: "logic-circuit-collab",
  apply: "serve",
  configureServer(server) {
    const config = readCollabConfigFromEnv();
    const relay = new CollabSignalingRelay({
      accessKey: config.accessKey,
      inviteTtlMs: config.inviteTtlMs,
      maxSessions: config.maxSessions,
      maxPeersPerSession: config.maxPeersPerSession,
    });
    const activeConnections = new Set<WebSocketConnection>();

    server.middlewares.use(COLLAB_HTTP_BASE_PATH, (req, res, next) => {
      const route = (req.url ?? "/").split("?")[0];
      if (route === "/config" && req.method === "GET") {
        sendJson(res, 200, toPublicCollabRuntimeConfig(config));
        return;
      }
      next();
    });

    server.httpServer?.on("upgrade", (req, socket, head) => {
      const pathname = (req.url ?? "/").split("?")[0];
      if (pathname !== COLLAB_WS_PATH) {
        return;
      }

      if (!isSameHostOrigin(req, config.allowedOrigins)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      const conn = WebSocketConnection.upgrade(req, socket, head, {
        maxMessageBytes: config.maxMessageBytes,
      });
      if (!conn) {
        return;
      }
      attachCollabWebSocket(conn, relay, activeConnections);
    });

    server.httpServer?.on("close", () => {
      for (const conn of activeConnections) {
        conn.close(1001, "Dev server shutdown");
      }
      activeConnections.clear();
    });
  },
});

export default vitePluginCollab;
