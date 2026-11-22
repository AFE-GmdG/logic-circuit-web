import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../../contexts/simulationContext";
import { computeCircuitCleanUpReport } from "../../hooks/useCircuitCleanUpAnalysis";

import type GridPoint from "../../types/canvas/gridPoint";
import type Wire from "../../types/circuit/wire";
import type CircuitCleanUpReport from "../../types/simulation/circuitCleanUpReport";

import CircuitMap from "../../simulation/compiler/circuitMap";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
  createSensor,
  createSplitter,
  instantiateCircuitFromPalette,
  syncProjectLogicalCircuits,
} from "../../utils/circuitLayout";
import {
  loadCleanUpVisualizationEnabled,
  saveCleanUpVisualizationEnabled,
} from "../../utils/viewPreferencesStorage";
import { formatWireCleanUpTooltip } from "../../utils/wireUtils";

import MainMenu from "../../components/app/mainMenu";
import CircuitSymbolView, { CLEANUP_DIM_OPACITY } from "../../components/circuitCanvas/circuitSymbolView";

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

describe("US-014 / T-047: Grafische CleanUp-Visualisierung & Multi-Bit-Bus-Analyse", () => {
  it("erkennt transitive Teilnetze ohne Senke sowie isolierte Senken ohne Quelle als ungenutzt", () => {
    const circuit = createDefaultLogicalCircuit("main", "CleanUpChain");

    // Aktiver Pfad: Button1 -> LED1
    const btnActive = createCircuitButton("btn-active", "Active", false, "right");
    const symBtnActive = createCircuitSymbol(btnActive, "main", 2, 2, "up", "sym-btn-active");
    const ledActive = createGate("led", 1, false, "red");
    const symLedActive = createCircuitSymbol(ledActive, "main", 8, 2, "up", "sym-led-active");
    const wireActive = makeWire(
      "w-active",
      "main",
      symBtnActive.jams[0].absolutePoint,
      symLedActive.jams[0].absolutePoint,
    );

    // Totes Teilnetz ohne Senke: ButtonDead -> NOT1 -> NOT2 (offen)
    const btnDead = createCircuitButton("btn-dead", "Dead", false, "right");
    const symBtnDead = createCircuitSymbol(btnDead, "main", 2, 8, "up", "sym-btn-dead");
    const not1 = createGate("not", 1, false);
    const symNot1 = createCircuitSymbol(not1, "main", 6, 7, "up", "sym-not-1");
    const not2 = createGate("not", 1, false);
    const symNot2 = createCircuitSymbol(not2, "main", 12, 7, "up", "sym-not-2");

    const not1In = symNot1.jams.find((j) => j.pin.pinType === "input")!;
    const not1Out = symNot1.jams.find((j) => j.pin.pinType === "output")!;
    const not2In = symNot2.jams.find((j) => j.pin.pinType === "input")!;

    const wireDead1 = makeWire("w-dead-1", "main", symBtnDead.jams[0].absolutePoint, not1In.absolutePoint);
    const wireDead2 = makeWire("w-dead-2", "main", not1Out.absolutePoint, not2In.absolutePoint);

    // Isolierte Probe ohne angeschlossene Quelle
    const isoProbe = createCircuitProbe("probe-iso");
    const symIsoProbe = createCircuitSymbol(isoProbe, "main", 2, 14, "up", "sym-probe-iso");

    circuit.circuitSymbols.push(
      symBtnActive,
      symLedActive,
      symBtnDead,
      symNot1,
      symNot2,
      symIsoProbe,
    );
    circuit.wires.push(wireActive, wireDead1, wireDead2);

    const map = new CircuitMap(circuit);
    map.prepareCleanUpAnalysis();
    const report = map.analyzeCleanUp();

    expect(report.unusedSymbolIds.has("sym-btn-active")).toBe(false);
    expect(report.unusedSymbolIds.has("sym-led-active")).toBe(false);
    expect(report.wireInfoById.get("w-active")?.isUsed).toBe(true);

    // Komplette Kette ohne Senke inklusive Start-Taster und isolierter Probe muss abgedunkelt sein
    expect(report.unusedSymbolIds.has("sym-not-2")).toBe(true);
    expect(report.unusedSymbolIds.has("sym-not-1")).toBe(true);
    expect(report.unusedSymbolIds.has("sym-btn-dead")).toBe(true);
    expect(report.unusedSymbolIds.has("sym-probe-iso")).toBe(true);
    expect(report.wireInfoById.get("w-dead-1")?.isUsed).toBe(false);
    expect(report.wireInfoById.get("w-dead-2")?.isUsed).toBe(false);
    expect(formatWireCleanUpTooltip(report.wireInfoById.get("w-dead-1"))).toContain("Ungenutzt");
  });

  it("hält einen 4-Bit-Bus mit Splitter schon bei 1 genutztem Bit aktiv und meldet Teilnutzung korrekt", () => {
    const circuit = createDefaultLogicalCircuit("main", "BusPartialTest");

    // Mehrbit-Sensor -> Mehrbit-Bus -> Splitter (vier Einzelbits)
    const sensor = createSensor("sensor-4", "clock", 4);
    const symSensor = createCircuitSymbol(sensor, "main", 2, 4, "up", "sym-sensor-4");
    const splitter = createSplitter("splitter-4", 4, 4, true);
    const symSplitter = createCircuitSymbol(splitter, "main", 10, 4, "up", "sym-splitter");

    const sensorOut = symSensor.jams.find((j) => j.pin.pinType === "output")!;
    const wideJam = symSplitter.jams.find((j) => j.pin.bitWidth === 4)!;
    const narrowJams = symSplitter.jams
      .filter((j) => j.pin.bitWidth === 1)
      .sort((a, b) => a.absolutePoint.y - b.absolutePoint.y);

    const busWire = makeWire("w-bus", "main", sensorOut.absolutePoint, wideJam.absolutePoint);

    // Nur Bit 0 wird über eine LED verbraucht
    const led0 = createGate("led", 1, false, "green");
    const symLed0 = createCircuitSymbol(led0, "main", 18, 4, "up", "sym-led-0");
    const wireBit0 = makeWire("w-bit0", "main", narrowJams[0].absolutePoint, symLed0.jams[0].absolutePoint);

    // Bit 1 führt nur in ein totes NOT-Gatter ohne Abnehmer
    const deadNot = createGate("not", 1, false);
    const symDeadNot = createCircuitSymbol(deadNot, "main", 18, 10, "up", "sym-dead-not");
    const deadNotIn = symDeadNot.jams.find((j) => j.pin.pinType === "input")!;
    const wireBit1Dead = makeWire("w-bit1-dead", "main", narrowJams[1].absolutePoint, deadNotIn.absolutePoint);

    circuit.circuitSymbols.push(symSensor, symSplitter, symLed0, symDeadNot);
    circuit.wires.push(busWire, wireBit0, wireBit1Dead);

    const map = new CircuitMap(circuit);
    map.prepareCleanUpAnalysis();
    const report = map.analyzeCleanUp();

    expect(report.unusedSymbolIds.has("sym-sensor-4")).toBe(false);
    expect(report.unusedSymbolIds.has("sym-splitter")).toBe(false);
    expect(report.unusedSymbolIds.has("sym-led-0")).toBe(false);
    expect(report.unusedSymbolIds.has("sym-dead-not")).toBe(true);

    const busInfo = report.wireInfoById.get("w-bus");
    expect(busInfo).toBeDefined();
    expect(busInfo?.bitWidth).toBe(4);
    expect(busInfo?.usedBits).toBe(1);
    expect(busInfo?.isUsed).toBe(true);
    expect(busInfo?.isPartiallyUsed).toBe(true);
    expect(formatWireCleanUpTooltip(busInfo)).toBe("Teilweise genutzt: 1 von 4 Bits aktiv");

    const bit0Info = report.wireInfoById.get("w-bit0");
    expect(bit0Info?.isUsed).toBe(true);
    expect(bit0Info?.isPartiallyUsed).toBe(false);

    // Bit-1-Leitung in totes Gatter muss als ungenutzt abgedunkelt werden
    const bit1Info = report.wireInfoById.get("w-bit1-dead");
    expect(bit1Info?.usedBits).toBe(0);
    expect(bit1Info?.isUsed).toBe(false);
  });

  it("analysiert Subschaltungen im Elternkontext sowie mit Boundary-Pins im Editiermodus fehlerfrei", () => {
    const project = createEmptyCircuitProject("SubTest", "Main");
    const mainCircuit = project.logicalCircuits[0];

    const subCircuit = createDefaultLogicalCircuit("sub-1", "PassThroughSub");
    const { pin: pinIn, pinCircuit: pinInCircuit } = createPinCircuit(
      "pin-in",
      "sub-1",
      "input",
      "A",
      1,
      "left",
    );
    const { pin: pinOut, pinCircuit: pinOutCircuit } = createPinCircuit(
      "pin-out",
      "sub-1",
      "output",
      "Y",
      1,
      "right",
    );
    const symPinIn = createCircuitSymbol(pinInCircuit, "sub-1", 2, 2, "up", "sym-pin-in");
    const symPinOut = createCircuitSymbol(pinOutCircuit, "sub-1", 10, 2, "up", "sym-pin-out");
    const subWire = makeWire(
      "w-sub",
      "sub-1",
      symPinIn.jams[0].absolutePoint,
      symPinOut.jams[0].absolutePoint,
    );

    // Ungenutztes Gatter innerhalb der Subschaltung
    const deadAnd = createGate("and", 2, false);
    const symDeadAnd = createCircuitSymbol(deadAnd, "sub-1", 6, 8, "up", "sym-sub-dead-and");

    subCircuit.circuitSymbols.push(symPinIn, symPinOut, symDeadAnd);
    subCircuit.wires.push(subWire);
    subCircuit.logicalPins.push(pinIn, pinOut);
    project.pins.push(pinIn, pinOut);

    project.logicalCircuits.push(subCircuit);
    const synced = syncProjectLogicalCircuits(project);
    const syncedSub = synced.logicalCircuits.find((lc) => lc.logicalCircuitId === "sub-1")!;
    const syncedMain = synced.logicalCircuits.find((lc) => lc.logicalCircuitId === mainCircuit.logicalCircuitId)!;

    // Im isolierten Editiermodus der Subschaltung bleiben Pin In -> Pin Out aktiv
    const subEditorReport = computeCircuitCleanUpReport(syncedSub, true);
    expect(subEditorReport).not.toBeNull();
    expect(subEditorReport?.unusedSymbolIds.has("sym-pin-in")).toBe(false);
    expect(subEditorReport?.unusedSymbolIds.has("sym-pin-out")).toBe(false);
    expect(subEditorReport?.wireInfoById.get("w-sub")?.isUsed).toBe(true);
    expect(subEditorReport?.unusedSymbolIds.has("sym-sub-dead-and")).toBe(true);

    // Einbettung in Main: eine genutzte Instanz und eine komplett ungenutzte Instanz
    const btn = createCircuitButton("btn-main", "B", false, "right");
    const symBtn = createCircuitSymbol(btn, syncedMain.logicalCircuitId, 2, 4, "up", "sym-main-btn");
    const symSubUsed = createCircuitSymbol(syncedSub, syncedMain.logicalCircuitId, 8, 4, "up", "sym-sub-used");
    const led = createGate("led", 1, false);
    const symLed = createCircuitSymbol(led, syncedMain.logicalCircuitId, 16, 4, "up", "sym-main-led");
    const symSubUnused = createCircuitSymbol(syncedSub, syncedMain.logicalCircuitId, 8, 12, "up", "sym-sub-unused");

    const subInJam = symSubUsed.jams.find((j) => j.pin.pinType === "input")!;
    const subOutJam = symSubUsed.jams.find((j) => j.pin.pinType === "output")!;
    const wMain1 = makeWire("w-m-1", syncedMain.logicalCircuitId, symBtn.jams[0].absolutePoint, subInJam.absolutePoint);
    const wMain2 = makeWire("w-m-2", syncedMain.logicalCircuitId, subOutJam.absolutePoint, symLed.jams[0].absolutePoint);

    syncedMain.circuitSymbols.push(symBtn, symSubUsed, symLed, symSubUnused);
    syncedMain.wires.push(wMain1, wMain2);

    const rootMap = new CircuitMap(syncedMain);
    rootMap.prepareCleanUpAnalysis();
    const mainReport = rootMap.analyzeCleanUp();

    expect(mainReport.unusedSymbolIds.has("sym-sub-used")).toBe(false);
    expect(mainReport.unusedSymbolIds.has("sym-sub-unused")).toBe(true);

    const childMap = rootMap.child(symSubUsed);
    expect(childMap).toBeDefined();
    const childReport = childMap!.analyzeCleanUp();
    expect(childReport.unusedSymbolIds.has("sym-pin-in")).toBe(false);
    expect(childReport.unusedSymbolIds.has("sym-pin-out")).toBe(false);
    expect(childReport.unusedSymbolIds.has("sym-sub-dead-and")).toBe(true);
  });

  it("bricht die Analyse bei Kompilierungsfehlern (z. B. Bitbreiten-Konflikt) sicher ab", () => {
    const circuit = createDefaultLogicalCircuit("main", "BrokenCircuit");
    const sensor4 = createSensor("s4", "manual", 4);
    const symSensor = createCircuitSymbol(sensor4, "main", 2, 2, "up", "sym-s4");
    const led1 = createGate("led", 1, false);
    const symLed = createCircuitSymbol(led1, "main", 8, 2, "up", "sym-l1");
    const w = makeWire(
      "w-bad",
      "main",
      symSensor.jams[0].absolutePoint,
      symLed.jams[0].absolutePoint,
    );
    circuit.circuitSymbols.push(symSensor, symLed);
    circuit.wires.push(w);

    expect(computeCircuitCleanUpReport(circuit)).toBeNull();
  });

  it("rendert MainMenu-Schalter, CircuitSymbolView-Dimming und persistiert UI-Option in localStorage", () => {
    const mockMap = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => mockMap.get(key) ?? null,
        setItem: (key: string, value: string) => mockMap.set(key, value),
      },
    });

    try {
      expect(loadCleanUpVisualizationEnabled()).toBe(false);
      saveCleanUpVisualizationEnabled(true);
      expect(loadCleanUpVisualizationEnabled()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }

    const noop = () => {};
    const menuHtml = renderToStaticMarkup(
      React.createElement(MainMenu, {
        isOpen: true,
        initialCategory: "view",
        isSimulating: false,
        isPaused: false,
        isRunning: false,
        canUndo: false,
        canRedo: false,
        hasSelection: false,
        hasSymbolSelection: false,
        canDeleteCurrentCircuit: false,
        isCleanUpVisualizationEnabled: true,
        onToggleCleanUpVisualization: noop,
        onClose: noop,
        onNewProject: noop,
        onLoadDemo: noop,
        onImportProject: noop,
        onSaveProject: noop,
        onSaveProjectAs: noop,
        onExportImage: noop,
        onOpenProjectSettings: noop,
        onUndo: noop,
        onRedo: noop,
        onDeleteSelected: noop,
        onRotateRight: noop,
        onRotateLeft: noop,
        onEditCurrentCircuit: noop,
        onCreateCircuit: noop,
        onDeleteCurrentCircuit: noop,
        onToggleSimulation: noop,
        onStepSimulation: noop,
        onStopSimulation: noop,
        onOpenOptions: noop,
        onOpenHelp: noop,
      }),
    );

    expect(menuHtml).toContain("CleanUp-Visualisierung");
    expect(menuHtml).toContain("role=\"menuitemcheckbox\"");
    expect(menuHtml).toContain("aria-checked=\"true\"");
    expect(menuHtml).toContain("✓");

    const dummyGate = createGate("and", 2, false);
    const dummySym = createCircuitSymbol(dummyGate, "main", 4, 4, "up", "sym-dim-test");
    const emptyReport: CircuitCleanUpReport = {
      circuitId: "main",
      unusedSymbolIds: new Set(["sym-dim-test"]),
      wireInfoById: new Map(),
      unusedCount: 1,
    };

    const symHtml = renderToStaticMarkup(
      React.createElement(
        SimulationContext.Provider,
        {
          value: {
            ...DEFAULT_SIMULATION_STATE,
            cleanUpReport: emptyReport,
          },
        },
        React.createElement(
          "svg",
          null,
          React.createElement(CircuitSymbolView, {
            symbol: dummySym,
            isCleanUpDimmed: true,
          }),
        ),
      ),
    );

    expect(symHtml).toContain("data-cleanup-unused=\"true\"");
    expect(symHtml).toContain(`opacity="${CLEANUP_DIM_OPACITY}"`);
    expect(symHtml).toContain("Ungenutzt (kein aktiver Signalpfad)");
  });

  it("hält paletten-erzeugte Out-Pins im Editiermodus aktiv, dunkelt sie im Root-Run ohne Eltern jedoch ab", () => {
    const project = createEmptyCircuitProject("PinTestProj", "Main");
    const mainCircuit = project.logicalCircuits[0];
    const cid = mainCircuit.logicalCircuitId;

    const { circuitSymbol: btnC } = instantiateCircuitFromPalette(
      project,
      cid,
      { type: "button", name: "Button", notation: "Button C" },
      { x: 4, y: 4 },
    );
    const { circuitSymbol: btnD } = instantiateCircuitFromPalette(
      project,
      cid,
      { type: "button", name: "Button", notation: "Button D" },
      { x: 4, y: 8 },
    );
    const { circuitSymbol: orGate } = instantiateCircuitFromPalette(
      project,
      cid,
      { type: "or", name: "OR", inputCount: 2 },
      { x: 16, y: 5 },
    );
    const { circuitSymbol: pinQ } = instantiateCircuitFromPalette(
      project,
      cid,
      { type: "pinOut", name: "Q", notation: "Q" },
      { x: 25, y: 6 },
    );
    const { circuitSymbol: loosePinOut } = instantiateCircuitFromPalette(
      project,
      cid,
      { type: "pinOut", name: "IdleQ", notation: "IdleQ" },
      { x: 25, y: 12 },
    );

    const orIn1 = orGate.jams.find((j) => j.pin.pinType === "input" && j.pin.name === "In 1")!;
    const orIn2 = orGate.jams.find((j) => j.pin.pinType === "input" && j.pin.name === "In 2")!;
    const orOut = orGate.jams.find((j) => j.pin.pinType === "output")!;

    const w1 = makeWire("w-c", cid, btnC.jams[0].absolutePoint, orIn1.absolutePoint);
    const w2 = makeWire("w-d", cid, btnD.jams[0].absolutePoint, orIn2.absolutePoint);
    const w3 = makeWire("w-q", cid, orOut.absolutePoint, pinQ.jams[0].absolutePoint);
    mainCircuit.circuitSymbols.push(btnC, btnD, orGate, pinQ, loosePinOut);
    mainCircuit.wires.push(w1, w2, w3);

    // Editiermodus: Verdrahteter Out-Pin zählt als aktiver Ausgangsport, unverbundener Out-Pin bleibt abgedunkelt
    const editorReport = computeCircuitCleanUpReport(mainCircuit, true);
    expect(editorReport).not.toBeNull();
    expect(editorReport?.unusedSymbolIds.has(btnC.circuitSymbolId)).toBe(false);
    expect(editorReport?.unusedSymbolIds.has(btnD.circuitSymbolId)).toBe(false);
    expect(editorReport?.unusedSymbolIds.has(orGate.circuitSymbolId)).toBe(false);
    expect(editorReport?.unusedSymbolIds.has(pinQ.circuitSymbolId)).toBe(false);
    expect(editorReport?.unusedSymbolIds.has(loosePinOut.circuitSymbolId)).toBe(true);
    expect(editorReport?.wireInfoById.get("w-c")?.isUsed).toBe(true);
    expect(editorReport?.wireInfoById.get("w-d")?.isUsed).toBe(true);
    expect(editorReport?.wireInfoById.get("w-q")?.isUsed).toBe(true);

    // Simulationsmodus als eigenständige Root-Schaltung: Ohne Elternschaltung optimiert CircuitMap Root-Pins weg
    const rootSimReport = computeCircuitCleanUpReport(mainCircuit, false);
    expect(rootSimReport).not.toBeNull();
    expect(rootSimReport?.unusedSymbolIds.has(btnC.circuitSymbolId)).toBe(true);
    expect(rootSimReport?.unusedSymbolIds.has(orGate.circuitSymbolId)).toBe(true);
    expect(rootSimReport?.unusedSymbolIds.has(pinQ.circuitSymbolId)).toBe(true);
    expect(rootSimReport?.wireInfoById.get("w-q")?.isUsed).toBe(false);
  });
});
