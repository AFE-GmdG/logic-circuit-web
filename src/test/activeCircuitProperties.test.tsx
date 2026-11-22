import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import { createDemoCircuitProject, createEmptyCircuitProject } from "../utils/circuitLayout";

import AppHeader from "../components/app/appHeader";

const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

describe("Eigenschaften der aktiven Schaltung manipulieren (AppHeader)", () => {
  it("rendert active-circuit-display im Editiermodus als interaktives Button-Element mit Tooltip", () => {
    const demo = createDemoCircuitProject();

    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContextProvider>
          <AppHeader />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(html).toContain("data-component=\"AppHeader\"");
    expect(html).toContain("active-circuit-display editable");
    expect(html).toContain("role=\"button\"");
    expect(html).toContain("tabindex=\"0\"");
    expect(html).toContain("aria-label=\"Aktive Schaltung\"");
    expect(html).toContain("Doppelklick zum Bearbeiten der Eigenschaften");
    expect(html).toContain("Haupt-Schaltung");
  });

  it("deaktiviert Interaktion auf active-circuit-display während der Simulation", () => {
    const demo = createDemoCircuitProject();
    const mockSimulationContext: React.ContextType<typeof SimulationContext> = {
      ...DEFAULT_SIMULATION_STATE,
      isSimulating: true,
      isPaused: false,
      isRunning: true,
      frameRateLimit: 30,
    };

    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContext.Provider value={mockSimulationContext}>
          <AppHeader />
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );

    // Nicht editierbar während der Simulation
    expect(html).not.toContain("active-circuit-display editable");
    expect(html).not.toContain("role=\"button\"");
    expect(html).not.toContain("tabindex=\"0\"");
    expect(html).not.toContain("Doppelklick zum Bearbeiten der Eigenschaften");
    expect(html).toContain("Simulation aktiv auf Schaltung: Haupt-Schaltung");
    expect(html).toContain("running simulating");
  });

  it("modifiziert Schaltungs-Eigenschaften über updateCircuitProperties und aktualisiert AppHeader", () => {
    let capturedContext!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Props Test", "Mein Schaltkreis")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedContext.currentCircuit.name).toBe("Mein Schaltkreis");
    expect(capturedContext.currentCircuit.category).toBe("");

    // Schaltungseigenschaften aktualisieren: Name, Kategorie und Notiz ändern
    React.act(() => {
      capturedContext.updateCircuitProperties(capturedContext.currentCircuit.logicalCircuitId, {
        name: "ALU 8-Bit",
        category: "Arithmetik",
        note: "Vollständiges Rechenwerk mit Addierer und Shifter",
      });
    });

    expect(capturedContext.currentCircuit.name).toBe("ALU 8-Bit");
    expect(capturedContext.currentCircuit.category).toBe("Arithmetik");
    expect(capturedContext.currentCircuit.note).toBe("Vollständiges Rechenwerk mit Addierer und Shifter");

    // Header rendert neuen Namen und Kategorie
    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={capturedContext.project} initialCircuitId={capturedContext.currentCircuitId}>
        <SimulationContextProvider>
          <AppHeader />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(html).toContain("ALU 8-Bit");
    expect(html).toContain("Arithmetik");
    expect(html).toContain("Aktuell bearbeitete Schaltung: ALU 8-Bit (Doppelklick zum Bearbeiten der Eigenschaften)");
  });

  it("unterstützt Undo und Redo bei Änderung der Schaltungseigenschaften", () => {
    let capturedContext!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={createEmptyCircuitProject("Undo Test", "Original-Name")}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedContext.currentCircuit.name).toBe("Original-Name");
    expect(capturedContext.canUndo).toBe(false);

    // Eigenschaftsänderung durchführen
    React.act(() => {
      capturedContext.updateCircuitProperties(capturedContext.currentCircuit.logicalCircuitId, {
        name: "Neuer Schaltungsname",
        category: "Submodule",
      });
    });

    expect(capturedContext.currentCircuit.name).toBe("Neuer Schaltungsname");
    expect(capturedContext.currentCircuit.category).toBe("Submodule");
    expect(capturedContext.canUndo).toBe(true);

    // Undo: Zurück zum Original-Namen
    React.act(() => {
      capturedContext.undo();
    });

    expect(capturedContext.currentCircuit.name).toBe("Original-Name");
    expect(capturedContext.currentCircuit.category).toBe("");
    expect(capturedContext.canRedo).toBe(true);

    // Redo: Wiederherstellen des neuen Namens
    React.act(() => {
      capturedContext.redo();
    });

    expect(capturedContext.currentCircuit.name).toBe("Neuer Schaltungsname");
    expect(capturedContext.currentCircuit.category).toBe("Submodule");
  });
});
