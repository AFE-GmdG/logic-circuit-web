import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type GridPoint from "../types/canvas/gridPoint";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Wire from "../types/circuit/wire";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../types/simulation/state";
import TruthState from "../types/simulation/truthState";

import CircuitTestSocket from "../simulation/truthTable/circuitTestSocket";
import {
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createMemory,
  createPinCircuit,
} from "../utils/circuitLayout";

import HelpDialog from "../components/app/helpDialog";
import MainMenu from "../components/app/mainMenu";
import TruthTableDialog, {
  formatTruthTableTsv,
  MAX_TRUTH_TABLE_FILTERS,
  normalizePastedFilterText,
  parseValidatorsHistory,
  removeValidatorFilter,
  serializeValidatorsHistory,
  sortTruthTableRows,
  toggleTruthTableSortColumn,
  upsertValidatorFilter,
} from "../components/app/truthTableDialog";

const noop = () => undefined;

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

function addPin(
  circuit: LogicalCircuit,
  pinId: string,
  pinType: "input" | "output",
  name: string,
  bitWidth: number,
  x: number,
  y: number,
  index: number,
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

function createAndTestProject() {
  const project = createEmptyCircuitProject();
  const main = project.logicalCircuits[0]!;
  main.name = "AND-Schaltung";

  const pinA = addPin(main, "pin-a", "input", "a", 1, 0, 0, 0);
  const pinB = addPin(main, "pin-b", "input", "b", 1, 0, 4, 1);
  const andSym = createCircuitSymbol(createGate("and", 2, false), main.logicalCircuitId, 8, 2, "up", "and-1");
  main.circuitSymbols.push(andSym);
  const pinQ = addPin(main, "pin-q", "output", "q", 1, 16, 2, 2);

  main.wires.push(
    makeWire("w-a", main.logicalCircuitId, pinA.jams[0]!.absolutePoint, andSym.jams[0]!.absolutePoint),
    makeWire("w-b", main.logicalCircuitId, pinB.jams[0]!.absolutePoint, andSym.jams[1]!.absolutePoint),
    makeWire("w-q", main.logicalCircuitId, andSym.jams[2]!.absolutePoint, pinQ.jams[0]!.absolutePoint),
  );
  project.circuits.set(main.logicalCircuitId, main);
  project.pins.push(...main.logicalPins);
  return { project, main };
}

function createLatchTestCircuit(): LogicalCircuit {
  const latch = createDefaultLogicalCircuit("lc-latch", "RS-Latch");
  const setPin = addPin(latch, "p-s", "input", "S", 1, 0, 0, 0);
  const resetPin = addPin(latch, "p-r", "input", "R", 1, 0, 10, 1);
  const norTop = createCircuitSymbol(createGate("or", 2, true), latch.logicalCircuitId, 6, 2, "up", "nor-top");
  const norBot = createCircuitSymbol(createGate("or", 2, true), latch.logicalCircuitId, 6, 8, "up", "nor-bot");
  latch.circuitSymbols.push(norTop, norBot);
  const qOut = addPin(latch, "p-q", "output", "Q", 1, 14, 2, 2);
  latch.wires.push(
    makeWire("w-s", latch.logicalCircuitId, setPin.jams[0]!.absolutePoint, norTop.jams[0]!.absolutePoint),
    makeWire("w-r", latch.logicalCircuitId, resetPin.jams[0]!.absolutePoint, norBot.jams[1]!.absolutePoint),
    makeWire("w-fb1", latch.logicalCircuitId, norTop.jams[2]!.absolutePoint, norBot.jams[0]!.absolutePoint),
    makeWire("w-fb2", latch.logicalCircuitId, norBot.jams[2]!.absolutePoint, norTop.jams[1]!.absolutePoint),
    makeWire("w-q", latch.logicalCircuitId, norTop.jams[2]!.absolutePoint, qOut.jams[0]!.absolutePoint),
  );
  return latch;
}

function createRamTestCircuit(): LogicalCircuit {
  const ramCircuit = createDefaultLogicalCircuit("lc-ram", "RAM-Test");
  const addrPin = addPin(ramCircuit, "p-a", "input", "A", 2, 0, 0, 0);
  const dinPin = addPin(ramCircuit, "p-d", "input", "D", 4, 0, 4, 1);
  const wrPin = addPin(ramCircuit, "p-w", "input", "W", 1, 0, 8, 2);
  const ramSym = createCircuitSymbol(
    createMemory("mem-ram", true, 2, 4, { onStart: "zeros" }),
    ramCircuit.logicalCircuitId,
    8,
    2,
    "up",
    "ram-1",
  );
  ramCircuit.circuitSymbols.push(ramSym);
  const outPin = addPin(ramCircuit, "p-o", "output", "Q", 4, 16, 2, 3);
  ramCircuit.wires.push(
    makeWire("w-1", ramCircuit.logicalCircuitId, addrPin.jams[0]!.absolutePoint, ramSym.jams[0]!.absolutePoint),
    makeWire("w-2", ramCircuit.logicalCircuitId, dinPin.jams[0]!.absolutePoint, ramSym.jams[2]!.absolutePoint),
    makeWire("w-3", ramCircuit.logicalCircuitId, wrPin.jams[0]!.absolutePoint, ramSym.jams[3]!.absolutePoint),
    makeWire("w-4", ramCircuit.logicalCircuitId, ramSym.jams[1]!.absolutePoint, outPin.jams[0]!.absolutePoint),
  );
  return ramCircuit;
}

describe("T-072: Wahrheitstabellen-Dialog (TruthTableDialog) & Integration", () => {
  it("verwaltet Filterhistorie (validators) dedupliziert bis maximal 15 Einträge und normalisiert Paste-Text", () => {
    expect(parseValidatorsHistory("")).toEqual([]);
    expect(parseValidatorsHistory("  q=a&b \t  \t s=a^b \t q=a&b ")).toEqual(["q=a&b", "s=a^b"]);

    let history: string[] = [];
    for (let i = 1; i <= 20; i++) {
      history = upsertValidatorFilter(history, `expr${i}`);
    }
    expect(history).toHaveLength(MAX_TRUTH_TABLE_FILTERS);
    expect(history[0]).toBe("expr20");

    // Vorhandenen Filter nach oben schieben
    history = upsertValidatorFilter(history, "expr10");
    expect(history).toHaveLength(MAX_TRUTH_TABLE_FILTERS);
    expect(history[0]).toBe("expr10");
    expect(history.filter((x) => x === "expr10")).toHaveLength(1);

    // Entfernen und Tab-Serialisierung
    const reduced = removeValidatorFilter(["f1", "f2", "f3"], "f2");
    expect(reduced).toEqual(["f1", "f3"]);
    expect(serializeValidatorsHistory(reduced)).toBe("f1\tf3");

    // Whitespace-Normalisierung beim Einfügen mehrzeiliger Filterausdrücke
    expect(normalizePastedFilterText("  outC << 1 |\n\t s  =  a + b  ")).toBe("outC << 1 | s = a + b");
  });

  it("sortiert Wahrheitstabellen-Zeilen einspaltig und per Shift+Klick mehrspaltig analog zu TruthStateComparer", () => {
    const makeRow = (a: number, b: number, q: number): TruthState => {
      const row = new TruthState(2, 1);
      row.input[0] = a;
      row.input[1] = b;
      row.rawStates[0] = [q ? STATE_ON1 : STATE_ON0];
      row.unpack([1]);
      return row;
    };

    const rows = [
      makeRow(0, 1, 0),
      makeRow(1, 0, 1),
      makeRow(0, 0, 1),
      makeRow(1, 1, 0),
    ];

    // Einzelspalte zyklisch: Asc -> Desc -> Unsortiert
    let sort = toggleTruthTableSortColumn([], { kind: "output", index: 0 }, false);
    expect(sort).toEqual([{ key: "output:0", kind: "output", index: 0, direction: 1 }]);
    expect(sortTruthTableRows(rows, sort).map((r) => r.output![0])).toEqual([0, 0, 1, 1]);

    sort = toggleTruthTableSortColumn(sort, { kind: "output", index: 0 }, false);
    expect(sort).toEqual([{ key: "output:0", kind: "output", index: 0, direction: -1 }]);
    expect(sortTruthTableRows(rows, sort).map((r) => r.output![0])).toEqual([1, 1, 0, 0]);

    sort = toggleTruthTableSortColumn(sort, { kind: "output", index: 0 }, false);
    expect(sort).toEqual([]);

    // Shift+Klick ergänzt sekundäre Sortierspalte
    let multi = toggleTruthTableSortColumn([], { kind: "output", index: 0 }, false);
    multi = toggleTruthTableSortColumn(multi, { kind: "input", index: 0 }, true);
    multi = toggleTruthTableSortColumn(multi, { kind: "input", index: 0 }, true); // input:0 Desc
    expect(multi).toEqual([
      { key: "output:0", kind: "output", index: 0, direction: 1 },
      { key: "input:0", kind: "input", index: 0, direction: -1 },
    ]);
    expect(
      sortTruthTableRows(rows, multi).map((r) => [r.output![0], r.input[0], r.input[1]]),
    ).toEqual([
      [0, 1, 1],
      [0, 0, 1],
      [1, 1, 0],
      [1, 0, 0],
    ]);
  });

  it("formatiert Tabellenansichten als TSV inklusive Spaltenköpfen und Tri-State-Werten", () => {
    const { main } = createAndTestProject();
    const socket = new CircuitTestSocket(main);
    const triRow = new TruthState(2, 1);
    triRow.input[0] = 1;
    triRow.input[1] = 0;
    triRow.rawStates[0] = [STATE_OFF];
    triRow.unpack([1]);

    const tsv = formatTruthTableTsv(socket.inputs, socket.outputs, [triRow]);
    expect(tsv).toBe("a\tb\tq\n1\t0\tz");
  });

  it("speichert validators in CircuitContextProvider ohne Undo-Historie zu verändern", () => {
    const { project, main } = createAndTestProject();
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    const Probe: React.FC = () => {
      capturedContext = React.useContext(CircuitContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <Probe />
      </CircuitContextProvider>,
    );

    expect(capturedContext).not.toBeNull();
    capturedContext!.updateCircuitProperties(main.logicalCircuitId, { validators: "q=a&b\ta!=b" });

    expect(capturedContext!.canUndo).toBe(false);
    expect(capturedContext!.currentCircuit.validators).toBe("q=a&b\ta!=b");
    expect(
      (capturedContext!.project.circuits.get(main.logicalCircuitId) as LogicalCircuit | undefined)?.validators,
    ).toBe("q=a&b\ta!=b");
  });

  it("rendert TruthTableDialog im geschlossenen, kombinatorischen und nicht-kombinatorischen Zustand (Warn-Banner)", () => {
    const { project } = createAndTestProject();

    const closedHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <TruthTableDialog isOpen={false} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(closedHtml).not.toContain("data-component=\"TruthTableDialog\"");

    const openHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <TruthTableDialog isOpen={true} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(openHtml).toContain("data-component=\"TruthTableDialog\"");
    expect(openHtml).toContain("Wahrheitstabelle: AND-Schaltung");
    expect(openHtml).toContain("Mögliche Kombinationen: 4");
    expect(openHtml).toContain("Angezeigte Zeilen: 4");
    expect(openHtml).toContain("Tabelle kopieren");
    expect(openHtml).not.toContain("non-combinational-warning");

    // Rückkopplungsschleife (RS-Latch) => deutlicher Warnhinweis
    const latch = createLatchTestCircuit();
    const latchHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <TruthTableDialog isOpen={true} targetCircuit={latch} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(latchHtml).toContain("non-combinational-warning");
    expect(latchHtml).toContain("Hinweis: Schaltung ist nicht rein kombinatorisch");
    expect(latchHtml).toContain("Rückkopplungsschleife");

    // RAM-Baustein => Warnhinweis inklusive RAM-Grund
    const ramCircuit = createRamTestCircuit();
    const ramHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <TruthTableDialog isOpen={true} targetCircuit={ramCircuit} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(ramHtml).toContain("non-combinational-warning");
    expect(ramHtml).toContain("RAM (schreibbar)");
  });

  it("integriert Wahrheitstabelle... (Strg+T) in MainMenu (inkl. isTestable-Status) und HelpDialog", () => {
    const disabledMenuHtml = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="circuit"
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        canDeleteCurrentCircuit={false}
        canOpenTruthTable={false}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onOpenTruthTable={noop}
        onOpenUsage={noop}
        onOpenReport={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );
    expect(disabledMenuHtml).toContain("Wahrheitstabelle...");
    expect(disabledMenuHtml).toContain("Strg+T");
    expect(disabledMenuHtml).toContain(
      "Benötigt mindestens einen Eingangs-Pin und einen Ausgangs-Pin in der aktuellen Schaltung",
    );

    const enabledMenuHtml = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="circuit"
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        canDeleteCurrentCircuit={false}
        canOpenTruthTable={true}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onOpenTruthTable={noop}
        onOpenUsage={noop}
        onOpenReport={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );
    expect(enabledMenuHtml).toContain("Wahrheitstabelle...");
    expect(enabledMenuHtml).toContain(
      "Erstellt eine interaktive Wahrheitstabelle inklusive Filterausdruck für die aktuelle Schaltung (Strg+T)",
    );

    const helpHtml = renderToStaticMarkup(<HelpDialog isOpen={true} onClose={noop} />);
    expect(helpHtml).toContain("Strg + T");
    expect(helpHtml).toContain("Wahrheitstabelle der aktiven Schaltung öffnen");
  });
});
