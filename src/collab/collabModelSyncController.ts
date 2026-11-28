import type CircuitProject from "../types/circuit/circuitProject";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type CollabRole from "../types/collab/collabRole";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type { CollabResyncReason } from "../types/collab/dataChannelMessage";
import type {
  CollabCatchupResponsePayload,
  CollabCircuitCommitPayload,
  CollabCommitOrigin,
  CollabHighlightIds,
  CollabHostHandoverReadyPayload,
  CollabHostHandoverStatePayload,
  CollabMutationRejectedPayload,
  CollabMutationRequestPayload,
  CollabProjectSnapshotPayload,
  CollabQuiesceReason,
  CollabSerializedMutation,
  CollabSessionQuiescePayload,
  CollabSoftLockEntry,
  CollabSoftLockPayload,
  CollabSoftLockReason,
  CollabSoftLockTargetType,
} from "../types/collab/modelSyncMessage";
import {
  COLLAB_APP_TOPIC_CATCHUP_RESPONSE,
  COLLAB_APP_TOPIC_CIRCUIT_COMMIT,
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED,
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST,
  COLLAB_APP_TOPIC_HOST_HANDOVER_READY,
  COLLAB_APP_TOPIC_HOST_HANDOVER_STATE,
  COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
  COLLAB_APP_TOPIC_SESSION_QUIESCE,
  COLLAB_APP_TOPIC_SOFT_LOCK,
} from "../types/collab/modelSyncMessage";
import type CircuitDelta from "../types/history/circuitDelta";
import type HistoryState from "../types/history/historyState";

import { generateEntityUuid } from "../utils/entityId";

import {
  applySerializedMutationToProject,
  decodeProjectSnapshot,
  encodeCircuitDeltaToMutation,
  encodeProjectSnapshot,
  extractMutationHighlightIds,
  extractMutationScope,
} from "./collabModelCodec";
import CollabRevisionEngine from "./collabRevisionEngine";
import CollabSoftLockManager, { type CollabSoftLockTarget } from "./collabSoftLockManager";
import CollabUndoManager, { type CollabUndoConflict } from "./collabUndoManager";
import type {
  CollabTransportSnapshot,
  ResyncConfirmationContext,
  ResyncHooks,
} from "./p2pSessionTransport";

const DEFAULT_HANDOVER_READY_TIMEOUT_MS = 3000;

export type CollabModelSyncStatus =
  | "idle"
  | "syncing"
  | "synced"
  | "quiesced"
  | "resyncing";

export type CollabModelSyncState = {
  syncStatus: CollabModelSyncStatus;
  revision: number;
  epochId: string | null;
  unconfirmedMutationCount: number;
  isQuiesced: boolean;
  quiesceReason: CollabQuiesceReason | null;
  isReadOnlyForGuest: boolean;
  lastSyncRejection: CollabMutationRejectedPayload | null;
  lastRemoteCommit: CollabCircuitCommitPayload | null;
  softLocks: CollabSoftLockEntry[];
  lastUndoConflict: CollabUndoConflict | null;
  undoStackVersion: number;
  isLocalSimulationBuffered: boolean;
  pendingSimulationDeltaCount: number;
  hasPendingProjectSwitchDuringSim: boolean;
  requiresResyncAfterSimulation: boolean;
};

export type CollabModelSyncTransport = {
  onTransportSnapshot: (listener: (snapshot: CollabTransportSnapshot | null) => void) => () => void;
  onTransportMessage: (listener: (fromPeerId: string, message: CollabDataChannelMessage) => void) => () => void;
  sendToPeer: (peerId: string, message: CollabDataChannelMessage) => Promise<void>;
  sendToHost: (message: CollabDataChannelMessage) => Promise<void>;
  broadcast: (message: CollabDataChannelMessage, excludePeerId?: string) => Promise<void>;
  requestResync: (reason?: CollabResyncReason, fromRevision?: number) => Promise<boolean>;
  setResyncHooks: (hooks: ResyncHooks | null) => void;
  setBeforeTransferHostHook: (hook: ((targetPeerId: string) => Promise<void>) | null) => void;
};

export type CollabModelSyncAdapter = {
  getVisibleProject: () => CircuitProject;
  applyAuthoritativeProject: (
    project: CircuitProject,
    options?: {
      resetHistory?: boolean;
      preserveSelection?: boolean;
      reason?: "initial" | "resync" | "project-switch" | "rollback" | "commit";
    },
  ) => void;
  isEditingLibrary: () => boolean;
  isLocalSnapshotSimulating?: () => boolean;
  getLibraryBackgroundProject: () => CircuitProject | null;
  setLibraryBackgroundProject: (project: CircuitProject) => void;
  getSelfDisplayName?: () => string;
  getParticipantDisplayName?: (peerId: string) => string | undefined;
  onRemoteCommitApplied?: (commit: CollabCircuitCommitPayload) => void;
  onMutationRejected?: (rejection: CollabMutationRejectedPayload) => void;
  onStateChange?: (state: CollabModelSyncState) => void;
};

export type CollabModelSyncControllerOptions = {
  transport: CollabModelSyncTransport;
  adapter: CollabModelSyncAdapter;
  handoverTimeoutMs?: number;
  maxRingBufferSize?: number;
  softLockTtlMs?: number;
  softLockRenewIntervalMs?: number;
  softLockSweepIntervalMs?: number;
  now?: () => number;
};

type PendingUndoTransition = {
  circuitId: string;
  previousPointer: number;
  direction: "undo" | "redo";
};

type PendingMutationEntry = {
  mutationId: string;
  baseRevision: number;
  mutation: CollabSerializedMutation;
  origin: CollabCommitOrigin;
  highlightIds?: CollabHighlightIds;
};

type PendingHandoverState = {
  project: CircuitProject;
  handover: CollabHostHandoverStatePayload;
};

type HandoverReadyWaiter = {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
};

type BufferedSimulationSnapshot = {
  project: CircuitProject;
  revision: number;
  epochId: string;
  reason: "initial" | "resync" | "project-switch";
  resetHistory: boolean;
  preserveSelection: boolean;
};

// Koordiniert Echtzeit-Synchronisation, Initial-Snapshots, Ringpuffer-Catch-up, Optimistic UI, Quiesce-Handover und Bibliotheks-Isolation
class CollabModelSyncController {
  readonly #transport: CollabModelSyncTransport;
  readonly #adapter: CollabModelSyncAdapter;
  readonly #handoverTimeoutMs: number;
  readonly #maxRingBufferSize: number | undefined;
  readonly #now: () => number;
  readonly #listeners = new Set<(state: CollabModelSyncState) => void>();
  readonly #undoListeners = new Set<() => void>();

  readonly #sentInitialSnapshotPeers = new Set<string>();
  readonly #handoverReadyWaiters = new Map<string, HandoverReadyWaiter>();
  readonly #knownPeerStates = new Map<string, { role: CollabRole; connected: boolean }>();
  readonly #pendingUndoTransitions = new Map<string, PendingUndoTransition>();
  readonly #softLockManager: CollabSoftLockManager;
  readonly #undoManager = new CollabUndoManager();

  #unsubscribes: Array<() => void> = [];
  #snapshot: CollabTransportSnapshot | null = null;
  #revisionEngine: CollabRevisionEngine | null = null;
  #confirmedProject: CircuitProject | null = null;
  #revision = 0;
  #epochId: string | null = null;
  #pendingMutations: PendingMutationEntry[] = [];
  #pendingHandoverState: PendingHandoverState | null = null;
  #requestedSyncForHostId: string | null = null;
  #receivedSnapshotEpochId: string | null = null;
  #syncStatus: CollabModelSyncStatus = "idle";
  #isQuiesced = false;
  #quiesceReason: CollabQuiesceReason | null = null;
  #isHostProjectLoading = false;
  #lastSyncRejection: CollabMutationRejectedPayload | null = null;
  #lastRemoteCommit: CollabCircuitCommitPayload | null = null;
  #lastUndoConflict: CollabUndoConflict | null = null;
  #undoStackVersion = 0;
  #activeMutationOrigin: CollabCommitOrigin = "user";
  #resyncConfirmHandler: ((context: ResyncConfirmationContext) => Promise<boolean> | boolean) | null = null;
  #isLocalSimulationActiveFlag = false;
  #bufferedSimulationSnapshot: BufferedSimulationSnapshot | null = null;
  #bufferedSimulationCommits: CollabCircuitCommitPayload[] = [];
  #pendingHostSimulationProject: CircuitProject | null = null;
  #deferredRemoteCommits: CollabCircuitCommitPayload[] = [];
  #pendingSimulationDeltaCount = 0;
  #hasPendingProjectSwitchDuringSim = false;
  #requiresResyncAfterSimulation = false;

