import { describe, expect, it } from "vitest";

import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import {
  type CollabChunkWireFrame,
  DATA_CHANNEL_PROTOCOL_VERSION,
} from "../types/collab/dataChannelMessage";

import DataChannelChunker, {
  DataChannelChunkError,
  getUtf8ByteLength,
} from "../collab/dataChannelChunker";

describe("DataChannelChunker", () => {
  it("überträgt kleine Nachrichten im Single-Frame-Fast-Path ohne Chunking", () => {
    const chunker = new DataChannelChunker({ maxChunkPayloadBytes: 16 * 1024 });
    const ping: CollabDataChannelMessage = {
      kind: "heartbeat-ping",
      seq: 7,
      sentAt: 123456,
    };

    const encoded = chunker.encodeMessage(ping);
    expect(encoded.isChunked).toBe(false);
    expect(encoded.transferId).toBeNull();
    expect(encoded.frames).toHaveLength(1);

    const decoded = chunker.decodeFrame(encoded.frames[0]);
    expect(decoded).toEqual({
      completed: true,
      message: ping,
      transferId: null,
      totalBytes: encoded.totalBytes,
    });
  });

  it("fragmentiert und rekonstruiert einen Mehr-Megabyte-Snapshot (Memory/GraphicsArray + Unicode) sicher", () => {
    const sender = new DataChannelChunker({ maxChunkPayloadBytes: 16 * 1024 });
    const receiver = new DataChannelChunker({ maxChunkPayloadBytes: 16 * 1024 });

    // Simuliert ein großes CircuitProject mit Memory-Hexdaten, GraphicsArray-Buffer und Emojis/Umlauten
    const memoryBlock = "A5F0".repeat(320_000);
    const graphicsBlock = Array.from({ length: 16_000 }, (_, i) => i % 256);
    const snapshotMessage: CollabDataChannelMessage = {
      kind: "app",
      topic: "circuit-snapshot",
      messageId: "snap-1",
      payload: {
        revision: 42,
        note: "Schaltkreis 🚀 Übertragungsprüfung äöüß ⚡",
        memoryData: memoryBlock,
        graphicsBuffer: graphicsBlock,
      },
    };

    const encoded = sender.encodeMessage(snapshotMessage);
    expect(encoded.isChunked).toBe(true);
    expect(encoded.transferId).toBeTruthy();
    expect(encoded.totalBytes).toBeGreaterThan(1_000_000);
    expect(encoded.frames.length).toBeGreaterThan(60);

    // Jeder einzelne Chunk bleibt unterhalb der konservativen SCTP-Nutzlastgrenze (16 KiB + kleine Frame-Metadaten)
    for (let i = 0; i < encoded.frames.length; i += 1) {
      const frameObj = JSON.parse(encoded.frames[i]) as CollabChunkWireFrame;
      expect(getUtf8ByteLength(frameObj.data)).toBeLessThanOrEqual(16 * 1024);
      const res = receiver.decodeFrame(encoded.frames[i]);
      if (i < encoded.frames.length - 1) {
        expect(res).toEqual({
          completed: false,
          transferId: encoded.transferId,
          receivedChunks: i + 1,
          totalChunks: encoded.frames.length,
        });
      } else {
        expect(res).toEqual({
          completed: true,
          message: snapshotMessage,
          transferId: encoded.transferId,
          totalBytes: encoded.totalBytes,
        });
      }
    }

    expect(receiver.activeTransferCount).toBe(0);
  });

  it("begrenzt Gesamtgröße, Parallel-Transfers, Checksumme, Duplikate und Reassembly-Timeout", () => {
    let nowMs = 10_000;
    const chunker = new DataChannelChunker({
      maxChunkPayloadBytes: 512,
      maxMessageBytes: 2048,
      maxConcurrentTransfers: 2,
      reassemblyTimeoutMs: 5000,
      now: () => nowMs,
    });

    // Oversize beim Senden
    expect(() => chunker.encodeMessage({
      kind: "app",
      topic: "too-big",
      payload: "X".repeat(3000),
    })).toThrow(DataChannelChunkError);

    // Parallel-Transfer-Limit & Timeout
    const t1 = chunker.encodeMessage({ kind: "app", topic: "t1", payload: "A".repeat(700) });
    const t2 = chunker.encodeMessage({ kind: "app", topic: "t2", payload: "B".repeat(700) });
    const t3 = chunker.encodeMessage({ kind: "app", topic: "t3", payload: "C".repeat(700) });

    chunker.decodeFrame(t1.frames[0]);
    chunker.decodeFrame(t2.frames[0]);
    expect(chunker.activeTransferCount).toBe(2);

    expect(() => chunker.decodeFrame(t3.frames[0])).toThrow(/paralleler Chunk-Transfers/);

    // Duplikat desselben Chunks wird abgewiesen
    expect(() => chunker.decodeFrame(t1.frames[0])).toThrow(/Doppelter Chunk/);

    // Nach Ablauf des Timeouts wird Speicher automatisch freigegeben
    nowMs += 6000;
    const expired = chunker.cleanupExpiredTransfers();
    expect(expired).toHaveLength(2);
    expect(chunker.activeTransferCount).toBe(0);

    // Checksum-Manipulation am letzten Chunk wird erkannt
    const t4 = chunker.encodeMessage({ kind: "app", topic: "t4", payload: "D".repeat(700) });
    const corruptedLast = JSON.parse(t4.frames[t4.frames.length - 1]) as CollabChunkWireFrame;
    corruptedLast.data = `${corruptedLast.data.slice(0, -1)}Z`;
    for (let i = 0; i < t4.frames.length - 1; i += 1) {
      chunker.decodeFrame(t4.frames[i]);
    }
    expect(() => chunker.decodeFrame(JSON.stringify(corruptedLast))).toThrow(/Prüfsummenfehler/);
    expect(chunker.activeTransferCount).toBe(0);

    // chunk-abort bereinigt angefangene Transfers sofort
    const t5 = chunker.encodeMessage({ kind: "app", topic: "t5", payload: "E".repeat(700) });
    chunker.decodeFrame(t5.frames[0]);
    expect(chunker.activeTransferCount).toBe(1);
    const abortRes = chunker.decodeFrame(chunker.encodeAbort(t5.transferId as string, "cancelled"));
    expect(abortRes).toEqual({
      completed: false,
      transferId: t5.transferId,
      receivedChunks: 0,
      totalChunks: 0,
      aborted: true,
    });
    expect(chunker.activeTransferCount).toBe(0);

    // Falsche Protokollversion wird abgewiesen
    expect(() => chunker.decodeFrame(JSON.stringify({ v: DATA_CHANNEL_PROTOCOL_VERSION + 1, frame: "single" }))).toThrow(
      DataChannelChunkError,
    );
  });
});
