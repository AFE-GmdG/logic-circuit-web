import type GridPoint from "../types/canvas/gridPoint";
import type CircuitProject from "../types/circuit/circuitProject";
import type CircuitShape from "../types/circuit/circuitShape";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type GateType from "../types/circuit/gateType";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type PinSide from "../types/circuit/pinSide";
import type Rotation from "../types/circuit/rotation";
import type { NativeLogicalCircuit } from "../types/storage/nativeProjectFormat";

import i18n from "../i18n";

import {
  calculateCircuitDimensionsAndPins,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
  createSplitter,
  getLogicalCircuitMinDimensions,
  rebuildImportedProjectLayout,
} from "./circuitLayout";
import {
  type TransferToLibraryOptions,
  type TransferToLibraryResult,
  transferProjectCircuitToLibrary,
} from "./libraryCircuitTransfer";
import { buildCircuitProjectFromNativeCircuits } from "./storage/nativeProjectReader";
import { serializeLogicalCircuitToNative } from "./storage/nativeProjectWriter";
import { createWire } from "./wireUtils";

export type BuiltInLibraryCategoryKey = "arithmetic" | "multiplexers" | "decoders" | "memory";

export type BuiltInCircuitKey =
  | "halfAdder"
  | "fullAdder"
  | "mux2to1"
  | "mux4to1"
  | "decoder2to4"
  | "srLatch"
  | "dFlipFlop"
  | "jkFlipFlop"
  | "register4Bit";

export const BUILT_IN_CIRCUIT_IDS: Record<BuiltInCircuitKey, string> = {
  halfAdder: "b1000000-0000-4000-8000-000000000001",
  fullAdder: "b1000000-0000-4000-8000-000000000002",
  mux2to1: "b1000000-0000-4000-8000-000000000003",
  mux4to1: "b1000000-0000-4000-8000-000000000004",
  decoder2to4: "b1000000-0000-4000-8000-000000000005",
  srLatch: "b1000000-0000-4000-8000-000000000006",
  dFlipFlop: "b1000000-0000-4000-8000-000000000007",
  jkFlipFlop: "b1000000-0000-4000-8000-000000000008",
  register4Bit: "b1000000-0000-4000-8000-000000000009",
};

export type BuiltInLibraryItem = {
  logicalCircuitId: string;
  key: BuiltInCircuitKey;
  categoryKey: BuiltInLibraryCategoryKey;
  isBuiltIn: true;
  circuit: NativeLogicalCircuit;
};

type CircuitSpec = {
  key: BuiltInCircuitKey;
  categoryKey: BuiltInLibraryCategoryKey;
  notation: string;
  circuitShape: CircuitShape;
};

const BUILT_IN_SPECS: readonly CircuitSpec[] = [
  { key: "halfAdder", categoryKey: "arithmetic", notation: "HA", circuitShape: "alu" },
  { key: "fullAdder", categoryKey: "arithmetic", notation: "FA", circuitShape: "alu" },
  { key: "mux2to1", categoryKey: "multiplexers", notation: "MUX 2:1", circuitShape: "mux" },
  { key: "mux4to1", categoryKey: "multiplexers", notation: "MUX 4:1", circuitShape: "mux" },
  { key: "decoder2to4", categoryKey: "decoders", notation: "DEC 2:4", circuitShape: "demux" },
  { key: "srLatch", categoryKey: "memory", notation: "SR", circuitShape: "flipFlop" },
  { key: "dFlipFlop", categoryKey: "memory", notation: "DFF", circuitShape: "flipFlop" },
  { key: "jkFlipFlop", categoryKey: "memory", notation: "JKFF", circuitShape: "flipFlop" },
  { key: "register4Bit", categoryKey: "memory", notation: "REG 4", circuitShape: "rectangular" },
];

type TranslateFn = (key: string) => string;

function deterministicGuid(circuitNum: number, kindNum: number, seq: number): string {
  const c = circuitNum.toString(16).padStart(4, "0");
  const k = kindNum.toString(16).padStart(4, "0");
  const s = seq.toString(16).padStart(12, "0");
  return `b200${c}-${k}-4000-8000-${s}`;
}

class StandardCircuitBuilder {
  readonly #project: CircuitProject;
  readonly #lc: LogicalCircuit;
  readonly #circuitNum: number;
  #symSeq = 1;
  #pinSeq = 1;
  #compSeq = 1;
  #wireSeq = 1;

  constructor(
    project: CircuitProject,
    circuitNum: number,
    spec: CircuitSpec,
    translate: TranslateFn,
  ) {
    this.#project = project;
    this.#circuitNum = circuitNum;
    const id = BUILT_IN_CIRCUIT_IDS[spec.key];
    const name = translate(`builtInLibrary.circuits.${spec.key}.name`);
    const category = translate(`builtInLibrary.categories.${spec.categoryKey}`);
    const note = translate(`builtInLibrary.circuits.${spec.key}.note`);

    const lc = createDefaultLogicalCircuit(id, name, category, note);
    lc.notation = spec.notation;
    lc.circuitShape = spec.circuitShape;
    this.#lc = lc;
    project.logicalCircuits.push(lc);
    project.circuits.set(lc.circuitId, lc);
  }

