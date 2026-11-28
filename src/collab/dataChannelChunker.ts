import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import {
  type CollabChunkAbortWireFrame,
  type CollabChunkWireFrame,
  type CollabSingleWireFrame,
  DATA_CHANNEL_PROTOCOL_VERSION,
  DEFAULT_MAX_CHUNK_PAYLOAD_BYTES,
  DEFAULT_MAX_CONCURRENT_TRANSFERS,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_REASSEMBLY_TIMEOUT_MS,
} from "../types/collab/dataChannelMessage";

export type DataChannelChunkErrorCode =
  | "payload-too-large"
  | "invalid-frame"
  | "too-many-transfers"
  | "chunk-out-of-range"
  | "duplicate-chunk"
  | "checksum-mismatch"
  | "size-mismatch"
  | "transfer-timeout"
  | "transfer-aborted";

export class DataChannelChunkError extends Error {
  readonly code: DataChannelChunkErrorCode;

  constructor(code: DataChannelChunkErrorCode, message: string) {
    super(message);
    this.name = "DataChannelChunkError";
    this.code = code;
  }
}

export type DataChannelChunkerOptions = {
  maxChunkPayloadBytes?: number;
  maxMessageBytes?: number;
  maxConcurrentTransfers?: number;
  reassemblyTimeoutMs?: number;
  now?: () => number;
};

export type EncodedDataChannelTransfer = {
  transferId: string | null;
  frames: string[];
  totalBytes: number;
  isChunked: boolean;
};

export type ReassemblyResult =
  | {
    completed: true;
    message: CollabDataChannelMessage;
    transferId: string | null;
    totalBytes: number;
  }
  | {
    completed: false;
    transferId: string;
    receivedChunks: number;
    totalChunks: number;
    aborted?: boolean;
  };

type InboundTransferState = {
  transferId: string;
  totalChunks: number;
  totalBytes: number;
  checksum: string;
  chunks: Array<string | undefined>;
  receivedCount: number;
  accumulatedBytes: number;
  lastChunkAt: number;
};

const utf8Encoder = new TextEncoder();

// Ermittelt die exakte UTF-8-Byte-Länge einer Zeichenkette für SCTP-Größenlimits
export function getUtf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).byteLength;
}

