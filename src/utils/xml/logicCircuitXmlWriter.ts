import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitShape from "../../types/circuit/circuitShape";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type CollapsedCategory from "../../types/circuit/collapsedCategory";
import type Constant from "../../types/circuit/constant";
import type Gate from "../../types/circuit/gate";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LedMatrixCellShape from "../../types/circuit/ledMatrixCellShape";
import type LedMatrixType from "../../types/circuit/ledMatrixType";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type MemoryOnStart from "../../types/circuit/memoryOnStart";
import type Pin from "../../types/circuit/pin";
import type PinSide from "../../types/circuit/pinSide";
import type PinType from "../../types/circuit/pinType";
import type Project from "../../types/circuit/project";
import type Rotation from "../../types/circuit/rotation";
import type Sensor from "../../types/circuit/sensor";
import type SensorType from "../../types/circuit/sensorType";
import type Sound from "../../types/circuit/sound";
import type Splitter from "../../types/circuit/splitter";
import type TextNote from "../../types/circuit/textNote";
import type Wire from "../../types/circuit/wire";

import { getGateGuid } from "../circuitLayout";
import { clampXmlFrequency } from "../simulationSpeed";
import {
  EMPTY_GUID,
  LOGIC_CIRCUIT_ATTRIBUTE_LENGTH_LIMIT,
  LOGIC_CIRCUIT_CURRENT_NAMESPACE,
  LOGICAL_CIRCUIT_DEFAULTS,
  PROJECT_DEFAULTS,
  XML_ROOT_NAME,
  XML_TABLES,
} from "./logicCircuitXmlConstants";

type XmlFieldEntry = [name: string, value: string];

// Maskiert Sonderzeichen in XML-Elementtexten
function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Maskiert Sonderzeichen sowie Zeilenumbrüche in XML-Attributwerten verlustfrei
function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#xD;")
    .replace(/\n/g, "&#xA;")
    .replace(/\t/g, "&#x9;");
}

function formatXmlBoolean(value: boolean): string {
  return value ? "True" : "False";
}

function formatRotation(rotation: Rotation): string {
  switch (rotation) {
    case "up":
      return "Up";
    case "right":
      return "Right";
    case "down":
      return "Down";
    case "left":
      return "Left";
  }
}

function formatPinSide(pinSide: PinSide): string {
  switch (pinSide) {
    case "left":
      return "Left";
    case "top":
      return "Top";
    case "right":
      return "Right";
    case "bottom":
      return "Bottom";
  }
}

function formatPinType(pinType: PinType): string {
  switch (pinType) {
    case "none":
      return "None";
    case "input":
      return "Input";
    case "output":
      return "Output";
  }
}

function formatCircuitShape(shape: CircuitShape): string {
  switch (shape) {
    case "rectangular":
      return "Rectangular";
    case "display":
      return "Display";
    case "mux":
      return "Mux";
    case "demux":
      return "Demux";
    case "alu":
      return "Alu";
    case "flipFlop":
      return "FlipFlop";
  }
}

function formatMemoryOnStart(onStart: MemoryOnStart): string {
  switch (onStart) {
    case "random":
      return "Random";
    case "zeros":
      return "Zeros";
    case "ones":
      return "Ones";
    case "data":
      return "Data";
  }
}

function formatLedMatrixType(matrixType: LedMatrixType): string {
  switch (matrixType) {
    case "individual":
      return "Individual";
    case "selector":
      return "Selector";
  }
}

function formatLedMatrixCellShape(cellShape: LedMatrixCellShape): string {
  switch (cellShape) {
    case "round":
      return "Round";
    case "rect":
      return "Rectangle";
  }
}

function formatSensorType(sensorType: SensorType): string {
  switch (sensorType) {
    case "random":
      return "Random";
    case "manual":
      return "Manual";
    case "series":
      return "Series";
    case "loop":
      return "Loop";
    case "ascii":
      return "ASCII";
    case "keyCode":
      return "KeyCode";
    case "sequence":
      return "Sequence";
    case "clock":
      return "Clock";
  }
}

// Konvertiert Klartext-Notizen in ein WPF-kompatibles FlowDocument-XML für die Desktop-App
function formatFlowDocumentNote(note: string): string {
  if (note.trimStart().startsWith("<FlowDocument")) {
    return note;
  }
  const paragraphs = note
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `<Paragraph><Run>${escapeXmlText(line)}</Run></Paragraph>`)
    .join("");
  return `<FlowDocument xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">${paragraphs}</FlowDocument>`;
}

