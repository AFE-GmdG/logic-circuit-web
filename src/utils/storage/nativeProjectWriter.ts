import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitShape from "../../types/circuit/circuitShape";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Constant from "../../types/circuit/constant";
import type Gate from "../../types/circuit/gate";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type Pin from "../../types/circuit/pin";
import type PinSide from "../../types/circuit/pinSide";
import type ProbeFormat from "../../types/circuit/probeFormat";
import type Sensor from "../../types/circuit/sensor";
import type Sound from "../../types/circuit/sound";
import type Splitter from "../../types/circuit/splitter";
import type Synthesizer from "../../types/circuit/synthesizer";
import type TextNote from "../../types/circuit/textNote";
import type Wire from "../../types/circuit/wire";
import type NativeProjectDocument from "../../types/storage/nativeProjectFormat";
import type {
  NativeCircuitElement,
  NativeLogicalCircuit,
  NativePinElement,
  NativeSnippetDocument,
  NativeTextNote,
  NativeWire,
} from "../../types/storage/nativeProjectFormat";
import {
  NATIVE_PROJECT_FILE_EXTENSION,
  NATIVE_PROJECT_FORMAT,
  NATIVE_PROJECT_SCHEMA_VERSION,
  NATIVE_SNIPPET_FORMAT,
} from "../../types/storage/nativeProjectFormat";

import { SOUND_WEB_DEFAULTS } from "../xml/logicCircuitXmlConstants";

export type NativeProjectSerializeOptions = {
  pretty?: boolean;
  appVersion?: string;
};

const FALLBACK_APP_VERSION = "0.0.0-dev";

export function resolveNativeAppVersion(override?: string): string {
  if (override && override.trim() !== "") {
    return override.trim();
  }
  const envVersion = typeof process.env.VERSION === "string" ? process.env.VERSION.trim() : "";
  if (envVersion !== "") {
    return envVersion;
  }
  return FALLBACK_APP_VERSION;
}

// Fügt eindeutige Einträge nach ID zusammen (Schaltplan-Listen haben Vorrang vor Projekt-Listen)
function mergeUniqueById<T>(primary: T[], secondary: T[], getId: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of primary) {
    const id = getId(item);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(item);
    }
  }
  for (const item of secondary) {
    const id = getId(item);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(item);
    }
  }
  return result;
}

export function serializePinSymbol(
  sym: CircuitSymbol,
  pinById: ReadonlyMap<string, Pin>,
): NativePinElement {
  const pin = pinById.get(sym.circuit.circuitId) ?? pinById.get(sym.circuitId);
  const internalPin = sym.circuit.pins[0];
  const fallbackPinType: "input" | "output" = internalPin?.pinType === "input" ? "output" : "input";
  const pinType: "input" | "output" = pin
    ? (pin.pinType === "output" ? "output" : "input")
    : fallbackPinType;
  const fallbackSide: PinSide = pinType === "input" ? "left" : "right";

  return {
    symbolId: sym.circuitSymbolId,
    x: sym.x,
    y: sym.y,
    rotation: sym.rotation,
    pinId: pin?.pinId ?? sym.circuit.circuitId,
    name: pin?.name ?? sym.circuit.name,
    jamNotation: pin?.jamNotation ?? internalPin?.jamNotation ?? "",
    note: pin?.note ?? sym.circuit.note ?? "",
    pinType,
    pinSide: pin?.pinSide ?? fallbackSide,
    bitWidth: pin?.bitWidth ?? internalPin?.bitWidth ?? 1,
    inverted: pin?.inverted ?? internalPin?.inverted ?? false,
    index: pin?.index ?? 0,
    width: sym.circuit.symbolWidth,
    height: sym.circuit.symbolHeight,
  };
}

