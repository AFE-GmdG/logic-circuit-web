import type CollabRole from "./collabRole";
import type { CollabInviteRole } from "./collabRole";
import type { CollabPeerConnectionState } from "./transportState";

// Kontrollnachricht-Aktionen für Roster, Moderation, Hand-Heben und Autorisierungsfeedback
export const COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT = "roster-snapshot";
export const COLLAB_CONTROL_ACTION_ROSTER_REQUEST = "roster-request";
export const COLLAB_CONTROL_ACTION_ROLE_UPDATE = "role-update";
export const COLLAB_CONTROL_ACTION_RENAME_SELF = "rename-self";
export const COLLAB_CONTROL_ACTION_MODERATE_NAME = "moderate-name";
export const COLLAB_CONTROL_ACTION_HAND_STATE = "hand-state";
export const COLLAB_CONTROL_ACTION_ACTION_REJECTED = "action-rejected";

type CollabParticipant = {
  peerId: string;
  role: CollabRole;
  displayName: string;
  nameLocked: boolean;
  handRaised: boolean;
  connectionState: CollabPeerConnectionState;
  isSelf?: boolean;
};

export type CollabActiveInvite = {
  inviteToken: string;
  role: CollabInviteRole;
  url: string;
  createdAt: number;
  expiresAt: number;
  sidecarUrl?: string;
  isLocalhostSidecar: boolean;
};

export type ParsedCollabInviteLink = {
  inviteToken: string;
  sidecarUrl: string | null;
  isRemoteSidecar: boolean;
  isLocalhostSidecar: boolean;
  sidecarError: string | null;
};

export type CollabSessionClosedReason =
  | "kicked"
  | "host-closed"
  | "host-left"
  | "host-disconnected"
  | "session-closed"
  | string;

export type CollabSessionClosedEvent = {
  sessionId: string | null;
  reason: CollabSessionClosedReason;
  closeCode?: number;
};

export type CollabRosterSnapshotPayload = {
  participants: CollabParticipant[];
  revision: number;
};

export type CollabRoleUpdatePayload = {
  targetPeerId: string;
  role: CollabInviteRole;
};

export type CollabRenameSelfPayload = {
  displayName: string;
};

export type CollabModerateNamePayload = {
  targetPeerId: string;
  displayName?: string;
  nameLocked?: boolean;
};

export type CollabHandStatePayload = {
  raised: boolean;
  targetPeerId?: string;
};

export type CollabActionRejectionCode =
  | "unknown-peer"
  | "unauthorized-role"
  | "host-only"
  | "name-locked"
  | "invalid-display-name"
  | "invalid-payload";

export type CollabActionRejectedPayload = {
  action: string;
  code: CollabActionRejectionCode;
  message: string;
  targetPeerId?: string;
};

export type CollabSessionControlMessage =
  | {
    kind: "control";
    action: typeof COLLAB_CONTROL_ACTION_ROSTER_SNAPSHOT;
    payload: CollabRosterSnapshotPayload;
  }
  | {
    kind: "control";
    action: typeof COLLAB_CONTROL_ACTION_ROSTER_REQUEST;
    payload?: Record<string, never>;
  }
  | {
    kind: "control";
    action: typeof COLLAB_CONTROL_ACTION_ROLE_UPDATE;
    payload: CollabRoleUpdatePayload;
  }
  | {
    kind: "control";
    action: typeof COLLAB_CONTROL_ACTION_RENAME_SELF;
    payload: CollabRenameSelfPayload;
  }
  | {
    kind: "control";
    action: typeof COLLAB_CONTROL_ACTION_MODERATE_NAME;
    payload: CollabModerateNamePayload;
  }
  | {
    kind: "control";
    action: typeof COLLAB_CONTROL_ACTION_HAND_STATE;
    payload: CollabHandStatePayload;
  }
  | {
    kind: "control";
    action: typeof COLLAB_CONTROL_ACTION_ACTION_REJECTED;
    payload: CollabActionRejectedPayload;
  };

export default CollabParticipant;
