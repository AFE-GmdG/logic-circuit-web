import { describe, expect, it } from "vitest";

import type GridPoint from "../types/canvas/gridPoint";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Wire from "../types/circuit/wire";

import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createLedMatrix,
  createMemory,
  createPinCircuit,
  createSplitter,
} from "../utils/circuitLayout";
import {
  bitRangeEquals,
  buildHdlCircuitGraph,
  buildHdlTruthTableVectors,
  canExportCircuitComponent,
  canMergeBitRange,
  createFullBitRange,
  extractBitRangeValue,
  mergeBitRange,
  resolveExportTargetCircuits,
} from "../utils/hdl/hdlGraphBuilder";

function makeWire(
  wireId: string,
  logicalCircuitId: string,
  point1: GridPoint,
  point2: GridPoint,
): Wire {
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

function addPinSymbol(
  circuit: LogicalCircuit,
  pinId: string,
  pinType: "input" | "output",
  name: string,
  bitWidth: number,
  x: number,
  y: number,
  index = 0,
): CircuitSymbol {
  const { pin, pinCircuit } = createPinCircuit(
    pinId,
    circuit.logicalCircuitId,
    pinType,
    name,
    bitWidth,
    pinType === "input" ? "left" : "right",
    false,
    index,
  );
  circuit.logicalPins.push(pin);
  const sym = createCircuitSymbol(pinCircuit, circuit.logicalCircuitId, x, y, "up", `sym-${pinId}`);
  circuit.circuitSymbols.push(sym);
  return sym;
}

function addLogicalCircuitToProject(
  project: ReturnType<typeof createEmptyCircuitProject>,
  circuit: LogicalCircuit,
): void {
  project.logicalCircuits.push(circuit);
  project.circuits.set(circuit.circuitId, circuit);
}

describe("hdlGraphBuilder", () => {
  describe("HdlBitRange utilities", () => {
    it("creates full bit ranges and extracts unsigned slice values", () => {
      const full8 = createFullBitRange(8);
      expect(full8).toEqual({ first: 0, last: 7 });
      expect(extractBitRangeValue(0b1011_0110, { first: 0, last: 3 })).toBe(0b0110);
      expect(extractBitRangeValue(0b1011_0110, { first: 4, last: 7 })).toBe(0b1011);
      expect(extractBitRangeValue(0xffffffff, { first: 0, last: 31 })).toBe(0xffffffff);
      expect(extractBitRangeValue(0xdead_beef, { first: 16, last: 23 })).toBe(0xad);
    });

    it("detects adjacent or overlapping ranges and merges them", () => {
      expect(canMergeBitRange({ first: 0, last: 1 }, { first: 2, last: 3 })).toBe(true);
      expect(canMergeBitRange({ first: 4, last: 5 }, { first: 1, last: 3 })).toBe(true);
      expect(canMergeBitRange({ first: 0, last: 1 }, { first: 3, last: 4 })).toBe(false);

      const merged = mergeBitRange({ first: 2, last: 3 }, { first: 0, last: 1 });
      expect(bitRangeEquals(merged, { first: 0, last: 3 })).toBe(true);
    });
  });

  describe("canExportCircuitComponent", () => {
    it("allows standard combinational gates, constants, pins, and memory in all languages", () => {
      const andGate = createGate("and", 2, false);
      const nandGate = createGate("and", 2, true);
      const constant = createConstant("const-1", 4, 5);
      const memory = createMemory("rom-1", false, 4, 8);
      const { pinCircuit } = createPinCircuit("pin-1", "lc-1", "input", "a", 1);

      for (const lang of ["verilog", "vhdl", "n2t"] as const) {
        expect(canExportCircuitComponent(andGate, lang)).toBe(true);
        expect(canExportCircuitComponent(nandGate, lang)).toBe(true);
        expect(canExportCircuitComponent(constant, lang)).toBe(true);
        expect(canExportCircuitComponent(memory, lang)).toBe(true);
        expect(canExportCircuitComponent(pinCircuit, lang)).toBe(true);
      }
    });

    it("allows tri-state gates in Verilog and VHDL but rejects them in Nand2Tetris", () => {
      const tri1 = createGate("triState1", 2, false);
      const tri2 = createGate("triState2", 2, false);

      expect(canExportCircuitComponent(tri1, "verilog")).toBe(true);
      expect(canExportCircuitComponent(tri1, "vhdl")).toBe(true);
      expect(canExportCircuitComponent(tri1, "n2t")).toBe(false);
      expect(canExportCircuitComponent(tri2, "verilog")).toBe(true);
      expect(canExportCircuitComponent(tri2, "n2t")).toBe(false);
    });

    it("rejects interactive/display components such as clocks, LEDs, buttons, and LED matrices", () => {
      const clock = createGate("clock", 0, false);
      const led = createGate("led", 1, false);
      const button = createCircuitButton("btn-1");
      const ledMatrix = createLedMatrix("mat-1");

      for (const lang of ["verilog", "vhdl", "n2t"] as const) {
        expect(canExportCircuitComponent(clock, lang)).toBe(false);
        expect(canExportCircuitComponent(led, lang)).toBe(false);
        expect(canExportCircuitComponent(button, lang)).toBe(false);
        expect(canExportCircuitComponent(ledMatrix, lang)).toBe(false);
      }
    });
  });

  describe("resolveExportTargetCircuits", () => {
    it("resolves current, currentWithSubcircuits, and flaggedExportToHdl scopes cleanly", () => {
      const project = createEmptyCircuitProject();
      for (const lc of project.logicalCircuits) {
        lc.exportToHDL = false;
      }

      const leaf = createDefaultLogicalCircuit("lc-leaf", "Leaf");
      const middle = createDefaultLogicalCircuit("lc-middle", "Middle");
      const top = createDefaultLogicalCircuit("lc-top", "Top");
      const flagged = createDefaultLogicalCircuit("lc-flagged", "Flagged");
      leaf.exportToHDL = false;
      middle.exportToHDL = false;
      top.exportToHDL = false;
      flagged.exportToHDL = true;

      const leafSym = createCircuitSymbol(leaf, middle.logicalCircuitId, 4, 4, "up", "sym-leaf");
      middle.circuitSymbols.push(leafSym);
      const middleSym = createCircuitSymbol(middle, top.logicalCircuitId, 4, 4, "up", "sym-middle");
      top.circuitSymbols.push(middleSym);

      const leafSymInFlagged = createCircuitSymbol(leaf, flagged.logicalCircuitId, 4, 4, "up", "sym-leaf-f");
      flagged.circuitSymbols.push(leafSymInFlagged);

      addLogicalCircuitToProject(project, leaf);
      addLogicalCircuitToProject(project, middle);
      addLogicalCircuitToProject(project, top);
      addLogicalCircuitToProject(project, flagged);

      const onlyCurrent = resolveExportTargetCircuits(project, top, "current");
      expect(onlyCurrent.map((c) => c.logicalCircuitId)).toEqual(["lc-top"]);

      const withSubs = resolveExportTargetCircuits(project, top, "currentWithSubcircuits");
      expect(withSubs.map((c) => c.logicalCircuitId)).toEqual(["lc-top", "lc-middle", "lc-leaf"]);

      const flaggedList = resolveExportTargetCircuits(project, top, "flaggedExportToHdl");
      expect(flaggedList.map((c) => c.logicalCircuitId)).toEqual(["lc-flagged", "lc-leaf"]);
    });
  });

  describe("buildHdlCircuitGraph", () => {
    it("builds a topologically ordered graph for cascaded gates and ignores probes", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-chain", "Chain");
      addLogicalCircuitToProject(project, circuit);

      const pinA = addPinSymbol(circuit, "pin-a", "input", "a", 1, 0, 2, 0);
      const pinB = addPinSymbol(circuit, "pin-b", "input", "b", 1, 0, 6, 1);
      const notGate = createGate("not", 1, true);
      const notSym = createCircuitSymbol(notGate, circuit.logicalCircuitId, 6, 2, "up", "sym-not");
      const andGate = createGate("and", 2, false);
      const andSym = createCircuitSymbol(andGate, circuit.logicalCircuitId, 12, 4, "up", "sym-and");
      const probe = createCircuitProbe("probe-1", "p");
      const probeSym = createCircuitSymbol(probe, circuit.logicalCircuitId, 16, 2, "up", "sym-probe");
      const pinQ = addPinSymbol(circuit, "pin-q", "output", "q", 1, 20, 4, 2);

      circuit.circuitSymbols.push(notSym, andSym, probeSym);

      const notIn = notSym.jams.find((j) => j.effectivePinType === "input")!;
      const notOut = notSym.jams.find((j) => j.effectivePinType === "output")!;
      const andInputs = andSym.jams.filter((j) => j.effectivePinType === "input");
      const andOut = andSym.jams.find((j) => j.effectivePinType === "output")!;

      circuit.wires.push(
        makeWire("w1", circuit.logicalCircuitId, pinA.jams[0]!.absolutePoint, notIn.absolutePoint),
        makeWire("w2", circuit.logicalCircuitId, notOut.absolutePoint, andInputs[0]!.absolutePoint),
        makeWire("w3", circuit.logicalCircuitId, pinB.jams[0]!.absolutePoint, andInputs[1]!.absolutePoint),
        makeWire("w4", circuit.logicalCircuitId, andOut.absolutePoint, pinQ.jams[0]!.absolutePoint),
        makeWire("w5", circuit.logicalCircuitId, andOut.absolutePoint, probeSym.jams[0]!.absolutePoint),
      );

      const graph = buildHdlCircuitGraph(circuit, project, "verilog");
      expect(graph.hasErrors).toBe(false);
      expect(graph.logs).toHaveLength(0);
      expect(graph.inputPins.map((n) => n.circuitSymbol.circuit.name)).toEqual(["a", "b"]);
      expect(graph.outputPins.map((n) => n.circuitSymbol.circuit.name)).toEqual(["q"]);
      expect(graph.parts.map((n) => n.circuitSymbol.circuitSymbolId)).toEqual(["sym-not", "sym-and"]);
      expect(graph.parts[0]!.order).toBeLessThan(graph.parts[1]!.order);
    });

    it("resolves multi-bit splitters and merges contiguous bit ranges cleanly", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-split", "SplitterGraph");
      addLogicalCircuitToProject(project, circuit);

      const pinIn = addPinSymbol(circuit, "pin-in", "input", "busIn", 4, 0, 4, 0);
      const splitOut = createSplitter("sp-out", 4, 2, true);
      const splitOutSym = createCircuitSymbol(splitOut, circuit.logicalCircuitId, 8, 4, "up", "sym-sp-out");
      const pinLow = addPinSymbol(circuit, "pin-low", "output", "low", 2, 16, 2, 1);
      const pinHigh = addPinSymbol(circuit, "pin-high", "output", "high", 2, 16, 6, 2);

      circuit.circuitSymbols.push(splitOutSym);

      circuit.wires.push(
        makeWire("w-in", circuit.logicalCircuitId, pinIn.jams[0]!.absolutePoint, splitOutSym.jams[0]!.absolutePoint),
        makeWire("w-low", circuit.logicalCircuitId, splitOutSym.jams[1]!.absolutePoint, pinLow.jams[0]!.absolutePoint),
        makeWire("w-high", circuit.logicalCircuitId, splitOutSym.jams[2]!.absolutePoint, pinHigh.jams[0]!.absolutePoint),
      );

      const graph = buildHdlCircuitGraph(circuit, project, "vhdl");
      expect(graph.hasErrors).toBe(false);
      expect(graph.parts).toHaveLength(0);
      expect(graph.outputPins).toHaveLength(2);

      const lowConn = graph.outputPins[0]!.connections[0]!;
      const highConn = graph.outputPins[1]!.connections[0]!;
      expect(lowConn.outBits).toEqual({ first: 0, last: 1 });
      expect(lowConn.inBits).toEqual({ first: 0, last: 1 });
      expect(highConn.outBits).toEqual({ first: 2, last: 3 });
      expect(highConn.inBits).toEqual({ first: 0, last: 1 });
    });

    it("detects splitter feedback loops with error code loopInSplitter", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-split-loop", "SplitterLoop");
      addLogicalCircuitToProject(project, circuit);

      const pinIn = addPinSymbol(circuit, "pin-in", "input", "a", 2, 0, 4, 0);
      const splitter = createSplitter("sp-loop", 2, 2, true);
      const spSym = createCircuitSymbol(splitter, circuit.logicalCircuitId, 8, 4, "up", "sym-sp-loop");
      circuit.circuitSymbols.push(spSym);

      circuit.wires.push(
        makeWire("w-in", circuit.logicalCircuitId, pinIn.jams[0]!.absolutePoint, spSym.jams[0]!.absolutePoint),
        makeWire("w-loop", circuit.logicalCircuitId, spSym.jams[1]!.absolutePoint, spSym.jams[0]!.absolutePoint),
      );

      const graph = buildHdlCircuitGraph(circuit, project, "verilog");
      expect(graph.hasErrors).toBe(true);
      expect(graph.logs.some((log) => log.code === "loopInSplitter")).toBe(true);
    });

    it("reports unsupported components, co-located jams, and floating inputs", () => {
      const project = createEmptyCircuitProject();

      const unsupportedCircuit = createDefaultLogicalCircuit("lc-unsup", "Unsupported");
      addLogicalCircuitToProject(project, unsupportedCircuit);
      const triGate = createGate("triState1", 2, false);
      unsupportedCircuit.circuitSymbols.push(
        createCircuitSymbol(triGate, unsupportedCircuit.logicalCircuitId, 4, 4, "up", "sym-tri"),
      );
      const n2tGraph = buildHdlCircuitGraph(unsupportedCircuit, project, "n2t");
      expect(n2tGraph.hasErrors).toBe(true);
      expect(n2tGraph.logs.some((l) => l.code === "circuitUnsupported")).toBe(true);

      const badCircuit = createDefaultLogicalCircuit("lc-bad", "BadLayout");
      addLogicalCircuitToProject(project, badCircuit);
      const pinA = addPinSymbol(badCircuit, "pin-a", "input", "a", 1, 10, 10, 0);
      const pinQ = addPinSymbol(badCircuit, "pin-q", "output", "q", 1, 12, 10, 1);
      // Eingangs-Pin hat Ausgangs-Jam rechts (x + symbolWidth), Ausgangs-Pin links (x): beide landen auf (12, 11)
      expect(pinA.jams[0]!.absolutePoint).toEqual(pinQ.jams[0]!.absolutePoint);

      const andGate = createGate("and", 2, false);
      const andSym = createCircuitSymbol(andGate, badCircuit.logicalCircuitId, 20, 20, "up", "sym-and-unconn");
      badCircuit.circuitSymbols.push(andSym);

      const badGraph = buildHdlCircuitGraph(badCircuit, project, "verilog");
      expect(badGraph.hasErrors).toBe(true);
      expect(badGraph.logs.some((l) => l.code === "jamsColocated")).toBe(true);
      expect(badGraph.logs.some((l) => l.code === "jamUnconnected")).toBe(true);
    });
  });

  describe("buildHdlTruthTableVectors", () => {
    it("extracts full truth table test vectors for a combinational AND circuit", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-and", "And2");
      addLogicalCircuitToProject(project, circuit);

      const pinA = addPinSymbol(circuit, "pin-a", "input", "a", 1, 0, 2, 0);
      const pinB = addPinSymbol(circuit, "pin-b", "input", "b", 1, 0, 6, 1);
      const andGate = createGate("and", 2, false);
      const andSym = createCircuitSymbol(andGate, circuit.logicalCircuitId, 8, 4, "up", "sym-and");
      circuit.circuitSymbols.push(andSym);
      const pinQ = addPinSymbol(circuit, "pin-q", "output", "q", 1, 16, 4, 2);

      const inJams = andSym.jams.filter((j) => j.effectivePinType === "input");
      const outJam = andSym.jams.find((j) => j.effectivePinType === "output")!;
      circuit.wires.push(
        makeWire("w1", circuit.logicalCircuitId, pinA.jams[0]!.absolutePoint, inJams[0]!.absolutePoint),
        makeWire("w2", circuit.logicalCircuitId, pinB.jams[0]!.absolutePoint, inJams[1]!.absolutePoint),
        makeWire("w3", circuit.logicalCircuitId, outJam.absolutePoint, pinQ.jams[0]!.absolutePoint),
      );

      const vectors = buildHdlTruthTableVectors(circuit, project);
      expect(vectors.status).toBe("ok");
      expect(vectors.totalInputBits).toBe(2);
      expect(vectors.inputs.map((p) => p.name)).toEqual(["a", "b"]);
      expect(vectors.outputs.map((p) => p.name)).toEqual(["q"]);
      expect(vectors.rows).toHaveLength(4);
      expect(vectors.rows.map((r) => [r.inputs[0], r.inputs[1], r.outputs?.[0]])).toEqual([
        [0, 0, 0],
        [0, 1, 0],
        [1, 0, 0],
        [1, 1, 1],
      ]);
    });

    it("reports inputTooBig when total input bits exceed limit and notTestable without IO pins", () => {
      const project = createEmptyCircuitProject();
      const empty = createDefaultLogicalCircuit("lc-empty", "Empty");
      addLogicalCircuitToProject(project, empty);
      expect(buildHdlTruthTableVectors(empty, project).status).toBe("notTestable");

      const wide = createDefaultLogicalCircuit("lc-wide", "Wide");
      addLogicalCircuitToProject(project, wide);
      const pinA = addPinSymbol(wide, "pin-a", "input", "a", 17, 0, 2, 0);
      const pinQ = addPinSymbol(wide, "pin-q", "output", "q", 17, 10, 2, 1);
      wide.wires.push(makeWire("w1", wide.logicalCircuitId, pinA.jams[0]!.absolutePoint, pinQ.jams[0]!.absolutePoint));

      const result = buildHdlTruthTableVectors(wide, project, 16);
      expect(result.status).toBe("inputTooBig");
      expect(result.totalInputBits).toBe(17);
    });
  });
});