export function serializeCircuitElement(sym: CircuitSymbol): NativeCircuitElement | null {
  const base = {
    symbolId: sym.circuitSymbolId,
    x: sym.x,
    y: sym.y,
    rotation: sym.rotation,
  };

  switch (sym.circuit.kind) {
    case "gate": {
      const gate = sym.circuit as Gate;
      return {
        ...base,
        kind: "gate",
        gateType: gate.gateType,
        inputCount: gate.inputCount,
        invertedOutput: gate.invertedOutput,
        color: gate.gateType === "led" ? (gate.color ?? "red") : null,
        note: gate.note ?? "",
      };
    }

    case "logicalCircuit": {
      const subLc = sym.circuit as LogicalCircuit;
      return {
        ...base,
        kind: "subCircuit",
        logicalCircuitId: subLc.logicalCircuitId ?? sym.circuitId,
      };
    }

    case "circuitButton": {
      const button = sym.circuit as CircuitButton;
      return {
        ...base,
        kind: "circuitButton",
        componentId: button.circuitButtonId,
        name: button.name,
        notation: button.notation,
        note: button.note,
        isToggle: button.isToggle,
        pinSide: button.pinSide,
        inverted: button.inverted,
        width: button.width,
        height: button.height,
        modifiers: button.modifiers,
        keyCode: button.keyCode,
      };
    }

    case "constant": {
      const constant = sym.circuit as Constant;
      return {
        ...base,
        kind: "constant",
        componentId: constant.constantId,
        bitWidth: constant.bitWidth,
        value: constant.value,
        pinSide: constant.pinSide,
        isHex: constant.isHex ?? true,
        width: constant.symbolWidth,
        height: constant.symbolHeight,
        note: constant.note,
      };
    }

    case "circuitProbe": {
      const probe = sym.circuit as CircuitProbe;
      const rawName = probe.name.trim();
      const isUnnamed = rawName === "" || rawName.toLowerCase() === probe.circuitProbeId.toLowerCase();
      const displayFormat: ProbeFormat = probe.displayFormat ?? (probe.isHex ? "hex" : "bin");
      return {
        ...base,
        kind: "circuitProbe",
        componentId: probe.circuitProbeId,
        name: isUnnamed ? "" : rawName,
        pinSide: probe.pinSide,
        displayFormat,
        isHex: displayFormat === "hex",
        width: probe.symbolWidth,
        height: probe.symbolHeight,
        note: probe.note,
      };
    }

    case "splitter": {
      const splitter = sym.circuit as Splitter;
      return {
        ...base,
        kind: "splitter",
        componentId: splitter.splitterId,
        bitWidth: splitter.bitWidth,
        pinCount: splitter.pinCount,
        clockwise: splitter.clockwise,
        note: splitter.note,
      };
    }

    case "memory": {
      const memory = sym.circuit as Memory;
      return {
        ...base,
        kind: "memory",
        componentId: memory.memoryId,
        writable: memory.writable,
        writeOn1: memory.writeOn1,
        onStart: memory.onStart,
        addressBitWidth: memory.addressBitWidth,
        dataBitWidth: memory.dataBitWidth,
        dualPort: memory.dualPort,
        data: memory.data,
        note: memory.note,
      };
    }

    case "ledMatrix": {
      const matrix = sym.circuit as LedMatrix;
      return {
        ...base,
        kind: "ledMatrix",
        componentId: matrix.ledMatrixId,
        name: matrix.name,
        matrixType: matrix.matrixType,
        cellShape: matrix.cellShape,
        rows: matrix.rows,
        columns: matrix.columns,
        colors: matrix.colors,
        persistenceMultiplier: matrix.persistenceMultiplier ?? 1,
        note: matrix.note,
      };
    }

    case "sensor": {
      const sensor = sym.circuit as Sensor;
      return {
        ...base,
        kind: "sensor",
        componentId: sensor.sensorId,
        sensorType: sensor.sensorType,
        bitWidth: sensor.bitWidth,
        pinSide: sensor.pinSide,
        notation: sensor.notation,
        data: sensor.data,
        note: sensor.note,
      };
    }

    case "sound": {
      const sound = sym.circuit as Sound;
      return {
        ...base,
        kind: "sound",
        componentId: sound.soundId,
        pinSide: sound.pinSide,
        notation: sound.notation,
        note: sound.note,
        frequency: sound.frequency ?? SOUND_WEB_DEFAULTS.frequency,
        waveform: sound.waveform ?? SOUND_WEB_DEFAULTS.waveform,
      };
    }

    case "synthesizer": {
      const synth = sym.circuit as Synthesizer;
      return {
        ...base,
        kind: "synthesizer",
        componentId: synth.synthesizerId,
        notation: synth.notation,
        note: synth.note,
        mode: synth.mode,
      };
    }

    case "graphicsArray": {
      const ga = sym.circuit as GraphicsArray;
      return {
        ...base,
        kind: "graphicsArray",
        componentId: ga.graphicsArrayId,
        writeOn1: ga.writeOn1,
        onStart: ga.onStart,
        dataBitWidth: ga.dataBitWidth,
        bitsPerPixel: ga.bitsPerPixel,
        width: ga.width,
        height: ga.height,
        zoom: ga.zoom,
        note: ga.note,
      };
    }

    default:
      return null;
  }
}

