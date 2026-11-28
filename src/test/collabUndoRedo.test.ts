import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import { applyDeltaForward } from "../contexts/circuitContext/historyManager";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import LibraryContext from "../contexts/libraryContext";
import LibraryContextProvider from "../contexts/libraryContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitProject from "../types/circuit/circuitProject";
import type CollabRole from "../types/collab/collabRole";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type CollabIceServer from "../types/collab/iceConfig";
import type { CollabCircuitCommitPayload } from "../types/collab/modelSyncMessage";
import type CircuitDelta from "../types/history/circuitDelta";

import CollabSignalingRelay, { type CollabRelayClient } from "../../server/collabSignalingRelay";
import CollabModelSyncController, {
  type CollabModelSyncTransport,
} from "../collab/collabModelSyncController";
import CollabSessionController from "../collab/collabSessionController";
import type { CollabDataChannelLike, CollabDataChannelReadyState } from "../collab/dataChannelTransport";
import P2pSessionTransport, {
  type CollabIceCandidateLike,
  type CollabPeerConnectionLike,
  type CollabSessionDescriptionLike,
  type PeerConnectionFactory,
} from "../collab/p2pSessionTransport";
import type { CollabSignalingSocketFactory } from "../collab/signalingClient";
import {
  createCircuitSymbol,
  createEmptyCircuitProject,
  createTextNote,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";
import type { CollabRuntimeConfigPreflightResult } from "../utils/collabIceConfig";
import { createWire } from "../utils/wireUtils";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 15));
}

