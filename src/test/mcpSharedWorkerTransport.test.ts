import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import CollabContext, { type CollabContextType } from "../contexts/collabContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";
import useMcpBridge, {
  guardMcpRequestForCollab,
  isMcpDisabledByEnv,
  MCP_COLLAB_HOST_ONLY_ERROR,
  type McpBridgeController,
  type McpHotChannel,
  syncMcpCollabLock,
} from "../hooks/useMcpBridge";

import type McpBridgeRequest from "../types/mcp/mcpBridgeRequest";
import type McpBridgeResponse from "../types/mcp/mcpBridgeResponse";
import type McpRemoteSharedState from "../types/mcp/mcpRemoteSharedState";
import type McpWorkerCommand from "../types/mcp/mcpWorkerCommand";
import type McpWorkerEvent from "../types/mcp/mcpWorkerEvent";

import {
  MCP_EVENT_ACK,
  MCP_EVENT_BYE,
  MCP_EVENT_ERROR,
  MCP_EVENT_HELLO,
  MCP_EVENT_PING,
  MCP_EVENT_REQUEST,
  MCP_EVENT_RESPONSE,
} from "../mcp/mcpEvents";
import McpRemoteClient, { mapRemoteStateToBridgeStatus, resolveRemoteWsUrl } from "../mcp/mcpRemoteClient";
import McpRemoteRouter, { type McpRemoteSocket, type McpSocketFactory, type McpTabPort } from "../mcp/mcpRemoteRouter";

function createFakeSocketHarness(): {
  socketFactory: McpSocketFactory;
  getSocketCount: () => number;
  openLatest: () => void;
  sendFromServer: (event: string, payload?: unknown) => void;
  closeLatest: (code: number, reason?: string) => void;
  getSentEnvelopes: () => Array<{ event: string; payload: unknown }>;
} {
  const sentEnvelopes: Array<{ event: string; payload: unknown }> = [];
  let socketCount = 0;
  let activeCallbacks: {
    onOpen: () => void;
    onMessage: (raw: string) => void;
    onClose: (code: number, reason: string) => void;
  } | null = null;

  const socketFactory: McpSocketFactory = (callbacks): McpRemoteSocket => {
    socketCount += 1;
    activeCallbacks = callbacks;
    return {
      send(text) {
        sentEnvelopes.push(JSON.parse(text) as { event: string; payload: unknown });
      },
      close(code = 1000, reason = "") {
        callbacks.onClose(code, reason);
      },
    };
  };

  return {
    socketFactory,
    getSocketCount: () => socketCount,
    openLatest: () => activeCallbacks?.onOpen(),
    sendFromServer: (event, payload) => activeCallbacks?.onMessage(JSON.stringify({ event, payload })),
    closeLatest: (code, reason = "") => activeCallbacks?.onClose(code, reason),
    getSentEnvelopes: () => sentEnvelopes,
  };
}

function createFakeTabPort(): {
  port: McpTabPort;
  events: McpWorkerEvent[];
  requests: McpBridgeRequest[];
  latestState: () => McpRemoteSharedState | undefined;
} {
  const events: McpWorkerEvent[] = [];
  const requests: McpBridgeRequest[] = [];
  return {
    port: {
      postMessage(event) {
        events.push(event);
        if (event.type === "execute-request") {
          requests.push(event.request);
        }
      },
    },
    events,
    requests,
    latestState: () => {
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const entry = events[i];
        if (entry.type === "state") {
          return entry.state;
        }
      }
      return undefined;
    },
  };
}

function createFakeSharedWorkerFactory(router: McpRemoteRouter): () => SharedWorker {
  return () => {
    let tabId: string | null = null;
    const port: {
      onmessage: ((event: MessageEvent<McpWorkerEvent>) => void) | null;
      start: () => void;
      close: () => void;
      postMessage: (command: McpWorkerCommand) => void;
    } = {
      onmessage: null,
      start() {},
      close() {},
      postMessage(command) {
        if (command.type === "register-tab") {
          tabId = command.tabId;
        }
        router.handleCommand(command, {
          postMessage(event) {
            port.onmessage?.({ data: event } as MessageEvent<McpWorkerEvent>);
          },
        });
        if (command.type === "unregister-tab") {
          tabId = null;
        }
      },
    };
    void tabId;
    return {
      port: port as unknown as MessagePort,
      onerror: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    } as unknown as SharedWorker;
  };
}

