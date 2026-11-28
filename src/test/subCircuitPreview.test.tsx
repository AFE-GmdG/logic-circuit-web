import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it, vi } from "vitest";

import CircuitContextProvider from "../contexts/circuitContext/provider";
import LibraryContext, { type LibraryContextType } from "../contexts/libraryContext";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitProject from "../types/circuit/circuitProject";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type { LibraryPersistenceState } from "../types/storage/circuitLibrary";

import i18n from "../i18n";
import { BUILT_IN_CIRCUIT_IDS, getBuiltInLibraryCircuits, getBuiltInLibraryItems } from "../utils/builtInLibraryCatalog";
import {
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createPinCircuit,
  getComponentLayout,
} from "../utils/circuitLayout";
import { hideBrowserDragImage } from "../utils/dragImage";
import { buildCircuitLibraryDocument } from "../utils/libraryStorage";
import { serializeLogicalCircuitToNative } from "../utils/storage/nativeProjectWriter";
import { getHydratedNativeCircuitsMap } from "../utils/subCircuitPreview";

import ComponentPalette from "../components/componentPalette";
import LibraryView from "../components/componentPalette/libraryView";
import SymbolRenderer from "../components/symbols/symbolRenderer";

function createDisplayLedSample(): { project: CircuitProject; displayLc: LogicalCircuit } {
  const project = createEmptyCircuitProject("Test", "Main", "main-1", "proj-1");
  const displayLc = createDefaultLogicalCircuit("disp-led-sub", "StatusLED", "Anzeigen");
  displayLc.circuitShape = "display";
  displayLc.isDisplay = true;
  displayLc.showLabelAbove = true;

  const { pin, pinCircuit } = createPinCircuit("pin-in-led", displayLc.logicalCircuitId, "input", "IN", 1, "left", false, 0);
  const ledGate = createGate("led", 1, false, "red");
  displayLc.logicalPins = [pin];
  displayLc.pins = [pin];
  displayLc.circuitSymbols = [
    createCircuitSymbol(pinCircuit, displayLc.logicalCircuitId, 2, 2, "up", "sym-disp-pin"),
    createCircuitSymbol(ledGate, displayLc.logicalCircuitId, 6, 2, "up", "sym-disp-led"),
  ];

  project.circuits.set(displayLc.circuitId, displayLc);
  project.circuits.set(pinCircuit.circuitId, pinCircuit);
  project.circuits.set(ledGate.circuitId, ledGate);
  project.logicalCircuits.push(displayLc);
  project.pins.push(pin);

  return { project, displayLc };
}

