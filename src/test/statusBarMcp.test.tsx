import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";
import type { McpBridgeController } from "../hooks/useMcpBridge";

import {
  buildLocalMcpConfigJson,
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
  it("erzeugt den Chat-Prompt und die Streamable-HTTP-mcp_config.json ohne CLI oder feste SessionID", () => {
    expect(buildRemoteChatPrompt("xxyy-aabb-1234-qwer")).toBe(
      "Nutze für Logic Circuit Anfragen folgende SessionID: xxyy-aabb-1234-qwer",
    );

    const localConfig = JSON.parse(buildLocalMcpConfigJson(5173)) as {
      mcpServers: { "logic-circuit": { url: string; command?: string; headers?: Record<string, string> } };
    };
    expect(localConfig.mcpServers["logic-circuit"]).toEqual({
      url: "http://localhost:5173/mcp",
    });

    const configNoKey = JSON.parse(buildRemoteMcpConfigJson("https://circuit.example.com/", false)) as {
      mcpServers: { "logic-circuit": { url: string; command?: string; headers?: Record<string, string> } };
    };
    expect(configNoKey.mcpServers["logic-circuit"]).toEqual({
      url: "https://circuit.example.com/mcp",
    });
    expect(configNoKey.mcpServers["logic-circuit"].command).toBeUndefined();

    const configWithKey = JSON.parse(buildRemoteMcpConfigJson("https://circuit.example.com", true)) as {
      mcpServers: { "logic-circuit": { url: string; headers?: Record<string, string> } };
    };
    expect(configWithKey.mcpServers["logic-circuit"]).toEqual({
      url: "https://circuit.example.com/mcp",
      headers: {
        Authorization: "Bearer <dein-access-key>",
      },
    });
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
        onOpenSettings={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivateThisTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(activeOtherHtml).toContain("Diesen Tab für MCP aktivieren");
    expect(activeOtherHtml).toContain("Test-Warnung");

    const disconnectedHtml = renderToStaticMarkup(
      <McpRemotePopover
        isOpen
        status="remote-off"
        sessionId={null}
        connectedTabCount={1}
        error={null}
        isSharedWorkerSupported
        onOpenSettings={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivateThisTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(disconnectedHtml).toContain("Verbinden");
    expect(disconnectedHtml).toContain("data-testid=\"mcp-open-settings-btn\"");
    expect(disconnectedHtml).toContain("Einstellungen…");
    expect(disconnectedHtml).not.toContain("data-testid=\"mcp-sidecar-url-input\"");
    expect(disconnectedHtml).not.toContain("id=\"mcp-remote-access-key\"");
    expect(disconnectedHtml).not.toContain("IDE-Config anzeigen");

    const missingRequiredUrlHtml = renderToStaticMarkup(
      <McpRemotePopover
        isOpen
        status="remote-off"
        sessionId={null}
        connectedTabCount={1}
        error={null}
        isSharedWorkerSupported
        sidecarUrl=""
        customSidecarRequired
        onOpenSettings={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivateThisTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(missingRequiredUrlHtml).toContain("data-testid=\"mcp-sidecar-required-hint\"");

    // Versionsabweichungs-Banner & Sprung zum Download (ohne Einstellungs-Felder oder IDE-Config)
    const customSidecarHtml = renderToStaticMarkup(
      <McpRemotePopover
        isOpen
        status="remote-active-self"
        sessionId="xxyy-aabb-1234-qwer"
        connectedTabCount={1}
        error={null}
        isSharedWorkerSupported
        sidecarUrl="http://localhost:3001"
        customSidecarRequired
        versionCheck={{
          relation: "server-outdated",
          isCompatible: false,
          updateRecommended: true,
          clientVersion: "1.2.0",
          serverVersion: "1.1.0",
        }}
        onOpenSettings={vi.fn()}
        onOpenSidecarDownload={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivateThisTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(customSidecarHtml).toContain("data-testid=\"mcp-version-banner\"");
    expect(customSidecarHtml).toContain("data-testid=\"mcp-version-download-btn\"");
    expect(customSidecarHtml).toContain("v1.1.0");
    expect(customSidecarHtml).toContain("v1.2.0");
    expect(customSidecarHtml).not.toContain("data-testid=\"mcp-sidecar-url-input\"");
    expect(customSidecarHtml).not.toContain("IDE-Config anzeigen");

    const invalidProtocolHtml = renderToStaticMarkup(
      <McpRemotePopover
        isOpen
        status="remote-off"
        sessionId={null}
        connectedTabCount={1}
        error={null}
        isSharedWorkerSupported
        sidecarUrl="ftp://ungueltig"
        customSidecarRequired
        onOpenSettings={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivateThisTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(invalidProtocolHtml).toContain("data-testid=\"mcp-sidecar-url-error\"");
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

  it("sperrt MCP-Steuerung und Anzeige in StatusBar und McpRemotePopover bei aktivem isBlockedByCollab", () => {
    const blockedStatusHtml = renderStatusBarWithMcp(
      createController({
        mode: "remote",
        status: "remote-off",
        isBlockedByCollab: true,
      }),
      true,
    );
    expect(blockedStatusHtml).toContain("data-mcp-blocked=\"true\"");
    expect(blockedStatusHtml).toContain("MCP: Nur Host");
    expect(blockedStatusHtml).toContain("data-testid=\"mcp-collab-blocked-hint\"");

    const blockedPopoverHtml = renderToStaticMarkup(
      <McpRemotePopover
        isOpen
        status="remote-active-other"
        sessionId="sess-1"
        connectedTabCount={2}
        error={null}
        isSharedWorkerSupported
        isBlockedByCollab
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivateThisTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(blockedPopoverHtml).toContain("data-testid=\"mcp-collab-blocked-hint\"");
    expect(blockedPopoverHtml).toContain("ausschließlich dem aktiven Session-Host vorbehalten");
    expect(blockedPopoverHtml).toMatch(/class="claim-tab-btn"[^>]*disabled=""/);
  });
});
