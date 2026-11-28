import { describe, expect, it, vi } from "vitest";

import type CircuitProject from "../types/circuit/circuitProject";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type { CollabResyncReason } from "../types/collab/dataChannelMessage";
import type { CollabCircuitCommitPayload, CollabMutationRejectedPayload } from "../types/collab/modelSyncMessage";
import {
  COLLAB_APP_TOPIC_CIRCUIT_COMMIT,
  COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED,
  COLLAB_APP_TOPIC_PROJECT_SNAPSHOT,
} from "../types/collab/modelSyncMessage";

import CollabModelSyncController, {
  type CollabModelSyncTransport,
} from "../collab/collabModelSyncController";
import type { CollabTransportSnapshot, ResyncHooks } from "../collab/p2pSessionTransport";
import { createEmptyCircuitProject, instantiateCircuitFromPalette } from "../utils/circuitLayout";

type PeerNode = {
  peerId: string;
  role: "host" | "collaborator" | "guest";
  project: CircuitProject;
  backgroundProject: CircuitProject | null;
  isEditingLibrary: boolean;
  connected: boolean;
  remoteCommits: CollabCircuitCommitPayload[];
  rejections: CollabMutationRejectedPayload[];
  snapshotListeners: Set<(snap: CollabTransportSnapshot | null) => void>;
  messageListeners: Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>;
  resyncHooks: ResyncHooks | null;
  beforeTransferHook: ((targetPeerId: string) => Promise<void>) | null;
  transport: CollabModelSyncTransport;
  controller: CollabModelSyncController;
};

