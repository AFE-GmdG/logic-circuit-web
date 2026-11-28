import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import CollabContext, { type CollabContextType } from "../contexts/collabContext";
import CollabContextProvider from "../contexts/collabContext/provider";
import LibraryContext, { type LibraryContextType } from "../contexts/libraryContext";
import LibraryContextProvider from "../contexts/libraryContext/provider";
import SimulationContext from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitProject from "../types/circuit/circuitProject";
import type CollabDataChannelMessage from "../types/collab/dataChannelMessage";
import type { CollabResyncReason } from "../types/collab/dataChannelMessage";
import { LIBRARY_FORMAT, type LibraryPersistenceState } from "../types/storage/circuitLibrary";

import CollabModelSyncController, {
  type CollabModelSyncTransport,
} from "../collab/collabModelSyncController";
import type { CollabTransportSnapshot } from "../collab/p2pSessionTransport";
import {
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createMemory,
  createPinCircuit,
  instantiateCircuitFromPalette,
  syncProjectLogicalCircuits,
} from "../utils/circuitLayout";
import { buildCircuitLibraryDocument } from "../utils/libraryStorage";
import { decodeMemoryData, encodeMemoryData, getCellValue, setCellValue, totalBytesFor } from "../utils/memoryDataUtils";
import { serializeLogicalCircuitToNative } from "../utils/storage/nativeProjectWriter";
import { createWire } from "../utils/wireUtils";

type PeerRuntime = {
  peerId: string;
  role: "host" | "collaborator" | "guest";
  getCircuit: () => React.ContextType<typeof CircuitContext>;
  getSim: () => React.ContextType<typeof SimulationContext>;
  getLibrary: () => LibraryContextType | undefined;
  sync: CollabModelSyncController;
  snapshotListeners: Set<(snap: CollabTransportSnapshot | null) => void>;
  messageListeners: Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>;
};

