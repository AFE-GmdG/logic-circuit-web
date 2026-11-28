import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type McpToolDefinition from "../src/types/mcp/mcpToolDefinition.ts";

export type McpToolInvoker = (method: string, params: unknown, browserSessionId?: string) => Promise<unknown>;

export type McpHttpHandlerOptions = {
  invokeTool: McpToolInvoker;
  requiresRemoteSession: boolean;
  maxBodyBytes?: number;
  httpSessionTtlMs?: number;
  maxHttpSessions?: number;
  serverLabel?: string;
  enforceLocalhostOnly?: boolean;
  isOriginAllowed?: (req: http.IncomingMessage) => boolean;
  authorizeRequest?: (req: http.IncomingMessage) => boolean;
};

type HttpMcpSession = {
  id: string;
  browserSessionId: string | null;
  createdAt: number;
  lastSeenAt: number;
};

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

class PayloadTooLargeError extends Error {
  constructor() {
    super("Request-Body zu groß.");
    this.name = "PayloadTooLargeError";
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DEFINITIONS = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../src/mcp/toolDefinitions.json"), "utf-8"),
) as McpToolDefinition[];
const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")) as { version: string }
).version;

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_HTTP_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_HTTP_SESSIONS = 50;
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const REMOTE_SESSION_TOOL = {
  name: "set_remote_session",
  description:
    "Setzt die flüchtige Remote-SessionID aus dem Logic-Circuit-Verbindungsdialog für alle weiteren Werkzeugaufrufe in dieser MCP-Session.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "SessionID aus dem Chat-Prompt des Nutzers (z. B. xxyy-aabb-1234-qwer).",
      },
    },
    required: ["sessionId"],
    additionalProperties: false,
  },
};

function readSingleHeader(req: http.IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
    const trimmed = raw[0].trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function sendJsonRpcResult(res: http.ServerResponse, status: number, id: unknown, result: unknown): void {
  sendJson(res, status, {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  });
}

function sendJsonRpcError(res: http.ServerResponse, status: number, id: unknown, code: number, message: string): void {
  sendJson(res, status, {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

function extractHostHostname(hostHeader: string | undefined): string | null {
  if (!hostHeader || hostHeader.trim().length === 0) {
    return null;
  }
  const trimmed = hostHeader.trim();
  if (trimmed === "::1" || trimmed === "[::1]") {
    return trimmed;
  }
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string | null): boolean {
  return hostname !== null && LOCALHOST_HOSTNAMES.has(hostname.toLowerCase());
}

function isAcceptHeaderCompatible(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) {
    return true;
  }
  const mediaTypes = acceptHeader
    .split(",")
    .map((entry) => entry.split(";")[0]?.trim().toLowerCase() ?? "")
    .filter(Boolean);
  if (mediaTypes.length === 0) {
    return true;
  }
  return mediaTypes.some(
    (type) => type === "application/json" || type === "application/*" || type === "*/*",
  );
}

function readJsonBody(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        req.pause();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(text.length > 0 ? JSON.parse(text) : undefined);
      } catch (_error) {
        reject(new Error("Parse error: Nachricht ist kein gültiges JSON."));
      }
    });

    req.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
  });
}

