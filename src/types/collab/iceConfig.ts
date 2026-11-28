// ICE-/STUN-Server-Eintrag sowie öffentliche Laufzeitkonfiguration für WebRTC (ohne TURN in Ausbaustufe 1)
type CollabIceServer = {
  urls: string | string[];
};

export type CollabRuntimeConfig = {
  stunUrls: string[];
  inviteTtlMs: number;
  gracePeriodMs: number;
  authRequired: boolean;
  maxPeersPerSession: number;
  serverVersion?: string;
};

export type CollabNatDiagnosticCode =
  | "none"
  | "connecting"
  | "stun-unreachable"
  | "symmetric-nat-or-udp-blocked"
  | "host-migration-unreachable"
  | "signaling-unavailable";

export default CollabIceServer;
