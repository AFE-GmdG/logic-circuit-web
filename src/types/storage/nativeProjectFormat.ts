import type CircuitShape from "../circuit/circuitShape";
import type DisplayColor from "../circuit/displayColor";
import type DisplayMargin from "../circuit/displayMargin";
import type GateType from "../circuit/gateType";
import type LedMatrixCellShape from "../circuit/ledMatrixCellShape";
import type LedMatrixType from "../circuit/ledMatrixType";
import type MemoryOnStart from "../circuit/memoryOnStart";
import type PinSide from "../circuit/pinSide";
import type ProbeFormat from "../circuit/probeFormat";
import type Rotation from "../circuit/rotation";
import type SensorType from "../circuit/sensorType";
import type SoundWaveform from "../circuit/soundWaveform";
import type SynthesizerMode from "../circuit/synthesizerMode";
import type TextNoteFontFamily from "../circuit/textNoteFontFamily";
import type TextNoteLineHeight from "../circuit/textNoteLineHeight";

export const NATIVE_PROJECT_FORMAT = "logic-circuit-web-project" as const;
export const NATIVE_SNIPPET_FORMAT = "logic-circuit-web-snippet" as const;
// Unabhängige, monoton steigende Schema-Version (entkoppelt von package.json / appVersion; nur bei Formatänderungen erhöhen)
export const NATIVE_PROJECT_MIN_SCHEMA_VERSION = 1 as const;
export const NATIVE_PROJECT_SCHEMA_VERSION = 1 as const;
export const NATIVE_PROJECT_FILE_EXTENSION = ".lcweb" as const;

// Globale Projekt-Metadaten im nativen Web-Projektformat (ohne Weglassen von Defaults)
export type NativeProjectMeta = {
  projectId: string;
  name: string;
  note: string;
  zoom: number;
  frequency: number;
  isMaximumSpeed: boolean;
  logicalCircuitId: string;
  startupCircuitId: string | null;
  categoryTextNoteCollapsed: boolean;
  categoryInputOutputCollapsed: boolean;
  categoryPrimitivesCollapsed: boolean;
};

// Gemeinsame Platzierungseigenschaften eines Elements auf einem Schaltplan
export type NativeElementPlacement = {
  symbolId: string;
  x: number;
  y: number;
  rotation: Rotation;
};

// Ein- oder Ausgangs-Pin eines LogicalCircuit mit expliziter PinSide und Sub-Symbol-Optionen
export type NativePinElement = NativeElementPlacement & {
  pinId: string;
  name: string;
  jamNotation: string;
  note: string;
  pinType: "input" | "output";
  pinSide: PinSide;
  bitWidth: number;
  inverted: boolean;
  index: number;
  width: number;
  height: number;
};

// Logikgatter-, Taktgeber-, LED- oder Tri-State-Platzierung ohne Desktop-Hex-GUID
export type NativeGateElement = NativeElementPlacement & {
  kind: "gate";
  gateType: GateType;
  inputCount: number;
  invertedOutput: boolean;
  color: DisplayColor | null;
  note: string;
};

// Wiederverwendete Subschaltungs-Instanz über echte logicalCircuitId-Referenz
export type NativeSubCircuitElement = NativeElementPlacement & {
  kind: "subCircuit";
  logicalCircuitId: string;
};

// Interaktiver Taster oder Schalter (1:1 Bauteil-Konfiguration direkt am Element)
export type NativeCircuitButtonElement = NativeElementPlacement & {
  kind: "circuitButton";
  componentId: string;
  name: string;
  notation: string;
  note: string;
  isToggle: boolean;
  pinSide: PinSide;
  inverted: boolean;
  width: number;
  height: number;
  modifiers: number;
  keyCode: number;
};

// Konstanten-Quelle mit expliziter Bitbreite, Wert und Anzeigeformat
export type NativeConstantElement = NativeElementPlacement & {
  kind: "constant";
  componentId: string;
  bitWidth: number;
  value: number;
  pinSide: PinSide;
  isHex: boolean;
  width: number;
  height: number;
  note: string;
};

// Signal-Messsonde (Probe) mit explizitem Format und leerem Namen für unbenannte Sonden
export type NativeCircuitProbeElement = NativeElementPlacement & {
  kind: "circuitProbe";
  componentId: string;
  name: string;
  pinSide: PinSide;
  displayFormat: ProbeFormat;
  isHex: boolean;
  width: number;
  height: number;
  note: string;
};

