import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import CollabContext, { type CollabContextType } from "../contexts/collabContext";
import LibraryContext, { type LibraryContextType } from "../contexts/libraryContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type { CollabSoftLockEntry } from "../types/collab/modelSyncMessage";
import { COLLAB_APP_TOPIC_PRESENCE_CURSOR } from "../types/collab/presenceMessage";
import type CollabRemoteSelectionOwner from "../types/collab/remoteEntityHighlight";
import type { LibraryPersistenceState } from "../types/storage/circuitLibrary";

import type { CollabModelSyncState } from "../collab/collabModelSyncController";
import CollabPresenceController, {
  type CollabPresenceCursorMap,
  type CollabPresenceState,
  type CollabPresenceTransport,
} from "../collab/collabPresenceController";
import type { CollabTransportSnapshot } from "../collab/p2pSessionTransport";
import {
  createEmptyCircuitProject,
  createTextNote,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";
import { canvasToScreen } from "../utils/coordinateSystem";
import { buildCircuitLibraryDocument } from "../utils/libraryStorage";
import { createWire } from "../utils/wireUtils";

import CircuitCanvas from "../components/circuitCanvas";
import CircuitSymbolView from "../components/circuitCanvas/circuitSymbolView";
import CollabCursorOverlay from "../components/circuitCanvas/collabCursorOverlay";
import TextNoteView from "../components/circuitCanvas/textNoteView";

function createSyncState(overrides: Partial<CollabModelSyncState> = {}): CollabModelSyncState {
  return {
    syncStatus: "synced",
    revision: 4,
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
    sessionId: "sess-presence-ui",
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
    selfParticipant: null,
    raisedHandCount: 0,
    activeInvites: [],
    pendingInviteLink: null,
    lastError: null,
    lastRejectionMessage: null,
    sessionClosedNotice: null,
    isParticipantsPanelOpen: false,
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
    getRemoteCursors: () => ({}),
    subscribeRemoteCursors: () => () => undefined,
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

describe("T-103: Entkoppeltes Cursor-Overlay, Fremd-Selektion & farbige Soft-Locks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rendert Remote-Cursor gefiltert nach Schaltplan, mit Welt->Bildschirm-Koordinaten, Teilnehmerfarbe und Idle-Ausblendung", () => {
    const baseNow = 50_000;
    const cursors: CollabPresenceCursorMap = {
      "peer-self": {
        peerId: "peer-self",
        x: 50,
        y: 50,
        logicalCircuitId: "lc-main",
        lastMovedAt: baseNow,
      },
      "peer-host": {
        peerId: "peer-host",
        x: 120,
        y: 80,
        logicalCircuitId: "lc-main",
        lastMovedAt: baseNow,
      },
      "peer-guest": {
        peerId: "peer-guest",
        x: 300,
        y: 200,
        logicalCircuitId: "lc-other",
        lastMovedAt: baseNow,
      },
    };
    const presenceState: CollabPresenceState = {
      version: 1,
      peers: {
        "peer-host": {
          peerId: "peer-host",
          logicalCircuitId: "lc-main",
          inLibraryMode: false,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: baseNow,
        },
        "peer-guest": {
          peerId: "peer-guest",
          logicalCircuitId: "lc-other",
          inLibraryMode: false,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: baseNow,
        },
      },
    };

    const viewport = { panX: 40, panY: 20, zoom: 1.5 };
    const expectedScreen = canvasToScreen({ x: 120, y: 80 }, viewport);
    const collab = createCollabStub({
      presenceState,
      getRemoteCursors: () => cursors,
      getParticipantColor: (peerId) => (peerId === "peer-host" ? "#e11d48" : "#0891b2"),
    });

    const htmlActive = renderToStaticMarkup(
      <CollabContext.Provider value={collab}>
        <CollabCursorOverlay
          viewport={viewport}
          activeCircuitId="lc-main"
          idleTimeoutSec={10}
          now={() => baseNow + 9000}
        />
      </CollabContext.Provider>,
    );

    expect(htmlActive).toContain("data-testid=\"collab-cursor-overlay\"");
    expect(htmlActive).toContain("data-testid=\"collab-remote-cursor-peer-host\"");
    expect(htmlActive).toContain("data-color=\"#e11d48\"");
    expect(htmlActive).toContain(`translate3d(${expectedScreen.x}px, ${expectedScreen.y}px, 0)`);
    expect(htmlActive).toContain("Host");
    expect(htmlActive).not.toContain("collab-remote-cursor-peer-self");
    expect(htmlActive).not.toContain("collab-remote-cursor-peer-guest");

    // Nach Ablauf der 10-Sekunden-Grace-Period wird der regungslose Cursor ausgeblendet
    const htmlIdle = renderToStaticMarkup(
      <CollabContext.Provider value={collab}>
        <CollabCursorOverlay
          viewport={viewport}
          activeCircuitId="lc-main"
          idleTimeoutSec={10}
          now={() => baseNow + 10_000}
        />
      </CollabContext.Provider>,
    );
    expect(htmlIdle).not.toContain("collab-remote-cursor-peer-host");

    // Bei idleTimeoutSec = 0 (Nie ausblenden) bleibt der Cursor dauerhaft sichtbar
    const htmlNeverIdle = renderToStaticMarkup(
      <CollabContext.Provider value={collab}>
        <CollabCursorOverlay
          viewport={viewport}
          activeCircuitId="lc-main"
          idleTimeoutSec={0}
          now={() => baseNow + 120_000}
        />
      </CollabContext.Provider>,
    );
    expect(htmlNeverIdle).toContain("data-testid=\"collab-remote-cursor-peer-host\"");

    // Im lokalen Bibliotheksmodus sowie bei Remote-Peer im Bibliotheksmodus bleibt der Cursor verborgen
    const htmlLocalLibrary = renderToStaticMarkup(
      <CollabContext.Provider value={collab}>
        <CollabCursorOverlay
          viewport={viewport}
          activeCircuitId="lc-main"
          isEditingLibrary={true}
          idleTimeoutSec={10}
          now={() => baseNow}
        />
      </CollabContext.Provider>,
    );
    expect(htmlLocalLibrary).not.toContain("data-testid=\"collab-cursor-overlay\"");
    expect(htmlLocalLibrary).not.toContain("collab-remote-cursor-");

    const collabRemoteLibrary = createCollabStub({
      ...collab,
      presenceState: {
        version: 2,
        peers: {
          ...presenceState.peers,
          "peer-host": {
            ...presenceState.peers["peer-host"],
            inLibraryMode: true,
          },
        },
      },
    });
    const htmlRemoteLibrary = renderToStaticMarkup(
      <CollabContext.Provider value={collabRemoteLibrary}>
        <CollabCursorOverlay
          viewport={viewport}
          activeCircuitId="lc-main"
          idleTimeoutSec={10}
          now={() => baseNow}
        />
      </CollabContext.Provider>,
    );
    expect(htmlRemoteLibrary).not.toContain("collab-remote-cursor-peer-host");

    // Sichtbarkeitsmodi filtern nach Rolle und gehobener Hand; aktiv verfolgte Teilnehmer bleiben sichtbar
    const nowMs = Date.now();
    const filterCursors: CollabPresenceCursorMap = {
      "peer-host": { peerId: "peer-host", x: 50, y: 50, logicalCircuitId: "lc-main", lastMovedAt: nowMs },
      "peer-collab": { peerId: "peer-collab", x: 90, y: 60, logicalCircuitId: "lc-main", lastMovedAt: nowMs },
      "peer-guest-quiet": { peerId: "peer-guest-quiet", x: 130, y: 70, logicalCircuitId: "lc-main", lastMovedAt: nowMs },
      "peer-guest-hand": { peerId: "peer-guest-hand", x: 170, y: 80, logicalCircuitId: "lc-main", lastMovedAt: nowMs },
    };
    const filterPresence: CollabPresenceState = {
      version: 3,
      peers: {
        "peer-host": {
          peerId: "peer-host",
          logicalCircuitId: "lc-main",
          inLibraryMode: false,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: nowMs,
        },
        "peer-collab": {
          peerId: "peer-collab",
          logicalCircuitId: "lc-main",
          inLibraryMode: false,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: nowMs,
        },
        "peer-guest-quiet": {
          peerId: "peer-guest-quiet",
          logicalCircuitId: "lc-main",
          inLibraryMode: false,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: nowMs,
        },
        "peer-guest-hand": {
          peerId: "peer-guest-hand",
          logicalCircuitId: "lc-main",
          inLibraryMode: false,
          selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
          openDialog: null,
          viewport: null,
          updatedAt: nowMs,
        },
      },
    };
    const filterCollab = createCollabStub({
      participants: [
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
          peerId: "peer-host",
          displayName: "Host",
          role: "host",
          isSelf: false,
          connectionState: "connected",
          handRaised: false,
          nameLocked: false,
        },
        {
          peerId: "peer-collab",
          displayName: "Clara",
          role: "collaborator",
          isSelf: false,
          connectionState: "connected",
          handRaised: false,
          nameLocked: false,
        },
        {
          peerId: "peer-guest-quiet",
          displayName: "Gerd",
          role: "guest",
          isSelf: false,
          connectionState: "connected",
          handRaised: false,
          nameLocked: false,
        },
        {
          peerId: "peer-guest-hand",
          displayName: "Hanna",
          role: "guest",
          isSelf: false,
          connectionState: "connected",
          handRaised: true,
          nameLocked: false,
        },
      ],
      presenceState: filterPresence,
      getRemoteCursors: () => filterCursors,
      followingPeerId: "peer-guest-quiet",
    });

    const htmlCollabAndHand = renderToStaticMarkup(
      <CollabContext.Provider value={filterCollab}>
        <CollabCursorOverlay
          viewport={viewport}
          activeCircuitId="lc-main"
          visibilityMode="collaborators-and-raised-hand"
          now={() => nowMs}
        />
      </CollabContext.Provider>,
    );
    expect(htmlCollabAndHand).toContain("collab-remote-cursor-peer-host");
    expect(htmlCollabAndHand).toContain("collab-remote-cursor-peer-collab");
    expect(htmlCollabAndHand).toContain("collab-remote-cursor-peer-guest-hand");
    // Verfolgter Gast bleibt auch bei aktivem Filter sichtbar
    expect(htmlCollabAndHand).toContain("collab-remote-cursor-peer-guest-quiet");

    const htmlRaisedHandOnly = renderToStaticMarkup(
      <CollabContext.Provider value={createCollabStub({ ...filterCollab, followingPeerId: null })}>
        <CollabCursorOverlay
          viewport={viewport}
          activeCircuitId="lc-main"
          visibilityMode="raised-hand"
          now={() => nowMs}
        />
      </CollabContext.Provider>,
    );
    expect(htmlRaisedHandOnly).not.toContain("collab-remote-cursor-peer-host");
    expect(htmlRaisedHandOnly).not.toContain("collab-remote-cursor-peer-collab");
    expect(htmlRaisedHandOnly).not.toContain("collab-remote-cursor-peer-guest-quiet");
    expect(htmlRaisedHandOnly).toContain("collab-remote-cursor-peer-guest-hand");
  });

  it("zeigt Fremd-Selektionen und Soft-Locks auf Symbolen und Textnotizen in Teilnehmerfarbe ohne doppeltes Badge", () => {
    const project = createEmptyCircuitProject();
    const mainCircuit = project.logicalCircuits[0];
    const instantiated = instantiateCircuitFromPalette(
      project,
      mainCircuit.logicalCircuitId,
      { type: "and", name: "AND", inputCount: 2 },
      { x: 4, y: 4 },
    );
    const symbol = instantiated.circuitSymbol;
    const note = createTextNote(mainCircuit.logicalCircuitId, 10, 10, "Hinweis");

    const owners: CollabRemoteSelectionOwner[] = [
      { peerId: "peer-1", displayName: "Clara", color: "#2563eb", hasOpenDialog: true },
      { peerId: "peer-2", displayName: "Gustav", color: "#059669" },
    ];

    const symbolSelectionHtml = renderToStaticMarkup(
      <SimulationContextProvider>
        <svg>
          <CircuitSymbolView symbol={symbol} foreignSelections={owners} />
        </svg>
      </SimulationContextProvider>,
    );
    expect(symbolSelectionHtml).toContain("data-foreign-selected=\"true\"");
    expect(symbolSelectionHtml).toContain("data-foreign-selected-by=\"Clara, Gustav\"");
    expect(symbolSelectionHtml).toContain("foreign-selection-box");
    expect(symbolSelectionHtml).toContain("✎ Clara +1");
    expect(symbolSelectionHtml).toContain("stroke:#2563eb");

    const noteSelectionHtml = renderToStaticMarkup(
      <svg>
        <TextNoteView textNote={note} foreignSelections={[owners[1]]} />
      </svg>,
    );
    expect(noteSelectionHtml).toContain("data-foreign-selected=\"true\"");
    expect(noteSelectionHtml).toContain("Gustav");
    expect(noteSelectionHtml).toContain("stroke:#059669");

    // Bei aktivem Soft-Lock trägt der Lock-Rahmen die lokale Teilnehmerfarbe; doppeltes Selektions-Badge wird unterdrückt
    const lock: CollabSoftLockEntry = {
      lockId: "lock-1",
      targetType: "symbol",
      targetId: symbol.circuitSymbolId,
      logicalCircuitId: mainCircuit.logicalCircuitId,
      ownerPeerId: "peer-1",
      ownerDisplayName: "Clara",
      reason: "drag",
      acquiredAt: 1000,
      expiresAt: 15_000,
    };
    const lockedHtml = renderToStaticMarkup(
      <SimulationContextProvider>
        <svg>
          <CircuitSymbolView
            symbol={symbol}
            foreignLock={lock}
            foreignLockColor="#7c3aed"
            foreignSelections={[owners[0]]}
          />
        </svg>
      </SimulationContextProvider>,
    );
    expect(lockedHtml).toContain("data-foreign-locked=\"true\"");
    expect(lockedHtml).toContain("data-lock-color=\"#7c3aed\"");
    expect(lockedHtml).toContain("stroke:#7c3aed");
    expect(lockedHtml).not.toContain("class=\"foreign-selection-box\"");
    expect(lockedHtml).not.toContain("data-foreign-selected=\"true\"");
  });

  it("rendert im CircuitCanvas fremde Leitungs-Selektionen, geöffnete Eigenschaftsdialoge, farbige Soft-Locks und Cursor-Overlay außerhalb des SVGs", () => {
    const project = createEmptyCircuitProject();
    const mainCircuit = project.logicalCircuits[0];
    const instantiated = instantiateCircuitFromPalette(
      project,
      mainCircuit.logicalCircuitId,
      { type: "button", name: "Taster", notation: "T1" },
      { x: 6, y: 6 },
    );
    const symbol = instantiated.circuitSymbol;
    const note = createTextNote(mainCircuit.logicalCircuitId, 14, 6, "Notiz");
    const wire = createWire(mainCircuit.logicalCircuitId, { x: 2, y: 2 }, { x: 8, y: 2 });
    mainCircuit.circuitSymbols.push(symbol);
    mainCircuit.textNotes.push(note);
    mainCircuit.wires.push(wire);

    const presenceState: CollabPresenceState = {
      version: 3,
      peers: {
        "peer-host": {
          peerId: "peer-host",
          logicalCircuitId: mainCircuit.logicalCircuitId,
          inLibraryMode: false,
          selection: {
            symbolIds: [],
            textNoteIds: [note.textNoteId],
            wireIds: [wire.wireId],
          },
          openDialog: {
            kind: "symbol-properties",
            targetId: symbol.circuitSymbolId,
            logicalCircuitId: mainCircuit.logicalCircuitId,
          },
          viewport: { centerX: 100, centerY: 100, zoom: 1 },
          updatedAt: 1000,
        },
      },
    };
    const cursors: CollabPresenceCursorMap = {
      "peer-host": {
        peerId: "peer-host",
        x: 150,
        y: 120,
        logicalCircuitId: mainCircuit.logicalCircuitId,
        lastMovedAt: Date.now(),
      },
    };

    const collab = createCollabStub({
      presenceState,
      getParticipantColor: () => "#ea580c",
      getRemoteCursors: () => cursors,
    });

    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub()}>
            <CanvasContextProvider>
              <CollabContext.Provider value={collab}>
                <CircuitCanvas />
              </CollabContext.Provider>
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    // Fremd-Selektionen für Wire, Textnotiz und Symbol mit offenem Dialog sind sichtbar
    expect(html).toContain(`data-testid="wire-foreign-selection-${wire.wireId}"`);
    expect(html).toContain("data-selected-by=\"Host\"");
    expect(html).toContain("✎ Host");
    expect(html).toContain("#ea580c");

    // Cursor-Overlay liegt als Geschwister-Element nach dem Schaltungs-</svg> und niemals innerhalb des Schaltungs-SVGs
    const schematicSvgStart = html.indexOf("schematic-viewport");
    const schematicSvgClose = html.indexOf("</svg>", schematicSvgStart);
    const cursorOverlayIndex = html.indexOf("data-component=\"CollabCursorOverlay\"");
    expect(schematicSvgStart).toBeGreaterThan(-1);
    expect(schematicSvgClose).toBeGreaterThan(schematicSvgStart);
    expect(cursorOverlayIndex).toBeGreaterThan(schematicSvgClose);
  });

  it("hält subscribeState bei hochfrequenten Remote-Cursor-Updates über CollabPresenceController vollständig ruhig", () => {
    const snapshotListeners = new Set<(snap: CollabTransportSnapshot | null) => void>();
    const messageListeners = new Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>();

    const transport: CollabPresenceTransport = {
      onTransportSnapshot(listener) {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
      },
      onTransportMessage(listener) {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      sendToPeer: () => Promise.resolve(),
      sendToHost: () => Promise.resolve(),
      broadcast: () => Promise.resolve(),
    };

    const controller = new CollabPresenceController({ transport });
    const stateListener = vi.fn();
    const cursorListener = vi.fn();
    controller.subscribeState(stateListener);
    controller.subscribeCursors(cursorListener);

    for (const listener of snapshotListeners) {
      listener({
        state: "connected",
        sessionId: "sess-1",
        selfPeerId: "peer-self",
        selfRole: "collaborator",
        hostPeerId: "peer-host",
        peers: [],
        diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
        gracePeriodMs: 20_000,
        iceServers: [],
      });
    }

    stateListener.mockClear();
    cursorListener.mockClear();

    for (let step = 1; step <= 10; step += 1) {
      for (const listener of messageListeners) {
        listener("peer-host", {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_CURSOR,
          payload: {
            peerId: "peer-host",
            x: step * 15,
            y: step * 10,
            logicalCircuitId: "lc-main",
          },
        });
      }
    }

    expect(cursorListener).toHaveBeenCalledTimes(10);
    expect(stateListener).toHaveBeenCalledTimes(0);
    expect(controller.getCursors()["peer-host"]).toMatchObject({ x: 150, y: 100 });
    controller.dispose();
  });
});
