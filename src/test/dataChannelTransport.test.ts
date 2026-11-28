import { describe, expect, it } from "vitest";

import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";

import { DataChannelChunkError } from "../collab/dataChannelChunker";
import DataChannelTransport, {
  type CollabDataChannelLike,
  type CollabDataChannelReadyState,
} from "../collab/dataChannelTransport";

class MockDataChannel implements CollabDataChannelLike {
  readonly label = "logic-circuit-collab";
  readonly ordered = true;
  readyState: CollabDataChannelReadyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: MockDataChannel | null = null;
  readonly sentRawFrames: string[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  send(data: string): void {
    this.sentRawFrames.push(data);
    this.bufferedAmount += data.length;
    if (this.peer && this.peer.readyState === "open") {
      this.peer.emit("message", { data });
    }
  }

  close(): void {
    if (this.readyState === "closed") {
      return;
    }
    this.readyState = "closed";
    this.emit("close", {});
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  drainBufferTo(nextBufferedAmount: number): void {
    this.bufferedAmount = nextBufferedAmount;
    if (nextBufferedAmount <= this.bufferedAmountLowThreshold) {
      this.emit("bufferedamountlow", {});
    }
  }
}

function createLoopbackPair(): { left: MockDataChannel; right: MockDataChannel } {
  const left = new MockDataChannel();
  const right = new MockDataChannel();
  left.peer = right;
  right.peer = left;
  return { left, right };
}

describe("DataChannelTransport", () => {
  it("pausiert Bulk-Transfers bei Backpressure, zieht Heartbeats vor und setzt nach bufferedamountlow fort", async () => {
    const { left, right } = createLoopbackPair();
    const sender = new DataChannelTransport(left, {
      maxChunkPayloadBytes: 512,
      highWaterMarkBytes: 2048,
      lowWaterMarkBytes: 512,
    });
    const receiver = new DataChannelTransport(right, {
      maxChunkPayloadBytes: 512,
    });

    const receivedOrder: CollabDataChannelMessage[] = [];
    receiver.onMessage((msg) => {
      receivedOrder.push(msg);
    });

    expect(left.bufferedAmountLowThreshold).toBe(512);

    const bulkPromise = sender.send({
      kind: "app",
      topic: "snapshot",
      payload: "M".repeat(4500),
    });

    // Nach Erreichen von highWaterMarkBytes pausiert der normale Bulk-Transfer
    expect(sender.getStats().isPausedForBackpressure).toBe(true);
    expect(sender.getStats().queuedNormalFrames).toBeGreaterThan(0);

    // Heartbeat-Ping wird trotz laufender Backpressure-Pause sofort priorisiert ausgeliefert
    await sender.send({
      kind: "heartbeat-ping",
      seq: 1,
      sentAt: 999,
    });

    expect(receivedOrder.some((m) => m.kind === "heartbeat-ping" && m.seq === 1)).toBe(true);
    expect(receivedOrder.some((m) => m.kind === "app")).toBe(false);

    // Puffer wird geleert -> restliche Chunks laufen automatisch weiter
    while (sender.getStats().queuedNormalFrames > 0) {
      left.drainBufferTo(0);
    }
    await bulkPromise;

    expect(sender.getStats().isPausedForBackpressure).toBe(false);
    expect(receivedOrder.some((m) => m.kind === "app" && m.topic === "snapshot")).toBe(true);

    sender.close();
    receiver.close();
    expect(left.listeners.get("message")?.size ?? 0).toBe(0);
  });

  it("bricht ausstehende Transfers sauber per abortPendingOutgoing ab und informiert den Empfänger", async () => {
    const { left, right } = createLoopbackPair();
    const sender = new DataChannelTransport(left, {
      maxChunkPayloadBytes: 512,
      highWaterMarkBytes: 1024,
      lowWaterMarkBytes: 256,
    });
    const receiver = new DataChannelTransport(right, {
      maxChunkPayloadBytes: 512,
    });

    const pendingBulk = sender.send({
      kind: "app",
      topic: "large",
      payload: "Z".repeat(4000),
    });

    expect(receiver.getStats().activeInboundTransfers).toBe(1);
    const aborted = sender.abortPendingOutgoing("resync");
    expect(aborted).toBe(1);

    await expect(pendingBulk).rejects.toThrow(DataChannelChunkError);
    // Empfänger hat chunk-abort erhalten und seinen Zwischenspeicher sofort wieder freigegeben
    expect(receiver.getStats().activeInboundTransfers).toBe(0);

    sender.close();
    receiver.close();
  });

  it("unterdrückt reguläre Remote-Close-Signale (User-Initiated Abort / sctpCauseCode 12) als Transportfehler", () => {
    const { left } = createLoopbackPair();
    const transport = new DataChannelTransport(left);
    const errors: Error[] = [];
    transport.onError((err) => {
      errors.push(err);
    });

    left.emit("error", { error: new Error("User-Initiated Abort, reason=Close called") });
    const cause12Error = Object.assign(new Error("sctp close"), { sctpCauseCode: 12 });
    left.emit("error", { error: cause12Error });
    expect(errors).toHaveLength(0);

    left.emit("error", { error: new Error("Unexpected SCTP failure") });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Unexpected SCTP failure");

    transport.close();
  });
});