// Multi-Bit-Bus-Splitter / Bündler
export type NativeSplitterElement = NativeElementPlacement & {
  kind: "splitter";
  componentId: string;
  bitWidth: number;
  pinCount: number;
  clockwise: boolean;
  note: string;
};

// Speicherbaustein (ROM oder RAM)
export type NativeMemoryElement = NativeElementPlacement & {
  kind: "memory";
  componentId: string;
  writable: boolean;
  writeOn1: boolean;
  onStart: MemoryOnStart;
  addressBitWidth: number;
  dataBitWidth: number;
  dualPort: boolean;
  data: string;
  note: string;
};

// Konfigurierbare LED-Matrix
export type NativeLedMatrixElement = NativeElementPlacement & {
  kind: "ledMatrix";
  componentId: string;
  name: string;
  matrixType: LedMatrixType;
  cellShape: LedMatrixCellShape;
  rows: number;
  columns: number;
  colors: number;
  persistenceMultiplier: 1 | 2 | 3;
  note: string;
};

// Sensor-Eingangsbaustein
export type NativeSensorElement = NativeElementPlacement & {
  kind: "sensor";
  componentId: string;
  sensorType: SensorType;
  bitWidth: number;
  pinSide: PinSide;
  notation: string;
  data: string;
  note: string;
};

// Akustischer Ausgabebaustein (Summer)
export type NativeSoundElement = NativeElementPlacement & {
  kind: "sound";
  componentId: string;
  pinSide: PinSide;
  notation: string;
  note: string;
  frequency: number;
  waveform: SoundWaveform;
};

export type NativeSynthesizerElement = NativeElementPlacement & {
  kind: "synthesizer";
  componentId: string;
  notation: string;
  note: string;
  mode: SynthesizerMode;
};

// Speicherabgebildetes Grafik-Display (GraphicsArray)
export type NativeGraphicsArrayElement = NativeElementPlacement & {
  kind: "graphicsArray";
  componentId: string;
  writeOn1: boolean;
  onStart: MemoryOnStart;
  dataBitWidth: number;
  bitsPerPixel: number;
  width: number;
  height: number;
  zoom: number;
  note: string;
};

// Discriminated Union aller platzierbaren Schaltungselemente (außer Pins)
export type NativeCircuitElement =
  | NativeGateElement
  | NativeSubCircuitElement
  | NativeCircuitButtonElement
  | NativeConstantElement
  | NativeCircuitProbeElement
  | NativeSplitterElement
  | NativeMemoryElement
  | NativeLedMatrixElement
  | NativeSensorElement
  | NativeSoundElement
  | NativeSynthesizerElement
  | NativeGraphicsArrayElement;

// Leitungssegment innerhalb eines Schaltplans
export type NativeWire = {
  wireId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

// Textnotiz innerhalb eines Schaltplans mit expliziten Web-Formatierungsfeldern
export type NativeTextNote = {
  textNoteId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  note: string;
  rotation: Rotation;
  lineHeight: TextNoteLineHeight;
  fontFamily: TextNoteFontFamily;
  lineHeights: TextNoteLineHeight[] | null;
};

// Hierarchisch gekapselter Schaltplan (inkl. eigener Pins, Elemente, Leitungen und Notizen)
export type NativeLogicalCircuit = {
  logicalCircuitId: string;
  name: string;
  notation: string;
  note: string;
  category: string;
  circuitShape: CircuitShape;
  showLabelAbove: boolean;
  displayMargin: DisplayMargin;
  validators: string;
  exportToHDL: boolean;
  pins: NativePinElement[];
  elements: NativeCircuitElement[];
  wires: NativeWire[];
  textNotes: NativeTextNote[];
};

// Versioniertes Zwischenablage-Snippet mit Teil-Auswahl und transitiv referenzierten Subschaltungen
export type NativeSnippetDocument = {
  format: typeof NATIVE_SNIPPET_FORMAT;
  schemaVersion: typeof NATIVE_PROJECT_SCHEMA_VERSION;
  appVersion: string;
  rootCircuitId: string;
  logicalCircuits: NativeLogicalCircuit[];
};

// Versioniertes Wurzel-Dokument des nativen Logic Circuit Web-Projektformats (*.lcweb)
type NativeProjectDocument = {
  format: typeof NATIVE_PROJECT_FORMAT;
  schemaVersion: typeof NATIVE_PROJECT_SCHEMA_VERSION;
  appVersion: string;
  project: NativeProjectMeta;
  collapsedCategories: string[];
  logicalCircuits: NativeLogicalCircuit[];
};

export default NativeProjectDocument;