function extractProvidedBrowserSessionId(req: http.IncomingMessage): string | null {
  const candidates: Array<string | undefined> = [
    readSingleHeader(req, "x-logic-circuit-session"),
    readSingleHeader(req, "x-mcp-session"),
  ];

  if (req.url && req.url.includes("?")) {
    try {
      const parsed = new URL(req.url, "http://localhost");
      candidates.push(parsed.searchParams.get("session") ?? undefined);
    } catch {
      // Ungültige Query-URL ignorieren
    }
  }

  for (const candidate of candidates) {
    if (candidate && SESSION_ID_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function formatToolSuccessContent(result: unknown): { content: Array<Record<string, unknown>> } {
  if (
    result &&
    typeof result === "object" &&
    typeof (result as { data?: unknown }).data === "string" &&
    typeof (result as { mimeType?: unknown }).mimeType === "string"
  ) {
    const img = result as { data: string; mimeType: string; description?: unknown };
    const content: Array<Record<string, unknown>> = [
      { type: "image", data: img.data, mimeType: img.mimeType },
    ];
    if (typeof img.description === "string") {
      content.push({ type: "text", text: img.description });
    }
    return { content };
  }

  if (
    result &&
    typeof result === "object" &&
    (result as { screenshot?: unknown }).screenshot &&
    typeof (result as { screenshot?: unknown }).screenshot === "object"
  ) {
    const { screenshot, ...payload } = result as {
      screenshot: { data?: unknown; mimeType?: unknown; description?: unknown };
      [key: string]: unknown;
    };
    if (typeof screenshot.data === "string" && typeof screenshot.mimeType === "string") {
      const content: Array<Record<string, unknown>> = [
        { type: "text", text: JSON.stringify(payload, null, 2) },
        { type: "image", data: screenshot.data, mimeType: screenshot.mimeType },
      ];
      if (typeof screenshot.description === "string") {
        content.push({ type: "text", text: screenshot.description });
      }
      return { content };
    }
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

// Gemeinsamer Protokoll-Handler für MCP Streamable HTTP (/mcp) im lokalen Dev-Server und Remote-Sidecar
class McpHttpHandler {
  readonly #invokeTool: McpToolInvoker;
  readonly #requiresRemoteSession: boolean;
  readonly #maxBodyBytes: number;
  readonly #httpSessionTtlMs: number;
  readonly #maxHttpSessions: number;
  readonly #serverLabel: string;
  readonly #enforceLocalhostOnly: boolean;
  readonly #isOriginAllowed?: (req: http.IncomingMessage) => boolean;
  readonly #authorizeRequest?: (req: http.IncomingMessage) => boolean;
  readonly #httpSessions = new Map<string, HttpMcpSession>();

  constructor(options: McpHttpHandlerOptions) {
    this.#invokeTool = options.invokeTool;
    this.#requiresRemoteSession = options.requiresRemoteSession;
    this.#maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.#httpSessionTtlMs = options.httpSessionTtlMs ?? DEFAULT_HTTP_SESSION_TTL_MS;
    this.#maxHttpSessions = options.maxHttpSessions ?? DEFAULT_MAX_HTTP_SESSIONS;
    this.#serverLabel = options.serverLabel ?? "Logic Circuit Web";
    this.#enforceLocalhostOnly = options.enforceLocalhostOnly ?? false;
    this.#isOriginAllowed = options.isOriginAllowed;
    this.#authorizeRequest = options.authorizeRequest;
  }

  get activeHttpSessionCount(): number {
    this.#cleanupExpiredSessions();
    return this.#httpSessions.size;
  }

  async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.#checkOriginAndHost(req, res)) {
      return;
    }

    if (this.#authorizeRequest && !this.#authorizeRequest(req)) {
      sendJson(res, 401, { error: "Ungültiger oder fehlender Bearer-Token (MCP_ACCESS_KEY)." });
      return;
    }

    const method = (req.method ?? "GET").toUpperCase();
    if (method === "GET") {
      res.setHeader("Allow", "POST, DELETE");
      sendJson(res, 405, { error: "GET wird auf /mcp nicht unterstützt. Bitte POST verwenden." });
      return;
    }

    if (method === "DELETE") {
      this.#handleDelete(req, res);
      return;
    }

    if (method !== "POST") {
      res.setHeader("Allow", "POST, DELETE");
      sendJson(res, 405, { error: `HTTP-Methode ${method} wird auf /mcp nicht unterstützt.` });
      return;
    }

    await this.#handlePost(req, res);
  }

  #checkOriginAndHost(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (this.#enforceLocalhostOnly) {
      const hostHostname = extractHostHostname(readSingleHeader(req, "host"));
      if (!isLocalHostname(hostHostname)) {
        sendJson(res, 403, { error: "Zugriff abgelehnt: Nur lokale Host-Header erlaubt." });
        return false;
      }

      const origin = readSingleHeader(req, "origin");
      if (origin) {
        let originHostname: string | null = null;
        try {
          originHostname = new URL(origin).hostname.toLowerCase();
        } catch {
          originHostname = null;
        }
        if (!isLocalHostname(originHostname)) {
          sendJson(res, 403, { error: "Zugriff abgelehnt: Origin ist nicht lokal." });
          return false;
        }
      }
      return true;
    }

    if (this.#isOriginAllowed && !this.#isOriginAllowed(req)) {
      sendJson(res, 403, { error: "Origin für /mcp nicht erlaubt." });
      return false;
    }

    return true;
  }

  #handleDelete(req: http.IncomingMessage, res: http.ServerResponse): void {
    const mcpSessionId = readSingleHeader(req, "mcp-session-id");
    if (!mcpSessionId) {
      sendJson(res, 400, { error: "Header \"Mcp-Session-Id\" fehlt." });
      return;
    }

    this.#cleanupExpiredSessions();
    if (!this.#httpSessions.delete(mcpSessionId)) {
      sendJson(res, 404, { error: "Unbekannte oder abgelaufene MCP-Session." });
      return;
    }

    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
  }

  async #handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const contentType = readSingleHeader(req, "content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      sendJson(res, 415, { error: "Content-Type muss application/json sein." });
      return;
    }

    if (!isAcceptHeaderCompatible(readSingleHeader(req, "accept"))) {
      sendJson(res, 406, { error: "Accept-Header muss application/json zulassen." });
      return;
    }

    const protocolHeader = readSingleHeader(req, "mcp-protocol-version");
    if (protocolHeader && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolHeader)) {
      sendJson(res, 400, { error: `Nicht unterstützte MCP-Protocol-Version: ${protocolHeader}` });
      return;
    }

    let parsedBody: unknown;
    try {
      parsedBody = await readJsonBody(req, this.#maxBodyBytes);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        res.setHeader("Connection", "close");
        res.once("finish", () => {
          req.destroy();
        });
        sendJson(res, 413, { error: error.message });
        return;
      }
      sendJsonRpcError(res, 400, null, -32700, (error as Error).message);
      return;
    }

    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      sendJsonRpcError(res, 400, null, -32600, "Ungültige JSON-RPC-Nachricht.");
      return;
    }

    const { id, method, params } = parsedBody as JsonRpcRequest;
    const isNotification = id === undefined || id === null;
    const headerSessionId = readSingleHeader(req, "mcp-session-id");

    if (typeof method !== "string" || method.length === 0) {
      if (isNotification) {
        res.statusCode = 202;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }
      sendJsonRpcError(res, 400, id, -32600, "Feld \"method\" (String) fehlt.");
      return;
    }

    if (method === "initialize") {
      if (isNotification) {
        sendJsonRpcError(res, 400, null, -32600, "initialize erfordert eine Request-ID.");
        return;
      }
      this.#handleInitialize(req, res, id, params);
      return;
    }

    let httpSession: HttpMcpSession | undefined;
    if (headerSessionId) {
      this.#cleanupExpiredSessions();
      httpSession = this.#httpSessions.get(headerSessionId);
      if (!httpSession) {
        sendJson(res, 404, { error: "Unbekannte oder abgelaufene MCP-Session." });
        return;
      }
      httpSession.lastSeenAt = Date.now();
      res.setHeader("Mcp-Session-Id", httpSession.id);
    }

    if (isNotification) {
      res.statusCode = 202;
      res.setHeader("Cache-Control", "no-store");
      res.end();
      return;
    }

    switch (method) {
      case "ping":
        sendJsonRpcResult(res, 200, id, {});
        return;
      case "tools/list": {
        const tools = this.#requiresRemoteSession
          ? [REMOTE_SESSION_TOOL, ...TOOL_DEFINITIONS]
          : TOOL_DEFINITIONS;
        sendJsonRpcResult(res, 200, id, { tools });
        return;
      }
      case "tools/call":
        await this.#handleToolCall(req, res, id, params, httpSession);
        return;
      default:
        sendJsonRpcError(res, 200, id, -32601, `Methode nicht unterstützt: ${method}`);
    }
  }

  #handleInitialize(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    id: unknown,
    params: unknown,
  ): void {
    this.#cleanupExpiredSessions();

    if (this.#maxHttpSessions <= 0 || this.#httpSessions.size >= this.#maxHttpSessions) {
      res.setHeader("Retry-After", "30");
      sendJson(res, 503, { error: "Maximale Anzahl gleichzeitiger HTTP-MCP-Sessions erreicht. Bitte später erneut versuchen." });
      return;
    }

    const requestedVersion =
      params && typeof params === "object"
        ? (params as { protocolVersion?: unknown }).protocolVersion
        : undefined;
    const protocolVersion =
      typeof requestedVersion === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : SUPPORTED_PROTOCOL_VERSIONS[0];

    const now = Date.now();
    const mcpSessionId = randomBytes(16).toString("hex");
    const preseededBrowserSessionId = this.#requiresRemoteSession
      ? extractProvidedBrowserSessionId(req)
      : null;

    this.#httpSessions.set(mcpSessionId, {
      id: mcpSessionId,
      browserSessionId: preseededBrowserSessionId,
      createdAt: now,
      lastSeenAt: now,
    });

    res.setHeader("Mcp-Session-Id", mcpSessionId);
    sendJsonRpcResult(res, 200, id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: "logic-circuit",
        title: this.#serverLabel,
        version: PACKAGE_VERSION,
      },
      instructions: this.#buildInstructions(),
    });
  }

  async #handleToolCall(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    id: unknown,
    params: unknown,
    httpSession?: HttpMcpSession,
  ): Promise<void> {
    const callParams =
      params && typeof params === "object" && !Array.isArray(params)
        ? (params as { name?: unknown; arguments?: unknown })
        : {};
    const toolName = callParams.name;
    const args =
      callParams.arguments && typeof callParams.arguments === "object" && !Array.isArray(callParams.arguments)
        ? (callParams.arguments as Record<string, unknown>)
        : {};

    if (this.#requiresRemoteSession && toolName === REMOTE_SESSION_TOOL.name) {
      this.#handleSetRemoteSession(res, id, args, httpSession);
      return;
    }

    if (typeof toolName !== "string" || !TOOL_DEFINITIONS.some((tool) => tool.name === toolName)) {
      sendJsonRpcError(res, 200, id, -32602, `Unbekanntes Werkzeug: ${String(toolName)}`);
      return;
    }

    const browserSessionId = this.#requiresRemoteSession
      ? (extractProvidedBrowserSessionId(req) ?? httpSession?.browserSessionId ?? undefined)
      : undefined;

    if (this.#requiresRemoteSession && !browserSessionId) {
      sendJsonRpcResult(res, 200, id, {
        content: [
          {
            type: "text",
            text: [
              "Keine Remote-SessionID gesetzt.",
              "Bitte den Nutzer um den Session-Prompt aus dem Logic-Circuit-Verbindungsdialog",
              "(\"Nutze für Logic Circuit Anfragen folgende SessionID: ...\") und anschließend \"set_remote_session\" aufrufen.",
            ].join(" "),
          },
        ],
        isError: true,
      });
      return;
    }

    try {
      const result = await this.#invokeTool(toolName, args, browserSessionId);
      sendJsonRpcResult(res, 200, id, formatToolSuccessContent(result));
    } catch (error) {
      if (error instanceof Error && error.name === "ConcurrentCallLimitError") {
        res.setHeader("Retry-After", "1");
        sendJsonRpcError(res, 429, id, -32001, error.message);
        return;
      }
      sendJsonRpcResult(res, 200, id, {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      });
    }
  }

  #handleSetRemoteSession(
    res: http.ServerResponse,
    id: unknown,
    args: Record<string, unknown>,
    httpSession?: HttpMcpSession,
  ): void {
    if (!httpSession) {
      sendJsonRpcResult(res, 200, id, {
        content: [
          {
            type: "text",
            text: "Fehlender Mcp-Session-Id-Header. Bitte zuerst \"initialize\" aufrufen.",
          },
        ],
        isError: true,
      });
      return;
    }

    const raw = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
    if (!SESSION_ID_PATTERN.test(raw)) {
      sendJsonRpcResult(res, 200, id, {
        content: [
          {
            type: "text",
            text: "Ungültige SessionID. Erwartet wird die vom Logic-Circuit-Verbindungsdialog erzeugte SessionID (z. B. xxyy-aabb-1234-qwer).",
          },
        ],
        isError: true,
      });
      return;
    }

    httpSession.browserSessionId = raw;
    httpSession.lastSeenAt = Date.now();
    sendJsonRpcResult(res, 200, id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              sessionId: raw,
            },
            null,
            2,
          ),
        },
      ],
    });
  }

  #buildInstructions(): string {
    if (this.#requiresRemoteSession) {
      return [
        `Zugriff auf eine entfernte Logic-Circuit-Web-Sitzung (${this.#serverLabel}).`,
        "Im Remote-Modus muss vor dem ersten Schaltungswerkzeug die SessionID per \"set_remote_session\" gesetzt werden",
        "(vom Nutzer im Chat über den Verbindungsdialog-Prompt bereitgestellt).",
        "Koordinaten sind Rastereinheiten (1 Einheit = 18 px).",
      ].join(" ");
    }

    return [
      "Zugriff auf die im Browser geöffnete Logic-Circuit-Web-Sitzung (digitaler Schaltungssimulator).",
      "Voraussetzung: \"yarn dev\" läuft und die App ist im Browser geöffnet.",
      "Koordinaten sind Rastereinheiten (1 Einheit = 18 px).",
    ].join(" ");
  }

  #cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.#httpSessions.entries()) {
      if (now - session.lastSeenAt > this.#httpSessionTtlMs) {
        this.#httpSessions.delete(id);
      }
    }
  }
}

export default McpHttpHandler;