  get circuit(): LogicalCircuit {
    return this.#lc;
  }

  addPin(
    pinType: "input" | "output",
    name: string,
    x: number,
    y: number,
    index: number,
    options?: { bitWidth?: number; pinSide?: PinSide; jamNotation?: string },
  ): CircuitSymbol {
    const pinId = deterministicGuid(this.#circuitNum, 1, this.#pinSeq++);
    const symId = deterministicGuid(this.#circuitNum, 2, this.#symSeq++);
    const bitWidth = options?.bitWidth ?? 1;
    const pinSide = options?.pinSide ?? (pinType === "input" ? "left" : "right");
    const jamNotation = options?.jamNotation ?? name;
    const { pin, pinCircuit } = createPinCircuit(
      pinId,
      this.#lc.logicalCircuitId,
      pinType,
      name,
      bitWidth,
      pinSide,
      false,
      index,
      2,
      2,
      jamNotation,
    );
    this.#lc.logicalPins.push(pin);
    this.#project.pins.push(pin);
    this.#project.circuits.set(pinCircuit.circuitId, pinCircuit);

    const sym = createCircuitSymbol(pinCircuit, this.#lc.logicalCircuitId, x, y, "up", symId);
    this.#lc.circuitSymbols.push(sym);
    this.#project.circuitSymbols.push(sym);
    return sym;
  }

  addGate(
    gateType: GateType,
    inputCount: number,
    invertedOutput: boolean,
    x: number,
    y: number,
    rotation: Rotation = "up",
  ): CircuitSymbol {
    const gate = createGate(gateType, inputCount, invertedOutput);
    this.#project.gates.set(gate.gateId, gate);
    this.#project.circuits.set(gate.circuitId, gate);

    const symId = deterministicGuid(this.#circuitNum, 2, this.#symSeq++);
    const sym = createCircuitSymbol(gate, this.#lc.logicalCircuitId, x, y, rotation, symId);
    this.#lc.circuitSymbols.push(sym);
    this.#project.circuitSymbols.push(sym);
    return sym;
  }

  addSplitter(bitWidth: number, pinCount: number, clockwise: boolean, x: number, y: number): CircuitSymbol {
    const splitterId = deterministicGuid(this.#circuitNum, 3, this.#compSeq++);
    const splitter = createSplitter(splitterId, bitWidth, pinCount, clockwise);
    this.#project.splitters.push(splitter);
    this.#project.circuits.set(splitter.circuitId, splitter);

    const symId = deterministicGuid(this.#circuitNum, 2, this.#symSeq++);
    const sym = createCircuitSymbol(splitter, this.#lc.logicalCircuitId, x, y, "up", symId);
    this.#lc.circuitSymbols.push(sym);
    this.#project.circuitSymbols.push(sym);
    return sym;
  }

  addSubCircuit(subCircuit: LogicalCircuit, x: number, y: number): CircuitSymbol {
    const symId = deterministicGuid(this.#circuitNum, 2, this.#symSeq++);
    const sym = createCircuitSymbol(subCircuit, this.#lc.logicalCircuitId, x, y, "up", symId);
    this.#lc.circuitSymbols.push(sym);
    this.#project.circuitSymbols.push(sym);
    return sym;
  }

  jam(sym: CircuitSymbol, pinNameOrIndex: string | number): GridPoint {
    if (typeof pinNameOrIndex === "number") {
      const target = sym.jams[pinNameOrIndex];
      if (!target) {
        throw new Error(`Jam index ${pinNameOrIndex} not found on "${sym.circuit.name}".`);
      }
      return target.absolutePoint;
    }
    const target = sym.jams.find((j) => j.pin.name === pinNameOrIndex);
    if (!target) {
      throw new Error(`Jam "${pinNameOrIndex}" not found on "${sym.circuit.name}".`);
    }
    return target.absolutePoint;
  }

  wireSegment(p1: GridPoint, p2: GridPoint): void {
    if (p1.x === p2.x && p1.y === p2.y) {
      return;
    }
    const wireId = deterministicGuid(this.#circuitNum, 4, this.#wireSeq++);
    const wire = createWire(this.#lc.logicalCircuitId, p1, p2, wireId);
    this.#lc.wires.push(wire);
    this.#project.wires.push(wire);
  }

  route(p1: GridPoint, p2: GridPoint, midX?: number): void {
    if (p1.y === p2.y && midX === undefined) {
      this.wireSegment(p1, p2);
      return;
    }
    const bendX = midX ?? Math.floor((p1.x + p2.x) / 2);
    const corner1: GridPoint = { x: bendX, y: p1.y };
    const corner2: GridPoint = { x: bendX, y: p2.y };
    this.wireSegment(p1, corner1);
    this.wireSegment(corner1, corner2);
    this.wireSegment(corner2, p2);
  }

  finalize(): LogicalCircuit {
    const symbolCoords = new Map<string, GridPoint>();
    for (const sym of this.#lc.circuitSymbols) {
      if (sym.circuit.kind === "pin") {
        symbolCoords.set(sym.circuit.circuitId, { x: sym.x, y: sym.y });
      }
    }
    const { minWidth, minHeight } = getLogicalCircuitMinDimensions(this.#lc);
    const layout = calculateCircuitDimensionsAndPins(
      this.#lc.logicalPins,
      minWidth,
      minHeight,
      symbolCoords,
    );
    this.#lc.symbolWidth = layout.gridWidth;
    this.#lc.symbolHeight = layout.gridHeight;
    this.#lc.pins = layout.pins;
    return this.#lc;
  }

  routeAround(points: GridPoint[]): void {
    for (let i = 0; i < points.length - 1; i += 1) {
      this.wireSegment(points[i], points[i + 1]);
    }
  }

  // Verbindet einen Quellpunkt über eine vertikale Sammelschiene exakt segmentiert mit mehreren Zielpunkten
  tapVerticalRail(src: GridPoint, railX: number, targets: GridPoint[]): void {
    this.wireSegment(src, { x: railX, y: src.y });
    const sortedYs = Array.from(new Set([src.y, ...targets.map((t) => t.y)])).sort((a, b) => a - b);
    for (let i = 0; i < sortedYs.length - 1; i += 1) {
      this.wireSegment({ x: railX, y: sortedYs[i] }, { x: railX, y: sortedYs[i + 1] });
    }
    for (const target of targets) {
      this.wireSegment({ x: railX, y: target.y }, target);
    }
  }

  // Verzweigt von einem Ausgangspfad (src -> splitX -> dest) sauber an (splitX, src.y)
  branchHorizontal(src: GridPoint, splitX: number, dest: GridPoint, destMidX?: number): GridPoint {
    const tapPoint: GridPoint = { x: splitX, y: src.y };
    this.wireSegment(src, tapPoint);
    this.route(tapPoint, dest, destMidX);
    return tapPoint;
  }
}

function buildHalfAdder(project: CircuitProject, translate: TranslateFn): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 1, BUILT_IN_SPECS[0], translate);
  const pinA = b.addPin("input", "A", 2, 4, 0);
  const pinB = b.addPin("input", "B", 2, 8, 1);
  const xorGate = b.addGate("xor", 2, false, 11, 4);
  const andGate = b.addGate("and", 2, false, 11, 8);
  const pinS = b.addPin("output", "S", 16, 5, 0);
  const pinC = b.addPin("output", "C", 16, 9, 1);

  b.tapVerticalRail(b.jam(pinA, 0), 7, [b.jam(xorGate, 0), b.jam(andGate, 1)]);
  b.tapVerticalRail(b.jam(pinB, 0), 9, [b.jam(xorGate, 1), b.jam(andGate, 0)]);
  b.wireSegment(b.jam(xorGate, 2), b.jam(pinS, 0));
  b.wireSegment(b.jam(andGate, 2), b.jam(pinC, 0));
  return b.circuit;
}

function buildFullAdder(project: CircuitProject, translate: TranslateFn): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 2, BUILT_IN_SPECS[1], translate);
  const pinA = b.addPin("input", "A", 2, 4, 0);
  const pinB = b.addPin("input", "B", 2, 8, 1);
  const pinCin = b.addPin("input", "Cin", 2, 12, 2);

  const xor1 = b.addGate("xor", 2, false, 11, 4);
  const and1 = b.addGate("and", 2, false, 11, 8);
  const xor2 = b.addGate("xor", 2, false, 18, 5);
  const and2 = b.addGate("and", 2, false, 18, 10);
  const orCarry = b.addGate("or", 2, false, 23, 9);

  const pinS = b.addPin("output", "S", 28, 6, 0);
  const pinCout = b.addPin("output", "Cout", 28, 10, 1);

  // Eingänge A & B kreuzungsarm und überlappungsfrei an XOR1 und AND1
  b.tapVerticalRail(b.jam(pinA, 0), 7, [b.jam(xor1, 0), b.jam(and1, 1)]);
  b.tapVerticalRail(b.jam(pinB, 0), 9, [b.jam(xor1, 1), b.jam(and1, 0)]);

  // Zwischensumme XOR1 -> XOR2 & AND2 über saubere vertikale Sammelschiene
  b.tapVerticalRail(b.jam(xor1, 2), 16, [b.jam(xor2, 0), b.jam(and2, 0)]);

  // Cin -> XOR2 & AND2 über saubere vertikale Sammelschiene
  b.tapVerticalRail(b.jam(pinCin, 0), 17, [b.jam(xor2, 1), b.jam(and2, 1)]);

  // Überträge und Ausgänge direkt und überlappungsfrei verbinden
  b.wireSegment(b.jam(and1, 2), b.jam(orCarry, 0));
  b.wireSegment(b.jam(and2, 2), b.jam(orCarry, 1));
  b.wireSegment(b.jam(xor2, 2), b.jam(pinS, 0));
  b.wireSegment(b.jam(orCarry, 2), b.jam(pinCout, 0));
  return b.circuit;
}

function buildMux2to1(project: CircuitProject, translate: TranslateFn): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 3, BUILT_IN_SPECS[2], translate);
  const pinD0 = b.addPin("input", "D0", 2, 4, 0);
  const pinD1 = b.addPin("input", "D1", 2, 8, 1);
  const pinS = b.addPin("input", "S", 2, 12, 2, { pinSide: "bottom" });

  const notS = b.addGate("not", 1, true, 9, 5);
  const and0 = b.addGate("and", 2, false, 14, 4);
  const and1 = b.addGate("and", 2, false, 14, 8);
  const orOut = b.addGate("or", 2, false, 21, 5);
  const pinY = b.addPin("output", "Y", 26, 6, 0);

  b.wireSegment(b.jam(pinD0, 0), b.jam(and0, 0));
  b.wireSegment(b.jam(pinD1, 0), b.jam(and1, 0));

  b.tapVerticalRail(b.jam(pinS, 0), 7, [b.jam(notS, 0), b.jam(and1, 1)]);
  b.wireSegment(b.jam(notS, 1), b.jam(and0, 1));

  b.wireSegment(b.jam(and0, 2), b.jam(orOut, 0));
  b.route(b.jam(and1, 2), b.jam(orOut, 1), 19);
  b.wireSegment(b.jam(orOut, 2), b.jam(pinY, 0));
  return b.finalize();
}

function buildMux4to1(project: CircuitProject, translate: TranslateFn): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 4, BUILT_IN_SPECS[3], translate);
  const pinD0 = b.addPin("input", "D0", 2, 4, 0);
  const pinD1 = b.addPin("input", "D1", 2, 8, 1);
  const pinD2 = b.addPin("input", "D2", 2, 12, 2);
  const pinD3 = b.addPin("input", "D3", 2, 16, 3);
  const pinS0 = b.addPin("input", "S0", 2, 21, 4, { pinSide: "bottom" });
  const pinS1 = b.addPin("input", "S1", 2, 25, 5, { pinSide: "bottom" });

  const and0 = b.addGate("and", 2, false, 11, 4);
  const and1 = b.addGate("and", 2, false, 11, 8);
  const orLow = b.addGate("or", 2, false, 18, 7);

  const notS0 = b.addGate("not", 1, true, 6, 18, "left");
  const and2 = b.addGate("and", 2, false, 11, 12);
  const and3 = b.addGate("and", 2, false, 11, 16);
  const orHigh = b.addGate("or", 2, false, 18, 13);

  const notS1 = b.addGate("not", 1, true, 25, 9);
  const andFinal0 = b.addGate("and", 2, false, 30, 8);
  const andFinal1 = b.addGate("and", 2, false, 30, 12);
  const orFinal = b.addGate("or", 2, false, 37, 9);
  const pinY = b.addPin("output", "Y", 42, 10, 0);

  // Dateneingänge D0..D3 direkt an die vier Eingangs-ANDs
  b.wireSegment(b.jam(pinD0, 0), b.jam(and0, 0));
  b.wireSegment(b.jam(pinD1, 0), b.jam(and1, 0));
  b.wireSegment(b.jam(pinD2, 0), b.jam(and2, 0));
  b.wireSegment(b.jam(pinD3, 0), b.jam(and3, 0));

  // Gemeinsamer S0-Inverter (rotiert) + Sammelschienen für /S0 (x=7) und S0 (x=9)
  const s0Tap: GridPoint = { x: 7, y: b.jam(pinS0, 0).y };
  b.wireSegment(b.jam(pinS0, 0), s0Tap);
  b.wireSegment(s0Tap, b.jam(notS0, 0));
  b.tapVerticalRail(s0Tap, 9, [b.jam(and1, 1), b.jam(and3, 1)]);
  b.tapVerticalRail(b.jam(notS0, 1), 7, [b.jam(and0, 1), b.jam(and2, 1)]);

  // Erste Multiplexer-Stufe (D0/D1 -> orLow, D2/D3 -> orHigh)
  b.route(b.jam(and0, 2), b.jam(orLow, 0), 16);
  b.wireSegment(b.jam(and1, 2), b.jam(orLow, 1));
  b.wireSegment(b.jam(and2, 2), b.jam(orHigh, 0));
  b.route(b.jam(and3, 2), b.jam(orHigh, 1), 16);

  // Zweite Multiplexer-Stufe (S1 wählt zwischen orLow und orHigh)
  b.wireSegment(b.jam(orLow, 2), b.jam(andFinal0, 0));
  b.wireSegment(b.jam(orHigh, 2), b.jam(andFinal1, 1));
  b.tapVerticalRail(b.jam(pinS1, 0), 23, [b.jam(notS1, 0), b.jam(andFinal1, 0)]);
  b.wireSegment(b.jam(notS1, 1), b.jam(andFinal0, 1));

  b.wireSegment(b.jam(andFinal0, 2), b.jam(orFinal, 0));
  b.route(b.jam(andFinal1, 2), b.jam(orFinal, 1), 35);
  b.wireSegment(b.jam(orFinal, 2), b.jam(pinY, 0));
  return b.circuit;
}

function buildDecoder2to4(project: CircuitProject, translate: TranslateFn): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 5, BUILT_IN_SPECS[4], translate);
  const pinA0 = b.addPin("input", "A0", 2, 4, 0);
  const pinA1 = b.addPin("input", "A1", 2, 7, 1);
  const pinEn = b.addPin("input", "EN", 2, 18, 2);

  const notA0 = b.addGate("not", 1, true, 8, 3);
  const notA1 = b.addGate("not", 1, true, 8, 8);

  const and0 = b.addGate("and", 3, false, 18, 4);
  const and1 = b.addGate("and", 3, false, 18, 8);
  const and2 = b.addGate("and", 3, false, 18, 12);
  const and3 = b.addGate("and", 3, false, 18, 16);

  const pinY0 = b.addPin("output", "Y0", 24, 5, 0);
  const pinY1 = b.addPin("output", "Y1", 24, 9, 1);
  const pinY2 = b.addPin("output", "Y2", 24, 13, 2);
  const pinY3 = b.addPin("output", "Y3", 24, 17, 3);

  const a0Pt = b.jam(pinA0, 0);
  const a1Pt = b.jam(pinA1, 0);
  const enPt = b.jam(pinEn, 0);

  // Verzweigung zu den Invertern am x=7 und Weiterleitung auf die 5 Sammelschienen
  const a0Tap: GridPoint = { x: 7, y: a0Pt.y };
  const a0Under: GridPoint = { x: 7, y: 7 };
  b.wireSegment(a0Pt, a0Tap);
  b.wireSegment(a0Tap, b.jam(notA0, 0));
  b.wireSegment(a0Tap, a0Under);

  const a1Tap: GridPoint = { x: 7, y: a1Pt.y };
  b.wireSegment(a1Pt, a1Tap);
  b.route(a1Tap, b.jam(notA1, 0), 7);

  // Vertikale Sammelschienen für /A0 (12), A0 (13), A1 (14), /A1 (15), EN (16)
  b.tapVerticalRail(b.jam(notA0, 1), 12, [b.jam(and0, 0), b.jam(and2, 0)]);
  b.tapVerticalRail(a0Under, 13, [b.jam(and1, 0), b.jam(and3, 0)]);
  b.tapVerticalRail(a1Tap, 14, [b.jam(and2, 1), b.jam(and3, 1)]);
  b.tapVerticalRail(b.jam(notA1, 1), 15, [b.jam(and0, 1), b.jam(and1, 1)]);
  b.tapVerticalRail(enPt, 16, [b.jam(and0, 2), b.jam(and1, 2), b.jam(and2, 2), b.jam(and3, 2)]);

  b.wireSegment(b.jam(and0, 3), b.jam(pinY0, 0));
  b.wireSegment(b.jam(and1, 3), b.jam(pinY1, 0));
  b.wireSegment(b.jam(and2, 3), b.jam(pinY2, 0));
  b.wireSegment(b.jam(and3, 3), b.jam(pinY3, 0));
  return b.circuit;
}

function buildSrLatch(project: CircuitProject, translate: TranslateFn): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 6, BUILT_IN_SPECS[5], translate);
  const pinS = b.addPin("input", "S", 2, 12, 0);
  const pinR = b.addPin("input", "R", 2, 4, 1);

  const norTop = b.addGate("or", 2, true, 8, 4);
  const norBot = b.addGate("or", 2, true, 8, 10);

  const pinQ = b.addPin("output", "Q", 15, 5, 0);
  const pinNq = b.addPin("output", "nQ", 15, 11, 1);

  const qOut = b.jam(norTop, 2);
  const nqOut = b.jam(norBot, 2);

  b.wireSegment(b.jam(pinR, 0), b.jam(norTop, 0));
  b.wireSegment(b.jam(pinS, 0), b.jam(norBot, 1));
  const qTap = b.branchHorizontal(qOut, 12, b.jam(pinQ, 0));
  const nqTap = b.branchHorizontal(nqOut, 12, b.jam(pinNq, 0));

  // Klassische diagonale Kreuzkopplung Q -> norBot.In1 und nQ -> norTop.In2
  b.routeAround([
    qTap,
    { x: 12, y: 8 },
    { x: 7, y: 10 },
    { x: 7, y: b.jam(norBot, 0).y },
    b.jam(norBot, 0),
  ]);
  b.routeAround([
    nqTap,
    { x: 12, y: 10 },
    { x: 7, y: 8 },
    { x: 7, y: b.jam(norTop, 1).y },
    b.jam(norTop, 1),
  ]);
  return b.circuit;
}

function buildDFlipFlop(project: CircuitProject, translate: TranslateFn): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 7, BUILT_IN_SPECS[6], translate);
  const pinD = b.addPin("input", "D", 2, 22, 0);
  const pinClk = b.addPin("input", "CLK", 2, 10, 1);

  // Klassisches flankengesteuertes 6-NAND D-Flipflop (7474-Topologie)
  const g1 = b.addGate("and", 2, true, 9, 2);
  const g2 = b.addGate("and", 2, true, 9, 8);
  const g3 = b.addGate("and", 3, true, 9, 14);
  const g4 = b.addGate("and", 2, true, 9, 20);

  const gQ = b.addGate("and", 2, true, 16, 9);
  const gNq = b.addGate("and", 2, true, 16, 15);

  const pinQ = b.addPin("output", "Q", 23, 10, 0);
  const pinNq = b.addPin("output", "nQ", 23, 16, 1);

  const dPt = b.jam(pinD, 0);
  const clkPt = b.jam(pinClk, 0);
  b.wireSegment(dPt, b.jam(g4, 1));

  // CLK -> g2.In2 und g3.In2 über vertikale Schiene x=7
  b.tapVerticalRail(clkPt, 7, [b.jam(g2, 1), b.jam(g3, 1)]);

  // Erstes Latch-Kreuz: g1Out -> g2.In1 und g2Out -> g1.In2, g3.In1, gQ.In1
  const g1Out = b.jam(g1, 2);
  b.routeAround([
    g1Out,
    { x: 13, y: g1Out.y },
    { x: 13, y: 6 },
    { x: 8, y: 8 },
    { x: 8, y: b.jam(g2, 0).y },
    b.jam(g2, 0),
  ]);

  const g2Out = b.jam(g2, 2);
  const g2Tap = b.branchHorizontal(g2Out, 13, b.jam(gQ, 0));
  b.routeAround([
    g2Tap,
    { x: 13, y: 8 },
    { x: 8, y: 6 },
    { x: 8, y: b.jam(g1, 1).y },
    b.jam(g1, 1),
  ]);
  b.routeAround([
    g2Tap,
    { x: 13, y: 12 },
    { x: 8, y: 14 },
    { x: 8, y: b.jam(g3, 0).y },
    b.jam(g3, 0),
  ]);

  // Zweites Latch-Kreuz: g3Out -> gNq.In2 & g4.In1 sowie g4Out -> g3.In3 & (hinter CLK) g1.In1
  const g3Out = b.jam(g3, 3);
  const g3Corner: GridPoint = { x: 13, y: 18 };
  b.routeAround([g3Out, { x: 13, y: g3Out.y }, g3Corner]);
  b.wireSegment(g3Corner, b.jam(gNq, 1));
  b.routeAround([
    g3Corner,
    { x: 8, y: 20 },
    { x: 8, y: b.jam(g4, 0).y },
    b.jam(g4, 0),
  ]);

  const g4Out = b.jam(g4, 2);
  const g4Tap: GridPoint = { x: 8, y: b.jam(g3, 2).y };
  b.routeAround([
    g4Out,
    { x: 13, y: g4Out.y },
    { x: 13, y: 20 },
    { x: 8, y: 18 },
    g4Tap,
  ]);
  b.wireSegment(g4Tap, b.jam(g3, 2));
  b.routeAround([
    g4Tap,
    { x: 1, y: g4Tap.y },
    { x: 1, y: b.jam(g1, 0).y },
    b.jam(g1, 0),
  ]);

  // Ausgangs-Latch Q / nQ mit diagonaler Kreuzkopplung
  const qOut = b.jam(gQ, 2);
  const nqOut = b.jam(gNq, 2);
  const qTap = b.branchHorizontal(qOut, 20, b.jam(pinQ, 0));
  const nqTap = b.branchHorizontal(nqOut, 20, b.jam(pinNq, 0));
  b.routeAround([
    qTap,
    { x: 20, y: 13 },
    { x: 15, y: 15 },
    { x: 15, y: b.jam(gNq, 0).y },
    b.jam(gNq, 0),
  ]);
  b.routeAround([
    nqTap,
    { x: 20, y: 15 },
    { x: 15, y: 13 },
    { x: 15, y: b.jam(gQ, 1).y },
    b.jam(gQ, 1),
  ]);
  return b.finalize();
}

