import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import CollabContext, { type CollabContextType } from "../contexts/collabContext";
import LibraryContext, { type LibraryContextType } from "../contexts/libraryContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type { LibraryPersistenceState } from "../types/storage/circuitLibrary";

import type { CollabModelSyncState } from "../collab/collabModelSyncController";
import {
  type CollabPresenceCursorMap,
  type CollabPresenceState,
  resolveParticipantNavigationTarget,
} from "../collab/collabPresenceController";
import { APP_SETTINGS_STORAGE_KEY, DEFAULT_APP_SETTINGS, saveAppSettings } from "../utils/appSettingsStorage";
import { createDefaultLogicalCircuit, createEmptyCircuitProject } from "../utils/circuitLayout";
import {
  COLLAB_PARTICIPANT_COLOR_PALETTE,
  createCollabParticipantColorStore,
  loadParticipantColorDictionary,
  saveParticipantColorDictionary,
} from "../utils/collabParticipantColors";
import { buildCircuitLibraryDocument } from "../utils/libraryStorage";

import OptionsDialog from "../components/app/optionsDialog";
import CollabParticipantsPanel from "../components/collab/collabParticipantsPanel";
import CollabWorkspaceOverlay from "../components/collab/collabWorkspaceOverlay";
import ComponentPalette from "../components/componentPalette";

function installMockLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mockStorage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: mockStorage, location: { hostname: "localhost" } },
    configurable: true,
    writable: true,
  });
  return store;
}

function createSyncState(overrides: Partial<CollabModelSyncState> = {}): CollabModelSyncState {
  return {
    syncStatus: "synced",
    revision: 1,
    epochId: "epoch-1",
    unconfirmedMutationCount: 0,
    isQuiesced: false,
    quiesceReason: null,
    isReadOnlyForGuest: false,
    lastSyncRejection: null,
    lastRemoteCommit: null,
    softLocks: [],
    lastUndoConflict: null,
    undoStackVersion: 0,
    isLocalSimulationBuffered: false,
    pendingSimulationDeltaCount: 0,
    hasPendingProjectSwitchDuringSim: false,
    requiresResyncAfterSimulation: false,
    ...overrides,
  };
}

