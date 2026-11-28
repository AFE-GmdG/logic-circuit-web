import { describe, expect, it } from "vitest";

import type CircuitProject from "../types/circuit/circuitProject";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type { CollabResyncReason } from "../types/collab/dataChannelMessage";
import type { CollabCircuitCommitPayload, CollabMutationRejectedPayload } from "../types/collab/modelSyncMessage";
import { COLLAB_APP_TOPIC_PROJECT_SNAPSHOT } from "../types/collab/modelSyncMessage";

import CollabModelSyncController, {
  type CollabModelSyncTransport,
} from "../collab/collabModelSyncController";
import type { CollabTransportSnapshot, ResyncHooks } from "../collab/p2pSessionTransport";
import {
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  instantiateCircuitFromPalette,
  syncProjectLogicalCircuits,
} from "../utils/circuitLayout";
import { serializeLogicalCircuitToNative } from "../utils/storage/nativeProjectWriter";

type PeerNode = {
  peerId: string;
  role: "host" | "collaborator" | "guest";
  project: CircuitProject;
  backgroundProject: CircuitProject | null;
  isEditingLibrary: boolean;
  connected: boolean;
  transportStateOverride: CollabTransportSnapshot["state"] | null;
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
    state: migrating
      ? "migrating-host"
      : (node.transportStateOverride ?? (node.connected ? "connected" : "disconnected")),
    sessionId: "sess-sim-1",
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

  const emitSnapshotFor = (peerId: string) => {
    const node = nodes.get(peerId);
    if (!node) {
      return;
    }
    const snap = buildSnapshotFor(node, false);
    for (const listener of node.snapshotListeners) {
      listener(snap);
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
      transportStateOverride: null,
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

  return { nodes, addNode, emitSnapshotAll, emitSnapshotFor, transferHost };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("T-106: CollabModelSyncController Snapshot-Simulation, Delta-Puffer & Nachzug", () => {
  it("friert sichtbares Projekt bei Kollaborateur und Gast ein, puffert Deltas und zieht beim Beenden nach", async () => {
    const harness = createMultiPeerHarness();
    const hostProject = createEmptyCircuitProject("SimSyncProj", "Main");
    const mainId = hostProject.logicalCircuits[0].logicalCircuitId;
    const gate = instantiateCircuitFromPalette(hostProject, mainId, { type: "and", name: "AND", inputCount: 2 }, { x: 8, y: 8 });
    hostProject.circuitSymbols.push(gate.circuitSymbol);
    hostProject.logicalCircuits[0].circuitSymbols.push(gate.circuitSymbol);
    const gateId = gate.circuitSymbol.circuitSymbolId;

    const host = harness.addNode("host-1", "host", hostProject);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    const guest = harness.addNode("guest-1", "guest", createEmptyCircuitProject("Empty", "Main"));

    harness.emitSnapshotAll();
    await flushMicrotasks();

    const frozenCollabProject = collab.project;
    const frozenGuestProject = guest.project;
    collab.controller.setLocalSimulationActive(true);
    guest.controller.setLocalSimulationActive(true);

    expect(collab.controller.getState().isLocalSimulationBuffered).toBe(true);
    expect(guest.controller.getState().isLocalSimulationBuffered).toBe(true);
    expect(collab.controller.canMutateProject()).toBe(false);
    expect(guest.controller.canMutateProject()).toBe(false);

    // Host committet drei Änderungen (Verschieben, Projektname, weiteres Gatter)
    host.controller.submitLocalMutation({
      type: "move",
      logicalCircuitId: mainId,
      symbolIds: [gateId],
      textNoteIds: [],
      dx: 5,
      dy: 3,
    });
    host.controller.submitLocalMutation({
      type: "updateProjectProperties",
      updates: { name: "UpdatedDuringSim" },
    });
    const gate2 = instantiateCircuitFromPalette(host.project, mainId, { type: "or", name: "OR", inputCount: 2 }, { x: 20, y: 12 });
    const nativeGate2 = serializeLogicalCircuitToNative(
      { ...host.project.logicalCircuits[0], circuitSymbols: [gate2.circuitSymbol], pins: [], wires: [], textNotes: [] },
      { ...host.project, circuitSymbols: [gate2.circuitSymbol] },
    );
    host.controller.submitLocalMutation({
      type: "add",
      logicalCircuitId: mainId,
      entities: {
        logicalCircuitId: mainId,
        pins: nativeGate2.pins,
        elements: nativeGate2.elements,
        wires: [],
        textNotes: [],
      },
    });
    await flushMicrotasks();

    // Sichtbare Snapshot-Projekte von Kollaborateur und Gast bleiben vollständig eingefroren
    expect(collab.project).toBe(frozenCollabProject);
    expect(collab.project.project.name).toBe("SimSyncProj");
    expect(collab.project.circuitSymbols).toHaveLength(1);
    expect(collab.project.circuitSymbols[0]).toMatchObject({ x: 8, y: 8 });
    expect(collab.controller.getState().pendingSimulationDeltaCount).toBe(3);

    expect(guest.project).toBe(frozenGuestProject);
    expect(guest.project.project.name).toBe("SimSyncProj");
    expect(guest.controller.getState().pendingSimulationDeltaCount).toBe(3);

    // Beim Beenden der Simulation werden alle Deltas in Revisionsreihenfolge nachgezogen
    collab.controller.setLocalSimulationActive(false);
    expect(collab.controller.getState().isLocalSimulationBuffered).toBe(false);
    expect(collab.controller.getState().pendingSimulationDeltaCount).toBe(0);
    expect(collab.controller.getState().revision).toBe(3);
    expect(collab.project.project.name).toBe("UpdatedDuringSim");
    expect(collab.project.circuitSymbols).toHaveLength(2);
    expect(collab.project.circuitSymbols.find((s) => s.circuitSymbolId === gateId)).toMatchObject({ x: 13, y: 11 });

    guest.controller.setLocalSimulationActive(false);
    expect(guest.controller.getState().revision).toBe(3);
    expect(guest.project.project.name).toBe("UpdatedDuringSim");
    expect(guest.project.circuitSymbols).toHaveLength(2);
  });

  it("erlaubt freie Schaltungs- und Sub-Schaltungswechsel im eingefrorenen Snapshot trotz Remote-Änderungen und -Löschungen", async () => {
    const harness = createMultiPeerHarness();
    let hostProject = createEmptyCircuitProject("SubSwitchProj", "Root");
    const subA = createDefaultLogicalCircuit("sub-a-id", "SubA");
    const subB = createDefaultLogicalCircuit("sub-b-id", "SubB");

    const subAGate = instantiateCircuitFromPalette(hostProject, subA.logicalCircuitId, { type: "not", name: "NOT" }, { x: 6, y: 6 });
    subA.circuitSymbols.push(subAGate.circuitSymbol);
    hostProject.circuitSymbols.push(subAGate.circuitSymbol);
    hostProject.logicalCircuits.push(subA, subB);

    const rootId = hostProject.logicalCircuits[0].logicalCircuitId;
    const subAPlacement = instantiateCircuitFromPalette(
      hostProject,
      rootId,
      { type: "subCircuit", name: subA.name, subCircuitId: subA.logicalCircuitId },
      { x: 10, y: 10 },
    );
    hostProject.circuitSymbols.push(subAPlacement.circuitSymbol);
    hostProject.logicalCircuits[0].circuitSymbols.push(subAPlacement.circuitSymbol);
    hostProject = syncProjectLogicalCircuits(hostProject);

    const host = harness.addNode("host-1", "host", hostProject);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));

    harness.emitSnapshotAll();
    await flushMicrotasks();

    // Kollaborateur startet lokale Simulation und merkt sich eingefrorene Sub-Schaltungen
    collab.controller.setLocalSimulationActive(true);
    const snapshotRootBefore = collab.project.logicalCircuits.find((lc) => lc.logicalCircuitId === rootId)!;
    const snapshotSubABefore = collab.project.logicalCircuits.find((lc) => lc.logicalCircuitId === "sub-a-id")!;
    const snapshotSubBBefore = collab.project.logicalCircuits.find((lc) => lc.logicalCircuitId === "sub-b-id")!;
    expect(snapshotSubABefore.circuitSymbols[0]).toMatchObject({ x: 6, y: 6 });

    // Team ändert SubA und löscht SubB während der Simulation
    host.controller.submitLocalMutation({
      type: "move",
      logicalCircuitId: "sub-a-id",
      symbolIds: [subAGate.circuitSymbol.circuitSymbolId],
      textNoteIds: [],
      dx: 10,
      dy: 10,
    });
    host.controller.submitLocalMutation({
      type: "deleteCircuits",
      circuitIds: ["sub-b-id"],
    });
    await flushMicrotasks();

    // Innerhalb des Snapshots sind Root, SubA (mit alten Koordinaten) und SubB weiterhin unverändert ansteuerbar
    expect(collab.project.logicalCircuits).toHaveLength(3);
    expect(collab.project.logicalCircuits.find((lc) => lc.logicalCircuitId === rootId)).toBe(snapshotRootBefore);
    expect(collab.project.logicalCircuits.find((lc) => lc.logicalCircuitId === "sub-a-id")).toBe(snapshotSubABefore);
    expect(collab.project.logicalCircuits.find((lc) => lc.logicalCircuitId === "sub-b-id")).toBe(snapshotSubBBefore);
    expect(snapshotSubABefore.circuitSymbols[0]).toMatchObject({ x: 6, y: 6 });
    expect(collab.controller.getState().pendingSimulationDeltaCount).toBe(2);

    // Nach Simulationsende greifen die Team-Änderungen (SubB entfernt, SubA verschoben)
    collab.controller.setLocalSimulationActive(false);
    expect(collab.project.logicalCircuits.map((lc) => lc.logicalCircuitId)).toEqual([rootId, "sub-a-id"]);
    const updatedSubA = collab.project.logicalCircuits.find((lc) => lc.logicalCircuitId === "sub-a-id")!;
    expect(updatedSubA.circuitSymbols[0]).toMatchObject({ x: 16, y: 16 });
  });

  it("wahrt Host-Kontinuität während eigener Snapshot-Simulation und zieht bei Stopp sichtbar nach", async () => {
    const harness = createMultiPeerHarness();
    const hostProject = createEmptyCircuitProject("HostSimProj", "Main");
    const host = harness.addNode("host-1", "host", hostProject);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
    const guest = harness.addNode("guest-1", "guest", createEmptyCircuitProject("Empty", "Main"));

    harness.emitSnapshotAll();
    await flushMicrotasks();

    // Host simuliert lokal; sichtbares Projekt bleibt eingefroren
    const frozenHostProject = host.project;
    host.controller.setLocalSimulationActive(true);
    expect(host.controller.canMutateProject()).toBe(false);

    // Kollaborateur schickt eine Mutation; Host verarbeitet sie autoritativ im Hintergrund & verteilt an Gast
    collab.controller.submitLocalMutation({
      type: "updateProjectProperties",
      updates: { name: "CollabTeamUpdate" },
    });
    await flushMicrotasks();

    expect(guest.project.project.name).toBe("CollabTeamUpdate");
    expect(guest.controller.getState().revision).toBe(1);
    expect(host.project).toBe(frozenHostProject);
    expect(host.project.project.name).toBe("HostSimProj");
    expect(host.controller.getState().revision).toBe(1);
    expect(host.controller.getState().pendingSimulationDeltaCount).toBe(1);

    // Host beendet Simulation -> sichtbares Projekt springt direkt auf den aktuellen Stand
    host.controller.setLocalSimulationActive(false);
    expect(host.project.project.name).toBe("CollabTeamUpdate");
    expect(host.controller.getState().pendingSimulationDeltaCount).toBe(0);
  });

  it("puffert Host-Projektwechsel während Simulation und wendet ihn erst beim Stoppen an", async () => {
    const harness = createMultiPeerHarness();
    const host = harness.addNode("host-1", "host", createEmptyCircuitProject("OldProject", "Main"));
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));

    harness.emitSnapshotAll();
    await flushMicrotasks();

    collab.controller.setLocalSimulationActive(true);
    const freshProject = createEmptyCircuitProject("FreshLoadedProject", "NewMain");
    host.project = freshProject;
    host.controller.notifyLocalProjectReplaced(freshProject);
    await flushMicrotasks();

    expect(collab.project.project.name).toBe("OldProject");
    expect(collab.controller.getState().hasPendingProjectSwitchDuringSim).toBe(true);
    expect(collab.controller.getState().pendingSimulationDeltaCount).toBe(1);

    collab.controller.setLocalSimulationActive(false);
    expect(collab.project.project.name).toBe("FreshLoadedProject");
    expect(collab.controller.getState().hasPendingProjectSwitchDuringSim).toBe(false);
    expect(collab.controller.getState().pendingSimulationDeltaCount).toBe(0);
  });

  it("löst bei Verbindungsunterbrechung während Simulation nach Stopp automatisch Ringpuffer-Catch-up bzw. Full-Resync aus", async () => {
    const harness = createMultiPeerHarness({ maxRingBufferSize: 2 });
    const host = harness.addNode("host-1", "host", createEmptyCircuitProject("ReconnectSim", "Main"));
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));

    harness.emitSnapshotAll();
    await flushMicrotasks();

    // Erster Fall: Kurze Trennung innerhalb des Ringpuffers während laufender Simulation
    collab.controller.setLocalSimulationActive(true);
    collab.connected = false;
    collab.transportStateOverride = "reconnecting";
    harness.emitSnapshotFor("collab-1");

    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "OfflineRev1" } });
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "OfflineRev2" } });
    await flushMicrotasks();

    collab.connected = true;
    collab.transportStateOverride = "connected";
    harness.emitSnapshotFor("collab-1");
    await flushMicrotasks();

    // Noch in Simulation -> sichtbar weiterhin eingefroren, aber Resync vorgemerkt
    expect(collab.project.project.name).toBe("ReconnectSim");
    expect(collab.controller.getState().requiresResyncAfterSimulation).toBe(true);

    const topicsOnExit1: string[] = [];
    const origSendToPeer = host.transport.sendToPeer;
    host.transport.sendToPeer = async (targetPeerId, msg) => {
      if (msg.kind === "app") {
        topicsOnExit1.push(msg.topic);
      }
      await origSendToPeer(targetPeerId, msg);
    };

    collab.controller.setLocalSimulationActive(false);
    await flushMicrotasks();

    expect(collab.project.project.name).toBe("OfflineRev2");
    expect(collab.controller.getState().revision).toBe(2);
    expect(collab.controller.getState().requiresResyncAfterSimulation).toBe(false);
    expect(topicsOnExit1).toContain("catchup-response");
    expect(topicsOnExit1).not.toContain(COLLAB_APP_TOPIC_PROJECT_SNAPSHOT);

    // Zweiter Fall: Ringpuffer-Überlauf während Offline-Simulation -> Full-Snapshot beim Verlassen
    topicsOnExit1.length = 0;
    collab.controller.setLocalSimulationActive(true);
    collab.connected = false;
    collab.transportStateOverride = "reconnecting";
    harness.emitSnapshotFor("collab-1");

    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "OfflineRev3" } });
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "OfflineRev4" } });
    host.controller.submitLocalMutation({ type: "updateProjectProperties", updates: { name: "OfflineRev5" } });
    await flushMicrotasks();

    collab.connected = true;
    collab.transportStateOverride = "connected";
    harness.emitSnapshotFor("collab-1");
    await flushMicrotasks();

    collab.controller.setLocalSimulationActive(false);
    await flushMicrotasks();

    expect(collab.project.project.name).toBe("OfflineRev5");
    expect(collab.controller.getState().revision).toBe(5);
    expect(topicsOnExit1).toContain(COLLAB_APP_TOPIC_PROJECT_SNAPSHOT);
  });

  it("gibt lokale Soft-Locks bei Simulationsstart frei und übersteht einen Host-Handover während laufender Simulation", async () => {
    const harness = createMultiPeerHarness();
    const hostProject = createEmptyCircuitProject("HandoverSimProj", "Main");
    const mainId = hostProject.logicalCircuits[0].logicalCircuitId;
    const gate = instantiateCircuitFromPalette(hostProject, mainId, { type: "and", name: "AND", inputCount: 2 }, { x: 4, y: 4 });
    hostProject.circuitSymbols.push(gate.circuitSymbol);
    hostProject.logicalCircuits[0].circuitSymbols.push(gate.circuitSymbol);

    const host = harness.addNode("host-1", "host", hostProject);
    const collab = harness.addNode("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));

    harness.emitSnapshotAll();
    await flushMicrotasks();

    // Kollaborateur hält Soft-Lock und startet Simulation -> Lock wird sofort freigegeben
    const lockRes = collab.controller.acquireSoftLocks(
      [{ targetType: "symbol", targetId: gate.circuitSymbol.circuitSymbolId, logicalCircuitId: mainId }],
      "drag",
    );
    expect(lockRes.ok).toBe(true);
    await flushMicrotasks();
    expect(host.controller.getSoftLocks()).toHaveLength(1);

    collab.controller.setLocalSimulationActive(true);
    await flushMicrotasks();
    expect(host.controller.getSoftLocks()).toHaveLength(0);

    // Während Kollaborateur simuliert, ändert Host Projekt und übergibt Host-Rolle an Kollaborateur
    host.controller.submitLocalMutation({
      type: "updateProjectProperties",
      updates: { name: "BeforeHandover" },
    });
    await flushMicrotasks();

    await harness.transferHost("collab-1");
    expect(collab.role).toBe("host");
    // Sichtbares Simulationsprojekt von collab bleibt weiterhin eingefroren bis zum Stopp
    expect(collab.project.project.name).toBe("HandoverSimProj");

    collab.controller.setLocalSimulationActive(false);
    expect(collab.project.project.name).toBe("BeforeHandover");
    expect(collab.controller.getState().revision).toBe(1);
  });
});