// Berechnet eine deterministische 32-Bit-FNV-1a-Prüfsumme über UTF-8-Bytes als Hex-String
export function computePayloadChecksum(text: string): string {
  const bytes = utf8Encoder.encode(text);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getUtf8CharBytes(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

// Teilt eine Zeichenkette UTF-8-bytegenau auf, ohne Mehrbyte-Sequenzen oder Surrogate-Pairs zu zerschneiden
function splitStringByUtf8Bytes(text: string, maxChunkBytes: number): string[] {
  const chunks: string[] = [];
  let startIndex = 0;
  let currentBytes = 0;
  let index = 0;

  while (index < text.length) {
    const codePoint = text.codePointAt(index) ?? 0;
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    const charBytes = getUtf8CharBytes(codePoint);

    if (currentBytes > 0 && currentBytes + charBytes > maxChunkBytes) {
      chunks.push(text.slice(startIndex, index));
      startIndex = index;
      currentBytes = 0;
    }

    currentBytes += charBytes;
    index += codeUnits;
  }

  if (startIndex < text.length || chunks.length === 0) {
    chunks.push(text.slice(startIndex));
  }

  return chunks;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidResyncReason(value: unknown): boolean {
  return value === "manual" || value === "reconnected" || value === "revision-gap" || value === "conflict";
}

function isValidDataChannelMessage(value: unknown): value is CollabDataChannelMessage {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  switch (value.kind) {
    case "heartbeat-ping":
      return typeof value.seq === "number" && Number.isFinite(value.seq) &&
        typeof value.sentAt === "number" && Number.isFinite(value.sentAt);
    case "heartbeat-pong":
      return typeof value.seq === "number" && Number.isFinite(value.seq) &&
        typeof value.sentAt === "number" && Number.isFinite(value.sentAt) &&
        typeof value.receivedAt === "number" && Number.isFinite(value.receivedAt);
    case "resync-request":
      return isValidResyncReason(value.reason) &&
        (value.fromRevision === undefined || (typeof value.fromRevision === "number" && Number.isFinite(value.fromRevision))) &&
        (value.hasUnconfirmedLocalChanges === undefined || typeof value.hasUnconfirmedLocalChanges === "boolean");
    case "resync-required":
      return typeof value.reason === "string" &&
        (value.hostRevision === undefined || (typeof value.hostRevision === "number" && Number.isFinite(value.hostRevision)));
    case "control":
      return typeof value.action === "string" && value.action.length > 0;
    case "app":
      return typeof value.topic === "string" && value.topic.length > 0 && "payload" in value &&
        (value.messageId === undefined || typeof value.messageId === "string");
    default:
      return false;
  }
}

function createTransferId(counter: number): string {
  const randomBytes = new Uint8Array(6);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(randomBytes);
  }
  const hex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `tr-${counter}-${hex}`;
}

// Fragmentiert große DataChannel-Nachrichten unterhalb browserseitiger SCTP-Limits und setzt sie mit Integritätsschutz wieder zusammen
class DataChannelChunker {
  readonly #maxChunkPayloadBytes: number;
  readonly #maxMessageBytes: number;
  readonly #maxConcurrentTransfers: number;
  readonly #reassemblyTimeoutMs: number;
  readonly #now: () => number;
  readonly #inFlight = new Map<string, InboundTransferState>();
  #nextTransferSeq = 1;

  constructor(options: DataChannelChunkerOptions = {}) {
    this.#maxChunkPayloadBytes = Math.max(256, Math.floor(options.maxChunkPayloadBytes ?? DEFAULT_MAX_CHUNK_PAYLOAD_BYTES));
    this.#maxMessageBytes = Math.max(this.#maxChunkPayloadBytes, Math.floor(options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES));
    this.#maxConcurrentTransfers = Math.max(1, Math.floor(options.maxConcurrentTransfers ?? DEFAULT_MAX_CONCURRENT_TRANSFERS));
    this.#reassemblyTimeoutMs = Math.max(1000, Math.floor(options.reassemblyTimeoutMs ?? DEFAULT_REASSEMBLY_TIMEOUT_MS));
    this.#now = options.now ?? (() => Date.now());
  }

  get maxChunkPayloadBytes(): number {
    return this.#maxChunkPayloadBytes;
  }

  get maxMessageBytes(): number {
    return this.#maxMessageBytes;
  }

  get activeTransferCount(): number {
    return this.#inFlight.size;
  }

  encodeMessage(message: CollabDataChannelMessage): EncodedDataChannelTransfer {
    const serializedPayload = JSON.stringify(message);
    if (typeof serializedPayload !== "string") {
      throw new DataChannelChunkError("invalid-frame", "Nachricht konnte nicht zu JSON serialisiert werden.");
    }

    const totalBytes = getUtf8ByteLength(serializedPayload);
    if (totalBytes > this.#maxMessageBytes) {
      throw new DataChannelChunkError(
        "payload-too-large",
        `Nachricht (${totalBytes} Bytes) überschreitet das Limit von ${this.#maxMessageBytes} Bytes.`,
      );
    }

    const singleFrame: CollabSingleWireFrame = {
      v: DATA_CHANNEL_PROTOCOL_VERSION,
      frame: "single",
      message,
    };
    const singleSerialized = JSON.stringify(singleFrame);
    if (getUtf8ByteLength(singleSerialized) <= this.#maxChunkPayloadBytes) {
      return {
        transferId: null,
        frames: [singleSerialized],
        totalBytes,
        isChunked: false,
      };
    }

    const transferId = createTransferId(this.#nextTransferSeq++);
    const checksum = computePayloadChecksum(serializedPayload);
    const slices = splitStringByUtf8Bytes(serializedPayload, this.#maxChunkPayloadBytes);
    const totalChunks = slices.length;

    const frames = slices.map((data, chunkIndex) => {
      const chunkFrame: CollabChunkWireFrame = {
        v: DATA_CHANNEL_PROTOCOL_VERSION,
        frame: "chunk",
        transferId,
        chunkIndex,
        totalChunks,
        totalBytes,
        checksum,
        data,
      };
      return JSON.stringify(chunkFrame);
    });

    return {
      transferId,
      frames,
      totalBytes,
      isChunked: true,
    };
  }

  encodeAbort(transferId: string, reason = "aborted"): string {
    const abortFrame: CollabChunkAbortWireFrame = {
      v: DATA_CHANNEL_PROTOCOL_VERSION,
      frame: "chunk-abort",
      transferId,
      reason,
    };
    return JSON.stringify(abortFrame);
  }

  decodeFrame(rawFrame: string): ReassemblyResult {
    this.cleanupExpiredTransfers();

    if (typeof rawFrame !== "string" || rawFrame.length === 0) {
      throw new DataChannelChunkError("invalid-frame", "Leeres DataChannel-Frame empfangen.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawFrame);
    } catch (_error) {
      throw new DataChannelChunkError("invalid-frame", "DataChannel-Frame enthält kein gültiges JSON.");
    }

    if (!isPlainRecord(parsed) || parsed.v !== DATA_CHANNEL_PROTOCOL_VERSION || typeof parsed.frame !== "string") {
      throw new DataChannelChunkError("invalid-frame", "Ungültige DataChannel-Protokollversion oder Frame-Struktur.");
    }

    if (parsed.frame === "single") {
      if (!isValidDataChannelMessage(parsed.message)) {
        throw new DataChannelChunkError("invalid-frame", "Ungültige Nachrichtenstruktur im Single-Frame.");
      }
      const totalBytes = getUtf8ByteLength(JSON.stringify(parsed.message));
      if (totalBytes > this.#maxMessageBytes) {
        throw new DataChannelChunkError("payload-too-large", "Einzelnachricht überschreitet die maximale Nachrichtengröße.");
      }
      return {
        completed: true,
        message: parsed.message,
        transferId: null,
        totalBytes,
      };
    }

    if (parsed.frame === "chunk-abort") {
      const transferId = typeof parsed.transferId === "string" ? parsed.transferId.trim() : "";
      if (transferId.length === 0) {
        throw new DataChannelChunkError("invalid-frame", "Ungültige transferId im chunk-abort-Frame.");
      }
      this.#inFlight.delete(transferId);
      return {
        completed: false,
        transferId,
        receivedChunks: 0,
        totalChunks: 0,
        aborted: true,
      };
    }

    if (parsed.frame !== "chunk") {
      throw new DataChannelChunkError("invalid-frame", "Unbekannter DataChannel-Frame-Typ.");
    }

    return this.#handleChunkFrame(parsed);
  }

  cleanupExpiredTransfers(): string[] {
    const now = this.#now();
    const expiredIds: string[] = [];
    for (const [transferId, state] of this.#inFlight.entries()) {
      if (now - state.lastChunkAt >= this.#reassemblyTimeoutMs) {
        this.#inFlight.delete(transferId);
        expiredIds.push(transferId);
      }
    }
    return expiredIds;
  }

  reset(): void {
    this.#inFlight.clear();
  }

  #handleChunkFrame(parsed: Record<string, unknown>): ReassemblyResult {
    const transferId = typeof parsed.transferId === "string" ? parsed.transferId.trim() : "";
    const chunkIndex = typeof parsed.chunkIndex === "number" ? parsed.chunkIndex : -1;
    const totalChunks = typeof parsed.totalChunks === "number" ? parsed.totalChunks : -1;
    const totalBytes = typeof parsed.totalBytes === "number" ? parsed.totalBytes : -1;
    const checksum = typeof parsed.checksum === "string" ? parsed.checksum : "";
    const data = typeof parsed.data === "string" ? parsed.data : null;

    if (
      transferId.length === 0 ||
      !Number.isInteger(totalChunks) ||
      totalChunks <= 0 ||
      !Number.isInteger(totalBytes) ||
      totalBytes < 0 ||
      checksum.length === 0 ||
      data === null
    ) {
      throw new DataChannelChunkError("invalid-frame", "Unvollständige Metadaten im Chunk-Frame.");
    }

    if (totalBytes > this.#maxMessageBytes) {
      throw new DataChannelChunkError(
        "payload-too-large",
        `Angekündigte Gesamtgröße (${totalBytes} Bytes) überschreitet das Limit (${this.#maxMessageBytes} Bytes).`,
      );
    }

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
      throw new DataChannelChunkError("chunk-out-of-range", `Chunk-Index ${chunkIndex} liegt außerhalb [0, ${totalChunks - 1}].`);
    }

    let state = this.#inFlight.get(transferId);
    if (!state) {
      if (this.#inFlight.size >= this.#maxConcurrentTransfers) {
        throw new DataChannelChunkError("too-many-transfers", "Maximale Anzahl paralleler Chunk-Transfers erreicht.");
      }
      state = {
        transferId,
        totalChunks,
        totalBytes,
        checksum,
        chunks: new Array<string | undefined>(totalChunks),
        receivedCount: 0,
        accumulatedBytes: 0,
        lastChunkAt: this.#now(),
      };
      this.#inFlight.set(transferId, state);
    } else if (state.totalChunks !== totalChunks || state.totalBytes !== totalBytes || state.checksum !== checksum) {
      this.#inFlight.delete(transferId);
      throw new DataChannelChunkError("invalid-frame", "Inkonsistente Chunk-Metadaten innerhalb desselben Transfers.");
    }

    if (state.chunks[chunkIndex] !== undefined) {
      throw new DataChannelChunkError("duplicate-chunk", `Doppelter Chunk ${chunkIndex} für Transfer ${transferId}.`);
    }

    const chunkBytes = getUtf8ByteLength(data);
    if (state.accumulatedBytes + chunkBytes > state.totalBytes) {
      this.#inFlight.delete(transferId);
      throw new DataChannelChunkError("size-mismatch", "Empfangene Chunk-Bytes überschreiten totalBytes.");
    }

    state.chunks[chunkIndex] = data;
    state.receivedCount += 1;
    state.accumulatedBytes += chunkBytes;
    state.lastChunkAt = this.#now();

    if (state.receivedCount < state.totalChunks) {
      return {
        completed: false,
        transferId,
        receivedChunks: state.receivedCount,
        totalChunks: state.totalChunks,
      };
    }

    this.#inFlight.delete(transferId);

    const assembled = (state.chunks as string[]).join("");
    const actualBytes = getUtf8ByteLength(assembled);
    if (actualBytes !== state.totalBytes) {
      throw new DataChannelChunkError("size-mismatch", `Erwartete ${state.totalBytes} Bytes, empfangen wurden ${actualBytes} Bytes.`);
    }

    const actualChecksum = computePayloadChecksum(assembled);
    if (actualChecksum !== state.checksum) {
      throw new DataChannelChunkError("checksum-mismatch", "Prüfsummenfehler bei Wiederzusammensetzung des Chunk-Transfers.");
    }

    let decodedMessage: unknown;
    try {
      decodedMessage = JSON.parse(assembled);
    } catch (_error) {
      throw new DataChannelChunkError("invalid-frame", "Zusammengesetzter Chunk-Payload ist kein gültiges JSON.");
    }

    if (!isValidDataChannelMessage(decodedMessage)) {
      throw new DataChannelChunkError("invalid-frame", "Zusammengesetzter Chunk-Payload entspricht keinem gültigen Nachrichtentyp.");
    }

    return {
      completed: true,
      message: decodedMessage,
      transferId,
      totalBytes: actualBytes,
    };
  }
}

export default DataChannelChunker;