function buildJkFlipFlop(
  project: CircuitProject,
  dFlipFlop: LogicalCircuit,
  translate: TranslateFn,
): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 8, BUILT_IN_SPECS[7], translate);
  const pinJ = b.addPin("input", "J", 2, 4, 0);
  const pinClk = b.addPin("input", "CLK", 2, 14, 1);
  const pinK = b.addPin("input", "K", 2, 8, 2);

  const notK = b.addGate("not", 1, true, 7, 7);
  const andSet = b.addGate("and", 2, false, 12, 4);
  const andHold = b.addGate("and", 2, false, 12, 8);
  const orD = b.addGate("or", 2, false, 17, 7);
  const dff = b.addSubCircuit(dFlipFlop, 22, 8);

  const pinQ = b.addPin("output", "Q", 30, 8, 0);
  const pinNq = b.addPin("output", "nQ", 30, 10, 1);

  b.wireSegment(b.jam(pinJ, 0), b.jam(andSet, 0));
  b.wireSegment(b.jam(pinK, 0), b.jam(notK, 0));
  b.wireSegment(b.jam(notK, 1), b.jam(andHold, 0));
  b.route(b.jam(andSet, 2), b.jam(orD, 0), 16);
  b.wireSegment(b.jam(andHold, 2), b.jam(orD, 1));
  b.wireSegment(b.jam(orD, 2), b.jam(dff, "D"));
  b.route(b.jam(pinClk, 0), b.jam(dff, "CLK"), 21);

  const qOut = b.jam(dff, "Q");
  const nqOut = b.jam(dff, "nQ");
  const qTap = b.branchHorizontal(qOut, 26, b.jam(pinQ, 0));
  const nqTap = b.branchHorizontal(nqOut, 27, b.jam(pinNq, 0));

  // Rückkopplung Q -> andHold.In2 und nQ -> andSet.In2 außen herum (nur eine Kreuzung)
  b.routeAround([
    qTap,
    { x: 26, y: 17 },
    { x: 1, y: 17 },
    { x: 1, y: b.jam(andHold, 1).y },
    b.jam(andHold, 1),
  ]);
  b.routeAround([
    nqTap,
    { x: 27, y: 18 },
    { x: 0, y: 18 },
    { x: 0, y: b.jam(andSet, 1).y },
    b.jam(andSet, 1),
  ]);
  return b.circuit;
}

