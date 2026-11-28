import { describe, expect, it } from "vitest";

import type CircuitProject from "../types/circuit/circuitProject";
import type LogicalCircuit from "../types/circuit/logicalCircuit";

import i18n from "../i18n";
import CircuitTestSocket from "../simulation/truthTable/circuitTestSocket";
import CircuitRunner from "../simulation/worker/circuitRunner";
import {
  BUILT_IN_CIRCUIT_IDS,
  createBuiltInLibraryProject,
  duplicateBuiltInCircuitToLibrary,
  getBuiltInLibraryCircuits,
  getBuiltInLibraryItems,
  isBuiltInLibraryCircuitId,
} from "../utils/builtInLibraryCatalog";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createEmptyCircuitProject,
  createSplitter,
  getSymbolGridBoundingBox,
  rebuildImportedProjectLayout,
} from "../utils/circuitLayout";
import { parseCircuitLibraryDocument, serializeCircuitLibrary } from "../utils/libraryStorage";
import { createWire } from "../utils/wireUtils";

function runCombinationalTruthTable(
  circuit: LogicalCircuit,
  project: CircuitProject,
): { inputs: string[]; outputs: string[]; rows: Array<{ inVals: number[]; outVals: number[] }> } {
  const socket = new CircuitTestSocket(circuit, project);
  const res = socket.buildTruthTable();
  expect(res.oscillation).toBe(false);
  expect(res.rows).not.toBeNull();
  expect(res.rows!.length).toBeGreaterThan(0);

  return {
    inputs: socket.inputs.map((c) => c.pin.name),
    outputs: socket.outputs.map((c) => c.pin.name),
    rows: res.rows!.map((r) => ({
      inVals: [...r.input],
      outVals: [...(r.output ?? [])],
    })),
  };
}

