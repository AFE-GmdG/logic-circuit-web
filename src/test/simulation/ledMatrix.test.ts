import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import type GridPoint from "../../types/canvas/gridPoint";
import type Wire from "../../types/circuit/wire";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import FunctionAnd from "../../simulation/functions/gates/functionAnd";
import FunctionNot from "../../simulation/functions/gates/functionNot";
import FunctionConstant from "../../simulation/functions/io/functionConstant";
import {
  FunctionLedMatrixIndividual,
  FunctionLedMatrixSelector,
} from "../../simulation/functions/io/functionLedMatrix";
import FunctionProbe from "../../simulation/functions/io/functionProbe";
import OneBitConst from "../../simulation/functions/io/oneBitConst";
import CircuitState from "../../simulation/state/circuitState";
import CircuitRunner from "../../simulation/worker/circuitRunner";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createLedMatrix,
} from "../../utils/circuitLayout";
import {
  MODIFIER_ALT,
  MODIFIER_CONTROL,
  MODIFIER_SHIFT,
  formatKeyGesture,
  getKeyboardEventModifiers,
  isModifierOnlyKey,
  keyboardEventToWpfKeyCode,
  matchesKeyGesture,
} from "../../utils/keyGesture";

import PropertyDialog from "../../components/propertyDialog";

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