function createMultiPeerHarness(options?: { maxRingBufferSize?: number }) {
  const nodes = new Map<string, PeerNode>();
  let hostPeerId = "host-1";

  const getPeersForHost = (hostId: string) =>
    Array.from(nodes.values())
      .filter((n) => n.peerId !== hostId)
      .map((n) => ({
        peerId: n.peerId,
        role: n.role,
        displayName: n.peerId,
        state: n.connected ? ("connected" as const) : ("disconnected" as const),
        diagnostic: { code: "none" as const, isRecoverable: true, turnPlannedHint: false, details: "" },
        lastHeartbeatAt: 1000,
      }));

  const buildSnapshotFor = (node: PeerNode, migrating = false): CollabTransportSnapshot => ({
    state: migrating ? "migrating-host" : (node.connected ? "connected" : "disconnected"),
    sessionId: "sess-1",
    selfPeerId: node.peerId,
    selfRole: node.role,
    hostPeerId,
    peers: node.role === "host" ? getPeersForHost(node.peerId) : [],
    diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
    gracePeriodMs: 20000,
    iceServers: [],
  });

  const emitSnapshotAll = (migrating = false) => {
    for (const node of nodes.values()) {
      const snap = buildSnapshotFor(node, migrating);
      for (const listener of node.snapshotListeners) {
        listener(snap);
      }
    }
  };

  const deliver = async (fromPeerId: string, toPeerId: string, msg: CollabDataChannelMessage) => {
    await Promise.resolve();
    const target = nodes.get(toPeerId);
    const sender = nodes.get(fromPeerId);
    if (!target || !sender || !target.connected || !sender.connected) {
      return;
    }
    for (const listener of target.messageListeners) {
      listener(fromPeerId, msg);
    }
    await Promise.resolve();
    await Promise.resolve();
  };

  const addNode = (peerId: string, role: "host" | "collaborator" | "guest", initialProject: CircuitProject) => {
    const snapshotListeners = new Set<(snap: CollabTransportSnapshot | null) => void>();
    const messageListeners = new Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>();

    const node: PeerNode = {
      peerId,
      role,
      project: initialProject,
      backgroundProject: null,
      isEditingLibrary: false,
      connected: true,
      remoteCommits: [],
      rejections: [],
      snapshotListeners,
      messageListeners,
      resyncHooks: null,
      beforeTransferHook: null,
      transport: null!,
      controller: null!,
    };

    node.transport = {
      onTransportSnapshot: (listener) => {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
      },
      onTransportMessage: (listener) => {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      sendToPeer: async (targetPeerId, msg) => {
        await deliver(node.peerId, targetPeerId, msg);
      },
      sendToHost: async (msg) => {
        await deliver(node.peerId, hostPeerId, msg);
      },
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
      requestResync: async (reason: CollabResyncReason = "manual", fromRevision?: number) => {
        const resolvedFrom = fromRevision ?? (reason !== "manual" ? node.resyncHooks?.getCurrentRevision?.() : undefined);
        const unconfirmed = node.resyncHooks?.getUnconfirmedLocalChangesCount?.() ?? 0;
        if (unconfirmed > 0 && node.resyncHooks?.confirmDiscardLocalChanges) {
          const ok = await node.resyncHooks.confirmDiscardLocalChanges({
            reason,
            unconfirmedLocalChangesCount: unconfirmed,
            peerId: node.peerId,
          });
          if (!ok) {
            return false;
          }
          node.resyncHooks.onLocalChangesDiscardedForResync?.({
            reason,
            unconfirmedLocalChangesCount: unconfirmed,
            peerId: node.peerId,
          });
        }
        await deliver(node.peerId, hostPeerId, {
          kind: "resync-request",
          reason,
          ...(resolvedFrom !== undefined ? { fromRevision: resolvedFrom } : {}),
          hasUnconfirmedLocalChanges: unconfirmed > 0,
        });
        return true;
      },
      setResyncHooks: (hooks) => {
        node.resyncHooks = hooks;
      },
      setBeforeTransferHostHook: (hook) => {
        node.beforeTransferHook = hook;
      },
    };

    node.controller = new CollabModelSyncController({
      transport: node.transport,
      maxRingBufferSize: options?.maxRingBufferSize,
      adapter: {
        getVisibleProject: () => node.project,
        applyAuthoritativeProject: (proj) => {
          node.project = proj;
        },
        isEditingLibrary: () => node.isEditingLibrary,
        getLibraryBackgroundProject: () => node.backgroundProject,
        setLibraryBackgroundProject: (proj) => {
          node.backgroundProject = proj;
        },
        onRemoteCommitApplied: (commit) => {
          node.remoteCommits.push(commit);
        },
        onMutationRejected: (rejection) => {
          node.rejections.push(rejection);
        },
      },
    });

    nodes.set(peerId, node);
    return node;
  };

  const transferHost = async (targetPeerId: string) => {
    const oldHost = nodes.get(hostPeerId)!;
    const newHost = nodes.get(targetPeerId)!;
    await oldHost.beforeTransferHook?.(targetPeerId);
    emitSnapshotAll(true);
    oldHost.role = "collaborator";
    newHost.role = "host";
    hostPeerId = targetPeerId;
    emitSnapshotAll(false);
    await Promise.resolve();
    await Promise.resolve();
  };

  return { nodes, addNode, emitSnapshotAll, transferHost };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("T-099: CollabModelSyncController (Initial-Sync, Catch-up, Optimistic UI, Quiesce-Handover & Bibliothek)", () => {
  it("verteilt Initial-Snapshot, synchronisiert bidirektional und blockiert Gäste", async () => {
    const harness = createMultiPeerHarness();
    const hostProject = createEmptyCircuitProject("HostProj", "Main");
    const mainId = hostProject.logicalCircuits[0].logicalCircuitId;
    const gate = instantiateCircuitFromPalette(hostProject, mainId, { type: "and", name: "AND", inputCount: 2 }, { x: 8, y: 8 });
    hostProject.circuitSymbols.push(gate.circuitSymbol);
    hostProject.logicalCircuits[0].circuitSymbols.push(gate.circuitSymbol);
    hostProject.gates.set((gate.circuit as typeof gate.circuit & { gateId: string }).gateId, gate.circuit as never);

    const host = harness.addNode("host-1", "host", hostProject);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    const guest = harness.addNode("guest-1", "guest", createEmptyCircuitProject("Empty", "Main"));

    harness.emitSnapshotAll();
    await flushMicrotasks();

    expect(collab.controller.getState().syncStatus).toBe("synced");
    expect(collab.project.project.name).toBe("HostProj");
    expect(collab.project.circuitSymbols).toHaveLength(1);
    expect(guest.project.circuitSymbols).toHaveLength(1);
    expect(guest.controller.canMutateProject()).toBe(false);
    expect(guest.controller.getState().isReadOnlyForGuest).toBe(true);

    // Gast darf nicht mutieren
    guest.controller.submitLocalMutation({
      type: "updateProjectProperties",
      updates: { name: "Gast-Hack" },
    });
    await flushMicrotasks();
    expect(host.project.project.name).toBe("HostProj");

    // Kollaborateur mutiert (Optimistic UI -> Host-Commit -> Gast erhält Update)
    const symId = gate.circuitSymbol.circuitSymbolId;
    collab.controller.submitLocalMutation({
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [symId],
      textNoteIds: [],
      dx: 4,
      dy: 2,
    });
    expect(collab.controller.getState().unconfirmedMutationCount).toBe(1);
    await flushMicrotasks();

    expect(collab.controller.getState().unconfirmedMutationCount).toBe(0);
    expect(host.controller.getState().revision).toBe(1);
    expect(host.project.circuitSymbols[0]).toMatchObject({ x: 12, y: 10 });
    expect(guest.project.circuitSymbols[0]).toMatchObject({ x: 12, y: 10 });
  });

  it("rollt abgelehnte optimistische Mutationen zurück und schützt ResyncHooks bei unbestätigten Änderungen", async () => {
    const harness = createMultiPeerHarness();
    const hostProject = createEmptyCircuitProject("RollbackTest", "Main");
    const mainId = hostProject.logicalCircuits[0].logicalCircuitId;
    const placement = instantiateCircuitFromPalette(hostProject, mainId, { type: "and", name: "AND", inputCount: 2 }, { x: 4, y: 4 });
    hostProject.circuitSymbols.push(placement.circuitSymbol);
    hostProject.logicalCircuits[0].circuitSymbols.push(placement.circuitSymbol);

    const host = harness.addNode("host-1", "host", hostProject);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    harness.emitSnapshotAll();
    await flushMicrotasks();

    // Host entfernt das Symbol zuerst (Revision 1), während Kollaborateur noch mit baseRevision=0 verschieben will
    const symId = placement.circuitSymbol.circuitSymbolId;
    host.controller.submitLocalMutation({
      type: "remove",
      logicalCircuitId: mainId,
      symbolIds: [symId],
      textNoteIds: [],
      wireIds: [],
    });

    // Kollaborateur hat optimistisch verschoben und will jetzt synchronisieren -> Konflikt + Rollback
    collab.controller.submitLocalMutation({
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [symId],
      textNoteIds: [],
      dx: 6,
      dy: 6,
    });
    expect(collab.controller.getState().unconfirmedMutationCount).toBe(1);
    await flushMicrotasks();

    expect(collab.rejections.length).toBeGreaterThanOrEqual(1);
    expect(collab.controller.getState().unconfirmedMutationCount).toBe(0);
    expect(collab.project.circuitSymbols).toHaveLength(0);

    // Resync-Warnung über ResyncHooks blockiert stilles Verwerfen ohne Confirm-Handler
    collab.connected = false;
    collab.controller.submitLocalMutation({
      type: "updateProjectProperties",
      updates: { note: "Offline-Edit" },
    });
    expect(collab.controller.getState().unconfirmedMutationCount).toBe(1);
    await flushMicrotasks();
    collab.connected = true;

    const cancelled = await collab.transport.requestResync("manual");
    expect(cancelled).toBe(false);
    expect(collab.controller.getState().unconfirmedMutationCount).toBe(1);

    const confirmSpy = vi.fn().mockResolvedValue(true);
    collab.controller.setResyncConfirmHandler(confirmSpy);
    const confirmed = await collab.transport.requestResync("manual");
    expect(confirmed).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(collab.controller.getState().unconfirmedMutationCount).toBe(0);
  });

  it("führt Reconnect-Catch-up über den Ringpuffer durch und fällt bei Überlauf auf Full-Snapshot zurück", async () => {
    const harness = createMultiPeerHarness({ maxRingBufferSize: 2 });
    const hostProject = createEmptyCircuitProject("CatchupTest", "Main");
    const host = harness.addNode("host-1", "host", hostProject);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    harness.emitSnapshotAll();
    await flushMicrotasks();

    // Kollaborateur kurz offline -> 2 Mutationen passen noch in den 2er-Ringpuffer
    collab.connected = false;
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "Step 1" } });
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "Step 2" } });
    await flushMicrotasks();
    expect(collab.project.project.name).toBe("CatchupTest");

    const receivedTopics: string[] = [];
    const origSendToPeer = host.transport.sendToPeer;
    host.transport.sendToPeer = async (targetPeerId, msg) => {
      if (msg.kind === "app") {
        receivedTopics.push(msg.topic);
      }
      await origSendToPeer(targetPeerId, msg);
    };

    collab.connected = true;
    await collab.transport.requestResync("reconnected");
    await flushMicrotasks();
    expect(collab.project.project.name).toBe("Step 2");
    expect(collab.controller.getState().revision).toBe(2);
    expect(receivedTopics).toContain("catchup-response");
    expect(receivedTopics).not.toContain(COLLAB_APP_TOPIC_PROJECT_SNAPSHOT);

    // Jetzt 3 Mutationen offline -> Ringpuffer läuft über -> Full-Snapshot-Fallback
    receivedTopics.length = 0;
    collab.connected = false;
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "Step 3" } });
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "Step 4" } });
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "Step 5" } });
    await flushMicrotasks();

    collab.connected = true;
    await collab.transport.requestResync("reconnected");
    await flushMicrotasks();
    expect(collab.project.project.name).toBe("Step 5");
    expect(collab.controller.getState().revision).toBe(5);
    expect(receivedTopics).toContain(COLLAB_APP_TOPIC_PROJECT_SNAPSHOT);
  });

  it("pausiert beim Host-Handover per Quiesce, übergibt Ringpuffer auch an Gäste und resynct bei Projektwechsel", async () => {
    const harness = createMultiPeerHarness();
    const hostProject = createEmptyCircuitProject("HandoverProj", "Main");
    const host = harness.addNode("host-1", "host", hostProject);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    const guest = harness.addNode("guest-1", "guest", createEmptyCircuitProject("Empty", "Main"));
    harness.emitSnapshotAll();
    await flushMicrotasks();

    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "Rev 1" } });
    await flushMicrotasks();

    // Handover an Gast
    await harness.transferHost("guest-1");
    expect(guest.controller.getState().revision).toBe(1);
    expect(guest.controller.getState().isReadOnlyForGuest).toBe(false);
    expect(collab.controller.getState().revision).toBe(1);
    expect(host.role).toBe("collaborator");

    // Neuer Host führt Projektwechsel durch -> alle Peers erhalten frischen Snapshot
    const replacedProject = createEmptyCircuitProject("FreshProject", "Main2");
    guest.project = replacedProject;
    guest.controller.notifyLocalProjectReplaced(replacedProject);
    await flushMicrotasks();

    expect(collab.project.project.name).toBe("FreshProject");
    expect(host.project.project.name).toBe("FreshProject");
    expect(collab.controller.getState().revision).toBe(2);
    expect(collab.controller.getState().epochId).toBe(guest.controller.getState().epochId);
  });

  it("isoliert den lokalen Bibliotheks-Bearbeitungsmodus auf Host-, Kollaborateur- und Gast-Seite", async () => {
    const harness = createMultiPeerHarness();
    const hostSessionProj = createEmptyCircuitProject("TeamCircuit", "Main");
    const host = harness.addNode("host-1", "host", hostSessionProj);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    const guest = harness.addNode("guest-1", "guest", createEmptyCircuitProject("Empty", "Main"));
    harness.emitSnapshotAll();
    await flushMicrotasks();

    // Host wechselt lokal in Bibliotheks-Bearbeitungsmodus
    host.backgroundProject = host.project;
    host.isEditingLibrary = true;
    host.project = createEmptyCircuitProject("MyLocalLibrary", "LibGate");
    expect(host.controller.canMutateProject()).toBe(true);

    // Lokale Bibliotheks-Mutation auf Host wird NICHT synchronisiert
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "LibChanged" } });
    await flushMicrotasks();
    expect(collab.project.project.name).toBe("TeamCircuit");

    // Gast darf im eigenen Bibliotheksmodus ebenfalls arbeiten
    guest.backgroundProject = guest.project;
    guest.isEditingLibrary = true;
    expect(guest.controller.canMutateProject()).toBe(true);
    guest.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "GuestLib" } });
    await flushMicrotasks();

    // Kollaborateur ändert TeamCircuit -> Host im Bibliotheksmodus nimmt Commit im Hintergrund autoritativ an,
    // und Gast erhält Update in seinem Background-Projekt (ohne sichtbare Bibliothek zu überschreiben)
    collab.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "TeamUpdated" } });
    await flushMicrotasks();
    expect(host.backgroundProject?.project.name).toBe("TeamUpdated");
    expect(host.project.project.name).toBe("MyLocalLibrary");
    expect(guest.backgroundProject?.project.name).toBe("TeamUpdated");
    expect(COLLAB_APP_TOPIC_CIRCUIT_COMMIT).toBe("circuit-commit");
    expect(COLLAB_APP_TOPIC_CIRCUIT_MUTATION_REJECTED).toBe("circuit-mutation-rejected");
  });

  it("pausiert Mutationen während Host-Dateiauswahl (project-loading) und hebt Sperre bei Abbruch oder Projektwechsel wieder auf", async () => {
    const harness = createMultiPeerHarness();
    const host = harness.addNode("host-1", "host", createEmptyCircuitProject("StartProj", "Main"));
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    const guest = harness.addNode("guest-1", "guest", createEmptyCircuitProject("Empty", "Main"));
    harness.emitSnapshotAll();
    await flushMicrotasks();

    // Host öffnet Datei-Auswahl -> alle Teilnehmer gehen in Quiesce mit Grund project-loading
    host.controller.setHostProjectLoading(true);
    await flushMicrotasks();

    expect(host.controller.getState().isQuiesced).toBe(true);
    expect(host.controller.getState().quiesceReason).toBe("project-loading");
    expect(collab.controller.getState().isQuiesced).toBe(true);
    expect(collab.controller.getState().quiesceReason).toBe("project-loading");
    expect(collab.controller.getState().syncStatus).toBe("quiesced");
    expect(guest.controller.getState().isQuiesced).toBe(true);
    expect(guest.controller.getState().quiesceReason).toBe("project-loading");
    expect(collab.controller.canMutateProject()).toBe(false);

    // Zwischenzeitliche Transport-/Roster-Snapshots löschen project-loading-Overlay nicht vorzeitig
    harness.emitSnapshotAll();
    await flushMicrotasks();
    expect(collab.controller.getState().isQuiesced).toBe(true);
    expect(collab.controller.getState().quiesceReason).toBe("project-loading");

    // Ein neu beitretender Peer erhält nach Initial-Snapshot ebenfalls die laufende Sperre
    const latePeer = harness.addNode("collab-late", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    harness.emitSnapshotAll();
    await flushMicrotasks();
    expect(latePeer.controller.getState().isQuiesced).toBe(true);
    expect(latePeer.controller.getState().quiesceReason).toBe("project-loading");

    // Eine noch unterwegs befindliche Mutation eines Kollaborateurs wird vom Host mit "quiesced" abgewiesen
    await collab.transport.sendToHost({
      kind: "app",
      topic: "circuit-mutation-request",
      payload: {
        mutationId: "in-flight-1",
        baseRevision: 0,
        mutation: { type: "updateProjectProperties", updates: { name: "TooLate" } },
      },
    });
    await flushMicrotasks();
    expect(collab.rejections).toHaveLength(1);
    expect(collab.rejections[0].code).toBe("quiesced");

    // Abbruch im Datei-Dialog hebt die Sperre sauber wieder auf
    host.controller.setHostProjectLoading(false);
    await flushMicrotasks();
    expect(host.controller.getState().isQuiesced).toBe(false);
    expect(host.controller.getState().quiesceReason).toBeNull();
    expect(collab.controller.getState().isQuiesced).toBe(false);
    expect(collab.controller.getState().quiesceReason).toBeNull();
    expect(collab.controller.getState().syncStatus).toBe("synced");
    expect(collab.controller.canMutateProject()).toBe(true);

    // Erneutes Öffnen + Laden einer neuen Schaltung hebt Sperre mit Projektwechsel-Snapshot ebenfalls auf
    host.controller.setHostProjectLoading(true);
    await flushMicrotasks();
    expect(collab.controller.getState().quiesceReason).toBe("project-loading");

    const loadedProj = createEmptyCircuitProject("LoadedCircuit", "MainNew");
    host.project = loadedProj;
    host.controller.notifyLocalProjectReplaced(loadedProj);
    await flushMicrotasks();

    expect(collab.project.project.name).toBe("LoadedCircuit");
    expect(collab.controller.getState().isQuiesced).toBe(false);
    expect(collab.controller.getState().quiesceReason).toBeNull();
    expect(collab.controller.canMutateProject()).toBe(true);
  });
});
