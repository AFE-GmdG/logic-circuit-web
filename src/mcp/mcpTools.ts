import type GridPoint from "../types/canvas/gridPoint";
import type CircuitButton from "../types/circuit/circuitButton";
import type CircuitProbe from "../types/circuit/circuitProbe";
import type CircuitProject from "../types/circuit/circuitProject";
import type CircuitShape from "../types/circuit/circuitShape";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type CircuitSymbolPropertiesUpdate from "../types/circuit/circuitSymbolPropertiesUpdate";
import type Constant from "../types/circuit/constant";
import type CreateCircuitInput from "../types/circuit/createCircuitInput";
import type DisplayColor from "../types/circuit/displayColor";
import type DisplayMargin from "../types/circuit/displayMargin";
import type Gate from "../types/circuit/gate";
import type GateType from "../types/circuit/gateType";
import type GraphicsArray from "../types/circuit/graphicsArray";
import type LedMatrix from "../types/circuit/ledMatrix";
import type LedMatrixCellShape from "../types/circuit/ledMatrixCellShape";
import type LedMatrixType from "../types/circuit/ledMatrixType";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Memory from "../types/circuit/memory";
import type MemoryOnStart from "../types/circuit/memoryOnStart";
import type PaletteSelection from "../types/circuit/paletteSelection";
import type PinSide from "../types/circuit/pinSide";
import type PinType from "../types/circuit/pinType";
import type ProbeFormat from "../types/circuit/probeFormat";
import type Rotation from "../types/circuit/rotation";
import type RotationDirection from "../types/circuit/rotationDirection";
import type Sensor from "../types/circuit/sensor";
import type SensorType from "../types/circuit/sensorType";
import type Sound from "../types/circuit/sound";
import type SoundWaveform from "../types/circuit/soundWaveform";
import type Splitter from "../types/circuit/splitter";
import type Synthesizer from "../types/circuit/synthesizer";
import type SynthesizerMode from "../types/circuit/synthesizerMode";
import type TextNote from "../types/circuit/textNote";
import type TextNoteFontFamily from "../types/circuit/textNoteFontFamily";
import type TextNoteLineHeight from "../types/circuit/textNoteLineHeight";
import type Wire from "../types/circuit/wire";
import type McpCircuitActions from "../types/mcp/mcpCircuitActions";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";
import type McpImageResult from "../types/mcp/mcpImageResult";
import type McpToolDefinition from "../types/mcp/mcpToolDefinition";

import {
  SOUND_DEFAULT_FREQUENCY,
  SOUND_MAX_FREQUENCY,
  SOUND_MIN_FREQUENCY,
} from "../utils/audioPitchTable";
import {
  captureCircuitSvg,
  type CaptureMode,
  type GridRect,
  type UnrelatedSymbolsMode,
} from "../utils/circuitCapture";
import { circuitContainsDisplays } from "../utils/circuitLayout";
import {
  buildComponentCatalog,
  BUTTON_MAX_GRID_SIZE,
  BUTTON_MIN_GRID_SIZE,
  COMPONENT_PALETTE_CATEGORIES,
  type ComponentPreviewParams,
  type ComponentToolType,
  DISPLAY_COLORS,
  getAllowedComponentTypes,
  GRAPHICS_ARRAY_BITS_PER_PIXEL,
  GRAPHICS_ARRAY_DATA_BIT_WIDTHS,
  GRAPHICS_ARRAY_MAX_HEIGHT,
  GRAPHICS_ARRAY_MAX_WIDTH,
  GRAPHICS_ARRAY_MAX_ZOOM,
  GRAPHICS_ARRAY_MIN_HEIGHT,
  GRAPHICS_ARRAY_MIN_WIDTH,
  GRAPHICS_ARRAY_MIN_ZOOM,
  GRAPHICS_ARRAY_ON_START_MODES,
  LED_MATRIX_MAX_DIM,
  LED_MATRIX_MIN_DIM,
  MATRIX_CELL_SHAPES,
  MATRIX_TYPES,
  MEMORY_MAX_ADDRESS_BIT_WIDTH,
  MEMORY_MIN_ADDRESS_BIT_WIDTH,
  MEMORY_ON_START_MODES,
  PIN_SIDES,
  PROBE_FORMATS,
  RESIZABLE_SYMBOL_MAX_GRID_SIZE,
  RESIZABLE_SYMBOL_MIN_GRID_SIZE,
  ROTATIONS,
  SENSOR_TYPES,
  SOUND_WAVEFORMS,
  SYNTHESIZER_MODES,
  TEXT_NOTE_FONT_FAMILIES,
  TEXT_NOTE_LINE_HEIGHTS,
  TEXT_NOTE_MAX_GRID_SIZE,
  TEXT_NOTE_MIN_GRID_SIZE,
} from "../utils/componentCatalog";
import { getGraphicsArrayStrides } from "../utils/graphicsArrayUtils";

import {
  readOptionalBoolean,
  readOptionalEnum,
  readOptionalInteger,
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
  readRequiredInteger,
  readRequiredNumber,
  readRequiredString,
  resolveCircuit,
  resolveLiveSnapshot,
} from "./mcpParamUtils";
import {
  setInputSignalTool,
  stepSimulationTool,
  validateCircuitTool,
} from "./mcpSimulationTools";

import toolDefinitions from "./toolDefinitions.json";

// Werkzeugkatalog (Single Source of Truth, wird auch von server/mcpHttpHandler.ts gelesen)
export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = toolDefinitions;

type McpToolHandler = (snapshot: McpCircuitSnapshot, params: Record<string, unknown>) => unknown | Promise<unknown>;

type WireRouteMode = "direct" | "horizontal-first" | "vertical-first";

const ALLOWED_COMPONENT_TYPES: readonly ComponentToolType[] = getAllowedComponentTypes();
const ALLOWED_PIN_SIDES = PIN_SIDES;
const ALLOWED_MATRIX_TYPES = MATRIX_TYPES;
const ALLOWED_CELL_SHAPES = MATRIX_CELL_SHAPES;
const ALLOWED_DISPLAY_COLORS = DISPLAY_COLORS;
const ALLOWED_SOUND_WAVEFORMS = SOUND_WAVEFORMS;
const ALLOWED_SYNTHESIZER_MODES = SYNTHESIZER_MODES;
const ALLOWED_UPDATE_GATE_TYPES: readonly GateType[] = ["and", "or", "xor", "triState1", "triState2"];
const ALLOWED_IO_PIN_TYPES: readonly ("input" | "output")[] = ["input", "output"];
const ALLOWED_ROTATION_DIRECTIONS: readonly RotationDirection[] = ["clockwise", "counterClockwise"];
const ALLOWED_WIRE_ROUTES: readonly WireRouteMode[] = ["direct", "horizontal-first", "vertical-first"];
const ALLOWED_UNRELATED_SYMBOL_MODES: readonly UnrelatedSymbolsMode[] = ["show", "dim", "hide"];
const ALLOWED_CIRCUIT_SHAPES: readonly CircuitShape[] = [
  "rectangular",
  "flipFlop",
  "mux",
  "demux",
  "alu",
  "display",
];
const ALLOWED_CREATE_CIRCUIT_SHAPES: readonly CircuitShape[] = [
  "rectangular",
  "flipFlop",
  "mux",
  "demux",
  "alu",
];
const ALLOWED_DISPLAY_MARGINS: readonly DisplayMargin[] = ["none", "horizontal", "vertical", "all"];

// Prüft, dass die Werkzeug-Parameter ein einfaches Objekt sind
function normalizeParams(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) {
    return {};
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Werkzeug-Parameter müssen ein Objekt sein.");
  }
  return params as Record<string, unknown>;
}

// Prüft, ob schreibende Context-Aktionen bereitstehen und keine Simulation läuft
function requireWritableActions(snapshot: McpCircuitSnapshot): McpCircuitActions {
  if (snapshot.isSimulating) {
    throw new Error(
      "Änderungen an der Schaltung sind während einer laufenden Simulation nicht möglich. Bitte zuerst die Simulation beenden.",
    );
  }
  if (!snapshot.actions) {
    throw new Error("Schreibende MCP-Werkzeuge erfordern eine aktive Editor-Sitzung mit CircuitContext-Aktionen.");
  }
  return snapshot.actions;
}

// Liest die aktuellste Instanz der aktiven Schaltung nach einer Context-Mutation
function resolveLatestCircuit(snapshot: McpCircuitSnapshot, actions: McpCircuitActions): LogicalCircuit {
  return actions.getCurrentCircuit ? actions.getCurrentCircuit() : snapshot.currentCircuit;
}

// Ermittelt einen sinnvollen Standardnamen für Palette-Komponenten
function getDefaultComponentName(type: ComponentToolType, subCircuitName?: string): string {
  switch (type) {
    case "subCircuit":
      return subCircuitName ?? "Sub-Circuit";
    case "textNote":
      return "Text-Notiz";
    case "pin":
    case "pinIn":
      return "X";
    case "pinOut":
      return "Q";
    case "probe":
      return "";
    case "button":
      return "";
    case "sound":
      return "Sound";
    case "synthesizer":
      return "Synthesizer";
    case "graphicsArray":
      return "Graphics Array";
    default:
      return type.toUpperCase();
  }
}

// Löst einen Anschluss (Jam) auf einem aufgelösten Symbol in Rasterkoordinaten auf
function resolveSymbolJamPoint(
  symbol: CircuitSymbol,
  symbolLabel: string,
  endpoint: Record<string, unknown>,
  paramName: string,
): GridPoint {
  if (symbol.jams.length === 0) {
    throw new Error(`Symbol ${symbolLabel} besitzt keine Anschlusspunkte (Jams).`);
  }

  const jamIndex = readOptionalInteger(endpoint, "jamIndex", 0, symbol.jams.length - 1);
  const pinName = readOptionalString(endpoint, "pinName");

  if (jamIndex !== undefined && pinName !== undefined) {
    throw new Error(`Parameter "${paramName}" darf nicht gleichzeitig jamIndex und pinName angeben.`);
  }

  if (jamIndex !== undefined) {
    const jam = symbol.jams[jamIndex];
    return { x: jam.absolutePoint.x, y: jam.absolutePoint.y };
  }

  if (pinName !== undefined) {
    const normalized = pinName.trim().toLowerCase();
    const matchedJam = symbol.jams.find(
      (j) => j.pin.name.trim().toLowerCase() === normalized || j.pin.pinId.trim().toLowerCase() === normalized,
    );
    if (!matchedJam) {
      const available = symbol.jams.map((j, idx) => `[${idx}] "${j.pin.name}" (${j.pin.pinId})`).join(", ");
      throw new Error(`Anschluss "${pinName}" an Symbol ${symbolLabel} nicht gefunden. Verfügbar: ${available}`);
    }
    return { x: matchedJam.absolutePoint.x, y: matchedJam.absolutePoint.y };
  }

  if (symbol.jams.length === 1) {
    const jam = symbol.jams[0];
    return { x: jam.absolutePoint.x, y: jam.absolutePoint.y };
  }

  const available = symbol.jams.map((j, idx) => `[${idx}] "${j.pin.name}" (${j.pin.pinId})`).join(", ");
  throw new Error(
    `Symbol ${symbolLabel} besitzt ${symbol.jams.length} Anschlüsse. Bitte pinName oder jamIndex angeben: ${available}`,
  );
}

