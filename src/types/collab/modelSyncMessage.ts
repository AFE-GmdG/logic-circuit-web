import type GridPoint from "../canvas/gridPoint";
import type CircuitShape from "../circuit/circuitShape";
import type DisplayMargin from "../circuit/displayMargin";
import type ProjectPropertiesUpdate from "../circuit/projectPropertiesUpdate";
import type Rotation from "../circuit/rotation";
import type RotationDirection from "../circuit/rotationDirection";
import type WireEndpointUpdate from "../circuit/wireEndpointUpdate";
import type NativeProjectDocument from "../storage/nativeProjectFormat";
import type {
  NativeCircuitElement,
  NativeLogicalCircuit,
  NativePinElement,
  NativeTextNote,
  NativeWire,
} from "../storage/nativeProjectFormat";

// App-Topics für das Echtzeit-Synchronisationsprotokoll des Schaltungsmodells
export const COLLAB_APP_TOPIC_PROJECT_SNAPSHOT = "project-snapshot" as const;
export const COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST = "circuit-mutation-request" as const;
export const COLLAB_APP_TOPIC_CIRCUIT_COMMIT = "circuit-commit" as const;
export const COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED = "circuit-mutation-rejected" as const;
export const COLLAB_APP_TOPIC_CATCHUP_RESPONSE = "catchup-response" as const;
export const COLLAB_APP_TOPIC_SOFT_LOCK = "soft-lock" as const;
export const COLLAB_APP_TOPIC_HOST_HANDOVER_STATE = "host-handover-state" as const;
export const COLLAB_APP_TOPIC_HOST_HANDOVER_READY = "host-handover-ready" as const;
export const COLLAB_APP_TOPIC_SESSION_QUIESCE = "session-quiesce" as const;

export type CollabCommitOrigin = "user" | "mcp";
export type CollabQuiesceReason = "host-handover" | "project-loading";

export type CollabSessionQuiescePayload = {
  quiesced: boolean;
  reason?: CollabQuiesceReason;
};

export type CollabHighlightIds = {
  symbolIds: string[];
  textNoteIds: string[];
  wireIds: string[];
};

export type CollabMutationRejectionCode =
  | "conflict"
  | "id-collision"
  | "missing-target"
  | "invalid-mutation"
  | "quiesced"
  | "unauthorized"
  | "stale-revision";

export type CollabSoftLockTargetType = "symbol" | "textNote" | "logicalCircuit";
export type CollabSoftLockAction = "acquire" | "renew" | "release" | "snapshot";
export type CollabSoftLockReason = "drag" | "property-dialog" | "text-note-dialog";

export type CollabSoftLockEntry = {
  lockId: string;
  targetType: CollabSoftLockTargetType;
  targetId: string;
  logicalCircuitId: string;
  ownerPeerId: string;
  ownerDisplayName: string;
  reason: CollabSoftLockReason;
  acquiredAt: number;
  expiresAt: number;
};

export type CollabSerializedEntityBundle = {
  logicalCircuitId: string;
  pins: NativePinElement[];
  elements: NativeCircuitElement[];
  wires: NativeWire[];
  textNotes: NativeTextNote[];
};

export type CollabSerializedLogicalCircuitProps = {
  name: string;
  notation: string;
  category: string;
  note: string;
  circuitShape?: CircuitShape;
  showLabelAbove?: boolean;
  displayMargin?: DisplayMargin;
  exportToHDL?: boolean;
  validators?: string;
  pinOrder?: { pinId: string; index: number }[];
};

