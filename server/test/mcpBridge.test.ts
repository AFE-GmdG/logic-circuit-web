import { afterEach, describe, expect, it, vi } from "vitest";

import type McpBridgeRequest from "../../src/types/mcp/mcpBridgeRequest.ts";

import { MCP_EVENT_ACK, MCP_EVENT_REQUEST } from "../../src/mcp/mcpEvents.ts";

import McpBridge, { NoBrowserSessionError } from "../mcpBridge.ts";

type SentMessage = {
  event: string;
  payload?: unknown;
};

function createFakeClient() {
  const sent: SentMessage[] = [];
  return {
    sent,
    send: (event: string, payload?: unknown) => {
      sent.push({ event, payload });
    },
    lastRequest: (): McpBridgeRequest => {
      const requests = sent.filter((m) => m.event === MCP_EVENT_REQUEST);
      return requests[requests.length - 1].payload as McpBridgeRequest;
    },
  };
}

describe("McpBridge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lehnt Aufrufe ohne angemeldete Browsersitzung ab", async () => {
    const bridge = new McpBridge();
    expect(bridge.isConnected).toBe(false);
    await expect(bridge.call("get_circuit_summary")).rejects.toBeInstanceOf(NoBrowserSessionError);
  });

  it("bestätigt die Anmeldung und ordnet Antworten per ID zu", async () => {
    const bridge = new McpBridge();
    const client = createFakeClient();
    bridge.registerClient(client);

    expect(client.sent[0].event).toBe(MCP_EVENT_ACK);
    expect(bridge.isConnected).toBe(true);

    const first = bridge.call("get_circuit_summary", {});
    const firstRequest = client.lastRequest();
    const second = bridge.call("get_circuit_details", { circuitId: "x" });
    const secondRequest = client.lastRequest();

    expect(firstRequest.id).not.toBe(secondRequest.id);
    expect(secondRequest.method).toBe("get_circuit_details");
    expect(secondRequest.params).toEqual({ circuitId: "x" });

    // Antworten in umgekehrter Reihenfolge
    bridge.handleResponse({ id: secondRequest.id, result: "zwei" });
    bridge.handleResponse({ id: firstRequest.id, result: "eins" });

    await expect(first).resolves.toBe("eins");
    await expect(second).resolves.toBe("zwei");
    expect(bridge.pendingCount).toBe(0);
  });

  it("reicht Fehlermeldungen des Browsers als Rejection weiter", async () => {
    const bridge = new McpBridge();
    const client = createFakeClient();
    bridge.registerClient(client);

    const pending = bridge.call("does_not_exist");
    bridge.handleResponse({ id: client.lastRequest().id, error: "Unbekanntes MCP-Werkzeug" });

    await expect(pending).rejects.toThrow("Unbekanntes MCP-Werkzeug");
  });

  it("ignoriert unbekannte oder fehlerhafte Antworten", () => {
    const bridge = new McpBridge();
    expect(() => bridge.handleResponse({ id: "999", result: 1 })).not.toThrow();
    expect(() => bridge.handleResponse(undefined as never)).not.toThrow();
  });

  it("bricht nach Zeitüberschreitung ab", async () => {
    vi.useFakeTimers();
    const bridge = new McpBridge(1000);
    bridge.registerClient(createFakeClient());

    const pending = bridge.call("get_circuit_summary");
    const assertion = expect(pending).rejects.toThrow(/Zeitüberschreitung/);
    vi.advanceTimersByTime(1001);

    await assertion;
    expect(bridge.pendingCount).toBe(0);
  });

  it("verwendet die zuletzt angemeldete Sitzung und fällt nach Abmeldung zurück", async () => {
    const bridge = new McpBridge();
    const older = createFakeClient();
    const newer = createFakeClient();
    bridge.registerClient(older);
    bridge.registerClient(newer);
    expect(bridge.clientCount).toBe(2);

    const toNewer = bridge.call("get_circuit_summary");
    bridge.handleResponse({ id: newer.lastRequest().id, result: "neu" });
    await expect(toNewer).resolves.toBe("neu");

    bridge.unregisterClient(newer);
    const toOlder = bridge.call("get_circuit_summary");
    bridge.handleResponse({ id: older.lastRequest().id, result: "alt" });
    await expect(toOlder).resolves.toBe("alt");

    bridge.unregisterClient(older);
    expect(bridge.isConnected).toBe(false);
  });

  it("meldet eine Sitzung bei erneutem Hello nicht doppelt an", () => {
    const bridge = new McpBridge();
    const client = createFakeClient();
    bridge.registerClient(client);
    bridge.registerClient(client);
    expect(bridge.clientCount).toBe(1);
  });
});
