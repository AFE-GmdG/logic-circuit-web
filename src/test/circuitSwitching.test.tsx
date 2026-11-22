import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import {
  createDefaultLogicalCircuit,
  createDemoCircuitProject,
  createEmptyCircuitProject,
  instantiateCircuitFromPalette,
  wouldCreateCircuitCycle,
} from "../utils/circuitLayout";

import AppHeader from "../components/app/appHeader";
import CircuitCanvas from "../components/circuitCanvas";
import ComponentPalette from "../components/componentPalette";
import PaletteItem from "../components/componentPalette/paletteItem";

const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

describe("T-012: Aktive Schaltung wechseln und anzeigen", () => {
  it("initialisiert mit der Haupt-Schaltung als aktiver Schaltung", () => {
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedContext).not.toBeNull();
    const { currentCircuit, currentCircuitId, project } = capturedContext!;
    expect(currentCircuitId).toBe(project.project.logicalCircuitId);
    expect(currentCircuit.name).toBe("Haupt-Schaltung");
  });

  it("initialisiert mit einer Subschaltung bei entsprechendem initialCircuitId", () => {
    const demo = createDemoCircuitProject();
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo} initialCircuitId="sub-power">
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedContext).not.toBeNull();
    const { currentCircuit, currentCircuitId } = capturedContext!;
    expect(currentCircuitId).toBe("sub-power");
    expect(currentCircuit.name).toBe("Power");
    expect(capturedContext!.selectedSymbolIds).toEqual([]);
    expect(capturedContext!.selectedTextNoteIds).toEqual([]);
  });

  it("fügt neue Bauteile und Textnotizen in die aktuell aktive Schaltung ein", () => {
    const demo = createDemoCircuitProject();
    let capturedContext: React.ContextType<typeof CircuitContext> | null = null;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo} initialCircuitId="sub-7seg-4bit">
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    const ctx = capturedContext!;

    let placedSymbol = null;
    let placedNote = null;
    React.act(() => {
      placedSymbol = ctx.addSymbol({ type: "not", name: "NOT" }, { x: 20, y: 20 });
      placedNote = ctx.addTextNote("Neue Notiz im Decoder", { x: 20, y: 18 });
    });

    expect(placedSymbol).not.toBeNull();
    expect(placedSymbol!.logicalCircuitId).toBe("sub-7seg-4bit");
    expect(placedNote).not.toBeNull();
    expect(placedNote!.logicalCircuitId).toBe("sub-7seg-4bit");
    expect(placedNote!.note).toBe("Neue Notiz im Decoder");
  });

  it("rendert PaletteItem mit 'Aktiv'-Badge und deaktiviertem Drag bei aktiver Schaltung", () => {
    const activeHtml = renderToStaticMarkup(
      <PaletteItem
        type="subCircuit"
        label="Power"
        subCircuitId="sub-power"
        isActive={true}
      />,
    );

    expect(activeHtml).toMatch(/class="[^"]*palette-item active[^"]*"/);
    expect(activeHtml).toContain("<span class=\"active-badge\">Aktiv</span>");
    expect(activeHtml).toContain("draggable=\"false\"");
    expect(activeHtml).toContain("Power (Aktive Schaltung)");

    const inactiveHtml = renderToStaticMarkup(
      <PaletteItem
        type="subCircuit"
        label="Power"
        subCircuitId="sub-power"
        isActive={false}
      />,
    );

    expect(inactiveHtml).not.toMatch(/class="[^"]*palette-item active[^"]*"/);
    expect(inactiveHtml).not.toContain("<span class=\"active-badge\">");
    expect(inactiveHtml).toContain("draggable=\"true\"");
    expect(inactiveHtml).toContain("Power (Doppelklick zum Öffnen, Ziehen zum Platzieren)");
  });

  it("hebt die aktuell aktive Schaltung in der gesamten ComponentPalette hervor", () => {
    const demo = createDemoCircuitProject();
    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <ComponentPalette />
      </CircuitContextProvider>,
    );

    expect(html).toContain("Haupt-Schaltung");
    expect(html).toContain("<span class=\"active-badge\">Aktiv</span>");
  });

  it("rendert im AppHeader die aktuell aktive Schaltung ohne statische Parent-Breadcrumbs", () => {
    const demo = createDemoCircuitProject();

    const mainHeaderHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContextProvider>
          <AppHeader />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(mainHeaderHtml).toContain("active-circuit-display");
    expect(mainHeaderHtml).toContain("Haupt-Schaltung");
    expect(mainHeaderHtml).not.toContain("breadcrumb-link");

    const subHeaderHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo} initialCircuitId="sub-power">
        <SimulationContextProvider>
          <AppHeader />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(subHeaderHtml).toContain("active-circuit-display");
    expect(subHeaderHtml).toContain("Power");
    expect(subHeaderHtml).toContain("Helpers");
    expect(subHeaderHtml).not.toContain("breadcrumb-link");
  });

  it("erkennt und verhindert Kreisabhängigkeiten zwischen Schaltungen", () => {
    const project = createEmptyCircuitProject("Cycle Test", "Circuit A");
    const circuitA = project.logicalCircuits[0];
    const circuitB = createDefaultLogicalCircuit("circuit-b", "Circuit B");
    const circuitC = createDefaultLogicalCircuit("circuit-c", "Circuit C");
    project.logicalCircuits.push(circuitB, circuitC);

    // Eine Schaltung darf sich niemals selbst enthalten
    expect(wouldCreateCircuitCycle(circuitA.logicalCircuitId, circuitA.logicalCircuitId, project)).toBe(true);

    // B in A platzieren: A -> B
    const { circuitSymbol: symB } = instantiateCircuitFromPalette(
      project,
      circuitA.logicalCircuitId,
      { type: "subCircuit", subCircuitId: circuitB.logicalCircuitId, name: "Circuit B" },
      { x: 5, y: 5 },
    );
    circuitA.circuitSymbols.push(symB);

    // Da A bereits B enthält, würde das Platzieren von A in B einen direkten Kreis (B -> A -> B) erzeugen
    expect(wouldCreateCircuitCycle(circuitB.logicalCircuitId, circuitA.logicalCircuitId, project)).toBe(true);

    // C in B platzieren: A -> B -> C
    const { circuitSymbol: symC } = instantiateCircuitFromPalette(
      project,
      circuitB.logicalCircuitId,
      { type: "subCircuit", subCircuitId: circuitC.logicalCircuitId, name: "Circuit C" },
      { x: 5, y: 5 },
    );
    circuitB.circuitSymbols.push(symC);

    // Transitiver Kreis: A in C platzieren (C -> A -> B -> C) ist unzulässig
    expect(wouldCreateCircuitCycle(circuitC.logicalCircuitId, circuitA.logicalCircuitId, project)).toBe(true);

    // Versuch einer zyklischen Instanziierung wirft eine Exception
    expect(() => {
      instantiateCircuitFromPalette(
        project,
        circuitC.logicalCircuitId,
        { type: "subCircuit", subCircuitId: circuitA.logicalCircuitId, name: "Circuit A" },
        { x: 10, y: 10 },
      );
    }).toThrow(/Zyklus erkannt/);

    // Schaltung D existiert unabhängig: C in D ist erlaubt
    const circuitD = createDefaultLogicalCircuit("circuit-d", "Circuit D");
    project.logicalCircuits.push(circuitD);
    expect(wouldCreateCircuitCycle(circuitD.logicalCircuitId, circuitC.logicalCircuitId, project)).toBe(false);
  });

  it("deaktiviert das Ziehen für Schaltungen, die einen Kreisbezug erzeugen würden", () => {
    const html = renderToStaticMarkup(
      <PaletteItem
        type="subCircuit"
        label="Circuit A"
        subCircuitId="circuit-a"
        isCycle={true}
      />,
    );

    expect(html).toContain("cycle-blocked");
    expect(html).toContain("draggable=\"false\"");
    expect(html).toContain("Nicht platzierbar: Kreisbezug");
  });

  it("rendert Canvas mit Inhalten der jeweiligen Schaltung", () => {
    const demo = createDemoCircuitProject();

    // Canvas mit Hauptschaltung
    const mainCanvasHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <CanvasContextProvider>
          <CircuitCanvas />
        </CanvasContextProvider>
      </CircuitContextProvider>,
    );

    expect(mainCanvasHtml).toContain("circuit-wire");
    expect(mainCanvasHtml).not.toContain("STROMVERSORGUNG (POWER)");

    // Canvas mit Subschaltung Power
    const powerCanvasHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo} initialCircuitId="sub-power">
        <CanvasContextProvider>
          <CircuitCanvas />
        </CanvasContextProvider>
      </CircuitContextProvider>,
    );

    expect(powerCanvasHtml).toContain("STROMVERSORGUNG (POWER)");
    expect(powerCanvasHtml).not.toContain("data-testid=\"circuit-wire-");
  });
});
