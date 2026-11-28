import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

import type McpBridgeResponse from "../src/types/mcp/mcpBridgeResponse.ts";
import type PrivacyConfig from "../src/types/privacyConfig.ts";

import {
  COLLAB_CONFIG_PATH,
  COLLAB_WS_PATH,
} from "../src/collab/collabEvents.ts";
import {
  MCP_EVENT_BYE,
  MCP_EVENT_ERROR,
  MCP_EVENT_HELLO,
  MCP_EVENT_PING,
  MCP_EVENT_PONG,
  MCP_EVENT_RESPONSE,
  MCP_HTTP_BASE_PATH,
  MCP_PRIVACY_PATH,
  MCP_STREAMABLE_HTTP_PATH,
  MCP_WS_PATH,
} from "../src/mcp/mcpEvents.ts";

import readCollabConfigFromEnv, {
  type CollabServerConfig,
  sanitizeStunUrls,
  toPublicCollabRuntimeConfig,
} from "./collabConfig.ts";
import CollabSignalingRelay from "./collabSignalingRelay.ts";
import attachCollabWebSocket from "./collabWsHandler.ts";
import McpHttpHandler from "./mcpHttpHandler.ts";
import McpRelay, {
  type RelayClient,
  SessionLimitReachedError,
  UnauthorizedRelayError,
} from "./mcpRelay.ts";
import readPrivacyConfigFromEnv from "./privacyConfig.ts";
import RateLimiter, { extractClientKey } from "./rateLimiter.ts";
import WebSocketConnection from "./webSocketConnection.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")) as { version: string }
).version;

const HELLO_TIMEOUT_MS = 10000;
const DEFAULT_RATE_WINDOW_MS = 60000;
const DEFAULT_RATE_LIMIT_HTTP_PER_MIN = 60;
const DEFAULT_RATE_LIMIT_STATUS_PER_MIN = 30;
const DEFAULT_RATE_LIMIT_AUTH_FAIL_PER_MIN = 5;
const DEFAULT_RATE_LIMIT_WS_PER_MIN = 10;

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

export type StandaloneRateLimitOptions = {
  windowMs?: number;
  httpPerMin?: number;
  statusPerMin?: number;
  authFailPerMin?: number;
  wsPerMin?: number;
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
  maxSessions?: number;
  maxHttpSessions?: number;
  httpSessionTtlMs?: number;
  maxConcurrentCallsPerSession?: number;
  trustProxy?: boolean;
  rateLimits?: StandaloneRateLimitOptions;
  staticDir?: string;
  privacy?: Partial<PrivacyConfig>;
  collab?: Partial<CollabServerConfig>;
};

export type StandaloneServerHandle = {
  server: http.Server;
  relay: McpRelay;
  collabRelay: CollabSignalingRelay;
  port: number;
  close: () => Promise<void>;
};

