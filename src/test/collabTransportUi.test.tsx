import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CircuitContextProvider from "../contexts/circuitContext/provider";
import type { CollabContextType } from "../contexts/collabContext";

import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from "../utils/appSettingsStorage";
import { createEmptyCircuitProject } from "../utils/circuitLayout";
import {
  clearCollabAccessKey,
  loadCollabAccessKey,
  saveCollabAccessKey,
} from "../utils/collabStorage";

import OptionsDialog from "../components/app/optionsDialog";
import PrivacyDialog from "../components/app/privacyDialog";
import CollabParticipantsPanel from "../components/collab/collabParticipantsPanel";
import ConnectionDiagnosticsBanner from "../components/collab/connectionDiagnosticsBanner";
import ResyncWarningDialog from "../components/collab/resyncWarningDialog";
import StartCollabSessionDialog from "../components/collab/startCollabSessionDialog";

const noop = () => undefined;

describe("T-088: STUN-Optionen, Verbindungsdiagnose, Resync-Warnung & WebRTC-Datenschutzhinweis", () => {
  const originalWindow = (globalThis as { window?: Window & typeof globalThis }).window;
  const originalDisableCollab = process.env.DISABLE_COLLAB;
  const originalDisableMcp = process.env.DISABLE_MCP;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window & typeof globalThis }).window;
    } else {
      (globalThis as { window?: Window & typeof globalThis }).window = originalWindow;
    }
    if (originalDisableCollab === undefined) {
      delete process.env.DISABLE_COLLAB;
    } else {
      process.env.DISABLE_COLLAB = originalDisableCollab;
    }
    if (originalDisableMcp === undefined) {
      delete process.env.DISABLE_MCP;
    } else {
      process.env.DISABLE_MCP = originalDisableMcp;
    }
    vi.restoreAllMocks();
  });

  function installMockLocalStorage(): Map<string, string> {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;

    (globalThis as { window?: Window & typeof globalThis }).window = {
      localStorage: mockStorage,
    } as unknown as Window & typeof globalThis;

    return store;
  }

  it("persistiert optionale STUN-Server und Host-Access-Key lokal und filtert TURN heraus", () => {
    const store = installMockLocalStorage();

    saveAppSettings({
      ...DEFAULT_APP_SETTINGS,
      collabStunUrls: ["stun:stun.example.org:3478", "turn:relay.example.org:3478"],
    });
    expect(loadAppSettings()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      collabStunUrls: ["stun:stun.example.org:3478"],
    });

    // Leere STUN-Liste fällt abwärtskompatibel auf Standard-Objekt ohne collabStunUrls zurück
    store.set(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APP_SETTINGS, collabStunUrls: ["turn:ignored.example.org:3478"] }),
    );
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);

    expect(loadCollabAccessKey()).toBe("");
    saveCollabAccessKey("  mein-geheimer-host-key  ");
    expect(loadCollabAccessKey()).toBe("mein-geheimer-host-key");
    clearCollabAccessKey();
    expect(loadCollabAccessKey()).toBe("");
  });

  it("rendert OptionsDialog mit Tabs (Allgemein, Verzeichnisse, Kollaboration, BYO SideCar) und initialTab", () => {
    delete process.env.DISABLE_COLLAB;
    delete process.env.DISABLE_MCP;
    const project = createEmptyCircuitProject();

    const activeHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <OptionsDialog isOpen={true} onClose={noop} />
      </CircuitContextProvider>,
    );
    expect(activeHtml).toContain("role=\"tablist\"");
    expect(activeHtml).toContain("data-testid=\"options-tab-general\"");
    expect(activeHtml).toContain("data-testid=\"options-tab-directories\"");
    expect(activeHtml).toContain("data-testid=\"options-tab-collab\"");
    expect(activeHtml).toContain("data-testid=\"options-tab-sidecar\"");
    expect(activeHtml).toContain("data-testid=\"options-collab-section\"");
    expect(activeHtml).toContain("id=\"options-collab-display-name\"");
    expect(activeHtml).toContain("id=\"options-collab-stun-urls\"");
    expect(activeHtml).toContain("id=\"options-collab-access-key\"");
    expect(activeHtml).toContain("id=\"options-mcp-access-key\"");
    expect(activeHtml).toContain("id=\"options-sidecar-url\"");
    expect(activeHtml).toContain("data-testid=\"options-sidecar-test-btn\"");
    expect(activeHtml).toContain("data-testid=\"options-ide-config-toggle-btn\"");
    expect(activeHtml).toContain("IDE-Config anzeigen");

    // Direkter Einsprung auf den BYO-SideCar-Tab (für Hilfe -> BYO SideCar) inkl. geöffneter IDE-Config
    const sidecarTabHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <OptionsDialog isOpen={true} initialTab="sidecar" initialShowIdeConfig={true} onClose={noop} />
      </CircuitContextProvider>,
    );
    expect(sidecarTabHtml).toMatch(/id="options-tab-sidecar"[^>]*aria-selected="true"/);
    expect(sidecarTabHtml).toMatch(/id="options-tab-general"[^>]*aria-selected="false"/);
    expect(sidecarTabHtml).not.toMatch(/id="options-panel-sidecar"[^>]*hidden=""/);
    expect(sidecarTabHtml).toContain("data-testid=\"options-ide-config-section\"");
    expect(sidecarTabHtml).toContain("data-testid=\"options-ide-config-preview\"");
    expect(sidecarTabHtml).toContain("mcpServers");
    expect(sidecarTabHtml).toContain("/mcp");
    expect(sidecarTabHtml).toContain("data-testid=\"options-ide-config-copy-btn\"");

    process.env.DISABLE_COLLAB = "true";
    const pagesHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <OptionsDialog isOpen={true} onClose={noop} />
      </CircuitContextProvider>,
    );
    expect(pagesHtml).not.toContain("data-testid=\"options-tab-collab\"");
    expect(pagesHtml).not.toContain("data-testid=\"options-collab-section\"");
    expect(pagesHtml).not.toContain("options-collab-display-name");
    expect(pagesHtml).not.toContain("options-collab-stun-urls");
    expect(pagesHtml).not.toContain("options-collab-access-key");

    process.env.DISABLE_MCP = "true";
    const noMcpHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <OptionsDialog isOpen={true} initialTab="sidecar" initialShowIdeConfig={true} onClose={noop} />
      </CircuitContextProvider>,
    );
    expect(noMcpHtml).not.toContain("data-testid=\"options-ide-config-toggle-btn\"");
    expect(noMcpHtml).not.toContain("data-testid=\"options-ide-config-section\"");
  });

  it("rendert ConnectionDiagnosticsBanner zustandsabhängig mit Grace Period, NAT-Diagnose und TURN-Hinweis", () => {
    delete process.env.DISABLE_COLLAB;

    // Idle, Connected ohne Diagnose oder deaktivierter Build rendern leer
    expect(renderToStaticMarkup(
      <ConnectionDiagnosticsBanner
        transportState="idle"
        diagnostic={{ code: "none", isRecoverable: true, turnPlannedHint: false, details: "" }}
      />,
    )).not.toContain("data-component=\"ConnectionDiagnosticsBanner\"");

    expect(renderToStaticMarkup(
      <ConnectionDiagnosticsBanner
        transportState="connected"
        diagnostic={{ code: "none", isRecoverable: true, turnPlannedHint: false, details: "" }}
      />,
    )).not.toContain("data-component=\"ConnectionDiagnosticsBanner\"");

    expect(renderToStaticMarkup(
      <ConnectionDiagnosticsBanner
        transportState="failed"
        diagnostic={{
          code: "symmetric-nat-or-udp-blocked",
          isRecoverable: false,
          turnPlannedHint: true,
          details: "",
        }}
        disabledOverride={true}
      />,
    )).not.toContain("data-component=\"ConnectionDiagnosticsBanner\"");

    const degradedHtml = renderToStaticMarkup(
      <ConnectionDiagnosticsBanner
        transportState="degraded"
        gracePeriodMs={15000}
        diagnostic={{ code: "connecting", isRecoverable: true, turnPlannedHint: false, details: "" }}
        onManualResync={noop}
      />,
    );
    expect(degradedHtml).toContain("data-component=\"ConnectionDiagnosticsBanner\"");
    expect(degradedHtml).toContain("15 s");
    expect(degradedHtml).toContain("data-testid=\"collab-manual-resync-btn\"");

    const natFailedHtml = renderToStaticMarkup(
      <ConnectionDiagnosticsBanner
        transportState="failed"
        diagnostic={{
          code: "host-migration-unreachable",
          isRecoverable: false,
          turnPlannedHint: true,
          details: "",
        }}
        onManualResync={noop}
      />,
    );
    expect(natFailedHtml).toContain("role=\"alert\"");
    expect(natFailedHtml).toContain("data-testid=\"collab-turn-planned-hint\"");
    expect(natFailedHtml).toContain("TURN");
  });

  it("rendert ResyncWarningDialog mit unbestätigter Änderungsanzahl und Zugänglichkeits-Attributen", () => {
    const singleHtml = renderToStaticMarkup(
      <ResyncWarningDialog
        isOpen={true}
        reason="reconnected"
        unconfirmedLocalChangesCount={1}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(singleHtml).toContain("data-component=\"ResyncWarningDialog\"");
    expect(singleHtml).toContain("role=\"alertdialog\"");
    expect(singleHtml).toContain("aria-modal=\"true\"");
    expect(singleHtml).toContain("data-testid=\"resync-unconfirmed-count\"");
    expect(singleHtml).toContain("1 ");

    const multiHtml = renderToStaticMarkup(
      <ResyncWarningDialog
        isOpen={true}
        reason="manual"
        unconfirmedLocalChangesCount={4}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(multiHtml).toContain("4 ");
    expect(multiHtml).toContain("data-testid=\"resync-confirm-btn\"");
  });

  it("zeigt den WebRTC-IP-Datenschutzhinweis im PrivacyDialog und blendet ihn im pages-Build aus", () => {
    delete process.env.DISABLE_COLLAB;
    const activeHtml = renderToStaticMarkup(
      <PrivacyDialog isOpen={true} onClose={noop} />,
    );
    expect(activeHtml).toContain("data-testid=\"privacy-webrtc-section\"");
    expect(activeHtml).toContain("ICE");

    process.env.DISABLE_COLLAB = "true";
    const pagesHtml = renderToStaticMarkup(
      <PrivacyDialog isOpen={true} onClose={noop} />,
    );
    expect(pagesHtml).not.toContain("data-testid=\"privacy-webrtc-section\"");
  });

  it("rendert StartCollabSessionDialog (T-096) mit Pflicht-Anzeigename, GDPR-Hinweis, BYO-SideCar-Führung, 429 & 503", () => {
    delete process.env.DISABLE_COLLAB;
    installMockLocalStorage();

    const createCollabStub = (overrides: Partial<CollabContextType> = {}): CollabContextType => ({
      isDisabled: false,
      customSidecarRequired: false,
      isInSession: false,
      transportState: "idle",
      diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
      gracePeriodMs: 15000,
      sessionId: null,
      selfPeerId: null,
      selfRole: null,
      hostPeerId: null,
      isHost: false,
      isMcpBlockedByCollab: false,
      activeSidecarUrl: null,
      isEphemeralSidecar: false,
      runtimeConfig: null,
      displayName: "Andreas",
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
      endOrLeaveSession: noop,
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
      setParticipantsPanelOpen: noop,
      clearPendingInviteLink: noop,
      clearError: noop,
      dismissSessionClosedNotice: noop,
      ...overrides,
    });

    const normalHtml = renderToStaticMarkup(
      <StartCollabSessionDialog
        isOpen={true}
        onClose={noop}
        collabOverride={createCollabStub()}
      />,
    );
    expect(normalHtml).toContain("data-component=\"StartCollabSessionDialog\"");
    expect(normalHtml).toContain("data-testid=\"collab-start-display-name-input\"");
    expect(normalHtml).toContain("value=\"Andreas\"");
    expect(normalHtml).toContain("data-testid=\"collab-start-privacy-notice\"");
    expect(normalHtml).toContain("data-testid=\"collab-start-open-privacy-btn\"");
    expect(normalHtml).not.toContain("data-testid=\"collab-start-sidecar-guidance\"");

    // SIDECAR_CUSTOM_ONLY ohne URL sowie 401 unauthorized führen zu Hilfe -> BYO SideCar
    const pagesGuidanceHtml = renderToStaticMarkup(
      <StartCollabSessionDialog
        isOpen={true}
        onClose={noop}
        customSidecarRequiredOverride={true}
        collabOverride={createCollabStub()}
      />,
    );
    expect(pagesGuidanceHtml).toContain("data-testid=\"collab-start-sidecar-guidance\"");
    expect(pagesGuidanceHtml).toContain("data-testid=\"collab-start-open-byo-sidecar-btn\"");

    const authErrorHtml = renderToStaticMarkup(
      <StartCollabSessionDialog
        isOpen={true}
        onClose={noop}
        collabOverride={createCollabStub({
          lastError: {
            code: "unauthorized",
            message: "401",
            httpStatus: 401,
            requiresAccessKey: true,
          },
        })}
      />,
    );
    expect(authErrorHtml).toContain("Host-Zugangsschlüssel erforderlich");
    expect(authErrorHtml).toContain("data-testid=\"collab-start-open-byo-sidecar-btn\"");

    // 429 mit Wartezeit & 503-Kapazitätsfehler
    const rateLimitHtml = renderToStaticMarkup(
      <StartCollabSessionDialog
        isOpen={true}
        onClose={noop}
        collabOverride={createCollabStub({
          lastError: {
            code: "rate-limited",
            message: "Too many",
            httpStatus: 429,
            retryAfterSeconds: 22,
          },
        })}
      />,
    );
    expect(rateLimitHtml).toContain("22 s");

    const serviceUnavailableHtml = renderToStaticMarkup(
      <StartCollabSessionDialog
        isOpen={true}
        onClose={noop}
        collabOverride={createCollabStub({
          lastError: {
            code: "service-unavailable",
            message: "503",
            httpStatus: 503,
          },
        })}
      />,
    );
    expect(serviceUnavailableHtml).toContain("503");

    // Bei DISABLE_COLLAB bleibt der Dialog geschlossen
    expect(renderToStaticMarkup(
      <StartCollabSessionDialog
        isOpen={true}
        onClose={noop}
        collabOverride={createCollabStub({ isDisabled: true })}
      />,
    )).not.toContain("data-component=\"StartCollabSessionDialog\"");
  });

  it("rendert CollabParticipantsPanel (T-096) ein-/ausgeklappt, mit Sperrhinweis, 5-Minuten-Links & Localhost-Warnung", () => {
    delete process.env.DISABLE_COLLAB;
    installMockLocalStorage();

    const baseCollab: CollabContextType = {
      isDisabled: false,
      customSidecarRequired: false,
      isInSession: true,
      transportState: "connected",
      diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
      gracePeriodMs: 15000,
      sessionId: "sess-1",
      selfPeerId: "p-host",
      selfRole: "host",
      hostPeerId: "p-host",
      isHost: true,
      isMcpBlockedByCollab: false,
      activeSidecarUrl: "http://localhost:3001",
      isEphemeralSidecar: false,
      runtimeConfig: null,
      displayName: "Host",
      participants: [
        {
          peerId: "p-host",
          role: "host",
          displayName: "Host",
          nameLocked: false,
          handRaised: false,
          connectionState: "connected",
          isSelf: true,
        },
        {
          peerId: "p-collab",
          role: "collaborator",
          displayName: "Clara",
          nameLocked: false,
          handRaised: true,
          connectionState: "connected",
        },
        {
          peerId: "p-guest",
          role: "guest",
          displayName: "Gustav",
          nameLocked: true,
          handRaised: false,
          connectionState: "connected",
        },
      ],
      selfParticipant: {
        peerId: "p-host",
        role: "host",
        displayName: "Host",
        nameLocked: false,
        handRaised: false,
        connectionState: "connected",
        isSelf: true,
      },
      raisedHandCount: 1,
      activeInvites: [
        {
          inviteToken: "tok-guest-1234567890",
          role: "guest",
          url: "http://localhost:3001/#collabInvite=tok-guest-1234567890",
          createdAt: Date.now(),
          expiresAt: Date.now() + 125_000,
          isLocalhostSidecar: true,
        },
      ],
      pendingInviteLink: null,
      lastError: null,
      lastRejectionMessage: null,
      sessionClosedNotice: null,
      isParticipantsPanelOpen: false,
      startHostSession: async () => false,
      joinSession: async () => false,
      endOrLeaveSession: noop,
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
      setParticipantsPanelOpen: noop,
      clearPendingInviteLink: noop,
      clearError: noop,
      dismissSessionClosedNotice: noop,
    };

    const collapsedHtml = renderToStaticMarkup(<CollabParticipantsPanel collabOverride={baseCollab} />);
    expect(collapsedHtml).toContain("data-component=\"CollabParticipantsPanel\"");
    expect(collapsedHtml).toContain("data-expanded=\"false\"");
    expect(collapsedHtml).toContain("3 Teilnehmer");
    expect(collapsedHtml).toContain("1 Hand gehoben");
    expect(collapsedHtml).not.toContain("data-testid=\"collab-participants-list\"");

    const expandedHostHtml = renderToStaticMarkup(
      <CollabParticipantsPanel collabOverride={{ ...baseCollab, isParticipantsPanelOpen: true }} />,
    );
    expect(expandedHostHtml).toContain("data-expanded=\"true\"");
    expect(expandedHostHtml).toContain("data-testid=\"collab-participants-list\"");
    expect(expandedHostHtml).toContain("data-testid=\"collab-hand-raised-badge\"");
    expect(expandedHostHtml).toContain("data-testid=\"collab-host-invites-section\"");
    expect(expandedHostHtml).toContain("data-testid=\"collab-localhost-warning\"");
    expect(expandedHostHtml).toContain("data-testid=\"collab-create-guest-invite-btn\"");
    expect(expandedHostHtml).toContain("Einladen als Gast");
    expect(expandedHostHtml).toContain("data-testid=\"collab-create-collab-invite-btn\"");
    expect(expandedHostHtml).toContain("Einladen als Kollaborateur");
    expect(expandedHostHtml).toContain("data-testid=\"collab-invite-tok-guest-1234567890\"");
    expect(expandedHostHtml).toContain("Session beenden");

    // Gesperrter Gast sieht Namenssperre-Hinweis und keine Host-Links
    const lockedGuestHtml = renderToStaticMarkup(
      <CollabParticipantsPanel
        collabOverride={{
          ...baseCollab,
          isHost: false,
          selfPeerId: "p-guest",
          selfRole: "guest",
          isParticipantsPanelOpen: true,
          selfParticipant: {
            peerId: "p-guest",
            role: "guest",
            displayName: "Gustav",
            nameLocked: true,
            handRaised: false,
            connectionState: "connected",
            isSelf: true,
          },
        }}
      />,
    );
    expect(lockedGuestHtml).toContain("data-testid=\"collab-name-locked-hint\"");
    expect(lockedGuestHtml).not.toContain("data-testid=\"collab-host-invites-section\"");
    expect(lockedGuestHtml).toContain("Session verlassen");

    expect(renderToStaticMarkup(
      <CollabParticipantsPanel collabOverride={{ ...baseCollab, isDisabled: true }} />,
    )).not.toContain("data-component=\"CollabParticipantsPanel\"");
  });
});