function createSequentialTestHarness(
  builtInProject: CircuitProject,
  targetCircuitId: string,
  inputConfigs: Array<{ pinName: string; bitWidth?: number }>,
  outputPinNames: string[],
): {
  runner: CircuitRunner;
  setInput: (pinName: string, value: number) => void;
  setBitsInput: (pinName: string, value: number, bitWidth: number) => void;
  stepAndRead: () => Record<string, number>;
} {
  const harness = createEmptyCircuitProject("SeqTest", "Harness");
  const main = harness.logicalCircuits[0];

  // Alle Schaltungen aus dem Built-in-Katalog in das Testharness übernehmen
  for (const lc of builtInProject.logicalCircuits) {
    harness.logicalCircuits.push(lc);
    harness.circuits.set(lc.circuitId, lc);
  }
  for (const [id, c] of builtInProject.circuits.entries()) {
    harness.circuits.set(id, c);
  }
  for (const [id, g] of builtInProject.gates.entries()) {
    harness.gates.set(id, g);
  }
  harness.pins.push(...builtInProject.pins);
  harness.splitters.push(...builtInProject.splitters);
  harness.circuitSymbols.push(...builtInProject.circuitSymbols);
  harness.wires.push(...builtInProject.wires);

  const targetLc = builtInProject.logicalCircuits.find(
    (lc) => lc.logicalCircuitId === targetCircuitId,
  )!;
  const dutSym = createCircuitSymbol(targetLc, main.logicalCircuitId, 24, 10, "up");
  main.circuitSymbols.push(dutSym);
  harness.circuitSymbols.push(dutSym);

  const buttonIdsByPin = new Map<string, string[]>();
  const probeIdsByPin = new Map<string, string>();

  inputConfigs.forEach((cfg, idx) => {
    const dutJam = dutSym.jams.find((j) => j.pin.name === cfg.pinName)!;
    const width = cfg.bitWidth ?? 1;
    if (width === 1) {
      const btnId = crypto.randomUUID();
      const btn = createCircuitButton(btnId, cfg.pinName, false, "right");
      const btnSym = createCircuitSymbol(btn, main.logicalCircuitId, 2, 2 + idx * 4, "up");
      main.circuitSymbols.push(btnSym);
      harness.circuitSymbols.push(btnSym);
      harness.circuitButtons.push(btn);
      harness.circuits.set(btn.circuitId, btn);

      const midX = 10 + idx;
      const p1 = btnSym.jams[0].absolutePoint;
      const p2 = dutJam.absolutePoint;
      const w1 = createWire(main.logicalCircuitId, p1, { x: midX, y: p1.y });
      const w2 = createWire(main.logicalCircuitId, { x: midX, y: p1.y }, { x: midX, y: p2.y });
      const w3 = createWire(main.logicalCircuitId, { x: midX, y: p2.y }, p2);
      main.wires.push(w1, w2, w3);
      harness.wires.push(w1, w2, w3);
      buttonIdsByPin.set(cfg.pinName, [btnId]);
    } else {
      // Multi-Bit-Eingang über N Einzel-Buttons + Splitter zusammensetzen
      const splitter = createSplitter(crypto.randomUUID(), width, width, false);
      const splitSym = createCircuitSymbol(splitter, main.logicalCircuitId, 16, 20, "up");
      main.circuitSymbols.push(splitSym);
      harness.circuitSymbols.push(splitSym);
      harness.splitters.push(splitter);
      harness.circuits.set(splitter.circuitId, splitter);

      const bitBtns: string[] = [];
      for (let bit = 0; bit < width; bit += 1) {
        const btnId = crypto.randomUUID();
        const btn = createCircuitButton(btnId, `${cfg.pinName}${bit}`, false, "right");
        const btnSym = createCircuitSymbol(btn, main.logicalCircuitId, 2, 16 + bit * 4, "up");
        main.circuitSymbols.push(btnSym);
        harness.circuitSymbols.push(btnSym);
        harness.circuitButtons.push(btn);
        harness.circuits.set(btn.circuitId, btn);

        const p1 = btnSym.jams[0].absolutePoint;
        const p2 = splitSym.jams.find((j) => j.pin.name === String(bit))!.absolutePoint;
        const midX = 8 + bit;
        const w1 = createWire(main.logicalCircuitId, p1, { x: midX, y: p1.y });
        const w2 = createWire(main.logicalCircuitId, { x: midX, y: p1.y }, { x: midX, y: p2.y });
        const w3 = createWire(main.logicalCircuitId, { x: midX, y: p2.y }, p2);
        main.wires.push(w1, w2, w3);
        harness.wires.push(w1, w2, w3);
        bitBtns.push(btnId);
      }

      const busOut = splitSym.jams.find((j) => j.pin.name === "Bus")!.absolutePoint;
      const p2 = dutJam.absolutePoint;
      const wBus1 = createWire(main.logicalCircuitId, busOut, { x: 20, y: busOut.y });
      const wBus2 = createWire(main.logicalCircuitId, { x: 20, y: busOut.y }, { x: 20, y: p2.y });
      const wBus3 = createWire(main.logicalCircuitId, { x: 20, y: p2.y }, p2);
      main.wires.push(wBus1, wBus2, wBus3);
      harness.wires.push(wBus1, wBus2, wBus3);
      buttonIdsByPin.set(cfg.pinName, bitBtns);
    }
  });

  outputPinNames.forEach((pinName, idx) => {
    const dutJam = dutSym.jams.find((j) => j.pin.name === pinName)!;
    const probeId = crypto.randomUUID();
    const probe = createCircuitProbe(probeId, pinName, "left");
    const probeSym = createCircuitSymbol(probe, main.logicalCircuitId, 40, 2 + idx * 5, "up");
    main.circuitSymbols.push(probeSym);
    harness.circuitSymbols.push(probeSym);
    harness.circuitProbes.push(probe);
    harness.circuits.set(probe.circuitId, probe);

    const p1 = dutJam.absolutePoint;
    const p2 = probeSym.jams[0].absolutePoint;
    const midX = 34 + idx;
    const w1 = createWire(main.logicalCircuitId, p1, { x: midX, y: p1.y });
    const w2 = createWire(main.logicalCircuitId, { x: midX, y: p1.y }, { x: midX, y: p2.y });
    const w3 = createWire(main.logicalCircuitId, { x: midX, y: p2.y }, p2);
    main.wires.push(w1, w2, w3);
    harness.wires.push(w1, w2, w3);
    probeIdsByPin.set(pinName, probeId);
  });

  const rebuilt = rebuildImportedProjectLayout(harness);
  const runner = new CircuitRunner(rebuilt.logicalCircuits[0]);
  runner.start();

  return {
    runner,
    setInput: (pinName, value) => {
      const ids = buttonIdsByPin.get(pinName)!;
      runner.setButtonState(ids[0], value !== 0);
    },
    setBitsInput: (pinName, value, bitWidth) => {
      const ids = buttonIdsByPin.get(pinName)!;
      for (let bit = 0; bit < bitWidth; bit += 1) {
        runner.setButtonState(ids[bit], ((value >> bit) & 1) === 1);
      }
    },
    stepAndRead: () => {
      const stepResult = runner.step(1);
      expect(stepResult.oscillating).toBe(false);
      const out: Record<string, number> = {};
      for (const [pinName, probeId] of probeIdsByPin.entries()) {
        out[pinName] = stepResult.snapshot.probes[probeId]?.value ?? -1;
      }
      return out;
    },
  };
}