// Verlustfrei JSON-serialisierbare Mutations-Union für alle Schaltungs-, Schaltplan-, Projekt-, Library- und Memory-Änderungen
export type CollabSerializedMutation =
  | {
    type: "add";
    logicalCircuitId: string;
    entities: CollabSerializedEntityBundle;
    importedSubCircuits?: NativeLogicalCircuit[];
  }
  | {
    type: "remove";
    logicalCircuitId: string;
    symbolIds: string[];
    textNoteIds: string[];
    wireIds: string[];
  }
  | {
    type: "move";
    logicalCircuitId: string;
    symbolIds: string[];
    textNoteIds: string[];
    wireIds?: string[];
    dx: number;
    dy: number;
    symbolPositions?: { symbolId: string; before: GridPoint; after: GridPoint }[];
    textNotePositions?: { textNoteId: string; before: GridPoint; after: GridPoint }[];
    wireChanges?: WireEndpointUpdate[];
    removedWireIds?: string[];
    addedWires?: NativeWire[];
  }
  | {
    type: "rotate";
    logicalCircuitId: string;
    direction: RotationDirection;
    symbols: {
      symbolId: string;
      before: { x: number; y: number; rotation: Rotation };
      after: { x: number; y: number; rotation: Rotation };
    }[];
    textNotes: {
      textNoteId: string;
      before: { x: number; y: number; rotation: Rotation };
      after: { x: number; y: number; rotation: Rotation };
    }[];
    wireChanges?: WireEndpointUpdate[];
    removedWireIds?: string[];
    addedWires?: NativeWire[];
  }
  | {
    type: "wireBatch";
    logicalCircuitId: string;
    addedWires: NativeWire[];
    removedWireIds: string[];
    updatedWires: WireEndpointUpdate[];
  }
  | {
    type: "updateProperty";
    logicalCircuitId: string;
    targetType: "symbol" | "textNote" | "logicalCircuit";
    targetId: string;
    afterPin?: NativePinElement;
    afterElement?: NativeCircuitElement;
    afterTextNote?: NativeTextNote;
    afterLogicalCircuit?: CollabSerializedLogicalCircuitProps;
    wireChanges?: WireEndpointUpdate[];
    removedWireIds?: string[];
    addedWires?: NativeWire[];
  }
  | {
    type: "createCircuits";
    circuits: NativeLogicalCircuit[];
  }
  | {
    type: "deleteCircuits";
    circuitIds: string[];
  }
  | {
    type: "updateProjectProperties";
    updates: ProjectPropertiesUpdate;
  }
  | {
    type: "importLibraryCircuit";
    addedCircuits: NativeLogicalCircuit[];
    targetCircuitId?: string;
    placedElement?: NativeCircuitElement;
  }
  | {
    type: "updateMemoryData";
    updates: { memoryId: string; data: string }[];
  };

export type CollabRevisionEntry = {
  revision: number;
  mutationId: string;
  authorPeerId: string;
  timestamp: number;
  origin: CollabCommitOrigin;
  mutation: CollabSerializedMutation;
  highlightIds?: CollabHighlightIds;
};

export type CollabProjectSnapshotPayload = {
  revision: number;
  epochId: string;
  reason: "initial" | "resync" | "project-switch";
  document: NativeProjectDocument;
};

export type CollabMutationRequestPayload = {
  mutationId: string;
  baseRevision: number;
  mutation: CollabSerializedMutation;
  origin?: CollabCommitOrigin;
  highlightIds?: CollabHighlightIds;
};

export type CollabCircuitCommitPayload = CollabRevisionEntry;

export type CollabMutationRejectedPayload = {
  mutationId: string;
  code: CollabMutationRejectionCode;
  message: string;
  hostRevision: number;
  requiresResync: boolean;
  conflictingEntityIds?: string[];
};

export type CollabCatchupResponsePayload = {
  fromRevision: number;
  toRevision: number;
  entries: CollabRevisionEntry[];
  requiresFullSnapshot: boolean;
};

export type CollabSoftLockPayload = {
  action: CollabSoftLockAction;
  locks: CollabSoftLockEntry[];
  senderPeerId?: string;
};

export type CollabHostHandoverStatePayload = {
  revision: number;
  epochId: string;
  ringBuffer: CollabRevisionEntry[];
  snapshot?: NativeProjectDocument;
  snapshotChecksum?: string;
};

export type CollabHostHandoverReadyPayload = {
  targetPeerId: string;
  acceptedRevision: number;
  ok: boolean;
  reason?: string;
};

type CollabModelSyncMessage =
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_PROJECT_SNAPSHOT;
    payload: CollabProjectSnapshotPayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST;
    payload: CollabMutationRequestPayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_CIRCUIT_COMMIT;
    payload: CollabCircuitCommitPayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED;
    payload: CollabMutationRejectedPayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_CATCHUP_RESPONSE;
    payload: CollabCatchupResponsePayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_SOFT_LOCK;
    payload: CollabSoftLockPayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_HOST_HANDOVER_STATE;
    payload: CollabHostHandoverStatePayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_HOST_HANDOVER_READY;
    payload: CollabHostHandoverReadyPayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_SESSION_QUIESCE;
    payload: CollabSessionQuiescePayload;
    messageId?: string;
  };

export default CollabModelSyncMessage;