describe("T-045: LED-Matrix-Simulation, Probe-Format und Button-Shortcuts", () => {
  it("wertet FunctionLedMatrixIndividual inkl. Multi-Color-Bitmuster korrekt aus", () => {
    const state = new CircuitState();
    // 2x2 Matrix mit 2 Farbkanälen -> 2 * 2 * 2 = 8 Parameter
    const params = Array.from({ length: 8 }, () => state.reserveState());
    const sources = params.map((idx) => new OneBitConst(state, STATE_ON0, idx));

    const matrix = new FunctionLedMatrixIndividual(state, params, {
      matrixId: "mat-ind-unit",
      rows: 2,
      columns: 2,
      colors: 2,
      persistenceMultiplier: 1,
    });
    state.endDefinition();

    expect(state.evaluate(false)).toBe(true);
    expect(matrix.getCellValues()).toEqual([
      [0, 0],
      [0, 0],
    ]);

    // Zelle (0, 0) = Farbe 1 (Bit 0), Zelle (0, 1) = Farbe 2 (Bit 1), Zelle (1, 1) = Farbe 3 (Bits 0+1)
    sources[0].setState(STATE_ON1);
    sources[3].setState(STATE_ON1);
    sources[6].setState(STATE_ON1);
    sources[7].setState(STATE_ON1);

    expect(state.evaluate(false)).toBe(true);
    expect(matrix.getCellValues()).toEqual([
      [1, 2],
      [0, 3],
    ]);
  });

  it("steuert gemultiplexte FunctionLedMatrixSelector mit PersistenceMultiplier", () => {
    const state = new CircuitState();
    // 2x2 Matrix mit 1 Farbkanal: erst 2 Spalten-Eingänge, dann 2 Zeilen-Eingänge
    const col0 = state.reserveState();
    const col1 = state.reserveState();
    const row0 = state.reserveState();
    const row1 = state.reserveState();

    const srcCol0 = new OneBitConst(state, STATE_ON0, col0);
    const srcCol1 = new OneBitConst(state, STATE_ON0, col1);
    const srcRow0 = new OneBitConst(state, STATE_ON0, row0);
    const srcRow1 = new OneBitConst(state, STATE_ON0, row1);

    const matrix = new FunctionLedMatrixSelector(state, [col0, col1, row0, row1], {
      matrixId: "mat-sel-persist",
      rows: 2,
      columns: 2,
      colors: 1,
      persistenceMultiplier: 2,
    });
    state.endDefinition();

    // Zeile 0 aktivieren, Spalte 0 an -> (0, 0) leuchtet sofort
    srcRow0.setState(STATE_ON1);
    srcCol0.setState(STATE_ON1);
    expect(state.evaluate(false)).toBe(true);
    expect(matrix.getCellValues()).toEqual([
      [1, 0],
      [0, 0],
    ]);

    // Multiplex-Umschaltung auf Zeile 1, Spalte 1 an -> (0, 0) bleibt dank Nachleuchten aktiv
    srcRow0.setState(STATE_ON0);
    srcCol0.setState(STATE_ON0);
    srcRow1.setState(STATE_ON1);
    srcCol1.setState(STATE_ON1);
    expect(state.evaluate(true)).toBe(true);
    expect(matrix.getCellValues()).toEqual([
      [1, 0],
      [0, 1],
    ]);

    // Zeile 1 ebenfalls aus: rows(2) * persistenceMultiplier(2) = 4 Flips für (0, 0) ab Flip 1 (Ablauf bei Flip 5)
    srcRow1.setState(STATE_ON0);
    srcCol1.setState(STATE_ON0);
    expect(state.evaluate(true)).toBe(true); // Flip 2: (1,1) geplant bis Flip 6, (0,0) noch an
    expect(matrix.getCell(0, 0)).toBe(1);
    expect(matrix.getCell(1, 1)).toBe(1);

    state.evaluate(true); // Flip 3
    state.evaluate(true); // Flip 4
    expect(matrix.getCell(0, 0)).toBe(1);

    state.evaluate(true); // Flip 5 -> (0, 0) erlischt, (1, 1) leuchtet noch 1 Flip
    expect(matrix.getCell(0, 0)).toBe(0);
    expect(matrix.getCell(1, 1)).toBe(1);

    state.evaluate(true); // Flip 6 -> (1, 1) erlischt
    expect(matrix.getCell(1, 1)).toBe(0);
  });

  it("verhindert Zwischenwellen-Ghosting bei ungleicher Gattertiefe von Zeilen- und Spaltenpfad", () => {
    // Reproduziert den Fall aus einer gemultiplexten Matrix: Spaltendaten (z. B. ROM) schalten schneller
    // um als der Zeilen-Decoder (NOT -> AND). Ohne Post-Settle-Auswertung würden Geisterpixel gelatcht.
    for (const seed of [1, 42, 123456789, 987654321]) {
      const state = new CircuitState(3, seed);
      const sel = state.reserveState();
      const constOne = state.reserveState();
      const notSel = state.reserveState();
      const row0 = state.reserveState();
      const row1 = state.reserveState();

      const srcSel = new OneBitConst(state, STATE_ON0, sel);
      new OneBitConst(state, STATE_ON1, constOne);
      // zweistufiger Zeilenpfad für Row 0 (NOT -> AND), 1-stufiger Pfad für Row 1 (AND)
      new FunctionNot(state, sel, notSel);
      new FunctionAnd(state, [notSel, constOne], row0);
      new FunctionAnd(state, [sel, constOne], row1);

      // Col 0 = notSel (aktiv bei sel=0 -> nur Row 0), Col 1 = sel (direkt, aktiv bei sel=1 -> nur Row 1)
      const matrix = new FunctionLedMatrixSelector(state, [notSel, sel, row0, row1], {
        matrixId: `mat-no-ghost-${seed}`,
        rows: 2,
        columns: 2,
        colors: 1,
        persistenceMultiplier: 2,
      });
      state.endDefinition();

      expect(state.evaluate(false)).toBe(true);
      expect(matrix.getCellValues()).toEqual([
        [1, 0],
        [0, 0],
      ]);

      for (let step = 1; step <= 30; step++) {
        srcSel.setState(step % 2 === 1 ? STATE_ON1 : STATE_ON0);
        expect(state.evaluate(true)).toBe(true);
        // Nur Diagonale (0,0) und (1,1) dürfen leuchten — niemals Geisterpixel bei (0,1) oder (1,0)
        expect(matrix.getCell(0, 1)).toBe(0);
        expect(matrix.getCell(1, 0)).toBe(0);
        expect(matrix.getCell(0, 0)).toBe(1);
        expect(matrix.getCell(1, 1)).toBe(1);
      }
    }
  });

  it("kompiliert und simuliert beide LedMatrix-Modi im CircuitRunner inkl. Snapshot.ledMatrices", () => {
    const circuit = createDefaultLogicalCircuit("main", "MatrixRunnerTest");

    // Individual 2x3 Matrix (colors=2 -> 6 Bit je Zeileneingang)
    const indMatrix = createLedMatrix("mat-ind-run", 2, 3, "individual", "round", 2, 1);
    const indSym = createCircuitSymbol(indMatrix, "main", 10, 2, "up", "sym-ind");

    const row0Const = createConstant("c-row0", 6, 0b011011, "right");
    const row0Sym = createCircuitSymbol(row0Const, "main", 2, 2, "up", "sym-c0");

    // Selector 2x2 Matrix (colors=1)
    const selMatrix = createLedMatrix("mat-sel-run", 2, 2, "selector", "rect", 1, 1);
    const selSym = createCircuitSymbol(selMatrix, "main", 25, 2, "up", "sym-sel");

    const col0Btn = createCircuitButton("btn-col0", "C0", true, "right");
    const col0Sym = createCircuitSymbol(col0Btn, "main", 20, 0, "up", "sym-bcol0");
    const row0Btn = createCircuitButton("btn-row0", "R0", true, "right");
    const row0BtnSym = createCircuitSymbol(row0Btn, "main", 20, 3, "up", "sym-brow0");

    circuit.circuitSymbols = [indSym, row0Sym, selSym, col0Sym, row0BtnSym];

    const indRow0Jam = indSym.jams
      .filter((j) => j.pin.pinSide === "left")
      .sort((a, b) => a.pin.gridPoint.y - b.pin.gridPoint.y)[0]!;
    const row0OutJam = row0Sym.jams.find((j) => j.pin.pinType === "output")!;

    const selCol0Jam = selSym.jams
      .filter((j) => j.pin.pinSide === "top")
      .sort((a, b) => a.pin.gridPoint.x - b.pin.gridPoint.x)[0]!;
    const selRow0Jam = selSym.jams
      .filter((j) => j.pin.pinSide === "left")
      .sort((a, b) => a.pin.gridPoint.y - b.pin.gridPoint.y)[0]!;
    const bCol0OutJam = col0Sym.jams.find((j) => j.pin.pinType === "output")!;
    const bRow0OutJam = row0BtnSym.jams.find((j) => j.pin.pinType === "output")!;

    circuit.wires = [
      makeWire("w-ind-r0", "main", row0OutJam.absolutePoint, indRow0Jam.absolutePoint),
      makeWire("w-sel-c0", "main", bCol0OutJam.absolutePoint, selCol0Jam.absolutePoint),
      makeWire("w-sel-r0", "main", bRow0OutJam.absolutePoint, selRow0Jam.absolutePoint),
    ];

    const runner = new CircuitRunner(circuit);
    const res1 = runner.step(1);

    // 0b01_10_11 (Bits 0..5) -> Spalte 0 = 0b11 (3), Spalte 1 = 0b10 (2), Spalte 2 = 0b01 (1)
    expect(res1.snapshot.ledMatrices?.["mat-ind-run"]).toEqual([
      [3, 2, 1],
      [0, 0, 0],
    ]);
    expect(res1.snapshot.ledMatrices?.["mat-sel-run"]).toEqual([
      [0, 0],
      [0, 0],
    ]);

    runner.toggleButton("btn-col0");
    runner.toggleButton("btn-row0");
    const res2 = runner.step(1);
    expect(res2.snapshot.ledMatrices?.["mat-sel-run"]).toEqual([
      [1, 0],
      [0, 0],
    ]);

    runner.dispose();
  });

  it("formatiert CircuitProbe im CircuitRunner als Hex, Dezimal oder Binär", () => {
    const state = new CircuitState();
    const bits = [
      state.reserveState(),
      state.reserveState(),
      state.reserveState(),
      state.reserveState(),
    ];
    new FunctionConstant(state, bits, 0b1010);
    const probeHex = new FunctionProbe(state, bits, "H", "p-hex", "hex");
    const probeDec = new FunctionProbe(state, bits, "D", "p-dec", "dec");
    const probeBin = new FunctionProbe(state, bits, "B", "p-bin", "bin");
    state.endDefinition();
    state.evaluate(false);

    expect(probeHex.toText(true, "hex")).toBe("0xA");
    expect(probeDec.toText(true, "dec")).toBe("10");
    expect(probeBin.toText(true, "bin")).toBe("1010");

    // Tri-State-Bit erzwingt in jedem Modus binäre Z-Anzeige mit 'z'
    const zCircuitState = new CircuitState();
    const zBits = [zCircuitState.reserveState(), zCircuitState.reserveState()];
    new OneBitConst(zCircuitState, STATE_ON1, zBits[0]);
    new OneBitConst(zCircuitState, STATE_OFF, zBits[1]);
    const zProbe = new FunctionProbe(zCircuitState, zBits, "Z", "p-z", "dec");
    zCircuitState.endDefinition();
    zCircuitState.evaluate(false);
    expect(zProbe.toText(true, "dec")).toBe("z1");

    // Ende-zu-Ende im CircuitRunner
    const circuit = createDefaultLogicalCircuit("main", "ProbeFormatTest");
    const c = createConstant("c-val", 4, 13, "right");
    const cSym = createCircuitSymbol(c, "main", 0, 2, "up", "sym-c");

    const pHex = createCircuitProbe("p-hex", "H", "left", 2, 2, true);
    pHex.displayFormat = "hex";
    const pHexSym = createCircuitSymbol(pHex, "main", 6, 2, "up", "sym-ph");

    const pDec = createCircuitProbe("p-dec", "D", "left", 2, 2, false);
    pDec.displayFormat = "dec";
    const pDecSym = createCircuitSymbol(pDec, "main", 6, 6, "up", "sym-pd");

    const pBin = createCircuitProbe("p-bin", "B", "left", 2, 2, false);
    pBin.displayFormat = "bin";
    const pBinSym = createCircuitSymbol(pBin, "main", 6, 10, "up", "sym-pb");

    circuit.circuitSymbols = [cSym, pHexSym, pDecSym, pBinSym];
    const cOut = cSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    circuit.wires = [
      makeWire("w1", "main", cOut, pHexSym.jams[0]!.absolutePoint),
      makeWire("w2", "main", cOut, pDecSym.jams[0]!.absolutePoint),
      makeWire("w3", "main", cOut, pBinSym.jams[0]!.absolutePoint),
    ];

    const runner = new CircuitRunner(circuit);
    const snap = runner.step(1).snapshot;
    expect(snap.probes["p-hex"].text).toBe("0xD");
    expect(snap.probes["p-dec"].text).toBe("13");
    expect(snap.probes["p-bin"].text).toBe("1101");
    runner.dispose();
  });

  it("rendert Anzeigeformat-Auswahl für CircuitProbe und Tastaturtrigger für CircuitButton im PropertyDialog", () => {
    const probe = createCircuitProbe("probe-ui", "Out", "left", 2, 2, false);
    probe.displayFormat = "dec";
    const probeSym = createCircuitSymbol(probe, "main", 2, 2);

    const probeHtml = renderToStaticMarkup(
      React.createElement(PropertyDialog, {
        isOpen: true,
        symbol: probeSym,
        onClose: () => {},
      }),
    );
    expect(probeHtml).toContain("Anzeigeformat");
    expect(probeHtml).toContain("Hexadezimal (0x...)");
    expect(probeHtml).toContain("Dezimal");
    expect(probeHtml).toContain("Binär");

    const btn = createCircuitButton("btn-ui", "KEY", false);
    btn.keyCode = 44; // WPF Key.A
    btn.modifiers = MODIFIER_CONTROL | MODIFIER_SHIFT;
    const btnSym = createCircuitSymbol(btn, "main", 4, 4);

    const btnHtml = renderToStaticMarkup(
      React.createElement(PropertyDialog, {
        isOpen: true,
        symbol: btnSym,
        onClose: () => {},
      }),
    );
    expect(btnHtml).toContain("Tastaturtrigger (Simulation)");
    expect(btnHtml).toContain("Strg+Shift+A");
    expect(btnHtml).toContain("Zurücksetzen");
  });

  it("konvertiert und prüft Tastaturtrigger (keyGesture) zuverlässig", () => {
    expect(isModifierOnlyKey("Control")).toBe(true);
    expect(isModifierOnlyKey("Shift")).toBe(true);
    expect(isModifierOnlyKey("a")).toBe(false);

    const keyA = keyboardEventToWpfKeyCode({ key: "a", code: "KeyA" });
    const keyZ = keyboardEventToWpfKeyCode({ key: "z", code: "KeyY" }); // QWERTZ: Z auf physischer KeyY
    const keySpace = keyboardEventToWpfKeyCode({ key: " ", code: "Space" });
    const keyF1 = keyboardEventToWpfKeyCode({ key: "F1", code: "F1" });

    expect(keyA).toBe(44);
    expect(keyZ).toBe(69);
    expect(keySpace).toBe(18);
    expect(keyF1).toBe(90);

    const mods = getKeyboardEventModifiers({
      altKey: true,
      ctrlKey: true,
      shiftKey: false,
      metaKey: false,
    });
    expect(mods).toBe(MODIFIER_ALT | MODIFIER_CONTROL);
    expect(formatKeyGesture(keyA, mods)).toBe("Strg+Alt+A");

    expect(
      matchesKeyGesture(
        {
          key: "a",
          code: "KeyA",
          altKey: true,
          ctrlKey: true,
          shiftKey: false,
          metaKey: false,
        },
        keyA,
        mods,
      ),
    ).toBe(true);
    expect(
      matchesKeyGesture(
        {
          key: "a",
          code: "KeyA",
          altKey: false,
          ctrlKey: true,
          shiftKey: false,
          metaKey: false,
        },
        keyA,
        mods,
      ),
    ).toBe(false);
    expect(formatKeyGesture(0, 0)).toBe("");
  });
});