export function serializeWire(wire: Wire): NativeWire | null {
  if (wire.x1 === wire.x2 && wire.y1 === wire.y2) {
    return null;
  }
  return {
    wireId: wire.wireId,
    x1: wire.x1,
    y1: wire.y1,
    x2: wire.x2,
    y2: wire.y2,
  };
}

export function serializeTextNote(note: TextNote): NativeTextNote {
  return {
    textNoteId: note.textNoteId,
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    note: note.note,
    rotation: note.rotation,
    lineHeight: note.lineHeight ?? 18,
    fontFamily: note.fontFamily ?? "mono",
    lineHeights: note.lineHeights && note.lineHeights.length > 0 ? [...note.lineHeights] : null,
  };
}

export function serializeLogicalCircuitToNative(
  lc: LogicalCircuit,
  project: CircuitProject,
  overrideEntities?: {
    symbols: CircuitSymbol[];
    wires: Wire[];
    textNotes: TextNote[];
  },
): NativeLogicalCircuit {
  const symbols = overrideEntities
    ? overrideEntities.symbols
    : mergeUniqueById(
      lc.circuitSymbols,
      project.circuitSymbols.filter((s) => s.logicalCircuitId === lc.logicalCircuitId),
      (s) => s.circuitSymbolId,
    );

  const wires = overrideEntities
    ? overrideEntities.wires
    : mergeUniqueById(
      lc.wires,
      project.wires.filter((w) => w.logicalCircuitId === lc.logicalCircuitId),
      (w) => w.wireId,
    );

  const textNotes = overrideEntities
    ? overrideEntities.textNotes
    : mergeUniqueById(
      lc.textNotes,
      project.textNotes.filter((n) => n.logicalCircuitId === lc.logicalCircuitId),
      (n) => n.textNoteId,
    );

  // Schaltplan-eigene Pins überschreiben Projekt-Array bei abweichendem Stand
  const pinById = new Map<string, Pin>();
  for (const pin of project.pins) {
    if (pin.circuitId === lc.logicalCircuitId) {
      pinById.set(pin.pinId, pin);
    }
  }
  for (const pin of lc.logicalPins) {
    pinById.set(pin.pinId, pin);
  }

  const pins: NativePinElement[] = [];
  const elements: NativeCircuitElement[] = [];

  for (const sym of symbols) {
    if (sym.circuit.kind === "pin") {
      pins.push(serializePinSymbol(sym, pinById));
    } else {
      const element = serializeCircuitElement(sym);
      if (element) {
        elements.push(element);
      }
    }
  }

  const serializedWires: NativeWire[] = [];
  for (const wire of wires) {
    const serialized = serializeWire(wire);
    if (serialized) {
      serializedWires.push(serialized);
    }
  }

  const effectiveShape: CircuitShape =
    lc.circuitShape === "rectangular" && lc.isDisplay ? "display" : lc.circuitShape;

  return {
    logicalCircuitId: lc.logicalCircuitId,
    name: lc.name,
    notation: lc.notation,
    note: lc.note,
    category: lc.category,
    circuitShape: effectiveShape,
    showLabelAbove: Boolean(lc.showLabelAbove),
    displayMargin: lc.displayMargin ?? "none",
    validators: lc.validators,
    exportToHDL: Boolean(lc.exportToHDL),
    pins,
    elements,
    wires: serializedWires,
    textNotes: textNotes.map(serializeTextNote),
  };
}

