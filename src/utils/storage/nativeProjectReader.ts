import type Circuit from "../../types/circuit/circuit";
import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitShape from "../../types/circuit/circuitShape";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type CollapsedCategory from "../../types/circuit/collapsedCategory";
import type Constant from "../../types/circuit/constant";
import type DisplayColor from "../../types/circuit/displayColor";
import type DisplayMargin from "../../types/circuit/displayMargin";
import type Gate from "../../types/circuit/gate";
import type GateType from "../../types/circuit/gateType";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LedMatrixCellShape from "../../types/circuit/ledMatrixCellShape";
import type LedMatrixType from "../../types/circuit/ledMatrixType";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type MemoryOnStart from "../../types/circuit/memoryOnStart";
import type Pin from "../../types/circuit/pin";
import type PinSide from "../../types/circuit/pinSide";
import type ProbeFormat from "../../types/circuit/probeFormat";
import type Project from "../../types/circuit/project";
import type Rotation from "../../types/circuit/rotation";
import type Sensor from "../../types/circuit/sensor";
import type SensorType from "../../types/circuit/sensorType";
import type Sound from "../../types/circuit/sound";
import type SoundWaveform from "../../types/circuit/soundWaveform";
import type Splitter from "../../types/circuit/splitter";
import type Synthesizer from "../../types/circuit/synthesizer";
import type SynthesizerMode from "../../types/circuit/synthesizerMode";
import type TextNote from "../../types/circuit/textNote";
import type TextNoteFontFamily from "../../types/circuit/textNoteFontFamily";
import type TextNoteLineHeight from "../../types/circuit/textNoteLineHeight";
import type Wire from "../../types/circuit/wire";
import type NativeProjectDocument from "../../types/storage/nativeProjectFormat";
import type {
  NativeCircuitElement,
  NativeElementPlacement,
  NativeLogicalCircuit,
  NativePinElement,
  NativeProjectMeta,
  NativeSnippetDocument,
  NativeTextNote,
  NativeWire,
} from "../../types/storage/nativeProjectFormat";
import {
  NATIVE_PROJECT_FILE_EXTENSION,
  NATIVE_PROJECT_FORMAT,
  NATIVE_PROJECT_MIN_SCHEMA_VERSION,
  NATIVE_PROJECT_SCHEMA_VERSION,
  NATIVE_SNIPPET_FORMAT,
} from "../../types/storage/nativeProjectFormat";

import {
  BUTTON_MAX_GRID_SIZE,
  BUTTON_MIN_GRID_SIZE,
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createGate,
  createGraphicsArray,
  createLedMatrix,
  createMemory,
  createPinCircuit,
  createSensor,
  createSound,
  createSplitter,
  createSynthesizer,
  LED_MATRIX_MAX_DIM,
  LED_MATRIX_MIN_DIM,
  MAX_BIT_WIDTH,
  MAX_GATE_INPUT_COUNT,
  rebuildImportedProjectLayout,
  RESIZABLE_SYMBOL_MAX_GRID_SIZE,
  RESIZABLE_SYMBOL_MIN_GRID_SIZE,
} from "../circuitLayout";
import { createWire } from "../wireUtils";

const CIRCUIT_SHAPES: readonly CircuitShape[] = [
  "rectangular",
  "display",
  "mux",
  "demux",
  "alu",
  "flipFlop",
];
const DISPLAY_MARGINS: readonly DisplayMargin[] = ["none", "horizontal", "vertical", "all"];
const ROTATIONS: readonly Rotation[] = ["up", "right", "down", "left"];
const PIN_SIDES: readonly PinSide[] = ["left", "top", "right", "bottom"];
const PIN_DIRECTIONS: readonly ("input" | "output")[] = ["input", "output"];
const GATE_TYPES: readonly GateType[] = [
  "nop",
  "clock",
  "not",
  "or",
  "and",
  "xor",
  "led",
  "triState1",
  "triState2",
];
const DISPLAY_COLORS: readonly DisplayColor[] = ["red", "yellow", "green", "blue"];
const PROBE_FORMATS: readonly ProbeFormat[] = ["hex", "dec", "bin"];
const LED_MATRIX_TYPES: readonly LedMatrixType[] = ["individual", "selector"];
const LED_MATRIX_CELL_SHAPES: readonly LedMatrixCellShape[] = ["round", "rect"];
const MEMORY_ON_START_MODES: readonly MemoryOnStart[] = ["random", "zeros", "ones", "data"];
const SENSOR_TYPES: readonly SensorType[] = [
  "random",
  "manual",
  "series",
  "loop",
  "ascii",
  "keyCode",
  "sequence",
  "clock",
];
const SOUND_WAVEFORMS: readonly SoundWaveform[] = ["sine", "triangle", "square", "sawtooth"];
const SYNTHESIZER_MODES: readonly SynthesizerMode[] = [
  "sine",
  "triangle",
  "square",
  "sawtooth",
  "noise",
];
const TEXT_NOTE_FONT_FAMILIES: readonly TextNoteFontFamily[] = ["mono", "sans"];
const TEXT_NOTE_LINE_HEIGHTS: readonly TextNoteLineHeight[] = [9, 12, 18, 36];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error(`Ungültige Struktur in ${context}: Erwartet wurde ein JSON-Objekt.`);
  }
  return value;
}

function assertArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Ungültige Struktur in ${context}: Erwartet wurde ein JSON-Array.`);
  }
  return value;
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  context: string,
  allowEmpty = true,
): string {
  const val = obj[key];
  if (typeof val !== "string") {
    throw new Error(`Ungültiges Feld "${key}" in ${context}: Erwartet wurde ein String.`);
  }
  if (!allowEmpty && val.trim() === "") {
    throw new Error(`Ungültiges Feld "${key}" in ${context}: Der Wert darf nicht leer sein.`);
  }
  return val;
}

function readNullableNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): string | null {
  const val = obj[key];
  if (val === null) {
    return null;
  }
  if (typeof val !== "string" || val.trim() === "") {
    throw new Error(`Ungültiges Feld "${key}" in ${context}: Erwartet wurde ein nicht-leerer String oder null.`);
  }
  return val;
}

function readBoolean(obj: Record<string, unknown>, key: string, context: string): boolean {
  const val = obj[key];
  if (typeof val !== "boolean") {
    throw new Error(`Ungültiges Feld "${key}" in ${context}: Erwartet wurde ein Boolean.`);
  }
  return val;
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
  context: string,
  min?: number,
  max?: number,
): number {
  const val = obj[key];
  if (typeof val !== "number" || !Number.isFinite(val)) {
    throw new Error(`Ungültiges Feld "${key}" in ${context}: Erwartet wurde eine gültige Zahl.`);
  }
  if (min !== undefined && val < min) {
    throw new Error(`Ungültiges Feld "${key}" in ${context}: Wert ${val} liegt unter dem Minimum ${min}.`);
  }
  if (max !== undefined && val > max) {
    throw new Error(`Ungültiges Feld "${key}" in ${context}: Wert ${val} liegt über dem Maximum ${max}.`);
  }
  return val;
}

function readInteger(
  obj: Record<string, unknown>,
  key: string,
  context: string,
  min?: number,
  max?: number,
): number {
  const val = readNumber(obj, key, context, min, max);
  if (!Number.isInteger(val)) {
    throw new Error(`Ungültiges Feld "${key}" in ${context}: Erwartet wurde eine ganze Zahl.`);
  }
  return val;
}

function readEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  context: string,
): T {
  const val = obj[key];
  if (typeof val !== "string" || !allowed.includes(val as T)) {
    throw new Error(
      `Ungültiger Wert für "${key}" in ${context}: "${String(val)}". Erlaubt sind: ${allowed.join(", ")}.`,
    );
  }
  return val as T;
}

function readLineHeightValue(value: unknown, context: string): TextNoteLineHeight {
  if (
    typeof value !== "number" ||
    !TEXT_NOTE_LINE_HEIGHTS.includes(value as TextNoteLineHeight)
  ) {
    throw new Error(
      `Ungültige Zeilenhöhe "${String(value)}" in ${context}: Erlaubt sind ${TEXT_NOTE_LINE_HEIGHTS.join(", ")}.`,
    );
  }
  return value as TextNoteLineHeight;
}

function readNullableLineHeights(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): TextNoteLineHeight[] | null {
  const val = obj[key];
  if (val === null) {
    return null;
  }
  const items = assertArray(val, `${context}.${key}`);
  return items.map((item, idx) => readLineHeightValue(item, `${context}.${key}[${idx}]`));
}

function parseJsonObject(jsonText: string): Record<string, unknown> {
  if (!jsonText || !jsonText.trim()) {
    throw new Error("Die Projektdatei ist leer.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Syntaxfehler";
    throw new Error(`Ungültiges JSON-Projektformat: ${message}`);
  }
  if (!isPlainRecord(parsed)) {
    throw new Error("Ungültiges Projektformat: Das Wurzel-Dokument muss ein JSON-Objekt sein.");
  }
  return parsed;
}

function parseHeader(
  root: Record<string, unknown>,
  expectedFormats: readonly string[],
): { format: string; schemaVersion: typeof NATIVE_PROJECT_SCHEMA_VERSION; appVersion: string } {
  const rawFormat = root.format;
  if (typeof rawFormat !== "string" || !expectedFormats.includes(rawFormat)) {
    if (
      expectedFormats.length === 1 &&
      expectedFormats[0] === NATIVE_PROJECT_FORMAT &&
      rawFormat === NATIVE_SNIPPET_FORMAT
    ) {
      throw new Error(
        `Die Datei besitzt das Snippet-Format "${NATIVE_SNIPPET_FORMAT}" und kein vollständiges Projekt.`,
      );
    }
    throw new Error(
      `Nicht unterstütztes Dateiformat "${String(rawFormat ?? "(fehlend)")}". ` +
      `Erwartet wurde "${expectedFormats.join("\" oder \"")}".`,
    );
  }

  const rawVersion = root.schemaVersion;
  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion)) {
    throw new Error(
      `Fehlende oder ungültige Schema-Version "${String(rawVersion ?? "(fehlend)")}". ` +
      `Erwartet wurde Version ${NATIVE_PROJECT_SCHEMA_VERSION}.`,
    );
  }
  if (rawVersion > NATIVE_PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Nicht unterstützte Schema-Version ${rawVersion}: ` +
      `Diese Anwendung unterstützt maximal Version ${NATIVE_PROJECT_SCHEMA_VERSION}.`,
    );
  }
  if (rawVersion < NATIVE_PROJECT_MIN_SCHEMA_VERSION) {
    throw new Error(
      `Ungültige Schema-Version ${rawVersion}: ` +
      `Erwartet wurde mindestens Version ${NATIVE_PROJECT_MIN_SCHEMA_VERSION} (aktuell ${NATIVE_PROJECT_SCHEMA_VERSION}).`,
    );
  }

  const appVersion = readString(root, "appVersion", "Dokument-Header", false);

  return {
    format: rawFormat,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    appVersion,
  };
}

function parseProjectMeta(raw: unknown): NativeProjectMeta {
  const obj = assertRecord(raw, "project");
  return {
    projectId: readString(obj, "projectId", "project", false),
    name: readString(obj, "name", "project"),
    note: readString(obj, "note", "project"),
    zoom: readNumber(obj, "zoom", "project", 0.1, 3.0),
    frequency: readNumber(obj, "frequency", "project", 1, 60),
    isMaximumSpeed: readBoolean(obj, "isMaximumSpeed", "project"),
    logicalCircuitId: readString(obj, "logicalCircuitId", "project", false),
    startupCircuitId: readNullableNonEmptyString(obj, "startupCircuitId", "project"),
    categoryTextNoteCollapsed: readBoolean(obj, "categoryTextNoteCollapsed", "project"),
    categoryInputOutputCollapsed: readBoolean(obj, "categoryInputOutputCollapsed", "project"),
    categoryPrimitivesCollapsed: readBoolean(obj, "categoryPrimitivesCollapsed", "project"),
  };
}

function parsePlacement(obj: Record<string, unknown>, context: string): NativeElementPlacement {
  return {
    symbolId: readString(obj, "symbolId", context, false),
    x: readInteger(obj, "x", context),
    y: readInteger(obj, "y", context),
    rotation: readEnum(obj, "rotation", ROTATIONS, context),
  };
}

function parsePinElement(raw: unknown, context: string): NativePinElement {
  const obj = assertRecord(raw, context);
  const placement = parsePlacement(obj, context);
  return {
    ...placement,
    pinId: readString(obj, "pinId", context, false),
    name: readString(obj, "name", context),
    jamNotation: readString(obj, "jamNotation", context),
    note: readString(obj, "note", context),
    pinType: readEnum(obj, "pinType", PIN_DIRECTIONS, context),
    pinSide: readEnum(obj, "pinSide", PIN_SIDES, context),
    bitWidth: readInteger(obj, "bitWidth", context, 1, MAX_BIT_WIDTH),
    inverted: readBoolean(obj, "inverted", context),
    index: readInteger(obj, "index", context),
    width: readInteger(obj, "width", context, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
    height: readInteger(obj, "height", context, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
  };
}

function parseCircuitElement(raw: unknown, context: string): NativeCircuitElement {
  const obj = assertRecord(raw, context);
  const kind = readString(obj, "kind", context, false);
  const placement = parsePlacement(obj, context);

  switch (kind) {
    case "gate": {
      const gateType = readEnum(obj, "gateType", GATE_TYPES, context);
      const inputCount = readInteger(obj, "inputCount", context, 0, MAX_GATE_INPUT_COUNT);
      const invertedOutput = readBoolean(obj, "invertedOutput", context);
      let color: DisplayColor | null;
      if (gateType === "led") {
        color = readEnum(obj, "color", DISPLAY_COLORS, context);
      } else {
        if (obj.color !== null) {
          throw new Error(`Ungültiges Feld "color" in ${context}: Für Nicht-LED-Gatter muss "color" null sein.`);
        }
        color = null;
      }
      return {
        ...placement,
        kind: "gate",
        gateType,
        inputCount,
        invertedOutput,
        color,
        note: readString(obj, "note", context),
      };
    }

    case "subCircuit":
      return {
        ...placement,
        kind: "subCircuit",
        logicalCircuitId: readString(obj, "logicalCircuitId", context, false),
      };

    case "circuitButton":
      return {
        ...placement,
        kind: "circuitButton",
        componentId: readString(obj, "componentId", context, false),
        name: readString(obj, "name", context),
        notation: readString(obj, "notation", context),
        note: readString(obj, "note", context),
        isToggle: readBoolean(obj, "isToggle", context),
        pinSide: readEnum(obj, "pinSide", PIN_SIDES, context),
        inverted: readBoolean(obj, "inverted", context),
        width: readInteger(obj, "width", context, BUTTON_MIN_GRID_SIZE, BUTTON_MAX_GRID_SIZE),
        height: readInteger(obj, "height", context, BUTTON_MIN_GRID_SIZE, BUTTON_MAX_GRID_SIZE),
        modifiers: readInteger(obj, "modifiers", context),
        keyCode: readInteger(obj, "keyCode", context),
      };

    case "constant":
      return {
        ...placement,
        kind: "constant",
        componentId: readString(obj, "componentId", context, false),
        bitWidth: readInteger(obj, "bitWidth", context, 1, MAX_BIT_WIDTH),
        value: readInteger(obj, "value", context),
        pinSide: readEnum(obj, "pinSide", PIN_SIDES, context),
        isHex: readBoolean(obj, "isHex", context),
        width: readInteger(obj, "width", context, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
        height: readInteger(obj, "height", context, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
        note: readString(obj, "note", context),
      };

    case "circuitProbe":
      return {
        ...placement,
        kind: "circuitProbe",
        componentId: readString(obj, "componentId", context, false),
        name: readString(obj, "name", context),
        pinSide: readEnum(obj, "pinSide", PIN_SIDES, context),
        displayFormat: readEnum(obj, "displayFormat", PROBE_FORMATS, context),
        isHex: readBoolean(obj, "isHex", context),
        width: readInteger(obj, "width", context, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
        height: readInteger(obj, "height", context, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
        note: readString(obj, "note", context),
      };

    case "splitter": {
      const bitWidth = readInteger(obj, "bitWidth", context, 2, MAX_BIT_WIDTH);
      const pinCount = readInteger(obj, "pinCount", context, 2, bitWidth);
      return {
        ...placement,
        kind: "splitter",
        componentId: readString(obj, "componentId", context, false),
        bitWidth,
        pinCount,
        clockwise: readBoolean(obj, "clockwise", context),
        note: readString(obj, "note", context),
      };
    }

    case "memory":
      return {
        ...placement,
        kind: "memory",
        componentId: readString(obj, "componentId", context, false),
        writable: readBoolean(obj, "writable", context),
        writeOn1: readBoolean(obj, "writeOn1", context),
        onStart: readEnum(obj, "onStart", MEMORY_ON_START_MODES, context),
        addressBitWidth: readInteger(obj, "addressBitWidth", context, 1, 16),
        dataBitWidth: readInteger(obj, "dataBitWidth", context, 1, MAX_BIT_WIDTH),
        dualPort: readBoolean(obj, "dualPort", context),
        data: readString(obj, "data", context),
        note: readString(obj, "note", context),
      };

    case "ledMatrix": {
      const persistenceRaw = readInteger(obj, "persistenceMultiplier", context, 1, 3);
      return {
        ...placement,
        kind: "ledMatrix",
        componentId: readString(obj, "componentId", context, false),
        name: readString(obj, "name", context),
        matrixType: readEnum(obj, "matrixType", LED_MATRIX_TYPES, context),
        cellShape: readEnum(obj, "cellShape", LED_MATRIX_CELL_SHAPES, context),
        rows: readInteger(obj, "rows", context, LED_MATRIX_MIN_DIM, LED_MATRIX_MAX_DIM),
        columns: readInteger(obj, "columns", context, LED_MATRIX_MIN_DIM, LED_MATRIX_MAX_DIM),
        colors: readInteger(obj, "colors", context, 1, 3),
        persistenceMultiplier: persistenceRaw as 1 | 2 | 3,
        note: readString(obj, "note", context),
      };
    }

    case "sensor":
      return {
        ...placement,
        kind: "sensor",
        componentId: readString(obj, "componentId", context, false),
        sensorType: readEnum(obj, "sensorType", SENSOR_TYPES, context),
        bitWidth: readInteger(obj, "bitWidth", context, 1, MAX_BIT_WIDTH),
        pinSide: readEnum(obj, "pinSide", PIN_SIDES, context),
        notation: readString(obj, "notation", context),
        data: readString(obj, "data", context),
        note: readString(obj, "note", context),
      };

    case "sound":
      return {
        ...placement,
        kind: "sound",
        componentId: readString(obj, "componentId", context, false),
        pinSide: readEnum(obj, "pinSide", PIN_SIDES, context),
        notation: readString(obj, "notation", context),
        note: readString(obj, "note", context),
        frequency: readNumber(obj, "frequency", context, 20, 20000),
        waveform: readEnum(obj, "waveform", SOUND_WAVEFORMS, context),
      };

    case "synthesizer":
      return {
        ...placement,
        kind: "synthesizer",
        componentId: readString(obj, "componentId", context, false),
        notation: readString(obj, "notation", context),
        note: readString(obj, "note", context),
        mode: readEnum(obj, "mode", SYNTHESIZER_MODES, context),
      };

    case "graphicsArray":
      return {
        ...placement,
        kind: "graphicsArray",
        componentId: readString(obj, "componentId", context, false),
        writeOn1: readBoolean(obj, "writeOn1", context),
        onStart: readEnum(obj, "onStart", MEMORY_ON_START_MODES, context),
        dataBitWidth: readInteger(obj, "dataBitWidth", context, 1, MAX_BIT_WIDTH),
        bitsPerPixel: readInteger(obj, "bitsPerPixel", context, 1, 8),
        width: readInteger(obj, "width", context, 1, 640),
        height: readInteger(obj, "height", context, 1, 480),
        zoom: readInteger(obj, "zoom", context, 1, 4),
        note: readString(obj, "note", context),
      };

    default:
      throw new Error(`Unbekannter Element-Typ "${kind}" in ${context}.`);
  }
}

function parseWire(raw: unknown, context: string): NativeWire {
  const obj = assertRecord(raw, context);
  return {
    wireId: readString(obj, "wireId", context, false),
    x1: readInteger(obj, "x1", context),
    y1: readInteger(obj, "y1", context),
    x2: readInteger(obj, "x2", context),
    y2: readInteger(obj, "y2", context),
  };
}

function parseTextNote(raw: unknown, context: string): NativeTextNote {
  const obj = assertRecord(raw, context);
  return {
    textNoteId: readString(obj, "textNoteId", context, false),
    x: readInteger(obj, "x", context),
    y: readInteger(obj, "y", context),
    width: readInteger(obj, "width", context, 1),
    height: readInteger(obj, "height", context, 1),
    note: readString(obj, "note", context),
    rotation: readEnum(obj, "rotation", ROTATIONS, context),
    lineHeight: readLineHeightValue(obj.lineHeight, `${context}.lineHeight`),
    fontFamily: readEnum(obj, "fontFamily", TEXT_NOTE_FONT_FAMILIES, context),
    lineHeights: readNullableLineHeights(obj, "lineHeights", context),
  };
}

function parseLogicalCircuit(raw: unknown, index: number): NativeLogicalCircuit {
  const context = `logicalCircuits[${index}]`;
  const obj = assertRecord(raw, context);
  const id = readString(obj, "logicalCircuitId", context, false);
  const lcContext = `logicalCircuit "${id}"`;

  const rawPins = assertArray(obj.pins, `${lcContext}.pins`);
  const rawElements = assertArray(obj.elements, `${lcContext}.elements`);
  const rawWires = assertArray(obj.wires, `${lcContext}.wires`);
  const rawTextNotes = assertArray(obj.textNotes, `${lcContext}.textNotes`);

  return {
    logicalCircuitId: id,
    name: readString(obj, "name", lcContext),
    notation: readString(obj, "notation", lcContext),
    note: readString(obj, "note", lcContext),
    category: readString(obj, "category", lcContext),
    circuitShape: readEnum(obj, "circuitShape", CIRCUIT_SHAPES, lcContext),
    showLabelAbove: readBoolean(obj, "showLabelAbove", lcContext),
    displayMargin: readEnum(obj, "displayMargin", DISPLAY_MARGINS, lcContext),
    validators: readString(obj, "validators", lcContext),
    exportToHDL: readBoolean(obj, "exportToHDL", lcContext),
    pins: rawPins.map((p, idx) => parsePinElement(p, `${lcContext}.pins[${idx}]`)),
    elements: rawElements.map((e, idx) => parseCircuitElement(e, `${lcContext}.elements[${idx}]`)),
    wires: rawWires.map((w, idx) => parseWire(w, `${lcContext}.wires[${idx}]`)),
    textNotes: rawTextNotes.map((n, idx) => parseTextNote(n, `${lcContext}.textNotes[${idx}]`)),
  };
}

// Prüft eindeutige IDs, gültige Referenzen und erkennt direkte sowie indirekte Subschaltungs-Zyklen
function validateCircuitGraph(
  logicalCircuits: NativeLogicalCircuit[],
  requiredCircuitIds: { label: string; id: string }[],
): void {
  const logicalCircuitById = new Map<string, NativeLogicalCircuit>();
  for (const lc of logicalCircuits) {
    if (logicalCircuitById.has(lc.logicalCircuitId)) {
      throw new Error(`Doppelte Schaltplan-ID "${lc.logicalCircuitId}" gefunden.`);
    }
    logicalCircuitById.set(lc.logicalCircuitId, lc);
  }

  for (const ref of requiredCircuitIds) {
    if (!logicalCircuitById.has(ref.id)) {
      throw new Error(`Fehlende Schaltplan-Referenz für "${ref.label}": "${ref.id}" existiert nicht.`);
    }
  }

  const seenSymbolIds = new Set<string>();
  const seenComponentIds = new Set<string>();
  const seenWireIds = new Set<string>();
  const seenTextNoteIds = new Set<string>();

  const registerSymbolId = (symbolId: string, context: string) => {
    if (seenSymbolIds.has(symbolId)) {
      throw new Error(`Doppelte Symbol-ID "${symbolId}" in ${context}.`);
    }
    seenSymbolIds.add(symbolId);
  };

  const registerComponentId = (componentId: string, context: string) => {
    if (logicalCircuitById.has(componentId)) {
      throw new Error(`ID-Kollision in ${context}: Bauteil-ID "${componentId}" kollidiert mit einem Schaltplan.`);
    }
    if (seenComponentIds.has(componentId)) {
      throw new Error(`Doppelte Bauteil-ID "${componentId}" in ${context}.`);
    }
    seenComponentIds.add(componentId);
  };

  for (const lc of logicalCircuits) {
    for (const pin of lc.pins) {
      registerSymbolId(pin.symbolId, `Schaltplan "${lc.name}"`);
      registerComponentId(pin.pinId, `Pin "${pin.name}" in "${lc.name}"`);
    }

    for (const elem of lc.elements) {
      registerSymbolId(elem.symbolId, `Schaltplan "${lc.name}"`);
      if (elem.kind === "subCircuit") {
        if (!logicalCircuitById.has(elem.logicalCircuitId)) {
          throw new Error(
            `Ungültige Subschaltungs-Referenz "${elem.logicalCircuitId}" in Schaltplan "${lc.name}".`,
          );
        }
      } else if (elem.kind !== "gate") {
        registerComponentId(elem.componentId, `Element "${elem.kind}" in "${lc.name}"`);
      }
    }

    for (const wire of lc.wires) {
      if (seenWireIds.has(wire.wireId)) {
        throw new Error(`Doppelte Leitungs-ID "${wire.wireId}" in Schaltplan "${lc.name}".`);
      }
      seenWireIds.add(wire.wireId);
    }

    for (const note of lc.textNotes) {
      if (seenTextNoteIds.has(note.textNoteId)) {
        throw new Error(`Doppelte Textnotiz-ID "${note.textNoteId}" in Schaltplan "${lc.name}".`);
      }
      seenTextNoteIds.add(note.textNoteId);
    }
  }

  // Dreifarben-DFS zur Zykluserkennung über alle Subschaltungs-Abhängigkeiten
  const visitState = new Map<string, 0 | 1 | 2>();
  for (const lc of logicalCircuits) {
    visitState.set(lc.logicalCircuitId, 0);
  }
  const stack: string[] = [];

  const dfs = (circuitId: string): void => {
    visitState.set(circuitId, 1);
    stack.push(circuitId);

    const lc = logicalCircuitById.get(circuitId);
    if (lc) {
      for (const elem of lc.elements) {
        if (elem.kind !== "subCircuit") {
          continue;
        }
        const targetId = elem.logicalCircuitId;
        const targetState = visitState.get(targetId) ?? 0;
        if (targetState === 1) {
          const cycleStart = stack.indexOf(targetId);
          const cycleIds = [...stack.slice(cycleStart), targetId];
          const pathLabel = cycleIds
            .map((id) => `"${logicalCircuitById.get(id)?.name ?? id}" (${id})`)
            .join(" -> ");
          throw new Error(`Zyklische Subschaltungs-Referenz erkannt: ${pathLabel}.`);
        }
        if (targetState === 0) {
          dfs(targetId);
        }
      }
    }

    stack.pop();
    visitState.set(circuitId, 2);
  };

  for (const lc of logicalCircuits) {
    if (visitState.get(lc.logicalCircuitId) === 0) {
      dfs(lc.logicalCircuitId);
    }
  }
}

// Rekonstruiert aus validierten nativen Schaltplänen ein vollständiges, simulationsfähiges CircuitProject
function buildCircuitProjectFromNative(
  projectMeta: Project,
  collapsedCategories: CollapsedCategory[],
  nativeCircuits: NativeLogicalCircuit[],
): CircuitProject {
  const circuits = new Map<string, Circuit>();
  const gates = new Map<string, Gate>();
  const logicalCircuitById = new Map<string, LogicalCircuit>();

  const pins: Pin[] = [];
  const constants: Constant[] = [];
  const circuitButtons: CircuitButton[] = [];
  const circuitProbes: CircuitProbe[] = [];
  const splitters: Splitter[] = [];
  const memories: Memory[] = [];
  const ledMatrices: LedMatrix[] = [];
  const sensors: Sensor[] = [];
  const sounds: Sound[] = [];
  const synthesizers: Synthesizer[] = [];
  const graphicsArrays: GraphicsArray[] = [];
  const allSymbols: CircuitSymbol[] = [];
  const allWires: Wire[] = [];
  const allTextNotes: TextNote[] = [];

  for (const rawLc of nativeCircuits) {
    const lc = createDefaultLogicalCircuit(
      rawLc.logicalCircuitId,
      rawLc.name,
      rawLc.category,
      rawLc.note,
    );
    lc.notation = rawLc.notation;
    lc.circuitShape = rawLc.circuitShape;
    lc.isDisplay = rawLc.circuitShape === "display";
    lc.showLabelAbove = rawLc.showLabelAbove;
    lc.displayMargin = rawLc.displayMargin;
    lc.validators = rawLc.validators;
    lc.exportToHDL = rawLc.exportToHDL;

    logicalCircuitById.set(lc.logicalCircuitId, lc);
    circuits.set(lc.circuitId, lc);
  }

  const populatedCircuits: LogicalCircuit[] = [];

  for (const rawLc of nativeCircuits) {
    const lc = logicalCircuitById.get(rawLc.logicalCircuitId)!;
    const lcPins: Pin[] = [];
    const lcSymbols: CircuitSymbol[] = [];
    const lcWires: Wire[] = [];
    const lcTextNotes: TextNote[] = [];

    for (const rawPin of rawLc.pins) {
      const { pin, pinCircuit } = createPinCircuit(
        rawPin.pinId,
        rawLc.logicalCircuitId,
        rawPin.pinType,
        rawPin.name,
        rawPin.bitWidth,
        rawPin.pinSide,
        rawPin.inverted,
        rawPin.index,
        rawPin.width,
        rawPin.height,
        rawPin.jamNotation,
      );
      pin.note = rawPin.note;
      pinCircuit.note = rawPin.note;

      pins.push(pin);
      lcPins.push(pin);
      circuits.set(pinCircuit.circuitId, pinCircuit);

      const pinSymbol = createCircuitSymbol(
        pinCircuit,
        rawLc.logicalCircuitId,
        rawPin.x,
        rawPin.y,
        rawPin.rotation,
        rawPin.symbolId,
      );
      lcSymbols.push(pinSymbol);
      allSymbols.push(pinSymbol);
    }

    for (const elem of rawLc.elements) {
      let targetCircuit: Circuit;

      switch (elem.kind) {
        case "gate": {
          const canonical = createGate(
            elem.gateType,
            elem.inputCount,
            elem.invertedOutput,
            elem.color ?? "red",
          );
          const sharedGate = gates.get(canonical.gateId) ?? canonical;
          gates.set(sharedGate.gateId, sharedGate);
          circuits.set(sharedGate.circuitId, sharedGate);
          // Instanz-Notiz am Symbol-Circuit belassen, damit geteilte Gates sauber bleiben
          targetCircuit = elem.note !== "" ? { ...sharedGate, note: elem.note } : sharedGate;
          break;
        }

        case "subCircuit":
          targetCircuit = logicalCircuitById.get(elem.logicalCircuitId)!;
          break;

        case "circuitButton": {
          const button = createCircuitButton(
            elem.componentId,
            elem.notation,
            elem.isToggle,
            elem.pinSide,
            elem.inverted,
            elem.width,
            elem.height,
            false,
          );
          button.name = elem.name;
          button.modifiers = elem.modifiers;
          button.keyCode = elem.keyCode;
          button.note = elem.note;
          circuitButtons.push(button);
          circuits.set(button.circuitId, button);
          targetCircuit = button;
          break;
        }

        case "constant": {
          const constant = createConstant(
            elem.componentId,
            elem.bitWidth,
            elem.value,
            elem.pinSide,
            elem.isHex,
            elem.width,
            elem.height,
          );
          constant.note = elem.note;
          constants.push(constant);
          circuits.set(constant.circuitId, constant);
          targetCircuit = constant;
          break;
        }

        case "circuitProbe": {
          const probe = createCircuitProbe(
            elem.componentId,
            elem.name,
            elem.pinSide,
            elem.width,
            elem.height,
            elem.isHex,
          );
          probe.displayFormat = elem.displayFormat;
          probe.note = elem.note;
          circuitProbes.push(probe);
          circuits.set(probe.circuitId, probe);
          targetCircuit = probe;
          break;
        }

        case "splitter": {
          const splitter = createSplitter(
            elem.componentId,
            elem.bitWidth,
            elem.pinCount,
            elem.clockwise,
          );
          splitter.note = elem.note;
          splitters.push(splitter);
          circuits.set(splitter.circuitId, splitter);
          targetCircuit = splitter;
          break;
        }

        case "memory": {
          const memory = createMemory(
            elem.componentId,
            elem.writable,
            elem.addressBitWidth,
            elem.dataBitWidth,
            {
              writeOn1: elem.writeOn1,
              onStart: elem.onStart,
              dualPort: elem.dualPort,
              data: elem.data,
              note: elem.note,
            },
          );
          memories.push(memory);
          circuits.set(memory.circuitId, memory);
          targetCircuit = memory;
          break;
        }

        case "ledMatrix": {
          const matrix = createLedMatrix(
            elem.componentId,
            elem.rows,
            elem.columns,
            elem.matrixType,
            elem.cellShape,
            elem.colors,
            elem.persistenceMultiplier,
          );
          matrix.name = elem.name;
          matrix.note = elem.note;
          ledMatrices.push(matrix);
          circuits.set(matrix.circuitId, matrix);
          targetCircuit = matrix;
          break;
        }

        case "sensor": {
          const sensor = createSensor(
            elem.componentId,
            elem.sensorType,
            elem.bitWidth,
            elem.pinSide,
            elem.notation,
            elem.data,
            elem.note,
          );
          sensors.push(sensor);
          circuits.set(sensor.circuitId, sensor);
          targetCircuit = sensor;
          break;
        }

        case "sound": {
          const sound = createSound(
            elem.componentId,
            elem.pinSide,
            elem.notation,
            elem.note,
            elem.frequency,
            elem.waveform,
          );
          sounds.push(sound);
          circuits.set(sound.circuitId, sound);
          targetCircuit = sound;
          break;
        }

        case "synthesizer": {
          const synth = createSynthesizer(
            elem.componentId,
            elem.mode,
            elem.notation,
            elem.note,
          );
          synthesizers.push(synth);
          circuits.set(synth.circuitId, synth);
          targetCircuit = synth;
          break;
        }

        case "graphicsArray": {
          const ga = createGraphicsArray(elem.componentId, {
            writeOn1: elem.writeOn1,
            onStart: elem.onStart,
            dataBitWidth: elem.dataBitWidth,
            bitsPerPixel: elem.bitsPerPixel,
            width: elem.width,
            height: elem.height,
            zoom: elem.zoom,
            note: elem.note,
          });
          graphicsArrays.push(ga);
          circuits.set(ga.circuitId, ga);
          targetCircuit = ga;
          break;
        }
      }

      const symbol = createCircuitSymbol(
        targetCircuit,
        rawLc.logicalCircuitId,
        elem.x,
        elem.y,
        elem.rotation,
        elem.symbolId,
      );
      lcSymbols.push(symbol);
      allSymbols.push(symbol);
    }

    for (const rawWire of rawLc.wires) {
      if (rawWire.x1 === rawWire.x2 && rawWire.y1 === rawWire.y2) {
        continue;
      }
      const wire = createWire(
        rawLc.logicalCircuitId,
        { x: rawWire.x1, y: rawWire.y1 },
        { x: rawWire.x2, y: rawWire.y2 },
        rawWire.wireId,
      );
      lcWires.push(wire);
      allWires.push(wire);
    }

    for (const rawNote of rawLc.textNotes) {
      const note: TextNote = {
        textNoteId: rawNote.textNoteId,
        logicalCircuitId: rawLc.logicalCircuitId,
        x: rawNote.x,
        y: rawNote.y,
        width: rawNote.width,
        height: rawNote.height,
        note: rawNote.note,
        rotation: rawNote.rotation,
        lineHeight: rawNote.lineHeight,
        fontFamily: rawNote.fontFamily,
        lineHeights: rawNote.lineHeights ? [...rawNote.lineHeights] : undefined,
      };
      lcTextNotes.push(note);
      allTextNotes.push(note);
    }

    lc.logicalPins = lcPins;
    lc.circuitSymbols = lcSymbols;
    lc.wires = lcWires;
    lc.textNotes = lcTextNotes;
    populatedCircuits.push(lc);
  }

  const assembledProject: CircuitProject = {
    project: projectMeta,
    collapsedCategories,
    circuits,
    logicalCircuits: populatedCircuits,
    gates,
    pins,
    devicePins: [],
    constants,
    circuitButtons,
    circuitProbes,
    splitters,
    memories,
    ledMatrices,
    sensors,
    sounds,
    synthesizers,
    graphicsArrays,
    circuitSymbols: allSymbols,
    wires: allWires,
    textNotes: allTextNotes,
  };

  return rebuildImportedProjectLayout(assembledProject);
}

// Prüft schnell und sicher, ob ein Text ein natives Web-Projektdokument enthält
export function isNativeProjectJson(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isPlainRecord(parsed) && parsed.format === NATIVE_PROJECT_FORMAT;
  } catch {
    return false;
  }
}

// Prüft schnell und sicher, ob ein Text ein natives Web-Zwischenablage-Snippet enthält
export function isNativeSnippetJson(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isPlainRecord(parsed) && parsed.format === NATIVE_SNIPPET_FORMAT;
  } catch {
    return false;
  }
}

// Prüft, ob ein Text entweder ein natives Projekt oder ein natives Snippet darstellt
export function isNativeCircuitJson(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return (
      isPlainRecord(parsed) &&
      (parsed.format === NATIVE_PROJECT_FORMAT || parsed.format === NATIVE_SNIPPET_FORMAT)
    );
  } catch {
    return false;
  }
}

// Prüft, ob der Dateiname eine unterstützte native Web-Projektendung besitzt
export function isSupportedNativeProjectFile(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return lower.endsWith(NATIVE_PROJECT_FILE_EXTENSION) || lower.endsWith(".json");
}

// Validiert und parst ein unbekanntes Objekt in ein typsicheres NativeProjectDocument
export function parseNativeProjectDocument(raw: unknown): NativeProjectDocument {
  const root = assertRecord(raw, "Dokument-Wurzel");
  const header = parseHeader(root, [NATIVE_PROJECT_FORMAT]);
  const project = parseProjectMeta(root.project);

  const rawCategories = assertArray(root.collapsedCategories, "collapsedCategories");
  const collapsedCategories = rawCategories.map((cat, idx) => {
    if (typeof cat !== "string") {
      throw new Error(`Ungültiges Element collapsedCategories[${idx}]: Erwartet wurde ein String.`);
    }
    return cat;
  });

  const rawCircuits = assertArray(root.logicalCircuits, "logicalCircuits");
  if (rawCircuits.length === 0) {
    throw new Error("Ungültige Projektdatei: Mindestens ein Schaltplan in \"logicalCircuits\" ist erforderlich.");
  }

  const logicalCircuits = rawCircuits.map((lc, idx) => parseLogicalCircuit(lc, idx));
  const requiredRefs: { label: string; id: string }[] = [
    { label: "project.logicalCircuitId", id: project.logicalCircuitId },
  ];
  if (project.startupCircuitId !== null) {
    requiredRefs.push({ label: "project.startupCircuitId", id: project.startupCircuitId });
  }
  validateCircuitGraph(logicalCircuits, requiredRefs);

  return {
    format: NATIVE_PROJECT_FORMAT,
    schemaVersion: header.schemaVersion,
    appVersion: header.appVersion,
    project,
    collapsedCategories,
    logicalCircuits,
  };
}

// Validiert und parst ein unbekanntes Objekt in ein typsicheres NativeSnippetDocument
export function parseNativeSnippetDocument(raw: unknown): NativeSnippetDocument {
  const root = assertRecord(raw, "Dokument-Wurzel");
  const header = parseHeader(root, [NATIVE_SNIPPET_FORMAT, NATIVE_PROJECT_FORMAT]);

  if (header.format === NATIVE_PROJECT_FORMAT) {
    const fullDoc = parseNativeProjectDocument(raw);
    return {
      format: NATIVE_SNIPPET_FORMAT,
      schemaVersion: fullDoc.schemaVersion,
      appVersion: fullDoc.appVersion,
      rootCircuitId: fullDoc.project.logicalCircuitId,
      logicalCircuits: fullDoc.logicalCircuits,
    };
  }

  const rootCircuitId = readString(root, "rootCircuitId", "Snippet-Header", false);
  const rawCircuits = assertArray(root.logicalCircuits, "logicalCircuits");
  if (rawCircuits.length === 0) {
    throw new Error("Ungültiges Snippet: Mindestens ein Schaltplan in \"logicalCircuits\" ist erforderlich.");
  }

  const logicalCircuits = rawCircuits.map((lc, idx) => parseLogicalCircuit(lc, idx));
  validateCircuitGraph(logicalCircuits, [{ label: "rootCircuitId", id: rootCircuitId }]);

  return {
    format: NATIVE_SNIPPET_FORMAT,
    schemaVersion: header.schemaVersion,
    appVersion: header.appVersion,
    rootCircuitId,
    logicalCircuits,
  };
}

// Deserialisiert einen nativen Projekt-JSON-String in ein vollständiges CircuitProject
export function parseNativeProject(jsonText: string): CircuitProject {
  const raw = parseJsonObject(jsonText);
  const doc = parseNativeProjectDocument(raw);

  const collapsedCategories: CollapsedCategory[] = [];
  const seenCollapsed = new Set<string>();
  for (const name of doc.collapsedCategories) {
    if (name && !seenCollapsed.has(name)) {
      seenCollapsed.add(name);
      collapsedCategories.push({ name });
    }
  }

  const projectMeta: Project = {
    projectId: doc.project.projectId,
    name: doc.project.name,
    note: doc.project.note,
    zoom: doc.project.zoom,
    frequency: doc.project.frequency,
    isMaximumSpeed: doc.project.isMaximumSpeed,
    logicalCircuitId: doc.project.logicalCircuitId,
    startupCircuitId: doc.project.startupCircuitId ?? undefined,
    categoryTextNoteCollapsed: doc.project.categoryTextNoteCollapsed,
    categoryInputOutputCollapsed: doc.project.categoryInputOutputCollapsed,
    categoryPrimitivesCollapsed: doc.project.categoryPrimitivesCollapsed,
  };

  return buildCircuitProjectFromNative(projectMeta, collapsedCategories, doc.logicalCircuits);
}

// Deserialisiert ein natives Zwischenablage-Snippet (oder Vollprojekt) in ein CircuitProject
export function parseNativeSnippet(jsonText: string): CircuitProject {
  const raw = parseJsonObject(jsonText);
  const doc = parseNativeSnippetDocument(raw);

  const projectMeta: Project = {
    projectId: "snippet-project",
    name: "Snippet",
    note: "",
    zoom: 1,
    frequency: 10,
    isMaximumSpeed: false,
    logicalCircuitId: doc.rootCircuitId,
    startupCircuitId: undefined,
    categoryTextNoteCollapsed: false,
    categoryInputOutputCollapsed: false,
    categoryPrimitivesCollapsed: false,
  };

  return buildCircuitProjectFromNative(projectMeta, [], doc.logicalCircuits);
}
