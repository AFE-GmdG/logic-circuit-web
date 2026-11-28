import { afterEach, describe, expect, it, vi } from "vitest";

import { insertEntities } from "../contexts/circuitContext/historyManager";
import { guardMcpRequestForSoftLocks } from "../hooks/useMcpBridge";

import type CircuitProject from "../types/circuit/circuitProject";
import type CollabRole from "../types/collab/collabRole";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import {
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST,
  type CollabMutationRejectedPayload,
  type CollabSoftLockEntry,
  type CollabSoftLockPayload,
} from "../types/collab/modelSyncMessage";

import CollabModelSyncController, {
  type CollabModelSyncTransport,
} from "../collab/collabModelSyncController";
import CollabSoftLockManager from "../collab/collabSoftLockManager";
import type { CollabTransportSnapshot } from "../collab/p2pSessionTransport";
import { createEmptyCircuitProject, instantiateCircuitFromPalette } from "../utils/circuitLayout";
import { generateEntityUuid } from "../utils/entityId";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createSoftLockHarness() {
  type Node = {
    peerId: string;
    role: CollabRole;
    displayName: string;
    connected: boolean;
    project: CircuitProject;
    rejections: CollabMutationRejectedPayload[];
    snapshotListeners: Set<(snap: CollabTransportSnapshot | null) => void>;
    messageListeners: Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>;
    controller: CollabModelSyncController;
  };

  const nodes = new Map<string, Node>();
  let hostPeerId = "host-1";

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
        state: n.connected ? ("connected" as const) : ("disconnected" as const),
        diagnostic: { code: "none" as const, isRecoverable: true, turnPlannedHint: false, details: "" },
        lastHeartbeatAt: 1000,
      }));

    for (const node of nodes.values()) {
      const snap: CollabTransportSnapshot = {
        state: node.connected ? "connected" : "disconnected",
        sessionId: "sess-locks",
        selfPeerId: node.peerId,
        selfRole: node.role,
        hostPeerId,
        peers: node.role === "host" ? peerSummaries : [],
        diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
        gracePeriodMs: 20000,
        iceServers: [],
      };
      for (const listener of node.snapshotListeners) {
        listener(snap);
      }
    }
  };

  const addNode = (peerId: string, role: CollabRole, displayName: string, project: CircuitProject) => {
    const snapshotListeners = new Set<(snap: CollabTransportSnapshot | null) => void>();
    const messageListeners = new Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>();
    const node: Node = {
      peerId,
      role,
      displayName,
      connected: true,
      project,
      rejections: [],
      snapshotListeners,
      messageListeners,
      controller: null!,
    };

    const transport: CollabModelSyncTransport = {
      onTransportSnapshot: (listener) => {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
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
      softLockTtlMs: 12_000,
      softLockRenewIntervalMs: 4_000,
      softLockSweepIntervalMs: 1_000,
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
        onMutationRejected: (rejection) => {
          node.rejections.push(rejection);
        },
      },
    });
    nodes.set(peerId, node);
    return node;
  };

  return { nodes, addNode, emitAll, setHostPeerId: (nextHost: string) => { hostPeerId = nextHost; } };
}