function buildRegister4Bit(
  project: CircuitProject,
  mux2to1: LogicalCircuit,
  dFlipFlop: LogicalCircuit,
  translate: TranslateFn,
): LogicalCircuit {
  const b = new StandardCircuitBuilder(project, 9, BUILT_IN_SPECS[8], translate);
  const pinD = b.addPin("input", "D", 2, 9, 0, { bitWidth: 4 });
  const pinLoad = b.addPin("input", "LOAD", 2, 4, 1);
  const pinClk = b.addPin("input", "CLK", 2, 33, 2);

  const inSplit = b.addSplitter(4, 4, true, 7, 8);
  const outSplit = b.addSplitter(4, 4, false, 29, 17);
  const pinQ = b.addPin("output", "Q", 33, 18, 0, { bitWidth: 4 });

  b.wireSegment(b.jam(pinD, 0), b.jam(inSplit, "Bus"));
  b.wireSegment(b.jam(outSplit, "Bus"), b.jam(pinQ, 0));

  const loadPt = b.jam(pinLoad, 0);
  const clkPt = b.jam(pinClk, 0);
  const loadBranchTargets: GridPoint[] = [];
  const clkTargets: GridPoint[] = [];
  const rowYs = [6, 13, 21, 28];

  for (let bit = 0; bit < 4; bit += 1) {
    const rowY = rowYs[bit];
    const mux = b.addSubCircuit(mux2to1, 15, rowY);
    const dff = b.addSubCircuit(dFlipFlop, 22, rowY + 1);

    // D[bit] -> mux.D1 (LOAD=1), DFF.Q -> mux.D0 (LOAD=0 Haltezweig)
    if (bit === 0) {
      b.wireSegment(b.jam(inSplit, "0"), b.jam(mux, "D1"));
    } else {
      b.route(b.jam(inSplit, String(bit)), b.jam(mux, "D1"), 12 - bit);
    }
    b.wireSegment(b.jam(mux, "Y"), b.jam(dff, "D"));

    const qPt = b.jam(dff, "Q");
    const qRailX = bit === 0 || bit === 3 ? 28 : 27;
    const loopCorner: GridPoint = { x: 14, y: rowY - 1 };
    const muxD0 = b.jam(mux, "D0");
    b.tapVerticalRail(qPt, qRailX, [b.jam(outSplit, String(bit)), loopCorner]);
    b.routeAround([loopCorner, { x: 14, y: muxD0.y }, muxD0]);

    const loadTarget = b.jam(mux, "S");
    const loadCorner: GridPoint = { x: 13, y: loadTarget.y + 1 };
    loadBranchTargets.push(loadCorner);
    b.routeAround([loadCorner, { x: loadTarget.x, y: loadTarget.y + 1 }, loadTarget]);

    clkTargets.push(b.jam(dff, "CLK"));
  }

  b.tapVerticalRail(loadPt, 13, loadBranchTargets);
  b.tapVerticalRail(clkPt, 20, clkTargets);

  return b.circuit;
}

