import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CanvasContextProvider from "../contexts/canvasContext/provider";
import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import LibraryContext, { type LibraryContextType } from "../contexts/libraryContext";
import LibraryContextProvider from "../contexts/libraryContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitProject from "../types/circuit/circuitProject";
import {
  LIBRARY_FORMAT,
  type LibraryPersistenceState,
} from "../types/storage/circuitLibrary";
import { NATIVE_PROJECT_SCHEMA_VERSION } from "../types/storage/nativeProjectFormat";

import i18n from "../i18n";
import { getBuiltInLibraryCircuits, getBuiltInLibraryItems } from "../utils/builtInLibraryCatalog";
import {
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
} from "../utils/circuitLayout";
import type {
  FileSystemDeps,
  FileSystemFileHandleLike,
  LibraryCacheRecord,
  LibraryHandleRecord,
  LibraryStoreAdapter,
} from "../utils/fileSystemStorage";
import { buildCircuitLibraryDocument, parseCircuitLibraryDocument, serializeCircuitLibrary } from "../utils/libraryStorage";
import { serializeLogicalCircuitToNative } from "../utils/storage/nativeProjectWriter";
import { getHydratedNativeCircuitsMap } from "../utils/subCircuitPreview";
import { createWire } from "../utils/wireUtils";

import AppHeader from "../components/app/appHeader";
import CircuitCanvas from "../components/circuitCanvas";
import LibraryView from "../components/componentPalette/libraryView";
import PropertyDialog from "../components/propertyDialog";

function buildPowerAndLedSampleProject(): {
  project: CircuitProject;
  powerCircuitId: string;
  triLedCircuitId: string;
} {
  const project = createEmptyCircuitProject("Test Project", "Main", "main-1", "proj-1");
  const main = project.logicalCircuits[0];

  const triLed = createDefaultLogicalCircuit("tri-led-1", "Tri State LED (Right)", "Helpers", "Tri-state indicator");
  const { pin: ledInPin, pinCircuit: ledInCircuit } = createPinCircuit(
    "pin-led-in",
    triLed.logicalCircuitId,
    "input",
    "IN",
    1,
    "left",
    false,
    0,
  );
  const ledGate = createGate("led", 1, false, "green");
  project.circuits.set(triLed.circuitId, triLed);
  project.circuits.set(ledInCircuit.circuitId, ledInCircuit);
  project.circuits.set(ledGate.circuitId, ledGate);
  project.logicalCircuits.push(triLed);
  project.pins.push(ledInPin);

  const symLedPin = createCircuitSymbol(ledInCircuit, triLed.logicalCircuitId, 2, 2, "up", "sym-led-pin");
  const symLedGate = createCircuitSymbol(ledGate, triLed.logicalCircuitId, 8, 2, "up", "sym-led-gate");
  triLed.logicalPins = [ledInPin];
  triLed.circuitSymbols.push(symLedPin, symLedGate);
  triLed.wires.push(createWire(triLed.logicalCircuitId, { x: 4, y: 3 }, { x: 8, y: 3 }, "w-tri-1"));

  const power = createDefaultLogicalCircuit("power-1", "Power", "Supply", "Power rail with LED");
  const { pin: pwrInPin, pinCircuit: pwrInCircuit } = createPinCircuit(
    "pin-pwr-in",
    power.logicalCircuitId,
    "input",
    "PWR",
    1,
    "left",
    false,
    0,
  );
  const { pin: pwrOutPin, pinCircuit: pwrOutCircuit } = createPinCircuit(
    "pin-pwr-out",
    power.logicalCircuitId,
    "output",
    "OUT",
    1,
    "right",
    false,
    1,
  );
  project.circuits.set(power.circuitId, power);
  project.circuits.set(pwrInCircuit.circuitId, pwrInCircuit);
  project.circuits.set(pwrOutCircuit.circuitId, pwrOutCircuit);
  project.logicalCircuits.push(power);
  project.pins.push(pwrInPin, pwrOutPin);

  const symPwrIn = createCircuitSymbol(pwrInCircuit, power.logicalCircuitId, 2, 2, "up", "sym-pwr-in");
  const symPwrOut = createCircuitSymbol(pwrOutCircuit, power.logicalCircuitId, 14, 2, "up", "sym-pwr-out");
  const symSubLed = createCircuitSymbol(triLed, power.logicalCircuitId, 8, 2, "up", "sym-pwr-led");
  power.logicalPins = [pwrInPin, pwrOutPin];
  power.circuitSymbols.push(symPwrIn, symPwrOut, symSubLed);
  power.wires.push(
    createWire(power.logicalCircuitId, { x: 4, y: 3 }, { x: 8, y: 3 }, "w-pwr-1"),
    createWire(power.logicalCircuitId, { x: 4, y: 3 }, { x: 14, y: 3 }, "w-pwr-2"),
  );

  const mainPowerSym = createCircuitSymbol(power, main.logicalCircuitId, 6, 4, "up", "sym-main-pwr");
  main.circuitSymbols.push(mainPowerSym);

  return {
    project,
    powerCircuitId: power.logicalCircuitId,
    triLedCircuitId: triLed.logicalCircuitId,
  };
}

