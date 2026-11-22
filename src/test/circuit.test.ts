import { describe, expect, it } from "vitest";

import type GridPoint from "../types/canvas/gridPoint";
import type PaletteGateType from "../types/circuit/paletteGateType";
import type Wire from "../types/circuit/wire";
import type SignalState from "../types/simulation/signalState";

import {
  buildConductorMap,
  calculateCircuitDimensionsAndPins,
  calculateJamAbsolutePoint,
  comparePins,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
  createSplitter,
  generateUniquePinName,
  getGateGuid,
  getNextRotation,
  instantiateCircuitFromPalette,
  parseGateGuid,
  passSplitterBit,
  rotateSymbol,
  rotateSymbolsGroup,
} from "../utils/circuitLayout";
import { recalculateProjectWires } from "../utils/wireUtils";

// Einfache Simulation boolescher Basisfunktionen mit SignalState ("off", "on0", "on1")
function evaluateGate(type: PaletteGateType, inputs: SignalState[]): SignalState {
  if (inputs.some((state) => state === "off")) {
    return "on0";
  }

  const boolInputs = inputs.map((state) => state === "on1");

  switch (type) {
    case "not":
      return boolInputs[0] ? "on0" : "on1";
    case "and":
      return boolInputs.every(Boolean) ? "on1" : "on0";
    case "or":
      return boolInputs.some(Boolean) ? "on1" : "on0";
    case "xor": {
      const highCount = boolInputs.filter(Boolean).length;
      return highCount % 2 === 1 ? "on1" : "on0";
    }
    case "nand":
      return boolInputs.every(Boolean) ? "on0" : "on1";
    case "nor":
      return boolInputs.some(Boolean) ? "on0" : "on1";
    default:
      return "off";
  }
}

describe("Basic Gate Evaluation & SignalState", () => {
  it("evaluates NOT gate correctly", () => {
    expect(evaluateGate("not", ["on0"])).toBe("on1");
    expect(evaluateGate("not", ["on1"])).toBe("on0");
  });

  it("evaluates AND and NAND gates correctly", () => {
    expect(evaluateGate("and", ["on0", "on1"])).toBe("on0");
    expect(evaluateGate("and", ["on1", "on1"])).toBe("on1");
    expect(evaluateGate("nand", ["on1", "on1"])).toBe("on0");
  });

  it("evaluates OR and XOR gates correctly", () => {
    expect(evaluateGate("or", ["on0", "on1"])).toBe("on1");
    expect(evaluateGate("xor", ["on1", "on0"])).toBe("on1");
    expect(evaluateGate("xor", ["on1", "on1"])).toBe("on0");
  });
});

