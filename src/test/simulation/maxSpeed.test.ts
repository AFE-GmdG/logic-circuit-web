import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../../contexts/canvasContext/provider";
import CircuitContextProvider from "../../contexts/circuitContext/provider";
import SimulationContext, {
  DEFAULT_SIMULATION_STATE,
  type SimulationContextType,
} from "../../contexts/simulationContext";

import type GridPoint from "../../types/canvas/gridPoint";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Wire from "../../types/circuit/wire";

import CircuitRunner from "../../simulation/worker/circuitRunner";
import SimulationClient from "../../simulation/worker/simulationClient";
import SnapshotScheduler from "../../simulation/worker/snapshotScheduler";
import type { SimulationSnapshot, WorkerCommand, WorkerResponse } from "../../simulation/worker/workerMessages";
import {
  calculateCircuitDimensionsAndPins,
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
} from "../../utils/circuitLayout";

import RunningCircuitTree from "../../components/runningCircuitTree";

function makeWire(wireId: string, logicalCircuitId: string, point1: GridPoint, point2: GridPoint): Wire {
  return {
    wireId,
    logicalCircuitId,
    x1: point1.x,
    y1: point1.y,
    x2: point2.x,
    y2: point2.y,
    point1,
    point2,
  };
}

// Erstellt einen flankengesteuerten T-Flip-Flop-Subcircuit (Frequenzteiler durch 2) aus 6 NAND-Gattern
function createTFlipFlopSubCircuit(circuitId = "t-ff", name = "TFlipFlop"): LogicalCircuit {
  const ff = createDefaultLogicalCircuit(circuitId, name);

  const clkPinData = createPinCircuit(`${circuitId}-pin-clk`, circuitId, "input", "CLK", 1, "left", false, 0);
  const qPinData = createPinCircuit(`${circuitId}-pin-q`, circuitId, "output", "Q", 1, "right", false, 0);
  const qBarPinData = createPinCircuit(`${circuitId}-pin-qn`, circuitId, "output", "Qn", 1, "right", false, 1);

  const layout = calculateCircuitDimensionsAndPins(
    [clkPinData.pin, qPinData.pin, qBarPinData.pin],
    3,
    4,
  );
  ff.symbolWidth = layout.gridWidth;
  ff.symbolHeight = layout.gridHeight;
  ff.logicalPins = [clkPinData.pin, qPinData.pin, qBarPinData.pin];
  ff.pins = layout.pins;

  const symClk = createCircuitSymbol(clkPinData.pinCircuit, circuitId, 0, 10, "up", `${circuitId}-s-clk`);
  const symQ = createCircuitSymbol(qPinData.pinCircuit, circuitId, 40, 5, "up", `${circuitId}-s-q`);
  const symQBar = createCircuitSymbol(qBarPinData.pinCircuit, circuitId, 40, 20, "up", `${circuitId}-s-qn`);

  // Klassisches 6-NAND-Master-Slave-D-Flip-Flop mit Rückführung Qn -> D (Toggeln bei steigender Flanke)
  const g1 = createCircuitSymbol(createGate("and", 2, true), circuitId, 10, 0, "up", `${circuitId}-g1`);
  const g2 = createCircuitSymbol(createGate("and", 2, true), circuitId, 10, 10, "up", `${circuitId}-g2`);
  const g3 = createCircuitSymbol(createGate("and", 3, true), circuitId, 10, 20, "up", `${circuitId}-g3`);
  const g4 = createCircuitSymbol(createGate("and", 2, true), circuitId, 10, 30, "up", `${circuitId}-g4`);
  const g5 = createCircuitSymbol(createGate("and", 2, true), circuitId, 25, 5, "up", `${circuitId}-g5`);
  const g6 = createCircuitSymbol(createGate("and", 2, true), circuitId, 25, 20, "up", `${circuitId}-g6`);

  ff.circuitSymbols = [symClk, symQ, symQBar, g1, g2, g3, g4, g5, g6];

  const clkOut = symClk.jams[0].absolutePoint;
  const qIn = symQ.jams[0].absolutePoint;
  const qBarIn = symQBar.jams[0].absolutePoint;

  const g1In = g1.jams.filter((j) => j.pin.pinType === "input").map((j) => j.absolutePoint);
  const g1Out = g1.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;

  const g2In = g2.jams.filter((j) => j.pin.pinType === "input").map((j) => j.absolutePoint);
  const g2Out = g2.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;

  const g3In = g3.jams.filter((j) => j.pin.pinType === "input").map((j) => j.absolutePoint);
  const g3Out = g3.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;

  const g4In = g4.jams.filter((j) => j.pin.pinType === "input").map((j) => j.absolutePoint);
  const g4Out = g4.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;

  const g5In = g5.jams.filter((j) => j.pin.pinType === "input").map((j) => j.absolutePoint);
  const g5Out = g5.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;

  const g6In = g6.jams.filter((j) => j.pin.pinType === "input").map((j) => j.absolutePoint);
  const g6Out = g6.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;

  ff.wires = [
    // G1 = NAND(G4, G2)
    makeWire(`${circuitId}-w1`, circuitId, g4Out, g1In[0]),
    makeWire(`${circuitId}-w2`, circuitId, g2Out, g1In[1]),
    // G2 = NAND(G1, CLK)
    makeWire(`${circuitId}-w3`, circuitId, g1Out, g2In[0]),
    makeWire(`${circuitId}-w4`, circuitId, clkOut, g2In[1]),
    // G3 = NAND(G2, CLK, G4)
    makeWire(`${circuitId}-w5`, circuitId, g2Out, g3In[0]),
    makeWire(`${circuitId}-w6`, circuitId, clkOut, g3In[1]),
    makeWire(`${circuitId}-w7`, circuitId, g4Out, g3In[2]),
    // G4 = NAND(G3, D = Qn)
    makeWire(`${circuitId}-w8`, circuitId, g3Out, g4In[0]),
    makeWire(`${circuitId}-w9`, circuitId, g6Out, g4In[1]),
    // Ausgangs-Latch Q = NAND(G2, Qn), Qn = NAND(Q, G3)
    makeWire(`${circuitId}-w10`, circuitId, g2Out, g5In[0]),
    makeWire(`${circuitId}-w11`, circuitId, g6Out, g5In[1]),
    makeWire(`${circuitId}-w12`, circuitId, g5Out, g6In[0]),
    makeWire(`${circuitId}-w13`, circuitId, g3Out, g6In[1]),
    // Ausgangspins
    makeWire(`${circuitId}-w14`, circuitId, g5Out, qIn),
    makeWire(`${circuitId}-w15`, circuitId, g6Out, qBarIn),
  ];

  return ff;
}

