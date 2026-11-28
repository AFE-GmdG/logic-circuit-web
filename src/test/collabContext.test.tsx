import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import CollabContext, { type CollabContextType } from "../contexts/collabContext";
import CollabContextProvider from "../contexts/collabContext/provider";
import LibraryContext, { type LibraryContextType } from "../contexts/libraryContext";
import LibraryContextProvider from "../contexts/libraryContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CollabIceServer from "../types/collab/iceConfig";
import { LIBRARY_FORMAT, type LibraryPersistenceState } from "../types/storage/circuitLibrary";

import CollabSignalingRelay, { type CollabRelayClient } from "../../server/collabSignalingRelay";
import CollabModelSyncController from "../collab/collabModelSyncController";
import CollabSessionController from "../collab/collabSessionController";
import type { CollabDataChannelLike, CollabDataChannelReadyState } from "../collab/dataChannelTransport";
import P2pSessionTransport, {
  type CollabIceCandidateLike,
  type CollabPeerConnectionLike,
  type CollabSessionDescriptionLike,
  type PeerConnectionFactory,
} from "../collab/p2pSessionTransport";
import type { CollabSignalingSocketFactory } from "../collab/signalingClient";
import { createDefaultLogicalCircuit, createEmptyCircuitProject } from "../utils/circuitLayout";
import type { CollabRuntimeConfigPreflightResult } from "../utils/collabIceConfig";
import { loadCollabDisplayName, saveCollabAccessKey } from "../utils/collabStorage";
import { buildCircuitLibraryDocument } from "../utils/libraryStorage";
import { loadSidecarBaseUrl, saveSidecarBaseUrl } from "../utils/sidecarStorage";
import { serializeLogicalCircuitToNative } from "../utils/storage/nativeProjectWriter";

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

  addIceCandidate(): Promise<void> {
    return Promise.resolve();
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

function createControllerHarness(options: { accessKey?: string; now?: () => number; maxSessions?: number } = {}) {
  const relay = new CollabSignalingRelay({
    accessKey: options.accessKey,
    maxSessions: options.maxSessions,
    now: options.now,
  });
  let nextPcId = 1;
  const requestedSidecars: Array<string | undefined> = [];

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

  const createController = (pageUrl = "https://afe-gmdg.github.io/logic-circuit-web/") => {
    const pcs: MockPeerConnection[] = [];
    const pcFactory: PeerConnectionFactory = (iceServers) => {
      const pc = new MockPeerConnection(nextPcId++, iceServers);
      pcs.push(pc);
      return pc;
    };

    const controller = new CollabSessionController({
      disabledOverride: false,
      customOnlyOverride: false,
      now: options.now,
      getPageUrl: () => pageUrl,
      preflightFetcher: async ({ baseUrl }): Promise<CollabRuntimeConfigPreflightResult> => {
        const effective = baseUrl ?? (loadSidecarBaseUrl() || "http://localhost:3001");
        requestedSidecars.push(baseUrl);
        return {
          ok: true,
          effectiveBaseUrl: effective,
          authRequired: Boolean(options.accessKey),
          config: {
            stunUrls: ["stun:stun.example.org:3478"],
            inviteTtlMs: 300_000,
            gracePeriodMs: 15_000,
            authRequired: Boolean(options.accessKey),
            maxPeersPerSession: 16,
          },
        };
      },
      transportFactory: (transportOpts) => new P2pSessionTransport({
        ...transportOpts,
        socketFactory: createSocketFactory(),
        peerConnectionFactory: pcFactory,
        heartbeatIntervalMs: 0,
        now: options.now,
      }),
    });

    return { controller, pcs };
  };

  return { relay, requestedSidecars, createController };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((res) => setTimeout(res, 15));
}

describe("CollabSessionController & CollabContextProvider (US-029 / T-095)", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      },
      location: {
        protocol: "https:",
        host: "afe-gmdg.github.io",
        origin: "https://afe-gmdg.github.io",
        pathname: "/logic-circuit-web/",
        search: "",
        hash: "",
      },
      history: {
        replaceState: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  it("startet Host-Session mit Pflichtnamen & COLLAB_ACCESS_KEY, erzeugt 5-Minuten-Links und hält Hash-Sidecar flüchtig", async () => {
    let nowMs = 1_000_000;
    const harness = createControllerHarness({ accessKey: "secret-key", now: () => nowMs });
    const hostHolder = harness.createController("https://afe-gmdg.github.io/logic-circuit-web/");
    const guestHolder = harness.createController("https://afe-gmdg.github.io/logic-circuit-web/");

    // Leerer Name oder fehlender COLLAB_ACCESS_KEY werden abgewiesen
    expect(await hostHolder.controller.startHostSession({ displayName: "   " })).toBe(false);
    expect(hostHolder.controller.getState().lastError?.code).toBe("invalid-display-name");

    expect(await hostHolder.controller.startHostSession({ displayName: "Andreas" })).toBe(false);
    expect(hostHolder.controller.getState().lastError?.code).toBe("unauthorized");

    saveCollabAccessKey("secret-key");
    saveSidecarBaseUrl("https://local-saved-sidecar.example.com");

    expect(await hostHolder.controller.startHostSession({ displayName: "  Andreas  " })).toBe(true);
    expect(loadCollabDisplayName()).toBe("Andreas");
    expect(hostHolder.controller.getState().isHost).toBe(true);
    expect(hostHolder.controller.getState().isMcpBlockedByCollab).toBe(false);

    const invite = await hostHolder.controller.createInviteLink("guest");
    expect(invite).not.toBeNull();
    expect(invite!.url).toContain("#collabInvite=");
    expect(invite!.url).toContain("sidecar=https%3A%2F%2Flocal-saved-sidecar.example.com");

    // Hash-Beitritt mit abweichendem Remote-Sidecar überschreibt niemals den gespeicherten BYO-Sidecar
    const parsed = guestHolder.controller.ingestHash(
      `#collabInvite=${invite!.inviteToken}&sidecar=${encodeURIComponent("https://ephemeral-relay.example.org")}`,
      { protocol: "https:", host: "afe-gmdg.github.io", origin: "https://afe-gmdg.github.io" },
    );
    expect(parsed?.isRemoteSidecar).toBe(true);

    // Gast benötigt keinen COLLAB_ACCESS_KEY
    window.localStorage.removeItem("logicCircuit.collab.accessKey");
    expect(await guestHolder.controller.joinSession({
      inviteToken: parsed!.inviteToken,
      displayName: "Andreas",
      sidecarBaseUrl: parsed!.sidecarUrl ?? undefined,
      isEphemeralSidecar: parsed!.isRemoteSidecar,
    })).toBe(true);

    expect(guestHolder.controller.getState().isEphemeralSidecar).toBe(true);
    expect(guestHolder.controller.getState().activeSidecarUrl).toBe("https://ephemeral-relay.example.org");
    expect(loadSidecarBaseUrl()).toBe("https://local-saved-sidecar.example.com");
    expect(guestHolder.controller.getState().isMcpBlockedByCollab).toBe(true);

    await flushMicrotasks();
    pairMockPeerConnections(hostHolder.pcs[0], guestHolder.pcs[0]);
    await flushMicrotasks();

    // Doppelter Anzeigename wird automatisch disambiguiert ("Andreas" + "Andreas (2)")
    expect(hostHolder.controller.getState().participants.map((p) => p.displayName)).toEqual([
      "Andreas",
      "Andreas (2)",
    ]);
    expect(guestHolder.controller.getState().participants.map((p) => p.displayName)).toEqual([
      "Andreas",
      "Andreas (2)",
    ]);

    // TTL-Ablauf räumt aktive Einladungslinks auf
    nowMs += 300_001;
    hostHolder.controller.pruneExpiredInvites();
    expect(hostHolder.controller.getState().activeInvites).toHaveLength(0);

    hostHolder.controller.dispose();
    guestHolder.controller.dispose();
  });

  it("unterstützt Moderation (Rolle, Namenssperre, Hand heben, Kick) und Host-Handover auch an Gäste", async () => {
    const harness = createControllerHarness();
    const hostHolder = harness.createController();
    const guestHolder = harness.createController();
    const collabHolder = harness.createController();

    await hostHolder.controller.startHostSession({ displayName: "Stefan" });
    const guestInvite = await hostHolder.controller.createInviteLink("guest");
    const collabInvite = await hostHolder.controller.createInviteLink("collaborator");

    await guestHolder.controller.joinSession({
      inviteToken: guestInvite!.inviteToken,
      displayName: "Berta",
    });
    await collabHolder.controller.joinSession({
      inviteToken: collabInvite!.inviteToken,
      displayName: "Anton",
    });
    await flushMicrotasks();

    const guestPc = guestHolder.pcs[0];
    const collabPc = collabHolder.pcs[0];
    const hostPcForGuest = hostHolder.pcs.find((pc) => pc.localDescription?.sdp === guestPc.remoteDescription?.sdp)!;
    const hostPcForCollab = hostHolder.pcs.find((pc) => pc.localDescription?.sdp === collabPc.remoteDescription?.sdp)!;
    pairMockPeerConnections(hostPcForGuest, guestPc);
    pairMockPeerConnections(hostPcForCollab, collabPc);
    await flushMicrotasks();

    // Sortierung: Host -> Kollaborateur -> Gast
    expect(hostHolder.controller.getState().participants.map((p) => `${p.role}:${p.displayName}`)).toEqual([
      "host:Stefan",
      "collaborator:Anton",
      "guest:Berta",
    ]);

    // Teilnehmer hebt Hand, Host senkt sie wieder
    await guestHolder.controller.toggleHandRaised(true);
    await flushMicrotasks();
    expect(hostHolder.controller.getState().raisedHandCount).toBe(1);
    const guestId = guestHolder.controller.getState().selfPeerId!;
    await hostHolder.controller.lowerParticipantHand(guestId);
    await flushMicrotasks();
    expect(guestHolder.controller.getState().selfParticipant?.handRaised).toBe(false);

    // Bad-Word-Moderation mit Namenssperre blockiert eigenmächtiges Zurückbenennen
    await hostHolder.controller.moderateParticipantName(guestId, {
      displayName: "Moderiert",
      nameLocked: true,
    });
    await flushMicrotasks();
    expect(guestHolder.controller.getState().selfParticipant?.nameLocked).toBe(true);
    expect(await guestHolder.controller.renameSelf("AlterName")).toBe(false);
    expect(guestHolder.controller.getState().lastRejectionMessage).toContain("gesperrt");

    // Host-Handover explizit an den Gast -> alter Host wird Kollaborateur & MCP-gesperrt, Gast wird Host
    await guestHolder.controller.toggleHandRaised(true);
    await flushMicrotasks();
    expect(hostHolder.controller.transferHostRole(guestId)).toBe(true);
    await flushMicrotasks();

    expect(guestHolder.controller.getState().isHost).toBe(true);
    expect(guestHolder.controller.getState().isMcpBlockedByCollab).toBe(false);
    expect(hostHolder.controller.getState().selfRole).toBe("collaborator");
    expect(hostHolder.controller.getState().isMcpBlockedByCollab).toBe(true);

    // Neuer Host (vormals Gast) kann Rollen umschalten, neue Links erzeugen und kicken
    const newInvite = await guestHolder.controller.createInviteLink("collaborator");
    expect(newInvite).not.toBeNull();
    expect(await guestHolder.controller.revokeInviteLink(newInvite!.inviteToken)).toBe(true);

    const collabId = collabHolder.controller.getState().selfPeerId!;
    await guestHolder.controller.kickParticipant(collabId, "kicked");
    await flushMicrotasks();
    expect(collabHolder.controller.getState().isInSession).toBe(false);
    expect(collabHolder.controller.getState().sessionClosedNotice?.reason).toBe("kicked");

    guestHolder.controller.dispose();
    hostHolder.controller.dispose();
    collabHolder.controller.dispose();
  });

  it("behandelt 429/503/SIDECAR_CUSTOM_ONLY-Fehler sauber, bleibt bei DISABLE_COLLAB komplett stumm und rendert Provider", async () => {
    const fetchSpy = vi.fn();
    const transportFactorySpy = vi.fn();

    const disabledController = new CollabSessionController({
      disabledOverride: true,
      preflightFetcher: async () => {
        fetchSpy();
        return { ok: false, effectiveBaseUrl: null, error: { code: "disabled", message: "off" } };
      },
      transportFactory: (opts) => {
        transportFactorySpy();
        return new P2pSessionTransport(opts);
      },
    });
    expect(disabledController.getState().isDisabled).toBe(true);
    expect(await disabledController.startHostSession({ displayName: "Max" })).toBe(false);
    expect(disabledController.ingestHash("#collabInvite=AbCdEfGhIjKlMnOpQrSt")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transportFactorySpy).not.toHaveBeenCalled();

    const rateLimitController = new CollabSessionController({
      disabledOverride: false,
      preflightFetcher: async () => ({
        ok: false,
        effectiveBaseUrl: "https://relay.example.com",
        error: {
          code: "rate-limited",
          message: "Rate-Limit",
          httpStatus: 429,
          retryAfterSeconds: 30,
        },
      }),
    });
    expect(await rateLimitController.startHostSession({ displayName: "Max" })).toBe(false);
    expect(rateLimitController.getState().lastError).toMatchObject({
      code: "rate-limited",
      httpStatus: 429,
      retryAfterSeconds: 30,
    });

    const pagesMissingSidecar = new CollabSessionController({
      disabledOverride: false,
      customOnlyOverride: true,
      preflightFetcher: async () => ({
        ok: false,
        effectiveBaseUrl: null,
        error: {
          code: "sidecar-required",
          message: "BYO SideCar erforderlich",
          requiresSidecarSetup: true,
        },
      }),
    });
    expect(pagesMissingSidecar.getState().customSidecarRequired).toBe(true);
    expect(await pagesMissingSidecar.startHostSession({ displayName: "Max" })).toBe(false);
    expect(pagesMissingSidecar.getState().lastError?.requiresSidecarSetup).toBe(true);

    // React Provider Rendering & Context-Konsum prüfen
    let capturedContext: CollabContextType | undefined;
    const Probe: React.FC = () => {
      capturedContext = React.useContext(CollabContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider>
        <CollabContextProvider disabledOverride>
          <Probe />
        </CollabContextProvider>
      </CircuitContextProvider>,
    );

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.isDisabled).toBe(true);
    expect(capturedContext!.isInSession).toBe(false);
    expect(capturedContext!.isMcpBlockedByCollab).toBe(false);
  });

  it("synchronisiert reale CircuitContext-Mutationen, Projektwechsel und Bibliotheks-Isolation über P2P-Signaling", async () => {
    const harness = createControllerHarness();
    const hostHolder = harness.createController();
    const collabHolder = harness.createController();

    const mountWorkspace = (initialName: string, libraryState?: LibraryPersistenceState) => {
      let circuitCtx!: React.ContextType<typeof CircuitContext>;
      let libraryCtx: LibraryContextType | undefined;

      const Probe: React.FC = () => {
        circuitCtx = React.useContext(CircuitContext);
        libraryCtx = React.useContext(LibraryContext);
        return null;
      };

      const inner = (
        <CircuitContextProvider initialProject={createEmptyCircuitProject(initialName, "Main")}>
          {libraryState ? (
            <SimulationContextProvider>
              <LibraryContextProvider initialPersistenceState={libraryState} skipInitialLoad>
                <Probe />
              </LibraryContextProvider>
            </SimulationContextProvider>
          ) : (
            <Probe />
          )}
        </CircuitContextProvider>
      );

      renderToStaticMarkup(inner);
      return {
        getCircuit: () => circuitCtx,
        getLibrary: () => libraryCtx,
      };
    };

    const libLc = createDefaultLogicalCircuit("lib-circ-1", "LibGate", "Custom");
    const libDoc = buildCircuitLibraryDocument([
      serializeLogicalCircuitToNative(libLc, createEmptyCircuitProject("Temp", "Main")),
    ]);
    const libState: LibraryPersistenceState = {
      status: "synced",
      isReadOnly: false,
      fileName: "team.lclib",
      cachedAt: 1000,
      lastSyncedAt: 1000,
      document: { ...libDoc, format: LIBRARY_FORMAT },
    };

    const hostWs = mountWorkspace("HostStart", libState);
    const collabWs = mountWorkspace("CollabStart");

    const attachSync = (
      ws: ReturnType<typeof mountWorkspace>,
      controller: CollabSessionController,
    ) => {
      const sync = new CollabModelSyncController({
        transport: controller,
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
        },
      });
      ws.getCircuit().registerCollabSyncBridge?.({
        canMutateProject: () => sync.canMutateProject(),
        onLocalDeltaCommitted: (delta, proj, opts) => sync.submitLocalDelta(delta, proj, opts),
        onLocalMutation: (mutation) => sync.submitLocalMutation(mutation),
        onLocalProjectReplaced: (nextProj) => sync.notifyLocalProjectReplaced(nextProj),
      });
      return sync;
    };

    const hostSync = attachSync(hostWs, hostHolder.controller);
    const collabSync = attachSync(collabWs, collabHolder.controller);

    await hostHolder.controller.startHostSession({ displayName: "Host" });
    const invite = await hostHolder.controller.createInviteLink("collaborator");
    await collabHolder.controller.joinSession({
      inviteToken: invite!.inviteToken,
      displayName: "Kollaborateur",
    });

    await flushMicrotasks();
    pairMockPeerConnections(hostHolder.pcs[0], collabHolder.pcs[0]);
    await flushMicrotasks();
    await flushMicrotasks();

    // Kollaborateur erhält Initial-Snapshot
    expect(collabWs.getCircuit().project.project.name).toBe("HostStart");

    // Reale CircuitContext-Mutationen auf Kollaborateur -> Host synchronisiert zurück
    let addedSymId = "";
    React.act(() => {
      const sym = collabWs.getCircuit().addSymbol({ type: "and", name: "AND", inputCount: 2 }, { x: 8, y: 8 });
      addedSymId = sym.circuitSymbolId;
      collabWs.getCircuit().moveEntities({ symbolIds: [addedSymId], dx: 4, dy: 2 });
    });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(hostWs.getCircuit().project.circuitSymbols).toHaveLength(1);
    expect(hostWs.getCircuit().project.circuitSymbols[0]).toMatchObject({
      circuitSymbolId: addedSymId,
      x: 12,
      y: 10,
    });

    // Host geht lokal in Bibliotheks-Bearbeitungsmodus (kein Projektwechsel-Resync!)
    await React.act(async () => {
      await hostWs.getLibrary()!.enterLibraryEditMode("lib-circ-1");
    });
    await flushMicrotasks();
    expect(collabWs.getCircuit().project.project.name).toBe("HostStart");

    // Während Host Bibliothek editiert, benennt Kollaborateur das gemeinsame Projekt um
    React.act(() => {
      collabWs.getCircuit().updateProjectProperties({ name: "SharedUpdated" });
    });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(hostWs.getLibrary()!.getSavedSessionProject?.()?.project.name).toBe("SharedUpdated");

    await React.act(async () => {
      await hostWs.getLibrary()!.exitLibraryEditMode();
    });
    expect(hostWs.getCircuit().project.project.name).toBe("SharedUpdated");
    expect(hostWs.getCircuit().project.circuitSymbols).toHaveLength(1);

    // Host-Rolle auf Gast umstellen -> Gast-Guard blockiert Mutationen
    const collabPeerId = collabHolder.controller.getState().selfPeerId!;
    await hostHolder.controller.setParticipantRole(collabPeerId, "guest");
    await flushMicrotasks();
    expect(collabSync.canMutateProject()).toBe(false);

    React.act(() => {
      collabWs.getCircuit().updateProjectProperties({ name: "GuestBlocked" });
    });
    await flushMicrotasks();
    expect(hostWs.getCircuit().project.project.name).toBe("SharedUpdated");

    // Host lädt Demo-Projekt -> vollständiger Projekt-Resync an Kollaborateur
    React.act(() => {
      hostWs.getCircuit().resetToDemoProject();
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(collabWs.getCircuit().project.project.name).toBe("Schaltungs-Projekt");
    expect(collabWs.getCircuit().currentCircuit.circuitSymbols.length).toBe(16);

    hostSync.dispose();
    collabSync.dispose();
    hostHolder.controller.dispose();
    collabHolder.controller.dispose();
  });
});