// Löst einen Leitungsendpunkt entweder aus Koordinaten, bestehender Symbol-ID oder Batch-Referenz auf
function resolveWireEndpoint(
  circuit: LogicalCircuit,
  rawEndpoint: unknown,
  paramName: string,
  batchSymbolsByRef?: Map<string, CircuitSymbol>,
  textNoteRefs?: Set<string>,
): GridPoint {
  if (!rawEndpoint || typeof rawEndpoint !== "object" || Array.isArray(rawEndpoint)) {
    throw new Error(`Parameter "${paramName}" muss ein Objekt ({ x, y }, { symbolId } oder { ref }) sein.`);
  }

  const endpoint = rawEndpoint as Record<string, unknown>;
  const hasCoords = endpoint.x !== undefined || endpoint.y !== undefined;
  const hasSymbol = endpoint.symbolId !== undefined;
  const hasRef = endpoint.ref !== undefined;

  const sourceCount = Number(hasCoords) + Number(hasSymbol) + Number(hasRef);
  if (sourceCount > 1) {
    throw new Error(`Parameter "${paramName}" darf nur genau eine Zielart (Koordinaten, symbolId oder ref) angeben.`);
  }

  if (hasCoords) {
    const x = readRequiredInteger(endpoint, "x");
    const y = readRequiredInteger(endpoint, "y");
    return { x, y };
  }

  if (hasSymbol) {
    const symbolId = readRequiredString(endpoint, "symbolId");
    const symbol = circuit.circuitSymbols.find((s) => s.circuitSymbolId === symbolId);
    if (!symbol) {
      throw new Error(`Symbol "${symbolId}" in der aktiven Schaltung "${circuit.name}" nicht gefunden.`);
    }
    return resolveSymbolJamPoint(symbol, `"${symbolId}"`, endpoint, paramName);
  }

  if (hasRef) {
    const ref = readRequiredString(endpoint, "ref");
    if (textNoteRefs?.has(ref)) {
      throw new Error(`Referenz "${ref}" verweist auf eine Textnotiz und besitzt keine Anschlüsse.`);
    }
    const symbol = batchSymbolsByRef?.get(ref);
    if (!symbol) {
      throw new Error(`Referenz "${ref}" in "components" nicht gefunden.`);
    }
    return resolveSymbolJamPoint(symbol, `ref="${ref}"`, endpoint, paramName);
  }

  throw new Error(`Parameter "${paramName}" benötigt entweder { x, y }, { symbolId } oder { ref }.`);
}

// Erfasst die aktuellen Koordinaten aller Leitungen einer Schaltung zur Erkennung mitgeführter Leitungen
function captureWireCoordinatesMap(wires: Wire[]): Map<string, string> {
  return new Map(wires.map((w) => [w.wireId, `${w.x1},${w.y1}->${w.x2},${w.y2}`]));
}

// Ermittelt alle Leitungs-IDs, deren Koordinaten sich gegenüber einem Vorher-Schnappschuss verändert haben
function findModifiedWireIds(beforeMap: Map<string, string>, afterWires: Wire[]): string[] {
  const changed: string[] = [];
  for (const w of afterWires) {
    const prev = beforeMap.get(w.wireId);
    if (prev !== undefined && prev !== `${w.x1},${w.y1}->${w.x2},${w.y2}`) {
      changed.push(w.wireId);
    }
  }
  return changed;
}

type SymbolSpecificProperties = {
  gateType?: GateType;
  inputCount?: number;
  invertedOutput?: boolean;
  color?: DisplayColor;
  isToggle?: boolean;
  pinSide?: PinSide;
  inverted?: boolean;
  keyCode?: number;
  modifiers?: number;
  bitWidth?: number;
  value?: number;
  isHex?: boolean;
  displayFormat?: ProbeFormat;
  pinType?: PinType;
  jamNotation?: string;
  matrixType?: LedMatrixType;
  cellShape?: LedMatrixCellShape;
  rows?: number;
  columns?: number;
  colors?: number;
  persistenceMultiplier?: 1 | 2 | 3;
  pinCount?: number;
  pinBitWidth?: number;
  clockwise?: boolean;
  sensorType?: SensorType;
  frequency?: number;
  waveform?: SoundWaveform;
  synthesizerMode?: SynthesizerMode;
  writable?: boolean;
  writeOn1?: boolean;
  onStart?: MemoryOnStart;
  addressBitWidth?: number;
  dataBitWidth?: number;
  bitsPerPixel?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  zoom?: number;
  dualPort?: boolean;
  data?: string;
  logicalCircuitId?: string;
  circuitShape?: CircuitShape;
  category?: string;
  isDisplay?: boolean;
  showLabelAbove?: boolean;
  displayMargin?: DisplayMargin;
  note?: string;
};

// Ermittelt typspezifische Eigenschaften eines platzierten Symbols für Inspektion und Mutationsergebnisse
function extractSymbolSpecificProperties(
  symbol: CircuitSymbol,
  project?: CircuitProject,
): SymbolSpecificProperties {
  const { circuit } = symbol;
  const noteField = circuit.note ? { note: circuit.note } : {};

  switch (circuit.kind) {
    case "gate": {
      const gate = circuit as Gate;
      return {
        gateType: gate.gateType,
        inputCount: gate.inputCount,
        invertedOutput: gate.invertedOutput,
        ...(gate.color ? { color: gate.color } : {}),
        ...noteField,
      };
    }
    case "circuitButton": {
      const button = circuit as CircuitButton;
      return {
        isToggle: button.isToggle,
        pinSide: button.pinSide,
        inverted: button.inverted,
        keyCode: button.keyCode,
        modifiers: button.modifiers,
        ...noteField,
      };
    }
    case "constant": {
      const constant = circuit as Constant;
      return {
        bitWidth: constant.bitWidth,
        value: constant.value,
        pinSide: constant.pinSide,
        isHex: constant.isHex ?? true,
        ...noteField,
      };
    }
    case "circuitProbe": {
      const probe = circuit as CircuitProbe;
      const displayFormat = probe.displayFormat ?? (probe.isHex ? "hex" : "bin");
      return {
        pinSide: probe.pinSide,
        isHex: probe.isHex ?? displayFormat === "hex",
        displayFormat,
        ...noteField,
      };
    }
    case "pin": {
      const realPin = project?.pins.find((p) => p.pinId === circuit.circuitId);
      const internalPin = circuit.pins[0];
      const pinType = realPin?.pinType ?? (internalPin?.pinType === "input" ? "output" : "input");
      const pinSide = realPin?.pinSide ?? (pinType === "output" ? "right" : "left");
      return {
        pinType,
        bitWidth: realPin?.bitWidth ?? internalPin?.bitWidth ?? 1,
        pinSide,
        inverted: realPin?.inverted ?? internalPin?.inverted ?? false,
        ...(realPin?.jamNotation ? { jamNotation: realPin.jamNotation } : {}),
        ...noteField,
      };
    }
    case "ledMatrix": {
      const matrix = circuit as LedMatrix;
      return {
        matrixType: matrix.matrixType,
        cellShape: matrix.cellShape,
        rows: matrix.rows,
        columns: matrix.columns,
        colors: matrix.colors,
        persistenceMultiplier: matrix.persistenceMultiplier ?? 1,
        ...noteField,
      };
    }
    case "splitter": {
      const splitter = circuit as Splitter;
      return {
        bitWidth: splitter.bitWidth,
        pinCount: splitter.pinCount,
        pinBitWidth: Math.max(1, Math.floor(splitter.bitWidth / splitter.pinCount)),
        clockwise: splitter.clockwise,
        ...noteField,
      };
    }
    case "sensor": {
      const sensor = circuit as Sensor;
      return {
        sensorType: sensor.sensorType,
        bitWidth: sensor.bitWidth,
        pinSide: sensor.pinSide,
        data: sensor.data,
        ...noteField,
      };
    }
    case "sound": {
      const sound = circuit as Sound;
      return {
        pinSide: sound.pinSide,
        frequency: sound.frequency ?? SOUND_DEFAULT_FREQUENCY,
        waveform: sound.waveform ?? "sine",
        ...noteField,
      };
    }
    case "synthesizer": {
      const synth = circuit as Synthesizer;
      return {
        synthesizerMode: synth.mode,
        ...noteField,
      };
    }
    case "memory": {
      const memory = circuit as Memory;
      return {
        writable: memory.writable,
        addressBitWidth: memory.addressBitWidth,
        dataBitWidth: memory.dataBitWidth,
        ...(memory.writable ? { writeOn1: memory.writeOn1, onStart: memory.onStart } : {}),
        dualPort: memory.dualPort,
        data: memory.data,
        ...noteField,
      };
    }
    case "graphicsArray": {
      const ga = circuit as GraphicsArray;
      return {
        addressBitWidth: getGraphicsArrayStrides(
          ga.dataBitWidth,
          ga.bitsPerPixel,
          ga.width,
          ga.height,
        ).addressBitWidth,
        dataBitWidth: ga.dataBitWidth,
        bitsPerPixel: ga.bitsPerPixel,
        pixelWidth: ga.width,
        pixelHeight: ga.height,
        zoom: ga.zoom,
        writeOn1: ga.writeOn1,
        onStart: ga.onStart,
        ...noteField,
      };
    }
    case "logicalCircuit": {
      const lc = circuit as LogicalCircuit;
      return {
        logicalCircuitId: lc.logicalCircuitId,
        circuitShape: lc.circuitShape,
        category: lc.category,
        isDisplay: lc.isDisplay,
        showLabelAbove: Boolean(lc.showLabelAbove),
        displayMargin: lc.displayMargin ?? "none",
        ...noteField,
      };
    }
    default:
      return noteField;
  }
}

// Kompakte, KI-lesbare Beschreibung eines platzierten Symbols inkl. absoluter Jam-Positionen und Bauteil-Eigenschaften
export function describeSymbol(symbol: CircuitSymbol, project?: CircuitProject) {
  const { circuit } = symbol;
  return {
    circuitSymbolId: symbol.circuitSymbolId,
    kind: circuit.kind ?? "unknown",
    ...extractSymbolSpecificProperties(symbol, project),
    name: circuit.name,
    notation: circuit.notation,
    circuitId: symbol.circuitId,
    x: symbol.x,
    y: symbol.y,
    rotation: symbol.rotation,
    width: circuit.symbolWidth,
    height: circuit.symbolHeight,
    jams: symbol.jams.map((jam) => ({
      pinName: jam.pin.name,
      pinType: jam.pin.pinType,
      bitWidth: jam.pin.bitWidth,
      inverted: jam.pin.inverted,
      x: jam.absolutePoint.x,
      y: jam.absolutePoint.y,
    })),
  };
}

