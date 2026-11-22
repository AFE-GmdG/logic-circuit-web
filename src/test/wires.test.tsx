import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type Jam from "../types/circuit/jam";
import type Wire from "../types/circuit/wire";

import { createEmptyCircuitProject } from "../utils/circuitLayout";
import { formatJamTooltip, validateCircuitWires } from "../utils/wireUtils";

import CircuitCanvas from "../components/circuitCanvas";

const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

describe("US-004: Leitungsverlegung, Signal-Knoten, Rubberbanding und Validierung (T-026 & T-027)", () => {
  it("legt Leitungen an, berechnet ConductorMap sowie Lötpunkte (junctionPoints(3)) und unterstützt Undo/Redo", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject()}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let w1Id = "";
    let w2Id = "";
    let w3Id = "";

    React.act(() => {
      const w1 = ctx.addWire({ x: 2, y: 5 }, { x: 6, y: 5 });
      const w2 = ctx.addWire({ x: 6, y: 5 }, { x: 10, y: 5 });
      const w3 = ctx.addWire({ x: 6, y: 5 }, { x: 6, y: 9 });
      w1Id = w1?.wireId ?? "";
      w2Id = w2?.wireId ?? "";
      w3Id = w3?.wireId ?? "";
    });

    expect(ctx.currentCircuit.wires).toHaveLength(3);
    expect(w1Id).toBeTruthy();
    expect(w2Id).toBeTruthy();
    expect(w3Id).toBeTruthy();

    // Alle 3 Segmente treffen sich bei (6, 5) -> 1 Conductor und 1 Lötpunkt (junctionPoint) bei (6, 5)
    const map = ctx.currentCircuit.conductorMap;
    expect(map).toBeDefined();
    expect(map?.conductors).toHaveLength(1);
    expect(map?.junctionPoints).toEqual([{ x: 6, y: 5 }]);

    // Reine Kreuzung ohne gemeinsamen Endpunkt erzeugt keinen Lötpunkt und bleibt elektrisch getrennt
    React.act(() => {
      ctx.addWire({ x: 4, y: 2 }, { x: 4, y: 8 });
    });

    const mapAfterCross = ctx.currentCircuit.conductorMap;
    expect(mapAfterCross?.conductors).toHaveLength(2);
    expect(mapAfterCross?.junctionPoints).toEqual([{ x: 6, y: 5 }]);

    // Undo entfernt die zuletzt gezogene Kreuzungsleitung
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.wires).toHaveLength(3);

    // Redo stellt sie wieder her
    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.wires).toHaveLength(4);
  });

  it("unterstützt manuelles Teilen (Split) und Verschmelzen (Merge) von Leitungen inkl. Undo/Redo", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject()}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let initialWireId = "";
    React.act(() => {
      const w = ctx.addWire({ x: 2, y: 4 }, { x: 10, y: 4 });
      initialWireId = w!.wireId;
    });

    expect(ctx.currentCircuit.wires).toHaveLength(1);

    // Split bei (6, 4)
    let splitIds: [string, string] = ["", ""];
    React.act(() => {
      const res = ctx.splitWire(initialWireId, { x: 6, y: 4 });
      expect(res).not.toBeNull();
      splitIds = [res![0].wireId, res![1].wireId];
    });

    expect(ctx.currentCircuit.wires).toHaveLength(2);
    expect(ctx.selectedWireIds).toEqual(splitIds);

    // Undo macht den Split rückgängig
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.wires).toHaveLength(1);
    expect(ctx.currentCircuit.wires[0].x1).toBe(2);
    expect(ctx.currentCircuit.wires[0].x2).toBe(10);

    // Redo stellt die geteilten Segmente wieder her
    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.wires).toHaveLength(2);

    // Merge verschmilzt die beiden Segmente wieder zu einer durchgehenden Leitung
    React.act(() => {
      const merged = ctx.mergeWires(splitIds[0], splitIds[1]);
      expect(merged).not.toBeNull();
    });
    expect(ctx.currentCircuit.wires).toHaveLength(1);
    expect(ctx.currentCircuit.wires[0].x1).toBe(2);
    expect(ctx.currentCircuit.wires[0].x2).toBe(10);
  });

  it("wählt per selectConductor das gesamte zusammenhängende Leitungsnetz aus", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject()}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let w1Id = "";
    let w2Id = "";
    let separateId = "";

    React.act(() => {
      w1Id = ctx.addWire({ x: 1, y: 1 }, { x: 5, y: 1 })!.wireId;
      w2Id = ctx.addWire({ x: 5, y: 1 }, { x: 5, y: 6 })!.wireId;
      separateId = ctx.addWire({ x: 12, y: 12 }, { x: 16, y: 12 })!.wireId;
    });

    React.act(() => {
      ctx.selectConductor(w1Id, "replace");
    });

    expect(ctx.selectedWireIds).toHaveLength(2);
    expect(ctx.selectedWireIds).toContain(w1Id);
    expect(ctx.selectedWireIds).toContain(w2Id);
    expect(ctx.selectedWireIds).not.toContain(separateId);
  });

  it("zieht angeschlossene Leitungen beim Bewegen und Rotieren von Bauteilen automatisch mit (Rubberbanding)", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject()}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let gateId = "";
    let jamPoint = { x: 0, y: 0 };

    React.act(() => {
      const sym = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 6, y: 6 });
      gateId = sym.circuitSymbolId;
      jamPoint = { ...sym.jams[0].absolutePoint };
    });

    React.act(() => {
      ctx.addWire({ x: 2, y: jamPoint.y }, jamPoint);
    });

    expect(ctx.currentCircuit.wires[0].point2).toEqual(jamPoint);

    // Bauteil um (+3, +2) mit Rubberbanding verschieben
    React.act(() => {
      ctx.moveSymbol(gateId, { x: 9, y: 8 }, { withWires: true });
    });

    const movedWire = ctx.currentCircuit.wires[0];
    expect(movedWire.point1).toEqual({ x: 2, y: jamPoint.y });
    expect(movedWire.point2).toEqual({ x: jamPoint.x + 3, y: jamPoint.y + 2 });

    // Undo setzt sowohl Bauteil als auch mitgezogene Leitung zurück
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.wires[0].point2).toEqual(jamPoint);

    // Rotation mit Rubberbanding zieht den Leitungsendpunkt an die rotierte Pin-Position mit
    React.act(() => {
      ctx.rotateSymbols([gateId], "clockwise", [], { withWires: true });
    });

    const rotatedSym = ctx.currentCircuit.circuitSymbols[0];
    const rotatedJamPoint = rotatedSym.jams[0].absolutePoint;
    expect(ctx.currentCircuit.wires[0].point2).toEqual(rotatedJamPoint);
  });

  it("erkennt Bitbreiten-Konflikte (markedBad) auf einem Conductor und rendert rote Fehler-Indikatorkreise", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject()}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let pin4BitPoint = { x: 0, y: 0 };
    let pin1BitPoint = { x: 0, y: 0 };
    let probePoint = { x: 0, y: 0 };

    React.act(() => {
      const sym4Bit = ctx.addSymbol(
        { type: "pinIn", name: "Bus4", bitWidth: 4 },
        { x: 2, y: 4 },
      );
      const sym1Bit = ctx.addSymbol(
        { type: "pinOut", name: "Out1", bitWidth: 1 },
        { x: 10, y: 4 },
      );
      const symProbe = ctx.addSymbol(
        { type: "probe", name: "ProbeA" },
        { x: 6, y: 8 },
      );

      pin4BitPoint = { ...sym4Bit.jams[0].absolutePoint };
      pin1BitPoint = { ...sym1Bit.jams[0].absolutePoint };
      probePoint = { ...symProbe.jams[0].absolutePoint };
    });

    // Zuerst nur den 4-Bit-Pin mit der Messsonde (CircuitProbe) verbinden -> KEIN Fehler, da Probe jede Bitbreite akzeptiert
    React.act(() => {
      ctx.addWire(pin4BitPoint, { x: 6, y: pin4BitPoint.y });
      ctx.addWire({ x: 6, y: pin4BitPoint.y }, probePoint);
    });

    expect(ctx.currentCircuit.wires.every((w: Wire) => !w.markedBad)).toBe(true);

    // Jetzt den 1-Bit-Pin an dasselbe Leitungsnetz anschließen -> Bitbreiten-Konflikt (4 Bit vs. 1 Bit)!
    React.act(() => {
      ctx.addWire({ x: 6, y: pin4BitPoint.y }, pin1BitPoint);
    });

    // Alle 3 Leitungssegmente des Conductors müssen als markedBad markiert sein
    expect(ctx.currentCircuit.wires).toHaveLength(3);
    expect(ctx.currentCircuit.wires.every((w: Wire) => w.markedBad)).toBe(true);

    const validation = validateCircuitWires(
      ctx.currentCircuit.circuitSymbols,
      ctx.currentCircuit.wires,
    );
    expect(validation.errorIndicators).toHaveLength(2);
    expect(validation.errorIndicators[0].conflictingBitWidths).toEqual([1, 4]);
    expect(validation.errorIndicators[0].tooltip).toContain("1 Bit ↔ 4 Bit");

    // Rendern auf CircuitCanvas erzeugt die roten Leitungen (.circuit-wire-bad) und die roten Fehler-Indikatorkreise (.wire-error-indicator)
    const html = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={ctx.project} initialCircuitId={ctx.currentCircuitId}>
          <SimulationContextProvider>
            <CircuitCanvas />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    expect(html).toContain("circuit-wire-bad");
    expect(html).toContain("wire-error-indicator");
    expect(html).toContain("wire-error-ring");
    expect(html).toContain("Bitbreiten-Konflikt");
  });

  it("erkennt Mehrfach-Ausgänge (Kurzschluss wie 2 Buttons oder Button + Clock) auf demselben Conductor, erlaubt aber In/Out-Pins als Ausnahme", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject()}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let button1Point = { x: 0, y: 0 };
    let button2Point = { x: 0, y: 0 };
    let clockPoint = { x: 0, y: 0 };
    let pinInPoint = { x: 0, y: 0 };

    React.act(() => {
      const btn1 = ctx.addSymbol({ type: "button", name: "Btn1" }, { x: 2, y: 2 });
      const btn2 = ctx.addSymbol({ type: "button", name: "Btn2" }, { x: 2, y: 6 });
      const clk = ctx.addSymbol({ type: "clock", name: "Clk1" }, { x: 2, y: 10 });
      const pinIn = ctx.addSymbol({ type: "pinIn", name: "ExtIn", bitWidth: 1 }, { x: 10, y: 2 });

      button1Point = { ...btn1.jams[0].absolutePoint };
      button2Point = { ...btn2.jams[0].absolutePoint };
      clockPoint = { ...clk.jams[0].absolutePoint };
      pinInPoint = { ...pinIn.jams[0].absolutePoint };
    });

    // Zuerst Button1 mit einem In-Pin verbinden -> KEIN Fehler, da In/Out-Pins als Ausnahme über mehrere Ebenen kommunizieren
    React.act(() => {
      ctx.addWire(button1Point, pinInPoint);
    });
    expect(ctx.currentCircuit.wires).toHaveLength(1);
    expect(ctx.currentCircuit.wires[0].markedBad).toBe(false);

    // Anschließend zweiten Button (Btn2) und Clock (Clk1) an denselben Conductor anschließen -> Kurzschluss / Mehrfach-Ausgang!
    React.act(() => {
      ctx.addWire(button1Point, button2Point);
      ctx.addWire(button2Point, clockPoint);
    });

    // Gesamter Conductor muss als fehlerhaft (markedBad) markiert sein
    expect(ctx.currentCircuit.wires).toHaveLength(3);
    expect(ctx.currentCircuit.wires.every((w: Wire) => w.markedBad)).toBe(true);

    // Rote Fehler-Indikatoren müssen exakt an den 3 treibenden Ausgängen (Btn1, Btn2, Clk1) sitzen, nicht am In-Pin
    const validation = validateCircuitWires(
      ctx.currentCircuit.circuitSymbols,
      ctx.currentCircuit.wires,
    );
    expect(validation.errorIndicators).toHaveLength(3);
    expect(validation.errorIndicators.every((ind) => ind.errorKind === "multipleOutputs")).toBe(true);
    expect(validation.errorIndicators[0].tooltip).toContain("Mehrfach-Ausgang (Kurzschluss)");
  });

  it("formatiert Pin-Tooltips für Gatter-Pins, Sonden und Bus-Splitter korrekt", () => {
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject()}>
        <TestConsumer onContext={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    let splitterSym!: CircuitSymbol;
    React.act(() => {
      splitterSym = ctx.addSymbol(
        { type: "splitter", name: "Splitter", bitWidth: 8, pinCount: 2, pinBitWidth: 4, clockwise: true },
        { x: 4, y: 4 },
      );
    });

    const busJam = splitterSym.jams.find((j: Jam) => j.pin.name === "Bus")!;
    const thinJam0 = splitterSym.jams.find((j: Jam) => j.pin.name === "0-3")!;

    expect(formatJamTooltip(splitterSym, busJam)).toContain("Bits 0–7, 8 Bit");
    expect(formatJamTooltip(splitterSym, thinJam0)).toContain("Bits 0–3, 4 Bit");
  });
});
