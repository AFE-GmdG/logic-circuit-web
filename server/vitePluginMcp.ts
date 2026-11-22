import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import { MCP_HTTP_BASE_PATH } from "../src/mcp/mcpEvents.ts";

import McpBridge, { NoBrowserSessionError } from "./mcpBridge.ts";
import readPrivacyConfigFromEnv from "./privacyConfig.ts";

const MAX_BODY_BYTES = 1024 * 1024;

// Liest den JSON-Body einer Anfrage mit Größenbegrenzung
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request-Body zu groß."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(text.length > 0 ? JSON.parse(text) : {});
      } catch (_error) {
        reject(new Error("Request-Body ist kein gültiges JSON."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Bearbeitet POST /__mcp/call: { method, params } -> { result } | { error }
async function handleCall(bridge: McpBridge, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Nur JSON-Requests zulassen: erzwingt einen CORS-Preflight und verhindert Aufrufe fremder Webseiten
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    sendJson(res, 415, { error: "Content-Type muss application/json sein." });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: (error as Error).message });
    return;
  }

  const { method, params } = (body ?? {}) as { method?: unknown; params?: unknown };
  if (typeof method !== "string" || method.length === 0) {
    sendJson(res, 400, { error: "Feld \"method\" (String) fehlt." });
    return;
  }

  try {
    const result = await bridge.call(method, params);
    sendJson(res, 200, { result });
  } catch (error) {
    const status = error instanceof NoBrowserSessionError ? 503 : 422;
    sendJson(res, status, { error: (error as Error).message });
  }
}

// Vite-Plugin: hängt die MCP-Bridge an den HMR-WebSocket und stellt HTTP-Endpunkte für die Stdio-CLI bereit
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

      if (route === "/call" && req.method === "POST") {
        handleCall(bridge, req, res).catch((error: unknown) => {
          sendJson(res, 500, { error: (error as Error).message });
        });
        return;
      }

      next();
    });
  },
});

export default vitePluginMcp;
