import { describe, expect, it } from "vitest";

import type GridPoint from "../types/canvas/gridPoint";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Wire from "../types/circuit/wire";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../types/simulation/state";
import TruthState from "../types/simulation/truthState";

import CircuitMap from "../simulation/compiler/circuitMap";
import CircuitTestSocket, {
  analyzeCombinationalPurity,
  isTestable,
} from "../simulation/truthTable/circuitTestSocket";
import ExpressionParser from "../simulation/truthTable/expressionParser";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createGraphicsArray,
  createMemory,
  createPinCircuit,
  createSensor,
} from "../utils/circuitLayout";

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

function addPinSymbolToCircuit(
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

function createWireCircuit(): LogicalCircuit {
  const circuit = createDefaultLogicalCircuit("lc-wire", "1 Bit Wire");
  const inSym = addPinSymbolToCircuit(circuit, "pin-x", "input", "x", 1, 0, 2, 0);
  const outSym = addPinSymbolToCircuit(circuit, "pin-q", "output", "q", 1, 10, 2, 1);
  circuit.wires.push(
    makeWire("w-1", circuit.logicalCircuitId, inSym.jams[0]!.absolutePoint, outSym.jams[0]!.absolutePoint),
  );
  return circuit;
}

function createAndGateCircuit(): LogicalCircuit {
  const circuit = createDefaultLogicalCircuit("lc-and", "1 bit 2 entry AND");
  const pinA = addPinSymbolToCircuit(circuit, "pin-a", "input", "a", 1, 0, 0, 0);
  const pinB = addPinSymbolToCircuit(circuit, "pin-b", "input", "b", 1, 0, 4, 1);
  const andGate = createGate("and", 2, false);
  const andSym = createCircuitSymbol(andGate, circuit.logicalCircuitId, 8, 2, "up", "sym-and");
  circuit.circuitSymbols.push(andSym);
  const pinQ = addPinSymbolToCircuit(circuit, "pin-q", "output", "q", 1, 16, 2, 2);

  circuit.wires.push(
    makeWire("w-a", circuit.logicalCircuitId, pinA.jams[0]!.absolutePoint, andSym.jams[0]!.absolutePoint),
    makeWire("w-b", circuit.logicalCircuitId, pinB.jams[0]!.absolutePoint, andSym.jams[1]!.absolutePoint),
    makeWire("w-q", circuit.logicalCircuitId, andSym.jams[2]!.absolutePoint, pinQ.jams[0]!.absolutePoint),
  );
  return circuit;
}

function createFullAdderCircuit(): LogicalCircuit {
  const circuit = createDefaultLogicalCircuit("lc-fa", "1 bit full adder");
  const inC = addPinSymbolToCircuit(circuit, "pin-inc", "input", "inC", 1, 0, 0, 0);
  const a = addPinSymbolToCircuit(circuit, "pin-a", "input", "a", 1, 0, 4, 1);
  const b = addPinSymbolToCircuit(circuit, "pin-b", "input", "b", 1, 0, 8, 2);

  const xor1 = createCircuitSymbol(createGate("xor", 2, false), circuit.logicalCircuitId, 6, 4, "up", "xor1");
  const xor2 = createCircuitSymbol(createGate("xor", 2, false), circuit.logicalCircuitId, 14, 2, "up", "xor2");
  const and1 = createCircuitSymbol(createGate("and", 2, false), circuit.logicalCircuitId, 6, 10, "up", "and1");
  const and2 = createCircuitSymbol(createGate("and", 2, false), circuit.logicalCircuitId, 14, 8, "up", "and2");
  const or1 = createCircuitSymbol(createGate("or", 2, false), circuit.logicalCircuitId, 22, 9, "up", "or1");

  circuit.circuitSymbols.push(xor1, xor2, and1, and2, or1);

  const outC = addPinSymbolToCircuit(circuit, "pin-outc", "output", "outC", 1, 28, 9, 3);
  const s = addPinSymbolToCircuit(circuit, "pin-s", "output", "s", 1, 28, 2, 4);

  const pInC = inC.jams[0]!.absolutePoint;
  const pA = a.jams[0]!.absolutePoint;
  const pB = b.jams[0]!.absolutePoint;

  circuit.wires.push(
    makeWire("w-1", circuit.logicalCircuitId, pA, xor1.jams[0]!.absolutePoint),
    makeWire("w-2", circuit.logicalCircuitId, pB, xor1.jams[1]!.absolutePoint),
    makeWire("w-3", circuit.logicalCircuitId, pA, and1.jams[0]!.absolutePoint),
    makeWire("w-4", circuit.logicalCircuitId, pB, and1.jams[1]!.absolutePoint),
    makeWire("w-5", circuit.logicalCircuitId, pInC, xor2.jams[0]!.absolutePoint),
    makeWire("w-6", circuit.logicalCircuitId, xor1.jams[2]!.absolutePoint, xor2.jams[1]!.absolutePoint),
    makeWire("w-7", circuit.logicalCircuitId, pInC, and2.jams[0]!.absolutePoint),
    makeWire("w-8", circuit.logicalCircuitId, xor1.jams[2]!.absolutePoint, and2.jams[1]!.absolutePoint),
    makeWire("w-9", circuit.logicalCircuitId, and2.jams[2]!.absolutePoint, or1.jams[0]!.absolutePoint),
    makeWire("w-10", circuit.logicalCircuitId, and1.jams[2]!.absolutePoint, or1.jams[1]!.absolutePoint),
    makeWire("w-11", circuit.logicalCircuitId, xor2.jams[2]!.absolutePoint, s.jams[0]!.absolutePoint),
    makeWire("w-12", circuit.logicalCircuitId, or1.jams[2]!.absolutePoint, outC.jams[0]!.absolutePoint),
  );
  return circuit;
}

function createTriStateBufferCircuit(): LogicalCircuit {
  const circuit = createDefaultLogicalCircuit("lc-tri", "TriState Buffer");
  const d = addPinSymbolToCircuit(circuit, "pin-d", "input", "d", 1, 0, 2, 0);
  const en = addPinSymbolToCircuit(circuit, "pin-en", "input", "en", 1, 0, 8, 1);
  const triSym = createCircuitSymbol(
    createGate("triState1", 2, false),
    circuit.logicalCircuitId,
    8,
    2,
    "up",
    "tri-1",
  );
  circuit.circuitSymbols.push(triSym);
  const q = addPinSymbolToCircuit(circuit, "pin-q", "output", "q", 1, 16, 2, 2);

  circuit.wires.push(
    makeWire("w-1", circuit.logicalCircuitId, d.jams[0]!.absolutePoint, triSym.jams[0]!.absolutePoint),
    makeWire("w-2", circuit.logicalCircuitId, en.jams[0]!.absolutePoint, triSym.jams[1]!.absolutePoint),
    makeWire("w-3", circuit.logicalCircuitId, triSym.jams[2]!.absolutePoint, q.jams[0]!.absolutePoint),
  );
  return circuit;
}

function createCaseSensitiveAdderSocketCircuit(): LogicalCircuit {
  const circuit = createDefaultLogicalCircuit("lc-vars", "4 bit adder");
  const c = addPinSymbolToCircuit(circuit, "pin-c", "input", "c", 1, 0, 0, 0);
  const x1 = addPinSymbolToCircuit(circuit, "pin-x1", "input", "variant", 4, 0, 4, 1);
  const x2 = addPinSymbolToCircuit(circuit, "pin-x2", "input", "vaRIAnt", 4, 0, 8, 2);
  const s = addPinSymbolToCircuit(circuit, "pin-s", "output", "VAriaNT", 4, 10, 4, 3);
  const cOut = addPinSymbolToCircuit(circuit, "pin-cout", "output", "VARIANT", 1, 10, 8, 4);
  const quoted = addPinSymbolToCircuit(circuit, "pin-qtick", "output", "c'", 1, 10, 12, 5);

  circuit.wires.push(
    makeWire("w-1", circuit.logicalCircuitId, c.jams[0]!.absolutePoint, cOut.jams[0]!.absolutePoint),
    makeWire("w-2", circuit.logicalCircuitId, x1.jams[0]!.absolutePoint, s.jams[0]!.absolutePoint),
    makeWire("w-3", circuit.logicalCircuitId, x2.jams[0]!.absolutePoint, x2.jams[0]!.absolutePoint),
    makeWire("w-4", circuit.logicalCircuitId, c.jams[0]!.absolutePoint, quoted.jams[0]!.absolutePoint),
  );
  // x2 mit einem Dummy-Output verbinden, damit CleanUp x2 nicht entfernt
  const x2Copy = addPinSymbolToCircuit(circuit, "pin-x2-out", "output", "x2Out", 4, 10, 16, 6);
  circuit.wires.push(
    makeWire("w-5", circuit.logicalCircuitId, x2.jams[0]!.absolutePoint, x2Copy.jams[0]!.absolutePoint),
  );
  return circuit;
}

describe("T-071: TruthTable-Engine (CircuitTestSocket) & Kombinatorik-Analyse", () => {
  it("erkennt testbare und nicht testbare Schaltungen über isTestable", () => {
    const empty = createDefaultLogicalCircuit("lc-empty", "No Input Output");
    expect(isTestable(empty)).toBe(false);
    expect(isTestable(null)).toBe(false);

    const onlyIn = createDefaultLogicalCircuit("lc-in", "Only Input");
    addPinSymbolToCircuit(onlyIn, "p-in", "input", "x", 1, 0, 0);
    expect(isTestable(onlyIn)).toBe(false);

    const onlyOut = createDefaultLogicalCircuit("lc-out", "Only Output");
    addPinSymbolToCircuit(onlyOut, "p-out", "output", "q", 1, 6, 0);
    expect(isTestable(onlyOut)).toBe(false);

    const unconnected = createDefaultLogicalCircuit("lc-unconn", "Unconnected");
    addPinSymbolToCircuit(unconnected, "p-in", "input", "x", 1, 0, 0);
    addPinSymbolToCircuit(unconnected, "p-out", "output", "q", 1, 8, 0);
    expect(isTestable(unconnected)).toBe(true);

    expect(isTestable(createWireCircuit())).toBe(true);
    expect(isTestable(createAndGateCircuit())).toBe(true);
    expect(isTestable(createFullAdderCircuit())).toBe(true);
  });

  it("filtert unverbundene Pins durch CleanUp aus und prüft 1-Bit-Leitung sowie AND-Gatter", () => {
    const unconnected = createDefaultLogicalCircuit("lc-unconn", "Unconnected");
    addPinSymbolToCircuit(unconnected, "p-in", "input", "x", 1, 0, 0);
    addPinSymbolToCircuit(unconnected, "p-out", "output", "q", 1, 8, 0);
    const emptySocket = new CircuitTestSocket(unconnected);
    expect(emptySocket.inputs).toHaveLength(0);
    expect(emptySocket.outputs).toHaveLength(0);
    expect(emptySocket.buildTruthTable()).toEqual({
      rows: [],
      truncated: false,
      oscillation: false,
    });

    const wireSocket = new CircuitTestSocket(createWireCircuit());
    expect(wireSocket.inputs).toHaveLength(1);
    expect(wireSocket.outputs).toHaveLength(1);
    expect(wireSocket.inputBitCount).toBe(1);

    let lastProgress = -1;
    const wireTable = wireSocket.buildTruthTable({
      reportProgress: (p) => {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(100);
        lastProgress = p;
      },
    });
    expect(lastProgress).toBe(100);
    expect(wireTable.truncated).toBe(false);
    expect(wireTable.oscillation).toBe(false);
    expect(wireTable.rows).toHaveLength(2);
    expect(wireTable.rows?.[0]?.input[0]).toBe(0);
    expect(wireTable.rows?.[0]?.output?.[0]).toBe(0);
    expect(wireTable.rows?.[1]?.input[0]).toBe(1);
    expect(wireTable.rows?.[1]?.output?.[0]).toBe(1);

    // Wiederholte Auswertung auf demselben Socket mit invertiertem Prädikat (Gegenbeispiele)
    const wireParser = new ExpressionParser(wireSocket);
    const wireMismatch = wireParser.parse("q=x", true)!;
    const wireFiltered = wireSocket.buildTruthTable({ include: wireMismatch });
    expect(wireFiltered.rows).toHaveLength(0);

    const andSocket = new CircuitTestSocket(createAndGateCircuit());
    const andResult = andSocket.buildTruthTable();
    expect(andResult.rows).toHaveLength(4);
    expect(andResult.rows?.map((r) => [...r.input, r.output?.[0]])).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [1, 1, 1],
    ]);

    const andParser = new ExpressionParser(andSocket);
    const andMismatch = andSocket.buildTruthTable({
      include: andParser.parse("q=a&b", true),
    });
    expect(andMismatch.rows).toHaveLength(0);
  });

  it("verifiziert den 1-Bit-Volladdierer über outC << 1 | s = inC + a + b", () => {
    const socket = new CircuitTestSocket(createFullAdderCircuit());
    expect(socket.inputs).toHaveLength(3);
    expect(socket.outputs).toHaveLength(2);
    expect(socket.inputBitCount).toBe(3);

    const parser = new ExpressionParser(socket);
    const mismatchPredicate = parser.parse("outC << 1 | s = inC + a + b", true);
    expect(mismatchPredicate).not.toBeNull();

    const fullTable = socket.buildTruthTable();
    expect(fullTable.truncated).toBe(false);
    expect(fullTable.oscillation).toBe(false);
    expect(fullTable.rows).toHaveLength(8);
    for (const row of fullTable.rows!) {
      expect(mismatchPredicate!(row)).toBe(false);
    }

    const errors = socket.buildTruthTable({ include: mismatchPredicate, maxCount: 1 });
    expect(errors.rows).toHaveLength(0);
    expect(errors.truncated).toBe(false);
  });

  it("unterstützt maxCount-Begrenzung, keepGoing-Abbruch, Tri-State-Z und Oszillationserkennung", () => {
    // Breiter 9-Bit-Bus (512 Zeilen) mit Begrenzung auf 16 Zeilen und frühem Abbruch
    const wideCircuit = createDefaultLogicalCircuit("lc-wide", "Wide Bus");
    const a = addPinSymbolToCircuit(wideCircuit, "p-a", "input", "a", 5, 0, 0, 0);
    const b = addPinSymbolToCircuit(wideCircuit, "p-b", "input", "b", 4, 0, 4, 1);
    const qA = addPinSymbolToCircuit(wideCircuit, "p-qa", "output", "qa", 5, 10, 0, 2);
    const qB = addPinSymbolToCircuit(wideCircuit, "p-qb", "output", "qb", 4, 10, 4, 3);
    wideCircuit.wires.push(
      makeWire("w-1", wideCircuit.logicalCircuitId, a.jams[0]!.absolutePoint, qA.jams[0]!.absolutePoint),
      makeWire("w-2", wideCircuit.logicalCircuitId, b.jams[0]!.absolutePoint, qB.jams[0]!.absolutePoint),
    );

    const wideSocket = new CircuitTestSocket(wideCircuit);
    const maxLimited = wideSocket.buildTruthTable({ maxCount: 16 });
    expect(maxLimited.truncated).toBe(true);
    expect(maxLimited.oscillation).toBe(false);
    expect(maxLimited.rows).toHaveLength(16);

    let checks = 0;
    const cancelled = wideSocket.buildTruthTable({
      keepGoing: () => {
        checks++;
        return checks <= 5;
      },
    });
    expect(cancelled.truncated).toBe(true);
    expect(cancelled.rows).toHaveLength(5);

    // Tri-State-Ausgang liefert hochohmiges 'z' (STATE_OFF) und wird auch bei Filter-Prädikat beibehalten
    const triSocket = new CircuitTestSocket(createTriStateBufferCircuit());
    const triParser = new ExpressionParser(triSocket);
    const triFiltered = triSocket.buildTruthTable({
      include: triParser.parse("q=d", true),
    });
    // d=0,en=0 sowie d=1,en=0 liefern Tri-State Off ('z'), en=1-Zeilen erfüllen q=d und entfallen
    expect(triFiltered.rows).toHaveLength(2);
    expect(triFiltered.rows?.[0]?.output).toBeNull();
    expect(triFiltered.rows?.[0]?.formatOutput(0)).toBe("z");
    expect(triFiltered.rows?.[0]?.rawStates[0]).toEqual([STATE_OFF]);

    // Oszillierender Ring aus einem rückgekoppelten NOT-Gatter (über AND-Enable steuerbar)
    const oscCircuit = createDefaultLogicalCircuit("lc-osc", "Oscillator");
    const enPin = addPinSymbolToCircuit(oscCircuit, "p-en", "input", "en", 1, 0, 0, 0);
    const andSym = createCircuitSymbol(createGate("and", 2, false), oscCircuit.logicalCircuitId, 6, 2, "up", "and-osc");
    const notSym = createCircuitSymbol(createGate("not", 1, true), oscCircuit.logicalCircuitId, 12, 2, "up", "not-osc");
    oscCircuit.circuitSymbols.push(andSym, notSym);
    const outPin = addPinSymbolToCircuit(oscCircuit, "p-out", "output", "q", 1, 18, 2, 1);

    oscCircuit.wires.push(
      makeWire("w-1", oscCircuit.logicalCircuitId, enPin.jams[0]!.absolutePoint, andSym.jams[0]!.absolutePoint),
      makeWire("w-2", oscCircuit.logicalCircuitId, andSym.jams[2]!.absolutePoint, notSym.jams[0]!.absolutePoint),
      makeWire("w-3", oscCircuit.logicalCircuitId, notSym.jams[1]!.absolutePoint, andSym.jams[1]!.absolutePoint),
      makeWire("w-4", oscCircuit.logicalCircuitId, notSym.jams[1]!.absolutePoint, outPin.jams[0]!.absolutePoint),
    );

    const oscSocket = new CircuitTestSocket(oscCircuit);
    expect(oscSocket.analyzeCombinationalPurity().hasFeedbackLoops).toBe(true);
    const oscResult = oscSocket.buildTruthTable();
    expect(oscResult.oscillation).toBe(true);
    expect(oscResult.rows).toBeNull();
  });

  it("unterscheidet rein kombinatorische Schaltungen (inkl. ROM) von Schleifen und zustandsbehafteten Bausteinen", () => {
    const andPurity = new CircuitTestSocket(createAndGateCircuit()).analyzeCombinationalPurity();
    expect(andPurity.isPurelyCombinational).toBe(true);
    expect(andPurity.hasFeedbackLoops).toBe(false);
    expect(andPurity.hasStatefulComponents).toBe(false);
    expect(andPurity.reasons).toEqual([]);

    // Reines ROM ohne Schleife gilt als deterministisch und rein kombinatorisch
    const romCircuit = createDefaultLogicalCircuit("lc-rom", "ROM Lookup");
    const addrIn = addPinSymbolToCircuit(romCircuit, "p-addr", "input", "A", 2, 0, 2, 0);
    const rom = createMemory("rom-1", false, 2, 4, { onStart: "data", data: "1,2,4,8" });
    const romSym = createCircuitSymbol(rom, romCircuit.logicalCircuitId, 6, 2, "up", "sym-rom");
    romCircuit.circuitSymbols.push(romSym);
    const dataOut = addPinSymbolToCircuit(romCircuit, "p-data", "output", "D", 4, 14, 2, 1);
    romCircuit.wires.push(
      makeWire("w-1", romCircuit.logicalCircuitId, addrIn.jams[0]!.absolutePoint, romSym.jams[0]!.absolutePoint),
      makeWire("w-2", romCircuit.logicalCircuitId, romSym.jams[1]!.absolutePoint, dataOut.jams[0]!.absolutePoint),
    );
    const romPurity = new CircuitTestSocket(romCircuit).analyzeCombinationalPurity();
    expect(romPurity.isPurelyCombinational).toBe(true);

    // Kreuzgekoppeltes NOR-Flip-Flop (RS-Latch) => Rückkopplungsschleife
    const latchCircuit = createDefaultLogicalCircuit("lc-latch", "NOR Latch");
    const setPin = addPinSymbolToCircuit(latchCircuit, "p-s", "input", "S", 1, 0, 0, 0);
    const resetPin = addPinSymbolToCircuit(latchCircuit, "p-r", "input", "R", 1, 0, 10, 1);
    const norTop = createCircuitSymbol(createGate("or", 2, true), latchCircuit.logicalCircuitId, 6, 2, "up", "nor-top");
    const norBot = createCircuitSymbol(createGate("or", 2, true), latchCircuit.logicalCircuitId, 6, 8, "up", "nor-bot");
    latchCircuit.circuitSymbols.push(norTop, norBot);
    const qOut = addPinSymbolToCircuit(latchCircuit, "p-q", "output", "Q", 1, 14, 2, 2);
    latchCircuit.wires.push(
      makeWire("w-s", latchCircuit.logicalCircuitId, setPin.jams[0]!.absolutePoint, norTop.jams[0]!.absolutePoint),
      makeWire("w-r", latchCircuit.logicalCircuitId, resetPin.jams[0]!.absolutePoint, norBot.jams[1]!.absolutePoint),
      makeWire("w-fb1", latchCircuit.logicalCircuitId, norTop.jams[2]!.absolutePoint, norBot.jams[0]!.absolutePoint),
      makeWire("w-fb2", latchCircuit.logicalCircuitId, norBot.jams[2]!.absolutePoint, norTop.jams[1]!.absolutePoint),
      makeWire("w-q", latchCircuit.logicalCircuitId, norTop.jams[2]!.absolutePoint, qOut.jams[0]!.absolutePoint),
    );
    const latchPurity = new CircuitTestSocket(latchCircuit).analyzeCombinationalPurity();
    expect(latchPurity.isPurelyCombinational).toBe(false);
    expect(latchPurity.hasFeedbackLoops).toBe(true);
    expect(latchPurity.reasons.some((r) => r.kind === "feedbackLoop")).toBe(true);

    // RAM-Schaltung => zustandsbehaftet (reason kind "ram")
    const ramCircuit = createDefaultLogicalCircuit("lc-ram", "RAM Circuit");
    const ramAddr = addPinSymbolToCircuit(ramCircuit, "p-ra", "input", "A", 2, 0, 0, 0);
    const ramDin = addPinSymbolToCircuit(ramCircuit, "p-rd", "input", "Din", 4, 0, 4, 1);
    const ramWr = addPinSymbolToCircuit(ramCircuit, "p-rw", "input", "W", 1, 0, 8, 2);
    const ram = createMemory("ram-1", true, 2, 4, { onStart: "zeros" });
    const ramSym = createCircuitSymbol(ram, ramCircuit.logicalCircuitId, 8, 2, "up", "sym-ram");
    ramCircuit.circuitSymbols.push(ramSym);
    const ramDout = addPinSymbolToCircuit(ramCircuit, "p-ro", "output", "Dout", 4, 16, 2, 3);
    ramCircuit.wires.push(
      makeWire("w-1", ramCircuit.logicalCircuitId, ramAddr.jams[0]!.absolutePoint, ramSym.jams[0]!.absolutePoint),
      makeWire("w-2", ramCircuit.logicalCircuitId, ramDin.jams[0]!.absolutePoint, ramSym.jams[2]!.absolutePoint),
      makeWire("w-3", ramCircuit.logicalCircuitId, ramWr.jams[0]!.absolutePoint, ramSym.jams[3]!.absolutePoint),
      makeWire("w-4", ramCircuit.logicalCircuitId, ramSym.jams[1]!.absolutePoint, ramDout.jams[0]!.absolutePoint),
    );
    const ramPurity = new CircuitTestSocket(ramCircuit).analyzeCombinationalPurity();
    expect(ramPurity.isPurelyCombinational).toBe(false);
    expect(ramPurity.hasStatefulComponents).toBe(true);
    expect(ramPurity.reasons.some((r) => r.kind === "ram")).toBe(true);

    // Clock, Button, Sensor und GraphicsArray => jeweils als nicht-kombinatorisch erkannt
    const project = createEmptyCircuitProject();
    const statefulCircuit = project.logicalCircuits[0]!;
    const clkSym = createCircuitSymbol(
      createGate("clock", 0, false),
      statefulCircuit.logicalCircuitId,
      0,
      0,
      "up",
      "clk-1",
    );
    const btnSym = createCircuitSymbol(
      createCircuitButton("btn-1", "B"),
      statefulCircuit.logicalCircuitId,
      0,
      4,
      "up",
      "btn-s",
    );
    const snsSym = createCircuitSymbol(
      createSensor("sns-1", "random", 4),
      statefulCircuit.logicalCircuitId,
      0,
      8,
      "up",
      "sns-s",
    );
    const ga = createGraphicsArray("ga-1", { width: 8, height: 8, dataBitWidth: 4, bitsPerPixel: 1 });
    const gaSym = createCircuitSymbol(ga, statefulCircuit.logicalCircuitId, 8, 12, "up", "ga-s");
    const addrBits = ga.pins[0]!.bitWidth;
    const gaAddrIn = createCircuitSymbol(
      createConstant("ga-a-const", addrBits, 0),
      statefulCircuit.logicalCircuitId,
      0,
      12,
      "up",
      "ga-a",
    );
    const gaDataIn = createCircuitSymbol(
      createConstant("ga-d-const", 4, 0),
      statefulCircuit.logicalCircuitId,
      0,
      14,
      "up",
      "ga-d",
    );
    const gaWrIn = createCircuitSymbol(
      createConstant("ga-w-const", 1, 0),
      statefulCircuit.logicalCircuitId,
      0,
      16,
      "up",
      "ga-w",
    );
    const prb1 = createCircuitSymbol(createCircuitProbe("p1", "P1"), statefulCircuit.logicalCircuitId, 6, 0, "up", "prb-1");
    const prb2 = createCircuitSymbol(createCircuitProbe("p2", "P2"), statefulCircuit.logicalCircuitId, 6, 4, "up", "prb-2");
    const prb3 = createCircuitSymbol(createCircuitProbe("p3", "P3"), statefulCircuit.logicalCircuitId, 6, 8, "up", "prb-3");

    statefulCircuit.circuitSymbols.push(
      clkSym,
      btnSym,
      snsSym,
      gaSym,
      gaAddrIn,
      gaDataIn,
      gaWrIn,
      prb1,
      prb2,
      prb3,
    );
    statefulCircuit.wires.push(
      makeWire("ws-1", statefulCircuit.logicalCircuitId, clkSym.jams[0]!.absolutePoint, prb1.jams[0]!.absolutePoint),
      makeWire("ws-2", statefulCircuit.logicalCircuitId, btnSym.jams[0]!.absolutePoint, prb2.jams[0]!.absolutePoint),
      makeWire("ws-3", statefulCircuit.logicalCircuitId, snsSym.jams[0]!.absolutePoint, prb3.jams[0]!.absolutePoint),
      makeWire("ws-4", statefulCircuit.logicalCircuitId, gaAddrIn.jams[0]!.absolutePoint, gaSym.jams[0]!.absolutePoint),
      makeWire("ws-5", statefulCircuit.logicalCircuitId, gaDataIn.jams[0]!.absolutePoint, gaSym.jams[2]!.absolutePoint),
      makeWire("ws-6", statefulCircuit.logicalCircuitId, gaWrIn.jams[0]!.absolutePoint, gaSym.jams[3]!.absolutePoint),
    );
    const compiledState = new CircuitMap(statefulCircuit).apply(1);
    const statefulPurity = analyzeCombinationalPurity(compiledState);
    expect(statefulPurity.isPurelyCombinational).toBe(false);
    expect(statefulPurity.hasStatefulComponents).toBe(true);
    expect(statefulPurity.reasons.map((r) => r.kind)).toEqual(
      expect.arrayContaining(["clock", "button", "sensor", "graphicsArray"]),
    );
  });

  it("prüft TruthState unpack(), Tri-State-Formatierung und Vergleichsmethoden", () => {
    const a = new TruthState(1, 1);
    a.input[0] = 5;
    a.rawStates[0] = [STATE_ON1, STATE_ON0, STATE_ON1];
    expect(a.unpack([3])).toBe(true);
    expect(a.output?.[0]).toBe(5);
    expect(a.formatInput(0)).toBe("5");
    expect(a.formatOutput(0)).toBe("5");

    const b = new TruthState(1, 1);
    b.input[0] = 5;
    b.rawStates[0] = [STATE_ON1, STATE_ON0, STATE_ON1];
    expect(b.unpack([3])).toBe(true);
    expect(TruthState.areEqual([a], [b])).toBe(true);

    const tri = new TruthState(1, 1);
    tri.rawStates[0] = [STATE_OFF, STATE_ON1];
    expect(tri.unpack([2])).toBe(false);
    expect(tri.output).toBeNull();
    expect(tri.formatOutput(0)).toBe("1z");
  });
});