function createFakeMemoryLibraryDeps(initialContent: string, fileName = "personal.lclib"): {
  deps: FileSystemDeps;
  getFileText: () => string;
  setPermission: (mode: "granted" | "prompt" | "denied") => void;
} {
  let storedText = initialContent;
  let permissionState: "granted" | "prompt" | "denied" = "granted";
  let handleRecord: LibraryHandleRecord | null = null;
  let cacheRecord: LibraryCacheRecord | null = null;

  const fakeHandle: FileSystemFileHandleLike = {
    kind: "file",
    name: fileName,
    getFile: async () => ({
      name: fileName,
      text: async () => storedText,
    } as unknown as File),
    createWritable: async () => {
      let buffer = "";
      return {
        write: async (data) => {
          buffer = typeof data === "string" ? data : String(data);
        },
        close: async () => {
          storedText = buffer;
        },
      };
    },
    queryPermission: async () => permissionState,
    requestPermission: async () => permissionState,
  };

  handleRecord = {
    id: "active-library",
    fileName,
    handle: fakeHandle,
    savedAt: 1000,
  };

  const libraryAdapter: LibraryStoreAdapter = {
    getLibraryHandle: async () => handleRecord,
    putLibraryHandle: async (record) => {
      handleRecord = record;
    },
    getLibraryCache: async () => cacheRecord,
    putLibraryCache: async (record) => {
      cacheRecord = record;
    },
  };

  return {
    deps: { libraryStore: libraryAdapter },
    getFileText: () => storedText,
    setPermission: (next) => {
      permissionState = next;
    },
  };
}

