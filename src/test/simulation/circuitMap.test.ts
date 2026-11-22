import { describe, expect, it } from "vitest";

import type GridPoint from "../../types/canvas/gridPoint";
import type Wire from "../../types/circuit/wire";
import { STATE_ON1 } from "../../types/simulation/state";

import CircuitException from "../../simulation/compiler/circuitException";
import CircuitMap from "../../simulation/compiler/circuitMap";
import type CircuitFunction from "../../simulation/functions/circuitFunction";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createGate,
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

describe("CircuitMap Compiler", () => {
  it("baut die Schaltungshierarchie auf und generiert hierarchische Pfade", () => {
    const mainCircuit = createDefaultLogicalCircuit("main", "Main");
    const subCircuit = createDefaultLogicalCircuit("sub", "SubModule");

    const subSymbol = createCircuitSymbol(subCircuit, "main", 10, 5, "up", "sym-sub-1");
    mainCircuit.circuitSymbols = [subSymbol];

    const gate = createGate("and", 2, false);
    const gateSymbol = createCircuitSymbol(gate, "sub", 2, 4, "up", "sym-gate-1");
    subCircuit.circuitSymbols = [gateSymbol];

    const map = new CircuitMap(mainCircuit);
    expect(map.isRoot).toBe(true);
    expect(map.path()).toBe("Main");
    expect(map.path(subSymbol)).toBe("Main/SubModule[10,5]");

    const childMap = map.child(subSymbol);
    expect(childMap).toBeDefined();
    expect(childMap?.path()).toBe("Main/SubModule[10,5]");
    expect(childMap?.path(gateSymbol)).toBe("Main/SubModule[10,5]/AND[2,4]");
  });

  it("erkennt direkte Selbst-Einbettungen und wirft eine CircuitException", () => {
    const mainCircuit = createDefaultLogicalCircuit("main", "RecursiveSelf");
    const selfSymbol = createCircuitSymbol(mainCircuit, "main", 0, 0, "up", "sym-self");
    mainCircuit.circuitSymbols = [selfSymbol];

    expect(() => new CircuitMap(mainCircuit)).toThrow(CircuitException);
    expect(() => new CircuitMap(mainCircuit)).toThrow(/Rekursive Schaltungsschleife erkannt/);
  });

  it("erkennt indirekte zyklische Schleifen (A enthält B, B enthält A)", () => {
    const circuitA = createDefaultLogicalCircuit("circ-a", "CircuitA");
    const circuitB = createDefaultLogicalCircuit("circ-b", "CircuitB");

    const symBInA = createCircuitSymbol(circuitB, "circ-a", 0, 0, "up", "sym-b-in-a");
    circuitA.circuitSymbols = [symBInA];

    const symAInB = createCircuitSymbol(circuitA, "circ-b", 0, 0, "up", "sym-a-in-b");
    circuitB.circuitSymbols = [symAInB];

    expect(() => new CircuitMap(circuitA)).toThrow(CircuitException);
    expect(() => new CircuitMap(circuitA)).toThrow(/Rekursive Schaltungsschleife erkannt/);
  });

  it("erkennt Bitbreiten-Konflikte zwischen verbundenen Anschlüssen", () => {
    const mainCircuit = createDefaultLogicalCircuit("main", "BitConflict");

    // Gatter 1 mit 1-Bit Ausgang
    const gate1 = createGate("and", 2, false);
    const sym1 = createCircuitSymbol(gate1, "main", 0, 0, "up", "sym-1");

    // Manuelles Fake-Bauteil mit 8-Bit Eingang am selben Rasterpunkt
    const gate2 = createGate("or", 2, false);
    gate2.pins[0].bitWidth = 8; // Bitbreiten-Mismatch erzwingen
    const sym2 = createCircuitSymbol(gate2, "main", 5, 0, "up", "sym-2");

    mainCircuit.circuitSymbols = [sym1, sym2];

    // Leitung zwischen Ausgang sym1 (rechts: x=3, y=2) und Eingang sym2 (links: x=5, y=1)
    const outJamPoint = sym1.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const inJamPoint = sym2.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;

    mainCircuit.wires = [
      makeWire("w1", "main", outJamPoint, inJamPoint),
    ];

    const map = new CircuitMap(mainCircuit);
    expect(() => map.apply()).toThrow(CircuitException);
    expect(() => map.apply()).toThrow(/Bitbreiten-Konflikt/);
  });

  it("erlaubt beliebige Bitbreiten an Messstellen (CircuitProbe)", () => {
    const mainCircuit = createDefaultLogicalCircuit("main", "ProbeFlex");

    const gate = createGate("and", 2, false);
    gate.pins.find((p) => p.pinType === "output")!.bitWidth = 8;
    const gateSym = createCircuitSymbol(gate, "main", 0, 0, "up", "sym-gate");

    const probe = createCircuitProbe("probe-1", "TestProbe");
    const probeSym = createCircuitSymbol(probe, "main", 10, 0, "up", "sym-probe");

    mainCircuit.circuitSymbols = [gateSym, probeSym];

    const outPt = gateSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const inPt = probeSym.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;

    mainCircuit.wires = [
      makeWire("w1", "main", outPt, inPt),
    ];

    const map = new CircuitMap(mainCircuit);
    // Darf keinen Bitbreiten-Konflikt werfen
    expect(() => map.apply()).not.toThrow();
  });

  it("kompiliert eine einfache Schaltung und liefert korrekte Simulationsergebnisse", () => {
    const main = createDefaultLogicalCircuit("main", "SimpleSim");

    // Zwei Buttons
    const btnA = createCircuitButton("btn-a", "A");
    const btnB = createCircuitButton("btn-b", "B");
    const symBtnA = createCircuitSymbol(btnA, "main", 0, 0, "up", "sym-btn-a");
    const symBtnB = createCircuitSymbol(btnB, "main", 0, 4, "up", "sym-btn-b");

    // Ein AND-Gatter
    const andGate = createGate("and", 2, false);
    const symAnd = createCircuitSymbol(andGate, "main", 6, 2, "up", "sym-and");

    // Eine Sonde (Probe) am Ausgang
    const probe = createCircuitProbe("probe-out", "Out");
    const symProbe = createCircuitSymbol(probe, "main", 12, 3, "up", "sym-probe");

    main.circuitSymbols = [symBtnA, symBtnB, symAnd, symProbe];

    const jamBtnA = symBtnA.jams[0].absolutePoint;
    const jamBtnB = symBtnB.jams[0].absolutePoint;
    const andIn1 = symAnd.jams.filter((j) => j.pin.pinType === "input")[0].absolutePoint;
    const andIn2 = symAnd.jams.filter((j) => j.pin.pinType === "input")[1].absolutePoint;
    const andOut = symAnd.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const probeIn = symProbe.jams[0].absolutePoint;

    main.wires = [
      makeWire("w1", "main", jamBtnA, andIn1),
      makeWire("w2", "main", jamBtnB, andIn2),
      makeWire("w3", "main", andOut, probeIn),
    ];

    const map = new CircuitMap(main);
    const state = map.apply();

    // Schritt A (Initial): Beide Buttons 0 -> Probe muss 0 sein
    expect(state.evaluate(false)).toBe(true);

    const probeFunc = state.functions.find((f: CircuitFunction) => f.name === "FunctionProbe");
    expect(probeFunc).toBeDefined();

    // Schritt B (Button A): A=1, B=0 -> AND Ausgang 0
    const btnAFunc = state.functions.find(
      (f: CircuitFunction) => f.name === "FunctionButton" && (f as any).buttonId === "btn-a",
    ) as any;
    const btnBFunc = state.functions.find(
      (f: CircuitFunction) => f.name === "FunctionButton" && (f as any).buttonId === "btn-b",
    ) as any;

    btnAFunc.press(true);
    expect(state.evaluate(false)).toBe(true);
    expect((probeFunc as any).toNumeric()).toBe(0);

    // Schritt C (Button B): A=1, B=1 -> AND Ausgang 1
    btnBFunc.press(true);
    expect(state.evaluate(false)).toBe(true);
    expect((probeFunc as any).toNumeric()).toBe(1);

    // Schritt D (Wire-Zustandsindizes prüfen)
    const wireIndices = map.stateIndexes(main.wires[2]);
    expect(wireIndices.length).toBeGreaterThan(0);
    expect(state.get(wireIndices[0]!)).toBe(STATE_ON1);
  });
});