// Baut das vollständige Projekt aller integrierten Standard-ICs inklusive Abhängigkeiten auf
export function createBuiltInLibraryProject(translate: TranslateFn = (key) => i18n.t(key)): CircuitProject {
  const project = createEmptyCircuitProject("Built-in Standard Library", "Main");
  // Leere Standard-Main-Schaltung wieder entfernen, damit nur Standard-ICs enthalten sind
  project.circuits.delete(project.logicalCircuits[0].circuitId);
  project.logicalCircuits = [];

  buildHalfAdder(project, translate);
  buildFullAdder(project, translate);
  const mux2to1 = buildMux2to1(project, translate);
  buildMux4to1(project, translate);
  buildDecoder2to4(project, translate);
  buildSrLatch(project, translate);
  const dff = buildDFlipFlop(project, translate);
  buildJkFlipFlop(project, dff, translate);
  buildRegister4Bit(project, mux2to1, dff, translate);

  project.project.logicalCircuitId = project.logicalCircuits[0].logicalCircuitId;
  return rebuildImportedProjectLayout(project);
}

// Liefert die schreibgeschützten Standard-ICs als NativeLogicalCircuit-Liste (für Vorschau, Transfer & Suche)
export function getBuiltInLibraryCircuits(
  translate: TranslateFn = (key) => i18n.t(key),
): NativeLogicalCircuit[] {
  const project = createBuiltInLibraryProject(translate);
  return project.logicalCircuits.map((lc) => serializeLogicalCircuitToNative(lc, project));
}

