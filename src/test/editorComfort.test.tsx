import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type TextNote from "../types/circuit/textNote";
import type Wire from "../types/circuit/wire";

import {
  createCircuitSymbol,
  createEmptyCircuitProject,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";
import { buildClipboardXml, prepareClipboardPaste } from "../utils/clipboardUtils";
import {
  createFloatingMoveState,
  createFloatingPasteState,
  getFloatingPasteBoundingBox,
  getRubberbandPreviewSegments,
  rotateFloatingState,
  translateFloatingState,
} from "../utils/floatingPasteUtils";
import { navigateToSimulationErrorLocation } from "../utils/simulationNavigation";
import { createWire } from "../utils/wireUtils";

import HelpDialog from "../components/app/helpDialog";
import MainMenu from "../components/app/mainMenu";
import SimulationErrorDialog from "../components/app/simulationErrorDialog";
import CanvasContextMenu, {
  buildCanvasContextMenuItems,
  resolveWireSplitPoint,
} from "../components/circuitCanvas/canvasContextMenu";
import FloatingPasteLayer from "../components/circuitCanvas/floatingPasteLayer";
import TelemetryFooter from "../components/runningCircuitTree/telemetryFooter";
import StatusBar from "../components/statusBar";

const noop = () => undefined;

describe("T-044: Editor-Komfort, Kontextmenüs & UI-Fehlerdialog bei CircuitException", () => {
  it("moveEntities unterstützt Rubberbanding für explizit ausgewählte Leitungen sowie Shift-Opt-Out und Undo", () => {
    const project = createEmptyCircuitProject("MoveRubberbandTest", "Main");
    let capturedCtx!: React.ContextType<typeof CircuitContext>;

    const Capture: React.FC = () => {
      capturedCtx = React.useContext(CircuitContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <Capture />
      </CircuitContextProvider>,
    );

    let selectedWire!: Wire;
    let attachedWire!: Wire;
    React.act(() => {
      selectedWire = capturedCtx.addWire({ x: 4, y: 4 }, { x: 10, y: 4 })!;
      attachedWire = capturedCtx.addWire({ x: 10, y: 4 }, { x: 10, y: 8 })!;
      capturedCtx.clearHistory();
    });

    // Standardverschiebung (withWires !== false): angehängter Endpunkt der Nachbarleitung wandert per Rubberbanding mit
    React.act(() => {
      capturedCtx.moveEntities({
        dx: 0,
        dy: 2,
        symbolIds: [],
        textNoteIds: [],
        wireIds: [selectedWire.wireId],
        withWires: true,
      });
    });

    const movedSel1 = capturedCtx.currentCircuit.wires.find((w) => w.wireId === selectedWire.wireId)!;
    const movedAtt1 = capturedCtx.currentCircuit.wires.find((w) => w.wireId === attachedWire.wireId)!;
    expect(movedSel1.point1).toEqual({ x: 4, y: 6 });
    expect(movedSel1.point2).toEqual({ x: 10, y: 6 });
    expect(movedAtt1.point1).toEqual({ x: 10, y: 6 });
    expect(movedAtt1.point2).toEqual({ x: 10, y: 8 });
    expect(capturedCtx.history.entries).toHaveLength(1);

    React.act(() => {
      capturedCtx.undo();
    });

    // Mit Shift (withWires: false): kein Rubberbanding an der Nachbarleitung
    React.act(() => {
      capturedCtx.moveEntities({
        dx: 0,
        dy: 2,
        symbolIds: [],
        textNoteIds: [],
        wireIds: [selectedWire.wireId],
        withWires: false,
      });
    });

    const movedSel2 = capturedCtx.currentCircuit.wires.find((w) => w.wireId === selectedWire.wireId)!;
    const movedAtt2 = capturedCtx.currentCircuit.wires.find((w) => w.wireId === attachedWire.wireId)!;
    expect(movedSel2.point1).toEqual({ x: 4, y: 6 });
    expect(movedSel2.point2).toEqual({ x: 10, y: 6 });
    expect(movedAtt2.point1).toEqual({ x: 10, y: 4 });
    expect(movedAtt2.point2).toEqual({ x: 10, y: 8 });
  });

  it("createFloatingPasteState richtet die obere linke Ecke der Auswahl exakt an der Kontextmenü-Klickposition aus", () => {
    const project = createEmptyCircuitProject("PasteAnchorTest", "Main");
    const circuit = project.logicalCircuits[0];

    const andGate = instantiateCircuitFromPalette(
      project,
      circuit.logicalCircuitId,
      { type: "and", name: "AND", inputCount: 2 },
      { x: 2, y: 3 },
    );
    const orGate = instantiateCircuitFromPalette(
      project,
      circuit.logicalCircuitId,
      { type: "or", name: "OR", inputCount: 2 },
      { x: 9, y: 8 },
    );

    const symA = andGate.circuitSymbol;
    const symB = orGate.circuitSymbol;
    circuit.circuitSymbols.push(symA, symB);

    const xml = buildClipboardXml(
      project,
      circuit,
      [symA.circuitSymbolId, symB.circuitSymbolId],
      [],
      [],
    );
    const prepared = prepareClipboardPaste(xml, project, circuit.logicalCircuitId);
    const floatingState = createFloatingPasteState(prepared, circuit, null, { x: 20, y: 15 });
    const box = getFloatingPasteBoundingBox(floatingState.payload);

    expect(box).not.toBeNull();
    expect(box!.minX).toBe(20);
    expect(box!.minY).toBe(15);
  });

  it("aktiviert Strg+A im MainMenu und dokumentiert neue Kürzel in HelpDialog und StatusBar", () => {
    const menuEnabledHtml = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="edit"
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        hasCircuitElements={true}
        canDeleteCurrentCircuit={false}
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
        onSelectAll={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );

    expect(menuEnabledHtml).toContain("Alles auswählen");
    expect(menuEnabledHtml).toContain("Strg+A");
    expect(menuEnabledHtml).not.toContain("Folgt in US-013 (Editor-Komfort)");

    const helpHtml = renderToStaticMarkup(<HelpDialog isOpen={true} onClose={noop} />);
    expect(helpHtml).toContain("Strg + A");
    expect(helpHtml).toContain("Strg + C / Strg + X / Strg + V");
    expect(helpHtml).toContain("Pfeiltasten / Shift + Pfeiltasten");

    const statusHtml = renderToStaticMarkup(
      <CanvasContextProvider>
        <SimulationContext.Provider value={DEFAULT_SIMULATION_STATE}>
          <StatusBar />
        </SimulationContext.Provider>
      </CanvasContextProvider>,
    );
    expect(statusHtml).toContain("Simulation beenden / Editiermodus (Shift+F5)");
  });

  it("erstellt zielspezifische Canvas-Kontextmenüs inklusive Leitung-Auftrennen-Prüfung", () => {
    const project = createEmptyCircuitProject("ContextMenuTest", "Main");
    const mainCircuit = project.logicalCircuits[0];
    const subCircuit: LogicalCircuit = {
      ...project.logicalCircuits[0],
      logicalCircuitId: "sub-id",
      name: "SubChip",
      circuitId: "sub-id",
      kind: "logicalCircuit",
    };

    const gateInst = instantiateCircuitFromPalette(
      project,
      mainCircuit.logicalCircuitId,
      { type: "and", name: "AND", inputCount: 2 },
      { x: 4, y: 4 },
    );
    const gateSym: CircuitSymbol = gateInst.circuitSymbol;
    const subSym: CircuitSymbol = createCircuitSymbol(subCircuit, mainCircuit.logicalCircuitId, 10, 4);
    const textNote: TextNote = {
      textNoteId: "note-1",
      logicalCircuitId: mainCircuit.logicalCircuitId,
      x: 2,
      y: 2,
      width: 4,
      height: 2,
      rotation: "up",
      note: "Hinweis",
    };
    const wire = createWire(mainCircuit.logicalCircuitId, { x: 4, y: 10 }, { x: 12, y: 10 });

    expect(resolveWireSplitPoint(wire, { x: 8, y: 10 })).toEqual({ x: 8, y: 10 });
    expect(resolveWireSplitPoint(wire, { x: 4, y: 10 })).toBeNull();
    expect(resolveWireSplitPoint(wire, { x: 8, y: 14 })).toBeNull();

    const baseHandlers = {
      selectedCount: 1,
      canPaste: true,
      hasCircuitElements: true,
      canRotateSelection: true,
      onCut: noop,
      onCopy: noop,
      onPasteAt: noop,
      onDeleteSelected: noop,
      onSelectAll: noop,
      onRotateRight: noop,
      onRotateLeft: noop,
      onOpenSubCircuit: noop,
      onEditSymbol: noop,
      onEditTextNote: noop,
      onEditCurrentCircuit: noop,
      onSelectConductor: noop,
      onSplitWire: noop,
    };

    const canvasItems = buildCanvasContextMenuItems({
      ...baseHandlers,
      target: { kind: "canvas", gridPoint: { x: 6, y: 6 }, screenX: 100, screenY: 100 },
    });
    expect(canvasItems.map((i) => i.label)).toEqual(["Einfügen", "Alles auswählen", "Eigenschaften..."]);

    const noteItems = buildCanvasContextMenuItems({
      ...baseHandlers,
      target: { kind: "textNote", textNote, gridPoint: { x: 2, y: 2 }, screenX: 120, screenY: 120 },
    });
    expect(noteItems.map((i) => i.label)).toEqual(["Ausschneiden", "Kopieren", "Löschen", "Eigenschaften..."]);
    expect(noteItems.some((i) => i.label.includes("Bearbeiten"))).toBe(false);

    const subItems = buildCanvasContextMenuItems({
      ...baseHandlers,
      target: { kind: "symbol", symbol: subSym, gridPoint: { x: 10, y: 4 }, screenX: 160, screenY: 160 },
    });
    expect(subItems.some((i) => i.label === "Schaltung öffnen")).toBe(true);
    expect(subItems.some((i) => i.label === "Eigenschaften...")).toBe(true);

    const gateItems = buildCanvasContextMenuItems({
      ...baseHandlers,
      target: { kind: "symbol", symbol: gateSym, gridPoint: { x: 4, y: 4 }, screenX: 140, screenY: 140 },
    });
    expect(gateItems.some((i) => i.label === "Schaltung öffnen")).toBe(false);
    expect(gateItems.some((i) => i.label === "Rechts drehen")).toBe(true);

    const wireInteriorItems = buildCanvasContextMenuItems({
      ...baseHandlers,
      target: { kind: "wire", wire, gridPoint: { x: 8, y: 10 }, screenX: 200, screenY: 200 },
    });
    const splitInterior = wireInteriorItems.find((i) => i.id === "ctx-split-wire");
    expect(splitInterior?.disabled).toBe(false);
    expect(wireInteriorItems.some((i) => i.label === "Gesamte Leitung / Netz auswählen")).toBe(true);

    const wireEndpointItems = buildCanvasContextMenuItems({
      ...baseHandlers,
      target: { kind: "wire", wire, gridPoint: { x: 4, y: 10 }, screenX: 200, screenY: 200 },
    });
    const splitEndpoint = wireEndpointItems.find((i) => i.id === "ctx-split-wire");
    expect(splitEndpoint?.disabled).toBe(true);

    const menuHtml = renderToStaticMarkup(
      <CanvasContextMenu
        {...baseHandlers}
        onClose={noop}
        target={{ kind: "wire", wire, gridPoint: { x: 8, y: 10 }, screenX: 200, screenY: 200 }}
      />,
    );
    expect(menuHtml).toContain("data-component=\"ContextMenuPopup\"");
    expect(menuHtml).toContain("Leitung hier auftrennen");
    expect(menuHtml).toContain("Gesamte Leitung / Netz auswählen");
  });

  it("fängt CircuitException beim Simulationsstart sauber ab, zeigt SimulationErrorDialog und navigiert zum Fehlerbauteil", async () => {
    const project = createEmptyCircuitProject("SimErrorDialogTest", "Main");
    let circuitCtx!: React.ContextType<typeof CircuitContext>;
    let simCtx!: React.ContextType<typeof SimulationContext>;

    const Capture: React.FC = () => {
      circuitCtx = React.useContext(CircuitContext);
      simCtx = React.useContext(SimulationContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <Capture />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    let conflictGateId = "";
    let conflictGatePoint = { x: 10, y: 4 };
    React.act(() => {
      const c1 = circuitCtx.addSymbol({ type: "constant", name: "C1" }, { x: 2, y: 4 });
      const c2 = circuitCtx.addSymbol({ type: "constant", name: "C2" }, { x: 2, y: 8 });
      const gate = circuitCtx.addSymbol({ type: "and", name: "AND", inputCount: 2 }, { x: 10, y: 4 });
      conflictGateId = gate.circuitSymbolId;
      conflictGatePoint = { x: gate.x, y: gate.y };

      const out1 = c1.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
      const out2 = c2.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
      const in1 = gate.jams.filter((j) => j.pin.pinType === "input")[0].absolutePoint;

      // Beide Konstanten-Ausgänge kurzschließen auf denselben Eingang -> CircuitException
      circuitCtx.addWire(out1, in1);
      circuitCtx.addWire(out2, in1);
    });

    await React.act(async () => {
      await simCtx.startSimulation(circuitCtx.currentCircuit);
    });

    expect(simCtx.isSimulating).toBe(false);
    expect(simCtx.simulationError).not.toBeNull();
    expect(simCtx.simulationError!.message).toContain("Mehrere Signalquellen");
    expect(simCtx.simulationError!.location?.symbolId).toBe(conflictGateId);
    expect(simCtx.simulationError!.location?.x).toBe(conflictGatePoint.x);

    const dialogHtml = renderToStaticMarkup(
      <CircuitContext.Provider value={circuitCtx}>
        <SimulationContext.Provider value={simCtx}>
          <CanvasContextProvider>
            <SimulationErrorDialog />
          </CanvasContextProvider>
        </SimulationContext.Provider>
      </CircuitContext.Provider>,
    );

    expect(dialogHtml).toContain("data-component=\"SimulationErrorDialog\"");
    expect(dialogHtml).toContain("Springe zu Fehler");
    expect(dialogHtml).toContain("Mehrere Signalquellen");

    const highlightSpy = vi.fn();
    const focusSpy = vi.fn();
    React.act(() => {
      navigateToSimulationErrorLocation({
        location: simCtx.simulationError!.location!,
        isSimulating: simCtx.isSimulating,
        currentCircuitId: circuitCtx.currentCircuit.logicalCircuitId,
        stopSimulation: simCtx.stopSimulation,
        clearSimulationError: simCtx.clearSimulationError,
        setCurrentCircuitId: circuitCtx.setCurrentCircuitId,
        selectEntities: circuitCtx.selectEntities,
        highlightAiElements: highlightSpy,
        focusGridPoint: focusSpy,
      });
    });

    expect(simCtx.simulationError).toBeNull();
    expect(circuitCtx.selectedSymbolIds).toEqual([conflictGateId]);
    expect(highlightSpy).toHaveBeenCalledWith({ symbolIds: [conflictGateId] });
    expect(focusSpy).toHaveBeenCalledWith(
      { x: conflictGatePoint.x, y: conflictGatePoint.y },
      project.logicalCircuits[0].logicalCircuitId,
    );
  });

  it("erkennt Oszillation samt Verursacher-Position und bietet Springe zu Fehler in TelemetryFooter", async () => {
    const project = createEmptyCircuitProject("OscillationLocTest", "Main");
    let circuitCtx!: React.ContextType<typeof CircuitContext>;
    let simCtx!: React.ContextType<typeof SimulationContext>;

    const Capture: React.FC = () => {
      circuitCtx = React.useContext(CircuitContext);
      simCtx = React.useContext(SimulationContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <Capture />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    let notId = "";
    React.act(() => {
      const c1 = circuitCtx.addSymbol({ type: "constant", name: "C1", value: 1 }, { x: 2, y: 4 });
      const andSym = circuitCtx.addSymbol({ type: "and", name: "AND", inputCount: 2 }, { x: 8, y: 4 });
      const notSym = circuitCtx.addSymbol({ type: "not", name: "NOT" }, { x: 16, y: 4 });
      const probeSym = circuitCtx.addSymbol({ type: "probe", name: "OutProbe" }, { x: 22, y: 4 });
      notId = notSym.circuitSymbolId;

      const c1Out = c1.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
      const andIns = andSym.jams.filter((j) => j.pin.pinType === "input");
      const andOut = andSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
      const notIn = notSym.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;
      const notOut = notSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
      const probeIn = probeSym.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;

      circuitCtx.addWire(c1Out, andIns[0].absolutePoint);
      circuitCtx.addWire(andOut, notIn);
      circuitCtx.addWire(notOut, andIns[1].absolutePoint);
      circuitCtx.addWire(notOut, probeIn);
    });

    await React.act(async () => {
      await simCtx.step(1, circuitCtx.currentCircuit);
    });

    expect(simCtx.isOscillating).toBe(true);
    expect(simCtx.oscillationLocation?.symbolId).toBeTruthy();
    expect([notId, circuitCtx.currentCircuit.circuitSymbols[1].circuitSymbolId]).toContain(
      simCtx.oscillationLocation?.symbolId,
    );
    expect(simCtx.simulationError?.isOscillation).toBe(true);

    const footerHtml = renderToStaticMarkup(
      <CircuitContext.Provider value={circuitCtx}>
        <SimulationContext.Provider value={simCtx}>
          <CanvasContextProvider>
            <TelemetryFooter
              actualFrequency={0}
              frameRateLimit={30}
              isRunning={false}
              isPaused={true}
              isOscillating={true}
            />
          </CanvasContextProvider>
        </SimulationContext.Provider>
      </CircuitContext.Provider>,
    );

    expect(footerHtml).toContain("⚠️ Schaltung oszilliert");
    expect(footerHtml).toContain("Springe zu Fehler");
  });

  it("aktiviert bei Pfeiltastenverschiebung den Schwebemodus ohne vorzeitige Leitungsaktivierung und bündelt zu einem Undo", () => {
    const project = createEmptyCircuitProject("FloatingArrowMoveTest", "Main");
    let capturedCtx!: React.ContextType<typeof CircuitContext>;

    const Capture: React.FC = () => {
      capturedCtx = React.useContext(CircuitContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <Capture />
      </CircuitContextProvider>,
    );

    let symId = "";
    let otherSymId = "";
    let externalWireId = "";
    let initialSymX = 0;
    let initialSymY = 0;

    React.act(() => {
      const movingSym = capturedCtx.addSymbol({ type: "and", name: "AND", inputCount: 2 }, { x: 4, y: 4 });
      const otherSym = capturedCtx.addSymbol({ type: "or", name: "OR", inputCount: 2 }, { x: 11, y: 4 });
      symId = movingSym.circuitSymbolId;
      otherSymId = otherSym.circuitSymbolId;
      initialSymX = movingSym.x;
      initialSymY = movingSym.y;
      const outJam = movingSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
      const wire = capturedCtx.addWire(outJam, { x: 11, y: outJam.y })!;
      externalWireId = wire.wireId;
      capturedCtx.clearHistory();
    });

    // Erste Pfeiltaste aktiviert den Schwebemodus ohne Veränderung an project oder History
    let floating = createFloatingMoveState(capturedCtx.currentCircuit, {
      symbolIds: [symId],
      textNoteIds: [],
      wireIds: [],
      dx: 1,
      dy: 0,
      withWires: true,
    })!;

    expect(floating).not.toBeNull();
    expect(floating.mode).toBe("move");
    expect(floating.hasOverlapWarning).toBe(false);
    expect(floating.moveMeta?.dx).toBe(1);
    expect(floating.moveMeta?.dy).toBe(0);
    expect(floating.moveMeta?.rubberbandPreviewWires).toHaveLength(1);
    expect(capturedCtx.history.entries).toHaveLength(0);
    expect(capturedCtx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symId)!.x).toBe(initialSymX);

    // Weitere Pfeiltasten verschieben nur das schwebende Overlay (mit Erkennung fremder Kollisionen)
    floating = translateFloatingState(floating, 1, 0, capturedCtx.currentCircuit);
    floating = translateFloatingState(floating, 5, 0, capturedCtx.currentCircuit);
    expect(floating.moveMeta?.dx).toBe(7);
    expect(floating.hasOverlapWarning).toBe(true);
    expect(floating.overlappingSymbolIds).toContain(symId);
    expect(floating.overlappingSymbolIds).not.toContain(otherSymId);

    // Zurückschieben an freie Stelle (+2, +1 insgesamt)
    floating = translateFloatingState(floating, -5, 1, capturedCtx.currentCircuit);
    expect(floating.hasOverlapWarning).toBe(false);
    expect(floating.moveMeta?.dx).toBe(2);
    expect(floating.moveMeta?.dy).toBe(1);

    const previewSegments = getRubberbandPreviewSegments(floating.moveMeta);
    expect(previewSegments).toHaveLength(1);
    expect(previewSegments[0].point2).toEqual({ x: 11, y: previewSegments[0].y2 });

    const layerHtml = renderToStaticMarkup(
      <svg>
        <FloatingPasteLayer floatingPaste={floating} onStartFloatingDrag={noop} />
      </svg>,
    );
    expect(layerHtml).toContain("data-floating-mode=\"move\"");
    expect(layerHtml).toContain("floating-rubberband-wires");
    expect(capturedCtx.history.entries).toHaveLength(0);

    // Erst beim Ablegen entsteht genau EIN Undo-Eintrag
    React.act(() => {
      capturedCtx.moveEntities({
        dx: floating.moveMeta!.dx,
        dy: floating.moveMeta!.dy,
        symbolIds: floating.moveMeta!.symbolIds,
        textNoteIds: floating.moveMeta!.textNoteIds,
        wireIds: floating.moveMeta!.wireIds,
        withWires: floating.moveMeta!.withWires,
      });
    });

    expect(capturedCtx.history.entries).toHaveLength(1);
    const movedSym = capturedCtx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symId)!;
    expect(movedSym.x).toBe(initialSymX + 2);
    expect(movedSym.y).toBe(initialSymY + 1);
    const stretchedWire = capturedCtx.currentCircuit.wires.find((w) => w.wireId === externalWireId)!;
    expect(stretchedWire.y1).toBe(movedSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint.y);

    // Ein einziges Undo setzt alle Teilschritte inkl. Rubberband-Leitung vollständig zurück
    React.act(() => {
      capturedCtx.undo();
    });
    const revertedSym = capturedCtx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symId)!;
    expect(revertedSym.x).toBe(initialSymX);
    expect(revertedSym.y).toBe(initialSymY);
    const revertedWire = capturedCtx.currentCircuit.wires.find((w) => w.wireId === externalWireId)!;
    expect(revertedWire.y1).toBe(revertedSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint.y);

    // Shift deaktiviert Rubberbanding dauerhaft für den schwebenden Verschiebevorgang
    const shiftFloating = translateFloatingState(floating, 1, 0, capturedCtx.currentCircuit, {
      withWires: false,
    });
    expect(shiftFloating.moveMeta?.withWires).toBe(false);
    expect(getRubberbandPreviewSegments(shiftFloating.moveMeta)).toHaveLength(0);
  });

  it("aktiviert bei R / Shift+R / L den Schwebemodus mit Rubberbanding-Vorschau und genau einem Undo beim Ablegen", () => {
    const project = createEmptyCircuitProject("FloatingRotateTest", "Main");
    let capturedCtx!: React.ContextType<typeof CircuitContext>;

    const Capture: React.FC = () => {
      capturedCtx = React.useContext(CircuitContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <Capture />
      </CircuitContextProvider>,
    );

    let symId = "";
    let wireId = "";
    let initialSymX = 0;
    let initialSymY = 0;
    let initialRotation = "right";
    let initialWireX1 = 0;
    let initialWireY1 = 0;

    React.act(() => {
      const sym = capturedCtx.addSymbol({ type: "and", name: "AND", inputCount: 2 }, { x: 6, y: 6 });
      symId = sym.circuitSymbolId;
      initialSymX = sym.x;
      initialSymY = sym.y;
      initialRotation = sym.rotation;
      const outJam = sym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
      const wire = capturedCtx.addWire(outJam, { x: 14, y: outJam.y })!;
      wireId = wire.wireId;
      initialWireX1 = wire.x1;
      initialWireY1 = wire.y1;
      capturedCtx.clearHistory();
    });

    // Erstes R aktiviert Schwebemodus mit Rechtsdrehung ohne vorzeitige Projekt-/History-Änderung
    let floating = createFloatingMoveState(capturedCtx.currentCircuit, {
      symbolIds: [symId],
      textNoteIds: [],
      wireIds: [],
      dx: 0,
      dy: 0,
      withWires: true,
      initialRotation: "clockwise",
    })!;

    expect(floating).not.toBeNull();
    expect(floating.mode).toBe("move");
    expect(initialRotation).toBe("up");
    expect(floating.payload.symbols[0].symbol.rotation).toBe("right");
    expect(capturedCtx.history.entries).toHaveLength(0);
    expect(capturedCtx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symId)!.rotation).toBe(
      initialRotation,
    );

    // Kombinierte Verschiebung + Linksdrehung (Shift+R / L) im selben Schwebemodus
    floating = translateFloatingState(floating, 2, -1, capturedCtx.currentCircuit);
    floating = rotateFloatingState(floating, "counterClockwise", capturedCtx.currentCircuit);
    expect(floating.payload.symbols[0].symbol.rotation).toBe("up");

    // Erneutes R dreht wieder auf "right" und Rubberband-Vorschau zeigt exakt auf den rotierten + verschobenen Ausgangs-Pin
    floating = rotateFloatingState(floating, "clockwise", capturedCtx.currentCircuit);
    const previewSym = floating.payload.symbols[0].symbol;
    expect(previewSym.rotation).toBe("right");
    const previewOutJam = previewSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const previewSegments = getRubberbandPreviewSegments(floating.moveMeta, floating.payload);
    expect(previewSegments).toHaveLength(1);
    expect(previewSegments[0].point1).toEqual(previewOutJam);
    expect(previewSegments[0].point2).toEqual({ x: 14, y: initialWireY1 });

    // Ohne Netzveränderung nach Zurückdrehen (Shift+R + L + R ohne Shift) entstehen 0 Undo-Einträge
    const netZero = createFloatingMoveState(capturedCtx.currentCircuit, {
      symbolIds: [symId],
      textNoteIds: [],
      wireIds: [],
      dx: 0,
      dy: 0,
      withWires: true,
      initialRotation: "counterClockwise",
    })!;
    expect(netZero.payload.symbols[0].symbol.rotation).toBe("left");
    const backToStart = rotateFloatingState(netZero, "clockwise", capturedCtx.currentCircuit);
    React.act(() => {
      capturedCtx.commitFloatingMove?.(backToStart);
    });
    expect(capturedCtx.history.entries).toHaveLength(0);

    // Ablegen des gedrehten + verschobenen Schwebeblocks erzeugt genau EINEN Undo-Eintrag
    React.act(() => {
      capturedCtx.commitFloatingMove?.(floating);
    });
    expect(capturedCtx.history.entries).toHaveLength(1);
    const committedSym = capturedCtx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symId)!;
    expect(committedSym.rotation).toBe("right");
    const committedOutJam = committedSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const committedWire = capturedCtx.currentCircuit.wires.find((w) => w.wireId === wireId)!;
    expect(committedWire.point1).toEqual(committedOutJam);

    // Ein einziges Undo setzt Rotation, Position und verbundene Leitung komplett zurück
    React.act(() => {
      capturedCtx.undo();
    });
    const revertedSym = capturedCtx.currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === symId)!;
    expect(revertedSym.rotation).toBe(initialRotation);
    expect(revertedSym.x).toBe(initialSymX);
    expect(revertedSym.y).toBe(initialSymY);
    const revertedWire = capturedCtx.currentCircuit.wires.find((w) => w.wireId === wireId)!;
    expect(revertedWire.x1).toBe(initialWireX1);
    expect(revertedWire.y1).toBe(initialWireY1);
  });
});
