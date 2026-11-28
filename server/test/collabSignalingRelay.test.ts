import { createHash, randomBytes } from "node:crypto";
import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type {
  CollabHostChangedPayload,
  CollabInviteCreatedPayload,
  CollabJoinedSessionPayload,
  CollabPeerJoinedPayload,
  CollabPeerLeftPayload,
  CollabSessionClosedPayload,
  CollabSessionCreatedPayload,
  CollabSignalingErrorPayload,
  CollabSignalRelayedPayload,
} from "../../src/types/collab/signalingMessage.ts";

import {
  COLLAB_CONFIG_PATH,
  COLLAB_EVENT_CLOSE_SESSION,
  COLLAB_EVENT_CREATE_INVITE,
  COLLAB_EVENT_CREATE_SESSION,
  COLLAB_EVENT_ERROR,
  COLLAB_EVENT_HOST_CHANGED,
  COLLAB_EVENT_INVITE_CREATED,
  COLLAB_EVENT_INVITE_REVOKED,
  COLLAB_EVENT_JOIN_INVITE,
  COLLAB_EVENT_JOINED,
  COLLAB_EVENT_LEAVE,
  COLLAB_EVENT_PEER_JOINED,
  COLLAB_EVENT_PEER_LEFT,
  COLLAB_EVENT_PING,
  COLLAB_EVENT_PONG,
  COLLAB_EVENT_REVOKE_INVITE,
  COLLAB_EVENT_SESSION_CLOSED,
  COLLAB_EVENT_SESSION_CREATED,
  COLLAB_EVENT_SIGNAL,
  COLLAB_EVENT_SIGNAL_RELAYED,
  COLLAB_EVENT_TRANSFER_HOST,
  COLLAB_WS_PATH,
  DEFAULT_COLLAB_INVITE_TTL_MS,
  DEFAULT_COLLAB_STUN_URLS,
} from "../../src/collab/collabEvents.ts";

import readCollabConfigFromEnv, { toPublicCollabRuntimeConfig } from "../collabConfig.ts";
import CollabSignalingRelay, {
  type CollabRelayClient,
  CollabSignalingError,
} from "../collabSignalingRelay.ts";
import { createStandaloneServer, type StandaloneServerHandle } from "../standaloneServer.ts";

function createMemoryClient(): {
  client: CollabRelayClient;
  events: Array<{ event: string; payload: unknown }>;
  closedWith: Array<{ code?: number; reason?: string }>;
} {
  const events: Array<{ event: string; payload: unknown }> = [];
  const closedWith: Array<{ code?: number; reason?: string }> = [];
  const client: CollabRelayClient = {
    send(event, payload) {
      events.push({ event, payload });
    },
    close(code, reason) {
      closedWith.push({ code, reason });
    },
  };
  return { client, events, closedWith };
}

function encodeClientWsFrame(opcode: number, payload: Buffer): Buffer {
  const maskKey = randomBytes(4);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) {
    masked[i] = payload[i] ^ maskKey[i & 3];
  }
  return Buffer.concat([header, maskKey, masked]);
}

function decodeServerWsFrames(buffer: Buffer): {
  frames: Array<{ opcode: number; payload: Buffer }>;
  rest: Buffer;
} {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let cursor = 0;

  while (buffer.length - cursor >= 2) {
    const opcode = buffer[cursor] & 0x0f;
    let len = buffer[cursor + 1] & 0x7f;
    let offset = cursor + 2;

    if (len === 126) {
      if (buffer.length - offset < 2) {
        break;
      }
      len = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buffer.length - offset < 8) {
        break;
      }
      len = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    if (buffer.length - offset < len) {
      break;
    }

    frames.push({
      opcode,
      payload: buffer.subarray(offset, offset + len),
    });
    cursor = offset + len;
  }

  return {
    frames,
    rest: buffer.subarray(cursor),
  };
}