// Kompakte Beschreibung einer Text-Notiz für MCP-Antworten
function describeTextNote(note: TextNote) {
  return {
    textNoteId: note.textNoteId,
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    rotation: note.rotation,
    fontFamily: note.fontFamily ?? "mono",
    lineHeight: note.lineHeight ?? 18,
    note: note.note,
  };
}

// Liest eine optionale Ganzzahl aus einer zulässigen Werteliste mit verständlicher Fehlermeldung
function readOptionalAllowedInteger(
  params: Record<string, unknown>,
  key: string,
  allowedValues: readonly number[],
): number | undefined {
  const value = readOptionalInteger(params, key);
  if (value === undefined) {
    return undefined;
  }
  if (!allowedValues.includes(value)) {
    throw new Error(`Parameter "${key}" muss einer der Werte [${allowedValues.join(", ")}] sein.`);
  }
  return value;
}

// Liest optionale Preview-Parameter für get_component_catalog ein und validiert sie
function parseCatalogPreviewParams(
  rawPreview: unknown,
  targetType?: ComponentToolType,
): ComponentPreviewParams | undefined {
  if (rawPreview === undefined || rawPreview === null) {
    return undefined;
  }
  if (typeof rawPreview !== "object" || Array.isArray(rawPreview)) {
    throw new Error("Parameter \"preview\" muss ein Objekt sein.");
  }

  const obj = rawPreview as Record<string, unknown>;
  const allowedKeys = new Set([
    "inputCount",
    "subCircuitId",
    "name",
    "notation",
    "isToggle",
    "bitWidth",
    "pinSide",
    "isHex",
    "value",
    "rows",
    "columns",
    "matrixType",
    "cellShape",
    "color",
    "pinCount",
    "pinBitWidth",
    "clockwise",
    "sensorType",
    "frequency",
    "waveform",
    "synthesizerMode",
    "addressBitWidth",
    "dataBitWidth",
    "bitsPerPixel",
    "zoom",
    "writeOn1",
    "onStart",
    "dualPort",
    "data",
    "width",
    "height",
    "inverted",
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unbekanntes Feld "preview.${key}".`);
    }
  }

  const isGraphicsPreview = targetType === "graphicsArray";

  return {
    inputCount: readOptionalInteger(obj, "inputCount", 1, 18),
    subCircuitId: readOptionalString(obj, "subCircuitId"),
    name: readOptionalString(obj, "name"),
    notation: readOptionalString(obj, "notation"),
    isToggle: readOptionalBoolean(obj, "isToggle"),
    bitWidth: readOptionalInteger(obj, "bitWidth", 1, 32),
    pinSide: readOptionalEnum(obj, "pinSide", ALLOWED_PIN_SIDES),
    isHex: readOptionalBoolean(obj, "isHex"),
    value: readOptionalInteger(obj, "value", 0),
    rows: readOptionalInteger(obj, "rows", 1, 10),
    columns: readOptionalInteger(obj, "columns", 1, 10),
    matrixType: readOptionalEnum(obj, "matrixType", ALLOWED_MATRIX_TYPES),
    cellShape: readOptionalEnum(obj, "cellShape", ALLOWED_CELL_SHAPES),
    color: readOptionalEnum(obj, "color", ALLOWED_DISPLAY_COLORS),
    pinCount: readOptionalInteger(obj, "pinCount", 2, 32),
    pinBitWidth: readOptionalInteger(obj, "pinBitWidth", 1, 32),
    clockwise: readOptionalBoolean(obj, "clockwise"),
    sensorType: readOptionalEnum(obj, "sensorType", SENSOR_TYPES),
    frequency: readOptionalNumber(obj, "frequency", SOUND_MIN_FREQUENCY, SOUND_MAX_FREQUENCY),
    waveform: readOptionalEnum(obj, "waveform", ALLOWED_SOUND_WAVEFORMS),
    synthesizerMode: readOptionalEnum(obj, "synthesizerMode", ALLOWED_SYNTHESIZER_MODES),
    addressBitWidth: readOptionalInteger(
      obj,
      "addressBitWidth",
      MEMORY_MIN_ADDRESS_BIT_WIDTH,
      MEMORY_MAX_ADDRESS_BIT_WIDTH,
    ),
    dataBitWidth: isGraphicsPreview
      ? readOptionalAllowedInteger(obj, "dataBitWidth", GRAPHICS_ARRAY_DATA_BIT_WIDTHS)
      : readOptionalInteger(obj, "dataBitWidth", 1, 32),
    bitsPerPixel: readOptionalAllowedInteger(obj, "bitsPerPixel", GRAPHICS_ARRAY_BITS_PER_PIXEL),
    zoom: readOptionalInteger(obj, "zoom", GRAPHICS_ARRAY_MIN_ZOOM, GRAPHICS_ARRAY_MAX_ZOOM),
    writeOn1: readOptionalBoolean(obj, "writeOn1"),
    onStart: readOptionalEnum(
      obj,
      "onStart",
      isGraphicsPreview ? GRAPHICS_ARRAY_ON_START_MODES : MEMORY_ON_START_MODES,
    ),
    dualPort: readOptionalBoolean(obj, "dualPort"),
    data: readOptionalString(obj, "data"),
    width: readOptionalInteger(
      obj,
      "width",
      isGraphicsPreview ? GRAPHICS_ARRAY_MIN_WIDTH : 1,
      isGraphicsPreview ? GRAPHICS_ARRAY_MAX_WIDTH : TEXT_NOTE_MAX_GRID_SIZE,
    ),
    height: readOptionalInteger(
      obj,
      "height",
      isGraphicsPreview ? GRAPHICS_ARRAY_MIN_HEIGHT : 1,
      isGraphicsPreview ? GRAPHICS_ARRAY_MAX_HEIGHT : TEXT_NOTE_MAX_GRID_SIZE,
    ),
    inverted: readOptionalBoolean(obj, "inverted"),
  };
}

// Liefert den dynamisch aus dem Code abgeleiteten Komponenten-Katalog inklusive Projekt-Subschaltungen
export function getComponentCatalogTool(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const category = readOptionalEnum(params, "category", COMPONENT_PALETTE_CATEGORIES);
  const type = readOptionalEnum(params, "type", ALLOWED_COMPONENT_TYPES);
  const includeAliases = readOptionalBoolean(params, "includeAliases") ?? false;
  const includeSubCircuits = readOptionalBoolean(params, "includeSubCircuits") ?? true;
  const preview = parseCatalogPreviewParams(params.preview, type);

  if (preview && !type) {
    throw new Error("Parameter \"preview\" kann nur zusammen mit \"type\" angegeben werden.");
  }

  const liveSnapshot = resolveLiveSnapshot(snapshot);
  return buildComponentCatalog({
    category,
    type,
    includeAliases,
    includeSubCircuits,
    preview,
    project: liveSnapshot.project,
  });
}

// Übersicht über Projekt, aktive Schaltung und Auswahl
export function getCircuitSummary(snapshot: McpCircuitSnapshot) {
  const { project, currentCircuit } = snapshot;
  return {
    project: {
      projectId: project.project.projectId,
      name: project.project.name,
    },
    currentCircuitId: currentCircuit.logicalCircuitId,
    circuits: project.logicalCircuits.map((lc) => ({
      logicalCircuitId: lc.logicalCircuitId,
      name: lc.name,
      notation: lc.notation,
      isCurrent: lc.logicalCircuitId === currentCircuit.logicalCircuitId,
      symbolCount: lc.circuitSymbols.length,
      wireCount: lc.wires.length,
      textNoteCount: lc.textNotes.length,
      pinCount: lc.logicalPins.length,
    })),
    selection: {
      symbolIds: snapshot.selectedSymbolIds,
      textNoteIds: snapshot.selectedTextNoteIds,
    },
  };
}

// Detaillierter Inhalt einer Schaltung (Symbole, Leitungen, Textnotizen)
export function getCircuitDetails(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const liveSnapshot = resolveLiveSnapshot(snapshot);
  const circuit = resolveCircuit(liveSnapshot, readOptionalString(params, "circuitId"));
  const isCurrent = circuit.logicalCircuitId === liveSnapshot.currentCircuit.logicalCircuitId;
  return {
    logicalCircuitId: circuit.logicalCircuitId,
    name: circuit.name,
    notation: circuit.notation,
    isCurrent,
    symbols: circuit.circuitSymbols.map((sym) => describeSymbol(sym, liveSnapshot.project)),
    wires: circuit.wires.map((wire) => ({
      wireId: wire.wireId,
      x1: wire.x1,
      y1: wire.y1,
      x2: wire.x2,
      y2: wire.y2,
    })),
    textNotes: circuit.textNotes.map(describeTextNote),
    selection: isCurrent
      ? {
        symbolIds: snapshot.selectedSymbolIds,
        textNoteIds: snapshot.selectedTextNoteIds,
      }
      : {
        symbolIds: [],
        textNoteIds: [],
      },
  };
}

// Prüft und extrahiert ein Raster-Rechteck für Ausschnitt-Screenshots
function parseGridRect(raw: unknown): GridRect {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Parameter \"gridRect\" muss ein Objekt { x, y, width, height } sein.");
  }
  const obj = raw as Record<string, unknown>;
  const allowedKeys = new Set(["x", "y", "width", "height"]);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unbekanntes Feld "gridRect.${key}". Erlaubt sind x, y, width, height.`);
    }
  }
  return {
    x: readRequiredNumber(obj, "x"),
    y: readRequiredNumber(obj, "y"),
    width: readRequiredNumber(obj, "width", 1),
    height: readRequiredNumber(obj, "height", 1),
  };
}

