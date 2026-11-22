/// <reference types="node" />
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import CircuitMap from "../simulation/compiler/circuitMap";
import type CircuitFunction from "../simulation/functions/circuitFunction";
import FunctionButton from "../simulation/functions/io/functionButton";
import FunctionProbe from "../simulation/functions/io/functionProbe";
import FunctionRam from "../simulation/functions/memory/functionRam";
import FunctionRom from "../simulation/functions/memory/functionRom";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
} from "../utils/circuitLayout";
import { serializeNativeProject } from "../utils/storage/nativeProjectWriter";
import { parseProjectFileText } from "../utils/storage/projectFileUtils";
import { createWire } from "../utils/wireUtils";
import { analyzeDesktopExportCompatibility } from "../utils/xml/desktopExportCompatibility";
import {
  importProjectFromXml,
  parseLogicCircuitXml,
} from "../utils/xml/logicCircuitXmlReader";
import { exportProjectToXml } from "../utils/xml/logicCircuitXmlWriter";

function loadOfficialSample(fileName: string): string {
  return readFileSync(new URL(`../../reference/OfficialSamples/${fileName}`, import.meta.url), "utf8");
}

function bcdToInt(value: number | null): number {
  if (value === null) {
    throw new Error("BCD-Probe liefert einen ungültigen/hochohmigen Zustand (null).");
  }
  return ((value >> 4) & 0xf) * 10 + (value & 0xf);
}