function createUndoSyncHarness() {
  type Node = {
    peerId: string;
    role: CollabRole;
    displayName: string;
    connected: boolean;
    project: CircuitProject;
    remoteCommits: CollabCircuitCommitPayload[];
    snapshotListeners: Set<(snap: never) => void>;
    messageListeners: Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>;
    controller: CollabModelSyncController;
  };

  const nodes = new Map<string, Node>();
  const hostPeerId = "host-1";

  const deliver = async (fromPeerId: string, toPeerId: string, msg: CollabDataChannelMessage) => {
    await Promise.resolve();
    const sender = nodes.get(fromPeerId);
    const target = nodes.get(toPeerId);
    if (!sender || !target || !sender.connected || !target.connected) {
      return;
    }
    for (const listener of target.messageListeners) {
      listener(fromPeerId, msg);
    }
    await Promise.resolve();
    await Promise.resolve();
  };

  const emitAll = () => {
    const peerSummaries = Array.from(nodes.values())
      .filter((n) => n.peerId !== hostPeerId)
      .map((n) => ({
        peerId: n.peerId,
        role: n.role,
        displayName: n.displayName,
        state: "connected" as const,
        diagnostic: { code: "none" as const, isRecoverable: true, turnPlannedHint: false, details: "" },
        lastHeartbeatAt: 1000,
      }));

    for (const node of nodes.values()) {
      const snap = {
        state: "connected" as const,
        sessionId: "sess-undo",
        selfPeerId: node.peerId,
        selfRole: node.role,
        hostPeerId,
        peers: node.role === "host" ? peerSummaries : [],
        diagnostic: { code: "none" as const, isRecoverable: true, turnPlannedHint: false, details: "" },
        gracePeriodMs: 20000,
        iceServers: [],
      };
      for (const listener of node.snapshotListeners) {
        listener(snap as never);
      }
    }
  };

  const addNode = (peerId: string, role: CollabRole, displayName: string, project: CircuitProject) => {
    const snapshotListeners = new Set<(snap: never) => void>();
    const messageListeners = new Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>();
    const node: Node = {
      peerId,
      role,
      displayName,
      connected: true,
      project,
      remoteCommits: [],
      snapshotListeners,
      messageListeners,
      controller: null!,
    };

    const transport: CollabModelSyncTransport = {
      onTransportSnapshot: (listener) => {
        snapshotListeners.add(listener as (snap: never) => void);
        return () => snapshotListeners.delete(listener as (snap: never) => void);
      },
      onTransportMessage: (listener) => {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      sendToPeer: async (targetId, msg) => deliver(node.peerId, targetId, msg),
      sendToHost: async (msg) => deliver(node.peerId, hostPeerId, msg),
      broadcast: async (msg, excludePeerId) => {
        const deliveries: Promise<void>[] = [];
        for (const other of nodes.values()) {
          if (other.peerId === node.peerId || other.peerId === excludePeerId) {
            continue;
          }
          deliveries.push(deliver(node.peerId, other.peerId, msg));
        }
        await Promise.all(deliveries);
      },
      requestResync: async () => true,
      setResyncHooks: () => undefined,
      setBeforeTransferHostHook: () => undefined,
    };

    node.controller = new CollabModelSyncController({
      transport,
      adapter: {
        getVisibleProject: () => node.project,
        applyAuthoritativeProject: (proj) => {
          node.project = proj;
        },
        isEditingLibrary: () => false,
        getLibraryBackgroundProject: () => null,
        setLibraryBackgroundProject: () => undefined,
        getSelfDisplayName: () => node.displayName,
        getParticipantDisplayName: (id) => nodes.get(id)?.displayName,
        onRemoteCommitApplied: (commit) => {
          node.remoteCommits.push(commit);
        },
      },
    });
    nodes.set(peerId, node);
    return node;
  };

  const applyAndCommitDelta = (node: Node, delta: CircuitDelta) => {
    node.project = applyDeltaForward(node.project, delta);
    node.controller.submitLocalDelta(delta, node.project);
  };

  return { addNode, emitAll, applyAndCommitDelta };
}

// Leichtgewichtiger P2P-/Signaling-Mock für echte CircuitContext <-> CollabContext Undo-Integration
class MockRtcDataChannel implements CollabDataChannelLike {
  readonly label: string;
  readonly ordered = true;
  readyState: CollabDataChannelReadyState = "connecting";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: MockRtcDataChannel | null = null;
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(label: string) {
    this.label = label;
  }

  openNow(): void {
    if (this.readyState === "open") {
      return;
    }
    this.readyState = "open";
    this.emit("open", {});
  }

  send(data: string): void {
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
}

class MockPeerConnection implements CollabPeerConnectionLike {
  readonly id: number;
  readonly iceServers: CollabIceServer[];
  iceConnectionState = "new";
  iceGatheringState = "complete";
  onicecandidate: ((event: { candidate: CollabIceCandidateLike | null }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: CollabDataChannelLike }) => void) | null = null;
  localDescription: CollabSessionDescriptionLike | null = null;
  remoteDescription: CollabSessionDescriptionLike | null = null;
  localDataChannel: MockRtcDataChannel | null = null;

  constructor(id: number, iceServers: CollabIceServer[]) {
    this.id = id;
    this.iceServers = iceServers;
  }

  createDataChannel(label: string): CollabDataChannelLike {
    const ch = new MockRtcDataChannel(label);
    this.localDataChannel = ch;
    return ch;
  }

  async createOffer(): Promise<CollabSessionDescriptionLike> {
    return { type: "offer", sdp: `offer-${this.id}` };
  }

  async createAnswer(): Promise<CollabSessionDescriptionLike> {
    return { type: "answer", sdp: `answer-${this.id}` };
  }

  async setLocalDescription(desc: CollabSessionDescriptionLike): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: CollabSessionDescriptionLike): Promise<void> {
    this.remoteDescription = desc;
  }

  async addIceCandidate(): Promise<void> {
    return undefined;
  }

  setIceState(nextState: string): void {
    this.iceConnectionState = nextState;
    this.oniceconnectionstatechange?.();
  }

  close(): void {
    this.iceConnectionState = "closed";
    this.localDataChannel?.close();
  }
}

function pairPeerConnections(offerer: MockPeerConnection, answerer: MockPeerConnection): void {
  const offerChannel = offerer.localDataChannel ?? (offerer.createDataChannel("logic-circuit-collab") as MockRtcDataChannel);
  const answerChannel = new MockRtcDataChannel(offerChannel.label);
  offerChannel.peer = answerChannel;
  answerChannel.peer = offerChannel;
  answerer.localDataChannel = answerChannel;

  answerer.ondatachannel?.({ channel: answerChannel });
  offerer.setIceState("connected");
  answerer.setIceState("connected");
  offerChannel.openNow();
  answerChannel.openNow();
}