describe("Reference Data Model (CircuitProject, Gate, Jam, ConductorMap)", () => {
  it("encodes and decodes deterministic Gate GUIDs matching C# GateSet.GateGuid", () => {
    const and2Id = getGateGuid("and", 2, false);
    expect(and2Id).toBe("00000000-0000-0000-0000-000000040200");
    expect(parseGateGuid(and2Id)).toEqual({
      gateType: "and",
      inputCount: 2,
      invertedOutput: false,
    });

    const nand4Id = getGateGuid("and", 4, true);
    expect(nand4Id).toBe("00000000-0000-0000-0000-000000040401");
    expect(parseGateGuid(nand4Id)).toEqual({
      gateType: "and",
      inputCount: 4,
      invertedOutput: true,
    });
  });

  it("computes rotated Jam absolute points on integer grid coordinates", () => {
    // 3x4 Gatter auf Position (10, 10): Rotationszentrum liegt auf (10 + 1, 10 + 2) = (11, 12)
    const outPin: GridPoint = { x: 3, y: 2 };
    expect(calculateJamAbsolutePoint(10, 10, 3, 4, "up", outPin)).toEqual({ x: 13, y: 12 });
    expect(calculateJamAbsolutePoint(10, 10, 3, 4, "right", outPin)).toEqual({ x: 11, y: 14 });
    expect(calculateJamAbsolutePoint(10, 10, 3, 4, "down", outPin)).toEqual({ x: 9, y: 12 });
    expect(calculateJamAbsolutePoint(10, 10, 3, 4, "left", outPin)).toEqual({ x: 11, y: 10 });
  });

  it("sorts sub-circuit Pins by Y coordinate of their inner symbols via comparePins", () => {
    const { pin: pinBottom } = createPinCircuit("pin-bottom", "sub-1", "input", "B");
    const { pin: pinTop } = createPinCircuit("pin-top", "sub-1", "input", "A");

    const symbolCoords = new Map<string, GridPoint>([
      ["pin-bottom", { x: 2, y: 10 }],
      ["pin-top", { x: 2, y: 3 }],
    ]);

    expect(comparePins(pinBottom, pinTop, symbolCoords)).toBeGreaterThan(0);

    const layout = calculateCircuitDimensionsAndPins([pinBottom, pinTop], 3, 4, symbolCoords);
    const topPositioned = layout.pins.find((p) => p.pinId === "pin-top");
    const bottomPositioned = layout.pins.find((p) => p.pinId === "pin-bottom");

    expect(topPositioned?.gridPoint).toEqual({ x: 0, y: 1 });
    expect(bottomPositioned?.gridPoint).toEqual({ x: 0, y: 3 });
  });

  it("links sub-circuit Jams to their innerJam and sets effectivePinType to none", () => {
    const { pin, internalDevicePin } = createPinCircuit("pin-in-1", "sub-1", "input", "In1");
    const innerPinSymbol = createCircuitSymbol(
      {
        circuitId: pin.pinId,
        name: pin.name,
        notation: pin.name,
        note: "",
        category: "io",
        isDisplay: false,
        symbolWidth: 2,
        symbolHeight: 2,
        pins: [internalDevicePin],
      },
      "sub-1",
      4,
      6,
    );

    const subCircuitLayout = calculateCircuitDimensionsAndPins([pin], 3, 4);
    const subCircuitSymbol = createCircuitSymbol(
      {
        circuitId: "sub-1",
        name: "Sub 1",
        notation: "Sub 1",
        note: "",
        category: "",
        isDisplay: false,
        symbolWidth: subCircuitLayout.gridWidth,
        symbolHeight: subCircuitLayout.gridHeight,
        pins: subCircuitLayout.pins,
      },
      "main",
      20,
      10,
      "up",
      "sym-sub-1",
      new Map([["pin-in-1", innerPinSymbol]]),
    );

    expect(subCircuitSymbol.jams).toHaveLength(1);
    expect(subCircuitSymbol.jams[0].effectivePinType).toBe("none");
    expect(subCircuitSymbol.jams[0].innerJam).toBe(innerPinSymbol.jams[0]);
    expect(subCircuitSymbol.jams[0].innerJam?.absolutePoint).toEqual({ x: 6, y: 7 });
  });

  it("routes multi-bit signals through Splitter pins accurately via passSplitterBit", () => {
    const splitter = createSplitter("split-4", 4, 2, true);
    const symbol = createCircuitSymbol(splitter, "main", 5, 5);

    const busJam = symbol.jams[0];
    const thinLowJam = symbol.jams[1];
    const thinHighJam = symbol.jams[2];

    expect(busJam.pin.bitWidth).toBe(4);
    expect(thinLowJam.pin.bitWidth).toBe(2);
    expect(thinHighJam.pin.bitWidth).toBe(2);

    // Vom Bus-Pin in die dünnen Pins
    expect(passSplitterBit(symbol.jams, busJam, 1)).toEqual({ exitJam: thinLowJam, exitBit: 1 });
    expect(passSplitterBit(symbol.jams, busJam, 3)).toEqual({ exitJam: thinHighJam, exitBit: 1 });

    // Von einem dünnen Pin zurück in den Bus-Pin
    expect(passSplitterBit(symbol.jams, thinHighJam, 0)).toEqual({ exitJam: busJam, exitBit: 2 });
  });

  it("merges connected Wire segments into Conductors and detects T-junctions (>= 3 wires)", () => {
    const wires: Wire[] = [
      {
        wireId: "w1",
        logicalCircuitId: "main",
        x1: 0,
        y1: 2,
        x2: 5,
        y2: 2,
        point1: { x: 0, y: 2 },
        point2: { x: 5, y: 2 },
      },
      {
        wireId: "w2",
        logicalCircuitId: "main",
        x1: 5,
        y1: 2,
        x2: 10,
        y2: 2,
        point1: { x: 5, y: 2 },
        point2: { x: 10, y: 2 },
      },
      {
        wireId: "w3",
        logicalCircuitId: "main",
        x1: 5,
        y1: 2,
        x2: 5,
        y2: 8,
        point1: { x: 5, y: 2 },
        point2: { x: 5, y: 8 },
      },
      {
        wireId: "w4-isolated",
        logicalCircuitId: "main",
        x1: 20,
        y1: 0,
        x2: 20,
        y2: 5,
        point1: { x: 20, y: 0 },
        point2: { x: 20, y: 5 },
      },
    ];

    const map = buildConductorMap(wires);
    expect(map.conductors).toHaveLength(2);
    expect(map.junctionPoints).toEqual([{ x: 5, y: 2 }]);

    const mainNet = map.byPointKey.get("0,2");
    expect(mainNet).toBeDefined();
    expect(mainNet?.wires).toHaveLength(3);
    expect(map.byPointKey.get("10,2")).toBe(mainNet);
    expect(map.byPointKey.get("5,8")).toBe(mainNet);
  });

  it("initializes an empty CircuitProject with a main LogicalCircuit", () => {
    const circuitProject = createEmptyCircuitProject("Test Project", "Main");
    expect(circuitProject.project.name).toBe("Test Project");
    expect(circuitProject.logicalCircuits).toHaveLength(1);
    expect(circuitProject.project.logicalCircuitId).toBe(circuitProject.logicalCircuits[0].logicalCircuitId);

    const gate = createGate("and", 3, false);
    expect(gate.symbolWidth).toBe(3);
    expect(gate.symbolHeight).toBe(4);
  });
});

