import React from "react";

import type { CollabInviteRole } from "../../types/collab/collabRole";
import type {
  CollabCommitOrigin,
  CollabSoftLockEntry,
  CollabSoftLockReason,
  CollabSoftLockTargetType,
} from "../../types/collab/modelSyncMessage";
import type { CollabPresenceCursorPosition } from "../../types/collab/presenceMessage";
import type { CollabActiveInvite } from "../../types/collab/sessionState";

import type { CollabModelSyncState } from "../../collab/collabModelSyncController";
import type {
  CollabLocalPresenceInput,
  CollabPresenceCursorMap,
  CollabPresenceState,
} from "../../collab/collabPresenceController";
import {
  type CollabSessionControllerState,
  type JoinCollabSessionInput,
  type ModerateParticipantNameInput,
  type StartHostSessionInput,
} from "../../collab/collabSessionController";
import type { CollabSoftLockAcquireResult, CollabSoftLockTarget } from "../../collab/collabSoftLockManager";
import type { ResyncConfirmationContext } from "../../collab/p2pSessionTransport";
import type { CollabParticipantColorMap } from "../../utils/collabParticipantColors";

export type CollabContextType = CollabSessionControllerState & {
  startHostSession: (input: StartHostSessionInput) => Promise<boolean>;
  joinSession: (input: JoinCollabSessionInput) => Promise<boolean>;
  endOrLeaveSession: (reason?: string) => void;
  createInviteLink: (role: CollabInviteRole, ttlMs?: number) => Promise<CollabActiveInvite | null>;
  revokeInviteLink: (inviteToken: string) => Promise<boolean>;
  setParticipantRole: (targetPeerId: string, role: CollabInviteRole) => Promise<boolean>;
  moderateParticipantName: (targetPeerId: string, update: ModerateParticipantNameInput) => Promise<boolean>;
  renameSelf: (newName: string) => Promise<boolean>;
  toggleHandRaised: (raised?: boolean) => Promise<boolean>;
  lowerParticipantHand: (targetPeerId: string) => Promise<boolean>;
  kickParticipant: (targetPeerId: string, reason?: string) => Promise<boolean>;
  transferHostRole: (targetPeerId: string) => boolean;
  requestResync: () => Promise<boolean>;
  setParticipantsPanelOpen: (open: boolean) => void;
  clearPendingInviteLink: () => void;
  clearError: () => void;
  dismissSessionClosedNotice: () => void;
  modelSyncState?: CollabModelSyncState;
  softLockBlockedNotice?: CollabSoftLockEntry | null;
  reportSoftLockBlocked?: (lock: CollabSoftLockEntry) => void;
  clearSoftLockBlockedNotice?: () => void;
  clearSyncRejection?: () => void;
  clearUndoConflict?: () => void;
  setHostProjectLoading?: (loading: boolean) => void;
  acquireSoftLocks?: (
    targets: ReadonlyArray<CollabSoftLockTarget>,
    reason: CollabSoftLockReason,
  ) => CollabSoftLockAcquireResult;
  renewSoftLocks?: (
    targets?: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>,
  ) => CollabSoftLockEntry[];
  releaseSoftLocks?: (
    targets?: ReadonlyArray<{ targetType: CollabSoftLockTargetType; targetId: string }>,
  ) => CollabSoftLockEntry[];
  getForeignSoftLocks?: () => CollabSoftLockEntry[];
  getForeignLockForTarget?: (
    targetType: CollabSoftLockTargetType,
    targetId: string,
  ) => CollabSoftLockEntry | null;
  registerResyncConfirmHandler?: (
    handler: ((context: ResyncConfirmationContext) => Promise<boolean> | boolean) | null,
  ) => void;
  runWithMutationOrigin?: <T>(origin: CollabCommitOrigin, fn: () => T) => T;
  presenceState?: CollabPresenceState;
  participantColors?: CollabParticipantColorMap;
  getParticipantColor?: (peerId: string, fallbackDisplayName?: string) => string;
  setParticipantColor?: (peerId: string, color: string) => boolean;
  reloadParticipantColors?: () => void;
  updateLocalPresenceState?: (patch: Partial<CollabLocalPresenceInput>) => void;
  updateLocalPresenceCursor?: (cursor: CollabPresenceCursorPosition | null) => void;
  getRemoteCursors?: () => CollabPresenceCursorMap;
  subscribeRemoteCursors?: (listener: (cursors: CollabPresenceCursorMap) => void) => () => void;
  followingPeerId?: string | null;
  startFollowingPeer?: (peerId: string) => boolean;
  stopFollowingPeer?: () => void;
  jumpToParticipant?: (peerId: string) => boolean;
};

const CollabContext = React.createContext<CollabContextType | undefined>(undefined);

export default CollabContext;
