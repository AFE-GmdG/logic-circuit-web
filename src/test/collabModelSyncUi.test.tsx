import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import { applyDeltaForward } from "../contexts/circuitContext/historyManager";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import CollabContext, { type CollabContextType } from "../contexts/collabContext";
import LibraryContext, { type LibraryContextType } from "../contexts/libraryContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitProject from "../types/circuit/circuitProject";
import type CollabRole from "../types/collab/collabRole";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type { CollabCircuitCommitPayload, CollabHighlightIds, CollabSoftLockEntry } from "../types/collab/modelSyncMessage";
import type CircuitDelta from "../types/history/circuitDelta";
import type { LibraryPersistenceState } from "../types/storage/circuitLibrary";

import CollabModelSyncController, {
  type CollabModelSyncState,
  type CollabModelSyncTransport,
} from "../collab/collabModelSyncController";
import type { CollabTransportSnapshot } from "../collab/p2pSessionTransport";
import {
  createEmptyCircuitProject,
  createTextNote,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";
import { buildCircuitLibraryDocument } from "../utils/libraryStorage";

import MainMenu from "../components/app/mainMenu";
import { buildCanvasContextMenuItems } from "../components/circuitCanvas/canvasContextMenu";
import CircuitSymbolView from "../components/circuitCanvas/circuitSymbolView";
import TextNoteModal from "../components/circuitCanvas/textNoteModal";
import TextNoteView from "../components/circuitCanvas/textNoteView";
import CollabWorkspaceOverlay from "../components/collab/collabWorkspaceOverlay";
import ResyncWarningDialog from "../components/collab/resyncWarningDialog";
import ComponentPalette from "../components/componentPalette";
import PropertyDialog from "../components/propertyDialog";

const noop = () => undefined;

function createSyncState(overrides: Partial<CollabModelSyncState> = {}): CollabModelSyncState {
  return {
    syncStatus: "synced",
    revision: 5,
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
    sessionId: "sess-ui-1",
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

function createSampleSymbol() {
  const project = createEmptyCircuitProject();
  const mainCircuit = project.logicalCircuits[0];
  const instantiated = instantiateCircuitFromPalette(
    project,
    mainCircuit.logicalCircuitId,
    { type: "button", name: "A", notation: "A" },
    { x: 4, y: 4 },
  );
  const symbol = instantiated.circuitSymbol;
  mainCircuit.circuitSymbols.push(symbol);
  return { project, mainCircuit, symbol };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 15));
}

describe("T-101: Editor-UI für Soft-Locks, Gast-Read-Only, Resync- & Konfliktfeedback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("kennzeichnet fremdgelockte Bausteine und Textnotizen mit Soft-Lock-Rahmen und versteckt Resize-Anfasser", () => {
    const { symbol, mainCircuit } = createSampleSymbol();
    const note = createTextNote(mainCircuit.logicalCircuitId, 10, 10, "Notiz");
    const foreignLock: CollabSoftLockEntry = {
      lockId: "lock-sym-1",
      targetType: "symbol",
      targetId: symbol.circuitSymbolId,
      logicalCircuitId: mainCircuit.logicalCircuitId,
      ownerPeerId: "peer-bob",
      ownerDisplayName: "Bob",
      reason: "drag",
      acquiredAt: 1000,
      expiresAt: 15_000,
    };

    const lockedSymbolHtml = renderToStaticMarkup(
      <SimulationContextProvider>
        <svg>
          <CircuitSymbolView
            symbol={symbol}
            isSelected={true}
            isOnlySelected={true}
            foreignLock={foreignLock}
          />
        </svg>
      </SimulationContextProvider>,
    );
    expect(lockedSymbolHtml).toContain("data-foreign-locked=\"true\"");
    expect(lockedSymbolHtml).toContain("data-locked-by=\"Bob\"");
    expect(lockedSymbolHtml).toContain("class=\"soft-lock-box\"");
    expect(lockedSymbolHtml).toContain("🔒 Bob");
    expect(lockedSymbolHtml).toContain("Wird gerade von Bob bearbeitet");
    expect(lockedSymbolHtml).not.toContain("class=\"resize-markers\"");

    // Getrennte visuelle Darstellung gegenüber Host-MCP-AI-Highlight
    const aiSymbolHtml = renderToStaticMarkup(
      <SimulationContextProvider>
        <svg>
          <CircuitSymbolView
            symbol={symbol}
            isAiHighlighted={true}
            foreignLock={null}
          />
        </svg>
      </SimulationContextProvider>,
    );
    expect(aiSymbolHtml).toContain("data-ai-highlighted=\"true\"");
    expect(aiSymbolHtml).toContain("class=\"ai-highlight-box\"");
    expect(aiSymbolHtml).not.toContain("class=\"soft-lock-box\"");

    const lockedNoteHtml = renderToStaticMarkup(
      <svg>
        <TextNoteView
          textNote={note}
          isSelected={true}
          isOnlySelected={true}
          foreignLock={{ ...foreignLock, targetType: "textNote", targetId: note.textNoteId }}
        />
      </svg>,
    );
    expect(lockedNoteHtml).toContain("data-foreign-locked=\"true\"");
    expect(lockedNoteHtml).toContain("class=\"soft-lock-box\"");
    expect(lockedNoteHtml).toContain("🔒 Bob");
    expect(lockedNoteHtml).not.toContain("class=\"resize-markers\"");
  });

  it("sperrt mutierende Kontextmenü-Einträge bei Soft-Lock oder Gast-Read-Only, belässt Kopieren & Eigenschaften aktiv", () => {
    const { symbol } = createSampleSymbol();
    const target = {
      kind: "symbol" as const,
      symbol,
      gridPoint: { x: 4, y: 4 },
      screenX: 100,
      screenY: 100,
    };

    const lockedItems = buildCanvasContextMenuItems({
      target,
      selectedCount: 1,
      canPaste: true,
      hasCircuitElements: true,
      canRotateSelection: true,
      isReadOnly: false,
      lockedByDisplayName: "Bob",
      onCut: noop,
      onCopy: noop,
      onPasteAt: noop,
      onDeleteSelected: noop,
      onSelectAll: noop,
      onRotateRight: noop,
      onRotateLeft: noop,
      onOpenSubCircuit: noop,
      onEditSymbol: noop,
      onEditTextNote: noop,
      onEditCurrentCircuit: noop,
      onSelectConductor: noop,
      onSplitWire: noop,
    });

    expect(lockedItems.find((i) => i.id === "ctx-cut")?.disabled).toBe(true);
    expect(lockedItems.find((i) => i.id === "ctx-delete")?.disabled).toBe(true);
    expect(lockedItems.find((i) => i.id === "ctx-rotate-right")?.disabled).toBe(true);
    expect(lockedItems.find((i) => i.id === "ctx-cut")?.tooltip).toContain("Bob");
    expect(lockedItems.find((i) => i.id === "ctx-copy")?.disabled).toBeFalsy();
    expect(lockedItems.find((i) => i.id === "ctx-properties")?.disabled).toBeFalsy();

    const guestCanvasItems = buildCanvasContextMenuItems({
      target: { kind: "canvas", gridPoint: { x: 1, y: 1 }, screenX: 10, screenY: 10 },
      selectedCount: 0,
      canPaste: true,
      hasCircuitElements: true,
      canRotateSelection: false,
      isReadOnly: true,
      lockedByDisplayName: null,
      onCut: noop,
      onCopy: noop,
      onPasteAt: noop,
      onDeleteSelected: noop,
      onSelectAll: noop,
      onRotateRight: noop,
      onRotateLeft: noop,
      onOpenSubCircuit: noop,
      onEditSymbol: noop,
      onEditTextNote: noop,
      onEditCurrentCircuit: noop,
      onSelectConductor: noop,
      onSplitWire: noop,
    });
    expect(guestCanvasItems.find((i) => i.id === "canvas-paste")?.disabled).toBe(true);
    expect(guestCanvasItems.find((i) => i.id === "canvas-select-all")?.disabled).toBe(false);
    expect(guestCanvasItems.find((i) => i.id === "canvas-properties")?.disabled).toBeFalsy();
  });

  it("zeigt Lock- und Gast-Read-Only-Banner in PropertyDialog & TextNoteModal und lässt lokalen Bibliotheksmodus editierbar", () => {
    const { project, mainCircuit, symbol } = createSampleSymbol();
    const note = createTextNote(mainCircuit.logicalCircuitId, 10, 10, "Testnotiz");

    const foreignLock: CollabSoftLockEntry = {
      lockId: "lock-prop-1",
      targetType: "symbol",
      targetId: symbol.circuitSymbolId,
      logicalCircuitId: mainCircuit.logicalCircuitId,
      ownerPeerId: "peer-bob",
      ownerDisplayName: "Bob",
      reason: "property-dialog",
      acquiredAt: 1000,
      expiresAt: 15_000,
    };

    const lockedPropertyHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub({ isEditingLibrary: false })}>
            <CollabContext.Provider
              value={createCollabStub({
                modelSyncState: createSyncState({ softLocks: [foreignLock] }),
              })}
            >
              <PropertyDialog isOpen={true} symbol={symbol} onClose={noop} />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(lockedPropertyHtml).toContain("data-testid=\"property-dialog-lock-banner\"");
    expect(lockedPropertyHtml).toContain("Bob");
    expect(lockedPropertyHtml).toMatch(/<button[^>]*class="btn btn-primary"[^>]*disabled=""/);

    const guestPropertyHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub({ isEditingLibrary: false })}>
            <CollabContext.Provider
              value={createCollabStub({
                selfRole: "guest",
                modelSyncState: createSyncState({ isReadOnlyForGuest: true }),
              })}
            >
              <PropertyDialog isOpen={true} symbol={symbol} onClose={noop} />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(guestPropertyHtml).toContain("data-testid=\"property-dialog-readonly-banner\"");
    expect(guestPropertyHtml).toMatch(/<button[^>]*class="btn btn-primary"[^>]*disabled=""/);

    // Im lokalen Bibliotheksmodus darf auch ein Gast uneingeschränkt editieren
    const guestLibraryPropertyHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub({ isEditingLibrary: true })}>
            <CollabContext.Provider
              value={createCollabStub({
                selfRole: "guest",
                modelSyncState: createSyncState({ isReadOnlyForGuest: true, softLocks: [foreignLock] }),
              })}
            >
              <PropertyDialog isOpen={true} symbol={symbol} onClose={noop} />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(guestLibraryPropertyHtml).not.toContain("data-testid=\"property-dialog-readonly-banner\"");
    expect(guestLibraryPropertyHtml).not.toContain("data-testid=\"property-dialog-lock-banner\"");

    const lockedNoteModalHtml = renderToStaticMarkup(
      <LibraryContext.Provider value={createLibraryStub({ isEditingLibrary: false })}>
        <CollabContext.Provider
          value={createCollabStub({
            modelSyncState: createSyncState({
              softLocks: [{ ...foreignLock, targetType: "textNote", targetId: note.textNoteId }],
            }),
          })}
        >
          <TextNoteModal isOpen={true} textNote={note} onSave={noop} onClose={noop} />
        </CollabContext.Provider>
      </LibraryContext.Provider>,
    );
    expect(lockedNoteModalHtml).toContain("data-testid=\"text-note-lock-banner\"");
    expect(lockedNoteModalHtml).toContain("readOnly=\"\"");
    expect(lockedNoteModalHtml).toMatch(/<button[^>]*class="btn btn-primary"[^>]*disabled=""/);
  });

  it("deaktiviert Palette und MainMenu für Gäste im gemeinsamen Projekt bei weiter zugänglicher Bibliothek", () => {
    const { project } = createSampleSymbol();

    const guestPaletteProjectHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub({ activeSidebarTab: "project", isEditingLibrary: false })}>
            <CollabContext.Provider
              value={createCollabStub({
                selfRole: "guest",
                modelSyncState: createSyncState({ isReadOnlyForGuest: true }),
              })}
            >
              <ComponentPalette />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(guestPaletteProjectHtml).toMatch(/class="new-circuit-button"[^>]*disabled=""/);
    expect(guestPaletteProjectHtml).toContain("draggable=\"false\"");
    expect(guestPaletteProjectHtml).not.toContain("draggable=\"true\"");

    // Gast wechselt auf den Bibliotheks-Tab -> eigene Bibliothek bleibt benutzbar
    const guestPaletteLibraryHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={createLibraryStub({ activeSidebarTab: "library", isEditingLibrary: false })}>
            <CollabContext.Provider
              value={createCollabStub({
                selfRole: "guest",
                modelSyncState: createSyncState({ isReadOnlyForGuest: true }),
              })}
            >
              <ComponentPalette />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(guestPaletteLibraryHtml).toContain("data-component=\"LibraryView\"");

    const guestEditMenuHtml = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="edit"
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={true}
        canRedo={true}
        hasSelection={true}
        hasSymbolSelection={true}
        hasCircuitElements={true}
        canPaste={true}
        canDeleteCurrentCircuit={true}
        isCollabInSession={true}
        isCollabHost={false}
        isCollabReadOnly={true}
        isCollabNonHost={true}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onCut={noop}
        onCopy={noop}
        onPaste={noop}
        onSelectAll={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );
    expect(guestEditMenuHtml).toMatch(/disabled=""[^>]*>.*Rückgängig/s);
    expect(guestEditMenuHtml).toMatch(/disabled=""[^>]*>.*Einfügen/s);
    expect(guestEditMenuHtml).toContain("Kopieren");
  });

  it("rendert Feedback-Banner für Handover-Quiesce, Sync-Rollback, räumlichen Undo-Konflikt, Soft-Lock und ResyncWarningDialog", () => {
    const project = createEmptyCircuitProject();
    const overlayHtml = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project}>
          <LibraryContext.Provider value={createLibraryStub({ isEditingLibrary: false })}>
            <CollabContext.Provider
              value={createCollabStub({
                selfRole: "guest",
                softLockBlockedNotice: {
                  lockId: "lock-sym-1",
                  targetType: "symbol",
                  targetId: "sym-1",
                  logicalCircuitId: "main",
                  ownerPeerId: "peer-bob",
                  ownerDisplayName: "Bob",
                  reason: "drag",
                  acquiredAt: 1000,
                  expiresAt: 15_000,
                },
                modelSyncState: createSyncState({
                  isQuiesced: true,
                  quiesceReason: "host-handover",
                  isReadOnlyForGuest: true,
                  lastSyncRejection: {
                    mutationId: "mut-1",
                    code: "conflict",
                    message: "Abgelehnt wegen Revisionskonflikt.",
                    hostRevision: 7,
                    requiresResync: false,
                  },
                  lastUndoConflict: {
                    direction: "undo",
                    code: "spatial-collision",
                    message: "Zielposition belegt",
                    logicalCircuitId: "main",
                    conflictingEntityIds: ["sym-1"],
                    preservedEntry: true,
                  },
                }),
              })}
            >
              <CollabWorkspaceOverlay />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    expect(overlayHtml).toContain("data-testid=\"collab-handover-quiesce-banner\"");
    expect(overlayHtml).toContain("data-testid=\"collab-sync-rejection-banner\"");
    expect(overlayHtml).toContain("Abgelehnt wegen Revisionskonflikt.");
    expect(overlayHtml).toContain("data-testid=\"collab-undo-conflict-banner\"");
    expect(overlayHtml).toContain("Zielposition wird bereits von einem anderen Baustein belegt");
    expect(overlayHtml).toContain("data-testid=\"collab-soft-lock-notice-banner\"");
    expect(overlayHtml).toContain("Bob");
    expect(overlayHtml).toContain("data-testid=\"collab-guest-readonly-badge\"");
    expect(overlayHtml).toContain("data-testid=\"collab-guest-readonly-close-btn\"");

    // Im Bibliotheksmodus wird das Gast-Read-Only-Badge ausgeblendet
    const libraryOverlayHtml = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project}>
          <LibraryContext.Provider value={createLibraryStub({ isEditingLibrary: true })}>
            <CollabContext.Provider
              value={createCollabStub({
                selfRole: "guest",
                modelSyncState: createSyncState({ isReadOnlyForGuest: true }),
              })}
            >
              <CollabWorkspaceOverlay />
            </CollabContext.Provider>
          </LibraryContext.Provider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );
    expect(libraryOverlayHtml).not.toContain("data-testid=\"collab-guest-readonly-badge\"");

    const resyncHtml = renderToStaticMarkup(
      <ResyncWarningDialog
        isOpen={true}
        reason="revision-gap"
        unconfirmedLocalChangesCount={3}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(resyncHtml).toContain("data-testid=\"resync-warning-reason\"");
    expect(resyncHtml).toContain("data-testid=\"resync-unconfirmed-count\"");
    expect(resyncHtml).toContain("3");
  });

  it("empfängt eingehende MCP-Commits mit origin=\"mcp\" und Highlight-IDs zur Weiterleitung an highlightAiElements", async () => {
    const project = createEmptyCircuitProject();
    const mainCircuitId = project.logicalCircuits[0].logicalCircuitId;

    type PeerNode = {
      peerId: string;
      role: CollabRole;
      connected: boolean;
      project: CircuitProject;
      editingLibrary: boolean;
      remoteCommits: CollabCircuitCommitPayload[];
      snapshotListeners: Set<(snap: CollabTransportSnapshot | null) => void>;
      messageListeners: Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>;
      controller: CollabModelSyncController;
    };

    const nodes = new Map<string, PeerNode>();
    const highlightCalls: CollabHighlightIds[] = [];

    const deliver = async (fromPeerId: string, toPeerId: string, msg: CollabDataChannelMessage) => {
      await Promise.resolve();
      const target = nodes.get(toPeerId);
      if (!target) {
        return;
      }
      for (const listener of target.messageListeners) {
        listener(fromPeerId, msg);
      }
      await Promise.resolve();
      await Promise.resolve();
    };

    const createTransport = (selfPeerId: string): CollabModelSyncTransport => ({
      onTransportSnapshot(listener) {
        nodes.get(selfPeerId)!.snapshotListeners.add(listener);
        return () => nodes.get(selfPeerId)!.snapshotListeners.delete(listener);
      },
      onTransportMessage(listener) {
        nodes.get(selfPeerId)!.messageListeners.add(listener);
        return () => nodes.get(selfPeerId)!.messageListeners.delete(listener);
      },
      sendToPeer: (peerId, msg) => deliver(selfPeerId, peerId, msg),
      sendToHost: (msg) => deliver(selfPeerId, "host", msg),
      broadcast: async (msg, excludePeerId) => {
        for (const [peerId, peer] of nodes.entries()) {
          if (peerId !== selfPeerId && peerId !== excludePeerId && peer.connected) {
            await deliver(selfPeerId, peerId, msg);
          }
        }
      },
      requestResync: async () => true,
      setResyncHooks: () => {},
      setBeforeTransferHostHook: () => {},
    });

    const spawnPeer = (peerId: string, role: CollabRole) => {
      const node: PeerNode = {
        peerId,
        role,
        connected: true,
        project: structuredClone(project),
        editingLibrary: false,
        remoteCommits: [],
        snapshotListeners: new Set(),
        messageListeners: new Set(),
        controller: null as unknown as CollabModelSyncController,
      };
      nodes.set(peerId, node);
      node.controller = new CollabModelSyncController({
        transport: createTransport(peerId),
        adapter: {
          getVisibleProject: () => node.project,
          applyAuthoritativeProject: (next) => {
            node.project = next;
          },
          isEditingLibrary: () => node.editingLibrary,
          getLibraryBackgroundProject: () => null,
          setLibraryBackgroundProject: () => {},
          onRemoteCommitApplied: (commit) => {
            node.remoteCommits.push(commit);
            if (commit.origin === "mcp" && !node.editingLibrary && commit.highlightIds) {
              highlightCalls.push(commit.highlightIds);
            }
          },
        },
      });
      return node;
    };

    const host = spawnPeer("host", "host");
    const peer = spawnPeer("guest", "guest");

    const buildSnap = (self: PeerNode): CollabTransportSnapshot => ({
      state: "connected",
      sessionId: "sess-mcp",
      hostPeerId: "host",
      selfPeerId: self.peerId,
      selfRole: self.role,
      gracePeriodMs: 60_000,
      diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
      iceServers: [],
      peers: Array.from(nodes.values())
        .filter((n) => n.peerId !== self.peerId)
        .map((n) => ({
          peerId: n.peerId,
          displayName: n.peerId,
          role: n.role,
          state: "connected",
          diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
          lastHeartbeatAt: 1000,
        })),
    });

    for (const n of nodes.values()) {
      for (const listener of n.snapshotListeners) {
        listener(buildSnap(n));
      }
    }
    await flushMicrotasks();

    const instantiated = instantiateCircuitFromPalette(
      host.project,
      mainCircuitId,
      { type: "and", name: "AND", inputCount: 2 },
      { x: 6, y: 6 },
    );
    const mcpSymbol = instantiated.circuitSymbol;
    const addDelta: CircuitDelta = {
      type: "add",
      logicalCircuitId: mainCircuitId,
      symbols: [{ symbol: mcpSymbol, circuit: instantiated.circuit }],
      textNotes: [],
      wires: [],
    };
    host.project = applyDeltaForward(host.project, addDelta);
    host.controller.runWithMutationOrigin("mcp", () => {
      host.controller.submitLocalDelta(addDelta, host.project);
    });
    await flushMicrotasks();

    expect(host.controller.getState().revision).toBe(1);
    expect(peer.remoteCommits).toHaveLength(1);
    expect(peer.remoteCommits[0].origin).toBe("mcp");
    expect(highlightCalls).toHaveLength(1);
    expect(highlightCalls[0].symbolIds).toEqual([mcpSymbol.circuitSymbolId]);

    host.controller.dispose();
    peer.controller.dispose();
  });
});
