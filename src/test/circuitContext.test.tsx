import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";

import type GridPoint from "../types/canvas/gridPoint";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type Gate from "../types/circuit/gate";
import type LedMatrix from "../types/circuit/ledMatrix";
import type PaletteSelection from "../types/circuit/paletteSelection";
import type Splitter from "../types/circuit/splitter";

import {
  createEmptyCircuitProject,
  doBoundingBoxesIntersect,
  getSymbolGridBoundingBox,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";

// Hilfskomponente zum Testen von Kontext-Methoden und State-Mutationen
const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

describe("CircuitContext & Demo Project", () => {
  it("initializes with demo project containing symbols and text notes", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedContext).not.toBeNull();
    const { project, currentCircuit } = capturedContext!;

    expect(project.project.name).toBe("Schaltungs-Projekt");
    expect(project.logicalCircuits.length).toBeGreaterThanOrEqual(3);
    expect(currentCircuit.name).toBe("Haupt-Schaltung");

    // Prüfen, ob die Bauteile und Leitungen des C#-Referenzprojekts vorhanden sind
    expect(currentCircuit.circuitSymbols.length).toBe(16);
    expect(currentCircuit.wires.length).toBe(12);

    const hasAndGate = currentCircuit.circuitSymbols.some((s) => s.circuit.name === "AND");
    const hasOrGate = currentCircuit.circuitSymbols.some((s) => s.circuit.name === "OR");
    const hasXorGate = currentCircuit.circuitSymbols.some((s) => s.circuit.name === "XOR");
    const hasTriState = currentCircuit.circuitSymbols.some((s) => s.circuit.name === "Tri-State");
    const hasButton = currentCircuit.circuitSymbols.some((s) => s.circuit.kind === "circuitButton");

    expect(hasAndGate).toBe(true);
    expect(hasOrGate).toBe(true);
    expect(hasXorGate).toBe(true);
    expect(hasTriState).toBe(true);
    expect(hasButton).toBe(true);
  });

  it("instantiates and places gates, IO elements and sub-circuits at exact grid points", () => {
    const empty = createEmptyCircuitProject("Test Project", "Main");
    const mainCircuit = empty.logicalCircuits[0];

    // AND-Gatter mit 3 Eingängen platzieren
    const andSelection: PaletteSelection = { type: "and", inputCount: 3, name: "AND" };
    const ptAnd: GridPoint = { x: 12, y: 15 };
    const { circuitSymbol: andSymbol } = instantiateCircuitFromPalette(
      empty,
      mainCircuit.logicalCircuitId,
      andSelection,
      ptAnd,
    );

    expect(andSymbol.x).toBe(12);
    expect(andSymbol.y).toBe(15);
    expect(andSymbol.jams.length).toBe(4); // 3 Inputs + 1 Output
    expect(andSymbol.jams[0].absolutePoint).toEqual({ x: 12, y: 16 });

    // Button platzieren
    const btnSelection: PaletteSelection = { type: "button", name: "Push Button" };
    const ptBtn: GridPoint = { x: 5, y: 8 };
    const { circuitSymbol: btnSymbol } = instantiateCircuitFromPalette(
      empty,
      mainCircuit.logicalCircuitId,
      btnSelection,
      ptBtn,
    );

    expect(btnSymbol.x).toBe(5);
    expect(btnSymbol.y).toBe(8);
    expect(btnSymbol.circuit.name).toBe("Push Button");
    expect(btnSymbol.jams.length).toBe(1); // 1 Output
  });

  it("supports addSymbol, moveSymbol, selectSymbol and removeSymbol actions", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedContext).not.toBeNull();
    const ctx = capturedContext!;
    expect(ctx.currentCircuit.circuitSymbols.length).toBe(0);

    // Baustein hinzufügen
    let placedSymbol: CircuitSymbol | null = null;
    React.act(() => {
      placedSymbol = ctx.addSymbol({ type: "or", inputCount: 2, name: "OR" }, { x: 10, y: 20 });
    });

    expect(placedSymbol).not.toBeNull();
    expect(placedSymbol!.x).toBe(10);
    expect(placedSymbol!.y).toBe(20);

    // Selektion
    React.act(() => {
      ctx.selectSymbol(placedSymbol!.circuitSymbolId);
    });

    // Verschieben
    React.act(() => {
      ctx.moveSymbol(placedSymbol!.circuitSymbolId, { x: 14, y: 24 });
    });

    // Löschen
    React.act(() => {
      ctx.removeSymbol(placedSymbol!.circuitSymbolId);
    });
  });

  it("calculates symbol bounding boxes and intersection with selection rectangles", () => {
    const empty = createEmptyCircuitProject("Test", "Main");
    const mainCircuit = empty.logicalCircuits[0];

    const { circuitSymbol: sym1 } = instantiateCircuitFromPalette(
      empty,
      mainCircuit.logicalCircuitId,
      { type: "and", inputCount: 2, name: "AND" },
      { x: 5, y: 10 },
    );

    const box1 = getSymbolGridBoundingBox(sym1);
    expect(box1).toEqual({
      minX: 5,
      minY: 10,
      maxX: 8,
      maxY: 14,
    });

    // Überschneidendes Auswahlrechteck
    const overlappingRect = { minX: 4, minY: 9, maxX: 6, maxY: 11 };
    expect(doBoundingBoxesIntersect(overlappingRect, box1)).toBe(true);

    // Nicht überschneidendes Auswahlrechteck
    const nonOverlappingRect = { minX: 0, minY: 0, maxX: 4, maxY: 9 };
    expect(doBoundingBoxesIntersect(nonOverlappingRect, box1)).toBe(false);
  });

  it("supports multi-selection via selectSymbols, collective moveSymbols and removeSymbols", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Test Multi", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    let symA: CircuitSymbol | null = null;
    let symB: CircuitSymbol | null = null;

    React.act(() => {
      symA = ctx.addSymbol({ type: "not", name: "NOT" }, { x: 2, y: 4 });
      symB = ctx.addSymbol({ type: "clock", name: "CLOCK" }, { x: 10, y: 12 });
    });

    expect(symA).not.toBeNull();
    expect(symB).not.toBeNull();
    expect(symA!.x).toBe(2);
    expect(symB!.x).toBe(10);

    // Mehrfachauswahl setzen
    React.act(() => {
      ctx.selectSymbols([symA!.circuitSymbolId, symB!.circuitSymbolId]);
    });

    // Additive Mehrfachauswahl testen
    React.act(() => {
      ctx.selectSymbols([symA!.circuitSymbolId]);
      ctx.selectSymbols([symB!.circuitSymbolId], true);
    });

    // Kollektive Verschiebung beider Bausteine um Delta (+3, +5)
    React.act(() => {
      ctx.moveSymbols([
        { symbolId: symA!.circuitSymbolId, gridPoint: { x: symA!.x + 3, y: symA!.y + 5 } },
        { symbolId: symB!.circuitSymbolId, gridPoint: { x: symB!.x + 3, y: symB!.y + 5 } },
      ]);
    });

    // Gemeinsames Löschen aller ausgewählten Bausteine
    React.act(() => {
      ctx.removeSymbols([symA!.circuitSymbolId, symB!.circuitSymbolId]);
    });
  });

  it("resets to empty and demo project cleanly", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    expect(ctx.currentCircuit.circuitSymbols.length).toBeGreaterThan(0);

    React.act(() => {
      ctx.resetToEmptyProject();
    });

    React.act(() => {
      ctx.resetToDemoProject();
    });
  });

  it("rotates selected symbols via rotateSelectedSymbols in CircuitContext", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Rotate Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    let sym1: CircuitSymbol | null = null;

    React.act(() => {
      sym1 = ctx.addSymbol({ type: "and", name: "AND" }, { x: 5, y: 5 });
    });

    expect(sym1).not.toBeNull();
    expect(sym1!.rotation).toBe("up");

    // Symbol selektieren und im Uhrzeigersinn rotieren
    React.act(() => {
      ctx.selectSymbol(sym1!.circuitSymbolId);
    });

    React.act(() => {
      ctx.rotateSelectedSymbols("clockwise");
    });

    // Rotation gegen den Uhrzeigersinn (zurück zu "up")
    React.act(() => {
      ctx.rotateSelectedSymbols("counterClockwise");
    });

    // Gruppenauswahl aus zwei Symbolen und geknickter Leitung rotieren (inkl. wireIds)
    let pinSym: CircuitSymbol | null = null;
    let w1Id = "";
    let w2Id = "";
    React.act(() => {
      pinSym = ctx.addSymbol({ type: "pinIn", name: "IN" }, { x: 2, y: 12 });
      const w1 = ctx.addWire({ x: 4, y: 13 }, { x: 8, y: 13 });
      const w2 = ctx.addWire({ x: 8, y: 13 }, { x: 8, y: 16 });
      w1Id = w1!.wireId;
      w2Id = w2!.wireId;
      ctx.selectEntities([sym1!.circuitSymbolId, pinSym.circuitSymbolId], [], false, [w1Id, w2Id]);
    });

    React.act(() => {
      ctx.rotateSelectedSymbols("clockwise");
    });

    const rotatedWires = ctx.currentCircuit.wires.filter((w) => w.wireId === w1Id || w.wireId === w2Id);
    expect(rotatedWires).toHaveLength(2);
    expect(rotatedWires.every((w) => w.x1 === w.x2 || w.y1 === w.y2)).toBe(true);
    // Zwei L-Segmente teilen weiterhin einen gemeinsamen orthogonalen Knickpunkt
    const w1After = rotatedWires.find((w) => w.wireId === w1Id)!;
    const w2After = rotatedWires.find((w) => w.wireId === w2Id)!;
    expect(w1After.x2).toBe(w2After.x1);
    expect(w1After.y2).toBe(w2After.y1);
  });

  it("modifies gate properties: increasing input count from 2 to 4 and recalculates jams", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Gate Props Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    let placedAnd: CircuitSymbol | null = null;

    React.act(() => {
      placedAnd = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 10, y: 10 });
    });

    expect(placedAnd).not.toBeNull();
    expect(placedAnd!.jams.length).toBe(3); // 2 Inputs + 1 Output
    expect((placedAnd!.circuit as unknown as { inputCount: number }).inputCount).toBe(2);

    // Eingangsanzahl von 2 auf 4 erhöhen
    let updatedSymbol: CircuitSymbol | null = null;
    React.act(() => {
      updatedSymbol = ctx.updateCircuitSymbolProperties(placedAnd!.circuitSymbolId, {
        inputCount: 4,
      });
    });

    expect(updatedSymbol).not.toBeNull();
    expect((updatedSymbol!.circuit as unknown as { inputCount: number }).inputCount).toBe(4);
    expect(updatedSymbol!.jams.length).toBe(5); // 4 Inputs + 1 Output

    // Alle Jams müssen exakt auf dem Raster sitzen
    for (const jam of updatedSymbol!.jams) {
      expect(Number.isInteger(jam.absolutePoint.x)).toBe(true);
      expect(Number.isInteger(jam.absolutePoint.y)).toBe(true);
    }
  });

  it("modifies gate inversion toggle: AND becomes NAND with inverted output", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Gate Invert Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    let placedAnd: CircuitSymbol | null = null;

    React.act(() => {
      placedAnd = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 5, y: 5 });
    });

    let updatedSymbol: CircuitSymbol | null = null;
    React.act(() => {
      updatedSymbol = ctx.updateCircuitSymbolProperties(placedAnd!.circuitSymbolId, {
        invertedOutput: true,
      });
    });

    expect(updatedSymbol).not.toBeNull();
    expect(updatedSymbol!.circuit.name).toBe("NAND");
    expect((updatedSymbol!.circuit as unknown as { invertedOutput: boolean }).invertedOutput).toBe(true);
    const outJam = updatedSymbol!.jams.find((j) => j.pin.pinType === "output");
    expect(outJam).toBeDefined();
    expect(outJam!.z).toBe(2);
  });

  it("modifies button, constant and pin properties via updateCircuitSymbolProperties", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Items Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    let btnSym: CircuitSymbol | null = null;
    let constSym: CircuitSymbol | null = null;
    let pinSym: CircuitSymbol | null = null;

    React.act(() => {
      btnSym = ctx.addSymbol({ type: "button", name: "Button" }, { x: 2, y: 2 });
      constSym = ctx.addSymbol({ type: "constant", name: "Constant" }, { x: 10, y: 2 });
      pinSym = ctx.addSymbol({ type: "pinIn", name: "Pin" }, { x: 20, y: 2 });
    });

    // Button modifizieren: Taster -> Schalter mit Label "RESET"
    let updatedBtn: CircuitSymbol | null = null;
    React.act(() => {
      updatedBtn = ctx.updateCircuitSymbolProperties(btnSym!.circuitSymbolId, {
        isToggle: true,
        notation: "RESET",
        inverted: true,
      });
    });

    expect(updatedBtn).not.toBeNull();
    expect((updatedBtn!.circuit as unknown as { isToggle: boolean }).isToggle).toBe(true);
    expect(updatedBtn!.circuit.notation).toBe("RESET");
    expect((updatedBtn!.circuit as unknown as { inverted: boolean }).inverted).toBe(true);

    // Konstante modifizieren: Bitbreite 8, Wert 255 (Hex FF)
    let updatedConst: CircuitSymbol | null = null;
    React.act(() => {
      updatedConst = ctx.updateCircuitSymbolProperties(constSym!.circuitSymbolId, {
        bitWidth: 8,
        value: 255,
      });
    });

    expect(updatedConst).not.toBeNull();
    expect((updatedConst!.circuit as unknown as { bitWidth: number }).bitWidth).toBe(8);
    expect((updatedConst!.circuit as unknown as { value: number }).value).toBe(255);
    expect(updatedConst!.circuit.notation).toBe("FF");

    // Pin modifizieren: Name "CLOCK", Ausgang, Bitbreite 1
    let updatedPin: CircuitSymbol | null = null;
    React.act(() => {
      updatedPin = ctx.updateCircuitSymbolProperties(pinSym!.circuitSymbolId, {
        name: "CLOCK",
        pinType: "output",
        bitWidth: 1,
      });
    });

    expect(updatedPin).not.toBeNull();
    expect(updatedPin!.circuit.name).toBe("CLOCK");
    expect(updatedPin!.circuit.notation).toBe("Out: CLOCK");
  });

  it("updates logical circuit metadata via updateCircuitProperties", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Meta Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    expect(ctx.currentCircuit.name).toBe("Main");

    let updatedLc: unknown = null;
    React.act(() => {
      updatedLc = ctx.updateCircuitProperties(ctx.currentCircuit.logicalCircuitId, {
        name: "ALU Rechenwerk",
        category: "Arithmetik",
        note: "8-Bit arithmetisch-logische Einheit",
      });
    });

    expect(updatedLc).not.toBeNull();
    expect((updatedLc as { name: string }).name).toBe("ALU Rechenwerk");
    expect((updatedLc as { category: string }).category).toBe("Arithmetik");
    expect((updatedLc as { note: string }).note).toBe("8-Bit arithmetisch-logische Einheit");
  });

  it("resizes resizable symbols (Button, Constant, Probe, Pin) via resizeCircuitSymbol and recalculates jams", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Resize Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    const btnSym = ctx.addSymbol({ type: "button", name: "Button", inputCount: 1 }, { x: 5, y: 5 });
    const constSym = ctx.addSymbol({ type: "constant", name: "Constant", inputCount: 1 }, { x: 10, y: 5 });
    const probeSym = ctx.addSymbol({ type: "probe", name: "Probe", inputCount: 1 }, { x: 15, y: 5 });
    const pinSym = ctx.addSymbol({ type: "pinIn", name: "Pin In", inputCount: 1 }, { x: 20, y: 5 });

    // Button von 3x3 auf 4x4 vergrößern
    let resizedBtn: CircuitSymbol | null = null;
    React.act(() => {
      resizedBtn = ctx.resizeCircuitSymbol(btnSym.circuitSymbolId, {
        x: 5,
        y: 5,
        width: 4,
        height: 4,
      });
    });

    expect(resizedBtn).not.toBeNull();
    expect(resizedBtn!.circuit.symbolWidth).toBe(4);
    expect(resizedBtn!.circuit.symbolHeight).toBe(4);
    expect(resizedBtn!.jams[0]?.x).toBe(4); // PinSide right -> x = 4
    expect(resizedBtn!.jams[0]?.y).toBe(2); // Mittig bei y = 2

    // Constant von 2x2 auf 3x2 vergrößern
    let resizedConst: CircuitSymbol | null = null;
    React.act(() => {
      resizedConst = ctx.resizeCircuitSymbol(constSym.circuitSymbolId, {
        x: 10,
        y: 5,
        width: 3,
        height: 2,
      });
    });

    expect(resizedConst).not.toBeNull();
    expect(resizedConst!.circuit.symbolWidth).toBe(3);
    expect(resizedConst!.circuit.symbolHeight).toBe(2);
    expect(resizedConst!.jams[0]?.x).toBe(3);

    // Probe auf 4x3 vergrößern
    let resizedProbe: CircuitSymbol | null = null;
    React.act(() => {
      resizedProbe = ctx.resizeCircuitSymbol(probeSym.circuitSymbolId, {
        x: 15,
        y: 5,
        width: 4,
        height: 3,
      });
    });

    expect(resizedProbe).not.toBeNull();
    expect(resizedProbe!.circuit.symbolWidth).toBe(4);
    expect(resizedProbe!.circuit.symbolHeight).toBe(3);

    // Pin auf 5x2 vergrößern
    let resizedPin: CircuitSymbol | null = null;
    React.act(() => {
      resizedPin = ctx.resizeCircuitSymbol(pinSym.circuitSymbolId, {
        x: 20,
        y: 5,
        width: 5,
        height: 2,
      });
    });

    expect(resizedPin).not.toBeNull();
    expect(resizedPin!.circuit.symbolWidth).toBe(5);
    expect(resizedPin!.circuit.symbolHeight).toBe(2);
  });

  it("updates Tri-State gate type between triState1 and triState2 via updateCircuitSymbolProperties", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("TriState Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    let triSym: CircuitSymbol | null = null;

    React.act(() => {
      triSym = ctx.addSymbol({ type: "triState1", name: "Tri-State" }, { x: 5, y: 5 });
    });

    expect(triSym).not.toBeNull();
    const triGate1 = triSym!.circuit as Gate;
    expect(triGate1.gateType).toBe("triState1");
    // Enable pin bei triState1 ist unten (y=4, absolut y = 5 + 4 = 9)
    const enableJam1 = triSym!.jams.find((j) => j.pin.name === "Enable");
    expect(enableJam1?.y).toBe(4);
    expect(enableJam1?.absolutePoint.y).toBe(9);

    // Umschalten auf triState2 (Up-Variante)
    let updatedTri: CircuitSymbol | null = null;
    React.act(() => {
      updatedTri = ctx.updateCircuitSymbolProperties(triSym!.circuitSymbolId, {
        gateType: "triState2",
      });
    });

    expect(updatedTri).not.toBeNull();
    const triGate2 = updatedTri!.circuit as Gate;
    expect(triGate2.gateType).toBe("triState2");
    // Enable pin bei triState2 ist oben (y=0, absolut y = 5 + 0 = 5)
    const enableJam2 = updatedTri!.jams.find((j) => j.pin.name === "Enable");
    expect(enableJam2?.y).toBe(0);
    expect(enableJam2?.absolutePoint.y).toBe(5);
  });

  it("resizes LED matrix dynamically adjusting rows and columns with clamp limits", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Matrix Resize Test", "Main")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;
    let matrixSym: CircuitSymbol | null = null;

    React.act(() => {
      matrixSym = ctx.addSymbol({
        type: "ledMatrix",
        name: "LED-Matrix",
        rows: 4,
        columns: 4,
      }, { x: 5, y: 5 });
    });

    expect(matrixSym).not.toBeNull();
    const initialMatrix = matrixSym!.circuit as LedMatrix;
    expect(initialMatrix.rows).toBe(4);
    expect(initialMatrix.columns).toBe(4);
    expect(initialMatrix.symbolWidth).toBe(5);
    expect(initialMatrix.symbolHeight).toBe(5);

    // Resizen auf Breite 7, Höhe 5 (ergibt 6 Spalten, 4 Zeilen)
    let resizedMatrixSym: CircuitSymbol | null = null;
    React.act(() => {
      resizedMatrixSym = ctx.resizeCircuitSymbol(matrixSym!.circuitSymbolId, {
        x: 5,
        y: 5,
        width: 7,
        height: 5,
      });
    });

    expect(resizedMatrixSym).not.toBeNull();
    const resizedMatrix = resizedMatrixSym!.circuit as LedMatrix;
    expect(resizedMatrix.columns).toBe(6);
    expect(resizedMatrix.rows).toBe(4);
    expect(resizedMatrix.symbolWidth).toBe(7);
    expect(resizedMatrix.symbolHeight).toBe(5);

    // Resizen auf Werte unter Minimum (Breite 1, Höhe 1) wird geklemmt auf 1x1 (Breite 2, Höhe 2)
    React.act(() => {
      resizedMatrixSym = ctx.resizeCircuitSymbol(matrixSym!.circuitSymbolId, {
        x: 5,
        y: 5,
        width: 1,
        height: 1,
      });
    });

    expect(resizedMatrixSym).not.toBeNull();
    const minMatrix = resizedMatrixSym!.circuit as LedMatrix;
    expect(minMatrix.columns).toBe(1);
    expect(minMatrix.rows).toBe(1);
    expect(minMatrix.symbolWidth).toBe(2);
    expect(minMatrix.symbolHeight).toBe(2);

    // Resizen auf Werte über Maximum (Breite 20, Höhe 20) wird geklemmt auf 10x10 (Breite 11, Höhe 11)
    React.act(() => {
      resizedMatrixSym = ctx.resizeCircuitSymbol(matrixSym!.circuitSymbolId, {
        x: 5,
        y: 5,
        width: 20,
        height: 20,
      });
    });

    expect(resizedMatrixSym).not.toBeNull();
    const maxMatrix = resizedMatrixSym!.circuit as LedMatrix;
    expect(maxMatrix.columns).toBe(10);
    expect(maxMatrix.rows).toBe(10);
    expect(maxMatrix.symbolWidth).toBe(11);
    expect(maxMatrix.symbolHeight).toBe(11);
  });

  it("places and updates Bus-Splitter symbols via addSymbol and updateCircuitSymbolProperties", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let splitterSym: CircuitSymbol | null = null;
    React.act(() => {
      splitterSym = ctx.addSymbol(
        {
          type: "splitter",
          name: "Splitter",
          pinCount: 4,
          pinBitWidth: 2,
          clockwise: true,
        },
        { x: 12, y: 15 },
      );
    });

    expect(splitterSym).not.toBeNull();
    const splitter = splitterSym!.circuit as Splitter;
    expect(splitter.kind).toBe("splitter");
    expect(splitter.pinCount).toBe(4);
    expect(splitter.bitWidth).toBe(8);
    expect(splitter.clockwise).toBe(true);
    expect(splitter.symbolWidth).toBe(1);
    expect(splitter.symbolHeight).toBe(5);
    expect(splitterSym!.jams).toHaveLength(5);

    // Aktualisierung über Eigenschaftendialog
    let updatedSym: CircuitSymbol | null = null;
    React.act(() => {
      updatedSym = ctx.updateCircuitSymbolProperties(splitterSym!.circuitSymbolId, {
        pinCount: 3,
        pinBitWidth: 1,
        clockwise: false,
        note: "3-Bit Verteiler",
      });
    });

    expect(updatedSym).not.toBeNull();
    const updatedSplitter = updatedSym!.circuit as Splitter;
    expect(updatedSplitter.pinCount).toBe(3);
    expect(updatedSplitter.bitWidth).toBe(3);
    expect(updatedSplitter.clockwise).toBe(false);
    expect(updatedSplitter.note).toBe("3-Bit Verteiler");
    expect(updatedSplitter.symbolWidth).toBe(1);
    expect(updatedSplitter.symbolHeight).toBe(4);
    expect(updatedSym!.jams).toHaveLength(4);
  });
});
