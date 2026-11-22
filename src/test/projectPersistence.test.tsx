import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContext, { DEFAULT_SIMULATION_STATE } from "../contexts/simulationContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitButton from "../types/circuit/circuitButton";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";

import { addElements, createCircuitsTool, setCurrentCircuit } from "../mcp/mcpTools";
import {
  buildExportImageFilename,
  prepareCircuitSvgClone,
} from "../utils/circuitCapture";
import { createDemoCircuitProject, createEmptyCircuitProject } from "../utils/circuitLayout";
import { formatDocumentTitle } from "../utils/documentTitle";
import {
  loadCollapsedCategories,
  saveCollapsedCategories,
} from "../utils/paletteStorage";
import {
  clampXmlFrequency,
  resolveFrequencyFromProject,
  roundToNearestFrequencyStep,
} from "../utils/simulationSpeed";
import { parseNativeProject } from "../utils/storage/nativeProjectReader";
import { serializeNativeProject } from "../utils/storage/nativeProjectWriter";
import { importProjectFromXml } from "../utils/xml/logicCircuitXmlReader";
import { serializeCircuitProjectToXml } from "../utils/xml/logicCircuitXmlWriter";

import AppHeader from "../components/app/appHeader";
import ConfirmDialog from "../components/app/confirmDialog";
import ExportImageDialog from "../components/app/exportImageDialog";
import ProjectDialog from "../components/app/projectDialog";
import RunningCircuitTree from "../components/runningCircuitTree";

const ContextProbe: React.FC<{
  onCircuit?: (ctx: React.ContextType<typeof CircuitContext>) => void;
  onSim?: (ctx: React.ContextType<typeof SimulationContext>) => void;
}> = ({ onCircuit, onSim }) => {
  const circuitCtx = React.useContext(CircuitContext);
  const simCtx = React.useContext(SimulationContext);
  onCircuit?.(circuitCtx);
  onSim?.(simCtx);
  return null;
};

const noop = () => undefined;

