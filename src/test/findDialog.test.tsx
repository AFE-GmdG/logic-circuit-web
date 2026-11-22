import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContext from "../contexts/canvasContext";
import CanvasContextProvider from "../contexts/canvasContext/provider";

import i18n from "../i18n";
import {
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  instantiateCircuitFromPalette,
} from "../utils/circuitLayout";
import {
  DEFAULT_FIND_PREFERENCES,
  FIND_PREFERENCES_STORAGE_KEY,
  loadFindPreferences,
  MAX_RECENT_FIND_QUERIES,
  pushRecentFindQuery,
  removeRecentFindQuery,
  saveFindPreferences,
} from "../utils/findPreferencesStorage";
import {
  getProbeDisplayName,
  hasCustomProbeName,
  searchProject,
  splitHighlightSegments,
} from "../utils/projectSearch";

import HelpDialog from "../components/app/helpDialog";
import MainMenu from "../components/app/mainMenu";
import FindBar from "../components/circuitCanvas/findBar";

const noop = () => undefined;

const CanvasProbe: React.FC<{
  onContext: (ctx: React.ContextType<typeof CanvasContext>) => void;
}> = ({ onContext }) => {
  const ctx = React.useContext(CanvasContext);
  onContext(ctx);
  return null;
};

describe("T-048 / US-015: Projekt-Suche, VS-Code-FindBar, LRU-Historie & Preferences", () => {
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

  it("indiziert Schaltungen, Sub-Schaltungen, Pins (inkl. jamNotation), Textnotizen und 27 durchnummerierte AND-Gatter", () => {
    const project = createEmptyCircuitProject("SearchProj", "Main");
    const mainCircuit = project.logicalCircuits[0];

    const subCircuit = createDefaultLogicalCircuit("sub-alu", "ALU Core", "Arithmetik");
    subCircuit.notation = "ALU8";
    subCircuit.note = "Rechenwerk Beschreibung Spezialhinweis";
    project.logicalCircuits.push(subCircuit);
    project.circuits.set(subCircuit.circuitId, subCircuit);

    // Sub-Circuit-Instanz in Main
    const subSymbol = createCircuitSymbol(subCircuit, mainCircuit.logicalCircuitId, 20, 10);
    mainCircuit.circuitSymbols.push(subSymbol);
    project.circuitSymbols.push(subSymbol);

    // 27 AND-Gatter in Main platzieren -> AND1 .. AND27
    let twentySeventhAndId = "";
    for (let i = 0; i < 27; i++) {
      const { circuitSymbol } = instantiateCircuitFromPalette(
        project,
        mainCircuit.logicalCircuitId,
        { type: "and", name: "AND", inputCount: 2 },
        { x: 4 + (i % 9) * 4, y: 4 + Math.floor(i / 9) * 5 },
      );
      if (i === 26) {
        twentySeventhAndId = circuitSymbol.circuitSymbolId;
      }
      mainCircuit.circuitSymbols.push(circuitSymbol);
      project.circuitSymbols.push(circuitSymbol);
    }

    // Eingangs-Pin mit jamNotation und Ausgangs-Pin in subCircuit
    const pinInInst = instantiateCircuitFromPalette(
      project,
      subCircuit.logicalCircuitId,
      { type: "pinIn", name: "Pin", notation: "ClockInput", jamNotation: "CLK" },
      { x: 2, y: 4 },
    );
    subCircuit.circuitSymbols.push(pinInInst.circuitSymbol);
    project.circuitSymbols.push(pinInInst.circuitSymbol);

    const pinOutInst = instantiateCircuitFromPalette(
      project,
      subCircuit.logicalCircuitId,
      { type: "pinOut", name: "Pin", notation: "DataBus", jamNotation: "Q0" },
      { x: 14, y: 4 },
    );
    subCircuit.circuitSymbols.push(pinOutInst.circuitSymbol);
    project.circuitSymbols.push(pinOutInst.circuitSymbol);

    // Textnotiz (mehrzeilig) in Main
    const noteInst = instantiateCircuitFromPalette(
      project,
      mainCircuit.logicalCircuitId,
      { type: "textNote", name: "Note", note: "Kopfzeile\nTakt-Zähler prüfen" },
      { x: 30, y: 20 },
    );
    expect(noteInst).toBeDefined();
    mainCircuit.textNotes.push({
      textNoteId: "note-1",
      logicalCircuitId: mainCircuit.logicalCircuitId,
      x: 30,
      y: 20,
      width: 6,
      height: 3,
      rotation: "up",
      note: "Kopfzeile\nTakt-Zähler prüfen",
    });

    // Suche nach "AND27" findet exakt das 27. AND-Gatter mit berechneter Bauteilmitte
    const and27Hits = searchProject(project, "and27", {
      scope: "project",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: false,
      wholeWord: false,
      includeNotes: false,
    });
    expect(and27Hits).toHaveLength(1);
    expect(and27Hits[0].symbolId).toBe(twentySeventhAndId);
    expect(and27Hits[0].label).toBe("AND27");
    expect(and27Hits[0].gridPoint).toEqual({ x: 36, y: 14 });
    expect(and27Hits[0].focusPoint).toEqual({ x: 37.5, y: 16 });

    // Exaktes Ranking für "AND2" im Substring-Modus vs. exakt ein Treffer im WholeWord-Modus
    const and2Substring = searchProject(project, "AND2", {
      scope: "current",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: false,
      wholeWord: false,
      includeNotes: false,
    });
    expect(and2Substring[0].label).toBe("AND2");
    expect(and2Substring.length).toBeGreaterThan(2);

    const and2WholeWord = searchProject(project, "AND2", {
      scope: "current",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: false,
      wholeWord: true,
      includeNotes: false,
    });
    expect(and2WholeWord).toHaveLength(1);
    expect(and2WholeWord[0].label).toBe("AND2");

    // Pin über jamNotation im gesamten Projekt finden
    const clkHits = searchProject(project, "clk", {
      scope: "project",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: false,
      wholeWord: true,
      includeNotes: false,
    });
    expect(clkHits).toHaveLength(1);
    expect(clkHits[0].itemKind).toBe("pinIn");
    expect(clkHits[0].circuitId).toBe(subCircuit.logicalCircuitId);
    expect(clkHits[0].secondaryLabel).toBe("CLK");

    // Im "current"-Scope bleibt Pin aus subCircuit außen vor und Main wird nicht als eigener Circuit-Eintrag gelistet
    const clkCurrentScope = searchProject(project, "clk", {
      scope: "current",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: false,
      wholeWord: true,
      includeNotes: false,
    });
    expect(clkCurrentScope).toHaveLength(0);

    const mainCurrentScope = searchProject(project, "Main", {
      scope: "current",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: false,
      wholeWord: false,
      includeNotes: false,
    });
    expect(mainCurrentScope).toHaveLength(0);

    // Sichtbare Textnotiz wird auch bei includeNotes=false gefunden (inkl. Unicode-WholeWord)
    const noteHits = searchProject(project, "Zähler", {
      scope: "project",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: true,
      wholeWord: true,
      includeNotes: false,
    });
    expect(noteHits).toHaveLength(1);
    expect(noteHits[0].itemKind).toBe("textNote");
    expect(noteHits[0].matchedNoteSnippet).toContain("Zähler");

    // Metadaten-Beschreibung (note) nur wenn includeNotes=true
    const descDisabled = searchProject(project, "Spezialhinweis", {
      scope: "project",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: false,
      wholeWord: false,
      includeNotes: false,
    });
    expect(descDisabled).toHaveLength(0);

    const descEnabled = searchProject(project, "Spezialhinweis", {
      scope: "project",
      currentCircuitId: mainCircuit.logicalCircuitId,
      matchCase: false,
      wholeWord: false,
      includeNotes: true,
    });
    expect(descEnabled.length).toBeGreaterThanOrEqual(1);
    expect(descEnabled.some((hit) => hit.entityType === "circuit" && hit.circuitId === subCircuit.logicalCircuitId)).toBe(true);
    expect(descEnabled[0].matchedNoteSnippet).toContain("Spezialhinweis");
  });

  it("ignoriert unbenannte Probes (inkl. interner UUID und '?'), findet aber benannte Probes und beachtet matchCase/wholeWord", () => {
    const project = createEmptyCircuitProject("ProbeTest", "Main");
    const main = project.logicalCircuits[0];

    const unnamedProbe = createCircuitProbe("aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb", "");
    unnamedProbe.note = "Unbenannte Probe Notiz";
    const unnamedSym = createCircuitSymbol(unnamedProbe, main.logicalCircuitId, 2, 2);

    const namedProbe = createCircuitProbe("cccccccc-4444-5555-6666-dddddddddddd", "Bus_Valid");
    const namedSym = createCircuitSymbol(namedProbe, main.logicalCircuitId, 8, 2);

    const nandInst = instantiateCircuitFromPalette(
      project,
      main.logicalCircuitId,
      { type: "nand", name: "NAND", inputCount: 2 },
      { x: 14, y: 2 },
    );

    main.circuitSymbols.push(unnamedSym, namedSym, nandInst.circuitSymbol);
    project.circuitProbes.push(unnamedProbe, namedProbe);
    project.circuits.set(unnamedProbe.circuitId, unnamedProbe);
    project.circuits.set(namedProbe.circuitId, namedProbe);
    project.circuitSymbols.push(unnamedSym, namedSym, nandInst.circuitSymbol);

    expect(hasCustomProbeName(unnamedProbe)).toBe(false);
    expect(getProbeDisplayName(unnamedProbe)).toBe("");
    expect(hasCustomProbeName(namedProbe)).toBe(true);
    expect(getProbeDisplayName(namedProbe)).toBe("Bus_Valid");

    // UUID, "?" und "Probe" dürfen unbenannte Probes bei includeNotes=false niemals matchen
    for (const query of ["aaaaaaaa", "?", "Probe"]) {
      const hits = searchProject(project, query, {
        scope: "project",
        currentCircuitId: main.logicalCircuitId,
        matchCase: false,
        wholeWord: false,
        includeNotes: false,
      });
      expect(hits.some((h) => h.symbolId === unnamedSym.circuitSymbolId)).toBe(false);
    }

    // Bei includeNotes=true wird die Beschreibung der unbenannten Probe gefunden
    const noteProbeHits = searchProject(project, "Unbenannte", {
      scope: "project",
      currentCircuitId: main.logicalCircuitId,
      matchCase: false,
      wholeWord: false,
      includeNotes: true,
    });
    expect(noteProbeHits.some((h) => h.symbolId === unnamedSym.circuitSymbolId)).toBe(true);

    // Benannte Probe wird gefunden und respektiert matchCase
    const validLowerCaseSensitive = searchProject(project, "bus_valid", {
      scope: "project",
      currentCircuitId: main.logicalCircuitId,
      matchCase: true,
      wholeWord: false,
      includeNotes: false,
    });
    expect(validLowerCaseSensitive).toHaveLength(0);

    const validExactCase = searchProject(project, "Bus_Valid", {
      scope: "project",
      currentCircuitId: main.logicalCircuitId,
      matchCase: true,
      wholeWord: true,
      includeNotes: false,
    });
    expect(validExactCase).toHaveLength(1);
    expect(validExactCase[0].itemKind).toBe("probe");
    expect(validExactCase[0].label).toBe("Bus_Valid");

    // wholeWord verhindert Treffer von "AND" auf "NAND"
    const wholeWordAnd = searchProject(project, "AND", {
      scope: "project",
      currentCircuitId: main.logicalCircuitId,
      matchCase: false,
      wholeWord: true,
      includeNotes: false,
    });
    expect(wholeWordAnd).toHaveLength(0);

    // Highlight-Segmentierung
    expect(splitHighlightSegments("ALU_AND_Gate", "and", false, false)).toEqual([
      { text: "ALU_", matched: false },
      { text: "AND", matched: true },
      { text: "_Gate", matched: false },
    ]);
  });

  it("verwaltet FindPreferences und die 10er-LRU-Suchhistorie robust in localStorage", () => {
    const store = installMockLocalStorage();

    expect(loadFindPreferences()).toEqual(DEFAULT_FIND_PREFERENCES);
    expect(loadFindPreferences().includeNotes).toBe(false);

    // LRU-Logik: Maximal 10 Einträge, Deduplizierung und Verschieben nach vorne
    let history: string[] = [];
    for (let i = 1; i <= 12; i++) {
      history = pushRecentFindQuery(history, `Term${i}`);
    }
    expect(history).toHaveLength(MAX_RECENT_FIND_QUERIES);
    expect(history[0]).toBe("Term12");
    expect(history[9]).toBe("Term3");
    expect(history).not.toContain("Term1");
    expect(history).not.toContain("Term2");

    // Bestehender Eintrag rutscht an Index 0 ohne Duplikat
    history = pushRecentFindQuery(history, "  Term5  ");
    expect(history).toHaveLength(10);
    expect(history[0]).toBe("Term5");
    expect(history.filter((entry) => entry === "Term5")).toHaveLength(1);

    // Leere Eingabe ändert Liste nicht
    expect(pushRecentFindQuery(history, "   ")).toEqual(history);

    // Entfernen eines einzelnen Eintrags
    const shortened = removeRecentFindQuery(history, "Term5");
    expect(shortened).toHaveLength(9);
    expect(shortened).not.toContain("Term5");

    // Persistenz aller Einstellungen
    saveFindPreferences({
      scope: "current",
      matchCase: true,
      wholeWord: true,
      includeNotes: true,
      recentQueries: shortened,
    });

    const loaded = loadFindPreferences();
    expect(loaded.scope).toBe("current");
    expect(loaded.matchCase).toBe(true);
    expect(loaded.wholeWord).toBe(true);
    expect(loaded.includeNotes).toBe(true);
    expect(loaded.recentQueries).toEqual(shortened);

    // Fehlerhaftes JSON fällt sauber auf Defaults zurück
    store.set(FIND_PREFERENCES_STORAGE_KEY, "{broken-json");
    expect(loadFindPreferences()).toEqual(DEFAULT_FIND_PREFERENCES);
  });

  it("rendert FindBar (VS-Code-Stil, DE & EN, Toggles, Trefferliste & LRU-Verlauf), MainMenu & HelpDialog korrekt", async () => {
    installMockLocalStorage();
    const project = createEmptyCircuitProject("RenderFind", "Main");
    const main = project.logicalCircuits[0];

    const andInst = instantiateCircuitFromPalette(
      project,
      main.logicalCircuitId,
      { type: "and", name: "AND", inputCount: 2 },
      { x: 6, y: 8 },
    );
    main.circuitSymbols.push(andInst.circuitSymbol);
    project.circuitSymbols.push(andInst.circuitSymbol);

    // Geschlossene FindBar rendert nichts
    const closedHtml = renderToStaticMarkup(
      <FindBar
        isOpen={false}
        focusSignal={0}
        project={project}
        currentCircuitId={main.logicalCircuitId}
        onNavigateToResult={noop}
        onClose={noop}
      />,
    );
    expect(closedHtml).not.toContain("data-component=\"FindBar\"");
    expect(closedHtml).not.toContain("find-bar-input");

    // Geöffnete FindBar mit Suchbegriff (Default-Toggles: includeNotes=false, project-Scope)
    const openMatchHtml = renderToStaticMarkup(
      <FindBar
        isOpen={true}
        focusSignal={1}
        project={project}
        currentCircuitId={main.logicalCircuitId}
        initialQuery="AND1"
        onNavigateToResult={noop}
        onClose={noop}
      />,
    );
    expect(openMatchHtml).toContain("data-component=\"FindBar\"");
    expect(openMatchHtml).toContain("data-testid=\"find-toggle-case\"");
    expect(openMatchHtml).toContain("data-testid=\"find-toggle-word\"");
    expect(openMatchHtml).toContain("data-testid=\"find-toggle-notes\"");
    expect(openMatchHtml).toContain("Auch Beschreibungen durchsuchen");
    expect(openMatchHtml).toContain("aria-pressed=\"false\"");
    expect(openMatchHtml).toContain("Gesamtes Projekt");
    expect(openMatchHtml).toContain("Aktuelle Schaltung");
    expect(openMatchHtml).toContain("1 Treffer");
    expect(openMatchHtml).toContain("<mark class=\"find-highlight\">AND1</mark>");
    expect(openMatchHtml).toContain("(6, 8)");

    // Geöffnete FindBar mit leerem Feld zeigt LRU-Verlauf aus localStorage
    saveFindPreferences({
      scope: "project",
      matchCase: false,
      wholeWord: false,
      includeNotes: true,
      recentQueries: ["ALU", "AND1"],
    });

    await i18n.changeLanguage("en");
    const openHistoryEnHtml = renderToStaticMarkup(
      <FindBar
        isOpen={true}
        focusSignal={2}
        project={project}
        currentCircuitId={main.logicalCircuitId}
        onNavigateToResult={noop}
        onClose={noop}
      />,
    );
    expect(openHistoryEnHtml).toContain("Also search descriptions");
    expect(openHistoryEnHtml).toContain("Entire Project");
    expect(openHistoryEnHtml).toContain("Recent searches");
    expect(openHistoryEnHtml).toContain("ALU");
    expect(openHistoryEnHtml).toContain("AND1");

    // MainMenu: im Editiermodus aktiv, während Simulation gesperrt
    await i18n.changeLanguage("de");
    const menuEditHtml = renderToStaticMarkup(
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
        onOpenSearch={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );
    expect(menuEditHtml).toContain("Suchen...");
    expect(menuEditHtml).toContain("Strg+F");
    expect(menuEditHtml).not.toContain("Folgt in US-015");
    expect(menuEditHtml).toContain(
      "title=\"Durchsucht Schaltungen, Bauteile, Pins, Messsonden und Textnotizen im Projekt (Strg+F)\" class=\"submenu-item\"",
    );

    const menuSimHtml = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="view"
        isSimulating={true}
        isPaused={false}
        isRunning={true}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
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
        onOpenSearch={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );
    expect(menuSimHtml).toContain("class=\"submenu-item disabled\"");
    expect(menuSimHtml).toContain("Während aktiver Simulation nicht verfügbar");

    // HelpDialog führt Strg+F / Ctrl+F auf
    const helpDeHtml = renderToStaticMarkup(<HelpDialog isOpen={true} onClose={noop} />);
    expect(helpDeHtml).toContain("Strg + F");

    await i18n.changeLanguage("en");
    const helpEnHtml = renderToStaticMarkup(<HelpDialog isOpen={true} onClose={noop} />);
    expect(helpEnHtml).toContain("Ctrl + F");

    // CanvasContext registriert openFindBar
    let capturedCanvasCtx!: React.ContextType<typeof CanvasContext>;
    renderToStaticMarkup(
      <CanvasContextProvider>
        <CanvasProbe onContext={(ctx) => { capturedCanvasCtx = ctx; }} />
      </CanvasContextProvider>,
    );
    const openSpy = vi.fn();
    capturedCanvasCtx.registerOpenFindBar?.(openSpy);
    capturedCanvasCtx.openFindBar?.();
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});
