import type CircuitShape from "../../types/circuit/circuitShape";
import type DisplayColor from "../../types/circuit/displayColor";
import type LedMatrixCellShape from "../../types/circuit/ledMatrixCellShape";
import type LedMatrixType from "../../types/circuit/ledMatrixType";
import type MemoryOnStart from "../../types/circuit/memoryOnStart";
import type PinSide from "../../types/circuit/pinSide";
import type PinType from "../../types/circuit/pinType";
import type Rotation from "../../types/circuit/rotation";
import type SensorType from "../../types/circuit/sensorType";
import type SoundWaveform from "../../types/circuit/soundWaveform";
import type TextNoteFontFamily from "../../types/circuit/textNoteFontFamily";
import type TextNoteLineHeight from "../../types/circuit/textNoteLineHeight";

export const LOGIC_CIRCUIT_DESKTOP_NAMESPACE = "http://LogicCircuit.net/2.0.0.14/CircuitProject.xsd";
export const LOGIC_CIRCUIT_CURRENT_NAMESPACE = LOGIC_CIRCUIT_DESKTOP_NAMESPACE;
export const LOGIC_CIRCUIT_XML_PREFIX = "lc";
export const LOGIC_CIRCUIT_ATTRIBUTE_LENGTH_LIMIT = 4096;
export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

export const SUPPORTED_LOGIC_CIRCUIT_2X_NAMESPACES: ReadonlySet<string> = new Set([
  "http://LogicCircuit.net/2.0.0.1/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.2/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.3/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.4/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.5/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.6/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.7/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.8/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.9/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.10/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.11/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.12/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.13/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.14/CircuitProject.xsd",
  "http://LogicCircuit.net/2.0.0.15/CircuitProject.xsd",
]);

export const LEGACY_UNSUPPORTED_1X_NAMESPACES: ReadonlySet<string> = new Set([
  "http://LogicCircuit.net/1.0.0.2/CircuitProject.xsd",
  "http://LogicCircuit.net/1.0.0.3/CircuitProject.xsd",
]);

export const XML_ROOT_NAME = "CircuitProject";

export const XML_TABLES = {
  project: "Project",
  collapsedCategory: "CollapsedCategory",
  logicalCircuit: "LogicalCircuit",
  pin: "Pin",
  circuitProbe: "CircuitProbe",
  constant: "Constant",
  circuitButton: "CircuitButton",
  memory: "Memory",
  ledMatrix: "LedMatrix",
  splitter: "Splitter",
  sensor: "Sensor",
  sound: "Sound",
  graphicsArray: "GraphicsArray",
  circuitSymbol: "CircuitSymbol",
  wire: "Wire",
  textNote: "TextNote",
} as const;

export const PROJECT_DEFAULTS = {
  name: "Circuit Project",
  note: "",
  zoom: 1,
  frequency: 10,
  isMaximumSpeed: false,
  categoryTextNoteCollapsed: false,
  categoryInputOutputCollapsed: false,
  categoryPrimitivesCollapsed: false,
} as const;

export const LOGICAL_CIRCUIT_DEFAULTS = {
  name: "Main",
  notation: "",
  note: "",
  category: "",
  circuitShape: "rectangular" as CircuitShape,
  validators: "",
  exportToHDL: true,
} as const;

export const SOUND_WEB_DEFAULTS = {
  frequency: 440,
  waveform: "sine" as SoundWaveform,
} as const;

// Prüft, ob ein XML-Namespace zu einer unterstützten 2.0.0.x-Version gehört
export function isSupportedLogicCircuitNamespace(namespaceUri: string): boolean {
  const normalized = namespaceUri.trim().toLowerCase();
  for (const ns of SUPPORTED_LOGIC_CIRCUIT_2X_NAMESPACES) {
    if (ns.toLowerCase() === normalized) {
      return true;
    }
  }
  return false;
}

// Prüft, ob ein XML-Namespace zu einer bekannten, nicht unterstützten 1.0.0.x-Version gehört
export function isLegacyUnsupportedNamespace(namespaceUri: string): boolean {
  const normalized = namespaceUri.trim().toLowerCase();
  for (const ns of LEGACY_UNSUPPORTED_1X_NAMESPACES) {
    if (ns.toLowerCase() === normalized) {
      return true;
    }
  }
  return false;
}

// Parst einen XML-Boolean-Wert tolerant ("True", "true", "1")
export function parseXmlBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return defaultValue;
}

// Parst eine Ganzzahl aus XML mit Fallback auf den Standardwert
export function parseXmlInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