function createMultiContextCollabHarness(
  initialHostProject: CircuitProject,
  libraryState?: LibraryPersistenceState,
) {
  const peers = new Map<string, PeerRuntime>();
  const hostPeerId = "host-1";

  const mountPeer = (
    peerId: string,
    role: "host" | "collaborator" | "guest",
    initialProject: CircuitProject,
    withLibrary?: LibraryPersistenceState,
  ): PeerRuntime => {
    let circuitCtx!: React.ContextType<typeof CircuitContext>;
    let simCtx!: React.ContextType<typeof SimulationContext>;
    let libraryCtx: LibraryContextType | undefined;

    const Probe: React.FC = () => {
      circuitCtx = React.useContext(CircuitContext);
      simCtx = React.useContext(SimulationContext);
      libraryCtx = React.useContext(LibraryContext);
      return null;
    };

    const inner = withLibrary ? (
      <CircuitContextProvider initialProject={initialProject}>
        <SimulationContextProvider>
          <LibraryContextProvider initialPersistenceState={withLibrary} skipInitialLoad>
            <Probe />
          </LibraryContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>
    ) : (
      <CircuitContextProvider initialProject={initialProject}>
        <SimulationContextProvider>
          <Probe />
        </SimulationContextProvider>
      </CircuitContextProvider>
    );

    renderToStaticMarkup(inner);

    const snapshotListeners = new Set<(snap: CollabTransportSnapshot | null) => void>();
    const messageListeners = new Set<(fromPeerId: string, msg: CollabDataChannelMessage) => void>();

    const deliver = async (fromPeerId: string, toPeerId: string, msg: CollabDataChannelMessage) => {
      await Promise.resolve();
      const target = peers.get(toPeerId);
      if (!target) {
        return;
      }
      for (const listener of target.messageListeners) {
        listener(fromPeerId, msg);
      }
      await Promise.resolve();
      await Promise.resolve();
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
      sendToPeer: async (targetPeerId, msg) => {
        await deliver(peerId, targetPeerId, msg);
      },
      sendToHost: async (msg) => {
        await deliver(peerId, hostPeerId, msg);
      },
      broadcast: async (msg, excludePeerId) => {
        const deliveries: Promise<void>[] = [];
        for (const other of peers.values()) {
          if (other.peerId === peerId || other.peerId === excludePeerId) {
            continue;
          }
          deliveries.push(deliver(peerId, other.peerId, msg));
        }
        await Promise.all(deliveries);
      },
      requestResync: async (reason: CollabResyncReason = "manual", fromRevision?: number) => {
        await deliver(peerId, hostPeerId, {
          kind: "resync-request",
          reason,
          ...(fromRevision !== undefined ? { fromRevision } : {}),
          hasUnconfirmedLocalChanges: false,
        });
        return true;
      },
      setResyncHooks: () => {},
      setBeforeTransferHostHook: () => {},
    };

    const sync = new CollabModelSyncController({
      transport,
      adapter: {
        getVisibleProject: () => circuitCtx.project,
        applyAuthoritativeProject: (proj, opts) => {
          circuitCtx.applyRemoteProjectState?.(proj, opts);
        },
        isEditingLibrary: () => Boolean(libraryCtx?.isEditingLibrary),
        isLocalSnapshotSimulating: () => Boolean(simCtx.isSimulating && !libraryCtx?.isEditingLibrary),
        getLibraryBackgroundProject: () => libraryCtx?.getSavedSessionProject?.() ?? null,
        setLibraryBackgroundProject: (proj) => {
          libraryCtx?.updateSavedSessionProject?.(proj);
        },
      },
    });

    circuitCtx.registerCollabSyncBridge?.({
      canMutateProject: () => sync.canMutateProject(),
      onLocalDeltaCommitted: (delta, proj, opts) => sync.submitLocalDelta(delta, proj, opts),
      onLocalMutation: (mutation) => sync.submitLocalMutation(mutation),
      onLocalProjectReplaced: (nextProj) => sync.notifyLocalProjectReplaced(nextProj),
    });

    simCtx.registerCollabBridge?.({
      isCollabSnapshotMode: () => Boolean(sync.getState().syncStatus !== "idle" && !libraryCtx?.isEditingLibrary),
      onSimulationStateChange: (simulating) => {
        sync.setLocalSimulationActive(Boolean(simulating && !libraryCtx?.isEditingLibrary));
      },
    });

    const runtime: PeerRuntime = {
      peerId,
      role,
      getCircuit: () => circuitCtx,
      getSim: () => simCtx,
      getLibrary: () => libraryCtx,
      sync,
      snapshotListeners,
      messageListeners,
    };

    peers.set(peerId, runtime);
    return runtime;
  };

  const host = mountPeer("host-1", "host", initialHostProject, libraryState);
  const collab = mountPeer("collab-1", "collaborator", createEmptyCircuitProject("Empty", "Main"));
  const guest = mountPeer("guest-1", "guest", createEmptyCircuitProject("Empty", "Main"));

  const emitAll = () => {
    const peerSummaries = Array.from(peers.values())
      .filter((p) => p.peerId !== hostPeerId)
      .map((p) => ({
        peerId: p.peerId,
        role: p.role,
        displayName: p.peerId,
        state: "connected" as const,
        diagnostic: { code: "none" as const, isRecoverable: true, turnPlannedHint: false, details: "" },
        lastHeartbeatAt: 1000,
      }));
    for (const p of peers.values()) {
      const snap: CollabTransportSnapshot = {
        state: "connected",
        sessionId: "sess-ctx-sim",
        selfPeerId: p.peerId,
        selfRole: p.role,
        hostPeerId,
        peers: p.role === "host" ? peerSummaries : [],
        diagnostic: { code: "none", isRecoverable: true, turnPlannedHint: false, details: "" },
        gracePeriodMs: 20000,
        iceServers: [],
      };
      for (const listener of p.snapshotListeners) {
        listener(snap);
      }
    }
  };

  const dispose = () => {
    for (const p of peers.values()) {
      p.sync.dispose();
    }
  };

  return { host, collab, guest, emitAll, dispose };
}

