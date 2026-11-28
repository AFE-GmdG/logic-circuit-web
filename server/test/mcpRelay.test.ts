import { createHash, randomBytes } from "node:crypto";
import net from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type McpBridgeRequest from "../../src/types/mcp/mcpBridgeRequest.ts";

import {
  MCP_EVENT_ACK,
  MCP_EVENT_BYE,
  MCP_EVENT_ERROR,
  MCP_EVENT_HELLO,
  MCP_EVENT_PING,
  MCP_EVENT_PONG,
  MCP_EVENT_REQUEST,
  MCP_EVENT_RESPONSE,
  MCP_HTTP_BASE_PATH,
  MCP_PRIVACY_PATH,
  MCP_STREAMABLE_HTTP_PATH,
  MCP_WS_PATH,
} from "../../src/mcp/mcpEvents.ts";

import McpBridge, { type McpBridgeClient, type McpWebSocketChannel, NoBrowserSessionError } from "../mcpBridge.ts";
import McpRelay, {
  MissingSessionIdError,
  type RelayClient,
  UnauthorizedRelayError,
  UnknownSessionError,
} from "../mcpRelay.ts";
import { createStandaloneServer, type StandaloneServerHandle } from "../standaloneServer.ts";

function createFakeBridgeChannel(): {
  channel: McpWebSocketChannel;
  emit: (event: string, data: unknown, client: McpBridgeClient) => void;
} {
  const listeners = new Map<string, Array<(data: unknown, client: McpBridgeClient) => void>>();
  return {
    channel: {
      on(event, listener) {
        const list = listeners.get(event) ?? [];
        list.push(listener as (data: unknown, client: McpBridgeClient) => void);
        listeners.set(event, list);
      },
    },
    emit(event, data, client) {
      for (const listener of listeners.get(event) ?? []) {
        listener(data, client);
      }
    },
  };
}

function createMemoryRelayClient(): {
  client: RelayClient;
  events: Array<{ event: string; payload: unknown }>;
  closed: boolean;
} {
  const state = {
    events: [] as Array<{ event: string; payload: unknown }>,
    closed: false,
  };
  const client: RelayClient = {
    send(event, payload) {
      state.events.push({ event, payload });
    },
    close() {
      state.closed = true;
    },
  };
  return {
    client,
    get events() {
      return state.events;
    },
    get closed() {
      return state.closed;
    },
  };
}

// Hilfsfunktion: Maskierter RFC-6455-Client-Frame für End-to-End-Tests gegen den TCP-Socket
function encodeClientWsFrame(opcode: number, payload: Buffer): Buffer {
  const maskKey = randomBytes(4);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) {
    masked[i] = payload[i] ^ maskKey[i & 3];
  }
  return Buffer.concat([header, maskKey, masked]);
}

function decodeServerWsFrames(buffer: Buffer): {
  frames: Array<{ opcode: number; payload: Buffer }>;
  rest: Buffer;
} {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let cursor = 0;

  while (buffer.length - cursor >= 2) {
    const opcode = buffer[cursor] & 0x0f;
    let len = buffer[cursor + 1] & 0x7f;
    let offset = cursor + 2;

    if (len === 126) {
      if (buffer.length - offset < 2) {
        break;
      }
      len = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buffer.length - offset < 8) {
        break;
      }
      len = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    if (buffer.length - offset < len) {
      break;
    }

    frames.push({
      opcode,
      payload: buffer.subarray(offset, offset + len),
    });
    cursor = offset + len;
  }

  return {
    frames,
    rest: buffer.subarray(cursor),
  };
}

