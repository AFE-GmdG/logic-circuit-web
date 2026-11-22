import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import { createDemoCircuitProject } from "../utils/circuitLayout";

import AppHeader from "../components/app/appHeader";
import StatusBar from "../components/statusBar";

const TestSimulationConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof SimulationContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(SimulationContext);
  onContext(context);
  return null;
};

describe("SimulationContext", () => {
  it("initialisiert im Editiermodus mit pausierter Simulation und Standard-Framerate 30", () => {
    let captured: React.ContextType<typeof SimulationContext> | null = null;

    renderToStaticMarkup(
      <SimulationContextProvider>
        <TestSimulationConsumer onContext={(ctx) => { captured = ctx; }} />
      </SimulationContextProvider>,
    );

    expect(captured).not.toBeNull();
    expect(captured!.isSimulating).toBe(false);
    expect(captured!.isPaused).toBe(false);
    expect(captured!.isRunning).toBe(false);
    expect(captured!.frameRateLimit).toBe(30);
  });

  it("schaltet über startSimulation, step und stopSimulation zwischen Modi um", () => {
    let captured: React.ContextType<typeof SimulationContext> | null = null;

    renderToStaticMarkup(
      <SimulationContextProvider>
        <TestSimulationConsumer onContext={(ctx) => { captured = ctx; }} />
      </SimulationContextProvider>,
    );

    expect(typeof captured!.startSimulation).toBe("function");
    expect(typeof captured!.step).toBe("function");
    expect(typeof captured!.stopSimulation).toBe("function");
    expect(typeof captured!.setFrameRateLimit).toBe("function");
  });
});

describe("AppHeader", () => {
  it("rendert Hamburger-Platzhalter vor dem Logo und zentriert die aktive Schaltung", () => {
    const demo = createDemoCircuitProject();

    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContextProvider>
          <AppHeader />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    // Hamburger-Menü-Button vor dem Logo
    expect(html).toContain("hamburger-button");
    expect(html).toContain("aria-label=\"Hauptmenü\"");
    expect(html).toContain("Logic Circuit Web");
    expect(html).toContain("app-version");
    expect(html).toContain(`v${process.env.VERSION}`);

    // Zentrierte Schaltungsanzeige
    expect(html).toContain("center-section");
    expect(html).toContain("active-circuit-display");
    expect(html).toContain("Haupt-Schaltung");

    // Entfernte Steuerungs-Buttons dürfen nicht mehr im AppHeader sein
    expect(html).not.toContain("Start Simulation");
    expect(html).not.toContain("Einzelschritt");
    expect(html).not.toContain("Zurücksetzen");
  });
});

describe("StatusBar", () => {
  it("rendert im Editiermodus die 3 Simulations-Buttons und Koordinaten", () => {
    const html = renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContextProvider>
          <CanvasContextProvider>
            <StatusBar />
          </CanvasContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    // Drei Simulations-Buttons am Anfang der Statusleiste
    expect(html).toContain("sim-btn play-btn");
    expect(html).toContain("aria-label=\"Simulation starten\"");
    expect(html).toContain("sim-btn step-btn");
    expect(html).toContain("aria-label=\"Einzelschritt\"");
    expect(html).toContain("sim-btn stop-btn disabled");
    expect(html).toContain("aria-label=\"Simulation beenden\"");

    // Im Editiermodus werden Raster- und Pixelkoordinaten angezeigt
    expect(html).toContain("class=\"coordinates-group\"");
    expect(html).toContain("Raster:");
    expect(html).toContain("Pixel:");
    expect(html).not.toContain("class=\"framerate-group\"");

    // Zoom-Steuerung
    expect(html).toContain("zoom-group");
    expect(html).toContain("Ursprung");
  });

  it("hält Koordinaten im Simulationsmodus sichtbar ohne doppelte Telemetrie in der StatusBar", () => {
    const mockSimulationContext: React.ContextType<typeof SimulationContext> = {
      ...DEFAULT_SIMULATION_STATE,
      isSimulating: true,
      isPaused: false,
      isRunning: true,
      frameRateLimit: 60,
    };

    const html = renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContext.Provider value={mockSimulationContext}>
          <CanvasContextProvider>
            <StatusBar />
          </CanvasContextProvider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );

    // Im Simulationsmodus bleiben Play-Aktiv-Status, Koordinaten und Aktiv-Hinweis sichtbar ohne doppeltes Takt-Dropdown
    expect(html).toContain("sim-btn play-btn active");
    expect(html).toContain("class=\"coordinates-group\"");
    expect(html).toContain("Raster:");
    expect(html).toContain("Pixel:");
    expect(html).toContain("Simulation aktiv");
    expect(html).not.toContain("class=\"framerate-group\"");
    expect(html).not.toContain("framerate-select");
    expect(html).not.toContain("data-testid=\"actual-frequency\"");
  });

  it("zeigt im pausierten Simulationsmodus aktiven Step-Status und Pausiert-Hinweis", () => {
    const mockSimulationContext: React.ContextType<typeof SimulationContext> = {
      ...DEFAULT_SIMULATION_STATE,
      isSimulating: true,
      isPaused: true,
      isRunning: false,
      frameRateLimit: 30,
    };

    const html = renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContext.Provider value={mockSimulationContext}>
          <CanvasContextProvider>
            <StatusBar />
          </CanvasContextProvider>
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );

    expect(html).toContain("sim-btn step-btn active");
    expect(html).toContain("Simulation pausiert");
    expect(html).toContain("class=\"coordinates-group\"");
  });
});