// Erzeugt einen Screenshot der Schaltung als Base64-PNG
export async function getCircuitImage(
  snapshot: McpCircuitSnapshot,
  params: Record<string, unknown>,
): Promise<McpImageResult> {
  const rawMode = params.mode;
  if (rawMode !== undefined && rawMode !== "viewport" && rawMode !== "circuit") {
    throw new Error("Parameter \"mode\" muss entweder \"viewport\" oder \"circuit\" sein.");
  }

  const gridRect = params.gridRect !== undefined && params.gridRect !== null
    ? parseGridRect(params.gridRect)
    : undefined;
  const symbolIds = readOptionalStringArray(params, "symbolIds");
  const margin = readOptionalNumber(params, "margin", 0, 50);
  const unrelatedSymbols = readOptionalEnum(params, "unrelatedSymbols", ALLOWED_UNRELATED_SYMBOL_MODES);

  if (gridRect && symbolIds !== undefined) {
    throw new Error("Parameter \"gridRect\" und \"symbolIds\" können nicht gleichzeitig verwendet werden.");
  }
  if (rawMode !== undefined && (gridRect || symbolIds !== undefined)) {
    throw new Error("Parameter \"mode\" darf nicht gleichzeitig mit \"gridRect\" oder \"symbolIds\" angegeben werden.");
  }
  if (symbolIds !== undefined && symbolIds.length === 0) {
    throw new Error("Parameter \"symbolIds\" darf nicht leer sein.");
  }
  if (unrelatedSymbols !== undefined && symbolIds === undefined) {
    throw new Error("Parameter \"unrelatedSymbols\" kann nur zusammen mit \"symbolIds\" verwendet werden.");
  }

  const hasRegion = gridRect !== undefined || symbolIds !== undefined;
  const mode: CaptureMode = rawMode === "circuit" ? "circuit" : "viewport";
  if (!hasRegion && mode === "viewport" && margin !== undefined) {
    throw new Error("Parameter \"margin\" wird im Modus \"viewport\" nicht unterstützt.");
  }

  const circuit = resolveLiveSnapshot(snapshot).currentCircuit;
  if (symbolIds) {
    const knownIds = new Set(circuit.circuitSymbols.map((sym) => sym.circuitSymbolId));
    for (const symbolId of symbolIds) {
      if (!knownIds.has(symbolId)) {
        throw new Error(`Symbol "${symbolId}" in der aktuellen Schaltung nicht gefunden.`);
      }
    }
  }

  return captureCircuitSvg({
    mode,
    circuit,
    gridRect,
    symbolIds,
    margin,
    unrelatedSymbols,
  });
}

type ParsedTextNoteOptions = {
  width?: number;
  height?: number;
  rotation?: Rotation;
  fontFamily?: TextNoteFontFamily;
  lineHeight?: TextNoteLineHeight;
};

type ParsedComponentPlacement =
  | { kind: "textNote"; ref?: string; note: string; gridPoint: GridPoint; options?: ParsedTextNoteOptions }
  | { kind: "symbol"; ref?: string; selection: PaletteSelection; gridPoint: GridPoint };

// Liest die zulässige Zeilenhöhe einer Text-Notiz aus den Werkzeug-Parametern
function readOptionalLineHeight(params: Record<string, unknown>): TextNoteLineHeight | undefined {
  const value = readOptionalInteger(params, "lineHeight");
  if (value === undefined) {
    return undefined;
  }
  if (!TEXT_NOTE_LINE_HEIGHTS.includes(value as TextNoteLineHeight)) {
    throw new Error(`Parameter "lineHeight" muss einer der Werte [${TEXT_NOTE_LINE_HEIGHTS.join(", ")}] sein.`);
  }
  return value as TextNoteLineHeight;
}

// Validiert Parameter einer einzelnen Bauelement- oder Textnotiz-Platzierung für add_elements
function parseComponentPlacement(
  snapshot: McpCircuitSnapshot,
  params: Record<string, unknown>,
): ParsedComponentPlacement {
  const componentType = readOptionalEnum(params, "type", ALLOWED_COMPONENT_TYPES);
  if (!componentType) {
    throw new Error(`Parameter "type" ist erforderlich und muss einer der Werte [${ALLOWED_COMPONENT_TYPES.join(", ")}] sein.`);
  }

  const x = readRequiredInteger(params, "x");
  const y = readRequiredInteger(params, "y");
  const providedName = readOptionalString(params, "name");
  const ref = readOptionalString(params, "ref");
  const rotation = readOptionalEnum(params, "rotation", ROTATIONS);

  if (componentType === "textNote") {
    const noteText = readOptionalString(params, "note") ?? providedName ?? "Text-Notiz";
    const width = readOptionalInteger(params, "width", TEXT_NOTE_MIN_GRID_SIZE, TEXT_NOTE_MAX_GRID_SIZE);
    const height = readOptionalInteger(params, "height", TEXT_NOTE_MIN_GRID_SIZE, TEXT_NOTE_MAX_GRID_SIZE);
    const fontFamily = readOptionalEnum(params, "fontFamily", TEXT_NOTE_FONT_FAMILIES);
    const lineHeight = readOptionalLineHeight(params);
    const options: ParsedTextNoteOptions = {};
    if (width !== undefined) {
      options.width = width;
    }
    if (height !== undefined) {
      options.height = height;
    }
    if (rotation !== undefined) {
      options.rotation = rotation;
    }
    if (fontFamily !== undefined) {
      options.fontFamily = fontFamily;
    }
    if (lineHeight !== undefined) {
      options.lineHeight = lineHeight;
    }
    return { kind: "textNote", ref, note: noteText, gridPoint: { x, y }, options };
  }

  const isButton = componentType === "button";
  const isGraphicsArray = componentType === "graphicsArray";
  const isFreelyResizableSymbol =
    isButton ||
    componentType === "constant" ||
    componentType === "probe" ||
    componentType === "pin" ||
    componentType === "pinIn" ||
    componentType === "pinOut";

  if (!isFreelyResizableSymbol && !isGraphicsArray && (params.width !== undefined || params.height !== undefined)) {
    const hint = componentType === "ledMatrix" ? " Verwende stattdessen 'rows' und 'columns'." : "";
    throw new Error(`Parameter "width" und "height" werden für Komponententyp "${componentType}" nicht unterstützt.${hint}`);
  }

  const minWidth = isGraphicsArray
    ? GRAPHICS_ARRAY_MIN_WIDTH
    : (isButton ? BUTTON_MIN_GRID_SIZE : RESIZABLE_SYMBOL_MIN_GRID_SIZE);
  const maxWidth = isGraphicsArray
    ? GRAPHICS_ARRAY_MAX_WIDTH
    : (isButton ? BUTTON_MAX_GRID_SIZE : RESIZABLE_SYMBOL_MAX_GRID_SIZE);
  const minHeight = isGraphicsArray
    ? GRAPHICS_ARRAY_MIN_HEIGHT
    : (isButton ? BUTTON_MIN_GRID_SIZE : RESIZABLE_SYMBOL_MIN_GRID_SIZE);
  const maxHeight = isGraphicsArray
    ? GRAPHICS_ARRAY_MAX_HEIGHT
    : (isButton ? BUTTON_MAX_GRID_SIZE : RESIZABLE_SYMBOL_MAX_GRID_SIZE);
  const canSpecifySize = isFreelyResizableSymbol || isGraphicsArray;
  const width = canSpecifySize ? readOptionalInteger(params, "width", minWidth, maxWidth) : undefined;
  const height = canSpecifySize ? readOptionalInteger(params, "height", minHeight, maxHeight) : undefined;

  let subCircuitId: string | undefined;
  let subCircuitName: string | undefined;
  if (componentType === "subCircuit") {
    subCircuitId = readRequiredString(params, "subCircuitId");
    const targetSub = snapshot.project.logicalCircuits.find((lc) => lc.logicalCircuitId === subCircuitId);
    if (!targetSub) {
      const known = snapshot.project.logicalCircuits.map((lc) => lc.logicalCircuitId).join(", ");
      throw new Error(`Sub-Schaltung "${subCircuitId}" nicht gefunden. Verfügbare IDs: ${known}`);
    }
    subCircuitName = targetSub.name;
  }

  const selection: PaletteSelection = {
    type: componentType,
    name: providedName ?? getDefaultComponentName(componentType, subCircuitName),
    notation: readOptionalString(params, "notation"),
    jamNotation: readOptionalString(params, "jamNotation"),
    note: readOptionalString(params, "note"),
    rotation,
    width,
    height,
    inputCount: readOptionalInteger(params, "inputCount", 1, 18),
    subCircuitId,
    isToggle: readOptionalBoolean(params, "isToggle"),
    inverted: readOptionalBoolean(params, "inverted"),
    keyCode: readOptionalInteger(params, "keyCode", 0),
    modifiers: readOptionalInteger(params, "modifiers", 0),
    bitWidth: readOptionalInteger(params, "bitWidth", 1, 32),
    pinSide: readOptionalEnum(params, "pinSide", ALLOWED_PIN_SIDES),
    isHex: readOptionalBoolean(params, "isHex"),
    displayFormat: readOptionalEnum(params, "displayFormat", PROBE_FORMATS),
    value: readOptionalInteger(params, "value", 0),
    rows: readOptionalInteger(params, "rows", 1, 10),
    columns: readOptionalInteger(params, "columns", 1, 10),
    matrixType: readOptionalEnum(params, "matrixType", ALLOWED_MATRIX_TYPES),
    cellShape: readOptionalEnum(params, "cellShape", ALLOWED_CELL_SHAPES),
    color: readOptionalEnum(params, "color", ALLOWED_DISPLAY_COLORS),
    colors: readOptionalInteger(params, "colors", 1, 3),
    persistenceMultiplier: readOptionalInteger(params, "persistenceMultiplier", 1, 3) as 1 | 2 | 3 | undefined,
    pinCount: readOptionalInteger(params, "pinCount", 2, 32),
    pinBitWidth: readOptionalInteger(params, "pinBitWidth", 1, 32),
    clockwise: readOptionalBoolean(params, "clockwise"),
    sensorType: readOptionalEnum(params, "sensorType", SENSOR_TYPES),
    frequency: readOptionalNumber(params, "frequency", SOUND_MIN_FREQUENCY, SOUND_MAX_FREQUENCY),
    waveform: readOptionalEnum(params, "waveform", ALLOWED_SOUND_WAVEFORMS),
    synthesizerMode: readOptionalEnum(params, "synthesizerMode", ALLOWED_SYNTHESIZER_MODES),
    addressBitWidth: readOptionalInteger(
      params,
      "addressBitWidth",
      MEMORY_MIN_ADDRESS_BIT_WIDTH,
      MEMORY_MAX_ADDRESS_BIT_WIDTH,
    ),
    dataBitWidth: isGraphicsArray
      ? readOptionalAllowedInteger(params, "dataBitWidth", GRAPHICS_ARRAY_DATA_BIT_WIDTHS)
      : readOptionalInteger(params, "dataBitWidth", 1, 32),
    bitsPerPixel: readOptionalAllowedInteger(params, "bitsPerPixel", GRAPHICS_ARRAY_BITS_PER_PIXEL),
    zoom: readOptionalInteger(params, "zoom", GRAPHICS_ARRAY_MIN_ZOOM, GRAPHICS_ARRAY_MAX_ZOOM),
    writeOn1: readOptionalBoolean(params, "writeOn1"),
    onStart: readOptionalEnum(
      params,
      "onStart",
      isGraphicsArray ? GRAPHICS_ARRAY_ON_START_MODES : MEMORY_ON_START_MODES,
    ),
    dualPort: readOptionalBoolean(params, "dualPort"),
    data: readOptionalString(params, "data"),
  };

  return { kind: "symbol", ref, selection, gridPoint: { x, y } };
}