function createCollabStub(overrides: Partial<CollabContextType> = {}): CollabContextType {
  return {
    isDisabled: false,
    customSidecarRequired: false,
    isInSession: true,
    transportState: "connected",
    diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
    gracePeriodMs: 60_000,
    sessionId: "sess-ui-104",
    selfPeerId: "peer-self",
    selfRole: "collaborator",
    hostPeerId: "peer-host",
    isHost: false,
    isMcpBlockedByCollab: true,
    activeSidecarUrl: null,
    isEphemeralSidecar: false,
    runtimeConfig: null,
    displayName: "Alice",
    participants: [
      {
        peerId: "peer-host",
        displayName: "Host",
        role: "host",
        isSelf: false,
        connectionState: "connected",
        handRaised: false,
        nameLocked: false,
      },
      {
        peerId: "peer-self",
        displayName: "Alice",
        role: "collaborator",
        isSelf: true,
        connectionState: "connected",
        handRaised: false,
        nameLocked: false,
      },
      {
        peerId: "peer-guest",
        displayName: "Gustav",
        role: "guest",
        isSelf: false,
        connectionState: "connected",
        handRaised: false,
        nameLocked: false,
      },
    ],
    selfParticipant: {
      peerId: "peer-self",
      displayName: "Alice",
      role: "collaborator",
      isSelf: true,
      connectionState: "connected",
      handRaised: false,
      nameLocked: false,
    },
    raisedHandCount: 0,
    activeInvites: [],
    pendingInviteLink: null,
    lastError: null,
    lastRejectionMessage: null,
    sessionClosedNotice: null,
    isParticipantsPanelOpen: true,
    modelSyncState: createSyncState(),
    softLockBlockedNotice: null,
    reportSoftLockBlocked: vi.fn(),
    clearSoftLockBlockedNotice: vi.fn(),
    clearSyncRejection: vi.fn(),
    clearUndoConflict: vi.fn(),
    acquireSoftLocks: vi.fn().mockReturnValue({ ok: true, acquired: [] }),
    renewSoftLocks: vi.fn().mockReturnValue([]),
    releaseSoftLocks: vi.fn().mockReturnValue([]),
    getForeignSoftLocks: vi.fn().mockReturnValue([]),
    getForeignLockForTarget: vi.fn().mockReturnValue(null),
    registerResyncConfirmHandler: vi.fn(),
    runWithMutationOrigin: (_origin, fn) => fn(),
    startHostSession: vi.fn().mockResolvedValue(true),
    joinSession: vi.fn().mockResolvedValue(true),
    endOrLeaveSession: vi.fn(),
    createInviteLink: vi.fn().mockResolvedValue(null),
    revokeInviteLink: vi.fn().mockResolvedValue(true),
    setParticipantRole: vi.fn().mockResolvedValue(true),
    moderateParticipantName: vi.fn().mockResolvedValue(true),
    renameSelf: vi.fn().mockResolvedValue(true),
    toggleHandRaised: vi.fn().mockResolvedValue(true),
    lowerParticipantHand: vi.fn().mockResolvedValue(true),
    kickParticipant: vi.fn().mockResolvedValue(true),
    transferHostRole: vi.fn().mockReturnValue(true),
    requestResync: vi.fn().mockResolvedValue(true),
    setParticipantsPanelOpen: vi.fn(),
    clearPendingInviteLink: vi.fn(),
    clearError: vi.fn(),
    dismissSessionClosedNotice: vi.fn(),
    getParticipantColor: (peerId: string) => (peerId === "peer-host" ? "#dc2626" : "#059669"),
    setParticipantColor: vi.fn().mockReturnValue(true),
    getRemoteCursors: () => ({}),
    subscribeRemoteCursors: () => () => undefined,
    followingPeerId: null,
    startFollowingPeer: vi.fn().mockReturnValue(true),
    stopFollowingPeer: vi.fn(),
    jumpToParticipant: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function createLibraryStub(overrides: Partial<LibraryContextType> = {}): LibraryContextType {
  const persistenceState: LibraryPersistenceState = {
    status: "synced",
    isReadOnly: false,
    fileName: "personal.lclib",
    cachedAt: null,
    lastSyncedAt: null,
    document: buildCircuitLibraryDocument([]),
  };
  return {
    activeSidebarTab: "project",
    setActiveSidebarTab: vi.fn(),
    persistenceState,
    isLoading: false,
    isResyncWarningDismissed: false,
    dismissResyncWarning: vi.fn(),
    libraryError: null,
    clearLibraryError: vi.fn(),
    builtInItems: [],
    builtInCircuits: [],
    userCircuits: [],
    isWritable: true,
    editingLibraryCircuitId: null,
    isEditingLibrary: false,
    openLibraryFile: vi.fn().mockResolvedValue(true),
    openLibraryFromText: vi.fn().mockReturnValue(true),
    createLibraryFile: vi.fn().mockResolvedValue(true),
    resyncLibrary: vi.fn().mockResolvedValue(true),
    unlinkLibrary: vi.fn().mockResolvedValue(undefined),
    reloadInitialLibrary: vi.fn().mockResolvedValue(undefined),
    addProjectCircuitToLibrary: vi.fn().mockResolvedValue(null),
    duplicateBuiltInToLibrary: vi.fn().mockResolvedValue(null),
    updateLibraryCircuitMetadata: vi.fn().mockResolvedValue(false),
    getLibraryDeletionDependents: vi.fn().mockReturnValue([]),
    deleteLibraryCircuits: vi.fn().mockResolvedValue({ deletedIds: [], blockedByDependents: [] }),
    importCircuitsIntoLibrary: vi.fn().mockResolvedValue(0),
    exportLibraryCircuitNative: vi.fn(),
    exportLibraryCircuitXml: vi.fn(),
    exportLibraryDocument: vi.fn(),
    enterLibraryEditMode: vi.fn().mockResolvedValue(true),
    saveLibraryEditSession: vi.fn().mockResolvedValue(true),
    exitLibraryEditMode: vi.fn().mockResolvedValue(undefined),
    getSavedSessionProject: vi.fn().mockReturnValue(null),
    updateSavedSessionProject: vi.fn(),
    ...overrides,
  };
}

describe("T-104: Teilnehmer-Panel (Farbwähler & Schaltplan), Paletten-Präsenz, Folgen & Optionen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it("zeigt im Teilnehmer-Panel lokale Farben, Farbwähler (Presets + Color-Input), Schaltplan/Bibliothek sowie Springen- und Folgen-Buttons", () => {
    const project = createEmptyCircuitProject("Demo");
    const mainCircuit = project.logicalCircuits[0];
    const subCircuit = createDefaultLogicalCircuit("sub-alu", "ALU 4-Bit");
    project.logicalCircuits.push(subCircuit);

    const presenceState: CollabPresenceState = {
      version: 2,
      peers: {
        "peer-host": {
          peerId: "peer-host",
          logicalCircuitId: subCircuit.logicalCircuitId,
          inLibraryMode: false,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: { centerX: 180, centerY: 120, zoom: 1.2 },
          updatedAt: 1000,
        },
        "peer-guest": {
          peerId: "peer-guest",
          logicalCircuitId: null,
          inLibraryMode: true,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: 1000,
        },
      },
    };

    const collab = createCollabStub({
      presenceState,
      followingPeerId: "peer-host",
      getParticipantColor: (peerId) => (peerId === "peer-host" ? "#dc2626" : peerId === "peer-self" ? "#2563eb" : "#059669"),
    });

    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub()}>
            <CollabContext.Provider value={collab}>
              <CollabParticipantsPanel initialColorPickerPeerId="peer-host" />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    // Farbindikator & geöffneter Farbwähler nur für Remote-Teilnehmer, kein Punkt für Self
    expect(html).toContain("data-testid=\"collab-color-btn-peer-host\"");
    expect(html).toContain("data-color=\"#dc2626\"");
    expect(html).not.toContain("data-testid=\"collab-color-dot-peer-self\"");
    expect(html).not.toContain("data-testid=\"collab-color-btn-peer-self\"");
    expect(html).toContain("data-testid=\"collab-color-picker-peer-host\"");
    expect(html).toContain(`data-testid="collab-color-preset-peer-host-${COLLAB_PARTICIPANT_COLOR_PALETTE[0].slice(1)}"`);
    expect(html).toContain("data-testid=\"collab-color-input-peer-host\"");

    // Schaltplan-Namen & Bibliotheksmodus-Kennzeichnung
    expect(html).toContain("data-testid=\"collab-participant-circuit-peer-host\"");
    expect(html).toContain("ALU 4-Bit");
    expect(html).toContain(mainCircuit.name);
    expect(html).toContain("data-testid=\"collab-participant-circuit-peer-guest\"");
    expect(html).toContain("data-in-library=\"true\"");
    expect(html).toContain("Bibliothek (lokal)");

    // Springen für Remote-Gast im Bibliotheksmodus ist deaktiviert, für Host aktiv; Folgen-Button zeigt aktiven Zustand
    expect(html).toContain("data-testid=\"collab-jump-peer-host\"");
    expect(html).toContain("data-testid=\"collab-follow-peer-host\"");
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("Folgt");
    expect(html).toMatch(/data-testid="collab-jump-peer-guest"[^>]*disabled=""/);

    // Synchrones Cursor-Filter-Dropdown im Teilnehmer-Panel
    expect(html).toContain("data-testid=\"collab-panel-cursor-visibility\"");
    expect(html).toContain("Alle Mauszeiger anzeigen");
    expect(html).toContain("Hand gehoben + Kollaborateure");
    expect(html).toContain("Nur Kollaborateure");
    expect(html).toContain("Nur Hand gehoben");
  });

  it("rendert das Follow-Banner in CollabWorkspaceOverlay in der lokalen Teilnehmerfarbe", () => {
    const collab = createCollabStub({
      followingPeerId: "peer-host",
      getParticipantColor: () => "#7c3aed",
    });

    const html = renderToStaticMarkup(
      <LibraryContext.Provider value={createLibraryStub()}>
        <CollabContext.Provider value={collab}>
          <CollabWorkspaceOverlay />
        </CollabContext.Provider>
      </LibraryContext.Provider>,
    );

    expect(html).toContain("data-testid=\"collab-follow-banner\"");
    expect(html).toContain("data-following-peer-id=\"peer-host\"");
    expect(html).toContain("data-color=\"#7c3aed\"");
    expect(html).toContain("Du folgst Host");
    expect(html).toContain("data-testid=\"collab-stop-following-btn\"");
    expect(html).toContain("Folgen beenden");
  });

  it("zeigt farbige Präsenzpunkte an den Schaltplänen in ComponentPalette und verbirgt sie im lokalen Bibliotheksmodus", () => {
    const project = createEmptyCircuitProject("Demo");
    const mainCircuit = project.logicalCircuits[0];
    const subCircuit = createDefaultLogicalCircuit("sub-reg", "Register 8-Bit");
    project.logicalCircuits.push(subCircuit);

    const presenceState: CollabPresenceState = {
      version: 1,
      peers: {
        "peer-host": {
          peerId: "peer-host",
          logicalCircuitId: subCircuit.logicalCircuitId,
          inLibraryMode: false,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: 1000,
        },
        "peer-guest": {
          peerId: "peer-guest",
          logicalCircuitId: mainCircuit.logicalCircuitId,
          inLibraryMode: true,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: 1000,
        },
      },
    };

    const collab = createCollabStub({
      presenceState,
      getParticipantColor: () => "#ea580c",
    });

    const normalHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub({ isEditingLibrary: false })}>
            <CollabContext.Provider value={collab}>
              <ComponentPalette />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(normalHtml).toContain(`data-testid="palette-circuit-presence-${subCircuit.logicalCircuitId}"`);
    expect(normalHtml).toContain(`data-testid="palette-circuit-presence-dot-${subCircuit.logicalCircuitId}-peer-host"`);
    expect(normalHtml).toContain("data-color=\"#ea580c\"");
    expect(normalHtml).toContain("Gerade hier aktiv: Host");
    // Peer im Bibliotheksmodus erzeugt keinen Paletten-Präsenzpunkt auf Projektschaltungen
    expect(normalHtml).not.toContain(`palette-circuit-presence-dot-${mainCircuit.logicalCircuitId}-peer-guest`);

    const libraryEditHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub({ isEditingLibrary: true })}>
            <CollabContext.Provider value={collab}>
              <ComponentPalette />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(libraryEditHtml).not.toContain("palette-circuit-presence-");
  });

  it("rendert Cursor-Ausblendzeit, Cursor-Filter-Dropdown und Farblisten-Verwaltung (Title-Case) im OptionsDialog", () => {
    installMockLocalStorage();
    saveAppSettings(
      {
        ...DEFAULT_APP_SETTINGS,
        collabCursorIdleTimeoutSec: 30,
        collabCursorVisibilityMode: "collaborators-and-raised-hand",
      },
      APP_SETTINGS_STORAGE_KEY,
    );
    saveParticipantColorDictionary({
      "andreas friedel": "#2563eb",
      "mr. foo": "#059669",
      SABINE: "#dc2626",
    });

    const project = createEmptyCircuitProject("Optionen");
    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <CanvasContextProvider>
            <OptionsDialog isOpen={true} initialTab="collab" onClose={() => undefined} />
          </CanvasContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(html).toContain("data-testid=\"options-collab-cursor-idle\"");
    expect(html).toContain("Inaktive Mauszeiger ausblenden nach");
    expect(html).toContain("5 Sekunden");
    expect(html).toContain("10 Sekunden");
    expect(html).toContain("15 Sekunden");
    expect(html).toContain("<option value=\"30\" selected=\"\">30 Sekunden</option>");
    expect(html).toContain("Nie ausblenden");

    // Synchrones Cursor-Filter-Dropdown im OptionsDialog
    expect(html).toContain("data-testid=\"options-collab-cursor-visibility\"");
    expect(html).toContain("<option value=\"collaborators-and-raised-hand\" selected=\"\">Hand gehoben + Kollaborateure</option>");

    // Farbliste mit Title-Case-Formatierung, Farbpicker und Löschen-Buttons
    expect(html).toContain("data-testid=\"options-collab-colors-section\"");
    expect(html).toContain("data-testid=\"options-collab-clear-colors\"");
    expect(html).toContain("Andreas Friedel");
    expect(html).toContain("Mr. Foo");
    expect(html).toContain("Sabine");
    expect(html).toContain("data-testid=\"options-collab-color-input-andreas friedel\"");
    expect(html).toContain("data-testid=\"options-collab-color-delete-sabine\"");

    // Leer-Zustand ohne gespeicherte Farben
    saveParticipantColorDictionary({});
    const emptyColorsHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <CanvasContextProvider>
            <OptionsDialog isOpen={true} initialTab="collab" onClose={() => undefined} />
          </CanvasContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(emptyColorsHtml).toContain("data-testid=\"options-collab-colors-empty\"");
    expect(emptyColorsHtml).toContain("Noch keine gespeicherten Teilnehmerfarben vorhanden.");
  });

  it("löst Sprung-/Follow-Ziele inklusive stillem Pausieren im Bibliotheksmodus und lokalem Farb-Rename korrekt auf", () => {
    installMockLocalStorage();
    const colorStore = createCollabParticipantColorStore();
    colorStore.syncParticipants([
      { peerId: "peer-host", displayName: "Host" },
      { peerId: "peer-guest", displayName: "Gustav" },
    ]);
    colorStore.setColorForPeer("peer-host", "#123456");

    // Namensänderung über dieselbe peerId behält die lokale benutzerdefinierte Farbe
    colorStore.syncParticipants([
      { peerId: "peer-host", displayName: "Host Neu" },
      { peerId: "peer-guest", displayName: "Gustav" },
    ]);
    expect(colorStore.getColorForPeer("peer-host")).toBe("#123456");
    expect(loadParticipantColorDictionary()["host neu"]).toBe("#123456");

    const remoteCursors: CollabPresenceCursorMap = {
      "peer-host": {
        peerId: "peer-host",
        x: 240,
        y: 160,
        logicalCircuitId: "lc-sub",
        lastMovedAt: 1000,
      },
    };

    // Ziel mit Viewport -> ready
    expect(
      resolveParticipantNavigationTarget({
        targetPeerId: "peer-host",
        availableCircuitIds: ["lc-main", "lc-sub"],
        remoteCursors,
        presenceState: {
          version: 1,
          peers: {
            "peer-host": {
              peerId: "peer-host",
              logicalCircuitId: "lc-sub",
              inLibraryMode: false,
              selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
              openDialog: null,
              viewport: { centerX: 300, centerY: 220, zoom: 1.5 },
              updatedAt: 1000,
            },
          },
        },
      }),
    ).toEqual({
      status: "ready",
      logicalCircuitId: "lc-sub",
      viewport: { centerX: 300, centerY: 220, zoom: 1.5 },
    });

    // Ziel ohne Viewport fällt auf Cursor-Position zurück
    expect(
      resolveParticipantNavigationTarget({
        targetPeerId: "peer-host",
        availableCircuitIds: ["lc-main", "lc-sub"],
        remoteCursors,
        presenceState: {
          version: 2,
          peers: {
            "peer-host": {
              peerId: "peer-host",
              logicalCircuitId: "lc-sub",
              inLibraryMode: false,
              selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
              openDialog: null,
              viewport: null,
              updatedAt: 1000,
            },
          },
        },
      }),
    ).toEqual({
      status: "ready",
      logicalCircuitId: "lc-sub",
      viewport: { centerX: 240, centerY: 160 },
    });

    // Im Bibliotheksmodus des Gefolgten liefert der Resolver "paused-library" für stilles Pausieren
    expect(
      resolveParticipantNavigationTarget({
        targetPeerId: "peer-host",
        availableCircuitIds: ["lc-main", "lc-sub"],
        remoteCursors,
        presenceState: {
          version: 3,
          peers: {
            "peer-host": {
              peerId: "peer-host",
              logicalCircuitId: null,
              inLibraryMode: true,
              selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
              openDialog: null,
              viewport: null,
              updatedAt: 1000,
            },
          },
        },
      }),
    ).toEqual({ status: "paused-library" });
  });
});
