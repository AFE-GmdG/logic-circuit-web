import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { COLLAB_CONFIG_PATH } from "../../src/collab/collabEvents.ts";
import {
  MCP_EVENT_ACK,
  MCP_EVENT_HELLO,
  MCP_EVENT_REQUEST,
  MCP_EVENT_RESPONSE,
  MCP_HTTP_BASE_PATH,
  MCP_STREAMABLE_HTTP_PATH,
  MCP_WS_PATH,
} from "../../src/mcp/mcpEvents.ts";

import McpRelay, {
  ConcurrentCallLimitError,
  type RelayClient,
  SessionLimitReachedError,
} from "../mcpRelay.ts";
import RateLimiter, { extractClientKey } from "../rateLimiter.ts";
import { createStandaloneServer, type StandaloneServerHandle } from "../standaloneServer.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8")) as { version: string }
).version;

function createDummyClient(): RelayClient {
  return {
    send: () => undefined,
    close: () => undefined,
  };
}

function encodeClientWsFrame(opcode: number, payload: Buffer): Buffer {
  const maskKey = randomBytes(4);
  const len = payload.length;
  const header = Buffer.alloc(2);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | len;

  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) {
    masked[i] = payload[i] ^ maskKey[i & 3];
  }
  return Buffer.concat([header, maskKey, masked]);
}

