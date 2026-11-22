import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContext from "../contexts/canvasContext";
import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";
import type { McpBridgeController } from "../hooks/useMcpBridge";

import type CircuitProject from "../types/circuit/circuitProject";
import type Gate from "../types/circuit/gate";
import type CircuitDelta from "../types/history/circuitDelta";

import i18n from "../i18n";
import { CircuitMap } from "../simulation/compiler/circuitMap";
import {
  tryParseRandomRange,
  tryParseSensorPoint,
} from "../simulation/functions/io/functionSensor";
import { loadAppSettings } from "../utils/appSettingsStorage";
import {
  createCircuitButton,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createLedMatrix,
  createPinCircuit,
  createSensor,
  createSplitter,
  createTextNote,
  syncProjectLogicalCircuits,
} from "../utils/circuitLayout";
import { getCircuitDeletionBlockReason } from "../utils/circuitManagement";
import {
  getOpenProjectPickerTypes,
  getSaveDesktopXmlPickerTypes,
} from "../utils/fileSystemStorage";
import {
  createWire,
  formatJamTooltip,
  formatWireCleanUpTooltip,
  validateCircuitWires,
} from "../utils/wireUtils";
import { analyzeDesktopExportCompatibility } from "../utils/xml/desktopExportCompatibility";

import AppHeader from "../components/app/appHeader";
import ConfirmDialog from "../components/app/confirmDialog";
import ExportImageDialog from "../components/app/exportImageDialog";
import HelpDialog from "../components/app/helpDialog";
import MainMenu from "../components/app/mainMenu";
import PrivacyDialog from "../components/app/privacyDialog";
import ProjectDialog from "../components/app/projectDialog";
import SimulationErrorDialog from "../components/app/simulationErrorDialog";
import CanvasContextMenu from "../components/circuitCanvas/canvasContextMenu";
import TextNoteModal from "../components/circuitCanvas/textNoteModal";
import ComponentPalette from "../components/componentPalette";
import PropertyDialog from "../components/propertyDialog";
import RunningCircuitTree from "../components/runningCircuitTree";
import TelemetryFooter from "../components/runningCircuitTree/telemetryFooter";
import StatusBar from "../components/statusBar";
import McpRemotePopover from "../components/statusBar/mcpRemotePopover";

const noop = () => undefined;

const ContextProbe: React.FC<{
  onCircuit: (ctx: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onCircuit }) => {
  const ctx = React.useContext(CircuitContext);
  onCircuit(ctx);
  return null;
};

function createMcpController(overrides: Partial<McpBridgeController> = {}): McpBridgeController {
  return {
    status: "remote-active-self",
    mode: "remote",
    sessionId: "abc-123",
    tabId: "tab-1",
    connectedTabCount: 1,
    error: null,
    isSharedWorkerSupported: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    activateThisTab: vi.fn(),
    ...overrides,
  };
}

function createCanvasContextValue(selectedCount: number): React.ContextType<typeof CanvasContext> {
  return {
    viewport: { panX: 0, panY: 0, zoom: 1 },
    setViewport: noop,
    cursor: null,
    setCursor: noop,
    zoomIn: noop,
    zoomOut: noop,
    resetZoom: noop,
    resetView: noop,
    selectedCount,
    setSelectedCount: noop,
    aiHighlightedIds: { symbolIds: [], wireIds: [], textNoteIds: [] },
    highlightAiElements: noop,
    hasClipboardContent: true,
    setHasClipboardContent: noop,
    refreshClipboardAvailability: async () => true,
    registerClipboardActions: noop,
    copySelection: async () => true,
    copySelectionForDesktop: async () => true,
    cutSelection: async () => true,
    pasteFromClipboard: async () => undefined,
  };
}

function createDummyDelta(circuitId: string): CircuitDelta {
  return {
    type: "move",
    logicalCircuitId: circuitId,
    symbolIds: [],
    textNoteIds: [],
    dx: 0,
    dy: 0,
  };
}

function buildRenderedAppHeader(project: CircuitProject, historyLength: number): string {
  let capturedCtx!: React.ContextType<typeof CircuitContext>;
  renderToStaticMarkup(
    <CircuitContextProvider initialProject={project}>
      <ContextProbe onCircuit={(ctx) => { capturedCtx = ctx; }} />
    </CircuitContextProvider>,
  );

  const entries = Array.from({ length: historyLength }, () =>
    createDummyDelta(project.project.logicalCircuitId),
  );

  return renderToStaticMarkup(
    <CircuitContext.Provider
      value={{
        ...capturedCtx,
        history: { entries, pointer: entries.length },
        canUndo: entries.length > 0,
      }}
    >
      <SimulationContextProvider>
        <AppHeader />
      </SimulationContextProvider>
    </CircuitContext.Provider>,
  );
}

