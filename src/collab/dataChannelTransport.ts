import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import {
  DEFAULT_BACKPRESSURE_HIGH_WATER_BYTES,
  DEFAULT_BACKPRESSURE_LOW_WATER_BYTES,
} from "../types/collab/dataChannelMessage";

import DataChannelChunker, {
  DataChannelChunkError,
  type DataChannelChunkerOptions,
  getUtf8ByteLength,
} from "./dataChannelChunker";

export type CollabDataChannelReadyState = "connecting" | "open" | "closing" | "closed";

// Strukturelle Schnittstelle kompatibel zum nativen Browser-RTCDataChannel und Test-Mocks
export type CollabDataChannelLike = {
  readonly label: string;
  readonly readyState: CollabDataChannelReadyState;
  readonly ordered?: boolean;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
};

export type DataChannelTransportOptions = DataChannelChunkerOptions & {
  highWaterMarkBytes?: number;
  lowWaterMarkBytes?: number;
};

export type DataChannelTransportStats = {
  queuedPriorityFrames: number;
  queuedNormalFrames: number;
  activeInboundTransfers: number;
  bytesSent: number;
  bytesReceived: number;
  isPausedForBackpressure: boolean;
};

type QueuedTransfer = {
  transferId: string | null;
  frames: string[];
  cursor: number;
  isPriority: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

function isPriorityMessage(message: CollabDataChannelMessage): boolean {
  return message.kind === "heartbeat-ping" || message.kind === "heartbeat-pong";
}

function extractMessageData(event: unknown): string | null {
  if (typeof event === "string") {
    return event;
  }
  if (typeof event === "object" && event !== null && "data" in event) {
    const data = (event as { data?: unknown }).data;
    return typeof data === "string" ? data : null;
  }
  return null;
}

// Prüft auf reguläre Gegenstellen-Schließung (RFC 4960 Cause 12 / User-Initiated Abort in Chromium)
function isBenignRemoteCloseError(error: Error): boolean {
  const causeCode = (error as { sctpCauseCode?: unknown }).sctpCauseCode;
  if (causeCode === 12) {
    return true;
  }
  return /user-initiated abort/i.test(error.message);
}

// Typisierter, zuverlässiger DataChannel-Transport mit Chunking, Backpressure-Steuerung und Heartbeat-Priorisierung
class DataChannelTransport {
  readonly #channel: CollabDataChannelLike;
  readonly #chunker: DataChannelChunker;
  readonly #highWaterMarkBytes: number;
  readonly #lowWaterMarkBytes: number;

  readonly #priorityQueue: QueuedTransfer[] = [];
  readonly #normalQueue: QueuedTransfer[] = [];
  readonly #messageListeners = new Set<(message: CollabDataChannelMessage) => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();
  readonly #closeListeners = new Set<() => void>();

  #bytesSent = 0;
  #bytesReceived = 0;
  #isPausedForBackpressure = false;
  #isFlushing = false;
  #disposed = false;

  readonly #handleOpen = () => {
    this.#flushQueues();
  };

  readonly #handleBufferedAmountLow = () => {
    this.#isPausedForBackpressure = false;
    this.#flushQueues();
  };

  readonly #handleMessage = (event: unknown) => {
    const raw = extractMessageData(event);
    if (raw === null) {
      return;
    }
    this.#bytesReceived += getUtf8ByteLength(raw);

    try {
      const result = this.#chunker.decodeFrame(raw);
      if (result.completed) {
        for (const listener of this.#messageListeners) {
          listener(result.message);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.#emitError(err);
    }
  };

  readonly #handleError = (event: unknown) => {
    const err = event instanceof Error
      ? event
      : typeof event === "object" && event !== null && "error" in event && (event as { error?: unknown }).error instanceof Error
        ? (event as { error: Error }).error
        : new Error("WebRTC DataChannel Fehler aufgetreten.");
    if (isBenignRemoteCloseError(err)) {
      return;
    }
    this.#emitError(err);
  };

  readonly #handleClose = () => {
    this.#rejectAllPending(new DataChannelChunkError("transfer-aborted", "DataChannel wurde geschlossen."));
    this.#chunker.reset();
    for (const listener of this.#closeListeners) {
      listener();
    }
  };

  constructor(channel: CollabDataChannelLike, options: DataChannelTransportOptions = {}) {
    this.#channel = channel;
    this.#chunker = new DataChannelChunker(options);
    this.#highWaterMarkBytes = Math.max(1024, Math.floor(options.highWaterMarkBytes ?? DEFAULT_BACKPRESSURE_HIGH_WATER_BYTES));
    this.#lowWaterMarkBytes = Math.min(
      this.#highWaterMarkBytes,
      Math.max(0, Math.floor(options.lowWaterMarkBytes ?? DEFAULT_BACKPRESSURE_LOW_WATER_BYTES)),
    );

    this.#channel.bufferedAmountLowThreshold = this.#lowWaterMarkBytes;
    this.#channel.addEventListener("open", this.#handleOpen);
    this.#channel.addEventListener("bufferedamountlow", this.#handleBufferedAmountLow);
    this.#channel.addEventListener("message", this.#handleMessage);
    this.#channel.addEventListener("error", this.#handleError);
    this.#channel.addEventListener("close", this.#handleClose);
  }

  get label(): string {
    return this.#channel.label;
  }

  get readyState(): CollabDataChannelReadyState {
    return this.#channel.readyState;
  }

  get isOpen(): boolean {
    return !this.#disposed && this.#channel.readyState === "open";
  }

  send(message: CollabDataChannelMessage): Promise<void> {
    if (this.#disposed || this.#channel.readyState === "closing" || this.#channel.readyState === "closed") {
      return Promise.reject(new DataChannelChunkError("transfer-aborted", "DataChannel ist nicht mehr geöffnet."));
    }

    let encoded;
    try {
      encoded = this.#chunker.encodeMessage(message);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const priority = isPriorityMessage(message);
    return new Promise((resolve, reject) => {
      const entry: QueuedTransfer = {
        transferId: encoded.transferId,
        frames: encoded.frames,
        cursor: 0,
        isPriority: priority,
        resolve,
        reject,
      };
      if (priority) {
        this.#priorityQueue.push(entry);
      } else {
        this.#normalQueue.push(entry);
      }
      this.#flushQueues();
    });
  }

  // Bricht ausstehende normale Transfers ab und sendet für bereits begonnene Multi-Chunk-Transfers ein chunk-abort-Signal
  abortPendingOutgoing(reason = "aborted"): number {
    const abortedCount = this.#normalQueue.length;
    if (abortedCount === 0) {
      return 0;
    }

    const pending = this.#normalQueue.splice(0, this.#normalQueue.length);
    for (const item of pending) {
      if (item.transferId && item.cursor > 0 && this.isOpen) {
        const abortFrame = this.#chunker.encodeAbort(item.transferId, reason);
        this.#priorityQueue.push({
          transferId: null,
          frames: [abortFrame],
          cursor: 0,
          isPriority: true,
          resolve: () => {},
          reject: () => {},
        });
      }
      item.reject(new DataChannelChunkError("transfer-aborted", `Ausgehender Transfer abgebrochen: ${reason}`));
    }

    this.#isPausedForBackpressure = false;
    this.#flushQueues();
    return abortedCount;
  }

  cleanupExpiredInbound(): string[] {
    return this.#chunker.cleanupExpiredTransfers();
  }

  onMessage(listener: (message: CollabDataChannelMessage) => void): () => void {
    this.#messageListeners.add(listener);
    return () => {
      this.#messageListeners.delete(listener);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this.#errorListeners.add(listener);
    return () => {
      this.#errorListeners.delete(listener);
    };
  }

  onClose(listener: () => void): () => void {
    this.#closeListeners.add(listener);
    return () => {
      this.#closeListeners.delete(listener);
    };
  }

  getStats(): DataChannelTransportStats {
    const countRemainingFrames = (queue: QueuedTransfer[]) => {
      let total = 0;
      for (const item of queue) {
        total += Math.max(0, item.frames.length - item.cursor);
      }
      return total;
    };

    return {
      queuedPriorityFrames: countRemainingFrames(this.#priorityQueue),
      queuedNormalFrames: countRemainingFrames(this.#normalQueue),
      activeInboundTransfers: this.#chunker.activeTransferCount,
      bytesSent: this.#bytesSent,
      bytesReceived: this.#bytesReceived,
      isPausedForBackpressure: this.#isPausedForBackpressure,
    };
  }

  close(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#channel.removeEventListener("open", this.#handleOpen);
    this.#channel.removeEventListener("bufferedamountlow", this.#handleBufferedAmountLow);
    this.#channel.removeEventListener("message", this.#handleMessage);
    this.#channel.removeEventListener("error", this.#handleError);
    this.#channel.removeEventListener("close", this.#handleClose);

    this.#rejectAllPending(new DataChannelChunkError("transfer-aborted", "DataChannelTransport wurde geschlossen."));
    this.#chunker.reset();

    if (this.#channel.readyState === "open" || this.#channel.readyState === "connecting") {
      try {
        this.#channel.close();
      } catch (_error) {
        // Kanal konnte bereits geschlossen sein
      }
    }
  }

  #flushQueues(): void {
    if (this.#isFlushing || this.#disposed || this.#channel.readyState !== "open") {
      return;
    }
    this.#isFlushing = true;

    try {
      // Priorisierte Frames (Heartbeats, Chunk-Aborts) immer vor Bulk-Chunks ausliefern
      this.#drainQueue(this.#priorityQueue, false);

      while (this.#normalQueue.length > 0 && !this.#disposed && this.#channel.readyState === "open") {
        if (this.#channel.bufferedAmount >= this.#highWaterMarkBytes) {
          this.#isPausedForBackpressure = true;
          break;
        }
        this.#isPausedForBackpressure = false;

        const current = this.#normalQueue[0];
        if (!current) {
          break;
        }

        const frame = current.frames[current.cursor];
        this.#sendRawFrame(frame);
        current.cursor += 1;

        if (current.cursor >= current.frames.length) {
          this.#normalQueue.shift();
          current.resolve();
        }

        // Nach jedem Normal-Chunk eventuell neu eingereihte Heartbeats sofort vorziehen
        if (this.#priorityQueue.length > 0) {
          this.#drainQueue(this.#priorityQueue, false);
        }
      }

      if (this.#normalQueue.length === 0) {
        this.#isPausedForBackpressure = false;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.#emitError(err);
      this.#rejectAllPending(err);
    } finally {
      this.#isFlushing = false;
    }
  }

  #drainQueue(queue: QueuedTransfer[], respectBackpressure: boolean): void {
    while (queue.length > 0 && !this.#disposed && this.#channel.readyState === "open") {
      if (respectBackpressure && this.#channel.bufferedAmount >= this.#highWaterMarkBytes) {
        this.#isPausedForBackpressure = true;
        break;
      }

      const current = queue[0];
      if (!current) {
        break;
      }

      while (current.cursor < current.frames.length && !this.#disposed && this.#channel.readyState === "open") {
        if (respectBackpressure && this.#channel.bufferedAmount >= this.#highWaterMarkBytes) {
          this.#isPausedForBackpressure = true;
          return;
        }
        this.#sendRawFrame(current.frames[current.cursor]);
        current.cursor += 1;
      }

      if (current.cursor >= current.frames.length) {
        queue.shift();
        current.resolve();
      }
    }
  }

  #sendRawFrame(frame: string): void {
    this.#channel.send(frame);
    this.#bytesSent += getUtf8ByteLength(frame);
  }

  #rejectAllPending(error: Error): void {
    for (const item of this.#priorityQueue.splice(0, this.#priorityQueue.length)) {
      item.reject(error);
    }
    for (const item of this.#normalQueue.splice(0, this.#normalQueue.length)) {
      item.reject(error);
    }
    this.#isPausedForBackpressure = false;
  }

  #emitError(error: Error): void {
    for (const listener of this.#errorListeners) {
      listener(error);
    }
  }
}

export default DataChannelTransport;