// Liefert den schreibgeschützten Standard-IC-Katalog mit isBuiltIn-Kennzeichnung und i18n-Schlüsseln
export function getBuiltInLibraryItems(
  translate: TranslateFn = (key) => i18n.t(key),
): BuiltInLibraryItem[] {
  const circuits = getBuiltInLibraryCircuits(translate);
  const byId = new Map(circuits.map((lc) => [lc.logicalCircuitId, lc]));

  return BUILT_IN_SPECS.map((spec) => {
    const id = BUILT_IN_CIRCUIT_IDS[spec.key];
    const circuit = byId.get(id)!;
    return {
      logicalCircuitId: id,
      key: spec.key,
      categoryKey: spec.categoryKey,
      isBuiltIn: true,
      circuit,
    };
  });
}

// Prüft, ob eine Schaltungs-ID zum unveränderlichen Standard-IC-Katalog gehört
export function isBuiltInLibraryCircuitId(circuitId: string): boolean {
  return Object.values(BUILT_IN_CIRCUIT_IDS).includes(circuitId);
}

// Erzeugt aus einem schreibgeschützten Standard-IC eine bearbeitbare Kopie (samt Sub-Schaltungen) für die eigene Bibliothek
export function duplicateBuiltInCircuitToLibrary(
  builtInCircuitId: string,
  existingLibraryCircuits: readonly NativeLogicalCircuit[],
  options?: TransferToLibraryOptions & { translate?: TranslateFn },
): TransferToLibraryResult {
  const builtInCircuits = getBuiltInLibraryCircuits(options?.translate);
  if (!builtInCircuits.some((lc) => lc.logicalCircuitId === builtInCircuitId)) {
    throw new Error(`Integrierter Standard-Baustein "${builtInCircuitId}" wurde nicht gefunden.`);
  }

  const firstCircuit = builtInCircuits[0];
  const projectMeta = {
    projectId: "built-in-library-source",
    name: firstCircuit.name,
    note: "",
    zoom: 1,
    frequency: 10,
    isMaximumSpeed: false,
    logicalCircuitId: builtInCircuitId,
    categoryTextNoteCollapsed: false,
    categoryInputOutputCollapsed: false,
    categoryPrimitivesCollapsed: false,
  };

  const sourceProject = buildCircuitProjectFromNativeCircuits(projectMeta, [], builtInCircuits);
  return transferProjectCircuitToLibrary(
    sourceProject,
    builtInCircuitId,
    existingLibraryCircuits,
    options,
  );
}