function createMockLibraryContext(overrides?: Partial<LibraryContextType>): LibraryContextType {
  const builtInCircuits = getBuiltInLibraryCircuits();
  const builtInItems = getBuiltInLibraryItems();
  const emptyPersistence: LibraryPersistenceState = {
    status: "uninitialized",
    isReadOnly: true,
    fileName: null,
    cachedAt: null,
    lastSyncedAt: null,
    document: null,
  };

  return {
    activeSidebarTab: "library",
    setActiveSidebarTab: vi.fn(),
    persistenceState: emptyPersistence,
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

describe("SubCircuitPreview & DragImage (B-006)", () => {
  const originalImage = (globalThis as { Image?: typeof Image }).Image;

  afterEach(async () => {
    (globalThis as { Image?: typeof Image }).Image = originalImage;
    await i18n.changeLanguage("de");
  });

  it("renders project subcircuits in ComponentPalette with real shape and display-mode elements", () => {
    const demuxLc = createDefaultLogicalCircuit("sub-demux", "MyDemux", "Logik");
    demuxLc.notation = "DMX";
    demuxLc.circuitShape = "demux";
    const { pin: inPin } = createPinCircuit("pin-dmx-in", demuxLc.logicalCircuitId, "input", "A0", 1, "left", false, 0);
    const { pin: outPin } = createPinCircuit("pin-dmx-out", demuxLc.logicalCircuitId, "output", "Y0", 1, "right", false, 0);
    demuxLc.logicalPins = [inPin, outPin];
    demuxLc.pins = [inPin, outPin];

    const { displayLc } = createDisplayLedSample();

    const html = renderToStaticMarkup(<ComponentPalette subCircuits={[demuxLc, displayLc]} />);

    expect(html).toContain("data-component=\"SubCircuitPreview\"");
    expect(html).toContain("data-circuit-shape=\"demux\"");
    expect(html).toContain(">DMX<");
    expect(html).toContain("data-circuit-shape=\"display\"");
    expect(html).toContain("class=\"display-chip-content\"");
    expect(html).toContain("class=\"chip-name chip-name-above\"");
  });

  it("renders built-in Standard ICs and user display circuits in LibraryView via SubCircuitPreview", () => {
    const { project, displayLc } = createDisplayLedSample();
    const nativeDisplay = serializeLogicalCircuitToNative(displayLc, project);
    const doc = buildCircuitLibraryDocument([nativeDisplay]);
    const mockCtx = createMockLibraryContext({
      userCircuits: doc.logicalCircuits,
      persistenceState: {
        status: "synced",
        isReadOnly: false,
        fileName: "my.lclib",
        cachedAt: 1,
        lastSyncedAt: 1,
        document: doc,
      },
    });

    const html = renderToStaticMarkup(
      <CircuitContextProvider>
        <SimulationContextProvider>
          <LibraryContext.Provider value={mockCtx}>
            <LibraryView />
          </LibraryContext.Provider>
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );

    expect(html).toContain("data-component=\"SubCircuitPreview\"");
    expect(html).toContain("data-circuit-shape=\"demux\"");
    expect(html).toContain(">DEC 2:4<");
    expect(html).toContain(">Y3<");
    expect(html).toContain("data-circuit-shape=\"display\"");
    expect(html).toContain("class=\"display-chip-content\"");
  });

  it("caches hydrated native circuits per array reference and resolves real dimensions", () => {
    const builtIns = getBuiltInLibraryCircuits();
    const mapA = getHydratedNativeCircuitsMap(builtIns);
    const mapB = getHydratedNativeCircuitsMap(builtIns);

    expect(mapA).toBe(mapB);
    const decoder = mapA.get(BUILT_IN_CIRCUIT_IDS.decoder2to4);
    expect(decoder).toBeDefined();
    expect(decoder?.circuitShape).toBe("demux");
    expect(decoder?.symbolWidth).toBeGreaterThanOrEqual(3);
    expect(decoder?.symbolHeight).toBeGreaterThanOrEqual(5);
    expect(decoder?.pins).toHaveLength(7);
  });

  it("hides browser drag image using a 1x1 transparent image and handles missing dataTransfer safely", () => {
    class MockImage {
      src = "";
    }
    (globalThis as { Image?: typeof Image }).Image = MockImage as unknown as typeof Image;

    const setDragImage = vi.fn();
    hideBrowserDragImage({ setDragImage } as unknown as DataTransfer);

    expect(setDragImage).toHaveBeenCalledTimes(1);
    const [imgArg, offsetX, offsetY] = setDragImage.mock.calls[0];
    expect(imgArg).toBeInstanceOf(MockImage);
    expect((imgArg as MockImage).src.startsWith("data:image/gif;base64,")).toBe(true);
    expect(offsetX).toBe(0);
    expect(offsetY).toBe(0);

    expect(() => hideBrowserDragImage(null)).not.toThrow();
    expect(() => hideBrowserDragImage({} as DataTransfer)).not.toThrow();
  });

  it("computes splitter drag ghost layout and renders all 17 pins for 16-pin splitter", () => {
    const splitterLayout = getComponentLayout("splitter", {
      pinCount: 16,
      pinBitWidth: 1,
      bitWidth: 16,
      clockwise: false,
    });

    expect(splitterLayout.gridHeight).toBe(17);
    expect(splitterLayout.pins).toHaveLength(17);

    const html = renderToStaticMarkup(
      <svg>
        <SymbolRenderer
          type="splitter"
          pinCount={16}
          bitWidth={16}
          clockwise={false}
          pins={splitterLayout.pins}
          showPins={true}
        />
      </svg>,
    );

    const pinMatches = html.match(/class="pin-point /g) ?? [];
    expect(pinMatches).toHaveLength(17);
  });
});
