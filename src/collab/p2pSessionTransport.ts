import type CollabRole from "../types/collab/collabRole";
import type { CollabInviteRole } from "../types/collab/collabRole";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import { type CollabResyncReason, DEFAULT_DATA_CHANNEL_LABEL } from "../types/collab/dataChannelMessage";
import type CollabIceServer from "../types/collab/iceConfig";
import type { CollabRuntimeConfig } from "../types/collab/iceConfig";
import type { CollabSessionClosedEvent } from "../types/collab/sessionState";
import type { CollabHostChangedPayload } from "../types/collab/signalingMessage";
import type CollabTransportState from "../types/collab/transportState";
import type { CollabPeerConnectionState } from "../types/collab/transportState";

import {
  classifyIceDiagnostic,
  type CollabConnectionDiagnostic,
  extractIceCandidateType,
  fetchRuntimeCollabConfig,
  isCollabDisabledByEnv,
  resolveCollabIceServers,
} from "../utils/collabIceConfig";

import { DEFAULT_COLLAB_GRACE_PERIOD_MS } from "./collabEvents";
import DataChannelTransport, {
  type CollabDataChannelLike,
  type DataChannelTransportOptions,
} from "./dataChannelTransport";
import InviteTokenVerifier, { type IssuedInviteToken } from "./inviteTokenVerifier";
import SignalingClient, {
  type CollabSignalingSocketFactory,
  SignalingClientError,
} from "./signalingClient";

export type CollabSessionDescriptionLike = {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
};

export type CollabIceCandidateLike = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};

