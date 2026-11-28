import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import type CollabRole from "../src/types/collab/collabRole.ts";
import type { CollabInviteRole } from "../src/types/collab/collabRole.ts";
import type {
  CollabCloseSessionPayload,
  CollabCreateInvitePayload,
  CollabCreateSessionPayload,
  CollabHostChangedPayload,
  CollabHostChangedPeerInfo,
  CollabInviteCreatedPayload,
  CollabInviteRevokedPayload,
  CollabJoinedSessionPayload,
  CollabJoinInvitePayload,
  CollabKickPeerPayload,
  CollabPeerJoinedPayload,
  CollabPeerLeftPayload,
  CollabRevokeInvitePayload,
  CollabSessionClosedPayload,
  CollabSessionCreatedPayload,
  CollabSignalForwardPayload,
  CollabSignalingErrorCode,
  CollabSignalRelayedPayload,
  CollabTransferHostPayload,
} from "../src/types/collab/signalingMessage.ts";

import {
  COLLAB_EVENT_HOST_CHANGED,
  COLLAB_EVENT_INVITE_CREATED,
  COLLAB_EVENT_INVITE_REVOKED,
  COLLAB_EVENT_JOINED,
  COLLAB_EVENT_PEER_JOINED,
  COLLAB_EVENT_PEER_LEFT,
  COLLAB_EVENT_SESSION_CLOSED,
  COLLAB_EVENT_SESSION_CREATED,
  COLLAB_EVENT_SIGNAL_RELAYED,
  DEFAULT_COLLAB_INVITE_TTL_MS,
} from "../src/collab/collabEvents.ts";

export type CollabRelayClient = {
  send: (event: string, payload?: unknown) => void;
  close?: (code?: number, reason?: string) => void;
};

export type CollabSignalingRelayOptions = {
  accessKey?: string;
  inviteTtlMs?: number;
  maxSessions?: number;
  maxPeersPerSession?: number;
  now?: () => number;
};

export type CollabSignalingStatus = {
  activeSessions: number;
  activePeers: number;
  activeInvites: number;
  authRequired: boolean;
};

export class CollabSignalingError extends Error {
  readonly code: CollabSignalingErrorCode;

  constructor(code: CollabSignalingErrorCode, message: string) {
    super(message);
    this.name = "CollabSignalingError";
    this.code = code;
  }
}

type CollabPeerRecord = {
  peerId: string;
  client: CollabRelayClient;
  role: CollabRole;
  displayName?: string;
};

type CollabSessionRecord = {
  sessionId: string;
  hostPeerId: string;
  hostSecret: string;
  peers: Map<string, CollabPeerRecord>;
};

type CollabInviteRecord = {
  inviteToken: string;
  sessionId: string;
  role: CollabInviteRole;
  expiresAt: number;
  tokenProof?: string;
  revoked: boolean;
};

type ClientRegistration = {
  sessionId: string;
  peerId: string;
};

const SESSION_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
const MIN_INVITE_TTL_MS = 10000;
const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_TOKEN_PROOF_LENGTH = 512;

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf-8").digest();
}

function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(hashSecret(a), hashSecret(b));
}

function createEphemeralId(prefix: string): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g += 1) {
    let part = "";
    for (let i = 0; i < 4; i += 1) {
      part += SESSION_ALPHABET[randomInt(0, SESSION_ALPHABET.length)];
    }
    groups.push(part);
  }
  return `${prefix}-${groups.join("-")}`;
}

function createSecretToken(): string {
  return randomBytes(24).toString("base64url");
}

