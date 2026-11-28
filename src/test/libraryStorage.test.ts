import { describe, expect, it } from "vitest";

import type CircuitLibraryDocument from "../types/storage/circuitLibrary";
import {
  LIBRARY_FILE_EXTENSION,
  LIBRARY_FORMAT,
} from "../types/storage/circuitLibrary";
import type { NativeLogicalCircuit } from "../types/storage/nativeProjectFormat";
import { NATIVE_PROJECT_SCHEMA_VERSION } from "../types/storage/nativeProjectFormat";

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
  FileSystemPickerWindow,
  LibraryCacheRecord,
  LibraryHandleRecord,
  LibraryStoreAdapter,
} from "../utils/fileSystemStorage";
import {
  buildCircuitLibraryDocument,
  buildLibraryFileName,
  collectTransitiveNativeCircuits,
  createAndLinkLibraryFile,
  exportLibraryCircuitAsDesktopXml,
  exportLibraryCircuitAsNativeProject,
  importCircuitsFromFileText,
  importCircuitsFromProjectText,
  isCircuitLibraryJson,
  isSupportedLibraryFile,
  listProjectCircuitCandidates,
  loadInitialLibraryState,
  openAndLinkLibraryFile,
  parseCircuitLibraryDocument,
  resyncLibraryWithPermission,
  saveLibraryDocumentToLinkedFile,
  serializeCircuitLibrary,
  unlinkLibraryFile,
} from "../utils/libraryStorage";
import { parseNativeProject } from "../utils/storage/nativeProjectReader";
import { buildNativeProjectDocument, serializeNativeProject } from "../utils/storage/nativeProjectWriter";
import { createWire } from "../utils/wireUtils";
import { importProjectFromXml } from "../utils/xml/logicCircuitXmlReader";
import { serializeCircuitProjectToXml } from "../utils/xml/logicCircuitXmlWriter";

function createMemoryLibraryStore(): LibraryStoreAdapter {
  let libraryHandle: LibraryHandleRecord | null = null;
  let libraryCache: LibraryCacheRecord | null = null;

  return {
    async getLibraryHandle() {
      return libraryHandle;
    },
    async putLibraryHandle(record) {
      libraryHandle = record;
    },
    async getLibraryCache() {
      return libraryCache;
    },
    async putLibraryCache(record) {
      libraryCache = record;
    },
  };
}

function createMockLibraryFileHandle(
  name: string,
  initialContent: string,
  initialPermission: "granted" | "prompt" | "denied" = "granted",
): {
  handle: FileSystemFileHandleLike;
  getContent: () => string;
  setContent: (next: string) => void;
  setPermission: (next: "granted" | "prompt" | "denied") => void;
  setRequestResult: (next: "granted" | "prompt" | "denied") => void;
} {
  let content = initialContent;
  let queryPerm = initialPermission;
  let requestPerm = initialPermission;

  const handle: FileSystemFileHandleLike = {
    kind: "file",
    name,
    async queryPermission() {
      return queryPerm;
    },
    async requestPermission() {
      queryPerm = requestPerm;
      return requestPerm;
    },
    async getFile() {
      return {
        name,
        text: async () => content,
      } as unknown as File;
    },
    async createWritable() {
      let buffer = "";
      return {
        async write(data) {
          buffer = typeof data === "string" ? data : String(data);
        },
        async close() {
          content = buffer;
        },
      };
    },
  };

  return {
    handle,
    getContent: () => content,
    setContent: (next) => {
      content = next;
    },
    setPermission: (next) => {
      queryPerm = next;
      requestPerm = next;
    },
    setRequestResult: (next) => {
      requestPerm = next;
    },
  };
}

