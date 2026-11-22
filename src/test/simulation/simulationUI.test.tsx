import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CanvasContextProvider from "../../contexts/canvasContext/provider";
import CircuitContext from "../../contexts/circuitContext";
import CircuitContextProvider from "../../contexts/circuitContext/provider";
import SimulationContext from "../../contexts/simulationContext";
import SimulationContextProvider from "../../contexts/simulationContext/provider";

import type GridPoint from "../../types/canvas/gridPoint";
import type Wire from "../../types/circuit/wire";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createSplitter,
} from "../../utils/circuitLayout";
import { formatJamTooltip, formatSignalTooltip } from "../../utils/wireUtils";

import CircuitCanvas from "../../components/circuitCanvas";
import StatusBar from "../../components/statusBar";

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

describe("US-005 / T-032: Simulations-UI, Einzelschritt-Steuerung und Canvas-Kopplung", () => {
  it("schaltet im Einzelschritt-Modus (step) durch und visualisiert Signalpegel auf Leitungen und Probes", async () => {
    const project = createEmptyCircuitProject();
    const circuit = createDefaultLogicalCircuit("main", "SingleStepUITest");

    // Button bei (0, 1) -> Output bei (2, 2)
    const btn = createCircuitButton("btn-1", "btn-1", false, "right");
    const btnSym = createCircuitSymbol(btn, "main", 0, 1, "up", "sym-btn");

    // NOT-Gate bei (10, 0) -> In bei (10, 2), Out bei (13, 2)
    const notGate = createGate("not", 1, false);
    const notSym = createCircuitSymbol(notGate, "main", 10, 0, "up", "sym-not");

    // Probe bei (20, 1) -> In bei (20, 2)
    const probe = createCircuitProbe("probe-1", "OutProbe");
    const probeSym = createCircuitSymbol(probe, "main", 20, 1, "up", "sym-probe");

    circuit.circuitSymbols = [btnSym, notSym, probeSym];

    const btnOut = btnSym.jams.find((j) => j.pin.pinType === "output")!;
    const notIn = notSym.jams.find((j) => j.pin.pinType === "input")!;
    const notOut = notSym.jams.find((j) => j.pin.pinType === "output")!;
    const probeIn = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("w1", "main", btnOut.absolutePoint, notIn.absolutePoint),
      makeWire("w2", "main", notOut.absolutePoint, probeIn.absolutePoint),
    ];

    project.logicalCircuits = [circuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;
    let circCtx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => { simCtx = s; }}
              onCircuitContext={(c) => { circCtx = c; }}
            />
            <CircuitCanvas />
            <StatusBar />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    expect(simCtx.isSimulating).toBe(false);
    expect(circCtx.currentCircuit.wires).toHaveLength(2);

    // Führe ersten Einzelschritt aus: NOT(0) = 1
    await simCtx.step();

    expect(simCtx.isSimulating).toBe(true);
    expect(simCtx.isPaused).toBe(true);
    expect(simCtx.snapshot).not.toBeNull();
    expect(simCtx.snapshot?.probes["probe-1"].value).toBe(1);

    // Leitung w2 (Ausgang NOT -> Probe) muss High sein
    const w2State = simCtx.wireStateMap.get("w2");
    expect(w2State).toBe(STATE_ON1);

    // Leitung w1 (Button 0 -> Eingang NOT) muss Low sein
    const w1State = simCtx.wireStateMap.get("w1");
    expect(w1State).toBe(STATE_ON0);

    // Taster drücken und weiteren Einzelschritt ausführen: NOT(1) = 0
    await simCtx.setButtonState("btn-1", true);
    await simCtx.step();

    expect(simCtx.snapshot?.probes["probe-1"].value).toBe(0);
    expect(simCtx.wireStateMap.get("w2")).toBe(STATE_ON0);
    expect(simCtx.wireStateMap.get("w1")).toBe(STATE_ON1);
  });

  it("färbt Leitungen und Lötpunkte auf dem Canvas synchron zum Simulationszustand ein", async () => {
    const project = createEmptyCircuitProject();
    const circuit = createDefaultLogicalCircuit("main", "WireColorTest");

    const btn = createCircuitButton("btn-2", "btn-2", false, "right");
    const btnSym = createCircuitSymbol(btn, "main", 0, 1, "up", "sym-btn");

    const probe = createCircuitProbe("probe-2", "DirectProbe");
    const probeSym = createCircuitSymbol(probe, "main", 10, 1, "up", "sym-probe");

    circuit.circuitSymbols = [btnSym, probeSym];

    const btnOut = btnSym.jams.find((j) => j.pin.pinType === "output")!;
    const probeIn = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("wire-test", "main", btnOut.absolutePoint, probeIn.absolutePoint),
    ];

    project.logicalCircuits = [circuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;

    const renderUi = () =>
      renderToStaticMarkup(
        <CanvasContextProvider>
          <CircuitContextProvider initialProject={project} initialCircuitId="main">
            <SimulationContextProvider>
              <ContextCapture
                onSimContext={(s) => { simCtx = s; }}
                onCircuitContext={() => {}}
              />
              <CircuitCanvas />
            </SimulationContextProvider>
          </CircuitContextProvider>
        </CanvasContextProvider>,
      );

    // Vor Simulation: Standard-Leitungsfarbe (kein stroke="var(--color-logic-high)")
    const html = renderUi();
    expect(html).toContain("data-testid=\"circuit-wire-wire-test\"");
    expect(html).not.toContain("stroke=\"var(--color-logic-high)\"");

    // Einzelschritt mit gedrücktem Taster -> Leitung muss Hellgrün sein
    await simCtx.step();
    await simCtx.setButtonState("btn-2", true);
    await simCtx.step();

    expect(simCtx.wireStateMap.get("wire-test")).toBe(STATE_ON1);

    const activeHtml = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContext.Provider value={simCtx}>
            <CircuitCanvas />
          </SimulationContext.Provider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );
    expect(activeHtml).toContain("stroke=\"var(--color-logic-high)\"");
  });

  it("unterstützt das Umschalten von Wechselschaltern (ToggleSwitch)", async () => {
    const project = createEmptyCircuitProject();
    const circuit = createDefaultLogicalCircuit("main", "ToggleUITest");

    const toggle = createCircuitButton("toggle-ui", "T", true, "right");
    toggle.isToggle = true;
    const toggleSym = createCircuitSymbol(toggle, "main", 0, 1, "up", "sym-toggle");

    const probe = createCircuitProbe("probe-toggle", "P");
    const probeSym = createCircuitSymbol(probe, "main", 10, 1, "up", "sym-probe");

    circuit.circuitSymbols = [toggleSym, probeSym];

    const toggleOut = toggleSym.jams.find((j) => j.pin.pinType === "output")!;
    const probeIn = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("w-toggle", "main", toggleOut.absolutePoint, probeIn.absolutePoint),
    ];

    project.logicalCircuits = [circuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => { simCtx = s; }}
              onCircuitContext={() => {}}
            />
            <CircuitCanvas />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    // Initial 0
    await simCtx.step();
    expect(simCtx.snapshot?.probes["probe-toggle"].value).toBe(0);

    // Umschalten -> 1
    await simCtx.toggleButton("toggle-ui");
    await simCtx.step();
    expect(simCtx.snapshot?.probes["probe-toggle"].value).toBe(1);

    // Erneutes Umschalten -> wieder 0
    await simCtx.toggleButton("toggle-ui");
    await simCtx.step();
    expect(simCtx.snapshot?.probes["probe-toggle"].value).toBe(0);
  });

  it("beendet die Simulation sauber und setzt den Modus zurück", async () => {
    const project = createEmptyCircuitProject();
    const circuit = createDefaultLogicalCircuit("main", "StopTest");
    project.logicalCircuits = [circuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => { simCtx = s; }}
              onCircuitContext={() => {}}
            />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    await simCtx.step();
    expect(simCtx.isSimulating).toBe(true);

    await simCtx.stopSimulation();
    expect(simCtx.isSimulating).toBe(false);
    expect(simCtx.isPaused).toBe(false);
    expect(simCtx.snapshot).toBeNull();
    expect(simCtx.wireStateMap.size).toBe(0);
  });

  it("unterstützt Taktfrequenz-Änderungen im SimulationContext (10, 20, 30, 60 Hz und Max)", () => {
    const project = createEmptyCircuitProject();
    let simCtx!: React.ContextType<typeof SimulationContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => { simCtx = s; }}
              onCircuitContext={() => {}}
            />
            <StatusBar />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    expect(simCtx.frameRateLimit).toBe(30);

    simCtx.setFrameRateLimit(10);
    expect(simCtx.frameRateLimit).toBe(10);

    simCtx.setFrameRateLimit(60);
    expect(simCtx.frameRateLimit).toBe(60);

    simCtx.setFrameRateLimit("max");
    expect(simCtx.frameRateLimit).toBe("max");
  });

  it("formatiert Signal-Tooltips für 1-Bit und Multi-Bit-Leitungen inklusive 4er-Nibble-Binärdarstellung", () => {
    // Einzelbit Auswertung
    const stateArr1 = new Uint8Array([STATE_ON1, STATE_ON0, STATE_OFF]);
    expect(formatSignalTooltip([0], stateArr1)).toBe("1 (High)");
    expect(formatSignalTooltip([1], stateArr1)).toBe("0 (Low)");
    expect(formatSignalTooltip([2], stateArr1)).toBe("x (Tri-State)");

    // Multi-Bit Auswertung mit hexadezimalem Wert 0x2d1 (binär 0010 1101 0001, MSB links)
    // Bit 0 = 1, Bit 4 = 1, Bit 6 = 1, Bit 7 = 1, Bit 9 = 1, alle anderen 0
    const bits12 = [1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]; // LSB bis MSB
    const stateArr12 = new Uint8Array(bits12.map((b) => (b === 1 ? STATE_ON1 : STATE_ON0)));
    const indices12 = Array.from({ length: 12 }, (_, i) => i);

    const tooltip12 = formatSignalTooltip(indices12, stateArr12);
    expect(tooltip12).toBe("12-Bit: 0x2d1\n0010 1101 0001");
  });

  it("unterscheidet visuell zwischen LED-Zuständen STATE_OFF, STATE_ON0 und STATE_ON1", async () => {
    const project = createEmptyCircuitProject();
    const circuit = createDefaultLogicalCircuit("main", "LedTest");

    const btn = createCircuitButton("btn-led", "btn-led", false, "right");
    const btnSym = createCircuitSymbol(btn, "main", 0, 1, "up", "sym-btn");

    const led = createGate("led", 1, false);
    const ledSym = createCircuitSymbol(led, "main", 10, 1, "up", "sym-led");

    circuit.circuitSymbols = [btnSym, ledSym];

    const outJam = btnSym.jams.find((j) => j.pin.pinType === "output")!;
    const inJam = ledSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("w-led", "main", outJam.absolutePoint, inJam.absolutePoint),
    ];

    project.logicalCircuits = [circuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;

    const renderUi = () =>
      renderToStaticMarkup(
        <CanvasContextProvider>
          <CircuitContextProvider initialProject={project} initialCircuitId="main">
            <SimulationContextProvider>
              <ContextCapture
                onSimContext={(s) => { simCtx = s; }}
                onCircuitContext={() => {}}
              />
              <CircuitCanvas />
            </SimulationContextProvider>
          </CircuitContextProvider>
        </CanvasContextProvider>,
      );

    // Initialzustand vor Simulation: LED ist STATE_OFF (Klasse is-off, LedOff-Farbverlauf)
    const html = renderUi();
    expect(html).toContain("led-lens is-off");
    expect(html).toContain("led-off-grad");

    // Erster Simulationsschritt: Taster nicht gedrückt -> Signal 0 (STATE_ON0, Klasse is-on0)
    await simCtx.step();
    const activeHtml0 = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContext.Provider value={simCtx}>
            <CircuitCanvas />
          </SimulationContext.Provider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );
    expect(activeHtml0).toContain("led-lens is-on0");
    expect(activeHtml0).toContain("fill=\"#5B4949\"");

    // Taster drücken und weiterschalten: Signal 1 (STATE_ON1, Klasse is-on, Glow)
    await simCtx.setButtonState("btn-led", true);
    await simCtx.step();
    const activeHtml1 = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContext.Provider value={simCtx}>
            <CircuitCanvas />
          </SimulationContext.Provider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );
    expect(activeHtml1).toContain("led-lens is-on");
    expect(activeHtml1).toContain("led-on-grad");
  });

  it("ermittelt Signal-Tooltips und Zustandsindizes über Splitter-Busleitungen und unverbundene Pins", async () => {
    const project = createEmptyCircuitProject();
    const circuit = createDefaultLogicalCircuit("main", "SplitterSignalTest");

    // Zwei Taster für Bit Null und Bit Eins
    const btn1 = createCircuitButton("btn-1", "btn-1", false, "right");
    const btn1Sym = createCircuitSymbol(btn1, "main", 1, 27, "up", "sym-btn-1");

    const btn2 = createCircuitButton("btn-2", "btn-2", false, "right");
    const btn2Sym = createCircuitSymbol(btn2, "main", 1, 30, "up", "sym-btn-2");

    // Splitter A: 3-Bit-Bus mit 3 Pins (Bit Null, Bit Eins, Bit Zwei unverbunden)
    const splitA = createSplitter("split-a", 3, 3, true);
    const splitASym = createCircuitSymbol(splitA, "main", 10, 29, "up", "sym-split-a");

    // Splitter B: 3-Bit-Bus mit 3 Pins zur Verteilung auf LEDs
    const splitB = createSplitter("split-b", 3, 3, true);
    const splitBSym = createCircuitSymbol(splitB, "main", 15, 29, "up", "sym-split-b");

    // Drei LEDs (Rot, Gelb, Grün)
    const ledRed = createGate("led", 1, false);
    (ledRed as any).color = "red";
    const ledRedSym = createCircuitSymbol(ledRed, "main", 18, 27, "up", "sym-led-red");

    const ledYellow = createGate("led", 1, false);
    (ledYellow as any).color = "yellow";
    const ledYellowSym = createCircuitSymbol(ledYellow, "main", 18, 30, "up", "sym-led-yellow");

    const ledGreen = createGate("led", 1, false);
    (ledGreen as any).color = "green";
    const ledGreenSym = createCircuitSymbol(ledGreen, "main", 18, 33, "up", "sym-led-green");

    circuit.circuitSymbols = [
      btn1Sym,
      btn2Sym,
      splitASym,
      splitBSym,
      ledRedSym,
      ledYellowSym,
      ledGreenSym,
    ];

    const btn1Out = btn1Sym.jams.find((j) => j.pin.pinType === "output")!;
    const btn2Out = btn2Sym.jams.find((j) => j.pin.pinType === "output")!;

    const splitABus = splitASym.jams[0];
    const splitAPin0 = splitASym.jams[1];
    const splitAPin1 = splitASym.jams[2];
    // splitAPin2 bleibt unverbunden!

    const splitBBus = splitBSym.jams[0];
    const splitBPin0 = splitBSym.jams[1];
    const splitBPin1 = splitBSym.jams[2];
    const splitBPin2 = splitBSym.jams[3];

    const ledRedIn = ledRedSym.jams.find((j) => j.pin.pinType === "input")!;
    const ledYellowIn = ledYellowSym.jams.find((j) => j.pin.pinType === "input")!;
    const ledGreenIn = ledGreenSym.jams.find((j) => j.pin.pinType === "input")!;

    const wireBus = makeWire("w-bus", "main", splitABus.absolutePoint, splitBBus.absolutePoint);
    const wireToGreen = makeWire("w-green", "main", splitBPin2.absolutePoint, ledGreenIn.absolutePoint);

    circuit.wires = [
      makeWire("w-btn1", "main", btn1Out.absolutePoint, splitAPin0.absolutePoint),
      makeWire("w-btn2", "main", btn2Out.absolutePoint, splitAPin1.absolutePoint),
      wireBus,
      makeWire("w-red", "main", splitBPin0.absolutePoint, ledRedIn.absolutePoint),
      makeWire("w-yellow", "main", splitBPin1.absolutePoint, ledYellowIn.absolutePoint),
      wireToGreen,
    ];

    project.logicalCircuits = [circuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => { simCtx = s; }}
              onCircuitContext={() => {}}
            />
            <CircuitCanvas />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    // Initialen Schritt ausführen
    await simCtx.step();

    const snapshot = simCtx.snapshot!;
    const map = simCtx.circuitMap!;

    // Prüfung der Bus-Leitung zwischen Splittern
    const busIndices = map.stateIndexes(wireBus);
    expect(busIndices.length).toBe(3);
    expect(busIndices[2]).toBeNull(); // Drittes Bit unverbunden

    const busTooltip = formatSignalTooltip(busIndices, snapshot.stateArray);
    expect(busTooltip).toBe("3-Bit: 0x?\nx00");

    // Taster 1 drücken
    await simCtx.setButtonState("btn-1", true);
    await simCtx.step();

    const busTooltipBtn1 = formatSignalTooltip(busIndices, simCtx.snapshot!.stateArray);
    expect(busTooltipBtn1).toBe("3-Bit: 0x?\nx01");

    // Unverbundene grüne LED und Leitung
    const greenWireIndices = map.stateIndexes(wireToGreen);
    expect(greenWireIndices).toEqual([null]);

    const greenWireTooltip = formatSignalTooltip(greenWireIndices, simCtx.snapshot!.stateArray);
    expect(greenWireTooltip).toBe("x (Tri-State)");

    const greenJamIndices = map.jamStateIndexes(ledGreenIn);
    expect(greenJamIndices).toEqual([null]);

    const greenJamTooltip = formatSignalTooltip(greenJamIndices, simCtx.snapshot!.stateArray);
    expect(greenJamTooltip).toBe("x (Tri-State)");

    // Tooltips für LEDs enthalten die konfigurierte Farbe
    expect(formatJamTooltip(ledRedSym, ledRedIn)).toBe("LED (rot)");
    expect(formatJamTooltip(ledYellowSym, ledYellowIn)).toBe("LED (gelb)");
    expect(formatJamTooltip(ledGreenSym, ledGreenIn)).toBe("LED (grün)");
  });

  it("steuert Taktgeneratoren (Clock) korrekt an und schaltet Signalpegel auf Leitungen ohne Hochohmig-Zustand um", async () => {
    const project = createEmptyCircuitProject();
    const circuit = createDefaultLogicalCircuit("main", "ClockSimulationTest");

    // Taktgenerator bei (0, 0)
    const clkGate = createGate("clock", 0, false);
    const clkSym = createCircuitSymbol(clkGate, "main", 0, 0, "up", "sym-clock");

    // Messsonde bei (10, 0)
    const probe = createCircuitProbe("probe-clk", "ClockOut");
    const probeSym = createCircuitSymbol(probe, "main", 10, 0, "up", "sym-probe-clk");

    circuit.circuitSymbols = [clkSym, probeSym];

    const clkOut = clkSym.jams.find((j) => j.pin.pinType === "output")!;
    const probeIn = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    const clkWire = makeWire("w-clk", "main", clkOut.absolutePoint, probeIn.absolutePoint);
    circuit.wires = [clkWire];

    project.logicalCircuits = [circuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => { simCtx = s; }}
              onCircuitContext={() => {}}
            />
            <CircuitCanvas />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    // Initialer Simulationsschritt
    await simCtx.step();

    const snapshot1 = simCtx.snapshot!;
    const map = simCtx.circuitMap!;
    const clkIndices = map.stateIndexes(clkWire);
    expect(clkIndices.length).toBe(1);
    expect(clkIndices[0]).not.toBeNull();

    // Leitung darf NICHT hochohmig (x) sein, sondern muss gültigen Logikpegel (0 oder 1) tragen
    const wireTooltip1 = formatSignalTooltip(clkIndices, snapshot1.stateArray);
    expect(wireTooltip1).toMatch(/^[01] \((Low|High)\)$/);

    // Weiterer Einzelschritt: Taktflanke muss toggeln
    await simCtx.step();
    const snapshot2 = simCtx.snapshot!;
    const wireTooltip2 = formatSignalTooltip(clkIndices, snapshot2.stateArray);
    expect(wireTooltip2).toMatch(/^[01] \((Low|High)\)$/);
    expect(wireTooltip2).not.toBe(wireTooltip1);
  });

  it("steuert 7-Segment-Anzeige während der Simulation an und aktualisiert die Segmente", async () => {
    const project = createEmptyCircuitProject();
    const circuit = createDefaultLogicalCircuit("main", "SevenSegmentSimulationTest");

    // Siebensegment-Anzeige (Breite 3, Höhe 5) platziert bei (10, 5)
    const sevenSegGate = createGate("led", 8, false, "red");
    const sevenSegSym = createCircuitSymbol(sevenSegGate, "main", 10, 5, "up", "sym-7seg");

    // Schalter 1 für Segment a (Pin in-0 bei y=1)
    const btnA = createCircuitButton("btn-a", "A", true, "right");
    const btnASym = createCircuitSymbol(btnA, "main", 2, 5, "up", "sym-btn-a");

    // Schalter 2 für Segment b (Pin in-1 bei y=2)
    const btnB = createCircuitButton("btn-b", "B", true, "right");
    const btnBSym = createCircuitSymbol(btnB, "main", 2, 7, "up", "sym-btn-b");

    circuit.circuitSymbols = [sevenSegSym, btnASym, btnBSym];

    const jamInA = sevenSegSym.jams.find((j) => j.pin.pinId === "in-0")!;
    const jamInB = sevenSegSym.jams.find((j) => j.pin.pinId === "in-1")!;
    const btnAOut = btnASym.jams.find((j) => j.pin.pinType === "output")!;
    const btnBOut = btnBSym.jams.find((j) => j.pin.pinType === "output")!;

    // Tooltip-Prüfung für 7-Segment-Pins
    expect(formatJamTooltip(sevenSegSym, jamInA)).toBe("7-Segment-Eingang \"a\" (rot)");
    expect(formatJamTooltip(sevenSegSym, jamInB)).toBe("7-Segment-Eingang \"b\" (rot)");

    const wireA = makeWire("w-a", "main", btnAOut.absolutePoint, jamInA.absolutePoint);
    const wireB = makeWire("w-b", "main", btnBOut.absolutePoint, jamInB.absolutePoint);
    circuit.wires = [wireA, wireB];

    project.logicalCircuits = [circuit];
    project.project.logicalCircuitId = "main";

    let simCtx!: React.ContextType<typeof SimulationContext>;

    let html = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContextProvider>
            <ContextCapture
              onSimContext={(s) => { simCtx = s; }}
              onCircuitContext={() => {}}
            />
            <CircuitCanvas />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    // Initialer Zustand vor Simulation: Segmente aus
    expect(html).toContain("segment-a segment-off");
    expect(html).toContain("segment-b segment-off");

    // Simulation starten
    await simCtx.startSimulation();
    await simCtx.step();

    // Schalter A aktivieren -> Segment a leuchtet auf
    await simCtx.setButtonState("btn-a", true);
    await simCtx.step();

    html = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContext.Provider value={simCtx}>
            <CircuitCanvas />
          </SimulationContext.Provider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    expect(html).toContain("segment-a segment-on");
    expect(html).toContain("segment-b segment-off");

    // Schalter B aktivieren -> Segment b leuchtet zusätzlich auf
    await simCtx.setButtonState("btn-b", true);
    await simCtx.step();

    html = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project} initialCircuitId="main">
          <SimulationContext.Provider value={simCtx}>
            <CircuitCanvas />
          </SimulationContext.Provider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    expect(html).toContain("segment-a segment-on");
    expect(html).toContain("segment-b segment-on");
  });
});
