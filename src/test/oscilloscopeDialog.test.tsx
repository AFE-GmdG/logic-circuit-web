import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";

import type {
  OscilloscopeBusSample,
  OscilloscopeSnapshot,
} from "../types/simulation/oscilloscope";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../types/simulation/state";

import i18n from "../i18n";

import HelpDialog from "../components/app/helpDialog";
import MainMenu from "../components/app/mainMenu";
import OscilloscopeDialog, {
  buildBusSegments,
  buildSingleBitPolylinePoints,
} from "../components/app/oscilloscopeDialog";

const noop = () => undefined;

function makeBusSample(
  states: [typeof STATE_OFF | typeof STATE_ON0 | typeof STATE_ON1, typeof STATE_OFF | typeof STATE_ON0 | typeof STATE_ON1],
  numericValue: number | null,
  textHex: string,
  textDec: string,
  textBin: string,
): OscilloscopeBusSample {
  return {
    states,
    numericValue,
    hasTriState: numericValue === null,
    textHex,
    textDec,
    textBin,
  };
}

function createSampleOscilloscopeSnapshot(): OscilloscopeSnapshot {
  const s0 = makeBusSample([STATE_ON0, STATE_ON0], 0, "0x0", "0", "00");
  const s1 = makeBusSample([STATE_ON1, STATE_ON0], 1, "0x1", "1", "01");
  const s2 = makeBusSample([STATE_OFF, STATE_ON1], null, "1z", "1z", "1z");

  return {
    isOscilloscoping: true,
    historySize: 100,
    totalSteps: 3,
    sampleCount: 3,
    channels: [
      {
        probeId: "p-clk",
        rawProbeId: "p-clk",
        label: "CLK",
        path: "Main/CLK[2,2]",
        bitWidth: 1,
        displayFormat: "bin",
        sampleCount: 3,
        bitTraces: [[STATE_ON0, STATE_ON1, STATE_ON0]],
        busSamples: [
          {
            states: [STATE_ON0],
            numericValue: 0,
            hasTriState: false,
            textHex: "0",
            textDec: "0",
            textBin: "0",
          },
          {
            states: [STATE_ON1],
            numericValue: 1,
            hasTriState: false,
            textHex: "1",
            textDec: "1",
            textBin: "1",
          },
          {
            states: [STATE_ON0],
            numericValue: 0,
            hasTriState: false,
            textHex: "0",
            textDec: "0",
            textBin: "0",
          },
        ],
      },
      {
        probeId: "p-bus",
        rawProbeId: "p-bus",
        label: "DATA",
        path: "Main/DATA[10,2]",
        bitWidth: 2,
        displayFormat: "hex",
        sampleCount: 3,
        bitTraces: [
          [STATE_ON0, STATE_ON1, STATE_OFF],
          [STATE_ON0, STATE_ON0, STATE_ON1],
        ],
        busSamples: [s0, s1, s2],
      },
    ],
  };
}

