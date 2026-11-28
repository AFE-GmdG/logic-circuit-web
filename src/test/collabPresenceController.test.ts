import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import {
  COLLAB_APP_TOPIC_PRESENCE_CURSOR,
  COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT,
  COLLAB_APP_TOPIC_PRESENCE_STATE,
  MAX_PRESENCE_SELECTION_IDS,
} from "../types/collab/presenceMessage";
import type CollabParticipant from "../types/collab/sessionState";

import { authorizeCollabAction } from "../collab/collabAuthorization";
import CollabPresenceController, {
  type CollabPresenceTransport,
  isRemoteCursorIdle,
  shouldShowRemoteCursor,
} from "../collab/collabPresenceController";
import type { CollabTransportSnapshot } from "../collab/p2pSessionTransport";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  resolveCollabCursorIdleTimeoutSec,
  resolveCollabCursorVisibilityMode,
  saveAppSettings,
} from "../utils/appSettingsStorage";
import {
  COLLAB_PARTICIPANT_COLOR_PALETTE,
  COLLAB_PARTICIPANT_COLORS_STORAGE_KEY,
  createCollabParticipantColorStore,
  formatStoredParticipantDisplayName,
  loadParticipantColorDictionary,
  saveParticipantColorDictionary,
} from "../utils/collabParticipantColors";

type PresencePeerNode = {
  peerId: string;
  role: "host" | "collaborator" | "guest";
  connected: boolean;
  snapshotListeners: Set<(snap: CollabTransportSnapshot | null) => void>;
  messageListeners: Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>;
  sentMessages: Array<{ to: string; message: CollabDataChannelMessage }>;
  transport: CollabPresenceTransport;
  controller: CollabPresenceController;
};

function installMockLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mockStorage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: mockStorage },
    configurable: true,
    writable: true,
  });
  return store;
}

function createParticipant(overrides: Partial<CollabParticipant> & { peerId: string }): CollabParticipant {
  return {
    role: "guest",
    displayName: "Teilnehmer",
    nameLocked: false,
    handRaised: false,
    connectionState: "connected",
    ...overrides,
  };
}

