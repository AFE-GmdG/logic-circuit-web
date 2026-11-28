import type CollabRole from "../types/collab/collabRole";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type {
  CollabPresenceCursorPayload,
  CollabPresenceCursorPosition,
  CollabPresenceOpenDialog,
  CollabPresencePeerSnapshotEntry,
  CollabPresenceSelection,
  CollabPresenceSnapshotPayload,
  CollabPresenceStatePayload,
  CollabPresenceViewport,
} from "../types/collab/presenceMessage";
import {
  COLLAB_APP_TOPIC_PRESENCE_CURSOR,
  COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT,
  COLLAB_APP_TOPIC_PRESENCE_STATE,
} from "../types/collab/presenceMessage";
import type CollabCursorVisibilityMode from "../types/settings/collabCursorVisibilityMode";

import {
  isValidPresenceCursorPayload,
  isValidPresenceSnapshotPayload,
  isValidPresenceStatePayload,
} from "./collabAuthorization";
import type { CollabTransportSnapshot } from "./p2pSessionTransport";

export const DEFAULT_CURSOR_THROTTLE_MS = 50;
export const DEFAULT_VIEWPORT_THROTTLE_MS = 100;

export type CollabPresenceTransport = {
  onTransportSnapshot: (listener: (snapshot: CollabTransportSnapshot | null) => void) => () => void;
  onTransportMessage: (listener: (fromPeerId: string, message: CollabDataChannelMessage) => void) => () => void;
  sendToPeer: (peerId: string, message: CollabDataChannelMessage) => Promise<void>;
  sendToHost: (message: CollabDataChannelMessage) => Promise<void>;
  broadcast: (message: CollabDataChannelMessage, excludePeerId?: string) => Promise<void>;
};

export type CollabLocalPresenceInput = {
  logicalCircuitId: string | null;
  inLibraryMode: boolean;
  selection: CollabPresenceSelection;
  openDialog: CollabPresenceOpenDialog | null;
  viewport: CollabPresenceViewport | null;
};

export type CollabPeerPresenceState = {
  peerId: string;
  logicalCircuitId: string | null;
  inLibraryMode: boolean;
  selection: CollabPresenceSelection;
  openDialog: CollabPresenceOpenDialog | null;
  viewport: CollabPresenceViewport | null;
  updatedAt: number;
};

export type CollabPresenceState = {
  peers: Record<string, CollabPeerPresenceState>;
  version: number;
};

export type CollabRemoteCursorEntry = {
  peerId: string;
  x: number;
  y: number;
  logicalCircuitId: string | null;
  lastMovedAt: number;
};

export type CollabPresenceCursorMap = Record<string, CollabRemoteCursorEntry>;

export type CollabPresenceControllerOptions = {
  transport: CollabPresenceTransport;
  cursorThrottleMs?: number;
  viewportThrottleMs?: number;
  now?: () => number;
};

function createEmptySelection(): CollabPresenceSelection {
  return {
    symbolIds: [],
    textNoteIds: [],
    wireIds: [],
  };
}

function cloneSelection(selection?: CollabPresenceSelection | null): CollabPresenceSelection {
  if (!selection) {
    return createEmptySelection();
  }
  return {
    symbolIds: [...selection.symbolIds],
    textNoteIds: [...selection.textNoteIds],
    wireIds: [...selection.wireIds],
  };
}

function cloneOpenDialog(dialog?: CollabPresenceOpenDialog | null): CollabPresenceOpenDialog | null {
  if (!dialog) {
    return null;
  }
  return {
    kind: dialog.kind,
    targetId: dialog.targetId,
    logicalCircuitId: dialog.logicalCircuitId,
  };
}

function cloneViewport(viewport?: CollabPresenceViewport | null): CollabPresenceViewport | null {
  if (!viewport) {
    return null;
  }
  return {
    centerX: viewport.centerX,
    centerY: viewport.centerY,
    zoom: viewport.zoom,
  };
}

function areStringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function areSelectionsEqual(a: CollabPresenceSelection, b: CollabPresenceSelection): boolean {
  return (
    areStringArraysEqual(a.symbolIds, b.symbolIds) &&
    areStringArraysEqual(a.textNoteIds, b.textNoteIds) &&
    areStringArraysEqual(a.wireIds, b.wireIds)
  );
}

function areOpenDialogsEqual(a: CollabPresenceOpenDialog | null, b: CollabPresenceOpenDialog | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.kind === b.kind && a.targetId === b.targetId && a.logicalCircuitId === b.logicalCircuitId;
}

function areViewportsEqual(a: CollabPresenceViewport | null, b: CollabPresenceViewport | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.centerX === b.centerX && a.centerY === b.centerY && a.zoom === b.zoom;
}

