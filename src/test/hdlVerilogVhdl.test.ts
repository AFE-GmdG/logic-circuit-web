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
  exportVerilog,
  isValidVerilogIdentifier,
  sanitizeVerilogIdentifier,
} from "../utils/hdl/verilogExporter";
import {
  exportVhdl,
  isValidVhdlIdentifier,
  sanitizeVhdlIdentifier,
} from "../utils/hdl/vhdlExporter";
import { encodeMemoryData, setCellValue } from "../utils/memoryDataUtils";

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

describe("Verilog & VHDL Exporters (T-077)", () => {
  describe("Identifier Validation & Sanitizing", () => {
    it("validates and fixes Verilog identifiers and reserved keywords", () => {
      expect(isValidVerilogIdentifier("HalfAdder", false)).toBe(true);
      expect(isValidVerilogIdentifier("Half Adder", false)).toBe(false);
      expect(isValidVerilogIdentifier("wire", false)).toBe(false);
      expect(isValidVerilogIdentifier("1bit", false)).toBe(false);

      expect(sanitizeVerilogIdentifier("Half Adder-1", true)).toBe("Half_Adder_1");
      expect(sanitizeVerilogIdentifier("1bit", true)).toBe("_1bit");
      expect(sanitizeVerilogIdentifier("wire", true)).toBe("wire_id");
      expect(isValidVerilogIdentifier("Half Adder-1", true)).toBe(true);
    });

    it("validates and fixes VHDL identifiers (no leading/trailing/double underscores, case-insensitive keywords)", () => {
      expect(isValidVhdlIdentifier("Full_Adder_1", false)).toBe(true);
      expect(isValidVhdlIdentifier("Bad__Name", false)).toBe(false);
      expect(isValidVhdlIdentifier("_lead", false)).toBe(false);
      expect(isValidVhdlIdentifier("SIGNAL", false)).toBe(false);

      expect(sanitizeVhdlIdentifier("Bad__Name-", true)).toBe("Bad_Name");
      expect(sanitizeVhdlIdentifier("3state_buf", true)).toBe("n_3state_buf");
      expect(sanitizeVhdlIdentifier("SIGNAL", true)).toBe("SIGNAL_sig");
      expect(isValidVhdlIdentifier("Bad__Name-", true)).toBe(true);
    });
  });

  describe("Combinational Gates, Constants & Testbenches", () => {
    it("exports 3-input NAND gate with constant and full self-checking SV & VHDL testbenches", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-nand3", "Nand3 Test");
      registerCircuit(project, circuit);

      const pinA = addPinSymbol(circuit, "pin-a", "input", "a", 1, 0, 2, 0);
      const pinB = addPinSymbol(circuit, "pin-b", "input", "b", 1, 0, 6, 1);
      const constOne = createConstant("const-1", 1, 1);
      const constSym = createCircuitSymbol(constOne, circuit.logicalCircuitId, 0, 10, "up", "sym-const");
      const nand3 = createGate("and", 3, true);
      const nandSym = createCircuitSymbol(nand3, circuit.logicalCircuitId, 8, 4, "up", "sym-nand");
      const pinQ = addPinSymbol(circuit, "pin-q", "output", "q", 1, 16, 4, 2);

      circuit.circuitSymbols.push(constSym, nandSym);
      const inJams = nandSym.jams.filter((j) => j.effectivePinType === "input");
      const outJam = nandSym.jams.find((j) => j.effectivePinType === "output")!;

      circuit.wires.push(
        makeWire("w1", circuit.logicalCircuitId, pinA.jams[0]!.absolutePoint, inJams[0]!.absolutePoint),
        makeWire("w2", circuit.logicalCircuitId, pinB.jams[0]!.absolutePoint, inJams[1]!.absolutePoint),
        makeWire("w3", circuit.logicalCircuitId, constSym.jams[0]!.absolutePoint, inJams[2]!.absolutePoint),
        makeWire("w4", circuit.logicalCircuitId, outJam.absolutePoint, pinQ.jams[0]!.absolutePoint),
      );

      const svRes = exportVerilog(project, circuit, {
        scope: "current",
        exportTests: true,
        fixNames: true,
        commentPoints: true,
      });
      expect(svRes.hasErrors).toBe(false);
      expect(svRes.files.map((f) => f.fileName)).toEqual(["Nand3_Test.sv", "Nand3_Test_TestBench.sv"]);

      const svModule = svRes.files[0]!.content;
      expect(svModule).toContain("module Nand3_Test(");
      expect(svModule).toContain("// NAND (8, 4)");
      expect(svModule).toContain("nand nand_8x4(");
      expect(svModule).toContain("1'h1");

      const svTb = svRes.files[1]!.content;
      expect(svTb).toContain("module Nand3_Test_TestBench;");
      expect(svTb).toContain("TestBenchTruthState[4]");
      expect(svTb).toContain("$error");

      const vhdlRes = exportVhdl(project, circuit, {
        scope: "current",
        exportTests: true,
        fixNames: true,
        commentPoints: true,
      });
      expect(vhdlRes.hasErrors).toBe(false);
      expect(vhdlRes.files.map((f) => f.fileName)).toEqual(["Nand3_Test.vhd", "Nand3_Test_tb.vhd"]);

      const vhdlModule = vhdlRes.files[0]!.content;
      expect(vhdlModule).toContain("entity Nand3_Test is");
      expect(vhdlModule).toContain("q <= not (a and b and '1');");

      const vhdlTb = vhdlRes.files[1]!.content;
      expect(vhdlTb).toContain("entity Nand3_Test_tb is");
      expect(vhdlTb).toContain("wait for 10 ns;");
      expect(vhdlTb).toContain("assert q = '1'");
      expect(vhdlTb).toContain("assert q = '0'");
    });
  });

  describe("Tri-State Drivers & Floating Port Diagnostics", () => {
    it("exports tri-state driver in Verilog and VHDL including high-Z test vectors", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-tri", "TriBuf");
      registerCircuit(project, circuit);

      const pinD = addPinSymbol(circuit, "pin-d", "input", "d", 1, 0, 2, 0);
      const pinEn = addPinSymbol(circuit, "pin-en", "input", "en", 1, 0, 6, 1);
      const triGate = createGate("triState1", 2, false);
      const triSym = createCircuitSymbol(triGate, circuit.logicalCircuitId, 8, 2, "up", "sym-tri");
      circuit.circuitSymbols.push(triSym);
      const pinY = addPinSymbol(circuit, "pin-y", "output", "y", 1, 16, 2, 2);

      const inPin = triSym.jams.find((j) => j.pin.pinId === "in-0")!;
      const enPin = triSym.jams.find((j) => j.pin.pinId === "enable")!;
      const outPin = triSym.jams.find((j) => j.pin.pinId === "out-0")!;

      circuit.wires.push(
        makeWire("w1", circuit.logicalCircuitId, pinD.jams[0]!.absolutePoint, inPin.absolutePoint),
        makeWire("w2", circuit.logicalCircuitId, pinEn.jams[0]!.absolutePoint, enPin.absolutePoint),
        makeWire("w3", circuit.logicalCircuitId, outPin.absolutePoint, pinY.jams[0]!.absolutePoint),
      );

      const svRes = exportVerilog(project, circuit, { scope: "current", exportTests: true, fixNames: true });
      expect(svRes.hasErrors).toBe(false);
      expect(svRes.files[0]!.content).toContain("bufif1 bufif1_8x2(\n\t\ty,\n\t\td,\n\t\ten\n\t);");
      expect(svRes.files[1]!.content).toContain("1'bz");

      const vhdlRes = exportVhdl(project, circuit, { scope: "current", exportTests: true, fixNames: true });
      expect(vhdlRes.hasErrors).toBe(false);
      expect(vhdlRes.files[0]!.content).toContain("y <= d when en = '1' else 'Z';");
      expect(vhdlRes.files[1]!.content).toContain("assert y = 'Z'");
    });

    it("fails export when tri-state enable or data input is left floating", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-tri-bad", "FloatingTri");
      registerCircuit(project, circuit);

      const triGate = createGate("triState1", 2, false);
      const triSym = createCircuitSymbol(triGate, circuit.logicalCircuitId, 8, 2, "up", "sym-tri");
      circuit.circuitSymbols.push(triSym);

      const svRes = exportVerilog(project, circuit, { scope: "current", exportTests: false });
      expect(svRes.hasErrors).toBe(true);
      expect(svRes.logs.some((l) => l.code === "floatingPort" && l.level === "error")).toBe(true);
    });
  });

  describe("Subcircuits, Multi-Bit Buses & Splitters", () => {
    it("exports nested subcircuit with merged multi-bit splitter concatenation in Verilog and VHDL", () => {
      const project = createEmptyCircuitProject();
      for (const lc of project.logicalCircuits) {
        lc.exportToHDL = false;
      }

      // Subcircuit BusPass(a[1:0]) -> y[1:0]
      const sub = createDefaultLogicalCircuit("lc-sub", "BusPass");
      sub.exportToHDL = false;
      const subIn = addPinSymbol(sub, "sub-in", "input", "a", 2, 0, 2, 0);
      const subOut = addPinSymbol(sub, "sub-out", "output", "y", 2, 10, 2, 1);
      sub.wires.push(makeWire("ws", sub.logicalCircuitId, subIn.jams[0]!.absolutePoint, subOut.jams[0]!.absolutePoint));
      registerCircuit(project, sub);

      // Top circuit verbindet zwei 1-Bit Pins über Splitter zu einem 2-Bit Subcircuit-Eingang
      const top = createDefaultLogicalCircuit("lc-top", "TopSystem");
      top.exportToHDL = true;
      const inLo = addPinSymbol(top, "top-lo", "input", "lo", 1, 0, 0, 0);
      const inHi = addPinSymbol(top, "top-hi", "input", "hi", 1, 0, 4, 1);
      const combiner = createSplitter("sp-comb", 2, 2, false);
      const spSym = createCircuitSymbol(combiner, top.logicalCircuitId, 6, 2, "up", "sym-sp");
      const subSym = createCircuitSymbol(sub, top.logicalCircuitId, 14, 2, "up", "sym-sub");
      const outBus = addPinSymbol(top, "top-out", "output", "q", 2, 24, 2, 2);
      top.circuitSymbols.push(spSym, subSym);

      top.wires.push(
        makeWire("wt1", top.logicalCircuitId, inLo.jams[0]!.absolutePoint, spSym.jams[1]!.absolutePoint),
        makeWire("wt2", top.logicalCircuitId, inHi.jams[0]!.absolutePoint, spSym.jams[2]!.absolutePoint),
        makeWire("wt3", top.logicalCircuitId, spSym.jams[0]!.absolutePoint, subSym.jams[0]!.absolutePoint),
        makeWire("wt4", top.logicalCircuitId, subSym.jams[1]!.absolutePoint, outBus.jams[0]!.absolutePoint),
      );
      registerCircuit(project, top);

      const svRes = exportVerilog(project, top, { scope: "flaggedExportToHdl", exportTests: true });
      expect(svRes.hasErrors).toBe(false);
      expect(svRes.targetCircuits).toEqual(["TopSystem", "BusPass"]);
      const topSv = svRes.files.find((f) => f.fileName === "TopSystem.sv")!.content;
      expect(topSv).toContain(".a({hi, lo})");
      expect(topSv).toContain(".y(q)");

      const vhdlRes = exportVhdl(project, top, { scope: "flaggedExportToHdl", exportTests: true });
      expect(vhdlRes.hasErrors).toBe(false);
      const topVhdl = vhdlRes.files.find((f) => f.fileName === "TopSystem.vhd")!.content;
      expect(topVhdl).toContain("signal Cat_14x2_a : std_logic_vector(1 downto 0);");
      expect(topVhdl).toContain("Cat_14x2_a <= hi & lo;");
      expect(topVhdl).toContain("u_BusPass_14x2 : entity work.BusPass");
      expect(topVhdl).toContain("a => Cat_14x2_a");
    });
  });

  describe("ROM & Dual-Port RAM Generation", () => {
    it("emits initialized ROM and Dual-Port writable RAM in Verilog and VHDL", () => {
      const project = createEmptyCircuitProject();
      const circuit = createDefaultLogicalCircuit("lc-mem", "MemUnit");
      registerCircuit(project, circuit);

      const buf = new Uint8Array(4);
      setCellValue(buf, 8, 0, 0xaa);
      setCellValue(buf, 8, 1, 0x55);
      const ramDataB64 = encodeMemoryData(buf, 2, 8);

      const ram = createMemory("ram-1", true, 2, 8, {
        writeOn1: true,
        onStart: "data",
        dualPort: true,
        data: ramDataB64,
      });

      const ramSym = createCircuitSymbol(ram, circuit.logicalCircuitId, 10, 4, "up", "sym-ram");
      circuit.circuitSymbols.push(ramSym);

      const addr = addPinSymbol(circuit, "p-addr", "input", "addr", 2, 0, 2, 0);
      const addr2 = addPinSymbol(circuit, "p-addr2", "input", "addr2", 2, 0, 6, 1);
      const din = addPinSymbol(circuit, "p-din", "input", "din", 8, 0, 10, 2);
      const we = addPinSymbol(circuit, "p-we", "input", "we", 1, 10, 14, 3);
      const dout = addPinSymbol(circuit, "p-dout", "output", "dout", 8, 20, 2, 4);
      const dout2 = addPinSymbol(circuit, "p-dout2", "output", "dout2", 8, 20, 6, 5);

      const jamBySuffix = (suffix: string) => ramSym.jams.find((j) => j.pin.pinId.endsWith(suffix))!;

      circuit.wires.push(
        makeWire("wm1", circuit.logicalCircuitId, addr.jams[0]!.absolutePoint, jamBySuffix("-addr").absolutePoint),
        makeWire("wm2", circuit.logicalCircuitId, addr2.jams[0]!.absolutePoint, jamBySuffix("-addr2").absolutePoint),
        makeWire("wm3", circuit.logicalCircuitId, din.jams[0]!.absolutePoint, jamBySuffix("-data-in").absolutePoint),
        makeWire("wm4", circuit.logicalCircuitId, we.jams[0]!.absolutePoint, jamBySuffix("-write").absolutePoint),
        makeWire("wm5", circuit.logicalCircuitId, jamBySuffix("-data-out").absolutePoint, dout.jams[0]!.absolutePoint),
        makeWire("wm6", circuit.logicalCircuitId, jamBySuffix("-data-out2").absolutePoint, dout2.jams[0]!.absolutePoint),
      );

      const svRes = exportVerilog(project, circuit, { scope: "current", exportTests: false });
      expect(svRes.hasErrors).toBe(false);
      const svText = svRes.files[0]!.content;
      expect(svText).toContain("module MemUnit_RAM_10x4(");
      expect(svText).toContain("memory[0] = 170;");
      expect(svText).toContain("memory[1] = 85;");
      expect(svText).toContain("always @(posedge write)");
      expect(svText).toContain("assign dataOut2 = memory[address2];");

      const vhdlRes = exportVhdl(project, circuit, { scope: "current", exportTests: false });
      expect(vhdlRes.hasErrors).toBe(false);
      const vhdlText = vhdlRes.files[0]!.content;
      expect(vhdlText).toContain("entity MemUnit_RAM_10x4 is");
      expect(vhdlText).toContain("\"10101010\"");
      expect(vhdlText).toContain("\"01010101\"");
      expect(vhdlText).toContain("if rising_edge(write) then");
      expect(vhdlText).toContain("dataOut2 <= memory(to_integer(unsigned(address2)));");
    });
  });
});