describe("McpRemoteRouter (Multi-Tab-Koordination & Reconnect)", () => {
  it("hält genau eine WebSocket-Verbindung für mehrere Tabs und routet nur an den aktiven Tab", () => {
    const harness = createFakeSocketHarness();
    const router = new McpRemoteRouter({
      socketFactory: harness.socketFactory,
      heartbeatIntervalMs: 0,
    });

    const tab1 = createFakeTabPort();
    const tab2 = createFakeTabPort();

    router.registerTab("tab-1", tab1.port);
    router.registerTab("tab-2", tab2.port);
    expect(tab1.latestState()?.connectedTabCount).toBe(2);
    expect(tab1.latestState()?.connectionState).toBe("off");

    // Tab 1 aktiviert die Remote-Verbindung
    router.connect("tab-1", "mein-key");
    expect(harness.getSocketCount()).toBe(1);
    expect(tab1.latestState()?.connectionState).toBe("connecting");

    harness.openLatest();
    expect(harness.getSentEnvelopes()[0]).toEqual({
      event: MCP_EVENT_HELLO,
      payload: { accessKey: "mein-key" },
    });

    harness.sendFromServer(MCP_EVENT_ACK, {
      sessionId: "xxyy-aabb-1234-qwer",
      reconnectToken: "tok-1",
    });

    expect(tab1.latestState()?.connectionState).toBe("connected");
    expect(tab1.latestState()?.activeTabId).toBe("tab-1");
    expect(tab2.latestState()?.activeTabId).toBe("tab-1");
    expect(harness.getSocketCount()).toBe(1);

    // Request geht ausschließlich an Tab 1
    harness.sendFromServer(MCP_EVENT_REQUEST, { id: "1", method: "get_circuit_summary", params: {} });
    expect(tab1.requests).toHaveLength(1);
    expect(tab2.requests).toHaveLength(0);

    router.forwardToolResponse({ id: "1", result: { tab: 1 } });
    expect(harness.getSentEnvelopes().at(-1)).toEqual({
      event: MCP_EVENT_RESPONSE,
      payload: { id: "1", result: { tab: 1 } },
    });

    // Nutzer übernimmt MCP in Tab 2
    router.claimActiveTab("tab-2");
    expect(tab1.latestState()?.activeTabId).toBe("tab-2");
    expect(tab2.latestState()?.activeTabId).toBe("tab-2");

    harness.sendFromServer(MCP_EVENT_REQUEST, { id: "2", method: "get_circuit_details", params: {} });
    expect(tab1.requests).toHaveLength(1);
    expect(tab2.requests).toHaveLength(1);

    // Schließt der aktive Tab 2 während eines offenen Requests, wird sofort eine Fehlerantwort gesendet
    router.unregisterTab("tab-2");
    expect(harness.getSentEnvelopes().at(-1)).toEqual({
      event: MCP_EVENT_RESPONSE,
      payload: {
        id: "2",
        error: "Der aktive Browser-Tab wurde geschlossen, bevor der Werkzeugaufruf abgeschlossen war.",
      },
    });
    expect(tab1.latestState()?.activeTabId).toBeNull();
    expect(tab1.latestState()?.connectedTabCount).toBe(1);

    // Schließt auch der letzte Tab, sendet der Router sauber BYE
    router.unregisterTab("tab-1");
    expect(harness.getSentEnvelopes().some((entry) => entry.event === MCP_EVENT_BYE)).toBe(true);
  });

  it("verbindet bei Netzabbruch per Exponential Backoff neu, stoppt aber bei 4001 Unauthorized", () => {
    vi.useFakeTimers();
    try {
      const harness = createFakeSocketHarness();
      const router = new McpRemoteRouter({
        socketFactory: harness.socketFactory,
        heartbeatIntervalMs: 1000,
        baseReconnectDelayMs: 500,
        maxReconnectDelayMs: 4000,
      });

      const tab1 = createFakeTabPort();
      router.registerTab("tab-1", tab1.port);
      router.connect("tab-1", "key-1");
      harness.openLatest();
      harness.sendFromServer(MCP_EVENT_ACK, {
        sessionId: "aaaa-bbbb-cccc-dddd",
        reconnectToken: "tok-reconnect",
      });

      // Heartbeat-Ping prüfen
      vi.advanceTimersByTime(1000);
      expect(harness.getSentEnvelopes().some((e) => e.event === MCP_EVENT_PING)).toBe(true);

      // Unerwarteter Abbruch -> Reconnect mit gleichem Session- und Reconnect-Token
      harness.closeLatest(1006, "Abnormal Closure");
      expect(tab1.latestState()?.connectionState).toBe("connecting");
      expect(harness.getSocketCount()).toBe(1);

      vi.advanceTimersByTime(500);
      expect(harness.getSocketCount()).toBe(2);
      harness.openLatest();
      expect(harness.getSentEnvelopes().at(-1)).toEqual({
        event: MCP_EVENT_HELLO,
        payload: {
          sessionId: "aaaa-bbbb-cccc-dddd",
          reconnectToken: "tok-reconnect",
          accessKey: "key-1",
        },
      });

      // 4001 Unauthorized darf keinen endlosen Reconnect auslösen
      harness.sendFromServer(MCP_EVENT_ERROR, { error: "Falscher Key" });
      harness.closeLatest(4001, "Unauthorized");
      expect(tab1.latestState()?.connectionState).toBe("error");
      expect(tab1.latestState()?.error).toBe("Falscher Key");

      vi.advanceTimersByTime(10000);
      expect(harness.getSocketCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("McpRemoteClient (SharedWorker & Single-Tab-Fallback)", () => {
  it("koordiniert zwei Clients über gemeinsamen SharedWorker und fällt ohne SharedWorker auf Single-Tab zurück", () => {
    expect(resolveRemoteWsUrl({ protocol: "https:", host: "circuit.example.com" })).toBe(
      "wss://circuit.example.com/ws-mcp",
    );
    expect(resolveRemoteWsUrl({ protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws-mcp");
    expect(resolveRemoteWsUrl("http://localhost:3001/")).toBe("ws://localhost:3001/ws-mcp");
    expect(resolveRemoteWsUrl("https://sidecar.example.com")).toBe("wss://sidecar.example.com/ws-mcp");

    const seenWsUrls: Array<string | undefined> = [];
    const customRouter = new McpRemoteRouter({
      resolveWsUrl: (sidecarBaseUrl) => resolveRemoteWsUrl(sidecarBaseUrl ?? "http://localhost:3001"),
      socketFactory: (callbacks) => {
        seenWsUrls.push(callbacks.wsUrl);
        return createFakeSocketHarness().socketFactory(callbacks);
      },
      heartbeatIntervalMs: 0,
    });
    const customTab = createFakeTabPort();
    customRouter.registerTab("tab-custom", customTab.port);
    customRouter.connect("tab-custom", "k1", "http://localhost:3001");
    expect(seenWsUrls[0]).toBe("ws://localhost:3001/ws-mcp");
    expect(customTab.latestState()?.sidecarBaseUrl).toBe("http://localhost:3001");

    // Wechsel der Sidecar-URL öffnet neue WebSocket-Verbindung gegen das neue Ziel
    customRouter.connect("tab-custom", "k1", "https://sidecar.example.com");
    expect(seenWsUrls[1]).toBe("wss://sidecar.example.com/ws-mcp");
    expect(customTab.latestState()?.sidecarBaseUrl).toBe("https://sidecar.example.com");
    customRouter.disconnect();

    const sharedHarness = createFakeSocketHarness();
    const sharedRouter = new McpRemoteRouter({
      socketFactory: sharedHarness.socketFactory,
      heartbeatIntervalMs: 0,
    });
    const workerFactory = createFakeSharedWorkerFactory(sharedRouter);

    const clientA = new McpRemoteClient({ tabId: "tab-a", useSharedWorker: true, workerFactory });
    const clientB = new McpRemoteClient({ tabId: "tab-b", useSharedWorker: true, workerFactory });

    const reqA: McpBridgeRequest[] = [];
    const reqB: McpBridgeRequest[] = [];
    clientA.onRequest((req) => reqA.push(req));
    clientB.onRequest((req) => reqB.push(req));

    clientA.connect();
    sharedHarness.openLatest();
    sharedHarness.sendFromServer(MCP_EVENT_ACK, { sessionId: "1111-2222-3333-4444", reconnectToken: "t1" });

    expect(mapRemoteStateToBridgeStatus(clientA.state, clientA.tabId)).toBe("remote-active-self");
    expect(mapRemoteStateToBridgeStatus(clientB.state, clientB.tabId)).toBe("remote-active-other");

    clientB.claimActiveTab();
    expect(mapRemoteStateToBridgeStatus(clientA.state, clientA.tabId)).toBe("remote-active-other");
    expect(mapRemoteStateToBridgeStatus(clientB.state, clientB.tabId)).toBe("remote-active-self");

    sharedHarness.sendFromServer(MCP_EVENT_REQUEST, { id: "10", method: "get_circuit_summary", params: {} });
    expect(reqA).toHaveLength(0);
    expect(reqB).toHaveLength(1);

    const response: McpBridgeResponse = { id: "10", result: { ok: true } };
    clientB.sendResponse(response);
    expect(sharedHarness.getSentEnvelopes().at(-1)).toEqual({
      event: MCP_EVENT_RESPONSE,
      payload: response,
    });

    clientA.dispose();
    clientB.dispose();

    // Fallback ohne SharedWorker
    const fallbackHarness = createFakeSocketHarness();
    const fallbackClient = new McpRemoteClient({
      tabId: "fallback-tab",
      useSharedWorker: false,
      socketFactory: fallbackHarness.socketFactory,
    });
    expect(fallbackClient.isSharedWorkerSupported).toBe(false);
    fallbackClient.connect();
    fallbackHarness.openLatest();
    fallbackHarness.sendFromServer(MCP_EVENT_ACK, { sessionId: "5555-6666-7777-8888", reconnectToken: "t2" });
    expect(mapRemoteStateToBridgeStatus(fallbackClient.state, fallbackClient.tabId)).toBe("remote-active-self");
    fallbackClient.dispose();
  });
});

describe("useMcpBridge (Vorrang für lokales Development)", () => {
  it("wählt bei vorhandenem HMR-Kanal zwingend den lokalen Modus und ohne HMR den Remote-Modus", () => {
    const fakeHot: McpHotChannel = {
      send: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const remoteFactory = vi.fn(() => new McpRemoteClient({ useSharedWorker: false }));

    let localController: McpBridgeController | null = null;
    let remoteController: McpBridgeController | null = null;

    const Probe: React.FC<{
      hotOverride: McpHotChannel | null;
      onResult: (ctrl: McpBridgeController) => void;
    }> = ({ hotOverride, onResult }) => {
      onResult(useMcpBridge({ hotOverride, remoteClientFactory: remoteFactory }));
      return null;
    };

    renderToStaticMarkup(
      React.createElement(
        CircuitContextProvider,
        null,
        React.createElement(
          SimulationContextProvider,
          null,
          React.createElement(
            CanvasContextProvider,
            null,
            React.createElement(Probe, {
              hotOverride: fakeHot,
              onResult: (ctrl) => { localController = ctrl; },
            }),
          ),
        ),
      ),
    );

    expect(localController!.mode).toBe("local");
    expect(localController!.status).toBe("local-connecting");
    expect(remoteFactory).not.toHaveBeenCalled();

    renderToStaticMarkup(
      React.createElement(
        CircuitContextProvider,
        null,
        React.createElement(
          SimulationContextProvider,
          null,
          React.createElement(
            CanvasContextProvider,
            null,
            React.createElement(Probe, {
              hotOverride: null,
              onResult: (ctrl) => { remoteController = ctrl; },
            }),
          ),
        ),
      ),
    );

    expect(remoteController!.mode).toBe("remote");
    expect(remoteController!.status).toBe("remote-off");

    // Im MCP-freien Modus (VITE_DISABLE_MCP / process.env.DISABLE_MCP) werden weder HMR noch Remote-Clients gestartet
    let disabledController: McpBridgeController | null = null;
    const DisabledProbe: React.FC = () => {
      disabledController = useMcpBridge({
        hotOverride: fakeHot,
        remoteClientFactory: remoteFactory,
        disabledOverride: true,
      });
      return null;
    };

    renderToStaticMarkup(
      React.createElement(
        CircuitContextProvider,
        null,
        React.createElement(
          SimulationContextProvider,
          null,
          React.createElement(
            CanvasContextProvider,
            null,
            React.createElement(DisabledProbe),
          ),
        ),
      ),
    );

    expect(disabledController!.mode).toBe("disabled");
    expect(disabledController!.status).toBe("remote-off");
    expect(disabledController!.sessionId).toBeNull();
    expect(disabledController!.tabId).toBeNull();
    expect(disabledController!.isSharedWorkerSupported).toBe(false);
    expect(remoteFactory).not.toHaveBeenCalled();

    const prevDisableEnv = process.env.DISABLE_MCP;
    try {
      process.env.DISABLE_MCP = "true";
      expect(isMcpDisabledByEnv()).toBe(true);
      process.env.DISABLE_MCP = "false";
      expect(isMcpDisabledByEnv()).toBe(false);
    } finally {
      if (prevDisableEnv === undefined) {
        delete process.env.DISABLE_MCP;
      } else {
        process.env.DISABLE_MCP = prevDisableEnv;
      }
    }
  });

  it("sperrt MCP deterministisch für Nicht-Hosts während aktiver Kollaboration und gibt es nach Host-Übernahme oder Session-Ende frei", () => {
    const blockedResponse = guardMcpRequestForCollab(true, {
      id: "req-1",
      method: "get_circuit_summary",
      params: {},
    });
    expect(blockedResponse).toEqual({
      id: "req-1",
      error: MCP_COLLAB_HOST_ONLY_ERROR,
    });
    expect(guardMcpRequestForCollab(false, {
      id: "req-2",
      method: "get_circuit_summary",
      params: {},
    })).toBeNull();

    const disconnectMock = vi.fn();
    expect(syncMcpCollabLock(true, { disconnect: disconnectMock }, "connected")).toBe(true);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(syncMcpCollabLock(true, { disconnect: disconnectMock }, "off")).toBe(false);
    expect(syncMcpCollabLock(false, { disconnect: disconnectMock }, "connected")).toBe(false);

    const createCollabStub = (isMcpBlockedByCollab: boolean): CollabContextType => ({
      isDisabled: false,
      customSidecarRequired: false,
      isInSession: true,
      transportState: "connected",
      diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
      gracePeriodMs: 15000,
      sessionId: "sess-1",
      selfPeerId: "peer-1",
      selfRole: isMcpBlockedByCollab ? "guest" : "host",
      hostPeerId: isMcpBlockedByCollab ? "peer-host" : "peer-1",
      isHost: !isMcpBlockedByCollab,
      isMcpBlockedByCollab,
      activeSidecarUrl: null,
      isEphemeralSidecar: false,
      runtimeConfig: null,
      displayName: "Tester",
      participants: [],
      selfParticipant: null,
      raisedHandCount: 0,
      activeInvites: [],
      pendingInviteLink: null,
      lastError: null,
      lastRejectionMessage: null,
      sessionClosedNotice: null,
      isParticipantsPanelOpen: false,
      startHostSession: async () => false,
      joinSession: async () => false,
      endOrLeaveSession: () => {},
      createInviteLink: async () => null,
      revokeInviteLink: async () => false,
      setParticipantRole: async () => false,
      moderateParticipantName: async () => false,
      renameSelf: async () => false,
      toggleHandRaised: async () => false,
      lowerParticipantHand: async () => false,
      kickParticipant: async () => false,
      transferHostRole: () => false,
      requestResync: async () => false,
      setParticipantsPanelOpen: () => {},
      clearPendingInviteLink: () => {},
      clearError: () => {},
      dismissSessionClosedNotice: () => {},
    });

    const remoteClient = new McpRemoteClient({ useSharedWorker: false });
    const connectSpy = vi.spyOn(remoteClient, "connect");
    const claimSpy = vi.spyOn(remoteClient, "claimActiveTab");

    let guestController: McpBridgeController | null = null;
    let hostController: McpBridgeController | null = null;

    const Probe: React.FC<{ onResult: (ctrl: McpBridgeController) => void }> = ({ onResult }) => {
      onResult(useMcpBridge({ hotOverride: null, remoteClientFactory: () => remoteClient }));
      return null;
    };

    renderToStaticMarkup(
      React.createElement(
        CircuitContextProvider,
        null,
        React.createElement(
          SimulationContextProvider,
          null,
          React.createElement(
            CanvasContextProvider,
            null,
            React.createElement(
              CollabContext.Provider,
              { value: createCollabStub(true) },
              React.createElement(Probe, { onResult: (ctrl) => { guestController = ctrl; } }),
            ),
          ),
        ),
      ),
    );

    expect(guestController!.isBlockedByCollab).toBe(true);
    expect(guestController!.error).toBe(MCP_COLLAB_HOST_ONLY_ERROR);
    guestController!.connect("key");
    guestController!.activateThisTab();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(claimSpy).not.toHaveBeenCalled();

    // Nach Host-Übernahme (oder Session-Ende) ist MCP wieder freigegeben
    renderToStaticMarkup(
      React.createElement(
        CircuitContextProvider,
        null,
        React.createElement(
          SimulationContextProvider,
          null,
          React.createElement(
            CanvasContextProvider,
            null,
            React.createElement(
              CollabContext.Provider,
              { value: createCollabStub(false) },
              React.createElement(Probe, { onResult: (ctrl) => { hostController = ctrl; } }),
            ),
          ),
        ),
      ),
    );

    expect(hostController!.isBlockedByCollab).toBe(false);
    expect(hostController!.error).toBeNull();
  });
});
