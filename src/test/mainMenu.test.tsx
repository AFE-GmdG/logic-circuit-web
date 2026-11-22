import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import { createDemoCircuitProject, createEmptyCircuitProject } from "../utils/circuitLayout";
import { getCircuitDeletionBlockReason } from "../utils/circuitManagement";

import AppHeader from "../components/app/appHeader";
import ConfirmDialog from "../components/app/confirmDialog";
import HelpDialog from "../components/app/helpDialog";
import MainMenu from "../components/app/mainMenu";
import PrivacyDialog from "../components/app/privacyDialog";
import ComponentPalette from "../components/componentPalette";
import PropertyDialog from "../components/propertyDialog";

const TestConsumer: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

const noop = () => undefined;

describe("T-040: Hauptmenü, Schaltplanverwaltung & Hilfe-Dialog", () => {
  it("rendert MainMenu nicht im geschlossenen Zustand", () => {
    const html = renderToStaticMarkup(
      <MainMenu
        isOpen={false}
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        canDeleteCurrentCircuit={false}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );

    expect(html).not.toContain("data-component=\"MainMenu\"");
    expect(html).not.toContain("Datei / Projekt");
  });

  it("rendert alle 5 Menükategorien und ausgegraute Platzhalter im geöffneten MainMenu", () => {
    const html = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={true}
        canRedo={false}
        hasSelection={true}
        hasSymbolSelection={true}
        canDeleteCurrentCircuit={true}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );

    expect(html).toContain("data-component=\"MainMenu\"");
    expect(html).toContain("Datei / Projekt");
    expect(html).toContain("Bearbeiten");
    expect(html).toContain("Schaltung");
    expect(html).toContain("Ansicht / Werkzeuge");
    expect(html).toContain("Hilfe");

    // Datei-Untermenü initial sichtbar inkl. Platzhalter für T-041 / T-050
    expect(html).toContain("Neues Projekt (leer)");
    expect(html).toContain("Demo-Projekt laden");
    expect(html).toContain("Öffnen / Importieren...");
    expect(html).toContain("Speichern");
    expect(html).toContain("Strg+S");
    expect(html).toContain("Als Bild exportieren...");
    expect(html).toContain("Exportiert die aktuelle Schaltung als PNG (1:1) oder SVG");
    expect(html).toContain("Projekt-Einstellungen...");
    expect(html).toContain("Projektname, Beschreibung und Ziel-Taktfrequenz (Hz) bearbeiten");

    const toolsHtml = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="view"
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        canDeleteCurrentCircuit={false}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );

    expect(toolsHtml).toContain("CleanUp-Visualisierung");
    expect(toolsHtml).toContain("Suchen...");
    expect(toolsHtml).toContain("Einstellungen / Optionen...");
    expect(toolsHtml).toContain("Startverhalten, Standard-Taktfrequenz und Projektverzeichnisse konfigurieren");

    const helpHtml = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="help"
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        canDeleteCurrentCircuit={false}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenPrivacy={noop}
        onOpenHelp={noop}
      />,
    );

    const privacyIndex = helpHtml.indexOf("Datenschutz (GDPR)...");
    const shortcutsIndex = helpHtml.indexOf("Tastaturkürzel &amp; Über Logic Circuit Web...");
    expect(privacyIndex).toBeGreaterThan(-1);
    expect(shortcutsIndex).toBeGreaterThan(privacyIndex);
  });

  it("deaktiviert destruktive Datei-Aktionen während aktiver Simulation, lässt Speichern jedoch aktiv", () => {
    const html = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        isSimulating={true}
        isPaused={false}
        isRunning={true}
        canUndo={true}
        canRedo={true}
        hasSelection={true}
        hasSymbolSelection={true}
        canDeleteCurrentCircuit={true}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );

    expect(html).toContain("Während aktiver Simulation nicht verfügbar");
    expect(html).toContain("Speichert das aktuelle Projekt im nativen Web-Format (.lcweb)");
    expect(html).toContain("Für Desktop exportieren (.CircuitProject)...");
  });

  it("rendert AppHeader mit zugänglichem Hamburger-Button und ComponentPalette mit Schaltungs-Buttons", () => {
    const demo = createDemoCircuitProject();

    const headerHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContextProvider>
          <AppHeader />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(headerHtml).toContain("aria-haspopup=\"menu\"");
    expect(headerHtml).toContain("aria-expanded=\"false\"");

    const paletteHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContextProvider>
          <ComponentPalette />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(paletteHtml).toContain("new-circuit-button");
    expect(paletteHtml).toContain("+ Schaltung");
    expect(paletteHtml).toContain("delete-circuit-button");
  });

  it("unterstützt PropertyDialog im direkten Erstellungsmodus für neue Schaltungen", () => {
    const onCreate = vi.fn();

    const html = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        isCreatingCircuit={true}
        onCreateCircuit={onCreate}
        onClose={noop}
      />,
    );

    expect(html).toContain("Neue Schaltung anlegen");
    expect(html).toContain("value=\"Neue Schaltung\"");
    expect(html).toContain("Erstellen");
    expect(html).not.toContain(">Speichern<");
  });

  it("rendert HelpDialog mit Editor- & Simulations-Kürzeln und C#-Desktop-Hinweis", () => {
    const html = renderToStaticMarkup(
      <HelpDialog isOpen={true} onClose={noop} />,
    );

    expect(html).toContain("data-component=\"HelpDialog\"");
    expect(html).toContain("Hilfe &amp; Tastaturkürzel");
    expect(html).toContain("F2 / Doppelklick");
    expect(html).toContain("Strg + Z");
    expect(html).toContain("F5");
    expect(html).toContain("Shift + F5");
    expect(html).toContain("F10");
    expect(html).toContain("Über Logic Circuit Web");
    expect(html).toContain("https://www.logiccircuit.org/");
    expect(html).toContain("https://github.com/eugenelepekhin/LogicCircuit");
    expect(html).toContain("LogicCircuit");
    expect(html).toContain(".CircuitProject");
  });

  it("rendert PrivacyDialog mit konfigurierbaren Betreiberangaben und neutralem Fallback", () => {
    const configuredHtml = renderToStaticMarkup(
      <PrivacyDialog
        isOpen={true}
        initialConfig={{
          responsibleName: "Max Mustermann",
          responsibleAddress: "Musterstraße 1, 12345 Musterstadt",
          contactEmail: "privacy@example.com",
          hostingLocation: "Deutschland, Frankfurt",
        }}
        onClose={noop}
      />,
    );

    expect(configuredHtml).toContain("data-component=\"PrivacyDialog\"");
    expect(configuredHtml).toContain("Datenschutz (DSGVO / GDPR)");
    expect(configuredHtml).toContain("Max Mustermann");
    expect(configuredHtml).toContain("Musterstraße 1, 12345 Musterstadt");
    expect(configuredHtml).toContain("mailto:privacy@example.com");
    expect(configuredHtml).toContain("Deutschland, Frankfurt");

    const fallbackHtml = renderToStaticMarkup(
      <PrivacyDialog isOpen={true} onClose={noop} />,
    );
    expect(fallbackHtml).toContain("PRIVACY_RESPONSIBLE_NAME");
    expect(fallbackHtml).toContain("Keine Cookies &amp; kein Tracking");
  });

  it("rendert ConfirmDialog für destruktive Bestätigungen", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={true}
        title="Schaltung löschen"
        message="Möchten Sie die Schaltung wirklich löschen?"
        confirmLabel="Löschen"
        isDanger={true}
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("data-component=\"ConfirmDialog\"");
    expect(html).toContain("role=\"alertdialog\"");
    expect(html).toContain("Schaltung löschen");
    expect(html).toContain("btn btn-danger");

    const warningHtml = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={true}
        title="Eingeschränkte Desktop-Kompatibilität"
        message="Hinweis zur Kompatibilität:"
        details={[
          "Subschaltung „DisplayBlock“ nutzt Margin Horizontal",
          "Synthesizer existiert nicht im Desktop",
        ]}
        confirmLabel="Trotzdem exportieren"
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    expect(warningHtml).toContain("data-testid=\"confirm-dialog-details\"");
    expect(warningHtml).toContain("Subschaltung „DisplayBlock“ nutzt Margin Horizontal");
    expect(warningHtml).toContain("Synthesizer existiert nicht im Desktop");
    expect(warningHtml).toContain("Trotzdem exportieren");
  });

  it("prüft Löschschutz für letzte Schaltung und referenzierte Subschaltungen sowie Erstellen & Löschen neuer Schaltungen", () => {
    const empty = createEmptyCircuitProject("Solo", "Haupt-Schaltung");
    expect(
      getCircuitDeletionBlockReason(empty, empty.logicalCircuits[0].logicalCircuitId),
    ).toBe("Mindestens eine Schaltung muss im Projekt verbleiben");

    const demo = createDemoCircuitProject();

    let capturedContext!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
      </CircuitContextProvider>,
    );

    // Subschaltung "sub-power" in "Haupt-Schaltung" instanziieren, um den Löschschutz zu testen
    React.act(() => {
      capturedContext.addSymbol(
        { type: "subCircuit", subCircuitId: "sub-power", name: "Power" },
        { x: 20, y: 20 },
      );
    });
    const powerReason = getCircuitDeletionBlockReason(capturedContext.project, "sub-power");
    expect(powerReason).toContain("wird noch in");

    let createdId = "";
    React.act(() => {
      const created = capturedContext.createCircuits([
        { name: "Test ALU", category: "Arithmetik", note: "Neu erstellt" },
      ]);
      createdId = created[0].logicalCircuitId;
      capturedContext.setCurrentCircuitId(createdId);
    });

    expect(capturedContext.currentCircuitId).toBe(createdId);
    expect(capturedContext.currentCircuit.name).toBe("Test ALU");
    expect(capturedContext.currentCircuit.category).toBe("Arithmetik");
    expect(getCircuitDeletionBlockReason(capturedContext.project, createdId)).toBeNull();

    React.act(() => {
      capturedContext.deleteCircuits([createdId]);
    });

    expect(
      capturedContext.project.logicalCircuits.some((lc) => lc.logicalCircuitId === createdId),
    ).toBe(false);
  });
});
