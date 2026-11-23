import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CanvasContextProvider from "../../contexts/canvasContext/provider";
import CircuitContext from "../../contexts/circuitContext";
import CircuitContextProvider from "../../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../../contexts/simulationContext";
import SimulationContextProvider from "../../contexts/simulationContext/provider";

import CircuitMap, { getButtonInstanceId } from "../../simulation/compiler/circuitMap";
import CircuitRunner from "../../simulation/worker/circuitRunner";
import {
  createCircuitButton,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
  syncProjectLogicalCircuits,
} from "../../utils/circuitLayout";
import { createWire } from "../../utils/wireUtils";

import {
  dispatchSimulationSymbolDoubleClick,
  dispatchSimulationSymbolPointerDown,
} from "../../components/circuitCanvas";
import CircuitSymbolView from "../../components/circuitCanvas/circuitSymbolView";
import ComponentPalette from "../../components/componentPalette";
import RunningCircuitTree from "../../components/runningCircuitTree";
import RunningTreeNode from "../../components/runningCircuitTree/runningTreeNode";
import TelemetryFooter from "../../components/runningCircuitTree/telemetryFooter";

const ContextCapture: React.FC<{
  onSimContext: (sim: React.ContextType<typeof SimulationContext>) => void;
  onCircuitContext: (circ: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onSimContext, onCircuitContext }) => {
  const sim = React.useContext(SimulationContext);
  const circ = React.useContext(CircuitContext);
  onSimContext(sim);
  onCircuitContext(circ);
  return null;
};

