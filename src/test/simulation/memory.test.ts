import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../../contexts/circuitContext";
import CircuitContextProvider from "../../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../../contexts/simulationContext";
import SimulationContextProvider from "../../contexts/simulationContext/provider";

import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type McpCircuitSnapshot from "../../types/mcp/mcpCircuitSnapshot";
import type McpSimulationActions from "../../types/mcp/mcpSimulationActions";
import { STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import { executeMcpTool } from "../../mcp/mcpTools";
import CircuitException from "../../simulation/compiler/circuitException";
import CircuitMap, { getMemoryInstanceId } from "../../simulation/compiler/circuitMap";
import FunctionLed from "../../simulation/functions/io/functionLed";
import FunctionProbe from "../../simulation/functions/io/functionProbe";
import FunctionRam from "../../simulation/functions/memory/functionRam";
import FunctionRom from "../../simulation/functions/memory/functionRom";
import SimulationClient from "../../simulation/worker/simulationClient";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createMemory,
  createSplitter,
} from "../../utils/circuitLayout";
import {
  decodeMemoryData,
  encodeMemoryData,
  getCellValue,
  setCellValue,
  totalBytesFor,
} from "../../utils/memoryDataUtils";
import { createWire } from "../../utils/wireUtils";

import { dispatchSimulationSymbolDoubleClick } from "../../components/circuitCanvas";
import MemoryInspectorDialog from "../../components/memoryInspectorDialog";

const SEVEN_SEG_HEX_DIGITS = [
  0x3f, 0x06, 0x5b, 0x4f,
  0x66, 0x6d, 0x7d, 0x07,
  0x7f, 0x6f, 0x77, 0x7c,
  0x39, 0x5e, 0x79, 0x71,
];

function findJam(symbol: CircuitSymbol, pinNamePrefix: string) {
  const jam = symbol.jams.find((j) => j.pin.name === pinNamePrefix || j.pin.name.startsWith(pinNamePrefix));
  if (!jam) {
    throw new Error(`Pin "${pinNamePrefix}" an "${symbol.circuit.name}" nicht gefunden.`);
  }
  return jam;
}