function wireRamToProbe(
  project: CircuitProject,
  logicalCircuitId: string,
  ramId: string,
  initialData: string,
  prefix: string,
): void {
  const lc = project.logicalCircuits.find((c) => c.logicalCircuitId === logicalCircuitId)!;
  const ram = createMemory(ramId, true, 4, 8, {
    onStart: "data",
    data: initialData,
  });
  const ramSym = createCircuitSymbol(ram, logicalCircuitId, 20, 4, "up", `${prefix}-ram`);
  const addrConst = createConstant(`${prefix}-ca`, 4, 0);
  const dataConst = createConstant(`${prefix}-cd`, 8, 0);
  const outProbe = createCircuitProbe(`${prefix}-pr`, "Out");
  const addrSym = createCircuitSymbol(addrConst, logicalCircuitId, 6, 4, "up", `${prefix}-sym-ca`);
  const dataSym = createCircuitSymbol(dataConst, logicalCircuitId, 6, 8, "up", `${prefix}-sym-cd`);
  const probeSym = createCircuitSymbol(outProbe, logicalCircuitId, 32, 4, "up", `${prefix}-sym-pr`);

  const addrJam = ramSym.jams.find((j) => j.pin.name.startsWith("Address"))!;
  const dataInJam = ramSym.jams.find((j) => j.pin.name.startsWith("DataIn"))!;
  const dataOutJam = ramSym.jams.find((j) => j.pin.name === "Data")!;

  project.memories.push(ram);
  project.constants.push(addrConst, dataConst);
  project.circuitProbes.push(outProbe);
  project.circuits.set(ram.circuitId, ram);
  project.circuits.set(addrConst.circuitId, addrConst);
  project.circuits.set(dataConst.circuitId, dataConst);
  project.circuits.set(outProbe.circuitId, outProbe);
  project.circuitSymbols.push(ramSym, addrSym, dataSym, probeSym);
  lc.circuitSymbols.push(ramSym, addrSym, dataSym, probeSym);

  const wires = [
    createWire(logicalCircuitId, addrSym.jams[0].absolutePoint, addrJam.absolutePoint, `${prefix}-w1`),
    createWire(logicalCircuitId, dataSym.jams[0].absolutePoint, dataInJam.absolutePoint, `${prefix}-w2`),
    createWire(logicalCircuitId, dataOutJam.absolutePoint, probeSym.jams[0].absolutePoint, `${prefix}-w3`),
  ];
  project.wires.push(...wires);
  lc.wires.push(...wires);
}

function buildProjectWithPersistentRam(): CircuitProject {
  const project = createEmptyCircuitProject("RamCollabTest", "Main", "main-1", "proj-ram-1");
  const initBytes = new Uint8Array(totalBytesFor(4, 8));
  setCellValue(initBytes, 8, 0, 0x11);
  wireRamToProbe(project, "main-1", "ram-1", encodeMemoryData(initBytes, 4, 8), "main");
  return syncProjectLogicalCircuits(project);
}

function buildProjectWithSubCircuits() {
  let project = createEmptyCircuitProject("SubSimProj", "Root", "root-id", "proj-sub-1");
  const subA = createDefaultLogicalCircuit("sub-a-id", "SubA");
  const subB = createDefaultLogicalCircuit("sub-b-id", "SubB");

  const { pin: inPin, pinCircuit: inCircuit } = createPinCircuit(
    "pin-sub-a-in",
    subA.logicalCircuitId,
    "input",
    "IN",
    1,
    "left",
    false,
    0,
  );
  const notGate = createGate("not", 1, false);
  const pinSym = createCircuitSymbol(inCircuit, subA.logicalCircuitId, 2, 2, "up", "sym-sub-a-pin");
  const notSym = createCircuitSymbol(notGate, subA.logicalCircuitId, 8, 2, "up", "sym-sub-a-not");
  subA.logicalPins = [inPin];
  subA.circuitSymbols = [pinSym, notSym];

  project.pins.push(inPin);
  project.circuits.set(subA.circuitId, subA);
  project.circuits.set(subB.circuitId, subB);
  project.circuits.set(inCircuit.circuitId, inCircuit);
  project.circuits.set(notGate.circuitId, notGate);
  project.circuitSymbols.push(pinSym, notSym);
  project.logicalCircuits.push(subA, subB);

  const subAPlacement = instantiateCircuitFromPalette(
    project,
    "root-id",
    { type: "subCircuit", name: subA.name, subCircuitId: subA.logicalCircuitId },
    { x: 10, y: 10 },
  );
  project.circuitSymbols.push(subAPlacement.circuitSymbol);
  project.logicalCircuits[0].circuitSymbols.push(subAPlacement.circuitSymbol);
  project = syncProjectLogicalCircuits(project);

  return { project, rootId: "root-id", subAId: "sub-a-id", subBId: "sub-b-id", subANotSymId: notSym.circuitSymbolId };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 15));
}