function sanitizeStateForWire(
  input: CollabLocalPresenceInput,
  peerId?: string,
): CollabPresenceStatePayload {
  if (input.inLibraryMode) {
    return {
      ...(peerId ? { peerId } : {}),
      logicalCircuitId: null,
      inLibraryMode: true,
      selection: createEmptySelection(),
      openDialog: null,
      viewport: null,
    };
  }
  return {
    ...(peerId ? { peerId } : {}),
    logicalCircuitId: input.logicalCircuitId,
    inLibraryMode: false,
    selection: cloneSelection(input.selection),
    openDialog: cloneOpenDialog(input.openDialog),
    viewport: cloneViewport(input.viewport),
  };
}

function areWireStatesEqual(a: CollabPresenceStatePayload | null, b: CollabPresenceStatePayload | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.logicalCircuitId === b.logicalCircuitId &&
    a.inLibraryMode === b.inLibraryMode &&
    areSelectionsEqual(a.selection ?? createEmptySelection(), b.selection ?? createEmptySelection()) &&
    areOpenDialogsEqual(a.openDialog ?? null, b.openDialog ?? null) &&
    areViewportsEqual(a.viewport ?? null, b.viewport ?? null)
  );
}

function areNonViewportPartsEqual(a: CollabPresenceStatePayload | null, b: CollabPresenceStatePayload | null): boolean {
  if (!a || !b) {
    return false;
  }
  return (
    a.logicalCircuitId === b.logicalCircuitId &&
    a.inLibraryMode === b.inLibraryMode &&
    areSelectionsEqual(a.selection ?? createEmptySelection(), b.selection ?? createEmptySelection()) &&
    areOpenDialogsEqual(a.openDialog ?? null, b.openDialog ?? null)
  );
}

// Prüft anhand des gewählten Sichtbarkeitsmodus, ob ein Remote-Cursor eingeblendet werden darf
export function shouldShowRemoteCursor(params: {
  mode: CollabCursorVisibilityMode;
  participantRole?: CollabRole | null;
  handRaised?: boolean;
  isFollowed?: boolean;
}): boolean {
  if (params.isFollowed) {
    return true;
  }
  switch (params.mode) {
    case "all":
      return true;
    case "collaborators":
      return params.participantRole === "host" || params.participantRole === "collaborator";
    case "raised-hand":
      return Boolean(params.handRaised);
    case "collaborators-and-raised-hand":
      return (
        params.participantRole === "host" ||
        params.participantRole === "collaborator" ||
        Boolean(params.handRaised)
      );
  }
}

// Prüft, ob ein Remote-Cursor mangels Bewegung nach der konfigurierten Grace Period ausgeblendet werden soll
export function isRemoteCursorIdle(
  cursor: CollabRemoteCursorEntry,
  nowMs: number,
  idleTimeoutSec: number,
): boolean {
  if (idleTimeoutSec <= 0) {
    return false;
  }
  return nowMs - cursor.lastMovedAt >= idleTimeoutSec * 1000;
}

export type CollabParticipantNavigationTarget =
  | {
    status: "ready";
    logicalCircuitId: string;
    viewport: {
      centerX: number;
      centerY: number;
      zoom?: number;
    } | null;
  }
  | { status: "paused-library" }
  | { status: "unavailable" };

// Ermittelt Schaltplan- und Viewport-Ziel für „Hinspringen“ sowie „Teilnehmer folgen“ (inkl. stillem Pausieren im Bibliotheksmodus)
export function resolveParticipantNavigationTarget(params: {
  targetPeerId: string;
  presenceState: CollabPresenceState;
  remoteCursors: CollabPresenceCursorMap;
  availableCircuitIds: ReadonlySet<string> | ReadonlyArray<string>;
}): CollabParticipantNavigationTarget {
  const peerPresence = params.presenceState.peers[params.targetPeerId];
  if (!peerPresence) {
    return { status: "unavailable" };
  }
  if (peerPresence.inLibraryMode) {
    return { status: "paused-library" };
  }
  if (!peerPresence.logicalCircuitId) {
    return { status: "unavailable" };
  }

  const hasCircuit = Array.isArray(params.availableCircuitIds)
    ? params.availableCircuitIds.includes(peerPresence.logicalCircuitId)
    : (params.availableCircuitIds as ReadonlySet<string>).has(peerPresence.logicalCircuitId);
  if (!hasCircuit) {
    return { status: "unavailable" };
  }

  if (peerPresence.viewport) {
    return {
      status: "ready",
      logicalCircuitId: peerPresence.logicalCircuitId,
      viewport: {
        centerX: peerPresence.viewport.centerX,
        centerY: peerPresence.viewport.centerY,
        zoom: peerPresence.viewport.zoom,
      },
    };
  }

  const cursor = params.remoteCursors[params.targetPeerId];
  if (cursor && cursor.logicalCircuitId === peerPresence.logicalCircuitId) {
    return {
      status: "ready",
      logicalCircuitId: peerPresence.logicalCircuitId,
      viewport: {
        centerX: cursor.x,
        centerY: cursor.y,
      },
    };
  }

  return {
    status: "ready",
    logicalCircuitId: peerPresence.logicalCircuitId,
    viewport: null,
  };
}