function buildContextHarness(initialProject = createEmptyCircuitProject("Memory Sim Test", "Main", "main")) {
  let circuitCtx!: React.ContextType<typeof CircuitContext>;
  let simCtx!: React.ContextType<typeof SimulationContext>;

  const Capture: React.FC = () => {
    circuitCtx = React.useContext(CircuitContext);
    simCtx = React.useContext(SimulationContext);
    return null;
  };

  renderToStaticMarkup(
    React.createElement(CircuitContextProvider, {
      initialProject,
      initialCircuitId: "main",
      children: React.createElement(SimulationContextProvider, {
        children: React.createElement(Capture, null),
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
    flushPersistentMemories: simCtx.flushPersistentMemories,
    readMemorySlice: simCtx.readMemorySlice,
    writeMemoryCell: simCtx.writeMemoryCell,
    step: simCtx.step,
    ensurePausedSimulation: simCtx.ensurePausedSimulation,
    setFrameRateLimit: simCtx.setFrameRateLimit,
    selectCircuitMap: simCtx.selectCircuitMap,
    setButtonState: simCtx.setButtonState,
    toggleButton: simCtx.toggleButton,
    pullSnapshot: simCtx.pullSnapshot,
  };

  const getMcpSnapshot = (): McpCircuitSnapshot => ({
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
    getMcpSnapshot,
  };
}

describe("ROM- und RAM-Simulations-Engine", () => {
  it("treibt eine 7-Segment-Anzeige und Probe über alle 16 Adressen (0x0..0xF) eines ROMs", async () => {
    const rawBytes = new Uint8Array(totalBytesFor(4, 8));
    SEVEN_SEG_HEX_DIGITS.forEach((pattern, addr) => {
      setCellValue(rawBytes, 8, addr, pattern);
    });
    const encoded = encodeMemoryData(rawBytes, 4, 8);

    const lc = createDefaultLogicalCircuit("main", "RomSevenSeg");
    const rom = createMemory("rom-7seg", false, 4, 8, { data: encoded });
    const romSym = createCircuitSymbol(rom, "main", 22, 6, "up", "sym-rom");

    const addrSplitter = createSplitter("sp-addr", 4, 4, false);
    const addrSplitterSym = createCircuitSymbol(addrSplitter, "main", 14, 4, "up", "sym-sp-addr");

    const bitButtons = [0, 1, 2, 3].map((bit) =>
      createCircuitSymbol(
        createCircuitButton(`btn-a${bit}`, `A${bit}`, true, "right"),
        "main",
        2,
        2 + bit * 4,
        "up",
        `sym-btn-a${bit}`,
      ),
    );

    const segSplitter = createSplitter("sp-seg", 8, 8, true);
    const segSplitterSym = createCircuitSymbol(segSplitter, "main", 30, 4, "up", "sym-sp-seg");

    const sevenSeg = createGate("led", 8, false, "red");
    const sevenSegSym = createCircuitSymbol(sevenSeg, "main", 40, 6, "up", "sym-7seg");

    const probe = createCircuitProbe("probe-rom", "ROMOut", "left");
    const probeSym = createCircuitSymbol(probe, "main", 34, 1, "up", "sym-probe");

    const wires = [
      ...bitButtons.map((btnSym, bit) =>
        createWire(
          "main",
          findJam(btnSym, "").absolutePoint,
          addrSplitterSym.jams.find((j) => j.pin.pinId === `sp-addr-thin-${bit}`)!.absolutePoint,
          `w-addr-bit-${bit}`,
        ),
      ),
      createWire(
        "main",
        addrSplitterSym.jams.find((j) => j.pin.pinId === "sp-addr-bus")!.absolutePoint,
        findJam(romSym, "Address").absolutePoint,
        "w-addr-bus",
      ),
      createWire(
        "main",
        findJam(romSym, "Data").absolutePoint,
        segSplitterSym.jams.find((j) => j.pin.pinId === "sp-seg-bus")!.absolutePoint,
        "w-data-bus",
      ),
      createWire(
        "main",
        findJam(romSym, "Data").absolutePoint,
        probeSym.jams[0].absolutePoint,
        "w-data-probe",
      ),
      ...Array.from({ length: 8 }, (_, bit) =>
        createWire(
          "main",
          segSplitterSym.jams.find((j) => j.pin.pinId === `sp-seg-thin-${bit}`)!.absolutePoint,
          sevenSegSym.jams.find((j) => j.pin.pinId === `in-${bit}`)!.absolutePoint,
          `w-seg-${bit}`,
        ),
      ),
    ];

    lc.circuitSymbols = [
      ...bitButtons,
      addrSplitterSym,
      romSym,
      segSplitterSym,
      sevenSegSym,
      probeSym,
    ];
    lc.wires = wires;

    const map = new CircuitMap(lc);
    const state = map.apply();
    expect(state.evaluate(false)).toBe(true);

    const romFn = state.functions.find((fn): fn is FunctionRom => fn instanceof FunctionRom);
    const segFn = state.functions.find(
      (fn): fn is FunctionLed => fn instanceof FunctionLed && fn.displayType === "sevenSegment",
    );
    const probeFn = state.probes.find(
      (fn): fn is FunctionProbe => fn instanceof FunctionProbe && fn.probeId === "probe-rom",
    );
    expect(romFn).toBeDefined();
    expect(segFn).toBeDefined();
    expect(probeFn).toBeDefined();

    const client = new SimulationClient();
    await client.init(lc);
    await client.step(0);

    for (let addr = 0; addr < 16; addr++) {
      for (let bit = 0; bit < 4; bit++) {
        const shouldBeOn = ((addr >> bit) & 1) === 1;
        const curr = (await client.pullSnapshot()).buttons[`btn-a${bit}`]?.isOn ?? false;
        if (curr !== shouldBeOn) {
          client.toggleButton(`btn-a${bit}`);
        }
      }
      const snap = await client.pullSnapshot();
      const expectedPattern = SEVEN_SEG_HEX_DIGITS[addr];
      expect(snap.probes["probe-rom"].value).toBe(expectedPattern);

      for (let seg = 0; seg < 8; seg++) {
        const segJam = sevenSegSym.jams.find((j) => j.pin.pinId === `in-${seg}`)!;
        const idx = map.jamStateIndexes(segJam)[0]!;
        const expectedState = ((expectedPattern >> seg) & 1) === 1 ? STATE_ON1 : STATE_ON0;
        expect(snap.stateArray[idx]).toBe(expectedState);
      }
    }

    await client.stop();
    client.terminate();
  });

  it("unterstützt vorzeichenlose 32-Bit-ROM-Werte sowie Dual-Port mit getrennten Data- und Data2-Ausgängen", () => {
    const raw = new Uint8Array(totalBytesFor(2, 32));
    setCellValue(raw, 32, 0, 0x12345678);
    setCellValue(raw, 32, 1, 0x80000001);
    setCellValue(raw, 32, 2, 0xffffffff);

    const lc = createDefaultLogicalCircuit("main", "DualPortRom");
    const rom = createMemory("rom-dp", false, 2, 32, {
      dualPort: true,
      data: encodeMemoryData(raw, 2, 32),
    });
    const romSym = createCircuitSymbol(rom, "main", 18, 6, "up", "sym-rom-dp");
    const a1Const = createCircuitSymbol(createConstant("c-a1", 2, 1), "main", 4, 4, "up", "sym-c-a1");
    const a2Const = createCircuitSymbol(createConstant("c-a2", 2, 2), "main", 4, 10, "up", "sym-c-a2");
    const p1 = createCircuitSymbol(createCircuitProbe("p-d1", "D1"), "main", 30, 4, "up", "sym-p-d1");
    const p2 = createCircuitSymbol(createCircuitProbe("p-d2", "D2"), "main", 30, 10, "up", "sym-p-d2");

    // Splitter auf Port 2 prüft #findStateIndexesAtPoint für Multi-Output-Primitives
    const split2 = createCircuitSymbol(createSplitter("sp-d2", 32, 2, true), "main", 26, 12, "up", "sym-sp-d2");
    const lowWordProbe = createCircuitSymbol(createCircuitProbe("p-d2-low", "D2Low"), "main", 36, 16, "up", "sym-p-d2-low");

    lc.circuitSymbols = [romSym, a1Const, a2Const, p1, p2, split2, lowWordProbe];
    lc.wires = [
      createWire("main", a1Const.jams[0].absolutePoint, findJam(romSym, "Address").absolutePoint, "w1"),
      createWire("main", a2Const.jams[0].absolutePoint, findJam(romSym, "Address2").absolutePoint, "w2"),
      createWire("main", findJam(romSym, "Data").absolutePoint, p1.jams[0].absolutePoint, "w3"),
      createWire("main", findJam(romSym, "Data2").absolutePoint, p2.jams[0].absolutePoint, "w4"),
      createWire(
        "main",
        findJam(romSym, "Data2").absolutePoint,
        split2.jams.find((j) => j.pin.pinId === "sp-d2-bus")!.absolutePoint,
        "w5",
      ),
      createWire(
        "main",
        split2.jams.find((j) => j.pin.pinId === "sp-d2-thin-0")!.absolutePoint,
        lowWordProbe.jams[0].absolutePoint,
        "w6",
      ),
    ];

    const map = new CircuitMap(lc);
    const state = map.apply();
    expect(state.evaluate(false)).toBe(true);

    const probe1 = state.probes.find((fn): fn is FunctionProbe => fn instanceof FunctionProbe && fn.probeId === "p-d1")!;
    const probe2 = state.probes.find((fn): fn is FunctionProbe => fn instanceof FunctionProbe && fn.probeId === "p-d2")!;
    const probe2Low = state.probes.find(
      (fn): fn is FunctionProbe => fn instanceof FunctionProbe && fn.probeId === "p-d2-low",
    )!;
    probe1.updateState();
    probe2.updateState();
    probe2Low.updateState();

    expect(probe1.toNumeric()).toBe(0x80000001);
    expect(probe2.toNumeric()).toBe(0xffffffff);
    expect(probe2Low.toNumeric()).toBe(0xffff);

    // Getrennte Leitungs-Indizes über Splitter-Pfad prüfen
    const lowWire = lc.wires.find((w) => w.wireId === "w6")!;
    const d1Indices = map.jamStateIndexes(findJam(romSym, "Data"));
    const d2Indices = map.jamStateIndexes(findJam(romSym, "Data2"));
    expect(map.stateIndexes(lowWire)).toEqual(d2Indices.slice(0, 16));
    expect(d2Indices).not.toEqual(d1Indices);
  });

  it("steuert flankengetriggertes RAM-Schreiben (writeOn1) inklusive Einschalt-Schutz und onStart-Modi", () => {
    const buildRamCircuit = (opts: {
      writeOn1: boolean;
      onStart: "random" | "zeros" | "ones" | "data";
      initialData?: string;
      initialWriteOn: boolean;
    }) => {
      const lc = createDefaultLogicalCircuit("main", "RamEdgeTest");
      const ram = createMemory("ram-test", true, 2, 8, {
        writeOn1: opts.writeOn1,
        onStart: opts.onStart,
        data: opts.initialData ?? "",
      });
      const ramSym = createCircuitSymbol(ram, "main", 20, 6, "up", "sym-ram");
      const addrConst = createCircuitSymbol(createConstant("c-addr", 2, 1), "main", 4, 4, "up", "sym-addr");
      const dataConst = createCircuitSymbol(createConstant("c-data", 8, 0xa5), "main", 4, 10, "up", "sym-data");
      const writeBtn = createCircuitButton("btn-w", "W", true, "right");
      const writeSym = createCircuitSymbol(writeBtn, "main", 14, 16, "up", "sym-write");
      const outProbe = createCircuitSymbol(createCircuitProbe("p-out", "Out"), "main", 32, 6, "up", "sym-p-out");

      lc.circuitSymbols = [ramSym, addrConst, dataConst, writeSym, outProbe];
      lc.wires = [
        createWire("main", addrConst.jams[0].absolutePoint, findJam(ramSym, "Address").absolutePoint, "w1"),
        createWire("main", dataConst.jams[0].absolutePoint, findJam(ramSym, "DataIn").absolutePoint, "w2"),
        createWire("main", writeSym.jams[0].absolutePoint, findJam(ramSym, "Write").absolutePoint, "w3"),
        createWire("main", findJam(ramSym, "Data").absolutePoint, outProbe.jams[0].absolutePoint, "w4"),
      ];

      const map = new CircuitMap(lc);
      const state = map.apply();
      const ramFn = state.functions.find((fn): fn is FunctionRam => fn instanceof FunctionRam)!;
      const probeFn = state.probes.find(
        (fn): fn is FunctionProbe => fn instanceof FunctionProbe && fn.probeId === "p-out",
      )!;
      return { state, ramFn, probeFn, btnFn: state.functions.find((f) => f.constructor.name === "FunctionButton") as any };
    };

    // Startwert zeros + steigende Flanke (writeOn1 = true)
    const rising = buildRamCircuit({ writeOn1: true, onStart: "zeros", initialWriteOn: false });
    expect(rising.state.evaluate(false)).toBe(true);
    rising.probeFn.updateState();
    // Initialer Übergang STATE_OFF -> STATE_ON0 darf kein Schreiben auslösen
    expect(rising.probeFn.toNumeric()).toBe(0x00);

    // Toggle 0 -> 1 löst Schreibvorgang auf steigender Flanke aus
    rising.btnFn.toggle();
    expect(rising.state.evaluate(false)).toBe(true);
    rising.probeFn.updateState();
    expect(rising.probeFn.toNumeric()).toBe(0xa5);

    // Startwert ones + fallende Flanke (writeOn1 = false), selbst wenn Write direkt High startet
    const falling = buildRamCircuit({ writeOn1: false, onStart: "ones", initialWriteOn: true });
    expect(falling.state.evaluate(false)).toBe(true);
    falling.probeFn.updateState();
    expect(falling.probeFn.toNumeric()).toBe(0xff);
    // Zunächst High anlegen (STATE_ON0 -> STATE_ON1) darf noch nicht schreiben
    falling.btnFn.toggle();
    expect(falling.state.evaluate(false)).toBe(true);
    falling.probeFn.updateState();
    expect(falling.probeFn.toNumeric()).toBe(0xff);
    // Erst fallende Flanke (STATE_ON1 -> STATE_ON0) schreibt 0xA5
    falling.btnFn.toggle();
    expect(falling.state.evaluate(false)).toBe(true);
    falling.probeFn.updateState();
    expect(falling.probeFn.toNumeric()).toBe(0xa5);

    // Startwert random (gültiger 8-Bit-Wert) & data (initialisiert aus Base64)
    const rand = buildRamCircuit({ writeOn1: true, onStart: "random", initialWriteOn: false });
    expect(rand.state.evaluate(false)).toBe(true);
    expect(rand.ramFn.getCell(1)).toBeGreaterThanOrEqual(0);
    expect(rand.ramFn.getCell(1)).toBeLessThanOrEqual(255);

    const presetBytes = new Uint8Array(totalBytesFor(2, 8));
    setCellValue(presetBytes, 8, 1, 0x3c);
    const preset = buildRamCircuit({
      writeOn1: true,
      onStart: "data",
      initialData: encodeMemoryData(presetBytes, 2, 8),
      initialWriteOn: false,
    });
    expect(preset.state.evaluate(false)).toBe(true);
    preset.probeFn.updateState();
    expect(preset.probeFn.toNumeric()).toBe(0x3c);
  });

  it("erzwingt Compiler-Validierungen (Address/DataIn/ManyMemoryData) und CleanUp-Toleranz", () => {
    // Unbeschaltetes ROM/RAM ohne Abnehmer wird durch CleanUp ignoriert
    const unusedLc = createDefaultLogicalCircuit("main", "UnusedMemory");
    unusedLc.circuitSymbols = [
      createCircuitSymbol(createMemory("rom-unused", false, 4, 8), "main", 4, 4, "up", "sym-u1"),
      createCircuitSymbol(createMemory("ram-unused", true, 4, 8, { onStart: "data" }), "main", 14, 4, "up", "sym-u2"),
    ];
    expect(() => new CircuitMap(unusedLc).apply()).not.toThrow();

    // ErrorAddressNotConnected bei fehlendem Address-Pin auf ROM
    const noAddrLc = createDefaultLogicalCircuit("main", "MissingAddress");
    const rom = createMemory("rom-noaddr", false, 4, 8);
    const romSym = createCircuitSymbol(rom, "main", 8, 4, "up", "sym-rom-na");
    const probeSym = createCircuitSymbol(createCircuitProbe("p", "P"), "main", 20, 4, "up", "sym-p");
    noAddrLc.circuitSymbols = [romSym, probeSym];
    noAddrLc.wires = [
      createWire("main", findJam(romSym, "Data").absolutePoint, probeSym.jams[0].absolutePoint, "w1"),
    ];
    expect(() => new CircuitMap(noAddrLc).apply()).toThrow(CircuitException);
    try {
      new CircuitMap(noAddrLc).apply();
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitException);
      expect((err as CircuitException).location?.symbolId).toBe("sym-rom-na");
    }

    // ErrorAddressNotConnected auch für Address2 im Dual-Port-Betrieb
    const noAddr2Lc = createDefaultLogicalCircuit("main", "MissingAddress2");
    const dpRom = createMemory("rom-dp-na2", false, 4, 8, { dualPort: true });
    const dpRomSym = createCircuitSymbol(dpRom, "main", 10, 4, "up", "sym-dp-na2");
    const cAddr = createCircuitSymbol(createConstant("ca", 4, 0), "main", 2, 4, "up", "sym-ca");
    const pDp = createCircuitSymbol(createCircuitProbe("p2", "P2"), "main", 22, 4, "up", "sym-p2");
    noAddr2Lc.circuitSymbols = [dpRomSym, cAddr, pDp];
    noAddr2Lc.wires = [
      createWire("main", cAddr.jams[0].absolutePoint, findJam(dpRomSym, "Address").absolutePoint, "w1"),
      createWire("main", findJam(dpRomSym, "Data").absolutePoint, pDp.jams[0].absolutePoint, "w2"),
    ];
    expect(() => new CircuitMap(noAddr2Lc).apply()).toThrow(CircuitException);

    // ErrorDataInNotConnected auf RAM mit verbundenem Address aber offenem DataIn
    const noDataInLc = createDefaultLogicalCircuit("main", "MissingDataIn");
    const ram = createMemory("ram-nodata", true, 4, 8);
    const ramSym = createCircuitSymbol(ram, "main", 12, 4, "up", "sym-ram-nd");
    const cAddrRam = createCircuitSymbol(createConstant("cr", 4, 0), "main", 2, 4, "up", "sym-cr");
    const pRam = createCircuitSymbol(createCircuitProbe("pr", "PR"), "main", 24, 4, "up", "sym-pr");
    noDataInLc.circuitSymbols = [ramSym, cAddrRam, pRam];
    noDataInLc.wires = [
      createWire("main", cAddrRam.jams[0].absolutePoint, findJam(ramSym, "Address").absolutePoint, "w1"),
      createWire("main", findJam(ramSym, "Data").absolutePoint, pRam.jams[0].absolutePoint, "w2"),
    ];
    expect(() => new CircuitMap(noDataInLc).apply()).toThrow(CircuitException);

    // ErrorManyMemoryData bei mehrfacher Instanziierung desselben persistenten RAMs in Subschaltung
    const sub = createDefaultLogicalCircuit("sub", "SubRam");
    const subRam = createMemory("shared-ram", true, 2, 4, { onStart: "data" });
    const subRamSym = createCircuitSymbol(subRam, "sub", 10, 4, "up", "sym-sub-ram");
    const cA = createCircuitSymbol(createConstant("sa", 2, 0), "sub", 2, 4, "up", "sym-sa");
    const cD = createCircuitSymbol(createConstant("sd", 4, 0), "sub", 2, 8, "up", "sym-sd");
    const pS = createCircuitSymbol(createCircuitProbe("sp", "SP"), "sub", 20, 4, "up", "sym-sp");
    sub.circuitSymbols = [subRamSym, cA, cD, pS];
    sub.wires = [
      createWire("sub", cA.jams[0].absolutePoint, findJam(subRamSym, "Address").absolutePoint, "w1"),
      createWire("sub", cD.jams[0].absolutePoint, findJam(subRamSym, "DataIn").absolutePoint, "w2"),
      createWire("sub", findJam(subRamSym, "Data").absolutePoint, pS.jams[0].absolutePoint, "w3"),
    ];

    const root = createDefaultLogicalCircuit("main", "RootDupRam");
    root.circuitSymbols = [
      createCircuitSymbol(sub, "main", 4, 4, "up", "sym-inst-1"),
      createCircuitSymbol(sub, "main", 18, 4, "up", "sym-inst-2"),
    ];
    expect(() => new CircuitMap(root).apply()).toThrow(CircuitException);
  });
});

describe("WebWorker-Paging, Pause-Editierung und gezielte RAM-Persistenz", () => {
  it("synchronisiert memoryRevisions, READ_MEMORY_SLICE, WRITE_MEMORY_CELL und Persistenz bei Pause & Stopp", async () => {
    const project = createEmptyCircuitProject("RAM Persist", "Main", "main");
    const lc = project.logicalCircuits[0];

    const persistentRam = createMemory("ram-persist", true, 2, 8, {
      onStart: "data",
      writeOn1: true,
    });
    const volatileRam = createMemory("ram-volatile", true, 2, 8, {
      onStart: "zeros",
      writeOn1: true,
    });

    const pRamSym = createCircuitSymbol(persistentRam, "main", 20, 4, "up", "sym-pram");
    const vRamSym = createCircuitSymbol(volatileRam, "main", 20, 20, "up", "sym-vram");
    const pAddr = createCircuitSymbol(createConstant("c-pa", 2, 2), "main", 6, 4, "up", "sym-cpa");
    const pData = createCircuitSymbol(createConstant("c-pd", 8, 0x5c), "main", 6, 8, "up", "sym-cpd");
    const vAddr = createCircuitSymbol(createConstant("c-va", 2, 1), "main", 6, 20, "up", "sym-cva");
    const vData = createCircuitSymbol(createConstant("c-vd", 8, 0x77), "main", 6, 24, "up", "sym-cvd");
    const pProbe = createCircuitSymbol(createCircuitProbe("pr-p", "POut"), "main", 32, 4, "up", "sym-prp");
    const vProbe = createCircuitSymbol(createCircuitProbe("pr-v", "VOut"), "main", 32, 20, "up", "sym-prv");
    const wBtn = createCircuitSymbol(
      createCircuitButton("btn-we", "WE", true, "right"),
      "main",
      12,
      14,
      "up",
      "sym-bwe",
    );

    lc.circuitSymbols = [pRamSym, vRamSym, pAddr, pData, vAddr, vData, pProbe, vProbe, wBtn];
    lc.wires = [
      createWire("main", pAddr.jams[0].absolutePoint, findJam(pRamSym, "Address").absolutePoint, "w1"),
      createWire("main", pData.jams[0].absolutePoint, findJam(pRamSym, "DataIn").absolutePoint, "w2"),
      createWire("main", findJam(pRamSym, "Data").absolutePoint, pProbe.jams[0].absolutePoint, "w3"),
      createWire("main", wBtn.jams[0].absolutePoint, findJam(pRamSym, "Write").absolutePoint, "w4"),
      createWire("main", vAddr.jams[0].absolutePoint, findJam(vRamSym, "Address").absolutePoint, "w5"),
      createWire("main", vData.jams[0].absolutePoint, findJam(vRamSym, "DataIn").absolutePoint, "w6"),
      createWire("main", findJam(vRamSym, "Data").absolutePoint, vProbe.jams[0].absolutePoint, "w7"),
      createWire("main", wBtn.jams[0].absolutePoint, findJam(vRamSym, "Write").absolutePoint, "w8"),
    ];
    project.memories = [persistentRam, volatileRam];
    project.circuits.set(persistentRam.circuitId, persistentRam);
    project.circuits.set(volatileRam.circuitId, volatileRam);

    const { getCircuitCtx, getSimCtx } = buildContextHarness(project);
    const simCtx = getSimCtx();

    await simCtx.startSimulation();
    expect(simCtx.isRunning).toBe(true);
    expect(simCtx.isPaused).toBe(false);

    // Während aktiv laufender Simulation ist writeMemoryCell gesperrt
    const deniedWhileRunning = await simCtx.writeMemoryCell("sym-pram", 2, 0x99);
    expect(deniedWhileRunning).toBe(false);

    // Schreibvorgang über Flanke anstoßen und danach pausieren
    await simCtx.toggleButton("btn-we");
    expect(getCircuitCtx().hasUnsavedChanges).toBe(false);

    simCtx.pauseSimulation();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Pause hat persistenten RAM in Memory.data ohne Undo-Eintrag gesichert
    expect(getCircuitCtx().hasUnsavedChanges).toBe(true);
    expect(getCircuitCtx().canUndo).toBe(false);
    const afterPauseMem = getCircuitCtx().project.memories.find((m) => m.memoryId === "ram-persist")!;
    const afterPauseVolatile = getCircuitCtx().project.memories.find((m) => m.memoryId === "ram-volatile")!;
    expect(getCellValue(decodeMemoryData(afterPauseMem.data, 2, 8), 8, 2)).toBe(0x5c);
    expect(afterPauseVolatile.data).toBe("");

    // Live-Bearbeitung im Pause-Modus über writeMemoryCell aktualisiert sofort UI-Probe und RAM
    const edited = await simCtx.writeMemoryCell("sym-pram", 2, 0x3e);
    expect(edited).toBe(true);
    expect(getSimCtx().snapshot?.probes["pr-p"].value).toBe(0x3e);

    const slice = await simCtx.readMemorySlice("sym-pram", 0, 4);
    expect(slice).not.toBeNull();
    expect(getCellValue(slice!.bytes, 8, 2)).toBe(0x3e);

    await simCtx.stopSimulation();
    expect(getSimCtx().isSimulating).toBe(false);

    const persistedFinal = getCircuitCtx().project.memories.find((m) => m.memoryId === "ram-persist")!;
    expect(getCellValue(decodeMemoryData(persistedFinal.data, 2, 8), 8, 2)).toBe(0x3e);

    // Neustart lädt den persistierten Inhalt aus Memory.data automatisch wieder in die Simulation
    await simCtx.startSimulation();
    expect(getSimCtx().snapshot?.probes["pr-p"].value).toBe(0x3e);
    await simCtx.stopSimulation();
  });
});

describe("Live-Speicherinspektor UI & MCP-Unterstützung", () => {
  it("öffnet MemoryInspectorDialog per Doppelklick und steuert ReadOnly vs. Pause-Editierung korrekt", () => {
    const lc = createDefaultLogicalCircuit("main", "InspectorUi");
    const rom = createMemory("rom-insp", false, 4, 8, { data: "qv8=" });
    const ram = createMemory("ram-insp", true, 4, 8, { onStart: "data", data: "qv8=" });
    const romSym = createCircuitSymbol(rom, "main", 2, 2, "up", "sym-rom-insp");
    const ramSym = createCircuitSymbol(ram, "main", 10, 2, "up", "sym-ram-insp");
    lc.circuitSymbols = [romSym, ramSym];

    const rootMap = new CircuitMap(lc);
    let openedInstanceId: string | null = null;
    const handled = dispatchSimulationSymbolDoubleClick({
      symbol: ramSym,
      target: null,
      activeSimulationMap: rootMap,
      selectCircuitMap: () => {},
      onOpenMemoryInspector: (sym, activeMap) => {
        openedInstanceId = getMemoryInstanceId(activeMap, sym);
      },
    });
    expect(handled).toBe(true);
    expect(openedInstanceId).toBe("sym-ram-insp");

    const renderInspector = (
      sym: CircuitSymbol,
      instanceId: string,
      simOverrides: Partial<React.ContextType<typeof SimulationContext>>,
    ): string =>
      renderToStaticMarkup(
        React.createElement(SimulationContext.Provider, {
          value: {
            ...DEFAULT_SIMULATION_STATE,
            ...simOverrides,
          },
          children: React.createElement(MemoryInspectorDialog, {
            isOpen: true,
            symbol: sym,
            memoryInstanceId: instanceId,
            circuitPath: `${lc.name}/${sym.circuit.name}[${sym.x},${sym.y}]`,
            onClose: () => {},
          }),
        }),
      );

    const romHtml = renderInspector(romSym, "sym-rom-insp", {
      isSimulating: true,
      isPaused: true,
      isRunning: false,
    });
    expect(romHtml).toContain("Live-Speicherinspektor: ROM");
    expect(romHtml).toContain("ROM · Schreibgeschützt");
    expect(romHtml).toContain("data-readonly=\"true\"");
    expect(romHtml).toContain("value=\"AA\"");

    const ramRunningHtml = renderInspector(ramSym, "sym-ram-insp", {
      isSimulating: true,
      isPaused: false,
      isRunning: true,
    });
    expect(ramRunningHtml).toContain("Live-Speicherinspektor: RAM");
    expect(ramRunningHtml).toContain("Läuft · Schreibgeschützt");
    expect(ramRunningHtml).toContain("data-readonly=\"true\"");

    const ramPausedHtml = renderInspector(ramSym, "sym-ram-insp", {
      isSimulating: true,
      isPaused: true,
      isRunning: false,
    });
    expect(ramPausedHtml).toContain("Pausiert · Bearbeitbar");
    expect(ramPausedHtml).toContain("data-readonly=\"false\"");
  });

  it("unterstützt validate_circuit und step_simulation für ROM-Schaltungen über MCP", async () => {
    const raw = new Uint8Array(totalBytesFor(4, 8));
    setCellValue(raw, 8, 5, 0x6d);

    const project = createEmptyCircuitProject("MCP Mem Sim", "Main", "main");
    const lc = project.logicalCircuits[0];
    const rom = createMemory("mcp-rom", false, 4, 8, { data: encodeMemoryData(raw, 4, 8) });
    const romSym = createCircuitSymbol(rom, "main", 12, 4, "up", "sym-mcp-rom");
    const addrConst = createCircuitSymbol(createConstant("mcp-ca", 4, 5), "main", 2, 4, "up", "sym-mcp-ca");
    const outProbe = createCircuitSymbol(createCircuitProbe("mcp-pr", "MCPData"), "main", 24, 4, "up", "sym-mcp-pr");

    lc.circuitSymbols = [romSym, addrConst, outProbe];
    lc.wires = [
      createWire("main", addrConst.jams[0].absolutePoint, findJam(romSym, "Address").absolutePoint, "w1"),
      createWire("main", findJam(romSym, "Data").absolutePoint, outProbe.jams[0].absolutePoint, "w2"),
    ];
    project.memories = [rom];
    project.circuits.set(rom.circuitId, rom);

    const { getMcpSnapshot } = buildContextHarness(project);

    const validation = (await executeMcpTool("validate_circuit", {}, getMcpSnapshot())) as {
      valid: boolean;
      errorCount: number;
    };
    expect(validation.valid).toBe(true);
    expect(validation.errorCount).toBe(0);

    const simResult = (await executeMcpTool(
      "step_simulation",
      { action: "step", steps: 1, includeState: true },
      getMcpSnapshot(),
    )) as {
      state: {
        probes: { name: string; numeric: number | null }[];
        symbols: { kind: string; memory?: { memoryId: string; writable: boolean } }[];
      };
    };

    expect(simResult.state.probes[0].numeric).toBe(0x6d);
    const memSymbol = simResult.state.symbols.find((s) => s.kind === "memory");
    expect(memSymbol?.memory?.memoryId).toBe("mcp-rom");
    expect(memSymbol?.memory?.writable).toBe(false);

    await executeMcpTool("step_simulation", { action: "stop" }, getMcpSnapshot());

    // Ohne Address-Draht meldet validate_circuit den fehlenden Adressanschluss
    lc.wires = [
      createWire("main", findJam(romSym, "Data").absolutePoint, outProbe.jams[0].absolutePoint, "w2"),
    ];
    const invalidResult = (await executeMcpTool("validate_circuit", {}, getMcpSnapshot())) as {
      valid: boolean;
      errorCount: number;
      errors: { location?: { symbolId?: string } }[];
    };
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errorCount).toBeGreaterThan(0);
    expect(invalidResult.errors.some((e) => e.location?.symbolId === "sym-mcp-rom")).toBe(true);
  });
});
