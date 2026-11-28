import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import CollabContext, { type CollabContextType } from "../contexts/collabContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CollabParticipant from "../types/collab/sessionState";
import type { CollabSessionClosedEvent, ParsedCollabInviteLink } from "../types/collab/sessionState";

import { createEmptyCircuitProject } from "../utils/circuitLayout";
import { COLLAB_DISPLAY_NAME_STORAGE_KEY } from "../utils/collabStorage";

import MainMenu from "../components/app/mainMenu";
import CollabParticipantsPanel from "../components/collab/collabParticipantsPanel";
import CollabWorkspaceOverlay from "../components/collab/collabWorkspaceOverlay";
import JoinCollabSessionDialog from "../components/collab/joinCollabSessionDialog";
import SessionEndedDialog from "../components/collab/sessionEndedDialog";
import TransferHostWarningDialog from "../components/collab/transferHostWarningDialog";
import StatusBar from "../components/statusBar";

const noop = () => undefined;

function createCollabStub(overrides: Partial<CollabContextType> = {}): CollabContextType {
  return {
    isDisabled: false,
    customSidecarRequired: false,
    isInSession: false,
    transportState: "idle",
    diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
    gracePeriodMs: 60_000,
    sessionId: null,
    selfPeerId: null,
    selfRole: null,
    hostPeerId: null,
    isHost: false,
    isMcpBlockedByCollab: false,
    activeSidecarUrl: null,
    isEphemeralSidecar: false,
    runtimeConfig: null,
    displayName: "",
    participants: [],
    selfParticipant: null,
    raisedHandCount: 0,
    activeInvites: [],
    pendingInviteLink: null,
    lastError: null,
    lastRejectionMessage: null,
    sessionClosedNotice: null,
    isParticipantsPanelOpen: false,
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

describe("T-097: Beitritts-Dialog (GDPR), Host-Moderation, Handover-Warnung & Session-Ende-UI", () => {
  const originalWindow = (globalThis as { window?: Window & typeof globalThis }).window;
  const originalDisableCollab = process.env.DISABLE_COLLAB;

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
    vi.restoreAllMocks();
  });

  function installMockLocalStorage(initialEntries: Record<string, string> = {}): Map<string, string> {
    const store = new Map<string, string>(Object.entries(initialEntries));
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    (globalThis as { window?: unknown }).window = { localStorage: mockStorage };
    return store;
  }

  it("rendert JoinCollabSessionDialog für manuelle Links, erkannte Hashes mit flüchtigem Sidecar und ungespeicherte Änderungen", () => {
    delete process.env.DISABLE_COLLAB;
    installMockLocalStorage({ [COLLAB_DISPLAY_NAME_STORAGE_KEY]: "Carla" });
    const project = createEmptyCircuitProject();

    // Manueller Beitritt ohne vorerkannten Hash
    const manualHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <JoinCollabSessionDialog
          isOpen={true}
          onClose={noop}
          collabOverride={createCollabStub()}
          pendingInviteOverride={null}
        />
      </CircuitContextProvider>,
    );
    expect(manualHtml).toContain("data-component=\"JoinCollabSessionDialog\"");
    expect(manualHtml).toContain("Kollaborations-Session beitreten");
    expect(manualHtml).toContain("data-testid=\"collab-join-link-input\"");
    expect(manualHtml).toContain("data-testid=\"collab-join-display-name-input\"");
    expect(manualHtml).toContain("value=\"Carla\"");
    expect(manualHtml).toContain("data-testid=\"collab-join-privacy-notice\"");
    expect(manualHtml).toContain("data-testid=\"collab-join-open-privacy-btn\"");
    expect(manualHtml).toContain("data-testid=\"collab-join-submit-btn\"");
    expect(manualHtml).not.toContain("data-testid=\"collab-join-remote-sidecar-box\"");

    // Erkannter Hash-Invite mit entfernter https://-Sidecar-URL und ungespeicherten Änderungen
    const remotePending: ParsedCollabInviteLink = {
      inviteToken: "token-1234567890abcdef",
      sidecarUrl: "https://sidecar.example.org",
      isRemoteSidecar: true,
      isLocalhostSidecar: false,
      sidecarError: null,
    };
    const remoteHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <JoinCollabSessionDialog
          isOpen={true}
          hasUnsavedChanges={true}
          onClose={noop}
          collabOverride={createCollabStub()}
          pendingInviteOverride={remotePending}
        />
      </CircuitContextProvider>,
    );
    expect(remoteHtml).toContain("data-testid=\"collab-join-detected-invite\"");
    expect(remoteHtml).not.toContain("data-testid=\"collab-join-link-input\"");
    expect(remoteHtml).toContain("data-testid=\"collab-join-remote-sidecar-box\"");
    expect(remoteHtml).toContain("sidecar.example.org");
    expect(remoteHtml).toContain("flüchtig");
    expect(remoteHtml).toContain("data-testid=\"collab-join-confirm-sidecar-checkbox\"");
    expect(remoteHtml).toContain("data-testid=\"collab-join-unsaved-warning\"");
    expect(remoteHtml).toContain("data-testid=\"collab-join-save-and-join-btn\"");
    expect(remoteHtml).toContain("Speichern &amp; beitreten");
    expect(remoteHtml).toContain("data-testid=\"collab-join-without-save-btn\"");
    expect(remoteHtml).toContain("Ohne Speichern beitreten");

    // Ungültige Sidecar-URL im Hash wird als Alert angezeigt
    const badSidecarPending: ParsedCollabInviteLink = {
      inviteToken: "token-1234567890abcdef",
      sidecarUrl: null,
      isRemoteSidecar: false,
      isLocalhostSidecar: false,
      sidecarError: "Entfernte Sidecar-Server in Einladungslinks müssen zwingend über https:// erreichbar sein.",
    };
    const badSidecarHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <JoinCollabSessionDialog
          isOpen={true}
          onClose={noop}
          collabOverride={createCollabStub()}
          pendingInviteOverride={badSidecarPending}
        />
      </CircuitContextProvider>,
    );
    expect(badSidecarHtml).toContain("data-testid=\"collab-join-sidecar-error\"");
    expect(badSidecarHtml).toContain("https:// erreichbar sein");
  });

  it("rendert verständliche Fehlerzustände in JoinCollabSessionDialog und blendet bei DISABLE_COLLAB aus", () => {
    delete process.env.DISABLE_COLLAB;
    installMockLocalStorage();
    const project = createEmptyCircuitProject();

    const errorCases = [
      { code: "invite-expired" as const, expected: "abgelaufen" },
      { code: "invite-revoked" as const, expected: "vorzeitig widerrufen" },
      { code: "invite-invalid" as const, expected: "ungültig oder unbekannt" },
      { code: "session-not-found" as const, expected: "existiert nicht mehr" },
      { code: "peer-limit-reached" as const, expected: "maximale Teilnehmerzahl" },
      { code: "rate-limited" as const, retryAfterSeconds: 19, expected: "19 s warten" },
      { code: "service-unavailable" as const, expected: "keine Kapazität frei (503)" },
    ];

    for (const errorCase of errorCases) {
      const html = renderToStaticMarkup(
        <CircuitContextProvider initialProject={project}>
          <JoinCollabSessionDialog
            isOpen={true}
            onClose={noop}
            collabOverride={createCollabStub()}
            initialErrorOverride={{
              code: errorCase.code,
              message: "raw",
              ...(errorCase.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: errorCase.retryAfterSeconds }
                : {}),
            }}
          />
        </CircuitContextProvider>,
      );
      expect(html).toContain("data-testid=\"collab-join-error-box\"");
      expect(html).toContain(errorCase.expected);
    }

    const disabledHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <JoinCollabSessionDialog
          isOpen={true}
          onClose={noop}
          collabOverride={createCollabStub({ isDisabled: true })}
        />
      </CircuitContextProvider>,
    );
    expect(disabledHtml).not.toContain("data-component=\"JoinCollabSessionDialog\"");
  });

  it("rendert Host-Moderation (Rolle, Name + Bad-Word-Sperre, Hand senken, Handover, Kick) nur für Hosts", () => {
    delete process.env.DISABLE_COLLAB;
    installMockLocalStorage();
    const project = createEmptyCircuitProject();

    const participants: CollabParticipant[] = [
      {
        peerId: "peer-host",
        role: "host",
        displayName: "Alice",
        nameLocked: false,
        handRaised: false,
        connectionState: "connected",
        isSelf: true,
      },
      {
        peerId: "peer-collab",
        role: "collaborator",
        displayName: "Bob",
        nameLocked: false,
        handRaised: true,
        connectionState: "connected",
      },
      {
        peerId: "peer-guest",
        role: "guest",
        displayName: "Charlie",
        nameLocked: true,
        handRaised: false,
        connectionState: "connected",
      },
    ];

    const hostHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <CollabParticipantsPanel
          initialModeratingPeerId="peer-guest"
          onRequestTransferHost={noop}
          collabOverride={createCollabStub({
            isInSession: true,
            isParticipantsPanelOpen: true,
            isHost: true,
            selfRole: "host",
            selfPeerId: "peer-host",
            displayName: "Alice",
            selfParticipant: participants[0],
            participants,
            raisedHandCount: 1,
          })}
        />
      </CircuitContextProvider>,
    );

    // Für den Host selbst werden keine Fremd-Moderationsbuttons gerendert
    expect(hostHtml).not.toContain("data-testid=\"collab-host-actions-peer-host\"");

    // Kollaborateur mit gehobener Hand: Rollenwechsel zu Gast, Hand senken, Name, Handover, Kick
    expect(hostHtml).toContain("data-testid=\"collab-host-actions-peer-collab\"");
    expect(hostHtml).toContain("data-testid=\"collab-toggle-role-peer-collab\"");
    expect(hostHtml).toContain("Zu Gast");
    expect(hostHtml).toContain("data-testid=\"collab-lower-hand-peer-collab\"");
    expect(hostHtml).toContain("data-testid=\"collab-transfer-host-peer-collab\"");
    expect(hostHtml).toContain("data-testid=\"collab-kick-peer-collab\"");

    // Gast ohne gehobene Hand: Rollenwechsel zu Kollaborateur, Handover auch für Gäste, kein Hand-senken-Button
    expect(hostHtml).toContain("data-testid=\"collab-host-actions-peer-guest\"");
    expect(hostHtml).toContain("data-testid=\"collab-toggle-role-peer-guest\"");
    expect(hostHtml).toContain("Zu Kollaborateur");
    expect(hostHtml).not.toContain("data-testid=\"collab-lower-hand-peer-guest\"");
    expect(hostHtml).toContain("data-testid=\"collab-transfer-host-peer-guest\"");

    // Inline-Namensmoderation inklusive Bad-Word-Namenssperre (nameLocked)
    expect(hostHtml).toContain("data-testid=\"collab-moderate-form-peer-guest\"");
    expect(hostHtml).toContain("data-testid=\"collab-moderate-name-input-peer-guest\"");
    expect(hostHtml).toContain("data-testid=\"collab-moderate-lock-checkbox-peer-guest\"");
    expect(hostHtml).toContain("Namenssperre (Bad-Word-Schutz)");

    // Nicht-Host sieht weder Moderationsaktionen noch Einladungslinks, aber seine gesperrte Namenseingabe
    const nonHostParticipants = participants.map((participant) => ({
      ...participant,
      isSelf: participant.peerId === "peer-guest",
    }));
    const nonHostHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <CollabParticipantsPanel
          collabOverride={createCollabStub({
            isInSession: true,
            isParticipantsPanelOpen: true,
            isHost: false,
            selfRole: "guest",
            selfPeerId: "peer-guest",
            isMcpBlockedByCollab: true,
            displayName: "Charlie",
            selfParticipant: nonHostParticipants[2],
            participants: nonHostParticipants,
            raisedHandCount: 1,
          })}
        />
      </CircuitContextProvider>,
    );
    expect(nonHostHtml).not.toContain("data-testid=\"collab-host-actions-peer-collab\"");
    expect(nonHostHtml).not.toContain("data-testid=\"collab-host-invites-section\"");
    expect(nonHostHtml).toContain("data-testid=\"collab-name-locked-hint\"");
    expect(nonHostHtml).toContain("Session verlassen");
  });

  it("rendert TransferHostWarningDialog mit Gast-Warnung sowie SessionEndedDialog für alle Endegründe", () => {
    delete process.env.DISABLE_COLLAB;
    installMockLocalStorage();
    const project = createEmptyCircuitProject();

    const guestTarget: CollabParticipant = {
      peerId: "peer-guest",
      role: "guest",
      displayName: "Dora",
      nameLocked: false,
      handRaised: false,
      connectionState: "connected",
    };
    const guestWarningHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <TransferHostWarningDialog
          isOpen={true}
          targetParticipant={guestTarget}
          onConfirm={noop}
          onCancel={noop}
        />
      </CircuitContextProvider>,
    );
    expect(guestWarningHtml).toContain("data-component=\"TransferHostWarningDialog\"");
    expect(guestWarningHtml).toContain("Dora");
    expect(guestWarningHtml).toContain("data-testid=\"collab-transfer-guest-warning\"");
    expect(guestWarningHtml).toContain("data-testid=\"collab-transfer-consequences\"");
    expect(guestWarningHtml).toContain("data-testid=\"collab-transfer-confirm-btn\"");

    const collabTarget: CollabParticipant = {
      ...guestTarget,
      peerId: "peer-collab",
      role: "collaborator",
    };
    const collabWarningHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <TransferHostWarningDialog
          isOpen={true}
          targetParticipant={collabTarget}
          onConfirm={noop}
          onCancel={noop}
        />
      </CircuitContextProvider>,
    );
    expect(collabWarningHtml).toContain("data-component=\"TransferHostWarningDialog\"");
    expect(collabWarningHtml).not.toContain("data-testid=\"collab-transfer-guest-warning\"");

    const closedNotices: Array<{ notice: CollabSessionClosedEvent; expected: string }> = [
      { notice: { sessionId: "s1", reason: "kicked", closeCode: 4003 }, expected: "Aus der Kollaborations-Session entfernt" },
      { notice: { sessionId: "s1", reason: "host-closed" }, expected: "regulär beendet" },
      { notice: { sessionId: "s1", reason: "host-disconnected" }, expected: "Grace Period" },
    ];
    for (const entry of closedNotices) {
      const endedHtml = renderToStaticMarkup(
        <CircuitContextProvider initialProject={project}>
          <SessionEndedDialog
            noticeOverride={entry.notice}
            onDismissOverride={noop}
          />
        </CircuitContextProvider>,
      );
      expect(endedHtml).toContain("data-component=\"SessionEndedDialog\"");
      expect(endedHtml).toContain(entry.expected);
      expect(endedHtml).toContain("data-testid=\"collab-ended-local-copy-note\"");
      expect(endedHtml).toContain("ohne automatisches Backporting");
    }

    const hiddenEndedHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SessionEndedDialog
          noticeOverride={{ sessionId: "s1", reason: "kicked" }}
          isDisabledOverride={true}
        />
      </CircuitContextProvider>,
    );
    expect(hiddenEndedHtml).not.toContain("data-component=\"SessionEndedDialog\"");
  });

  it("sperrt MCP-Zugriff in MainMenu und StatusBar sauber für Nicht-Hosts und blendet bei DISABLE_COLLAB aus", () => {
    delete process.env.DISABLE_COLLAB;
    installMockLocalStorage();
    const project = createEmptyCircuitProject();

    const guestMenuHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <MainMenu
          isOpen={true}
          initialCategory="file"
          isSimulating={false}
          isPaused={false}
          isRunning={false}
          canUndo={false}
          canRedo={false}
          hasSelection={false}
          hasSymbolSelection={false}
          canDeleteCurrentCircuit={false}
          isCollabDisabled={false}
          isCollabInSession={true}
          isCollabHost={false}
          isCollabParticipantsPanelOpen={true}
          onToggleCollabParticipantsPanel={noop}
          onEndOrLeaveCollabSession={noop}
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
        />
      </CircuitContextProvider>,
    );
    expect(guestMenuHtml).toContain("Kollaborations-Session verlassen");
    expect(guestMenuHtml).not.toContain("Kollaborations-Session beenden");

    const guestStatusHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <CanvasContextProvider>
            <StatusBar
              collabOverride={createCollabStub({
                isInSession: true,
                transportState: "connected",
                selfRole: "guest",
                isHost: false,
                isMcpBlockedByCollab: true,
                participants: [
                  {
                    peerId: "p1",
                    role: "host",
                    displayName: "Host",
                    nameLocked: false,
                    handRaised: false,
                    connectionState: "connected",
                  },
                  {
                    peerId: "p2",
                    role: "guest",
                    displayName: "Gast",
                    nameLocked: false,
                    handRaised: false,
                    connectionState: "connected",
                    isSelf: true,
                  },
                ],
              })}
            />
          </CanvasContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(guestStatusHtml).toContain("Gast (2)");
    expect(guestStatusHtml).not.toContain("Host (2)");
  });

  it("zeigt Teilnehmern während der Host-Dateiauswahl ein deutliches Lade-Overlay an", () => {
    delete process.env.DISABLE_COLLAB;

    const collaboratorOverlayHtml = renderToStaticMarkup(
      <CollabContext.Provider
        value={createCollabStub({
          isInSession: true,
          transportState: "connected",
          selfRole: "collaborator",
          isHost: false,
          modelSyncState: {
            syncStatus: "quiesced",
            revision: 3,
            epochId: "epoch-1",
            unconfirmedMutationCount: 0,
            isQuiesced: true,
            quiesceReason: "project-loading",
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
          },
        })}
      >
        <CollabWorkspaceOverlay />
      </CollabContext.Provider>,
    );
    expect(collaboratorOverlayHtml).toContain("data-testid=\"collab-host-loading-overlay\"");
    expect(collaboratorOverlayHtml).toContain("Host lädt neue Schaltung");

    const hostOverlayHtml = renderToStaticMarkup(
      <CollabContext.Provider
        value={createCollabStub({
          isInSession: true,
          transportState: "connected",
          selfRole: "host",
          isHost: true,
          modelSyncState: {
            syncStatus: "quiesced",
            revision: 3,
            epochId: "epoch-1",
            unconfirmedMutationCount: 0,
            isQuiesced: true,
            quiesceReason: "project-loading",
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
          },
        })}
      >
        <CollabWorkspaceOverlay />
      </CollabContext.Provider>,
    );
    expect(hostOverlayHtml).not.toContain("data-testid=\"collab-host-loading-overlay\"");
  });
});
