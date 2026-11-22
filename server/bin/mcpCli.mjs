#!/usr/bin/env node
// Stdio-Adapter für MCP-Clients (z. B. Antigravity, Claude Desktop).
// Spricht MCP (JSON-RPC 2.0, zeilenweise über stdin/stdout) und leitet Werkzeugaufrufe
// per HTTP an die MCP-Bridge des laufenden Vite-Dev-Servers ("yarn dev") weiter.
// Wichtig: stdout ist ausschließlich für MCP-Nachrichten reserviert, Diagnosen gehen nach stderr.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOOL_DEFINITIONS = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../src/mcp/toolDefinitions.json"), "utf-8"),
);
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
).version;

const BASE_URL = (process.env.LOGIC_CIRCUIT_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const ACCESS_TOKEN = (process.env.LOGIC_CIRCUIT_TOKEN ?? "").trim();

function isLocalUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch (_error) {
    return false;
  }
}

const IS_REMOTE_MODE =
  process.env.LOGIC_CIRCUIT_REMOTE === "1" ||
  process.env.LOGIC_CIRCUIT_REMOTE === "true" ||
  !isLocalUrl(BASE_URL);

const DEFAULT_TIMEOUT_MS = IS_REMOTE_MODE ? 60000 : 20000;
const REQUEST_TIMEOUT_MS = Number(process.env.LOGIC_CIRCUIT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

let activeSessionId = (process.env.LOGIC_CIRCUIT_SESSION ?? "").trim() || null;

const REMOTE_SESSION_TOOL = {
  name: "set_remote_session",
  description:
    "Setzt die flüchtige Remote-SessionID aus dem Logic-Circuit-Verbindungsdialog für alle weiteren Werkzeugaufrufe in dieser Konversation.",
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

const SERVER_INSTRUCTIONS = IS_REMOTE_MODE
  ? [
    `Zugriff auf eine entfernte Logic-Circuit-Web-Sitzung (${BASE_URL}).`,
    "Im Remote-Modus muss vor dem ersten Schaltungswerkzeug die SessionID per \"set_remote_session\" gesetzt werden",
    "(vom Nutzer im Chat über den Verbindungsdialog-Prompt bereitgestellt).",
    "Koordinaten sind Rastereinheiten (1 Einheit = 18 px).",
  ].join(" ")
  : [
    "Zugriff auf die im Browser geöffnete Logic-Circuit-Web-Sitzung (digitaler Schaltungssimulator).",
    "Voraussetzung: \"yarn dev\" läuft und die App ist im Browser geöffnet.",
    "Koordinaten sind Rastereinheiten (1 Einheit = 18 px).",
  ].join(" ");

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

// Ruft ein Werkzeug über die HTTP-Bridge des Dev-Servers oder Remote-Relays auf
async function callBrowser(method, params, sessionId) {
  const headers = { "Content-Type": "application/json" };
  if (ACCESS_TOKEN.length > 0) {
    headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
  }
  if (typeof sessionId === "string" && sessionId.length > 0) {
    headers["X-MCP-Session"] = sessionId;
  }

  const payload = sessionId ? { sessionId, method, params } : { method, params };

  let response;
  try {
    response = await fetch(`${BASE_URL}/__mcp/call`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const hint = IS_REMOTE_MODE
      ? `Logic-Circuit-Remote-Server unter ${BASE_URL} nicht erreichbar. (${error.message})`
      : `Logic-Circuit-Dev-Server unter ${BASE_URL} nicht erreichbar. Bitte "yarn dev" starten. (${error.message})`;
    throw new Error(hint, { cause: error });
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.error === "string") {
    throw new Error(body.error ?? `HTTP ${response.status} vom Server.`);
  }
  return body.result;
}

function handleSetRemoteSession(id, args) {
  const raw = typeof args?.sessionId === "string" ? args.sessionId.trim() : "";
  if (!SESSION_ID_PATTERN.test(raw)) {
    sendResult(id, {
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

  activeSessionId = raw;
  sendResult(id, {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ok: true,
            sessionId: activeSessionId,
            url: BASE_URL,
          },
          null,
          2,
        ),
      },
    ],
  });
}

async function handleToolCall(id, params) {
  const name = params?.name;
  const args = params?.arguments ?? {};

  if (IS_REMOTE_MODE && name === REMOTE_SESSION_TOOL.name) {
    handleSetRemoteSession(id, args);
    return;
  }

  if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
    sendError(id, -32602, `Unbekanntes Werkzeug: ${String(name)}`);
    return;
  }

  if (IS_REMOTE_MODE && !activeSessionId) {
    sendResult(id, {
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
    const result = await callBrowser(name, args, activeSessionId);
    if (result && typeof result === "object" && typeof result.data === "string" && typeof result.mimeType === "string") {
      const content = [
        { type: "image", data: result.data, mimeType: result.mimeType },
      ];
      if (typeof result.description === "string") {
        content.push({ type: "text", text: result.description });
      }
      sendResult(id, { content });
      return;
    }

    if (
      result &&
      typeof result === "object" &&
      result.screenshot &&
      typeof result.screenshot === "object" &&
      typeof result.screenshot.data === "string" &&
      typeof result.screenshot.mimeType === "string"
    ) {
      const { screenshot, ...payload } = result;
      const content = [
        { type: "text", text: JSON.stringify(payload, null, 2) },
        { type: "image", data: screenshot.data, mimeType: screenshot.mimeType },
      ];
      if (typeof screenshot.description === "string") {
        content.push({ type: "text", text: screenshot.description });
      }
      sendResult(id, { content });
      return;
    }

    sendResult(id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    });
  } catch (error) {
    sendResult(id, {
      content: [{ type: "text", text: error.message }],
      isError: true,
    });
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    sendError(null, -32600, "Ungültige JSON-RPC-Nachricht.");
    return;
  }

  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  // Antworten des Clients auf Server-Requests werden nicht benötigt
  if (typeof method !== "string") {
    return;
  }

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      sendResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "logic-circuit", title: "Logic Circuit Web", version: PACKAGE_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      });
      return;
    }
    case "ping":
      sendResult(id, {});
      return;
    case "tools/list": {
      const tools = IS_REMOTE_MODE ? [REMOTE_SESSION_TOOL, ...TOOL_DEFINITIONS] : TOOL_DEFINITIONS;
      sendResult(id, { tools });
      return;
    }
    case "tools/call":
      await handleToolCall(id, params);
      return;
    default:
      if (!isNotification) {
        sendError(id, -32601, `Methode nicht unterstützt: ${method}`);
      }
  }
}

const pendingMessages = new Set();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  if (line.trim().length === 0) {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch (_error) {
    sendError(null, -32700, "Parse error: Nachricht ist kein gültiges JSON.");
    return;
  }

  const task = handleMessage(message)
    .catch((error) => {
      console.error("[logic-circuit-mcp]", error);
    })
    .finally(() => {
      pendingMessages.delete(task);
    });
  pendingMessages.add(task);
});

// Beim Schließen von stdin laufende Aufrufe noch beantworten, dann beenden
input.on("close", () => {
  Promise.allSettled([...pendingMessages]).then(() => {
    process.exit(0);
  });
});