describe("Component Rotation (90-degree steps, Jams, Centroid)", () => {
  it("cycles next rotation through 90-degree steps in both directions", () => {
    // Im Uhrzeigersinn (clockwise)
    expect(getNextRotation("up", "clockwise")).toBe("right");
    expect(getNextRotation("right", "clockwise")).toBe("down");
    expect(getNextRotation("down", "clockwise")).toBe("left");
    expect(getNextRotation("left", "clockwise")).toBe("up");

    // Gegen den Uhrzeigersinn (counterClockwise)
    expect(getNextRotation("up", "counterClockwise")).toBe("left");
    expect(getNextRotation("left", "counterClockwise")).toBe("down");
    expect(getNextRotation("down", "counterClockwise")).toBe("right");
    expect(getNextRotation("right", "counterClockwise")).toBe("up");
  });

  it("rotates single symbol in-place and restores exact original state after 4 rotations", () => {
    const gate = createGate("and", 2, false);
    const initialSymbol = createCircuitSymbol(gate, "main", 10, 10, "up", "sym-and-1");

    // Erste Drehung im Uhrzeigersinn (nach rechts)
    const rot1 = rotateSymbol(initialSymbol, "clockwise");
    expect(rot1.x).toBe(10);
    expect(rot1.y).toBe(10);
    expect(rot1.rotation).toBe("right");

    // Ausgangspin (im unrotierten Zustand bei {x: 3, y: 2}) zeigt nun nach unten
    const outJam1 = rot1.jams.find((j) => j.pin.pinType === "output");
    expect(outJam1?.absolutePoint).toEqual({ x: 11, y: 14 });

    // Zweite Drehung (nach unten)
    const rot2 = rotateSymbol(rot1, "clockwise");
    expect(rot2.rotation).toBe("down");

    // Dritte Drehung (nach links)
    const rot3 = rotateSymbol(rot2, "clockwise");
    expect(rot3.rotation).toBe("left");

    // Vierte Drehung (zurück nach oben)
    const rot4 = rotateSymbol(rot3, "clockwise");
    expect(rot4.x).toBe(initialSymbol.x);
    expect(rot4.y).toBe(initialSymbol.y);
    expect(rot4.rotation).toBe("up");
    expect(rot4.jams.map((j) => j.absolutePoint)).toEqual(initialSymbol.jams.map((j) => j.absolutePoint));
  });

  it("rotates multiple symbols around their common centroid and restores exact positions after 4 rotations", () => {
    const andGate = createGate("and", 2, false);
    const orGate = createGate("or", 2, false);

    const symA = createCircuitSymbol(andGate, "main", 10, 10, "up", "sym-a");
    const symB = createCircuitSymbol(orGate, "main", 20, 10, "up", "sym-b");

    // Gruppe im Uhrzeigersinn rotieren
    const step1 = rotateSymbolsGroup([symA, symB], "clockwise");
    expect(step1).toHaveLength(2);
    expect(step1[0].rotation).toBe("right");
    expect(step1[1].rotation).toBe("right");

    // Vorher waren sie horizontal auf Y=10 verteilt, nun vertikal auf derselben Spalte
    expect(step1[0].x).toBe(step1[1].x);

    const step2 = rotateSymbolsGroup(step1, "clockwise");
    const step3 = rotateSymbolsGroup(step2, "clockwise");
    const step4 = rotateSymbolsGroup(step3, "clockwise");

    // Nach 4 vollen Rotationen exakt identische Positionen und Rotationen
    expect(step4[0].x).toBe(symA.x);
    expect(step4[0].y).toBe(symA.y);
    expect(step4[0].rotation).toBe("up");

    expect(step4[1].x).toBe(symB.x);
    expect(step4[1].y).toBe(symB.y);
    expect(step4[1].rotation).toBe("up");

    expect(step4[0].jams.map((j) => j.absolutePoint)).toEqual(symA.jams.map((j) => j.absolutePoint));
    expect(step4[1].jams.map((j) => j.absolutePoint)).toEqual(symB.jams.map((j) => j.absolutePoint));
  });

  it("dynamically generates and synchronizes sub-circuit pins and jams on placed symbols", () => {
    const project = createEmptyCircuitProject("Test Project", "Main", "main-circuit");
    const subCircuit = createDefaultLogicalCircuit("sub-power", "Power");
    project.logicalCircuits.push(subCircuit);
    project.circuits.set(subCircuit.circuitId, subCircuit);

    // Ausgangs-Pin in sub-power platzieren
    const pinResult = instantiateCircuitFromPalette(
      project,
      subCircuit.logicalCircuitId,
      { type: "pinOut", name: "Out", bitWidth: 1, pinSide: "right" },
      { x: 5, y: 5 },
    );
    subCircuit.circuitSymbols.push(pinResult.circuitSymbol);
    project.circuitSymbols.push(pinResult.circuitSymbol);

    // sub-power in main-circuit platzieren
    const subPlacement = instantiateCircuitFromPalette(
      project,
      "main-circuit",
      { type: "subCircuit", subCircuitId: "sub-power", name: "Power" },
      { x: 10, y: 10 },
    );
    const mainCircuit = project.logicalCircuits.find((lc) => lc.logicalCircuitId === "main-circuit")!;
    mainCircuit.circuitSymbols.push(subPlacement.circuitSymbol);
    project.circuitSymbols.push(subPlacement.circuitSymbol);

    // Platzierte Instanz muss genau einen Jam für "Out" besitzen
    expect(subPlacement.circuitSymbol.jams).toHaveLength(1);
    const outJam = subPlacement.circuitSymbol.jams[0];
    expect(outJam.pin.name).toBe("Out");
    expect(outJam.pin.pinType).toBe("output");
    expect(outJam.innerJam).toBeDefined();
    expect(outJam.innerJam?.circuitSymbolId).toBe(pinResult.circuitSymbol.circuitSymbolId);

    // Nachträglich einen weiteren Pin ("Enable") in sub-power einfügen
    const inPinResult = instantiateCircuitFromPalette(
      project,
      subCircuit.logicalCircuitId,
      { type: "pinIn", name: "Enable", bitWidth: 1, pinSide: "left" },
      { x: 2, y: 5 },
    );
    subCircuit.circuitSymbols.push(inPinResult.circuitSymbol);
    project.circuitSymbols.push(inPinResult.circuitSymbol);

    // Projekt aktualisieren via recalculateProjectWires
    const updatedProject = recalculateProjectWires(project);
    const updatedMainCircuit = updatedProject.logicalCircuits.find((lc) => lc.logicalCircuitId === "main-circuit")!;
    const updatedPlacedSymbol = updatedMainCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === subPlacement.circuitSymbol.circuitSymbolId,
    )!;

    // Platziertes Symbol muss nun 2 Jams besitzen
    expect(updatedPlacedSymbol.jams).toHaveLength(2);
    const jamNames = updatedPlacedSymbol.jams.map((j) => j.pin.name).sort();
    expect(jamNames).toEqual(["Enable", "Out"]);
  });

  it("appends consecutive numbers to duplicate pin names (X, X1, X2... and Q, Q1, Q2...)", () => {
    const existing = [
      { name: "X" },
      { name: "X1" },
      { name: "Q" },
      { name: "A0" },
    ];

    expect(generateUniquePinName("X", existing)).toBe("X2");
    expect(generateUniquePinName("Q", existing)).toBe("Q1");
    expect(generateUniquePinName("A0", existing)).toBe("A1");
    expect(generateUniquePinName("NewPin", existing)).toBe("NewPin");

    const project = createEmptyCircuitProject("Test Pin Uniqueness", "Main", "main-circuit");
    const p1 = instantiateCircuitFromPalette(project, "main-circuit", { type: "pinIn", notation: "X", name: "X" }, { x: 0, y: 0 });
    const p2 = instantiateCircuitFromPalette(project, "main-circuit", { type: "pinIn", notation: "X", name: "X" }, { x: 0, y: 2 });
    const p3 = instantiateCircuitFromPalette(project, "main-circuit", { type: "pinIn", notation: "X", name: "X" }, { x: 0, y: 4 });

    expect(p1.circuit.name).toBe("X");
    expect(p2.circuit.name).toBe("X1");
    expect(p3.circuit.name).toBe("X2");

    const q1 = instantiateCircuitFromPalette(project, "main-circuit", { type: "pinOut", notation: "Q", name: "Q" }, { x: 10, y: 0 });
    const q2 = instantiateCircuitFromPalette(project, "main-circuit", { type: "pinOut", notation: "Q", name: "Q" }, { x: 10, y: 2 });
    const q3 = instantiateCircuitFromPalette(project, "main-circuit", { type: "pinOut", notation: "Q", name: "Q" }, { x: 10, y: 4 });

    expect(q1.circuit.name).toBe("Q");
    expect(q2.circuit.name).toBe("Q1");
    expect(q3.circuit.name).toBe("Q2");
  });
});
