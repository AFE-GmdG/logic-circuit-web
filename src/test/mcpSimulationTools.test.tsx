import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContext from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";
import type McpSimulationActions from "../types/mcp/mcpSimulationActions";

import {
  addElements,
  createCircuitsTool,
  executeMcpTool,
  setCurrentCircuit,
} from "../mcp/mcpTools";
import { createEmptyCircuitProject } from "../utils/circuitLayout";

import CircuitSymbolView from "../components/circuitCanvas/circuitSymbolView";

function createSimulationHarness(initialProject = createEmptyCircuitProject("MCP Sim Test", "Main")) {
  let circuitCtx!: React.ContextType<typeof CircuitContext>;
  let simCtx!: React.ContextType<typeof SimulationContext>;

  const Capture: React.FC = () => {
    circuitCtx = React.useContext(CircuitContext);
    simCtx = React.useContext(SimulationContext);
    return null;
  };

  renderToStaticMarkup(
    React.createElement(CanvasContextProvider, {
      children: React.createElement(CircuitContextProvider, {
        initialProject,
        children: React.createElement(SimulationContextProvider, {
          children: React.createElement(Capture, null),
        }),
      }),
    }),
  );

  const simulationActions: McpSimulationActions = {
    getState: () => ({
      isSimulating: simCtx.isSimulating,
      isPaused: simCtx.isPaused,
      isRunning: simCtx.isRunning,
      isOscillating: simCtx.isOscillating,
      simulationError: simCtx.simulationError,
      actualFrequency: simCtx.actualFrequency,
      frameRateLimit: simCtx.frameRateLimit,
      snapshot: simCtx.snapshot,
      rootCircuitMap: simCtx.rootCircuitMap ?? simCtx.circuitMap,
      selectedCircuitMap: simCtx.selectedCircuitMap,
    }),
    startSimulation: simCtx.startSimulation,
    pauseSimulation: simCtx.pauseSimulation,
    stopSimulation: simCtx.stopSimulation,
    reset: simCtx.reset,
    step: simCtx.step,
    ensurePausedSimulation: simCtx.ensurePausedSimulation,
    setFrameRateLimit: simCtx.setFrameRateLimit,
    selectCircuitMap: simCtx.selectCircuitMap,
    setButtonState: simCtx.setButtonState,
    toggleButton: simCtx.toggleButton,
    pullSnapshot: simCtx.pullSnapshot,
  };

  const getSnapshot = (): McpCircuitSnapshot => ({
    project: circuitCtx.project,
    currentCircuit: circuitCtx.currentCircuit,
    selectedSymbolIds: [],
    selectedTextNoteIds: [],
    selectedWireIds: [],
    isSimulating: simCtx.isSimulating,
    actions: {
      addEntities: circuitCtx.addEntities,
      moveEntities: circuitCtx.moveEntities,
      rotateSymbols: circuitCtx.rotateSymbols,
      removeEntities: circuitCtx.removeEntities,
      setCurrentCircuitId: circuitCtx.setCurrentCircuitId,
      updateCircuitProperties: circuitCtx.updateCircuitProperties,
      updateCircuitSymbolProperties: circuitCtx.updateCircuitSymbolProperties,
      resizeCircuitSymbol: circuitCtx.resizeCircuitSymbol,
      updateTextNote: circuitCtx.updateTextNote,
      createCircuits: circuitCtx.createCircuits,
      deleteCircuits: circuitCtx.deleteCircuits,
      getCurrentCircuit: () => circuitCtx.currentCircuit,
      getProject: () => circuitCtx.project,
    },
    simulation: simulationActions,
  });

  return {
    getCircuitCtx: () => circuitCtx,
    getSimCtx: () => simCtx,
    getSnapshot,
  };
}