  constructor(options: CollabModelSyncControllerOptions) {
    this.#transport = options.transport;
    this.#adapter = options.adapter;
    this.#handoverTimeoutMs = Math.max(250, options.handoverTimeoutMs ?? DEFAULT_HANDOVER_READY_TIMEOUT_MS);
    this.#maxRingBufferSize = options.maxRingBufferSize;
    this.#now = options.now ?? (() => Date.now());
    this.#softLockManager = new CollabSoftLockManager({
      ttlMs: options.softLockTtlMs,
      renewIntervalMs: options.softLockRenewIntervalMs,
      sweepIntervalMs: options.softLockSweepIntervalMs,
      now: this.#now,
      sendLockMessage: (payload) => {
        this.#sendSoftLockMessage(payload);
      },
      onLocksChanged: () => {
        this.#emitState();
      },
    });

    this.#transport.setResyncHooks({
      getUnconfirmedLocalChangesCount: () => this.#pendingMutations.length,
      getCurrentRevision: () => (this.#receivedSnapshotEpochId !== null ? this.#revision : undefined),
      confirmDiscardLocalChanges: (context) => {
        if (!this.#resyncConfirmHandler) {
          return false;
        }
        return this.#resyncConfirmHandler(context);
      },
      onLocalChangesDiscardedForResync: () => {
        this.#pendingMutations = [];
        this.#emitState();
      },
    });
    this.#transport.setBeforeTransferHostHook((targetPeerId) => this.prepareHostHandover(targetPeerId));

    this.#unsubscribes = [
      this.#transport.onTransportSnapshot((snap) => {
        this.#handleTransportSnapshot(snap);
      }),
      this.#transport.onTransportMessage((fromPeerId, message) => {
        void this.#handleTransportMessage(fromPeerId, message);
      }),
    ];
  }

  getState(): CollabModelSyncState {
    const isInSession = Boolean(
      this.#snapshot &&
      this.#snapshot.sessionId &&
      this.#snapshot.state !== "idle" &&
      this.#snapshot.state !== "disconnected",
    );
    return {
      syncStatus: isInSession ? this.#syncStatus : "idle",
      revision: isInSession ? this.#revision : 0,
      epochId: isInSession ? this.#epochId : null,
      unconfirmedMutationCount: this.#pendingMutations.length,
      isQuiesced: this.#isQuiesced,
      quiesceReason: isInSession && this.#isQuiesced ? this.#quiesceReason : null,
      isReadOnlyForGuest: Boolean(isInSession && this.#snapshot?.selfRole === "guest"),
      lastSyncRejection: this.#lastSyncRejection,
      lastRemoteCommit: this.#lastRemoteCommit,
      softLocks: isInSession ? this.#softLockManager.getActiveLocks() : [],
      lastUndoConflict: isInSession ? this.#lastUndoConflict : null,
      undoStackVersion: this.#undoStackVersion,
      isLocalSimulationBuffered: Boolean(isInSession && this.#isLocalSimulationActive()),
      pendingSimulationDeltaCount: isInSession ? this.#pendingSimulationDeltaCount : 0,
      hasPendingProjectSwitchDuringSim: isInSession ? this.#hasPendingProjectSwitchDuringSim : false,
      requiresResyncAfterSimulation: isInSession
        ? (this.#requiresResyncAfterSimulation || this.#hasBufferedSimulationGap())
        : false,
    };
  }

  subscribe(listener: (state: CollabModelSyncState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  subscribeUndoState(listener: () => void): () => void {
    this.#undoListeners.add(listener);
    return () => {
      this.#undoListeners.delete(listener);
    };
  }

  getSoftLocks(): CollabSoftLockEntry[] {
    return this.#softLockManager.getActiveLocks();
  }

  getForeignSoftLocks(): CollabSoftLockEntry[] {
    return this.#softLockManager.getForeignLocks();
  }

  getForeignLockForTarget(
    targetType: CollabSoftLockTargetType,
    targetId: string,
  ): CollabSoftLockEntry | null {
    return this.#softLockManager.getForeignLockForTarget(targetType, targetId);
  }

  acquireSoftLocks(targets: ReadonlyArray<CollabSoftLockTarget>, reason: CollabSoftLockReason) {
    if (this.#adapter.isEditingLibrary() || !this.#isSessionActive() || this.#isLocalSimulationActive()) {
      return { ok: true as const, acquired: [] };
    }
    return this.#softLockManager.acquireLocks(targets, reason);
  }

  renewSoftLocks(targets?: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>): CollabSoftLockEntry[] {
    if (this.#adapter.isEditingLibrary() || !this.#isSessionActive() || this.#isLocalSimulationActive()) {
      return [];
    }
    return this.#softLockManager.renewLocalLocks(targets);
  }

  releaseSoftLocks(targets?: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>): CollabSoftLockEntry[] {
    return this.#softLockManager.releaseLocks(targets);
  }

  isCollabUndoActive(): boolean {
    return !this.#adapter.isEditingLibrary() && this.#isSessionActive();
  }

  getCollabHistory(logicalCircuitId: string): HistoryState {
    return this.#undoManager.getHistoryState(logicalCircuitId);
  }

  canCollabUndo(logicalCircuitId: string): boolean {
    return this.#undoManager.canUndo(logicalCircuitId);
  }

  canCollabRedo(logicalCircuitId: string): boolean {
    return this.#undoManager.canRedo(logicalCircuitId);
  }

  clearCollabHistory(logicalCircuitId: string): void {
    this.#undoManager.clearCircuit(logicalCircuitId);
    this.#notifyUndoChanged();
    this.#emitState();
  }

  clearUndoConflict(): void {
    if (!this.#lastUndoConflict) {
      return;
    }
    this.#lastUndoConflict = null;
    this.#emitState();
  }

  performCollabUndo(logicalCircuitId: string): boolean {
    return this.#performUndoRedoTransition("undo", logicalCircuitId);
  }

  performCollabRedo(logicalCircuitId: string): boolean {
    return this.#performUndoRedoTransition("redo", logicalCircuitId);
  }

  setResyncConfirmHandler(
    handler: ((context: ResyncConfirmationContext) => Promise<boolean> | boolean) | null,
  ): void {
    this.#resyncConfirmHandler = handler;
  }

  clearSyncRejection(): void {
    if (!this.#lastSyncRejection) {
      return;
    }
    this.#lastSyncRejection = null;
    this.#emitState();
  }

  // Führt eine lokale Aktion (z. B. Host-MCP-Toolaufruf) mit explizitem Commit-Origin aus
  runWithMutationOrigin<T>(origin: CollabCommitOrigin, fn: () => T): T {
    const prev = this.#activeMutationOrigin;
    this.#activeMutationOrigin = origin;
    try {
      return fn();
    } finally {
      this.#activeMutationOrigin = prev;
    }
  }

  // Aktiviert oder beendet die Snapshot-Simulations-Isolation inklusive automatischem Delta-Nachzug bei Stopp
  setLocalSimulationActive(active: boolean): void {
    if (active === this.#isLocalSimulationActiveFlag) {
      return;
    }
    if (active) {
      this.#isLocalSimulationActiveFlag = true;
      if (this.#isSessionActive() && !this.#adapter.isEditingLibrary()) {
        this.#softLockManager.releaseLocks();
      }
      this.#emitState();
      return;
    }
    this.#isLocalSimulationActiveFlag = false;
    this.#flushBufferedSimulationUpdates();
  }

  // Prüft, ob lokale Änderungen am aktuell sichtbaren Editor-Projekt erlaubt sind
  canMutateProject(): boolean {
    if (this.#adapter.isEditingLibrary()) {
      return true;
    }
    const snap = this.#snapshot;
    if (!snap || !snap.sessionId || snap.state === "idle" || snap.state === "disconnected") {
      return true;
    }
    if (snap.selfRole === "guest") {
      return false;
    }
    if (this.#isQuiesced) {
      return false;
    }
    if (this.#isLocalSimulationActive()) {
      return false;
    }
    return true;
  }

  // Übermittelt ein lokales CircuitDelta in die aktive Kollaborations-Session
  submitLocalDelta(
    delta: CircuitDelta,
    projectAfterDelta: CircuitProject,
    options?: { importedSubCircuits?: readonly LogicalCircuit[] },
  ): void {
    if (this.#adapter.isEditingLibrary() || !this.#isSessionActive()) {
      return;
    }
    const mutationId = generateEntityUuid();
    this.#undoManager.recordLocalDelta(delta, projectAfterDelta, {
      mutationId,
      importedSubCircuits: options?.importedSubCircuits,
    });
    this.#lastUndoConflict = null;
    this.#notifyUndoChanged();
    const mutation = encodeCircuitDeltaToMutation(delta, projectAfterDelta, options);
    this.#submitSerializedMutation(mutation, { mutationId });
  }

  // Übermittelt eine bereits serialisierte Mutation an Host oder lokalen Host-Commit
  submitLocalMutation(
    mutation: CollabSerializedMutation,
    options?: { origin?: CollabCommitOrigin; highlightIds?: CollabHighlightIds; mutationId?: string },
  ): void {
    this.#submitSerializedMutation(mutation, options);
  }

  #submitSerializedMutation(
    mutation: CollabSerializedMutation,
    options?: { origin?: CollabCommitOrigin; highlightIds?: CollabHighlightIds; mutationId?: string },
  ): { acceptedOnHost?: boolean; mutationId: string } {
    const mutationId = options?.mutationId ?? generateEntityUuid();
    if (this.#adapter.isEditingLibrary() || !this.#isSessionActive() || !this.#snapshot) {
      return { mutationId };
    }
    if (this.#snapshot.selfRole === "guest" || this.#isQuiesced || this.#isLocalSimulationActive()) {
      return { acceptedOnHost: false, mutationId };
    }

    const origin = options?.origin ?? this.#activeMutationOrigin;
    const highlightIds = options?.highlightIds ?? extractMutationHighlightIds(mutation);

    if (this.#snapshot.selfRole === "host") {
      if (!this.#revisionEngine) {
        return { acceptedOnHost: false, mutationId };
      }
      const result = this.#revisionEngine.submitMutation(
        {
          mutationId,
          baseRevision: this.#revisionEngine.getRevision(),
          mutation,
          origin,
          highlightIds,
        },
        this.#snapshot.selfPeerId ?? "host",
      );
      if (result.accepted) {
        this.#confirmedProject = result.project;
        this.#revision = result.commit.revision;
        this.#epochId = this.#revisionEngine.getEpochId();
        this.#lastRemoteCommit = result.commit;
        void this.#transport.broadcast({
          kind: "app",
          topic: COLLAB_APP_TOPIC_CIRCUIT_COMMIT,
          payload: result.commit,
        }).catch(() => {});
        this.#emitState();
        return { acceptedOnHost: true, mutationId };
      } else {
        const undoRemoved = this.#undoManager.discardByMutationId(mutationId);
        if (undoRemoved) {
          this.#notifyUndoChanged();
        }
        this.#lastSyncRejection = result.rejection;
        if (this.#confirmedProject) {
          this.#applySessionProject(this.#confirmedProject, {
            resetHistory: false,
            preserveSelection: true,
            reason: "rollback",
          });
        }
        this.#adapter.onMutationRejected?.(result.rejection);
        this.#emitState();
        return { acceptedOnHost: false, mutationId };
      }
    }

    const requestPayload: CollabMutationRequestPayload = {
      mutationId,
      baseRevision: this.#revision,
      mutation,
      origin,
      highlightIds,
    };
    this.#pendingMutations.push({
      mutationId,
      baseRevision: this.#revision,
      mutation,
      origin,
      highlightIds,
    });
    this.#emitState();

    void this.#transport.sendToHost({
      kind: "app",
      topic: COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST,
      payload: requestPayload,
    }).catch(() => {});
    return { mutationId };
  }

  // Aktiviert oder beendet die Session-Sperre, während der Host eine neue Projektdatei auswählt
  setHostProjectLoading(loading: boolean): void {
    if (!this.#isSessionActive() || !this.#snapshot || this.#snapshot.selfRole !== "host" || !this.#revisionEngine) {
      return;
    }

    if (loading) {
      if (this.#isHostProjectLoading) {
        return;
      }
      this.#isHostProjectLoading = true;
      this.#revisionEngine.setQuiesced(true);
      this.#isQuiesced = true;
      this.#quiesceReason = "project-loading";
      this.#syncStatus = "quiesced";
      void this.#transport.broadcast({
        kind: "app",
        topic: COLLAB_APP_TOPIC_SESSION_QUIESCE,
        payload: { quiesced: true, reason: "project-loading" },
      }).catch(() => {});
      this.#emitState();
      return;
    }

    if (!this.#isHostProjectLoading) {
      return;
    }
    this.#isHostProjectLoading = false;
    if (this.#quiesceReason === "project-loading") {
      this.#revisionEngine.setQuiesced(false);
      this.#isQuiesced = false;
      this.#quiesceReason = null;
      this.#syncStatus = "synced";
      void this.#transport.broadcast({
        kind: "app",
        topic: COLLAB_APP_TOPIC_SESSION_QUIESCE,
        payload: { quiesced: false },
      }).catch(() => {});
      this.#emitState();
    }
  }

  // Benachrichtigt über einen vollständigen Projektwechsel (Neu, Demo, Import) auf Host-Seite
  notifyLocalProjectReplaced(nextProject: CircuitProject): void {
    if (this.#adapter.isEditingLibrary() || !this.#isSessionActive() || !this.#snapshot) {
      return;
    }
    if (this.#snapshot.selfRole !== "host" || !this.#revisionEngine) {
      return;
    }
    const snapshotPayload = this.#revisionEngine.resetWithProject(nextProject);
    this.#confirmedProject = this.#revisionEngine.getProject();
    this.#revision = snapshotPayload.revision;
    this.#epochId = snapshotPayload.epochId;
    this.#pendingMutations = [];
    this.#pendingUndoTransitions.clear();
    this.#undoManager.clearAll();
    this.#lastUndoConflict = null;
    this.#softLockManager.clearAllLocks(true);
    this.#notifyUndoChanged();
    this.#lastSyncRejection = null;
    this.#isHostProjectLoading = false;
    this.#isQuiesced = false;
    this.#quiesceReason = null;
    this.#syncStatus = "synced";
    void this.#transport.broadcast({
      kind: "app",
      topic: COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
      payload: snapshotPayload,
    }).catch(() => {});
    this.#emitState();
  }

  // Pausiert neue Mutationen (Quiesce) und übergibt Projektstand samt Ringpuffer konsistent vor einem Host-Handover
  async prepareHostHandover(targetPeerId: string): Promise<void> {
    if (!this.#snapshot || this.#snapshot.selfRole !== "host" || !this.#revisionEngine) {
      return;
    }

    this.#softLockManager.clearAllLocks(true);
    this.#isHostProjectLoading = false;
    this.#revisionEngine.setQuiesced(true);
    this.#isQuiesced = true;
    this.#quiesceReason = "host-handover";
    this.#syncStatus = "quiesced";
    void this.#transport.broadcast({
      kind: "app",
      topic: COLLAB_APP_TOPIC_SESSION_QUIESCE,
      payload: { quiesced: true, reason: "host-handover" },
    }).catch(() => {});
    this.#emitState();

    const handoverPayload: CollabHostHandoverStatePayload = {
      revision: this.#revisionEngine.getRevision(),
      epochId: this.#revisionEngine.getEpochId(),
      ringBuffer: this.#revisionEngine.getRingBuffer(),
      snapshot: encodeProjectSnapshot(this.#revisionEngine.getProject()),
    };

    const waitReady = new Promise<void>((resolve) => {
      const existing = this.#handoverReadyWaiters.get(targetPeerId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve();
      }
      const timer = setTimeout(() => {
        this.#handoverReadyWaiters.delete(targetPeerId);
        resolve();
      }, this.#handoverTimeoutMs);
      this.#handoverReadyWaiters.set(targetPeerId, { resolve, timer });
    });

    try {
      await this.#transport.sendToPeer(targetPeerId, {
        kind: "app",
        topic: COLLAB_APP_TOPIC_HOST_HANDOVER_STATE,
        payload: handoverPayload,
      });
      await waitReady;
    } catch {
      const waiter = this.#handoverReadyWaiters.get(targetPeerId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.#handoverReadyWaiters.delete(targetPeerId);
        waiter.resolve();
      }
    }
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribes) {
      unsubscribe();
    }
    this.#unsubscribes = [];
    this.#clearHandoverWaiters();
    this.#softLockManager.dispose();
    this.#undoManager.clearAll();
    this.#pendingUndoTransitions.clear();
    this.#knownPeerStates.clear();
    this.#transport.setResyncHooks(null);
    this.#transport.setBeforeTransferHostHook(null);
    this.#listeners.clear();
    this.#undoListeners.clear();
  }

  #isSessionActive(): boolean {
    return Boolean(
      this.#snapshot &&
      this.#snapshot.sessionId &&
      this.#snapshot.state !== "idle" &&
      this.#snapshot.state !== "disconnected",
    );
  }

  #getSessionProject(): CircuitProject {
    if (this.#adapter.isEditingLibrary()) {
      return this.#adapter.getLibraryBackgroundProject() ?? this.#adapter.getVisibleProject();
    }
    return this.#adapter.getVisibleProject();
  }

  #applySessionProject(
    project: CircuitProject,
    options: {
      resetHistory?: boolean;
      preserveSelection?: boolean;
      reason: "initial" | "resync" | "project-switch" | "rollback" | "commit";
    },
  ): void {
    if (this.#adapter.isEditingLibrary()) {
      this.#adapter.setLibraryBackgroundProject(project);
      return;
    }
    this.#adapter.applyAuthoritativeProject(project, options);
  }

  #handleTransportSnapshot(snapshot: CollabTransportSnapshot | null): void {
    const previousSnapshot = this.#snapshot;
    this.#snapshot = snapshot;

    if (!snapshot || !snapshot.sessionId || snapshot.state === "idle" || snapshot.state === "disconnected") {
      this.#softLockManager.configureSession({
        isActive: false,
        selfPeerId: null,
        selfDisplayName: "",
        selfRole: null,
      });
      this.#resetSyncState();
      this.#emitState();
      return;
    }

    this.#softLockManager.configureSession({
      isActive: true,
      selfPeerId: snapshot.selfPeerId,
      selfDisplayName: this.#resolvePeerDisplayName(snapshot.selfPeerId),
      selfRole: snapshot.selfRole,
    });

    if (snapshot.selfRole === "host") {
      this.#handleHostSnapshot(snapshot, previousSnapshot);
      return;
    }

    this.#handleNonHostSnapshot(snapshot, previousSnapshot);
  }

  #handleHostSnapshot(
    snapshot: CollabTransportSnapshot,
    previousSnapshot: CollabTransportSnapshot | null,
  ): void {
    const becameHost = !this.#revisionEngine || previousSnapshot?.selfRole !== "host";
    if (becameHost) {
      this.#sentInitialSnapshotPeers.clear();
      this.#requestedSyncForHostId = null;
      this.#isHostProjectLoading = false;
      this.#isQuiesced = false;
      this.#quiesceReason = null;

      if (this.#pendingHandoverState) {
        const pending = this.#pendingHandoverState;
        this.#pendingHandoverState = null;
        this.#revisionEngine = new CollabRevisionEngine({
          initialProject: pending.project,
          initialRevision: pending.handover.revision,
          epochId: pending.handover.epochId,
          maxRingBufferSize: this.#maxRingBufferSize,
          now: this.#now,
        });
        this.#revisionEngine.restoreFromHandover(pending.project, pending.handover);
        this.#confirmedProject = this.#revisionEngine.getProject();
        this.#revision = this.#revisionEngine.getRevision();
        this.#epochId = this.#revisionEngine.getEpochId();
        this.#pendingMutations = [];
        // Bestehende Peers behalten ihren Stand und holen eventuelle Lücken per Ringpuffer-Catch-up nach
        for (const peer of snapshot.peers) {
          this.#sentInitialSnapshotPeers.add(peer.peerId);
        }
      } else {
        const baseProject = this.#confirmedProject ?? this.#getSessionProject();
        this.#revisionEngine = new CollabRevisionEngine({
          initialProject: baseProject,
          initialRevision: this.#revision,
          epochId: this.#epochId ?? undefined,
          maxRingBufferSize: this.#maxRingBufferSize,
          now: this.#now,
        });
        this.#confirmedProject = this.#revisionEngine.getProject();
        this.#revision = this.#revisionEngine.getRevision();
        this.#epochId = this.#revisionEngine.getEpochId();
      }
      this.#syncStatus = "synced";
    }

    const activePeerIds = new Set(snapshot.peers.map((p) => p.peerId));
    for (const sentPeerId of Array.from(this.#sentInitialSnapshotPeers)) {
      if (!activePeerIds.has(sentPeerId)) {
        this.#sentInitialSnapshotPeers.delete(sentPeerId);
      }
    }

    // Locks von getrennten oder auf Gast zurückgestuften Teilnehmern sofort freigeben
    const releasedForPeers: CollabSoftLockEntry[] = [];
    for (const knownPeerId of Array.from(this.#knownPeerStates.keys())) {
      const currentPeer = snapshot.peers.find((p) => p.peerId === knownPeerId);
      if (!currentPeer || currentPeer.state === "disconnected" || currentPeer.state === "failed" || currentPeer.role === "guest") {
        releasedForPeers.push(...this.#softLockManager.releaseLocksByOwner(knownPeerId));
        if (!currentPeer) {
          this.#knownPeerStates.delete(knownPeerId);
        }
      }
    }
    for (const peer of snapshot.peers) {
      this.#knownPeerStates.set(peer.peerId, {
        role: peer.role,
        connected: peer.state === "connected",
      });
    }
    if (releasedForPeers.length > 0) {
      void this.#transport.broadcast({
        kind: "app",
        topic: COLLAB_APP_TOPIC_SOFT_LOCK,
        payload: {
          action: "release",
          locks: releasedForPeers,
          senderPeerId: this.#snapshot?.selfPeerId ?? undefined,
        },
      }).catch(() => {});
    }

    if (this.#revisionEngine) {
      for (const peer of snapshot.peers) {
        if (peer.state === "connected" && !this.#sentInitialSnapshotPeers.has(peer.peerId)) {
          this.#sentInitialSnapshotPeers.add(peer.peerId);
          const payload = this.#revisionEngine.createSnapshotPayload("initial");
          void this.#transport.sendToPeer(peer.peerId, {
            kind: "app",
            topic: COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
            payload,
          }).catch(() => {});
          const activeLocks = this.#softLockManager.getActiveLocks();
          if (activeLocks.length > 0) {
            void this.#transport.sendToPeer(peer.peerId, {
              kind: "app",
              topic: COLLAB_APP_TOPIC_SOFT_LOCK,
              payload: this.#softLockManager.createSnapshotPayload(),
            }).catch(() => {});
          }
          if (this.#isHostProjectLoading) {
            void this.#transport.sendToPeer(peer.peerId, {
              kind: "app",
              topic: COLLAB_APP_TOPIC_SESSION_QUIESCE,
              payload: { quiesced: true, reason: "project-loading" },
            }).catch(() => {});
          }
        }
      }
    }

    this.#emitState();
  }

  #handleNonHostSnapshot(
    snapshot: CollabTransportSnapshot,
    previousSnapshot: CollabTransportSnapshot | null,
  ): void {
    this.#revisionEngine = null;
    this.#sentInitialSnapshotPeers.clear();
    this.#clearHandoverWaiters();

    if (snapshot.state === "migrating-host") {
      this.#isQuiesced = true;
      this.#quiesceReason = "host-handover";
      this.#syncStatus = "quiesced";
      this.#emitState();
      return;
    }

    if (previousSnapshot?.hostPeerId && previousSnapshot.hostPeerId !== snapshot.hostPeerId) {
      this.#isQuiesced = false;
      this.#quiesceReason = null;
    } else if (this.#quiesceReason !== "project-loading") {
      this.#isQuiesced = false;
      this.#quiesceReason = null;
    }

    if (this.#isLocalSimulationActive()) {
      if (snapshot.state === "degraded" || snapshot.state === "reconnecting") {
        this.#requiresResyncAfterSimulation = true;
      }
      if (
        snapshot.state === "connected" &&
        snapshot.hostPeerId &&
        this.#requestedSyncForHostId !== snapshot.hostPeerId
      ) {
        this.#requestedSyncForHostId = snapshot.hostPeerId;
        if (this.#receivedSnapshotEpochId !== null) {
          this.#requiresResyncAfterSimulation = true;
        }
      }
      this.#emitState();
      return;
    }

    if (this.#receivedSnapshotEpochId === null) {
      this.#syncStatus = "syncing";
    } else if (snapshot.state === "degraded" || snapshot.state === "reconnecting") {
      this.#syncStatus = "resyncing";
    } else if (this.#isQuiesced) {
      this.#syncStatus = "quiesced";
    } else {
      this.#syncStatus = "synced";
    }

    if (
      snapshot.state === "connected" &&
      snapshot.hostPeerId &&
      this.#requestedSyncForHostId !== snapshot.hostPeerId
    ) {
      const targetHostId = snapshot.hostPeerId;
      this.#requestedSyncForHostId = targetHostId;
      const fromRevision = this.#receivedSnapshotEpochId !== null ? this.#revision : undefined;
      queueMicrotask(() => {
        if (
          this.#snapshot?.hostPeerId === targetHostId &&
          this.#snapshot?.selfRole !== "host" &&
          this.#snapshot?.state === "connected"
        ) {
          void this.#transport.sendToHost({
            kind: "resync-request",
            reason: fromRevision !== undefined ? "reconnected" : "manual",
            ...(fromRevision !== undefined ? { fromRevision } : {}),
            hasUnconfirmedLocalChanges: this.#pendingMutations.length > 0,
          }).catch(() => {});
        }
      });
    }

    this.#emitState();
  }

  async #handleTransportMessage(fromPeerId: string, message: CollabDataChannelMessage): Promise<void> {
    if (!this.#isSessionActive() || !this.#snapshot) {
      return;
    }

    if (this.#snapshot.selfRole === "host") {
      await this.#handleHostMessage(fromPeerId, message);
      return;
    }

    await this.#handleNonHostMessage(message);
  }

  async #handleHostMessage(fromPeerId: string, message: CollabDataChannelMessage): Promise<void> {
    if (!this.#revisionEngine) {
      return;
    }

    if (message.kind === "resync-request") {
      if (message.fromRevision !== undefined) {
        const catchup = this.#revisionEngine.getCatchupSince(message.fromRevision);
        if (!catchup.requiresFullSnapshot) {
          await this.#transport.sendToPeer(fromPeerId, {
            kind: "app",
            topic: COLLAB_APP_TOPIC_CATCHUP_RESPONSE,
            payload: catchup,
          }).catch(() => {});
          await this.#sendHostLoadingStateToPeer(fromPeerId, true);
          return;
        }
      }

      const snapshotPayload = this.#revisionEngine.createSnapshotPayload(
        message.reason === "manual" ? "resync" : "initial",
      );
      this.#sentInitialSnapshotPeers.add(fromPeerId);
      await this.#transport.sendToPeer(fromPeerId, {
        kind: "app",
        topic: COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
        payload: snapshotPayload,
      }).catch(() => {});
      await this.#sendHostLoadingStateToPeer(fromPeerId, true);
      return;
    }

    if (message.kind !== "app") {
      return;
    }

    if (message.topic === COLLAB_APP_TOPIC_HOST_HANDOVER_READY) {
      const payload = message.payload as Partial<CollabHostHandoverReadyPayload> | undefined;
      if (!payload) {
        return;
      }
      const waiter = this.#handoverReadyWaiters.get(fromPeerId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.#handoverReadyWaiters.delete(fromPeerId);
        waiter.resolve();
      }
      return;
    }

    if (message.topic === COLLAB_APP_TOPIC_SOFT_LOCK) {
      const payload = message.payload as CollabSoftLockPayload | undefined;
      if (!payload) {
        return;
      }
      const { broadcast, replySnapshot } = this.#softLockManager.handleIncomingPayload(
        fromPeerId,
        payload,
        true,
        this.#resolvePeerDisplayName(fromPeerId),
      );
      if (broadcast) {
        await this.#transport.broadcast(
          {
            kind: "app",
            topic: COLLAB_APP_TOPIC_SOFT_LOCK,
            payload: broadcast,
          },
          fromPeerId,
        ).catch(() => {});
      }
      if (replySnapshot) {
        await this.#transport.sendToPeer(fromPeerId, {
          kind: "app",
          topic: COLLAB_APP_TOPIC_SOFT_LOCK,
          payload: replySnapshot,
        }).catch(() => {});
      }
      return;
    }

    if (message.topic === COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST) {
      const payload = message.payload as CollabMutationRequestPayload;
      const blockingLocks = this.#findBlockingSoftLocksForMutation(payload.mutation, fromPeerId);
      if (blockingLocks.length > 0) {
        await this.#transport.sendToPeer(fromPeerId, {
          kind: "app",
          topic: COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED,
          payload: {
            mutationId: payload.mutationId,
            code: "conflict",
            message: `Element wird aktuell von ${blockingLocks[0].ownerDisplayName} bearbeitet.`,
            hostRevision: this.#revisionEngine.getRevision(),
            requiresResync: false,
            conflictingEntityIds: Array.from(new Set(blockingLocks.map((lock) => lock.targetId))),
          },
        }).catch(() => {});
        return;
      }

      const result = this.#revisionEngine.submitMutation(payload, fromPeerId);

      if (!result.accepted) {
        await this.#transport.sendToPeer(fromPeerId, {
          kind: "app",
          topic: COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED,
          payload: result.rejection,
        }).catch(() => {});
        return;
      }

      if (!result.deduplicated) {
        this.#confirmedProject = result.project;
        this.#revision = result.commit.revision;
        this.#epochId = this.#revisionEngine.getEpochId();
        this.#lastRemoteCommit = result.commit;
        if (this.#isLocalSimulationActive()) {
          this.#pendingHostSimulationProject = result.project;
          this.#pendingSimulationDeltaCount += 1;
          this.#deferredRemoteCommits.push(result.commit);
        } else {
          this.#applySessionProject(result.project, {
            resetHistory: false,
            preserveSelection: true,
            reason: "commit",
          });
          this.#adapter.onRemoteCommitApplied?.(result.commit);
        }
        this.#emitState();
      }

      await this.#transport.broadcast({
        kind: "app",
        topic: COLLAB_APP_TOPIC_CIRCUIT_COMMIT,
        payload: result.commit,
      }).catch(() => {});
    }
  }

  async #handleNonHostMessage(message: CollabDataChannelMessage): Promise<void> {
    if (message.kind !== "app") {
      return;
    }

    switch (message.topic) {
      case COLLAB_APP_TOPIC_PROJECT_SNAPSHOT: {
        const payload = message.payload as CollabProjectSnapshotPayload;
        this.#applyIncomingSnapshot(payload);
        break;
      }

      case COLLAB_APP_TOPIC_CATCHUP_RESPONSE: {
        const payload = message.payload as CollabCatchupResponsePayload;
        if (this.#isLocalSimulationActive()) {
          if (payload.requiresFullSnapshot) {
            this.#requiresResyncAfterSimulation = true;
            this.#emitState();
            return;
          }
          for (const entry of payload.entries) {
            this.#enqueueBufferedSimulationCommit(entry);
          }
          this.#emitState();
          break;
        }
        if (payload.requiresFullSnapshot) {
          this.#syncStatus = "resyncing";
          this.#emitState();
          await this.#transport.sendToHost({
            kind: "resync-request",
            reason: "revision-gap",
            hasUnconfirmedLocalChanges: this.#pendingMutations.length > 0,
          }).catch(() => {});
          return;
        }
        this.#applyIncomingCatchup(payload.entries);
        break;
      }

      case COLLAB_APP_TOPIC_CIRCUIT_COMMIT: {
        const commit = message.payload as CollabCircuitCommitPayload;
        await this.#applyIncomingCommit(commit);
        break;
      }

      case COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED: {
        const rejection = message.payload as CollabMutationRejectedPayload;
        await this.#applyIncomingRejection(rejection);
        break;
      }

      case COLLAB_APP_TOPIC_SOFT_LOCK: {
        const payload = message.payload as CollabSoftLockPayload | undefined;
        if (!payload) {
          break;
        }
        this.#softLockManager.handleIncomingPayload(
          this.#snapshot?.hostPeerId ?? "host",
          payload,
          false,
        );
        break;
      }

      case COLLAB_APP_TOPIC_SESSION_QUIESCE: {
        const payload = message.payload as Partial<CollabSessionQuiescePayload> | undefined;
        if (!payload || typeof payload.quiesced !== "boolean") {
          break;
        }
        if (payload.quiesced) {
          this.#isQuiesced = true;
          this.#quiesceReason = payload.reason ?? "project-loading";
          this.#syncStatus = "quiesced";
        } else {
          this.#isQuiesced = false;
          this.#quiesceReason = null;
          this.#syncStatus = this.#receivedSnapshotEpochId === null ? "syncing" : "synced";
        }
        this.#emitState();
        break;
      }

      case COLLAB_APP_TOPIC_HOST_HANDOVER_STATE: {
        const handover = message.payload as CollabHostHandoverStatePayload;
        if (this.#isLocalSimulationActive()) {
          if (handover.snapshot) {
            try {
              const hydrated = decodeProjectSnapshot(handover.snapshot);
              this.#pendingHandoverState = { project: hydrated, handover };
              this.#bufferedSimulationSnapshot = {
                project: hydrated,
                revision: handover.revision,
                epochId: handover.epochId,
                reason: "resync",
                resetHistory: false,
                preserveSelection: true,
              };
              this.#bufferedSimulationCommits = [];
              this.#deferredRemoteCommits = [];
              this.#pendingHostSimulationProject = hydrated;
              this.#pendingSimulationDeltaCount += 1;
            } catch {
              this.#requiresResyncAfterSimulation = true;
            }
          }
          await this.#transport.sendToHost({
            kind: "app",
            topic: COLLAB_APP_TOPIC_HOST_HANDOVER_READY,
            payload: {
              targetPeerId: this.#snapshot?.selfPeerId ?? "",
              acceptedRevision: handover.snapshot ? handover.revision : this.#revision,
              ok: true,
            } satisfies CollabHostHandoverReadyPayload,
          }).catch(() => {});
          this.#emitState();
          break;
        }
        if (handover.snapshot) {
          try {
            const hydrated = decodeProjectSnapshot(handover.snapshot);
            this.#pendingHandoverState = { project: hydrated, handover };
            this.#confirmedProject = hydrated;
            this.#revision = handover.revision;
            this.#epochId = handover.epochId;
            this.#receivedSnapshotEpochId = handover.epochId;
            this.#pendingMutations = [];
            this.#applySessionProject(hydrated, {
              resetHistory: false,
              preserveSelection: true,
              reason: "resync",
            });
          } catch {
            // Fehlerhafter Handover-Snapshot wird als Fallback über regulären Resync aufgelöst
          }
        }
        await this.#transport.sendToHost({
          kind: "app",
          topic: COLLAB_APP_TOPIC_HOST_HANDOVER_READY,
          payload: {
            targetPeerId: this.#snapshot?.selfPeerId ?? "",
            acceptedRevision: this.#revision,
            ok: true,
          } satisfies CollabHostHandoverReadyPayload,
        }).catch(() => {});
        this.#emitState();
        break;
      }
    }
  }

  #applyIncomingSnapshot(payload: CollabProjectSnapshotPayload): void {
    let hydrated: CircuitProject;
    try {
      hydrated = decodeProjectSnapshot(payload.document);
    } catch {
      return;
    }

    if (this.#isLocalSimulationActive()) {
      const effectiveRevision = this.#bufferedSimulationSnapshot
        ? this.#bufferedSimulationSnapshot.revision
        : this.#revision;
      const effectiveEpochId = this.#bufferedSimulationSnapshot
        ? this.#bufferedSimulationSnapshot.epochId
        : this.#receivedSnapshotEpochId;
      const isSameEpoch = effectiveEpochId === payload.epochId;
      if (isSameEpoch && payload.reason === "initial" && payload.revision <= effectiveRevision) {
        this.#emitState();
        return;
      }
      this.#bufferedSimulationSnapshot = {
        project: hydrated,
        revision: payload.revision,
        epochId: payload.epochId,
        reason: payload.reason,
        resetHistory: payload.reason === "project-switch" || !isSameEpoch,
        preserveSelection: payload.reason === "resync" && isSameEpoch,
      };
      this.#bufferedSimulationCommits = [];
      this.#deferredRemoteCommits = [];
      if (payload.reason === "project-switch") {
        this.#hasPendingProjectSwitchDuringSim = true;
      }
      this.#requiresResyncAfterSimulation = false;
      this.#pendingSimulationDeltaCount += 1;
      this.#emitState();
      return;
    }

    const isSameEpoch = this.#receivedSnapshotEpochId === payload.epochId;
    if (isSameEpoch && payload.reason === "initial" && payload.revision <= this.#revision) {
      this.#syncStatus = "synced";
      this.#emitState();
      return;
    }

    this.#confirmedProject = hydrated;
    this.#revision = payload.revision;
    this.#epochId = payload.epochId;
    this.#receivedSnapshotEpochId = payload.epochId;
    this.#pendingMutations = [];
    this.#lastSyncRejection = null;
    if (payload.reason === "project-switch") {
      this.#isQuiesced = false;
      this.#quiesceReason = null;
      this.#softLockManager.clearAllLocks(false);
      this.#undoManager.clearAll();
      this.#pendingUndoTransitions.clear();
      this.#lastUndoConflict = null;
      this.#notifyUndoChanged();
    }
    this.#syncStatus = this.#isQuiesced ? "quiesced" : "synced";
    this.#applySessionProject(hydrated, {
      resetHistory: payload.reason === "project-switch" || !isSameEpoch,
      preserveSelection: payload.reason === "resync" && isSameEpoch,
      reason: payload.reason,
    });
    this.#emitState();
  }

  #applyIncomingCatchup(entries: CollabCircuitCommitPayload[]): void {
    if (!this.#confirmedProject) {
      return;
    }
    const sorted = [...entries].sort((a, b) => a.revision - b.revision);
    let working = this.#confirmedProject;
    let appliedCount = 0;

    for (const entry of sorted) {
      if (entry.revision <= this.#revision) {
        continue;
      }
      if (entry.revision > this.#revision + 1) {
        this.#syncStatus = "resyncing";
        this.#emitState();
        void this.#transport.sendToHost({
          kind: "resync-request",
          reason: "revision-gap",
          hasUnconfirmedLocalChanges: this.#pendingMutations.length > 0,
        }).catch(() => {});
        return;
      }
      try {
        working = applySerializedMutationToProject(working, entry.mutation);
        this.#revision = entry.revision;
        this.#pendingMutations = this.#pendingMutations.filter((p) => p.mutationId !== entry.mutationId);
        this.#lastRemoteCommit = entry;
        appliedCount += 1;
        if (entry.authorPeerId !== this.#snapshot?.selfPeerId) {
          this.#adapter.onRemoteCommitApplied?.(entry);
        }
      } catch {
        this.#pendingMutations = [];
        void this.#transport.sendToHost({
          kind: "resync-request",
          reason: "conflict",
          hasUnconfirmedLocalChanges: false,
        }).catch(() => {});
        return;
      }
    }

    this.#confirmedProject = working;
    this.#syncStatus = "synced";
    if (appliedCount > 0) {
      const rebased = this.#rebasePendingMutations(working);
      this.#applySessionProject(rebased, {
        resetHistory: false,
        preserveSelection: true,
        reason: "commit",
      });
    }
    this.#emitState();
  }

  async #applyIncomingCommit(commit: CollabCircuitCommitPayload): Promise<void> {
    if (this.#isLocalSimulationActive()) {
      if (this.#receivedSnapshotEpochId === null || (!this.#confirmedProject && !this.#bufferedSimulationSnapshot)) {
        this.#requiresResyncAfterSimulation = true;
        this.#emitState();
        return;
      }
      this.#enqueueBufferedSimulationCommit(commit);
      this.#emitState();
      return;
    }

    if (commit.revision <= this.#revision) {
      return;
    }

    if (this.#receivedSnapshotEpochId === null || !this.#confirmedProject) {
      this.#syncStatus = "resyncing";
      this.#emitState();
      await this.#transport.sendToHost({
        kind: "resync-request",
        reason: "revision-gap",
        hasUnconfirmedLocalChanges: this.#pendingMutations.length > 0,
      }).catch(() => {});
      return;
    }

    if (commit.revision > this.#revision + 1) {
      this.#syncStatus = "resyncing";
      this.#emitState();
      await this.#transport.sendToHost({
        kind: "resync-request",
        reason: "revision-gap",
        fromRevision: this.#revision,
        hasUnconfirmedLocalChanges: this.#pendingMutations.length > 0,
      }).catch(() => {});
      return;
    }

    try {
      this.#confirmedProject = applySerializedMutationToProject(this.#confirmedProject, commit.mutation);
    } catch {
      this.#pendingMutations = [];
      this.#syncStatus = "resyncing";
      this.#emitState();
      await this.#transport.sendToHost({
        kind: "resync-request",
        reason: "conflict",
        hasUnconfirmedLocalChanges: false,
      }).catch(() => {});
      return;
    }

    this.#revision = commit.revision;
    this.#pendingMutations = this.#pendingMutations.filter((p) => p.mutationId !== commit.mutationId);
    this.#pendingUndoTransitions.delete(commit.mutationId);
    this.#lastRemoteCommit = commit;
    this.#syncStatus = "synced";

    const nextVisible = this.#rebasePendingMutations(this.#confirmedProject);
    this.#applySessionProject(nextVisible, {
      resetHistory: false,
      preserveSelection: true,
      reason: "commit",
    });

    if (commit.authorPeerId !== this.#snapshot?.selfPeerId) {
      this.#adapter.onRemoteCommitApplied?.(commit);
    }
    this.#emitState();
  }

  async #applyIncomingRejection(rejection: CollabMutationRejectedPayload): Promise<void> {
    const wasPending = this.#pendingMutations.some((p) => p.mutationId === rejection.mutationId);
    if (rejection.requiresResync) {
      this.#pendingMutations = [];
    } else {
      this.#pendingMutations = this.#pendingMutations.filter((p) => p.mutationId !== rejection.mutationId);
    }

    const undoTransition = this.#pendingUndoTransitions.get(rejection.mutationId);
    if (undoTransition) {
      this.#pendingUndoTransitions.delete(rejection.mutationId);
      this.#undoManager.restorePointer(undoTransition.circuitId, undoTransition.previousPointer);
      this.#lastUndoConflict = {
        direction: undoTransition.direction,
        code: rejection.code === "quiesced" ? "quiesced" : "entity-modified",
        message: rejection.message,
        logicalCircuitId: undoTransition.circuitId,
        conflictingEntityIds: rejection.conflictingEntityIds ?? [],
        preservedEntry: true,
      };
      this.#notifyUndoChanged();
    } else if (this.#undoManager.discardByMutationId(rejection.mutationId)) {
      this.#notifyUndoChanged();
    }

    this.#lastSyncRejection = rejection;

    if (this.#confirmedProject && (wasPending || rejection.requiresResync)) {
      const rolledBack = this.#rebasePendingMutations(this.#confirmedProject);
      this.#applySessionProject(rolledBack, {
        resetHistory: false,
        preserveSelection: true,
        reason: "rollback",
      });
    }

    this.#adapter.onMutationRejected?.(rejection);

    if (rejection.hostRevision > this.#revision) {
      this.#syncStatus = "resyncing";
      this.#emitState();
      await this.#transport.sendToHost({
        kind: "resync-request",
        reason: "conflict",
        fromRevision: this.#revision,
        hasUnconfirmedLocalChanges: this.#pendingMutations.length > 0,
      }).catch(() => {});
      return;
    }

    this.#emitState();
  }

  #rebasePendingMutations(baseConfirmed: CircuitProject): CircuitProject {
    if (this.#pendingMutations.length === 0) {
      return baseConfirmed;
    }
    let working = baseConfirmed;
    const surviving: PendingMutationEntry[] = [];
    for (const pending of this.#pendingMutations) {
      try {
        working = applySerializedMutationToProject(working, pending.mutation);
        surviving.push(pending);
      } catch {
        // Optimistische Mutation lässt sich nicht mehr sauber auf den neuen Stand anwenden und wird verworfen
      }
    }
    this.#pendingMutations = surviving;
    return working;
  }

  async #sendHostLoadingStateToPeer(peerId: string, syncFalseWhenIdle = false): Promise<void> {
    if (this.#isHostProjectLoading) {
      await this.#transport.sendToPeer(peerId, {
        kind: "app",
        topic: COLLAB_APP_TOPIC_SESSION_QUIESCE,
        payload: { quiesced: true, reason: "project-loading" },
      }).catch(() => {});
      return;
    }
    if (syncFalseWhenIdle) {
      await this.#transport.sendToPeer(peerId, {
        kind: "app",
        topic: COLLAB_APP_TOPIC_SESSION_QUIESCE,
        payload: { quiesced: false },
      }).catch(() => {});
    }
  }

  #clearHandoverWaiters(): void {
    for (const waiter of this.#handoverReadyWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.#handoverReadyWaiters.clear();
  }

  #resetSyncState(): void {
    this.#clearHandoverWaiters();
    this.#sentInitialSnapshotPeers.clear();
    this.#knownPeerStates.clear();
    this.#pendingUndoTransitions.clear();
    this.#undoManager.clearAll();
    this.#softLockManager.clearAllLocks(false);
    this.#revisionEngine = null;
    this.#confirmedProject = null;
    this.#revision = 0;
    this.#epochId = null;
    this.#pendingMutations = [];
    this.#pendingHandoverState = null;
    this.#requestedSyncForHostId = null;
    this.#receivedSnapshotEpochId = null;
    this.#syncStatus = "idle";
    this.#isQuiesced = false;
    this.#quiesceReason = null;
    this.#isHostProjectLoading = false;
    this.#lastSyncRejection = null;
    this.#lastRemoteCommit = null;
    this.#lastUndoConflict = null;
    this.#isLocalSimulationActiveFlag = false;
    this.#clearSimulationBuffers();
    this.#notifyUndoChanged();
  }

  #isLocalSimulationActive(): boolean {
    return (
      !this.#adapter.isEditingLibrary() &&
      (this.#isLocalSimulationActiveFlag || Boolean(this.#adapter.isLocalSnapshotSimulating?.()))
    );
  }

  #clearSimulationBuffers(): void {
    this.#bufferedSimulationSnapshot = null;
    this.#bufferedSimulationCommits = [];
    this.#pendingHostSimulationProject = null;
    this.#deferredRemoteCommits = [];
    this.#pendingSimulationDeltaCount = 0;
    this.#hasPendingProjectSwitchDuringSim = false;
    this.#requiresResyncAfterSimulation = false;
  }

  #hasBufferedSimulationGap(): boolean {
    if (this.#bufferedSimulationCommits.length === 0) {
      return false;
    }
    let expectedRevision = this.#bufferedSimulationSnapshot
      ? this.#bufferedSimulationSnapshot.revision
      : this.#revision;
    for (const entry of this.#bufferedSimulationCommits) {
      if (entry.revision <= expectedRevision) {
        continue;
      }
      if (entry.revision > expectedRevision + 1) {
        return true;
      }
      expectedRevision = entry.revision;
    }
    return false;
  }

  #enqueueBufferedSimulationCommit(commit: CollabCircuitCommitPayload): void {
    const baseRevision = this.#bufferedSimulationSnapshot
      ? this.#bufferedSimulationSnapshot.revision
      : this.#revision;
    if (commit.revision <= baseRevision) {
      return;
    }
    if (this.#bufferedSimulationCommits.some((entry) => entry.revision === commit.revision)) {
      return;
    }
    this.#bufferedSimulationCommits.push(commit);
    this.#bufferedSimulationCommits.sort((a, b) => a.revision - b.revision);
    this.#pendingSimulationDeltaCount += 1;
  }

  #flushBufferedSimulationUpdates(): void {
    const bufferedSnapshot = this.#bufferedSimulationSnapshot;
    const bufferedCommits = this.#bufferedSimulationCommits;
    const pendingHostProject = this.#pendingHostSimulationProject;
    const deferredCommits = this.#deferredRemoteCommits;
    const needsResync = this.#requiresResyncAfterSimulation;

    this.#clearSimulationBuffers();

    if (!this.#isSessionActive() || !this.#snapshot) {
      this.#emitState();
      return;
    }

    if (this.#snapshot.selfRole === "host") {
      if (pendingHostProject) {
        const targetProject = this.#revisionEngine?.getProject() ?? pendingHostProject;
        this.#applySessionProject(targetProject, {
          resetHistory: false,
          preserveSelection: true,
          reason: "commit",
        });
        for (const commit of deferredCommits) {
          this.#adapter.onRemoteCommitApplied?.(commit);
        }
      }
      this.#emitState();
      return;
    }

    let workingProject = this.#confirmedProject;
    let applyOptions: {
      resetHistory: boolean;
      preserveSelection: boolean;
      reason: "initial" | "resync" | "project-switch" | "commit";
    } | null = null;
    let hasChangesToApply = false;
    let gapDetected = false;
    const appliedRemoteCommits: CollabCircuitCommitPayload[] = [];

    if (bufferedSnapshot) {
      workingProject = bufferedSnapshot.project;
      this.#confirmedProject = bufferedSnapshot.project;
      this.#revision = bufferedSnapshot.revision;
      this.#epochId = bufferedSnapshot.epochId;
      this.#receivedSnapshotEpochId = bufferedSnapshot.epochId;
      this.#pendingMutations = [];
      this.#lastSyncRejection = null;
      if (bufferedSnapshot.reason === "project-switch") {
        this.#isQuiesced = false;
        this.#quiesceReason = null;
        this.#softLockManager.clearAllLocks(false);
        this.#undoManager.clearAll();
        this.#pendingUndoTransitions.clear();
        this.#lastUndoConflict = null;
        this.#notifyUndoChanged();
      }
      hasChangesToApply = true;
      applyOptions = {
        resetHistory: bufferedSnapshot.resetHistory,
        preserveSelection: bufferedSnapshot.preserveSelection,
        reason: bufferedSnapshot.reason,
      };
    }

    const sorted = [...bufferedCommits].sort((a, b) => a.revision - b.revision);
    for (const commit of sorted) {
      if (commit.revision <= this.#revision) {
        continue;
      }
      if (commit.revision > this.#revision + 1 || !workingProject) {
        gapDetected = true;
        break;
      }
      try {
        workingProject = applySerializedMutationToProject(workingProject, commit.mutation);
        this.#revision = commit.revision;
        this.#pendingMutations = this.#pendingMutations.filter((p) => p.mutationId !== commit.mutationId);
        this.#pendingUndoTransitions.delete(commit.mutationId);
        this.#lastRemoteCommit = commit;
        hasChangesToApply = true;
        if (!applyOptions) {
          applyOptions = {
            resetHistory: false,
            preserveSelection: true,
            reason: "commit",
          };
        }
        if (commit.authorPeerId !== this.#snapshot.selfPeerId) {
          appliedRemoteCommits.push(commit);
        }
      } catch {
        this.#pendingMutations = [];
        gapDetected = true;
        break;
      }
    }

    if (hasChangesToApply && workingProject && applyOptions) {
      this.#confirmedProject = workingProject;
      const nextVisible = this.#rebasePendingMutations(workingProject);
      this.#applySessionProject(nextVisible, applyOptions);
      for (const commit of appliedRemoteCommits) {
        this.#adapter.onRemoteCommitApplied?.(commit);
      }
    }

    if (gapDetected || needsResync) {
      if (this.#snapshot.state === "connected" && this.#snapshot.hostPeerId) {
        this.#syncStatus = "resyncing";
        this.#emitState();
        const fromRevision = this.#receivedSnapshotEpochId !== null ? this.#revision : undefined;
        void this.#transport.sendToHost({
          kind: "resync-request",
          reason: gapDetected ? "revision-gap" : "reconnected",
          ...(fromRevision !== undefined ? { fromRevision } : {}),
          hasUnconfirmedLocalChanges: this.#pendingMutations.length > 0,
        }).catch(() => {});
        return;
      }
      this.#syncStatus = "resyncing";
      this.#emitState();
      return;
    }

    this.#syncStatus = this.#isQuiesced
      ? "quiesced"
      : (this.#receivedSnapshotEpochId === null ? "syncing" : "synced");
    this.#emitState();
  }

  #performUndoRedoTransition(direction: "undo" | "redo", logicalCircuitId: string): boolean {
    if (
      this.#adapter.isEditingLibrary() ||
      !this.#isSessionActive() ||
      !this.#snapshot ||
      this.#isLocalSimulationActive()
    ) {
      return false;
    }
    const canAct = direction === "undo"
      ? this.#undoManager.canUndo(logicalCircuitId)
      : this.#undoManager.canRedo(logicalCircuitId);
    if (!canAct) {
      return false;
    }

    if (this.#snapshot.selfRole === "guest") {
      this.#lastUndoConflict = {
        direction,
        code: "unauthorized",
        message: "Gäste besitzen im gemeinsamen Projekt nur Leserechte.",
        logicalCircuitId,
        conflictingEntityIds: [],
        preservedEntry: true,
      };
      this.#emitState();
      return false;
    }

    if (this.#isQuiesced) {
      this.#lastUndoConflict = {
        direction,
        code: "quiesced",
        message: "Änderungen sind während des laufenden Host-Wechsels bzw. Projekt-Ladevorgangs pausiert.",
        logicalCircuitId,
        conflictingEntityIds: [],
        preservedEntry: true,
      };
      this.#emitState();
      return false;
    }

    const currentProject = this.#getSessionProject();
    const foreignLocks = this.#softLockManager.getForeignLocks();
    const preparation = direction === "undo"
      ? this.#undoManager.prepareUndo(logicalCircuitId, currentProject, foreignLocks)
      : this.#undoManager.prepareRedo(logicalCircuitId, currentProject, foreignLocks);

    if (!preparation.ok) {
      if (preparation.conflict) {
        this.#lastUndoConflict = preparation.conflict;
        this.#emitState();
      }
      return false;
    }

    this.#lastUndoConflict = null;
    this.#undoManager.commitPointer(logicalCircuitId, preparation.nextPointer);
    this.#notifyUndoChanged();

    this.#applySessionProject(preparation.nextProject, {
      resetHistory: false,
      preserveSelection: true,
      reason: "commit",
    });

    const mutationId = generateEntityUuid();
    if (this.#snapshot.selfRole !== "host") {
      this.#pendingUndoTransitions.set(mutationId, {
        circuitId: logicalCircuitId,
        previousPointer: preparation.previousPointer,
        direction,
      });
    }

    const submitOutcome = this.#submitSerializedMutation(preparation.mutation, {
      mutationId,
      origin: "user",
    });

    if (this.#snapshot.selfRole === "host" && submitOutcome.acceptedOnHost === false) {
      this.#undoManager.restorePointer(logicalCircuitId, preparation.previousPointer);
      this.#lastUndoConflict = {
        direction,
        code: "entity-modified",
        message: this.#lastSyncRejection?.message ?? "Rückgängig/Wiederherstellen wegen Konflikt abgebrochen.",
        logicalCircuitId,
        conflictingEntityIds: this.#lastSyncRejection?.conflictingEntityIds ?? [],
        preservedEntry: true,
      };
      this.#notifyUndoChanged();
      this.#emitState();
      return false;
    }

    return true;
  }

  #findBlockingSoftLocksForMutation(
    mutation: CollabSerializedMutation,
    authorPeerId: string,
  ): CollabSoftLockEntry[] {
    if (mutation.type === "deleteCircuits") {
      const targetIds = new Set(mutation.circuitIds);
      return this.#softLockManager.getForeignLocks(authorPeerId).filter(
        (lock) =>
          targetIds.has(lock.logicalCircuitId) ||
          (lock.targetType === "logicalCircuit" && targetIds.has(lock.targetId)),
      );
    }

    if (mutation.type === "updateProperty") {
      return this.#softLockManager.findForeignLocks(
        [{ targetType: mutation.targetType, targetId: mutation.targetId }],
        authorPeerId,
      );
    }

    const scope = extractMutationScope(mutation);
    const targets: { targetType: CollabSoftLockTargetType; targetId: string }[] = [];
    for (const id of scope.touchedEntityIds) {
      targets.push({ targetType: "symbol", targetId: id });
      targets.push({ targetType: "textNote", targetId: id });
    }
    return this.#softLockManager.findForeignLocks(targets, authorPeerId);
  }

  #sendSoftLockMessage(payload: CollabSoftLockPayload): void {
    if (!this.#isSessionActive() || !this.#snapshot) {
      return;
    }
    const msg: CollabDataChannelMessage = {
      kind: "app",
      topic: COLLAB_APP_TOPIC_SOFT_LOCK,
      payload,
    };
    if (this.#snapshot.selfRole === "host") {
      void this.#transport.broadcast(msg).catch(() => {});
      return;
    }
    if (this.#snapshot.selfRole !== "guest") {
      void this.#transport.sendToHost(msg).catch(() => {});
    }
  }

  #resolvePeerDisplayName(peerId: string | null): string {
    if (!peerId) {
      return "Teilnehmer";
    }
    if (this.#snapshot?.selfPeerId === peerId) {
      const selfName = this.#adapter.getSelfDisplayName?.().trim();
      if (selfName) {
        return selfName;
      }
    }
    const fromAdapter = this.#adapter.getParticipantDisplayName?.(peerId)?.trim();
    if (fromAdapter) {
      return fromAdapter;
    }
    const fromSnap = this.#snapshot?.peers.find((p) => p.peerId === peerId)?.displayName?.trim();
    return fromSnap || peerId;
  }

  #notifyUndoChanged(): void {
    this.#undoStackVersion += 1;
    for (const listener of this.#undoListeners) {
      listener();
    }
  }

  #emitState(): void {
    const state = this.getState();
    this.#adapter.onStateChange?.(state);
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}

export default CollabModelSyncController;