// Verwaltet Live-Präsenz, gedrosselten Cursor-/Viewport-Versand, Host-Relay und Snapshots mit entkoppelten Kanälen
class CollabPresenceController {
  readonly #transport: CollabPresenceTransport;
  readonly #cursorThrottleMs: number;
  readonly #viewportThrottleMs: number;
  readonly #now: () => number;

  readonly #stateListeners = new Set<(state: CollabPresenceState) => void>();
  readonly #cursorListeners = new Set<(cursors: CollabPresenceCursorMap) => void>();
  readonly #unsubscribes: Array<() => void> = [];

  readonly #peerStates = new Map<string, CollabPeerPresenceState>();
  readonly #cursors = new Map<string, CollabRemoteCursorEntry>();
  readonly #connectedPeersSentSnapshot = new Set<string>();

  #transportSnapshot: CollabTransportSnapshot | null = null;
  #lastSentToHostId: string | null = null;
  #stateVersion = 0;
  #cachedStateSnapshot: CollabPresenceState = { peers: {}, version: 0 };
  #cachedCursorsSnapshot: CollabPresenceCursorMap = {};

  #localState: CollabLocalPresenceInput = {
    logicalCircuitId: null,
    inLibraryMode: false,
    selection: createEmptySelection(),
    openDialog: null,
    viewport: null,
  };
  #localCursor: CollabPresenceCursorPosition | null = null;

  #lastSentStatePayload: CollabPresenceStatePayload | null = null;
  #pendingStateSend: CollabPresenceStatePayload | null = null;
  #lastViewportSentAt = 0;
  #viewportTimer: ReturnType<typeof setTimeout> | null = null;

  #lastSentCursorVisible = false;
  #lastSentCursorPayload: { x: number; y: number; logicalCircuitId: string | null } | null = null;
  #pendingCursorSend: CollabPresenceCursorPayload | null = null;
  #lastCursorSentAt = 0;
  #cursorTimer: ReturnType<typeof setTimeout> | null = null;

  #disposed = false;

  constructor(options: CollabPresenceControllerOptions) {
    this.#transport = options.transport;
    this.#cursorThrottleMs = Math.max(0, options.cursorThrottleMs ?? DEFAULT_CURSOR_THROTTLE_MS);
    this.#viewportThrottleMs = Math.max(0, options.viewportThrottleMs ?? DEFAULT_VIEWPORT_THROTTLE_MS);
    this.#now = options.now ?? (() => Date.now());

    this.#unsubscribes.push(
      this.#transport.onTransportSnapshot((snapshot) => {
        this.#handleTransportSnapshot(snapshot);
      }),
      this.#transport.onTransportMessage((fromPeerId, message) => {
        this.#handleTransportMessage(fromPeerId, message);
      }),
    );
  }

  getState(): CollabPresenceState {
    return this.#cachedStateSnapshot;
  }

  getCursors(): CollabPresenceCursorMap {
    return this.#cachedCursorsSnapshot;
  }

  subscribeState(listener: (state: CollabPresenceState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  subscribeCursors(listener: (cursors: CollabPresenceCursorMap) => void): () => void {
    this.#cursorListeners.add(listener);
    return () => {
      this.#cursorListeners.delete(listener);
    };
  }

  // Aktualisiert lokalen Präsenz-Status (Schaltplan, Selektion, Dialog, Bibliotheksmodus sofort; Viewport gedrosselt)
  updateLocalState(patch: Partial<CollabLocalPresenceInput>): void {
    if (this.#disposed) {
      return;
    }

    const nextState: CollabLocalPresenceInput = {
      logicalCircuitId: patch.logicalCircuitId !== undefined
        ? patch.logicalCircuitId
        : this.#localState.logicalCircuitId,
      inLibraryMode: patch.inLibraryMode !== undefined
        ? patch.inLibraryMode
        : this.#localState.inLibraryMode,
      selection: patch.selection !== undefined
        ? cloneSelection(patch.selection)
        : this.#localState.selection,
      openDialog: patch.openDialog !== undefined
        ? cloneOpenDialog(patch.openDialog)
        : this.#localState.openDialog,
      viewport: patch.viewport !== undefined
        ? cloneViewport(patch.viewport)
        : this.#localState.viewport,
    };

    const wasInLibraryMode = this.#localState.inLibraryMode;
    this.#localState = nextState;

    const selfPeerId = this.#transportSnapshot?.selfPeerId ?? undefined;
    const wirePayload = sanitizeStateForWire(nextState, selfPeerId);

    if (!this.#isSessionReadyForSend()) {
      return;
    }

    if (nextState.inLibraryMode && !wasInLibraryMode) {
      this.#hideLocalCursorImmediately();
    }

    if (areWireStatesEqual(this.#lastSentStatePayload, wirePayload)) {
      return;
    }

    const onlyViewportChanged = areNonViewportPartsEqual(this.#lastSentStatePayload, wirePayload);
    if (!onlyViewportChanged || this.#viewportThrottleMs === 0) {
      this.#clearViewportTimer();
      this.#sendStateNow(wirePayload);
      return;
    }

    const nowMs = this.#now();
    const elapsed = this.#lastViewportSentAt === 0 ? this.#viewportThrottleMs : nowMs - this.#lastViewportSentAt;
    if (elapsed >= this.#viewportThrottleMs) {
      this.#clearViewportTimer();
      this.#sendStateNow(wirePayload);
      return;
    }

    this.#pendingStateSend = wirePayload;
    if (this.#viewportTimer === null) {
      const waitMs = Math.max(0, this.#viewportThrottleMs - elapsed);
      this.#viewportTimer = setTimeout(() => {
        this.#viewportTimer = null;
        const pending = this.#pendingStateSend;
        this.#pendingStateSend = null;
        if (pending && !this.#disposed && this.#isSessionReadyForSend()) {
          const refreshedPayload = sanitizeStateForWire(
            this.#localState,
            this.#transportSnapshot?.selfPeerId ?? undefined,
          );
          this.#sendStateNow(refreshedPayload);
        }
      }, waitMs);
    }
  }

  // Aktualisiert die lokale Mausposition in Weltkoordinaten mit Leading/Trailing-Drosselung
  updateLocalCursor(cursor: CollabPresenceCursorPosition | null): void {
    if (this.#disposed) {
      return;
    }

    this.#localCursor = cursor
      ? {
        x: cursor.x,
        y: cursor.y,
        logicalCircuitId: cursor.logicalCircuitId !== undefined
          ? cursor.logicalCircuitId
          : this.#localState.logicalCircuitId,
      }
      : null;

    if (!this.#isSessionReadyForSend()) {
      return;
    }

    if (this.#localState.inLibraryMode || this.#localCursor === null) {
      this.#hideLocalCursorImmediately();
      return;
    }

    const circuitId = this.#localCursor.logicalCircuitId ?? this.#localState.logicalCircuitId ?? null;
    if (
      this.#lastSentCursorVisible &&
      this.#lastSentCursorPayload &&
      this.#lastSentCursorPayload.x === this.#localCursor.x &&
      this.#lastSentCursorPayload.y === this.#localCursor.y &&
      this.#lastSentCursorPayload.logicalCircuitId === circuitId
    ) {
      return;
    }

    const payload: CollabPresenceCursorPayload = {
      ...(this.#transportSnapshot?.selfPeerId ? { peerId: this.#transportSnapshot.selfPeerId } : {}),
      visible: true,
      x: this.#localCursor.x,
      y: this.#localCursor.y,
      logicalCircuitId: circuitId,
    };

    if (this.#cursorThrottleMs === 0) {
      this.#clearCursorTimer();
      this.#sendCursorNow(payload, circuitId);
      return;
    }

    const nowMs = this.#now();
    const elapsed = this.#lastCursorSentAt === 0 ? this.#cursorThrottleMs : nowMs - this.#lastCursorSentAt;
    if (elapsed >= this.#cursorThrottleMs) {
      this.#clearCursorTimer();
      this.#sendCursorNow(payload, circuitId);
      return;
    }

    this.#pendingCursorSend = payload;
    if (this.#cursorTimer === null) {
      const waitMs = Math.max(0, this.#cursorThrottleMs - elapsed);
      this.#cursorTimer = setTimeout(() => {
        this.#cursorTimer = null;
        const pending = this.#pendingCursorSend;
        this.#pendingCursorSend = null;
        if (!pending || this.#disposed || !this.#isSessionReadyForSend() || this.#localState.inLibraryMode) {
          return;
        }
        if (pending.visible !== false) {
          this.#sendCursorNow(
            {
              ...pending,
              ...(this.#transportSnapshot?.selfPeerId ? { peerId: this.#transportSnapshot.selfPeerId } : {}),
            },
            pending.logicalCircuitId ?? this.#localState.logicalCircuitId ?? null,
          );
        }
      }, waitMs);
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#clearViewportTimer();
    this.#clearCursorTimer();
    for (const unsubscribe of this.#unsubscribes) {
      unsubscribe();
    }
    this.#unsubscribes.length = 0;
    this.#peerStates.clear();
    this.#cursors.clear();
    this.#connectedPeersSentSnapshot.clear();
    this.#stateListeners.clear();
    this.#cursorListeners.clear();
  }

  #isSessionReadyForSend(): boolean {
    const snap = this.#transportSnapshot;
    if (!snap || !snap.sessionId || snap.state === "idle" || snap.state === "disconnected") {
      return false;
    }
    if (snap.selfRole === "host") {
      return snap.peers.some((peer) => peer.state === "connected");
    }
    return snap.state === "connected" && Boolean(snap.hostPeerId);
  }

  #clearViewportTimer(): void {
    if (this.#viewportTimer !== null) {
      clearTimeout(this.#viewportTimer);
      this.#viewportTimer = null;
    }
    this.#pendingStateSend = null;
  }

  #clearCursorTimer(): void {
    if (this.#cursorTimer !== null) {
      clearTimeout(this.#cursorTimer);
      this.#cursorTimer = null;
    }
    this.#pendingCursorSend = null;
  }

  #sendStateNow(payload: CollabPresenceStatePayload): void {
    this.#lastSentStatePayload = payload;
    if (payload.viewport !== null && payload.viewport !== undefined) {
      this.#lastViewportSentAt = this.#now();
    }
    this.#dispatchPresenceMessage({
      kind: "app",
      topic: COLLAB_APP_TOPIC_PRESENCE_STATE,
      payload,
    });
  }

  #sendCursorNow(payload: CollabPresenceCursorPayload, circuitId: string | null): void {
    this.#lastCursorSentAt = this.#now();
    if (payload.visible === false) {
      this.#lastSentCursorVisible = false;
      this.#lastSentCursorPayload = null;
    } else {
      this.#lastSentCursorVisible = true;
      this.#lastSentCursorPayload = {
        x: payload.x,
        y: payload.y,
        logicalCircuitId: circuitId,
      };
    }
    this.#dispatchPresenceMessage({
      kind: "app",
      topic: COLLAB_APP_TOPIC_PRESENCE_CURSOR,
      payload,
    });
  }

  #hideLocalCursorImmediately(): void {
    this.#clearCursorTimer();
    if (!this.#lastSentCursorVisible) {
      return;
    }
    const selfPeerId = this.#transportSnapshot?.selfPeerId ?? undefined;
    this.#sendCursorNow(
      {
        ...(selfPeerId ? { peerId: selfPeerId } : {}),
        visible: false,
        logicalCircuitId: this.#localState.inLibraryMode ? null : this.#localState.logicalCircuitId,
      },
      null,
    );
  }

  #dispatchPresenceMessage(message: CollabDataChannelMessage): void {
    const snap = this.#transportSnapshot;
    if (!snap || !snap.sessionId) {
      return;
    }
    if (snap.selfRole === "host") {
      void this.#transport.broadcast(message).catch(() => {});
    } else {
      void this.#transport.sendToHost(message).catch(() => {});
    }
  }

  #handleTransportSnapshot(snapshot: CollabTransportSnapshot | null): void {
    if (this.#disposed) {
      return;
    }

    const prevSnapshot = this.#transportSnapshot;
    this.#transportSnapshot = snapshot;

    if (!snapshot || !snapshot.sessionId || snapshot.state === "idle" || snapshot.state === "disconnected") {
      this.#resetRuntimePresenceState();
      return;
    }

    if (snapshot.selfRole === "host") {
      this.#reconcileHostPeers(snapshot, prevSnapshot);
      return;
    }

    let stateChanged = false;
    let cursorsChanged = false;
    if (snapshot.selfPeerId) {
      if (this.#peerStates.delete(snapshot.selfPeerId)) {
        stateChanged = true;
      }
      if (this.#cursors.delete(snapshot.selfPeerId)) {
        cursorsChanged = true;
      }
    }
    if (stateChanged) {
      this.#emitState();
    }
    if (cursorsChanged) {
      this.#emitCursors();
    }

    if (snapshot.state === "connected" && snapshot.hostPeerId) {
      if (this.#lastSentToHostId !== snapshot.hostPeerId) {
        this.#lastSentToHostId = snapshot.hostPeerId;
        const payload = sanitizeStateForWire(this.#localState, snapshot.selfPeerId ?? undefined);
        this.#sendStateNow(payload);
      }
    } else {
      this.#lastSentToHostId = null;
      this.#lastSentStatePayload = null;
      this.#lastSentCursorVisible = false;
      this.#lastSentCursorPayload = null;
    }
  }

  #reconcileHostPeers(snapshot: CollabTransportSnapshot, prevSnapshot: CollabTransportSnapshot | null): void {
    const justBecameHost = prevSnapshot !== null && prevSnapshot.selfRole !== "host";
    if (justBecameHost) {
      this.#connectedPeersSentSnapshot.clear();
      this.#lastSentToHostId = null;
    }

    const activePeerIds = new Set(snapshot.peers.map((peer) => peer.peerId));
    let stateChanged = false;
    let cursorsChanged = false;

    if (snapshot.selfPeerId) {
      if (this.#peerStates.delete(snapshot.selfPeerId)) {
        stateChanged = true;
      }
      if (this.#cursors.delete(snapshot.selfPeerId)) {
        cursorsChanged = true;
      }
    }

    for (const existingPeerId of Array.from(this.#peerStates.keys())) {
      if (!activePeerIds.has(existingPeerId)) {
        this.#peerStates.delete(existingPeerId);
        stateChanged = true;
      }
    }
    for (const existingPeerId of Array.from(this.#cursors.keys())) {
      if (!activePeerIds.has(existingPeerId)) {
        this.#cursors.delete(existingPeerId);
        cursorsChanged = true;
      }
    }
    for (const sentPeerId of Array.from(this.#connectedPeersSentSnapshot)) {
      if (!activePeerIds.has(sentPeerId)) {
        this.#connectedPeersSentSnapshot.delete(sentPeerId);
      }
    }

    const newlyConnectedPeers: string[] = [];
    for (const peer of snapshot.peers) {
      if (peer.state === "disconnected" || peer.state === "failed") {
        this.#connectedPeersSentSnapshot.delete(peer.peerId);
        if (this.#cursors.delete(peer.peerId)) {
          cursorsChanged = true;
        }
        continue;
      }
      if (peer.state === "connected" && !this.#connectedPeersSentSnapshot.has(peer.peerId)) {
        this.#connectedPeersSentSnapshot.add(peer.peerId);
        newlyConnectedPeers.push(peer.peerId);
      }
    }

    if (stateChanged) {
      this.#emitState();
    }
    if (cursorsChanged) {
      this.#emitCursors();
    }

    if (justBecameHost) {
      const connectedPeers = snapshot.peers.filter((peer) => peer.state === "connected");
      if (connectedPeers.length > 0) {
        const snapshotMessage = this.#buildSnapshotMessage();
        for (const peer of connectedPeers) {
          this.#connectedPeersSentSnapshot.add(peer.peerId);
          void this.#transport.sendToPeer(peer.peerId, snapshotMessage).catch(() => {});
        }
      }
      return;
    }

    if (newlyConnectedPeers.length > 0) {
      const snapshotMessage = this.#buildSnapshotMessage();
      for (const peerId of newlyConnectedPeers) {
        void this.#transport.sendToPeer(peerId, snapshotMessage).catch(() => {});
      }
    }
  }

  #buildSnapshotMessage(): CollabDataChannelMessage {
    const entries: CollabPresencePeerSnapshotEntry[] = [];
    const selfPeerId = this.#transportSnapshot?.selfPeerId;
    if (selfPeerId) {
      const selfWire = sanitizeStateForWire(this.#localState, selfPeerId);
      const selfCursor = !this.#localState.inLibraryMode && this.#localCursor
        ? {
          x: this.#localCursor.x,
          y: this.#localCursor.y,
          logicalCircuitId: this.#localCursor.logicalCircuitId ?? this.#localState.logicalCircuitId ?? null,
        }
        : null;
      entries.push({
        peerId: selfPeerId,
        logicalCircuitId: selfWire.logicalCircuitId,
        inLibraryMode: selfWire.inLibraryMode,
        selection: cloneSelection(selfWire.selection),
        openDialog: cloneOpenDialog(selfWire.openDialog),
        viewport: cloneViewport(selfWire.viewport),
        cursor: selfCursor,
      });
    }

    for (const peerState of this.#peerStates.values()) {
      const peerCursor = !peerState.inLibraryMode ? this.#cursors.get(peerState.peerId) : undefined;
      entries.push({
        peerId: peerState.peerId,
        logicalCircuitId: peerState.inLibraryMode ? null : peerState.logicalCircuitId,
        inLibraryMode: peerState.inLibraryMode,
        selection: peerState.inLibraryMode ? createEmptySelection() : cloneSelection(peerState.selection),
        openDialog: peerState.inLibraryMode ? null : cloneOpenDialog(peerState.openDialog),
        viewport: peerState.inLibraryMode ? null : cloneViewport(peerState.viewport),
        cursor: peerCursor
          ? {
            x: peerCursor.x,
            y: peerCursor.y,
            logicalCircuitId: peerCursor.logicalCircuitId,
          }
          : null,
      });
    }

    const payload: CollabPresenceSnapshotPayload = { entries };
    return {
      kind: "app",
      topic: COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT,
      payload,
    };
  }

  #handleTransportMessage(fromPeerId: string, message: CollabDataChannelMessage): void {
    if (this.#disposed || message.kind !== "app") {
      return;
    }
    const snap = this.#transportSnapshot;
    if (!snap || !snap.sessionId) {
      return;
    }

    const topic = message.topic.trim();
    if (
      topic !== COLLAB_APP_TOPIC_PRESENCE_STATE &&
      topic !== COLLAB_APP_TOPIC_PRESENCE_CURSOR &&
      topic !== COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT
    ) {
      return;
    }

    if (snap.selfRole === "host") {
      this.#handleHostIncomingMessage(fromPeerId, topic, message.payload);
      return;
    }

    if (snap.hostPeerId && fromPeerId !== snap.hostPeerId) {
      return;
    }

    if (topic === COLLAB_APP_TOPIC_PRESENCE_STATE) {
      if (!isValidPresenceStatePayload(message.payload)) {
        return;
      }
      const payload = message.payload as CollabPresenceStatePayload;
      if (!payload.peerId || payload.peerId === snap.selfPeerId) {
        return;
      }
      this.#applyRemoteState(payload.peerId, payload);
      return;
    }

    if (topic === COLLAB_APP_TOPIC_PRESENCE_CURSOR) {
      if (!isValidPresenceCursorPayload(message.payload)) {
        return;
      }
      const payload = message.payload as CollabPresenceCursorPayload;
      if (!payload.peerId || payload.peerId === snap.selfPeerId) {
        return;
      }
      this.#applyRemoteCursor(payload.peerId, payload);
      return;
    }

    if (topic === COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT) {
      if (!isValidPresenceSnapshotPayload(message.payload)) {
        return;
      }
      this.#applySnapshot(message.payload as CollabPresenceSnapshotPayload, snap.selfPeerId);
    }
  }

  #handleHostIncomingMessage(fromPeerId: string, topic: string, rawPayload: unknown): void {
    if (topic === COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT) {
      return;
    }

    if (topic === COLLAB_APP_TOPIC_PRESENCE_STATE) {
      if (!isValidPresenceStatePayload(rawPayload)) {
        return;
      }
      const payload = rawPayload as CollabPresenceStatePayload;
      // Anti-Spoofing: Host setzt peerId immer autoritativ aus der Transport-Absender-ID
      const sanitized: CollabPresenceStatePayload = payload.inLibraryMode
        ? {
          peerId: fromPeerId,
          logicalCircuitId: null,
          inLibraryMode: true,
          selection: createEmptySelection(),
          openDialog: null,
          viewport: null,
        }
        : {
          peerId: fromPeerId,
          logicalCircuitId: payload.logicalCircuitId,
          inLibraryMode: false,
          selection: cloneSelection(payload.selection),
          openDialog: cloneOpenDialog(payload.openDialog),
          viewport: cloneViewport(payload.viewport),
        };

      this.#applyRemoteState(fromPeerId, sanitized);
      void this.#transport.broadcast(
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_STATE,
          payload: sanitized,
        },
        fromPeerId,
      ).catch(() => {});
      return;
    }

    if (topic === COLLAB_APP_TOPIC_PRESENCE_CURSOR) {
      if (!isValidPresenceCursorPayload(rawPayload)) {
        return;
      }
      const payload = rawPayload as CollabPresenceCursorPayload;
      const peerState = this.#peerStates.get(fromPeerId);
      if (peerState?.inLibraryMode) {
        if (this.#cursors.delete(fromPeerId)) {
          this.#emitCursors();
        }
        return;
      }

      const authoritativePayload: CollabPresenceCursorPayload = payload.visible === false
        ? {
          peerId: fromPeerId,
          visible: false,
          ...(payload.logicalCircuitId !== undefined ? { logicalCircuitId: payload.logicalCircuitId } : {}),
        }
        : {
          peerId: fromPeerId,
          visible: true,
          x: payload.x,
          y: payload.y,
          logicalCircuitId: payload.logicalCircuitId !== undefined
            ? payload.logicalCircuitId
            : (peerState?.logicalCircuitId ?? null),
        };

      this.#applyRemoteCursor(fromPeerId, authoritativePayload);
      void this.#transport.broadcast(
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_CURSOR,
          payload: authoritativePayload,
        },
        fromPeerId,
      ).catch(() => {});
    }
  }

  #applyRemoteState(peerId: string, payload: CollabPresenceStatePayload): void {
    const nextEntry: CollabPeerPresenceState = payload.inLibraryMode
      ? {
        peerId,
        logicalCircuitId: null,
        inLibraryMode: true,
        selection: createEmptySelection(),
        openDialog: null,
        viewport: null,
        updatedAt: this.#now(),
      }
      : {
        peerId,
        logicalCircuitId: payload.logicalCircuitId,
        inLibraryMode: false,
        selection: cloneSelection(payload.selection),
        openDialog: cloneOpenDialog(payload.openDialog),
        viewport: cloneViewport(payload.viewport),
        updatedAt: this.#now(),
      };

    this.#peerStates.set(peerId, nextEntry);
    this.#emitState();

    if (nextEntry.inLibraryMode && this.#cursors.delete(peerId)) {
      this.#emitCursors();
    }
  }

  #applyRemoteCursor(peerId: string, payload: CollabPresenceCursorPayload): void {
    const peerState = this.#peerStates.get(peerId);
    if (peerState?.inLibraryMode || payload.visible === false) {
      if (this.#cursors.delete(peerId)) {
        this.#emitCursors();
      }
      return;
    }

    const circuitId = payload.logicalCircuitId !== undefined
      ? payload.logicalCircuitId
      : (peerState?.logicalCircuitId ?? null);

    const existing = this.#cursors.get(peerId);
    const positionChanged =
      !existing ||
      existing.x !== payload.x ||
      existing.y !== payload.y ||
      existing.logicalCircuitId !== circuitId;

    if (!positionChanged) {
      return;
    }

    this.#cursors.set(peerId, {
      peerId,
      x: payload.x,
      y: payload.y,
      logicalCircuitId: circuitId,
      lastMovedAt: this.#now(),
    });
    this.#emitCursors();
  }

  #applySnapshot(payload: CollabPresenceSnapshotPayload, selfPeerId: string | null): void {
    const incomingPeerIds = new Set<string>();
    let cursorsChanged = false;
    const nextCursors = new Map<string, CollabRemoteCursorEntry>();

    this.#peerStates.clear();
    for (const entry of payload.entries) {
      if (selfPeerId && entry.peerId === selfPeerId) {
        continue;
      }
      incomingPeerIds.add(entry.peerId);
      const nextPeerState: CollabPeerPresenceState = entry.inLibraryMode
        ? {
          peerId: entry.peerId,
          logicalCircuitId: null,
          inLibraryMode: true,
          selection: createEmptySelection(),
          openDialog: null,
          viewport: null,
          updatedAt: this.#now(),
        }
        : {
          peerId: entry.peerId,
          logicalCircuitId: entry.logicalCircuitId,
          inLibraryMode: false,
          selection: cloneSelection(entry.selection),
          openDialog: cloneOpenDialog(entry.openDialog),
          viewport: cloneViewport(entry.viewport),
          updatedAt: this.#now(),
        };
      this.#peerStates.set(entry.peerId, nextPeerState);

      if (!nextPeerState.inLibraryMode && entry.cursor) {
        const circuitId = entry.cursor.logicalCircuitId !== undefined
          ? entry.cursor.logicalCircuitId
          : nextPeerState.logicalCircuitId;
        const existingCursor = this.#cursors.get(entry.peerId);
        const samePosition = Boolean(
          existingCursor &&
          existingCursor.x === entry.cursor.x &&
          existingCursor.y === entry.cursor.y &&
          existingCursor.logicalCircuitId === circuitId,
        );
        if (!samePosition) {
          cursorsChanged = true;
        }
        nextCursors.set(entry.peerId, {
          peerId: entry.peerId,
          x: entry.cursor.x,
          y: entry.cursor.y,
          logicalCircuitId: circuitId,
          lastMovedAt: samePosition && existingCursor ? existingCursor.lastMovedAt : this.#now(),
        });
      }
    }

    for (const existingPeerId of this.#cursors.keys()) {
      if (!nextCursors.has(existingPeerId)) {
        cursorsChanged = true;
        break;
      }
    }

    this.#cursors.clear();
    for (const [peerId, cursorEntry] of nextCursors.entries()) {
      this.#cursors.set(peerId, cursorEntry);
    }

    this.#emitState();
    if (cursorsChanged) {
      this.#emitCursors();
    }
  }

  #resetRuntimePresenceState(): void {
    this.#clearViewportTimer();
    this.#clearCursorTimer();
    this.#lastSentToHostId = null;
    this.#lastSentStatePayload = null;
    this.#lastSentCursorVisible = false;
    this.#lastSentCursorPayload = null;
    this.#lastCursorSentAt = 0;
    this.#lastViewportSentAt = 0;
    this.#connectedPeersSentSnapshot.clear();

    const hadStates = this.#peerStates.size > 0;
    const hadCursors = this.#cursors.size > 0;
    this.#peerStates.clear();
    this.#cursors.clear();

    if (hadStates) {
      this.#emitState();
    }
    if (hadCursors) {
      this.#emitCursors();
    }
  }

  #emitState(): void {
    this.#stateVersion += 1;
    const peers: Record<string, CollabPeerPresenceState> = {};
    for (const [peerId, entry] of this.#peerStates.entries()) {
      peers[peerId] = entry;
    }
    this.#cachedStateSnapshot = {
      peers,
      version: this.#stateVersion,
    };
    for (const listener of this.#stateListeners) {
      listener(this.#cachedStateSnapshot);
    }
  }

  #emitCursors(): void {
    const cursors: CollabPresenceCursorMap = {};
    for (const [peerId, entry] of this.#cursors.entries()) {
      cursors[peerId] = entry;
    }
    this.#cachedCursorsSnapshot = cursors;
    for (const listener of this.#cursorListeners) {
      listener(this.#cachedCursorsSnapshot);
    }
  }
}

export default CollabPresenceController;
