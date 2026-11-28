// App-Topics und typisierte Präsenz-Payloads (bewusst ohne Farben, da Teilnehmerfarben rein lokal verwaltet werden)
export const COLLAB_APP_TOPIC_PRESENCE_STATE = "presence-state" as const;
export const COLLAB_APP_TOPIC_PRESENCE_CURSOR = "presence-cursor" as const;
export const COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT = "presence-snapshot" as const;

export const MAX_PRESENCE_SELECTION_IDS = 500;
export const MAX_PRESENCE_ID_LENGTH = 128;
export const MAX_PRESENCE_SNAPSHOT_ENTRIES = 128;

export type CollabPresenceSelection = {
  symbolIds: string[];
  textNoteIds: string[];
  wireIds: string[];
};

export type CollabPresenceOpenDialogKind = "symbol-properties" | "text-note" | "circuit-properties";

export type CollabPresenceOpenDialog = {
  kind: CollabPresenceOpenDialogKind;
  targetId: string;
  logicalCircuitId: string;
};

export type CollabPresenceViewport = {
  centerX: number;
  centerY: number;
  zoom: number;
};

export type CollabPresenceCursorPosition = {
  x: number;
  y: number;
  logicalCircuitId?: string | null;
};

export type CollabPresenceStatePayload = {
  peerId?: string;
  logicalCircuitId: string | null;
  inLibraryMode: boolean;
  selection?: CollabPresenceSelection;
  openDialog?: CollabPresenceOpenDialog | null;
  viewport?: CollabPresenceViewport | null;
};

export type CollabPresenceCursorPayload =
  | {
    peerId?: string;
    visible?: true;
    x: number;
    y: number;
    logicalCircuitId?: string | null;
  }
  | {
    peerId?: string;
    visible: false;
    logicalCircuitId?: string | null;
  };

export type CollabPresencePeerSnapshotEntry = {
  peerId: string;
  logicalCircuitId: string | null;
  inLibraryMode: boolean;
  selection: CollabPresenceSelection;
  openDialog: CollabPresenceOpenDialog | null;
  viewport: CollabPresenceViewport | null;
  cursor: CollabPresenceCursorPosition | null;
};

export type CollabPresenceSnapshotPayload = {
  entries: CollabPresencePeerSnapshotEntry[];
};

type CollabPresenceMessage =
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_PRESENCE_STATE;
    payload: CollabPresenceStatePayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_PRESENCE_CURSOR;
    payload: CollabPresenceCursorPayload;
    messageId?: string;
  }
  | {
    kind: "app";
    topic: typeof COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT;
    payload: CollabPresenceSnapshotPayload;
    messageId?: string;
  };

export default CollabPresenceMessage;