describe("T-063: Vollständige UI-Lokalisierung & Live-Sprachumschaltung", () => {
  const originalWindow = (globalThis as { window?: Window & typeof globalThis }).window;

  afterEach(async () => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window & typeof globalThis }).window;
    } else {
      (globalThis as { window?: Window & typeof globalThis }).window = originalWindow;
    }
    await i18n.changeLanguage("de");
  });

  function installMockLocalStorage(): Map<string, string> {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;

    (globalThis as { window?: Window & typeof globalThis }).window = {
      localStorage: mockStorage,
    } as unknown as Window & typeof globalThis;

    return store;
  }

  it("lokalisiert AppHeader inkl. Pluralisierung ohne Sprachschalter im Header", async () => {
    const project = createEmptyCircuitProject("HeaderTest", "Main");

    await i18n.changeLanguage("de");
    const deZero = buildRenderedAppHeader(project, 0);
    const deOne = buildRenderedAppHeader(project, 1);
    const deTwo = buildRenderedAppHeader(project, 2);

    expect(deZero).toContain("aria-label=\"Hauptmenü\"");
    expect(deZero).toContain("title=\"Hauptmenü\"");
    expect(deZero).toContain("Lösche 0 Undo/Redo Schritte");
    expect(deOne).toContain("Lösche 1 Undo/Redo Schritt");
    expect(deTwo).toContain("Lösche 2 Undo/Redo Schritte");
    expect(deZero).not.toContain("statusbar-language-button");
    expect(deZero).not.toContain("language-switcher");

    await i18n.changeLanguage("en");
    const enZero = buildRenderedAppHeader(project, 0);
    const enOne = buildRenderedAppHeader(project, 1);
    const enTwo = buildRenderedAppHeader(project, 2);

    expect(enZero).toContain("aria-label=\"Main menu\"");
    expect(enZero).toContain("title=\"Main menu\"");
    expect(enZero).toContain("Clear 0 Undo/Redo steps");
    expect(enOne).toContain("Clear 1 Undo/Redo step");
    expect(enTwo).toContain("Clear 2 Undo/Redo steps");
    expect(enZero).not.toContain("statusbar-language-button");
    expect(enZero).not.toContain("language-switcher");
  });

  it("lokalisiert MainMenu inkl. Kategorien, Einträgen und Shortcuts live", async () => {
    const renderMenu = (initialCategory: "file" | "view") => renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory={initialCategory}
        isSimulating={false}
        isPaused={false}
        isRunning={false}
        canUndo={true}
        canRedo={false}
        hasSelection={true}
        hasSymbolSelection={true}
        hasCircuitElements={true}
        canPaste={true}
        canDeleteCurrentCircuit={true}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportDesktopXml={noop}
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

    await i18n.changeLanguage("de");
    const deFileHtml = renderMenu("file");
    const deViewHtml = renderMenu("view");
    expect(deFileHtml).toContain("Datei / Projekt");
    expect(deFileHtml).toContain("Speichern");
    expect(deFileHtml).toContain("Strg+S");
    expect(deViewHtml).toContain("Ansicht / Werkzeuge");
    expect(deViewHtml).toContain("Einstellungen / Optionen...");
    expect(deFileHtml).toContain("Hilfe");

    await i18n.changeLanguage("en");
    const enFileHtml = renderMenu("file");
    const enViewHtml = renderMenu("view");
    expect(enFileHtml).toContain("File / Project");
    expect(enFileHtml).toContain("Save");
    expect(enFileHtml).toContain("Ctrl+S");
    expect(enViewHtml).toContain("View / Tools");
    expect(enViewHtml).toContain("Settings / Options...");
    expect(enFileHtml).toContain("Help");
  });

  it("lokalisiert StatusBar inkl. Sprach-Umschalter rechts neben Ursprung/Origin und LanguagePopover", async () => {
    const project = createEmptyCircuitProject();
    const renderStatus = (selectedCount: number, openLangPopover = false) =>
      renderToStaticMarkup(
        <CircuitContextProvider initialProject={project}>
          <SimulationContextProvider>
            <CanvasContext.Provider value={createCanvasContextValue(selectedCount)}>
              <StatusBar
                mcpControllerOverride={createMcpController({ mode: "local", status: "local-connected" })}
                initialLanguagePopoverOpen={openLangPopover}
              />
            </CanvasContext.Provider>
          </SimulationContextProvider>
        </CircuitContextProvider>,
      );

    await i18n.changeLanguage("de");
    const deReady = renderStatus(0, true);
    const deOne = renderStatus(1);
    const deTwo = renderStatus(2);

    expect(deReady).toContain("aria-label=\"Simulation starten\"");
    expect(deReady).toContain("aria-label=\"Einzelschritt\"");
    expect(deReady).toContain("aria-label=\"Simulation beenden\"");
    expect(deReady).toContain("Raster:");
    expect(deReady).toContain("Pixel:");
    expect(deReady).toContain("Bereit");
    expect(deOne).toContain("1 Baustein ausgewählt");
    expect(deTwo).toContain("2 Bausteine ausgewählt");
    expect(deReady).toContain("MCP (Lokal)");
    expect(deReady).toContain("Ursprung");
    expect(deReady).toContain("data-testid=\"statusbar-language-button\"");
    expect(deReady).toContain(">DE<");
    expect(deReady.indexOf("Ursprung")).toBeLessThan(deReady.indexOf("statusbar-language-button"));
    expect(deReady).toContain("data-component=\"LanguagePopover\"");
    expect(deReady).toContain("Automatisch (Browser:");
    expect(deReady).toContain("Deutsch");
    expect(deReady).toContain("English");

    await i18n.changeLanguage("en");
    const enReady = renderStatus(0, true);
    const enOne = renderStatus(1);
    const enTwo = renderStatus(2);

    expect(enReady).toContain("aria-label=\"Start simulation\"");
    expect(enReady).toContain("aria-label=\"Single step\"");
    expect(enReady).toContain("aria-label=\"Stop simulation\"");
    expect(enReady).toContain("Grid:");
    expect(enReady).toContain("Pixel:");
    expect(enReady).toContain("Ready");
    expect(enOne).toContain("1 component selected");
    expect(enTwo).toContain("2 components selected");
    expect(enReady).toContain("MCP (Local)");
    expect(enReady).toContain("Origin");
    expect(enReady).toContain("data-testid=\"statusbar-language-button\"");
    expect(enReady).toContain(">EN<");
    expect(enReady.indexOf("Origin")).toBeLessThan(enReady.indexOf("statusbar-language-button"));
    expect(enReady).toContain("data-component=\"LanguagePopover\"");
    expect(enReady).toContain("Automatic (Browser:");
    expect(enReady).toContain("English");
    expect(enReady).toContain("Deutsch");
  });

  it("lokalisiert McpRemotePopover inkl. Einzahl/Mehrzahl für verbundene Tabs", async () => {
    const renderPopover = (connectedTabCount: number) =>
      renderToStaticMarkup(
        <McpRemotePopover
          isOpen={true}
          status="remote-active-self"
          sessionId="abc-123"
          connectedTabCount={connectedTabCount}
          error={null}
          isSharedWorkerSupported={true}
          accessKey=""
          onAccessKeyChange={noop}
          onClearAccessKey={noop}
          onConnect={noop}
          onDisconnect={noop}
          onActivateThisTab={noop}
          onClose={noop}
        />,
      );

    await i18n.changeLanguage("de");
    const deOne = renderPopover(1);
    const deThree = renderPopover(3);
    expect(deOne).toContain("Aktiv (dieser Tab)");
    expect(deOne).toContain("1 Tab (SharedWorker)");
    expect(deThree).toContain("3 Tabs (SharedWorker)");
    expect(deOne).toContain("Nutze für Logic Circuit Anfragen folgende SessionID: abc-123");

    await i18n.changeLanguage("en");
    const enOne = renderPopover(1);
    const enThree = renderPopover(3);
    expect(enOne).toContain("Active (this tab)");
    expect(enOne).toContain("1 tab (SharedWorker)");
    expect(enThree).toContain("3 tabs (SharedWorker)");
    expect(enOne).toContain("Use the following SessionID for Logic Circuit requests: abc-123");
  });

  it("lokalisiert ComponentPalette inkl. Bitbreiten-Pluralisierung und Schaltungs-Button", async () => {
    const project = createEmptyCircuitProject();
    const renderPalette = () =>
      renderToStaticMarkup(
        <CircuitContextProvider initialProject={project}>
          <SimulationContextProvider>
            <ComponentPalette />
          </SimulationContextProvider>
        </CircuitContextProvider>,
      );

    await i18n.changeLanguage("de");
    const deHtml = renderPalette();
    expect(deHtml).toContain("Bausteine");
    expect(deHtml).toContain("+ Schaltung");
    expect(deHtml).toContain("Ein- &amp; Ausgänge");
    expect(deHtml).toContain("Taster / Schalter");
    expect(deHtml).toContain(">1 Bit<");
    expect(deHtml).toContain(">4 Bits<");

    await i18n.changeLanguage("en");
    const enHtml = renderPalette();
    expect(enHtml).toContain("Components");
    expect(enHtml).toContain("+ Circuit");
    expect(enHtml).toContain("Inputs &amp; Outputs");
    expect(enHtml).toContain("Button / Switch");
    expect(enHtml).toContain(">1 bit<");
    expect(enHtml).toContain(">4 bits<");
  });

  it("lokalisiert PropertyDialog für Gatter, Taster, Pin, Splitter, Sensor und Subschaltung", async () => {
    const circuit = createDefaultLogicalCircuit("main-id", "Main");
    const andSym = createCircuitSymbol(createGate("and", 2, false), circuit.logicalCircuitId, 2, 2);
    const btnSym = createCircuitSymbol(createCircuitButton("btn-1", "GO", false), circuit.logicalCircuitId, 4, 2);
    const pinDef = createPinCircuit("pin-1", circuit.logicalCircuitId, "input", "A", 1);
    const pinSym = createCircuitSymbol(pinDef.pinCircuit, circuit.logicalCircuitId, 6, 2);
    const splitterSym = createCircuitSymbol(createSplitter("spl-1", 8, 2, true), circuit.logicalCircuitId, 8, 2);
    const sensorSym = createCircuitSymbol(createSensor("sen-1", "series", 4, "right", "S1", "0:1"), circuit.logicalCircuitId, 10, 2);

    const renderProp = (el: React.ReactElement) => renderToStaticMarkup(el);

    await i18n.changeLanguage("de");
    const deGate = renderProp(<PropertyDialog isOpen={true} symbol={andSym} onClose={noop} />);
    const deBtn = renderProp(<PropertyDialog isOpen={true} symbol={btnSym} onClose={noop} />);
    const dePin = renderProp(<PropertyDialog isOpen={true} symbol={pinSym} onClose={noop} />);
    const deSplitter = renderProp(<PropertyDialog isOpen={true} symbol={splitterSym} onClose={noop} />);
    const deSensor = renderProp(<PropertyDialog isOpen={true} symbol={sensorSym} onClose={noop} />);
    const deCircuit = renderProp(<PropertyDialog isOpen={true} circuit={circuit} onClose={noop} />);

    expect(deGate).toContain("Eigenschaften: AND-Gatter");
    expect(deGate).toContain("Ausgang invertieren (NAND)");
    expect(deBtn).toContain("Eigenschaften: Taster / Schalter");
    expect(deBtn).toContain("Taster (Momentary)");
    expect(dePin).toContain("Pin-Richtung");
    expect(deSplitter).toContain("Bus verzweigen: Teilt einen 8-Bit-Bus in 2 Abzweige à 4 Bit auf.");
    expect(deSensor).toContain("Sensortyp / Modus");
    expect(deSensor).toContain("Tick:Wert-Sequenz (Hexadezimal)");
    expect(deCircuit).toContain("Schaltplan");
    expect(deCircuit).toContain("Pin Reihenfolge");

    await i18n.changeLanguage("en");
    const enGate = renderProp(<PropertyDialog isOpen={true} symbol={andSym} onClose={noop} />);
    const enBtn = renderProp(<PropertyDialog isOpen={true} symbol={btnSym} onClose={noop} />);
    const enPin = renderProp(<PropertyDialog isOpen={true} symbol={pinSym} onClose={noop} />);
    const enSplitter = renderProp(<PropertyDialog isOpen={true} symbol={splitterSym} onClose={noop} />);
    const enSensor = renderProp(<PropertyDialog isOpen={true} symbol={sensorSym} onClose={noop} />);
    const enCircuit = renderProp(<PropertyDialog isOpen={true} circuit={circuit} onClose={noop} />);

    expect(enGate).toContain("Properties: AND Gate");
    expect(enGate).toContain("Invert output (NAND)");
    expect(enBtn).toContain("Properties: Button / Switch");
    expect(enBtn).toContain("Push Button (Momentary)");
    expect(enPin).toContain("Pin direction");
    expect(enSplitter).toContain("Split bus: splits a 8-bit bus into 2 branches of 4 bits each.");
    expect(enSensor).toContain("Sensor type / Mode");
    expect(enSensor).toContain("Tick:Value sequence (Hexadecimal)");
    expect(enCircuit).toContain("Schematic");
    expect(enCircuit).toContain("Pin Order");
  });

  it("lokalisiert Projekt-, Export-, Hilfe-, Datenschutz-, Bestätigungs-, Fehler-, TextNotiz-, Kontextmenü- und Tree-Ansichten", async () => {
    const project = createEmptyCircuitProject("ModalsProj", "Main");
    const circuitId = project.project.logicalCircuitId;
    const note = createTextNote(circuitId, 2, 2, "Demo");
    const simErrorState: React.ContextType<typeof SimulationContext> = {
      ...DEFAULT_SIMULATION_STATE,
      simulationError: {
        title: "Sim Err",
        message: "Details",
        causeType: "userError",
        location: {
          circuitId,
          circuitName: "Main",
          symbolId: "sym-1",
          symbolName: "AND1",
          x: 2,
          y: 4,
        },
      },
    };

    const renderOverlays = () =>
      renderToStaticMarkup(
        <CircuitContextProvider initialProject={project}>
          <SimulationContext.Provider value={simErrorState}>
            <CanvasContextProvider>
              <ProjectDialog isOpen={true} onClose={noop} />
              <ExportImageDialog isOpen={true} onClose={noop} />
              <HelpDialog isOpen={true} onClose={noop} />
              <PrivacyDialog isOpen={true} onClose={noop} />
              <ConfirmDialog
                isOpen={true}
                title="Confirm Title"
                message="Confirm Message"
                onConfirm={noop}
                onCancel={noop}
              />
              <SimulationErrorDialog />
              <TextNoteModal isOpen={true} textNote={note} onSave={noop} onClose={noop} />
              <CanvasContextMenu
                target={{ kind: "canvas", gridPoint: { x: 1, y: 1 }, screenX: 10, screenY: 10 }}
                selectedCount={0}
                canPaste={false}
                hasCircuitElements={true}
                canRotateSelection={false}
                onClose={noop}
                onCut={noop}
                onCopy={noop}
                onCopyForDesktop={noop}
                onPasteAt={noop}
                onDeleteSelected={noop}
                onSelectAll={noop}
                onRotateRight={noop}
                onRotateLeft={noop}
                onOpenSubCircuit={noop}
                onEditSymbol={noop}
                onEditTextNote={noop}
                onEditCurrentCircuit={noop}
                onSelectConductor={noop}
                onSplitWire={noop}
              />
              <RunningCircuitTree />
            </CanvasContextProvider>
          </SimulationContext.Provider>
        </CircuitContextProvider>,
      );

    await i18n.changeLanguage("de");
    const deHtml = renderOverlays();
    expect(deHtml).toContain("Projekt-Einstellungen");
    expect(deHtml).toContain("Ziel-Taktfrequenz (Hz)");
    expect(deHtml).toContain("Startschaltung beim nächsten Öffnen");
    expect(deHtml).toContain("Schaltung als Bild exportieren");
    expect(deHtml).toContain("Hilfe &amp; Tastaturkürzel");
    expect(deHtml).toContain("Über Logic Circuit Web");
    expect(deHtml).toContain("Datenschutz (DSGVO / GDPR)");
    expect(deHtml).toContain("Bestätigen");
    expect(deHtml).toContain("Abbrechen");
    expect(deHtml).toContain("Betroffenes Bauteil:");
    expect(deHtml).toContain("Text-Notiz bearbeiten");
    expect(deHtml).toContain("Alles auswählen");
    expect(deHtml).toContain("Laufende Schaltung");
    expect(deHtml).toContain("Keine aktive Schaltungssimulation");
    expect(deHtml).toContain("Telemetrie &amp; Takt");
    expect(deHtml).toContain("Aktuelle Taktfrequenz:");
    expect(deHtml).toContain("Ziel-Taktfrequenz:");
    expect(deHtml).toContain("Schritte (Ticks):");

    await i18n.changeLanguage("en");
    const enHtml = renderOverlays();
    expect(enHtml).toContain("Project Settings");
    expect(enHtml).toContain("Target clock frequency (Hz)");
    expect(enHtml).toContain("Startup circuit on next open");
    expect(enHtml).toContain("Export Circuit as Image");
    expect(enHtml).toContain("Help &amp; Keyboard Shortcuts");
    expect(enHtml).toContain("About Logic Circuit Web");
    expect(enHtml).toContain("Privacy (GDPR)");
    expect(enHtml).toContain("Confirm");
    expect(enHtml).toContain("Cancel");
    expect(enHtml).toContain("Affected component:");
    expect(enHtml).toContain("Edit Text Note");
    expect(enHtml).toContain("Select All");
    expect(enHtml).toContain("Running Circuits");
    expect(enHtml).toContain("No active circuit simulation");
    expect(enHtml).toContain("Telemetry &amp; Clock");
    expect(enHtml).toContain("Actual clock rate:");
    expect(enHtml).toContain("Target clock rate:");
    expect(enHtml).toContain("Steps (Ticks):");
  });

  it("lokalisiert TelemetryFooter inkl. Taktfrequenz, Ziel-Dropdown und Tausendertrennzeichen live", async () => {
    const renderTelemetry = () => renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContextProvider>
          <CanvasContextProvider>
            <TelemetryFooter
              actualFrequency={2500}
              frameRateLimit={30}
              totalSteps={1234567}
              isRunning={true}
              isPaused={false}
              isOscillating={false}
            />
          </CanvasContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    await i18n.changeLanguage("de");
    const deHtml = renderTelemetry();
    expect(deHtml).toContain("Aktuelle Taktfrequenz:");
    expect(deHtml).toContain("2,5 kHz");
    expect(deHtml).toContain("Ziel-Taktfrequenz:");
    expect(deHtml).toContain("<option value=\"30\" selected=\"\">30 Hz</option>");
    expect(deHtml).toContain("Schritte (Ticks):");
    expect(deHtml).toContain("1.234.567");

    await i18n.changeLanguage("en");
    const enHtml = renderTelemetry();
    expect(enHtml).toContain("Actual clock rate:");
    expect(enHtml).toContain("2.5 kHz");
    expect(enHtml).toContain("Target clock rate:");
    expect(enHtml).toContain("<option value=\"30\" selected=\"\">30 Hz</option>");
    expect(enHtml).toContain("Steps (Ticks):");
    expect(enHtml).toContain("1,234,567");
  });

  it("lokalisiert Utility-Fehler, Compiler-Exceptions, Tooltips, Export-Hinweise & FilePicker in DE/EN inkl. Plural", async () => {
    const project = createEmptyCircuitProject("ErrProj", "Main");
    const mainCircuit = project.logicalCircuits[0];

    // Zweite Schaltung für Lösch-Schutz & Zyklusprüfung vorbereiten
    const subCircuit = createDefaultLogicalCircuit("sub-1", "HelperSub");
    const subIn = createPinCircuit("sub-pin-1", subCircuit.logicalCircuitId, "input", "IN", 1);
    const subInSym = createCircuitSymbol(subIn.pinCircuit, subCircuit.logicalCircuitId, 2, 2);
    subCircuit.circuitSymbols.push(subInSym);
    project.logicalCircuits.push(subCircuit);

    const subInstSym = createCircuitSymbol(subCircuit, mainCircuit.logicalCircuitId, 4, 4);
    mainCircuit.circuitSymbols.push(subInstSym);
    const refProject = syncProjectLogicalCircuits(project);

    // Splitter + Jam für Tooltip
    const splitter = createSplitter("spl-err", 8, 2, true);
    const splitterSym = createCircuitSymbol(splitter, mainCircuit.logicalCircuitId, 10, 10);
    const busJam = splitterSym.jams.find((j) => j.pin.name === "Bus")!;

    // Bitbreiten-Konflikt + Kurzschluss für validateCircuitWires
    const p1Def = createPinCircuit("p-1", mainCircuit.logicalCircuitId, "input", "P1", 1);
    const p4Def = createPinCircuit("p-4", mainCircuit.logicalCircuitId, "input", "P4", 4);
    const p1 = createCircuitSymbol(p1Def.pinCircuit, mainCircuit.logicalCircuitId, 2, 20);
    const p4 = createCircuitSymbol(p4Def.pinCircuit, mainCircuit.logicalCircuitId, 8, 20);
    const wConflict = createWire(mainCircuit.logicalCircuitId, p1.jams[0].absolutePoint, p4.jams[0].absolutePoint);
    const btnA = createCircuitSymbol(createCircuitButton("btn-a", "A", false), mainCircuit.logicalCircuitId, 2, 26);
    const btnB = createCircuitSymbol(createCircuitButton("btn-b", "B", false), mainCircuit.logicalCircuitId, 8, 26);
    const wShort = createWire(mainCircuit.logicalCircuitId, btnA.jams[0].absolutePoint, btnB.jams[0].absolutePoint);

    // Zirkuläre Einbettung für CircuitMap Konstruktor-Validierung
    const loopCircuit = createDefaultLogicalCircuit("loop-1", "LoopSub");
    const selfRefSym = createCircuitSymbol(loopCircuit, loopCircuit.logicalCircuitId, 4, 4);
    loopCircuit.circuitSymbols.push(selfRefSym);

    // Mehrfach-Treiber-Schaltung für Compiler-Fehlermeldung (2 Buttons auf denselben LED-Eingang)
    const driverProj = createEmptyCircuitProject("DriverProj", "Main");
    const driverMain = driverProj.logicalCircuits[0];
    const outA = createCircuitSymbol(createCircuitButton("oa", "BtnA", false), driverMain.logicalCircuitId, 2, 2);
    const outB = createCircuitSymbol(createCircuitButton("ob", "BtnB", false), driverMain.logicalCircuitId, 2, 6);
    const ledTarget = createCircuitSymbol(createGate("led", 1, false), driverMain.logicalCircuitId, 10, 2);
    driverMain.circuitSymbols.push(outA, outB, ledTarget);
    driverMain.wires.push(
      createWire(driverMain.logicalCircuitId, outA.jams[0].absolutePoint, ledTarget.jams[0].absolutePoint),
      createWire(driverMain.logicalCircuitId, outB.jams[0].absolutePoint, ledTarget.jams[0].absolutePoint),
    );

    // Desktop Export Compatibility mit Einzahl (1 Eingang) & Mehrzahl (3 Eingänge / 3 Farben)
    const compatProj = createEmptyCircuitProject("CompatTest", "Main");
    const compatMain = compatProj.logicalCircuits[0];
    const invalidLedGate: Gate = { ...createGate("led", 1, false), inputCount: 3 };
    const singleInputAndGate: Gate = { ...createGate("and", 2, false), inputCount: 1 };
    const triColorMatrix = createLedMatrix("mtx-3", 2, 2, "individual", "round", 3);
    compatMain.circuitSymbols.push(
      createCircuitSymbol(invalidLedGate, compatMain.logicalCircuitId, 2, 2),
      createCircuitSymbol(singleInputAndGate, compatMain.logicalCircuitId, 8, 2),
      createCircuitSymbol(triColorMatrix, compatMain.logicalCircuitId, 14, 2),
    );
    const syncedCompat = syncProjectLogicalCircuits(compatProj);

    const checkInLanguage = async (lang: "de" | "en") => {
      await i18n.changeLanguage(lang);

      const singleCircuitOnly = createEmptyCircuitProject("Single", "Main");
      const lastReason = getCircuitDeletionBlockReason(singleCircuitOnly, singleCircuitOnly.project.logicalCircuitId);
      const refReason = getCircuitDeletionBlockReason(refProject, "sub-1");
      const jamTip = formatJamTooltip(splitterSym, busJam);
      const cleanUnused = formatWireCleanUpTooltip({
        wireId: "w-unused",
        isUsed: false,
        usedBits: 0,
        bitWidth: 1,
        isPartiallyUsed: false,
      });
      const cleanSingle = formatWireCleanUpTooltip({
        wireId: "w-single",
        isUsed: true,
        usedBits: 1,
        bitWidth: 1,
        isPartiallyUsed: true,
      });
      const cleanPlural = formatWireCleanUpTooltip({
        wireId: "w-plural",
        isUsed: true,
        usedBits: 1,
        bitWidth: 4,
        isPartiallyUsed: true,
      });
      const validation = validateCircuitWires([p1, p4, btnA, btnB], [wConflict, wShort]);
      const conflictTip = validation.errorIndicators.find((ind) => ind.errorKind === "bitWidthMismatch")?.tooltip ?? "";
      const shortTip = validation.errorIndicators.find((ind) => ind.errorKind === "multipleOutputs")?.tooltip ?? "";

      let loopErrorMessage = "";
      try {
        new CircuitMap(loopCircuit);
      } catch (err) {
        loopErrorMessage = err instanceof Error ? err.message : "";
      }

      let driverErrorMessage = "";
      try {
        const driverMap = new CircuitMap(driverMain);
        driverMap.apply();
      } catch (err) {
        driverErrorMessage = err instanceof Error ? err.message : "";
      }

      const sensorPointErr = tryParseSensorPoint("invalid", 1);
      const sensorRandomErr = tryParseRandomRange("0:5");
      const exportReport = analyzeDesktopExportCompatibility(syncedCompat);
      const openFilters = getOpenProjectPickerTypes();
      const saveXmlFilters = getSaveDesktopXmlPickerTypes();

      return {
        lastReason,
        refReason,
        jamTip,
        cleanUnused,
        cleanSingle,
        cleanPlural,
        conflictTip,
        shortTip,
        loopErrorMessage,
        driverErrorMessage,
        sensorPointError: sensorPointErr.ok ? "" : sensorPointErr.error,
        sensorRandomError: sensorRandomErr.ok ? "" : sensorRandomErr.error,
        exportMessages: exportReport.warnings.map((w) => w.message).join("\n"),
        openFilterDesc: openFilters[0].description ?? "",
        saveXmlFilterDesc: saveXmlFilters[0].description ?? "",
      };
    };

    const de = await checkInLanguage("de");
    expect(de.lastReason).toBe("Mindestens eine Schaltung muss im Projekt verbleiben");
    expect(de.refReason).toContain("Schaltung wird noch in");
    expect(de.jamTip).toContain("Bits 0–7, 8 Bit");
    expect(de.cleanUnused).toBe("Ungenutzt (kein aktiver Signalpfad)");
    expect(de.cleanSingle).toBe("Teilweise genutzt: 1 von 1 Bit aktiv");
    expect(de.cleanPlural).toBe("Teilweise genutzt: 1 von 4 Bits aktiv");
    expect(de.conflictTip).toContain("Bitbreiten-Konflikt");
    expect(de.shortTip).toContain("Mehrfach-Ausgang (Kurzschluss)");
    expect(de.loopErrorMessage).toContain("Rekursive Schaltungsschleife erkannt");
    expect(de.driverErrorMessage).toContain("Mehrere Signalquellen auf demselben Eingang");
    expect(de.sensorPointError).toContain("Ungültiger Datenpunkt");
    expect(de.sensorRandomError).toContain("Minimaler Taktabstand");
    expect(de.exportMessages).toContain("mit 3 Eingängen");
    expect(de.exportMessages).toContain("mit 1 Eingang");
    expect(de.openFilterDesc).toContain("Logic Circuit Projekte");
    expect(de.saveXmlFilterDesc).toContain("LogicCircuit Desktop Projekt");

    const en = await checkInLanguage("en");
    expect(en.lastReason).toBe("At least one circuit must remain in the project");
    expect(en.refReason).toContain("Circuit is still used as a component in");
    expect(en.jamTip).toContain("Bits 0–7, 8 bits");
    expect(en.cleanUnused).toBe("Unused (no active signal path)");
    expect(en.cleanSingle).toBe("Partially used: 1 of 1 bit active");
    expect(en.cleanPlural).toBe("Partially used: 1 of 4 bits active");
    expect(en.conflictTip).toContain("Bit-width conflict");
    expect(en.shortTip).toContain("Multiple outputs (short circuit)");
    expect(en.loopErrorMessage).toContain("Recursive circuit loop detected");
    expect(en.driverErrorMessage).toContain("Multiple signal drivers connected to the same input");
    expect(en.sensorPointError).toContain("Invalid data point");
    expect(en.sensorRandomError).toContain("Minimum clock interval");
    expect(en.exportMessages).toContain("with 3 inputs");
    expect(en.exportMessages).toContain("with 1 input");
    expect(en.openFilterDesc).toContain("Logic Circuit Projects");
    expect(en.saveXmlFilterDesc).toContain("LogicCircuit Desktop Project");
  });

  it("behält beim Live-Sprachwechsel den aktuellen Projektzustand ohne Reload bei", () => {
    installMockLocalStorage();
    const project = createEmptyCircuitProject("StatePreserved", "Main");
    let capturedCtx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <ContextProbe onCircuit={(ctx) => { capturedCtx = ctx; }} />
      </CircuitContextProvider>,
    );

    const projectBeforeSwitch = capturedCtx.project;

    React.act(() => {
      capturedCtx.updateAppSettings({ language: "en" });
    });

    expect(i18n.language).toBe("en");
    expect(loadAppSettings().language).toBe("en");
    expect(capturedCtx.project).toBe(projectBeforeSwitch);
    expect(capturedCtx.project.project.name).toBe("StatePreserved");
  });
});