function createRelayNetworkHarness() {
  const relay = new CollabSignalingRelay({ inviteTtlMs: 300_000, now: () => 1000 });
  let nextConnId = 1;

  const createSocketFactory = (): CollabSignalingSocketFactory => ({ onOpen, onMessage, onClose }) => {
    const relayClient: CollabRelayClient = {
      send(event, payload) {
        queueMicrotask(() => {
          onMessage(JSON.stringify({ event, payload }));
        });
      },
      close(code = 4003, reason = "kicked") {
        queueMicrotask(() => {
          onClose(code, reason);
        });
      },
    };
    queueMicrotask(() => onOpen());
    return {
      send(rawText) {
        const parsed = JSON.parse(rawText) as { event: string; payload: unknown };
        try {
          switch (parsed.event) {
            case "logic-circuit:collab-create-session":
              relay.createSession(relayClient, parsed.payload as never);
              break;
            case "logic-circuit:collab-create-invite":
              relay.createInvite(relayClient, parsed.payload as never);
              break;
            case "logic-circuit:collab-revoke-invite":
              relay.revokeInvite(relayClient, parsed.payload as never);
              break;
            case "logic-circuit:collab-join-invite":
              relay.joinWithInvite(relayClient, parsed.payload as never);
              break;
            case "logic-circuit:collab-signal":
              relay.relaySignal(relayClient, parsed.payload as never);
              break;
            case "logic-circuit:collab-transfer-host":
              relay.transferHost(relayClient, parsed.payload as never);
              break;
            case "logic-circuit:collab-kick-peer":
              relay.kickPeer(relayClient, parsed.payload as never);
              break;
            case "logic-circuit:collab-close-session":
              relay.closeSession(relayClient, parsed.payload as never);
              break;
            case "logic-circuit:collab-leave":
              relay.leaveSession(relayClient, "left");
              break;
            default:
              break;
          }
        } catch (error) {
          relayClient.send("logic-circuit:collab-error", {
            code: (error as { code?: string }).code ?? "invalid-payload",
            message: (error as Error).message,
          });
        }
      },
      close() {
        relay.disconnectClient(relayClient);
      },
    };
  };

  const createSessionController = () => {
    const pcs: MockPeerConnection[] = [];
    const pcFactory: PeerConnectionFactory = (iceServers) => {
      const conn = new MockPeerConnection(nextConnId++, iceServers);
      pcs.push(conn);
      return conn;
    };

    const controller = new CollabSessionController({
      disabledOverride: false,
      customOnlyOverride: false,
      getPageUrl: () => "https://example.test/logic",
      preflightFetcher: async (): Promise<CollabRuntimeConfigPreflightResult> => ({
        ok: true,
        effectiveBaseUrl: "http://localhost:3001",
        authRequired: false,
        config: {
          stunUrls: ["stun:stun.l.google.com:19302"],
          inviteTtlMs: 300_000,
          gracePeriodMs: 60_000,
          authRequired: false,
          maxPeersPerSession: 16,
        },
      }),
      transportFactory: (transportOpts) =>
        new P2pSessionTransport({
          ...transportOpts,
          socketFactory: createSocketFactory(),
          peerConnectionFactory: pcFactory,
          heartbeatIntervalMs: 0,
        }),
    });

    return { controller, pcs };
  };

  return { createSessionController };
}