function createSampleHierarchyCircuits(): {
  mainId: string;
  powerId: string;
  ledId: string;
  extraId: string;
  nativeProjectJson: string;
  desktopXml: string;
  nativeCircuits: NativeLogicalCircuit[];
} {
  const mainId = "10000000-0000-4000-8000-000000000001";
  const ledId = "10000000-0000-4000-8000-000000000002";
  const powerId = "10000000-0000-4000-8000-000000000003";
  const extraId = "10000000-0000-4000-8000-000000000004";
  const projectId = "10000000-0000-4000-8000-000000000010";

  const project = createEmptyCircuitProject("Sample Project", "Main", mainId, projectId);
  const mainLc = project.logicalCircuits[0];

  const ledLc = createDefaultLogicalCircuit(ledId, "Tri State LED (Right)", "Display");
  const { pin: ledIn, pinCircuit: ledInCircuit } = createPinCircuit(
    "20000000-0000-4000-8000-000000000001",
    ledLc.logicalCircuitId,
    "input",
    "X0",
    1,
    "left",
    false,
    0,
  );
  const ledGate = createGate("led", 1, false, "green");
  const ledPinSym = createCircuitSymbol(
    ledInCircuit,
    ledLc.logicalCircuitId,
    4,
    4,
    "up",
    "30000000-0000-4000-8000-000000000001",
  );
  const ledGateSym = createCircuitSymbol(
    ledGate,
    ledLc.logicalCircuitId,
    10,
    4,
    "up",
    "30000000-0000-4000-8000-000000000002",
  );
  const ledWire = createWire(
    ledLc.logicalCircuitId,
    { x: 6, y: 5 },
    { x: 10, y: 5 },
    "40000000-0000-4000-8000-000000000001",
  );
  ledLc.logicalPins = [ledIn];
  ledLc.circuitSymbols = [ledPinSym, ledGateSym];
  ledLc.wires = [ledWire];

  const powerLc = createDefaultLogicalCircuit(powerId, "Power", "Control", "Power supply block");
  const { pin: powerIn, pinCircuit: powerInCircuit } = createPinCircuit(
    "20000000-0000-4000-8000-000000000002",
    powerLc.logicalCircuitId,
    "input",
    "En",
    1,
    "left",
    false,
    0,
  );
  const powerPinSym = createCircuitSymbol(
    powerInCircuit,
    powerLc.logicalCircuitId,
    4,
    4,
    "up",
    "30000000-0000-4000-8000-000000000003",
  );
  const subLedSym = createCircuitSymbol(
    ledLc,
    powerLc.logicalCircuitId,
    10,
    4,
    "up",
    "30000000-0000-4000-8000-000000000004",
  );
  const powerWire = createWire(
    powerLc.logicalCircuitId,
    { x: 6, y: 5 },
    { x: 10, y: 5 },
    "40000000-0000-4000-8000-000000000002",
  );
  powerLc.logicalPins = [powerIn];
  powerLc.circuitSymbols = [powerPinSym, subLedSym];
  powerLc.wires = [powerWire];

  const extraLc = createDefaultLogicalCircuit(extraId, "ExtraNotGate", "Gates");
  const notGate = createGate("not", 1, true);
  const extraGateSym = createCircuitSymbol(
    notGate,
    extraLc.logicalCircuitId,
    8,
    4,
    "up",
    "30000000-0000-4000-8000-000000000005",
  );
  extraLc.circuitSymbols = [extraGateSym];

  const mainSubSym = createCircuitSymbol(
    powerLc,
    mainLc.logicalCircuitId,
    8,
    6,
    "up",
    "30000000-0000-4000-8000-000000000006",
  );
  mainLc.circuitSymbols = [mainSubSym];

  project.logicalCircuits.push(powerLc, ledLc, extraLc);
  project.circuits.set(powerLc.circuitId, powerLc);
  project.circuits.set(ledLc.circuitId, ledLc);
  project.circuits.set(extraLc.circuitId, extraLc);
  project.circuits.set(ledInCircuit.circuitId, ledInCircuit);
  project.circuits.set(powerInCircuit.circuitId, powerInCircuit);
  project.circuits.set(ledGate.circuitId, ledGate);
  project.circuits.set(notGate.circuitId, notGate);
  project.pins.push(ledIn, powerIn);
  project.circuitSymbols.push(mainSubSym, powerPinSym, subLedSym, ledPinSym, ledGateSym, extraGateSym);
  project.wires.push(ledWire, powerWire);

  const nativeDoc = buildNativeProjectDocument(project);

  return {
    mainId: mainLc.logicalCircuitId,
    powerId: powerLc.logicalCircuitId,
    ledId: ledLc.logicalCircuitId,
    extraId: extraLc.logicalCircuitId,
    nativeProjectJson: serializeNativeProject(project),
    desktopXml: serializeCircuitProjectToXml(project),
    nativeCircuits: nativeDoc.logicalCircuits,
  };
}

