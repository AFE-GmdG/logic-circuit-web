import http from "node:http";

import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MCP_EVENT_HELLO, MCP_HTTP_BASE_PATH, MCP_STREAMABLE_HTTP_PATH } from "../../src/mcp/mcpEvents.ts";

import McpHttpHandler from "../mcpHttpHandler.ts";
import vitePluginMcp from "../vitePluginMcp.ts";

function startHandlerServer(handler: McpHttpHandler): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = (req.url ?? "/").split("?")[0];
      if (pathname !== MCP_STREAMABLE_HTTP_PATH) {
        res.statusCode = 404;
        res.end();
        return;
      }
      handler.handleHttpRequest(req, res).catch((error: unknown) => {
        res.statusCode = 500;
        res.end(error instanceof Error ? error.message : String(error));
      });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

function rawHttpRequest(options: {
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

describe("McpHttpHandler (Streamable HTTP)", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    vi.useRealTimers();
    while (closers.length > 0) {
      const close = closers.pop();
      if (close) {
        await close();
      }
    }
  });

  it("unterstützt den lokalen Dev-Modus ohne SessionID inkl. DNS-Rebinding-Schutz und Bild-Antworten", async () => {
    const invokeTool = vi.fn(async (method: string, params: unknown) => {
      if (method === "get_circuit_image") {
        return {
          data: "BASE64PNG",
          mimeType: "image/png",
          description: "Viewport-Screenshot",
        };
      }
      if (method === "step_simulation") {
        return {
          stepsExecuted: 4,
          screenshot: {
            data: "SIMPNG",
            mimeType: "image/png",
            description: "Nach 4 Schritten",
          },
        };
      }
      if (method === "delete_circuits") {
        throw new Error("Schaltung wird noch referenziert.");
      }
      return { method, params, ok: true };
    });

    const handler = new McpHttpHandler({
      requiresRemoteSession: false,
      enforceLocalhostOnly: true,
      serverLabel: "Logic Circuit Web (Dev)",
      invokeTool,
    });

    const { baseUrl, close } = await startHandlerServer(handler);
    closers.push(close);
    const port = Number(new URL(baseUrl).port);

    // DNS-Rebinding-Schutz: fremder Host-Header und fremder Origin werden abgewiesen, fehlendes Origin erlaubt
    const badHost = await rawHttpRequest({
      port,
      method: "POST",
      path: MCP_STREAMABLE_HTTP_PATH,
      headers: {
        Host: "evil.example:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(badHost.status).toBe(403);

    const badOrigin = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(badOrigin.status).toBe(403);

    // initialize mit lokalem Origin
    const initRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      }),
    });
    expect(initRes.status).toBe(200);
    const mcpSessionId = initRes.headers.get("mcp-session-id") ?? "";
    expect(mcpSessionId.length).toBeGreaterThanOrEqual(16);
    const initBody = (await initRes.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(initBody.result.protocolVersion).toBe("2025-06-18");
    expect(initBody.result.serverInfo.name).toBe("logic-circuit");

    // Notification -> 202 Accepted
    const notifRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(notifRes.status).toBe(202);
    expect(await notifRes.text()).toBe("");

    // ping & tools/list (ohne set_remote_session im lokalen Modus)
    const pingRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    });
    expect(pingRes.status).toBe(200);
    expect(await pingRes.json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });

    const listRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    const listJson = (await listRes.json()) as { result: { tools: Array<{ name: string }> } };
    const toolNames = listJson.result.tools.map((t) => t.name);
    expect(toolNames).not.toContain("set_remote_session");
    expect(toolNames).toContain("get_circuit_summary");

    // Standard-JSON-Tool
    const sumRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_circuit_summary", arguments: {} },
      }),
    });
    const sumJson = (await sumRes.json()) as { result: { content: Array<{ type: string; text: string }> } };
    expect(JSON.parse(sumJson.result.content[0].text)).toEqual({
      method: "get_circuit_summary",
      params: {},
      ok: true,
    });

    // Direktes Bild-Ergebnis
    const imgRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get_circuit_image", arguments: { mode: "viewport" } },
      }),
    });
    const imgJson = (await imgRes.json()) as {
      result: { content: Array<{ type: string; data?: string; mimeType?: string; text?: string }> };
    };
    expect(imgJson.result.content).toEqual([
      { type: "image", data: "BASE64PNG", mimeType: "image/png" },
      { type: "text", text: "Viewport-Screenshot" },
    ]);

    // Kombiniertes Ergebnis mit screenshot
    const simRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "step_simulation", arguments: { steps: 4, includeScreenshot: true } },
      }),
    });
    const simJson = (await simRes.json()) as {
      result: { content: Array<{ type: string; data?: string; mimeType?: string; text?: string }> };
    };
    expect(simJson.result.content[0].type).toBe("text");
    expect(JSON.parse(simJson.result.content[0].text ?? "")).toEqual({ stepsExecuted: 4 });
    expect(simJson.result.content[1]).toEqual({ type: "image", data: "SIMPNG", mimeType: "image/png" });
    expect(simJson.result.content[2]).toEqual({ type: "text", text: "Nach 4 Schritten" });

    // Tool-Fehler als isError: true
    const errRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "delete_circuits", arguments: { circuitIds: ["c1"] } },
      }),
    });
    const errJson = (await errRes.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(errJson.result.isError).toBe(true);
    expect(errJson.result.content[0].text).toContain("referenziert");
  });

  it("isoliert parallele Remote-MCP-Sessions, prüft TTL sowie DELETE /mcp und Query-/Header-SessionIDs", async () => {
    const invokeTool = vi.fn(async (method: string, _params: unknown, browserSessionId?: string) => ({
      method,
      browserSessionId,
    }));

    const handler = new McpHttpHandler({
      requiresRemoteSession: true,
      httpSessionTtlMs: 5000,
      invokeTool,
    });

    const { baseUrl, close } = await startHandlerServer(handler);
    closers.push(close);
    const endpoint = `${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`;

    const callPost = async (body: unknown, headers: Record<string, string> = {}, query = "") => {
      const res = await fetch(`${endpoint}${query}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });
      return {
        status: res.status,
        sessionId: res.headers.get("mcp-session-id"),
        json: (await res.json()) as Record<string, unknown>,
      };
    };

    const initA = await callPost({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const initB = await callPost({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const mcpA = initA.sessionId as string;
    const mcpB = initB.sessionId as string;
    expect(mcpA).not.toBe(mcpB);
    expect(handler.activeHttpSessionCount).toBe(2);

    await callPost(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "set_remote_session", arguments: { sessionId: "aaaa-bbbb-cccc-1111" } } },
      { "Mcp-Session-Id": mcpA },
    );
    await callPost(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "set_remote_session", arguments: { sessionId: "zzzz-yyyy-xxxx-2222" } } },
      { "Mcp-Session-Id": mcpB },
    );

    const callA = await callPost(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_circuit_summary", arguments: {} } },
      { "Mcp-Session-Id": mcpA },
    );
    const callB = await callPost(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_circuit_summary", arguments: {} } },
      { "Mcp-Session-Id": mcpB },
    );
    expect(JSON.parse(((callA.json.result as { content: Array<{ text: string }> }).content[0]).text).browserSessionId).toBe(
      "aaaa-bbbb-cccc-1111",
    );
    expect(JSON.parse(((callB.json.result as { content: Array<{ text: string }> }).content[0]).text).browserSessionId).toBe(
      "zzzz-yyyy-xxxx-2222",
    );

    // Header-/Query-Übergabe ohne set_remote_session
    const headerSessionCall = await callPost(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_circuit_summary", arguments: {} } },
      { "X-Logic-Circuit-Session": "hdr1-hdr2-hdr3-4444" },
    );
    expect(
      JSON.parse(((headerSessionCall.json.result as { content: Array<{ text: string }> }).content[0]).text).browserSessionId,
    ).toBe("hdr1-hdr2-hdr3-4444");

    const querySessionCall = await callPost(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_circuit_summary", arguments: {} } },
      {},
      "?session=qry1-qry2-qry3-5555",
    );
    expect(
      JSON.parse(((querySessionCall.json.result as { content: Array<{ text: string }> }).content[0]).text).browserSessionId,
    ).toBe("qry1-qry2-qry3-5555");

    // DELETE beendet Session A -> danach 404
    const delRes = await fetch(endpoint, {
      method: "DELETE",
      headers: { "Mcp-Session-Id": mcpA },
    });
    expect(delRes.status).toBe(204);

    const afterDelete = await callPost(
      { jsonrpc: "2.0", id: 6, method: "ping" },
      { "Mcp-Session-Id": mcpA },
    );
    expect(afterDelete.status).toBe(404);

    // Session B läuft nach TTL ab
    vi.useFakeTimers();
    vi.advanceTimersByTime(6000);
    expect(handler.activeHttpSessionCount).toBe(0);
    const expiredRes = await callPost(
      { jsonrpc: "2.0", id: 7, method: "ping" },
      { "Mcp-Session-Id": mcpB },
    );
    expect(expiredRes.status).toBe(404);
  });

  it("lehnt ungültige HTTP-Methoden, Header, JSON-Bodies und unbekannte Werkzeuge sauber ab", async () => {
    const handler = new McpHttpHandler({
      requiresRemoteSession: false,
      maxBodyBytes: 128,
      invokeTool: async () => ({}),
    });

    const { baseUrl, close } = await startHandlerServer(handler);
    closers.push(close);
    const endpoint = `${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`;

    const getRes = await fetch(endpoint, { method: "GET" });
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get("allow")).toContain("POST");

    const wrongCt = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    expect(wrongCt.status).toBe(415);

    const wrongAccept = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/html" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(wrongAccept.status).toBe(406);

    const wrongVersion = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "1999-01-01" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(wrongVersion.status).toBe(400);

    const badJson = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ungueltig",
    });
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as { error: { code: number } }).error.code).toBe(-32700);

    const tooLarge = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", padding: "x".repeat(256) }),
    });
    expect(tooLarge.status).toBe(413);

    const unknownTool = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "gibts_nicht" } }),
    });
    expect(unknownTool.status).toBe(200);
    expect(((await unknownTool.json()) as { error: { code: number } }).error.code).toBe(-32602);

    const unknownMethod = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/list" }),
    });
    expect(unknownMethod.status).toBe(200);
    expect(((await unknownMethod.json()) as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("verdrahtet vitePluginMcp auf /mcp (ohne /__mcp/call) und schützt vor DNS-Rebinding", async () => {
    type WsListener = (data: unknown, client: { send: (event: string, payload?: unknown) => void }) => void;
    const middlewares: Array<{
      base: string;
      fn: (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void;
    }> = [];
    const wsHandlers = new Map<string, WsListener>();

    const plugin = vitePluginMcp();
    const configureServer = plugin.configureServer as (server: ViteDevServer) => void;
    configureServer({
      ws: {
        on(event: string, listener: WsListener) {
          wsHandlers.set(event, listener);
        },
      },
      middlewares: {
        use(base: string, fn: (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) {
          middlewares.push({ base, fn });
        },
      },
    } as unknown as ViteDevServer);

    const server = http.createServer((req, res) => {
      const fullPath = req.url ?? "/";
      const match = middlewares.find((m) => fullPath === m.base || fullPath.startsWith(`${m.base}/`) || fullPath.startsWith(`${m.base}?`));
      if (!match) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const stripped = fullPath.slice(match.base.length) || "/";
      req.url = stripped;
      match.fn(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    );

    const port = (server.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Simulierten HMR-Browser-Client anmelden
    wsHandlers.get(MCP_EVENT_HELLO)?.({}, { send: () => undefined });

    const statusRes = await fetch(`${baseUrl}${MCP_HTTP_BASE_PATH}/status`);
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toEqual({ connected: true, clients: 1 });

    // /__mcp/call gibt 404 zurück (nicht mehr registriert)
    const legacyRes = await fetch(`${baseUrl}${MCP_HTTP_BASE_PATH}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "get_circuit_summary" }),
    });
    expect(legacyRes.status).toBe(404);

    // /mcp antwortet auf initialize
    const initRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(initRes.status).toBe(200);
    expect(initRes.headers.get("mcp-session-id")).toBeTruthy();

    // Fremder Origin auf /mcp wird abgewiesen
    const evilRes = await fetch(`${baseUrl}${MCP_STREAMABLE_HTTP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    });
    expect(evilRes.status).toBe(403);
  });
});
