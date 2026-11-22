import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { applyDeltaForward } from "../contexts/circuitContext/historyManager";

import type CircuitProbe from "../types/circuit/circuitProbe";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Sensor from "../types/circuit/sensor";

import FunctionSensor, {
  formatSensorValueText,
  normalizeSensorValue,
  parseSensorSeries,
  saveSensorSeries,
  tryParseRandomRange,
  tryParseSensorPoint,
} from "../simulation/functions/io/functionSensor";
import CircuitState from "../simulation/state/circuitState";
import CircuitRunner from "../simulation/worker/circuitRunner";
import {
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createSensor,
  getComponentLayout,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";
import { parseNativeProject } from "../utils/storage/nativeProjectReader";
import { serializeNativeProject } from "../utils/storage/nativeProjectWriter";
import { createWire } from "../utils/wireUtils";
import { importProjectFromXml } from "../utils/xml/logicCircuitXmlReader";
import { exportProjectToXml } from "../utils/xml/logicCircuitXmlWriter";

import ComponentPalette from "../components/componentPalette";
import PropertyDialog from "../components/propertyDialog";
import SensorShape from "../components/symbols/io/sensorShape";
import SymbolRenderer from "../components/symbols/symbolRenderer";

function buildSensorToProbeCircuit(
  sensorType: Parameters<typeof createSensor>[1],
  bitWidth: number,
  data = "",
  notation = "",
): { circuit: LogicalCircuit; sensorId: string; probeId: string } {
  const sensor = createSensor(`sensor-${sensorType}`, sensorType, bitWidth, "right", notation, data);
  const probe = createCircuitProbe(`probe-${sensorType}`, "OUT", "left", 2, 2, true);
  probe.displayFormat = "hex";

  const lc = createDefaultLogicalCircuit("lc-sensor-test", "SensorTest");
  const symSensor = createCircuitSymbol(sensor, lc.logicalCircuitId, 2, 2, "up", `sym-s-${sensorType}`);
  const symProbe = createCircuitSymbol(probe, lc.logicalCircuitId, 10, 2, "up", `sym-p-${sensorType}`);

  // Sensor hat Ausgangspin bei (4, 1) -> absolut (6, 3); Probe (2x2, links) hat Eingang bei (0, 1) -> absolut (10, 3)
  const outJam = symSensor.jams[0];
  const inJam = symProbe.jams[0];
  const p1 = { x: symSensor.x + outJam.x, y: symSensor.y + outJam.y };
  const p2 = { x: symProbe.x + inJam.x, y: symProbe.y + inJam.y };

  lc.circuitSymbols.push(symSensor, symProbe);
  lc.wires.push(createWire(lc.logicalCircuitId, p1, p2, `wire-${sensorType}`));

  return { circuit: lc, sensorId: sensor.sensorId, probeId: probe.circuitProbeId };
}

describe("T-046: Sensor-Baustein (Layout, Palette, Dialog und Simulation)", () => {
  it("berechnet Layout, Pin-Positionen und Paletten-Instanziierung analog zu Sensor.cs", () => {
    const layoutRight = getComponentLayout("sensor", { bitWidth: 8, pinSide: "right", sensorType: "random" });
    expect(layoutRight.gridWidth).toBe(4);
    expect(layoutRight.gridHeight).toBe(3);
    expect(layoutRight.pins).toHaveLength(1);
    expect(layoutRight.pins[0].pinType).toBe("output");
    expect(layoutRight.pins[0].bitWidth).toBe(8);
    expect(layoutRight.pins[0].gridPoint).toEqual({ x: 4, y: 1 });

    const layoutLeft = getComponentLayout("sensor", { bitWidth: 32, pinSide: "left" });
    expect(layoutLeft.pins[0].bitWidth).toBe(32);
    expect(layoutLeft.pins[0].gridPoint).toEqual({ x: 0, y: 1 });

    const project = createEmptyCircuitProject("SensorProjekt");
    const targetId = project.logicalCircuits[0].logicalCircuitId;
    const { circuit, circuitSymbol } = instantiateCircuitFromPalette(
      project,
      targetId,
      {
        type: "sensor",
        name: "Sensor",
        sensorType: "loop",
        bitWidth: 4,
        pinSide: "bottom",
        data: "0:A 1:5",
      },
      { x: 5, y: 6 },
    );

    expect(circuit.kind).toBe("sensor");
    expect(project.sensors).toHaveLength(1);
    expect(project.circuits.get(circuit.circuitId)).toBe(circuit);
    expect(circuitSymbol.jams).toHaveLength(1);
    expect(circuitSymbol.jams[0].pin.bitWidth).toBe(4);
  });

  it("parst und normalisiert Punkt-, Serien-, Zufalls- und 32-Bit-Daten korrekt", () => {
    expect(normalizeSensorValue(-1, 4)).toBe(15);
    expect(normalizeSensorValue(0xffffffff, 32)).toBe(0xffffffff);

    const pointOk = tryParseSensorPoint("A:1FF", 8);
    expect(pointOk).toEqual({ ok: true, point: { tick: 10, value: 0xff } });

    const badPoint = tryParseSensorPoint("xyz", 8);
    expect(badPoint.ok).toBe(false);

    const seriesOk = parseSensorSeries("0:1 2:A 5:FF", 4);
    expect(seriesOk).toEqual({
      ok: true,
      points: [
        { tick: 0, value: 1 },
        { tick: 2, value: 0xa },
        { tick: 5, value: 0xf },
      ],
    });
    if (seriesOk.ok) {
      expect(saveSensorSeries(seriesOk.points)).toBe("0:1 2:A 5:F");
    }

    const nonMonotonic = parseSensorSeries("2:1 2:3", 4);
    expect(nonMonotonic.ok).toBe(false);

    expect(tryParseRandomRange("")).toEqual({ ok: true, min: 10, max: 20 });
    expect(tryParseRandomRange("2:5")).toEqual({ ok: true, min: 2, max: 5 });
    expect(tryParseRandomRange("0:5").ok).toBe(false);
    expect(tryParseRandomRange("A:5").ok).toBe(false);
  });

  it("simuliert die Modi manual, ascii und keyCode inkl. interaktiver Wert-Einspeisung", () => {
    const manualBuilt = buildSensorToProbeCircuit("manual", 8, "1A");
    const manualRunner = new CircuitRunner(manualBuilt.circuit);
    manualRunner.step(0);
    expect(manualRunner.getSnapshot().probes[manualBuilt.probeId].value).toBe(0x1a);
    expect(manualRunner.getSnapshot().sensors?.[manualBuilt.sensorId]?.text).toBe("1A");

    expect(manualRunner.setSensorValue(manualBuilt.sensorId, 0x1ff)).toBe(true);
    expect(manualRunner.getSnapshot().probes[manualBuilt.probeId].value).toBe(0xff);
    expect(manualRunner.getSnapshot().sensors?.[manualBuilt.sensorId]?.text).toBe("FF");

    const asciiBuilt = buildSensorToProbeCircuit("ascii", 8);
    const asciiRunner = new CircuitRunner(asciiBuilt.circuit);
    asciiRunner.step(0);
    expect(asciiRunner.getSnapshot().probes[asciiBuilt.probeId].value).toBe(0);
    asciiRunner.setSensorValue(asciiBuilt.sensorId, "K".charCodeAt(0));
    expect(asciiRunner.getSnapshot().probes[asciiBuilt.probeId].value).toBe(75);
    expect(asciiRunner.getSnapshot().sensors?.[asciiBuilt.sensorId]?.text).toBe("K");

    const keyBuilt = buildSensorToProbeCircuit("keyCode", 8);
    const keyRunner = new CircuitRunner(keyBuilt.circuit);
    keyRunner.step(0);
    keyRunner.setSensorValue(keyBuilt.sensorId, 44);
    expect(keyRunner.getSnapshot().probes[keyBuilt.probeId].value).toBe(44);
    expect(keyRunner.getSnapshot().sensors?.[keyBuilt.sensorId]?.text).toBe("A");
    keyRunner.setSensorValue(keyBuilt.sensorId, 0);
    expect(keyRunner.getSnapshot().sensors?.[keyBuilt.sensorId]?.text).toBe("None");
  });

  it("simuliert sequence, series und loop deterministisch über Taktschritte", () => {
    const seqBuilt = buildSensorToProbeCircuit("sequence", 2);
    const seqRunner = new CircuitRunner(seqBuilt.circuit);
    seqRunner.step(0);
    expect(seqRunner.getSnapshot().probes[seqBuilt.probeId].value).toBe(0);
    seqRunner.step(1);
    expect(seqRunner.getSnapshot().probes[seqBuilt.probeId].value).toBe(1);
    seqRunner.step(1);
    expect(seqRunner.getSnapshot().probes[seqBuilt.probeId].value).toBe(2);
    seqRunner.step(1);
    expect(seqRunner.getSnapshot().probes[seqBuilt.probeId].value).toBe(3);
    seqRunner.step(1);
    expect(seqRunner.getSnapshot().probes[seqBuilt.probeId].value).toBe(0);

    const seriesBuilt = buildSensorToProbeCircuit("series", 4, "0:3 2:9");
    const seriesRunner = new CircuitRunner(seriesBuilt.circuit);
    seriesRunner.step(0);
    expect(seriesRunner.getSnapshot().probes[seriesBuilt.probeId].value).toBe(0);
    seriesRunner.step(1); // Tick 0 -> 3
    expect(seriesRunner.getSnapshot().probes[seriesBuilt.probeId].value).toBe(3);
    seriesRunner.step(1); // Tick 1 -> unverändert 3
    expect(seriesRunner.getSnapshot().probes[seriesBuilt.probeId].value).toBe(3);
    seriesRunner.step(1); // Tick 2 -> 9, danach stop
    expect(seriesRunner.getSnapshot().probes[seriesBuilt.probeId].value).toBe(9);
    seriesRunner.step(3);
    expect(seriesRunner.getSnapshot().probes[seriesBuilt.probeId].value).toBe(9);

    const loopBuilt = buildSensorToProbeCircuit("loop", 4, "0:5 1:C");
    const loopRunner = new CircuitRunner(loopBuilt.circuit);
    loopRunner.step(0);
    loopRunner.step(1); // Tick 0 -> 5
    expect(loopRunner.getSnapshot().probes[loopBuilt.probeId].value).toBe(5);
    loopRunner.step(1); // Tick 1 -> C
    expect(loopRunner.getSnapshot().probes[loopBuilt.probeId].value).toBe(0xc);
    loopRunner.step(1); // Zyklusstart Tick 0 -> 5
    expect(loopRunner.getSnapshot().probes[loopBuilt.probeId].value).toBe(5);
  });

  it("simuliert random und clock analog zur C#-Referenz", () => {
    const state = new CircuitState();
    const outIdx = [state.reserveState(), state.reserveState(), state.reserveState(), state.reserveState()];
    let rngCall = 0;
    const rngSeq = [0.0, 0.75, 0.5];
    const fnRandom = new FunctionSensor(state, outIdx, {
      sensorId: "rnd-1",
      sensorType: "random",
      bitWidth: 4,
      data: "2:4",
      random: () => {
        const val = rngSeq[rngCall % rngSeq.length];
        rngCall += 1;
        return val;
      },
    });

    const clkIndices = Array.from({ length: 32 }, () => state.reserveState());
    const fixedDate = new Date(2026, 0, 1, 14, 35, 59, 420);
    const fnClock = new FunctionSensor(state, clkIndices, {
      sensorId: "clk-1",
      sensorType: "clock",
      bitWidth: 32,
      now: () => fixedDate,
    });
    state.endDefinition();
    expect(state.evaluate(false)).toBe(true);

    // Random: Erstes Intervall (rng=0.0 -> 2 Takte), nach 2. Flip nächstes Intervall (rng=0.75) und Wert rng=0.5 * 16 = 8
    expect(state.evaluate(true)).toBe(true);
    expect(fnRandom.value).toBe(0);
    expect(state.evaluate(true)).toBe(true);
    expect(fnRandom.value).toBe(8);

    // Clock: 14:35:59.42 -> BCD 0x14355942
    expect(fnClock.value).toBe(0x14355942);
    expect(formatSensorValueText("clock", fnClock.value, 32)).toBe("14355942");
  });

  it("rendert SensorShape, Palette, PropertyDialog und XML-Import/Export konsistent", () => {
    const svgHtml = renderToStaticMarkup(
      React.createElement(
        "svg",
        null,
        React.createElement(SensorShape, {
          width: 64,
          height: 48,
          sensorType: "series",
          notation: "DATA",
          value: "0F",
        }),
        React.createElement(SymbolRenderer, {
          type: "sensor",
          sensorType: "clock",
          bitWidth: 16,
          pinSide: "right",
          value: "1234",
        }),
      ),
    );
    expect(svgHtml).toContain("SensorShape");
    expect(svgHtml).toContain("DATA");
    expect(svgHtml).toContain("1234");

    const paletteHtml = renderToStaticMarkup(React.createElement(ComponentPalette));
    expect(paletteHtml).toContain("Sensor");

    const sensor = createSensor("s-ui", "series", 8, "right", "IN", "0:1 4:FF", "Testnotiz");
    const sym = createCircuitSymbol(sensor, "lc-1", 1, 1, "up", "sym-s-ui");
    const dialogHtml = renderToStaticMarkup(
      React.createElement(PropertyDialog, {
        isOpen: true,
        symbol: sym,
        onClose: () => {},
      }),
    );
    expect(dialogHtml).toContain("Eigenschaften: Sensor");
    expect(dialogHtml).toContain("sensor-type-select");
    expect(dialogHtml).toContain("sensor-data-input");
    expect(dialogHtml).toContain("0:1 4:FF");

    const project = createEmptyCircuitProject("XmlSensorTest");
    const mainLc = project.logicalCircuits[0];
    const xmlSym = createCircuitSymbol(sensor, mainLc.logicalCircuitId, 1, 1, "up", "sym-s-xml");
    project.sensors.push(sensor);
    project.circuits.set(sensor.circuitId, sensor);
    mainLc.circuitSymbols.push(xmlSym);

    const xml = exportProjectToXml(project);
    const reimported = importProjectFromXml(xml);
    expect(reimported.sensors).toHaveLength(1);
    expect(reimported.sensors[0].sensorType).toBe("series");
    expect(reimported.sensors[0].bitWidth).toBe(8);
    expect(reimported.sensors[0].data).toBe("0:1 4:FF");
  });

  it("aktualisiert project.sensors bei Eigenschaftsänderungen und bewahrt Probe-Größe/-Format sowie leeren Namen im XML-Roundtrip", () => {
    const project = createEmptyCircuitProject("SensorProbePersistTest");
    const mainLc = project.logicalCircuits[0];

    const initialSensor = createSensor("sensor-1", "random", 4, "right", "", "A:14");
    const sensorSym = createCircuitSymbol(initialSensor, mainLc.logicalCircuitId, 2, 2, "up", "sym-s1");
    project.sensors.push(initialSensor);
    project.circuits.set(initialSensor.circuitId, initialSensor);
    project.circuitSymbols.push(sensorSym);
    mainLc.circuitSymbols.push(sensorSym);

    const updatedSensor = createSensor("sensor-1", "clock", 32, "right", "", "", "");
    const updatedSensorSym = createCircuitSymbol(updatedSensor, mainLc.logicalCircuitId, 2, 2, "up", "sym-s1");
    const afterSensorUpdate = applyDeltaForward(project, {
      type: "updateProperty",
      logicalCircuitId: mainLc.logicalCircuitId,
      targetType: "symbol",
      targetId: sensorSym.circuitSymbolId,
      changes: {},
      beforeSymbol: { symbol: sensorSym, circuit: initialSensor },
      afterSymbol: { symbol: updatedSensorSym, circuit: updatedSensor },
    });

    expect(afterSensorUpdate.sensors).toHaveLength(1);
    expect(afterSensorUpdate.sensors[0].sensorType).toBe("clock");
    expect(afterSensorUpdate.sensors[0].bitWidth).toBe(32);

    // Probe ohne Namen (mit interner ID als Name) und Übergröße 13x2 bleibt namenlos und behält Breite/Format
    const unnamedProbe = createCircuitProbe("probe-abc", "", "left", 13, 2, false);
    unnamedProbe.displayFormat = "dec";
    const renamedWithOwnId = createCircuitProbe("probe-abc", unnamedProbe.name, "left", 13, 2, false);
    expect(renamedWithOwnId.notation).toBe("?");

    const probeSym = createCircuitSymbol(unnamedProbe, mainLc.logicalCircuitId, 10, 2, "up", "sym-p1");
    afterSensorUpdate.circuitProbes.push(unnamedProbe);
    afterSensorUpdate.circuits.set(unnamedProbe.circuitId, unnamedProbe);
    afterSensorUpdate.circuitSymbols.push(probeSym);
    afterSensorUpdate.logicalCircuits[0].circuitSymbols.push(probeSym);

    const dialogProbeMarkup = renderToStaticMarkup(
      React.createElement(PropertyDialog, {
        isOpen: true,
        symbol: probeSym,
        onClose: () => {},
      }),
    );
    expect(dialogProbeMarkup).not.toContain(`value="${unnamedProbe.circuitProbeId}"`);

    // Natives Format bewahrt Probe-Übergröße (13x2), Format und leeren Namen verlustfrei
    const nativeJson = serializeNativeProject(afterSensorUpdate);
    const nativeReloaded = parseNativeProject(nativeJson);
    const nativeProbe = nativeReloaded.circuitProbes[0] as CircuitProbe;
    expect(nativeProbe.notation).toBe("?");
    expect(nativeProbe.symbolWidth).toBe(13);
    expect(nativeProbe.symbolHeight).toBe(2);
    expect(nativeProbe.displayFormat).toBe("dec");

    // Desktop-XML normalisiert IDs auf GUIDs, behält 32-Bit-Clock-Sensor und streift Web-Probe-Größe/Format ab
    const xml = exportProjectToXml(afterSensorUpdate);
    expect(xml).not.toContain("DisplayFormat=");
    expect(xml).not.toContain("Width=\"13\"");
    const reloaded = importProjectFromXml(xml);
    const reloadedSensor = reloaded.sensors[0] as Sensor;
    const reloadedProbe = reloaded.circuitProbes[0] as CircuitProbe;

    expect(reloadedSensor.sensorType).toBe("clock");
    expect(reloadedSensor.bitWidth).toBe(32);
    expect(reloadedProbe.notation).toBe("?");
    expect(reloadedProbe.symbolWidth).toBe(2);
    expect(reloadedProbe.symbolHeight).toBe(2);
  });
});