// Erzeugt ein oder zwei orthogonale Leitungssegmente zwischen p1 und p2 gemäß Routing-Modus
function buildWireSegments(
  p1: GridPoint,
  p2: GridPoint,
  route: (typeof ALLOWED_WIRE_ROUTES)[number],
): { point1: GridPoint; point2: GridPoint }[] {
  if (p1.x === p2.x && p1.y === p2.y) {
    throw new Error("Start- und Endpunkt einer Leitung dürfen nicht identisch sein.");
  }
  if (route === "direct" || p1.x === p2.x || p1.y === p2.y) {
    return [{ point1: p1, point2: p2 }];
  }
  const corner: GridPoint = route === "horizontal-first"
    ? { x: p2.x, y: p1.y }
    : { x: p1.x, y: p2.y };
  return [
    { point1: p1, point2: corner },
    { point1: corner, point2: p2 },
  ];
}

// Prüft, ob alle übergebenen Symbol-, Textnotiz- und Leitungs-IDs in der aktiven Schaltung existieren
function assertElementIdsExist(
  circuit: LogicalCircuit,
  ids: { symbolIds?: string[]; textNoteIds?: string[]; wireIds?: string[] },
): void {
  for (const id of ids.symbolIds ?? []) {
    if (!circuit.circuitSymbols.some((s) => s.circuitSymbolId === id)) {
      throw new Error(`Symbol "${id}" in der aktiven Schaltung "${circuit.name}" nicht gefunden.`);
    }
  }
  for (const id of ids.wireIds ?? []) {
    if (!circuit.wires.some((w) => w.wireId === id)) {
      throw new Error(`Leitung "${id}" in der aktiven Schaltung "${circuit.name}" nicht gefunden.`);
    }
  }
  for (const id of ids.textNoteIds ?? []) {
    if (!circuit.textNotes.some((n) => n.textNoteId === id)) {
      throw new Error(`Textnotiz "${id}" in der aktiven Schaltung "${circuit.name}" nicht gefunden.`);
    }
  }
}

// Verschiebt Symbole, Textnotizen und/oder Leitungen gemeinsam um (dx, dy) in einem Undo-Schritt
export function moveElements(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const symbolIds = readOptionalStringArray(params, "symbolIds") ?? [];
  const textNoteIds = readOptionalStringArray(params, "textNoteIds") ?? [];
  const wireIds = readOptionalStringArray(params, "wireIds") ?? [];
  const dx = readRequiredInteger(params, "dx");
  const dy = readRequiredInteger(params, "dy");
  const withWires = readOptionalBoolean(params, "withWires") ?? true;

  if (symbolIds.length === 0 && textNoteIds.length === 0 && wireIds.length === 0) {
    throw new Error("Mindestens eine ID in \"symbolIds\", \"textNoteIds\" oder \"wireIds\" muss angegeben werden.");
  }

  assertElementIdsExist(snapshot.currentCircuit, { symbolIds, textNoteIds, wireIds });

  const result = actions.moveEntities({
    symbolIds,
    textNoteIds,
    wireIds,
    dx,
    dy,
    withWires,
  });

  const updatedCircuit = resolveLatestCircuit(snapshot, actions);
  const latestProject = actions.getProject ? actions.getProject() : snapshot.project;
  const movedWireIds = result.wires.map((w) => w.wireId);

  actions.highlightAiElements?.({
    symbolIds,
    textNoteIds,
    wireIds: movedWireIds,
  });

  return {
    circuitId: updatedCircuit.logicalCircuitId,
    dx,
    dy,
    symbols: result.symbols.map((sym) => describeSymbol(sym, latestProject)),
    textNotes: result.textNotes.map(describeTextNote),
    wires: result.wires.map((w) => ({
      wireId: w.wireId,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      markedBad: Boolean(w.markedBad),
    })),
    removedWireIds: result.removedWireIds,
  };
}

// Rotiert Symbole, Textnotizen und optional Leitungen um 90 Grad in der aktiven Schaltung
export function rotateSymbolsTool(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const symbolIds = readOptionalStringArray(params, "symbolIds") ?? [];
  const textNoteIds = readOptionalStringArray(params, "textNoteIds") ?? [];
  const wireIds = readOptionalStringArray(params, "wireIds") ?? [];
  const direction = readOptionalEnum(params, "direction", ALLOWED_ROTATION_DIRECTIONS) ?? "clockwise";
  const withWires = readOptionalBoolean(params, "withWires") ?? true;

  if (symbolIds.length === 0 && textNoteIds.length === 0 && wireIds.length === 0) {
    throw new Error("Mindestens eine ID in \"symbolIds\", \"textNoteIds\" oder \"wireIds\" muss angegeben werden.");
  }

  assertElementIdsExist(snapshot.currentCircuit, { symbolIds, textNoteIds, wireIds });

  const wiresBefore = captureWireCoordinatesMap(snapshot.currentCircuit.wires);
  actions.rotateSymbols(symbolIds, direction, textNoteIds, { withWires, wireIds });

  const updatedCircuit = resolveLatestCircuit(snapshot, actions);
  const latestProject = actions.getProject ? actions.getProject() : snapshot.project;
  const symbolSet = new Set(symbolIds);
  const updatedSymbols = updatedCircuit.circuitSymbols.filter((s) => symbolSet.has(s.circuitSymbolId));
  const movedWireIds = findModifiedWireIds(wiresBefore, updatedCircuit.wires);
  const highlightWireIds = Array.from(new Set([...wireIds, ...movedWireIds]))
    .filter((id) => updatedCircuit.wires.some((w) => w.wireId === id));
  const updatedWires = updatedCircuit.wires.filter((w) => highlightWireIds.includes(w.wireId));

  actions.highlightAiElements?.({
    symbolIds,
    textNoteIds,
    wireIds: highlightWireIds,
  });

  return {
    circuitId: updatedCircuit.logicalCircuitId,
    direction,
    symbols: updatedSymbols.map((sym) => describeSymbol(sym, latestProject)),
    textNoteIds,
    wires: updatedWires.map((w) => ({
      wireId: w.wireId,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      markedBad: Boolean(w.markedBad),
    })),
  };
}

// Entfernt Symbole, Leitungen und/oder Textnotizen aus der aktiven Schaltung
export function deleteElements(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const symbolIds = readOptionalStringArray(params, "symbolIds") ?? [];
  const wireIds = readOptionalStringArray(params, "wireIds") ?? [];
  const textNoteIds = readOptionalStringArray(params, "textNoteIds") ?? [];

  if (symbolIds.length === 0 && wireIds.length === 0 && textNoteIds.length === 0) {
    throw new Error("Mindestens eine ID in \"symbolIds\", \"wireIds\" oder \"textNoteIds\" muss angegeben werden.");
  }

  assertElementIdsExist(snapshot.currentCircuit, { symbolIds, wireIds, textNoteIds });

  actions.removeEntities(symbolIds, textNoteIds, wireIds);
  const updatedCircuit = resolveLatestCircuit(snapshot, actions);

  return {
    circuitId: updatedCircuit.logicalCircuitId,
    deleted: {
      symbolIds,
      wireIds,
      textNoteIds,
    },
    remainingCounts: {
      symbols: updatedCircuit.circuitSymbols.length,
      wires: updatedCircuit.wires.length,
      textNotes: updatedCircuit.textNotes.length,
    },
  };
}

// Verlegt eine Leitung zwischen zwei Koordinaten oder Bauteil-Anschlüssen (Jams)
export function connectWire(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const p1 = resolveWireEndpoint(snapshot.currentCircuit, params.from, "from");
  const p2 = resolveWireEndpoint(snapshot.currentCircuit, params.to, "to");
  const route = readOptionalEnum(params, "route", ALLOWED_WIRE_ROUTES) ?? "direct";

  const segments = buildWireSegments(p1, p2, route);
  const createdWires = actions.addEntities({ wireSegments: segments }).wires;
  const createdWireIds = createdWires.map((w) => w.wireId);

  if (createdWireIds.length === 0) {
    throw new Error(`Zwischen (${p1.x}, ${p1.y}) und (${p2.x}, ${p2.y}) existiert bereits eine Leitung.`);
  }

  const updatedCircuit = resolveLatestCircuit(snapshot, actions);
  const createdSet = new Set(createdWireIds);
  const finalWires = updatedCircuit.wires.filter((w) => createdSet.has(w.wireId));

  actions.highlightAiElements?.({ wireIds: createdWireIds });

  return {
    circuitId: updatedCircuit.logicalCircuitId,
    from: p1,
    to: p2,
    route,
    wires: finalWires.map((w) => ({
      wireId: w.wireId,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      markedBad: Boolean(w.markedBad),
    })),
    conductorCount: updatedCircuit.conductorMap?.conductors.length ?? 0,
  };
}