describe("T-100: Ephemeres Soft-Locking (Leases, TTL, Auto-Renew, Disconnect & Host-MCP-Guard)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("erwirbt, erneuert, blockiert atomar und bereinigt Leases per TTL und Rollenverlust", () => {
    vi.useFakeTimers();
    let now = 10_000;
    const sentMessages: CollabSoftLockPayload[] = [];
    const manager = new CollabSoftLockManager({
      ttlMs: 12_000,
      renewIntervalMs: 4_000,
      sweepIntervalMs: 1_000,
      now: () => now,
      sendLockMessage: (payload) => sentMessages.push(payload),
    });

    // Im Solo-Modus ohne aktive Session ist acquireLocks ein No-Op
    expect(
      manager.acquireLocks([{ targetType: "symbol", targetId: "s-solo", logicalCircuitId: "lc-1" }], "drag"),
    ).toEqual({ ok: true, acquired: [] });

    manager.configureSession({
      isActive: true,
      selfPeerId: "collab-a",
      selfDisplayName: "Alice",
      selfRole: "collaborator",
    });

    const acquireOk = manager.acquireLocks(
      [
        { targetType: "symbol", targetId: "s-1", logicalCircuitId: "lc-1" },
        { targetType: "symbol", targetId: "s-1", logicalCircuitId: "lc-1" },
      ],
      "drag",
    );
    expect(acquireOk.ok).toBe(true);
    if (acquireOk.ok) {
      expect(acquireOk.acquired).toHaveLength(1);
      expect(acquireOk.acquired[0].expiresAt).toBe(22_000);
    }

    // Auto-Renew hält Lease aktiv solange Bearbeitung läuft
    now += 4_000;
    vi.advanceTimersByTime(4_000);
    expect(manager.getLockForTarget("symbol", "s-1")?.expiresAt).toBe(26_000);

    // Fremder Lock blockiert atomaren Mehrfach-Erwerb (auch für s-free wird kein Teil-Lock gesetzt)
    manager.handleIncomingPayload("host-1", {
      action: "acquire",
      locks: [
        {
          lockId: "lock-foreign",
          targetType: "symbol",
          targetId: "s-2",
          logicalCircuitId: "lc-1",
          ownerPeerId: "collab-b",
          ownerDisplayName: "Bob",
          reason: "property-dialog",
          acquiredAt: now,
          expiresAt: now + 6_000,
        },
      ],
    }, false);
    const partialAttempt = manager.acquireLocks(
      [
        { targetType: "symbol", targetId: "s-free", logicalCircuitId: "lc-1" },
        { targetType: "symbol", targetId: "s-2", logicalCircuitId: "lc-1" },
      ],
      "drag",
    );
    expect(partialAttempt.ok).toBe(false);
    if (!partialAttempt.ok) {
      expect(partialAttempt.blockedBy.map((b) => b.targetId)).toEqual(["s-2"]);
    }
    expect(manager.getLockForTarget("symbol", "s-free")).toBeNull();

    // Fremdlock läuft nach Ablauf seines TTL beim nächsten Sweep automatisch ab
    now += 6_000;
    vi.advanceTimersByTime(1_000);
    expect(manager.getLockForTarget("symbol", "s-2")).toBeNull();

    // Herabstufung auf Gast gibt eigene gehaltene Locks sofort frei
    manager.configureSession({
      isActive: true,
      selfPeerId: "collab-a",
      selfDisplayName: "Alice",
      selfRole: "guest",
    });
    expect(manager.getLockForTarget("symbol", "s-1")).toBeNull();
    expect(sentMessages.at(-1)?.action).toBe("release");
    manager.dispose();
  });

  it("synchronisiert Soft-Locks im Team, weist fremdgelockte Mutationen ab und gibt bei Disconnect/Gast-Abstufung frei", async () => {
    const harness = createSoftLockHarness();
    let baseProj = createEmptyCircuitProject("LockTeam", "Main");
    const mainId = baseProj.logicalCircuits[0].logicalCircuitId;
    const symA = instantiateCircuitFromPalette(baseProj, mainId, { type: "and", name: "AND", inputCount: 2 }, { x: 8, y: 8 });
    baseProj = insertEntities(baseProj, mainId, [{ symbol: symA.circuitSymbol, circuit: symA.circuit }], []);
    const symId = symA.circuitSymbol.circuitSymbolId;

    const host = harness.addNode("host-1", "host", "Host", baseProj);
    const alice = harness.addNode("collab-a", "collaborator", "Alice", createEmptyCircuitProject());
    const bob = harness.addNode("collab-b", "collaborator", "Bob", createEmptyCircuitProject());
    harness.emitAll();
    await flushMicrotasks();

    // Alice erwirbt Soft-Lock -> Host & Bob erhalten ihn
    const lockRes = alice.controller.acquireSoftLocks(
      [{ targetType: "symbol", targetId: symId, logicalCircuitId: mainId }],
      "drag",
    );
    expect(lockRes.ok).toBe(true);
    await flushMicrotasks();

    expect(host.controller.getForeignLockForTarget("symbol", symId)?.ownerDisplayName).toBe("Alice");
    expect(bob.controller.getForeignLockForTarget("symbol", symId)?.ownerDisplayName).toBe("Alice");

    // Bob versucht trotzdem per Mutation an das gesperrte Bauteil -> Host lehnt mit Hinweis ab
    bob.controller.submitLocalMutation({
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [symId],
      textNoteIds: [],
      dx: 4,
      dy: 0,
    });
    await flushMicrotasks();
    expect(bob.rejections).toHaveLength(1);
    expect(bob.rejections[0].code).toBe("conflict");
    expect(bob.rejections[0].message).toContain("Alice");

    // Ein spät beitretender Peer erhält den laufenden Soft-Lock sofort beim Initial-Sync
    const charlie = harness.addNode("collab-c", "collaborator", "Charlie", createEmptyCircuitProject());
    harness.emitAll();
    await flushMicrotasks();
    expect(charlie.controller.getForeignLockForTarget("symbol", symId)?.ownerDisplayName).toBe("Alice");

    // Direkter Request-Check: Host blockiert fremdgelocktes Target sauber
    expect(host.controller.getSoftLocks()).toHaveLength(1);
    await alice.controller.releaseSoftLocks();
    await flushMicrotasks();
    expect(bob.controller.getForeignLockForTarget("symbol", symId)).toBeNull();

    // Erneuter Lock durch Alice + Disconnect von Alice -> Host räumt automatisch ab und sendet Release
    alice.controller.acquireSoftLocks(
      [{ targetType: "symbol", targetId: symId, logicalCircuitId: mainId }],
      "property-dialog",
    );
    await flushMicrotasks();
    expect(bob.controller.getForeignLockForTarget("symbol", symId)?.ownerDisplayName).toBe("Alice");

    alice.connected = false;
    harness.emitAll();
    await flushMicrotasks();
    expect(host.controller.getSoftLocks()).toHaveLength(0);
    expect(bob.controller.getForeignLockForTarget("symbol", symId)).toBeNull();
    expect(COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REQUEST).toBe("circuit-mutation-request");

    host.controller.dispose();
    alice.controller.dispose();
    bob.controller.dispose();
    charlie.controller.dispose();
  });

  it("schützt mutierende Host-MCP-Aufrufe gegen fremdgelockte Elemente und Schaltpläne", () => {
    const symId = generateEntityUuid();
    const noteId = generateEntityUuid();
    const circuitId = generateEntityUuid();
    const foreignLocks: CollabSoftLockEntry[] = [
      {
        lockId: "l-1",
        targetType: "symbol",
        targetId: symId,
        logicalCircuitId: circuitId,
        ownerPeerId: "collab-1",
        ownerDisplayName: "Alice",
        reason: "drag",
        acquiredAt: 1000,
        expiresAt: 15000,
      },
      {
        lockId: "l-2",
        targetType: "textNote",
        targetId: noteId,
        logicalCircuitId: circuitId,
        ownerPeerId: "collab-2",
        ownerDisplayName: "Bob",
        reason: "text-note-dialog",
        acquiredAt: 1000,
        expiresAt: 15000,
      },
      {
        lockId: "l-3",
        targetType: "logicalCircuit",
        targetId: circuitId,
        logicalCircuitId: circuitId,
        ownerPeerId: "collab-1",
        ownerDisplayName: "Alice",
        reason: "property-dialog",
        acquiredAt: 1000,
        expiresAt: 15000,
      },
    ];

    expect(
      guardMcpRequestForSoftLocks(
        { id: "r1", method: "move_elements", params: { symbolIds: [symId], dx: 2, dy: 0 } },
        foreignLocks,
        circuitId,
      )?.error,
    ).toContain("Alice");

    expect(
      guardMcpRequestForSoftLocks(
        { id: "r2", method: "rotate_symbols", params: { symbolIds: [symId], direction: "clockwise" } },
        foreignLocks,
        circuitId,
      )?.error,
    ).toContain("Alice");

    expect(
      guardMcpRequestForSoftLocks(
        { id: "r3", method: "delete_elements", params: { textNoteIds: [noteId] } },
        foreignLocks,
        circuitId,
      )?.error,
    ).toContain("Bob");

    expect(
      guardMcpRequestForSoftLocks(
        { id: "r4", method: "update_element_properties", params: { textNoteId: noteId, text: "Neu" } },
        foreignLocks,
        circuitId,
      )?.error,
    ).toContain("Bob");

    expect(
      guardMcpRequestForSoftLocks(
        { id: "r5", method: "update_circuit_properties", params: { name: "Neu" } },
        foreignLocks,
        circuitId,
      )?.error,
    ).toContain("Alice");

    expect(
      guardMcpRequestForSoftLocks(
        { id: "r6", method: "delete_circuits", params: { circuitIds: [circuitId] } },
        foreignLocks,
        circuitId,
      )?.error,
    ).toBeTruthy();

    // Unbeteiligte Elemente und Lese-Werkzeuge bleiben frei
    expect(
      guardMcpRequestForSoftLocks(
        { id: "r7", method: "move_elements", params: { symbolIds: [generateEntityUuid()], dx: 2, dy: 0 } },
        foreignLocks,
        circuitId,
      ),
    ).toBeNull();
    expect(
      guardMcpRequestForSoftLocks(
        { id: "r8", method: "get_circuit_summary", params: {} },
        foreignLocks,
        circuitId,
      ),
    ).toBeNull();
  });
});
