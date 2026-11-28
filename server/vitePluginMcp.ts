import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import { MCP_HTTP_BASE_PATH, MCP_STREAMABLE_HTTP_PATH } from "../src/mcp/mcpEvents.ts";

import McpBridge from "./mcpBridge.ts";
import McpHttpHandler from "./mcpHttpHandler.ts";
import readPrivacyConfigFromEnv from "./privacyConfig.ts";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Vite-Plugin: hängt die MCP-Bridge an den HMR-WebSocket und stellt /mcp sowie Status-/Datenschutzendpunkte bereit
const vitePluginMcp = (): Plugin => ({
  name: "logic-circuit-mcp",
  apply: "serve",
  configureServer(server) {
    const bridge = new McpBridge(600000); // For Debug: 10 Minuten Timeout
    bridge.attach({
      on: (event, listener) => {
        server.ws.on(event, listener);
      },
    });

    const mcpHttpHandler = new McpHttpHandler({
      requiresRemoteSession: false,
      enforceLocalhostOnly: true,
      serverLabel: "Logic Circuit Web (Dev)",
      invokeTool: (method, params) => bridge.call(method, params),
    });

    server.middlewares.use(MCP_STREAMABLE_HTTP_PATH, (req, res, next) => {
      const route = (req.url ?? "/").split("?")[0];
      if (route !== "/" && route !== "") {
        next();
        return;
      }
      mcpHttpHandler.handleHttpRequest(req as IncomingMessage, res).catch((error: unknown) => {
        sendJson(res, 500, { error: (error as Error).message });
      });
    });

    server.middlewares.use(MCP_HTTP_BASE_PATH, (req, res, next) => {
      const route = (req.url ?? "/").split("?")[0];

      if (route === "/status" && req.method === "GET") {
        sendJson(res, 200, {
          connected: bridge.isConnected,
          clients: bridge.clientCount,
        });
        return;
      }

      if (route === "/privacy" && req.method === "GET") {
        sendJson(res, 200, readPrivacyConfigFromEnv());
        return;
      }

      next();
    });
  },
});

export default vitePluginMcp;