describe("T-082: Integrierte Standard-IC-Bibliothek", () => {
  it("stellt alle 9 Standard-ICs schreibgeschützt und gültig im Katalog bereit", () => {
    const items = getBuiltInLibraryItems();
    expect(items).toHaveLength(9);
    expect(items.every((item) => item.isBuiltIn === true)).toBe(true);
    expect(isBuiltInLibraryCircuitId(BUILT_IN_CIRCUIT_IDS.dFlipFlop)).toBe(true);
    expect(isBuiltInLibraryCircuitId("non-built-in")).toBe(false);

    const circuits = getBuiltInLibraryCircuits();
    const parsed = parseCircuitLibraryDocument(serializeCircuitLibrary(circuits));
    expect(parsed.logicalCircuits).toHaveLength(9);

    // Zweisprachigkeit prüfen
    const deNames = getBuiltInLibraryCircuits((key) => i18n.getFixedT("de")(key)).map((c) => c.name);
    const enNames = getBuiltInLibraryCircuits((key) => i18n.getFixedT("en")(key)).map((c) => c.name);
    expect(deNames).toContain("Halbaddierer");
    expect(enNames).toContain("Half Adder");
    expect(deNames).toContain("4-Bit-Register");
    expect(enNames).toContain("4-Bit Register");
  });

  it("verifiziert alle kombinatorischen Standard-ICs vollständig per CircuitTestSocket", () => {
    const project = createBuiltInLibraryProject();
    const byId = new Map(project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]));

    // Halbaddierer: S = A ^ B, C = A & B
    const ha = runCombinationalTruthTable(byId.get(BUILT_IN_CIRCUIT_IDS.halfAdder)!, project);
    expect(ha.inputs).toEqual(["A", "B"]);
    expect(ha.outputs).toEqual(["S", "C"]);
    for (const row of ha.rows) {
      const [a, b] = row.inVals;
      expect(row.outVals).toEqual([a ^ b, a & b]);
    }

    // Volladdierer: S = A ^ B ^ Cin, Cout = maj(A, B, Cin)
    const fa = runCombinationalTruthTable(byId.get(BUILT_IN_CIRCUIT_IDS.fullAdder)!, project);
    expect(fa.inputs).toEqual(["A", "B", "Cin"]);
    expect(fa.outputs).toEqual(["S", "Cout"]);
    for (const row of fa.rows) {
      const [a, b, cin] = row.inVals;
      const sum = a + b + cin;
      expect(row.outVals).toEqual([sum & 1, sum >> 1]);
    }

    // 2:1-Multiplexer
    const m2 = runCombinationalTruthTable(byId.get(BUILT_IN_CIRCUIT_IDS.mux2to1)!, project);
    expect(m2.inputs).toEqual(["D0", "D1", "S"]);
    expect(m2.outputs).toEqual(["Y"]);
    for (const row of m2.rows) {
      const [d0, d1, s] = row.inVals;
      expect(row.outVals).toEqual([s === 0 ? d0 : d1]);
    }

    // 4:1-Multiplexer (optimierte Gatter-Struktur mit gemeinsamem S0-Inverter)
    const m4 = runCombinationalTruthTable(byId.get(BUILT_IN_CIRCUIT_IDS.mux4to1)!, project);
    expect(m4.inputs).toEqual(["D0", "D1", "D2", "D3", "S0", "S1"]);
    expect(m4.outputs).toEqual(["Y"]);
    for (const row of m4.rows) {
      const [d0, d1, d2, d3, s0, s1] = row.inVals;
      const sel = (s1 << 1) | s0;
      const data = [d0, d1, d2, d3];
      expect(row.outVals).toEqual([data[sel]]);
    }

    // 2:4-Dekoder mit Enable
    const dec = runCombinationalTruthTable(byId.get(BUILT_IN_CIRCUIT_IDS.decoder2to4)!, project);
    expect(dec.inputs).toEqual(["A0", "A1", "EN"]);
    expect(dec.outputs).toEqual(["Y0", "Y1", "Y2", "Y3"]);
    for (const row of dec.rows) {
      const [a0, a1, en] = row.inVals;
      const idx = (a1 << 1) | a0;
      const expected = [0, 1, 2, 3].map((i) => (en === 1 && i === idx ? 1 : 0));
      expect(row.outVals).toEqual(expected);
    }
  });

  it("verifiziert SR-Latch, D-Flipflop, JK-Flipflop und 4-Bit-Register per CircuitRunner", () => {
    const project = createBuiltInLibraryProject();

    // SR-Latch: Setzen, Halten, Rücksetzen, Halten
    const sr = createSequentialTestHarness(
      project,
      BUILT_IN_CIRCUIT_IDS.srLatch,
      [{ pinName: "S" }, { pinName: "R" }],
      ["Q", "nQ"],
    );
    sr.setInput("S", 1);
    sr.setInput("R", 0);
    expect(sr.stepAndRead()).toEqual({ Q: 1, nQ: 0 });
    sr.setInput("S", 0);
    sr.setInput("R", 0);
    expect(sr.stepAndRead()).toEqual({ Q: 1, nQ: 0 });
    sr.setInput("S", 0);
    sr.setInput("R", 1);
    expect(sr.stepAndRead()).toEqual({ Q: 0, nQ: 1 });
    sr.setInput("S", 0);
    sr.setInput("R", 0);
    expect(sr.stepAndRead()).toEqual({ Q: 0, nQ: 1 });
    sr.runner.dispose();

    // D-Flipflop: Übernahme ausschließlich bei steigender Taktflanke (CLK 0 -> 1)
    const dff = createSequentialTestHarness(
      project,
      BUILT_IN_CIRCUIT_IDS.dFlipFlop,
      [{ pinName: "D" }, { pinName: "CLK" }],
      ["Q", "nQ"],
    );
    dff.setInput("D", 0);
    dff.setInput("CLK", 0);
    dff.stepAndRead();
    dff.setInput("CLK", 1);
    expect(dff.stepAndRead()).toEqual({ Q: 0, nQ: 1 });

    // Bei CLK=0 ändert D=1 noch nichts
    dff.setInput("CLK", 0);
    dff.setInput("D", 1);
    expect(dff.stepAndRead()).toEqual({ Q: 0, nQ: 1 });

    // Steigende Flanke übernimmt D=1
    dff.setInput("CLK", 1);
    expect(dff.stepAndRead()).toEqual({ Q: 1, nQ: 0 });

    // Während CLK=1 bleibt Q=1 trotz D=0
    dff.setInput("D", 0);
    expect(dff.stepAndRead()).toEqual({ Q: 1, nQ: 0 });
    dff.runner.dispose();

    // JK-Flipflop: Reset (0,1), Set (1,0), Hold (0,0), Toggle (1,1)
    const jk = createSequentialTestHarness(
      project,
      BUILT_IN_CIRCUIT_IDS.jkFlipFlop,
      [{ pinName: "J" }, { pinName: "K" }, { pinName: "CLK" }],
      ["Q", "nQ"],
    );
    const pulseJk = (j: number, k: number) => {
      jk.setInput("J", j);
      jk.setInput("K", k);
      jk.setInput("CLK", 0);
      jk.stepAndRead();
      jk.setInput("CLK", 1);
      return jk.stepAndRead();
    };
    expect(pulseJk(0, 1)).toEqual({ Q: 0, nQ: 1 });
    expect(pulseJk(1, 0)).toEqual({ Q: 1, nQ: 0 });
    expect(pulseJk(0, 0)).toEqual({ Q: 1, nQ: 0 });
    expect(pulseJk(1, 1)).toEqual({ Q: 0, nQ: 1 });
    expect(pulseJk(1, 1)).toEqual({ Q: 1, nQ: 0 });
    jk.runner.dispose();

    // Register (4-Bit): Laden bei LOAD=1 & steigender Flanke, Halten bei LOAD=0
    const reg = createSequentialTestHarness(
      project,
      BUILT_IN_CIRCUIT_IDS.register4Bit,
      [{ pinName: "D", bitWidth: 4 }, { pinName: "LOAD" }, { pinName: "CLK" }],
      ["Q"],
    );
    const pulseReg = (d: number, load: number) => {
      reg.setBitsInput("D", d, 4);
      reg.setInput("LOAD", load);
      reg.setInput("CLK", 0);
      reg.stepAndRead();
      reg.setInput("CLK", 1);
      return reg.stepAndRead();
    };
    expect(pulseReg(0b1010, 1)).toEqual({ Q: 0b1010 });
    expect(pulseReg(0b0101, 0)).toEqual({ Q: 0b1010 });
    expect(pulseReg(0b1100, 1)).toEqual({ Q: 0b1100 });
    reg.runner.dispose();
  });

  it("dupliziert Standard-ICs inklusive transitiver Sub-Schaltungen bearbeitbar in die persönliche Bibliothek", () => {
    const first = duplicateBuiltInCircuitToLibrary(BUILT_IN_CIRCUIT_IDS.register4Bit, []);
    // Register (4-Bit) benötigt 2:1-Mux und D-Flipflop
    expect(first.addedCircuits.map((c) => c.logicalCircuitId)).not.toContain(
      BUILT_IN_CIRCUIT_IDS.register4Bit,
    );
    expect(first.addedCircuits).toHaveLength(3);

    // Zweites Duplizieren (JK-Flipflop) nutzt bereits vorhandenes D-Flipflop per Struktur-Hash
    const second = duplicateBuiltInCircuitToLibrary(
      BUILT_IN_CIRCUIT_IDS.jkFlipFlop,
      first.logicalCircuits,
    );
    expect(second.reusedCircuitIds).toHaveLength(1);
    expect(second.addedCircuits).toHaveLength(1);
  });

  it("hat für alle 9 Standard-ICs keine kollinearen Leitungsüberlappungen oder unsegmentierten T-Treffer", () => {
    const project = createBuiltInLibraryProject();
    expect(project.logicalCircuits).toHaveLength(9);

    const segmentCrossesStrictBoxInterior = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      minX: number,
      minY: number,
      maxX: number,
      maxY: number,
    ): boolean => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      let t0 = 0;
      let t1 = 1;
      const checks: Array<[number, number]> = [
        [-dx, x1 - minX],
        [dx, maxX - x1],
        [-dy, y1 - minY],
        [dy, maxY - y1],
      ];
      for (const [p, q] of checks) {
        if (p === 0) {
          if (q <= 0) {
            return false;
          }
        } else {
          const r = q / p;
          if (p < 0) {
            if (r > t1) {
              return false;
            }
            if (r > t0) {
              t0 = r;
            }
          } else {
            if (r < t0) {
              return false;
            }
            if (r < t1) {
              t1 = r;
            }
          }
        }
      }
      return t1 - t0 > 1e-9;
    };

    const crossProduct = (
      pt: { x: number; y: number },
      seg: { x1: number; y1: number; x2: number; y2: number },
    ): number => (seg.x2 - seg.x1) * (pt.y - seg.y1) - (seg.y2 - seg.y1) * (pt.x - seg.x1);

    const isStrictlyInsideSegment = (
      pt: { x: number; y: number },
      seg: { x1: number; y1: number; x2: number; y2: number },
    ): boolean =>
      crossProduct(pt, seg) === 0 &&
      (pt.x - seg.x1) * (pt.x - seg.x2) + (pt.y - seg.y1) * (pt.y - seg.y2) < 0;

    for (const lc of project.logicalCircuits) {
      for (const wire of lc.wires) {
        const hasNonZeroLength = wire.x1 !== wire.x2 || wire.y1 !== wire.y2;
        expect(hasNonZeroLength, `${lc.name}: wire has zero length`).toBe(true);

        // Keine Leitung darf durch den Innenbereich eines Bauteilsymbols verlaufen
        for (const sym of lc.circuitSymbols) {
          const bounds = getSymbolGridBoundingBox(sym);
          const passesThroughInterior = segmentCrossesStrictBoxInterior(
            wire.x1,
            wire.y1,
            wire.x2,
            wire.y2,
            bounds.minX,
            bounds.minY,
            bounds.maxX,
            bounds.maxY,
          );
          expect(
            passesThroughInterior,
            `${lc.name}: wire (${wire.x1},${wire.y1})->(${wire.x2},${wire.y2}) crosses symbol ${sym.circuit.name} (${bounds.minX},${bounds.minY})`,
          ).toBe(false);
        }
      }

      for (let i = 0; i < lc.wires.length; i += 1) {
        const a = lc.wires[i];
        const useXAxis = a.x1 !== a.x2;

        for (let j = i + 1; j < lc.wires.length; j += 1) {
          const b = lc.wires[j];
          const isCollinear =
            crossProduct({ x: b.x1, y: b.y1 }, a) === 0 &&
            crossProduct({ x: b.x2, y: b.y2 }, a) === 0;

          if (isCollinear) {
            const aMin = useXAxis ? Math.min(a.x1, a.x2) : Math.min(a.y1, a.y2);
            const aMax = useXAxis ? Math.max(a.x1, a.x2) : Math.max(a.y1, a.y2);
            const bMin = useXAxis ? Math.min(b.x1, b.x2) : Math.min(b.y1, b.y2);
            const bMax = useXAxis ? Math.max(b.x1, b.x2) : Math.max(b.y1, b.y2);
            const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
            expect(
              overlap,
              `${lc.name}: collinear overlap between (${a.x1},${a.y1})->(${a.x2},${a.y2}) and (${b.x1},${b.y1})->(${b.x2},${b.y2})`,
            ).toBeLessThanOrEqual(0);
          }

          // Unsegmentierter T-Treffer: Endpunkt von b liegt echt im Inneren von a (oder umgekehrt)
          const bPts = [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }];
          for (const pt of bPts) {
            expect(
              isStrictlyInsideSegment(pt, a),
              `${lc.name}: endpoint (${pt.x},${pt.y}) hits interior of (${a.x1},${a.y1})->(${a.x2},${a.y2})`,
            ).toBe(false);
          }

          const aPts = [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }];
          for (const pt of aPts) {
            expect(
              isStrictlyInsideSegment(pt, b),
              `${lc.name}: endpoint (${pt.x},${pt.y}) hits interior of (${b.x1},${b.y1})->(${b.x2},${b.y2})`,
            ).toBe(false);
          }
        }
      }
    }
  });
});
