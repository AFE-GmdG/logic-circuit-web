// Verbindungszustände des P2P-Session-Transports und einzelner Peer-Verbindungen
type CollabTransportState =
  | "idle"
  | "connecting"
  | "connected"
  | "degraded"
  | "reconnecting"
  | "migrating-host"
  | "failed"
  | "disconnected";

export type CollabPeerConnectionState =
  | "connecting"
  | "connected"
  | "degraded"
  | "reconnecting"
  | "failed"
  | "disconnected";

export default CollabTransportState;
