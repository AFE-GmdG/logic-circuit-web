import React from "react";

import CollabContext from ".";

import type { CollabInviteRole } from "../../types/collab/collabRole";
import type {
  CollabCommitOrigin,
  CollabSoftLockEntry,
  CollabSoftLockTargetType,
  CollabSoftLockReason,
} from "../../types/collab/modelSyncMessage";
import type { CollabPresenceCursorPosition } from "../../types/collab/presenceMessage";

import CollabModelSyncController, {
  type CollabModelSyncState,
} from "../../collab/collabModelSyncController";
import CollabPresenceController, {
  type CollabLocalPresenceInput,
  type CollabParticipantNavigationTarget,
  type CollabPresenceCursorMap,
  type CollabPresenceState,
  resolveParticipantNavigationTarget,
} from "../../collab/collabPresenceController";
import CollabSessionController, {
  type CollabSessionControllerOptions,
  type CollabSessionControllerState,
  type JoinCollabSessionInput,
  type ModerateParticipantNameInput,
  type StartHostSessionInput,
} from "../../collab/collabSessionController";
import type { CollabSoftLockTarget } from "../../collab/collabSoftLockManager";
import type { ResyncConfirmationContext } from "../../collab/p2pSessionTransport";
import { stripCollabInviteFromHash } from "../../utils/collabInviteLink";
import {
  type CollabParticipantColorMap,
  type CollabParticipantColorStore,
  createCollabParticipantColorStore,
} from "../../utils/collabParticipantColors";

import CanvasContext from "../canvasContext";
import CircuitContext from "../circuitContext";
import LibraryContext from "../libraryContext";
import SimulationContext from "../simulationContext";

export type CollabContextProviderProps = {
  children: React.ReactNode;
  disabledOverride?: boolean;
  controllerOptions?: CollabSessionControllerOptions;
};

const INVITE_EXPIRY_POLL_MS = 1000;
const EMPTY_REMOTE_CURSORS: CollabPresenceCursorMap = {};

function areColorDictionariesEqual(a: CollabParticipantColorMap, b: CollabParticipantColorMap): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function clearInviteFromBrowserLocationHash(): void {
  if (typeof window === "undefined" || !window.location || !window.history || typeof window.history.replaceState !== "function") {
    return;
  }
  const currentHash = window.location.hash ?? "";
  if (currentHash.length === 0) {
    return;
  }
  const cleanedHash = stripCollabInviteFromHash(currentHash);
  if (cleanedHash === currentHash) {
    return;
  }
  const nextUrl = `${window.location.pathname}${window.location.search}${cleanedHash}`;
  window.history.replaceState(null, "", nextUrl);
}