function sanitizeDisplayName(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

function isInviteRole(value: unknown): value is CollabInviteRole {
  return value === "guest" || value === "collaborator";
}

function isSignalType(value: unknown): value is CollabSignalForwardPayload["signalType"] {
  return value === "offer" || value === "answer" || value === "ice-candidate";
}

// Flüchtiges In-Memory-WebRTC-Signaling-Relay ohne Persistenz, ohne Lobby und ohne Chat
class CollabSignalingRelay {
  readonly #accessKey: string;
  readonly #inviteTtlMs: number;
  readonly #maxSessions: number;
  readonly #maxPeersPerSession: number;
  readonly #now: () => number;
  readonly #sessions = new Map<string, CollabSessionRecord>();
  readonly #invites = new Map<string, CollabInviteRecord>();
  readonly #clientIndex = new Map<CollabRelayClient, ClientRegistration>();

  constructor(options: CollabSignalingRelayOptions = {}) {
    this.#accessKey = (options.accessKey ?? "").trim();
    this.#inviteTtlMs = Math.max(
      MIN_INVITE_TTL_MS,
      Math.min(options.inviteTtlMs ?? DEFAULT_COLLAB_INVITE_TTL_MS, DEFAULT_COLLAB_INVITE_TTL_MS),
    );
    this.#maxSessions = Math.max(1, options.maxSessions ?? 50);
    this.#maxPeersPerSession = Math.max(2, options.maxPeersPerSession ?? 16);
    this.#now = options.now ?? (() => Date.now());
  }

  get requiresAccessKey(): boolean {
    return this.#accessKey.length > 0;
  }

  verifyAccessKey(candidate: unknown): boolean {
    if (!this.requiresAccessKey) {
      return true;
    }
    if (typeof candidate !== "string" || candidate.length === 0) {
      return false;
    }
    return constantTimeEquals(candidate, this.#accessKey);
  }

  isClientRegistered(client: CollabRelayClient): boolean {
    return this.#clientIndex.has(client);
  }

  // Erstellt eine neue flüchtige Session und weist dem Aufrufer die Host-Rolle zu
  createSession(
    client: CollabRelayClient,
    payload: CollabCreateSessionPayload = {},
  ): CollabSessionCreatedPayload {
    this.#cleanupExpiredInvites();

    if (this.#clientIndex.has(client)) {
      throw new CollabSignalingError("already-in-session", "Dieser Client ist bereits in einer Kollaborations-Session registriert.");
    }
    if (!this.verifyAccessKey(payload.accessKey)) {
      throw new CollabSignalingError("unauthorized", "Ungültiger oder fehlender Zugangsschlüssel (COLLAB_ACCESS_KEY).");
    }
    if (this.#sessions.size >= this.#maxSessions) {
      throw new CollabSignalingError("session-limit-reached", "Maximale Anzahl gleichzeitiger Kollaborations-Sessions erreicht.");
    }

    let sessionId = createEphemeralId("sess");
    while (this.#sessions.has(sessionId)) {
      sessionId = createEphemeralId("sess");
    }
    const peerId = createEphemeralId("peer");
    const hostSecret = createSecretToken();

    const peers = new Map<string, CollabPeerRecord>();
    peers.set(peerId, {
      peerId,
      client,
      role: "host",
      displayName: sanitizeDisplayName(payload.displayName),
    });

    this.#sessions.set(sessionId, {
      sessionId,
      hostPeerId: peerId,
      hostSecret,
      peers,
    });
    this.#clientIndex.set(client, { sessionId, peerId });

    const created: CollabSessionCreatedPayload = {
      sessionId,
      peerId,
      hostSecret,
      role: "host",
      inviteTtlMs: this.#inviteTtlMs,
    };
    client.send(COLLAB_EVENT_SESSION_CREATED, created);
    return created;
  }

  // Erstellt ein zeitlich begrenztes (standardmäßig 5 Minuten), rollengebundenes Einladungs-Token
  createInvite(
    client: CollabRelayClient,
    payload: CollabCreateInvitePayload,
  ): CollabInviteCreatedPayload {
    this.#cleanupExpiredInvites();

    const { session } = this.#requireAuthorizedHost(client, payload?.sessionId, payload?.hostSecret);
    if (!isInviteRole(payload.role)) {
      throw new CollabSignalingError("invalid-payload", "Ungültige Einladungsrolle: nur 'guest' oder 'collaborator' erlaubt.");
    }

    let inviteToken: string;
    if (typeof payload.inviteToken === "string" && payload.inviteToken.trim().length > 0) {
      const candidate = payload.inviteToken.trim();
      if (!INVITE_TOKEN_REGEX.test(candidate)) {
        throw new CollabSignalingError("invalid-payload", "Ungültiges Format für inviteToken.");
      }
      if (this.#invites.has(candidate)) {
        throw new CollabSignalingError("invalid-payload", "Das angegebene inviteToken existiert bereits.");
      }
      inviteToken = candidate;
    } else {
      inviteToken = createSecretToken();
      while (this.#invites.has(inviteToken)) {
        inviteToken = createSecretToken();
      }
    }

    let tokenProof: string | undefined;
    if (payload.tokenProof !== undefined) {
      if (typeof payload.tokenProof !== "string" || payload.tokenProof.length === 0 || payload.tokenProof.length > MAX_TOKEN_PROOF_LENGTH) {
        throw new CollabSignalingError("invalid-payload", "Ungültiger tokenProof.");
      }
      tokenProof = payload.tokenProof;
    }

    const requestedTtl = typeof payload.ttlMs === "number" && Number.isFinite(payload.ttlMs)
      ? Math.floor(payload.ttlMs)
      : this.#inviteTtlMs;
    const effectiveTtlMs = Math.max(MIN_INVITE_TTL_MS, Math.min(requestedTtl, this.#inviteTtlMs));
    const expiresAt = this.#now() + effectiveTtlMs;

    this.#invites.set(inviteToken, {
      inviteToken,
      sessionId: session.sessionId,
      role: payload.role,
      expiresAt,
      tokenProof,
      revoked: false,
    });

    const created: CollabInviteCreatedPayload = {
      sessionId: session.sessionId,
      inviteToken,
      role: payload.role,
      expiresAt,
      ...(tokenProof !== undefined ? { tokenProof } : {}),
    };
    client.send(COLLAB_EVENT_INVITE_CREATED, created);
    return created;
  }

  // Widerruft ein aktives Einladungs-Token vorzeitig (laufende P2P-Verbindungen bleiben aktiv)
  revokeInvite(
    client: CollabRelayClient,
    payload: CollabRevokeInvitePayload,
  ): CollabInviteRevokedPayload {
    this.#cleanupExpiredInvites();

    const { session } = this.#requireAuthorizedHost(client, payload?.sessionId, payload?.hostSecret);
    const token = typeof payload.inviteToken === "string" ? payload.inviteToken.trim() : "";
    if (token.length === 0) {
      throw new CollabSignalingError("invalid-payload", "inviteToken fehlt.");
    }

    const invite = this.#invites.get(token);
    if (!invite || invite.sessionId !== session.sessionId) {
      throw new CollabSignalingError("invite-invalid", "Einladungslink nicht gefunden.");
    }

    invite.revoked = true;
    const revokedPayload: CollabInviteRevokedPayload = {
      sessionId: session.sessionId,
      inviteToken: token,
    };
    client.send(COLLAB_EVENT_INVITE_REVOKED, revokedPayload);
    return revokedPayload;
  }

  // Löst ein gültiges 5-Minuten-Einladungs-Token ein (mehrfach gleichzeitig innerhalb TTL möglich, ohne Server-Secret)
  joinWithInvite(
    client: CollabRelayClient,
    payload: CollabJoinInvitePayload,
  ): CollabJoinedSessionPayload {
    const now = this.#now();

    if (this.#clientIndex.has(client)) {
      throw new CollabSignalingError("already-in-session", "Dieser Client ist bereits in einer Kollaborations-Session registriert.");
    }

    const token = typeof payload?.inviteToken === "string" ? payload.inviteToken.trim() : "";
    if (token.length === 0) {
      throw new CollabSignalingError("invite-invalid", "Fehlender Einladungslink.");
    }

    const invite = this.#invites.get(token);
    if (!invite) {
      throw new CollabSignalingError("invite-invalid", "Einladungslink ist ungültig oder unbekannt.");
    }
    if (invite.revoked) {
      throw new CollabSignalingError("invite-revoked", "Einladungslink wurde vom Host widerrufen.");
    }
    if (now >= invite.expiresAt) {
      this.#invites.delete(token);
      throw new CollabSignalingError("invite-expired", "Einladungslink ist abgelaufen.");
    }

    this.#cleanupExpiredInvites();

    const session = this.#sessions.get(invite.sessionId);
    if (!session) {
      this.#invites.delete(token);
      throw new CollabSignalingError("session-not-found", "Die zugehörige Kollaborations-Session ist nicht mehr aktiv.");
    }
    if (session.peers.size >= this.#maxPeersPerSession) {
      throw new CollabSignalingError("peer-limit-reached", "Die maximale Teilnehmerzahl dieser Session wurde erreicht.");
    }

    let peerId = createEphemeralId("peer");
    while (session.peers.has(peerId)) {
      peerId = createEphemeralId("peer");
    }
    const displayName = sanitizeDisplayName(payload.displayName);

    // Rolle wird ausschließlich aus dem serverseitigen Einladungs-Datensatz übernommen
    session.peers.set(peerId, {
      peerId,
      client,
      role: invite.role,
      displayName,
    });
    this.#clientIndex.set(client, {
      sessionId: session.sessionId,
      peerId,
    });

    const joinedPayload: CollabJoinedSessionPayload = {
      sessionId: session.sessionId,
      peerId,
      hostPeerId: session.hostPeerId,
      role: invite.role,
      inviteExpiresAt: invite.expiresAt,
    };
    client.send(COLLAB_EVENT_JOINED, joinedPayload);

    const hostPeer = session.peers.get(session.hostPeerId);
    if (hostPeer) {
      const peerJoinedPayload: CollabPeerJoinedPayload = {
        sessionId: session.sessionId,
        peerId,
        role: invite.role,
        inviteToken: invite.inviteToken,
        ...(invite.tokenProof !== undefined ? { tokenProof: invite.tokenProof } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
      };
      hostPeer.client.send(COLLAB_EVENT_PEER_JOINED, peerJoinedPayload);
    }

    return joinedPayload;
  }

  // Vermittelt SDP-/ICE-Nachrichten ausschließlich zwischen autorisierten Teilnehmern der Stern-Topologie
  relaySignal(
    client: CollabRelayClient,
    payload: CollabSignalForwardPayload,
  ): void {
    const registration = this.#requireRegistration(client);
    const session = this.#sessions.get(registration.sessionId);
    if (!session) {
      throw new CollabSignalingError("session-not-found", "Session nicht mehr aktiv.");
    }

    if (!payload || !isSignalType(payload.signalType) || typeof payload.targetPeerId !== "string") {
      throw new CollabSignalingError("invalid-payload", "Ungültiges Signaling-Payload.");
    }

    const targetPeerId = payload.targetPeerId.trim();
    if (targetPeerId.length === 0 || targetPeerId === registration.peerId) {
      throw new CollabSignalingError("invalid-payload", "Ungültiger targetPeerId.");
    }

    const targetPeer = session.peers.get(targetPeerId);
    if (!targetPeer) {
      throw new CollabSignalingError("peer-not-found", "Ziel-Teilnehmer wurde in dieser Session nicht gefunden.");
    }

    // Stern-Topologie erzwingen: Signaling findet nur zwischen Host und jeweiligem Peer statt
    const involvesHost = registration.peerId === session.hostPeerId || targetPeerId === session.hostPeerId;
    if (!involvesHost) {
      throw new CollabSignalingError("forbidden", "Direktes Signaling zwischen Nicht-Host-Teilnehmern ist nicht zulässig.");
    }

    const relayed: CollabSignalRelayedPayload = {
      sessionId: session.sessionId,
      fromPeerId: registration.peerId,
      signalType: payload.signalType,
      data: payload.data,
    };
    targetPeer.client.send(COLLAB_EVENT_SIGNAL_RELAYED, relayed);
  }

  // Überträgt das Host-Recht autorisiert an einen verbundenen Ziel-Peer (Kollaborateur oder Gast; Stern-Zentrum-Migration)
  transferHost(
    client: CollabRelayClient,
    payload: CollabTransferHostPayload,
  ): CollabHostChangedPayload {
    this.#cleanupExpiredInvites();

    const { session, hostPeer } = this.#requireAuthorizedHost(client, payload?.sessionId, payload?.hostSecret);
    const targetPeerId = typeof payload.targetPeerId === "string" ? payload.targetPeerId.trim() : "";
    if (targetPeerId.length === 0 || targetPeerId === session.hostPeerId) {
      throw new CollabSignalingError("invalid-payload", "Ungültiger Ziel-Teilnehmer für den Host-Wechsel.");
    }

    const targetPeer = session.peers.get(targetPeerId);
    if (!targetPeer) {
      throw new CollabSignalingError("peer-not-found", "Ziel-Teilnehmer für den Host-Wechsel nicht gefunden.");
    }

    const previousHostPeerId = session.hostPeerId;
    const nextHostSecret = createSecretToken();

    hostPeer.role = "collaborator";
    targetPeer.role = "host";
    session.hostPeerId = targetPeerId;
    session.hostSecret = nextHostSecret;

    // Alte Einladungslinks der Session ungültig machen, damit der neue Host eigene Links/Proofs ausstellt
    for (const invite of this.#invites.values()) {
      if (invite.sessionId === session.sessionId) {
        invite.revoked = true;
      }
    }

    const peerIdsForNewHost: string[] = [];
    const peersForNewHost: CollabHostChangedPeerInfo[] = [];
    for (const peer of session.peers.values()) {
      if (peer.peerId === targetPeerId) {
        continue;
      }
      peerIdsForNewHost.push(peer.peerId);
      peersForNewHost.push({
        peerId: peer.peerId,
        role: peer.role === "host" ? "collaborator" : peer.role,
        ...(peer.displayName !== undefined ? { displayName: peer.displayName } : {}),
      });
    }

    const newHostNotification: CollabHostChangedPayload = {
      sessionId: session.sessionId,
      previousHostPeerId,
      newHostPeerId: targetPeerId,
      hostSecret: nextHostSecret,
      peerIds: peerIdsForNewHost,
      peers: peersForNewHost,
    };
    const peerNotification: CollabHostChangedPayload = {
      sessionId: session.sessionId,
      previousHostPeerId,
      newHostPeerId: targetPeerId,
    };

    for (const peer of session.peers.values()) {
      if (peer.peerId === targetPeerId) {
        peer.client.send(COLLAB_EVENT_HOST_CHANGED, newHostNotification);
      } else {
        peer.client.send(COLLAB_EVENT_HOST_CHANGED, peerNotification);
      }
    }

    return peerNotification;
  }

  // Entfernt einen Teilnehmer autorisiert durch den aktuellen Host
  kickPeer(
    client: CollabRelayClient,
    payload: CollabKickPeerPayload,
  ): void {
    const { session } = this.#requireAuthorizedHost(client, payload?.sessionId, payload?.hostSecret);
    const targetPeerId = typeof payload.targetPeerId === "string" ? payload.targetPeerId.trim() : "";
    if (targetPeerId.length === 0 || targetPeerId === session.hostPeerId) {
      throw new CollabSignalingError("invalid-payload", "Ungültiger targetPeerId.");
    }

    const targetPeer = session.peers.get(targetPeerId);
    if (!targetPeer) {
      throw new CollabSignalingError("peer-not-found", "Teilnehmer nicht gefunden.");
    }

    session.peers.delete(targetPeerId);
    this.#clientIndex.delete(targetPeer.client);

    const reason = typeof payload.reason === "string" && payload.reason.trim().length > 0
      ? payload.reason.trim()
      : "kicked";

    const closedPayload: CollabSessionClosedPayload = {
      sessionId: session.sessionId,
      reason,
    };
    targetPeer.client.send(COLLAB_EVENT_SESSION_CLOSED, closedPayload);
    targetPeer.client.close?.(4003, reason);

    const leftPayload: CollabPeerLeftPayload = {
      sessionId: session.sessionId,
      peerId: targetPeerId,
      reason,
    };
    client.send(COLLAB_EVENT_PEER_LEFT, leftPayload);
  }

  // Beendet die gesamte Session explizit durch den aktuellen Host
  closeSession(
    client: CollabRelayClient,
    payload: CollabCloseSessionPayload,
  ): void {
    const { session } = this.#requireAuthorizedHost(client, payload?.sessionId, payload?.hostSecret);
    const reason = typeof payload.reason === "string" && payload.reason.trim().length > 0
      ? payload.reason.trim()
      : "host-closed";
    this.#destroySession(session, reason);
  }

  // Meldet den aktuellen Client sauber ab (beim Host endet die Session für alle Teilnehmer)
  leaveSession(client: CollabRelayClient, reason = "left"): void {
    const registration = this.#clientIndex.get(client);
    if (!registration) {
      return;
    }

    const session = this.#sessions.get(registration.sessionId);
    if (!session) {
      this.#clientIndex.delete(client);
      return;
    }

    if (registration.peerId === session.hostPeerId) {
      this.#destroySession(session, reason === "left" ? "host-left" : reason);
      return;
    }

    this.#clientIndex.delete(client);
    session.peers.delete(registration.peerId);

    const hostPeer = session.peers.get(session.hostPeerId);
    if (hostPeer) {
      const leftPayload: CollabPeerLeftPayload = {
        sessionId: session.sessionId,
        peerId: registration.peerId,
        reason,
      };
      hostPeer.client.send(COLLAB_EVENT_PEER_LEFT, leftPayload);
    }
  }

  // Bereinigt einen Client bei Socket-Abbruch
  disconnectClient(client: CollabRelayClient, reason = "disconnected"): void {
    this.leaveSession(client, reason);
  }

  getStatus(): CollabSignalingStatus {
    this.#cleanupExpiredInvites();
    let activePeers = 0;
    for (const session of this.#sessions.values()) {
      activePeers += session.peers.size;
    }
    let activeInvites = 0;
    for (const invite of this.#invites.values()) {
      if (!invite.revoked) {
        activeInvites += 1;
      }
    }
    return {
      activeSessions: this.#sessions.size,
      activePeers,
      activeInvites,
      authRequired: this.requiresAccessKey,
    };
  }

  #requireRegistration(client: CollabRelayClient): ClientRegistration {
    const registration = this.#clientIndex.get(client);
    if (!registration) {
      throw new CollabSignalingError("not-registered", "Client ist keiner aktiven Kollaborations-Session zugeordnet.");
    }
    return registration;
  }

  #requireAuthorizedHost(
    client: CollabRelayClient,
    sessionId: unknown,
    hostSecret: unknown,
  ): { session: CollabSessionRecord; hostPeer: CollabPeerRecord } {
    const registration = this.#requireRegistration(client);
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (normalizedSessionId.length === 0 || normalizedSessionId !== registration.sessionId) {
      throw new CollabSignalingError("session-not-found", "SessionID stimmt nicht mit der registrierten Session überein.");
    }

    const session = this.#sessions.get(normalizedSessionId);
    if (!session) {
      throw new CollabSignalingError("session-not-found", "Session wurde nicht gefunden.");
    }
    if (registration.peerId !== session.hostPeerId) {
      throw new CollabSignalingError("forbidden", "Nur der aktive Host darf diese Aktion ausführen.");
    }
    if (typeof hostSecret !== "string" || hostSecret.length === 0 || !constantTimeEquals(hostSecret, session.hostSecret)) {
      throw new CollabSignalingError("unauthorized", "Ungültiges Host-Secret.");
    }

    const hostPeer = session.peers.get(session.hostPeerId);
    if (!hostPeer) {
      throw new CollabSignalingError("session-not-found", "Host-Eintrag fehlt.");
    }
    return { session, hostPeer };
  }

  #destroySession(session: CollabSessionRecord, reason: string): void {
    this.#sessions.delete(session.sessionId);

    for (const [token, invite] of this.#invites.entries()) {
      if (invite.sessionId === session.sessionId) {
        this.#invites.delete(token);
      }
    }

    const closedPayload: CollabSessionClosedPayload = {
      sessionId: session.sessionId,
      reason,
    };

    for (const peer of session.peers.values()) {
      this.#clientIndex.delete(peer.client);
      peer.client.send(COLLAB_EVENT_SESSION_CLOSED, closedPayload);
    }
    session.peers.clear();
  }

  #cleanupExpiredInvites(): void {
    const now = this.#now();
    for (const [token, invite] of this.#invites.entries()) {
      if (now >= invite.expiresAt || !this.#sessions.has(invite.sessionId)) {
        this.#invites.delete(token);
      }
    }
  }
}

export default CollabSignalingRelay;
