import { describe, expect, it, vi } from "vitest";

import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type CollabIceServer from "../types/collab/iceConfig";
import type { CollabSessionClosedEvent } from "../types/collab/sessionState";

import CollabSignalingRelay, { type CollabRelayClient } from "../../server/collabSignalingRelay";
import { COLLAB_EVENT_SIGNAL } from "../collab/collabEvents";
import type { CollabDataChannelLike, CollabDataChannelReadyState } from "../collab/dataChannelTransport";
import P2pSessionTransport, {
  type CollabIceCandidateLike,
  type CollabPeerConnectionLike,
  type CollabSessionDescriptionLike,
  type PeerConnectionFactory,
} from "../collab/p2pSessionTransport";
import SignalingClient, { type CollabSignalingSocketFactory } from "../collab/signalingClient";

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
  peerConnection: MockPeerConnection | null = null;
  readonly addedIceCandidates: CollabIceCandidateLike[] = [];
  shouldFailIce = false;

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
    return { type: "offer", sdp: `offer-from-${this.id}` };
  }

  async createAnswer(): Promise<CollabSessionDescriptionLike> {
    return { type: "answer", sdp: `answer-from-${this.id}` };
  }

  async setLocalDescription(desc: CollabSessionDescriptionLike): Promise<void> {
    this.localDescription = desc;
    // Simuliert Trickle-ICE mit lokalem host- und öffentlichem srflx-Kandidaten
    queueMicrotask(() => {
      this.onicecandidate?.({
        candidate: {
          candidate: `candidate:1 1 UDP 2122260223 192.168.1.${this.id} 5000${this.id} typ host`,
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      });
      this.onicecandidate?.({
        candidate: {
          candidate: `candidate:2 1 UDP 1686052607 203.0.113.${this.id} 6000${this.id} typ srflx`,
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      });
    });
  }

  async setRemoteDescription(desc: CollabSessionDescriptionLike): Promise<void> {
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate: CollabIceCandidateLike): Promise<void> {
    this.addedIceCandidates.push(candidate);
  }

  setIceState(nextState: string): void {
    this.iceConnectionState = nextState;
    this.oniceconnectionstatechange?.();
  }

  close(): void {
    this.iceConnectionState = "closed";
  }
}

function pairMockPeerConnections(offerer: MockPeerConnection, answerer: MockPeerConnection): void {
  offerer.peerConnection = answerer;
  answerer.peerConnection = offerer;

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

function createRelayTestHarness(options: { accessKey?: string; tamperPeerJoined?: boolean } = {}) {
  const relay = new CollabSignalingRelay({
    accessKey: options.accessKey,
  });
  const sentSignals: Array<{ event: string; payload: unknown }> = [];
  const requestedUrls: string[] = [];
  const createdPcs: MockPeerConnection[] = [];
  let nextPcId = 1;

  const createSocketFactory = (): CollabSignalingSocketFactory => {
    return ({ url, onOpen, onMessage, onClose }) => {
      requestedUrls.push(url);
      const relayClient: CollabRelayClient = {
        send(event, payload) {
          let effectivePayload = payload;
          if (options.tamperPeerJoined && event === "logic-circuit:collab-peer-joined") {
            effectivePayload = {
              ...(payload as Record<string, unknown>),
              role: "collaborator",
              tokenProof: "forged-proof",
            };
          }
          queueMicrotask(() => {
            onMessage(JSON.stringify({ event, payload: effectivePayload }));
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
          sentSignals.push(parsed);
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
              case COLLAB_EVENT_SIGNAL:
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
              case "logic-circuit:collab-ping":
                relayClient.send("logic-circuit:collab-pong", {});
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
  };

  const createPcFactory = (): { factory: PeerConnectionFactory; pcs: MockPeerConnection[] } => {
    const localPcs: MockPeerConnection[] = [];
    const factory: PeerConnectionFactory = (iceServers) => {
      const pc = new MockPeerConnection(nextPcId++, iceServers);
      localPcs.push(pc);
      createdPcs.push(pc);
      return pc;
    };
    return { factory, pcs: localPcs };
  };

  return { relay, sentSignals, requestedUrls, createdPcs, createSocketFactory, createPcFactory };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((res) => setTimeout(res, 15));
}

describe("P2pSessionTransport (WebRTC-Stern-Transport, Host-Wechsel & Resync)", () => {
  it("vermittelt Handshake per Invite-Token und überträgt Nutzdaten direkt P2P ohne Signaling-Umweg", async () => {
    const harness = createRelayTestHarness({ accessKey: "secret-host-key" });
    const hostPcHolder = harness.createPcFactory();
    const guestPcHolder = harness.createPcFactory();

    const host = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: hostPcHolder.factory,
      runtimeConfig: {
        stunUrls: ["stun:stun.example.org:3478"],
        inviteTtlMs: 300_000,
        gracePeriodMs: 15_000,
        authRequired: true,
        maxPeersPerSession: 8,
      },
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });

    const guest = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: guestPcHolder.factory,
      runtimeConfig: {
        stunUrls: ["stun:stun.example.org:3478"],
        inviteTtlMs: 300_000,
        gracePeriodMs: 15_000,
        authRequired: true,
        maxPeersPerSession: 8,
      },
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });

    const hostSnap = await host.startHostSession({ accessKey: "secret-host-key", displayName: "Andreas" });
    expect(hostSnap.selfRole).toBe("host");
    expect(hostSnap.iceServers).toEqual([{ urls: "stun:stun.example.org:3478" }]);

    const invite = await host.createInvite("collaborator");
    const guestJoinSnap = await guest.joinSession({ inviteToken: invite.inviteToken, displayName: "Eva" });
    expect(guestJoinSnap.selfRole).toBe("collaborator");

    await flushMicrotasks();
    expect(hostPcHolder.pcs).toHaveLength(1);
    expect(guestPcHolder.pcs).toHaveLength(1);
    pairMockPeerConnections(hostPcHolder.pcs[0], guestPcHolder.pcs[0]);
    await flushMicrotasks();

    const receivedOnGuest: CollabDataChannelMessage[] = [];
    guest.onMessage((_from, msg) => receivedOnGuest.push(msg));

    const signalCountBeforeP2p = harness.sentSignals.length;
    await host.broadcast({
      kind: "app",
      topic: "circuit-mutation",
      payload: { op: "add-gate", id: "g1" },
    });

    expect(receivedOnGuest).toEqual([
      { kind: "app", topic: "circuit-mutation", payload: { op: "add-gate", id: "g1" } },
    ]);
    // Nutzdaten fließen ausschließlich über P2P DataChannel, nicht über den Signaling-Socket
    expect(harness.sentSignals).toHaveLength(signalCountBeforeP2p);

    host.close();
    guest.close();
  });

  it("lehnt manipulierte Join-Token-Proofs und Rollen-Eskalation hostseitig ab und kickt den Peer", async () => {
    const harness = createRelayTestHarness({ tamperPeerJoined: true });
    const hostPcHolder = harness.createPcFactory();
    const attackerPcHolder = harness.createPcFactory();

    const host = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: hostPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });
    const hostErrors: Error[] = [];
    host.onError((err) => hostErrors.push(err));

    await host.startHostSession();
    const issued = await host.createInvite("guest");

    const attacker = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: attackerPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });

    await attacker.joinSession({ inviteToken: issued.inviteToken, displayName: "Mallory" });
    await flushMicrotasks();

    expect(hostPcHolder.pcs).toHaveLength(0);
    expect(hostErrors.some((err) => err.message.includes("role-mismatch"))).toBe(true);
    expect(attacker.getSnapshot().state).toBe("disconnected");

    host.close();
    attacker.close();
  });

  it("überwacht Heartbeat & Grace Period und triggert bei Erholung einen automatischen Resync", async () => {
    let nowMs = 10_000;
    const harness = createRelayTestHarness();
    const hostPcHolder = harness.createPcFactory();
    const peerPcHolder = harness.createPcFactory();
    const resyncRequests: Array<{ peerId: string; reason: string }> = [];

    const host = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: hostPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      gracePeriodMs: 4000,
      now: () => nowMs,
      disabledOverride: false,
      resyncHooks: {
        onResyncRequested: (req) => resyncRequests.push({ peerId: req.peerId, reason: req.reason }),
      },
    });

    const peer = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: peerPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      gracePeriodMs: 4000,
      now: () => nowMs,
      disabledOverride: false,
    });

    await host.startHostSession();
    const invite = await host.createInvite("collaborator");
    await peer.joinSession({ inviteToken: invite.inviteToken });
    await flushMicrotasks();

    pairMockPeerConnections(hostPcHolder.pcs[0], peerPcHolder.pcs[0]);
    await flushMicrotasks();
    expect(peer.getSnapshot().state).toBe("connected");

    // Kurzzeitige Unterbrechung -> degraded innerhalb Grace Period -> Erholung löst Auto-Resync aus
    peerPcHolder.pcs[0].setIceState("disconnected");
    expect(peer.getSnapshot().state).toBe("degraded");
    nowMs += 2000;
    peer.checkHeartbeats();
    expect(peer.getSnapshot().state).toBe("degraded");

    peerPcHolder.pcs[0].setIceState("connected");
    await flushMicrotasks();
    expect(peer.getSnapshot().state).toBe("connected");
    expect(resyncRequests).toHaveLength(1);
    expect(resyncRequests[0].reason).toBe("reconnected");

    // Dauerhafter stiller Paketverlust über Grace Period hinaus -> failed + NAT-/STUN-Diagnose mit TURN-Hinweis
    if (peerPcHolder.pcs[0].localDataChannel) {
      peerPcHolder.pcs[0].localDataChannel.peer = null;
    }
    nowMs += 5000;
    peer.checkHeartbeats();
    expect(peer.getSnapshot().state).toBe("degraded");
    nowMs += 5000;
    peer.checkHeartbeats();
    expect(peer.getSnapshot().state).toBe("failed");
    expect(peer.getSnapshot().diagnostic.turnPlannedHint).toBe(true);
    expect(peer.getSnapshot().diagnostic.code).toBe("symmetric-nat-or-udp-blocked");

    host.close();
    peer.close();
  });

  it("migriert die Stern-Topologie beim Host-Wechsel und diagnostiziert STUN-Fehler zu neuem Host", async () => {
    const harness = createRelayTestHarness();
    const hostAPcHolder = harness.createPcFactory();
    const collabBPcHolder = harness.createPcFactory();
    const guestCPcHolder = harness.createPcFactory();

    const hostA = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: hostAPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });
    const collabB = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: collabBPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });
    const guestC = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: guestCPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });

    await hostA.startHostSession({ displayName: "HostA" });
    const collabInvite = await hostA.createInvite("collaborator");
    const guestInvite = await hostA.createInvite("guest");

    const bSnap = await collabB.joinSession({ inviteToken: collabInvite.inviteToken, displayName: "CollabB" });
    const cSnap = await guestC.joinSession({ inviteToken: guestInvite.inviteToken, displayName: "GuestC" });
    await flushMicrotasks();

    // Ursprünglichen Stern verbinden
    for (const hostPc of hostAPcHolder.pcs) {
      const targetSdp = hostPc.localDescription?.sdp;
      const targetPeerPc = collabBPcHolder.pcs[0].remoteDescription?.sdp === targetSdp
        ? collabBPcHolder.pcs[0]
        : guestCPcHolder.pcs[0];
      pairMockPeerConnections(hostPc, targetPeerPc);
    }
    await flushMicrotasks();

    // Host-Wechsel von HostA auf CollabB
    hostA.transferHost(bSnap.selfPeerId as string);
    await flushMicrotasks();

    expect(collabB.getSnapshot().selfRole).toBe("host");
    expect(hostA.getSnapshot().selfRole).toBe("collaborator");
    expect(guestC.getSnapshot().hostPeerId).toBe(bSnap.selfPeerId);

    // CollabB hat Offers an HostA und GuestC gesendet (1 alter + 2 neue PCs = 3); HostA hat neuen PC[2] für CollabB angelegt
    expect(collabBPcHolder.pcs).toHaveLength(3);
    expect(hostAPcHolder.pcs).toHaveLength(3);
    const newAToB = hostAPcHolder.pcs[2];
    const newBToA = collabBPcHolder.pcs.find((pc) => pc.localDescription?.sdp === newAToB.remoteDescription?.sdp)
      ?? collabBPcHolder.pcs[1];
    const newBToC = collabBPcHolder.pcs.find((pc) => pc !== newBToA && pc !== collabBPcHolder.pcs[0])
      ?? collabBPcHolder.pcs[2];
    expect(newBToC.localDescription?.type).toBe("offer");

    pairMockPeerConnections(newBToA, newAToB);
    await flushMicrotasks();
    expect(hostA.getSnapshot().state).toBe("connected");

    // GuestC kann hinter Symmetric NAT keine direkte Verbindung zum neuen Host B aufbauen -> Diagnose
    guestCPcHolder.pcs[1].setIceState("failed");
    expect(guestC.getSnapshot().state).toBe("failed");
    expect(guestC.getSnapshot().diagnostic.code).toBe("host-migration-unreachable");
    expect(guestC.getSnapshot().diagnostic.turnPlannedHint).toBe(true);
    void cSnap;

    hostA.close();
    collabB.close();
    guestC.close();
  });

  it("warnt beim manuellen Resync vor dem Verwerfen unbestätigter lokaler Änderungen", async () => {
    const harness = createRelayTestHarness();
    const hostPcHolder = harness.createPcFactory();
    const peerPcHolder = harness.createPcFactory();
    const hostResyncEvents: Array<{ reason: string; hasUnconfirmedLocalChanges?: boolean }> = [];
    const confirmMock = vi.fn<() => Promise<boolean>>();

    const host = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: hostPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
      resyncHooks: {
        onResyncRequested: (req) => hostResyncEvents.push({
          reason: req.reason,
          hasUnconfirmedLocalChanges: req.hasUnconfirmedLocalChanges,
        }),
      },
    });

    const discardedSpy = vi.fn();
    const peer = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: peerPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
      resyncHooks: {
        getUnconfirmedLocalChangesCount: () => 3,
        confirmDiscardLocalChanges: confirmMock,
        onLocalChangesDiscardedForResync: discardedSpy,
      },
    });

    await host.startHostSession();
    const invite = await host.createInvite("collaborator");
    await peer.joinSession({ inviteToken: invite.inviteToken });
    await flushMicrotasks();

    pairMockPeerConnections(hostPcHolder.pcs[0], peerPcHolder.pcs[0]);
    await flushMicrotasks();

    // Nutzer lehnt Warnung ab -> kein Resync, Änderungen bleiben erhalten
    confirmMock.mockResolvedValueOnce(false);
    const cancelledRes = await peer.requestResync("manual", 10);
    expect(cancelledRes).toEqual({
      executed: false,
      cancelledByUser: true,
      unconfirmedLocalChangesCount: 3,
    });
    expect(discardedSpy).not.toHaveBeenCalled();
    expect(hostResyncEvents).toHaveLength(0);

    // Nutzer bestätigt Warnung -> lokale Änderungen verworfen & Resync-Request an Host gesendet
    confirmMock.mockResolvedValueOnce(true);
    const confirmedRes = await peer.requestResync("manual", 10);
    await flushMicrotasks();

    expect(confirmedRes).toEqual({
      executed: true,
      cancelledByUser: false,
      unconfirmedLocalChangesCount: 3,
    });
    expect(discardedSpy).toHaveBeenCalledTimes(1);
    expect(hostResyncEvents).toEqual([
      { reason: "manual", hasUnconfirmedLocalChanges: true },
    ]);

    host.close();
    peer.close();
  });

  it("behält Rollen und Anzeigenamen beim Host-Wechsel (auch an einen Gast) vollständig bei", async () => {
    const harness = createRelayTestHarness();
    const hostAPcHolder = harness.createPcFactory();
    const collabBPcHolder = harness.createPcFactory();
    const guestCPcHolder = harness.createPcFactory();

    const hostA = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: hostAPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });
    const collabB = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: collabBPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });
    const guestC = new P2pSessionTransport({
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: guestCPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });

    const aSnap = await hostA.startHostSession({ displayName: "HostA" });
    const collabInvite = await hostA.createInvite("collaborator");
    const guestInvite = await hostA.createInvite("guest");

    const bSnap = await collabB.joinSession({ inviteToken: collabInvite.inviteToken, displayName: "CollabB" });
    const cSnap = await guestC.joinSession({ inviteToken: guestInvite.inviteToken, displayName: "GuestC" });
    await flushMicrotasks();

    // Host-Recht gezielt an den Gast übertragen
    hostA.transferHost(cSnap.selfPeerId as string);
    await flushMicrotasks();

    const newHostSnapshot = guestC.getSnapshot();
    expect(newHostSnapshot.selfRole).toBe("host");
    expect(hostA.getSnapshot().selfRole).toBe("collaborator");
    expect(collabB.getSnapshot().selfRole).toBe("collaborator");
    expect(newHostSnapshot.peers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        peerId: aSnap.selfPeerId,
        role: "collaborator",
        displayName: "HostA",
      }),
      expect.objectContaining({
        peerId: bSnap.selfPeerId,
        role: "collaborator",
        displayName: "CollabB",
      }),
    ]));

    hostA.close();
    collabB.close();
    guestC.close();
  });

  it("kickt Peers sauber mit onSessionClosed-Event, unterdrückt Reconnect bei 4001/4003 und nutzt flüchtige Sidecar-URLs", async () => {
    const harness = createRelayTestHarness();
    const hostPcHolder = harness.createPcFactory();
    const peerPcHolder = harness.createPcFactory();

    const host = new P2pSessionTransport({
      sidecarBaseUrl: "https://relay.example.com",
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: hostPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });
    const peer = new P2pSessionTransport({
      sidecarBaseUrl: "https://relay.example.com",
      socketFactory: harness.createSocketFactory(),
      peerConnectionFactory: peerPcHolder.factory,
      runtimeConfig: null,
      heartbeatIntervalMs: 0,
      disabledOverride: false,
    });

    const closedEvents: CollabSessionClosedEvent[] = [];
    peer.onSessionClosed((evt) => closedEvents.push(evt));

    await host.startHostSession({ displayName: "Host" });
    const invite = await host.createInvite("guest");
    const peerSnap = await peer.joinSession({ inviteToken: invite.inviteToken, displayName: "Gast" });
    await flushMicrotasks();

    expect(harness.requestedUrls).toEqual([
      "wss://relay.example.com/ws-collab",
      "wss://relay.example.com/ws-collab",
    ]);

    host.kickPeer(peerSnap.selfPeerId as string, "kicked");
    await flushMicrotasks();

    expect(host.getSnapshot().peers).toHaveLength(0);
    expect(peer.getSnapshot().state).toBe("disconnected");
    expect(closedEvents).toHaveLength(1);
    expect(closedEvents[0].reason).toBe("kicked");

    // SignalingClient startet bei permanentem Close-Code 4001/4003 keinen Reconnect
    let openAttempts = 0;
    const states: string[] = [];
    const client = new SignalingClient({
      wsUrl: "wss://relay.example.com/ws-collab",
      disabledOverride: false,
      reconnectBaseDelayMs: 50,
      maxReconnectAttempts: 3,
      socketFactory: ({ onOpen, onClose }) => {
        openAttempts += 1;
        queueMicrotask(() => {
          onOpen();
          queueMicrotask(() => onClose(4001, "unauthorized"));
        });
        return {
          send: () => {},
          close: () => {},
        };
      },
    });
    client.onStateChange((s) => states.push(s));
    await client.connect();
    await flushMicrotasks();
    expect(openAttempts).toBe(1);
    expect(client.state).toBe("closed");
    expect(states).not.toContain("reconnecting");

    host.close();
    peer.close();
  });
});