describe("T-107: Seiteneffektfreie Snapshot-Simulation & Context-Verdrahtung", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  it("unterdrückt RAM-Rückschreiben in der Kollaborations-Session (Host, Kollaborateur, Gast), erhält es aber im Solo- und Bibliotheksmodus", async () => {
    // Solo-Modus schreibt persistente RAM-Änderungen regulär zurück
    const soloProject = buildProjectWithPersistentRam();
    let soloCircuit!: React.ContextType<typeof CircuitContext>;
    let soloSim!: React.ContextType<typeof SimulationContext>;
    const SoloProbe: React.FC = () => {
      soloCircuit = React.useContext(CircuitContext);
      soloSim = React.useContext(SimulationContext);
      return null;
    };
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={soloProject}>
        <SimulationContextProvider>
          <SoloProbe />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    const soloInit = await soloSim.ensurePausedSimulation();
    expect(soloInit).not.toBeNull();
    const soloMemInstanceId = Object.keys(soloInit!.snapshot.memoryRevisions ?? {})[0];
    expect(soloMemInstanceId).toBeTruthy();
    expect(await soloSim.writeMemoryCell(soloMemInstanceId, 0, 0xab)).toBe(true);
    await soloSim.stopSimulation();

    const soloDecoded = decodeMemoryData(soloCircuit.project.memories[0].data, 4, 8);
    expect(getCellValue(soloDecoded, 8, 0)).toBe(0xab);

    // Kollaborations-Session: Host, Kollaborateur und Gast dürfen RAM im Team-Projekt niemals zurückschreiben
    const libTempProj = createEmptyCircuitProject("TempLib", "Main", "lib-ram-1");
    wireRamToProbe(libTempProj, "lib-ram-1", "lib-mem-1", soloProject.memories[0].data, "lib");
    const libLc = libTempProj.logicalCircuits[0];
    libLc.name = "LibRam";
    libLc.category = "Memory";
    const libDoc = buildCircuitLibraryDocument([
      serializeLogicalCircuitToNative(libLc, libTempProj),
    ]);
    const libState: LibraryPersistenceState = {
      status: "synced",
      isReadOnly: false,
      fileName: "team.lclib",
      cachedAt: 1000,
      lastSyncedAt: 1000,
      document: { ...libDoc, format: LIBRARY_FORMAT },
    };

    const harness = createMultiContextCollabHarness(buildProjectWithPersistentRam(), libState);
    harness.emitAll();
    await flushMicrotasks();

    for (const peer of [harness.host, harness.collab, harness.guest]) {
      const sim = peer.getSim();
      const paused = await sim.ensurePausedSimulation();
      expect(paused).not.toBeNull();
      expect(sim.isCollabSnapshotSimulation).toBe(true);
      const memId = Object.keys(paused!.snapshot.memoryRevisions ?? {})[0];
      expect(await sim.writeMemoryCell(memId, 0, 0xcd)).toBe(true);

      // Flush (z. B. beim Pausieren oder Exportieren) sowie Stop schreiben NICHT ins gemeinsame Projekt zurück
      expect(await sim.flushPersistentMemories()).toBe(false);
      await sim.stopSimulation();
      expect(sim.isCollabSnapshotSimulation).toBe(false);
    }

    await flushMicrotasks();
    for (const peer of [harness.host, harness.collab, harness.guest]) {
      const decoded = decodeMemoryData(peer.getCircuit().project.memories[0].data, 4, 8);
      expect(getCellValue(decoded, 8, 0)).toBe(0x11);
    }

    // Im lokalen Bibliotheks-Bearbeitungsmodus bleibt RAM-Persistenz weiterhin aktiv
    await harness.host.getLibrary()!.enterLibraryEditMode("lib-ram-1");
    const libSim = harness.host.getSim();
    const libPaused = await libSim.ensurePausedSimulation();
    expect(libSim.isCollabSnapshotSimulation).toBe(false);
    const libMemId = Object.keys(libPaused!.snapshot.memoryRevisions ?? {})[0];
    expect(await libSim.writeMemoryCell(libMemId, 0, 0xef)).toBe(true);
    await libSim.stopSimulation();

    const libDecoded = decodeMemoryData(harness.host.getCircuit().project.memories[0].data, 4, 8);
    expect(getCellValue(libDecoded, 8, 0)).toBe(0xef);

    harness.dispose();
  });

  it("hält Frequenz- und Max-Speed-Änderungen während kollaborativer Snapshot-Simulation streng lokal", async () => {
    const harness = createMultiContextCollabHarness(buildProjectWithPersistentRam());
    harness.emitAll();
    await flushMicrotasks();

    expect(harness.host.getCircuit().project.project.frequency).toBe(10);
    expect(harness.host.getCircuit().project.project.isMaximumSpeed).toBe(false);

    const collabSim = harness.collab.getSim();
    await collabSim.ensurePausedSimulation();
    expect(collabSim.isCollabSnapshotSimulation).toBe(true);

    collabSim.setFrameRateLimit("max");
    expect(collabSim.frameRateLimit).toBe("max");
    await flushMicrotasks();

    // Weder lokal im Team-Modell noch beim Host wird eine Frequenz-Mutation synchronisiert
    expect(harness.collab.getCircuit().project.project.isMaximumSpeed).toBe(false);
    expect(harness.host.getCircuit().project.project.isMaximumSpeed).toBe(false);
    expect(harness.host.sync.getState().revision).toBe(0);

    collabSim.setFrameRateLimit(5);
    expect(collabSim.frameRateLimit).toBe(5);
    await collabSim.stopSimulation();
    expect(harness.host.getCircuit().project.project.frequency).toBe(10);

    harness.dispose();
  });

  it("ermöglicht freie Sub-Schaltungsnavigation im eingefrorenen Snapshot und zieht gepufferte Team-Deltas beim Stoppen nach", async () => {
    const { project, rootId, subAId, subBId, subANotSymId } = buildProjectWithSubCircuits();
    const harness = createMultiContextCollabHarness(project);
    harness.emitAll();
    await flushMicrotasks();

    const collabSim = harness.collab.getSim();
    const collabCircuit = harness.collab.getCircuit();
    const paused = await collabSim.ensurePausedSimulation();
    expect(paused).not.toBeNull();
    const rootMap = collabSim.rootCircuitMap!;
    const subAChildMap = Array.from(rootMap.children.values()).find(
      (child) => child.circuit.logicalCircuitId === subAId,
    )!;
    expect(subAChildMap).toBeDefined();

    // In Sub-Schaltung navigieren während Team SubA verändert und SubB löscht
    collabSim.selectCircuitMap(subAChildMap);
    expect(collabCircuit.currentCircuit.logicalCircuitId).toBe(subAId);
    expect(collabSim.selectedCircuitMap).toBe(subAChildMap);

    harness.host.getCircuit().setCurrentCircuitId(subAId);
    harness.host.getCircuit().moveEntities({
      symbolIds: [subANotSymId],
      dx: 4,
      dy: 3,
    });
    harness.host.getCircuit().setCurrentCircuitId(rootId);
    harness.host.getCircuit().deleteCircuits([subBId]);
    await flushMicrotasks();

    // Eingefrorener Snapshot des Teilnehmers bleibt komplett unberührt und frei navigierbar
    expect(harness.collab.sync.getState().pendingSimulationDeltaCount).toBe(2);
    expect(collabCircuit.project.logicalCircuits.some((lc) => lc.logicalCircuitId === subBId)).toBe(true);
    expect(
      collabCircuit.project.logicalCircuits
        .find((lc) => lc.logicalCircuitId === subAId)
        ?.circuitSymbols.find((s) => s.circuitSymbolId === subANotSymId),
    ).toMatchObject({ x: 8, y: 2 });

    collabSim.selectCircuitMap(rootMap);
    expect(collabCircuit.currentCircuit.logicalCircuitId).toBe(rootId);
    collabSim.selectCircuitMap(subAChildMap);
    expect(collabCircuit.currentCircuit.logicalCircuitId).toBe(subAId);
    expect(collabSim.isSimulating).toBe(true);

    // Beim Beenden greift der automatische Delta-Nachzug
    await collabSim.stopSimulation();
    expect(harness.collab.sync.getState().pendingSimulationDeltaCount).toBe(0);
    expect(collabCircuit.project.logicalCircuits.some((lc) => lc.logicalCircuitId === subBId)).toBe(false);
    expect(
      collabCircuit.project.logicalCircuits
        .find((lc) => lc.logicalCircuitId === subAId)
        ?.circuitSymbols.find((s) => s.circuitSymbolId === subANotSymId),
    ).toMatchObject({ x: 12, y: 5 });

    // Falls die aktuell geöffnete Schaltung während der Simulation gelöscht wurde, greift sicherer Fallback
    const guestSim = harness.guest.getSim();
    const guestCircuit = harness.guest.getCircuit();
    expect(guestCircuit.project.logicalCircuits.some((lc) => lc.logicalCircuitId === subAId)).toBe(true);
    guestCircuit.setCurrentCircuitId(subAId);
    await guestSim.ensurePausedSimulation(
      guestCircuit.project.logicalCircuits.find((lc) => lc.logicalCircuitId === subAId),
    );
    expect(guestSim.isSimulating).toBe(true);

    // Host entfernt SubA-Referenz aus Root und löscht SubA
    harness.host.getCircuit().setCurrentCircuitId(rootId);
    const refSymId = harness.host.getCircuit().project.logicalCircuits[0].circuitSymbols[0].circuitSymbolId;
    harness.host.getCircuit().removeEntities([refSymId], [], []);
    harness.host.getCircuit().deleteCircuits([subAId]);
    await flushMicrotasks();

    await guestSim.stopSimulation();
    expect(guestCircuit.project.logicalCircuits.map((lc) => lc.logicalCircuitId)).toEqual([rootId]);
    expect(guestCircuit.currentCircuit.logicalCircuitId).toBe(rootId);

    harness.dispose();
  });

  it("sperrt Hinspringen und Folgen im CollabContextProvider während einer laufenden lokalen Simulation", async () => {
    let capturedCollab!: CollabContextType;
    let capturedSim!: React.ContextType<typeof SimulationContext>;

    const Probe: React.FC = () => {
      capturedCollab = React.useContext(CollabContext)!;
      capturedSim = React.useContext(SimulationContext);
      return null;
    };

    const project = createEmptyCircuitProject("GuardTest", "Main", "main-1");
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContextProvider skipInitialLoad>
            <CanvasContextProvider>
              <CollabContextProvider>
                <Probe />
              </CollabContextProvider>
            </CanvasContextProvider>
          </LibraryContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(capturedSim.isSimulating).toBe(false);
    await capturedSim.ensurePausedSimulation();
    expect(capturedSim.isSimulating).toBe(true);
    expect(capturedCollab.jumpToParticipant?.("peer-2")).toBe(false);
    expect(capturedCollab.startFollowingPeer?.("peer-2")).toBe(false);

    await capturedSim.stopSimulation();
    expect(capturedSim.isSimulating).toBe(false);
  });
});
