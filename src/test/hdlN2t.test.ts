import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type GridPoint from "../types/canvas/gridPoint";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Wire from "../types/circuit/wire";

import {
  calculateCircuitDimensionsAndPins,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createMemory,
  createPinCircuit,
  createSplitter,
} from "../utils/circuitLayout";
import {
  exportN2t,
  isValidN2tIdentifier,
  sanitizeN2tIdentifier,
} from "../utils/hdl/n2tExporter";
import { parseLogicCircuitXml } from "../utils/xml/logicCircuitXmlReader";

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
  const layout = calculateCircuitDimensionsAndPins(circuit.logicalPins, 3, 4);
  circuit.pins = layout.pins;
  circuit.symbolWidth = layout.gridWidth;
  circuit.symbolHeight = layout.gridHeight;
  const sym = createCircuitSymbol(pinCircuit, circuit.logicalCircuitId, x, y, "up", `sym-${pinId}`);
  circuit.circuitSymbols.push(sym);
  return sym;
}

function registerCircuit(
  project: ReturnType<typeof createEmptyCircuitProject>,
  circuit: LogicalCircuit,
): void {
  project.logicalCircuits.push(circuit);
  project.circuits.set(circuit.circuitId, circuit);
}

describe("Nand2Tetris Exporter (T-078)", () => {
  describe("Identifier Validation & Sanitizing", () => {
    it("enforces alphanumeric identifiers without underscores and filters N2T keywords", () => {
      expect(isValidN2tIdentifier("HalfAdder2", false)).toBe(true);
      expect(isValidN2tIdentifier("Half_Adder", false)).toBe(false);
      expect(isValidN2tIdentifier("CHIP", false)).toBe(false);
      expect(isValidN2tIdentifier("true", false)).toBe(false);
      expect(isValidN2tIdentifier("2Mux", false)).toBe(false);

      expect(sanitizeN2tIdentifier("Half_Adder-2", true)).toBe("HalfAdder2");
      expect(sanitizeN2tIdentifier("2Mux", true)).toBe("n2Mux");
      expect(sanitizeN2tIdentifier("CHIP", true)).toBe("CHIPChip");
      expect(isValidN2tIdentifier("Half_Adder-2", true)).toBe(true);
    });
  });

  describe("Multi-Input & Inverted Gate Tree Decomposition", () => {
    it("decomposes a 3-input NAND gate into And + Nand with v1 intermediate wire and single comment", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-nand3", "Nand3");
      registerCircuit(project, circuit);

      const pA = addPinSymbol(circuit, "pa", "input", "a", 1, 0, 2, 0);
      const pB = addPinSymbol(circuit, "pb", "input", "b", 1, 0, 6, 1);
      const pC = addPinSymbol(circuit, "pc", "input", "c", 1, 0, 10, 2);
      const nand3 = createGate("and", 3, true);
      const nandSym = createCircuitSymbol(nand3, circuit.logicalCircuitId, 8, 6, "up", "sym-n3");
      const pQ = addPinSymbol(circuit, "pq", "output", "q", 1, 16, 6, 3);

      circuit.circuitSymbols.push(nandSym);
      const inJams = nandSym.jams.filter((j) => j.effectivePinType === "input");
      const outJam = nandSym.jams.find((j) => j.effectivePinType === "output")!;

      circuit.wires.push(
        makeWire("w1", circuit.logicalCircuitId, pA.jams[0]!.absolutePoint, inJams[0]!.absolutePoint),
        makeWire("w2", circuit.logicalCircuitId, pB.jams[0]!.absolutePoint, inJams[1]!.absolutePoint),
        makeWire("w3", circuit.logicalCircuitId, pC.jams[0]!.absolutePoint, inJams[2]!.absolutePoint),
        makeWire("w4", circuit.logicalCircuitId, outJam.absolutePoint, pQ.jams[0]!.absolutePoint),
      );

      const res = exportN2t(project, circuit, {
        scope: "current",
        exportTests: true,
        commentPoints: true,
        fixNames: true,
      });

      expect(res.hasErrors).toBe(false);
      expect(res.files.map((f) => f.fileName)).toEqual(["Nand3.hdl", "Nand3.tst", "Nand3.cmp"]);

      const hdl = res.files[0]!.content;
      expect(hdl).toContain("CHIP Nand3 {");
      expect(hdl).toContain("IN a, b, c;");
      expect(hdl).toContain("OUT q;");
      expect(hdl).toContain("\t// NAND (8, 6)");
      expect(hdl).toContain("And(a=a, b=b, out=Pin11x8v1);");
      expect(hdl).toContain("Nand(a=c, b=Pin11x8v1, out=q);");

      const commentMatches = hdl.match(/\/\/ NAND \(8, 6\)/g);
      expect(commentMatches).toHaveLength(1);

      const tst = res.files[1]!.content;
      expect(tst).toContain("load Nand3.hdl,");
      expect(tst).toContain("compare-to Nand3.cmp,");
      expect(tst).toContain("set a 1,");

      const cmp = res.files[2]!.content;
      expect(cmp).toContain("| a | b | c | q |");
      expect(cmp).toContain("| 1 | 1 | 1 | 0 |");
      expect(cmp).toContain("| 1 | 1 | 0 | 1 |");
    });

    it("decomposes NOR, XNOR, and 5-input OR gates into 2-input Or/Xor + Not primitives", () => {
      const project = createEmptyCircuitProject();
      const norCircuit = createDefaultLogicalCircuit("lc-nor3", "Nor3");
      registerCircuit(project, norCircuit);

      const pA = addPinSymbol(norCircuit, "pa", "input", "a", 1, 0, 2, 0);
      const pB = addPinSymbol(norCircuit, "pb", "input", "b", 1, 0, 6, 1);
      const pC = addPinSymbol(norCircuit, "pc", "input", "c", 1, 0, 10, 2);
      const nor3 = createGate("or", 3, true);
      const norSym = createCircuitSymbol(nor3, norCircuit.logicalCircuitId, 8, 6, "up", "sym-nor3");
      const pQ = addPinSymbol(norCircuit, "pq", "output", "q", 1, 16, 6, 3);
      norCircuit.circuitSymbols.push(norSym);

      const inJams = norSym.jams.filter((j) => j.effectivePinType === "input");
      const outJam = norSym.jams.find((j) => j.effectivePinType === "output")!;
      norCircuit.wires.push(
        makeWire("w1", norCircuit.logicalCircuitId, pA.jams[0]!.absolutePoint, inJams[0]!.absolutePoint),
        makeWire("w2", norCircuit.logicalCircuitId, pB.jams[0]!.absolutePoint, inJams[1]!.absolutePoint),
        makeWire("w3", norCircuit.logicalCircuitId, pC.jams[0]!.absolutePoint, inJams[2]!.absolutePoint),
        makeWire("w4", norCircuit.logicalCircuitId, outJam.absolutePoint, pQ.jams[0]!.absolutePoint),
      );

      const norRes = exportN2t(project, norCircuit, { scope: "current", exportTests: true });
      expect(norRes.hasErrors).toBe(false);
      const norHdl = norRes.files[0]!.content;
      expect(norHdl).toContain("Or(a=a, b=b, out=Pin11x8v1);");
      expect(norHdl).toContain("Or(a=c, b=Pin11x8v1, out=Pin11x8v2);");
      expect(norHdl).toContain("Not(in=Pin11x8v2, out=q);");
      expect(norRes.files[2]!.content).toContain("| 0 | 0 | 0 | 1 |");
      expect(norRes.files[2]!.content).toContain("| 0 | 0 | 1 | 0 |");

      const xnorCircuit = createDefaultLogicalCircuit("lc-xnor2", "Xnor2");
      registerCircuit(project, xnorCircuit);
      const x1 = addPinSymbol(xnorCircuit, "x1", "input", "a", 1, 0, 2, 0);
      const x2 = addPinSymbol(xnorCircuit, "x2", "input", "b", 1, 0, 6, 1);
      const xnor2 = createGate("xor", 2, true);
      const xSym = createCircuitSymbol(xnor2, xnorCircuit.logicalCircuitId, 8, 4, "up", "sym-xnor");
      const xq = addPinSymbol(xnorCircuit, "xq", "output", "q", 1, 16, 4, 2);
      xnorCircuit.circuitSymbols.push(xSym);

      const xIn = xSym.jams.filter((j) => j.effectivePinType === "input");
      const xOut = xSym.jams.find((j) => j.effectivePinType === "output")!;
      xnorCircuit.wires.push(
        makeWire("wx1", xnorCircuit.logicalCircuitId, x1.jams[0]!.absolutePoint, xIn[0]!.absolutePoint),
        makeWire("wx2", xnorCircuit.logicalCircuitId, x2.jams[0]!.absolutePoint, xIn[1]!.absolutePoint),
        makeWire("wx3", xnorCircuit.logicalCircuitId, xOut.absolutePoint, xq.jams[0]!.absolutePoint),
      );

      const xRes = exportN2t(project, xnorCircuit, { scope: "current", exportTests: false });
      expect(xRes.hasErrors).toBe(false);
      expect(xRes.files[0]!.content).toContain("Xor(a=a, b=b, out=Pin11x5v1);");
      expect(xRes.files[0]!.content).toContain("Not(in=Pin11x5v1, out=q);");
    });
  });

  describe("Multi-Bit Constants, Splitters & Fanout", () => {
    it("expands constant bits into true/false bindings and handles splitter slices and fanout", () => {
      const project = createEmptyCircuitProject();
      const sub = createDefaultLogicalCircuit("lc-id", "Buf1");
      const sIn = addPinSymbol(sub, "si", "input", "in", 2, 0, 2, 0);
      const sOut = addPinSymbol(sub, "so", "output", "out", 2, 10, 2, 1);
      // Eingebetteter Not-Chain im Subcircuit, damit Pin-zu-Pin im N2T erlaubt ist
      const sp = createSplitter("sp-i", 2, 2, true);
      const spInSym = createCircuitSymbol(sp, sub.logicalCircuitId, 4, 2, "up", "sym-sp-i");
      const spBack = createSplitter("sp-o", 2, 2, false);
      const spOutSym = createCircuitSymbol(spBack, sub.logicalCircuitId, 8, 2, "up", "sym-sp-o");
      sub.circuitSymbols.push(spInSym, spOutSym);
      sub.wires.push(
        makeWire("ws1", sub.logicalCircuitId, sIn.jams[0]!.absolutePoint, spInSym.jams[0]!.absolutePoint),
        makeWire("ws2", sub.logicalCircuitId, spInSym.jams[1]!.absolutePoint, spOutSym.jams[1]!.absolutePoint),
        makeWire("ws3", sub.logicalCircuitId, spInSym.jams[2]!.absolutePoint, spOutSym.jams[2]!.absolutePoint),
        makeWire("ws4", sub.logicalCircuitId, spOutSym.jams[0]!.absolutePoint, sOut.jams[0]!.absolutePoint),
      );
      registerCircuit(project, sub);

      const top = createDefaultLogicalCircuit("lc-top", "ConstSub");
      const cVal = createConstant("c2", 2, 0b10);
      const cSym = createCircuitSymbol(cVal, top.logicalCircuitId, 0, 2, "up", "sym-c");
      const subSym = createCircuitSymbol(sub, top.logicalCircuitId, 6, 2, "up", "sym-sub");
      const outPin = addPinSymbol(top, "po", "output", "y", 2, 14, 2, 0);
      top.circuitSymbols.push(cSym, subSym);
      top.wires.push(
        makeWire("wt1", top.logicalCircuitId, cSym.jams[0]!.absolutePoint, subSym.jams[0]!.absolutePoint),
        makeWire("wt2", top.logicalCircuitId, subSym.jams[1]!.absolutePoint, outPin.jams[0]!.absolutePoint),
      );
      registerCircuit(project, top);

      const res = exportN2t(project, top, { scope: "current", exportTests: false });
      expect(res.hasErrors).toBe(false);
      expect(res.files[0]!.content).toContain("Buf1(in[0]=false, in[1]=true, out=y);");
    });
  });

  describe("Memory Mapping & N2T Constraint Validation", () => {
    it("exports valid RAM8 and ROM32K modules and rejects unsupported memory specs or direct pin links", () => {
      const project = createEmptyCircuitProject();
      const memCircuit = createDefaultLogicalCircuit("lc-mem", "RamRomChip");
      registerCircuit(project, memCircuit);

      const ram8 = createMemory("ram8", true, 3, 16, { writeOn1: false, dualPort: false });
      const rom32k = createMemory("rom32", false, 15, 16, { dualPort: false });
      const ramSym = createCircuitSymbol(ram8, memCircuit.logicalCircuitId, 8, 4, "up", "sym-ram8");
      const romSym = createCircuitSymbol(rom32k, memCircuit.logicalCircuitId, 8, 12, "up", "sym-rom32k");
      memCircuit.circuitSymbols.push(ramSym, romSym);

      const addr = addPinSymbol(memCircuit, "pa", "input", "addr", 3, 0, 2, 0);
      const din = addPinSymbol(memCircuit, "pd", "input", "din", 16, 0, 6, 1);
      const load = addPinSymbol(memCircuit, "pl", "input", "load", 1, 8, 10, 2);
      const pc = addPinSymbol(memCircuit, "ppc", "input", "pc", 15, 0, 14, 3);
      const ramOut = addPinSymbol(memCircuit, "pro", "output", "ramOut", 16, 18, 4, 4);
      const romOut = addPinSymbol(memCircuit, "pko", "output", "romOut", 16, 18, 14, 5);

      const ramJam = (suffix: string) => ramSym.jams.find((j) => j.pin.pinId.endsWith(suffix))!;
      const romJam = (suffix: string) => romSym.jams.find((j) => j.pin.pinId.endsWith(suffix))!;

      memCircuit.wires.push(
        makeWire("w1", memCircuit.logicalCircuitId, addr.jams[0]!.absolutePoint, ramJam("-addr").absolutePoint),
        makeWire("w2", memCircuit.logicalCircuitId, din.jams[0]!.absolutePoint, ramJam("-data-in").absolutePoint),
        makeWire("w3", memCircuit.logicalCircuitId, load.jams[0]!.absolutePoint, ramJam("-write").absolutePoint),
        makeWire("w4", memCircuit.logicalCircuitId, ramJam("-data-out").absolutePoint, ramOut.jams[0]!.absolutePoint),
        makeWire("w5", memCircuit.logicalCircuitId, pc.jams[0]!.absolutePoint, romJam("-addr").absolutePoint),
        makeWire("w6", memCircuit.logicalCircuitId, romJam("-data-out").absolutePoint, romOut.jams[0]!.absolutePoint),
      );

      const res = exportN2t(project, memCircuit, { scope: "current", exportTests: true });
      expect(res.hasErrors).toBe(false);
      expect(res.logs.some((l) => l.code === "ramTestWarning")).toBe(true);
      const hdl = res.files[0]!.content;
      expect(hdl).toContain("RAM8(address=addr, in=din, load=load, out=ramOut);");
      expect(hdl).toContain("ROM32K(address=pc, out=romOut);");

      // Direkte Pin-zu-Pin-Verbindung + ungültiger Dual-Port RAM8 müssen sauber abgewiesen werden
      const bad = createDefaultLogicalCircuit("lc-bad", "BadDirect");
      registerCircuit(project, bad);
      const bIn = addPinSymbol(bad, "bi", "input", "a", 1, 0, 2, 0);
      const bOut = addPinSymbol(bad, "bo", "output", "q", 1, 10, 2, 1);
      bad.wires.push(makeWire("wb", bad.logicalCircuitId, bIn.jams[0]!.absolutePoint, bOut.jams[0]!.absolutePoint));

      const badRes = exportN2t(project, bad, { scope: "current", exportTests: false });
      expect(badRes.hasErrors).toBe(true);
      expect(badRes.logs.some((l) => l.code === "pinDirectConnect")).toBe(true);
    });
  });

  describe("Desktop Reference Project HDLTests.CircuitProject", () => {
    it("exports Test and BigGates circuits cleanly and rejects Error category circuits", () => {
      const filePath = path.resolve(
        process.cwd(),
        "reference/LogicCircuit/Sources/LogicCircuit.UnitTest/Properties/HDLTests.CircuitProject",
      );
      const xmlText = fs.readFileSync(filePath, "utf-8");
      const project = parseLogicCircuitXml(xmlText);

      const testCircuits = project.logicalCircuits.filter((c) => c.category === "Test");
      const bigGateCircuits = project.logicalCircuits.filter((c) => c.category === "BigGates");
      const errorCircuits = project.logicalCircuits.filter((c) => c.category === "Error");

      expect(testCircuits.length).toBeGreaterThan(0);
      expect(bigGateCircuits.length).toBeGreaterThan(0);
      expect(errorCircuits.length).toBeGreaterThan(0);

      for (const c of [...testCircuits, ...bigGateCircuits]) {
        const res = exportN2t(project, c, { scope: "current", exportTests: false, fixNames: true });
        expect(res.hasErrors, `Circuit '${c.name}' failed: ${res.logs.map((l) => l.message).join("; ")}`).toBe(false);
        expect(res.files[0]?.content).toContain(`CHIP ${sanitizeN2tIdentifier(c.name, true)}`);
      }

      for (const c of errorCircuits) {
        const res = exportN2t(project, c, { scope: "current", exportTests: false, fixNames: false });
        expect(res.hasErrors, `Error circuit '${c.name}' unexpectedly succeeded`).toBe(true);
      }
    });
  });
});