// Serialisiert einen Datensatz analog zu CircuitProject.SaveRecords (Attribute < 4096 Zeichen, sonst Kind-Elemente)
function serializeXmlRecord(tableName: string, fields: XmlFieldEntry[]): string {
  const attrs: string[] = [];
  const childElements: string[] = [];

  for (const [name, value] of fields) {
    if (value.length < LOGIC_CIRCUIT_ATTRIBUTE_LENGTH_LIMIT) {
      attrs.push(`${name}="${escapeXmlAttribute(value)}"`);
    } else {
      childElements.push(`\t\t<${name}>${escapeXmlText(value)}</${name}>`);
    }
  }

  const attrPart = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  if (childElements.length === 0) {
    return `\t<${tableName}${attrPart} />`;
  }
  return `\t<${tableName}${attrPart}>\n${childElements.join("\n")}\n\t</${tableName}>`;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function serializeProjectRecord(project: Project): string {
  const fields: XmlFieldEntry[] = [["ProjectId", project.projectId]];
  if (project.name !== PROJECT_DEFAULTS.name) {
    fields.push(["Name", project.name]);
  }
  if (project.note !== "") {
    fields.push(["Note", project.note]);
  }
  const clampedZoom = Number.isFinite(project.zoom) ? Math.max(0.1, Math.min(3, project.zoom)) : PROJECT_DEFAULTS.zoom;
  if (clampedZoom !== PROJECT_DEFAULTS.zoom) {
    fields.push(["Zoom", String(clampedZoom)]);
  }
  const clampedFreq = clampXmlFrequency(project.frequency);
  if (clampedFreq !== PROJECT_DEFAULTS.frequency) {
    fields.push(["Frequency", String(clampedFreq)]);
  }
  if (project.isMaximumSpeed) {
    fields.push(["IsMaximumSpeed", formatXmlBoolean(true)]);
  }
  fields.push(["LogicalCircuitId", project.logicalCircuitId]);
  if (project.startupCircuitId && project.startupCircuitId !== EMPTY_GUID) {
    fields.push(["StartupCircuitId", project.startupCircuitId]);
  }
  if (project.categoryTextNoteCollapsed) {
    fields.push(["CategoryTextNoteCollapsed", formatXmlBoolean(true)]);
  }
  if (project.categoryInputOutputCollapsed) {
    fields.push(["CategoryInputOutputCollapsed", formatXmlBoolean(true)]);
  }
  if (project.categoryPrimitivesCollapsed) {
    fields.push(["CategoryPrimitivesCollapsed", formatXmlBoolean(true)]);
  }
  return serializeXmlRecord(XML_TABLES.project, fields);
}

function serializeCollapsedCategoryRecord(category: CollapsedCategory): string {
  return serializeXmlRecord(XML_TABLES.collapsedCategory, [["Name", category.name]]);
}

function serializeLogicalCircuitRecord(lc: LogicalCircuit): string {
  const fields: XmlFieldEntry[] = [["LogicalCircuitId", lc.logicalCircuitId]];
  if (lc.name !== LOGICAL_CIRCUIT_DEFAULTS.name) {
    fields.push(["Name", lc.name]);
  }
  const resolvedNotation = lc.notation !== "" ? lc.notation : (lc.name || LOGICAL_CIRCUIT_DEFAULTS.name);
  if (resolvedNotation !== "") {
    fields.push(["Notation", resolvedNotation]);
  }
  if (lc.note !== "") {
    fields.push(["Note", lc.note]);
  }
  if (lc.category !== "") {
    fields.push(["Category", lc.category]);
  }
  if (lc.circuitShape !== "rectangular") {
    fields.push(["CircuitShape", formatCircuitShape(lc.circuitShape)]);
  }
  if (lc.validators !== "") {
    fields.push(["Validators", lc.validators]);
  }
  return serializeXmlRecord(XML_TABLES.logicalCircuit, fields);
}

function serializePinRecord(pin: Pin): string {
  const fields: XmlFieldEntry[] = [
    ["PinId", pin.pinId],
    ["CircuitId", pin.circuitId],
  ];
  const bitWidth = clampInt(pin.bitWidth, 1, 32);
  if (bitWidth !== 1) {
    fields.push(["BitWidth", String(bitWidth)]);
  }
  if (pin.pinType !== "input") {
    fields.push(["PinType", formatPinType(pin.pinType)]);
  }
  // Für Output-Pins PinSide stets explizit schreiben, damit Left/Right im Reader eindeutig bleibt
  if (pin.pinSide !== "left" || pin.pinType === "output") {
    fields.push(["PinSide", formatPinSide(pin.pinSide)]);
  }
  if (pin.inverted) {
    fields.push(["Inverted", formatXmlBoolean(true)]);
  }
  fields.push(["Name", pin.name]);
  if (pin.note !== "") {
    fields.push(["Note", pin.note]);
  }
  if (pin.jamNotation !== "") {
    fields.push(["JamNotation", pin.jamNotation]);
  }
  if (pin.index !== 0) {
    fields.push(["Index", String(pin.index)]);
  }
  return serializeXmlRecord(XML_TABLES.pin, fields);
}

function serializeCircuitProbeRecord(probe: CircuitProbe): string {
  const fields: XmlFieldEntry[] = [["CircuitProbeId", probe.circuitProbeId]];
  const resolvedName = probe.name.trim() !== "" ? probe.name : probe.circuitProbeId;
  fields.push(["Name", resolvedName]);
  if (probe.pinSide !== "left") {
    fields.push(["PinSide", formatPinSide(probe.pinSide)]);
  }
  if (probe.note !== "") {
    fields.push(["Note", probe.note]);
  }
  return serializeXmlRecord(XML_TABLES.circuitProbe, fields);
}

function serializeConstantRecord(constant: Constant): string {
  const fields: XmlFieldEntry[] = [["ConstantId", constant.constantId]];
  const bitWidth = clampInt(constant.bitWidth, 1, 32);
  if (bitWidth !== 1) {
    fields.push(["BitWidth", String(bitWidth)]);
  }
  if (constant.value !== 0) {
    fields.push(["Value", String(constant.value)]);
  }
  if (constant.pinSide !== "right") {
    fields.push(["PinSide", formatPinSide(constant.pinSide)]);
  }
  if (constant.note !== "") {
    fields.push(["Note", constant.note]);
  }
  return serializeXmlRecord(XML_TABLES.constant, fields);
}

function serializeCircuitButtonRecord(button: CircuitButton): string {
  const fields: XmlFieldEntry[] = [["CircuitButtonId", button.circuitButtonId]];
  if (button.notation !== "") {
    fields.push(["Notation", button.notation]);
  }
  if (button.modifiers !== 0) {
    fields.push(["Modifiers", String(button.modifiers)]);
  }
  if (button.keyCode !== 0) {
    fields.push(["KeyCode", String(button.keyCode)]);
  }
  if (button.isToggle) {
    fields.push(["IsToggle", formatXmlBoolean(true)]);
  }
  if (button.pinSide !== "right") {
    fields.push(["PinSide", formatPinSide(button.pinSide)]);
  }
  if (button.inverted) {
    fields.push(["Inverted", formatXmlBoolean(true)]);
  }
  const width = clampInt(button.width, 2, 20);
  const height = clampInt(button.height, 2, 20);
  if (width !== 2) {
    fields.push(["Width", String(width)]);
  }
  if (height !== 2) {
    fields.push(["Height", String(height)]);
  }
  if (button.note !== "") {
    fields.push(["Note", button.note]);
  }
  return serializeXmlRecord(XML_TABLES.circuitButton, fields);
}

function serializeMemoryRecord(memory: Memory): string {
  const fields: XmlFieldEntry[] = [
    ["MemoryId", memory.memoryId],
    ["Writable", formatXmlBoolean(memory.writable)],
  ];
  if (memory.writeOn1) {
    fields.push(["WriteOn1", formatXmlBoolean(true)]);
  }
  if (memory.onStart !== "random") {
    fields.push(["OnStart", formatMemoryOnStart(memory.onStart)]);
  }
  fields.push(["AddressBitWidth", String(clampInt(memory.addressBitWidth, 1, 16))]);
  fields.push(["DataBitWidth", String(clampInt(memory.dataBitWidth, 1, 32))]);
  if (memory.dualPort) {
    fields.push(["DualPort", formatXmlBoolean(true)]);
  }
  if (memory.data !== "") {
    fields.push(["Data", memory.data]);
  }
  if (memory.note !== "") {
    fields.push(["Note", memory.note]);
  }
  return serializeXmlRecord(XML_TABLES.memory, fields);
}

function serializeLedMatrixRecord(matrix: LedMatrix): string {
  const fields: XmlFieldEntry[] = [["LedMatrixId", matrix.ledMatrixId]];
  if (matrix.matrixType !== "individual") {
    fields.push(["MatrixType", formatLedMatrixType(matrix.matrixType)]);
  }
  if (matrix.cellShape !== "round") {
    fields.push(["CellShape", formatLedMatrixCellShape(matrix.cellShape)]);
  }
  fields.push(["Rows", String(clampInt(matrix.rows, 1, 10))]);
  fields.push(["Columns", String(clampInt(matrix.columns, 1, 10))]);
  const colors = clampInt(matrix.colors, 1, 3);
  if (colors !== 1) {
    fields.push(["Colors", String(colors)]);
  }
  if (matrix.note !== "") {
    fields.push(["Note", matrix.note]);
  }
  return serializeXmlRecord(XML_TABLES.ledMatrix, fields);
}

function serializeSplitterRecord(splitter: Splitter): string {
  const bitWidth = clampInt(splitter.bitWidth, 1, 32);
  const pinCount = clampInt(splitter.pinCount, 1, bitWidth);
  return serializeXmlRecord(XML_TABLES.splitter, [
    ["SplitterId", splitter.splitterId],
    ["BitWidth", String(bitWidth)],
    ["PinCount", String(pinCount)],
    ["Clockwise", formatXmlBoolean(splitter.clockwise)],
  ]);
}

function serializeSensorRecord(sensor: Sensor): string {
  const fields: XmlFieldEntry[] = [["SensorId", sensor.sensorId]];
  if (sensor.sensorType !== "random") {
    fields.push(["SensorType", formatSensorType(sensor.sensorType)]);
  }
  const bitWidth = clampInt(sensor.bitWidth, 1, 32);
  if (bitWidth !== 1) {
    fields.push(["BitWidth", String(bitWidth)]);
  }
  if (sensor.pinSide !== "right") {
    fields.push(["PinSide", formatPinSide(sensor.pinSide)]);
  }
  if (sensor.notation !== "") {
    fields.push(["Notation", sensor.notation]);
  }
  if (sensor.data !== "") {
    fields.push(["Data", sensor.data]);
  }
  if (sensor.note !== "") {
    fields.push(["Note", sensor.note]);
  }
  return serializeXmlRecord(XML_TABLES.sensor, fields);
}

function serializeSoundRecord(sound: Sound): string {
  const fields: XmlFieldEntry[] = [["SoundId", sound.soundId]];
  if (sound.pinSide !== "left") {
    fields.push(["PinSide", formatPinSide(sound.pinSide)]);
  }
  if (sound.notation !== "") {
    fields.push(["Notation", sound.notation]);
  }
  if (sound.note !== "") {
    fields.push(["Note", sound.note]);
  }
  return serializeXmlRecord(XML_TABLES.sound, fields);
}

function serializeGraphicsArrayRecord(ga: GraphicsArray): string {
  const fields: XmlFieldEntry[] = [["GraphicsArrayId", ga.graphicsArrayId]];
  if (ga.writeOn1) {
    fields.push(["WriteOn1", formatXmlBoolean(true)]);
  }
  if (ga.onStart !== "zeros") {
    fields.push(["OnStart", formatMemoryOnStart(ga.onStart)]);
  }
  if (ga.dataBitWidth !== 8) {
    fields.push(["DataBitWidth", String(ga.dataBitWidth)]);
  }
  if (ga.bitsPerPixel !== 1) {
    fields.push(["BitsPerPixel", String(ga.bitsPerPixel)]);
  }
  const width = clampInt(ga.width, 1, 640);
  const height = clampInt(ga.height, 1, 480);
  const zoom = clampInt(ga.zoom, 1, 4);
  if (width !== 160) {
    fields.push(["Width", String(width)]);
  }
  if (height !== 120) {
    fields.push(["Height", String(height)]);
  }
  if (zoom !== 1) {
    fields.push(["Zoom", String(zoom)]);
  }
  if (ga.note !== "") {
    fields.push(["Note", ga.note]);
  }
  return serializeXmlRecord(XML_TABLES.graphicsArray, fields);
}

function serializeCircuitSymbolRecord(symbol: CircuitSymbol): string {
  const serializedCircuitId = symbol.circuit.kind === "gate"
    ? getGateGuid(
      (symbol.circuit as Gate).gateType,
      (symbol.circuit as Gate).inputCount,
      (symbol.circuit as Gate).invertedOutput,
    )
    : symbol.circuitId;

  const fields: XmlFieldEntry[] = [
    ["CircuitSymbolId", symbol.circuitSymbolId],
    ["CircuitId", serializedCircuitId],
    ["LogicalCircuitId", symbol.logicalCircuitId],
    ["X", String(Math.round(symbol.x))],
    ["Y", String(Math.round(symbol.y))],
  ];
  if (symbol.rotation !== "up") {
    fields.push(["Rotation", formatRotation(symbol.rotation)]);
  }
  return serializeXmlRecord(XML_TABLES.circuitSymbol, fields);
}

function serializeWireRecord(wire: Wire): string | null {
  const x1 = Math.round(wire.x1);
  const y1 = Math.round(wire.y1);
  const x2 = Math.round(wire.x2);
  const y2 = Math.round(wire.y2);
  if (x1 === x2 && y1 === y2) {
    return null;
  }
  return serializeXmlRecord(XML_TABLES.wire, [
    ["WireId", wire.wireId],
    ["LogicalCircuitId", wire.logicalCircuitId],
    ["X1", String(x1)],
    ["Y1", String(y1)],
    ["X2", String(x2)],
    ["Y2", String(y2)],
  ]);
}

function serializeTextNoteRecord(note: TextNote): string | null {
  if (note.note.trim().length === 0) {
    return null;
  }
  const fields: XmlFieldEntry[] = [
    ["TextNoteId", note.textNoteId],
    ["LogicalCircuitId", note.logicalCircuitId],
    ["X", String(Math.round(note.x))],
    ["Y", String(Math.round(note.y))],
  ];
  const width = Math.max(1, Math.round(note.width));
  const height = Math.max(1, Math.round(note.height));
  if (width !== 10) {
    fields.push(["Width", String(width)]);
  }
  if (height !== 10) {
    fields.push(["Height", String(height)]);
  }
  fields.push(["Note", formatFlowDocumentNote(note.note)]);
  if (note.rotation !== "up") {
    fields.push(["Rotation", formatRotation(note.rotation)]);
  }
  return serializeXmlRecord(XML_TABLES.textNote, fields);
}

// Fügt eindeutige Einträge nach ID zusammen (Schaltplan-Listen haben Vorrang vor ggf. veralteten Projekt-Arrays)
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

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function createDeterministicGuid(rawId: string): string {
  const p1 = fnv1a32(rawId, 0x811c9dc5);
  const p2 = fnv1a32(`${rawId}:a`, 0x9e3779b9);
  const p3 = fnv1a32(`${rawId}:b`, 0x85ebca6b);
  const p4 = fnv1a32(`${rawId}:c`, 0xc2b2ae35);

  const b1 = p1.toString(16).padStart(8, "0");
  const b2 = ((p2 >>> 16) & 0xffff).toString(16).padStart(4, "0");
  const b3 = (((p2 & 0x0fff) | 0x4000) & 0xffff).toString(16).padStart(4, "0");
  const b4 = ((((p3 >>> 16) & 0x3fff) | 0x8000) & 0xffff).toString(16).padStart(4, "0");
  const b5a = (p3 & 0xffff).toString(16).padStart(4, "0");
  const b5b = p4.toString(16).padStart(8, "0");

  return `${b1}-${b2}-${b3}-${b4}-${b5a}${b5b}`;
}

const DESKTOP_SUPPORTED_KINDS: ReadonlySet<string> = new Set([
  "logicalCircuit",
  "gate",
  "pin",
  "circuitProbe",
  "constant",
  "circuitButton",
  "memory",
  "ledMatrix",
  "splitter",
  "sensor",
  "sound",
  "graphicsArray",
]);

const DESKTOP_SUPPORTED_GATE_TYPES: ReadonlySet<string> = new Set([
  "nop",
  "clock",
  "not",
  "or",
  "and",
  "xor",
  "led",
  "triState1",
  "triState2",
]);

function isDesktopSupportedSymbol(
  sym: CircuitSymbol,
  knownLogicalCircuitIds: ReadonlySet<string>,
): boolean {
  const kind = sym.circuit.kind;
  if (!kind || !DESKTOP_SUPPORTED_KINDS.has(kind)) {
    return false;
  }
  if (kind === "logicalCircuit") {
    const targetSubId = (sym.circuit as LogicalCircuit).logicalCircuitId ?? sym.circuitId;
    return knownLogicalCircuitIds.has(targetSubId);
  }
  if (kind === "gate") {
    const gate = sym.circuit as Gate;
    if (!DESKTOP_SUPPORTED_GATE_TYPES.has(gate.gateType)) {
      return false;
    }
    if (gate.gateType === "led") {
      return gate.inputCount === 1 || gate.inputCount === 8;
    }
    if (gate.gateType === "and" || gate.gateType === "or" || gate.gateType === "xor") {
      return gate.inputCount >= 2 && gate.inputCount <= 18;
    }
  }
  return true;
}

function makeUniqueName(rawName: string, fallbackBase: string, usedLowercase: Set<string>): string {
  const base = rawName.trim() || fallbackBase;
  if (!usedLowercase.has(base.toLowerCase())) {
    usedLowercase.add(base.toLowerCase());
    return base;
  }
  let suffix = 2;
  let candidate = `${base} (${suffix})`;
  while (usedLowercase.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${base} (${suffix})`;
  }
  usedLowercase.add(candidate.toLowerCase());
  return candidate;
}

function buildLookupMap<T>(items: T[], getId: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const id = getId(item);
    if (!map.has(id)) {
      map.set(id, item);
    }
  }
  return map;
}

function computeCircuitCoordShift(
  symbols: CircuitSymbol[],
  wires: Wire[],
  textNotes: TextNote[],
): { dx: number; dy: number } {
  let minX = 0;
  let minY = 0;

  for (const sym of symbols) {
    minX = Math.min(minX, Math.round(sym.x));
    minY = Math.min(minY, Math.round(sym.y));
  }
  for (const wire of wires) {
    const x1 = Math.round(wire.x1);
    const y1 = Math.round(wire.y1);
    const x2 = Math.round(wire.x2);
    const y2 = Math.round(wire.y2);
    if (x1 === x2 && y1 === y2) {
      continue;
    }
    minX = Math.min(minX, x1, x2);
    minY = Math.min(minY, y1, y2);
  }
  for (const note of textNotes) {
    if (note.note.trim().length === 0) {
      continue;
    }
    minX = Math.min(minX, Math.round(note.x));
    minY = Math.min(minY, Math.round(note.y));
  }

  return {
    dx: minX < 0 ? -minX : 0,
    dy: minY < 0 ? -minY : 0,
  };
}

function buildFallbackPinFromSymbol(sym: CircuitSymbol): Pin {
  const internalPin = sym.circuit.pins[0];
  const rawType = internalPin?.pinType;
  const resolvedType: PinType = rawType === "input" ? "output" : "input";
  return {
    kind: "pin",
    pinId: sym.circuitId,
    circuitId: sym.logicalCircuitId,
    bitWidth: internalPin?.bitWidth ?? 1,
    pinType: resolvedType,
    pinSide: internalPin?.pinSide ?? (resolvedType === "input" ? "left" : "right"),
    inverted: internalPin?.inverted ?? false,
    name: sym.circuit.name || (resolvedType === "output" ? "Out" : "In"),
    note: sym.circuit.note ?? "",
    jamNotation: internalPin?.jamNotation ?? "",
    index: 0,
    gridPoint: internalPin?.gridPoint ?? { x: 0, y: 0 },
  };
}

// Normalisiert Projekt-IDs, eindeutige Namen, Referenzen, Koordinaten und Komponenten auf LogicCircuit Desktop 2.0.0.14
export function normalizeProjectForDesktopXml(source: CircuitProject): CircuitProject {
  const mappedIds = new Map<string, string>();
  const toXmlGuid = (rawId: string): string => {
    if (GUID_PATTERN.test(rawId)) {
      return rawId;
    }
    const existing = mappedIds.get(rawId);
    if (existing) {
      return existing;
    }
    const generated = createDeterministicGuid(rawId);
    mappedIds.set(rawId, generated);
    return generated;
  };

  const rawLogicalCircuitIds = new Set(source.logicalCircuits.map((lc) => lc.logicalCircuitId));
  const rawPinMap = buildLookupMap(
    mergeUniqueById(
      source.logicalCircuits.flatMap((lc) => lc.logicalPins),
      source.pins,
      (p) => p.pinId,
    ),
    (p) => p.pinId,
  );
  const rawProbeMap = buildLookupMap(source.circuitProbes, (p) => p.circuitProbeId);
  const rawConstantMap = buildLookupMap(source.constants, (c) => c.constantId);
  const rawButtonMap = buildLookupMap(source.circuitButtons, (b) => b.circuitButtonId);
  const rawMemoryMap = buildLookupMap(source.memories, (m) => m.memoryId);
  const rawMatrixMap = buildLookupMap(source.ledMatrices, (m) => m.ledMatrixId);
  const rawSplitterMap = buildLookupMap(source.splitters, (s) => s.splitterId);
  const rawSensorMap = buildLookupMap(source.sensors, (s) => s.sensorId);
  const rawSoundMap = buildLookupMap(source.sounds, (s) => s.soundId);
  const rawGraphicsMap = buildLookupMap(source.graphicsArrays, (g) => g.graphicsArrayId);

  const mergedRawSymbols = mergeUniqueById(
    source.logicalCircuits.flatMap((lc) => lc.circuitSymbols),
    source.circuitSymbols,
    (s) => s.circuitSymbolId,
  );
  const mergedRawWires = mergeUniqueById(
    source.logicalCircuits.flatMap((lc) => lc.wires),
    source.wires,
    (w) => w.wireId,
  );
  const mergedRawNotes = mergeUniqueById(
    source.logicalCircuits.flatMap((lc) => lc.textNotes),
    source.textNotes,
    (n) => n.textNoteId,
  );

  // Desktop fordert exakt 1 CircuitSymbol pro 1:1-Bauteil (keine verwaisten Records oder Duplikate)
  const seenSingletonIds = new Set<string>();
  const keptRawSymbols: CircuitSymbol[] = [];
  for (const sym of mergedRawSymbols) {
    if (!rawLcSetHas(rawLogicalCircuitIds, sym.logicalCircuitId)) {
      continue;
    }
    if (!isDesktopSupportedSymbol(sym, rawLogicalCircuitIds)) {
      continue;
    }
    const kind = sym.circuit.kind ?? "";
    if (kind !== "gate" && kind !== "logicalCircuit") {
      if (seenSingletonIds.has(sym.circuitId)) {
        continue;
      }
      seenSingletonIds.add(sym.circuitId);
    }
    keptRawSymbols.push(sym);
  }

  const usedCircuitNames = new Set<string>();
  const usedPinNamesByCircuit = new Map<string, Set<string>>();
  const usedProbeNames = new Set<string>();

  const normalizedPins: Pin[] = [];
  const normalizedProbes: CircuitProbe[] = [];
  const normalizedConstants: Constant[] = [];
  const normalizedButtons: CircuitButton[] = [];
  const normalizedMemories: Memory[] = [];
  const normalizedMatrices: LedMatrix[] = [];
  const normalizedSplitters: Splitter[] = [];
  const normalizedSensors: Sensor[] = [];
  const normalizedSounds: Sound[] = [];
  const normalizedGraphicsArrays: GraphicsArray[] = [];

  for (const sym of keptRawSymbols) {
    const kind = sym.circuit.kind;
    if (kind === "gate" || kind === "logicalCircuit") {
      continue;
    }

    const normCompId = toXmlGuid(sym.circuitId);
    const normLcId = toXmlGuid(sym.logicalCircuitId);

    switch (kind) {
      case "pin": {
        const rawPin = rawPinMap.get(sym.circuitId) ?? buildFallbackPinFromSymbol(sym);
        const nameSet = usedPinNamesByCircuit.get(normLcId) ?? new Set<string>();
        usedPinNamesByCircuit.set(normLcId, nameSet);
        const fallbackPinName = rawPin.pinType === "output" ? "Out" : "In";
        const uniqueName = makeUniqueName(rawPin.name, fallbackPinName, nameSet);
        normalizedPins.push({
          ...rawPin,
          pinId: normCompId,
          circuitId: normLcId,
          name: uniqueName,
        });
        break;
      }
      case "circuitProbe": {
        const rawProbe = rawProbeMap.get(sym.circuitId) ?? (sym.circuit as CircuitProbe);
        const rawTrimmed = rawProbe.name.trim();
        const isUnnamed =
          rawTrimmed === "" ||
          rawTrimmed.toLowerCase() === rawProbe.circuitProbeId.toLowerCase() ||
          rawTrimmed.toLowerCase() === sym.circuitId.toLowerCase() ||
          rawTrimmed.toLowerCase() === normCompId.toLowerCase();
        const resolvedName = isUnnamed
          ? makeUniqueName(normCompId, normCompId, usedProbeNames)
          : makeUniqueName(rawTrimmed, normCompId, usedProbeNames);
        normalizedProbes.push({
          ...rawProbe,
          circuitId: normCompId,
          circuitProbeId: normCompId,
          name: resolvedName,
        });
        break;
      }
      case "constant": {
        const rawConst = rawConstantMap.get(sym.circuitId) ?? (sym.circuit as Constant);
        normalizedConstants.push({
          ...rawConst,
          circuitId: normCompId,
          constantId: normCompId,
        });
        break;
      }
      case "circuitButton": {
        const rawBtn = rawButtonMap.get(sym.circuitId) ?? (sym.circuit as CircuitButton);
        normalizedButtons.push({
          ...rawBtn,
          circuitId: normCompId,
          circuitButtonId: normCompId,
        });
        break;
      }
      case "memory": {
        const rawMem = rawMemoryMap.get(sym.circuitId) ?? (sym.circuit as Memory);
        normalizedMemories.push({
          ...rawMem,
          circuitId: normCompId,
          memoryId: normCompId,
        });
        break;
      }
      case "ledMatrix": {
        const rawMatrix = rawMatrixMap.get(sym.circuitId) ?? (sym.circuit as LedMatrix);
        normalizedMatrices.push({
          ...rawMatrix,
          circuitId: normCompId,
          ledMatrixId: normCompId,
        });
        break;
      }
      case "splitter": {
        const rawSplitter = rawSplitterMap.get(sym.circuitId) ?? (sym.circuit as Splitter);
        normalizedSplitters.push({
          ...rawSplitter,
          circuitId: normCompId,
          splitterId: normCompId,
        });
        break;
      }
      case "sensor": {
        const rawSensor = rawSensorMap.get(sym.circuitId) ?? (sym.circuit as Sensor);
        normalizedSensors.push({
          ...rawSensor,
          circuitId: normCompId,
          sensorId: normCompId,
        });
        break;
      }
      case "sound": {
        const rawSound = rawSoundMap.get(sym.circuitId) ?? (sym.circuit as Sound);
        normalizedSounds.push({
          ...rawSound,
          circuitId: normCompId,
          soundId: normCompId,
        });
        break;
      }
      case "graphicsArray": {
        const rawGa = rawGraphicsMap.get(sym.circuitId) ?? (sym.circuit as GraphicsArray);
        normalizedGraphicsArrays.push({
          ...rawGa,
          circuitId: normCompId,
          graphicsArrayId: normCompId,
        });
        break;
      }
      default:
        break;
    }
  }

  const normalizedPinById = new Map(normalizedPins.map((p) => [p.pinId, p]));
  const symbolsByRawLcId = new Map<string, CircuitSymbol[]>();
  const wiresByRawLcId = new Map<string, Wire[]>();
  const notesByRawLcId = new Map<string, TextNote[]>();

  for (const sym of keptRawSymbols) {
    const arr = symbolsByRawLcId.get(sym.logicalCircuitId) ?? [];
    arr.push(sym);
    symbolsByRawLcId.set(sym.logicalCircuitId, arr);
  }
  for (const w of mergedRawWires) {
    if (!rawLogicalCircuitIds.has(w.logicalCircuitId)) {
      continue;
    }
    const arr = wiresByRawLcId.get(w.logicalCircuitId) ?? [];
    arr.push(w);
    wiresByRawLcId.set(w.logicalCircuitId, arr);
  }
  for (const n of mergedRawNotes) {
    if (!rawLogicalCircuitIds.has(n.logicalCircuitId)) {
      continue;
    }
    const arr = notesByRawLcId.get(n.logicalCircuitId) ?? [];
    arr.push(n);
    notesByRawLcId.set(n.logicalCircuitId, arr);
  }

  const normalizedSymbols: CircuitSymbol[] = [];
  const normalizedWires: Wire[] = [];
  const normalizedNotes: TextNote[] = [];

  const normalizedLogicalCircuits: LogicalCircuit[] = source.logicalCircuits.map((lc) => {
    const normLcId = toXmlGuid(lc.logicalCircuitId);
    const uniqueCircuitName = makeUniqueName(lc.name, LOGICAL_CIRCUIT_DEFAULTS.name, usedCircuitNames);
    const lcSymbols = symbolsByRawLcId.get(lc.logicalCircuitId) ?? [];
    const lcWires = wiresByRawLcId.get(lc.logicalCircuitId) ?? [];
    const lcNotes = notesByRawLcId.get(lc.logicalCircuitId) ?? [];
    const { dx, dy } = computeCircuitCoordShift(lcSymbols, lcWires, lcNotes);

    const mappedSymbols: CircuitSymbol[] = lcSymbols.map((sym) => {
      const normSymId = toXmlGuid(sym.circuitSymbolId);
      let normCircuitId: string;
      if (sym.circuit.kind === "gate") {
        const gate = sym.circuit as Gate;
        normCircuitId = getGateGuid(gate.gateType, gate.inputCount, gate.invertedOutput);
      } else if (sym.circuit.kind === "logicalCircuit") {
        const subId = (sym.circuit as LogicalCircuit).logicalCircuitId ?? sym.circuitId;
        normCircuitId = toXmlGuid(subId);
      } else {
        normCircuitId = toXmlGuid(sym.circuitId);
      }
      return {
        ...sym,
        circuitSymbolId: normSymId,
        circuitId: normCircuitId,
        logicalCircuitId: normLcId,
        x: Math.round(sym.x) + dx,
        y: Math.round(sym.y) + dy,
      };
    });

    const mappedWires: Wire[] = [];
    for (const w of lcWires) {
      const x1 = Math.round(w.x1) + dx;
      const y1 = Math.round(w.y1) + dy;
      const x2 = Math.round(w.x2) + dx;
      const y2 = Math.round(w.y2) + dy;
      if (x1 === x2 && y1 === y2) {
        continue;
      }
      mappedWires.push({
        ...w,
        wireId: toXmlGuid(w.wireId),
        logicalCircuitId: normLcId,
        x1,
        y1,
        x2,
        y2,
        point1: { x: x1, y: y1 },
        point2: { x: x2, y: y2 },
      });
    }

    const mappedNotes: TextNote[] = [];
    for (const n of lcNotes) {
      if (n.note.trim().length === 0) {
        continue;
      }
      mappedNotes.push({
        ...n,
        textNoteId: toXmlGuid(n.textNoteId),
        logicalCircuitId: normLcId,
        x: Math.round(n.x) + dx,
        y: Math.round(n.y) + dy,
      });
    }

    normalizedSymbols.push(...mappedSymbols);
    normalizedWires.push(...mappedWires);
    normalizedNotes.push(...mappedNotes);

    const mappedPins = mappedSymbols
      .filter((s) => s.circuit.kind === "pin")
      .map((s) => normalizedPinById.get(s.circuitId))
      .filter((p): p is Pin => p !== undefined);

    return {
      ...lc,
      circuitId: normLcId,
      logicalCircuitId: normLcId,
      name: uniqueCircuitName,
      logicalPins: mappedPins,
      circuitSymbols: mappedSymbols,
      wires: mappedWires,
      textNotes: mappedNotes,
    };
  });

  const normalizedLcIdSet = new Set(normalizedLogicalCircuits.map((lc) => lc.logicalCircuitId));
  const firstLcId = normalizedLogicalCircuits[0]?.logicalCircuitId ?? EMPTY_GUID;
  const candidateLogicalId = toXmlGuid(source.project.logicalCircuitId);
  const resolvedLogicalId = normalizedLcIdSet.has(candidateLogicalId) ? candidateLogicalId : firstLcId;

  let resolvedStartupId: string | undefined;
  if (source.project.startupCircuitId && source.project.startupCircuitId !== EMPTY_GUID) {
    const candidateStartup = toXmlGuid(source.project.startupCircuitId);
    if (normalizedLcIdSet.has(candidateStartup)) {
      resolvedStartupId = candidateStartup;
    }
  }

  const usedCategories = new Set(normalizedLogicalCircuits.map((lc) => lc.category));
  const seenCollapsedLower = new Set<string>();
  const normalizedCollapsedCategories: CollapsedCategory[] = [];
  for (const collapsed of source.collapsedCategories) {
    const name = collapsed.name;
    const key = name.toLowerCase();
    if (name !== "" && usedCategories.has(name) && !seenCollapsedLower.has(key)) {
      seenCollapsedLower.add(key);
      normalizedCollapsedCategories.push({ name });
    }
  }

  return {
    ...source,
    project: {
      ...source.project,
      projectId: toXmlGuid(source.project.projectId),
      logicalCircuitId: resolvedLogicalId,
      startupCircuitId: resolvedStartupId,
    },
    collapsedCategories: normalizedCollapsedCategories,
    logicalCircuits: normalizedLogicalCircuits,
    pins: normalizedPins,
    circuitProbes: normalizedProbes,
    constants: normalizedConstants,
    circuitButtons: normalizedButtons,
    memories: normalizedMemories,
    ledMatrices: normalizedMatrices,
    splitters: normalizedSplitters,
    sensors: normalizedSensors,
    sounds: normalizedSounds,
    synthesizers: [],
    graphicsArrays: normalizedGraphicsArrays,
    circuitSymbols: normalizedSymbols,
    wires: normalizedWires,
    textNotes: normalizedNotes,
  };
}

function rawLcSetHas(set: ReadonlySet<string>, id: string): boolean {
  return set.has(id);
}

// Schreibt das gesamte CircuitProject-Modell in streng Desktop-kompatibles XML (Schema 2.0.0.14)
export function serializeCircuitProjectToXml(sourceProject: CircuitProject): string {
  const project = normalizeProjectForDesktopXml(sourceProject);
  const lines: string[] = [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    `<${XML_ROOT_NAME} xmlns="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">`,
  ];

  lines.push(serializeProjectRecord(project.project));

  for (const collapsed of project.collapsedCategories) {
    lines.push(serializeCollapsedCategoryRecord(collapsed));
  }

  for (const lc of project.logicalCircuits) {
    lines.push(serializeLogicalCircuitRecord(lc));
  }

  for (const pin of project.pins) {
    lines.push(serializePinRecord(pin));
  }

  for (const probe of project.circuitProbes) {
    lines.push(serializeCircuitProbeRecord(probe));
  }
  for (const constant of project.constants) {
    lines.push(serializeConstantRecord(constant));
  }
  for (const button of project.circuitButtons) {
    lines.push(serializeCircuitButtonRecord(button));
  }
  for (const memory of project.memories) {
    lines.push(serializeMemoryRecord(memory));
  }
  for (const matrix of project.ledMatrices) {
    lines.push(serializeLedMatrixRecord(matrix));
  }
  for (const splitter of project.splitters) {
    lines.push(serializeSplitterRecord(splitter));
  }
  for (const sensor of project.sensors) {
    lines.push(serializeSensorRecord(sensor));
  }
  for (const sound of project.sounds) {
    lines.push(serializeSoundRecord(sound));
  }
  for (const ga of project.graphicsArrays) {
    lines.push(serializeGraphicsArrayRecord(ga));
  }

  for (const symbol of project.circuitSymbols) {
    lines.push(serializeCircuitSymbolRecord(symbol));
  }

  for (const wire of project.wires) {
    const serialized = serializeWireRecord(wire);
    if (serialized) {
      lines.push(serialized);
    }
  }

  for (const note of project.textNotes) {
    const serialized = serializeTextNoteRecord(note);
    if (serialized) {
      lines.push(serialized);
    }
  }

  lines.push(`</${XML_ROOT_NAME}>`);
  return lines.join("\n");
}

export const exportProjectToXml = serializeCircuitProjectToXml;

// Serialisiert eine ausgewählte Teilmenge (Symbole, Leitungen, Textnotizen + benötigte Subschaltungen) als XML-Snippet
export function serializeSelectionToXml(
  project: CircuitProject,
  circuit: LogicalCircuit,
  symbolIds: string[],
  wireIds: string[],
  textNoteIds: string[],
): string {
  const symbolIdSet = new Set(symbolIds);
  const wireIdSet = new Set(wireIds);
  const noteIdSet = new Set(textNoteIds);

  const selectedSymbols = circuit.circuitSymbols.filter((s) => symbolIdSet.has(s.circuitSymbolId));
  const selectedWires = circuit.wires.filter((w) => wireIdSet.has(w.wireId));
  const selectedNotes = circuit.textNotes.filter((n) => noteIdSet.has(n.textNoteId));

  const logicalCircuitById = new Map(
    project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
  );
  const probeById = new Map(project.circuitProbes.map((p) => [p.circuitProbeId, p]));
  const constantById = new Map(project.constants.map((c) => [c.constantId, c]));
  const buttonById = new Map(project.circuitButtons.map((b) => [b.circuitButtonId, b]));
  const memoryById = new Map(project.memories.map((m) => [m.memoryId, m]));
  const matrixById = new Map(project.ledMatrices.map((m) => [m.ledMatrixId, m]));
  const splitterById = new Map(project.splitters.map((s) => [s.splitterId, s]));
  const sensorById = new Map(project.sensors.map((s) => [s.sensorId, s]));
  const soundById = new Map(project.sounds.map((s) => [s.soundId, s]));
  const gaById = new Map(project.graphicsArrays.map((g) => [g.graphicsArrayId, g]));
  const pinById = new Map(project.pins.map((p) => [p.pinId, p]));
  for (const p of circuit.logicalPins) {
    pinById.set(p.pinId, p);
  }

  const collectedPins: Pin[] = [];
  const collectedProbes: CircuitProbe[] = [];
  const collectedConstants: Constant[] = [];
  const collectedButtons: CircuitButton[] = [];
  const collectedMemories: Memory[] = [];
  const collectedMatrices: LedMatrix[] = [];
  const collectedSplitters: Splitter[] = [];
  const collectedSensors: Sensor[] = [];
  const collectedSounds: Sound[] = [];
  const collectedGraphicsArrays: GraphicsArray[] = [];
  const collectedSubCircuits: LogicalCircuit[] = [];

  const seenComponentIds = new Set<string>();
  const visitedSubCircuitIds = new Set<string>([circuit.logicalCircuitId]);

  const registerSymbolDependency = (sym: CircuitSymbol): void => {
    const kind = sym.circuit.kind;
    if (kind === "gate") {
      return;
    }

    if (kind === "logicalCircuit") {
      const targetSubId = (sym.circuit as LogicalCircuit).logicalCircuitId ?? sym.circuitId;
      if (visitedSubCircuitIds.has(targetSubId)) {
        return;
      }
      visitedSubCircuitIds.add(targetSubId);
      const subLc = logicalCircuitById.get(targetSubId) ?? (sym.circuit as LogicalCircuit);
      collectedSubCircuits.push(subLc);

      for (const subPin of subLc.logicalPins) {
        if (!seenComponentIds.has(subPin.pinId)) {
          seenComponentIds.add(subPin.pinId);
          collectedPins.push(subPin);
        }
      }
      for (const subSym of subLc.circuitSymbols) {
        registerSymbolDependency(subSym);
      }
      return;
    }

    if (seenComponentIds.has(sym.circuitId)) {
      return;
    }
    seenComponentIds.add(sym.circuitId);

    switch (kind) {
      case "pin": {
        const pin = pinById.get(sym.circuitId);
        if (pin) {
          collectedPins.push(pin);
        }
        break;
      }
      case "circuitProbe":
        collectedProbes.push(probeById.get(sym.circuitId) ?? (sym.circuit as CircuitProbe));
        break;
      case "constant":
        collectedConstants.push(constantById.get(sym.circuitId) ?? (sym.circuit as Constant));
        break;
      case "circuitButton":
        collectedButtons.push(buttonById.get(sym.circuitId) ?? (sym.circuit as CircuitButton));
        break;
      case "memory":
        collectedMemories.push(memoryById.get(sym.circuitId) ?? (sym.circuit as Memory));
        break;
      case "ledMatrix":
        collectedMatrices.push(matrixById.get(sym.circuitId) ?? (sym.circuit as LedMatrix));
        break;
      case "splitter":
        collectedSplitters.push(splitterById.get(sym.circuitId) ?? (sym.circuit as Splitter));
        break;
      case "sensor":
        collectedSensors.push(sensorById.get(sym.circuitId) ?? (sym.circuit as Sensor));
        break;
      case "sound":
        collectedSounds.push(soundById.get(sym.circuitId) ?? (sym.circuit as Sound));
        break;
      case "graphicsArray":
        collectedGraphicsArrays.push(gaById.get(sym.circuitId) ?? (sym.circuit as GraphicsArray));
        break;
      default:
        break;
    }
  };

  for (const sym of selectedSymbols) {
    registerSymbolDependency(sym);
  }

  const rootSelectedPinIds = new Set(collectedPins.map((p) => p.pinId));
  const selectedRootCircuit: LogicalCircuit = {
    ...circuit,
    logicalPins: circuit.logicalPins.filter((p) => rootSelectedPinIds.has(p.pinId)),
    circuitSymbols: selectedSymbols,
    wires: selectedWires,
    textNotes: selectedNotes,
  };

  const subsetProject: CircuitProject = {
    project: {
      ...project.project,
      logicalCircuitId: circuit.logicalCircuitId,
      startupCircuitId: undefined,
    },
    collapsedCategories: [],
    circuits: new Map(),
    logicalCircuits: [selectedRootCircuit, ...collectedSubCircuits],
    gates: new Map(),
    pins: collectedPins,
    devicePins: [],
    constants: collectedConstants,
    circuitButtons: collectedButtons,
    circuitProbes: collectedProbes,
    splitters: collectedSplitters,
    memories: collectedMemories,
    ledMatrices: collectedMatrices,
    sensors: collectedSensors,
    sounds: collectedSounds,
    synthesizers: [],
    graphicsArrays: collectedGraphicsArrays,
    circuitSymbols: selectedSymbols,
    wires: selectedWires,
    textNotes: selectedNotes,
  };

  return serializeCircuitProjectToXml(subsetProject);
}

// Erzeugt einen sicheren Desktop-Dateinamen im Format <projektname>.CircuitProject
export function buildDesktopProjectFileName(projectName: string): string {
  const sanitized = projectName.trim().replace(/[/\\?%*:|"<>]/g, "_");
  const withoutKnownExtension = sanitized
    .replace(/\.(lcweb|circuitproject|xml|json)$/i, "")
    .trim();
  const baseName = withoutKnownExtension.length > 0 ? withoutKnownExtension : "CircuitProject";
  return `${baseName}.CircuitProject`;
}

// Löst im Browser den Datei-Download der aktuellen Schaltung als .CircuitProject-Datei für LogicCircuit Desktop aus
export function downloadDesktopProjectXml(project: CircuitProject): string {
  const xml = exportProjectToXml(project);
  const fileName = buildDesktopProjectFileName(project.project.name);

  if (typeof document !== "undefined" && typeof URL !== "undefined") {
    const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
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

  return xml;
}