function connectRawWs(port: number, origin: string): Promise<{
  sendEnvelope: (event: string, payload?: unknown) => void;
  nextText: () => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const wsKey = randomBytes(16).toString("base64");
    const expectedAccept = createHash("sha1")
      .update(`${wsKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    const socket = net.createConnection({ host: "127.0.0.1", port });
    let handshakeDone = false;
    let rawBuffer: Buffer = Buffer.alloc(0);
    const messages: string[] = [];
    const waiters: Array<(msg: string) => void> = [];

    socket.on("connect", () => {
      socket.write(
        [
          `GET ${MCP_WS_PATH} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          `Origin: ${origin}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${wsKey}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });

    socket.on("data", (chunk: Buffer) => {
      rawBuffer = Buffer.concat([rawBuffer, chunk]);
      if (!handshakeDone) {
        const marker = rawBuffer.indexOf("\r\n\r\n");
        if (marker === -1) {
          return;
        }
        const headerText = rawBuffer.subarray(0, marker).toString("utf-8");
        rawBuffer = rawBuffer.subarray(marker + 4);
        if (!headerText.startsWith("HTTP/1.1 101") || !headerText.includes(expectedAccept)) {
          socket.destroy();
          reject(new Error(headerText));
          return;
        }
        handshakeDone = true;
        resolve({
          sendEnvelope(event, payload) {
            socket.write(encodeClientWsFrame(0x1, Buffer.from(JSON.stringify({ event, payload }), "utf-8")));
          },
          nextText() {
            const queued = messages.shift();
            if (queued !== undefined) {
              return Promise.resolve(queued);
            }
            return new Promise((res) => waiters.push(res));
          },
          close() {
            socket.write(encodeClientWsFrame(0x8, Buffer.alloc(0)));
            socket.end();
          },
        });
      }

      while (handshakeDone && rawBuffer.length >= 2) {
        const opcode = rawBuffer[0] & 0x0f;
        let len = rawBuffer[1] & 0x7f;
        let offset = 2;

        if (len === 126) {
          if (rawBuffer.length < 4) {
            break;
          }
          len = rawBuffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (rawBuffer.length < 10) {
            break;
          }
          len = Number(rawBuffer.readBigUInt64BE(2));
          offset = 10;
        }

        if (rawBuffer.length < offset + len) {
          break;
        }

        const text = rawBuffer.subarray(offset, offset + len).toString("utf-8");
        rawBuffer = rawBuffer.subarray(offset + len);
        if (opcode === 0x1) {
          const waiter = waiters.shift();
          if (waiter) {
            waiter(text);
          } else {
            messages.push(text);
          }
        }
      }
    });

    socket.on("error", (err) => {
      if (!handshakeDone) {
        reject(err);
      }
    });
  });
}

describe("RateLimiter & extractClientKey", () => {
  it("begrenzt Anfragen im Sliding Window, berechnet Retry-After und räumt abgelaufene Buckets auf", () => {
    let nowMs = 60_000;
    const limiter = new RateLimiter({
      windowMs: 10_000,
      maxRequests: 3,
      maxBuckets: 16,
      now: () => nowMs,
    });

    expect(limiter.consume("client-a")).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
    expect(limiter.consume("client-a")).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    expect(limiter.consume("client-a")).toEqual({ allowed: true, remaining: 0, retryAfterSeconds: 0 });

    const blocked = limiter.consume("client-a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(limiter.peek("client-a").allowed).toBe(false);

    // Nach 2 Fenstern ist der Bucket vollständig abgelaufen und wird aufgeräumt
    nowMs += 20_000;
    expect(limiter.bucketCount).toBe(0);
    expect(limiter.consume("client-a").allowed).toBe(true);
  });

  it("begrenzt die Bucket-Anzahl durch LRU-Verdrängung und berücksichtigt trustProxy", () => {
    let nowMs = 1000;
    const limiter = new RateLimiter({
      windowMs: 60_000,
      maxRequests: 5,
      maxBuckets: 16,
      now: () => nowMs,
    });

    for (let i = 0; i < 20; i += 1) {
      nowMs += 10;
      limiter.consume(`ip-${i}`);
    }
    expect(limiter.bucketCount).toBe(16);

    const fakeReq = {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as http.IncomingMessage;

    expect(extractClientKey(fakeReq, true)).toBe("203.0.113.10");
    expect(extractClientKey(fakeReq, false)).toBe("127.0.0.1");
  });
});

describe("McpRelay Session- und Concurrency-Limits", () => {
  it("erzwingt maxSessions (inkl. Reconnect-Ausnahme) und maxConcurrentCallsPerSession", async () => {
    const relay = new McpRelay({
      maxSessions: 1,
      maxConcurrentCallsPerSession: 2,
      gracePeriodMs: 5000,
    });

    const client1 = createDummyClient();
    const reg1 = relay.registerSession(client1);

    const client2 = createDummyClient();
    expect(() => relay.registerSession(client2)).toThrow(SessionLimitReachedError);

    // Reconnect derselben Session mit gültigem Token bleibt trotz vollem Session-Limit möglich
    relay.unregisterClient(client1, false);
    const resumed = relay.registerSession(client2, {
      sessionId: reg1.sessionId,
      reconnectToken: reg1.reconnectToken,
    });
    expect(resumed.sessionId).toBe(reg1.sessionId);

    const c1 = relay.call(reg1.sessionId, "get_circuit_summary");
    const c2 = relay.call(reg1.sessionId, "get_circuit_details");
    await expect(relay.call(reg1.sessionId, "validate_circuit")).rejects.toThrow(ConcurrentCallLimitError);

    relay.unregisterClient(client2, true);
    await expect(c1).rejects.toThrow();
    await expect(c2).rejects.toThrow();
  });
});

describe("StandaloneServer Sicherheit, Rate-Limiting, CORS & serverVersion", () => {
  const activeServers: StandaloneServerHandle[] = [];

  afterEach(async () => {
    while (activeServers.length > 0) {
      const handle = activeServers.pop();
      if (handle) {
        await handle.close();
      }
    }
  });

  it("liefert CORS-/Private-Network-Header für erlaubte Origins, blockt fremde Origins und liefert serverVersion", async () => {
    const server = await createStandaloneServer({
      host: "127.0.0.1",
      port: 0,
      accessKey: "secret-mcp",
      allowedOrigins: ["https://afe-gmdg.github.io"],
      heartbeatIntervalMs: 0,
      collab: {
        accessKey: "secret-collab",
        allowedOrigins: ["https://afe-gmdg.github.io"],
      },
    });
    activeServers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    // OPTIONS Preflight mit Private Network Access geht auch bei gesetztem MCP_ACCESS_KEY durch (204)
    const preflightOk = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://afe-gmdg.github.io",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization, Mcp-Session-Id",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(preflightOk.status).toBe(204);
    expect(preflightOk.headers.get("access-control-allow-origin")).toBe("https://afe-gmdg.github.io");
    expect(preflightOk.headers.get("access-control-allow-private-network")).toBe("true");
    expect(preflightOk.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");

    // Fremder Origin auf Preflight und GET -> 403 ohne Allow-Header
    const preflightBad = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(preflightBad.status).toBe(403);
    expect(preflightBad.headers.get("access-control-allow-origin")).toBeNull();

    const statusRes = await fetch(`${baseUrl}${MCP_HTTP_BASE_PATH}/status`, {
      headers: { Origin: "https://afe-gmdg.github.io" },
    });
    expect(statusRes.status).toBe(200);
    expect(statusRes.headers.get("access-control-allow-origin")).toBe("https://afe-gmdg.github.io");
    expect(await statusRes.json()).toEqual({
      activeSessions: 0,
      pendingRequests: 0,
      authRequired: true,
      serverVersion: PACKAGE_VERSION,
    });

    const collabRes = await fetch(`${baseUrl}${COLLAB_CONFIG_PATH}`, {
      headers: { Origin: "https://afe-gmdg.github.io" },
    });
    expect(collabRes.status).toBe(200);
    expect(collabRes.headers.get("access-control-allow-origin")).toBe("https://afe-gmdg.github.io");
    const collabBody = (await collabRes.json()) as { serverVersion?: string; authRequired?: boolean };
    expect(collabBody.authRequired).toBe(true);
    expect(collabBody.serverVersion).toBe(PACKAGE_VERSION);
  });

  it("erzwingt Auth-First (401 vor Body-Parsing) und schützt per Auth-Fail-, HTTP- und WS-Rate-Limiting", async () => {
    const server = await createStandaloneServer({
      host: "127.0.0.1",
      port: 0,
      accessKey: "secret-key",
      allowedOrigins: ["https://afe-gmdg.github.io"],
      heartbeatIntervalMs: 0,
      rateLimits: {
        httpPerMin: 5,
        authFailPerMin: 2,
        wsPerMin: 2,
      },
    });
    activeServers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    // Auth-First: selbst bei falschem Content-Type und defektem Body kommt zuerst 401
    const fail1 = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{kein-json",
    });
    expect(fail1.status).toBe(401);

    const fail2 = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer falsch",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(fail2.status).toBe(401);

    // Nach 2 fehlgeschlagenen Auth-Versuchen sperrt authFailLimiter mit 429 + Retry-After
    const locked = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-key",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // WebSocket-Upgrade-Rate-Limiting über separaten X-Forwarded-For-Client
    const ws1 = await connectRawWs(server.port, "https://afe-gmdg.github.io");
    const ws2 = await connectRawWs(server.port, "https://afe-gmdg.github.io");
    await expect(connectRawWs(server.port, "https://afe-gmdg.github.io")).rejects.toThrow(/429 Too Many Requests/);
    ws1.close();
    ws2.close();
  });

  it("begrenzt HTTP-MCP-Sessions (503) und gleichzeitige Tool-Calls (429 + Retry-After)", async () => {
    const server = await createStandaloneServer({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: ["https://afe-gmdg.github.io"],
      heartbeatIntervalMs: 0,
      maxHttpSessions: 1,
      maxConcurrentCallsPerSession: 1,
      rateLimits: { httpPerMin: 50 },
    });
    activeServers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    // Browser-WebSocket registrieren
    const ws = await connectRawWs(server.port, "https://afe-gmdg.github.io");
    ws.sendEnvelope(MCP_EVENT_HELLO, {});
    const ack = JSON.parse(await ws.nextText()) as { event: string; payload: { sessionId: string } };
    expect(ack.event).toBe(MCP_EVENT_ACK);
    const browserSessionId = ack.payload.sessionId;

    // Erste HTTP-MCP-Session initialisieren
    const init1 = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(init1.status).toBe(200);
    const mcpSessionId = init1.headers.get("mcp-session-id") as string;

    // Zweite HTTP-MCP-Session schlägt wegen maxHttpSessions=1 mit 503 + Retry-After fehl (ohne Session 1 zu verdrängen)
    const init2 = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(init2.status).toBe(503);
    expect(Number(init2.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // SessionID setzen
    const setRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "set_remote_session", arguments: { sessionId: browserSessionId } },
      }),
    });
    expect(setRes.status).toBe(200);

    // Erster laufender Call bleibt offen, zweiter paralleler Call wird mit 429 abgewiesen
    const call1Promise = fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_circuit_summary", arguments: {} },
      }),
    });

    const reqMsg = JSON.parse(await ws.nextText()) as { event: string; payload: { id: string } };
    expect(reqMsg.event).toBe(MCP_EVENT_REQUEST);

    const call2Res = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_circuit_details", arguments: {} },
      }),
    });
    expect(call2Res.status).toBe(429);
    expect(Number(call2Res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    ws.sendEnvelope(MCP_EVENT_RESPONSE, { id: reqMsg.payload.id, result: { ok: true } });
    const call1Res = await call1Promise;
    expect(call1Res.status).toBe(200);
    ws.close();
  });

  it("blockt HTTP-MCP bei Überschreitung des httpPerMin-Limits mit 429", async () => {
    const server = await createStandaloneServer({
      host: "127.0.0.1",
      port: 0,
      heartbeatIntervalMs: 0,
      rateLimits: { httpPerMin: 2 },
    });
    activeServers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    const r1 = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const r2 = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    });
    const r3 = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(Number(r3.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