describe("T-075: Interaktiver Oszilloskop-Dialog (OscilloscopeDialog) & Timing-Diagramm", () => {
  it("berechnet exakte digitale Rechteckkurven für Einzelbit-Signale inklusive Tri-State", () => {
    const points = buildSingleBitPolylinePoints(
      [STATE_ON0, STATE_ON1, STATE_OFF, STATE_ON0],
      10,
      14,
      6,
    );
    // y(On1)=6, y(On0)=20, y(Off)=34
    expect(points).toBe("0,20 10,20 10,6 20,6 20,34 30,34 30,20 40,20");

    // Ein einzelner Abtastwert zeichnet eine waagerechte Linie über eine Schrittbreite
    expect(buildSingleBitPolylinePoints([STATE_ON1], 12, 14, 6)).toBe("0,6 12,6");
    expect(buildSingleBitPolylinePoints([], 12, 14, 6)).toBe("");
  });

  it("gruppiert konstante Multi-Bit-Phasen sauber zu Bus-Blöcken im gewählten Format", () => {
    const sA = makeBusSample([STATE_ON1, STATE_ON0], 1, "0x1", "1", "01");
    const sB = makeBusSample([STATE_ON0, STATE_ON1], 2, "0x2", "2", "10");
    const sZ = makeBusSample([STATE_OFF, STATE_ON1], null, "1z", "1z", "1z");

    const hexSegs = buildBusSegments([sA, sA, sB, sZ], "hex");
    expect(hexSegs).toHaveLength(3);
    expect(hexSegs[0]).toMatchObject({ startIndex: 0, endIndex: 1, length: 2, label: "0x1" });
    expect(hexSegs[1]).toMatchObject({ startIndex: 2, endIndex: 2, length: 1, label: "0x2" });
    expect(hexSegs[2]).toMatchObject({ startIndex: 3, endIndex: 3, length: 1, label: "1z" });

    const decSegs = buildBusSegments([sA, sA, sB], "dec");
    expect(decSegs.map((s) => s.label)).toEqual(["1", "2"]);
  });

  it("rendert OscilloscopeDialog als schwebendes Fenster im Bus- und Einzelbit-Modus sowie mit Cursor-Inspektion", async () => {
    await i18n.changeLanguage("de");
    const snapshotData = createSampleOscilloscopeSnapshot();

    const htmlBus = renderToStaticMarkup(
      <SimulationContext.Provider
        value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true, hasProbes: true }}
      >
        <OscilloscopeDialog
          isOpen={true}
          initialData={snapshotData}
          initialMode="bus"
          initialFormat="hex"
          initialCursorIndex={1}
          onClose={noop}
        />
      </SimulationContext.Provider>,
    );

    expect(htmlBus).toContain("data-component=\"OscilloscopeDialog\"");
    expect(htmlBus).toContain("aria-modal=\"false\"");
    expect(htmlBus).toContain("Oszilloskop &amp; Timing-Diagramm");
    expect(htmlBus).toContain("Aufzeichnung läuft");
    expect(htmlBus).toContain("Cursor #1");
    expect(htmlBus).toContain("DATA");
    expect(htmlBus).toContain("data-testid=\"oscilloscope-bus-waveform\"");
    expect(htmlBus).toContain("data-testid=\"oscilloscope-single-waveform\"");
    expect(htmlBus).toContain("0x1");
    expect(htmlBus).toContain("Puffer: 3 / 100 Samples · Simulationsschritte: 3");

    // Im Einzelbit-Modus werden Multi-Bit-Busse als DATA[0], DATA[1] aufgefächert
    const htmlBits = renderToStaticMarkup(
      <SimulationContext.Provider
        value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true, hasProbes: true }}
      >
        <OscilloscopeDialog
          isOpen={true}
          initialData={snapshotData}
          initialMode="bits"
          onClose={noop}
        />
      </SimulationContext.Provider>,
    );

    expect(htmlBits).toContain("DATA[0]");
    expect(htmlBits).toContain("DATA[1]");
    expect(htmlBits).not.toContain("data-testid=\"oscilloscope-bus-waveform\"");

    // Leerzustand ohne aktive Sonden
    const htmlEmpty = renderToStaticMarkup(
      <SimulationContext.Provider
        value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true, hasProbes: false }}
      >
        <OscilloscopeDialog
          isOpen={true}
          initialData={{
            isOscilloscoping: false,
            historySize: 100,
            totalSteps: 0,
            sampleCount: 0,
            channels: [],
          }}
          onClose={noop}
        />
      </SimulationContext.Provider>,
    );

    expect(htmlEmpty).toContain("data-testid=\"oscilloscope-empty-probes\"");
    expect(htmlEmpty).toContain("Keine aktiven Messsonden");
  });

  it("integriert den Menüpunkt Oszilloskop... in MainMenu und dokumentiert die Shortcuts in HelpDialog", async () => {
    await i18n.changeLanguage("de");

    const baseMenuProps = {
      isOpen: true,
      initialCategory: "circuit" as const,
      isSimulating: true,
      isPaused: false,
      isRunning: true,
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      hasSymbolSelection: false,
      canDeleteCurrentCircuit: false,
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
    };

    const enabledMenuHtml = renderToStaticMarkup(
      <MainMenu
        {...baseMenuProps}
        canOpenOscilloscope={true}
        onOpenOscilloscope={noop}
      />,
    );
    expect(enabledMenuHtml).toContain("Oszilloskop...");
    expect(enabledMenuHtml).toContain("Strg+O");

    const disabledMenuHtml = renderToStaticMarkup(
      <MainMenu
        {...baseMenuProps}
        isSimulating={false}
        isRunning={false}
        canOpenOscilloscope={false}
        onOpenOscilloscope={noop}
      />,
    );
    expect(disabledMenuHtml).toContain("Oszilloskop...");
    expect(disabledMenuHtml).toContain("mindestens einer Messsonde");

    const helpHtml = renderToStaticMarkup(<HelpDialog isOpen={true} onClose={noop} />);
    expect(helpHtml).toContain("Strg + O");
    expect(helpHtml).toContain("Oszilloskop &amp; Timing-Diagramm öffnen");
    expect(helpHtml).toContain("Doppelklick (Sonde)");
  });
});