describe("T-071: Filter-Expression-Parser (ExpressionParser)", () => {
  const assertValid = (parser: ExpressionParser, state: TruthState, expected: number, text: string) => {
    const fn = parser.parse(text);
    expect(fn, `Erwarteter gültiger Ausdruck: ${text} (Fehler: ${parser.errorText})`).not.toBeNull();
    expect(parser.errorCount).toBe(0);
    expect(fn!(state)).toBe(expected);
  };

  const assertInvalid = (parser: ExpressionParser, text: string) => {
    const fn = parser.parse(text);
    expect(fn, `Erwarteter Fehler für: ${text}`).toBeNull();
    expect(parser.errorCount).toBeGreaterThan(0);
    expect(parser.errorText.length).toBeGreaterThan(0);
  };

  it("parst Dezimal-, Binär-, Oktal-, Hex-Literale inklusive Trennzeichen und Überlaufprüfung", () => {
    const parser = new ExpressionParser(null);
    const state = new TruthState(0, 0);

    assertValid(parser, state, 0, "0");
    assertValid(parser, state, 123, "123");
    assertValid(parser, state, 1_000_000, "1_000'000");
    assertValid(parser, state, 2147483647, "2147483647");
    assertInvalid(parser, "12345678901");
    assertInvalid(parser, "2147483648");

    assertValid(parser, state, 0b0, "0b0");
    assertValid(parser, state, 0b10101100, "0B1010_11'00");
    assertValid(parser, state, 2147483647, "0b1111111111111111111111111111111");
    assertInvalid(parser, "0b10101010101010101010101010101010101010101");
    assertInvalid(parser, "0b102");

    assertValid(parser, state, 0o755, "0755");
    assertValid(parser, state, 2147483647, "017'777_777_777");
    assertInvalid(parser, "0123456701234");
    assertInvalid(parser, "012345678");

    assertValid(parser, state, 0xabcd, "0XaB_Cd");
    assertValid(parser, state, 0x7fffffff, "0x7fffffff");
    assertValid(parser, state, -2147483648, "0x80000000");
    assertInvalid(parser, "0x123456780");
  });

  it("wertet Blockkommentare, unäre und binäre Operatoren sowie exakte Grammatik-Präzedenz aus", () => {
    const parser = new ExpressionParser(null);
    const state = new TruthState(0, 0);

    assertValid(parser, state, 42, "/* Kommentar */ 40 /* innen */ + 2");
    assertInvalid(parser, "/* nicht geschlossen");

    assertValid(parser, state, -1, "-1");
    assertValid(parser, state, 3, "--3");
    assertValid(parser, state, 0, "!3");
    assertValid(parser, state, 1, "!0");
    assertValid(parser, state, -8, "~7");
    assertValid(parser, state, 6, "3 * (1 + 1)");
    assertInvalid(parser, "-");
    assertInvalid(parser, "!");
    assertInvalid(parser, "(3 + 2");

    // Präzedenzregeln aus TruthTableFilterParser.g4: Shift > & > ^ > | > * / % > + - > Compare > Equality > && > ||
    assertValid(parser, state, 9, "3 * 2 | 1");
    assertValid(parser, state, 36, "1 | 2 * 4 | 8");
    assertValid(parser, state, 4, "4 | 8 / 1 | 2");
    assertValid(parser, state, 2, "4 | 8 | 2 % 0b1 | 0b10");
    assertValid(parser, state, 7, "7 | 2 & 1");
    assertValid(parser, state, 6, "7 ^ 3 & 1");
    assertValid(parser, state, 0xfc, "0xFF & 0xFF << 2");
    assertValid(parser, state, 0, "7 >> -1");
    assertValid(parser, state, 3, "7 >> --1");
    assertValid(parser, state, 0, "3 = 3 + 1");
    assertValid(parser, state, 1, "-1 <> 1");
    assertValid(parser, state, 1, "3 < 3 + 10");
    assertValid(parser, state, 0, "0 || 3 && 0");
    assertValid(parser, state, 1, "2 || 3 && 0");
    assertValid(parser, state, 0, "1 && 3 == 0");

    // Prädikat-Modus (inverted = true vs false)
    expect(parser.parse("5 - 5", true)!(state)).toBe(true);
    expect(parser.parse("1", true)!(state)).toBe(false);
    expect(parser.parse("5 - 5", false)!(state)).toBe(false);
    expect(parser.parse("10", false)!(state)).toBe(true);
  });

  it("löst Pins case-sensitiv sowie in Anführungszeichen auf und prüft alle Hilfsfunktionen samt Fehlerfällen", () => {
    const circuit = createCaseSensitiveAdderSocketCircuit();
    const socket = new CircuitTestSocket(circuit);
    const parser = new ExpressionParser(socket);

    const state = new TruthState(socket.inputs.length, socket.outputs.length);
    const inputIdx = (name: string) => socket.inputs.findIndex((i) => i.pin.name === name);
    const outputIdx = (name: string) => socket.outputs.findIndex((o) => o.pin.name === name);

    state.shortcut();
    state.input[inputIdx("c")] = 1;
    state.input[inputIdx("variant")] = 5;
    state.input[inputIdx("vaRIAnt")] = 4;
    state.output![outputIdx("VAriaNT")] = 9;
    state.output![outputIdx("VARIANT")] = 1;
    state.output![outputIdx("c'")] = 1;

    assertValid(parser, state, 1, "c");
    assertValid(parser, state, 5, "variant");
    assertValid(parser, state, 4, "vaRIAnt");
    assertValid(parser, state, 9, "VAriaNT");
    assertValid(parser, state, 1, "VARIANT");
    assertValid(parser, state, 1, "\"c'\"");

    assertInvalid(parser, "d");
    assertInvalid(parser, "\"c'");
    assertInvalid(parser, "\"c'\\");
    assertInvalid(parser, "\"c'\\\"\"");

    // Hilfsfunktionen ohne und mit Parametern sowie Parameter-Shadowing
    assertValid(parser, state, 2, "C:c+1 C");
    assertValid(parser, state, 10, "C:c+variant C+vaRIAnt");
    assertValid(parser, state, 26, "C:c+1 d:vaRIAnt+VAriaNT C*d");
    assertValid(parser, state, 4, "C(a):c+a C(3)");
    assertValid(parser, state, 8, "C(a,b):c+a+b C(3,4)");
    assertValid(parser, state, 9, "C(a,b):(c==0)*a+(c=1)*b C(3,VAriaNT)");
    assertValid(parser, state, 17, "a(b):c+b b(d):a(vaRIAnt)*d a(variant)+b(vaRIAnt)-VAriaNT");
    assertValid(parser, state, 12, "d:c+1 f(d):d*4 f(3)");
    assertValid(parser, state, 12, "f(d):d*4 d:c+1 f(3)");

    // Semantische Fehlerfälle
    assertInvalid(parser, "c:variant+1 c");
    assertInvalid(parser, "C:variant+1 C:vaRIAnt+1 C+2");
    assertInvalid(parser, "C(variant):c+variant C(2)");
    assertInvalid(parser, "C(x,x):c+x C(2,3)");
    assertInvalid(parser, "C(C):c+C C(2)");
    assertInvalid(parser, "C(x):c+x C");
    assertInvalid(parser, "C(x):x+C(x-1) C(3)");
    assertInvalid(parser, "C(x):x+4 C(3,1)");
    assertInvalid(parser, "C(x,y):x+y C(3)");
    assertInvalid(parser, "C(x,y):x+y D(3,4)");
  });
});