// Überführt ein vollständiges CircuitProject explizit in die versionierte NativeProjectDocument-Struktur
export function buildNativeProjectDocument(
  project: CircuitProject,
  options?: NativeProjectSerializeOptions,
): NativeProjectDocument {
  const seenCategories = new Set<string>();
  const collapsedCategories: string[] = [];
  for (const entry of project.collapsedCategories) {
    if (entry.name && !seenCategories.has(entry.name)) {
      seenCategories.add(entry.name);
      collapsedCategories.push(entry.name);
    }
  }

  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    appVersion: resolveNativeAppVersion(options?.appVersion),
    project: {
      projectId: project.project.projectId,
      name: project.project.name,
      note: project.project.note,
      zoom: project.project.zoom,
      frequency: project.project.frequency,
      isMaximumSpeed: Boolean(project.project.isMaximumSpeed),
      logicalCircuitId: project.project.logicalCircuitId,
      startupCircuitId: project.project.startupCircuitId ?? null,
      categoryTextNoteCollapsed: Boolean(project.project.categoryTextNoteCollapsed),
      categoryInputOutputCollapsed: Boolean(project.project.categoryInputOutputCollapsed),
      categoryPrimitivesCollapsed: Boolean(project.project.categoryPrimitivesCollapsed),
    },
    collapsedCategories,
    logicalCircuits: project.logicalCircuits.map((lc) => serializeLogicalCircuitToNative(lc, project)),
  };
}

// Erstellt aus nativen Schaltplänen und einer Einstiegs-Schaltung ein vollständiges NativeProjectDocument
export function buildNativeProjectDocumentFromCircuits(
  logicalCircuits: NativeLogicalCircuit[],
  rootCircuitId: string,
  options?: NativeProjectSerializeOptions & {
    projectId?: string;
    projectName?: string;
    projectNote?: string;
  },
): NativeProjectDocument {
  const rootCircuit = logicalCircuits.find((lc) => lc.logicalCircuitId === rootCircuitId);
  if (!rootCircuit) {
    throw new Error(`Schaltplan "${rootCircuitId}" wurde nicht gefunden.`);
  }

  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    appVersion: resolveNativeAppVersion(options?.appVersion),
    project: {
      projectId: options?.projectId ?? rootCircuit.logicalCircuitId,
      name: options?.projectName ?? rootCircuit.name,
      note: options?.projectNote ?? rootCircuit.note,
      zoom: 1,
      frequency: 10,
      isMaximumSpeed: false,
      logicalCircuitId: rootCircuit.logicalCircuitId,
      startupCircuitId: null,
      categoryTextNoteCollapsed: false,
      categoryInputOutputCollapsed: false,
      categoryPrimitivesCollapsed: false,
    },
    collapsedCategories: [],
    logicalCircuits,
  };
}

// Serialisiert ein vollständiges CircuitProject als natives Web-JSON (*.lcweb)
export function serializeNativeProject(
  project: CircuitProject,
  options?: NativeProjectSerializeOptions,
): string {
  const doc = buildNativeProjectDocument(project, options);
  const indent = options?.pretty === false ? undefined : 2;
  return JSON.stringify(doc, null, indent);
}