function createMockLibraryContextValue(overrides?: Partial<LibraryContextType>): LibraryContextType {
  const builtInCircuits = getBuiltInLibraryCircuits();
  const builtInItems = getBuiltInLibraryItems();

  return {
    activeSidebarTab: "library",
    setActiveSidebarTab: vi.fn(),
    persistenceState: {
      status: "uninitialized",
      isReadOnly: true,
      fileName: null,
      cachedAt: null,
      lastSyncedAt: null,
      document: null,
    },
    isLoading: false,
    isResyncWarningDismissed: false,
    dismissResyncWarning: vi.fn(),
    libraryError: null,
    clearLibraryError: vi.fn(),
    builtInItems,
    builtInCircuits,
    userCircuits: [],
    isWritable: false,
    editingLibraryCircuitId: null,
    isEditingLibrary: false,
    openLibraryFile: vi.fn(async () => false),
    openLibraryFromText: vi.fn(() => false),
    createLibraryFile: vi.fn(async () => false),
    resyncLibrary: vi.fn(async () => false),
    unlinkLibrary: vi.fn(async () => undefined),
    reloadInitialLibrary: vi.fn(async () => undefined),
    addProjectCircuitToLibrary: vi.fn(async () => null),
    duplicateBuiltInToLibrary: vi.fn(async () => null),
    updateLibraryCircuitMetadata: vi.fn(async () => false),
    getLibraryDeletionDependents: vi.fn(() => []),
    deleteLibraryCircuits: vi.fn(async () => ({ deletedIds: [], blockedByDependents: [] })),
    importCircuitsIntoLibrary: vi.fn(async () => 0),
    exportLibraryCircuitNative: vi.fn(),
    exportLibraryCircuitXml: vi.fn(),
    exportLibraryDocument: vi.fn(),
    enterLibraryEditMode: vi.fn(async () => false),
    saveLibraryEditSession: vi.fn(async () => false),
    exitLibraryEditMode: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Library UI & Workflows (T-083)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("de");
  });

  it("renders uninitialized prompt with Load/Create actions and built-in Standard ICs", () => {
    const mockCtx = createMockLibraryContextValue();
    const html = renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContextProvider>
          <LibraryContext.Provider value={mockCtx}>
            <LibraryView />
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(html).toContain("data-component=\"LibraryView\"");
    expect(html).toContain("data-testid=\"library-empty-state\"");
    expect(html).toContain("Bibliothek laden (.lclib)");
    expect(html).toContain("Neue Bibliothek anlegen");
    expect(html).toContain("Standard-ICs (Nur Lesen)");
    expect(html).toContain("Halbaddierer");
    expect(html).toContain("4-Bit-Register");
  });

  it("renders dismissible Read-Only resync warning when handle permission needs re-authorization", () => {
    const sample = buildPowerAndLedSampleProject();
    const nativePower = serializeLogicalCircuitToNative(
      sample.project.logicalCircuits.find((lc) => lc.logicalCircuitId === sample.powerCircuitId)!,
      sample.project,
    );
    const nativeLed = serializeLogicalCircuitToNative(
      sample.project.logicalCircuits.find((lc) => lc.logicalCircuitId === sample.triLedCircuitId)!,
      sample.project,
    );
    const doc = buildCircuitLibraryDocument([nativeLed, nativePower]);

    const readOnlyCtx = createMockLibraryContextValue({
      persistenceState: {
        status: "needs-permission",
        isReadOnly: true,
        fileName: "my-chips.lclib",
        cachedAt: 12345,
        lastSyncedAt: null,
        document: doc,
      },
      userCircuits: doc.logicalCircuits,
      isWritable: false,
      isResyncWarningDismissed: false,
    });

    const htmlWithBanner = renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContextProvider>
          <LibraryContext.Provider value={readOnlyCtx}>
            <LibraryView />
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(htmlWithBanner).toContain("data-testid=\"library-resync-banner\"");
    expect(htmlWithBanner).toContain("Erneut autorisieren");
    expect(htmlWithBanner).toContain("my-chips.lclib");
    expect(htmlWithBanner).toContain("Nur Lesen");
    expect(htmlWithBanner).toContain("Power");
    expect(htmlWithBanner).toContain("Tri State LED (Right)");
    expect(htmlWithBanner).toContain("1E / 1A");
    // Kategorie "Helpers" wird alphabetisch vor "Supply" angezeigt
    expect(htmlWithBanner.indexOf("Helpers")).toBeLessThan(htmlWithBanner.indexOf("Supply"));

    const dismissedCtx = createMockLibraryContextValue({
      ...readOnlyCtx,
      isResyncWarningDismissed: true,
    });

    const htmlDismissed = renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContextProvider>
          <LibraryContext.Provider value={dismissedCtx}>
            <LibraryView />
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(htmlDismissed).not.toContain("data-testid=\"library-resync-banner\"");
    expect(htmlDismissed).toContain("Power");
  });

  it("highlights Library Edit Mode in AppHeader, CircuitCanvas, and PropertyDialog", () => {
    const sample = buildPowerAndLedSampleProject();
    const editModeCtx = createMockLibraryContextValue({
      editingLibraryCircuitId: sample.powerCircuitId,
      isEditingLibrary: true,
      isWritable: true,
    });

    const headerHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={sample.project} initialCircuitId={sample.powerCircuitId}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={editModeCtx}>
            <CanvasContextProvider>
              <AppHeader />
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(headerHtml).toContain("data-testid=\"library-mode-badge\"");
    expect(headerHtml).toContain("Bibliotheksmodus");
    expect(headerHtml).toContain("data-testid=\"save-library-mode-button\"");
    expect(headerHtml).toContain("data-testid=\"exit-library-mode-button\"");

    const canvasHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={sample.project} initialCircuitId={sample.powerCircuitId}>
        <SimulationContextProvider>
          <LibraryContext.Provider value={editModeCtx}>
            <CanvasContextProvider>
              <CircuitCanvas />
            </CanvasContextProvider>
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(canvasHtml).toContain("data-library-edit=\"true\"");
    expect(canvasHtml).toContain("library-edit-mode");

    const dialogHtml = renderToStaticMarkup(
      <PropertyDialog
        isOpen={true}
        circuit={sample.project.logicalCircuits.find((lc) => lc.logicalCircuitId === sample.powerCircuitId)!}
        accentVariant="library"
        onClose={vi.fn()}
      />,
    );

    expect(dialogHtml).toContain("data-accent-variant=\"library\"");
    expect(dialogHtml).toContain("library-accent");
  });

  it("executes library transfer, reference-protected cascade deletion, read-only guard, and Library Edit Mode round-trip", async () => {
    const { project, powerCircuitId } = buildPowerAndLedSampleProject();
    const emptyLibJson = serializeCircuitLibrary({
      format: LIBRARY_FORMAT,
      schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
      appVersion: "1.1.0",
      logicalCircuits: [],
    });
    const fakeFs = createFakeMemoryLibraryDeps(emptyLibJson, "chips.lclib");

    const initialSynced: LibraryPersistenceState = {
      status: "synced",
      isReadOnly: false,
      fileName: "chips.lclib",
      cachedAt: 1000,
      lastSyncedAt: 1000,
      document: buildCircuitLibraryDocument([]),
    };

    let capturedLib: LibraryContextType | undefined;
    let capturedCircuit: React.ContextType<typeof CircuitContext> | undefined;

    const CaptureBoth: React.FC = () => {
      capturedLib = React.useContext(LibraryContext);
      capturedCircuit = React.useContext(CircuitContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContextProvider
            initialPersistenceState={initialSynced}
            storageDeps={fakeFs.deps}
            skipInitialLoad={true}
          >
            <CaptureBoth />
          </LibraryContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(capturedLib).toBeDefined();
    expect(capturedCircuit).toBeDefined();

    // Projekt-Schaltung "Power" inkl. transitiver "Tri State LED (Right)" kopieren
    const added = await capturedLib!.addProjectCircuitToLibrary(
      capturedCircuit!.project,
      powerCircuitId,
      { name: "Power Custom", category: "Supplies" },
    );
    expect(added).not.toBeNull();
    expect(added!.addedCircuits.length).toBe(2);

    const savedDocAfterAdd = parseCircuitLibraryDocument(fakeFs.getFileText());
    expect(savedDocAfterAdd.logicalCircuits.length).toBe(2);
    const savedLed = savedDocAfterAdd.logicalCircuits.find((lc) => lc.name.includes("Tri State LED"))!;
    const savedPower = savedDocAfterAdd.logicalCircuits.find((lc) => lc.name === "Power Custom")!;
    expect(savedLed).toBeDefined();
    expect(savedPower).toBeDefined();

    // Standard-IC in eigene Bibliothek duplizieren
    const dupResult = await capturedLib!.duplicateBuiltInToLibrary("halfAdder");
    expect(dupResult).not.toBeNull();
    expect(parseCircuitLibraryDocument(fakeFs.getFileText()).logicalCircuits.length).toBe(3);

    // Im Library Edit Mode öffnen, Änderung im isolierten Projekt speichern und sauber zurückkehren
    const snapshotBeforeEdit = capturedCircuit!.project.project.name;
    capturedCircuit!.setActiveFileHandle(null, "unsaved-work.lcweb");
    const entered = await capturedLib!.enterLibraryEditMode(savedPower.logicalCircuitId);
    expect(entered).toBe(true);
    expect(capturedCircuit!.currentCircuitId).toBe(savedPower.logicalCircuitId);

    capturedCircuit!.updateCircuitProperties(savedPower.logicalCircuitId, { note: "Updated in Edit Mode" });
    const savedEdit = await capturedLib!.saveLibraryEditSession();
    expect(savedEdit).toBe(true);

    const docAfterEdit = parseCircuitLibraryDocument(fakeFs.getFileText());
    expect(
      docAfterEdit.logicalCircuits.find((lc) => lc.logicalCircuitId === savedPower.logicalCircuitId)?.note,
    ).toBe("Updated in Edit Mode");

    await capturedLib!.exitLibraryEditMode();
    expect(capturedCircuit!.project.project.name).toBe(snapshotBeforeEdit);
    expect(capturedCircuit!.activeFileName).toBe("unsaved-work.lcweb");

    // Referenzschutz beim Löschversuch von "Tri State LED" (blockiert wegen "Power Custom")
    const blockedDelete = await capturedLib!.deleteLibraryCircuits(savedLed.logicalCircuitId);
    expect(blockedDelete.deletedIds).toEqual([]);
    expect(blockedDelete.blockedByDependents.map((d) => d.logicalCircuitId)).toEqual([savedPower.logicalCircuitId]);

    // Kaskadierendes Löschen entfernt beide Einträge und belässt das duplizierte Halbaddierer-IC
    const cascadeDelete = await capturedLib!.deleteLibraryCircuits(savedLed.logicalCircuitId, {
      cascadeDependents: true,
    });
    expect(cascadeDelete.blockedByDependents).toEqual([]);
    expect(cascadeDelete.deletedIds).toHaveLength(2);
    expect(parseCircuitLibraryDocument(fakeFs.getFileText()).logicalCircuits.length).toBe(1);

    // Read-Only-Sperre prüfen (Berechtigung widerrufen + resync -> schreibgeschützt)
    fakeFs.setPermission("prompt");
    await capturedLib!.resyncLibrary();
    const blockedInReadOnly = await capturedLib!.duplicateBuiltInToLibrary("fullAdder");
    expect(blockedInReadOnly).toBeNull();
  });

  it("saves via active in-memory FileHandle even if IndexedDB returns no handle record", async () => {
    const { project, powerCircuitId } = buildPowerAndLedSampleProject();
    let writtenText = serializeCircuitLibrary(buildCircuitLibraryDocument([]));
    const liveHandle: FileSystemFileHandleLike = {
      kind: "file",
      name: "CircuitLibrary.lclib",
      getFile: async () => ({
        name: "CircuitLibrary.lclib",
        text: async () => writtenText,
      } as unknown as File),
      createWritable: async () => {
        let buffer = "";
        return {
          write: async (data) => {
            buffer = typeof data === "string" ? data : String(data);
          },
          close: async () => {
            writtenText = buffer;
          },
        };
      },
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
    };

    // Simuliert blockierte oder geleerte IndexedDB beim Speichern trotz aktivem Picker-Handle
    let cachedRecord: LibraryCacheRecord | null = null;
    const emptyIdbAdapter: LibraryStoreAdapter = {
      getLibraryHandle: async () => null,
      putLibraryHandle: async () => undefined,
      getLibraryCache: async () => cachedRecord,
      putLibraryCache: async (record) => {
        cachedRecord = record;
      },
    };

    const syncedWithoutIdb: LibraryPersistenceState = {
      status: "synced",
      isReadOnly: false,
      fileName: "CircuitLibrary.lclib",
      handle: liveHandle,
      cachedAt: 1000,
      lastSyncedAt: 1000,
      document: buildCircuitLibraryDocument([]),
    };

    let capturedLib: LibraryContextType | undefined;
    const Capture: React.FC = () => {
      capturedLib = React.useContext(LibraryContext);
      return null;
    };

    renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <LibraryContextProvider
            initialPersistenceState={syncedWithoutIdb}
            storageDeps={{ libraryStore: emptyIdbAdapter }}
            skipInitialLoad={true}
          >
            <Capture />
          </LibraryContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    const res = await capturedLib!.addProjectCircuitToLibrary(project, powerCircuitId, {
      name: "Power",
      category: "Supply",
    });

    expect(res).not.toBeNull();
    expect(capturedLib!.persistenceState.status).toBe("synced");
    expect(capturedLib!.libraryError).toBeNull();
    const persisted = parseCircuitLibraryDocument(writtenText);
    expect(persisted.logicalCircuits.map((c) => c.name)).toContain("Power");
    expect(persisted.logicalCircuits.map((c) => c.name)).toContain("Tri State LED (Right)");
  });

  it("hydrates library display shape, showLabelAbove, displayMargin, exportToHDL and pins in PropertyDialog (B-007)", () => {
    const sample = buildPowerAndLedSampleProject();
    const triLed = sample.project.logicalCircuits.find((lc) => lc.logicalCircuitId === sample.triLedCircuitId)!;
    triLed.circuitShape = "display";
    triLed.isDisplay = true;

    const power = sample.project.logicalCircuits.find((lc) => lc.logicalCircuitId === sample.powerCircuitId)!;
    power.circuitShape = "display";
    power.isDisplay = true;
    power.showLabelAbove = true;
    power.displayMargin = "horizontal";
    power.exportToHDL = false;

    const nativeLed = serializeLogicalCircuitToNative(triLed, sample.project);
    const nativePower = serializeLogicalCircuitToNative(power, sample.project);
    const hydratedMap = getHydratedNativeCircuitsMap([nativeLed, nativePower]);
    const hydratedPower = hydratedMap.get(power.logicalCircuitId)!;
    const hydratedList = Array.from(hydratedMap.values());

    // Im aktiven CircuitContext liegt ein anderes leeres Projekt ohne die Bibliotheksschaltungen
    const html = renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContextProvider>
          <PropertyDialog
            isOpen={true}
            circuit={hydratedPower}
            contextCircuits={hydratedList}
            accentVariant="library"
            onClose={() => undefined}
          />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    const displayBtnMatch = html.match(/<button[^>]*data-testid="circuit-shape-btn-display"[^>]*>/);
    expect(displayBtnMatch).not.toBeNull();
    expect(displayBtnMatch![0]).toContain("shape-option-btn active");
    expect(displayBtnMatch![0]).not.toContain("disabled");

    const rectBtnMatch = html.match(/<button[^>]*data-testid="circuit-shape-btn-rectangular"[^>]*>/);
    expect(rectBtnMatch).not.toBeNull();
    expect(rectBtnMatch![0]).not.toContain("active");

    const showLabelAboveMatch = html.match(/<input[^>]*id="circuit-show-label-above-checkbox"[^>]*>/);
    expect(showLabelAboveMatch).not.toBeNull();
    expect(showLabelAboveMatch![0]).toContain("checked");

    const exportHdlMatch = html.match(/<input[^>]*id="circuit-export-hdl-checkbox"[^>]*>/);
    expect(exportHdlMatch).not.toBeNull();
    expect(exportHdlMatch![0]).not.toContain("checked");

    const marginSelectMatch = html.match(/<select[^>]*id="circuit-display-margin-select"[^>]*>[\s\S]*?<\/select>/);
    expect(marginSelectMatch).not.toBeNull();
    expect(marginSelectMatch![0]).not.toContain("disabled");
    expect(marginSelectMatch![0]).toMatch(/<option value="horizontal"[^>]*selected/);

    // Pin-Reihenfolge-Tab zeigt die echte Pin-Anzahl (2) statt 0
    expect(html).toContain("Pin Reihenfolge");
    expect(html).toContain("class=\"tab-count-badge\">2<");
  });

  it("persists circuitShape, showLabelAbove, displayMargin, exportToHDL and pinOrder in updateLibraryCircuitMetadata (B-007)", async () => {
    const sample = buildPowerAndLedSampleProject();
    const triLed = sample.project.logicalCircuits.find((lc) => lc.logicalCircuitId === sample.triLedCircuitId)!;
    triLed.circuitShape = "display";
    triLed.isDisplay = true;

    const power = sample.project.logicalCircuits.find((lc) => lc.logicalCircuitId === sample.powerCircuitId)!;
    const plain = createDefaultLogicalCircuit("plain-1", "PlainGate", "Logic");
    sample.project.logicalCircuits.push(plain);
    sample.project.circuits.set(plain.circuitId, plain);

    const nativeLed = serializeLogicalCircuitToNative(triLed, sample.project);
    const nativePower = serializeLogicalCircuitToNative(power, sample.project);
    const nativePlain = serializeLogicalCircuitToNative(plain, sample.project);
    const initialDoc = buildCircuitLibraryDocument([nativeLed, nativePower, nativePlain]);
    const fakeFs = createFakeMemoryLibraryDeps(serializeCircuitLibrary(initialDoc));

    let capturedLib: LibraryContextType | undefined;
    const Capture: React.FC = () => {
      capturedLib = React.useContext(LibraryContext);
      return null;
    };

    const initialState: LibraryPersistenceState = {
      status: "synced",
      isReadOnly: false,
      fileName: "personal.lclib",
      handle: undefined,
      cachedAt: 1000,
      lastSyncedAt: 1000,
      document: initialDoc,
    };

    renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContextProvider>
          <LibraryContextProvider
            initialPersistenceState={initialState}
            storageDeps={fakeFs.deps}
            skipInitialLoad={true}
          >
            <Capture />
          </LibraryContextProvider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    const updatedOk = await capturedLib!.updateLibraryCircuitMetadata(power.logicalCircuitId, {
      name: "Power Updated",
      notation: "PWR",
      category: "Helpers",
      note: "Display rail",
      circuitShape: "display",
      showLabelAbove: true,
      displayMargin: "all",
      exportToHDL: false,
      pinOrder: nativePower.pins.map((p, idx) => ({ pinId: p.pinId, index: idx + 1 })),
    });
    expect(updatedOk).toBe(true);

    // Schaltung ohne Display-Elemente darf nicht mit circuitShape="display" gespeichert werden; leere notation bleibt leer (B-008)
    const plainOk = await capturedLib!.updateLibraryCircuitMetadata(plain.logicalCircuitId, {
      notation: "",
      circuitShape: "display",
      showLabelAbove: true,
      exportToHDL: false,
    });
    expect(plainOk).toBe(true);

    const persistedDoc = parseCircuitLibraryDocument(fakeFs.getFileText());
    const savedPower = persistedDoc.logicalCircuits.find((lc) => lc.logicalCircuitId === power.logicalCircuitId)!;
    expect(savedPower.name).toBe("Power Updated");
    expect(savedPower.circuitShape).toBe("display");
    expect(savedPower.showLabelAbove).toBe(true);
    expect(savedPower.displayMargin).toBe("all");
    expect(savedPower.exportToHDL).toBe(false);
    expect(savedPower.pins.map((p) => p.index)).toEqual([1, 2]);

    const savedPlain = persistedDoc.logicalCircuits.find((lc) => lc.logicalCircuitId === plain.logicalCircuitId)!;
    expect(savedPlain.notation).toBe("");
    expect(savedPlain.circuitShape).toBe("rectangular");
    expect(savedPlain.showLabelAbove).toBe(true);
    expect(savedPlain.exportToHDL).toBe(false);
  });
});