// Platziert viele Bauelemente, Textnotizen und Leitungen atomar in einem einzigen Aufruf und Undo-Schritt
export function addElements(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);

  const rawComponents = params.components;
  if (rawComponents !== undefined && !Array.isArray(rawComponents)) {
    throw new Error("Parameter \"components\" muss ein Array sein.");
  }
  const rawWires = params.wires;
  if (rawWires !== undefined && !Array.isArray(rawWires)) {
    throw new Error("Parameter \"wires\" muss ein Array sein.");
  }

  const componentItems = rawComponents ?? [];
  const wireItems = rawWires ?? [];
  if (componentItems.length === 0 && wireItems.length === 0) {
    throw new Error("Mindestens ein Eintrag in \"components\" oder \"wires\" muss angegeben werden.");
  }

  const symbolPlacements: { selection: PaletteSelection; gridPoint: GridPoint; ref?: string }[] = [];
  const textNotePlacements: { note: string; gridPoint: GridPoint; options?: ParsedTextNoteOptions }[] = [];
  const seenRefs = new Set<string>();
  const textNoteRefs = new Set<string>();

  for (let i = 0; i < componentItems.length; i++) {
    const rawItem = componentItems[i];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new Error(`Eintrag components[${i}] muss ein Objekt sein.`);
    }
    const parsed = parseComponentPlacement(snapshot, rawItem as Record<string, unknown>);
    if (parsed.ref !== undefined) {
      if (seenRefs.has(parsed.ref)) {
        throw new Error(`Doppelte Referenz "${parsed.ref}" in "components" ist nicht zulässig.`);
      }
      seenRefs.add(parsed.ref);
    }

    if (parsed.kind === "textNote") {
      if (parsed.ref !== undefined) {
        textNoteRefs.add(parsed.ref);
      }
      textNotePlacements.push({
        note: parsed.note,
        gridPoint: parsed.gridPoint,
        ...(parsed.options ? { options: parsed.options } : {}),
      });
    } else {
      symbolPlacements.push({
        selection: parsed.selection,
        gridPoint: parsed.gridPoint,
        ref: parsed.ref,
      });
    }
  }

  const parsedWireSpecs = wireItems.map((rawWire, index) => {
    if (!rawWire || typeof rawWire !== "object" || Array.isArray(rawWire)) {
      throw new Error(`Eintrag wires[${index}] muss ein Objekt mit "from" und "to" sein.`);
    }
    const wireObj = rawWire as Record<string, unknown>;
    const route = readOptionalEnum(wireObj, "route", ALLOWED_WIRE_ROUTES) ?? "direct";
    return { index, from: wireObj.from, to: wireObj.to, route };
  });

  const result = actions.addEntities({
    symbols: symbolPlacements,
    textNotes: textNotePlacements,
    resolveWires: (placedSymbols) => {
      const symbolByRef = new Map<string, CircuitSymbol>();
      for (const entry of placedSymbols) {
        if (entry.ref !== undefined) {
          symbolByRef.set(entry.ref, entry.symbol);
        }
      }

      const segments: { point1: GridPoint; point2: GridPoint }[] = [];
      for (const spec of parsedWireSpecs) {
        const p1 = resolveWireEndpoint(
          snapshot.currentCircuit,
          spec.from,
          `wires[${spec.index}].from`,
          symbolByRef,
          textNoteRefs,
        );
        const p2 = resolveWireEndpoint(
          snapshot.currentCircuit,
          spec.to,
          `wires[${spec.index}].to`,
          symbolByRef,
          textNoteRefs,
        );
        segments.push(...buildWireSegments(p1, p2, spec.route));
      }
      return segments;
    },
  });

  const updatedCircuit = resolveLatestCircuit(snapshot, actions);
  const latestProject = actions.getProject ? actions.getProject() : snapshot.project;
  const symbolIds = result.symbols.map((s) => s.circuitSymbolId);
  const textNoteIds = result.textNotes.map((n) => n.textNoteId);
  const wireIds = result.wires.map((w) => w.wireId);

  actions.highlightAiElements?.({
    symbolIds,
    textNoteIds,
    wireIds,
  });

  return {
    circuitId: updatedCircuit.logicalCircuitId,
    symbols: result.symbols.map((sym, idx) => ({
      ref: symbolPlacements[idx]?.ref,
      ...describeSymbol(sym, latestProject),
    })),
    textNotes: result.textNotes.map(describeTextNote),
    wires: result.wires.map((w) => ({
      wireId: w.wireId,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      markedBad: Boolean(w.markedBad),
    })),
    conductorCount: updatedCircuit.conductorMap?.conductors.length ?? 0,
  };
}

const TEXT_NOTE_UPDATE_KEYS = new Set([
  "textNoteId",
  "note",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "fontFamily",
  "lineHeight",
]);

const SYMBOL_COMMON_UPDATE_KEYS = new Set(["symbolId", "x", "y", "withWires", "note", "description"]);

// Ermittelt je Symbol-Typ die erlaubten Eigenschafts-Schlüssel für update_element_properties
function getAllowedSymbolUpdateKeys(symbol: CircuitSymbol): Set<string> {
  const { circuit } = symbol;
  switch (circuit.kind) {
    case "gate": {
      const gate = circuit as Gate;
      if (gate.gateType === "led") {
        return new Set(["color"]);
      }
      if (gate.gateType === "triState1" || gate.gateType === "triState2") {
        return new Set(["gateType"]);
      }
      if (gate.gateType === "and" || gate.gateType === "or" || gate.gateType === "xor") {
        return new Set(["gateType", "inputCount", "invertedOutput", "name"]);
      }
      return new Set(["name"]);
    }
    case "circuitButton":
      return new Set(["isToggle", "pinSide", "inverted", "notation", "name", "keyCode", "modifiers", "width", "height"]);
    case "constant":
      return new Set(["bitWidth", "value", "pinSide", "isHex", "width", "height"]);
    case "circuitProbe":
      return new Set(["name", "notation", "pinSide", "isHex", "displayFormat", "width", "height"]);
    case "pin":
      return new Set(["name", "notation", "jamNotation", "pinType", "bitWidth", "pinSide", "inverted", "width", "height"]);
    case "ledMatrix":
      return new Set([
        "rows",
        "columns",
        "width",
        "height",
        "matrixType",
        "cellShape",
        "colors",
        "persistenceMultiplier",
        "name",
      ]);
    case "splitter":
      return new Set(["pinCount", "pinBitWidth", "bitWidth", "clockwise"]);
    case "sensor":
      return new Set(["sensorType", "bitWidth", "pinSide", "notation", "data"]);
    case "sound":
      return new Set(["pinSide", "notation", "frequency", "waveform"]);
    case "synthesizer":
      return new Set(["notation", "synthesizerMode"]);
    case "memory": {
      const memory = circuit as Memory;
      return memory.writable
        ? new Set(["addressBitWidth", "dataBitWidth", "writeOn1", "onStart", "dualPort", "data"])
        : new Set(["addressBitWidth", "dataBitWidth", "dualPort", "data"]);
    }
    case "graphicsArray":
      return new Set([
        "writeOn1",
        "onStart",
        "dataBitWidth",
        "bitsPerPixel",
        "width",
        "height",
        "zoom",
      ]);
    default:
      return new Set();
  }
}

// Validiert und erstellt das Update-Payload für eine Text-Notiz
function buildTextNoteUpdatePayload(params: Record<string, unknown>): Partial<TextNote> {
  for (const key of Object.keys(params)) {
    if (!TEXT_NOTE_UPDATE_KEYS.has(key)) {
      throw new Error(`Parameter "${key}" wird für Text-Notizen nicht unterstützt.`);
    }
  }

  const updates: Partial<TextNote> = {};
  const note = readOptionalString(params, "note");
  const x = readOptionalInteger(params, "x");
  const y = readOptionalInteger(params, "y");
  const width = readOptionalInteger(params, "width", TEXT_NOTE_MIN_GRID_SIZE, TEXT_NOTE_MAX_GRID_SIZE);
  const height = readOptionalInteger(params, "height", TEXT_NOTE_MIN_GRID_SIZE, TEXT_NOTE_MAX_GRID_SIZE);
  const rotation = readOptionalEnum(params, "rotation", ROTATIONS);
  const fontFamily = readOptionalEnum(params, "fontFamily", TEXT_NOTE_FONT_FAMILIES);
  const lineHeight = readOptionalLineHeight(params);

  if (note !== undefined) {
    updates.note = note;
  }
  if (x !== undefined) {
    updates.x = x;
  }
  if (y !== undefined) {
    updates.y = y;
  }
  if (width !== undefined) {
    updates.width = width;
  }
  if (height !== undefined) {
    updates.height = height;
  }
  if (rotation !== undefined) {
    updates.rotation = rotation;
  }
  if (fontFamily !== undefined) {
    updates.fontFamily = fontFamily;
  }
  if (lineHeight !== undefined) {
    updates.lineHeight = lineHeight;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("Mindestens eine zu aktualisierende Eigenschaft der Text-Notiz muss angegeben werden.");
  }

  return updates;
}