const CollabContextProvider: React.FC<CollabContextProviderProps> = ({
  children,
  disabledOverride,
  controllerOptions,
}) => {
  const canvasContext = React.useContext(CanvasContext);
  const circuitContext = React.useContext(CircuitContext);
  const libraryContext = React.useContext(LibraryContext);
  const simulationContext = React.useContext(SimulationContext);
  const canvasContextRef = React.useRef(canvasContext);
  canvasContextRef.current = canvasContext;
  const circuitContextRef = React.useRef(circuitContext);
  circuitContextRef.current = circuitContext;
  const libraryContextRef = React.useRef(libraryContext);
  libraryContextRef.current = libraryContext;
  const simulationContextRef = React.useRef(simulationContext);
  simulationContextRef.current = simulationContext;

  const customStunUrlsRef = React.useRef<string[] | undefined>(circuitContext?.appSettings?.collabStunUrls);
  customStunUrlsRef.current = circuitContext?.appSettings?.collabStunUrls;

  const controllerRef = React.useRef<CollabSessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CollabSessionController({
      disabledOverride,
      getCustomStunUrls: () => customStunUrlsRef.current,
      getPageUrl: () => (typeof window !== "undefined" && window.location
        ? `${window.location.origin}${window.location.pathname}`
        : "http://localhost/"),
      ...controllerOptions,
    });
  }

  const [sessionState, setSessionState] = React.useState<CollabSessionControllerState>(
    () => controllerRef.current!.getState(),
  );
  const [modelSyncState, setModelSyncState] = React.useState<CollabModelSyncState>(() => ({
    syncStatus: "idle",
    revision: 0,
    epochId: null,
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
  }));
  const [softLockBlockedNotice, setSoftLockBlockedNotice] = React.useState<CollabSoftLockEntry | null>(null);
  const softLockNoticeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncControllerRef = React.useRef<CollabModelSyncController | null>(null);

  const colorStoreRef = React.useRef<CollabParticipantColorStore | null>(null);
  if (!colorStoreRef.current) {
    colorStoreRef.current = createCollabParticipantColorStore();
  }
  const [participantColors, setParticipantColors] = React.useState<CollabParticipantColorMap>(
    () => colorStoreRef.current!.getDictionary(),
  );
  const [presenceState, setPresenceState] = React.useState<CollabPresenceState>(() => ({
    peers: {},
    version: 0,
  }));
  const [followingPeerId, setFollowingPeerId] = React.useState<string | null>(null);
  const presenceControllerRef = React.useRef<CollabPresenceController | null>(null);
  const remoteCursorListenersRef = React.useRef<Set<(cursors: CollabPresenceCursorMap) => void>>(new Set());
  const sessionStateRef = React.useRef(sessionState);
  sessionStateRef.current = sessionState;
  const presenceStateRef = React.useRef(presenceState);
  presenceStateRef.current = presenceState;
  const followingPeerIdRef = React.useRef(followingPeerId);
  followingPeerIdRef.current = followingPeerId;
  const programmaticCircuitTargetRef = React.useRef<string | null>(null);
  const lastAppliedFollowKeyRef = React.useRef<string | null>(null);
  const prevCircuitIdRef = React.useRef<string | null>(circuitContext?.currentCircuitId ?? null);

  const clearSoftLockBlockedNotice = React.useCallback(
    () => {
      if (softLockNoticeTimerRef.current !== null) {
        clearTimeout(softLockNoticeTimerRef.current);
        softLockNoticeTimerRef.current = null;
      }
      setSoftLockBlockedNotice(null);
    },
    [],
  );

  const reportSoftLockBlocked = React.useCallback(
    (lock: CollabSoftLockEntry) => {
      if (softLockNoticeTimerRef.current !== null) {
        clearTimeout(softLockNoticeTimerRef.current);
      }
      setSoftLockBlockedNotice(lock);
      softLockNoticeTimerRef.current = setTimeout(() => {
        softLockNoticeTimerRef.current = null;
        setSoftLockBlockedNotice(null);
      }, 4000);
    },
    [],
  );

  React.useEffect(
    () => {
      if (!sessionState.isInSession) {
        clearSoftLockBlockedNotice();
      }
    },
    [clearSoftLockBlockedNotice, sessionState.isInSession],
  );

  React.useEffect(
    () => {
      const controller = controllerRef.current;
      if (!controller) {
        return undefined;
      }

      const syncController = new CollabModelSyncController({
        transport: controller,
        adapter: {
          getVisibleProject: () => circuitContextRef.current.project,
          applyAuthoritativeProject: (project, options) => {
            circuitContextRef.current?.applyRemoteProjectState?.(project, options);
          },
          isEditingLibrary: () => Boolean(libraryContextRef.current?.isEditingLibrary),
          isLocalSnapshotSimulating: () =>
            Boolean(simulationContextRef.current?.isSimulating && !libraryContextRef.current?.isEditingLibrary),
          getLibraryBackgroundProject: () => libraryContextRef.current?.getSavedSessionProject?.() ?? null,
          setLibraryBackgroundProject: (project) => {
            libraryContextRef.current?.updateSavedSessionProject?.(project);
          },
          getSelfDisplayName: () => controller.getState().displayName,
          getParticipantDisplayName: (peerId) =>
            controller.getState().participants.find((participant) => participant.peerId === peerId)?.displayName,
          onRemoteCommitApplied: (commit) => {
            const highlight = commit.highlightIds;
            const hasHighlights = Boolean(
              highlight &&
              ((highlight.symbolIds?.length ?? 0) > 0 ||
                (highlight.textNoteIds?.length ?? 0) > 0 ||
                (highlight.wireIds?.length ?? 0) > 0),
            );
            if (commit.origin !== "mcp" || libraryContextRef.current?.isEditingLibrary || !hasHighlights || !highlight) {
              return;
            }
            const mutationCircuitId =
              "logicalCircuitId" in commit.mutation ? commit.mutation.logicalCircuitId : undefined;
            const activeCircuitId = circuitContextRef.current?.currentCircuitId;
            if (mutationCircuitId && activeCircuitId && mutationCircuitId !== activeCircuitId) {
              return;
            }
            canvasContextRef.current?.highlightAiElements?.(highlight);
          },
        },
      });
      syncControllerRef.current = syncController;
      setModelSyncState(syncController.getState());
      const unsubscribeSync = syncController.subscribe((nextSync) => {
        setModelSyncState(nextSync);
      });

      circuitContextRef.current?.registerCollabSyncBridge?.({
        canMutateProject: () => syncController.canMutateProject(),
        onLocalDeltaCommitted: (delta, projectAfterDelta, options) => {
          syncController.submitLocalDelta(delta, projectAfterDelta, options);
        },
        onLocalMutation: (mutation) => {
          syncController.submitLocalMutation(mutation);
        },
        onLocalProjectReplaced: (nextProject) => {
          syncController.notifyLocalProjectReplaced(nextProject);
        },
        isCollabUndoActive: () => syncController.isCollabUndoActive(),
        getCollabHistory: (logicalCircuitId) => syncController.getCollabHistory(logicalCircuitId),
        canCollabUndo: (logicalCircuitId) => syncController.canCollabUndo(logicalCircuitId),
        canCollabRedo: (logicalCircuitId) => syncController.canCollabRedo(logicalCircuitId),
        performCollabUndo: (logicalCircuitId) => syncController.performCollabUndo(logicalCircuitId),
        performCollabRedo: (logicalCircuitId) => syncController.performCollabRedo(logicalCircuitId),
        clearCollabHistory: (logicalCircuitId) => syncController.clearCollabHistory(logicalCircuitId),
        subscribeUndoState: (listener) => syncController.subscribeUndoState(listener),
      });

      simulationContextRef.current?.registerCollabBridge?.({
        isCollabSnapshotMode: () =>
          Boolean(controller.getState().isInSession && !libraryContextRef.current?.isEditingLibrary),
        onSimulationStateChange: (simulating) => {
          const inSharedSim = Boolean(
            simulating && controller.getState().isInSession && !libraryContextRef.current?.isEditingLibrary,
          );
          syncController.setLocalSimulationActive(inSharedSim);
          if (simulating && followingPeerIdRef.current) {
            programmaticCircuitTargetRef.current = null;
            lastAppliedFollowKeyRef.current = null;
            setFollowingPeerId(null);
          }
        },
      });

      setSessionState(controller.getState());
      const unsubscribe = controller.subscribe((nextState) => {
        setSessionState(nextState);
      });

      const presenceController = new CollabPresenceController({ transport: controller });
      presenceControllerRef.current = presenceController;
      setPresenceState(presenceController.getState());
      const unsubscribePresenceState = presenceController.subscribeState((nextPresence) => {
        setPresenceState(nextPresence);
      });
      const unsubscribePresenceCursors = presenceController.subscribeCursors((nextCursors) => {
        for (const listener of remoteCursorListenersRef.current) {
          listener(nextCursors);
        }
      });

      const handleHash = () => {
        if (typeof window === "undefined" || !window.location) {
          return;
        }
        const parsed = controller.ingestHash(window.location.hash ?? "", window.location);
        if (parsed) {
          clearInviteFromBrowserLocationHash();
        }
      };

      const handleUnload = () => {
        controller.dispose();
      };

      handleHash();
      if (typeof window !== "undefined") {
        window.addEventListener("hashchange", handleHash);
        window.addEventListener("pagehide", handleUnload);
      }

      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("hashchange", handleHash);
          window.removeEventListener("pagehide", handleUnload);
        }
        circuitContextRef.current?.registerCollabSyncBridge?.(null);
        simulationContextRef.current?.registerCollabBridge?.(null);
        clearSoftLockBlockedNotice();
        unsubscribePresenceCursors();
        unsubscribePresenceState();
        presenceController.dispose();
        presenceControllerRef.current = null;
        unsubscribeSync();
        syncController.dispose();
        syncControllerRef.current = null;
        unsubscribe();
        controller.dispose();
      };
    },
    [],
  );

  React.useEffect(
    () => {
      const colorStore = colorStoreRef.current;
      if (!colorStore) {
        return;
      }
      if (!sessionState.isInSession) {
        colorStore.clearPeerRuntimeState();
        return;
      }
      const nextDict = colorStore.syncParticipants(
        sessionState.participants.filter((participant) => !participant.isSelf),
      );
      setParticipantColors((prev) => (areColorDictionariesEqual(prev, nextDict) ? prev : nextDict));
    },
    [sessionState.isInSession, sessionState.participants],
  );

  React.useEffect(
    () => {
      if (sessionState.activeInvites.length === 0) {
        return undefined;
      }
      const timer = setInterval(() => {
        controllerRef.current?.pruneExpiredInvites();
      }, INVITE_EXPIRY_POLL_MS);
      return () => clearInterval(timer);
    },
    [sessionState.activeInvites.length],
  );

  const startHostSession = React.useCallback(
    (input: StartHostSessionInput) => controllerRef.current!.startHostSession(input),
    [],
  );

  const joinSession = React.useCallback(
    (input: JoinCollabSessionInput) => controllerRef.current!.joinSession(input),
    [],
  );

  const endOrLeaveSession = React.useCallback(
    (reason?: string) => {
      controllerRef.current?.endOrLeaveSession(reason);
    },
    [],
  );

  const createInviteLink = React.useCallback(
    (role: CollabInviteRole, ttlMs?: number) => controllerRef.current!.createInviteLink(role, ttlMs),
    [],
  );

  const revokeInviteLink = React.useCallback(
    (inviteToken: string) => controllerRef.current!.revokeInviteLink(inviteToken),
    [],
  );

  const setParticipantRole = React.useCallback(
    (targetPeerId: string, role: CollabInviteRole) => controllerRef.current!.setParticipantRole(targetPeerId, role),
    [],
  );

  const moderateParticipantName = React.useCallback(
    (targetPeerId: string, update: ModerateParticipantNameInput) =>
      controllerRef.current!.moderateParticipantName(targetPeerId, update),
    [],
  );

  const renameSelf = React.useCallback(
    (newName: string) => controllerRef.current!.renameSelf(newName),
    [],
  );

  const toggleHandRaised = React.useCallback(
    (raised?: boolean) => controllerRef.current!.toggleHandRaised(raised),
    [],
  );

  const lowerParticipantHand = React.useCallback(
    (targetPeerId: string) => controllerRef.current!.lowerParticipantHand(targetPeerId),
    [],
  );

  const kickParticipant = React.useCallback(
    (targetPeerId: string, reason?: string) => controllerRef.current!.kickParticipant(targetPeerId, reason),
    [],
  );

  const transferHostRole = React.useCallback(
    (targetPeerId: string) => controllerRef.current!.transferHostRole(targetPeerId),
    [],
  );

  const requestResync = React.useCallback(
    () => controllerRef.current!.requestResync(),
    [],
  );

  const setParticipantsPanelOpen = React.useCallback(
    (open: boolean) => {
      controllerRef.current?.setParticipantsPanelOpen(open);
    },
    [],
  );

  const clearPendingInviteLink = React.useCallback(
    () => {
      controllerRef.current?.clearPendingInviteLink();
    },
    [],
  );

  const clearError = React.useCallback(
    () => {
      controllerRef.current?.clearError();
    },
    [],
  );

  const dismissSessionClosedNotice = React.useCallback(
    () => {
      controllerRef.current?.dismissSessionClosedNotice();
    },
    [],
  );

  const clearSyncRejection = React.useCallback(
    () => {
      syncControllerRef.current?.clearSyncRejection();
    },
    [],
  );

  const clearUndoConflict = React.useCallback(
    () => {
      syncControllerRef.current?.clearUndoConflict();
    },
    [],
  );

  const setHostProjectLoading = React.useCallback(
    (loading: boolean) => {
      syncControllerRef.current?.setHostProjectLoading(loading);
    },
    [],
  );

  const acquireSoftLocks = React.useCallback(
    (targets: ReadonlyArray<CollabSoftLockTarget>, reason: CollabSoftLockReason) => {
      if (!syncControllerRef.current) {
        return { ok: true as const, acquired: [] };
      }
      return syncControllerRef.current.acquireSoftLocks(targets, reason);
    },
    [],
  );

  const renewSoftLocks = React.useCallback(
    (targets?: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>) =>
      syncControllerRef.current?.renewSoftLocks(targets) ?? [],
    [],
  );

  const releaseSoftLocks = React.useCallback(
    (targets?: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>) =>
      syncControllerRef.current?.releaseSoftLocks(targets) ?? [],
    [],
  );

  const getForeignSoftLocks = React.useCallback(
    () => syncControllerRef.current?.getForeignSoftLocks() ?? [],
    [],
  );

  const getForeignLockForTarget = React.useCallback(
    (targetType: CollabSoftLockTargetType, targetId: string) =>
      syncControllerRef.current?.getForeignLockForTarget(targetType, targetId) ?? null,
    [],
  );

  const registerResyncConfirmHandler = React.useCallback(
    (handler: ((context: ResyncConfirmationContext) => Promise<boolean> | boolean) | null) => {
      syncControllerRef.current?.setResyncConfirmHandler(handler);
    },
    [],
  );

  const runWithMutationOrigin = React.useCallback(
    <T, >(origin: CollabCommitOrigin, fn: () => T): T => {
      if (!syncControllerRef.current) {
        return fn();
      }
      return syncControllerRef.current.runWithMutationOrigin(origin, fn);
    },
    [],
  );

  const getParticipantColor = React.useCallback(
    (peerId: string, fallbackDisplayName?: string): string =>
      colorStoreRef.current!.getColorForPeer(peerId, fallbackDisplayName),
    [],
  );

  const setParticipantColor = React.useCallback(
    (peerId: string, color: string): boolean => {
      const store = colorStoreRef.current;
      if (!store) {
        return false;
      }
      const updated = store.setColorForPeer(peerId, color);
      if (updated) {
        setParticipantColors(store.getDictionary());
      }
      return updated;
    },
    [],
  );

  const reloadParticipantColors = React.useCallback(
    () => {
      const store = colorStoreRef.current;
      if (!store) {
        return;
      }
      const reloaded = store.reloadFromStorage();
      setParticipantColors(reloaded);
    },
    [],
  );

  const updateLocalPresenceState = React.useCallback(
    (patch: Partial<CollabLocalPresenceInput>) => {
      presenceControllerRef.current?.updateLocalState(patch);
    },
    [],
  );

  const updateLocalPresenceCursor = React.useCallback(
    (cursor: CollabPresenceCursorPosition | null) => {
      presenceControllerRef.current?.updateLocalCursor(cursor);
    },
    [],
  );

  const getRemoteCursors = React.useCallback(
    (): CollabPresenceCursorMap => presenceControllerRef.current?.getCursors() ?? EMPTY_REMOTE_CURSORS,
    [],
  );

  const subscribeRemoteCursors = React.useCallback(
    (listener: (cursors: CollabPresenceCursorMap) => void) => {
      remoteCursorListenersRef.current.add(listener);
      return () => {
        remoteCursorListenersRef.current.delete(listener);
      };
    },
    [],
  );

  const applyNavigationTarget = React.useCallback(
    (target: Extract<CollabParticipantNavigationTarget, { status: "ready" }>, skipIfSameKey: boolean): boolean => {
      const vpKey = target.viewport
        ? `${target.viewport.centerX},${target.viewport.centerY},${target.viewport.zoom ?? ""}`
        : "no-vp";
      const targetKey = `${target.logicalCircuitId}:${vpKey}`;
      if (skipIfSameKey && lastAppliedFollowKeyRef.current === targetKey) {
        return true;
      }
      lastAppliedFollowKeyRef.current = targetKey;

      const currentCircuitId = circuitContextRef.current?.currentCircuitId ?? null;
      if (currentCircuitId !== target.logicalCircuitId) {
        programmaticCircuitTargetRef.current = target.logicalCircuitId;
        circuitContextRef.current?.setCurrentCircuitId?.(target.logicalCircuitId);
      }

      if (target.viewport) {
        canvasContextRef.current?.focusCanvasCenter?.({
          centerX: target.viewport.centerX,
          centerY: target.viewport.centerY,
          zoom: target.viewport.zoom,
          circuitId: target.logicalCircuitId,
        });
      }
      return true;
    },
    [],
  );

  const jumpToParticipant = React.useCallback(
    (targetPeerId: string): boolean => {
      const currentSession = sessionStateRef.current;
      if (!currentSession.isInSession || targetPeerId === currentSession.selfPeerId) {
        return false;
      }
      if (libraryContextRef.current?.isEditingLibrary || simulationContextRef.current?.isSimulating) {
        return false;
      }
      if (followingPeerIdRef.current && followingPeerIdRef.current !== targetPeerId) {
        setFollowingPeerId(null);
        lastAppliedFollowKeyRef.current = null;
      }
      const target = resolveParticipantNavigationTarget({
        targetPeerId,
        presenceState: presenceStateRef.current,
        remoteCursors: presenceControllerRef.current?.getCursors() ?? EMPTY_REMOTE_CURSORS,
        availableCircuitIds: (circuitContextRef.current?.project?.logicalCircuits ?? []).map(
          (circuit) => circuit.logicalCircuitId,
        ),
      });
      if (target.status !== "ready") {
        return false;
      }
      return applyNavigationTarget(target, false);
    },
    [applyNavigationTarget],
  );

  const startFollowingPeer = React.useCallback(
    (targetPeerId: string): boolean => {
      const currentSession = sessionStateRef.current;
      if (!currentSession.isInSession || targetPeerId === currentSession.selfPeerId) {
        return false;
      }
      if (libraryContextRef.current?.isEditingLibrary || simulationContextRef.current?.isSimulating) {
        return false;
      }
      const exists = currentSession.participants.some(
        (participant) => participant.peerId === targetPeerId && !participant.isSelf,
      );
      if (!exists) {
        return false;
      }
      lastAppliedFollowKeyRef.current = null;
      setFollowingPeerId(targetPeerId);
      const target = resolveParticipantNavigationTarget({
        targetPeerId,
        presenceState: presenceStateRef.current,
        remoteCursors: presenceControllerRef.current?.getCursors() ?? EMPTY_REMOTE_CURSORS,
        availableCircuitIds: (circuitContextRef.current?.project?.logicalCircuits ?? []).map(
          (circuit) => circuit.logicalCircuitId,
        ),
      });
      if (target.status === "ready") {
        applyNavigationTarget(target, false);
      }
      return true;
    },
    [applyNavigationTarget],
  );

  const stopFollowingPeer = React.useCallback(
    () => {
      programmaticCircuitTargetRef.current = null;
      lastAppliedFollowKeyRef.current = null;
      setFollowingPeerId(null);
    },
    [],
  );

  // Synchronisiert den Snapshot-Simulationsmodus mit dem Sync-Controller und beendet aktives Folgen beim Start
  React.useEffect(
    () => {
      const isSimulating = Boolean(simulationContext?.isSimulating);
      const isEditingLibrary = Boolean(libraryContext?.isEditingLibrary);
      syncControllerRef.current?.setLocalSimulationActive(
        Boolean(sessionState.isInSession && isSimulating && !isEditingLibrary),
      );
      if (isSimulating && followingPeerIdRef.current) {
        programmaticCircuitTargetRef.current = null;
        lastAppliedFollowKeyRef.current = null;
        setFollowingPeerId(null);
      }
    },
    [
      libraryContext?.isEditingLibrary,
      sessionState.isInSession,
      simulationContext?.isSimulating,
    ],
  );

  // Führt den Viewport beim Folgen automatisch nach und pausiert still während des Bibliotheksmodus
  React.useEffect(
    () => {
      if (!followingPeerId) {
        return;
      }
      const isEditingLibrary = Boolean(libraryContext?.isEditingLibrary);
      const isSimulating = Boolean(simulationContext?.isSimulating);
      if (!sessionState.isInSession || isEditingLibrary || isSimulating) {
        setFollowingPeerId(null);
        lastAppliedFollowKeyRef.current = null;
        return;
      }
      const stillConnected = sessionState.participants.some(
        (participant) => participant.peerId === followingPeerId && !participant.isSelf,
      );
      if (!stillConnected) {
        setFollowingPeerId(null);
        lastAppliedFollowKeyRef.current = null;
        return;
      }
      const target = resolveParticipantNavigationTarget({
        targetPeerId: followingPeerId,
        presenceState,
        remoteCursors: presenceControllerRef.current?.getCursors() ?? EMPTY_REMOTE_CURSORS,
        availableCircuitIds: (circuitContext?.project?.logicalCircuits ?? []).map(
          (circuit) => circuit.logicalCircuitId,
        ),
      });
      if (target.status === "paused-library") {
        lastAppliedFollowKeyRef.current = null;
        return;
      }
      if (target.status === "ready") {
        applyNavigationTarget(target, true);
      }
    },
    [
      applyNavigationTarget,
      circuitContext?.project?.logicalCircuits,
      followingPeerId,
      libraryContext?.isEditingLibrary,
      presenceState,
      sessionState.isInSession,
      sessionState.participants,
      simulationContext?.isSimulating,
    ],
  );

  // Beendet den Follow-Modus sofort bei manuellem Pan oder Zoom des lokalen Benutzers
  const subscribeUserViewportInteraction = canvasContext?.subscribeUserViewportInteraction;
  React.useEffect(
    () => {
      if (!subscribeUserViewportInteraction || !followingPeerId) {
        return undefined;
      }
      return subscribeUserViewportInteraction(() => {
        lastAppliedFollowKeyRef.current = null;
        setFollowingPeerId(null);
      });
    },
    [followingPeerId, subscribeUserViewportInteraction],
  );

  // Beendet den Follow-Modus bei manuellem Schaltplanwechsel (programmatische Follow-Wechsel ausgenommen)
  React.useEffect(
    () => {
      const currentCircuitId = circuitContext?.currentCircuitId ?? null;
      if (prevCircuitIdRef.current === currentCircuitId) {
        return;
      }
      prevCircuitIdRef.current = currentCircuitId;
      if (!followingPeerId) {
        programmaticCircuitTargetRef.current = null;
        return;
      }
      if (programmaticCircuitTargetRef.current === currentCircuitId) {
        programmaticCircuitTargetRef.current = null;
        return;
      }
      lastAppliedFollowKeyRef.current = null;
      setFollowingPeerId(null);
    },
    [circuitContext?.currentCircuitId, followingPeerId],
  );

  return (
    <CollabContext.Provider
      value={{
        ...sessionState,
        startHostSession,
        joinSession,
        endOrLeaveSession,
        createInviteLink,
        revokeInviteLink,
        setParticipantRole,
        moderateParticipantName,
        renameSelf,
        toggleHandRaised,
        lowerParticipantHand,
        kickParticipant,
        transferHostRole,
        requestResync,
        setParticipantsPanelOpen,
        clearPendingInviteLink,
        clearError,
        dismissSessionClosedNotice,
        modelSyncState,
        softLockBlockedNotice,
        reportSoftLockBlocked,
        clearSoftLockBlockedNotice,
        clearSyncRejection,
        clearUndoConflict,
        setHostProjectLoading,
        acquireSoftLocks,
        renewSoftLocks,
        releaseSoftLocks,
        getForeignSoftLocks,
        getForeignLockForTarget,
        registerResyncConfirmHandler,
        runWithMutationOrigin,
        presenceState,
        participantColors,
        getParticipantColor,
        setParticipantColor,
        reloadParticipantColors,
        updateLocalPresenceState,
        updateLocalPresenceCursor,
        getRemoteCursors,
        subscribeRemoteCursors,
        followingPeerId,
        startFollowingPeer,
        stopFollowingPeer,
        jumpToParticipant,
      }}
    >
      {children}
    </CollabContext.Provider>
  );
};

export default CollabContextProvider;
