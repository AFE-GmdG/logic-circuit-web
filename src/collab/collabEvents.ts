// Gemeinsame Kanal-Bezeichner, Pfade und Standardwerte für das WebRTC-Signaling-Relay

export const COLLAB_HTTP_BASE_PATH = "/__collab";
export const COLLAB_CONFIG_PATH = `${COLLAB_HTTP_BASE_PATH}/config`;
export const COLLAB_WS_PATH = "/ws-collab";

export const DEFAULT_COLLAB_INVITE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_COLLAB_GRACE_PERIOD_MS = 15 * 1000;

export const DEFAULT_COLLAB_STUN_URLS: readonly string[] = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];

// Client -> Server Signaling-Events
export const COLLAB_EVENT_CREATE_SESSION = "logic-circuit:collab-create-session";
export const COLLAB_EVENT_CLOSE_SESSION = "logic-circuit:collab-close-session";
export const COLLAB_EVENT_CREATE_INVITE = "logic-circuit:collab-create-invite";
export const COLLAB_EVENT_REVOKE_INVITE = "logic-circuit:collab-revoke-invite";
export const COLLAB_EVENT_JOIN_INVITE = "logic-circuit:collab-join-invite";
export const COLLAB_EVENT_LEAVE = "logic-circuit:collab-leave";
export const COLLAB_EVENT_SIGNAL = "logic-circuit:collab-signal";
export const COLLAB_EVENT_TRANSFER_HOST = "logic-circuit:collab-transfer-host";
export const COLLAB_EVENT_KICK_PEER = "logic-circuit:collab-kick-peer";
export const COLLAB_EVENT_PING = "logic-circuit:collab-ping";

// Server -> Client Signaling-Events
export const COLLAB_EVENT_SESSION_CREATED = "logic-circuit:collab-session-created";
export const COLLAB_EVENT_INVITE_CREATED = "logic-circuit:collab-invite-created";
export const COLLAB_EVENT_INVITE_REVOKED = "logic-circuit:collab-invite-revoked";
export const COLLAB_EVENT_JOINED = "logic-circuit:collab-joined";
export const COLLAB_EVENT_PEER_JOINED = "logic-circuit:collab-peer-joined";
export const COLLAB_EVENT_PEER_LEFT = "logic-circuit:collab-peer-left";
export const COLLAB_EVENT_SIGNAL_RELAYED = "logic-circuit:collab-signal-relayed";
export const COLLAB_EVENT_HOST_CHANGED = "logic-circuit:collab-host-changed";
export const COLLAB_EVENT_SESSION_CLOSED = "logic-circuit:collab-session-closed";
export const COLLAB_EVENT_PONG = "logic-circuit:collab-pong";
export const COLLAB_EVENT_ERROR = "logic-circuit:collab-error";