// Validiert und erstellt das Update-Payload für ein platziertes Bauteil-Symbol
function buildSymbolUpdatePayload(
  symbol: CircuitSymbol,
  params: Record<string, unknown>,
): {
  updates: CircuitSymbolPropertiesUpdate;
  x?: number;
  y?: number;
  withWires: boolean;
} {
  if (symbol.circuit.kind === "logicalCircuit") {
    throw new Error(
      "Eigenschaften eingebetteter Sub-Schaltungen werden über 'update_circuit_properties' mit deren 'circuitId' geändert.",
    );
  }
  if (params.rotation !== undefined) {
    throw new Error("Parameter \"rotation\" wird für Symbole über 'rotate_symbols' geändert.");
  }

  const allowedSpecific = getAllowedSymbolUpdateKeys(symbol);
  for (const key of Object.keys(params)) {
    if (!SYMBOL_COMMON_UPDATE_KEYS.has(key) && !allowedSpecific.has(key)) {
      const kindLabel = symbol.circuit.kind === "gate"
        ? `gate (${(symbol.circuit as Gate).gateType})`
        : (symbol.circuit.kind ?? "unknown");
      throw new Error(`Parameter "${key}" wird für Symboltyp "${kindLabel}" nicht unterstützt.`);
    }
  }

  const x = readOptionalInteger(params, "x");
  const y = readOptionalInteger(params, "y");
  const withWires = readOptionalBoolean(params, "withWires") ?? true;

  const updates: CircuitSymbolPropertiesUpdate = {};
  const note = readOptionalString(params, "note");
  const description = readOptionalString(params, "description");
  if (note !== undefined) {
    updates.note = note;
  } else if (description !== undefined) {
    updates.note = description;
  }

  const isButton = symbol.circuit.kind === "circuitButton";
  const isMatrix = symbol.circuit.kind === "ledMatrix";
  const isGraphicsArray = symbol.circuit.kind === "graphicsArray";
  const minWidth = isMatrix
    ? LED_MATRIX_MIN_DIM + 1
    : (isGraphicsArray
      ? GRAPHICS_ARRAY_MIN_WIDTH
      : (isButton ? BUTTON_MIN_GRID_SIZE : RESIZABLE_SYMBOL_MIN_GRID_SIZE));
  const maxWidth = isMatrix
    ? LED_MATRIX_MAX_DIM + 1
    : (isGraphicsArray
      ? GRAPHICS_ARRAY_MAX_WIDTH
      : (isButton ? BUTTON_MAX_GRID_SIZE : RESIZABLE_SYMBOL_MAX_GRID_SIZE));
  const minHeight = isMatrix
    ? LED_MATRIX_MIN_DIM + 1
    : (isGraphicsArray
      ? GRAPHICS_ARRAY_MIN_HEIGHT
      : (isButton ? BUTTON_MIN_GRID_SIZE : RESIZABLE_SYMBOL_MIN_GRID_SIZE));
  const maxHeight = isMatrix
    ? LED_MATRIX_MAX_DIM + 1
    : (isGraphicsArray
      ? GRAPHICS_ARRAY_MAX_HEIGHT
      : (isButton ? BUTTON_MAX_GRID_SIZE : RESIZABLE_SYMBOL_MAX_GRID_SIZE));

  const width = allowedSpecific.has("width")
    ? readOptionalInteger(params, "width", minWidth, maxWidth)
    : undefined;
  const height = allowedSpecific.has("height")
    ? readOptionalInteger(params, "height", minHeight, maxHeight)
    : undefined;

  if (isMatrix) {
    const rows = readOptionalInteger(params, "rows", LED_MATRIX_MIN_DIM, LED_MATRIX_MAX_DIM);
    const columns = readOptionalInteger(params, "columns", LED_MATRIX_MIN_DIM, LED_MATRIX_MAX_DIM);
    if (rows !== undefined && height !== undefined && height - 1 !== rows) {
      throw new Error("Parameter \"rows\" und \"height\" widersprechen sich bei LED-Matrix (height = rows + 1).");
    }
    if (columns !== undefined && width !== undefined && width - 1 !== columns) {
      throw new Error("Parameter \"columns\" und \"width\" widersprechen sich bei LED-Matrix (width = columns + 1).");
    }
    const resolvedRows = rows ?? (height !== undefined ? height - 1 : undefined);
    const resolvedColumns = columns ?? (width !== undefined ? width - 1 : undefined);
    if (resolvedRows !== undefined) {
      updates.rows = resolvedRows;
    }
    if (resolvedColumns !== undefined) {
      updates.columns = resolvedColumns;
    }
  } else {
    if (width !== undefined) {
      updates.width = width;
    }
    if (height !== undefined) {
      updates.height = height;
    }
  }

  const name = readOptionalString(params, "name");
  const notation = readOptionalString(params, "notation");
  if (symbol.circuit.kind === "circuitProbe" || symbol.circuit.kind === "pin") {
    const resolvedName = name ?? notation;
    if (resolvedName !== undefined) {
      updates.name = resolvedName;
    }
  } else {
    if (name !== undefined) {
      updates.name = name;
    }
    if (notation !== undefined) {
      updates.notation = notation;
    }
  }
  const jamNotation = readOptionalString(params, "jamNotation");
  if (jamNotation !== undefined) {
    updates.jamNotation = jamNotation;
  }

  const gateType = readOptionalEnum(params, "gateType", ALLOWED_UPDATE_GATE_TYPES);
  if (gateType !== undefined) {
    const currentGate = symbol.circuit as Gate;
    const isCurrentTri = currentGate.gateType === "triState1" || currentGate.gateType === "triState2";
    const isNextTri = gateType === "triState1" || gateType === "triState2";
    if (isCurrentTri !== isNextTri) {
      throw new Error(`gateType "${currentGate.gateType}" kann nicht auf "${gateType}" umgestellt werden.`);
    }
    updates.gateType = gateType;
  }

  const inputCount = readOptionalInteger(params, "inputCount", 2, 18);
  if (inputCount !== undefined) {
    updates.inputCount = inputCount;
  }
  const invertedOutput = readOptionalBoolean(params, "invertedOutput");
  if (invertedOutput !== undefined) {
    updates.invertedOutput = invertedOutput;
  }
  const color = readOptionalEnum(params, "color", ALLOWED_DISPLAY_COLORS);
  if (color !== undefined) {
    updates.color = color;
  }
  const isToggle = readOptionalBoolean(params, "isToggle");
  if (isToggle !== undefined) {
    updates.isToggle = isToggle;
  }
  const inverted = readOptionalBoolean(params, "inverted");
  if (inverted !== undefined) {
    updates.inverted = inverted;
  }
  const keyCode = readOptionalInteger(params, "keyCode", 0);
  if (keyCode !== undefined) {
    updates.keyCode = keyCode;
  }
  const modifiers = readOptionalInteger(params, "modifiers", 0);
  if (modifiers !== undefined) {
    updates.modifiers = modifiers;
  }
  const pinSide = readOptionalEnum(params, "pinSide", ALLOWED_PIN_SIDES);
  if (pinSide !== undefined) {
    updates.pinSide = pinSide;
  }
  const pinType = readOptionalEnum(params, "pinType", ALLOWED_IO_PIN_TYPES);
  if (pinType !== undefined) {
    updates.pinType = pinType;
  }
  const bitWidth = readOptionalInteger(params, "bitWidth", 1, 32);
  if (bitWidth !== undefined) {
    updates.bitWidth = bitWidth;
  }
  const value = readOptionalInteger(params, "value", 0);
  if (value !== undefined) {
    updates.value = value;
  }
  const isHex = readOptionalBoolean(params, "isHex");
  if (isHex !== undefined) {
    updates.isHex = isHex;
  }
  const displayFormat = readOptionalEnum(params, "displayFormat", PROBE_FORMATS);
  if (displayFormat !== undefined) {
    updates.displayFormat = displayFormat;
  }
  const matrixType = readOptionalEnum(params, "matrixType", ALLOWED_MATRIX_TYPES);
  if (matrixType !== undefined) {
    updates.matrixType = matrixType;
  }
  const cellShape = readOptionalEnum(params, "cellShape", ALLOWED_CELL_SHAPES);
  if (cellShape !== undefined) {
    updates.cellShape = cellShape;
  }
  const colors = readOptionalInteger(params, "colors", 1, 3);
  if (colors !== undefined) {
    updates.colors = colors;
  }
  const persistenceMultiplier = readOptionalInteger(params, "persistenceMultiplier", 1, 3);
  if (persistenceMultiplier !== undefined) {
    updates.persistenceMultiplier = persistenceMultiplier as 1 | 2 | 3;
  }
  const pinCount = readOptionalInteger(params, "pinCount", 2, 32);
  if (pinCount !== undefined) {
    updates.pinCount = pinCount;
  }
  const pinBitWidth = readOptionalInteger(params, "pinBitWidth", 1, 32);
  if (pinBitWidth !== undefined) {
    updates.pinBitWidth = pinBitWidth;
  }
  const clockwise = readOptionalBoolean(params, "clockwise");
  if (clockwise !== undefined) {
    updates.clockwise = clockwise;
  }
  const sensorType = readOptionalEnum(params, "sensorType", SENSOR_TYPES);
  if (sensorType !== undefined) {
    updates.sensorType = sensorType;
  }
  const frequency = readOptionalNumber(
    params,
    "frequency",
    SOUND_MIN_FREQUENCY,
    SOUND_MAX_FREQUENCY,
  );
  if (frequency !== undefined) {
    updates.frequency = frequency;
  }
  const waveform = readOptionalEnum(params, "waveform", ALLOWED_SOUND_WAVEFORMS);
  if (waveform !== undefined) {
    updates.waveform = waveform;
  }
  const synthesizerMode = readOptionalEnum(params, "synthesizerMode", ALLOWED_SYNTHESIZER_MODES);
  if (synthesizerMode !== undefined) {
    updates.synthesizerMode = synthesizerMode;
  }
  const addressBitWidth = readOptionalInteger(
    params,
    "addressBitWidth",
    MEMORY_MIN_ADDRESS_BIT_WIDTH,
    MEMORY_MAX_ADDRESS_BIT_WIDTH,
  );
  if (addressBitWidth !== undefined) {
    updates.addressBitWidth = addressBitWidth;
  }
  const dataBitWidth = isGraphicsArray
    ? readOptionalAllowedInteger(params, "dataBitWidth", GRAPHICS_ARRAY_DATA_BIT_WIDTHS)
    : readOptionalInteger(params, "dataBitWidth", 1, 32);
  if (dataBitWidth !== undefined) {
    updates.dataBitWidth = dataBitWidth;
  }
  const bitsPerPixel = readOptionalAllowedInteger(params, "bitsPerPixel", GRAPHICS_ARRAY_BITS_PER_PIXEL);
  if (bitsPerPixel !== undefined) {
    updates.bitsPerPixel = bitsPerPixel;
  }
  const zoom = readOptionalInteger(params, "zoom", GRAPHICS_ARRAY_MIN_ZOOM, GRAPHICS_ARRAY_MAX_ZOOM);
  if (zoom !== undefined) {
    updates.zoom = zoom;
  }
  const writeOn1 = readOptionalBoolean(params, "writeOn1");
  if (writeOn1 !== undefined) {
    updates.writeOn1 = writeOn1;
  }
  const onStart = readOptionalEnum(
    params,
    "onStart",
    isGraphicsArray ? GRAPHICS_ARRAY_ON_START_MODES : MEMORY_ON_START_MODES,
  );
  if (onStart !== undefined) {
    updates.onStart = onStart;
  }
  const dualPort = readOptionalBoolean(params, "dualPort");
  if (dualPort !== undefined) {
    updates.dualPort = dualPort;
  }
  const data = readOptionalString(params, "data");
  if (data !== undefined) {
    updates.data = data;
  }

  if (Object.keys(updates).length === 0 && x === undefined && y === undefined) {
    throw new Error("Mindestens eine zu aktualisierende Eigenschaft oder Position muss angegeben werden.");
  }

  return { updates, x, y, withWires };
}

// Aktualisiert Eigenschaften und/oder Rastergröße eines platzierten Symbols oder einer Text-Notiz
export function updateElementPropertiesTool(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const symbolId = readOptionalString(params, "symbolId");
  const textNoteId = readOptionalString(params, "textNoteId");

  if (symbolId !== undefined && textNoteId !== undefined) {
    throw new Error("Parameter \"symbolId\" und \"textNoteId\" können nicht gleichzeitig angegeben werden.");
  }
  if (symbolId === undefined && textNoteId === undefined) {
    throw new Error("Entweder \"symbolId\" oder \"textNoteId\" muss angegeben werden.");
  }

  const liveSnapshot = resolveLiveSnapshot(snapshot);
  const currentCircuit = liveSnapshot.currentCircuit;

  if (textNoteId !== undefined) {
    const existingNote = currentCircuit.textNotes.find((n) => n.textNoteId === textNoteId);
    if (!existingNote) {
      throw new Error(`Textnotiz "${textNoteId}" in der aktiven Schaltung "${currentCircuit.name}" nicht gefunden.`);
    }

    const noteUpdates = buildTextNoteUpdatePayload(params);
    actions.updateTextNote(textNoteId, noteUpdates);

    const updatedCircuit = resolveLatestCircuit(snapshot, actions);
    const updatedNote = updatedCircuit.textNotes.find((n) => n.textNoteId === textNoteId) ?? existingNote;

    actions.highlightAiElements?.({ textNoteIds: [textNoteId] });

    return {
      circuitId: updatedCircuit.logicalCircuitId,
      targetType: "textNote" as const,
      textNote: describeTextNote(updatedNote),
    };
  }

  const targetSymbolId = symbolId as string;
  const existingSymbol = currentCircuit.circuitSymbols.find((s) => s.circuitSymbolId === targetSymbolId);
  if (!existingSymbol) {
    throw new Error(`Symbol "${targetSymbolId}" in der aktiven Schaltung "${currentCircuit.name}" nicht gefunden.`);
  }

  const { updates, x, y, withWires } = buildSymbolUpdatePayload(existingSymbol, params);
  const wiresBefore = captureWireCoordinatesMap(currentCircuit.wires);
  const updated = actions.updateCircuitSymbolProperties(targetSymbolId, updates, { x, y, withWires });

  const updatedCircuit = resolveLatestCircuit(snapshot, actions);
  const latestProject = actions.getProject ? actions.getProject() : liveSnapshot.project;
  const finalSymbol = updated ??
    updatedCircuit.circuitSymbols.find((s) => s.circuitSymbolId === targetSymbolId) ??
    existingSymbol;
  const movedWireIds = findModifiedWireIds(wiresBefore, updatedCircuit.wires);
  const updatedWires = updatedCircuit.wires.filter((w) => movedWireIds.includes(w.wireId));

  actions.highlightAiElements?.({
    symbolIds: [targetSymbolId],
    wireIds: movedWireIds,
  });

  return {
    circuitId: updatedCircuit.logicalCircuitId,
    targetType: "symbol" as const,
    symbol: describeSymbol(finalSymbol, latestProject),
    wires: updatedWires.map((w) => ({
      wireId: w.wireId,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      markedBad: Boolean(w.markedBad),
    })),
  };
}