function createPresenceHarness(options: { cursorThrottleMs?: number; viewportThrottleMs?: number } = {}) {
  const nodes = new Map<string, PresencePeerNode>();
  let hostPeerId = "host-1";

  const buildSnapshotFor = (node: PresencePeerNode): CollabTransportSnapshot => {
    const remotePeers = node.role === "host"
      ? Array.from(nodes.values())
        .filter((other) => other.peerId !== node.peerId)
        .map((other) => ({
          peerId: other.peerId,
          role: other.role,
          displayName: other.peerId,
          state: other.connected ? ("connected" as const) : ("disconnected" as const),
          diagnostic: { code: "none" as const, isRecoverable: true, turnPlannedHint: false, details: "" },
          lastHeartbeatAt: 1000,
        }))
      : [];
    return {
      state: node.connected ? "connected" : "disconnected",
      sessionId: "sess-presence-1",
      selfPeerId: node.peerId,
      selfRole: node.role,
      hostPeerId,
      peers: remotePeers,
      diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
      gracePeriodMs: 20000,
      iceServers: [],
    };
  };

  const emitSnapshots = () => {
    for (const node of nodes.values()) {
      const snap = buildSnapshotFor(node);
      for (const listener of node.snapshotListeners) {
        listener(snap);
      }
    }
  };

  const deliverAsync = async (fromPeerId: string, toPeerId: string, msg: CollabDataChannelMessage) => {
    await Promise.resolve();
    const sender = nodes.get(fromPeerId);
    const target = nodes.get(toPeerId);
    if (!sender || !target || !sender.connected || !target.connected) {
      return;
    }
    for (const listener of target.messageListeners) {
      listener(fromPeerId, msg);
    }
  };

  const addNode = (peerId: string, role: "host" | "collaborator" | "guest"): PresencePeerNode => {
    const snapshotListeners = new Set<(snap: CollabTransportSnapshot | null) => void>();
    const messageListeners = new Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>();
    const sentMessages: Array<{ to: string; message: CollabDataChannelMessage }> = [];

    const transport: CollabPresenceTransport = {
      onTransportSnapshot(listener) {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
      },
      onTransportMessage(listener) {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      async sendToPeer(targetPeerId, message) {
        sentMessages.push({ to: targetPeerId, message });
        await deliverAsync(peerId, targetPeerId, message);
      },
      async sendToHost(message) {
        sentMessages.push({ to: hostPeerId, message });
        await deliverAsync(peerId, hostPeerId, message);
      },
      async broadcast(message, excludePeerId) {
        sentMessages.push({ to: "*", message });
        const deliveries: Array<Promise<void>> = [];
        for (const other of nodes.values()) {
          if (other.peerId === peerId || (excludePeerId && other.peerId === excludePeerId)) {
            continue;
          }
          deliveries.push(deliverAsync(peerId, other.peerId, message));
        }
        await Promise.all(deliveries);
      },
    };

    const controller = new CollabPresenceController({
      transport,
      cursorThrottleMs: options.cursorThrottleMs ?? 50,
      viewportThrottleMs: options.viewportThrottleMs ?? 100,
    });

    const node: PresencePeerNode = {
      peerId,
      role,
      connected: true,
      snapshotListeners,
      messageListeners,
      sentMessages,
      transport,
      controller,
    };
    nodes.set(peerId, node);
    return node;
  };

  const transferHost = (newHostId: string) => {
    const previousHost = nodes.get(hostPeerId);
    const nextHost = nodes.get(newHostId);
    if (!previousHost || !nextHost) {
      return;
    }
    previousHost.role = "collaborator";
    nextHost.role = "host";
    hostPeerId = newHostId;
    emitSnapshots();
  };

  const disconnectNode = (peerId: string) => {
    const node = nodes.get(peerId);
    if (!node) {
      return;
    }
    node.connected = false;
    nodes.delete(peerId);
    for (const listener of node.snapshotListeners) {
      listener({
        state: "disconnected",
        sessionId: null,
        selfPeerId: node.peerId,
        selfRole: node.role,
        hostPeerId: null,
        peers: [],
        diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
        gracePeriodMs: 20000,
        iceServers: [],
      });
    }
    emitSnapshots();
  };

  return {
    nodes,
    addNode,
    emitSnapshots,
    transferHost,
    disconnectNode,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

describe("T-102: Präsenz-Protokoll, lokale Farbverwaltung & CollabPresenceController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { window?: unknown }).window;
  });

  it("autorisiert presence-cursor und presence-state für alle Rollen inklusive Gäste und blockiert ungültige Payloads sowie fremde Snapshots", () => {
    const roster = [
      createParticipant({ peerId: "host-1", role: "host", displayName: "Host" }),
      createParticipant({ peerId: "collab-1", role: "collaborator", displayName: "Clara" }),
      createParticipant({ peerId: "guest-1", role: "guest", displayName: "Gustav" }),
    ];

    expect(
      authorizeCollabAction(
        "guest-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_CURSOR,
          payload: { x: 120, y: 240, logicalCircuitId: "lc-main" },
        },
        roster,
      ),
    ).toEqual({ allowed: true });

    expect(
      authorizeCollabAction(
        "guest-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_CURSOR,
          payload: { visible: false },
        },
        roster,
      ),
    ).toEqual({ allowed: true });

    expect(
      authorizeCollabAction(
        "guest-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_STATE,
          payload: {
            logicalCircuitId: "lc-main",
            inLibraryMode: false,
            selection: { symbolIds: ["sym-1"], textNoteIds: [], wireIds: ["w-1"] },
            openDialog: { kind: "symbol-properties", targetId: "sym-1", logicalCircuitId: "lc-main" },
            viewport: { centerX: 180, centerY: 90, zoom: 1.25 },
          },
        },
        roster,
      ),
    ).toEqual({ allowed: true });

    // Snapshot ist strikt Host-Only
    expect(
      authorizeCollabAction(
        "collab-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT,
          payload: { entries: [] },
        },
        roster,
      ),
    ).toMatchObject({ allowed: false, code: "host-only" });

    expect(
      authorizeCollabAction(
        "host-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_SNAPSHOT,
          payload: { entries: [] },
        },
        roster,
      ),
    ).toEqual({ allowed: true });

    // Ungültige Zahlen, zu große Selektionslisten oder ungültige Dialogtypen werden abgewiesen
    expect(
      authorizeCollabAction(
        "guest-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_CURSOR,
          payload: { x: Number.NaN, y: 10 },
        },
        roster,
      ),
    ).toMatchObject({ allowed: false, code: "invalid-payload" });

    const oversizedIds = Array.from({ length: MAX_PRESENCE_SELECTION_IDS + 1 }, (_, idx) => `sym-${idx}`);
    expect(
      authorizeCollabAction(
        "collab-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_STATE,
          payload: {
            logicalCircuitId: "lc-main",
            inLibraryMode: false,
            selection: { symbolIds: oversizedIds, textNoteIds: [], wireIds: [] },
          },
        },
        roster,
      ),
    ).toMatchObject({ allowed: false, code: "invalid-payload" });

    expect(
      authorizeCollabAction(
        "collab-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_STATE,
          payload: {
            logicalCircuitId: "lc-main",
            inLibraryMode: false,
            openDialog: { kind: "unknown-dialog", targetId: "x", logicalCircuitId: "lc-main" },
          },
        },
        roster,
      ),
    ).toMatchObject({ allowed: false, code: "invalid-payload" });

    expect(
      authorizeCollabAction(
        "collab-1",
        {
          kind: "app",
          topic: COLLAB_APP_TOPIC_PRESENCE_STATE,
          payload: {
            logicalCircuitId: "lc-main",
            inLibraryMode: false,
            viewport: { centerX: 0, centerY: 0, zoom: 0 },
          },
        },
        roster,
      ),
    ).toMatchObject({ allowed: false, code: "invalid-payload" });
  });

  it("verwaltet lokale Teilnehmerfarben im Name->Farbe-Dictionary inklusive automatischer Zuweisung, Anpassung und Rename-Nachführung", () => {
    const rawStore = installMockLocalStorage();
    const store = createCollabParticipantColorStore();

    store.syncParticipants([
      { peerId: "p-1", displayName: "Alice" },
      { peerId: "p-2", displayName: "Bob" },
      { peerId: "p-3", displayName: "Charlie" },
    ]);

    const colorAlice = store.getColorForPeer("p-1");
    const colorBob = store.getColorForPeer("p-2");
    const colorCharlie = store.getColorForPeer("p-3");

    expect(COLLAB_PARTICIPANT_COLOR_PALETTE).toContain(colorAlice);
    expect(new Set([colorAlice, colorBob, colorCharlie]).size).toBe(3);

    // Manuelle Farbwahl wird lokal unter Name->Farbe persistiert
    expect(store.setColorForPeer("p-2", "#112233")).toBe(true);
    expect(store.setColorForPeer("p-2", "ungueltig")).toBe(false);
    expect(store.getColorForPeer("p-2")).toBe("#112233");
    expect(rawStore.has(COLLAB_PARTICIPANT_COLORS_STORAGE_KEY)).toBe(true);
    expect(loadParticipantColorDictionary().bob).toBe("#112233");

    // Namensänderung (Selbstumbenennung oder Host-Moderation) zieht lokale Farbe mit und räumt alten ungenutzten Schlüssel auf
    store.syncParticipants([
      { peerId: "p-1", displayName: "Alice" },
      { peerId: "p-2", displayName: "Bobby" },
      { peerId: "p-3", displayName: "Charlie" },
    ]);

    expect(store.getColorForPeer("p-2")).toBe("#112233");
    const dictAfterRename = loadParticipantColorDictionary();
    expect(dictAfterRename.bobby).toBe("#112233");
    expect(dictAfterRename.bob).toBeUndefined();

    // Nach Neustart / Rejoin bleibt die individuell gespeicherte Farbe erhalten
    const secondStore = createCollabParticipantColorStore();
    secondStore.syncParticipants([{ peerId: "p-99", displayName: "  Bobby  " }]);
    expect(secondStore.getColorForPeer("p-99")).toBe("#112233");
  });

  it("persistiert collabCursorIdleTimeoutSec in AppSettings mit Standard 10 s und gültigen Einzelauswahlen", () => {
    const rawStore = installMockLocalStorage();

    expect(resolveCollabCursorIdleTimeoutSec(undefined)).toBe(10);
    expect(resolveCollabCursorIdleTimeoutSec(42)).toBe(10);
    expect(loadAppSettings().collabCursorIdleTimeoutSec).toBeUndefined();

    saveAppSettings({
      ...DEFAULT_APP_SETTINGS,
      collabCursorIdleTimeoutSec: 30,
    });
    expect(loadAppSettings().collabCursorIdleTimeoutSec).toBe(30);
    expect(resolveCollabCursorIdleTimeoutSec(loadAppSettings().collabCursorIdleTimeoutSec)).toBe(30);

    saveAppSettings({
      ...DEFAULT_APP_SETTINGS,
      collabCursorIdleTimeoutSec: 0,
    });
    expect(loadAppSettings().collabCursorIdleTimeoutSec).toBe(0);
    expect(resolveCollabCursorIdleTimeoutSec(loadAppSettings().collabCursorIdleTimeoutSec)).toBe(0);

    // Ungültige manuelle Werte im Storage werden verworfen
    rawStore.set(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APP_SETTINGS, collabCursorIdleTimeoutSec: 17 }),
    );
    expect(loadAppSettings().collabCursorIdleTimeoutSec).toBeUndefined();
    expect(resolveCollabCursorIdleTimeoutSec(loadAppSettings().collabCursorIdleTimeoutSec)).toBe(10);
  });

  it("drosselt Cursor- und Viewport-Updates mit Leading+Trailing-Edge und hält Cursor-Updates vom Präsenz-State entkoppelt", async () => {
    const harness = createPresenceHarness({ cursorThrottleMs: 50, viewportThrottleMs: 100 });
    const host = harness.addNode("host-1", "host");
    const guest = harness.addNode("guest-1", "guest");
    harness.emitSnapshots();
    await flushMicrotasks();

    const hostStateListener = vi.fn();
    const hostCursorListener = vi.fn();
    host.controller.subscribeState(hostStateListener);
    host.controller.subscribeCursors(hostCursorListener);

    // Initialer Schaltplanwechsel wird sofort übertragen
    guest.controller.updateLocalState({
      logicalCircuitId: "lc-1",
      inLibraryMode: false,
    });
    await flushMicrotasks();
    expect(hostStateListener).toHaveBeenCalledTimes(1);
    expect(host.controller.getState().peers["guest-1"]?.logicalCircuitId).toBe("lc-1");

    // Reine Cursor-Bewegungen lösen nur subscribeCursors aus, niemals subscribeState
    hostStateListener.mockClear();
    guest.sentMessages.length = 0;

    guest.controller.updateLocalCursor({ x: 10, y: 20 });
    guest.controller.updateLocalCursor({ x: 25, y: 35 });
    guest.controller.updateLocalCursor({ x: 40, y: 55 });
    await flushMicrotasks();

    // Leading edge hat sofort gesendet, weitere Updates warten auf das 50 ms Trailing-Fenster
    expect(
      guest.sentMessages.filter((m) => m.message.kind === "app" && m.message.topic === COLLAB_APP_TOPIC_PRESENCE_CURSOR),
    ).toHaveLength(1);
    expect(host.controller.getCursors()["guest-1"]).toMatchObject({ x: 10, y: 20 });
    expect(hostCursorListener).toHaveBeenCalledTimes(1);
    expect(hostStateListener).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(50);
    await flushMicrotasks();
    expect(
      guest.sentMessages.filter((m) => m.message.kind === "app" && m.message.topic === COLLAB_APP_TOPIC_PRESENCE_CURSOR),
    ).toHaveLength(2);
    expect(host.controller.getCursors()["guest-1"]).toMatchObject({ x: 40, y: 55 });
    expect(hostCursorListener).toHaveBeenCalledTimes(2);
    expect(hostStateListener).toHaveBeenCalledTimes(0);

    // Viewport-Updates werden getrennt mit 100 ms gedrosselt
    guest.sentMessages.length = 0;
    guest.controller.updateLocalState({ viewport: { centerX: 100, centerY: 100, zoom: 1 } });
    guest.controller.updateLocalState({ viewport: { centerX: 200, centerY: 200, zoom: 1.5 } });
    await flushMicrotasks();
    expect(
      guest.sentMessages.filter((m) => m.message.kind === "app" && m.message.topic === COLLAB_APP_TOPIC_PRESENCE_STATE),
    ).toHaveLength(1);
    expect(host.controller.getState().peers["guest-1"]?.viewport).toEqual({ centerX: 100, centerY: 100, zoom: 1 });

    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(
      guest.sentMessages.filter((m) => m.message.kind === "app" && m.message.topic === COLLAB_APP_TOPIC_PRESENCE_STATE),
    ).toHaveLength(2);
    expect(host.controller.getState().peers["guest-1"]?.viewport).toEqual({ centerX: 200, centerY: 200, zoom: 1.5 });
  });

  it("erzwingt Anti-Spoofing auf Host-Seite, verteilt Snapshots an Nachzügler/nach Handover und isoliert den Bibliotheksmodus", async () => {
    const harness = createPresenceHarness({ cursorThrottleMs: 0, viewportThrottleMs: 0 });
    const host = harness.addNode("host-1", "host");
    const collab = harness.addNode("collab-1", "collaborator");
    harness.emitSnapshots();
    await flushMicrotasks();

    host.controller.updateLocalState({
      logicalCircuitId: "lc-main",
      inLibraryMode: false,
      selection: { symbolIds: ["sym-host"], textNoteIds: [], wireIds: [] },
    });
    host.controller.updateLocalCursor({ x: 50, y: 60 });
    await flushMicrotasks();

    // Gefälschte peerId im Payload von collab-1 wird vom Host autoritativ auf "collab-1" korrigiert
    void collab.transport.sendToHost({
      kind: "app",
      topic: COLLAB_APP_TOPIC_PRESENCE_STATE,
      payload: {
        peerId: "host-1",
        logicalCircuitId: "lc-sub",
        inLibraryMode: false,
        selection: { symbolIds: ["sym-c"], textNoteIds: [], wireIds: [] },
      },
    });
    await flushMicrotasks();
    expect(host.controller.getState().peers["collab-1"]?.logicalCircuitId).toBe("lc-sub");

    // Nachzügler (Gast) erhält beim Connect automatisch einen presence-snapshot mit Host und Kollaborateur
    const guest = harness.addNode("guest-1", "guest");
    harness.emitSnapshots();
    await flushMicrotasks();

    expect(guest.controller.getState().peers["host-1"]?.selection.symbolIds).toEqual(["sym-host"]);
    expect(guest.controller.getState().peers["collab-1"]?.logicalCircuitId).toBe("lc-sub");
    expect(guest.controller.getCursors()["host-1"]).toMatchObject({ x: 50, y: 60 });

    // Im Bibliotheksmodus werden Schaltplan, Selektion, Dialog, Viewport und Cursor strikt verborgen
    collab.controller.updateLocalCursor({ x: 300, y: 400 });
    await flushMicrotasks();
    expect(guest.controller.getCursors()["collab-1"]).toMatchObject({ x: 300, y: 400 });

    collab.controller.updateLocalState({
      logicalCircuitId: "lc-secret-lib",
      inLibraryMode: true,
      selection: { symbolIds: ["secret"], textNoteIds: [], wireIds: [] },
      openDialog: { kind: "symbol-properties", targetId: "secret", logicalCircuitId: "lc-secret-lib" },
      viewport: { centerX: 999, centerY: 999, zoom: 2 },
    });
    await flushMicrotasks();

    const collabStateOnGuest = guest.controller.getState().peers["collab-1"];
    expect(collabStateOnGuest?.inLibraryMode).toBe(true);
    expect(collabStateOnGuest?.logicalCircuitId).toBeNull();
    expect(collabStateOnGuest?.selection).toEqual({ symbolIds: [], textNoteIds: [], wireIds: [] });
    expect(collabStateOnGuest?.openDialog).toBeNull();
    expect(collabStateOnGuest?.viewport).toBeNull();
    expect(guest.controller.getCursors()["collab-1"]).toBeUndefined();

    // Host-Handover an collab-1 verteilt neuen Snapshot und behält bestehende Präsenz sauber
    harness.transferHost("collab-1");
    await flushMicrotasks();
    expect(collab.controller.getState().peers["host-1"]?.selection.symbolIds).toEqual(["sym-host"]);
    expect(guest.controller.getState().peers["host-1"]?.selection.symbolIds).toEqual(["sym-host"]);

    // Disconnect räumt Präsenz- und Cursor-Einträge auf
    harness.disconnectNode("host-1");
    await flushMicrotasks();
    expect(collab.controller.getState().peers["host-1"]).toBeUndefined();
    expect(collab.controller.getCursors()["host-1"]).toBeUndefined();
  });

  it("verfolgt lastMovedAt nur bei echter Cursor-Bewegung für das Ausblenden nach Grace Period", async () => {
    const harness = createPresenceHarness({ cursorThrottleMs: 0, viewportThrottleMs: 0 });
    const host = harness.addNode("host-1", "host");
    const guest = harness.addNode("guest-1", "guest");
    harness.emitSnapshots();
    await flushMicrotasks();

    guest.controller.updateLocalState({ logicalCircuitId: "lc-1", inLibraryMode: false });
    guest.controller.updateLocalCursor({ x: 100, y: 120 });
    await flushMicrotasks();

    const cursorEntry = host.controller.getCursors()["guest-1"];
    expect(cursorEntry).toBeDefined();
    expect(isRemoteCursorIdle(cursorEntry!, Date.now(), 10)).toBe(false);

    vi.advanceTimersByTime(9999);
    expect(isRemoteCursorIdle(host.controller.getCursors()["guest-1"]!, Date.now(), 10)).toBe(false);

    vi.advanceTimersByTime(1);
    expect(isRemoteCursorIdle(host.controller.getCursors()["guest-1"]!, Date.now(), 10)).toBe(true);

    // Bei deaktivierter Ausblendung (0 = Nie) bleibt der Cursor sichtbar
    expect(isRemoteCursorIdle(host.controller.getCursors()["guest-1"]!, Date.now(), 0)).toBe(false);

    // Ein identischer Cursor setzt lastMovedAt nicht zurück, echte Bewegung schon
    const staleLastMovedAt = host.controller.getCursors()["guest-1"]!.lastMovedAt;
    guest.controller.updateLocalCursor({ x: 100, y: 120 });
    await flushMicrotasks();
    expect(host.controller.getCursors()["guest-1"]!.lastMovedAt).toBe(staleLastMovedAt);

    guest.controller.updateLocalCursor({ x: 101, y: 120 });
    await flushMicrotasks();
    expect(isRemoteCursorIdle(host.controller.getCursors()["guest-1"]!, Date.now(), 10)).toBe(false);
  });

  it("filtert Cursor-Sichtbarkeit nach Rolle, gehobener Hand und Follow-Status und formatiert/verwaltet gespeicherte Namen", () => {
    const rawStore = installMockLocalStorage();

    // Title-Case-Formatierung für die Anzeige bei kleingeschriebenen Storage-Schlüsseln
    expect(formatStoredParticipantDisplayName("andreas friedel")).toBe("Andreas Friedel");
    expect(formatStoredParticipantDisplayName("mr. foo")).toBe("Mr. Foo");
    expect(formatStoredParticipantDisplayName("SABINE")).toBe("Sabine");

    // Sichtbarkeitsmodi inkl. Host als Kollaborateur, Hand-gehoben-Regel für Gäste und Follow-Ausnahme
    expect(shouldShowRemoteCursor({ mode: "all", participantRole: "guest", handRaised: false })).toBe(true);
    expect(shouldShowRemoteCursor({ mode: "collaborators", participantRole: "host", handRaised: false })).toBe(true);
    expect(shouldShowRemoteCursor({ mode: "collaborators", participantRole: "collaborator", handRaised: false })).toBe(true);
    expect(shouldShowRemoteCursor({ mode: "collaborators", participantRole: "guest", handRaised: true })).toBe(false);
    expect(shouldShowRemoteCursor({ mode: "raised-hand", participantRole: "host", handRaised: false })).toBe(false);
    expect(shouldShowRemoteCursor({ mode: "raised-hand", participantRole: "guest", handRaised: true })).toBe(true);
    expect(
      shouldShowRemoteCursor({ mode: "collaborators-and-raised-hand", participantRole: "guest", handRaised: false }),
    ).toBe(false);
    expect(
      shouldShowRemoteCursor({ mode: "collaborators-and-raised-hand", participantRole: "guest", handRaised: true }),
    ).toBe(true);
    expect(
      shouldShowRemoteCursor({ mode: "collaborators", participantRole: "guest", handRaised: false, isFollowed: true }),
    ).toBe(true);

    // Persistenz des Sichtbarkeitsmodus in AppSettings
    expect(resolveCollabCursorVisibilityMode(undefined)).toBe("all");
    expect(resolveCollabCursorVisibilityMode("ungueltig")).toBe("all");
    saveAppSettings({ ...DEFAULT_APP_SETTINGS, collabCursorVisibilityMode: "collaborators-and-raised-hand" });
    expect(loadAppSettings().collabCursorVisibilityMode).toBe("collaborators-and-raised-hand");

    rawStore.set(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APP_SETTINGS, collabCursorVisibilityMode: "bogus" }),
    );
    expect(loadAppSettings().collabCursorVisibilityMode).toBeUndefined();

    // Einzel-/Komplettlöschung und reloadFromStorage am Farb-Store
    const store = createCollabParticipantColorStore();
    store.syncParticipants([{ peerId: "p-1", displayName: "Andreas Friedel" }]);
    saveParticipantColorDictionary({
      "andreas friedel": "#111111",
      sabine: "#222222",
    });
    const reloaded = store.reloadFromStorage();
    expect(reloaded["andreas friedel"]).toBe("#111111");
    expect(store.getColorForPeer("p-1")).toBe("#111111");
    expect(store.removeColorForName("SABINE")).toBe(true);
    expect(loadParticipantColorDictionary().sabine).toBeUndefined();
    store.clearAllColors();
    expect(loadParticipantColorDictionary()).toEqual({});
  });

  it("überspringt eigene Teilnehmer (isSelf) bei syncParticipants und reloadFromStorage", () => {
    installMockLocalStorage();
    const store = createCollabParticipantColorStore();
    const synced = store.syncParticipants([
      { peerId: "peer-self", displayName: "Andreas", isSelf: true },
      { peerId: "peer-remote", displayName: "Firefox", isSelf: false },
    ]);

    expect(synced.andreas).toBeUndefined();
    expect(synced.firefox).toBeDefined();
    expect(store.getDictionary()).toEqual({ firefox: synced.firefox });
    expect(loadParticipantColorDictionary()).toEqual({ firefox: synced.firefox });

    const reloaded = store.reloadFromStorage();
    expect(reloaded.andreas).toBeUndefined();
    expect(reloaded.firefox).toBe(synced.firefox);
  });
});