// Erstellt einen 4-stufigen Binärzähler (Frequenzteiler /2, /4, /8, /16) mit Taktgeber und interaktivem Taster
function createFourStageCounterCircuit(): LogicalCircuit {
  const main = createDefaultLogicalCircuit("counter-main", "FourStageCounter");
  const tff = createTFlipFlopSubCircuit();

  const clkSym = createCircuitSymbol(createGate("clock", 0, false), "counter-main", 0, 10, "up", "sym-clk");
  const stage0 = createCircuitSymbol(tff, "counter-main", 10, 10, "up", "stage-0");
  const stage1 = createCircuitSymbol(tff, "counter-main", 20, 10, "up", "stage-1");
  const stage2 = createCircuitSymbol(tff, "counter-main", 30, 10, "up", "stage-2");
  const stage3 = createCircuitSymbol(tff, "counter-main", 40, 10, "up", "stage-3");

  const probe0 = createCircuitSymbol(createCircuitProbe("probe-q0", "Q0"), "counter-main", 10, 22, "up", "sym-p0");
  const probe1 = createCircuitSymbol(createCircuitProbe("probe-q1", "Q1"), "counter-main", 20, 22, "up", "sym-p1");
  const probe2 = createCircuitSymbol(createCircuitProbe("probe-q2", "Q2"), "counter-main", 30, 22, "up", "sym-p2");
  const probe3 = createCircuitSymbol(createCircuitProbe("probe-q3", "Q3"), "counter-main", 40, 22, "up", "sym-p3");

  // Interaktiver Taster + NOT-Gatter zur Latenzprüfung unter Volllast
  const btn = createCircuitButton("btn-live", "LiveBtn", false, "right");
  const btnSym = createCircuitSymbol(btn, "counter-main", 0, 32, "up", "sym-btn-live");
  const notSym = createCircuitSymbol(createGate("not", 1, false), "counter-main", 10, 32, "up", "sym-not-live");
  const probeBtn = createCircuitSymbol(createCircuitProbe("probe-live", "LiveProbe"), "counter-main", 20, 32, "up", "sym-p-live");

  main.circuitSymbols = [
    clkSym,
    stage0,
    stage1,
    stage2,
    stage3,
    probe0,
    probe1,
    probe2,
    probe3,
    btnSym,
    notSym,
    probeBtn,
  ];

  const clkOut = clkSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;

  const s0Clk = stage0.jams.find((j) => j.pin.name === "CLK")!.absolutePoint;
  const s0Q = stage0.jams.find((j) => j.pin.name === "Q")!.absolutePoint;
  const s0Qn = stage0.jams.find((j) => j.pin.name === "Qn")!.absolutePoint;

  const s1Clk = stage1.jams.find((j) => j.pin.name === "CLK")!.absolutePoint;
  const s1Q = stage1.jams.find((j) => j.pin.name === "Q")!.absolutePoint;
  const s1Qn = stage1.jams.find((j) => j.pin.name === "Qn")!.absolutePoint;

  const s2Clk = stage2.jams.find((j) => j.pin.name === "CLK")!.absolutePoint;
  const s2Q = stage2.jams.find((j) => j.pin.name === "Q")!.absolutePoint;
  const s2Qn = stage2.jams.find((j) => j.pin.name === "Qn")!.absolutePoint;

  const s3Clk = stage3.jams.find((j) => j.pin.name === "CLK")!.absolutePoint;
  const s3Q = stage3.jams.find((j) => j.pin.name === "Q")!.absolutePoint;

  const p0In = probe0.jams[0].absolutePoint;
  const p1In = probe1.jams[0].absolutePoint;
  const p2In = probe2.jams[0].absolutePoint;
  const p3In = probe3.jams[0].absolutePoint;

  const btnOut = btnSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
  const notIn = notSym.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;
  const notOut = notSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
  const pLiveIn = probeBtn.jams[0].absolutePoint;

  main.wires = [
    makeWire("w-clk-s0", "counter-main", clkOut, s0Clk),
    makeWire("w-s0-s1", "counter-main", s0Qn, s1Clk),
    makeWire("w-s1-s2", "counter-main", s1Qn, s2Clk),
    makeWire("w-s2-s3", "counter-main", s2Qn, s3Clk),
    makeWire("w-p0", "counter-main", s0Q, p0In),
    makeWire("w-p1", "counter-main", s1Q, p1In),
    makeWire("w-p2", "counter-main", s2Q, p2In),
    makeWire("w-p3", "counter-main", s3Q, p3In),
    makeWire("w-btn-not", "counter-main", btnOut, notIn),
    makeWire("w-not-probe", "counter-main", notOut, pLiveIn),
  ];

  return main;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("US-005 / T-033: Max-FPS-Simulationsmodus & Entkoppeltes UI-Rendering", () => {
  it("evaluiert einen 4-stufigen Binärzähler und Frequenzteiler im Max-Modus mit hoher Taktfrequenz ohne Oszillation", async () => {
    const circuit = createFourStageCounterCircuit();
    const runner = new CircuitRunner(circuit, { frameRateLimit: "max" });

    // Deterministische Vorprüfung: Frequenzteiler-Stufen schalten sauber ohne Oszillation
    const initialStep = runner.step(2);
    expect(initialStep.oscillating).toBe(false);
    expect(initialStep.snapshot.probes["probe-live"].value).toBe(1);

    const observedQ0 = new Set<number>();
    const observedQ1 = new Set<number>();
    const observedQ2 = new Set<number>();
    const observedQ3 = new Set<number>();

    for (let i = 0; i < 40; i++) {
      const res = runner.step(1);
      expect(res.oscillating).toBe(false);
      observedQ0.add(res.snapshot.probes["probe-q0"].value ?? -1);
      observedQ1.add(res.snapshot.probes["probe-q1"].value ?? -1);
      observedQ2.add(res.snapshot.probes["probe-q2"].value ?? -1);
      observedQ3.add(res.snapshot.probes["probe-q3"].value ?? -1);
    }

    // Alle 4 Teilerstufen (bis /16) müssen innerhalb von 40 Taktschritten sowohl 0 als auch 1 annehmen
    expect(observedQ0.has(0) && observedQ0.has(1)).toBe(true);
    expect(observedQ1.has(0) && observedQ1.has(1)).toBe(true);
    expect(observedQ2.has(0) && observedQ2.has(1)).toBe(true);
    expect(observedQ3.has(0) && observedQ3.has(1)).toBe(true);

    // Dauerlauf im Max-Modus über > 500 ms für Frequenz-Telemetrie
    const statuses: { status: string; freq: number }[] = [];
    const runnerMax = new CircuitRunner(circuit, {
      frameRateLimit: "max",
      onStatusChange: (status, telemetry) => {
        statuses.push({ status, freq: telemetry.actualFrequency });
      },
    });

    try {
      runnerMax.start();
      await waitMs(560);

      expect(runnerMax.isRunning).toBe(true);
      expect(runnerMax.isOscillating).toBe(false);
      expect(runnerMax.totalSteps).toBeGreaterThan(5_000);
      expect(runnerMax.actualFrequency).toBeGreaterThan(5_000);
      expect(statuses.some((entry) => entry.status === "running" && entry.freq > 0)).toBe(true);

      runnerMax.pause();
      expect(runnerMax.isPaused).toBe(true);
      expect(runnerMax.actualFrequency).toBe(0);

      runnerMax.stop();
      expect(runnerMax.isRunning).toBe(false);
      expect(runnerMax.actualFrequency).toBe(0);
    } finally {
      runner.dispose();
      runnerMax.dispose();
    }
  });

  it("reagiert im Max-Modus dank Micro-Yielding in unter 1 ms auf Taster-Klicks, Snapshots und Pause/Stop", async () => {
    const circuit = createFourStageCounterCircuit();
    const client = new SimulationClient();

    const receivedFrequencies: number[] = [];
    client.onStatusChange((_status, telemetry) => {
      receivedFrequencies.push(telemetry.actualFrequency);
    });

    try {
      await client.init(circuit);
      client.setSpeed("max");
      client.start();

      // Kurz anlaufen lassen, damit der Worker unter Max-Volllast steht
      await waitMs(30);

      // Messe Event-Loop-Latenz über Makrotask-Yielding unter laufender Max-Volllast
      const globalImmediate = globalThis as typeof globalThis & {
        setImmediate?: (cb: () => void) => unknown;
      };
      const measureYieldLatency = (): Promise<number> => new Promise((resolve) => {
        const t0 = performance.now();
        if (typeof globalImmediate.setImmediate === "function") {
          globalImmediate.setImmediate(() => {
            resolve(performance.now() - t0);
          });
        } else {
          setTimeout(() => {
            resolve(performance.now() - t0);
          }, 0);
        }
      });

      const latencies: number[] = [];
      for (let i = 0; i < 5; i++) {
        latencies.push(await measureYieldLatency());
      }
      const medianLatency = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)];
      expect(medianLatency).toBeLessThan(1.5);

      // Interaktiver Tasterklick im laufenden Max-Modus muss sofort wirken
      client.setButtonState("btn-live", true);
      const snapPressed = await client.pullSnapshot();
      expect(snapPressed.probes["probe-live"].value).toBe(0);
      expect(snapPressed.telemetry.totalSteps).toBeGreaterThan(0);

      client.setButtonState("btn-live", false);
      const snapReleased = await client.pullSnapshot();
      expect(snapReleased.probes["probe-live"].value).toBe(1);

      // Pause muss die Schrittzählung sofort anhalten
      client.pause();
      const snapPaused1 = await client.pullSnapshot();
      await waitMs(30);
      const snapPaused2 = await client.pullSnapshot();
      expect(snapPaused2.telemetry.totalSteps).toBe(snapPaused1.telemetry.totalSteps);
      expect(snapPaused2.telemetry.isPaused).toBe(true);

      client.stop();
      const snapStopped = await client.pullSnapshot();
      expect(snapStopped.telemetry.isRunning).toBe(false);
      expect(snapStopped.telemetry.actualFrequency).toBe(0);
    } finally {
      client.terminate();
    }
  });

  it("entkoppelt UI-Snapshots via requestAnimationFrame nach dem Drop-Frame-Prinzip ohne Anfragenstau", async () => {
    const snapshotsRequested: number[] = [];
    const pendingResolvers: ((snap: SimulationSnapshot) => void)[] = [];

    const mockWorker: Worker = {
      onmessage: null,
      onmessageerror: null,
      onerror: null,
      postMessage(message: WorkerCommand): void {
        if (message.type === "PULL_SNAPSHOT") {
          snapshotsRequested.push(snapshotsRequested.length + 1);
          return;
        }
        if (message.type === "INIT") {
          this.onmessage?.call(
            this,
            new MessageEvent("message", {
              data: {
                type: "READY",
                success: true,
                probeCount: 0,
                buttonCount: 0,
                stateCount: 3,
              } satisfies WorkerResponse,
            }),
          );
        }
      },
      terminate(): void {},
      addEventListener(): void {},
      removeEventListener(): void {},
      dispatchEvent(): boolean {
        return true;
      },
    };

    const client = new SimulationClient(mockWorker);
    // Überschreibe pullSnapshot kontrolliert, um langsame Worker- oder Render-Antworten zu simulieren
    client.pullSnapshot = (): Promise<SimulationSnapshot> => {
      snapshotsRequested.push(snapshotsRequested.length + 1);
      return new Promise((resolve) => {
        pendingResolvers.push(resolve);
      });
    };

    let nextFrameId = 1;
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    const cancelledFrames: number[] = [];
    const deliveredSnapshots: SimulationSnapshot[] = [];

    const scheduler = new SnapshotScheduler({
      client,
      frameRateLimit: "max",
      onSnapshot: (snap) => {
        deliveredSnapshots.push(snap);
      },
      requestFrame: (cb) => {
        const id = nextFrameId++;
        frameCallbacks.set(id, cb);
        return id;
      },
      cancelFrame: (id) => {
        cancelledFrames.push(id);
        frameCallbacks.delete(id);
      },
      now: () => 0,
    });

    const flushFrame = (timestamp: number) => {
      const entries = Array.from(frameCallbacks.entries());
      frameCallbacks.clear();
      for (const [, cb] of entries) {
        cb(timestamp);
      }
    };

    const makeSnap = (steps: number, freq: number): SimulationSnapshot => ({
      stateArray: new Uint8Array([0, 1, 2]),
      probes: {},
      buttons: {},
      telemetry: {
        isRunning: true,
        isPaused: false,
        isOscillating: false,
        actualFrequency: freq,
        totalSteps: steps,
        timestamp: steps,
      },
    });

    scheduler.start();
    expect(frameCallbacks.size).toBe(1);

    // Erster Frame fordert genau einen Snapshot an
    flushFrame(16);
    expect(snapshotsRequested).toHaveLength(1);
    expect(scheduler.isPullInFlight).toBe(true);

    // Während Anfrage 1 noch läuft, werden die nächsten 3 Render-Frames gedroppt (kein Queue-Stau)
    flushFrame(32);
    flushFrame(48);
    flushFrame(64);
    expect(snapshotsRequested).toHaveLength(1);
    expect(scheduler.droppedFrames).toBe(3);

    // Erste Snapshot-Antwort trifft ein -> nächster Frame darf wieder abrufen
    pendingResolvers.shift()!(makeSnap(50_000, 1_250_000));
    await waitMs(0);
    expect(scheduler.isPullInFlight).toBe(false);
    expect(deliveredSnapshots).toHaveLength(1);
    expect(deliveredSnapshots[0].telemetry.actualFrequency).toBe(1_250_000);

    flushFrame(80);
    expect(snapshotsRequested).toHaveLength(2);

    // Stoppen während einer laufenden Anfrage: späte Antwort darf keinen State mehr ausliefern
    scheduler.stop();
    expect(cancelledFrames.length).toBeGreaterThan(0);
    pendingResolvers.shift()!(makeSnap(90_000, 2_000_000));
    await waitMs(0);
    expect(deliveredSnapshots).toHaveLength(1);

    client.terminate();
  });

  it("zeigt den Max-Modus, formatierte Ist-Frequenz (Hz, kHz, MHz) und Schritte im Telemetriebereich an", () => {
    const project = createEmptyCircuitProject();

    const renderTreeWithFreq = (
      actualFrequency: number,
      totalSteps: number,
      isPaused = false,
    ): string => {
      const simValue: SimulationContextType = {
        ...DEFAULT_SIMULATION_STATE,
        isSimulating: true,
        isPaused,
        isRunning: !isPaused,
        frameRateLimit: "max",
        actualFrequency,
        totalSteps,
      };

      return renderToStaticMarkup(
        React.createElement(CanvasContextProvider, {
          children: React.createElement(CircuitContextProvider, {
            initialProject: project,
            initialCircuitId: project.project.logicalCircuitId,
            children: React.createElement(SimulationContext.Provider, {
              value: simValue,
              children: React.createElement(RunningCircuitTree),
            }),
          }),
        }),
      );
    };

    const htmlHz = renderTreeWithFreq(450, 42);
    expect(htmlHz).toContain("value=\"max\" selected=\"\"");
    expect(htmlHz).toContain("450 Hz");
    expect(htmlHz).toContain(">42<");

    const htmlKhz = renderTreeWithFreq(12_500, 12_500);
    expect(htmlKhz).toContain("12,5 kHz");
    expect(htmlKhz).toContain("12.500");

    const htmlMhz = renderTreeWithFreq(2_400_000, 2_400_000);
    expect(htmlMhz).toContain("2,4 MHz");
    expect(htmlMhz).toContain("2.400.000");

    const htmlPaused = renderTreeWithFreq(0, 0, true);
    expect(htmlPaused).toContain("0 Hz");
    expect(htmlPaused).toContain("Pausiert");
  });

  it("würfelt im Max-Speed-Modus pro Batch zwischen 9500 und 10500 Schritten gegen Stroboskop-Aliasing und summiert actualFrequency exakt", async () => {
    const circuit = createDefaultLogicalCircuit("clk-alias", "ClockAliasingTest");
    const clkSym = createCircuitSymbol(createGate("clock", 0, false), "clk-alias", 0, 0, "up", "sym-clk");
    const probeSym = createCircuitSymbol(createCircuitProbe("probe-clk", "ClockOut"), "clk-alias", 10, 0, "up", "sym-probe");
    circuit.circuitSymbols = [clkSym, probeSym];

    const clkOut = clkSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const probeIn = probeSym.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;
    circuit.wires = [makeWire("w-clk", "clk-alias", clkOut, probeIn)];

    let fakeNow = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNow);
    const randomSpy = vi.spyOn(Math, "random");

    // Batch 1: 9500 Schritte (gerade), Batch 2: 9501 Schritte (ungerade), Batch 3: 10500 Schritte (Maximum)
    randomSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.001)
      .mockReturnValueOnce(0.9999);

    const runner = new CircuitRunner(circuit, { frameRateLimit: "max" });
    const nextImmediate = (): Promise<void> => new Promise((resolve) => {
      const globalImmediate = globalThis as typeof globalThis & {
        setImmediate?: (cb: () => void) => unknown;
      };
      if (typeof globalImmediate.setImmediate === "function") {
        globalImmediate.setImmediate(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });

    try {
      runner.start();

      // Nach erstem Batch (9500 gerade Schritte): Taktpegel bleibt auf 0
      await nextImmediate();
      expect(runner.totalSteps).toBe(9_500);
      expect(runner.getSnapshot().probes["probe-clk"].value).toBe(0);

      // Zweiter Batch (9501 ungerade Schritte) schließt 500-ms-Messfenster ab
      fakeNow = 1500;
      await nextImmediate();
      expect(runner.totalSteps).toBe(19_001);
      expect(runner.getSnapshot().probes["probe-clk"].value).toBe(1);
      expect(runner.actualFrequency).toBe(38_002);

      // Dritter Batch prüft obere Zufallsgrenze 10500 (9500 + 1000)
      await nextImmediate();
      expect(runner.totalSteps).toBe(29_501);

      runner.pause();

      // Deterministisches STEP(count) bleibt von der variablen Max-Speed-Batchgröße unberührt
      const stepRes = runner.step(10);
      expect(stepRes.stepsCompleted).toBe(10);
      expect(runner.totalSteps).toBe(29_511);
    } finally {
      runner.dispose();
      vi.restoreAllMocks();
    }
  });
});