function connectRawWsClient(port: number, origin: string): Promise<{
  sendEnvelope: (event: string, payload?: unknown) => void;
  sendPing: () => void;
  nextEnvelope: () => Promise<{ event: string; payload: unknown }>;
  waitForClose: () => Promise<void>;
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
    const envelopeQueue: Array<{ event: string; payload: unknown }> = [];
    const envelopeWaiters: Array<(env: { event: string; payload: unknown }) => void> = [];
    const closeWaiters: Array<() => void> = [];
    let closed = false;

    const pushEnvelope = (env: { event: string; payload: unknown }) => {
      const waiter = envelopeWaiters.shift();
      if (waiter) {
        waiter(env);
      } else {
        envelopeQueue.push(env);
      }
    };

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
          reject(new Error(`Handshake fehlgeschlagen: ${headerText}`));
          return;
        }
        handshakeDone = true;
        resolve({
          sendEnvelope(event, payload) {
            socket.write(encodeClientWsFrame(0x1, Buffer.from(JSON.stringify({ event, payload }), "utf-8")));
          },
          sendPing() {
            socket.write(encodeClientWsFrame(0x9, Buffer.alloc(0)));
          },
          nextEnvelope() {
            const queued = envelopeQueue.shift();
            if (queued) {
              return Promise.resolve(queued);
            }
            return new Promise((res) => {
              envelopeWaiters.push(res);
            });
          },
          waitForClose() {
            if (closed) {
              return Promise.resolve();
            }
            return new Promise((res) => {
              closeWaiters.push(res);
            });
          },
          close() {
            socket.write(encodeClientWsFrame(0x8, Buffer.alloc(0)));
            socket.end();
          },
        });
      }

      if (handshakeDone && rawBuffer.length > 0) {
        const decoded = decodeServerWsFrames(rawBuffer);
        rawBuffer = decoded.rest;
        for (const frame of decoded.frames) {
          if (frame.opcode === 0x1) {
            pushEnvelope(JSON.parse(frame.payload.toString("utf-8")) as { event: string; payload: unknown });
          } else if (frame.opcode === 0x9) {
            socket.write(encodeClientWsFrame(0xa, frame.payload));
          } else if (frame.opcode === 0x8) {
            socket.end();
          }
        }
      }
    });

    socket.on("close", () => {
      closed = true;
      for (const waiter of closeWaiters.splice(0)) {
        waiter();
      }
    });

    socket.on("error", (error) => {
      if (!handshakeDone) {
        reject(error);
      }
    });
  });
}

describe("McpBridge (lokaler Dev-Transport)", () => {
  it("funktioniert unverändert über entkoppelten McpWebSocketChannel", async () => {
    const bridge = new McpBridge(500);
    const { channel, emit } = createFakeBridgeChannel();
    bridge.attach(channel);

    await expect(bridge.call("get_circuit_summary")).rejects.toThrow(NoBrowserSessionError);

    const sent: Array<{ event: string; payload: unknown }> = [];
    const client: McpBridgeClient = {
      send(event, payload) {
        sent.push({ event, payload });
      },
    };

    emit(MCP_EVENT_HELLO, {}, client);
    expect(bridge.isConnected).toBe(true);
    expect(sent[0]).toEqual({ event: MCP_EVENT_ACK, payload: {} });

    const pending = bridge.call("get_circuit_summary", {});
    const req = sent[1].payload as McpBridgeRequest;
    emit(MCP_EVENT_RESPONSE, { id: req.id, result: { ok: true } }, client);

    await expect(pending).resolves.toEqual({ ok: true });
    emit(MCP_EVENT_BYE, {}, client);
    expect(bridge.isConnected).toBe(false);
  });
});

