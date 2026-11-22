import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type Constant from "../types/circuit/constant";
import type Splitter from "../types/circuit/splitter";
import type TextNote from "../types/circuit/textNote";

import { createDemoCircuitProject, createEmptyCircuitProject } from "../utils/circuitLayout";

import AppHeader from "../components/app/appHeader";

const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

describe("Undo/Redo Delta Stack (US-010 / T-025)", () => {
  it("records add and remove deltas and reverses them via undo and redo", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Undo Test", "Main")}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    expect(ctx.canUndo).toBe(false);
    expect(ctx.canRedo).toBe(false);
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(0);

    let sym!: CircuitSymbol;
    let note!: TextNote;
    React.act(() => {
      sym = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 4, y: 6 });
      note = ctx.addTextNote("Notiz A", { x: 10, y: 12 });
    });

    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);
    expect(ctx.currentCircuit.textNotes).toHaveLength(1);
    expect(ctx.history.entries).toHaveLength(2);
    expect(ctx.history.pointer).toBe(2);
    expect(ctx.canUndo).toBe(true);
    expect(ctx.canRedo).toBe(false);

    // Undo TextNote-Platzierung -> Stack behält 2 Einträge, Pointer sinkt auf 1
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.textNotes).toHaveLength(0);
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);
    expect(ctx.history.entries).toHaveLength(2);
    expect(ctx.history.pointer).toBe(1);
    expect(ctx.canUndo).toBe(true);
    expect(ctx.canRedo).toBe(true);

    // Undo Symbol-Platzierung -> Pointer sinkt auf 0
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(0);
    expect(ctx.history.entries).toHaveLength(2);
    expect(ctx.history.pointer).toBe(0);
    expect(ctx.canUndo).toBe(false);
    expect(ctx.canRedo).toBe(true);

    // Redo stellt beide Schritte nacheinander wieder her
    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);
    expect(ctx.currentCircuit.circuitSymbols[0].circuitSymbolId).toBe(sym.circuitSymbolId);
    expect(ctx.history.pointer).toBe(1);

    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.textNotes).toHaveLength(1);
    expect(ctx.currentCircuit.textNotes[0].textNoteId).toBe(note.textNoteId);
    expect(ctx.history.pointer).toBe(2);
    expect(ctx.canRedo).toBe(false);

    // Gemeinsames Löschen (removeEntities) und anschließendes Undo
    React.act(() => {
      ctx.removeEntities([sym.circuitSymbolId], [note.textNoteId]);
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(0);
    expect(ctx.currentCircuit.textNotes).toHaveLength(0);
    expect(ctx.history.entries).toHaveLength(3);
    expect(ctx.history.entries[2].type).toBe("remove");

    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);
    expect(ctx.currentCircuit.textNotes).toHaveLength(1);
  });

  it("moves 12 elements by (4, -3) grid units as a single reversible move delta", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Move 12 Test", "Main")}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    const symbols: CircuitSymbol[] = [];
    React.act(() => {
      for (let i = 0; i < 12; i++) {
        symbols.push(
          ctx.addSymbol({ type: "not", name: "NOT" }, { x: i * 4, y: 10 + i }),
        );
      }
    });

    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(12);
    const historyLengthBeforeMove = ctx.history.entries.length;

    // Alle 12 Elemente gemeinsam um (+4, -3) Rastereinheiten verschieben
    React.act(() => {
      ctx.moveSymbols(
        symbols.map((s) => ({
          symbolId: s.circuitSymbolId,
          gridPoint: { x: s.x + 4, y: s.y - 3 },
        })),
      );
    });

    expect(ctx.history.entries).toHaveLength(historyLengthBeforeMove + 1);
    const moveDelta = ctx.history.entries[ctx.history.entries.length - 1];
    expect(moveDelta.type).toBe("move");
    if (moveDelta.type === "move") {
      expect(moveDelta.symbolIds).toHaveLength(12);
      expect(moveDelta.dx).toBe(4);
      expect(moveDelta.dy).toBe(-3);
    }

    for (let i = 0; i < 12; i++) {
      const sym = ctx.currentCircuit.circuitSymbols.find(
        (s) => s.circuitSymbolId === symbols[i].circuitSymbolId,
      )!;
      expect(sym.x).toBe(i * 4 + 4);
      expect(sym.y).toBe(10 + i - 3);
    }

    // Undo macht die Verschiebung aller 12 Elemente exakt rückgängig
    React.act(() => {
      ctx.undo();
    });

    for (let i = 0; i < 12; i++) {
      const sym = ctx.currentCircuit.circuitSymbols.find(
        (s) => s.circuitSymbolId === symbols[i].circuitSymbolId,
      )!;
      expect(sym.x).toBe(i * 4);
      expect(sym.y).toBe(10 + i);
    }

    // Redo wendet die Verschiebung (+4, -3) wieder an
    React.act(() => {
      ctx.redo();
    });

    for (let i = 0; i < 12; i++) {
      const sym = ctx.currentCircuit.circuitSymbols.find(
        (s) => s.circuitSymbolId === symbols[i].circuitSymbolId,
      )!;
      expect(sym.x).toBe(i * 4 + 4);
      expect(sym.y).toBe(10 + i - 3);
    }
  });

  it("rotates elements by 90 degrees and reverses rotation via undo and redo", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Rotate Test", "Main")}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let symA!: CircuitSymbol;
    let symB!: CircuitSymbol;
    React.act(() => {
      symA = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 4, y: 6 });
      symB = ctx.addSymbol({ type: "or", inputCount: 2, name: "OR" }, { x: 10, y: 6 });
      ctx.rotateSymbols([symA.circuitSymbolId, symB.circuitSymbolId], "clockwise");
    });

    const lastDelta = ctx.history.entries[ctx.history.entries.length - 1];
    expect(lastDelta.type).toBe("rotate");
    if (lastDelta.type === "rotate") {
      expect(lastDelta.direction).toBe("clockwise");
      expect(lastDelta.symbols).toHaveLength(2);
      expect(lastDelta.symbols[0].before.rotation).toBe("up");
      expect(lastDelta.symbols[0].after.rotation).toBe("right");
    }

    const rotatedA = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symA.circuitSymbolId)!;
    expect(rotatedA.rotation).toBe("right");

    // Undo stellt Ausrichtung "up" und Ursprungskoordinaten wieder her
    React.act(() => {
      ctx.undo();
    });
    const restoredA = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symA.circuitSymbolId)!;
    expect(restoredA.rotation).toBe("up");
    expect(restoredA.x).toBe(4);
    expect(restoredA.y).toBe(6);

    // Redo rotiert wieder nach "right"
    React.act(() => {
      ctx.redo();
    });
    const redoneA = ctx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symA.circuitSymbolId)!;
    expect(redoneA.rotation).toBe("right");
  });

  it("records before and after values on property changes and reverses them accurately", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Property Delta Test", "Main")}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let constSym!: CircuitSymbol;
    let splitterSym!: CircuitSymbol;
    React.act(() => {
      constSym = ctx.addSymbol({ type: "constant", bitWidth: 4, name: "1" }, { x: 2, y: 2 });
      splitterSym = ctx.addSymbol(
        { type: "splitter", name: "Splitter", pinCount: 4, pinBitWidth: 2, clockwise: true },
        { x: 8, y: 2 },
      );
    });

    // Eigenschaftsänderung an Konstante (bitWidth: 4 -> 8, value: 1 -> 42)
    React.act(() => {
      ctx.updateCircuitSymbolProperties(constSym.circuitSymbolId, {
        bitWidth: 8,
        value: 42,
        note: "Konstante geändert",
      });
    });

    const propDelta = ctx.history.entries[ctx.history.entries.length - 1];
    expect(propDelta.type).toBe("updateProperty");
    if (propDelta.type === "updateProperty") {
      expect(propDelta.changes.bitWidth).toEqual({ before: 4, after: 8 });
      expect(propDelta.changes.value).toEqual({ before: 1, after: 42 });
      expect(propDelta.changes.note).toEqual({ before: "", after: "Konstante geändert" });
    }

    // Eigenschaftsänderung am Splitter (clockwise: true -> false, pinCount: 4 -> 2)
    React.act(() => {
      ctx.updateCircuitSymbolProperties(splitterSym.circuitSymbolId, {
        pinCount: 2,
        pinBitWidth: 4,
        clockwise: false,
      });
    });

    const splitterAfter = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === splitterSym.circuitSymbolId,
    )!.circuit as Splitter;
    expect(splitterAfter.pinCount).toBe(2);
    expect(splitterAfter.clockwise).toBe(false);

    // Undo Splitter-Änderung -> zurück zum Von-Zustand (pinCount: 4, clockwise: true)
    React.act(() => {
      ctx.undo();
    });
    const splitterRestored = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === splitterSym.circuitSymbolId,
    )!.circuit as Splitter;
    expect(splitterRestored.pinCount).toBe(4);
    expect(splitterRestored.clockwise).toBe(true);

    // Undo Konstanten-Änderung -> zurück zum Von-Zustand (bitWidth: 4, value: 1)
    React.act(() => {
      ctx.undo();
    });
    const constRestored = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === constSym.circuitSymbolId,
    )!.circuit as Constant;
    expect(constRestored.bitWidth).toBe(4);
    expect(constRestored.value).toBe(1);
    expect(constRestored.note).toBe("");
  });

  it("truncates the redo branch only when a new action is recorded after undo", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Truncate Test", "Main")}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    React.act(() => {
      ctx.addSymbol({ type: "not", name: "NOT" }, { x: 2, y: 2 });
      ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 6, y: 2 });
      ctx.addSymbol({ type: "or", inputCount: 2, name: "OR" }, { x: 10, y: 2 });
    });

    expect(ctx.history.entries).toHaveLength(3);
    expect(ctx.history.pointer).toBe(3);

    // Zwei Schritte zurückspulen (Undo löscht den Stack noch nicht!)
    React.act(() => {
      ctx.undo();
      ctx.undo();
    });

    expect(ctx.history.entries).toHaveLength(3);
    expect(ctx.history.pointer).toBe(1);
    expect(ctx.canRedo).toBe(true);
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);

    // Jetzt eine neue Aktion ausführen -> Stack wird an Position 1 gekappt und neues Delta angehängt
    React.act(() => {
      ctx.addTextNote("Neuer Zweig", { x: 4, y: 8 });
    });

    expect(ctx.history.entries).toHaveLength(2);
    expect(ctx.history.pointer).toBe(2);
    expect(ctx.canRedo).toBe(false);
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);
    expect(ctx.currentCircuit.textNotes).toHaveLength(1);

    // Kompletten Undo-/Redo-Stack per clearHistory löschen
    React.act(() => {
      ctx.clearHistory();
    });
    expect(ctx.history.entries).toHaveLength(0);
    expect(ctx.history.pointer).toBe(0);
    expect(ctx.canUndo).toBe(false);
    expect(ctx.canRedo).toBe(false);
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);
    expect(ctx.currentCircuit.textNotes).toHaveLength(1);
  });

  it("renders Undo, Redo and Clear-History buttons with stack size tooltip in AppHeader", () => {
    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Header Test", "Main")}>
        <SimulationContextProvider>
          <AppHeader />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(html).toContain("aria-label=\"Rückgängig\"");
    expect(html).toContain("aria-label=\"Wiederherstellen\"");
    expect(html).toContain("title=\"Lösche 0 Undo/Redo Schritte\"");
  });

  it("maintains an isolated Undo/Redo stack per LogicalCircuit when switching circuits (T-028)", () => {
    const demoProject = createDemoCircuitProject();
    const mainCircuitId = demoProject.logicalCircuits[0].logicalCircuitId;
    const otherCircuitId = demoProject.logicalCircuits[1].logicalCircuitId;

    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={demoProject}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    expect(ctx.currentCircuitId).toBe(mainCircuitId);
    expect(ctx.canUndo).toBe(false);

    // Gatter auf der Hauptschaltung platzieren und verschieben
    let mainGate!: CircuitSymbol;
    React.act(() => {
      mainGate = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 10, y: 10 });
      ctx.moveSymbol(mainGate.circuitSymbolId, { x: 16, y: 14 });
    });

    expect(ctx.history.entries).toHaveLength(2);
    expect(ctx.history.pointer).toBe(2);
    expect(ctx.canUndo).toBe(true);

    const movedOnMain = ctx.project.logicalCircuits
      .find((lc) => lc.logicalCircuitId === mainCircuitId)!
      .circuitSymbols.find((s) => s.circuitSymbolId === mainGate.circuitSymbolId)!;
    expect(movedOnMain.x).toBe(16);
    expect(movedOnMain.y).toBe(14);

    // Wechsel auf eine andere Schaltung
    React.act(() => {
      ctx.setCurrentCircuitId(otherCircuitId);
    });

    expect(ctx.currentCircuitId).toBe(otherCircuitId);
    expect(ctx.history.entries).toHaveLength(0);
    expect(ctx.history.pointer).toBe(0);
    expect(ctx.canUndo).toBe(false);
    expect(ctx.canRedo).toBe(false);

    // Ein Undo auf der zweiten Schaltung darf das Gatter auf der nicht aktiven Hauptschaltung nicht verändern
    React.act(() => {
      ctx.undo();
    });

    const stillAtMovedPosOnMain = ctx.project.logicalCircuits
      .find((lc) => lc.logicalCircuitId === mainCircuitId)!
      .circuitSymbols.find((s) => s.circuitSymbolId === mainGate.circuitSymbolId)!;
    expect(stillAtMovedPosOnMain.x).toBe(16);
    expect(stillAtMovedPosOnMain.y).toBe(14);

    // Eigene Bearbeitung auf der zweiten Schaltung durchführen
    let subGate!: CircuitSymbol;
    React.act(() => {
      subGate = ctx.addSymbol({ type: "not", name: "NOT" }, { x: 4, y: 4 });
    });
    expect(ctx.history.entries).toHaveLength(1);
    expect(ctx.canUndo).toBe(true);

    // Zurückwechseln zur Hauptschaltung -> ursprünglicher Stack mit 2 Einträgen ist weiterhin intakt
    React.act(() => {
      ctx.setCurrentCircuitId(mainCircuitId);
    });
    expect(ctx.history.entries).toHaveLength(2);
    expect(ctx.history.pointer).toBe(2);
    expect(ctx.canUndo).toBe(true);

    // Undo auf der Hauptschaltung macht nun gezielt die Verschiebung auf der Hauptschaltung rückgängig
    React.act(() => {
      ctx.undo();
    });
    const revertedOnMain = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === mainGate.circuitSymbolId,
    )!;
    expect(revertedOnMain.x).toBe(10);
    expect(revertedOnMain.y).toBe(10);

    // Zweite Schaltung blieb davon unberührt und hat weiterhin ihren eigenen Stack
    const otherSymbols = ctx.project.logicalCircuits.find(
      (lc) => lc.logicalCircuitId === otherCircuitId,
    )!.circuitSymbols;
    expect(otherSymbols.some((s) => s.circuitSymbolId === subGate.circuitSymbolId)).toBe(true);

    // clearHistory auf der Hauptschaltung löscht nur den Stack der Hauptschaltung, nicht der zweiten Schaltung
    React.act(() => {
      ctx.clearHistory();
    });
    expect(ctx.history.entries).toHaveLength(0);
    expect(ctx.canUndo).toBe(false);

    React.act(() => {
      ctx.setCurrentCircuitId(otherCircuitId);
    });
    expect(ctx.history.entries).toHaveLength(1);
    expect(ctx.canUndo).toBe(true);
  });
});