// Parst eine Gleitkommazahl aus XML mit Fallback auf den Standardwert
export function parseXmlFloat(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

// Normalisiert eine GUID (entfernt geschweifte Klammern und konvertiert in Kleinbuchstaben)
export function normalizeGuid(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.trim().replace(/^\{|\}$/g, "").toLowerCase();
}

// Konvertiert C#-Rotation-Namen in den TypeScript-Typ Rotation
export function parseRotation(value: string | undefined, defaultValue: Rotation = "up"): Rotation {
  switch (value?.trim().toLowerCase()) {
    case "up":
      return "up";
    case "right":
      return "right";
    case "down":
      return "down";
    case "left":
      return "left";
    default:
      return defaultValue;
  }
}

// Konvertiert C#-PinSide-Namen in den TypeScript-Typ PinSide
export function parsePinSide(value: string | undefined, defaultValue: PinSide = "left"): PinSide {
  switch (value?.trim().toLowerCase()) {
    case "left":
      return "left";
    case "top":
      return "top";
    case "right":
      return "right";
    case "bottom":
      return "bottom";
    default:
      return defaultValue;
  }
}

// Konvertiert C#-PinType-Namen in den TypeScript-Typ PinType
export function parsePinType(value: string | undefined, defaultValue: PinType = "input"): PinType {
  switch (value?.trim().toLowerCase()) {
    case "none":
      return "none";
    case "input":
      return "input";
    case "output":
      return "output";
    default:
      return defaultValue;
  }
}

// Konvertiert C#-CircuitShape-Namen in den TypeScript-Typ CircuitShape
export function parseCircuitShape(
  value: string | undefined,
  defaultValue: CircuitShape = "rectangular",
): CircuitShape {
  switch (value?.trim().toLowerCase()) {
    case "rectangular":
      return "rectangular";
    case "display":
      return "display";
    case "mux":
      return "mux";
    case "demux":
      return "demux";
    case "alu":
      return "alu";
    case "flipflop":
      return "flipFlop";
    default:
      return defaultValue;
  }
}

// Konvertiert C#-MemoryOnStart-Namen in den TypeScript-Typ MemoryOnStart
export function parseMemoryOnStart(
  value: string | undefined,
  defaultValue: MemoryOnStart = "random",
): MemoryOnStart {
  switch (value?.trim().toLowerCase()) {
    case "random":
      return "random";
    case "zeros":
      return "zeros";
    case "ones":
      return "ones";
    case "data":
      return "data";
    default:
      return defaultValue;
  }
}

// Konvertiert C#-LedMatrixType-Namen in den TypeScript-Typ LedMatrixType
export function parseLedMatrixType(
  value: string | undefined,
  defaultValue: LedMatrixType = "individual",
): LedMatrixType {
  switch (value?.trim().toLowerCase()) {
    case "individual":
      return "individual";
    case "selector":
      return "selector";
    default:
      return defaultValue;
  }
}

// Konvertiert C#-LedMatrixCellShape-Namen in den TypeScript-Typ LedMatrixCellShape
export function parseLedMatrixCellShape(
  value: string | undefined,
  defaultValue: LedMatrixCellShape = "round",
): LedMatrixCellShape {
  switch (value?.trim().toLowerCase()) {
    case "round":
      return "round";
    case "rect":
    case "rectangle":
      return "rect";
    default:
      return defaultValue;
  }
}

// Konvertiert C#-SensorType-Namen in den TypeScript-Typ SensorType
export function parseSensorType(
  value: string | undefined,
  defaultValue: SensorType = "random",
): SensorType {
  switch (value?.trim().toLowerCase()) {
    case "random":
      return "random";
    case "manual":
      return "manual";
    case "series":
      return "series";
    case "loop":
      return "loop";
    case "ascii":
      return "ascii";
    case "keycode":
      return "keyCode";
    case "sequence":
      return "sequence";
    case "clock":
      return "clock";
    default:
      return defaultValue;
  }
}

// Konvertiert optionale Web-LED-Farbe in den TypeScript-Typ DisplayColor
export function parseDisplayColor(
  value: string | undefined,
  defaultValue: DisplayColor = "red",
): DisplayColor {
  switch (value?.trim().toLowerCase()) {
    case "red":
      return "red";
    case "green":
      return "green";
    case "blue":
      return "blue";
    case "yellow":
      return "yellow";
    default:
      return defaultValue;
  }
}

// Konvertiert optionale Web-Wellenform in den TypeScript-Typ SoundWaveform
export function parseSoundWaveform(
  value: string | undefined,
  defaultValue: SoundWaveform = "sine",
): SoundWaveform {
  switch (value?.trim().toLowerCase()) {
    case "sine":
      return "sine";
    case "triangle":
      return "triangle";
    case "square":
      return "square";
    case "sawtooth":
      return "sawtooth";
    default:
      return defaultValue;
  }
}

// Konvertiert optionale Web-Schriftfamilie für TextNote
export function parseTextNoteFontFamily(
  value: string | undefined,
): TextNoteFontFamily | undefined {
  switch (value?.trim().toLowerCase()) {
    case "mono":
      return "mono";
    case "sans":
      return "sans";
    default:
      return undefined;
  }
}

// Konvertiert optionale Web-Zeilenhöhe für TextNote
export function parseTextNoteLineHeight(
  value: string | undefined,
): TextNoteLineHeight | undefined {
  const num = parseXmlInt(value, 0);
  if (num === 9 || num === 12 || num === 18 || num === 36) {
    return num;
  }
  return undefined;
}