describe("T-041: Projekt-Einstellungen, FPS-Stufen, UI-Persistenz und Bildexport", () => {
  const originalWindow = (globalThis as { window?: Window & typeof globalThis }).window;
  const originalDocument = (globalThis as { document?: Document }).document;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window & typeof globalThis }).window;
    } else {
      (globalThis as { window?: Window & typeof globalThis }).window = originalWindow;
    }

    if (originalDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      (globalThis as { document?: Document }).document = originalDocument;
    }
  });

  it("rundet importierte Frequenz-Werte auf gültige Stufen (inkl. 50 -> 60) und begrenzt XML-Export auf 1..50", () => {
    expect(roundToNearestFrequencyStep(1)).toBe(1);
    expect(roundToNearestFrequencyStep(2)).toBe(2);
    expect(roundToNearestFrequencyStep(3)).toBe(2);
    expect(roundToNearestFrequencyStep(4)).toBe(5);
    expect(roundToNearestFrequencyStep(5)).toBe(5);
    expect(roundToNearestFrequencyStep(10)).toBe(10);
    expect(roundToNearestFrequencyStep(23)).toBe(20);
    expect(roundToNearestFrequencyStep(25)).toBe(30);
    expect(roundToNearestFrequencyStep(50)).toBe(60);
    expect(roundToNearestFrequencyStep(60)).toBe(60);
    expect(roundToNearestFrequencyStep(0)).toBe(1);
    expect(roundToNearestFrequencyStep(Number.NaN)).toBe(10);

    expect(clampXmlFrequency(1)).toBe(1);
    expect(clampXmlFrequency(30)).toBe(30);
    expect(clampXmlFrequency(50)).toBe(50);
    expect(clampXmlFrequency(60)).toBe(50);
    expect(clampXmlFrequency(0)).toBe(1);

    expect(resolveFrequencyFromProject(50, false)).toBe(60);
    expect(resolveFrequencyFromProject(2, false)).toBe(2);
    expect(resolveFrequencyFromProject(10, true)).toBe("max");

    const project = createEmptyCircuitProject("FPS-Test");
    project.project.frequency = 60;
    const xml = serializeCircuitProjectToXml(project);
    expect(xml).toContain("Frequency=\"50\"");
    const parsed = importProjectFromXml(xml);
    expect(parsed.project.frequency).toBe(50);
  });

  it("bietet Hz-Stufen 1, 2, 5, 10, 20, 30, 60 und Max in TelemetryFooter und SimulationContext an", () => {
    const project = createEmptyCircuitProject();
    let simCtx!: React.ContextType<typeof SimulationContext>;

    const treeHtml = renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project}>
          <SimulationContext.Provider value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true }}>
            <RunningCircuitTree />
          </SimulationContext.Provider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={project}>
          <SimulationContextProvider>
            <ContextProbe onSim={(s) => { simCtx = s; }} />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    expect(treeHtml).toContain("value=\"1\"");
    expect(treeHtml).toContain("1 Hz");
    expect(treeHtml).toContain("value=\"2\"");
    expect(treeHtml).toContain("2 Hz");
    expect(treeHtml).toContain("value=\"5\"");
    expect(treeHtml).toContain("5 Hz");
    expect(treeHtml).toContain("value=\"60\"");
    expect(treeHtml).toContain("value=\"max\"");

    simCtx.setFrameRateLimit(1);
    expect(simCtx.frameRateLimit).toBe(1);
    simCtx.setFrameRateLimit(2);
    expect(simCtx.frameRateLimit).toBe(2);
    simCtx.setFrameRateLimit(5);
    expect(simCtx.frameRateLimit).toBe(5);
  });

  it("aktualisiert Projekt-Metadaten ohne Undo-Eintrag, pflegt Startschaltung beim Wechsel und trackt Dirty-State", () => {
    const demo = createDemoCircuitProject();
    let circuitCtx!: React.ContextType<typeof CircuitContext>;

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <ContextProbe onCircuit={(c) => { circuitCtx = c; }} />
      </CircuitContextProvider>,
    );

    expect(circuitCtx.hasUnsavedChanges).toBe(false);
    expect(circuitCtx.canUndo).toBe(false);

    React.act(() => {
      circuitCtx.updateProjectProperties({
        name: "Mein Digitalprojekt",
        note: "Geänderte Beschreibung",
        frequency: 5,
        isMaximumSpeed: false,
      });
    });

    expect(circuitCtx.project.project.name).toBe("Mein Digitalprojekt");
    expect(circuitCtx.project.project.note).toBe("Geänderte Beschreibung");
    expect(circuitCtx.project.project.frequency).toBe(5);
    expect(circuitCtx.canUndo).toBe(false);
    expect(circuitCtx.history.entries).toHaveLength(0);
    expect(circuitCtx.hasUnsavedChanges).toBe(true);

    React.act(() => {
      circuitCtx.markProjectSaved();
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    // Startschaltung wird beim Schaltungswechsel mitgeführt und über XML-Roundtrip wiederhergestellt
    React.act(() => {
      circuitCtx.setCurrentCircuitId("sub-power");
    });
    expect(circuitCtx.currentCircuitId).toBe("sub-power");
    expect(circuitCtx.project.project.logicalCircuitId).toBe("sub-power");
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    // Natives Format behält IDs 1:1; Desktop-XML bildet sprechende ID auf deterministische GUID der Power-Schaltung ab
    const savedNative = serializeNativeProject(circuitCtx.project);
    const reloadedNative = parseNativeProject(savedNative);
    expect(reloadedNative.project.logicalCircuitId).toBe("sub-power");

    const savedXml = serializeCircuitProjectToXml(circuitCtx.project);
    const reloaded = importProjectFromXml(savedXml);
    const reloadedStart = reloaded.logicalCircuits.find(
      (lc) => lc.logicalCircuitId === reloaded.project.logicalCircuitId,
    );
    expect(reloadedStart?.name).toBe("Power");

    // Schaltungsbearbeitung setzt hasUnsavedChanges; markProjectSaved leert Undo/Redo-Historie über alle Schaltungen
    React.act(() => {
      circuitCtx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 10, y: 10 });
      circuitCtx.setCurrentCircuitId("main-circuit");
      circuitCtx.addSymbol({ type: "or", inputCount: 2, name: "OR" }, { x: 20, y: 20 });
    });
    expect(circuitCtx.canUndo).toBe(true);
    expect(circuitCtx.hasUnsavedChanges).toBe(true);

    React.act(() => {
      circuitCtx.markProjectSaved();
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(false);
    expect(circuitCtx.canUndo).toBe(false);
    expect(circuitCtx.history.entries).toHaveLength(0);

    React.act(() => {
      circuitCtx.setCurrentCircuitId("sub-power");
    });
    expect(circuitCtx.canUndo).toBe(false);
    expect(circuitCtx.history.entries).toHaveLength(0);

    React.act(() => {
      circuitCtx.addSymbol({ type: "not", inputCount: 1, name: "NOT" }, { x: 30, y: 30 });
    });
    expect(circuitCtx.canUndo).toBe(true);
    expect(circuitCtx.hasUnsavedChanges).toBe(true);

    React.act(() => {
      circuitCtx.loadProject(reloaded);
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(false);
  });

  it("hält frisch geöffnete Projekte, Schaltungswechsel und laufende Simulation sauber (nicht Dirty)", async () => {
    const initial = createEmptyCircuitProject("Sim-Dirty-Test", "Main");
    let circuitCtx!: React.ContextType<typeof CircuitContext>;
    let simCtx!: React.ContextType<typeof SimulationContext>;

    renderToStaticMarkup(
      <CanvasContextProvider>
        <CircuitContextProvider initialProject={initial}>
          <SimulationContextProvider>
            <ContextProbe
              onCircuit={(c) => { circuitCtx = c; }}
              onSim={(s) => { simCtx = s; }}
            />
          </SimulationContextProvider>
        </CircuitContextProvider>
      </CanvasContextProvider>,
    );

    const buildSnapshot = (): McpCircuitSnapshot => ({
      project: circuitCtx.project,
      currentCircuit: circuitCtx.currentCircuit,
      selectedSymbolIds: [],
      selectedTextNoteIds: [],
      selectedWireIds: [],
      isSimulating: simCtx.isSimulating,
      actions: {
        addEntities: circuitCtx.addEntities,
        moveEntities: circuitCtx.moveEntities,
        rotateSymbols: circuitCtx.rotateSymbols,
        removeEntities: circuitCtx.removeEntities,
        setCurrentCircuitId: circuitCtx.setCurrentCircuitId,
        updateCircuitProperties: circuitCtx.updateCircuitProperties,
        updateCircuitSymbolProperties: circuitCtx.updateCircuitSymbolProperties,
        resizeCircuitSymbol: circuitCtx.resizeCircuitSymbol,
        updateTextNote: circuitCtx.updateTextNote,
        createCircuits: circuitCtx.createCircuits,
        deleteCircuits: circuitCtx.deleteCircuits,
        getCurrentCircuit: () => circuitCtx.currentCircuit,
        getProject: () => circuitCtx.project,
      },
    });

    // Simulierte Schaltung mit Taster, Sub-Schaltung und LED aufbauen und exportieren
    const mainId = circuitCtx.currentCircuit.logicalCircuitId;
    let subId = "";
    React.act(() => {
      const created = createCircuitsTool(buildSnapshot(), { circuits: [{ name: "Inverter" }] });
      subId = created.circuits[0].logicalCircuitId;
      setCurrentCircuit(buildSnapshot(), { circuitId: subId });
      addElements(buildSnapshot(), {
        components: [
          { ref: "in", type: "pinIn", name: "A", notation: "A", x: 2, y: 4 },
          { ref: "inv", type: "not", x: 8, y: 4 },
          { ref: "out", type: "pinOut", name: "Y", notation: "Y", x: 14, y: 4 },
        ],
        wires: [
          { from: { ref: "in", pinName: "A" }, to: { ref: "inv", pinName: "In" } },
          { from: { ref: "inv", pinName: "Out" }, to: { ref: "out", pinName: "Y" } },
        ],
      });

      setCurrentCircuit(buildSnapshot(), { circuitId: mainId });
      addElements(buildSnapshot(), {
        components: [
          { ref: "btn", type: "button", isToggle: true, notation: "T", x: 2, y: 4 },
          { ref: "sub", type: "subCircuit", subCircuitId: subId, x: 8, y: 4 },
          { ref: "led", type: "led", x: 16, y: 5 },
        ],
        wires: [
          { from: { ref: "btn", pinName: "Out" }, to: { ref: "sub", pinName: "A" } },
          { from: { ref: "sub", pinName: "Y" }, to: { ref: "led", pinName: "In" } },
        ],
      });
    });

    expect(circuitCtx.hasUnsavedChanges).toBe(true);

    const nativeJson = serializeNativeProject(circuitCtx.project);
    const desktopXml = serializeCircuitProjectToXml(circuitCtx.project);

    // Import einer nativen .lcweb-Datei über importProjectFromText darf nicht als Dirty starten
    React.act(() => {
      circuitCtx.importProjectFromText(nativeJson, { fileName: "sim-test.lcweb" });
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(false);
    expect(circuitCtx.canUndo).toBe(false);
    expect(circuitCtx.history.entries).toHaveLength(0);
    expect(circuitCtx.activeFileName).toBe("sim-test.lcweb");

    // Reines Umschalten der aktiven Schaltung darf Projekt nicht Dirty markieren
    React.act(() => {
      circuitCtx.setCurrentCircuitId(subId);
    });
    expect(circuitCtx.project.project.logicalCircuitId).toBe(subId);
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    React.act(() => {
      circuitCtx.setCurrentCircuitId(mainId);
    });
    expect(circuitCtx.project.project.logicalCircuitId).toBe(mainId);
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    const importedSubSym = circuitCtx.currentCircuit.circuitSymbols.find(
      (s) => s.circuit.kind === "logicalCircuit",
    );
    expect(importedSubSym).toBeDefined();
    const importedBtnSym = circuitCtx.currentCircuit.circuitSymbols.find(
      (s) => s.circuit.kind === "circuitButton",
    );
    expect(importedBtnSym).toBeDefined();
    const btnCircuit = importedBtnSym!.circuit as CircuitButton;
    const buttonId = btnCircuit.circuitButtonId ?? btnCircuit.circuitId;

    // Simulation starten, schalten, Sub-Schaltung öffnen, pausieren und stoppen hält hasUnsavedChanges false
    await simCtx.startSimulation(circuitCtx.currentCircuit);
    expect(simCtx.isSimulating).toBe(true);
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    const stepResult = await simCtx.step(2);
    expect(stepResult).not.toBeNull();
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    await simCtx.toggleButton(buttonId);
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    const childMap = simCtx.rootCircuitMap?.children.get(importedSubSym!.circuitSymbolId);
    expect(childMap).toBeDefined();
    React.act(() => {
      simCtx.selectCircuitMap(childMap!);
    });
    expect(circuitCtx.currentCircuitId).toBe(subId);
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    simCtx.pauseSimulation();
    expect(simCtx.isPaused).toBe(true);
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    await simCtx.stopSimulation();
    expect(simCtx.isSimulating).toBe(false);
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    // Schaltungswechsel nach Simulationsende bleibt sauber
    React.act(() => {
      circuitCtx.setCurrentCircuitId(mainId);
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    // Bearbeitung setzt hasUnsavedChanges und wird durch Speichern/Import/Reset wieder zurückgesetzt
    React.act(() => {
      circuitCtx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 24, y: 4 });
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(true);

    // Schaltungswechsel erhält bestehenden Dirty-Status bei ungespeicherten Änderungen
    React.act(() => {
      circuitCtx.setCurrentCircuitId(subId);
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(true);

    // Import einer .CircuitProject XML-Datei löscht alten Dirty-Status und löst Handle
    React.act(() => {
      circuitCtx.importProjectFromText(desktopXml, { fileName: "Altprojekt.CircuitProject" });
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(false);
    expect(circuitCtx.activeFileHandle).toBeNull();
    expect(circuitCtx.activeFileName).toBe("Altprojekt.lcweb");

    React.act(() => {
      circuitCtx.addSymbol({ type: "or", inputCount: 2, name: "OR" }, { x: 24, y: 10 });
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(true);

    React.act(() => {
      circuitCtx.resetToDemoProject();
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    React.act(() => {
      circuitCtx.addSymbol({ type: "xor", inputCount: 2, name: "XOR" }, { x: 24, y: 16 });
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(true);

    React.act(() => {
      circuitCtx.resetToEmptyProject();
    });
    expect(circuitCtx.hasUnsavedChanges).toBe(false);

    // AppHeader rendert bei frisch geladenem nicht-leerem Projekt ohne geöffneten Bestätigungsdialog
    const headerHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={createDemoCircuitProject()}>
        <SimulationContextProvider>
          <AppHeader />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(headerHtml).not.toContain("data-component=\"ConfirmDialog\"");
    expect(headerHtml).toContain("Projekt öffnen (.lcweb / .CircuitProject)");

    // ConfirmDialog nutzt präzisen Verwerfen-Hinweis nur für ungespeicherte Änderungen
    const confirmHtml = renderToStaticMarkup(
      <ConfirmDialog
        isOpen={true}
        title="Projekt öffnen"
        message="Das aktuelle Projekt enthält ungespeicherte Änderungen. Möchten Sie diese verwerfen und fortfahren?"
        confirmLabel="Verwerfen & fortfahren"
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(confirmHtml).toContain("data-component=\"ConfirmDialog\"");
    expect(confirmHtml).toContain("Das aktuelle Projekt enthält ungespeicherte Änderungen.");
  });

  it("persistiert den Collapsed-Status der Paletten-Kategorien als Dictionary im localStorage", () => {
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

    expect(loadCollapsedCategories()).toEqual({});

    saveCollapsedCategories({
      Grundformen: true,
      Dekoration: false,
      Helpers: true,
    });

    expect(loadCollapsedCategories()).toEqual({
      Grundformen: true,
      Dekoration: false,
      Helpers: true,
    });

    // Fehlerhaftes JSON darf nicht werfen
    store.set("logicCircuit.palette.collapsedCategories", "{ungueltig");
    expect(loadCollapsedCategories()).toEqual({});
  });

  it("rendert ProjectDialog und ExportImageDialog (inkl. Hinweis bei laufender Simulation) korrekt", () => {
    const demo = createDemoCircuitProject();

    const projectDialogHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContextProvider>
          <ProjectDialog isOpen={true} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(projectDialogHtml).toContain("data-component=\"ProjectDialog\"");
    expect(projectDialogHtml).toContain("Projekt-Einstellungen");
    expect(projectDialogHtml).toContain("1 Hz");
    expect(projectDialogHtml).toContain("2 Hz");
    expect(projectDialogHtml).toContain("5 Hz");
    expect(projectDialogHtml).toContain("60 Hz");
    expect(projectDialogHtml).toContain("startup-circuit-info");
    expect(projectDialogHtml).toContain("Haupt-Schaltung");

    const exportDialogHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContextProvider>
          <ExportImageDialog isOpen={true} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(exportDialogHtml).toContain("data-component=\"ExportImageDialog\"");
    expect(exportDialogHtml).toContain("PNG (1:1)");
    expect(exportDialogHtml).toContain("SVG");
    expect(exportDialogHtml).toContain("Gesamte Schaltung");
    expect(exportDialogHtml).toContain("Aktueller Sichtbereich");
    expect(exportDialogHtml).toContain("Transparent");
    expect(exportDialogHtml).toContain("Ohne Hintergrundfläche und ohne Raster-Dots");

    const liveExportHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContext.Provider value={{ ...DEFAULT_SIMULATION_STATE, isSimulating: true, isRunning: true }}>
          <ExportImageDialog isOpen={true} onClose={noop} />
        </SimulationContext.Provider>
      </CircuitContextProvider>,
    );
    expect(liveExportHtml).toContain("export-simulation-notice");
    expect(liveExportHtml).toContain("Live-Export aktiv");
  });

  it("entfernt beim transparenten Bildexport Hintergrundfläche und CanvasGrid-Dots und erzeugt saubere Dateinamen", () => {
    expect(buildExportImageFilename("4-Bit Addierer!", "png")).toBe("4-Bit_Addierer!.png");
    expect(buildExportImageFilename("Schaltung: A/B", "svg")).toBe("Schaltung-_A-B.svg");
    expect(buildExportImageFilename("", "svg")).toBe("schaltung.svg");

    type MockNode = {
      tagName: string;
      textContent: string | null;
      attributes: Map<string, string>;
      children: MockNode[];
      firstChild: MockNode | null;
      removed: boolean;
      setAttribute: (k: string, v: string) => void;
      getAttribute: (k: string) => string | null;
      removeAttribute: (k: string) => void;
      remove: () => void;
      insertBefore: (node: MockNode, refNode: MockNode | null) => void;
      querySelector: (selector: string) => MockNode | null;
      querySelectorAll: (selector: string) => MockNode[];
      cloneNode: (deep?: boolean) => MockNode;
    };

    const createMockNode = (tagName: string, attrs: Record<string, string> = {}): MockNode => {
      const node: MockNode = {
        tagName,
        textContent: "",
        attributes: new Map(Object.entries(attrs)),
        children: [],
        get firstChild() {
          return this.children[0] ?? null;
        },
        removed: false,
        setAttribute(k, v) {
          this.attributes.set(k, v);
        },
        getAttribute(k) {
          return this.attributes.get(k) ?? null;
        },
        removeAttribute(k) {
          this.attributes.delete(k);
        },
        remove() {
          this.removed = true;
        },
        insertBefore(newChild, refNode) {
          const idx = refNode ? this.children.indexOf(refNode) : -1;
          if (idx >= 0) {
            this.children.splice(idx, 0, newChild);
          } else {
            this.children.push(newChild);
          }
        },
        querySelector(selector) {
          return this.querySelectorAll(selector)[0] ?? null;
        },
        querySelectorAll(selector) {
          if (selector === "[data-component=\"CanvasGrid\"]") {
            return this.children.filter(
              (c) => !c.removed && c.attributes.get("data-component") === "CanvasGrid",
            );
          }
          if (selector === "[data-component=\"SelectionBox\"]") {
            return this.children.filter(
              (c) => !c.removed && c.attributes.get("data-component") === "SelectionBox",
            );
          }
          return [];
        },
        cloneNode() {
          const copy = createMockNode(this.tagName, Object.fromEntries(this.attributes.entries()));
          copy.children = this.children.map((c) => c.cloneNode(true));
          return copy;
        },
      };
      return node;
    };

    (globalThis as { document?: Document }).document = {
      createElementNS: (_ns: string, tagName: string) => createMockNode(tagName),
    } as unknown as Document;

    const svgMock = createMockNode("svg", { viewBox: "0 0 800 600" });
    const gridMock = createMockNode("g", { "data-component": "CanvasGrid" });
    const selectionMock = createMockNode("g", { "data-component": "SelectionBox" });
    const contentMock = createMockNode("g", { "data-role": "symbols" });
    svgMock.children.push(gridMock, selectionMock, contentMock);

    const { clone: darkClone } = prepareCircuitSvgClone(
      svgMock as unknown as SVGSVGElement,
      { mode: "viewport", transparentBackground: false },
      { width: 800, height: 600 },
    );
    const darkMock = darkClone as unknown as MockNode;
    expect(darkMock.children.some((c) => c.tagName === "rect" && c.getAttribute("fill") === "var(--color-grid-canvas)")).toBe(true);
    expect(darkMock.querySelector("[data-component=\"CanvasGrid\"]")).not.toBeNull();
    expect(darkMock.querySelector("[data-component=\"SelectionBox\"]")).toBeNull();

    const { clone: transparentClone } = prepareCircuitSvgClone(
      svgMock as unknown as SVGSVGElement,
      { mode: "viewport", transparentBackground: true },
      { width: 800, height: 600 },
    );
    const transparentMock = transparentClone as unknown as MockNode;
    expect(transparentMock.children.some((c) => c.tagName === "rect")).toBe(false);
    expect(transparentMock.querySelector("[data-component=\"CanvasGrid\"]")).toBeNull();
    expect(transparentMock.querySelector("[data-component=\"SelectionBox\"]")).toBeNull();
  });

  it("setzt den HTML-Title ohne Bindestrich und formatiert Dateiname sowie Dirty-Punkt konsistent", () => {
    const indexHtml = readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    expect(indexHtml).toContain("<title>Logic Circuit Web</title>");
    expect(indexHtml).not.toContain("Logic Circuit - Web");

    expect(formatDocumentTitle(null, false)).toBe("Logic Circuit Web");
    expect(formatDocumentTitle("   ", false)).toBe("Logic Circuit Web");
    expect(formatDocumentTitle(null, true)).toBe("● Logic Circuit Web");
    expect(formatDocumentTitle("Counter.lcweb", false)).toBe("Counter.lcweb – Logic Circuit Web");
    expect(formatDocumentTitle("Counter.lcweb", true)).toBe("● Counter.lcweb – Logic Circuit Web");

    const initial = createEmptyCircuitProject("TitleTest", "Main");
    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider initialProject={initial}>
        <ContextProbe onCircuit={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    expect(ctx.activeFileName).toBeNull();
    expect(ctx.hasUnsavedChanges).toBe(false);
    expect(formatDocumentTitle(ctx.activeFileName, ctx.hasUnsavedChanges)).toBe("Logic Circuit Web");

    // Laden einer Datei setzt aktiven Dateinamen ohne Dirty-Punkt; Bearbeitung setzt Dirty-Punkt
    const jsonText = serializeNativeProject(ctx.project);
    React.act(() => {
      ctx.importProjectFromText(jsonText, { fileName: "Adder.lcweb" });
    });
    expect(ctx.activeFileName).toBe("Adder.lcweb");
    expect(ctx.hasUnsavedChanges).toBe(false);
    expect(formatDocumentTitle(ctx.activeFileName, ctx.hasUnsavedChanges)).toBe("Adder.lcweb – Logic Circuit Web");

    React.act(() => {
      ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 4, y: 4 });
    });
    expect(ctx.hasUnsavedChanges).toBe(true);
    expect(formatDocumentTitle(ctx.activeFileName, ctx.hasUnsavedChanges)).toBe("● Adder.lcweb – Logic Circuit Web");

    React.act(() => {
      ctx.markProjectSaved();
    });
    expect(ctx.hasUnsavedChanges).toBe(false);
    expect(formatDocumentTitle(ctx.activeFileName, ctx.hasUnsavedChanges)).toBe("Adder.lcweb – Logic Circuit Web");

    // Neues Projekt und Demo-Projekt setzen Dateinamen und Dirty-Punkt zurück
    React.act(() => {
      ctx.resetToEmptyProject();
    });
    expect(ctx.activeFileName).toBeNull();
    expect(ctx.hasUnsavedChanges).toBe(false);
    expect(formatDocumentTitle(ctx.activeFileName, ctx.hasUnsavedChanges)).toBe("Logic Circuit Web");

    React.act(() => {
      ctx.addSymbol({ type: "or", inputCount: 2, name: "OR" }, { x: 6, y: 6 });
    });
    expect(ctx.hasUnsavedChanges).toBe(true);
    expect(formatDocumentTitle(ctx.activeFileName, ctx.hasUnsavedChanges)).toBe("● Logic Circuit Web");

    React.act(() => {
      ctx.resetToDemoProject();
    });
    expect(ctx.activeFileName).toBeNull();
    expect(ctx.hasUnsavedChanges).toBe(false);
    expect(formatDocumentTitle(ctx.activeFileName, ctx.hasUnsavedChanges)).toBe("Logic Circuit Web");
  });
});
