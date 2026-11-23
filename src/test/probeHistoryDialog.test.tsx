import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";

import type GridPoint from "../types/canvas/gridPoint";
import type Wire from "../types/circuit/wire";
import type { ProbeHistorySnapshot } from "../types/simulation/oscilloscope";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../types/simulation/state";

import i18n from "../i18n";
import CircuitMap from "../simulation/compiler/circuitMap";
import CircuitRunner from "../simulation/worker/circuitRunner";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
} from "../utils/circuitLayout";

import ProbeHistoryDialog, {
  clampFloatingDialogPosition,
  formatProbeHistoryClipboardText,
  formatProbeHistoryEntryValue,
  resolveInitialProbeFormat,
} from "../components/app/probeHistoryDialog";
import { dispatchSimulationSymbolDoubleClick } from "../components/circuitCanvas";

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

describe("T-074: Messsonden-Verlaufsdialog (ProbeHistoryDialog) & Canvas-Doppelklick", () => {
  it("öffnet bei Doppelklick auf eine CircuitProbe während der Simulation onOpenProbeHistory und ignoriert Display-Buttons", () => {
    const circuit = createDefaultLogicalCircuit("main-dbl", "DoubleClickTest");
    const probe = createCircuitProbe("probe-dbl", "TestProbe", "left", 2, 2, true);
    const probeSym = createCircuitSymbol(probe, "main-dbl", 8, 4, "up", "sym-probe-dbl");
    circuit.circuitSymbols = [probeSym];

    const rootMap = new CircuitMap(circuit);
    const selectCircuitMap = vi.fn();
    const onOpenMemoryInspector = vi.fn();
    const onOpenProbeHistory = vi.fn();

    const handled = dispatchSimulationSymbolDoubleClick({
      symbol: probeSym,
      target: null,
      activeSimulationMap: rootMap,
      selectCircuitMap,
      onOpenMemoryInspector,
      onOpenProbeHistory,
    });

    expect(handled).toBe(true);
    expect(onOpenProbeHistory).toHaveBeenCalledTimes(1);
    expect(onOpenProbeHistory).toHaveBeenCalledWith(probeSym, rootMap);
    expect(onOpenMemoryInspector).not.toHaveBeenCalled();

    // Doppelklick auf einen eingebetteten Display-Button innerhalb einer Subschaltung wird ignoriert
    const fakeDisplayBtnTarget = {
      closest: (selector: string) => (selector === "[data-display-button-path]" ? {} : null),
    } as unknown as EventTarget;

    const ignored = dispatchSimulationSymbolDoubleClick({
      symbol: probeSym,
      target: fakeDisplayBtnTarget,
      activeSimulationMap: rootMap,
      selectCircuitMap,
      onOpenProbeHistory,
    });

    expect(ignored).toBe(false);
    expect(onOpenProbeHistory).toHaveBeenCalledTimes(1);
  });

  it("formatiert Verlaufs-Einträge in Hex, Dezimal und Binär sowie als Zwischenablage-Text inklusive Markierungen", () => {
    const probeHex = createCircuitProbe("p-hex", "HexProbe", "left", 2, 2, true);
    probeHex.displayFormat = "hex";
    const probeDec = createCircuitProbe("p-dec", "DecProbe", "left");
    probeDec.displayFormat = "dec";
    const probeBin = createCircuitProbe("p-bin", "BinProbe", "left");
    probeBin.displayFormat = "bin";

    expect(resolveInitialProbeFormat(createCircuitSymbol(probeHex, "m", 0, 0))).toBe("hex");
    expect(resolveInitialProbeFormat(createCircuitSymbol(probeDec, "m", 0, 0))).toBe("dec");
    expect(resolveInitialProbeFormat(createCircuitSymbol(probeBin, "m", 0, 0))).toBe("bin");

    const sampleHistory: ProbeHistorySnapshot = {
      probeId: "p-hex",
      rawProbeId: "p-hex",
      label: "DataBus",
      path: "Main/DataBus[4,2]",
      bitWidth: 4,
      displayFormat: "hex",
      markAllowed: false,
      entries: [
        { kind: "mark" },
        {
          kind: "value",
          packed: "170",
          states: [STATE_ON0, STATE_ON1, STATE_ON0, STATE_ON1],
          numericValue: 10,
          textHex: "0xA",
          textDec: "10",
          textBin: "1010",
        },
        {
          kind: "value",
          packed: "0",
          states: [STATE_OFF, STATE_ON0, STATE_ON0, STATE_ON0],
          numericValue: null,
          textHex: "000z",
          textDec: "000z",
          textBin: "000z",
        },
      ],
    };

    const firstVal = sampleHistory.entries[1];
    if (firstVal?.kind === "value") {
      expect(formatProbeHistoryEntryValue(firstVal, "hex")).toBe("0xA");
      expect(formatProbeHistoryEntryValue(firstVal, "dec")).toBe("10");
      expect(formatProbeHistoryEntryValue(firstVal, "bin")).toBe("1010");
    }

    expect(formatProbeHistoryClipboardText(sampleHistory, "hex", "-------------")).toBe(
      "-------------\n0xA\n000z",
    );
    expect(formatProbeHistoryClipboardText(sampleHistory, "dec", "-------------")).toBe(
      "-------------\n10\n000z",
    );
  });

  it("rendert Werte, neuestes Badge, Trennmarkierungen und deaktivierten Markieren-Button korrekt", async () => {
    await i18n.changeLanguage("de");

    const probe = createCircuitProbe("p-render", "BusOut", "left", 2, 2, true);
    probe.displayFormat = "hex";
    const probeSym = createCircuitSymbol(probe, "main", 6, 4, "up", "sym-render");

    const historyWithValues: ProbeHistorySnapshot = {
      probeId: "p-render",
      rawProbeId: "p-render",
      label: "BusOut",
      path: "Main/BusOut[6,4]",
      bitWidth: 8,
      displayFormat: "hex",
      markAllowed: true,
      entries: [
        {
          kind: "value",
          packed: "255",
          states: Array.from({ length: 8 }, () => STATE_ON1),
          numericValue: 255,
          textHex: "0xFF",
          textDec: "255",
          textBin: "11111111",
        },
        {
          kind: "value",
          packed: "0",
          states: Array.from({ length: 8 }, () => STATE_ON0),
          numericValue: 0,
          textHex: "0x0",
          textDec: "0",
          textBin: "00000000",
        },
      ],
    };

    const htmlActive = renderToStaticMarkup(
      <SimulationContext.Provider value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true }}>
        <ProbeHistoryDialog
          isOpen={true}
          symbol={probeSym}
          probeInstanceId="p-render"
          circuitPath="Main/BusOut[6,4]"
          initialHistory={historyWithValues}
          onClose={() => {}}
        />
      </SimulationContext.Provider>,
    );

    expect(htmlActive).toContain("data-component=\"ProbeHistoryDialog\"");
    expect(htmlActive).toContain("aria-modal=\"false\"");
    expect(htmlActive).toContain("left:48px");
    expect(htmlActive).toContain("top:72px");
    expect(htmlActive).toContain("Messsonden-Verlauf: BusOut");
    expect(htmlActive).toContain("Bitbreite: 8 Bit");
    expect(htmlActive).toContain("Instanz: Main/BusOut[6,4]");
    expect(htmlActive).toContain("0xFF");
    expect(htmlActive).toContain("0x0");
    expect(htmlActive).toContain("Aktuell");
    expect(htmlActive).toContain("data-testid=\"probe-history-mark-btn\"");
    expect(htmlActive).not.toContain("data-testid=\"probe-history-mark-btn\" disabled");

    // Wenn der oberste Eintrag eine Markierung ist, wird die Trennzeile angezeigt und Markieren deaktiviert
    const historyMarked: ProbeHistorySnapshot = {
      ...historyWithValues,
      markAllowed: false,
      entries: [{ kind: "mark" }, ...historyWithValues.entries],
    };

    const htmlMarked = renderToStaticMarkup(
      <SimulationContext.Provider value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true }}>
        <ProbeHistoryDialog
          isOpen={true}
          symbol={probeSym}
          probeInstanceId="p-render"
          circuitPath="Main/BusOut[6,4]"
          initialHistory={historyMarked}
          onClose={() => {}}
        />
      </SimulationContext.Provider>,
    );

    expect(htmlMarked).toContain("-------------");
    expect(htmlMarked).toContain("data-testid=\"probe-history-mark\"");
    expect(htmlMarked).toContain("disabled=\"\"");

    // Unverbundene Messsonde (bitWidth === 0) zeigt den Hinweis auf ein inaktives Signal
    const htmlInactive = renderToStaticMarkup(
      <SimulationContext.Provider value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true }}>
        <ProbeHistoryDialog
          isOpen={true}
          symbol={probeSym}
          probeInstanceId="p-render"
          initialHistory={{
            ...historyWithValues,
            bitWidth: 0,
            entries: [],
          }}
          onClose={() => {}}
        />
      </SimulationContext.Provider>,
    );

    expect(htmlInactive).toContain("data-testid=\"probe-history-inactive\"");
    expect(htmlInactive).toContain("nicht mit einem aktiven Signal verbunden");
  });

  it("zeichnet Wertänderungen auch in Schaltungen ohne Taktgeber bei Schalter-Interaktion für den Dialog auf", () => {
    const circuit = createDefaultLogicalCircuit("clockless", "OhneTakt");
    const toggle = createCircuitButton("btn-toggle", "Schalter", true, "right");
    const toggleSym = createCircuitSymbol(toggle, "clockless", 0, 2, "up", "sym-toggle");
    const probe = createCircuitProbe("probe-out", "Out", "left", 2, 2, true);
    const probeSym = createCircuitSymbol(probe, "clockless", 8, 2, "up", "sym-probe");

    circuit.circuitSymbols = [toggleSym, probeSym];
    circuit.wires = [
      makeWire(
        "w-1",
        "clockless",
        toggleSym.jams.find((j) => j.pin.pinType === "output")!.absolutePoint,
        probeSym.jams[0].absolutePoint,
      ),
    ];

    const runner = new CircuitRunner(circuit);
    expect(runner.hasClocks).toBe(false);

    runner.start();
    runner.toggleButton("btn-toggle");
    runner.toggleButton("btn-toggle");

    const history = runner.readProbeHistory("probe-out");
    expect(history).not.toBeNull();
    expect(history?.entries.filter((entry) => entry.kind === "value").map((e) => e.textHex)).toEqual([
      "0",
      "1",
      "0",
      "z",
    ]);

    const afterMark = runner.markProbeHistory("probe-out");
    expect(afterMark?.markAllowed).toBe(false);
    expect(afterMark?.entries[0]).toEqual({ kind: "mark" });

    runner.dispose();
  });

  it("begrenzt die Position beim Verschieben des schwebenden Dialogs strikt auf die Webseitengrenzen", () => {
    const dialogSize = { width: 416, height: 360 };
    const viewport = { width: 1280, height: 720 };

    // Negatives Herausziehen oben links wird am Rand (8 px) gestoppt
    expect(clampFloatingDialogPosition({ x: -120, y: -50 }, dialogSize, viewport)).toEqual({
      x: 8,
      y: 8,
    });

    // Herausziehen rechts unten wird am sichtbaren Rand begrenzt
    expect(clampFloatingDialogPosition({ x: 1200, y: 700 }, dialogSize, viewport)).toEqual({
      x: 1280 - 416 - 8,
      y: 720 - 360 - 8,
    });

    // Gültige Position innerhalb der Grenzen bleibt unverändert
    expect(clampFloatingDialogPosition({ x: 300, y: 140 }, dialogSize, viewport)).toEqual({
      x: 300,
      y: 140,
    });

    // Sehr kleiner Viewport klemmt sauber auf den Mindestabstand
    expect(clampFloatingDialogPosition({ x: 50, y: 50 }, dialogSize, { width: 320, height: 240 })).toEqual({
      x: 8,
      y: 8,
    });
  });
});
