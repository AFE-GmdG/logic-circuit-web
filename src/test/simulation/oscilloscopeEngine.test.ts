import { describe, expect, it } from "vitest";

import type GridPoint from "../../types/canvas/gridPoint";
import type Pin from "../../types/circuit/pin";
import type Wire from "../../types/circuit/wire";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import CircuitMap, { getProbeInstanceId } from "../../simulation/compiler/circuitMap";
import FunctionProbe from "../../simulation/functions/io/functionProbe";
import CircuitState from "../../simulation/state/circuitState";
import CircuitRunner from "../../simulation/worker/circuitRunner";
import SimulationClient from "../../simulation/worker/simulationClient";
import {
  calculateCircuitDimensionsAndPins,
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
  syncProjectLogicalCircuits,
} from "../../utils/circuitLayout";

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

describe("Oszilloskop- & Messsonden-Verlaufs-Engine (T-073)", () => {
  it("protokolliert Wertänderungen, Tri-State, Ringpuffer-Überlauf und Markierungen in FunctionProbe", () => {
    const state = new CircuitState(6);
    const sig0 = state.reserveState();
    const sig1 = state.reserveState();
    const sig31 = state.reserveState();
    const params = Array.from({ length: 32 }, (_, idx) => {
      if (idx === 0) {
        return sig0;
      }
      if (idx === 1) {
        return sig1;
      }
      if (idx === 31) {
        return sig31;
      }
      return 1; // STATE_ON0
    });
    state.endDefinition();

    // Initial: sig0=Off, sig1=Off, sig31=Off -> Tri-State
    const probe = new FunctionProbe(state, params, "Bus32", "probe-bus", "hex", {
      rawProbeId: "probe-bus",
      path: "Main/Bus32[0,0]",
      capacity: 4,
    });

    const initialSnap = probe.toHistorySnapshot();
    expect(initialSnap.entries).toHaveLength(1);
    expect(initialSnap.entries[0]).toMatchObject({
      kind: "value",
      numericValue: null,
    });
    expect(initialSnap.markAllowed).toBe(true);

    // Doppelte Markierung wird abgewiesen
    expect(probe.mark()).toBe(true);
    expect(probe.markAllowed).toBe(false);
    expect(probe.mark()).toBe(false);

    // Werte auf definierte 32-Bit-Pegel setzen: Bit 0 = 1, Bit 1 = 0, Bit 31 = 1 -> 0x80000001
    state.set(sig0, STATE_ON1);
    state.set(sig1, STATE_ON0);
    state.set(sig31, STATE_ON1);
    expect(probe.evaluate()).toBe(false);
    expect(probe.markAllowed).toBe(true);

    const packed = probe.pack();
    expect(probe.unpack(packed, 0)).toBe(STATE_ON1);
    expect(probe.unpack(packed, 1)).toBe(STATE_ON0);
    expect(probe.unpack(packed, 31)).toBe(STATE_ON1);
    expect(FunctionProbe.toNumericFromPacked(packed, 32)).toBe(0x80000001);

    // Zwei weitere Wertänderungen füllen den Ringpuffer (Kapazität 4) und überschreiben älteste Einträge
    state.set(sig0, STATE_ON0);
    probe.updateState();
    state.set(sig1, STATE_ON1);
    probe.updateState();
    state.set(sig31, STATE_ON0);
    probe.updateState();

    const snap = probe.toHistorySnapshot();
    // Neueste zuerst: Bit1=1, Bit0=0, Bit31=0 -> 0x00000002
    expect(snap.entries).toHaveLength(4);
    expect(snap.entries[0]).toMatchObject({
      kind: "value",
      numericValue: 2,
      textHex: "0x2",
      textDec: "2",
    });
    expect(snap.entries[1]).toMatchObject({
      kind: "value",
      numericValue: 0x80000002,
      textHex: "0x80000002",
    });
  });

  it("zeichnet Einzelbit- und Multi-Bit-Oszilloskop-Samples inkl. Tri-State und Reset auf", () => {
    const state = new CircuitState(4);
    const bit0 = state.reserveState();
    const bit1 = state.reserveState();
    state.endDefinition();

    const probe = new FunctionProbe(state, [bit0, bit1], "Data2", "p-data", "bin", {
      capacity: 3,
    });

    // Erster Abtastwert: 0b01 (1)
    state.set(bit0, STATE_ON1);
    state.set(bit1, STATE_ON0);
    probe.tick();

    // Zweiter Abtastwert: Tri-State (bit1 = Off, bit0 = 1 -> "z1")
    state.set(bit1, STATE_OFF);
    probe.tick();

    // Dritter Abtastwert: 0b10 (2)
    state.set(bit0, STATE_ON0);
    state.set(bit1, STATE_ON1);
    probe.tick();

    // Vierter Abtastwert: 0b11 (3) -> überschreibt den ältesten Wert im Ringpuffer (Kapazität 3)
    state.set(bit0, STATE_ON1);
    state.set(bit1, STATE_ON1);
    probe.tick();

    const channel = probe.toOscilloscopeChannel();
    expect(channel.sampleCount).toBe(3);
    expect(channel.bitTraces[0]).toEqual([STATE_ON1, STATE_ON0, STATE_ON1]);
    expect(channel.bitTraces[1]).toEqual([STATE_OFF, STATE_ON1, STATE_ON1]);
    expect(channel.busSamples.map((s) => s.textBin)).toEqual(["z1", "10", "11"]);
    expect(channel.busSamples[0].hasTriState).toBe(true);
    expect(channel.busSamples[1].textHex).toBe("0x2");
    expect(channel.busSamples[2].textDec).toBe("3");

    probe.clearTickHistory();
    expect(probe.toOscilloscopeChannel().sampleCount).toBe(0);
  });

  it("trennt Messsonden-Instanzen in mehrfach verwendeten Subschaltungen sauber über getProbeInstanceId", () => {
    const sub = createDefaultLogicalCircuit("sub-lc", "SubUnit");
    const inPinData = createPinCircuit("pin-in", "sub-lc", "input", "In", 1, "left");
    const subLayout = calculateCircuitDimensionsAndPins([inPinData.pin], 3, 2);
    sub.symbolWidth = subLayout.gridWidth;
    sub.symbolHeight = subLayout.gridHeight;
    sub.logicalPins = subLayout.pins as Pin[];
    sub.pins = subLayout.pins;
    const inPinSym = createCircuitSymbol(inPinData.pinCircuit, "sub-lc", 0, 1, "up", "sym-sub-in");

    const subProbe = createCircuitProbe("probe-sub", "SubProbe");
    const subProbeSym = createCircuitSymbol(subProbe, "sub-lc", 6, 1, "up", "sym-sub-probe");

    sub.circuitSymbols = [inPinSym, subProbeSym];
    sub.wires = [
      makeWire(
        "w-sub",
        "sub-lc",
        inPinSym.jams[0].absolutePoint,
        subProbeSym.jams[0].absolutePoint,
      ),
    ];

    const main = createDefaultLogicalCircuit("main-lc", "Main");
    const project = createEmptyCircuitProject("SubProbeProj", "Main", "main-lc");
    project.pins = [inPinData.pin];
    project.logicalCircuits = [main, sub];
    const syncedPre = syncProjectLogicalCircuits(project);
    const syncedSub = syncedPre.logicalCircuits.find((c) => c.logicalCircuitId === "sub-lc")!;
    const syncedMainPre = syncedPre.logicalCircuits.find((c) => c.logicalCircuitId === "main-lc")!;

    const cZero = createConstant("c-0", 1, 0, "right");
    const cZeroSym = createCircuitSymbol(cZero, "main-lc", 0, 0, "up", "sym-c0");

    const cOne = createConstant("c-1", 1, 1, "right");
    const cOneSym = createCircuitSymbol(cOne, "main-lc", 0, 8, "up", "sym-c1");

    const subInstA = createCircuitSymbol(syncedSub, "main-lc", 6, 0, "up", "inst-a");
    const subInstB = createCircuitSymbol(syncedSub, "main-lc", 6, 8, "up", "inst-b");

    syncedMainPre.circuitSymbols = [cZeroSym, cOneSym, subInstA, subInstB];
    syncedMainPre.wires = [
      makeWire(
        "w-a",
        "main-lc",
        cZeroSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint,
        subInstA.jams.find((j) => j.pin.pinType === "input")!.absolutePoint,
      ),
      makeWire(
        "w-b",
        "main-lc",
        cOneSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint,
        subInstB.jams.find((j) => j.pin.pinType === "input")!.absolutePoint,
      ),
    ];

    const synced = syncProjectLogicalCircuits(syncedPre);
    const syncedMain = synced.logicalCircuits.find((c) => c.logicalCircuitId === "main-lc")!;
    const syncedInstA = syncedMain.circuitSymbols.find((s) => s.circuitSymbolId === "inst-a")!;
    const syncedInstB = syncedMain.circuitSymbols.find((s) => s.circuitSymbolId === "inst-b")!;

    const runner = new CircuitRunner(syncedMain);
    const childA = runner.circuitMap.child(syncedInstA)!;
    const childB = runner.circuitMap.child(syncedInstB)!;
    const idA = getProbeInstanceId(childA, subProbeSym);
    const idB = getProbeInstanceId(childB, subProbeSym);

    expect(idA).toBe("inst-a/probe-sub");
    expect(idB).toBe("inst-b/probe-sub");

    const stepRes = runner.step(1);
    expect(stepRes.snapshot.probes[idA].value).toBe(0);
    expect(stepRes.snapshot.probes[idB].value).toBe(1);

    const osc = runner.setOscilloscoping(true);
    expect(osc.channels.map((ch) => ch.probeId).sort()).toEqual([idA, idB].sort());

    const histA = runner.readProbeHistory(idA);
    const histB = runner.readProbeHistory(idB);
    expect(histA?.entries[0]).toMatchObject({ kind: "value", numericValue: 0 });
    expect(histB?.entries[0]).toMatchObject({ kind: "value", numericValue: 1 });
    // Mehrdeutige rawProbeId darf nicht willkürlich aufgelöst werden
    expect(runner.readProbeHistory("probe-sub")).toBeNull();

    // Auch CircuitMap direkt unterstützt getProbeInstanceId
    const directMap = new CircuitMap(syncedMain);
    expect(getProbeInstanceId(directMap.child(syncedInstA), subProbeSym)).toBe("inst-a/probe-sub");

    runner.dispose();
  });

  it("steuert Oszilloskop-Aufzeichnung und Probe-Historie vollständig über SimulationClient", async () => {
    const circuit = createDefaultLogicalCircuit("main-client", "OscClientTest");

    const clk = createGate("clock", 1, false);
    const clkSym = createCircuitSymbol(clk, "main-client", 0, 0, "up", "sym-clk");

    const btn = createCircuitButton("btn-1", "InputBtn", false, "right");
    const btnSym = createCircuitSymbol(btn, "main-client", 0, 6, "up", "sym-btn");

    const clkProbe = createCircuitProbe("probe-clk", "ClkProbe");
    const clkProbeSym = createCircuitSymbol(clkProbe, "main-client", 8, 0, "up", "sym-p-clk");

    const btnProbe = createCircuitProbe("probe-btn", "BtnProbe");
    const btnProbeSym = createCircuitSymbol(btnProbe, "main-client", 8, 6, "up", "sym-p-btn");

    circuit.circuitSymbols = [clkSym, btnSym, clkProbeSym, btnProbeSym];
    circuit.wires = [
      makeWire(
        "w-clk",
        "main-client",
        clkSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint,
        clkProbeSym.jams[0].absolutePoint,
      ),
      makeWire(
        "w-btn",
        "main-client",
        btnSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint,
        btnProbeSym.jams[0].absolutePoint,
      ),
    ];

    const client = new SimulationClient();
    const ready = await client.init(circuit, 16);
    expect(ready.probeCount).toBe(2);

    // Initialzustand ohne Taktfortschaltung stabilisieren (analog zu ensurePausedSimulation)
    await client.step(0);

    // Aufzeichnung aktivieren (erfasst initialen Sample)
    const startedOsc = await client.setOscilloscoping(true);
    expect(startedOsc?.isOscilloscoping).toBe(true);
    expect(startedOsc?.sampleCount).toBe(1);

    // Drei deterministische Schritte ausführen -> Takt wechselt 0 -> 1 -> 0 -> 1
    await client.step(3);
    const oscData = await client.readOscilloscope();
    expect(oscData?.sampleCount).toBe(4);
    const clkChannel = oscData?.channels.find((ch) => ch.probeId === "probe-clk");
    expect(clkChannel?.bitTraces[0]).toEqual([STATE_ON0, STATE_ON1, STATE_ON0, STATE_ON1]);

    // Aufzeichnung pausieren: weiterer Schritt darf keine neuen Oszilloskop-Samples hinzufügen
    await client.setOscilloscoping(false);
    await client.step(2);
    const pausedOsc = await client.readOscilloscope();
    expect(pausedOsc?.isOscilloscoping).toBe(false);
    expect(pausedOsc?.sampleCount).toBe(4);

    // Reset leert Spuren ohne Reset der Simulation
    const clearedOsc = await client.clearOscilloscope();
    expect(clearedOsc?.sampleCount).toBe(0);
    expect(clearedOsc?.totalSteps).toBe(5);

    // Probe-Historie inkl. Markierung abfragen
    client.setButtonState("btn-1", true);
    await client.step(1);
    const histBeforeMark = await client.readProbeHistory("probe-btn");
    expect(histBeforeMark?.markAllowed).toBe(true);
    expect(histBeforeMark?.entries[0]).toMatchObject({ kind: "value", numericValue: 1 });

    const histAfterMark = await client.markProbeHistory("probe-btn");
    expect(histAfterMark?.markAllowed).toBe(false);
    expect(histAfterMark?.entries[0]).toEqual({ kind: "mark" });

    await client.stop();
    client.terminate();
  });
});
