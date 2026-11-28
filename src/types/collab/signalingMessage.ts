import type { CollabInviteRole } from "./collabRole.ts";

export type CollabSignalType = "offer" | "answer" | "ice-candidate";

export type CollabSignalingErrorCode =
  | "unauthorized"
  | "invalid-payload"
  | "session-not-found"
  | "session-limit-reached"
  | "peer-limit-reached"
  | "invite-invalid"
  | "invite-expired"
  | "invite-revoked"
  | "peer-not-found"
  | "forbidden"
  | "not-registered"
  | "already-in-session"
  | "hello-timeout";

// Client -> Server Payloads

export type CollabCreateSessionPayload = {
  accessKey?: string;
  displayName?: string;
};

export type CollabCloseSessionPayload = {
  sessionId: string;
  hostSecret: string;
  reason?: string;
};

export type CollabCreateInvitePayload = {
  sessionId: string;
  hostSecret: string;
  role: CollabInviteRole;
  inviteToken?: string;
  ttlMs?: number;
  tokenProof?: string;
};

export type CollabRevokeInvitePayload = {
  sessionId: string;
  hostSecret: string;
  inviteToken: string;
};

export type CollabJoinInvitePayload = {
  inviteToken: string;
  displayName?: string;
};

export type CollabLeaveSessionPayload = {
  reason?: string;
};

export type CollabSignalForwardPayload = {
  targetPeerId: string;
  signalType: CollabSignalType;
  data: unknown;
};

export type CollabTransferHostPayload = {
  sessionId: string;
  hostSecret: string;
  targetPeerId: string;
};

export type CollabKickPeerPayload = {
  sessionId: string;
  hostSecret: string;
  targetPeerId: string;
  reason?: string;
};

// Server -> Client Payloads

export type CollabSessionCreatedPayload = {
  sessionId: string;
  peerId: string;
  hostSecret: string;
  role: "host";
  inviteTtlMs: number;
};

export type CollabInviteCreatedPayload = {
  sessionId: string;
  inviteToken: string;
  role: CollabInviteRole;
  expiresAt: number;
  tokenProof?: string;
};

export type CollabInviteRevokedPayload = {
  sessionId: string;
  inviteToken: string;
};

export type CollabJoinedSessionPayload = {
  sessionId: string;
  peerId: string;
  hostPeerId: string;
  role: CollabInviteRole;
  inviteExpiresAt: number;
};

export type CollabPeerJoinedPayload = {
  sessionId: string;
  peerId: string;
  role: CollabInviteRole;
  inviteToken: string;
  tokenProof?: string;
  displayName?: string;
};

export type CollabPeerLeftPayload = {
  sessionId: string;
  peerId: string;
  reason?: string;
};

export type CollabSignalRelayedPayload = {
  sessionId: string;
  fromPeerId: string;
  signalType: CollabSignalType;
  data: unknown;
};

export type CollabHostChangedPeerInfo = {
  peerId: string;
  role: CollabInviteRole;
  displayName?: string;
};

export type CollabHostChangedPayload = {
  sessionId: string;
  previousHostPeerId: string;
  newHostPeerId: string;
  hostSecret?: string;
  peerIds?: string[];
  peers?: CollabHostChangedPeerInfo[];
};

export type CollabSessionClosedPayload = {
  sessionId: string;
  reason: string;
};

export type CollabSignalingErrorPayload = {
  code: CollabSignalingErrorCode;
  message: string;
};

// Gemeinsamer WebSocket-Envelope für alle Signaling-Nachrichten
type CollabSignalingEnvelope<TPayload = unknown> = {
  event: string;
  payload?: TPayload;
};

export default CollabSignalingEnvelope;