// Wechselt die aktuell im Editor aktive Schaltung
export function setCurrentCircuit(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const circuitId = readRequiredString(params, "circuitId");
  resolveCircuit(snapshot, circuitId);

  const previousCircuitId = snapshot.currentCircuit.logicalCircuitId;
  actions.setCurrentCircuitId(circuitId);

  const updatedCircuit = resolveLatestCircuit(snapshot, actions);
  return {
    previousCircuitId,
    currentCircuitId: updatedCircuit.logicalCircuitId,
    circuit: {
      logicalCircuitId: updatedCircuit.logicalCircuitId,
      name: updatedCircuit.name,
      notation: updatedCircuit.notation,
      category: updatedCircuit.category,
      note: updatedCircuit.note,
      symbolCount: updatedCircuit.circuitSymbols.length,
      wireCount: updatedCircuit.wires.length,
      textNoteCount: updatedCircuit.textNotes.length,
      pinCount: updatedCircuit.pins.length,
    },
  };
}

// Parst und validiert das optionale pinOrder-Array für update_circuit_properties
function readOptionalPinOrder(params: Record<string, unknown>): { pinId: string; index: number }[] | undefined {
  const raw = params.pinOrder;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new Error("Parameter \"pinOrder\" muss ein Array von { pinId, index } sein.");
  }
  return raw.map((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Eintrag pinOrder[${idx}] muss ein Objekt { pinId, index } sein.`);
    }
    const obj = entry as Record<string, unknown>;
    const index = readOptionalInteger(obj, "index", 0);
    if (index === undefined) {
      throw new Error(`Eintrag pinOrder[${idx}].index ist erforderlich und muss eine Ganzzahl >= 0 sein.`);
    }
    return {
      pinId: readRequiredString(obj, "pinId"),
      index,
    };
  });
}

// Aktualisiert Metadaten, Symbolform und Pin-Reihenfolge einer Schaltung
export function updateCircuitPropertiesTool(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const circuitId = readOptionalString(params, "circuitId");
  const targetCircuit = resolveCircuit(snapshot, circuitId);

  const name = readOptionalString(params, "name");
  const notation = readOptionalString(params, "notation");
  const category = readOptionalString(params, "category");
  const note = readOptionalString(params, "note");
  const description = readOptionalString(params, "description");
  const circuitShape = readOptionalEnum(params, "circuitShape", ALLOWED_CIRCUIT_SHAPES);
  const showLabelAbove = readOptionalBoolean(params, "showLabelAbove");
  const displayMargin = readOptionalEnum(params, "displayMargin", ALLOWED_DISPLAY_MARGINS);
  const exportToHDL = readOptionalBoolean(params, "exportToHDL");
  const pinOrder = readOptionalPinOrder(params);

  const hasAnyUpdate =
    name !== undefined ||
    notation !== undefined ||
    category !== undefined ||
    note !== undefined ||
    description !== undefined ||
    circuitShape !== undefined ||
    showLabelAbove !== undefined ||
    displayMargin !== undefined ||
    exportToHDL !== undefined ||
    pinOrder !== undefined;

  if (!hasAnyUpdate) {
    throw new Error(
      "Mindestens eine zu aktualisierende Eigenschaft (\"name\", \"notation\", \"category\", \"note\", " +
      "\"description\", \"circuitShape\", \"showLabelAbove\", \"displayMargin\", \"exportToHDL\" oder \"pinOrder\") muss angegeben werden.",
    );
  }
  if (name !== undefined && name.trim().length === 0) {
    throw new Error("Parameter \"name\" darf nicht leer sein.");
  }

  const latestBefore = actions.getProject ? actions.getProject() : snapshot.project;
  if (circuitShape === "display") {
    const lcById = new Map(latestBefore.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]));
    if (!circuitContainsDisplays(targetCircuit, lcById)) {
      throw new Error(
        "Die Symbolform \"display\" erfordert mindestens ein enthaltenes Display-Element " +
        "(LED, 7-Segment, LED-Matrix oder Display-Subschaltung).",
      );
    }
  }

  const updated = actions.updateCircuitProperties(targetCircuit.logicalCircuitId, {
    name,
    notation,
    category,
    note,
    description,
    circuitShape,
    showLabelAbove,
    displayMargin,
    exportToHDL,
    pinOrder,
  });

  const latestProject = actions.getProject ? actions.getProject() : snapshot.project;
  const finalLc = updated ??
    latestProject.logicalCircuits.find((lc) => lc.logicalCircuitId === targetCircuit.logicalCircuitId) ??
    targetCircuit;

  return {
    circuitId: finalLc.logicalCircuitId,
    name: finalLc.name,
    notation: finalLc.notation,
    category: finalLc.category,
    note: finalLc.note,
    circuitShape: finalLc.circuitShape,
    isDisplay: finalLc.isDisplay,
    showLabelAbove: Boolean(finalLc.showLabelAbove),
    displayMargin: finalLc.displayMargin ?? "none",
    exportToHDL: finalLc.exportToHDL,
  };
}

// Legt eine oder mehrere neue (Sub-)Schaltungen atomar im Projekt an
export function createCircuitsTool(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const rawCircuits = params.circuits;
  if (!Array.isArray(rawCircuits) || rawCircuits.length === 0) {
    throw new Error("Parameter \"circuits\" muss ein nicht-leeres Array von Schaltungsdefinitionen sein.");
  }

  const inputs: CreateCircuitInput[] = rawCircuits.map((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Eintrag circuits[${idx}] muss ein Objekt sein.`);
    }
    const obj = entry as Record<string, unknown>;
    return {
      name: readRequiredString(obj, "name"),
      notation: readOptionalString(obj, "notation"),
      category: readOptionalString(obj, "category"),
      note: readOptionalString(obj, "note"),
      circuitShape: readOptionalEnum(obj, "circuitShape", ALLOWED_CREATE_CIRCUIT_SHAPES),
      showLabelAbove: readOptionalBoolean(obj, "showLabelAbove"),
      displayMargin: readOptionalEnum(obj, "displayMargin", ALLOWED_DISPLAY_MARGINS),
      exportToHDL: readOptionalBoolean(obj, "exportToHDL"),
    };
  });

  const created = actions.createCircuits(inputs);
  const latestProject = actions.getProject ? actions.getProject() : snapshot.project;

  return {
    circuits: created.map((lc) => ({
      logicalCircuitId: lc.logicalCircuitId,
      name: lc.name,
      notation: lc.notation,
      category: lc.category,
      note: lc.note,
      circuitShape: lc.circuitShape,
      showLabelAbove: Boolean(lc.showLabelAbove),
      displayMargin: lc.displayMargin ?? "none",
      exportToHDL: lc.exportToHDL,
    })),
    totalCircuits: latestProject.logicalCircuits.length,
  };
}

// Löscht eine oder mehrere Schaltungen über ihre IDs aus dem Projekt
export function deleteCircuitsTool(snapshot: McpCircuitSnapshot, params: Record<string, unknown>) {
  const actions = requireWritableActions(snapshot);
  const circuitIds = readOptionalStringArray(params, "circuitIds") ?? [];
  if (circuitIds.length === 0) {
    throw new Error("Parameter \"circuitIds\" muss ein nicht-leeres Array von Schaltungs-IDs sein.");
  }

  const result = actions.deleteCircuits(circuitIds);
  const latestProject = actions.getProject ? actions.getProject() : snapshot.project;

  return {
    deletedCircuitIds: result.deletedCircuitIds,
    currentCircuitId: result.currentCircuitId,
    remainingCircuits: latestProject.logicalCircuits.map((lc) => ({
      logicalCircuitId: lc.logicalCircuitId,
      name: lc.name,
      category: lc.category,
    })),
  };
}

const MCP_TOOL_HANDLERS: Record<string, McpToolHandler> = {
  get_component_catalog: (snapshot, params) => getComponentCatalogTool(snapshot, params),
  get_circuit_summary: (snapshot) => getCircuitSummary(snapshot),
  get_circuit_details: (snapshot, params) => getCircuitDetails(snapshot, params),
  get_circuit_image: (snapshot, params) => getCircuitImage(snapshot, params),
  add_elements: (snapshot, params) => addElements(snapshot, params),
  move_elements: (snapshot, params) => moveElements(snapshot, params),
  rotate_symbols: (snapshot, params) => rotateSymbolsTool(snapshot, params),
  delete_elements: (snapshot, params) => deleteElements(snapshot, params),
  update_element_properties: (snapshot, params) => updateElementPropertiesTool(snapshot, params),
  connect_wire: (snapshot, params) => connectWire(snapshot, params),
  set_current_circuit: (snapshot, params) => setCurrentCircuit(snapshot, params),
  update_circuit_properties: (snapshot, params) => updateCircuitPropertiesTool(snapshot, params),
  create_circuits: (snapshot, params) => createCircuitsTool(snapshot, params),
  delete_circuits: (snapshot, params) => deleteCircuitsTool(snapshot, params),
  validate_circuit: (snapshot, params) => validateCircuitTool(snapshot, params),
  set_input_signal: (snapshot, params) => setInputSignalTool(snapshot, params),
  step_simulation: (snapshot, params) => stepSimulationTool(snapshot, params),
};

// Liefert die Namen aller im Browser implementierten Werkzeuge
export function getImplementedMcpToolNames(): string[] {
  return Object.keys(MCP_TOOL_HANDLERS);
}

// Führt ein MCP-Werkzeug auf dem übergebenen Editor-Zustand aus
export async function executeMcpTool(name: string, params: unknown, snapshot: McpCircuitSnapshot): Promise<unknown> {
  const handler = Object.hasOwn(MCP_TOOL_HANDLERS, name) ? MCP_TOOL_HANDLERS[name] : undefined;
  if (!handler) {
    throw new Error(`Unbekanntes MCP-Werkzeug: "${name}"`);
  }
  return await handler(snapshot, normalizeParams(params));
}
