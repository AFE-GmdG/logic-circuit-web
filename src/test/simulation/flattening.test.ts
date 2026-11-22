import { describe, expect, it } from "vitest";

import type GridPoint from "../../types/canvas/gridPoint";
import type Wire from "../../types/circuit/wire";

import CircuitMap from "../../simulation/compiler/circuitMap";
import type CircuitFunction from "../../simulation/functions/circuitFunction";
import {
  calculateCircuitDimensionsAndPins,
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createGate,
  createPinCircuit,
  createSplitter,
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

describe("Circuit Flattening (Sub-Circuits & Splitters)", () => {
  it("flacht einen eingebetteten Halbaddierer-Subcircuit vollständig ab", () => {
    // Vorbereitung: Sub-Circuit: Halbaddierer (Half Adder)
    const halfAdder = createDefaultLogicalCircuit("half-adder", "HalfAdder");

    // Pins des Halbaddierers anlegen
    const pinAData = createPinCircuit("pin-ha-a", "half-adder", "input", "A", 1, "left", false, 0);
    const pinBData = createPinCircuit("pin-ha-b", "half-adder", "input", "B", 1, "left", false, 1);
    const pinSData = createPinCircuit("pin-ha-s", "half-adder", "output", "S", 1, "right", false, 0);
    const pinCData = createPinCircuit("pin-ha-c", "half-adder", "output", "C", 1, "right", false, 1);

    const rawPins = [pinAData.pin, pinBData.pin, pinSData.pin, pinCData.pin];
    const haLayout = calculateCircuitDimensionsAndPins(rawPins, 3, 4);
    halfAdder.symbolWidth = haLayout.gridWidth;
    halfAdder.symbolHeight = haLayout.gridHeight;
    halfAdder.logicalPins = haLayout.pins as any;
    halfAdder.pins = haLayout.pins as any;

    // Platzierte Symbole der Pins im inneren Schaltplan
    const symPinA = createCircuitSymbol(pinAData.pinCircuit, "half-adder", 0, 1, "up", "sym-in-a");
    const symPinB = createCircuitSymbol(pinBData.pinCircuit, "half-adder", 0, 4, "up", "sym-in-b");
    const symPinS = createCircuitSymbol(pinSData.pinCircuit, "half-adder", 12, 1, "up", "sym-out-s");
    const symPinC = createCircuitSymbol(pinCData.pinCircuit, "half-adder", 12, 4, "up", "sym-out-c");

    // Gatter im Halbaddierer: XOR für Summe S, AND für Carry C
    const xorGate = createGate("xor", 2, false);
    const andGate = createGate("and", 2, false);
    const symXor = createCircuitSymbol(xorGate, "half-adder", 5, 1, "up", "sym-ha-xor");
    const symAnd = createCircuitSymbol(andGate, "half-adder", 5, 4, "up", "sym-ha-and");

    halfAdder.circuitSymbols = [symPinA, symPinB, symPinS, symPinC, symXor, symAnd];

    // Verdrahtung im Halbaddierer
    const ptPinA = symPinA.jams[0].absolutePoint;
    const ptPinB = symPinB.jams[0].absolutePoint;
    const ptXorIn1 = symXor.jams.filter((j) => j.pin.pinType === "input")[0].absolutePoint;
    const ptXorIn2 = symXor.jams.filter((j) => j.pin.pinType === "input")[1].absolutePoint;
    const ptXorOut = symXor.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const ptAndIn1 = symAnd.jams.filter((j) => j.pin.pinType === "input")[0].absolutePoint;
    const ptAndIn2 = symAnd.jams.filter((j) => j.pin.pinType === "input")[1].absolutePoint;
    const ptAndOut = symAnd.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const ptPinS = symPinS.jams[0].absolutePoint;
    const ptPinC = symPinC.jams[0].absolutePoint;

    halfAdder.wires = [
      makeWire("w-a1", "half-adder", ptPinA, ptXorIn1),
      makeWire("w-a2", "half-adder", ptPinA, ptAndIn1),
      makeWire("w-b1", "half-adder", ptPinB, ptXorIn2),
      makeWire("w-b2", "half-adder", ptPinB, ptAndIn2),
      makeWire("w-s", "half-adder", ptXorOut, ptPinS),
      makeWire("w-c", "half-adder", ptAndOut, ptPinC),
    ];

    // Hauptschaltung: Platziert den Halbaddierer als Sub-Circuit
    const main = createDefaultLogicalCircuit("main", "Main");

    // Sub-Circuit-Symbol auf der Hauptschaltung
    const symHalfAdder = createCircuitSymbol(halfAdder, "main", 10, 5, "up", "sym-sub-ha");

    // Zwei Buttons auf der Hauptschaltung
    const btnA = createCircuitButton("btn-main-a", "A");
    const btnB = createCircuitButton("btn-main-b", "B");
    const symBtnA = createCircuitSymbol(btnA, "main", 2, 5, "up", "sym-btn-a");
    const symBtnB = createCircuitSymbol(btnB, "main", 2, 8, "up", "sym-btn-b");

    // Zwei Sonden (Probes) auf der Hauptschaltung
    const probeS = createCircuitProbe("probe-s", "Summe");
    const probeC = createCircuitProbe("probe-c", "Carry");
    const symProbeS = createCircuitSymbol(probeS, "main", 20, 5, "up", "sym-probe-s");
    const symProbeC = createCircuitSymbol(probeC, "main", 20, 8, "up", "sym-probe-c");

    main.circuitSymbols = [symHalfAdder, symBtnA, symBtnB, symProbeS, symProbeC];

    // Anschlüsse auf der Hauptschaltung verknüpfen
    const mainBtnAPt = symBtnA.jams[0].absolutePoint;
    const mainBtnBPt = symBtnB.jams[0].absolutePoint;
    const haInAPt = symHalfAdder.jams.find((j) => j.pin.name === "A")!.absolutePoint;
    const haInBPt = symHalfAdder.jams.find((j) => j.pin.name === "B")!.absolutePoint;
    const haOutSPt = symHalfAdder.jams.find((j) => j.pin.name === "S")!.absolutePoint;
    const haOutCPt = symHalfAdder.jams.find((j) => j.pin.name === "C")!.absolutePoint;
    const probeSPt = symProbeS.jams[0].absolutePoint;
    const probeCPt = symProbeC.jams[0].absolutePoint;

    main.wires = [
      makeWire("mw-a", "main", mainBtnAPt, haInAPt),
      makeWire("mw-b", "main", mainBtnBPt, haInBPt),
      makeWire("mw-s", "main", haOutSPt, probeSPt),
      makeWire("mw-c", "main", haOutCPt, probeCPt),
    ];

    // Kompilieren
    const map = new CircuitMap(main);
    const state = map.apply();

    const probeSFunc = state.functions.find(
      (f: CircuitFunction) => f.name === "FunctionProbe" && (f as any).label === "Summe",
    ) as any;
    const probeCFunc = state.functions.find(
      (f: CircuitFunction) => f.name === "FunctionProbe" && (f as any).label === "Carry",
    ) as any;

    const btnAFunc = state.functions.find(
      (f: CircuitFunction) => f.name === "FunctionButton" && (f as any).buttonId === "btn-main-a",
    ) as any;
    const btnBFunc = state.functions.find(
      (f: CircuitFunction) => f.name === "FunctionButton" && (f as any).buttonId === "btn-main-b",
    ) as any;

    expect(probeSFunc).toBeDefined();
    expect(probeCFunc).toBeDefined();
    expect(btnAFunc).toBeDefined();
    expect(btnBFunc).toBeDefined();

    // Wahrheitstabelle des Halbaddierers durchprüfen
    const testCases = [
      { a: false, b: false, s: 0, c: 0 },
      { a: true, b: false, s: 1, c: 0 },
      { a: false, b: true, s: 1, c: 0 },
      { a: true, b: true, s: 0, c: 1 },
    ];

    for (const tc of testCases) {
      btnAFunc.press(tc.a);
      btnBFunc.press(tc.b);
      expect(state.evaluate(false)).toBe(true);
      expect(probeSFunc.toNumeric()).toBe(tc.s);
      expect(probeCFunc.toNumeric()).toBe(tc.c);
    }
  });

  it("flacht Multi-Bit-Splitter auf Bit-Ebene ab (Bus-Aufteilung auf Einzelbits)", () => {
    const main = createDefaultLogicalCircuit("main", "SplitterTest");

    // Vier-Bit-Konstante (Wert 0b1011 = 11: Bit 0=1, Bit 1=1, Bit 2=0, Bit 3=1)
    const constant4Bit = createConstant("const-4bit", 4, 0b1011);
    const symConst = createCircuitSymbol(constant4Bit, "main", 0, 5, "up", "sym-const");

    // Vier-Bit Splitter mit 4 Einzelpins (clockwise = true -> breiter Bus-Pin links)
    const splitter = createSplitter("split-4", 4, 4, true);
    const symSplitter = createCircuitSymbol(splitter, "main", 6, 4, "up", "sym-split");

    // 4 Probes für die einzelnen Bits
    const probe0 = createCircuitProbe("probe-b0", "Bit0");
    const probe1 = createCircuitProbe("probe-b1", "Bit1");
    const probe2 = createCircuitProbe("probe-b2", "Bit2");
    const probe3 = createCircuitProbe("probe-b3", "Bit3");
    const symP0 = createCircuitSymbol(probe0, "main", 12, 4, "up", "sym-p0");
    const symP1 = createCircuitSymbol(probe1, "main", 12, 5, "up", "sym-p1");
    const symP2 = createCircuitSymbol(probe2, "main", 12, 6, "up", "sym-p2");
    const symP3 = createCircuitSymbol(probe3, "main", 12, 7, "up", "sym-p3");

    main.circuitSymbols = [symConst, symSplitter, symP0, symP1, symP2, symP3];

    // Breiter Bus-Pin des Splitters (liegt links)
    const splitBusPt = symSplitter.jams.find((j) => j.pin.name === "Bus")!.absolutePoint;
    const constOutPt = symConst.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;

    // Dünne Pins des Splitters (liegen rechts, sortiert nach Bit)
    const thinJams = symSplitter.jams.filter((j) => j.pin.name !== "Bus");

    main.wires = [
      makeWire("w-bus", "main", constOutPt, splitBusPt),
      makeWire("w-b0", "main", thinJams[0].absolutePoint, symP0.jams[0].absolutePoint),
      makeWire("w-b1", "main", thinJams[1].absolutePoint, symP1.jams[0].absolutePoint),
      makeWire("w-b2", "main", thinJams[2].absolutePoint, symP2.jams[0].absolutePoint),
      makeWire("w-b3", "main", thinJams[3].absolutePoint, symP3.jams[0].absolutePoint),
    ];

    const map = new CircuitMap(main);
    const state = map.apply();

    expect(state.evaluate(false)).toBe(true);

    const p0Func = state.functions.find((f: CircuitFunction) => (f as any).label === "Bit0") as any;
    const p1Func = state.functions.find((f: CircuitFunction) => (f as any).label === "Bit1") as any;
    const p2Func = state.functions.find((f: CircuitFunction) => (f as any).label === "Bit2") as any;
    const p3Func = state.functions.find((f: CircuitFunction) => (f as any).label === "Bit3") as any;

    expect(p0Func.toNumeric()).toBe(1);
    expect(p1Func.toNumeric()).toBe(1);
    expect(p2Func.toNumeric()).toBe(0);
    expect(p3Func.toNumeric()).toBe(1);
  });
});
