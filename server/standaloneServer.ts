import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

import type McpBridgeResponse from "../src/types/mcp/mcpBridgeResponse.ts";
import type PrivacyConfig from "../src/types/privacyConfig.ts";

import {
  MCP_EVENT_BYE,
  MCP_EVENT_ERROR,
  MCP_EVENT_HELLO,
  MCP_EVENT_PING,
  MCP_EVENT_PONG,
  MCP_EVENT_RESPONSE,
  MCP_HTTP_BASE_PATH,
  MCP_PRIVACY_PATH,
  MCP_WS_PATH,
} from "../src/mcp/mcpEvents.ts";

import McpRelay, {
  MissingSessionIdError,
  type RelayClient,
  UnauthorizedRelayError,
  UnknownSessionError,
} from "./mcpRelay.ts";
import readPrivacyConfigFromEnv from "./privacyConfig.ts";
import WebSocketConnection from "./webSocketConnection.ts";

const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;
const HELLO_TIMEOUT_MS = 10000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export type StandaloneServerOptions = {
  host?: string;
  port?: number;
  accessKey?: string;
  allowedOrigins?: string[];
  allowMissingOrigin?: boolean;
  requestTimeoutMs?: number;
  gracePeriodMs?: number;
  heartbeatIntervalMs?: number;
  staticDir?: string;
  privacy?: Partial<PrivacyConfig>;
};

export type StandaloneServerHandle = {
  server: http.Server;
  relay: McpRelay;
  port: number;
  close: () => Promise<void>;
};

type WsEnvelope = {
  event?: unknown;
  payload?: unknown;
};

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_HTTP_BODY_BYTES) {
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

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function extractBearerToken(req: http.IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") {
    return undefined;
  }
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

function isOriginAllowed(
  req: http.IncomingMessage,
  allowedOrigins: string[],
  allowMissingOrigin: boolean,
): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.trim().length === 0) {
    return allowMissingOrigin;
  }

  const normalizedOrigin = origin.trim().replace(/\/+$/, "");
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(normalizedOrigin);
  }

  // Standardmäßig Same-Host-Prüfung anhand X-Forwarded-Host oder Host
  try {
    const originHost = new URL(normalizedOrigin).host.toLowerCase();
    const forwardedHost = req.headers["x-forwarded-host"];
    const hostHeader = typeof forwardedHost === "string"
      ? forwardedHost.split(",")[0].trim().toLowerCase()
      : (req.headers.host ?? "").trim().toLowerCase();
    return hostHeader.length > 0 && originHost === hostHeader;
  } catch (_error) {
    return false;
  }
}

function serveStaticFile(staticDir: string, pathname: string, res: http.ServerResponse): void {
  const rootDir = path.resolve(staticDir);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, relativePath);

  if (resolved !== rootDir && !resolved.startsWith(`${rootDir}${path.sep}`)) {
    sendJson(res, 403, { error: "Zugriff verweigert." });
    return;
  }

  let targetPath = resolved;
  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    targetPath = path.join(rootDir, "index.html");
  }

  if (!fs.existsSync(targetPath)) {
    sendJson(res, 404, { error: "Datei nicht gefunden." });
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
  fs.createReadStream(targetPath).pipe(res);
}