type WsEnvelope = {
  event?: unknown;
  payload?: unknown;
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function sendRateLimited(res: http.ServerResponse, retryAfterSeconds: number): void {
  res.setHeader("Retry-After", String(Math.max(1, retryAfterSeconds)));
  sendJson(res, 429, { error: "Zu viele Anfragen. Bitte kurz warten." });
}

function applyCorsHeaders(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  allowedOrigins: string[],
): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.trim().length === 0) {
    return true;
  }

  if (!isOriginAllowed(req, allowedOrigins, false)) {
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", origin.trim().replace(/\/+$/, ""));
  res.setHeader(
    "Vary",
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Retry-After");
  if (req.headers["access-control-request-private-network"] === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  return true;
}

function handleCorsPreflight(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  allowedOrigins: string[],
): void {
  if (!applyCorsHeaders(req, res, allowedOrigins)) {
    sendJson(res, 403, { error: "Origin für CORS-Preflight nicht erlaubt." });
    return;
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, X-Logic-Circuit-Session, X-MCP-Session",
  );
  res.setHeader("Access-Control-Max-Age", "600");
  res.statusCode = 204;
  res.setHeader("Cache-Control", "no-store");
  res.end();
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

function rejectUpgrade(socket: Duplex, status: number, message: string, extraHeaders: string[] = []): void {
  const lines = [`HTTP/1.1 ${status} ${message}`, "Connection: close", ...extraHeaders, "", ""];
  socket.write(lines.join("\r\n"));
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

  const envCollab = readCollabConfigFromEnv();
  const collabConfig: CollabServerConfig = {
    stunUrls: options.collab?.stunUrls ? sanitizeStunUrls(options.collab.stunUrls) : envCollab.stunUrls,
    accessKey: options.collab?.accessKey !== undefined ? options.collab.accessKey.trim() : envCollab.accessKey,
    allowedOrigins: options.collab?.allowedOrigins !== undefined
      ? options.collab.allowedOrigins.map((item) => item.trim().replace(/\/+$/, "")).filter(Boolean)
      : envCollab.allowedOrigins,
    inviteTtlMs: options.collab?.inviteTtlMs ?? envCollab.inviteTtlMs,
    gracePeriodMs: options.collab?.gracePeriodMs ?? envCollab.gracePeriodMs,
    maxSessions: options.collab?.maxSessions ?? envCollab.maxSessions,
    maxPeersPerSession: options.collab?.maxPeersPerSession ?? envCollab.maxPeersPerSession,
    maxMessageBytes: options.collab?.maxMessageBytes ?? envCollab.maxMessageBytes,
  };
  const collabAllowedOrigins = collabConfig.allowedOrigins.length > 0 ? collabConfig.allowedOrigins : allowedOrigins;

  const trustProxy = options.trustProxy ?? true;
  const rateWindowMs = options.rateLimits?.windowMs ?? DEFAULT_RATE_WINDOW_MS;
  const httpMcpLimiter = new RateLimiter({
    windowMs: rateWindowMs,
    maxRequests: options.rateLimits?.httpPerMin ?? DEFAULT_RATE_LIMIT_HTTP_PER_MIN,
  });
  const statusLimiter = new RateLimiter({
    windowMs: rateWindowMs,
    maxRequests: options.rateLimits?.statusPerMin ?? DEFAULT_RATE_LIMIT_STATUS_PER_MIN,
  });
  const authFailLimiter = new RateLimiter({
    windowMs: rateWindowMs,
    maxRequests: options.rateLimits?.authFailPerMin ?? DEFAULT_RATE_LIMIT_AUTH_FAIL_PER_MIN,
  });
  const wsUpgradeLimiter = new RateLimiter({
    windowMs: rateWindowMs,
    maxRequests: options.rateLimits?.wsPerMin ?? DEFAULT_RATE_LIMIT_WS_PER_MIN,
  });

  const relay = new McpRelay({
    timeoutMs: options.requestTimeoutMs ?? 60000,
    accessKey: options.accessKey,
    gracePeriodMs: options.gracePeriodMs ?? 120000,
    maxSessions: options.maxSessions,
    maxConcurrentCallsPerSession: options.maxConcurrentCallsPerSession,
  });

  const collabRelay = new CollabSignalingRelay({
    accessKey: collabConfig.accessKey,
    inviteTtlMs: collabConfig.inviteTtlMs,
    maxSessions: collabConfig.maxSessions,
    maxPeersPerSession: collabConfig.maxPeersPerSession,
  });

  const activeConnections = new Set<WebSocketConnection>();
  const mcpHttpHandler = new McpHttpHandler({
    requiresRemoteSession: true,
    maxHttpSessions: options.maxHttpSessions,
    httpSessionTtlMs: options.httpSessionTtlMs,
    serverLabel: "Logic Circuit Web (Remote)",
    authorizeRequest: (req) => {
      if (!relay.requiresAccessKey) {
        return true;
      }
      const ok = relay.verifyAccessKey(extractBearerToken(req));
      if (!ok) {
        authFailLimiter.consume(extractClientKey(req, trustProxy));
      }
      return ok;
    },
    isOriginAllowed: (req) => isOriginAllowed(req, allowedOrigins, true),
    invokeTool: (method, params, browserSessionId) => relay.call(browserSessionId, method, params),
  });

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    const method = (req.method ?? "GET").toUpperCase();
    const clientKey = extractClientKey(req, trustProxy);

    if (method === "OPTIONS") {
      if (pathname === COLLAB_CONFIG_PATH) {
        handleCorsPreflight(req, res, collabAllowedOrigins);
        return;
      }
      if (pathname === MCP_STREAMABLE_HTTP_PATH || pathname === MCP_PRIVACY_PATH || pathname === `${MCP_HTTP_BASE_PATH}/status`) {
        handleCorsPreflight(req, res, allowedOrigins);
        return;
      }
      if (pathname === "/healthz") {
        handleCorsPreflight(req, res, allowedOrigins.length > 0 ? allowedOrigins : collabAllowedOrigins);
        return;
      }
    }

    if (pathname === "/healthz" && method === "GET") {
      applyCorsHeaders(req, res, allowedOrigins.length > 0 ? allowedOrigins : collabAllowedOrigins);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === MCP_PRIVACY_PATH && method === "GET") {
      if (!applyCorsHeaders(req, res, allowedOrigins)) {
        sendJson(res, 403, { error: "Origin nicht erlaubt." });
        return;
      }
      const limit = statusLimiter.consume(clientKey);
      if (!limit.allowed) {
        sendRateLimited(res, limit.retryAfterSeconds);
        return;
      }
      sendJson(res, 200, privacyConfig);
      return;
    }

    if (pathname === COLLAB_CONFIG_PATH && method === "GET") {
      if (!applyCorsHeaders(req, res, collabAllowedOrigins)) {
        sendJson(res, 403, { error: "Origin nicht erlaubt." });
        return;
      }
      const limit = statusLimiter.consume(clientKey);
      if (!limit.allowed) {
        sendRateLimited(res, limit.retryAfterSeconds);
        return;
      }
      sendJson(res, 200, toPublicCollabRuntimeConfig(collabConfig, PACKAGE_VERSION));
      return;
    }

    if (pathname === `${MCP_HTTP_BASE_PATH}/status` && method === "GET") {
      if (!applyCorsHeaders(req, res, allowedOrigins)) {
        sendJson(res, 403, { error: "Origin nicht erlaubt." });
        return;
      }
      const limit = statusLimiter.consume(clientKey);
      if (!limit.allowed) {
        sendRateLimited(res, limit.retryAfterSeconds);
        return;
      }
      sendJson(res, 200, {
        ...relay.getStatus(),
        serverVersion: PACKAGE_VERSION,
      });
      return;
    }

    if (pathname === MCP_STREAMABLE_HTTP_PATH) {
      if (!applyCorsHeaders(req, res, allowedOrigins)) {
        sendJson(res, 403, { error: "Origin für /mcp nicht erlaubt." });
        return;
      }
      const authBlock = authFailLimiter.peek(clientKey);
      if (!authBlock.allowed) {
        sendRateLimited(res, authBlock.retryAfterSeconds);
        return;
      }
      const httpLimit = httpMcpLimiter.consume(clientKey);
      if (!httpLimit.allowed) {
        sendRateLimited(res, httpLimit.retryAfterSeconds);
        return;
      }
      mcpHttpHandler.handleHttpRequest(req, res).catch((error: unknown) => {
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
    const clientKey = extractClientKey(req, trustProxy);

    if (pathname === COLLAB_WS_PATH) {
      if (!isOriginAllowed(req, collabAllowedOrigins, allowMissingOrigin)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }

      const wsLimit = wsUpgradeLimiter.consume(clientKey);
      if (!wsLimit.allowed) {
        rejectUpgrade(socket, 429, "Too Many Requests", [`Retry-After: ${wsLimit.retryAfterSeconds}`]);
        return;
      }

      const conn = WebSocketConnection.upgrade(req, socket, head, {
        maxMessageBytes: collabConfig.maxMessageBytes,
      });
      if (!conn) {
        return;
      }
      attachCollabWebSocket(conn, collabRelay, activeConnections);
      return;
    }

    if (pathname !== MCP_WS_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    if (!isOriginAllowed(req, allowedOrigins, allowMissingOrigin)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const wsLimit = wsUpgradeLimiter.consume(clientKey);
    if (!wsLimit.allowed) {
      rejectUpgrade(socket, 429, "Too Many Requests", [`Retry-After: ${wsLimit.retryAfterSeconds}`]);
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
          if (!authFailLimiter.peek(clientKey).allowed) {
            client.send(MCP_EVENT_ERROR, { error: "Zu viele fehlgeschlagene Anmeldeversuche. Bitte kurz warten." });
            conn.close(4008, "Rate limited");
            break;
          }
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
            if (error instanceof UnauthorizedRelayError) {
              authFailLimiter.consume(clientKey);
              client.send(MCP_EVENT_ERROR, { error: error.message });
              conn.close(4001, "Unauthorized");
            } else if (error instanceof SessionLimitReachedError) {
              client.send(MCP_EVENT_ERROR, { error: error.message });
              conn.close(4008, "Session limit reached");
            } else {
              client.send(MCP_EVENT_ERROR, { error: "Sitzungsregistrierung fehlgeschlagen." });
              conn.close(4001, "Unauthorized");
            }
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
    collabRelay,
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

function parseOptionalIntEnv(raw: string | undefined, fallback: number, min = 0): number {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.floor(parsed));
}

function parseTrustProxyEnv(raw: string | undefined): boolean {
  if (!raw) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false";
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
    maxSessions: parseOptionalIntEnv(process.env.MCP_MAX_SESSIONS, 20, 1),
    maxHttpSessions: parseOptionalIntEnv(process.env.MCP_MAX_HTTP_SESSIONS, 50, 1),
    httpSessionTtlMs: parseOptionalIntEnv(process.env.MCP_HTTP_SESSION_TTL_MS, 1800000, 1000),
    maxConcurrentCallsPerSession: parseOptionalIntEnv(process.env.MCP_MAX_CONCURRENT_CALLS_PER_SESSION, 4, 1),
    trustProxy: parseTrustProxyEnv(process.env.MCP_TRUST_PROXY),
    rateLimits: {
      httpPerMin: parseOptionalIntEnv(process.env.RATE_LIMIT_HTTP_PER_MIN, DEFAULT_RATE_LIMIT_HTTP_PER_MIN, 0),
      statusPerMin: parseOptionalIntEnv(process.env.RATE_LIMIT_STATUS_PER_MIN, DEFAULT_RATE_LIMIT_STATUS_PER_MIN, 0),
      authFailPerMin: parseOptionalIntEnv(process.env.RATE_LIMIT_AUTH_FAIL_PER_MIN, DEFAULT_RATE_LIMIT_AUTH_FAIL_PER_MIN, 0),
      wsPerMin: parseOptionalIntEnv(process.env.RATE_LIMIT_WS_PER_MIN, DEFAULT_RATE_LIMIT_WS_PER_MIN, 0),
    },
    staticDir: process.env.MCP_STATIC_DIR,
    collab: readCollabConfigFromEnv(),
  })
    .then((handle) => {
      console.log(
        `[logic-circuit-relay] Aktiv auf http://${host}:${handle.port} (MCP HTTP: ${MCP_STREAMABLE_HTTP_PATH}, MCP WS: ${MCP_WS_PATH}, Collab WS: ${COLLAB_WS_PATH})`,
      );
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