// Überführt eine ausgewählte Teilmenge (inkl. transitiv referenzierter Subschaltungen) in ein NativeSnippetDocument
export function buildNativeSelectionDocument(
  project: CircuitProject,
  circuit: LogicalCircuit,
  symbolIds: string[],
  wireIds: string[],
  textNoteIds: string[],
  options?: NativeProjectSerializeOptions,
): NativeSnippetDocument {
  const symbolIdSet = new Set(symbolIds);
  const wireIdSet = new Set(wireIds);
  const noteIdSet = new Set(textNoteIds);

  const allCircuitSymbols = mergeUniqueById(
    circuit.circuitSymbols,
    project.circuitSymbols.filter((s) => s.logicalCircuitId === circuit.logicalCircuitId),
    (s) => s.circuitSymbolId,
  );
  const allCircuitWires = mergeUniqueById(
    circuit.wires,
    project.wires.filter((w) => w.logicalCircuitId === circuit.logicalCircuitId),
    (w) => w.wireId,
  );
  const allCircuitNotes = mergeUniqueById(
    circuit.textNotes,
    project.textNotes.filter((n) => n.logicalCircuitId === circuit.logicalCircuitId),
    (n) => n.textNoteId,
  );

  const selectedSymbols = allCircuitSymbols.filter((s) => symbolIdSet.has(s.circuitSymbolId));
  const selectedWires = allCircuitWires.filter((w) => wireIdSet.has(w.wireId));
  const selectedNotes = allCircuitNotes.filter((n) => noteIdSet.has(n.textNoteId));

  const logicalCircuitById = new Map(
    project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
  );

  const collectedSubCircuits: LogicalCircuit[] = [];
  const visitedSubCircuitIds = new Set<string>([circuit.logicalCircuitId]);

  const collectTransitiveSubCircuits = (symbols: CircuitSymbol[]): void => {
    for (const sym of symbols) {
      if (sym.circuit.kind !== "logicalCircuit") {
        continue;
      }
      const subId = (sym.circuit as LogicalCircuit).logicalCircuitId ?? sym.circuitId;
      if (visitedSubCircuitIds.has(subId)) {
        continue;
      }
      visitedSubCircuitIds.add(subId);
      const subLc = logicalCircuitById.get(subId) ?? (sym.circuit as LogicalCircuit);
      collectedSubCircuits.push(subLc);

      const subSymbols = mergeUniqueById(
        subLc.circuitSymbols,
        project.circuitSymbols.filter((s) => s.logicalCircuitId === subLc.logicalCircuitId),
        (s) => s.circuitSymbolId,
      );
      collectTransitiveSubCircuits(subSymbols);
    }
  };

  collectTransitiveSubCircuits(selectedSymbols);

  const rootSnippetCircuit = serializeLogicalCircuitToNative(circuit, project, {
    symbols: selectedSymbols,
    wires: selectedWires,
    textNotes: selectedNotes,
  });

  const subSnippetCircuits = collectedSubCircuits.map((subLc) => serializeLogicalCircuitToNative(subLc, project));

  return {
    format: NATIVE_SNIPPET_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    appVersion: resolveNativeAppVersion(options?.appVersion),
    rootCircuitId: circuit.logicalCircuitId,
    logicalCircuits: [rootSnippetCircuit, ...subSnippetCircuits],
  };
}

// Serialisiert eine Teilauswahl für Copy/Cut/Paste im nativen Web-JSON-Format
export function serializeNativeSelection(
  project: CircuitProject,
  circuit: LogicalCircuit,
  symbolIds: string[],
  wireIds: string[],
  textNoteIds: string[],
  options?: NativeProjectSerializeOptions,
): string {
  const doc = buildNativeSelectionDocument(project, circuit, symbolIds, wireIds, textNoteIds, options);
  const indent = options?.pretty === false ? undefined : 2;
  return JSON.stringify(doc, null, indent);
}

// Erzeugt einen sicheren Dateinamen im Format <projektname>.lcweb
export function buildNativeProjectFileName(projectName: string): string {
  const sanitized = projectName.trim().replace(/[/\\?%*:|"<>]/g, "_");
  const withoutKnownExtension = sanitized
    .replace(/\.(lcweb|circuitproject|xml|json)$/i, "")
    .trim();
  const baseName = withoutKnownExtension.length > 0 ? withoutKnownExtension : "CircuitProject";
  return `${baseName}${NATIVE_PROJECT_FILE_EXTENSION}`;
}

// Löst im Browser den Datei-Download der aktuellen Schaltung im nativen Web-Format (.lcweb) aus
export function downloadNativeProject(project: CircuitProject): string {
  const jsonText = serializeNativeProject(project);
  const fileName = buildNativeProjectFileName(project.project.name);

  if (typeof document !== "undefined" && typeof URL !== "undefined") {
    const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }

  return jsonText;
}