describe("T-100: Benutzerbezogenes Undo/Redo & deterministische Konflikt-/Kollisionsprüfungen", () => {
  afterEach(() => {
    delete process.env.DISABLE_COLLAB;
  });

  it("behält getrennte Stacks pro Teilnehmer/Schaltplan und unterstützt konfliktfreies Undo/Redo aller Delta-Typen", async () => {
    const harness = createUndoSyncHarness();
    const initialProj = createEmptyCircuitProject("UndoSym", "Main");
    const mainId = initialProj.logicalCircuits[0].logicalCircuitId;

    const host = harness.addNode("host-1", "host", "Host", initialProj);
    const alice = harness.addNode("collab-a", "collaborator", "Alice", createEmptyCircuitProject());
    harness.emitAll();
    await flushMicrotasks();

    // Host platziert Gate 1 und bewegt es mit kollabierter Leitung
    const place1 = instantiateCircuitFromPalette(host.project, mainId, { type: "and", name: "AND", inputCount: 2 }, { x: 6, y: 6 });
    const sym1 = place1.circuitSymbol;
    const wireCollapsed = createWire(mainId, { x: 10, y: 8 }, { x: 14, y: 8 });
    harness.applyAndCommitDelta(host, {
      type: "add",
      logicalCircuitId: mainId,
      symbols: [{ symbol: sym1, circuit: place1.circuit }],
      textNotes: [],
      wires: [wireCollapsed],
    });
    await flushMicrotasks();

    // Alice platziert unabhängig eine Textnotiz -> Host-Stack bleibt davon unberührt
    const noteAlice = createTextNote(mainId, 24, 6, "Alice Notiz");
    harness.applyAndCommitDelta(alice, {
      type: "add",
      logicalCircuitId: mainId,
      symbols: [],
      textNotes: [noteAlice],
      wires: [],
    });
    await flushMicrotasks();

    expect(host.controller.getCollabHistory(mainId).entries).toHaveLength(1);
    expect(alice.controller.getCollabHistory(mainId).entries).toHaveLength(1);

    // Host verschiebt Gate 1 um (+4, 0) und kollabiert dabei wireCollapsed
    const movedSym1 = createCircuitSymbol(sym1.circuit, mainId, 10, 6, "up", sym1.circuitSymbolId);
    harness.applyAndCommitDelta(host, {
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [sym1.circuitSymbolId],
      textNoteIds: [],
      dx: 4,
      dy: 0,
      symbolPositions: [{ symbolId: sym1.circuitSymbolId, before: { x: 6, y: 6 }, after: { x: 10, y: 6 } }],
      removedWires: [wireCollapsed],
    });
    await flushMicrotasks();
    expect(alice.project.wires.some((w) => w.wireId === wireCollapsed.wireId)).toBe(false);

    // Host macht Move rückgängig -> Position (6, 6) UND wireCollapsed sind wieder da
    expect(host.controller.performCollabUndo(mainId)).toBe(true);
    await flushMicrotasks();
    expect(alice.project.circuitSymbols.find((s) => s.circuitSymbolId === sym1.circuitSymbolId)?.x).toBe(6);
    expect(alice.project.wires.some((w) => w.wireId === wireCollapsed.wireId)).toBe(true);

    // Redo beim Host schiebt Gate 1 wieder auf (10, 6) und entfernt wireCollapsed erneut
    expect(host.controller.performCollabRedo(mainId)).toBe(true);
    await flushMicrotasks();
    expect(alice.project.circuitSymbols.find((s) => s.circuitSymbolId === sym1.circuitSymbolId)?.x).toBe(10);
    expect(alice.project.wires.some((w) => w.wireId === wireCollapsed.wireId)).toBe(false);

    // Alice bearbeitet eigene Textnotiz (updateProperty) -> Undo & Redo funktionieren auch beim Kollaborateur
    const updatedNoteAlice = { ...noteAlice, note: "Geändert von Alice" };
    harness.applyAndCommitDelta(alice, {
      type: "updateProperty",
      logicalCircuitId: mainId,
      targetType: "textNote",
      targetId: noteAlice.textNoteId,
      changes: { note: { before: "Alice Notiz", after: "Geändert von Alice" } },
      beforeTextNote: noteAlice,
      afterTextNote: updatedNoteAlice,
    });
    await flushMicrotasks();
    expect(host.project.textNotes.find((n) => n.textNoteId === noteAlice.textNoteId)?.note).toBe("Geändert von Alice");

    expect(alice.controller.performCollabUndo(mainId)).toBe(true);
    await flushMicrotasks();
    expect(host.project.textNotes.find((n) => n.textNoteId === noteAlice.textNoteId)?.note).toBe("Alice Notiz");

    expect(alice.controller.performCollabRedo(mainId)).toBe(true);
    await flushMicrotasks();
    expect(host.project.textNotes.find((n) => n.textNoteId === noteAlice.textNoteId)?.note).toBe("Geändert von Alice");

    // wireBatch Undo/Redo beim Host
    const wireExtra = createWire(mainId, { x: 20, y: 12 }, { x: 26, y: 12 });
    harness.applyAndCommitDelta(host, {
      type: "wireBatch",
      logicalCircuitId: mainId,
      addedWires: [wireExtra],
      removedWires: [],
      updatedWires: [],
    });
    await flushMicrotasks();
    expect(alice.project.wires.some((w) => w.wireId === wireExtra.wireId)).toBe(true);

    expect(host.controller.performCollabUndo(mainId)).toBe(true);
    await flushMicrotasks();
    expect(alice.project.wires.some((w) => w.wireId === wireExtra.wireId)).toBe(false);
    expect(movedSym1.circuitSymbolId).toBe(sym1.circuitSymbolId);

    host.controller.dispose();
    alice.controller.dispose();
  });

  it("verhindert Undo bei räumlich belegter Zielposition (erhält Eintrag für Retry), bei Fremdänderung und bei Soft-Lock", async () => {
    const harness = createUndoSyncHarness();
    const initialProj = createEmptyCircuitProject("CollisionProj", "Main");
    const mainId = initialProj.logicalCircuits[0].logicalCircuitId;

    const host = harness.addNode("host-1", "host", "Host", initialProj);
    const alice = harness.addNode("collab-a", "collaborator", "Alice", createEmptyCircuitProject());
    const bob = harness.addNode("collab-b", "collaborator", "Bob", createEmptyCircuitProject());
    harness.emitAll();
    await flushMicrotasks();

    // Alice setzt Gate A auf (8, 8) und Bob setzt Gate B auf (20, 8)
    const placeA = instantiateCircuitFromPalette(alice.project, mainId, { type: "and", name: "AND", inputCount: 2 }, { x: 8, y: 8 });
    harness.applyAndCommitDelta(alice, {
      type: "add",
      logicalCircuitId: mainId,
      symbols: [{ symbol: placeA.circuitSymbol, circuit: placeA.circuit }],
      textNotes: [],
      wires: [],
    });
    await flushMicrotasks();

    const placeB = instantiateCircuitFromPalette(bob.project, mainId, { type: "or", name: "OR", inputCount: 2 }, { x: 20, y: 8 });
    harness.applyAndCommitDelta(bob, {
      type: "add",
      logicalCircuitId: mainId,
      symbols: [{ symbol: placeB.circuitSymbol, circuit: placeB.circuit }],
      textNotes: [],
      wires: [],
    });
    await flushMicrotasks();

    // Szenario aus der Praxis: Alice verschiebt Gate A nach (14, 8), danach schiebt Bob Gate B auf (8, 8)
    harness.applyAndCommitDelta(alice, {
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [placeA.circuitSymbol.circuitSymbolId],
      textNoteIds: [],
      dx: 6,
      dy: 0,
    });
    await flushMicrotasks();

    harness.applyAndCommitDelta(bob, {
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [placeB.circuitSymbol.circuitSymbolId],
      textNoteIds: [],
      dx: -12,
      dy: 0,
      symbolPositions: [{
        symbolId: placeB.circuitSymbol.circuitSymbolId,
        before: { x: 20, y: 8 },
        after: { x: 8, y: 8 },
      }],
    });
    await flushMicrotasks();

    // Alice versucht Undo -> Zielposition (8, 8) ist von Gate B belegt -> sauberer Abbruch + Eintrag bleibt erhalten
    expect(alice.controller.performCollabUndo(mainId)).toBe(false);
    expect(alice.controller.getState().lastUndoConflict?.code).toBe("spatial-collision");
    expect(alice.controller.getState().lastUndoConflict?.preservedEntry).toBe(true);
    expect(alice.controller.canCollabUndo(mainId)).toBe(true);
    expect(alice.project.circuitSymbols.find((s) => s.circuitSymbolId === placeA.circuitSymbol.circuitSymbolId)?.x).toBe(14);

    // Bob räumt Position (8, 8) wieder frei -> Alices erneuter Undo-Versuch klappt sofort
    harness.applyAndCommitDelta(bob, {
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [placeB.circuitSymbol.circuitSymbolId],
      textNoteIds: [],
      dx: 12,
      dy: 8,
      symbolPositions: [{
        symbolId: placeB.circuitSymbol.circuitSymbolId,
        before: { x: 8, y: 8 },
        after: { x: 20, y: 16 },
      }],
    });
    await flushMicrotasks();

    expect(alice.controller.performCollabUndo(mainId)).toBe(true);
    await flushMicrotasks();
    expect(host.project.circuitSymbols.find((s) => s.circuitSymbolId === placeA.circuitSymbol.circuitSymbolId)?.x).toBe(8);
    expect(alice.controller.getState().lastUndoConflict).toBeNull();

    // Fremd-Soft-Lock verhindert Undo auf gesperrtem Bauteil
    bob.controller.acquireSoftLocks(
      [{ targetType: "symbol", targetId: placeA.circuitSymbol.circuitSymbolId, logicalCircuitId: mainId }],
      "drag",
    );
    await flushMicrotasks();
    expect(alice.controller.performCollabUndo(mainId)).toBe(false);
    expect(alice.controller.getState().lastUndoConflict?.code).toBe("entity-locked");
    expect(alice.controller.getState().lastUndoConflict?.lockedByDisplayName).toBe("Bob");

    await bob.controller.releaseSoftLocks();
    await flushMicrotasks();

    // Andere Person bewegt Gate A weiter -> Alices verbleibendes add-Undo bricht mit entity-modified ab
    harness.applyAndCommitDelta(bob, {
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [placeA.circuitSymbol.circuitSymbolId],
      textNoteIds: [],
      dx: 2,
      dy: 0,
      symbolPositions: [{
        symbolId: placeA.circuitSymbol.circuitSymbolId,
        before: { x: 8, y: 8 },
        after: { x: 10, y: 8 },
      }],
    });
    await flushMicrotasks();

    expect(alice.controller.performCollabUndo(mainId)).toBe(false);
    expect(alice.controller.getState().lastUndoConflict?.code).toBe("entity-modified");
    expect(alice.controller.canCollabUndo(mainId)).toBe(true);

    host.controller.dispose();
    alice.controller.dispose();
    bob.controller.dispose();
  });

  it("delegiert CircuitContext.undo/redo/canUndo/canRedo im Kollaborationsmodus an CollabUndoManager", async () => {
    delete process.env.DISABLE_COLLAB;
    const relayNet = createRelayNetworkHarness();

    const mountWorkspace = (projectName: string) => {
      let circuitCtx!: React.ContextType<typeof CircuitContext>;
      let libraryCtx!: React.ContextType<typeof LibraryContext>;
      const Probe = () => {
        circuitCtx = React.useContext(CircuitContext);
        libraryCtx = React.useContext(LibraryContext);
        return null;
      };
      renderToStaticMarkup(
        React.createElement(CircuitContextProvider, {
          initialProject: createEmptyCircuitProject(projectName, "Main"),
          children: React.createElement(SimulationContextProvider, {
            children: React.createElement(LibraryContextProvider, {
              skipInitialLoad: true,
              children: React.createElement(Probe),
            }),
          }),
        }),
      );
      return {
        getCircuit: () => circuitCtx,
        getLibrary: () => libraryCtx,
      };
    };

    const hostWs = mountWorkspace("CtxUndoHost");
    const collabWs = mountWorkspace("CtxUndoPeer");
    const hostHolder = relayNet.createSessionController();
    const collabHolder = relayNet.createSessionController();

    const attachBridge = (
      ws: ReturnType<typeof mountWorkspace>,
      sessionCtrl: CollabSessionController,
    ) => {
      const sync = new CollabModelSyncController({
        transport: sessionCtrl,
        adapter: {
          getVisibleProject: () => ws.getCircuit().project,
          applyAuthoritativeProject: (proj, opts) => {
            ws.getCircuit().applyRemoteProjectState?.(proj, opts);
          },
          isEditingLibrary: () => Boolean(ws.getLibrary()?.isEditingLibrary),
          getLibraryBackgroundProject: () => ws.getLibrary()?.getSavedSessionProject?.() ?? null,
          setLibraryBackgroundProject: (proj) => {
            ws.getLibrary()?.updateSavedSessionProject?.(proj);
          },
          getSelfDisplayName: () => sessionCtrl.getState().displayName,
          getParticipantDisplayName: (id) =>
            sessionCtrl.getState().participants.find((p) => p.peerId === id)?.displayName,
        },
      });
      ws.getCircuit().registerCollabSyncBridge?.({
        canMutateProject: () => sync.canMutateProject(),
        onLocalDeltaCommitted: (delta, proj, opts) => sync.submitLocalDelta(delta, proj, opts),
        onLocalMutation: (mutation) => sync.submitLocalMutation(mutation),
        onLocalProjectReplaced: (nextProj) => sync.notifyLocalProjectReplaced(nextProj),
        isCollabUndoActive: () => sync.isCollabUndoActive(),
        getCollabHistory: (cid) => sync.getCollabHistory(cid),
        canCollabUndo: (cid) => sync.canCollabUndo(cid),
        canCollabRedo: (cid) => sync.canCollabRedo(cid),
        performCollabUndo: (cid) => sync.performCollabUndo(cid),
        performCollabRedo: (cid) => sync.performCollabRedo(cid),
        clearCollabHistory: (cid) => sync.clearCollabHistory(cid),
        subscribeUndoState: (listener) => sync.subscribeUndoState(listener),
      });
      return sync;
    };

    const hostSync = attachBridge(hostWs, hostHolder.controller);
    const collabSync = attachBridge(collabWs, collabHolder.controller);

    await hostHolder.controller.startHostSession({ displayName: "Host" });
    const invite = await hostHolder.controller.createInviteLink("collaborator");
    await collabHolder.controller.joinSession({
      inviteToken: invite!.inviteToken,
      displayName: "Alice",
    });

    await flushMicrotasks();
    expect(hostHolder.pcs).toHaveLength(1);
    expect(collabHolder.pcs).toHaveLength(1);
    pairPeerConnections(hostHolder.pcs[0], collabHolder.pcs[0]);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(collabWs.getCircuit().project.project.name).toBe("CtxUndoHost");

    // Kollaborateur platziert Bauteil und verschiebt es -> Host erhält es
    let collabSymId = "";
    React.act(() => {
      const sym = collabWs.getCircuit().addSymbol({ type: "and", name: "AND", inputCount: 2 }, { x: 8, y: 8 });
      collabSymId = sym.circuitSymbolId;
      collabWs.getCircuit().moveEntities({ symbolIds: [collabSymId], dx: 8, dy: 0 });
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(hostWs.getCircuit().project.circuitSymbols.find((s) => s.circuitSymbolId === collabSymId)?.x).toBe(16);

    // Host hat KEINEN Undo-Verlauf aus Kollaborateur-Commits, Kollaborateur hat 2 eigene Schritte
    expect(hostWs.getCircuit().canUndo).toBe(false);
    expect(collabWs.getCircuit().canUndo).toBe(true);
    expect(collabWs.getCircuit().history.entries).toHaveLength(2);

    // Kollaborateur macht über CircuitContext.undo() den Move rückgängig -> Host sieht alte Position (8, 8)
    React.act(() => {
      collabWs.getCircuit().undo();
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(hostWs.getCircuit().project.circuitSymbols.find((s) => s.circuitSymbolId === collabSymId)?.x).toBe(8);
    expect(collabWs.getCircuit().canRedo).toBe(true);

    // Kollaborateur macht CircuitContext.redo() -> Host sieht wieder Position (16, 8)
    React.act(() => {
      collabWs.getCircuit().redo();
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(hostWs.getCircuit().project.circuitSymbols.find((s) => s.circuitSymbolId === collabSymId)?.x).toBe(16);

    hostSync.dispose();
    collabSync.dispose();
    hostHolder.controller.dispose();
    collabHolder.controller.dispose();
  });
});
