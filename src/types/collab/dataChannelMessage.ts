// Protokoll-Konstanten und typisierte Nachrichten- sowie Wire-Frame-Strukturen für den WebRTC-DataChannel

export const DATA_CHANNEL_PROTOCOL_VERSION = 1;
export const DEFAULT_DATA_CHANNEL_LABEL = "logic-circuit-collab";
export const DEFAULT_MAX_CHUNK_PAYLOAD_BYTES = 16 * 1024;
export const DEFAULT_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_CONCURRENT_TRANSFERS = 8;
export const DEFAULT_REASSEMBLY_TIMEOUT_MS = 30000;
export const DEFAULT_BACKPRESSURE_HIGH_WATER_BYTES = 256 * 1024;
export const DEFAULT_BACKPRESSURE_LOW_WATER_BYTES = 64 * 1024;

export type CollabHeartbeatPingMessage = {
  kind: "heartbeat-ping";
  seq: number;
  sentAt: number;
};

export type CollabHeartbeatPongMessage = {
  kind: "heartbeat-pong";
  seq: number;
  sentAt: number;
  receivedAt: number;
};

export type CollabResyncReason = "manual" | "reconnected" | "revision-gap" | "conflict";

export type CollabResyncRequestMessage = {
  kind: "resync-request";
  reason: CollabResyncReason;
  fromRevision?: number;
  hasUnconfirmedLocalChanges?: boolean;
};

export type CollabResyncRequiredMessage = {
  kind: "resync-required";
  reason: string;
  hostRevision?: number;
};

export type CollabControlMessage = {
  kind: "control";
  action: string;
  payload?: unknown;
};

export type CollabAppMessage = {
  kind: "app";
  topic: string;
  payload: unknown;
  messageId?: string;
};

type CollabDataChannelMessage =
  | CollabHeartbeatPingMessage
  | CollabHeartbeatPongMessage
  | CollabResyncRequestMessage
  | CollabResyncRequiredMessage
  | CollabControlMessage
  | CollabAppMessage;

export type CollabSingleWireFrame = {
  v: typeof DATA_CHANNEL_PROTOCOL_VERSION;
  frame: "single";
  message: CollabDataChannelMessage;
};

export type CollabChunkWireFrame = {
  v: typeof DATA_CHANNEL_PROTOCOL_VERSION;
  frame: "chunk";
  transferId: string;
  chunkIndex: number;
  totalChunks: number;
  totalBytes: number;
  checksum: string;
  data: string;
};

export type CollabChunkAbortWireFrame = {
  v: typeof DATA_CHANNEL_PROTOCOL_VERSION;
  frame: "chunk-abort";
  transferId: string;
  reason: string;
};

export type CollabWireFrame =
  | CollabSingleWireFrame
  | CollabChunkWireFrame
  | CollabChunkAbortWireFrame;

export default CollabDataChannelMessage;