export type CollabPeerConnectionLike = {
  readonly iceConnectionState: string;
  readonly iceGatheringState?: string;
  readonly connectionState?: string;
  onicecandidate: ((event: { candidate: CollabIceCandidateLike | null }) => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  onconnectionstatechange?: (() => void) | null;
  ondatachannel: ((event: { channel: CollabDataChannelLike }) => void) | null;
  createDataChannel: (label: string, init?: { ordered?: boolean }) => CollabDataChannelLike;
  createOffer: () => Promise<CollabSessionDescriptionLike>;
  createAnswer: () => Promise<CollabSessionDescriptionLike>;
  setLocalDescription: (desc: CollabSessionDescriptionLike) => Promise<void>;
  setRemoteDescription: (desc: CollabSessionDescriptionLike) => Promise<void>;
  addIceCandidate: (candidate: CollabIceCandidateLike) => Promise<void>;
  close: () => void;
};

export type PeerConnectionFactory = (iceServers: CollabIceServer[]) => CollabPeerConnectionLike;

export type ResyncConfirmationContext = {
  reason: CollabResyncReason;
  unconfirmedLocalChangesCount: number;
  peerId: string;
};

export type ResyncExecutionResult = {
  executed: boolean;
  cancelledByUser: boolean;
  unconfirmedLocalChangesCount: number;
};

export type ResyncHooks = {
  getUnconfirmedLocalChangesCount?: () => number;
  getCurrentRevision?: () => number | undefined;
  confirmDiscardLocalChanges?: (context: ResyncConfirmationContext) => Promise<boolean> | boolean;
  onResyncRequested?: (request: {
    peerId: string;
    reason: CollabResyncReason;
    fromRevision?: number;
    hasUnconfirmedLocalChanges?: boolean;
  }) => void;
  onLocalChangesDiscardedForResync?: (context: ResyncConfirmationContext) => void;
};

export type CollabPeerSummary = {
  peerId: string;
  role: CollabRole;
  displayName?: string;
  state: CollabPeerConnectionState;
  diagnostic: CollabConnectionDiagnostic;
  lastHeartbeatAt: number;
};

export type CollabTransportSnapshot = {
  state: CollabTransportState;
  sessionId: string | null;
  selfPeerId: string | null;
  selfRole: CollabRole | null;
  hostPeerId: string | null;
  peers: CollabPeerSummary[];
  diagnostic: CollabConnectionDiagnostic;
  gracePeriodMs: number;
  iceServers: CollabIceServer[];
};

export type P2pSessionTransportOptions = {
  wsUrl?: string;
  sidecarBaseUrl?: string;
  socketFactory?: CollabSignalingSocketFactory;
  peerConnectionFactory?: PeerConnectionFactory;
  customStunUrls?: string[];
  runtimeConfig?: CollabRuntimeConfig | null;
  dataChannelOptions?: DataChannelTransportOptions;
  heartbeatIntervalMs?: number;
  gracePeriodMs?: number;
  autoResyncOnReconnect?: boolean;
  disabledOverride?: boolean;
  resyncHooks?: ResyncHooks;
  now?: () => number;
};

type PeerLinkEntry = {
  peerId: string;
  role: CollabRole;
  displayName?: string;
  pc: CollabPeerConnectionLike;
  channel: CollabDataChannelLike | null;
  dataTransport: DataChannelTransport | null;
  pendingIceCandidates: CollabIceCandidateLike[];
  remoteDescriptionSet: boolean;
  gatheredCandidateTypes: Set<string>;
  state: CollabPeerConnectionState;
  diagnostic: CollabConnectionDiagnostic;
  lastHeartbeatAt: number;
  degradedSince: number | null;
  wasEverConnected: boolean;
  isHostMigration: boolean;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const NONE_DIAGNOSTIC: CollabConnectionDiagnostic = {
  code: "none",
  isRecoverable: true,
  turnPlannedHint: false,
  details: "",
};

function createDefaultPeerConnectionFactory(): PeerConnectionFactory {
  return (iceServers) => {
    if (typeof RTCPeerConnection === "undefined") {
      throw new Error("RTCPeerConnection wird von diesem Browser nicht unterstützt.");
    }
    return new RTCPeerConnection({ iceServers }) as unknown as CollabPeerConnectionLike;
  };
}

// Verwaltet die WebRTC-Stern-Topologie (Host als Zentrum, Teilnehmer via DataChannel), Heartbeat/Grace-Period, Host-Wechsel & Resync
class P2pSessionTransport {
  readonly #signaling: SignalingClient;
  readonly #sidecarBaseUrl: string | undefined;
  readonly #peerConnectionFactory: PeerConnectionFactory;
  readonly #customStunUrls: string[] | undefined;
  readonly #initialRuntimeConfig: CollabRuntimeConfig | null | undefined;
  readonly #dataChannelOptions: DataChannelTransportOptions;
  readonly #heartbeatIntervalMs: number;
  readonly #gracePeriodMsOverride: number | undefined;
  readonly #autoResyncOnReconnect: boolean;
  readonly #isDisabled: boolean;
  readonly #resyncHooks: ResyncHooks;
  readonly #now: () => number;

  readonly #peers = new Map<string, PeerLinkEntry>();
  readonly #messageListeners = new Set<(fromPeerId: string, message: CollabDataChannelMessage) => void>();
  readonly #stateListeners = new Set<(snapshot: CollabTransportSnapshot) => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();
  readonly #sessionClosedListeners = new Set<(event: CollabSessionClosedEvent) => void>();

  #runtimeConfig: CollabRuntimeConfig | null = null;
  #iceServers: CollabIceServer[] = [];
  #effectiveGracePeriodMs = DEFAULT_COLLAB_GRACE_PERIOD_MS;

  #state: CollabTransportState = "idle";
  #sessionId: string | null = null;
  #selfPeerId: string | null = null;
  #selfRole: CollabRole | null = null;
  #hostPeerId: string | null = null;
  #hostSecret: string | null = null;
  #tokenVerifier: InviteTokenVerifier | null = null;
  #diagnostic: CollabConnectionDiagnostic = { ...NONE_DIAGNOSTIC };

  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #heartbeatSeq = 1;
  #disposed = false;
  #sessionClosedEmitted = false;

  constructor(options: P2pSessionTransportOptions = {}) {
    this.#isDisabled = options.disabledOverride !== undefined
      ? options.disabledOverride
      : isCollabDisabledByEnv();
    this.#sidecarBaseUrl = options.sidecarBaseUrl;
    this.#signaling = new SignalingClient({
      wsUrl: options.wsUrl,
      sidecarBaseUrl: options.sidecarBaseUrl,
      socketFactory: options.socketFactory,
      disabledOverride: this.#isDisabled,
    });
    this.#peerConnectionFactory = options.peerConnectionFactory ?? createDefaultPeerConnectionFactory();
    this.#customStunUrls = options.customStunUrls;
    this.#initialRuntimeConfig = options.runtimeConfig;
    this.#dataChannelOptions = options.dataChannelOptions ?? {};
    this.#heartbeatIntervalMs = Math.max(0, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
    this.#gracePeriodMsOverride = options.gracePeriodMs;
    this.#autoResyncOnReconnect = options.autoResyncOnReconnect ?? true;
    this.#resyncHooks = options.resyncHooks ?? {};
    this.#now = options.now ?? (() => Date.now());

    this.#bindSignalingEvents();
  }

  getSnapshot(): CollabTransportSnapshot {
    const peers: CollabPeerSummary[] = [];
    for (const entry of this.#peers.values()) {
      peers.push({
        peerId: entry.peerId,
        role: entry.role,
        displayName: entry.displayName,
        state: entry.state,
        diagnostic: entry.diagnostic,
        lastHeartbeatAt: entry.lastHeartbeatAt,
      });
    }

    return {
      state: this.#state,
      sessionId: this.#sessionId,
      selfPeerId: this.#selfPeerId,
      selfRole: this.#selfRole,
      hostPeerId: this.#hostPeerId,
      peers,
      diagnostic: this.#diagnostic,
      gracePeriodMs: this.#effectiveGracePeriodMs,
      iceServers: [...this.#iceServers],
    };
  }

  // Startet eine neue Kollaborations-Session als autoritativer Host (mit optionalem COLLAB_ACCESS_KEY)
  async startHostSession(options: { accessKey?: string; displayName?: string } = {}): Promise<CollabTransportSnapshot> {
    this.#assertEnabled();
    this.#sessionClosedEmitted = false;
    await this.#prepareIceConfig();
    this.#setState("connecting");

    await this.#signaling.connect();
    const created = await this.#signaling.createSession({
      accessKey: options.accessKey,
      displayName: options.displayName,
    });

    this.#sessionId = created.sessionId;
    this.#selfPeerId = created.peerId;
    this.#selfRole = "host";
    this.#hostPeerId = created.peerId;
    this.#hostSecret = created.hostSecret;
    this.#tokenVerifier = new InviteTokenVerifier({
      sessionId: created.sessionId,
      defaultTtlMs: created.inviteTtlMs,
      now: this.#now,
    });

    this.#startHeartbeatLoop();
    this.#setState("connected");
    return this.getSnapshot();
  }

  // Erstellt einen kryptografisch abgesicherten 5-Minuten-Einladungslink über den Host-Verifier + Signaling-Relay
  async createInvite(role: CollabInviteRole, ttlMs?: number): Promise<IssuedInviteToken> {
    if (this.#selfRole !== "host" || !this.#sessionId || !this.#hostSecret || !this.#tokenVerifier) {
      throw new Error("Nur der aktive Host kann Einladungslinks erzeugen.");
    }

    const issued = await this.#tokenVerifier.issueInvite(role, ttlMs);
    await this.#signaling.createInvite({
      sessionId: this.#sessionId,
      hostSecret: this.#hostSecret,
      role: issued.role,
      inviteToken: issued.inviteToken,
      ttlMs: Math.max(10000, issued.expiresAt - issued.createdAt),
      tokenProof: issued.tokenProof,
    });
    return issued;
  }

  async revokeInvite(inviteToken: string): Promise<void> {
    if (this.#selfRole !== "host" || !this.#sessionId || !this.#hostSecret || !this.#tokenVerifier) {
      throw new Error("Nur der aktive Host kann Einladungslinks widerrufen.");
    }
    this.#tokenVerifier.revokeInvite(inviteToken);
    await this.#signaling.revokeInvite({
      sessionId: this.#sessionId,
      hostSecret: this.#hostSecret,
      inviteToken,
    });
  }

  // Tritt einer Session per 5-Minuten-Einladungslink bei (ohne Server-Secret) und baut P2P zum Host auf
  async joinSession(options: { inviteToken: string; displayName?: string }): Promise<CollabTransportSnapshot> {
    this.#assertEnabled();
    this.#sessionClosedEmitted = false;
    await this.#prepareIceConfig();
    this.#setState("connecting");

    await this.#signaling.connect();
    const joined = await this.#signaling.joinWithInvite({
      inviteToken: options.inviteToken,
      displayName: options.displayName,
    });

    this.#sessionId = joined.sessionId;
    this.#selfPeerId = joined.peerId;
    this.#selfRole = joined.role;
    this.#hostPeerId = joined.hostPeerId;
    this.#hostSecret = null;
    this.#tokenVerifier = null;

    this.#createPeerLink(joined.hostPeerId, "host", false, false);
    this.#startHeartbeatLoop();
    this.#emitSnapshot();
    return this.getSnapshot();
  }

  async sendToPeer(peerId: string, message: CollabDataChannelMessage): Promise<void> {
    const entry = this.#peers.get(peerId);
    if (!entry || !entry.dataTransport || !entry.dataTransport.isOpen) {
      throw new Error(`Kein offener WebRTC-DataChannel zu Peer "${peerId}".`);
    }
    await entry.dataTransport.send(message);
  }

  async sendToHost(message: CollabDataChannelMessage): Promise<void> {
    if (!this.#hostPeerId || this.#selfRole === "host") {
      throw new Error("Kein entfernter Host verbunden.");
    }
    await this.sendToPeer(this.#hostPeerId, message);
  }

  async broadcast(message: CollabDataChannelMessage, excludePeerId?: string): Promise<void> {
    const deliveries: Promise<void>[] = [];
    for (const entry of this.#peers.values()) {
      if (entry.peerId === excludePeerId) {
        continue;
      }
      if (entry.dataTransport && entry.dataTransport.isOpen) {
        deliveries.push(entry.dataTransport.send(message));
      }
    }
    await Promise.all(deliveries);
  }

  // Überträgt die Host-Rolle autorisiert auf einen verbundenen Ziel-Peer (Stern-Zentrum-Migration)
  transferHost(targetPeerId: string): void {
    if (this.#selfRole !== "host" || !this.#sessionId || !this.#hostSecret) {
      throw new Error("Nur der aktuelle Host kann das Host-Recht übertragen.");
    }
    if (!this.#peers.has(targetPeerId)) {
      throw new Error(`Ziel-Teilnehmer "${targetPeerId}" ist nicht verbunden.`);
    }

    this.#tokenVerifier?.revokeAll();
    this.#signaling.transferHost({
      sessionId: this.#sessionId,
      hostSecret: this.#hostSecret,
      targetPeerId,
    });
  }

  // Entfernt einen Teilnehmer autorisiert durch den aktuellen Host und schließt dessen P2P-Link sofort
  kickPeer(peerId: string, reason = "kicked"): void {
    if (this.#selfRole !== "host" || !this.#sessionId || !this.#hostSecret) {
      throw new Error("Nur der aktive Host kann Teilnehmer aus der Session entfernen.");
    }
    if (peerId === this.#selfPeerId) {
      throw new Error("Der Host kann sich nicht selbst aus der Session entfernen.");
    }
    const entry = this.#peers.get(peerId);
    if (!entry) {
      throw new Error(`Teilnehmer "${peerId}" ist nicht in der Session.`);
    }

    this.#signaling.kickPeer({
      sessionId: this.#sessionId,
      hostSecret: this.#hostSecret,
      targetPeerId: peerId,
      reason,
    });
    this.#disposePeerLink(entry, reason);
    this.#peers.delete(peerId);
    this.#recomputeTransportState();
  }

  // Aktualisiert lokale Peer-Metadaten (Rolle / Anzeigename) im Transport-Snapshot
  updatePeerMetadata(peerId: string, patch: { role?: CollabRole; displayName?: string }): void {
    const entry = this.#peers.get(peerId);
    if (!entry) {
      return;
    }
    let changed = false;
    if (patch.role !== undefined && entry.role !== patch.role) {
      entry.role = patch.role;
      changed = true;
    }
    if (patch.displayName !== undefined && entry.displayName !== patch.displayName) {
      entry.displayName = patch.displayName;
      changed = true;
    }
    if (changed) {
      this.#emitSnapshot();
    }
  }

  // Fordert einen Resync vom Host an; unbestätigte lokale Änderungen werden niemals stillschweigend verworfen
  async requestResync(
    reason: CollabResyncReason = "manual",
    fromRevision?: number,
  ): Promise<ResyncExecutionResult> {
    if (this.#selfRole === "host" || !this.#hostPeerId || !this.#selfPeerId) {
      return {
        executed: false,
        cancelledByUser: false,
        unconfirmedLocalChangesCount: 0,
      };
    }

    const unconfirmedCount = Math.max(0, this.#resyncHooks.getUnconfirmedLocalChangesCount?.() ?? 0);
    if (unconfirmedCount > 0) {
      const context: ResyncConfirmationContext = {
        reason,
        unconfirmedLocalChangesCount: unconfirmedCount,
        peerId: this.#selfPeerId,
      };
      if (!this.#resyncHooks.confirmDiscardLocalChanges) {
        return {
          executed: false,
          cancelledByUser: true,
          unconfirmedLocalChangesCount: unconfirmedCount,
        };
      }
      const confirmed = await this.#resyncHooks.confirmDiscardLocalChanges(context);
      if (!confirmed) {
        return {
          executed: false,
          cancelledByUser: true,
          unconfirmedLocalChangesCount: unconfirmedCount,
        };
      }
      this.#resyncHooks.onLocalChangesDiscardedForResync?.(context);
    }

    const resolvedFromRevision = fromRevision !== undefined
      ? fromRevision
      : reason !== "manual"
        ? this.#resyncHooks.getCurrentRevision?.()
        : undefined;

    await this.sendToHost({
      kind: "resync-request",
      reason,
      ...(resolvedFromRevision !== undefined ? { fromRevision: resolvedFromRevision } : {}),
      hasUnconfirmedLocalChanges: unconfirmedCount > 0,
    });

    return {
      executed: true,
      cancelledByUser: false,
      unconfirmedLocalChangesCount: unconfirmedCount,
    };
  }

  // Prüft Heartbeats und Grace-Period-Überschreitungen (direkt aufrufbar für deterministische Tests)
  checkHeartbeats(): void {
    if (this.#disposed || !this.#sessionId) {
      return;
    }

    const now = this.#now();
    for (const entry of this.#peers.values()) {
      entry.dataTransport?.cleanupExpiredInbound();

      if (entry.state === "connected" && entry.dataTransport?.isOpen) {
        void entry.dataTransport.send({
          kind: "heartbeat-ping",
          seq: this.#heartbeatSeq++,
          sentAt: now,
        }).catch(() => {
          // Sendefehler werden über onError/onClose verarbeitet
        });
      }

      if (entry.wasEverConnected && now - entry.lastHeartbeatAt > this.#effectiveGracePeriodMs) {
        if (entry.state === "connected") {
          entry.state = "degraded";
          entry.degradedSince = entry.degradedSince ?? now;
          this.#recomputeTransportState();
        } else if (
          (entry.state === "degraded" || entry.state === "reconnecting") &&
          entry.degradedSince !== null &&
          now - entry.degradedSince >= this.#effectiveGracePeriodMs
        ) {
          this.#markPeerFailed(entry, "failed");
        }
      }
    }
  }

  onMessage(listener: (fromPeerId: string, message: CollabDataChannelMessage) => void): () => void {
    this.#messageListeners.add(listener);
    return () => {
      this.#messageListeners.delete(listener);
    };
  }

  onStateChange(listener: (snapshot: CollabTransportSnapshot) => void): () => void {
    this.#stateListeners.add(listener);
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this.#errorListeners.add(listener);
    return () => {
      this.#errorListeners.delete(listener);
    };
  }

  onSessionClosed(listener: (event: CollabSessionClosedEvent) => void): () => void {
    this.#sessionClosedListeners.add(listener);
    return () => {
      this.#sessionClosedListeners.delete(listener);
    };
  }

  close(reason = "left"): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#stopHeartbeatLoop();

    for (const entry of this.#peers.values()) {
      this.#disposePeerLink(entry, reason);
    }
    this.#peers.clear();

    if (this.#selfRole === "host" && this.#sessionId && this.#hostSecret) {
      try {
        this.#signaling.closeSession({
          sessionId: this.#sessionId,
          hostSecret: this.#hostSecret,
          reason,
        });
      } catch (_error) {
        // Signaling konnte bereits geschlossen sein
      }
    } else {
      this.#signaling.leaveSession(reason);
    }

    this.#signaling.disconnect();
    this.#tokenVerifier = null;
    this.#hostSecret = null;
    this.#setState("disconnected");
  }

  #assertEnabled(): void {
    if (this.#isDisabled) {
      throw new SignalingClientError("disabled", "WebRTC-Kollaboration ist in diesem Build deaktiviert.");
    }
  }

  async #prepareIceConfig(): Promise<void> {
    if (this.#runtimeConfig === null) {
      if (this.#initialRuntimeConfig !== undefined) {
        this.#runtimeConfig = this.#initialRuntimeConfig;
      } else {
        this.#runtimeConfig = await fetchRuntimeCollabConfig(undefined, {
          disabledOverride: this.#isDisabled,
          baseUrl: this.#sidecarBaseUrl,
        });
      }
    }

    this.#iceServers = resolveCollabIceServers({
      customStunUrls: this.#customStunUrls,
      runtimeConfig: this.#runtimeConfig,
    });
    this.#effectiveGracePeriodMs = Math.max(
      1000,
      this.#gracePeriodMsOverride ?? this.#runtimeConfig?.gracePeriodMs ?? DEFAULT_COLLAB_GRACE_PERIOD_MS,
    );
  }

  #bindSignalingEvents(): void {
    this.#signaling.onPeerJoined((payload) => {
      void this.#handlePeerJoined(payload);
    });

    this.#signaling.onPeerLeft((payload) => {
      const entry = this.#peers.get(payload.peerId);
      if (entry) {
        this.#disposePeerLink(entry, payload.reason ?? "peer-left");
        this.#peers.delete(payload.peerId);
        this.#recomputeTransportState();
      }
    });

    this.#signaling.onSignal((payload) => {
      void this.#handleIncomingSignal(payload.fromPeerId, payload.signalType, payload.data);
    });

    this.#signaling.onHostChanged((payload) => {
      void this.#handleHostChanged(payload);
    });

    this.#signaling.onSessionClosed((payload) => {
      this.#handleRemoteSessionClosed(payload.sessionId, payload.reason);
    });

    this.#signaling.onClose(({ code, reason }) => {
      if ((code === 4001 || code === 4003) && this.#sessionId && !this.#sessionClosedEmitted && !this.#disposed) {
        const effectiveReason = reason.trim().length > 0
          ? reason.trim()
          : (code === 4003 ? "kicked" : "session-closed");
        this.#handleRemoteSessionClosed(this.#sessionId, effectiveReason, code);
      }
    });

    this.#signaling.onError((error) => {
      this.#emitError(error);
    });

    this.#signaling.onStateChange((sigState) => {
      if (sigState === "reconnecting" && this.#state === "connecting") {
        this.#diagnostic = classifyIceDiagnostic({
          iceConnectionState: "new",
          gatheredCandidateTypes: new Set<string>(),
          signalingUnavailable: true,
        });
        this.#setState("reconnecting");
      }
    });
  }

  async #handlePeerJoined(payload: {
    sessionId: string;
    peerId: string;
    role: CollabInviteRole;
    inviteToken: string;
    tokenProof?: string;
    displayName?: string;
  }): Promise<void> {
    if (this.#selfRole !== "host" || !this.#tokenVerifier || !this.#sessionId || !this.#hostSecret) {
      return;
    }

    const verification = await this.#tokenVerifier.verifyJoin({
      sessionId: payload.sessionId,
      inviteToken: payload.inviteToken,
      claimedRole: payload.role,
      tokenProof: payload.tokenProof,
    });

    if (!verification.valid) {
      this.#signaling.kickPeer({
        sessionId: this.#sessionId,
        hostSecret: this.#hostSecret,
        targetPeerId: payload.peerId,
        reason: `invite-verification-failed:${verification.reason}`,
      });
      this.#emitError(new Error(`Beitritt von Peer ${payload.peerId} abgelehnt (${verification.reason}).`));
      return;
    }

    const entry = this.#createPeerLink(payload.peerId, verification.role, true, false, payload.displayName);
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      this.#signaling.sendSignal({
        targetPeerId: payload.peerId,
        signalType: "offer",
        data: offer,
      });
    } catch (error) {
      this.#emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async #handleIncomingSignal(
    fromPeerId: string,
    signalType: "offer" | "answer" | "ice-candidate",
    data: unknown,
  ): Promise<void> {
    let entry = this.#peers.get(fromPeerId);
    if (!entry) {
      if (this.#selfRole === "host" || fromPeerId !== this.#hostPeerId) {
        return;
      }
      entry = this.#createPeerLink(fromPeerId, "host", false, this.#state === "migrating-host");
    }

    try {
      if (signalType === "offer") {
        const desc = data as CollabSessionDescriptionLike;
        await entry.pc.setRemoteDescription(desc);
        entry.remoteDescriptionSet = true;
        await this.#flushPendingIceCandidates(entry);

        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        this.#signaling.sendSignal({
          targetPeerId: fromPeerId,
          signalType: "answer",
          data: answer,
        });
      } else if (signalType === "answer") {
        const desc = data as CollabSessionDescriptionLike;
        await entry.pc.setRemoteDescription(desc);
        entry.remoteDescriptionSet = true;
        await this.#flushPendingIceCandidates(entry);
      } else if (signalType === "ice-candidate") {
        const candidate = data as CollabIceCandidateLike | null;
        if (!candidate) {
          return;
        }
        if (entry.remoteDescriptionSet) {
          await entry.pc.addIceCandidate(candidate);
        } else {
          entry.pendingIceCandidates.push(candidate);
        }
      }
    } catch (error) {
      this.#emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async #handleHostChanged(payload: CollabHostChangedPayload): Promise<void> {
    if (this.#disposed || payload.sessionId !== this.#sessionId) {
      return;
    }

    this.#setState("migrating-host");

    for (const entry of this.#peers.values()) {
      this.#disposePeerLink(entry, "host-migration");
    }
    this.#peers.clear();

    this.#hostPeerId = payload.newHostPeerId;

    if (payload.newHostPeerId === this.#selfPeerId && payload.hostSecret) {
      this.#selfRole = "host";
      this.#hostSecret = payload.hostSecret;
      this.#tokenVerifier = new InviteTokenVerifier({
        sessionId: payload.sessionId,
        defaultTtlMs: this.#runtimeConfig?.inviteTtlMs,
        now: this.#now,
      });

      const peerEntries = payload.peers && payload.peers.length > 0
        ? payload.peers
        : (payload.peerIds ?? []).map((peerId) => ({
          peerId,
          role: (peerId === payload.previousHostPeerId ? "collaborator" : "guest") as CollabInviteRole,
          displayName: undefined,
        }));

      if (peerEntries.length === 0) {
        this.#setState("connected");
        return;
      }

      for (const peerInfo of peerEntries) {
        const role: CollabRole = peerInfo.peerId === payload.previousHostPeerId
          ? "collaborator"
          : peerInfo.role;
        const entry = this.#createPeerLink(peerInfo.peerId, role, true, true, peerInfo.displayName);
        try {
          const offer = await entry.pc.createOffer();
          await entry.pc.setLocalDescription(offer);
          this.#signaling.sendSignal({
            targetPeerId: peerInfo.peerId,
            signalType: "offer",
            data: offer,
          });
        } catch (error) {
          this.#emitError(error instanceof Error ? error : new Error(String(error)));
        }
      }
      this.#emitSnapshot();
      return;
    }

    if (payload.previousHostPeerId === this.#selfPeerId) {
      this.#selfRole = "collaborator";
      this.#hostSecret = null;
      this.#tokenVerifier = null;
    }

    // Übrige Teilnehmer warten auf das P2P-Offer des neuen Hosts (Stern-Zentrum-Migration)
    this.#createPeerLink(payload.newHostPeerId, "host", false, true);
    this.#emitSnapshot();
  }

  #createPeerLink(
    peerId: string,
    role: CollabRole,
    createOfferChannel: boolean,
    isHostMigration: boolean,
    displayName?: string,
  ): PeerLinkEntry {
    const existing = this.#peers.get(peerId);
    if (existing) {
      this.#disposePeerLink(existing, "replaced");
      this.#peers.delete(peerId);
    }

    const pc = this.#peerConnectionFactory(this.#iceServers);
    const entry: PeerLinkEntry = {
      peerId,
      role,
      displayName,
      pc,
      channel: null,
      dataTransport: null,
      pendingIceCandidates: [],
      remoteDescriptionSet: false,
      gatheredCandidateTypes: new Set<string>(),
      state: "connecting",
      diagnostic: { ...NONE_DIAGNOSTIC },
      lastHeartbeatAt: this.#now(),
      degradedSince: null,
      wasEverConnected: false,
      isHostMigration,
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      const cType = extractIceCandidateType(event.candidate.candidate);
      if (cType) {
        entry.gatheredCandidateTypes.add(cType);
      }
      if (this.#signaling.state === "open") {
        this.#signaling.sendSignal({
          targetPeerId: peerId,
          signalType: "ice-candidate",
          data: event.candidate,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      this.#handlePeerIceStateChange(entry);
    };

    pc.ondatachannel = (event) => {
      this.#attachDataChannel(entry, event.channel);
    };

    if (createOfferChannel) {
      const channel = pc.createDataChannel(DEFAULT_DATA_CHANNEL_LABEL, { ordered: true });
      this.#attachDataChannel(entry, channel);
    }

    this.#peers.set(peerId, entry);
    return entry;
  }

  #attachDataChannel(entry: PeerLinkEntry, channel: CollabDataChannelLike): void {
    if (entry.dataTransport) {
      entry.dataTransport.close();
    }

    entry.channel = channel;
    const transport = new DataChannelTransport(channel, this.#dataChannelOptions);
    entry.dataTransport = transport;

    const markConnected = () => {
      const wasRecovering = entry.wasEverConnected && (entry.state === "degraded" || entry.state === "reconnecting");
      entry.wasEverConnected = true;
      entry.lastHeartbeatAt = this.#now();
      entry.degradedSince = null;
      entry.state = "connected";
      entry.diagnostic = { ...NONE_DIAGNOSTIC };
      entry.isHostMigration = false;
      this.#recomputeTransportState();

      if (wasRecovering && this.#autoResyncOnReconnect && this.#selfRole !== "host" && entry.peerId === this.#hostPeerId) {
        void this.requestResync("reconnected");
      }
    };

    if (channel.readyState === "open") {
      markConnected();
    } else {
      channel.addEventListener("open", markConnected);
    }

    transport.onMessage((message) => {
      entry.lastHeartbeatAt = this.#now();

      if (message.kind === "heartbeat-ping") {
        if (transport.isOpen) {
          void transport.send({
            kind: "heartbeat-pong",
            seq: message.seq,
            sentAt: message.sentAt,
            receivedAt: this.#now(),
          }).catch(() => {});
        }
        return;
      }

      if (message.kind === "heartbeat-pong") {
        if (entry.state === "degraded" || entry.state === "reconnecting") {
          entry.state = "connected";
          entry.degradedSince = null;
          entry.diagnostic = { ...NONE_DIAGNOSTIC };
          this.#recomputeTransportState();
          if (this.#autoResyncOnReconnect && this.#selfRole !== "host" && entry.peerId === this.#hostPeerId) {
            void this.requestResync("reconnected");
          }
        }
        return;
      }

      if (message.kind === "resync-request" && this.#selfRole === "host") {
        this.#resyncHooks.onResyncRequested?.({
          peerId: entry.peerId,
          reason: message.reason,
          fromRevision: message.fromRevision,
          hasUnconfirmedLocalChanges: message.hasUnconfirmedLocalChanges,
        });
      }

      for (const listener of this.#messageListeners) {
        listener(entry.peerId, message);
      }
    });

    transport.onError((error) => {
      this.#emitError(error);
    });

    transport.onClose(() => {
      if (this.#disposed || entry.state === "disconnected") {
        return;
      }
      if (entry.wasEverConnected) {
        entry.state = "reconnecting";
        entry.degradedSince = entry.degradedSince ?? this.#now();
      } else {
        this.#markPeerFailed(entry, "failed");
      }
      this.#recomputeTransportState();
    });
  }

  #handlePeerIceStateChange(entry: PeerLinkEntry): void {
    const iceState = entry.pc.iceConnectionState.toLowerCase();
    if (iceState === "connected" || iceState === "completed") {
      const wasRecovering = entry.wasEverConnected && (entry.state === "degraded" || entry.state === "reconnecting");
      entry.lastHeartbeatAt = this.#now();
      entry.degradedSince = null;
      if (entry.dataTransport?.isOpen) {
        entry.wasEverConnected = true;
        entry.state = "connected";
        entry.diagnostic = { ...NONE_DIAGNOSTIC };
        entry.isHostMigration = false;
      }
      this.#recomputeTransportState();
      if (wasRecovering && this.#autoResyncOnReconnect && this.#selfRole !== "host" && entry.peerId === this.#hostPeerId) {
        void this.requestResync("reconnected");
      }
      return;
    }

    if (iceState === "disconnected") {
      entry.state = "degraded";
      entry.degradedSince = entry.degradedSince ?? this.#now();
      entry.diagnostic = {
        code: "connecting",
        isRecoverable: true,
        turnPlannedHint: false,
        details: "P2P-Verbindung kurzzeitig unterbrochen – Grace Period läuft...",
      };
      this.#recomputeTransportState();
      return;
    }

    if (iceState === "failed") {
      this.#markPeerFailed(entry, "failed");
    }
  }

  #markPeerFailed(entry: PeerLinkEntry, iceState: string): void {
    entry.state = "failed";
    entry.diagnostic = classifyIceDiagnostic({
      iceConnectionState: iceState,
      iceGatheringState: entry.pc.iceGatheringState,
      gatheredCandidateTypes: entry.gatheredCandidateTypes,
      isHostMigration: entry.isHostMigration,
    });
    this.#diagnostic = entry.diagnostic;
    this.#recomputeTransportState();
  }

  async #flushPendingIceCandidates(entry: PeerLinkEntry): Promise<void> {
    const pending = entry.pendingIceCandidates.splice(0, entry.pendingIceCandidates.length);
    for (const candidate of pending) {
      await entry.pc.addIceCandidate(candidate);
    }
  }

  #disposePeerLink(entry: PeerLinkEntry, reason: string): void {
    entry.state = "disconnected";
    entry.dataTransport?.abortPendingOutgoing(reason);
    entry.dataTransport?.close();
    entry.dataTransport = null;
    entry.channel = null;
    entry.pc.onicecandidate = null;
    entry.pc.oniceconnectionstatechange = null;
    entry.pc.ondatachannel = null;
    try {
      entry.pc.close();
    } catch (_error) {
      // PeerConnection konnte bereits geschlossen sein
    }
  }

  #recomputeTransportState(): void {
    if (this.#disposed) {
      return;
    }
    if (!this.#sessionId) {
      this.#setState("idle");
      return;
    }

    if (this.#selfRole === "host") {
      const peerEntries = Array.from(this.#peers.values());
      if (peerEntries.some((p) => p.state === "degraded" || p.state === "reconnecting")) {
        this.#setState("degraded");
        return;
      }
      if (peerEntries.length > 0 && peerEntries.every((p) => p.state === "failed")) {
        const failedDiag = peerEntries.find((p) => p.diagnostic.code !== "none")?.diagnostic;
        if (failedDiag) {
          this.#diagnostic = failedDiag;
        }
        this.#setState("failed");
        return;
      }
      this.#diagnostic = { ...NONE_DIAGNOSTIC };
      this.#setState("connected");
      return;
    }

    const hostLink = this.#hostPeerId ? this.#peers.get(this.#hostPeerId) : undefined;
    if (!hostLink) {
      this.#setState("connecting");
      return;
    }

    this.#diagnostic = hostLink.diagnostic;
    if (hostLink.state === "connected") {
      this.#setState("connected");
    } else if (hostLink.state === "degraded") {
      this.#setState("degraded");
    } else if (hostLink.state === "reconnecting") {
      this.#setState("reconnecting");
    } else if (hostLink.state === "failed") {
      this.#setState("failed");
    } else if (this.#state !== "migrating-host") {
      this.#setState("connecting");
    }
  }

  #startHeartbeatLoop(): void {
    this.#stopHeartbeatLoop();
    if (this.#heartbeatIntervalMs <= 0) {
      return;
    }
    this.#heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.#heartbeatIntervalMs);
  }

  #stopHeartbeatLoop(): void {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  #setState(next: CollabTransportState): void {
    this.#state = next;
    this.#emitSnapshot();
  }

  #emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.#stateListeners) {
      listener(snapshot);
    }
  }

  #emitError(error: Error): void {
    for (const listener of this.#errorListeners) {
      listener(error);
    }
  }

  #handleRemoteSessionClosed(sessionId: string | null, reason: string, closeCode?: number): void {
    this.#stopHeartbeatLoop();
    for (const entry of this.#peers.values()) {
      this.#disposePeerLink(entry, reason);
    }
    this.#peers.clear();
    this.#tokenVerifier = null;
    this.#hostSecret = null;
    this.#signaling.disconnect();
    this.#setState("disconnected");
    if (!this.#sessionClosedEmitted) {
      this.#sessionClosedEmitted = true;
      const event: CollabSessionClosedEvent = {
        sessionId,
        reason,
        ...(closeCode !== undefined ? { closeCode } : {}),
      };
      for (const listener of this.#sessionClosedListeners) {
        listener(event);
      }
    }
  }
}

export default P2pSessionTransport;