describe("T-037: Hierarchischer Schaltungs-Instanzbaum (RunningTree) in der Seitenleiste während der Simulation", () => {
  it("schaltet die Seitenleiste bei Simulationsstart auf RunningCircuitTree und bei Simulationsstopp zurück zur Komponentenpalette", async () => {
    // Editiermodus (isSimulating = false): reguläre Komponentenpalette sichtbar
    let html = renderToStaticMarkup(
      <SimulationContext.Provider value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: false }}>
        <ComponentPalette />
      </SimulationContext.Provider>,
    );
    expect(html).toContain("data-component=\"ComponentPalette\"");
    expect(html).toContain("Bausteine");
    expect(html).toContain("Grundformen");
    expect(html).not.toContain("Laufende Schaltung");

    // Simulationsmodus (isSimulating = true): Seitenleiste schaltet auf RunningCircuitTree um
    html = renderToStaticMarkup(
      <SimulationContext.Provider value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true }}>
        <ComponentPalette />
      </SimulationContext.Provider>,
    );
    expect(html).toContain("data-component=\"RunningCircuitTree\"");
    expect(html).toContain("Laufende Schaltung");
    expect(html).not.toContain("data-component=\"ComponentPalette\"");
    expect(html).not.toContain("Bausteine");

    // Verifikation mit echtem SimulationContextProvider und step / stopSimulation
    const project = createEmptyCircuitProject();
    const mainCircuit = createDefaultLogicalCircuit("main", "Haupt-Schaltung");
    project.logicalCircuits = [mainCircuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => {
                simCtx = s;
              }}
              onCircuitContext={() => {}}
            />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    expect(simCtx.isSimulating).toBe(false);

    // Simulation via step() starten
    await simCtx.step();
    expect(simCtx.isSimulating).toBe(true);

    // Simulation via stopSimulation() beenden
    await simCtx.stopSimulation();
    expect(simCtx.isSimulating).toBe(false);
  });

  it("stellt verschachtelte Subschaltungen hierarchisch korrekt dar inklusive Koordinaten, Notation und Chevrons", () => {
    // Aufbau einer dreistufigen Schaltungshierarchie:
    // Root: TopLevel -> bindet SubALU ein bei (12, 14)
    // SubALU -> bindet AdderModul ein bei (5, 8)
    const topCircuit = createDefaultLogicalCircuit("top", "TopLevel");
    const aluCircuit = createDefaultLogicalCircuit("alu", "SubALU");
    aluCircuit.notation = "ALU-Core";
    const adderCircuit = createDefaultLogicalCircuit("adder", "AdderModul");
    adderCircuit.notation = "FullAdder";

    // Symbol für Adder in ALU platzieren
    const adderSymbol = createCircuitSymbol(adderCircuit, "alu", 5, 8, "up", "sym-adder-1");
    aluCircuit.circuitSymbols = [adderSymbol];

    // Symbol für ALU in Top platzieren
    const aluSymbol = createCircuitSymbol(aluCircuit, "top", 12, 14, "up", "sym-alu-1");
    topCircuit.circuitSymbols = [aluSymbol];

    const rootMap = new CircuitMap(topCircuit);
    expect(rootMap.isRoot).toBe(true);
    expect(rootMap.children.size).toBe(1);

    const aluMap = rootMap.child(aluSymbol)!;
    expect(aluMap).toBeDefined();
    expect(aluMap.children.size).toBe(1);

    const adderMap = aluMap.child(adderSymbol)!;
    expect(adderMap).toBeDefined();

    // Rendern des RunningCircuitTree mit simuliertem Context
    const mockSimContext: React.ContextType<typeof SimulationContext> = {
      ...DEFAULT_SIMULATION_STATE,
      isSimulating: true,
      isPaused: false,
      isRunning: true,
      frameRateLimit: 30,
      circuitMap: rootMap,
      rootCircuitMap: rootMap,
      selectedCircuitMap: adderMap,
      actualFrequency: 1500,
    };

    const html = renderToStaticMarkup(
      <SimulationContext.Provider value={mockSimContext}>
        <RunningCircuitTree />
      </SimulationContext.Provider>,
    );

    // Header der Leiste
    expect(html).toContain("Laufende Schaltung");

    // Wurzelknoten: Name der Hauptschaltung
    expect(html).toContain("TopLevel");

    // Subknoten 1: Notation und Koordinaten (12, 14)
    expect(html).toContain("ALU-Core");
    expect(html).toContain("(12, 14)");

    // Subknoten 2: Notation und Koordinaten (5, 8)
    expect(html).toContain("FullAdder");
    expect(html).toContain("(5, 8)");

    // Miniatur-Icons für alle Schaltungsinstanzen
    expect(html).toContain("data-component=\"SubCircuitGlyph\"");

    // Chevrons zum Auf-/Zuklappen
    expect(html).toContain("chevron-button");
  });

  it("navigiert per Klick auf einen Baumknoten zur entsprechenden Schaltung und hebt sie im Baum hervor", () => {
    const topCircuit = createDefaultLogicalCircuit("top", "TopLevel");
    const subCircuit = createDefaultLogicalCircuit("sub", "SubModule");
    const subSymbol = createCircuitSymbol(subCircuit, "top", 10, 20, "up", "sym-sub-nav");
    topCircuit.circuitSymbols = [subSymbol];

    const rootMap = new CircuitMap(topCircuit);
    const subMap = rootMap.child(subSymbol)!;

    const mockSelectMap = (_map: CircuitMap) => {};

    const expandedKeys = new Set<string>([rootMap.path()]);

    // Rendern mit SubModule als ausgewähltem Knoten
    const htmlWithSubSelected = renderToStaticMarkup(
      <RunningTreeNode
        map={rootMap}
        level={0}
        selectedMap={subMap}
        currentCircuitId="sub"
        expandedKeys={expandedKeys}
        onToggleExpand={() => {}}
        onSelectMap={mockSelectMap}
      />,
    );

    // SubModule muss als ausgewählt markiert sein
    expect(htmlWithSubSelected).toContain("SubModule");
    expect(htmlWithSubSelected).toContain("node-row selected");
    expect(htmlWithSubSelected).toContain("aria-selected=\"true\"");
  });

  it("lässt die Simulation aktiv weiterlaufen, wenn zwischen Schaltungsinstanzen im Baum navigiert wird", async () => {
    const project = createEmptyCircuitProject();
    const topCircuit = createDefaultLogicalCircuit("top", "TopLevelNav");
    const subCircuit = createDefaultLogicalCircuit("sub", "SubModuleNav");

    // Subschaltung enthält ein NOT-Gatter
    const notGate = createGate("not", 1, false);
    const notSym = createCircuitSymbol(notGate, "sub", 4, 4, "up", "sym-sub-not");
    subCircuit.circuitSymbols = [notSym];

    const subSymbol = createCircuitSymbol(subCircuit, "top", 6, 6, "up", "sym-sub-1");
    topCircuit.circuitSymbols = [subSymbol];

    project.logicalCircuits = [topCircuit, subCircuit];
    project.project.logicalCircuitId = "top";

    let simCtx!: React.ContextType<typeof SimulationContext>;
    let circCtx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="top">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => {
                simCtx = s;
              }}
              onCircuitContext={(c) => {
                circCtx = c;
              }}
            />
            <RunningCircuitTree />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    // Simulation starten
    await simCtx.step();
    expect(simCtx.isSimulating).toBe(true);
    expect(circCtx.currentCircuitId).toBe("top");

    const rootMap = simCtx.rootCircuitMap;
    expect(rootMap).not.toBeNull();
    const subMap = rootMap!.child(subSymbol)!;
    expect(subMap).toBeDefined();

    // Zur Subschaltung navigieren
    simCtx.selectCircuitMap(subMap);

    // Canvas-Schaltung hat gewechselt
    expect(circCtx.currentCircuitId).toBe("sub");
    expect(simCtx.selectedCircuitMap).toBe(subMap);

    // Simulation bleibt weiterhin aktiv!
    expect(simCtx.isSimulating).toBe(true);

    // Wieder zurück zur Hauptschaltung navigieren
    simCtx.selectCircuitMap(rootMap!);
    expect(circCtx.currentCircuitId).toBe("top");
    expect(simCtx.selectedCircuitMap).toBe(rootMap);
    expect(simCtx.isSimulating).toBe(true);
  });

  it("stellt den Frequenz-, Schrittzähler- und Telemetriebereich korrekt dar", () => {
    // Normaler Takt: 2,5 kHz mit 1.240 Schritten
    let html = renderToStaticMarkup(
      <TelemetryFooter
        actualFrequency={2500}
        frameRateLimit={30}
        totalSteps={1240}
        isRunning={true}
        isPaused={false}
        isOscillating={false}
      />,
    );

    expect(html).toContain("Telemetrie &amp; Takt");
    expect(html).toContain("Aktuelle Taktfrequenz:");
    expect(html).toContain("2,5 kHz");
    expect(html).toContain("Ziel-Taktfrequenz:");
    expect(html).toContain("data-testid=\"telemetry-frequency-select\"");
    expect(html).toContain("<option value=\"30\" selected=\"\">30 Hz</option>");
    expect(html).toContain("Schritte (Ticks):");
    expect(html).toContain("1.240");
    expect(html).toContain("Läuft");
    expect(html).not.toContain("Schaltung oszilliert");

    // Hoher Takt: 4,25 MHz mit Oszillationswarnung und großem Schrittzähler
    html = renderToStaticMarkup(
      <TelemetryFooter
        actualFrequency={4250000}
        frameRateLimit="max"
        totalSteps={1234567}
        isRunning={false}
        isPaused={true}
        isOscillating={true}
      />,
    );

    expect(html).toContain("4,25 MHz");
    expect(html).toContain("<option value=\"max\" selected=\"\">Max</option>");
    expect(html).toContain("1.234.567");
    expect(html).toContain("Pausiert");
    expect(html).toContain("⚠️ Schaltung oszilliert");
  });

  it("T-049: schaltet eingebettete Display-Taster instanzisoliert und unterscheidet Doppelklick-Navigation von Button-Klicks", () => {
    const project = createEmptyCircuitProject("Display Interaction", "Main", "main");
    const panelLc = createDefaultLogicalCircuit("sub-panel", "SwitchPanel");
    panelLc.circuitShape = "display";
    panelLc.isDisplay = true;

    const btn = createCircuitButton("btn-panel", "PWR", true, "right", false, 2, 2, false);
    const btnSym = createCircuitSymbol(btn, "sub-panel", 2, 2, "up", "sym-inner-btn");
    const led = createGate("led", 1, false, "green");
    const ledSym = createCircuitSymbol(led, "sub-panel", 6, 2, "up", "sym-inner-led");
    const { pin: outPin, pinCircuit: outPinCircuit } = createPinCircuit(
      "pin-out-panel",
      "sub-panel",
      "output",
      "Y",
      1,
      "right",
    );
    const outPinSym = createCircuitSymbol(outPinCircuit, "sub-panel", 10, 2, "up", "sym-inner-pin");

    panelLc.logicalPins = [outPin];
    panelLc.circuitSymbols = [btnSym, ledSym, outPinSym];
    const btnOut = btnSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const ledIn = ledSym.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;
    const pinIn = outPinSym.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;
    panelLc.wires = [
      createWire("sub-panel", btnOut, ledIn, "w-b-l"),
      createWire("sub-panel", ledIn, pinIn, "w-l-y"),
    ];

    project.pins.push(outPin);
    project.logicalCircuits.push(panelLc);
    project.circuits.set(panelLc.circuitId, panelLc);

    // Zwei unabhängige Instanzen derselben Display-Subschaltung in Main platzieren
    const inst1 = createCircuitSymbol(panelLc, "main", 2, 2, "up", "sym-panel-1");
    const inst2 = createCircuitSymbol(panelLc, "main", 12, 2, "up", "sym-panel-2");
    project.logicalCircuits[0].circuitSymbols.push(inst1, inst2);
    project.circuitSymbols.push(inst1, inst2);

    const synced = syncProjectLogicalCircuits(project);
    const mainCircuit = synced.logicalCircuits[0];
    const symInst1 = mainCircuit.circuitSymbols.find((s) => s.circuitSymbolId === "sym-panel-1")!;
    const symInst2 = mainCircuit.circuitSymbols.find((s) => s.circuitSymbolId === "sym-panel-2")!;

    const runner = new CircuitRunner(mainCircuit);
    runner.start();

    const rootMap = runner.circuitMap;
    const mapInst1 = rootMap.child(symInst1)!;
    const mapInst2 = rootMap.child(symInst2)!;
    expect(getButtonInstanceId(mapInst1, btnSym)).toBe("sym-panel-1/btn-panel");
    expect(getButtonInstanceId(mapInst2, btnSym)).toBe("sym-panel-2/btn-panel");

    // Nur Instanz 1 umschalten -> Instanz 2 bleibt aus
    expect(runner.toggleButton("sym-panel-1/btn-panel")).toBe(true);
    const snapAfterToggle1 = runner.getSnapshot();
    expect(snapAfterToggle1.buttons["sym-panel-1/btn-panel"]?.isOn).toBe(true);
    expect(snapAfterToggle1.buttons["sym-panel-2/btn-panel"]?.isOn).toBe(false);

    // CircuitSymbolView rendert eigene Hit-Targets je Instanzpfad und unterschiedliche Zustände
    const simCtxForView: React.ContextType<typeof SimulationContext> = {
      ...DEFAULT_SIMULATION_STATE,
      isSimulating: true,
      snapshot: snapAfterToggle1,
      circuitMap: rootMap,
      rootCircuitMap: rootMap,
      selectedCircuitMap: rootMap,
    };

    const viewHtml = renderToStaticMarkup(
      <SimulationContext.Provider value={simCtxForView}>
        <svg>
          <CircuitSymbolView symbol={symInst1} />
          <CircuitSymbolView symbol={symInst2} />
        </svg>
      </SimulationContext.Provider>,
    );
    expect(viewHtml).toContain("data-display-button-path=\"sym-panel-1/btn-panel\"");
    expect(viewHtml).toContain("data-display-button-path=\"sym-panel-2/btn-panel\"");
    expect(viewHtml).toContain("class=\"display-button-hit-target\"");

    // Pointer-/Doppelklick-Logik im Simulationsmodus prüfen
    const toggledIds: string[] = [];
    const pressedEvents: { id: string; pressed: boolean }[] = [];
    const selectedMaps: CircuitMap[] = [];
    const selectedSymbols: string[] = [];

    const mockButtonTarget = {
      closest: (selector: string) => (
        selector === "[data-display-button-path]"
          ? {
            getAttribute: (attr: string) => {
              if (attr === "data-display-button-path") {
                return "sym-panel-2/btn-panel";
              }
              if (attr === "data-display-button-toggle") {
                return "true";
              }
              return null;
            },
          }
          : null
      ),
    } as unknown as EventTarget;

    // Schnelle Doppelklicks auf den eingebetteten Button dürfen NIEMALS in die Subschaltung wechseln
    const firstBtnClick = dispatchSimulationSymbolPointerDown({
      symbol: symInst2,
      target: mockButtonTarget,
      detail: 1,
      shiftOrMeta: false,
      now: 1000,
      lastSymbolClick: null,
      activeSimulationMap: rootMap,
      toggleButton: (id) => { toggledIds.push(id); },
      setButtonState: (id, pressed) => { pressedEvents.push({ id, pressed }); },
      selectCircuitMap: (m) => { selectedMaps.push(m); },
      selectSymbol: (id) => { selectedSymbols.push(id); },
      selectEntities: (ids) => { selectedSymbols.push(...ids); },
    });
    expect(firstBtnClick.handledAction).toBe("displayButton");

    const secondBtnClick = dispatchSimulationSymbolPointerDown({
      symbol: symInst2,
      target: mockButtonTarget,
      detail: 2,
      shiftOrMeta: false,
      now: 1120,
      lastSymbolClick: firstBtnClick.nextLastClick,
      activeSimulationMap: rootMap,
      toggleButton: (id) => { toggledIds.push(id); },
      setButtonState: (id, pressed) => { pressedEvents.push({ id, pressed }); },
      selectCircuitMap: (m) => { selectedMaps.push(m); },
      selectSymbol: (id) => { selectedSymbols.push(id); },
      selectEntities: (ids) => { selectedSymbols.push(...ids); },
    });
    expect(secondBtnClick.handledAction).toBe("displayButton");

    const dblOnButton = dispatchSimulationSymbolDoubleClick({
      symbol: symInst2,
      target: mockButtonTarget,
      activeSimulationMap: rootMap,
      selectCircuitMap: (m) => { selectedMaps.push(m); },
    });
    expect(dblOnButton).toBe(false);
    expect(toggledIds).toEqual(["sym-panel-2/btn-panel", "sym-panel-2/btn-panel"]);
    expect(selectedMaps).toHaveLength(0);

    // Doppelklick auf den Körper außerhalb des Display-Buttons öffnet genau diese SubCircuit-Instanz
    const mockBodyTarget = {
      closest: () => null,
    } as unknown as EventTarget;

    const firstBodyClick = dispatchSimulationSymbolPointerDown({
      symbol: symInst1,
      target: mockBodyTarget,
      detail: 1,
      shiftOrMeta: false,
      now: 2000,
      lastSymbolClick: null,
      activeSimulationMap: rootMap,
      toggleButton: (id) => { toggledIds.push(id); },
      setButtonState: (id, pressed) => { pressedEvents.push({ id, pressed }); },
      selectCircuitMap: (m) => { selectedMaps.push(m); },
      selectSymbol: (id) => { selectedSymbols.push(id); },
      selectEntities: (ids) => { selectedSymbols.push(...ids); },
    });
    expect(firstBodyClick.handledAction).toBe("select");
    expect(selectedMaps).toHaveLength(0);

    const secondBodyClick = dispatchSimulationSymbolPointerDown({
      symbol: symInst1,
      target: mockBodyTarget,
      detail: 2,
      shiftOrMeta: false,
      now: 2150,
      lastSymbolClick: firstBodyClick.nextLastClick,
      activeSimulationMap: rootMap,
      toggleButton: (id) => { toggledIds.push(id); },
      setButtonState: (id, pressed) => { pressedEvents.push({ id, pressed }); },
      selectCircuitMap: (m) => { selectedMaps.push(m); },
      selectSymbol: (id) => { selectedSymbols.push(id); },
      selectEntities: (ids) => { selectedSymbols.push(...ids); },
    });
    expect(secondBodyClick.handledAction).toBe("subCircuitOpen");
    expect(selectedMaps).toEqual([mapInst1]);

    // Momentary-Button in Display-Subschaltung testen (setButtonState(true) statt toggleButton)
    const mockMomentaryTarget = {
      closest: () => ({
        getAttribute: (attr: string) => {
          if (attr === "data-display-button-path") {
            return "sym-panel-1/btn-momentary";
          }
          if (attr === "data-display-button-toggle") {
            return "false";
          }
          return null;
        },
      }),
    } as unknown as EventTarget;
    const momentaryPress = dispatchSimulationSymbolPointerDown({
      symbol: symInst1,
      target: mockMomentaryTarget,
      detail: 1,
      shiftOrMeta: false,
      now: 3000,
      lastSymbolClick: null,
      activeSimulationMap: rootMap,
      toggleButton: (id) => { toggledIds.push(id); },
      setButtonState: (id, pressed) => { pressedEvents.push({ id, pressed }); },
      selectCircuitMap: (m) => { selectedMaps.push(m); },
      selectSymbol: (id) => { selectedSymbols.push(id); },
      selectEntities: (ids) => { selectedSymbols.push(...ids); },
    });
    expect(momentaryPress.handledAction).toBe("displayButton");
    expect(momentaryPress.capturedButtonId).toBe("sym-panel-1/btn-momentary");
    expect(pressedEvents).toEqual([{ id: "sym-panel-1/btn-momentary", pressed: true }]);

    // Top-Level-Button während der Simulation: Klick schaltet/betätigt den Button, markiert ihn aber NICHT
    const topBtn = createCircuitButton("btn-top", "TopBtn", true, "right");
    const topBtnSym = createCircuitSymbol(topBtn, "main", 2, 12, "up", "sym-btn-top");
    const topBtnClick = dispatchSimulationSymbolPointerDown({
      symbol: topBtnSym,
      target: mockBodyTarget,
      detail: 1,
      shiftOrMeta: false,
      now: 4000,
      lastSymbolClick: null,
      activeSimulationMap: rootMap,
      toggleButton: (id) => { toggledIds.push(id); },
      setButtonState: (id, pressed) => { pressedEvents.push({ id, pressed }); },
      selectCircuitMap: (m) => { selectedMaps.push(m); },
      selectSymbol: (id) => { selectedSymbols.push(id); },
      selectEntities: (ids) => { selectedSymbols.push(...ids); },
    });
    expect(topBtnClick.handledAction).toBe("button");
    expect(selectedSymbols).not.toContain("sym-btn-top");

    const topBtnHtml = renderToStaticMarkup(
      <SimulationContext.Provider value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true }}>
        <svg>
          <CircuitSymbolView symbol={topBtnSym} />
        </svg>
      </SimulationContext.Provider>,
    );
    expect(topBtnHtml).toContain("data-sim-button=\"true\"");

    runner.dispose();
  });
});