describe("McpRelay (zustandsloses Multi-Session-RAM-Relay)", () => {
  it("erzeugt flüchtige SessionIDs und isoliert parallele Browsersitzungen strikt", async () => {
    const relay = new McpRelay({ timeoutMs: 2000 });
    const sessionA = createMemoryRelayClient();
    const sessionB = createMemoryRelayClient();

    const regA = relay.registerSession(sessionA.client);
    const regB = relay.registerSession(sessionB.client);

    expect(regA.sessionId).toMatch(/^[a-z0-9]{4}(?:-[a-z0-9]{4}){3}$/);
    expect(regB.sessionId).not.toBe(regA.sessionId);
    expect(relay.activeSessionCount).toBe(2);

    const callA = relay.call(regA.sessionId, "get_circuit_summary", { test: "A" });
    const reqA = sessionA.events.find((e) => e.event === MCP_EVENT_REQUEST)?.payload as McpBridgeRequest;
    expect(reqA).toBeDefined();
    expect(sessionB.events.some((e) => e.event === MCP_EVENT_REQUEST)).toBe(false);

    // Session B darf keinen fremden Request von Session A beantworten
    relay.handleResponse(sessionB.client, { id: reqA.id, result: { hijacked: true } });
    expect(relay.pendingCount).toBe(1);

    relay.handleResponse(sessionA.client, { id: reqA.id, result: { circuit: "A" } });
    await expect(callA).resolves.toEqual({ circuit: "A" });
    expect(relay.pendingCount).toBe(0);
  });

  it("verlangt zwingend eine gültige SessionID und lehnt fehlende/unbekannte IDs ab", async () => {
    const relay = new McpRelay();
    const session = createMemoryRelayClient();
    relay.registerSession(session.client);

    await expect(relay.call(undefined, "get_circuit_summary")).rejects.toThrow(MissingSessionIdError);
    await expect(relay.call("kurz", "get_circuit_summary")).rejects.toThrow(MissingSessionIdError);
    await expect(relay.call("aaaa-bbbb-cccc-dddd", "get_circuit_summary")).rejects.toThrow(UnknownSessionError);
  });

  it("prüft MCP_ACCESS_KEY und erlaubt Reconnect nur mit gültigem Reconnect-Token", async () => {
    vi.useFakeTimers();
    try {
      const relay = new McpRelay({ accessKey: "geheimer-schluessel", gracePeriodMs: 5000 });
      const client1 = createMemoryRelayClient();

      expect(() => relay.registerSession(client1.client, { accessKey: "falsch" })).toThrow(UnauthorizedRelayError);

      const reg = relay.registerSession(client1.client, { accessKey: "geheimer-schluessel" });
      expect(relay.getStatus()).toEqual({
        activeSessions: 1,
        pendingRequests: 0,
        authRequired: true,
      });

      // Netzabbruch -> ausstehender Request schlägt sofort fehl, Session bleibt kurz in Grace-Phase
      const pendingCall = relay.call(reg.sessionId, "get_circuit_summary");
      relay.unregisterClient(client1.client, false);
      await expect(pendingCall).rejects.toThrow(UnknownSessionError);

      // Falscher Reconnect-Token darf bestehende SessionID nicht übernehmen
      const attacker = createMemoryRelayClient();
      const attackerReg = relay.registerSession(attacker.client, {
        sessionId: reg.sessionId,
        reconnectToken: "ungueltig",
        accessKey: "geheimer-schluessel",
      });
      expect(attackerReg.sessionId).not.toBe(reg.sessionId);

      // Gültiger Reconnect-Token behält die SessionID
      const client2 = createMemoryRelayClient();
      const resumed = relay.registerSession(client2.client, {
        sessionId: reg.sessionId,
        reconnectToken: reg.reconnectToken,
        accessKey: "geheimer-schluessel",
      });
      expect(resumed.sessionId).toBe(reg.sessionId);

      // Explizites Bye entfernt die Session sofort
      relay.unregisterClient(client2.client, true);
      await expect(relay.call(reg.sessionId, "get_circuit_summary")).rejects.toThrow(UnknownSessionError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("StandaloneServer + WebSocket + Streamable HTTP (/mcp) End-to-End", () => {
  const activeServers: StandaloneServerHandle[] = [];

  afterEach(async () => {
    while (activeServers.length > 0) {
      const handle = activeServers.pop();
      if (handle) {
        await handle.close();
      }
    }
  });

  it("schützt HTTP/WS per Access-Key & Origin und vermittelt Streamable-HTTP-Calls an den Browser", async () => {
    const server = await createStandaloneServer({
      host: "127.0.0.1",
      port: 0,
      accessKey: "top-secret-key",
      allowedOrigins: ["https://circuit.example.com"],
      heartbeatIntervalMs: 0,
    });
    activeServers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;

    const healthRes = await fetch(`${baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);
    await expect(healthRes.json()).resolves.toEqual({ ok: true });

    const statusRes = await fetch(`${baseUrl}${MCP_HTTP_BASE_PATH}/status`);
    expect(statusRes.status).toBe(200);
    await expect(statusRes.json()).resolves.toEqual({
      activeSessions: 0,
      pendingRequests: 0,
      authRequired: true,
      serverVersion: expect.any(String),
    });

    // Legacy-Endpunkt POST /__mcp/call ist vollständig entfernt
    const legacyCallRes = await fetch(`${baseUrl}${MCP_HTTP_BASE_PATH}/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer top-secret-key",
      },
      body: JSON.stringify({ method: "get_circuit_summary" }),
    });
    expect(legacyCallRes.status).toBe(404);

    // Unautorisierter HTTP-Aufruf auf /mcp -> 401
    const unauthRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(unauthRes.status).toBe(401);

    // GET auf /mcp -> 405 Method Not Allowed
    const getRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "GET",
      headers: {
        Authorization: "Bearer top-secret-key",
      },
    });
    expect(getRes.status).toBe(405);

    // Unerlaubter Origin beim WS-Upgrade wird abgewiesen
    await expect(connectRawWsClient(server.port, "https://evil.example")).rejects.toThrow(/403/);

    // Falscher Access-Key beim WS-HELLO schließt Verbindung mit Fehler
    const badWs = await connectRawWsClient(server.port, "https://circuit.example.com");
    badWs.sendEnvelope(MCP_EVENT_HELLO, { accessKey: "falsch" });
    const errEnv = await badWs.nextEnvelope();
    expect(errEnv.event).toBe(MCP_EVENT_ERROR);
    await badWs.waitForClose();

    // Korrekter Browser-WS-Client
    const wsClient = await connectRawWsClient(server.port, "https://circuit.example.com");
    wsClient.sendEnvelope(MCP_EVENT_HELLO, { accessKey: "top-secret-key" });
    const ackEnv = await wsClient.nextEnvelope();
    expect(ackEnv.event).toBe(MCP_EVENT_ACK);
    const { sessionId } = ackEnv.payload as { sessionId: string };
    expect(sessionId).toMatch(/^[a-z0-9]{4}(?:-[a-z0-9]{4}){3}$/);

    // Ping/Pong über Anwendungs-Event
    wsClient.sendEnvelope(MCP_EVENT_PING, {});
    const pongEnv = await wsClient.nextEnvelope();
    expect(pongEnv.event).toBe(MCP_EVENT_PONG);

    const mcpEndpoint = `${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`;
    const postMcp = async (body: unknown, mcpSessionId?: string) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer top-secret-key",
      };
      if (mcpSessionId) {
        headers["Mcp-Session-Id"] = mcpSessionId;
      }
      const res = await fetch(mcpEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      return {
        status: res.status,
        sessionHeader: res.headers.get("mcp-session-id"),
        json: res.status === 202 ? null : (await res.json()) as Record<string, unknown>,
      };
    };

    try {
      const initRes = await postMcp({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      });
      expect(initRes.status).toBe(200);
      expect(initRes.sessionHeader).toBeTruthy();
      const mcpSessionId = initRes.sessionHeader as string;

      const listRes = await postMcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, mcpSessionId);
      const tools = ((listRes.json?.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
      expect(tools[0]).toBe("set_remote_session");
      expect(tools).toContain("get_circuit_summary");

      // Aufruf ohne vorher gesetzte SessionID muss gezielt fehlschlagen
      const missingRes = await postMcp(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_circuit_summary", arguments: {} },
        },
        mcpSessionId,
      );
      expect((missingRes.json?.result as { isError?: boolean }).isError).toBe(true);

      // SessionID über set_remote_session setzen
      const setRes = await postMcp(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "set_remote_session", arguments: { sessionId } },
        },
        mcpSessionId,
      );
      expect((setRes.json?.result as { isError?: boolean }).isError).toBeUndefined();

      // Werkzeugaufruf wird über Streamable HTTP -> Relay -> WebSocket zugestellt
      const callPromise = postMcp(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "get_circuit_summary", arguments: {} },
        },
        mcpSessionId,
      );

      const reqEnv = await wsClient.nextEnvelope();
      expect(reqEnv.event).toBe(MCP_EVENT_REQUEST);
      const reqPayload = reqEnv.payload as McpBridgeRequest;
      expect(reqPayload.method).toBe("get_circuit_summary");

      wsClient.sendEnvelope(MCP_EVENT_RESPONSE, {
        id: reqPayload.id,
        result: { currentCircuitId: "main", remoteOk: true },
      });

      const toolResp = await callPromise;
      const content = (toolResp.json?.result as { content: Array<{ text: string }> }).content;
      expect(JSON.parse(content[0].text)).toEqual({ currentCircuitId: "main", remoteOk: true });

      const deleteRes = await fetch(mcpEndpoint, {
        method: "DELETE",
        headers: {
          Authorization: "Bearer top-secret-key",
          "Mcp-Session-Id": mcpSessionId,
        },
      });
      expect(deleteRes.status).toBe(204);
    } finally {
      wsClient.close();
    }
  });

  it("liefert konfigurierte DSGVO-Betreiberangaben über GET /__mcp/privacy", async () => {
    const handle = await createStandaloneServer({
      host: "127.0.0.1",
      port: 0,
      heartbeatIntervalMs: 0,
      privacy: {
        responsibleName: "Max Mustermann",
        responsibleAddress: "Musterstraße 1, 12345 Musterstadt",
        contactEmail: "privacy@example.com",
        hostingLocation: "Deutschland, Frankfurt",
      },
    });
    activeServers.push(handle);

    const resp = await fetch(`http://127.0.0.1:${handle.port}${MCP_PRIVACY_PATH}`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, string>;
    expect(body).toEqual({
      responsibleName: "Max Mustermann",
      responsibleAddress: "Musterstraße 1, 12345 Musterstadt",
      contactEmail: "privacy@example.com",
      hostingLocation: "Deutschland, Frankfurt",
    });
  });
});