describe("T-020: MCP-Simulationswerkzeuge", () => {
  it("validate_circuit erkennt fehlerfreie Schaltungen sowie offene Eingänge, Kurzschlüsse und Bitbreiten-Konflikte", async () => {
    const harness = createSimulationHarness();

    // Fall A: Offener Eingang an einem AND-Gatter
    let andId = "";
    let btn1Id = "";
    let btn2Id = "";
    React.act(() => {
      const res = addElements(harness.getSnapshot(), {
        components: [
          { ref: "b1", type: "button", x: 2, y: 4, isToggle: true, notation: "A" },
          { ref: "b2", type: "button", x: 2, y: 8, isToggle: true, notation: "B" },
          { ref: "g", type: "and", x: 8, y: 4 },
          { ref: "l", type: "led", x: 14, y: 5 },
        ],
        wires: [
          { from: { ref: "b1", pinName: "Out" }, to: { ref: "g", pinName: "In 1" } },
          { from: { ref: "g", pinName: "Out" }, to: { ref: "l", pinName: "In" } },
        ],
      });
      btn1Id = res.symbols.find((s) => s.ref === "b1")!.circuitSymbolId;
      btn2Id = res.symbols.find((s) => s.ref === "b2")!.circuitSymbolId;
      andId = res.symbols.find((s) => s.ref === "g")!.circuitSymbolId;
    });

    const openInputReport = (await executeMcpTool("validate_circuit", {}, harness.getSnapshot())) as {
      valid: boolean;
      clean: boolean;
      errorCount: number;
      warningCount: number;
      warnings: Array<{ type: string; symbolId: string; pinName: string }>;
    };
    expect(openInputReport.valid).toBe(true);
    expect(openInputReport.clean).toBe(false);
    expect(openInputReport.warningCount).toBe(1);
    expect(openInputReport.warnings[0].type).toBe("unconnectedInput");
    expect(openInputReport.warnings[0].symbolId).toBe(andId);
    expect(openInputReport.warnings[0].pinName).toBe("In 2");

    // Fall B: Zweiten Eingang korrekt verdrahten -> Schaltung ist valid & clean
    React.act(() => {
      addElements(harness.getSnapshot(), {
        wires: [
          {
            from: { symbolId: btn2Id, pinName: "Out" },
            to: { symbolId: andId, pinName: "In 2" },
            route: "horizontal-first",
          },
        ],
      });
    });

    const cleanReport = (await executeMcpTool("validate_circuit", {}, harness.getSnapshot())) as {
      valid: boolean;
      clean: boolean;
      errorCount: number;
      warningCount: number;
    };
    expect(cleanReport.valid).toBe(true);
    expect(cleanReport.clean).toBe(true);
    expect(cleanReport.errorCount).toBe(0);
    expect(cleanReport.warningCount).toBe(0);

    // Fall C: Kurzschluss (zwei Ausgänge auf demselben Conductor) + Bitbreiten-Konflikt prüfen
    React.act(() => {
      addElements(harness.getSnapshot(), {
        components: [{ ref: "c4", type: "constant", x: 2, y: 12, bitWidth: 4, value: 5 }],
        wires: [
          {
            from: { symbolId: btn1Id, pinName: "Out" },
            to: { ref: "c4", pinName: "Out" },
            route: "vertical-first",
          },
        ],
      });
    });

    const conflictReport = (await executeMcpTool("validate_circuit", {}, harness.getSnapshot())) as {
      valid: boolean;
      errorCount: number;
      errors: Array<{ type: string }>;
    };
    expect(conflictReport.valid).toBe(false);
    expect(conflictReport.errorCount).toBeGreaterThan(0);
    expect(conflictReport.errors.some((e) => e.type === "both" || e.type === "multipleOutputs" || e.type === "bitWidthMismatch")).toBe(true);
  });

  it("steuert Eingänge, simuliert auf expliziter Root-CircuitId und wertet mehrfach platzierte SubCircuits per instancePath aus", async () => {
    const harness = createSimulationHarness();
    const mainId = harness.getCircuitCtx().currentCircuit.logicalCircuitId;

    // SubCircuit "FullAdder1Bit" anlegen und verdrahten
    let faCircuitId = "";
    React.act(() => {
      const created = createCircuitsTool(harness.getSnapshot(), {
        circuits: [{ name: "FullAdder 1-Bit", category: "Arithmetik" }],
      });
      faCircuitId = created.circuits[0].logicalCircuitId;
      setCurrentCircuit(harness.getSnapshot(), { circuitId: faCircuitId });

      addElements(harness.getSnapshot(), {
        components: [
          { ref: "a", type: "pinIn", name: "A", notation: "A", x: 2, y: 4 },
          { ref: "b", type: "pinIn", name: "B", notation: "B", x: 2, y: 8 },
          { ref: "cin", type: "pinIn", name: "Cin", notation: "Cin", x: 2, y: 12 },
          { ref: "xor1", type: "xor", x: 8, y: 4 },
          { ref: "and1", type: "and", x: 8, y: 15 },
          { ref: "xor2", type: "xor", x: 16, y: 6 },
          { ref: "and2", type: "and", x: 16, y: 11 },
          { ref: "or1", type: "or", x: 23, y: 14 },
          { ref: "s", type: "pinOut", name: "S", notation: "S", x: 29, y: 7 },
          { ref: "cout", type: "pinOut", name: "Cout", notation: "Cout", x: 29, y: 15 },
        ],
        wires: [
          { from: { x: 4, y: 5 }, to: { x: 5, y: 5 } },
          { from: { x: 5, y: 5 }, to: { x: 8, y: 5 } },
          { from: { x: 5, y: 5 }, to: { x: 8, y: 16 }, route: "vertical-first" },
          { from: { x: 4, y: 9 }, to: { x: 6, y: 9 } },
          { from: { x: 6, y: 9 }, to: { x: 8, y: 7 }, route: "vertical-first" },
          { from: { x: 6, y: 9 }, to: { x: 8, y: 18 }, route: "vertical-first" },
          { from: { x: 4, y: 13 }, to: { x: 14, y: 13 } },
          { from: { x: 14, y: 13 }, to: { x: 16, y: 9 }, route: "vertical-first" },
          { from: { x: 14, y: 13 }, to: { x: 16, y: 14 }, route: "vertical-first" },
          { from: { x: 11, y: 6 }, to: { x: 12, y: 7 }, route: "horizontal-first" },
          { from: { x: 12, y: 7 }, to: { x: 16, y: 7 } },
          { from: { x: 12, y: 7 }, to: { x: 16, y: 12 }, route: "vertical-first" },
          { from: { x: 19, y: 13 }, to: { x: 21, y: 13 } },
          { from: { x: 21, y: 13 }, to: { x: 23, y: 15 }, route: "vertical-first" },
          { from: { x: 11, y: 17 }, to: { x: 23, y: 17 } },
          { from: { x: 19, y: 8 }, to: { x: 29, y: 8 } },
          { from: { x: 26, y: 16 }, to: { x: 29, y: 16 } },
        ],
      });

      setCurrentCircuit(harness.getSnapshot(), { circuitId: mainId });
    });

    // Ripple-Carry Adder (2-Bit) mit 2 Instanzen von FullAdder 1-Bit in Main bauen
    let a0Sym = "";
    let b0Sym = "";
    let cinSym = "";
    let a1Sym = "";
    let b1Sym = "";
    let fa0Sym = "";
    let fa1Sym = "";
    let ledS0 = "";
    let ledS1 = "";
    let ledCout = "";

    React.act(() => {
      const built = addElements(harness.getSnapshot(), {
        components: [
          { ref: "a0", type: "button", isToggle: true, notation: "A0", x: 2, y: 4 },
          { ref: "b0", type: "button", isToggle: true, notation: "B0", x: 2, y: 7 },
          { ref: "cin", type: "button", isToggle: true, notation: "Cin", x: 2, y: 10 },
          { ref: "a1", type: "button", isToggle: true, notation: "A1", x: 2, y: 15 },
          { ref: "b1", type: "button", isToggle: true, notation: "B1", x: 2, y: 18 },
          { ref: "fa0", type: "subCircuit", subCircuitId: faCircuitId, x: 9, y: 4 },
          { ref: "fa1", type: "subCircuit", subCircuitId: faCircuitId, x: 14, y: 13 },
          { ref: "s0", type: "led", x: 24, y: 5 },
          { ref: "s1", type: "led", x: 24, y: 14 },
          { ref: "cout", type: "led", x: 24, y: 17 },
        ],
        wires: [
          { from: { ref: "a0", pinName: "Out" }, to: { ref: "fa0", pinName: "A" } },
          { from: { x: 4, y: 8 }, to: { x: 7, y: 8 } },
          { from: { x: 7, y: 8 }, to: { ref: "fa0", pinName: "B" }, route: "vertical-first" },
          { from: { x: 4, y: 11 }, to: { x: 8, y: 11 } },
          { from: { x: 8, y: 11 }, to: { ref: "fa0", pinName: "Cin" }, route: "vertical-first" },
          { from: { x: 4, y: 16 }, to: { x: 10, y: 16 } },
          { from: { x: 10, y: 16 }, to: { ref: "fa1", pinName: "A" }, route: "vertical-first" },
          { from: { x: 4, y: 19 }, to: { x: 11, y: 19 } },
          { from: { x: 11, y: 19 }, to: { ref: "fa1", pinName: "B" }, route: "vertical-first" },
          { from: { ref: "fa0", pinName: "Cout" }, to: { x: 13, y: 7 } },
          { from: { x: 13, y: 7 }, to: { ref: "fa1", pinName: "Cin" }, route: "vertical-first" },
          { from: { ref: "fa0", pinName: "S" }, to: { x: 22, y: 5 } },
          { from: { x: 22, y: 5 }, to: { ref: "s0", pinName: "In" }, route: "vertical-first" },
          { from: { ref: "fa1", pinName: "S" }, to: { x: 21, y: 14 } },
          { from: { x: 21, y: 14 }, to: { ref: "s1", pinName: "In" }, route: "vertical-first" },
          { from: { ref: "fa1", pinName: "Cout" }, to: { x: 20, y: 16 } },
          { from: { x: 20, y: 16 }, to: { ref: "cout", pinName: "In" }, route: "vertical-first" },
        ],
      });

      const byRef = (ref: string) => built.symbols.find((s) => s.ref === ref)!.circuitSymbolId;
      a0Sym = byRef("a0");
      b0Sym = byRef("b0");
      cinSym = byRef("cin");
      a1Sym = byRef("a1");
      b1Sym = byRef("b1");
      fa0Sym = byRef("fa0");
      fa1Sym = byRef("fa1");
      ledS0 = byRef("s0");
      ledS1 = byRef("s1");
      ledCout = byRef("cout");

      // Editor absichtlich auf SubCircuit umstellen, um Root-Start über circuitId zu prüfen
      setCurrentCircuit(harness.getSnapshot(), { circuitId: faCircuitId });
    });

    // Eingänge setzen: A0=1, B0=1, Cin=1 (ergibt Bit0 S0=1, C1=1), A1=1, B1=0 (ergibt Bit1 S1=0, Cout=1)
    const inputRes = (await executeMcpTool(
      "set_input_signal",
      {
        circuitId: mainId,
        inputs: [
          { symbolId: a0Sym, on: true },
          { symbolId: b0Sym, on: true },
          { symbolId: cinSym, on: true },
          { symbolId: a1Sym, on: true },
          { symbolId: b1Sym, on: false },
        ],
      },
      harness.getSnapshot(),
    )) as { rootCircuitId: string; updated: Array<{ symbolId: string; isOn: boolean }> };

    expect(inputRes.rootCircuitId).toBe(mainId);
    expect(inputRes.updated.find((u) => u.symbolId === a0Sym)?.isOn).toBe(true);
    expect(inputRes.updated.find((u) => u.symbolId === b1Sym)?.isOn).toBe(false);

    // 2 Frames auf Root-Schaltung simulieren + Root-Status prüfen
    const rootStep = (await executeMcpTool(
      "step_simulation",
      {
        circuitId: mainId,
        steps: 2,
        includeState: true,
        symbolIds: [ledS0, ledS1, ledCout],
      },
      harness.getSnapshot(),
    )) as {
      stepsCompleted: number;
      telemetry: { totalSteps: number; isPaused: boolean };
      state: {
        instances: Array<{ instancePath: string[]; circuitId: string }>;
        symbols: Array<{ circuitSymbolId: string; led?: { isOn: boolean } }>;
      };
    };

    expect(rootStep.stepsCompleted).toBe(2);
    expect(rootStep.telemetry.totalSteps).toBe(2);
    expect(rootStep.telemetry.isPaused).toBe(true);
    expect(rootStep.state.instances.map((i) => i.instancePath)).toEqual([
      [],
      [fa0Sym],
      [fa1Sym],
    ]);
    expect(rootStep.state.symbols.find((s) => s.circuitSymbolId === ledS0)?.led?.isOn).toBe(true);
    expect(rootStep.state.symbols.find((s) => s.circuitSymbolId === ledS1)?.led?.isOn).toBe(false);
    expect(rootStep.state.symbols.find((s) => s.circuitSymbolId === ledCout)?.led?.isOn).toBe(true);

    // Eindeutige SubCircuit-Instanz 1 (fa0) mit steps=0 abfragen: S=1, Cout=1
    const fa0State = (await executeMcpTool(
      "step_simulation",
      {
        instancePath: [fa0Sym],
        steps: 0,
        includeState: true,
      },
      harness.getSnapshot(),
    )) as {
      telemetry: { totalSteps: number };
      state: {
        activeInstance: { instancePath: string[]; circuitId: string };
        symbols: Array<{ name: string; jams: Array<{ pinName: string; signal: { text: string } }> }>;
        wires: Array<{ wireId: string; text: string }>;
      };
    };

    expect(fa0State.telemetry.totalSteps).toBe(2);
    expect(fa0State.state.activeInstance.instancePath).toEqual([fa0Sym]);
    expect(fa0State.state.symbols.find((s) => s.name === "S")?.jams[0].signal.text).toBe("1");
    expect(fa0State.state.symbols.find((s) => s.name === "Cout")?.jams[0].signal.text).toBe("1");
    expect(fa0State.state.wires.length).toBeGreaterThan(0);
    expect(fa0State.state.wires.every((w) => w.text === "0" || w.text === "1")).toBe(true);

    // Eindeutige SubCircuit-Instanz 2 (fa1) mit steps=0 abfragen: A=1, B=0, Cin=1 -> S=0, Cout=1
    const fa1State = (await executeMcpTool(
      "step_simulation",
      {
        instancePath: [fa1Sym],
        steps: 0,
        includeState: true,
      },
      harness.getSnapshot(),
    )) as {
      telemetry: { totalSteps: number };
      state: {
        activeInstance: { instancePath: string[]; circuitId: string };
        symbols: Array<{ name: string; jams: Array<{ pinName: string; signal: { text: string } }> }>;
        wires: Array<{ wireId: string; text: string }>;
      };
    };

    expect(fa1State.telemetry.totalSteps).toBe(2);
    expect(fa1State.state.activeInstance.instancePath).toEqual([fa1Sym]);
    expect(fa1State.state.symbols.find((s) => s.name === "A")?.jams[0].signal.text).toBe("1");
    expect(fa1State.state.symbols.find((s) => s.name === "B")?.jams[0].signal.text).toBe("0");
    expect(fa1State.state.symbols.find((s) => s.name === "Cin")?.jams[0].signal.text).toBe("1");
    expect(fa1State.state.symbols.find((s) => s.name === "S")?.jams[0].signal.text).toBe("0");
    expect(fa1State.state.symbols.find((s) => s.name === "Cout")?.jams[0].signal.text).toBe("1");
    expect(fa1State.state.wires.length).toBe(fa0State.state.wires.length);
    expect(fa1State.state.wires.every((w) => w.text === "0" || w.text === "1")).toBe(true);
    expect(fa1State.state.wires.map((w) => w.text)).not.toEqual(fa0State.state.wires.map((w) => w.text));

    // Dauerlauf starten, pausieren und stoppen prüfen
    const started = (await executeMcpTool(
      "step_simulation",
      { action: "start", frameRateLimit: 60 },
      harness.getSnapshot(),
    )) as { telemetry: { isRunning: boolean; frameRateLimit: number } };
    expect(started.telemetry.isRunning).toBe(true);
    expect(started.telemetry.frameRateLimit).toBe(60);

    const paused = (await executeMcpTool(
      "step_simulation",
      { action: "pause" },
      harness.getSnapshot(),
    )) as { telemetry: { isPaused: boolean; isRunning: boolean } };
    expect(paused.telemetry.isPaused).toBe(true);
    expect(paused.telemetry.isRunning).toBe(false);

    const stopped = (await executeMcpTool(
      "step_simulation",
      { action: "stop" },
      harness.getSnapshot(),
    )) as { telemetry: { isSimulating: boolean } };
    expect(stopped.telemetry.isSimulating).toBe(false);

    // Fehlerfälle prüfen
    await expect(
      executeMcpTool("step_simulation", { action: "stop", steps: 5 }, harness.getSnapshot()),
    ).rejects.toThrow(/steps/);
    await expect(
      executeMcpTool("step_simulation", { instancePath: ["ungueltig"] }, harness.getSnapshot()),
    ).rejects.toThrow(/Instanzpfad/);
  });

  it("rendert CircuitSymbolView-LEDs in SubCircuit-Instanzen anhand von selectedCircuitMap statt rootCircuitMap", async () => {
    const harness = createSimulationHarness();
    const mainId = harness.getCircuitCtx().currentCircuit.logicalCircuitId;

    let subId = "";
    let ledInSubId = "";
    let sub0Id = "";
    let sub1Id = "";

    React.act(() => {
      const created = createCircuitsTool(harness.getSnapshot(), {
        circuits: [{ name: "LedSub" }],
      });
      subId = created.circuits[0].logicalCircuitId;
      setCurrentCircuit(harness.getSnapshot(), { circuitId: subId });

      const inner = addElements(harness.getSnapshot(), {
        components: [
          { ref: "in", type: "pinIn", name: "X", notation: "X", x: 2, y: 4 },
          { ref: "led", type: "led", x: 8, y: 4 },
        ],
        wires: [{ from: { ref: "in", pinName: "X" }, to: { ref: "led", pinName: "In" } }],
      });
      ledInSubId = inner.symbols.find((s) => s.ref === "led")!.circuitSymbolId;

      setCurrentCircuit(harness.getSnapshot(), { circuitId: mainId });
      const outer = addElements(harness.getSnapshot(), {
        components: [
          { ref: "c1", type: "constant", value: 1, x: 2, y: 4 },
          { ref: "c0", type: "constant", value: 0, x: 2, y: 10 },
          { ref: "s0", type: "subCircuit", subCircuitId: subId, x: 8, y: 4 },
          { ref: "s1", type: "subCircuit", subCircuitId: subId, x: 8, y: 10 },
        ],
        wires: [
          { from: { ref: "c1", pinName: "Out" }, to: { ref: "s0", pinName: "X" } },
          { from: { ref: "c0", pinName: "Out" }, to: { ref: "s1", pinName: "X" } },
        ],
      });
      sub0Id = outer.symbols.find((s) => s.ref === "s0")!.circuitSymbolId;
      sub1Id = outer.symbols.find((s) => s.ref === "s1")!.circuitSymbolId;
    });

    await executeMcpTool("step_simulation", { circuitId: mainId, steps: 1 }, harness.getSnapshot());
    const simCtx = harness.getSimCtx();
    const rootMap = simCtx.rootCircuitMap!;
    const sub0Map = rootMap.children.get(sub0Id)!;
    const sub1Map = rootMap.children.get(sub1Id)!;
    const ledSymbol = sub0Map.findSymbol(ledInSubId)!;

    const renderWithSelectedMap = (selectedMap: typeof sub0Map) =>
      renderToStaticMarkup(
        React.createElement(
          SimulationContext.Provider,
          {
            value: {
              ...simCtx,
              circuitMap: rootMap,
              rootCircuitMap: rootMap,
              selectedCircuitMap: selectedMap,
            },
          },
          React.createElement(
            "svg",
            null,
            React.createElement(CircuitSymbolView, { symbol: ledSymbol }),
          ),
        ),
      );

    // Instanz 0 (Constant 1 -> X=1) vs Instanz 1 (Constant 0 -> X=0)
    const svg0 = renderWithSelectedMap(sub0Map);
    const svg1 = renderWithSelectedMap(sub1Map);
    expect(svg0).not.toEqual(svg1);
    expect(svg0).toContain("led-lens is-on\"");
    expect(svg0).toContain("fill=\"url(#led-on-grad-");
    expect(svg1).toContain("led-lens is-on0\"");
    expect(svg1).toContain("fill=\"#5B4949\"");
  });

  it("steuert mehrere Taster gleichzeitig sowie zeitgesteuerte 35-Takte-Events auch ohne Taktgeber", async () => {
    const harness = createSimulationHarness();

    let switchASym = "";
    let pushBSym = "";
    let pushCSym = "";
    let ledBothSym = "";
    React.act(() => {
      const built = addElements(harness.getSnapshot(), {
        components: [
          { ref: "swA", type: "button", x: 2, y: 2, isToggle: true, notation: "A" },
          { ref: "btnB", type: "button", x: 2, y: 6, isToggle: false, notation: "T_B" },
          { ref: "btnC", type: "button", x: 2, y: 10, isToggle: false, notation: "T_C" },
          { ref: "andBC", type: "and", x: 10, y: 6 },
          { ref: "andAll", type: "and", x: 18, y: 4 },
          { ref: "pA", type: "probe", name: "ProbeA", x: 10, y: 2 },
          { ref: "pBoth", type: "probe", name: "ProbeAll", x: 24, y: 4 },
          { ref: "ledBoth", type: "led", x: 24, y: 8 },
        ],
        wires: [
          { from: { ref: "swA", pinName: "Out" }, to: { ref: "pA", pinName: "In" } },
          { from: { ref: "swA", pinName: "Out" }, to: { ref: "andAll", pinName: "In 1" } },
          { from: { ref: "btnB", pinName: "Out" }, to: { ref: "andBC", pinName: "In 1" } },
          { from: { ref: "btnC", pinName: "Out" }, to: { ref: "andBC", pinName: "In 2" } },
          { from: { ref: "andBC", pinName: "Out" }, to: { ref: "andAll", pinName: "In 2" } },
          { from: { ref: "andAll", pinName: "Out" }, to: { ref: "pBoth", pinName: "In" } },
          { from: { ref: "andAll", pinName: "Out" }, to: { ref: "ledBoth", pinName: "In" } },
        ],
      });
      switchASym = built.symbols.find((s) => s.ref === "swA")!.circuitSymbolId;
      pushBSym = built.symbols.find((s) => s.ref === "btnB")!.circuitSymbolId;
      pushCSym = built.symbols.find((s) => s.ref === "btnC")!.circuitSymbolId;
      ledBothSym = built.symbols.find((s) => s.ref === "ledBoth")!.circuitSymbolId;
    });

    // Auch ohne Taktgeber darf step_simulation(steps: 10) ohne Events nicht hängenbleiben
    const freeTen = (await executeMcpTool(
      "step_simulation",
      { steps: 10, includeState: true },
      harness.getSnapshot(),
    )) as {
      stepsCompleted: number;
      telemetry: { totalSteps: number; hasClocks: boolean; isPaused: boolean };
    };
    expect(freeTen.stepsCompleted).toBe(10);
    expect(freeTen.telemetry.totalSteps).toBe(10);
    expect(freeTen.telemetry.hasClocks).toBe(false);
    expect(freeTen.telemetry.isPaused).toBe(true);

    // Im Pause-Modus aktualisieren gleichzeitige Tasterdrücke via set_input_signal sofort bei steps: 0
    await executeMcpTool(
      "set_input_signal",
      {
        inputs: [
          { symbolId: switchASym, on: true },
          { symbolId: pushBSym, on: true },
          { symbolId: pushCSym, on: true },
        ],
      },
      harness.getSnapshot(),
    );

    const immediateZeroStep = (await executeMcpTool(
      "step_simulation",
      { steps: 0, includeState: true },
      harness.getSnapshot(),
    )) as {
      stepsCompleted: number;
      telemetry: { totalSteps: number };
      state: {
        probes: Array<{ name: string; numeric: number | null; text: string }>;
        symbols: Array<{ circuitSymbolId: string; led?: { isOn: boolean; signal: string } }>;
      };
    };
    expect(immediateZeroStep.stepsCompleted).toBe(0);
    expect(immediateZeroStep.telemetry.totalSteps).toBe(10);
    expect(immediateZeroStep.state.probes.find((p) => p.name === "ProbeAll")?.numeric).toBe(1);
    const ledNow = immediateZeroStep.state.symbols.find((s) => s.circuitSymbolId === ledBothSym)!;
    expect(ledNow.led?.isOn).toBe(true);
    expect(ledNow.led?.signal).toBe("1");

    // Reset für einen zusammenhängenden 35-Takte-Lauf mit zeitgesteuerten Events
    await executeMcpTool("step_simulation", { action: "stop" }, harness.getSnapshot());

    const scheduledRun = (await executeMcpTool(
      "step_simulation",
      {
        steps: 35,
        events: [
          { atStep: 3, symbolId: switchASym, toggle: true },
          { atStep: 7, symbolId: pushBSym, on: true },
          { atStep: 7, symbolId: pushCSym, on: true },
          { atStep: 9, symbolId: pushBSym, on: false },
        ],
        includeState: true,
      },
      harness.getSnapshot(),
    )) as {
      stepsRequested: number;
      stepsCompleted: number;
      eventsExecuted: Array<{ atStep: number; symbolId: string; action: string; finalIsOn: boolean }>;
      telemetry: { totalSteps: number; hasClocks: boolean };
      state: {
        probes: Array<{ name: string; numeric: number | null }>;
        buttons: Array<{ notation: string; isOn: boolean }>;
      };
    };

    expect(scheduledRun.stepsRequested).toBe(35);
    expect(scheduledRun.stepsCompleted).toBe(35);
    expect(scheduledRun.telemetry.totalSteps).toBe(35);
    expect(scheduledRun.telemetry.hasClocks).toBe(false);
    expect(scheduledRun.eventsExecuted).toHaveLength(4);
    expect(scheduledRun.eventsExecuted.map((e) => e.atStep)).toEqual([3, 7, 7, 9]);
    // Schalter A bleibt nach Toggle bei Takt 3 eingeschaltet, Taster C gehalten, Taster B bei Takt 9 losgelassen
    expect(scheduledRun.eventsExecuted[0].finalIsOn).toBe(true);
    expect(scheduledRun.eventsExecuted[2].finalIsOn).toBe(true);
    expect(scheduledRun.eventsExecuted[3].finalIsOn).toBe(false);
    expect(scheduledRun.state.probes.find((p) => p.name === "ProbeA")?.numeric).toBe(1);
    expect(scheduledRun.state.probes.find((p) => p.name === "ProbeAll")?.numeric).toBe(0);

    // Fehlerfall: Event außerhalb 0..steps muss vor Ausführung abgewiesen werden
    await expect(
      executeMcpTool(
        "step_simulation",
        {
          steps: 5,
          events: [{ atStep: 6, symbolId: switchASym, toggle: true }],
        },
        harness.getSnapshot(),
      ),
    ).rejects.toThrow("darf höchstens 5 sein");
  });

  it("B-001: meldet ausgeführte zeitgesteuerte Events auch bei sofortiger Oszillation mit stepsCompleted === 0", async () => {
    const harness = createSimulationHarness();

    let enableSym = "";
    React.act(() => {
      const built = addElements(harness.getSnapshot(), {
        components: [
          { ref: "swEnable", type: "button", x: 2, y: 4, isToggle: true, notation: "EN" },
          { ref: "gateAnd", type: "and", x: 10, y: 4 },
          { ref: "gateNot", type: "not", x: 18, y: 4 },
        ],
        wires: [
          { from: { ref: "swEnable", pinName: "Out" }, to: { ref: "gateAnd", pinName: "In 1" } },
          { from: { ref: "gateAnd", pinName: "Out" }, to: { ref: "gateNot", pinName: "In" } },
          { from: { ref: "gateNot", pinName: "Out" }, to: { ref: "gateAnd", pinName: "In 2" } },
        ],
      });
      enableSym = built.symbols.find((s) => s.ref === "swEnable")!.circuitSymbolId;
    });

    const result = (await executeMcpTool(
      "step_simulation",
      {
        steps: 1,
        events: [{ atStep: 1, symbolId: enableSym, on: true }],
      },
      harness.getSnapshot(),
    )) as {
      stepsCompleted: number;
      eventsExecuted: Array<{ atStep: number; symbolId: string; action: string; finalIsOn: boolean }>;
      telemetry: { isOscillating: boolean };
    };

    expect(result.telemetry.isOscillating).toBe(true);
    expect(result.stepsCompleted).toBe(0);
    expect(result.eventsExecuted).toHaveLength(1);
    expect(result.eventsExecuted[0].atStep).toBe(1);
    expect(result.eventsExecuted[0].symbolId).toBe(enableSym);
    expect(result.eventsExecuted[0].finalIsOn).toBe(true);
  });
});