async function handleMcpCall(relay: McpRelay, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (relay.requiresAccessKey) {
    const token = extractBearerToken(req);
    if (!relay.verifyAccessKey(token)) {
      sendJson(res, 401, { error: "Ungültiger oder fehlender Bearer-Token (MCP_ACCESS_KEY)." });
      return;
    }
  }

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

  const parsed = (body ?? {}) as {
    sessionId?: unknown;
    method?: unknown;
    params?: unknown;
  };
  if (typeof parsed.method !== "string" || parsed.method.length === 0) {
    sendJson(res, 400, { error: "Feld \"method\" (String) fehlt." });
    return;
  }

  const headerSession = req.headers["x-mcp-session"];
  const sessionId = typeof parsed.sessionId === "string"
    ? parsed.sessionId
    : typeof headerSession === "string"
      ? headerSession
      : undefined;

  try {
    const result = await relay.call(sessionId, parsed.method, parsed.params);
    sendJson(res, 200, { result });
  } catch (error) {
    let status = 422;
    if (error instanceof MissingSessionIdError) {
      status = 400;
    } else if (error instanceof UnknownSessionError) {
      status = 503;
    }
    sendJson(res, status, { error: (error as Error).message });
  }
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

// Startet den zustandslosen Remote-MCP-HTTP- und WebSocket-Server
export async function createStandaloneServer(options: StandaloneServerOptions = {}): Promise<StandaloneServerHandle> {
  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 3001;
  const allowedOrigins = (options.allowedOrigins ?? []).map((item) => item.trim().replace(/\/+$/, "")).filter(Boolean);
  const allowMissingOrigin = options.allowMissingOrigin ?? false;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25000;
  const staticDir = options.staticDir?.trim() || "";
  const envPrivacy = readPrivacyConfigFromEnv();
  const privacyConfig: PrivacyConfig = {
    responsibleName: options.privacy?.responsibleName?.trim() || envPrivacy.responsibleName,
    responsibleAddress: options.privacy?.responsibleAddress?.trim() || envPrivacy.responsibleAddress,
    contactEmail: options.privacy?.contactEmail?.trim() || envPrivacy.contactEmail,
    hostingLocation: options.privacy?.hostingLocation?.trim() || envPrivacy.hostingLocation,
  };

  const relay = new McpRelay({
    timeoutMs: options.requestTimeoutMs ?? 60000,
    accessKey: options.accessKey,
    gracePeriodMs: options.gracePeriodMs ?? 120000,
  });

  const activeConnections = new Set<WebSocketConnection>();

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];

    if (pathname === "/healthz" && req.method === "GET") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === MCP_PRIVACY_PATH && req.method === "GET") {
      sendJson(res, 200, privacyConfig);
      return;
    }

    if (pathname === `${MCP_HTTP_BASE_PATH}/status` && req.method === "GET") {
      sendJson(res, 200, relay.getStatus());
      return;
    }

    if (pathname === `${MCP_HTTP_BASE_PATH}/call` && req.method === "POST") {
      handleMcpCall(relay, req, res).catch((error: unknown) => {
        sendJson(res, 500, { error: (error as Error).message });
      });
      return;
    }

    if (staticDir.length > 0 && (req.method === "GET" || req.method === "HEAD")) {
      serveStaticFile(staticDir, pathname, res);
      return;
    }

    sendJson(res, 404, { error: "Endpunkt nicht gefunden." });
  });

  server.on("upgrade", (req, socket, head) => {
    const pathname = (req.url ?? "/").split("?")[0];
    if (pathname !== MCP_WS_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    if (!isOriginAllowed(req, allowedOrigins, allowMissingOrigin)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const conn = WebSocketConnection.upgrade(req, socket, head);
    if (!conn) {
      return;
    }
    activeConnections.add(conn);

    const client: RelayClient = {
      send(event: string, payload?: unknown) {
        conn.sendText(JSON.stringify({ event, payload }));
      },
      close(code?: number, reason?: string) {
        conn.close(code, reason);
      },
    };

    let registered = false;
    const helloTimer = setTimeout(() => {
      if (!registered) {
        client.send(MCP_EVENT_ERROR, { error: "Anmeldung (HELLO) Zeitüberschreitung." });
        conn.close(4000, "Hello timeout");
      }
    }, HELLO_TIMEOUT_MS);

    conn.onMessage((raw) => {
      let envelope: WsEnvelope;
      try {
        envelope = JSON.parse(raw) as WsEnvelope;
      } catch (_error) {
        client.send(MCP_EVENT_ERROR, { error: "Ungültiges JSON über WebSocket." });
        return;
      }

      if (typeof envelope.event !== "string") {
        return;
      }

      switch (envelope.event) {
        case MCP_EVENT_HELLO: {
          const payload = (envelope.payload ?? {}) as {
            sessionId?: unknown;
            reconnectToken?: unknown;
            accessKey?: unknown;
          };
          try {
            relay.registerSession(client, {
              sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
              reconnectToken: typeof payload.reconnectToken === "string" ? payload.reconnectToken : undefined,
              accessKey: typeof payload.accessKey === "string" ? payload.accessKey : undefined,
            });
            registered = true;
            clearTimeout(helloTimer);
          } catch (error) {
            const message = error instanceof UnauthorizedRelayError
              ? error.message
              : "Sitzungsregistrierung fehlgeschlagen.";
            client.send(MCP_EVENT_ERROR, { error: message });
            conn.close(4001, "Unauthorized");
          }
          break;
        }
        case MCP_EVENT_BYE: {
          clearTimeout(helloTimer);
          relay.unregisterClient(client, true);
          conn.close(1000, "Client bye");
          break;
        }
        case MCP_EVENT_RESPONSE: {
          relay.touch(client);
          relay.handleResponse(client, envelope.payload as McpBridgeResponse);
          break;
        }
        case MCP_EVENT_PING: {
          relay.touch(client);
          client.send(MCP_EVENT_PONG, {});
          break;
        }
        default:
          break;
      }
    });

    conn.onPong(() => {
      relay.touch(client);
    });

    conn.onError(() => {
      // TCP-Fehler werden über onClose bereinigt
    });

    conn.onClose(() => {
      clearTimeout(helloTimer);
      activeConnections.delete(conn);
      relay.unregisterClient(client, false);
    });
  });

  const heartbeatTimer = heartbeatIntervalMs > 0
    ? setInterval(() => {
      for (const conn of activeConnections) {
        conn.ping();
      }
    }, heartbeatIntervalMs)
    : null;
  heartbeatTimer?.unref();

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    server,
    relay,
    port: actualPort,
    close: async () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      for (const conn of activeConnections) {
        conn.close(1001, "Server shutdown");
      }
      activeConnections.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function parseAllowedOriginsEnv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

const isDirectEntry = typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectEntry) {
  const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";
  createStandaloneServer({
    host,
    port,
    accessKey: process.env.MCP_ACCESS_KEY,
    allowedOrigins: parseAllowedOriginsEnv(process.env.MCP_ALLOWED_ORIGINS),
    requestTimeoutMs: Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? 600000),
    gracePeriodMs: Number(process.env.MCP_SESSION_GRACE_MS ?? 120000),
    heartbeatIntervalMs: Number(process.env.MCP_HEARTBEAT_INTERVAL_MS ?? 25000),
    staticDir: process.env.MCP_STATIC_DIR,
  })
    .then((handle) => {
      console.log(`[logic-circuit-mcp-relay] Aktiv auf http://${host}:${handle.port} (WS: ${MCP_WS_PATH})`);
      const shutdown = () => {
        void handle.close().then(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((error: unknown) => {
      console.error("[logic-circuit-mcp-relay] Start fehlgeschlagen:", error);
      process.exit(1);
    });
}
