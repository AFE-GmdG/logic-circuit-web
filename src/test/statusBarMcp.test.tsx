import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";
import type { McpBridgeController } from "../hooks/useMcpBridge";

import {
  buildRemoteChatPrompt,
  buildRemoteMcpConfigJson,
  clearMcpAccessKey,
  loadMcpAccessKey,
  saveMcpAccessKey,
} from "../utils/mcpStorage";

import StatusBar from "../components/statusBar";
import McpRemotePopover from "../components/statusBar/mcpRemotePopover";

function createController(overrides: Partial<McpBridgeController> = {}): McpBridgeController {
  return {
    status: "remote-off",
    mode: "remote",
    sessionId: null,
    tabId: "tab-1",
    connectedTabCount: 1,
    error: null,
    isSharedWorkerSupported: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    activateThisTab: vi.fn(),
    ...overrides,
  };
}

function renderStatusBarWithMcp(controller: McpBridgeController, initialPopoverOpen = false): string {
  return renderToStaticMarkup(
    <CircuitContextProvider>
      <SimulationContextProvider>
        <CanvasContextProvider>
          <StatusBar
            mcpControllerOverride={controller}
            initialPopoverOpen={initialPopoverOpen}
          />
        </CanvasContextProvider>
      </SimulationContextProvider>
    </CircuitContextProvider>,
  );
}

describe("mcpStorage & Prompt/Config-Generatoren", () => {
  it("erzeugt den Chat-Prompt und die statische mcp_config.json ohne feste SessionID", () => {
    expect(buildRemoteChatPrompt("xxyy-aabb-1234-qwer")).toBe(
      "Nutze für Logic Circuit Anfragen folgende SessionID: xxyy-aabb-1234-qwer",
    );

    const configNoKey = JSON.parse(buildRemoteMcpConfigJson("https://circuit.example.com", false)) as {
      mcpServers: { "logic-circuit-remote": { env: Record<string, string> } };
    };
    expect(configNoKey.mcpServers["logic-circuit-remote"].env).toEqual({
      LOGIC_CIRCUIT_URL: "https://circuit.example.com",
    });

    const configWithKey = JSON.parse(buildRemoteMcpConfigJson("https://circuit.example.com", true)) as {
      mcpServers: { "logic-circuit-remote": { env: Record<string, string> } };
    };
    expect(configWithKey.mcpServers["logic-circuit-remote"].env).toEqual({
      LOGIC_CIRCUIT_URL: "https://circuit.example.com",
      LOGIC_CIRCUIT_TOKEN: "<dein-access-key>",
    });
    expect(configWithKey.mcpServers["logic-circuit-remote"].env.LOGIC_CIRCUIT_SESSION).toBeUndefined();
  });

  it("liest, speichert und löscht den Access-Key robust in localStorage", () => {
    const store = new Map<string, string>();
    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
      },
    };

    try {
      expect(loadMcpAccessKey()).toBe("");
      saveMcpAccessKey("  mein-key  ");
      expect(loadMcpAccessKey()).toBe("mein-key");
      clearMcpAccessKey();
      expect(loadMcpAccessKey()).toBe("");
    } finally {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  });
});

describe("StatusBar MCP-Anzeige & McpRemotePopover", () => {
  it("zeigt im lokalen Dev-Modus 'MCP (Lokal)' ohne Remote-Popover", () => {
    const html = renderStatusBarWithMcp(
      createController({
        mode: "local",
        status: "local-connected",
      }),
    );

    expect(html).toContain("MCP (Lokal)");
    expect(html).toContain("data-mcp-status=\"local-connected\"");
    expect(html).not.toContain("class=\"mcp-remote-button");
    expect(html).not.toContain("data-component=\"McpRemotePopover\"");
  });

  it("zeigt alle Remote-MCP-Zustände und den Chat-Prompt im geöffneten Popover korrekt an", () => {
    expect(renderStatusBarWithMcp(createController({ status: "remote-off" }))).toContain("MCP: Aus");
    expect(renderStatusBarWithMcp(createController({ status: "remote-connecting" }))).toContain("MCP: Verbindet…");
    expect(renderStatusBarWithMcp(createController({ status: "remote-active-self" }))).toContain(
      "MCP: Aktiv (dieser Tab)",
    );
    expect(renderStatusBarWithMcp(createController({ status: "remote-active-other" }))).toContain(
      "MCP: Anderer Tab",
    );
    expect(renderStatusBarWithMcp(createController({ status: "remote-error" }))).toContain("MCP: Fehler");

    const activeSelfHtml = renderStatusBarWithMcp(
      createController({
        status: "remote-active-self",
        sessionId: "xxyy-aabb-1234-qwer",
        connectedTabCount: 3,
      }),
      true,
    );

    expect(activeSelfHtml).toContain("data-component=\"McpRemotePopover\"");
    expect(activeSelfHtml).toContain("Nutze für Logic Circuit Anfragen folgende SessionID: xxyy-aabb-1234-qwer");
    expect(activeSelfHtml).toContain("3 Tabs (SharedWorker)");
    expect(activeSelfHtml).toContain("Trennen");
    expect(activeSelfHtml).toContain("Keine Anmeldung, keine Cookies, keine Server-Persistenz");
    expect(activeSelfHtml).not.toContain("Diesen Tab für MCP aktivieren");

    const activeOtherHtml = renderToStaticMarkup(
      <McpRemotePopover
        isOpen
        status="remote-active-other"
        sessionId="xxyy-aabb-1234-qwer"
        connectedTabCount={2}
        error="Test-Warnung"
        isSharedWorkerSupported
        accessKey="geheim"
        onAccessKeyChange={vi.fn()}
        onClearAccessKey={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivateThisTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(activeOtherHtml).toContain("Diesen Tab für MCP aktivieren");
    expect(activeOtherHtml).toContain("Test-Warnung");

    const disconnectedWithKeyHtml = renderToStaticMarkup(
      <McpRemotePopover
        isOpen
        status="remote-off"
        sessionId={null}
        connectedTabCount={1}
        error={null}
        isSharedWorkerSupported
        accessKey="geheim"
        onAccessKeyChange={vi.fn()}
        onClearAccessKey={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivateThisTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(disconnectedWithKeyHtml).toContain("Löschen");
    expect(disconnectedWithKeyHtml).toContain("Verbinden");
  });

  it("blendet im MCP-freien Build (mode: 'disabled') sämtliche MCP-Statusleisten-Elemente und Popovers aus", () => {
    const disabledHtml = renderStatusBarWithMcp(
      createController({
        mode: "disabled",
        status: "remote-off",
      }),
      true,
    );

    expect(disabledHtml).toContain("data-component=\"StatusBar\"");
    expect(disabledHtml).not.toContain("class=\"mcp-indicator");
    expect(disabledHtml).not.toContain("class=\"mcp-remote-button");
    expect(disabledHtml).not.toContain("data-mcp-status=");
    expect(disabledHtml).not.toContain("data-component=\"McpRemotePopover\"");
    expect(disabledHtml).not.toContain("MCP (Lokal)");
    expect(disabledHtml).not.toContain("MCP: Aus");
  });
});
