import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import CollabContext, { type CollabContextType } from "../contexts/collabContext";
import LibraryContext, { type LibraryContextType } from "../contexts/libraryContext";
import SimulationContext, {
  DEFAULT_SIMULATION_STATE,
  type SimulationContextType,
} from "../contexts/simulationContext";

import type { LibraryPersistenceState } from "../types/storage/circuitLibrary";

import type { CollabModelSyncState } from "../collab/collabModelSyncController";
import type { CollabPresenceState } from "../collab/collabPresenceController";
import { createEmptyCircuitProject } from "../utils/circuitLayout";
import { getClientVersion } from "../utils/sidecarVersion";

import CollabParticipantsPanel from "../components/collab/collabParticipantsPanel";
import CollabWorkspaceOverlay from "../components/collab/collabWorkspaceOverlay";
import TelemetryFooter from "../components/runningCircuitTree/telemetryFooter";
import StatusBar from "../components/statusBar";

import pkg from "../../package.json" with { type: "json" };

function createSyncState(overrides: Partial<CollabModelSyncState> = {}): CollabModelSyncState {
  return {
    syncStatus: "synced",
    revision: 3,
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
  const defaultPresence: CollabPresenceState = {
    version: 1,
    peers: {
      "peer-host": {
        peerId: "peer-host",
        logicalCircuitId: "main-circuit",
        inLibraryMode: false,
        selection: { symbolIds: [], textNoteIds: [], wireIds: [] },
        openDialog: null,
        viewport: null,
        updatedAt: 1000,
      },
    },
  };

  return {
    isDisabled: false,
    customSidecarRequired: false,
    isInSession: true,
    transportState: "connected",
    diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
    gracePeriodMs: 60_000,
    sessionId: "sess-ui-108",
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
    isParticipantsPanelOpen: true,
    sessionClosedNotice: null,
    lastError: null,
    lastRejectionMessage: null,
    modelSyncState: createSyncState(),
    presenceState: defaultPresence,
    startHostSession: async () => true,
    joinSession: async () => true,
    endOrLeaveSession: () => undefined,
    createInviteLink: async () => null,
    revokeInviteLink: async () => true,
    setParticipantRole: async () => true,
    moderateParticipantName: async () => true,
    renameSelf: async () => true,
    toggleHandRaised: async () => true,
    lowerParticipantHand: async () => true,
    kickParticipant: async () => true,
    transferHostRole: () => true,
    requestResync: async () => true,
    setParticipantsPanelOpen: () => undefined,
    clearPendingInviteLink: () => undefined,
    clearError: () => undefined,
    dismissSessionClosedNotice: () => undefined,
    ...overrides,
  };
}

function createLibraryStub(isEditingLibrary = false): LibraryContextType {
  const emptyPersistence: LibraryPersistenceState = {
    status: "uninitialized",
    isReadOnly: true,
    fileName: null,
    cachedAt: null,
    lastSyncedAt: null,
    document: null,
  };
  return {
    activeSidebarTab: "project",
    setActiveSidebarTab: () => undefined,
    persistenceState: emptyPersistence,
    isLoading: false,
    isResyncWarningDismissed: false,
    dismissResyncWarning: () => undefined,
    libraryError: null,
    clearLibraryError: () => undefined,
    builtInItems: [],
    builtInCircuits: [],
    userCircuits: [],
    isWritable: false,
    editingLibraryCircuitId: isEditingLibrary ? "lib-1" : null,
    isEditingLibrary,
    openLibraryFile: async () => false,
    openLibraryFromText: () => false,
    createLibraryFile: async () => false,
    resyncLibrary: async () => false,
    unlinkLibrary: async () => undefined,
    reloadInitialLibrary: async () => undefined,
    addProjectCircuitToLibrary: async () => null,
    duplicateBuiltInToLibrary: async () => null,
    updateLibraryCircuitMetadata: async () => false,
    getLibraryDeletionDependents: () => [],
    deleteLibraryCircuits: async () => ({ deletedIds: [], blockedByDependents: [], updatedProject: false }),
    importCircuitsIntoLibrary: async () => 0,
    exportLibraryCircuitNative: () => false,
    exportLibraryCircuitXml: () => false,
    exportLibraryDocument: () => false,
    enterLibraryEditMode: async () => false,
    saveLibraryEditSession: async () => false,
    exitLibraryEditMode: async () => undefined,
    getSavedSessionProject: () => null,
    updateSavedSessionProject: () => undefined,
  };
}

function createSimStub(overrides: Partial<SimulationContextType> = {}): SimulationContextType {
  return {
    ...DEFAULT_SIMULATION_STATE,
    isSimulating: true,
    isRunning: true,
    isCollabSnapshotSimulation: true,
    ...overrides,
  };
}

describe("T-108: Kollaborative Snapshot-Simulation UI-Hinweise & Version 1.2.0-rc", () => {
  it("rendert Snapshot-Simulations- und Team-Änderungs-Banner in CollabWorkspaceOverlay samt Stop-Button", () => {
    const project = createEmptyCircuitProject("OverlayTest", "Main", "main-circuit");

    // Aktive Snapshot-Simulation ohne gepufferte Team-Änderungen
    const activeHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <LibraryContext.Provider value={createLibraryStub(false)}>
            <CanvasContextProvider>
              <CollabContext.Provider
                value={createCollabStub({
                  modelSyncState: createSyncState({
                    isLocalSimulationBuffered: true,
                    pendingSimulationDeltaCount: 0,
                  }),
                })}
              >
                <CollabWorkspaceOverlay />
              </CollabContext.Provider>
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(activeHtml).toContain("data-testid=\"collab-snapshot-sim-banner\"");
    expect(activeHtml).toContain("data-has-pending-updates=\"false\"");
    expect(activeHtml).toContain("Lokale Snapshot-Simulation");
    expect(activeHtml).not.toContain("data-testid=\"collab-snapshot-sim-stop-btn\"");

    // Singular: 1 gepufferte Team-Änderung -> Warnbanner + Direkt-Button
    const oneDeltaHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <LibraryContext.Provider value={createLibraryStub(false)}>
            <CanvasContextProvider>
              <CollabContext.Provider
                value={createCollabStub({
                  modelSyncState: createSyncState({
                    isLocalSimulationBuffered: true,
                    pendingSimulationDeltaCount: 1,
                  }),
                })}
              >
                <CollabWorkspaceOverlay />
              </CollabContext.Provider>
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(oneDeltaHtml).toContain("data-has-pending-updates=\"true\"");
    expect(oneDeltaHtml).toContain("1 neue Team-Änderung im Hintergrund gepuffert");
    expect(oneDeltaHtml).toContain("data-testid=\"collab-snapshot-sim-stop-btn\"");
    expect(oneDeltaHtml).toContain("Simulation beenden &amp; übernehmen");

    // Plural: 3 gepufferte Team-Änderungen
    const multiDeltaHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <LibraryContext.Provider value={createLibraryStub(false)}>
            <CanvasContextProvider>
              <CollabContext.Provider
                value={createCollabStub({
                  modelSyncState: createSyncState({
                    isLocalSimulationBuffered: true,
                    pendingSimulationDeltaCount: 3,
                  }),
                })}
              >
                <CollabWorkspaceOverlay />
              </CollabContext.Provider>
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(multiDeltaHtml).toContain("3 neue Team-Änderungen im Hintergrund gepuffert");

    // Projektwechsel während Simulation
    const projectSwitchHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <LibraryContext.Provider value={createLibraryStub(false)}>
            <CanvasContextProvider>
              <CollabContext.Provider
                value={createCollabStub({
                  modelSyncState: createSyncState({
                    isLocalSimulationBuffered: true,
                    pendingSimulationDeltaCount: 1,
                    hasPendingProjectSwitchDuringSim: true,
                  }),
                })}
              >
                <CollabWorkspaceOverlay />
              </CollabContext.Provider>
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(projectSwitchHtml).toContain("Host hat das Projekt gewechselt");
    expect(projectSwitchHtml).toContain("data-testid=\"collab-snapshot-sim-stop-btn\"");

    // Ausstehender Resync nach Verbindungsunterbrechung
    const resyncHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <LibraryContext.Provider value={createLibraryStub(false)}>
            <CanvasContextProvider>
              <CollabContext.Provider
                value={createCollabStub({
                  modelSyncState: createSyncState({
                    isLocalSimulationBuffered: true,
                    requiresResyncAfterSimulation: true,
                  }),
                })}
              >
                <CollabWorkspaceOverlay />
              </CollabContext.Provider>
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(resyncHtml).toContain("Nachsynchronisation nach Verbindungsunterbrechung ausstehend");

    // Im lokalen Bibliotheksmodus erscheint das Team-Snapshot-Banner nicht
    const libraryHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub({ isCollabSnapshotSimulation: false })}>
          <LibraryContext.Provider value={createLibraryStub(true)}>
            <CanvasContextProvider>
              <CollabContext.Provider value={createCollabStub()}>
                <CollabWorkspaceOverlay />
              </CollabContext.Provider>
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(libraryHtml).not.toContain("data-testid=\"collab-snapshot-sim-banner\"");
  });

  it("zeigt den Snapshot-Indikator in StatusBar und TelemetryFooter sowie deaktivierte Navigation im CollabParticipantsPanel", () => {
    const project = createEmptyCircuitProject("UiBadgeTest", "Main", "main-circuit");

    const statusIdleSimHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <CanvasContextProvider>
            <StatusBar
              collabOverride={createCollabStub({
                modelSyncState: createSyncState({
                  isLocalSimulationBuffered: true,
                  pendingSimulationDeltaCount: 0,
                }),
              })}
            />
          </CanvasContextProvider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(statusIdleSimHtml).toContain("data-testid=\"status-bar-snapshot-sim-badge\"");
    expect(statusIdleSimHtml).toContain(">Snapshot<");

    const statusPendingHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <CanvasContextProvider>
            <StatusBar
              collabOverride={createCollabStub({
                modelSyncState: createSyncState({
                  isLocalSimulationBuffered: true,
                  pendingSimulationDeltaCount: 2,
                }),
              })}
            />
          </CanvasContextProvider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(statusPendingHtml).toContain("Snapshot · +2");

    const telemetryHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <CanvasContextProvider>
            <CollabContext.Provider
              value={createCollabStub({
                modelSyncState: createSyncState({
                  isLocalSimulationBuffered: true,
                  pendingSimulationDeltaCount: 2,
                }),
              })}
            >
              <TelemetryFooter
                actualFrequency={10}
                frameRateLimit={10}
                totalSteps={42}
                isRunning={true}
                isPaused={false}
                isOscillating={false}
              />
            </CollabContext.Provider>
          </CanvasContextProvider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(telemetryHtml).toContain("data-testid=\"telemetry-snapshot-sim-notice\"");
    expect(telemetryHtml).toContain("Lokaler Snapshot (RAM bleibt lokal)");
    expect(telemetryHtml).toContain("2 Team-Änderungen warten auf Nachzug");

    const panelHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContext.Provider value={createSimStub()}>
          <LibraryContext.Provider value={createLibraryStub(false)}>
            <CollabParticipantsPanel collabOverride={createCollabStub()} />
          </LibraryContext.Provider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(panelHtml).toMatch(/data-testid="collab-jump-peer-host"[^>]*disabled=""/);
    expect(panelHtml).toMatch(/data-testid="collab-follow-peer-host"[^>]*disabled=""/);
    expect(panelHtml).toContain("Während einer laufenden lokalen Simulation nicht verfügbar");
  });

  it("setzt die Projektversion auf das Release 1.2.0", () => {
    expect(pkg.version).toBe("1.2.0");
    expect(getClientVersion()).toBe(pkg.version);
  });
});