describe("T-080: Schaltungs-Bibliothek Datenmodell, FSA-Persistenz & Austausch", () => {
  it("serialisiert und validiert flache .lclib-Bibliotheksdokumente mit gemeinsamer Schema-Version", () => {
    const sample = createSampleHierarchyCircuits();
    const powerAndLed = collectTransitiveNativeCircuits(sample.nativeCircuits, [sample.powerId]);

    expect(powerAndLed.map((lc) => lc.logicalCircuitId)).toEqual([sample.powerId, sample.ledId]);

    const doc: CircuitLibraryDocument = buildCircuitLibraryDocument(powerAndLed, { appVersion: "1.2.0" });
    expect(doc.format).toBe(LIBRARY_FORMAT);
    expect(doc.schemaVersion).toBe(NATIVE_PROJECT_SCHEMA_VERSION);
    expect(doc.logicalCircuits).toHaveLength(2);

    const json = serializeCircuitLibrary(doc);
    expect(isCircuitLibraryJson(json)).toBe(true);
    expect(isCircuitLibraryJson(sample.nativeProjectJson)).toBe(false);

    const parsed = parseCircuitLibraryDocument(json);
    expect(parsed).toEqual(doc);

    const emptyJson = serializeCircuitLibrary([]);
    const emptyParsed = parseCircuitLibraryDocument(emptyJson);
    expect(emptyParsed.logicalCircuits).toEqual([]);

    expect(isSupportedLibraryFile(`my-lib${LIBRARY_FILE_EXTENSION}`)).toBe(true);
    expect(isSupportedLibraryFile("my-lib.json")).toBe(true);
    expect(isSupportedLibraryFile("my-project.lcweb")).toBe(false);
    expect(buildLibraryFileName("Mein Ordner/Test?.lcweb")).toBe("Mein Ordner_Test_.lclib");
    expect(buildLibraryFileName("   ")).toBe("CircuitLibrary.lclib");
  });

  it("lehnt ungültige Bibliotheksformate, fehlende Subschaltungs-Referenzen und Zyklen ab", () => {
    const sample = createSampleHierarchyCircuits();

    expect(() => parseCircuitLibraryDocument(sample.nativeProjectJson)).toThrow(/Nicht unterstütztes Dateiformat/);

    const powerOnly = sample.nativeCircuits.filter((lc) => lc.logicalCircuitId === sample.powerId);
    const brokenJson = serializeCircuitLibrary(powerOnly);
    expect(() => parseCircuitLibraryDocument(brokenJson)).toThrow(/Ungültige Subschaltungs-Referenz/);

    const power = structuredClone(powerOnly[0]);
    const led = structuredClone(sample.nativeCircuits.find((lc) => lc.logicalCircuitId === sample.ledId)!);
    led.elements.push({
      symbolId: "sym-cycle-back",
      x: 2,
      y: 2,
      rotation: "up",
      kind: "subCircuit",
      logicalCircuitId: power.logicalCircuitId,
    });
    const cyclicJson = serializeCircuitLibrary([power, led]);
    expect(() => parseCircuitLibraryDocument(cyclicJson)).toThrow(/Zyklische Subschaltungs-Referenz/);
  });

  it("liefert ohne Handle und ohne Cache den Zustand uninitialized und verhindert reine Cache-Schreibvorgänge", async () => {
    const libraryStore = createMemoryLibraryStore();
    const win: FileSystemPickerWindow = {
      showOpenFilePicker: async () => [],
      showSaveFilePicker: async () => createMockLibraryFileHandle("x.lclib", "").handle,
      showDirectoryPicker: async () => ({ kind: "directory", name: "dir" }),
    };
    const deps: FileSystemDeps = { win, libraryStore };

    const initial = await loadInitialLibraryState(deps);
    expect(initial.status).toBe("uninitialized");
    expect(initial.isReadOnly).toBe(true);
    expect(initial.document).toBeNull();

    const doc = buildCircuitLibraryDocument([]);
    const writeAttempt = await saveLibraryDocumentToLinkedFile(doc, undefined, deps);
    expect(writeAttempt.status).toBe("uninitialized");
    expect(writeAttempt.isReadOnly).toBe(true);
    expect(await libraryStore.getLibraryCache()).toBeNull();
  });

  it("persistiert Handle + Read-Only-Cache via FSA, erzwingt Read-Only bei prompt und überschreibt Cache beim Resync mit Datei", async () => {
    const sample = createSampleHierarchyCircuits();
    const initialCircuits = collectTransitiveNativeCircuits(sample.nativeCircuits, [sample.powerId]);
    const initialDoc = buildCircuitLibraryDocument(initialCircuits, { appVersion: "1.2.0" });

    const mockFile = createMockLibraryFileHandle("standard.lclib", "", "granted");
    const libraryStore = createMemoryLibraryStore();
    const win: FileSystemPickerWindow = {
      showOpenFilePicker: async () => [mockFile.handle],
      showSaveFilePicker: async () => mockFile.handle,
      showDirectoryPicker: async () => ({ kind: "directory", name: "dir" }),
    };
    const deps: FileSystemDeps = { win, libraryStore };

    // Neue Bibliothek anlegen und verknüpfen
    const created = await createAndLinkLibraryFile(
      { suggestedName: "standard", initialDocument: initialDoc },
      deps,
    );
    expect(created.status).toBe("synced");
    if (created.status !== "synced") {
      throw new Error("Expected synced library state");
    }
    expect(created.isReadOnly).toBe(false);
    expect(created.fileName).toBe("standard.lclib");
    expect(created.document?.logicalCircuits).toHaveLength(2);
    expect(parseCircuitLibraryDocument(mockFile.getContent()).logicalCircuits).toHaveLength(2);

    // Nach Page Reload steht Handle-Permission auf "prompt" -> Read-Only-Cache sofort lesbar
    mockFile.setPermission("prompt");
    const reloaded = await loadInitialLibraryState(deps);
    expect(reloaded.status).toBe("needs-permission");
    expect(reloaded.isReadOnly).toBe(true);
    expect(reloaded.document?.logicalCircuits.map((c) => c.name)).toEqual([
      "Power",
      "Tri State LED (Right)",
    ]);

    // Schreibversuch ohne erteilte Berechtigung wird blockiert und verändert weder Datei noch Cache
    const extraDoc = buildCircuitLibraryDocument(sample.nativeCircuits, { appVersion: "1.2.0" });
    const blockedSave = await saveLibraryDocumentToLinkedFile(extraDoc, { requestPermission: false }, deps);
    expect(blockedSave.status).toBe("needs-permission");
    expect(blockedSave.isReadOnly).toBe(true);
    expect(parseCircuitLibraryDocument(mockFile.getContent()).logicalCircuits).toHaveLength(2);

    // Externe Änderung auf Platte + 1-Klick-Resync -> Datei gewinnt immer und aktualisiert Cache
    mockFile.setContent(serializeCircuitLibrary(extraDoc));
    mockFile.setRequestResult("granted");
    const resynced = await resyncLibraryWithPermission(deps);
    expect(resynced.status).toBe("synced");
    expect(resynced.isReadOnly).toBe(false);
    expect(resynced.document?.logicalCircuits).toHaveLength(4);

    const updatedCache = await libraryStore.getLibraryCache();
    expect(updatedCache).not.toBeNull();
    expect(parseCircuitLibraryDocument(updatedCache!.content).logicalCircuits).toHaveLength(4);
  });

  it("öffnet bestehende Bibliotheken über Picker, unterstützt Read-Only-Fallback ohne FSA und trennt Handles sauber", async () => {
    const sample = createSampleHierarchyCircuits();
    const doc = buildCircuitLibraryDocument(
      collectTransitiveNativeCircuits(sample.nativeCircuits, [sample.powerId]),
      { appVersion: "1.2.0" },
    );
    const json = serializeCircuitLibrary(doc);

    const mockFile = createMockLibraryFileHandle("team-lib.lclib", json, "granted");
    const libraryStore = createMemoryLibraryStore();
    const fsaWin: FileSystemPickerWindow = {
      showOpenFilePicker: async () => [mockFile.handle],
      showSaveFilePicker: async () => mockFile.handle,
      showDirectoryPicker: async () => ({ kind: "directory", name: "dir" }),
    };

    const opened = await openAndLinkLibraryFile(undefined, { win: fsaWin, libraryStore });
    expect(opened.status).toBe("synced");
    if (opened.status === "synced") {
      expect(opened.isReadOnly).toBe(false);
      expect(opened.fileName).toBe("team-lib.lclib");
      expect(opened.document?.logicalCircuits).toHaveLength(2);
    }

    // In Browser ohne FSA bleibt der Cache als Read-Only ("unsupported") lesbar
    const noFsaState = await loadInitialLibraryState({ win: {}, libraryStore });
    expect(noFsaState.status).toBe("unsupported");
    expect(noFsaState.isReadOnly).toBe(true);
    expect(noFsaState.document?.logicalCircuits).toHaveLength(2);

    // Handle trennen mit Cache-Erhalt -> "handle-invalid" Read-Only; mit clearCache -> "uninitialized"
    const unlinkedKeepCache = await unlinkLibraryFile({ clearCache: false }, { win: fsaWin, libraryStore });
    expect(unlinkedKeepCache.status).toBe("handle-invalid");
    expect(unlinkedKeepCache.isReadOnly).toBe(true);
    expect(unlinkedKeepCache.document?.logicalCircuits).toHaveLength(2);

    const unlinkedCleared = await unlinkLibraryFile({ clearCache: true }, { win: fsaWin, libraryStore });
    expect(unlinkedCleared.status).toBe("uninitialized");
    expect(unlinkedCleared.document).toBeNull();
  });

  it("exportiert und importiert Bibliotheksschaltungen samt Sub-Schaltungen in .lcweb und .CircuitProject", () => {
    const sample = createSampleHierarchyCircuits();

    // Export einer einzelnen Bibliotheksschaltung ("Power") nach .lcweb inkl. "Tri State LED (Right)"
    const exportedNative = exportLibraryCircuitAsNativeProject(sample.nativeCircuits, sample.powerId);
    const reparsedNative = parseNativeProject(exportedNative);
    expect(reparsedNative.project.logicalCircuitId).toBe(sample.powerId);
    expect(reparsedNative.logicalCircuits.map((lc) => lc.name)).toEqual([
      "Power",
      "Tri State LED (Right)",
    ]);

    // Export nach .CircuitProject-XML
    const exportedXml = exportLibraryCircuitAsDesktopXml(sample.nativeCircuits, sample.powerId);
    const reparsedXml = importProjectFromXml(exportedXml);
    expect(reparsedXml.project.logicalCircuitId).toBe(sample.powerId);
    expect(reparsedXml.logicalCircuits.map((lc) => lc.name)).toEqual([
      "Power",
      "Tri State LED (Right)",
    ]);

    // Kandidaten-Inspektion und gezielter Import aus .lcweb und .CircuitProject
    const nativeCandidates = listProjectCircuitCandidates(sample.nativeProjectJson);
    const powerCandidate = nativeCandidates.find((c) => c.logicalCircuitId === sample.powerId);
    expect(powerCandidate?.isProjectRoot).toBe(false);
    expect(powerCandidate?.transitiveCircuitIds).toEqual([sample.powerId, sample.ledId]);

    const importedFromNative = importCircuitsFromProjectText(sample.nativeProjectJson, [sample.powerId]);
    expect(importedFromNative.map((lc) => lc.name)).toEqual(["Power", "Tri State LED (Right)"]);

    const xmlCandidates = listProjectCircuitCandidates(sample.desktopXml);
    expect(xmlCandidates.find((c) => c.name === "Main")?.isProjectRoot).toBe(true);
    const importedFromXml = importCircuitsFromFileText(sample.desktopXml, [sample.powerId]);
    expect(importedFromXml.sourceFormat).toBe("xml");
    expect(importedFromXml.logicalCircuits.map((lc) => lc.name)).toEqual([
      "Power",
      "Tri State LED (Right)",
    ]);

    const libText = serializeCircuitLibrary(sample.nativeCircuits);
    const importedFromLib = importCircuitsFromFileText(libText, [sample.powerId]);
    expect(importedFromLib.sourceFormat).toBe("library");
    expect(importedFromLib.logicalCircuits.map((lc) => lc.name)).toEqual([
      "Power",
      "Tri State LED (Right)",
    ]);
  });
});