describe("OfficialSamples Real-World Tests", () => {
  it("importiert und kompiliert Digital Clock.CircuitProject fehlerfrei", () => {
    const xml = loadOfficialSample("Digital Clock.CircuitProject");
    const project = parseLogicCircuitXml(xml);

    expect(project.project.name).toBe("Digital Clock");
    expect(project.project.frequency).toBe(2);
    expect(project.logicalCircuits.length).toBe(21);
    expect(project.pins.length).toBe(84);
    expect(project.circuitButtons.length).toBe(9);
    expect(project.constants.length).toBe(21);
    expect(project.splitters.length).toBe(10);

    const jkFlipFlop = project.logicalCircuits.find((c) => c.name === "JK flip-flop");
    const rsFlipFlop = project.logicalCircuits.find((c) => c.name === "RS flip-flop");
    expect(jkFlipFlop?.circuitShape).toBe("flipFlop");
    expect(rsFlipFlop?.circuitShape).toBe("flipFlop");

    const rootCircuit = project.logicalCircuits.find(
      (c) => c.logicalCircuitId === project.project.logicalCircuitId,
    );
    expect(rootCircuit).toBeDefined();
    expect(rootCircuit?.notation).toBe("Main");

    const map = new CircuitMap(rootCircuit!);
    const state = map.apply();
    expect(state.evaluate(false)).toBe(true);
  });

  it("importiert und kompiliert Calc16.CircuitProject (1,47 MB) mit ROMs, Sensoren und FlowDocuments", () => {
    const xml = loadOfficialSample("Calc16.CircuitProject");
    const project = parseLogicCircuitXml(xml);

    expect(project.project.name).toBe("Simple integer calculator");
    expect(project.project.frequency).toBe(50);
    expect(project.project.isMaximumSpeed).toBe(true);
    expect(project.logicalCircuits.length).toBe(68);
    expect(project.pins.length).toBe(329);
    expect(project.splitters.length).toBe(136);
    expect(project.memories.length).toBe(6);
    expect(project.sensors.length).toBe(5);
    expect(project.collapsedCategories.length).toBeGreaterThan(0);

    // Base64-ROM-Daten und FlowDocument-Notizen müssen erhalten/dekodiert sein
    expect(project.memories.some((m) => m.data.length > 0)).toBe(true);
    expect(project.textNotes.length).toBeGreaterThan(0);

    const rootCircuit = project.logicalCircuits.find(
      (c) => c.logicalCircuitId === project.project.logicalCircuitId,
    );
    expect(rootCircuit).toBeDefined();

    const map = new CircuitMap(rootCircuit!);
    const state = map.apply();
    expect(state.evaluate(false)).toBe(true);

    const rootRomCount = state.functions.filter((fn) => fn instanceof FunctionRom).length;
    expect(rootRomCount).toBeGreaterThan(0);

    for (let tick = 0; tick < 8; tick++) {
      expect(state.evaluate(true)).toBe(true);
    }

    // Sub-Testschaltung "Test 3" enthält zusätzlich das beschreibbare Calc16-RAM
    const test3Circuit = project.logicalCircuits.find((c) => c.name === "Test 3");
    expect(test3Circuit).toBeDefined();
    const test3State = new CircuitMap(test3Circuit!).apply();
    expect(test3State.evaluate(false)).toBe(true);
    expect(test3State.functions.filter((fn) => fn instanceof FunctionRom).length).toBeGreaterThan(0);
    expect(test3State.functions.filter((fn) => fn instanceof FunctionRam).length).toBeGreaterThan(0);
    for (let tick = 0; tick < 8; tick++) {
      expect(test3State.evaluate(true)).toBe(true);
    }
  });

  it("führt DigitalClockTest.py auf dem importierten Clock Counter über Reset und Stundenwechsel aus", () => {
    const xml = loadOfficialSample("Digital Clock.CircuitProject");
    const project = parseLogicCircuitXml(xml);

    const clockCounter = project.logicalCircuits.find((c) => c.name === "Clock Counter");
    expect(clockCounter).toBeDefined();

    // Testbench analog zu App.CreateTester("Clock Counter") in DigitalClockTest.py
    const testbenchId = "testbench-clock-counter";
    const testbench = createDefaultLogicalCircuit(testbenchId, "ClockCounterTestbench");
    const subSym = createCircuitSymbol(clockCounter!, testbenchId, 20, 10, "up", "sym-clock-counter");

    const inputButtons = new Map<string, string>();
    const outputProbes = new Map<string, string>();
    const benchSymbols = [subSym];
    const benchWires = [];

    let inputOffset = 0;
    let outputOffset = 0;

    for (const jam of subSym.jams) {
      if (jam.pin.pinType === "input") {
        const btnId = `bench-btn-${jam.pin.name}`;
        const btn = createCircuitButton(btnId, jam.pin.name, false, "right");
        const btnSym = createCircuitSymbol(btn, testbenchId, 4, 4 + inputOffset * 6, "up", `sym-${btnId}`);
        benchSymbols.push(btnSym);
        inputButtons.set(jam.pin.name, btnId);
        benchWires.push(
          createWire(testbenchId, btnSym.jams[0].absolutePoint, jam.absolutePoint, `w-in-${jam.pin.name}`),
        );
        inputOffset++;
      } else if (jam.pin.pinType === "output") {
        const probeId = `bench-probe-${jam.pin.name}`;
        const probe = createCircuitProbe(probeId, jam.pin.name, "left");
        const probeSym = createCircuitSymbol(probe, testbenchId, 40, 4 + outputOffset * 6, "up", `sym-${probeId}`);
        benchSymbols.push(probeSym);
        outputProbes.set(jam.pin.name, probeId);
        benchWires.push(
          createWire(testbenchId, jam.absolutePoint, probeSym.jams[0].absolutePoint, `w-out-${jam.pin.name}`),
        );
        outputOffset++;
      }
    }

    testbench.circuitSymbols = benchSymbols;
    testbench.wires = benchWires;

    const map = new CircuitMap(testbench);
    const state = map.apply();

    const findBtn = (pinName: string): FunctionButton => {
      const btnId = inputButtons.get(pinName);
      const found = state.functions.find(
        (fn: CircuitFunction): fn is FunctionButton => fn instanceof FunctionButton && fn.buttonId === btnId,
      );
      if (!found) {
        throw new Error(`Eingangs-Button für Pin "${pinName}" nicht gefunden.`);
      }
      return found;
    };

    const findProbe = (pinName: string): FunctionProbe => {
      const probeId = outputProbes.get(pinName);
      const found = state.probes.find(
        (fn: CircuitFunction): fn is FunctionProbe => fn instanceof FunctionProbe && fn.probeId === probeId,
      );
      if (!found) {
        throw new Error(`Probe "${pinName}" fehlt im kompilierten CircuitState.`);
      }
      return found;
    };

    const clkBtn = findBtn("C");
    const clsBtn = findBtn("Cls");
    const secProbe = findProbe("s");
    const minProbe = findProbe("m");
    const hourProbe = findProbe("h");

    // ResetClock analog zu DigitalClockTest.py
    clsBtn.press(true);
    expect(state.evaluate(false)).toBe(true);
    clsBtn.press(false);
    expect(state.evaluate(false)).toBe(true);

    let expectedS = bcdToInt(secProbe.toNumeric());
    let expectedM = bcdToInt(minProbe.toNumeric());
    let expectedH = bcdToInt(hourProbe.toNumeric());
    expect(expectedS).toBe(0);
    expect(expectedM).toBe(0);
    expect(expectedH).toBe(0);

    // 3665 Sekunden (über 1 Stunde + 1 Minute + 5 Sekunden) durchtakten
    const totalTicks = 60 * 60 + 65;
    for (let i = 0; i < totalTicks; i++) {
      expectedS += 1;
      if (expectedS >= 60) {
        expectedS = 0;
        expectedM += 1;
        if (expectedM >= 60) {
          expectedM = 0;
          expectedH += 1;
          if (expectedH >= 24) {
            expectedH = 0;
          }
        }
      }

      clkBtn.press(true);
      expect(state.evaluate(false)).toBe(true);
      clkBtn.press(false);
      expect(state.evaluate(false)).toBe(true);

      expect(bcdToInt(secProbe.toNumeric())).toBe(expectedS);
      expect(bcdToInt(minProbe.toNumeric())).toBe(expectedM);
      expect(bcdToInt(hourProbe.toNumeric())).toBe(expectedH);
    }

    expect(expectedH).toBe(1);
    expect(expectedM).toBe(1);
    expect(expectedS).toBe(5);
  });

  it("besteht den vollständigen XML-Roundtrip für Digital Clock und Calc16 inklusive erneuter Kompilierung", () => {
    for (const fileName of ["Digital Clock.CircuitProject", "Calc16.CircuitProject"]) {
      const original = parseLogicCircuitXml(loadOfficialSample(fileName));
      const exportedXml = exportProjectToXml(original);
      const reimported = importProjectFromXml(exportedXml);

      expect(reimported.project.name).toBe(original.project.name);
      expect(reimported.project.frequency).toBe(original.project.frequency);
      expect(reimported.logicalCircuits).toHaveLength(original.logicalCircuits.length);
      expect(reimported.pins).toHaveLength(original.pins.length);
      expect(reimported.splitters).toHaveLength(original.splitters.length);
      expect(reimported.memories).toHaveLength(original.memories.length);
      expect(reimported.sensors).toHaveLength(original.sensors.length);
      expect(reimported.circuitSymbols).toHaveLength(original.circuitSymbols.length);
      expect(reimported.wires).toHaveLength(original.wires.length);

      const rootCircuit = reimported.logicalCircuits.find(
        (c) => c.logicalCircuitId === reimported.project.logicalCircuitId,
      );
      expect(rootCircuit).toBeDefined();

      const map = new CircuitMap(rootCircuit!);
      const state = map.apply();
      expect(state.evaluate(false)).toBe(true);
    }
  });

  it("migriert Digital Clock und Calc16 (.CircuitProject) automatisch über parseProjectFileText in das native Web-Format", () => {
    for (const fileName of ["Digital Clock.CircuitProject", "Calc16.CircuitProject"]) {
      const xml = loadOfficialSample(fileName);
      const xmlResult = parseProjectFileText(xml);
      expect(xmlResult.format).toBe("xml");
      expect(analyzeDesktopExportCompatibility(xmlResult.project)).toEqual({
        hasWarnings: false,
        warnings: [],
      });

      const nativeJson = serializeNativeProject(xmlResult.project);
      const nativeResult = parseProjectFileText(nativeJson);
      expect(nativeResult.format).toBe("native");

      expect(nativeResult.project.project.name).toBe(xmlResult.project.project.name);
      expect(nativeResult.project.logicalCircuits).toHaveLength(xmlResult.project.logicalCircuits.length);
      expect(nativeResult.project.memories).toHaveLength(xmlResult.project.memories.length);
      expect(nativeResult.project.sensors).toHaveLength(xmlResult.project.sensors.length);

      const rootCircuit = nativeResult.project.logicalCircuits.find(
        (c) => c.logicalCircuitId === nativeResult.project.project.logicalCircuitId,
      );
      expect(rootCircuit).toBeDefined();

      const map = new CircuitMap(rootCircuit!);
      const state = map.apply();
      expect(state.evaluate(false)).toBe(true);
    }
  });
});