function connectRawCollabWsClient(port: number, origin: string): Promise<{
  sendEnvelope: (event: string, payload?: unknown) => void;
  nextEnvelope: () => Promise<{ event: string; payload: unknown }>;
  waitForClose: () => Promise<void>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const wsKey = randomBytes(16).toString("base64");
    const expectedAccept = createHash("sha1")
      .update(`${wsKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    const socket = net.createConnection({ host: "127.0.0.1", port });
    let handshakeDone = false;
    let rawBuffer: Buffer = Buffer.alloc(0);
    const envelopeQueue: Array<{ event: string; payload: unknown }> = [];
    const envelopeWaiters: Array<(env: { event: string; payload: unknown }) => void> = [];
    const closeWaiters: Array<() => void> = [];
    let closed = false;

    const pushEnvelope = (env: { event: string; payload: unknown }) => {
      const waiter = envelopeWaiters.shift();
      if (waiter) {
        waiter(env);
      } else {
        envelopeQueue.push(env);
      }
    };

    socket.on("connect", () => {
      socket.write(
        [
          `GET ${COLLAB_WS_PATH} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          `Origin: ${origin}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${wsKey}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });

    socket.on("data", (chunk: Buffer) => {
      rawBuffer = Buffer.concat([rawBuffer, chunk]);
      if (!handshakeDone) {
        const marker = rawBuffer.indexOf("\r\n\r\n");
        if (marker === -1) {
          return;
        }
        const headerText = rawBuffer.subarray(0, marker).toString("utf-8");
        rawBuffer = rawBuffer.subarray(marker + 4);
        if (!headerText.startsWith("HTTP/1.1 101") || !headerText.includes(expectedAccept)) {
          socket.destroy();
          reject(new Error(`Handshake fehlgeschlagen: ${headerText}`));
          return;
        }
        handshakeDone = true;
        resolve({
          sendEnvelope(event, payload) {
            socket.write(encodeClientWsFrame(0x1, Buffer.from(JSON.stringify({ event, payload }), "utf-8")));
          },
          nextEnvelope() {
            const queued = envelopeQueue.shift();
            if (queued) {
              return Promise.resolve(queued);
            }
            return new Promise((res) => {
              envelopeWaiters.push(res);
            });
          },
          waitForClose() {
            if (closed) {
              return Promise.resolve();
            }
            return new Promise((res) => {
              closeWaiters.push(res);
            });
          },
          close() {
            socket.write(encodeClientWsFrame(0x8, Buffer.alloc(0)));
            socket.end();
          },
        });
      }

      if (handshakeDone && rawBuffer.length > 0) {
        const decoded = decodeServerWsFrames(rawBuffer);
        rawBuffer = decoded.rest;
        for (const frame of decoded.frames) {
          if (frame.opcode === 0x1) {
            pushEnvelope(JSON.parse(frame.payload.toString("utf-8")) as { event: string; payload: unknown });
          } else if (frame.opcode === 0x9) {
            socket.write(encodeClientWsFrame(0xa, frame.payload));
          } else if (frame.opcode === 0x8) {
            socket.end();
          }
        }
      }
    });

    socket.on("close", () => {
      closed = true;
      for (const waiter of closeWaiters.splice(0)) {
        waiter();
      }
    });

    socket.on("error", (error) => {
      if (!handshakeDone) {
        reject(error);
      }
    });
  });
}

describe("collabConfig", () => {
  it("filtert TURN-URLs in Ausbaustufe 1 heraus und verbirgt COLLAB_ACCESS_KEY in der öffentlichen Config", () => {
    const config = readCollabConfigFromEnv({
      COLLAB_STUN_URLS: "turn:relay.example.com:3478, stun:stun.example.org:3478, stuns:stun2.example.org:5349, invalid://foo",
      COLLAB_ACCESS_KEY: "super-secret-collab-key",
      COLLAB_INVITE_TTL_MS: "240000",
      COLLAB_GRACE_PERIOD_MS: "20000",
      COLLAB_MAX_SESSIONS: "12",
      COLLAB_MAX_PEERS_PER_SESSION: "8",
    });

    expect(config.stunUrls).toEqual(["stun:stun.example.org:3478", "stuns:stun2.example.org:5349"]);
    expect(config.accessKey).toBe("super-secret-collab-key");
    expect(config.inviteTtlMs).toBe(240000);
    expect(config.gracePeriodMs).toBe(20000);
    expect(config.maxSessions).toBe(12);
    expect(config.maxPeersPerSession).toBe(8);

    const publicConfig = toPublicCollabRuntimeConfig(config);
    expect(publicConfig).toEqual({
      stunUrls: ["stun:stun.example.org:3478", "stuns:stun2.example.org:5349"],
      inviteTtlMs: 240000,
      gracePeriodMs: 20000,
      authRequired: true,
      maxPeersPerSession: 8,
    });
    expect(JSON.stringify(publicConfig)).not.toContain("super-secret-collab-key");
  });

  it("fällt bei fehlenden oder reinen TURN-Angaben auf Standard-STUN-Server zurück", () => {
    const config = readCollabConfigFromEnv({
      COLLAB_STUN_URLS: "turn:only-turn.example.com:3478",
    });
    expect(config.stunUrls).toEqual([...DEFAULT_COLLAB_STUN_URLS]);
    expect(config.inviteTtlMs).toBe(DEFAULT_COLLAB_INVITE_TTL_MS);
    expect(toPublicCollabRuntimeConfig(config).authRequired).toBe(false);
  });
});

describe("CollabSignalingRelay (flüchtiger In-Memory-Signaling-Relay)", () => {
  it("schützt create-session über COLLAB_ACCESS_KEY, während Gäste ohne Secret per Invite-Token beitreten", () => {
    let nowMs = 1_000_000;
    const relay = new CollabSignalingRelay({
      accessKey: "netcup-secret",
      maxSessions: 2,
      maxPeersPerSession: 3,
      now: () => nowMs,
    });

    const host = createMemoryClient();
    expect(() => relay.createSession(host.client, { accessKey: "falsch" })).toThrow(CollabSignalingError);
    try {
      relay.createSession(host.client, { accessKey: "falsch" });
    } catch (error) {
      expect((error as CollabSignalingError).code).toBe("unauthorized");
    }

    const session = relay.createSession(host.client, { accessKey: "netcup-secret", displayName: "Host" });
    expect(session.role).toBe("host");
    expect(session.inviteTtlMs).toBe(DEFAULT_COLLAB_INVITE_TTL_MS);

    const guestInvite = relay.createInvite(host.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      role: "guest",
      tokenProof: "hmac-proof-guest",
    });
    expect(guestInvite.expiresAt).toBe(nowMs + DEFAULT_COLLAB_INVITE_TTL_MS);

    // Mehrere Gäste können denselben 5-Minuten-Link ohne Server-Secret nutzen
    const guest1 = createMemoryClient();
    const guest2 = createMemoryClient();
    const joined1 = relay.joinWithInvite(guest1.client, { inviteToken: guestInvite.inviteToken, displayName: "Anna" });
    const joined2 = relay.joinWithInvite(guest2.client, { inviteToken: guestInvite.inviteToken, displayName: "Ben" });

    expect(joined1.role).toBe("guest");
    expect(joined2.role).toBe("guest");

    const hostJoinNotices = host.events
      .filter((entry) => entry.event === COLLAB_EVENT_PEER_JOINED)
      .map((entry) => entry.payload as CollabPeerJoinedPayload);
    expect(hostJoinNotices).toHaveLength(2);
    expect(hostJoinNotices[0]).toMatchObject({
      peerId: joined1.peerId,
      role: "guest",
      inviteToken: guestInvite.inviteToken,
      tokenProof: "hmac-proof-guest",
      displayName: "Anna",
    });

    // Peer-Limit (maxPeersPerSession = 3 -> Host + 2 Gäste) blockiert vierten Teilnehmer
    const guest3 = createMemoryClient();
    expect(() => relay.joinWithInvite(guest3.client, { inviteToken: guestInvite.inviteToken })).toThrow(
      CollabSignalingError,
    );

    // Ablauf nach 5 Minuten macht neue Einlösungen ungültig, aktive Teilnehmer bleiben verbunden
    nowMs += DEFAULT_COLLAB_INVITE_TTL_MS;
    relay.leaveSession(guest2.client, "left");
    try {
      relay.joinWithInvite(guest3.client, { inviteToken: guestInvite.inviteToken });
      expect.unreachable("Abgelaufener Link muss abgelehnt werden");
    } catch (error) {
      expect((error as CollabSignalingError).code).toBe("invite-expired");
    }
    expect(relay.getStatus().activePeers).toBe(2);
  });

  it("erzwingt Session-Limit, Token-Widerruf und Stern-Topologie beim Signal-Forwarding", () => {
    const relay = new CollabSignalingRelay({ maxSessions: 1 });
    const hostA = createMemoryClient();
    const hostB = createMemoryClient();

    const sessionA = relay.createSession(hostA.client);
    try {
      relay.createSession(hostB.client);
      expect.unreachable("Session-Limit muss greifen");
    } catch (error) {
      expect((error as CollabSignalingError).code).toBe("session-limit-reached");
    }

    const collabInvite = relay.createInvite(hostA.client, {
      sessionId: sessionA.sessionId,
      hostSecret: sessionA.hostSecret,
      role: "collaborator",
    });
    const guestInvite = relay.createInvite(hostA.client, {
      sessionId: sessionA.sessionId,
      hostSecret: sessionA.hostSecret,
      role: "guest",
    });

    const peer1 = createMemoryClient();
    const peer2 = createMemoryClient();
    const joined1 = relay.joinWithInvite(peer1.client, { inviteToken: collabInvite.inviteToken });
    const joined2 = relay.joinWithInvite(peer2.client, { inviteToken: guestInvite.inviteToken });

    // Peer-zu-Peer-Signaling ohne Host-Beteiligung ist in der Stern-Topologie verboten
    try {
      relay.relaySignal(peer1.client, {
        targetPeerId: joined2.peerId,
        signalType: "offer",
        data: { sdp: "illegal" },
      });
      expect.unreachable("Nicht-Host-Signaling muss verboten sein");
    } catch (error) {
      expect((error as CollabSignalingError).code).toBe("forbidden");
    }

    // Host <-> Peer Signaling funktioniert bidirektional
    relay.relaySignal(peer1.client, {
      targetPeerId: sessionA.peerId,
      signalType: "offer",
      data: { type: "offer", sdp: "v=0" },
    });
    const hostSignal = hostA.events.find((e) => e.event === COLLAB_EVENT_SIGNAL_RELAYED)?.payload as CollabSignalRelayedPayload;
    expect(hostSignal).toEqual({
      sessionId: sessionA.sessionId,
      fromPeerId: joined1.peerId,
      signalType: "offer",
      data: { type: "offer", sdp: "v=0" },
    });

    // Widerruf blockiert neue Beitritte mit 'invite-revoked', bestehender Peer bleibt aktiv
    relay.revokeInvite(hostA.client, {
      sessionId: sessionA.sessionId,
      hostSecret: sessionA.hostSecret,
      inviteToken: collabInvite.inviteToken,
    });
    const peer3 = createMemoryClient();
    try {
      relay.joinWithInvite(peer3.client, { inviteToken: collabInvite.inviteToken });
      expect.unreachable("Widerrufener Link muss abgelehnt werden");
    } catch (error) {
      expect((error as CollabSignalingError).code).toBe("invite-revoked");
    }
    expect(relay.getStatus().activePeers).toBe(3);
  });

  it("unterstützt autorisierten Host-Wechsel mit Secret-Rotation und Entzug alter Host-Rechte", () => {
    const relay = new CollabSignalingRelay();
    const oldHost = createMemoryClient();
    const collab = createMemoryClient();
    const guest = createMemoryClient();

    const session = relay.createSession(oldHost.client);
    const collabInvite = relay.createInvite(oldHost.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      role: "collaborator",
    });
    const guestInvite = relay.createInvite(oldHost.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      role: "guest",
    });

    const collabJoined = relay.joinWithInvite(collab.client, { inviteToken: collabInvite.inviteToken, displayName: "Berta" });
    const guestJoined = relay.joinWithInvite(guest.client, { inviteToken: guestInvite.inviteToken, displayName: "Carla" });

    // Ein normaler Teilnehmer darf keinen Host-Wechsel erzwingen
    expect(() => relay.transferHost(collab.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      targetPeerId: collabJoined.peerId,
    })).toThrow(CollabSignalingError);

    relay.transferHost(oldHost.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      targetPeerId: collabJoined.peerId,
    });

    const newHostChange = collab.events.find((e) => e.event === COLLAB_EVENT_HOST_CHANGED)?.payload as CollabHostChangedPayload;
    const oldHostChange = oldHost.events.find((e) => e.event === COLLAB_EVENT_HOST_CHANGED)?.payload as CollabHostChangedPayload;
    const guestChange = guest.events.find((e) => e.event === COLLAB_EVENT_HOST_CHANGED)?.payload as CollabHostChangedPayload;

    expect(newHostChange.newHostPeerId).toBe(collabJoined.peerId);
    expect(newHostChange.hostSecret).toBeTruthy();
    expect(newHostChange.hostSecret).not.toBe(session.hostSecret);
    expect(newHostChange.peerIds?.sort()).toEqual([session.peerId, guestJoined.peerId].sort());
    expect(newHostChange.peers).toEqual(expect.arrayContaining([
      { peerId: session.peerId, role: "collaborator" },
      { peerId: guestJoined.peerId, role: "guest", displayName: "Carla" },
    ]));
    expect(oldHostChange.hostSecret).toBeUndefined();
    expect(guestChange.hostSecret).toBeUndefined();

    // Alter Host hat keine Host-Rechte mehr
    expect(() => relay.createInvite(oldHost.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      role: "guest",
    })).toThrow(CollabSignalingError);

    // Neuer Host kann sofort Kicks und neue Invites mit neuem hostSecret ausführen
    relay.kickPeer(collab.client, {
      sessionId: session.sessionId,
      hostSecret: newHostChange.hostSecret as string,
      targetPeerId: guestJoined.peerId,
      reason: "removed-by-new-host",
    });
    expect(guest.closedWith[0]).toEqual({ code: 4003, reason: "removed-by-new-host" });

    // Neuer Host verlässt die Session -> Session schließt für alle verbleibenden Teilnehmer
    relay.closeSession(collab.client, {
      sessionId: session.sessionId,
      hostSecret: newHostChange.hostSecret as string,
      reason: "session-ended",
    });
    const oldHostClosed = oldHost.events.find((e) => e.event === COLLAB_EVENT_SESSION_CLOSED)?.payload as CollabSessionClosedPayload;
    expect(oldHostClosed).toEqual({ sessionId: session.sessionId, reason: "session-ended" });
    expect(relay.getStatus().activeSessions).toBe(0);
  });

  it("erlaubt Host-Wechsel ausdrücklich auch an einen Gast unter Erhalt aller Peer-Metadaten", () => {
    const relay = new CollabSignalingRelay({ accessKey: "initial-host-only-key" });
    const initialHost = createMemoryClient();
    const collab = createMemoryClient();
    const guest = createMemoryClient();

    const session = relay.createSession(initialHost.client, {
      accessKey: "initial-host-only-key",
      displayName: "InitialHost",
    });
    const collabInvite = relay.createInvite(initialHost.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      role: "collaborator",
    });
    const guestInvite = relay.createInvite(initialHost.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      role: "guest",
    });

    const collabJoined = relay.joinWithInvite(collab.client, {
      inviteToken: collabInvite.inviteToken,
      displayName: "Mitentwickler",
    });
    const guestJoined = relay.joinWithInvite(guest.client, {
      inviteToken: guestInvite.inviteToken,
      displayName: "Gast-Admin",
    });

    relay.transferHost(initialHost.client, {
      sessionId: session.sessionId,
      hostSecret: session.hostSecret,
      targetPeerId: guestJoined.peerId,
    });

    const guestHostEvent = guest.events.find((e) => e.event === COLLAB_EVENT_HOST_CHANGED)?.payload as CollabHostChangedPayload;
    expect(guestHostEvent.newHostPeerId).toBe(guestJoined.peerId);
    expect(guestHostEvent.hostSecret).toBeTruthy();
    expect(guestHostEvent.peers).toEqual(expect.arrayContaining([
      { peerId: session.peerId, role: "collaborator", displayName: "InitialHost" },
      { peerId: collabJoined.peerId, role: "collaborator", displayName: "Mitentwickler" },
    ]));

    // Neuer Host (zuvor Gast) kann ohne COLLAB_ACCESS_KEY neue Einladungen erzeugen
    const followUpInvite = relay.createInvite(guest.client, {
      sessionId: session.sessionId,
      hostSecret: guestHostEvent.hostSecret as string,
      role: "guest",
    });
    expect(followUpInvite.role).toBe("guest");
  });
});

describe("StandaloneServer + /ws-collab End-to-End", () => {
  const activeServers: StandaloneServerHandle[] = [];

  afterEach(async () => {
    while (activeServers.length > 0) {
      const handle = activeServers.pop();
      if (handle) {
        await handle.close();
      }
    }
  });

  it("liefert /__collab/config, schützt Origin/COLLAB_ACCESS_KEY und vermittelt WebRTC-Signaling & Host-Wechsel", async () => {
    const server = await createStandaloneServer({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: ["https://afe-gmdg.de"],
      heartbeatIntervalMs: 0,
      collab: {
        accessKey: "collab-top-secret",
        stunUrls: ["stun:stun.example.net:3478", "turn:ignored.example.net:3478"],
        maxSessions: 10,
        maxPeersPerSession: 6,
      },
    });
    activeServers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const configRes = await fetch(`${baseUrl}${COLLAB_CONFIG_PATH}`);
    expect(configRes.status).toBe(200);
    await expect(configRes.json()).resolves.toEqual({
      stunUrls: ["stun:stun.example.net:3478"],
      inviteTtlMs: DEFAULT_COLLAB_INVITE_TTL_MS,
      gracePeriodMs: 15000,
      authRequired: true,
      maxPeersPerSession: 6,
      serverVersion: expect.any(String),
    });

    // Unerlaubter Origin wird abgewiesen
    await expect(connectRawCollabWsClient(server.port, "https://attacker.example")).rejects.toThrow(/403/);

    // Falscher Access-Key beim Session-Start wird abgelehnt
    const unauthWs = await connectRawCollabWsClient(server.port, "https://afe-gmdg.de");
    unauthWs.sendEnvelope(COLLAB_EVENT_CREATE_SESSION, { accessKey: "wrong" });
    const unauthErr = await unauthWs.nextEnvelope();
    expect(unauthErr.event).toBe(COLLAB_EVENT_ERROR);
    expect((unauthErr.payload as CollabSignalingErrorPayload).code).toBe("unauthorized");
    await unauthWs.waitForClose();

    // Host erstellt Session
    const hostWs = await connectRawCollabWsClient(server.port, "https://afe-gmdg.de");
    hostWs.sendEnvelope(COLLAB_EVENT_CREATE_SESSION, {
      accessKey: "collab-top-secret",
      displayName: "Andreas",
    });
    const createdEnv = await hostWs.nextEnvelope();
    expect(createdEnv.event).toBe(COLLAB_EVENT_SESSION_CREATED);
    const created = createdEnv.payload as CollabSessionCreatedPayload;

    // Host erzeugt Einladungslink für Kollaborateur
    hostWs.sendEnvelope(COLLAB_EVENT_CREATE_INVITE, {
      sessionId: created.sessionId,
      hostSecret: created.hostSecret,
      role: "collaborator",
      tokenProof: "sig-v1",
    });
    const inviteEnv = await hostWs.nextEnvelope();
    expect(inviteEnv.event).toBe(COLLAB_EVENT_INVITE_CREATED);
    const invite = inviteEnv.payload as CollabInviteCreatedPayload;

    // Teilnehmer tritt ohne COLLAB_ACCESS_KEY nur über inviteToken bei
    const peerWs = await connectRawCollabWsClient(server.port, "https://afe-gmdg.de");
    peerWs.sendEnvelope(COLLAB_EVENT_JOIN_INVITE, {
      inviteToken: invite.inviteToken,
      displayName: "Gast-Bob",
    });
    const joinedEnv = await peerWs.nextEnvelope();
    expect(joinedEnv.event).toBe(COLLAB_EVENT_JOINED);
    const joined = joinedEnv.payload as CollabJoinedSessionPayload;
    expect(joined.role).toBe("collaborator");

    const peerJoinedEnv = await hostWs.nextEnvelope();
    expect(peerJoinedEnv.event).toBe(COLLAB_EVENT_PEER_JOINED);
    expect((peerJoinedEnv.payload as CollabPeerJoinedPayload).tokenProof).toBe("sig-v1");

    // Ping / Pong
    peerWs.sendEnvelope(COLLAB_EVENT_PING, {});
    const pongEnv = await peerWs.nextEnvelope();
    expect(pongEnv.event).toBe(COLLAB_EVENT_PONG);

    // SDP Offer / Answer / ICE-Candidate Forwarding
    hostWs.sendEnvelope(COLLAB_EVENT_SIGNAL, {
      targetPeerId: joined.peerId,
      signalType: "offer",
      data: { sdp: "offer-sdp" },
    });
    const offerEnv = await peerWs.nextEnvelope();
    expect(offerEnv.event).toBe(COLLAB_EVENT_SIGNAL_RELAYED);
    expect((offerEnv.payload as CollabSignalRelayedPayload).data).toEqual({ sdp: "offer-sdp" });

    peerWs.sendEnvelope(COLLAB_EVENT_SIGNAL, {
      targetPeerId: created.peerId,
      signalType: "ice-candidate",
      data: { candidate: "cand:1" },
    });
    const iceEnv = await hostWs.nextEnvelope();
    expect(iceEnv.event).toBe(COLLAB_EVENT_SIGNAL_RELAYED);
    expect((iceEnv.payload as CollabSignalRelayedPayload).signalType).toBe("ice-candidate");

    // Host-Wechsel über WebSocket
    hostWs.sendEnvelope(COLLAB_EVENT_TRANSFER_HOST, {
      sessionId: created.sessionId,
      hostSecret: created.hostSecret,
      targetPeerId: joined.peerId,
    });
    const hostChangedOld = await hostWs.nextEnvelope();
    const hostChangedNew = await peerWs.nextEnvelope();
    expect(hostChangedOld.event).toBe(COLLAB_EVENT_HOST_CHANGED);
    expect(hostChangedNew.event).toBe(COLLAB_EVENT_HOST_CHANGED);
    expect((hostChangedNew.payload as CollabHostChangedPayload).hostSecret).toBeTruthy();

    // Widerruf & Leave prüfen
    peerWs.sendEnvelope(COLLAB_EVENT_CREATE_INVITE, {
      sessionId: created.sessionId,
      hostSecret: (hostChangedNew.payload as CollabHostChangedPayload).hostSecret,
      role: "guest",
    });
    const secondInvite = (await peerWs.nextEnvelope()).payload as CollabInviteCreatedPayload;
    peerWs.sendEnvelope(COLLAB_EVENT_REVOKE_INVITE, {
      sessionId: created.sessionId,
      hostSecret: (hostChangedNew.payload as CollabHostChangedPayload).hostSecret,
      inviteToken: secondInvite.inviteToken,
    });
    expect((await peerWs.nextEnvelope()).event).toBe(COLLAB_EVENT_INVITE_REVOKED);

    hostWs.sendEnvelope(COLLAB_EVENT_LEAVE, { reason: "done" });
    const leftEnv = await peerWs.nextEnvelope();
    expect(leftEnv.event).toBe(COLLAB_EVENT_PEER_LEFT);
    expect((leftEnv.payload as CollabPeerLeftPayload).peerId).toBe(created.peerId);

    peerWs.sendEnvelope(COLLAB_EVENT_CLOSE_SESSION, {
      sessionId: created.sessionId,
      hostSecret: (hostChangedNew.payload as CollabHostChangedPayload).hostSecret,
    });
    expect((await peerWs.nextEnvelope()).event).toBe(COLLAB_EVENT_SESSION_CLOSED);

    hostWs.close();
    peerWs.close();
  });
});
