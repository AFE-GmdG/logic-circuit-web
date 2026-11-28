import type BoundingBox from "../types/canvas/boundingBox";
import type GridPoint from "../types/canvas/gridPoint";
import type BasePin from "../types/circuit/basePin";
import type Circuit from "../types/circuit/circuit";
import type CircuitButton from "../types/circuit/circuitButton";
import type CircuitProbe from "../types/circuit/circuitProbe";
import type CircuitProject from "../types/circuit/circuitProject";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type ComponentLayout from "../types/circuit/componentLayout";
import type Conductor from "../types/circuit/conductor";
import type ConductorMap from "../types/circuit/conductorMap";
import type Constant from "../types/circuit/constant";
import type DevicePin from "../types/circuit/devicePin";
import type DisplayColor from "../types/circuit/displayColor";
import type DisplayMargin from "../types/circuit/displayMargin";
import type Gate from "../types/circuit/gate";
import type GateType from "../types/circuit/gateType";
import type GraphicsArray from "../types/circuit/graphicsArray";
import type Jam from "../types/circuit/jam";
import type LedMatrix from "../types/circuit/ledMatrix";
import type LedMatrixCellShape from "../types/circuit/ledMatrixCellShape";
import type LedMatrixType from "../types/circuit/ledMatrixType";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Memory from "../types/circuit/memory";
import type MemoryOnStart from "../types/circuit/memoryOnStart";
import type PaletteGateType from "../types/circuit/paletteGateType";
import type PaletteSelection from "../types/circuit/paletteSelection";
import type Pin from "../types/circuit/pin";
import type PinSide from "../types/circuit/pinSide";
import type PinType from "../types/circuit/pinType";
import type Project from "../types/circuit/project";
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

import { clampSoundFrequency, SOUND_DEFAULT_FREQUENCY } from "./audioPitchTable";
import { GRID_SIZE } from "./coordinateSystem";
import { generateEntityUuid } from "./entityId";
import {
  clampGraphicsArrayBitsPerPixel,
  clampGraphicsArrayDataBitWidth,
  clampGraphicsArrayHeight,
  clampGraphicsArrayWidth,
  clampGraphicsArrayZoom,
  GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL,
  GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH,
  GRAPHICS_ARRAY_DEFAULT_HEIGHT,
  GRAPHICS_ARRAY_DEFAULT_WIDTH,
  GRAPHICS_ARRAY_DEFAULT_ZOOM,
  getGraphicsArrayStrides,
  normalizeGraphicsArrayOnStart,
} from "./graphicsArrayUtils";

export const PIN_RADIUS = 3;
export const MAX_GATE_INPUT_COUNT = 18;
export const MAX_BIT_WIDTH = 32;
export const BUTTON_MIN_GRID_SIZE = 2;
export const BUTTON_MAX_GRID_SIZE = 20;
export const RESIZABLE_SYMBOL_MIN_GRID_SIZE = 2;
export const RESIZABLE_SYMBOL_MAX_GRID_SIZE = 20;
export const LED_MATRIX_MIN_DIM = 1;
export const LED_MATRIX_MAX_DIM = 10;
export const TEXT_NOTE_MIN_GRID_SIZE = 1;
export const TEXT_NOTE_MAX_GRID_SIZE = 100;
export const LOGICAL_CIRCUIT_GRID_WIDTH = 170;
export const LOGICAL_CIRCUIT_GRID_HEIGHT = 170;

// Begrenzt eine Rasterabmessung auf das zulässige [min, max]-Intervall
export function clampGridDimension(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const GATE_TYPE_TO_CODE: Record<GateType, number> = {
  nop: 0,
  clock: 1,
  not: 2,
  or: 3,
  and: 4,
  xor: 5,
  led: 8,
  triState1: 10,
  triState2: 11,
};

const CODE_TO_GATE_TYPE: Record<number, GateType> = {
  0: "nop",
  1: "clock",
  2: "not",
  3: "or",
  4: "and",
  5: "xor",
  8: "led",
  10: "triState1",
  11: "triState2",
};

// Erzeugt den deterministischen Schlüssel für einen Rasterpunkt in Maps und Sets
export function gridPointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

// Berechnet die deterministische Gate-GUID analog zu GateSet.GateGuid in Gate.cs
export function getGateGuid(
  gateType: GateType,
  inputCount: number,
  invertedOutput: boolean,
): string {
  const code = GATE_TYPE_TO_CODE[gateType] ?? 0;
  const gHex = code.toString(16).padStart(2, "0");
  const iHex = Math.max(0, Math.min(255, inputCount)).toString(16).padStart(2, "0");
  const vHex = invertedOutput ? "01" : "00";
  return `00000000-0000-0000-0000-000000${gHex}${iHex}${vHex}`;
}

// Dekodiert eine deterministische Gate-GUID zurück in (gateType, inputCount, invertedOutput)
export function parseGateGuid(gateId: string): {
  gateType: GateType;
  inputCount: number;
  invertedOutput: boolean;
} | null {
  const normalized = gateId.trim().toLowerCase();
  const match = normalized.match(
    /^00000000-0000-0000-0000-000000([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:-[a-z0-9]+)?$/,
  );
  if (!match) {
    return null;
  }

  const gateCode = parseInt(match[1], 16);
  const inputCount = parseInt(match[2], 16);
  const invertedByte = parseInt(match[3], 16);
  const gateType = CODE_TO_GATE_TYPE[gateCode];
  if (!gateType) {
    return null;
  }

  return {
    gateType,
    inputCount,
    invertedOutput: invertedByte !== 0,
  };
}

// Extrahiert die optionale Web-LED-Farbe aus einer erweiterten Gate-GUID (z. B. "...-green")
export function extractLedColorFromGateId(gateId: string): DisplayColor {
  const normalized = gateId.trim().toLowerCase();
  if (normalized.endsWith("-green")) {
    return "green";
  }
  if (normalized.endsWith("-blue")) {
    return "blue";
  }
  if (normalized.endsWith("-yellow")) {
    return "yellow";
  }
  return "red";
}

// Vergleicht zwei BasePin-Instanzen analog zu PinComparer.cs
export function comparePins(
  a: BasePin,
  b: BasePin,
  symbolCoordsByCircuitId?: Map<string, GridPoint>,
): number {
  const aDevice = a as Partial<DevicePin>;
  const bDevice = b as Partial<DevicePin>;

  if (aDevice.kind === "devicePin" && bDevice.kind === "devicePin") {
    return (aDevice.order ?? 0) - (bDevice.order ?? 0);
  }

  const aPin = a as Partial<Pin>;
  const bPin = b as Partial<Pin>;
  const indexDiff = (aPin.index ?? 0) - (bPin.index ?? 0);
  if (indexDiff !== 0) {
    return indexDiff;
  }

  if (symbolCoordsByCircuitId) {
    const posA = symbolCoordsByCircuitId.get(a.pinId);
    const posB = symbolCoordsByCircuitId.get(b.pinId);
    if (posA && posB) {
      const dy = posA.y - posB.y;
      if (dy !== 0) {
        return dy;
      }
      const dx = posA.x - posB.x;
      if (dx !== 0) {
        return dx;
      }
    }
  }

  return a.name.localeCompare(b.name);
}

// Verteilt die Pins einer Bauteilseite exakt nach dem Algorithmus aus Circuit.UpdatePin in Circuit.cs
export function distributeSidePins(
  sideSize: number,
  pins: BasePin[],
  makePoint: (coord: number) => GridPoint,
): BasePin[] {
  if (pins.length === 0) {
    return [];
  }

  if (pins.length === 1) {
    const coord = Math.floor(sideSize / 2);
    return [{ ...pins[0], gridPoint: makePoint(coord) }];
  }

  const step = Math.floor((sideSize - 2) / (pins.length - 1));
  return pins.map((pin, index) => ({
    ...pin,
    gridPoint: makePoint(index * step + 1),
  }));
}

// Berechnet Bauteil-Dimensionen und Pin-Rasterpunkte analog zu Circuit.Update() in Circuit.cs
export function calculateCircuitDimensionsAndPins(
  rawPins: BasePin[],
  minWidth = 2,
  minHeight = 2,
  symbolCoordsByCircuitId?: Map<string, GridPoint>,
): ComponentLayout {
  const bySide: Record<PinSide, BasePin[]> = {
    left: [],
    top: [],
    right: [],
    bottom: [],
  };

  for (const pin of rawPins) {
    bySide[pin.pinSide].push(pin);
  }

  for (const side of ["left", "top", "right", "bottom"] as PinSide[]) {
    bySide[side].sort((a, b) => comparePins(a, b, symbolCoordsByCircuitId));
  }

  const defaultWidth = Math.max(bySide.top.length, bySide.bottom.length) + 1;
  const defaultHeight = Math.max(bySide.left.length, bySide.right.length) + 1;

  const gridWidth = Math.max(2, minWidth, defaultWidth);
  const gridHeight = Math.max(2, minHeight, defaultHeight);

  const leftPins = distributeSidePins(gridHeight, bySide.left, (y) => ({ x: 0, y }));
  const topPins = distributeSidePins(gridWidth, bySide.top, (x) => ({ x, y: 0 }));
  const rightPins = distributeSidePins(gridHeight, bySide.right, (y) => ({ x: gridWidth, y }));
  const bottomPins = distributeSidePins(gridWidth, bySide.bottom, (x) => ({ x, y: gridHeight }));

  const positionedById = new Map<string, BasePin>();
  for (const pin of [...leftPins, ...topPins, ...rightPins, ...bottomPins]) {
    positionedById.set(pin.pinId, pin);
  }

  // Ursprüngliche Pin-Reihenfolge beibehalten, aber mit berechneten GridPoints aktualisieren
  const positionedPins = rawPins.map((pin) => positionedById.get(pin.pinId) ?? pin);

  return {
    gridWidth,
    gridHeight,
    pins: positionedPins,
  };
}

// Erzeugt ein deterministisches Gate-Objekt inklusive seiner DevicePins analog zu GateSet.Create in Gate.cs
export function createGate(
  gateType: GateType,
  inputCount: number,
  invertedOutput = false,
  color: DisplayColor = "red",
): Gate {
  const validInputCount =
    gateType === "clock" || gateType === "nop"
      ? 0
      : gateType === "not"
        ? 1
        : gateType === "triState1" || gateType === "triState2"
          ? 2
          : gateType === "led"
            ? inputCount === 8 ? 8 : 1
            : Math.max(2, Math.min(MAX_GATE_INPUT_COUNT, inputCount));

  const effectiveInverted =
    gateType === "not"
      ? true
      : gateType === "clock" || gateType === "led" || gateType === "triState1" || gateType === "triState2"
        ? false
        : invertedOutput;

  const baseGateId = getGateGuid(gateType, validInputCount, effectiveInverted);
  const gateId = gateType === "led" && color !== "red" ? `${baseGateId}-${color}` : baseGateId;
  const rawPins: DevicePin[] = [];
  let order = 0;

  const addPin = (
    pinId: string,
    name: string,
    pinType: PinType,
    pinSide: PinSide,
    inverted = false,
  ) => {
    rawPins.push({
      kind: "devicePin",
      pinId,
      circuitId: gateId,
      bitWidth: 1,
      pinType,
      pinSide,
      inverted,
      name,
      note: "",
      jamNotation: "",
      order: order++,
      gridPoint: { x: 0, y: 0 },
    });
  };

  if (gateType === "triState1" || gateType === "triState2") {
    addPin("in-0", "In", "input", "left", false);
    addPin("enable", "Enable", "input", gateType === "triState1" ? "bottom" : "top", false);
    addPin("out-0", "Out", "output", "right", false);
  } else if (gateType === "led" && validInputCount === 8) {
    const pinNames = ["a", "b", "c", "d", "e", "f", "g", "dp"];
    for (let i = 0; i < 4; i++) {
      addPin(`in-${i}`, pinNames[i], "input", "left", false);
    }
    for (let i = 4; i < 8; i++) {
      addPin(`in-${i}`, pinNames[i], "input", "right", false);
    }
  } else {
    if (validInputCount === 1) {
      addPin("in-0", "In", "input", "left", false);
    } else {
      for (let i = 0; i < validInputCount; i++) {
        addPin(`in-${i}`, `In ${i + 1}`, "input", "left", false);
      }
    }

    if (gateType !== "nop" && gateType !== "led") {
      addPin("out-0", "Out", "output", "right", effectiveInverted);
    }
  }

  const isSmallGate = gateType === "clock" || (gateType === "led" && validInputCount === 1);
  const minWidth = isSmallGate ? 2 : 3;
  const minHeight = isSmallGate ? 2 : (gateType === "led" && validInputCount === 8 ? 5 : 4);

  const layout = calculateCircuitDimensionsAndPins(rawPins, minWidth, minHeight);

  let name = "Gate";
  let notation = "";
  let category = "gates";

  switch (gateType) {
    case "clock":
      name = "Clock";
      notation = "Clock";
      category = "io";
      break;
    case "not":
      name = "NOT";
      notation = "1";
      break;
    case "and":
      name = effectiveInverted ? "NAND" : "AND";
      notation = "&";
      break;
    case "or":
      name = effectiveInverted ? "NOR" : "OR";
      notation = "≥1";
      break;
    case "xor":
      name = effectiveInverted ? "XNOR" : "XOR";
      notation = "=1";
      break;
    case "triState1":
    case "triState2":
      name = "Tri-State";
      notation = "▷";
      break;
    case "led":
      name = validInputCount === 1 ? "LED" : "7-Segment";
      notation = validInputCount === 1 ? "LED" : "7-Segment";
      category = "displays";
      break;
    default:
      break;
  }

  return {
    kind: "gate",
    circuitId: gateId,
    gateId,
    gateType,
    inputCount: validInputCount,
    invertedOutput: effectiveInverted,
    name,
    notation,
    note: "",
    category,
    isDisplay: gateType === "led",
    color: gateType === "led" ? color : undefined,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Generiert einen eindeutigen Pin-Namen innerhalb einer Schaltung (z. B. X -> X1 -> X2 etc.) analog zur Desktop-App
export function generateUniquePinName(
  candidateName: string,
  existingPins: (Pin | { name: string })[],
): string {
  const existingNames = new Set(
    existingPins.map((p) => p.name.trim().toLowerCase()).filter(Boolean),
  );

  const trimmed = candidateName.trim();
  const base = trimmed !== "" ? trimmed : "Pin";

  if (!existingNames.has(base.toLowerCase())) {
    return base;
  }

  // Falls die Basis bereits mit einer Zahl endet (z. B. "X1" oder "D0")
  const match = base.match(/^(.*?)(\d+)$/);
  let prefix = base;
  let startNum = 1;

  if (match) {
    prefix = match[1];
    startNum = parseInt(match[2], 10) + 1;
  }

  let counter = startNum;
  while (existingNames.has(`${prefix}${counter}`.toLowerCase())) {
    counter++;
  }

  return `${prefix}${counter}`;
}

// Ermittelt die Kurzbeschriftung eines Sub-Circuit-Pins (leer = keine Beschriftung am Chip)
export function getPinJamDisplayLabel(pin: BasePin): string {
  const sideMaxLen = pin.pinSide === "top" || pin.pinSide === "bottom" ? 4 : 2;
  const explicit = pin.jamNotation?.trim() ?? "";
  if (explicit === "") {
    return "";
  }
  return explicit.slice(0, Math.max(sideMaxLen, Math.min(4, explicit.length)));
}

// Erzeugt einen Pin-Baustein (Ein- oder Ausgang einer LogicalCircuit) analog zu PinSet.Create in Pin.cs
export function createPinCircuit(
  pinId: string,
  logicalCircuitId: string,
  pinType: "input" | "output",
  name: string,
  bitWidth = 1,
  pinSide?: PinSide,
  inverted = false,
  index = 0,
  symbolWidth = 2,
  symbolHeight = 2,
  jamNotation = "",
): { pin: Pin; internalDevicePin: DevicePin; pinCircuit: Circuit } {
  const effectiveSide: PinSide = pinSide ?? (pinType === "input" ? "left" : "right");
  const internalSide: PinSide = pinType === "input" ? "right" : "left";

  const targetWidth = clampGridDimension(symbolWidth, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE);
  const targetHeight = clampGridDimension(symbolHeight, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE);

  const internalDevicePin: DevicePin = {
    kind: "devicePin",
    pinId: `${pinId}-device`,
    circuitId: pinId,
    bitWidth,
    pinType: pinType === "input" ? "output" : "input",
    pinSide: internalSide,
    inverted,
    name,
    note: "",
    jamNotation,
    order: 0,
    gridPoint: { x: internalSide === "right" ? targetWidth : 0, y: Math.floor(targetHeight / 2) },
  };

  const layout = calculateCircuitDimensionsAndPins([internalDevicePin], targetWidth, targetHeight);

  const pin: Pin = {
    kind: "pin",
    pinId,
    circuitId: logicalCircuitId,
    bitWidth,
    pinType,
    pinSide: effectiveSide,
    inverted,
    name,
    note: "",
    jamNotation,
    index,
    gridPoint: {
      x: effectiveSide === "right" ? targetWidth : 0,
      y: Math.floor(targetHeight / 2),
    },
  };

  const pinCircuit: Circuit = {
    kind: "pin",
    circuitId: pinId,
    name,
    notation: pinType === "input" ? `In: ${name}` : `Out: ${name}`,
    note: "",
    category: "io",
    isDisplay: false,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: [(layout.pins[0] as DevicePin) ?? internalDevicePin],
  };

  return {
    pin,
    internalDevicePin: (layout.pins[0] as DevicePin) ?? internalDevicePin,
    pinCircuit,
  };
}

// Erzeugt einen Taster-/Schalter-Baustein analog zu CircuitButtonSet.Create in CircuitButton.cs
export function createCircuitButton(
  circuitButtonId: string,
  notation = "",
  isToggle = false,
  pinSide: PinSide = "right",
  inverted = false,
  width = 2,
  height = 2,
  isOn = false,
): CircuitButton {
  const devicePin: DevicePin = {
    kind: "devicePin",
    pinId: `${circuitButtonId}-out`,
    circuitId: circuitButtonId,
    bitWidth: 1,
    pinType: "output",
    pinSide,
    inverted,
    name: "Out",
    note: "",
    jamNotation: "",
    order: 0,
    gridPoint: { x: 2, y: 1 },
  };

  const clampedWidth = clampGridDimension(width, BUTTON_MIN_GRID_SIZE, BUTTON_MAX_GRID_SIZE);
  const clampedHeight = clampGridDimension(height, BUTTON_MIN_GRID_SIZE, BUTTON_MAX_GRID_SIZE);
  const layout = calculateCircuitDimensionsAndPins([devicePin], clampedWidth, clampedHeight);

  return {
    kind: "circuitButton",
    circuitId: circuitButtonId,
    circuitButtonId,
    name: "Button",
    notation,
    note: "",
    category: "io",
    isDisplay: true,
    modifiers: 0,
    keyCode: 0,
    isToggle,
    isOn,
    pinSide,
    inverted,
    width: layout.gridWidth,
    height: layout.gridHeight,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Erzeugt einen Konstanten-Baustein analog zu ConstantSet.Create in Constant.cs
export function createConstant(
  constantId: string,
  bitWidth = 1,
  value = 0,
  pinSide: PinSide = "right",
  isHex = true,
  symbolWidth = 2,
  symbolHeight = 2,
): Constant {
  const clampedWidth = Math.max(1, Math.min(MAX_BIT_WIDTH, bitWidth));
  const normalizedValue = clampedWidth < 32 ? value & ((1 << clampedWidth) - 1) : value;

  const targetWidth = clampGridDimension(symbolWidth, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE);
  const targetHeight = clampGridDimension(symbolHeight, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE);

  const devicePin: DevicePin = {
    kind: "devicePin",
    pinId: `${constantId}-out`,
    circuitId: constantId,
    bitWidth: clampedWidth,
    pinType: "output",
    pinSide,
    inverted: false,
    name: "Out",
    note: "",
    jamNotation: "",
    order: 0,
    gridPoint: { x: pinSide === "left" ? 0 : targetWidth, y: Math.floor(targetHeight / 2) },
  };

  const layout = calculateCircuitDimensionsAndPins([devicePin], targetWidth, targetHeight);

  const notation = isHex
    ? normalizedValue.toString(16).toUpperCase()
    : normalizedValue.toString(10);

  return {
    kind: "constant",
    circuitId: constantId,
    constantId,
    name: "Constant",
    notation,
    note: "",
    category: "io",
    isDisplay: false,
    bitWidth: clampedWidth,
    value: normalizedValue,
    isHex,
    pinSide,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Erzeugt einen Signal-Sonden-Baustein (Probe) analog zu CircuitProbeSet.Create in CircuitProbe.cs
export function createCircuitProbe(
  circuitProbeId: string,
  name = "",
  pinSide: PinSide = "left",
  symbolWidth = 2,
  symbolHeight = 2,
  isHex = false,
): CircuitProbe {
  const targetWidth = clampGridDimension(symbolWidth, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE);
  const targetHeight = clampGridDimension(symbolHeight, RESIZABLE_SYMBOL_MIN_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE);

  const devicePin: DevicePin = {
    kind: "devicePin",
    pinId: `${circuitProbeId}-in`,
    circuitId: circuitProbeId,
    bitWidth: 1,
    pinType: "input",
    pinSide,
    inverted: false,
    name: "In",
    note: "",
    jamNotation: "",
    order: 0,
    gridPoint: { x: pinSide === "right" ? targetWidth : 0, y: Math.floor(targetHeight / 2) },
  };

  const layout = calculateCircuitDimensionsAndPins([devicePin], targetWidth, targetHeight);
  const trimmedName = name.trim();
  const hasCustomName =
    trimmedName !== "" && trimmedName.toLowerCase() !== circuitProbeId.toLowerCase();

  return {
    kind: "circuitProbe",
    circuitId: circuitProbeId,
    circuitProbeId,
    name: hasCustomName ? trimmedName : circuitProbeId,
    notation: hasCustomName ? `?\n${trimmedName}` : "?",
    note: "",
    category: "displays",
    isDisplay: false,
    pinSide,
    isHex,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Erzeugt einen Bus-Splitter-Baustein analog zu SplitterSet.Create in Splitter.cs
export function createSplitter(
  splitterId: string,
  bitWidth: number,
  pinCount: number,
  clockwise: boolean,
): Splitter {
  const safePinCount = Math.max(2, Math.min(MAX_BIT_WIDTH, pinCount));
  const safeBitWidth = Math.max(safePinCount, Math.min(MAX_BIT_WIDTH, bitWidth));

  const widePinSide: PinSide = clockwise ? "left" : "right";
  const thinPinSide: PinSide = clockwise ? "right" : "left";

  const rawPins: DevicePin[] = [];
  let order = 0;

  // Breiter Bus-Pin muss als erstes angelegt werden (für Splitter.Pass)
  rawPins.push({
    kind: "devicePin",
    pinId: `${splitterId}-bus`,
    circuitId: splitterId,
    bitWidth: safeBitWidth,
    pinType: "none",
    pinSide: widePinSide,
    inverted: false,
    name: "Bus",
    note: "",
    jamNotation: "",
    order: order++,
    gridPoint: { x: 0, y: 0 },
  });

  const pinWidth = Math.floor(safeBitWidth / safePinCount);
  const rem = safeBitWidth % safePinCount;

  for (let i = 0; i < rem; i++) {
    const width = pinWidth + 1;
    const firstBit = i * width;
    const pinName = width === 1 ? `${firstBit}` : `${firstBit}-${firstBit + width - 1}`;
    rawPins.push({
      kind: "devicePin",
      pinId: `${splitterId}-thin-${i}`,
      circuitId: splitterId,
      bitWidth: width,
      pinType: "none",
      pinSide: thinPinSide,
      inverted: false,
      name: pinName,
      note: "",
      jamNotation: "",
      order: order++,
      gridPoint: { x: 0, y: 0 },
    });
  }

  for (let i = rem; i < safePinCount; i++) {
    const firstBit = i * pinWidth + rem;
    const pinName = pinWidth === 1 ? `${firstBit}` : `${firstBit}-${firstBit + pinWidth - 1}`;
    rawPins.push({
      kind: "devicePin",
      pinId: `${splitterId}-thin-${i}`,
      circuitId: splitterId,
      bitWidth: pinWidth,
      pinType: "none",
      pinSide: thinPinSide,
      inverted: false,
      name: pinName,
      note: "",
      jamNotation: "",
      order: order++,
      gridPoint: { x: 0, y: 0 },
    });
  }

  const layout = calculateCircuitDimensionsAndPins(rawPins, 1, safePinCount + 1);
  // Splitter hat im Original immer exakt Breite 1 (CircuitSymbolWidth gibt 1 zurück)
  const fixedPins = layout.pins.map((pin) => ({
    ...pin,
    gridPoint: {
      x: pin.pinSide === "right" ? 1 : 0,
      y: pin.gridPoint.y,
    },
  }));

  return {
    kind: "splitter",
    circuitId: splitterId,
    splitterId,
    name: "Splitter",
    notation: "Splitter",
    note: "",
    category: "io",
    isDisplay: false,
    bitWidth: safeBitWidth,
    pinCount: safePinCount,
    clockwise,
    symbolWidth: 1,
    symbolHeight: layout.gridHeight,
    pins: fixedPins,
  };
}

// Erzeugt einen konfigurierbaren LED-Matrix-Baustein analog zu LedMatrixSet.Create in LedMatrix.cs
export function createLedMatrix(
  ledMatrixId: string,
  rows = 4,
  columns = 4,
  matrixType: LedMatrixType = "individual",
  cellShape: LedMatrixCellShape = "round",
  colors = 1,
  persistenceMultiplier: 1 | 2 | 3 = 1,
): LedMatrix {
  const safeRows = Math.max(1, Math.min(10, rows));
  const safeCols = Math.max(1, Math.min(10, columns));
  const safeColors = Math.max(1, Math.min(3, colors));

  const rawPins: DevicePin[] = [];
  let order = 0;

  if (matrixType === "individual") {
    const bitWidth = safeCols * safeColors;
    for (let r = 0; r < safeRows; r++) {
      rawPins.push({
        kind: "devicePin",
        pinId: `${ledMatrixId}-row-${r}`,
        circuitId: ledMatrixId,
        bitWidth,
        pinType: "input",
        pinSide: "left",
        inverted: false,
        name: `Row ${r + 1}`,
        note: "",
        jamNotation: "",
        order: order++,
        gridPoint: { x: 0, y: 0 },
      });
    }
  } else {
    for (let c = 0; c < safeCols; c++) {
      rawPins.push({
        kind: "devicePin",
        pinId: `${ledMatrixId}-col-${c}`,
        circuitId: ledMatrixId,
        bitWidth: safeColors,
        pinType: "input",
        pinSide: "top",
        inverted: false,
        name: `Col ${c + 1}`,
        note: "",
        jamNotation: "",
        order: order++,
        gridPoint: { x: 0, y: 0 },
      });
    }
    for (let r = 0; r < safeRows; r++) {
      rawPins.push({
        kind: "devicePin",
        pinId: `${ledMatrixId}-row-${r}`,
        circuitId: ledMatrixId,
        bitWidth: 1,
        pinType: "input",
        pinSide: "left",
        inverted: false,
        name: `Row ${r + 1}`,
        note: "",
        jamNotation: "",
        order: order++,
        gridPoint: { x: 0, y: 0 },
      });
    }
  }

  const targetWidth = safeCols + 1;
  const targetHeight = safeRows + 1;
  const layout = calculateCircuitDimensionsAndPins(rawPins, targetWidth, targetHeight);

  return {
    kind: "ledMatrix",
    circuitId: ledMatrixId,
    ledMatrixId,
    name: "LED Matrix",
    notation: "LED Matrix",
    note: "",
    category: "displays",
    isDisplay: true,
    matrixType,
    cellShape,
    rows: safeRows,
    columns: safeCols,
    colors: safeColors,
    persistenceMultiplier,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Berechnet die erforderliche Adress-Bitbreite eines GraphicsArray analog zu GraphicsArray.AddressBitsFor
export function getGraphicsArrayAddressBitWidth(
  dataBitWidth: number,
  bitsPerPixel: number,
  width: number,
  height: number,
): number {
  return getGraphicsArrayStrides(dataBitWidth, bitsPerPixel, width, height).addressBitWidth;
}

// Erzeugt einen Speicherbaustein (ROM oder RAM) analog zu MemorySet.Create in Memory.cs
export function createMemory(
  memoryId: string,
  writable: boolean,
  addressBitWidth: number,
  dataBitWidth: number,
  options?: {
    writeOn1?: boolean;
    onStart?: MemoryOnStart;
    dualPort?: boolean;
    data?: string;
    note?: string;
  },
): Memory {
  const safeAddressBitWidth = Math.max(1, Math.min(16, addressBitWidth));
  const safeDataBitWidth = Math.max(1, Math.min(MAX_BIT_WIDTH, dataBitWidth));
  const writeOn1 = options?.writeOn1 ?? false;
  const onStart: MemoryOnStart = options?.onStart ?? "random";
  const dualPort = options?.dualPort ?? false;
  const data = options?.data ?? "";
  const note = options?.note ?? "";

  const rawPins: DevicePin[] = [];
  let order = 0;

  const pushPin = (
    pinId: string,
    name: string,
    jamNotation: string,
    pinType: PinType,
    pinSide: PinSide,
    bitWidth: number,
  ) => {
    rawPins.push({
      kind: "devicePin",
      pinId,
      circuitId: memoryId,
      bitWidth,
      pinType,
      pinSide,
      inverted: false,
      name,
      note: "",
      jamNotation,
      order: order++,
      gridPoint: { x: 0, y: 0 },
    });
  };

  pushPin(`${memoryId}-addr`, "Address", "A", "input", "left", safeAddressBitWidth);
  pushPin(`${memoryId}-data-out`, "Data", "D", "output", "right", safeDataBitWidth);

  if (writable) {
    pushPin(`${memoryId}-data-in`, "DataIn", "D", "input", "left", safeDataBitWidth);
    pushPin(
      `${memoryId}-write`,
      writeOn1 ? "Write (1)" : "Write (0)",
      "W",
      "input",
      "bottom",
      1,
    );
  }

  if (dualPort) {
    pushPin(`${memoryId}-addr2`, "Address2", "A2", "input", "left", safeAddressBitWidth);
    pushPin(`${memoryId}-data-out2`, "Data2", "D2", "output", "right", safeDataBitWidth);
  }

  const minHeight = Math.max(4, (writable ? 3 : 2) + (dualPort ? 1 : 0));
  const layout = calculateCircuitDimensionsAndPins(rawPins, 3, minHeight);
  const label = writable ? "RAM" : "ROM";

  return {
    kind: "memory",
    circuitId: memoryId,
    memoryId,
    name: label,
    notation: label,
    note,
    category: "gates",
    isDisplay: false,
    writable,
    writeOn1,
    onStart,
    addressBitWidth: safeAddressBitWidth,
    dataBitWidth: safeDataBitWidth,
    dualPort,
    data,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Erzeugt einen Sensor-Baustein analog zu SensorSet.Create in Sensor.cs
export function createSensor(
  sensorId: string,
  sensorType: SensorType = "random",
  bitWidth = 1,
  pinSide: PinSide = "right",
  notation = "",
  data = "",
  note = "",
): Sensor {
  const safeBitWidth = Math.max(1, Math.min(MAX_BIT_WIDTH, bitWidth));
  let normalizedData = data;
  if ((sensorType === "series" || sensorType === "loop") && !normalizedData.trim()) {
    normalizedData = "0:0";
  } else if (sensorType === "random" && !normalizedData.trim()) {
    normalizedData = "A:14";
  }

  const devicePin: DevicePin = {
    kind: "devicePin",
    pinId: `${sensorId}-out`,
    circuitId: sensorId,
    bitWidth: safeBitWidth,
    pinType: "output",
    pinSide,
    inverted: false,
    name: "Out",
    note: "",
    jamNotation: "",
    order: 0,
    gridPoint: { x: 0, y: 0 },
  };

  const layout = calculateCircuitDimensionsAndPins([devicePin], 4, 3);

  return {
    kind: "sensor",
    circuitId: sensorId,
    sensorId,
    name: "Sensor",
    notation,
    note,
    category: "io",
    isDisplay: sensorType === "ascii" || sensorType === "keyCode",
    sensorType,
    bitWidth: safeBitWidth,
    pinSide,
    data: normalizedData,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Erzeugt einen Standard-Summer (Sound) mit Web-Default 440 Hz Sinus analog zu SoundSet.Create in Sound.cs
export function createSound(
  soundId: string,
  pinSide: PinSide = "left",
  notation = "",
  note = "",
  frequency = SOUND_DEFAULT_FREQUENCY,
  waveform: SoundWaveform = "sine",
): Sound {
  const clampedFrequency = clampSoundFrequency(frequency);
  const devicePin: DevicePin = {
    kind: "devicePin",
    pinId: `${soundId}-in`,
    circuitId: soundId,
    bitWidth: 1,
    pinType: "input",
    pinSide,
    inverted: false,
    name: "In",
    note: "",
    jamNotation: "",
    order: 0,
    gridPoint: { x: 0, y: 0 },
  };

  const layout = calculateCircuitDimensionsAndPins([devicePin], 3, 3);

  return {
    kind: "sound",
    circuitId: soundId,
    soundId,
    name: "Sound",
    notation,
    note,
    category: "displays",
    isDisplay: false,
    pinSide,
    frequency: clampedFrequency,
    waveform,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Erzeugt einen polyphonen 8-Bit-Synthesizer (3x4 IC: F 8-Bit links y=1, V 8-Bit links y=3, E 1-Bit unten x=1)
export function createSynthesizer(
  synthesizerId: string,
  mode: SynthesizerMode = "square",
  notation = "",
  note = "",
): Synthesizer {
  const rawPins: DevicePin[] = [
    {
      kind: "devicePin",
      pinId: `${synthesizerId}-freq`,
      circuitId: synthesizerId,
      bitWidth: 8,
      pinType: "input",
      pinSide: "left",
      inverted: false,
      name: "Frequency",
      note: "",
      jamNotation: "F",
      order: 0,
      gridPoint: { x: 0, y: 0 },
    },
    {
      kind: "devicePin",
      pinId: `${synthesizerId}-vol`,
      circuitId: synthesizerId,
      bitWidth: 8,
      pinType: "input",
      pinSide: "left",
      inverted: false,
      name: "Volume",
      note: "",
      jamNotation: "V",
      order: 1,
      gridPoint: { x: 0, y: 0 },
    },
    {
      kind: "devicePin",
      pinId: `${synthesizerId}-en`,
      circuitId: synthesizerId,
      bitWidth: 1,
      pinType: "input",
      pinSide: "bottom",
      inverted: false,
      name: "Enable",
      note: "",
      jamNotation: "E",
      order: 2,
      gridPoint: { x: 0, y: 0 },
    },
  ];

  const layout = calculateCircuitDimensionsAndPins(rawPins, 3, 4);

  return {
    kind: "synthesizer",
    circuitId: synthesizerId,
    synthesizerId,
    name: "Synthesizer",
    notation,
    note,
    category: "displays",
    isDisplay: false,
    mode,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Erzeugt ein speicherabgebildetes Grafik-Display (GraphicsArray) analog zu GraphicsArraySet.Create in GraphicsArray.cs
export function createGraphicsArray(
  graphicsArrayId: string,
  options?: {
    writeOn1?: boolean;
    onStart?: MemoryOnStart;
    dataBitWidth?: number;
    bitsPerPixel?: number;
    width?: number;
    height?: number;
    zoom?: number;
    note?: string;
  },
): GraphicsArray {
  const writeOn1 = options?.writeOn1 ?? false;
  const onStart: MemoryOnStart = normalizeGraphicsArrayOnStart(options?.onStart);
  const dataBitWidth = clampGraphicsArrayDataBitWidth(
    options?.dataBitWidth ?? GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH,
  );
  const bitsPerPixel = clampGraphicsArrayBitsPerPixel(
    options?.bitsPerPixel ?? GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL,
  );
  const width = clampGraphicsArrayWidth(options?.width ?? GRAPHICS_ARRAY_DEFAULT_WIDTH);
  const height = clampGraphicsArrayHeight(options?.height ?? GRAPHICS_ARRAY_DEFAULT_HEIGHT);
  const zoom = clampGraphicsArrayZoom(options?.zoom ?? GRAPHICS_ARRAY_DEFAULT_ZOOM);
  const note = options?.note ?? "";

  const addressBitWidth = getGraphicsArrayAddressBitWidth(dataBitWidth, bitsPerPixel, width, height);

  const rawPins: DevicePin[] = [
    {
      kind: "devicePin",
      pinId: `${graphicsArrayId}-addr`,
      circuitId: graphicsArrayId,
      bitWidth: addressBitWidth,
      pinType: "input",
      pinSide: "left",
      inverted: false,
      name: "Address",
      note: "",
      jamNotation: "",
      order: 0,
      gridPoint: { x: 0, y: 0 },
    },
    {
      kind: "devicePin",
      pinId: `${graphicsArrayId}-data-out`,
      circuitId: graphicsArrayId,
      bitWidth: dataBitWidth,
      pinType: "output",
      pinSide: "right",
      inverted: false,
      name: "Data",
      note: "",
      jamNotation: "",
      order: 1,
      gridPoint: { x: 0, y: 0 },
    },
    {
      kind: "devicePin",
      pinId: `${graphicsArrayId}-data-in`,
      circuitId: graphicsArrayId,
      bitWidth: dataBitWidth,
      pinType: "input",
      pinSide: "left",
      inverted: false,
      name: "DataIn",
      note: "",
      jamNotation: "",
      order: 2,
      gridPoint: { x: 0, y: 0 },
    },
    {
      kind: "devicePin",
      pinId: `${graphicsArrayId}-write`,
      circuitId: graphicsArrayId,
      bitWidth: 1,
      pinType: "input",
      pinSide: "bottom",
      inverted: false,
      name: writeOn1 ? "Write (1)" : "Write (0)",
      note: "",
      jamNotation: "",
      order: 3,
      gridPoint: { x: 0, y: 0 },
    },
  ];

  const minGridWidth = Math.max(2, Math.ceil((width * zoom + 3) / GRID_SIZE));
  const minGridHeight = Math.max(3, Math.ceil((height * zoom + 3) / GRID_SIZE));
  const layout = calculateCircuitDimensionsAndPins(rawPins, minGridWidth, minGridHeight);

  return {
    kind: "graphicsArray",
    circuitId: graphicsArrayId,
    graphicsArrayId,
    name: "Graphics Array",
    notation: "Graphics Array",
    note,
    category: "displays",
    isDisplay: true,
    writeOn1,
    onStart,
    dataBitWidth,
    bitsPerPixel,
    width,
    height,
    zoom,
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins,
  };
}

// Übersetzt ein einzelnes Bit beim Durchgang durch einen Splitter analog zu Splitter.Pass in Splitter.cs
export function passSplitterBit(
  jams: Jam[],
  enterJam: Jam,
  enterBit: number,
): { exitJam: Jam; exitBit: number } {
  const sorted = [...jams].sort((a, b) => comparePins(a.pin, b.pin));
  if (sorted.length < 3 || enterBit < 0 || enterBit >= enterJam.pin.bitWidth) {
    throw new Error("Ungültiger Splitter-Durchgang");
  }

  const wideJam = sorted[0];
  if (enterJam === wideJam) {
    let width = 0;
    for (let i = 1; i < sorted.length; i++) {
      const thinPinWidth = sorted[i].pin.bitWidth;
      if (enterBit < width + thinPinWidth) {
        return {
          exitJam: sorted[i],
          exitBit: enterBit - width,
        };
      }
      width += thinPinWidth;
    }
  } else {
    let width = 0;
    for (let i = 1; i < sorted.length; i++) {
      const thinPinWidth = sorted[i].pin.bitWidth;
      if (enterJam === sorted[i]) {
        return {
          exitJam: wideJam,
          exitBit: enterBit + width,
        };
      }
      width += thinPinWidth;
    }
  }

  throw new Error("Ziel-Jam im Splitter nicht gefunden");
}

// Berechnet das Layout für einen Paletten- oder SymbolRenderer-Typ auf Basis des C#-Pin-Algorithmus
export type ComponentLayoutOptions = {
  inputCount?: number;
  rows?: number;
  columns?: number;
  matrixType?: LedMatrixType;
  cellShape?: LedMatrixCellShape;
  bitWidth?: number;
  pinSide?: PinSide;
  color?: DisplayColor;
  pinCount?: number;
  pinBitWidth?: number;
  clockwise?: boolean;
  sensorType?: SensorType;
  addressBitWidth?: number;
  dataBitWidth?: number;
  bitsPerPixel?: number;
  width?: number;
  height?: number;
  zoom?: number;
  writeOn1?: boolean;
  dualPort?: boolean;
  frequency?: number;
  waveform?: SoundWaveform;
  synthesizerMode?: SynthesizerMode;
};

export function getComponentLayout(
  type: PaletteGateType,
  inputCountOrOptions: number | ComponentLayoutOptions = 2,
): ComponentLayout {
  const options: ComponentLayoutOptions =
    typeof inputCountOrOptions === "number"
      ? { inputCount: inputCountOrOptions }
      : inputCountOrOptions;

  const inputCount = options.inputCount ?? 2;
  const rows = options.rows ?? 4;
  const columns = options.columns ?? 4;
  const matrixType = options.matrixType ?? "individual";
  const cellShape = options.cellShape ?? "round";
  const bitWidth = options.bitWidth ?? 1;
  const pinSide = options.pinSide;
  const color = options.color ?? "red";

  switch (type) {
    case "not": {
      const gate = createGate("not", 1, true);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "and": {
      const gate = createGate("and", inputCount, false);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "nand": {
      const gate = createGate("and", inputCount, true);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "or": {
      const gate = createGate("or", inputCount, false);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "nor": {
      const gate = createGate("or", inputCount, true);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "xor": {
      const gate = createGate("xor", inputCount, false);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "xnor": {
      const gate = createGate("xor", inputCount, true);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "triState1": {
      const gate = createGate("triState1", 2, false);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "triState2": {
      const gate = createGate("triState2", 2, false);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "clock": {
      const gate = createGate("clock", 0, false);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "led": {
      const gate = createGate("led", 1, false, color);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "sevenSegment": {
      const gate = createGate("led", 8, false, color);
      return { gridWidth: gate.symbolWidth, gridHeight: gate.symbolHeight, pins: gate.pins };
    }
    case "ledMatrix": {
      const matrix = createLedMatrix("preview-matrix", rows, columns, matrixType, cellShape, 1, 1);
      return { gridWidth: matrix.symbolWidth, gridHeight: matrix.symbolHeight, pins: matrix.pins };
    }
    case "button": {
      const button = createCircuitButton("preview-button", "", false, pinSide ?? "right");
      return { gridWidth: button.symbolWidth, gridHeight: button.symbolHeight, pins: button.pins };
    }
    case "constant": {
      const constant = createConstant("preview-constant", bitWidth, 1, pinSide ?? "right");
      return { gridWidth: constant.symbolWidth, gridHeight: constant.symbolHeight, pins: constant.pins };
    }
    case "probe": {
      const probe = createCircuitProbe("preview-probe", "", pinSide ?? "left");
      return { gridWidth: probe.symbolWidth, gridHeight: probe.symbolHeight, pins: probe.pins };
    }
    case "pin":
    case "pinIn": {
      const { internalDevicePin } = createPinCircuit(
        "preview-pin-in",
        "preview-circuit",
        "input",
        "X",
        bitWidth,
        pinSide ?? "left",
      );
      // Für SymbolRenderer-Darstellung als Ausgangspin nach rechts (speist Signal in die Schaltung ein)
      return {
        gridWidth: 2,
        gridHeight: 2,
        pins: [{ ...internalDevicePin, pinId: "out-0", pinType: "output" }],
      };
    }
    case "pinOut": {
      const { internalDevicePin } = createPinCircuit(
        "preview-pin-out",
        "preview-circuit",
        "output",
        "Q",
        bitWidth,
        pinSide ?? "right",
      );
      // Für SymbolRenderer-Darstellung als Eingangspin von links (nimmt Signal aus der Schaltung auf)
      return {
        gridWidth: 2,
        gridHeight: 2,
        pins: [{ ...internalDevicePin, pinId: "in-0", pinType: "input" }],
      };
    }
    case "splitter": {
      const pinCount = options.pinCount ?? 3;
      const pinBitWidth = options.pinBitWidth ?? 1;
      const totalBitWidth = options.bitWidth ?? pinCount * pinBitWidth;
      const clockwise = options.clockwise ?? true;
      const splitter = createSplitter("preview-splitter", totalBitWidth, pinCount, clockwise);
      return {
        gridWidth: splitter.symbolWidth,
        gridHeight: splitter.symbolHeight,
        pins: splitter.pins,
      };
    }
    case "sensor": {
      const sensor = createSensor(
        "preview-sensor",
        options.sensorType ?? "random",
        bitWidth,
        pinSide ?? "right",
      );
      return { gridWidth: sensor.symbolWidth, gridHeight: sensor.symbolHeight, pins: sensor.pins };
    }
    case "rom":
    case "ram": {
      const writable = type === "ram";
      const memory = createMemory(
        `preview-${type}`,
        writable,
        options.addressBitWidth ?? 8,
        options.dataBitWidth ?? 8,
        {
          writeOn1: writable ? (options.writeOn1 ?? false) : false,
          dualPort: options.dualPort ?? false,
        },
      );
      return { gridWidth: memory.symbolWidth, gridHeight: memory.symbolHeight, pins: memory.pins };
    }
    case "sound": {
      const sound = createSound(
        "preview-sound",
        options.pinSide ?? "left",
        "",
        "",
        options.frequency ?? SOUND_DEFAULT_FREQUENCY,
        options.waveform ?? "sine",
      );
      return { gridWidth: sound.symbolWidth, gridHeight: sound.symbolHeight, pins: sound.pins };
    }
    case "synthesizer": {
      const synthesizer = createSynthesizer(
        "preview-synthesizer",
        options.synthesizerMode ?? "square",
      );
      return { gridWidth: synthesizer.symbolWidth, gridHeight: synthesizer.symbolHeight, pins: synthesizer.pins };
    }
    case "graphicsArray": {
      const ga = createGraphicsArray("preview-graphics-array", {
        dataBitWidth: options.dataBitWidth ?? GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH,
        bitsPerPixel: options.bitsPerPixel ?? GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL,
        width: options.width ?? GRAPHICS_ARRAY_DEFAULT_WIDTH,
        height: options.height ?? GRAPHICS_ARRAY_DEFAULT_HEIGHT,
        zoom: options.zoom ?? GRAPHICS_ARRAY_DEFAULT_ZOOM,
        writeOn1: options.writeOn1 ?? false,
      });
      return { gridWidth: ga.symbolWidth, gridHeight: ga.symbolHeight, pins: ga.pins };
    }
  }
}

// Gibt den Rotationswinkel in Grad analog zu Symbol.Angle in Symbol.cs zurück
export function getRotationAngle(rotation: Rotation): number {
  switch (rotation) {
    case "up":
      return 0;
    case "right":
      return 90;
    case "down":
      return 180;
    case "left":
      return -90;
  }
}

// Berechnet das relative Rotationszentrum analog zu Symbol.RotationCenter in Symbol.cs
export function getRotationCenter(width: number, height: number): { x: number; y: number } {
  if ((width & 1) === (height & 1)) {
    return { x: 0.5, y: 0.5 };
  }
  return {
    x: Math.floor(width / 2) / width,
    y: Math.floor(height / 2) / height,
  };
}

// Berechnet den absoluten Rasterpunkt eines Pins unter Berücksichtigung der Symbol-Rotation analog zu Jam.AbsolutePoint
export function calculateJamAbsolutePoint(
  symbolX: number,
  symbolY: number,
  symbolWidth: number,
  symbolHeight: number,
  rotation: Rotation,
  pinPoint: GridPoint,
): GridPoint {
  if (rotation === "up") {
    return {
      x: symbolX + pinPoint.x,
      y: symbolY + pinPoint.y,
    };
  }

  const origin = getRotationCenter(symbolWidth, symbolHeight);
  const centerX = symbolX + symbolWidth * origin.x;
  const centerY = symbolY + symbolHeight * origin.y;

  const dx = symbolX + pinPoint.x - centerX;
  const dy = symbolY + pinPoint.y - centerY;

  let rotatedX = dx;
  let rotatedY = dy;

  switch (rotation) {
    case "right":
      rotatedX = -dy;
      rotatedY = dx;
      break;
    case "down":
      rotatedX = -dx;
      rotatedY = -dy;
      break;
    case "left":
      rotatedX = dy;
      rotatedY = -dx;
      break;
  }

  return {
    x: Math.round(centerX + rotatedX),
    y: Math.round(centerY + rotatedY),
  };
}

// Berechnet die nächste Rotationsstufe eines Bauteils (90°-Schritt)
export function getNextRotation(
  current: Rotation,
  direction: RotationDirection = "clockwise",
): Rotation {
  if (direction === "clockwise") {
    switch (current) {
      case "up":
        return "right";
      case "right":
        return "down";
      case "down":
        return "left";
      case "left":
        return "up";
    }
  }

  switch (current) {
    case "up":
      return "left";
    case "left":
      return "down";
    case "down":
      return "right";
    case "right":
      return "up";
  }
}

// Dreht ein einzelnes Symbol um sein eigenes Rotationszentrum (Position bleibt unverändert)
export function rotateSymbol(
  symbol: CircuitSymbol,
  direction: RotationDirection = "clockwise",
): CircuitSymbol {
  const nextRotation = getNextRotation(symbol.rotation, direction);
  const updatedJams = symbol.jams.map((jam) => ({
    ...jam,
    absolutePoint: calculateJamAbsolutePoint(
      symbol.x,
      symbol.y,
      symbol.circuit.symbolWidth,
      symbol.circuit.symbolHeight,
      nextRotation,
      jam.pin.gridPoint,
    ),
  }));

  return {
    ...symbol,
    rotation: nextRotation,
    jams: updatedJams,
  };
}

// Dreht eine Gruppe von Symbolen gemeinsam um ihren gemeinsamen Schwerpunkt
export function rotateSymbolsGroup(
  symbols: CircuitSymbol[],
  direction: RotationDirection = "clockwise",
): CircuitSymbol[] {
  return rotateCircuitEntities(symbols, [], direction).symbols;
}

// Dreht eine Text-Notiz um ihr eigenes Zentrum
export function rotateTextNote(
  textNote: TextNote,
  direction: RotationDirection = "clockwise",
): TextNote {
  return {
    ...textNote,
    rotation: getNextRotation(textNote.rotation, direction),
  };
}

// Ermittelt die Dimensionen einer TextNote auf dem Raster anhand der Zeilen und Zeilenhöhen
export function getTextNoteGridDimensions(textNote: TextNote): { gridWidth: number; gridHeight: number } {
  if (textNote.width && textNote.height) {
    return {
      gridWidth: Math.max(1, textNote.width),
      gridHeight: Math.max(1, textNote.height),
    };
  }

  const lines = textNote.note.split("\n");
  const defaultLh = textNote.lineHeight ?? 18;
  const totalPxHeight = lines.reduce((sum, _, idx) => {
    const lh = textNote.lineHeights?.[idx] ?? defaultLh;
    return sum + lh;
  }, 0);

  const gridHeight = Math.max(textNote.height || 1, Math.ceil(totalPxHeight / GRID_SIZE));
  const maxLineLength = Math.max(1, ...lines.map((l) => l.length));
  const estimatedPxWidth = Math.max(72, maxLineLength * 9 + 16);
  const gridWidth = Math.max(textNote.width || 4, Math.ceil(estimatedPxWidth / GRID_SIZE));

  return { gridWidth, gridHeight };
}

// Berechnet die achsenparallele Bounding-Box einer TextNote in Rasterkoordinaten
export function getTextNoteGridBoundingBox(textNote: TextNote): BoundingBox {
  const { gridWidth, gridHeight } = getTextNoteGridDimensions(textNote);

  if (textNote.rotation === "up") {
    return {
      minX: textNote.x,
      minY: textNote.y,
      maxX: textNote.x + gridWidth,
      maxY: textNote.y + gridHeight,
    };
  }

  const origin = getRotationCenter(gridWidth, gridHeight);
  const centerX = textNote.x + gridWidth * origin.x;
  const centerY = textNote.y + gridHeight * origin.y;

  const corners: GridPoint[] = [
    { x: 0, y: 0 },
    { x: gridWidth, y: 0 },
    { x: gridWidth, y: gridHeight },
    { x: 0, y: gridHeight },
  ];

  const rotatedCorners = corners.map((corner) => {
    const dx = textNote.x + corner.x - centerX;
    const dy = textNote.y + corner.y - centerY;
    let rX = dx;
    let rY = dy;
    switch (textNote.rotation) {
      case "right":
        rX = -dy;
        rY = dx;
        break;
      case "down":
        rX = -dx;
        rY = -dy;
        break;
      case "left":
        rX = dy;
        rY = -dx;
        break;
    }
    return {
      x: Math.round(centerX + rX),
      y: Math.round(centerY + rY),
    };
  });

  return {
    minX: Math.min(...rotatedCorners.map((p) => p.x)),
    minY: Math.min(...rotatedCorners.map((p) => p.y)),
    maxX: Math.max(...rotatedCorners.map((p) => p.x)),
    maxY: Math.max(...rotatedCorners.map((p) => p.y)),
  };
}

// Dreht einen Rasterpunkt um 90 Grad um ein vorgegebenes Rotationszentrum
function rotateGridPointAround(
  point: GridPoint,
  centerX: number,
  centerY: number,
  direction: RotationDirection,
): GridPoint {
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const rotatedDx = direction === "clockwise" ? -dy : dy;
  const rotatedDy = direction === "clockwise" ? dx : -dx;
  return {
    x: Math.round(centerX + rotatedDx),
    y: Math.round(centerY + rotatedDy),
  };
}

// Dreht eine beliebige Kombination aus CircuitSymbols, TextNotes und Wires gemeinsam um ihren Schwerpunkt
export function rotateCircuitEntities(
  symbols: CircuitSymbol[],
  textNotes: TextNote[],
  direction: RotationDirection = "clockwise",
  wires: Wire[] = [],
): { symbols: CircuitSymbol[]; textNotes: TextNote[]; wires: Wire[] } {
  const totalCount = symbols.length + textNotes.length;
  if (totalCount === 0 && wires.length === 0) {
    return { symbols: [], textNotes: [], wires: [] };
  }

  // Zentren aller Symbole ermitteln
  const symbolCenters = symbols.map((symbol) => {
    const origin = getRotationCenter(symbol.circuit.symbolWidth, symbol.circuit.symbolHeight);
    return {
      x: symbol.x + symbol.circuit.symbolWidth * origin.x,
      y: symbol.y + symbol.circuit.symbolHeight * origin.y,
      origin,
    };
  });

  // Zentren aller TextNotes ermitteln
  const noteCenters = textNotes.map((note) => {
    const { gridWidth, gridHeight } = getTextNoteGridDimensions(note);
    const origin = getRotationCenter(gridWidth, gridHeight);
    return {
      x: note.x + gridWidth * origin.x,
      y: note.y + gridHeight * origin.y,
      gridWidth,
      gridHeight,
      origin,
    };
  });

  if (totalCount === 1) {
    const singleCenter = symbolCenters[0] ?? noteCenters[0];
    const nextWires = wires.map((wire) => {
      const nextP1 = rotateGridPointAround(wire.point1, singleCenter.x, singleCenter.y, direction);
      const nextP2 = rotateGridPointAround(wire.point2, singleCenter.x, singleCenter.y, direction);
      return {
        ...wire,
        x1: nextP1.x,
        y1: nextP1.y,
        x2: nextP2.x,
        y2: nextP2.y,
        point1: nextP1,
        point2: nextP2,
      };
    });

    return {
      symbols: symbols.map((s) => rotateSymbol(s, direction)),
      textNotes: textNotes.map((n) => rotateTextNote(n, direction)),
      wires: nextWires,
    };
  }

  // Gemeinsamen Schwerpunkt ermitteln (falls nur Leitungen übergeben wurden, aus deren Endpunkten)
  const gridCenterX = totalCount > 0
    ? Math.round(
      (symbolCenters.reduce((acc, c) => acc + c.x, 0) +
        noteCenters.reduce((acc, c) => acc + c.x, 0)) / totalCount,
    )
    : Math.round(wires.reduce((acc, w) => acc + w.x1 + w.x2, 0) / (wires.length * 2));
  const gridCenterY = totalCount > 0
    ? Math.round(
      (symbolCenters.reduce((acc, c) => acc + c.y, 0) +
        noteCenters.reduce((acc, c) => acc + c.y, 0)) / totalCount,
    )
    : Math.round(wires.reduce((acc, w) => acc + w.y1 + w.y2, 0) / (wires.length * 2));

  // Symbole rotieren
  const nextSymbols = symbols.map((symbol, index) => {
    const { x: centerX, y: centerY, origin } = symbolCenters[index];
    const dx = centerX - gridCenterX;
    const dy = centerY - gridCenterY;

    const rotatedDx = direction === "clockwise" ? -dy : dy;
    const rotatedDy = direction === "clockwise" ? dx : -dx;

    const newCenterX = gridCenterX + rotatedDx;
    const newCenterY = gridCenterY + rotatedDy;

    const newX = Math.round(newCenterX - symbol.circuit.symbolWidth * origin.x);
    const newY = Math.round(newCenterY - symbol.circuit.symbolHeight * origin.y);
    const nextRotation = getNextRotation(symbol.rotation, direction);

    const updatedJams = symbol.jams.map((jam) => ({
      ...jam,
      absolutePoint: calculateJamAbsolutePoint(
        newX,
        newY,
        symbol.circuit.symbolWidth,
        symbol.circuit.symbolHeight,
        nextRotation,
        jam.pin.gridPoint,
      ),
    }));

    return {
      ...symbol,
      x: newX,
      y: newY,
      rotation: nextRotation,
      jams: updatedJams,
    };
  });

  // TextNotes rotieren
  const nextNotes = textNotes.map((note, index) => {
    const { x: centerX, y: centerY, gridWidth, gridHeight, origin } = noteCenters[index];
    const dx = centerX - gridCenterX;
    const dy = centerY - gridCenterY;

    const rotatedDx = direction === "clockwise" ? -dy : dy;
    const rotatedDy = direction === "clockwise" ? dx : -dx;

    const newCenterX = gridCenterX + rotatedDx;
    const newCenterY = gridCenterY + rotatedDy;

    const newX = Math.round(newCenterX - gridWidth * origin.x);
    const newY = Math.round(newCenterY - gridHeight * origin.y);
    const nextRotation = getNextRotation(note.rotation, direction);

    return {
      ...note,
      x: newX,
      y: newY,
      rotation: nextRotation,
    };
  });

  // Explizit selektierte Leitungen komplett (inkl. Knick- und Verzweigungspunkten) mitrotieren
  const nextWires = wires.map((wire) => {
    const nextP1 = rotateGridPointAround(wire.point1, gridCenterX, gridCenterY, direction);
    const nextP2 = rotateGridPointAround(wire.point2, gridCenterX, gridCenterY, direction);
    return {
      ...wire,
      x1: nextP1.x,
      y1: nextP1.y,
      x2: nextP2.x,
      y2: nextP2.y,
      point1: nextP1,
      point2: nextP2,
    };
  });

  return { symbols: nextSymbols, textNotes: nextNotes, wires: nextWires };
}

// Erzeugt eine neue Text-Notiz mit flexibler Zeilenhöhe und Schriftfamilie
export function createTextNote(
  logicalCircuitId: string,
  x: number,
  y: number,
  note = "Notiz",
  options?: {
    textNoteId?: string;
    width?: number;
    height?: number;
    rotation?: Rotation;
    lineHeight?: TextNoteLineHeight;
    fontFamily?: TextNoteFontFamily;
    lineHeights?: TextNoteLineHeight[];
  },
): TextNote {
  const textNoteId = options?.textNoteId ?? generateEntityUuid();
  const lineHeight = options?.lineHeight ?? 18;
  const fontFamily = options?.fontFamily ?? "mono";
  const lineHeights = options?.lineHeights;
  const rotation = options?.rotation ?? "up";

  const lines = note.split("\n");
  const totalPxHeight = lines.reduce((sum, _, idx) => {
    const lh = lineHeights?.[idx] ?? lineHeight;
    return sum + lh;
  }, 0);
  const autoHeight = clampGridDimension(
    Math.ceil(totalPxHeight / GRID_SIZE),
    TEXT_NOTE_MIN_GRID_SIZE,
    TEXT_NOTE_MAX_GRID_SIZE,
  );
  const maxLineLen = Math.max(1, ...lines.map((l) => l.length));
  const autoWidth = clampGridDimension(
    Math.max(4, Math.ceil((maxLineLen * 9 + 16) / GRID_SIZE)),
    TEXT_NOTE_MIN_GRID_SIZE,
    TEXT_NOTE_MAX_GRID_SIZE,
  );
  const width = options?.width !== undefined
    ? clampGridDimension(options.width, TEXT_NOTE_MIN_GRID_SIZE, TEXT_NOTE_MAX_GRID_SIZE)
    : autoWidth;
  const height = options?.height !== undefined
    ? clampGridDimension(options.height, TEXT_NOTE_MIN_GRID_SIZE, TEXT_NOTE_MAX_GRID_SIZE)
    : autoHeight;

  return {
    textNoteId,
    logicalCircuitId,
    x,
    y,
    width,
    height,
    note,
    rotation,
    lineHeight,
    fontFamily,
    lineHeights,
  };
}

// Berechnet die achsenparallele Bounding-Box eines CircuitSymbol in ganzzahligen Rasterkoordinaten
export function getSymbolGridBoundingBox(symbol: CircuitSymbol): BoundingBox {
  const width = symbol.circuit.symbolWidth;
  const height = symbol.circuit.symbolHeight;

  if (symbol.rotation === "up") {
    return {
      minX: symbol.x,
      minY: symbol.y,
      maxX: symbol.x + width,
      maxY: symbol.y + height,
    };
  }

  // Für rotierte Symbole die 4 Eckpunkte um das Rotationszentrum drehen
  const corners: GridPoint[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  const rotatedCorners = corners.map((corner) =>
    calculateJamAbsolutePoint(symbol.x, symbol.y, width, height, symbol.rotation, corner),
  );

  return {
    minX: Math.min(...rotatedCorners.map((p) => p.x)),
    minY: Math.min(...rotatedCorners.map((p) => p.y)),
    maxX: Math.max(...rotatedCorners.map((p) => p.x)),
    maxY: Math.max(...rotatedCorners.map((p) => p.y)),
  };
}

// Prüft, ob zwei Bounding-Boxes einander schneiden oder berühren
export function doBoundingBoxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// Liefert den zusätzlichen Rand in Rastereinheiten pro Seite für Display-Subschaltungen
export function getDisplayMarginOffsets(margin?: DisplayMargin): { marginX: number; marginY: number } {
  switch (margin) {
    case "horizontal":
      return { marginX: 1, marginY: 0 };
    case "vertical":
      return { marginX: 0, marginY: 1 };
    case "all":
      return { marginX: 1, marginY: 1 };
    case "none":
    default:
      return { marginX: 0, marginY: 0 };
  }
}

// Prüft zyklensicher, ob ein platziertes Symbol ein darstellbares Display-Element ist
export function isValidDisplaySymbol(
  symbol: CircuitSymbol,
  logicalCircuitsById?: ReadonlyMap<string, LogicalCircuit>,
  visitedCircuitIds: ReadonlySet<string> = new Set(),
): boolean {
  if (symbol.circuit.kind === "logicalCircuit") {
    const subLc =
      logicalCircuitsById?.get(symbol.circuit.circuitId) ??
      (symbol.circuit as LogicalCircuit);
    const isDisplayMode = subLc.circuitShape === "display" || subLc.isDisplay;
    return isDisplayMode && circuitContainsDisplays(subLc, logicalCircuitsById, visitedCircuitIds);
  }
  return Boolean(symbol.circuit.isDisplay);
}

// Prüft analog zu LogicalCircuit.ContainsDisplays(), ob eine Schaltung mindestens ein gültiges Display-Bauteil enthält
export function circuitContainsDisplays(
  circuit: LogicalCircuit,
  logicalCircuitsById?: ReadonlyMap<string, LogicalCircuit>,
  visitedCircuitIds: ReadonlySet<string> = new Set(),
): boolean {
  if (visitedCircuitIds.has(circuit.logicalCircuitId)) {
    return false;
  }
  const nextVisited = new Set(visitedCircuitIds);
  nextVisited.add(circuit.logicalCircuitId);
  return circuit.circuitSymbols.some((sym) =>
    isValidDisplaySymbol(sym, logicalCircuitsById, nextVisited),
  );
}

// Prüft rekursiv und zyklussicher, ob eine Schaltung direkt oder in Subschaltungen Audio-Bausteine enthält
export function circuitContainsAudio(
  circuit: LogicalCircuit,
  logicalCircuitsById?: ReadonlyMap<string, LogicalCircuit>,
  visitedCircuitIds: ReadonlySet<string> = new Set(),
): boolean {
  if (visitedCircuitIds.has(circuit.logicalCircuitId)) {
    return false;
  }
  const nextVisited = new Set(visitedCircuitIds);
  nextVisited.add(circuit.logicalCircuitId);

  return circuit.circuitSymbols.some((sym) => {
    if (sym.circuit.kind === "sound" || sym.circuit.kind === "synthesizer") {
      return true;
    }
    if (sym.circuit.kind === "logicalCircuit") {
      const subCircuit =
        logicalCircuitsById?.get(sym.circuit.circuitId) ??
        (sym.circuit as LogicalCircuit);
      return circuitContainsAudio(subCircuit, logicalCircuitsById, nextVisited);
    }
    return false;
  });
}

// Liefert alle in einer Schaltung enthaltenen gültigen Display-Symbole (mit aktualisierter SubCircuit-Referenz)
export function getCircuitDisplaySymbols(
  circuit: LogicalCircuit,
  logicalCircuitsById?: ReadonlyMap<string, LogicalCircuit>,
): CircuitSymbol[] {
  if (!circuitContainsDisplays(circuit, logicalCircuitsById)) {
    return [];
  }
  return circuit.circuitSymbols
    .filter((sym) => isValidDisplaySymbol(sym, logicalCircuitsById))
    .map((sym) => {
      if (sym.circuit.kind === "logicalCircuit" && logicalCircuitsById) {
        const updatedSub = logicalCircuitsById.get(sym.circuit.circuitId);
        if (updatedSub) {
          return { ...sym, circuit: updatedSub };
        }
      }
      return sym;
    });
}

// Berechnet die gemeinsame Raster-Bounding-Box aller Display-Symbole einer Schaltung analog zu LogicalCircuit.DisplayBounds()
export function getCircuitDisplayBounds(
  circuit: LogicalCircuit,
  logicalCircuitsById?: ReadonlyMap<string, LogicalCircuit>,
): BoundingBox | null {
  const displaySymbols = getCircuitDisplaySymbols(circuit, logicalCircuitsById);
  if (displaySymbols.length === 0) {
    return null;
  }
  const boxes = displaySymbols.map((sym) => getSymbolGridBoundingBox(sym));
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

// Erzeugt ein CircuitSymbol mit allen berechneten Jams analog zu CircuitSymbolSet.Create und CircuitGlyph.Update
export function createCircuitSymbol(
  circuit: Circuit,
  logicalCircuitId: string,
  x: number,
  y: number,
  rotation: Rotation = "up",
  circuitSymbolId = `sym-${circuit.circuitId}-${x}-${y}`,
  innerPinSymbolsByPinId?: Map<string, CircuitSymbol>,
): CircuitSymbol {
  const jams: Jam[] = circuit.pins.map((pin) => {
    const isSubCircuitPin = (pin as Partial<Pin>).kind === "pin";
    const effectivePinType: PinType = isSubCircuitPin ? "none" : pin.pinType;
    const absolutePoint = calculateJamAbsolutePoint(
      x,
      y,
      circuit.symbolWidth,
      circuit.symbolHeight,
      rotation,
      pin.gridPoint,
    );

    let innerJam: Jam | undefined;
    if (isSubCircuitPin) {
      const innerSymbol = innerPinSymbolsByPinId?.get(pin.pinId);
      innerJam = innerSymbol?.jams[0];
      if (!innerJam && (circuit as LogicalCircuit).circuitSymbols) {
        const innerSym = (circuit as LogicalCircuit).circuitSymbols.find(
          (s) =>
            s.circuitId === pin.pinId ||
            s.circuit.circuitId === pin.pinId ||
            (s.circuit.kind === "pin" && s.circuit.name === pin.name),
        );
        innerJam = innerSym?.jams[0];
      }
    }

    return {
      pin,
      circuitSymbolId,
      x: pin.gridPoint.x,
      y: pin.gridPoint.y,
      z: pin.inverted ? 2 : 0,
      effectivePinType,
      absolutePoint,
      innerJam,
    };
  });

  return {
    circuitSymbolId,
    circuitId: circuit.circuitId,
    logicalCircuitId,
    x,
    y,
    rotation,
    circuit,
    jams,
  };
}

// Berechnet die ConductorMap (elektrische Leitungsnetze und Lötpunkte) aus den Wire-Segmenten analog zu ConductorMap.cs
export function buildConductorMap(wires: Wire[], junctionMinCount = 3): ConductorMap {
  const byPointKey = new Map<string, Conductor>();
  const conductorSet = new Set<Conductor>();

  const parseKeyToPoint = (key: string): GridPoint => {
    const [xStr, yStr] = key.split(",");
    return { x: Number(xStr), y: Number(yStr) };
  };

  const addWireToConductor = (conductor: Conductor, wire: Wire) => {
    if (!conductor.wires.includes(wire)) {
      conductor.wires.push(wire);
      for (const pt of [wire.point1, wire.point2]) {
        const key = gridPointKey(pt);
        const current = conductor.pointCounts.get(key) ?? 0;
        if (current === 0) {
          conductor.points.push(pt);
        }
        conductor.pointCounts.set(key, current + 1);
      }
    }
  };

  const joinConductors = (target: Conductor, other: Conductor): Conductor => {
    for (const wire of other.wires) {
      addWireToConductor(target, wire);
      byPointKey.set(gridPointKey(wire.point1), target);
      byPointKey.set(gridPointKey(wire.point2), target);
    }
    conductorSet.delete(other);
    return target;
  };

  for (const wire of wires) {
    const key1 = gridPointKey(wire.point1);
    const key2 = gridPointKey(wire.point2);
    if (key1 === key2) {
      continue;
    }

    let conductor = byPointKey.get(key1);
    const other = byPointKey.get(key2);

    if (conductor) {
      if (!other) {
        byPointKey.set(key2, conductor);
      } else if (conductor !== other) {
        conductor = joinConductors(conductor, other);
      }
    } else if (other) {
      conductor = other;
      byPointKey.set(key1, conductor);
    } else {
      conductor = {
        wires: [],
        points: [],
        pointCounts: new Map<string, number>(),
        junctionPoints: [],
      };
      byPointKey.set(key1, conductor);
      byPointKey.set(key2, conductor);
      conductorSet.add(conductor);
    }

    addWireToConductor(conductor, wire);
  }

  const conductors = Array.from(conductorSet);
  const allJunctions: GridPoint[] = [];

  for (const conductor of conductors) {
    conductor.junctionPoints = [];
    for (const [key, count] of conductor.pointCounts.entries()) {
      if (count >= junctionMinCount) {
        const pt = parseKeyToPoint(key);
        conductor.junctionPoints.push(pt);
        allJunctions.push(pt);
      }
    }
  }

  return {
    conductors,
    byPointKey,
    junctionPoints: allJunctions,
  };
}

// Erzeugt ein Standard-LogicalCircuit-Objekt analog zu LogicalCircuitSet.Create in LogicalCircuit.cs
export function createDefaultLogicalCircuit(
  logicalCircuitId: string,
  name: string,
  category = "",
  note = "",
): LogicalCircuit {
  return {
    kind: "logicalCircuit",
    circuitId: logicalCircuitId,
    logicalCircuitId,
    name,
    notation: name,
    note,
    category,
    isDisplay: false,
    circuitShape: "rectangular",
    validators: "",
    exportToHDL: true,
    symbolWidth: 3,
    symbolHeight: 4,
    pins: [],
    logicalPins: [],
    circuitSymbols: [],
    wires: [],
    textNotes: [],
    conductorMap: buildConductorMap([]),
  };
}

// Erzeugt ein leeres CircuitProject analog zu Schema/Empty.xml und CircuitProject.Create
export function createEmptyCircuitProject(
  projectName = "Circuit Project",
  mainCircuitName = "Main",
  mainCircuitId = "main-circuit",
  projectId = "default-project",
): CircuitProject {
  const mainCircuit = createDefaultLogicalCircuit(mainCircuitId, mainCircuitName);

  const project: Project = {
    projectId,
    name: projectName,
    note: "",
    zoom: 1.0,
    frequency: 10,
    isMaximumSpeed: false,
    logicalCircuitId: mainCircuitId,
    startupCircuitId: undefined,
    categoryTextNoteCollapsed: false,
    categoryInputOutputCollapsed: false,
    categoryPrimitivesCollapsed: false,
  };

  const circuits = new Map<string, Circuit>();
  circuits.set(mainCircuit.circuitId, mainCircuit);

  return {
    project,
    collapsedCategories: [],
    circuits,
    logicalCircuits: [mainCircuit],
    gates: new Map<string, Gate>(),
    pins: [],
    devicePins: [],
    constants: [],
    circuitButtons: [],
    circuitProbes: [],
    splitters: [],
    memories: [],
    ledMatrices: [],
    sensors: [],
    sounds: [],
    synthesizers: [],
    graphicsArrays: [],
    circuitSymbols: [],
    wires: [],
    textNotes: [],
  };
}

// Prüft rekursiv, ob eine Quellschaltung direkt oder transitiv die angegebene Zielschaltung enthält
export function circuitContainsSubCircuit(
  sourceCircuit: LogicalCircuit,
  targetCircuitId: string,
  project: CircuitProject,
  visited: Set<string> = new Set(),
): boolean {
  if (sourceCircuit.logicalCircuitId === targetCircuitId) {
    return true;
  }
  if (visited.has(sourceCircuit.logicalCircuitId)) {
    return false;
  }
  visited.add(sourceCircuit.logicalCircuitId);

  for (const symbol of sourceCircuit.circuitSymbols) {
    if (symbol.circuit.kind === "logicalCircuit") {
      const subCircuitId = (symbol.circuit as LogicalCircuit).logicalCircuitId;
      if (subCircuitId === targetCircuitId) {
        return true;
      }
      const subCircuit = project.logicalCircuits.find((lc) => lc.logicalCircuitId === subCircuitId);
      if (subCircuit && circuitContainsSubCircuit(subCircuit, targetCircuitId, project, visited)) {
        return true;
      }
    }
  }

  return false;
}

// Prüft, ob das Platzieren einer Subschaltung in eine Zielschaltung einen unzulässigen Kreisbezug erzeugen würde
export function wouldCreateCircuitCycle(
  targetCircuitId: string,
  candidateCircuitId: string,
  project: CircuitProject,
): boolean {
  // Eine Schaltung darf sich niemals selbst enthalten
  if (targetCircuitId === candidateCircuitId) {
    return true;
  }

  const candidateCircuit = project.logicalCircuits.find(
    (lc) => lc.logicalCircuitId === candidateCircuitId,
  );
  if (!candidateCircuit) {
    return false;
  }

  // Ein Zyklus liegt vor, wenn die zu platzierende Schaltung die Zielschaltung bereits transitiv enthält
  return circuitContainsSubCircuit(candidateCircuit, targetCircuitId, project);
}

// Erzeugt oder ermittelt das passende Circuit-Objekt und platziert ein CircuitSymbol analog zu C# CircuitSymbolSet.Create
export function instantiateCircuitFromPalette(
  project: CircuitProject,
  logicalCircuitId: string,
  selection: PaletteSelection,
  gridPoint: GridPoint,
): { circuit: Circuit; circuitSymbol: CircuitSymbol } {
  let circuit: Circuit;

  if (selection.type === "subCircuit") {
    if (selection.subCircuitId && wouldCreateCircuitCycle(logicalCircuitId, selection.subCircuitId, project)) {
      throw new Error(
        `Zyklus erkannt: Schaltung "${selection.name || selection.subCircuitId}" kann nicht in Schaltung "${logicalCircuitId}" platziert werden.`,
      );
    }
    const subCircuit = project.logicalCircuits.find(
      (c) => c.logicalCircuitId === selection.subCircuitId,
    );
    if (subCircuit) {
      const symbolCoords = new Map<string, GridPoint>();
      for (const sym of subCircuit.circuitSymbols) {
        if (sym.circuit.kind === "pin") {
          symbolCoords.set(sym.circuit.circuitId, { x: sym.x, y: sym.y });
        }
      }
      const circuitPins = project.pins.filter((p) => p.circuitId === subCircuit.logicalCircuitId);
      const allPins = [...circuitPins];
      for (const p of subCircuit.logicalPins) {
        if (!allPins.some((cp) => cp.pinId === p.pinId)) {
          allPins.push(p);
        }
      }
      const logicalCircuitsById = new Map(
        project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
      );
      const { minWidth, minHeight } = getLogicalCircuitMinDimensions(
        subCircuit,
        logicalCircuitsById,
      );
      const layout = calculateCircuitDimensionsAndPins(allPins, minWidth, minHeight, symbolCoords);
      subCircuit.symbolWidth = layout.gridWidth;
      subCircuit.symbolHeight = layout.gridHeight;
      subCircuit.pins = layout.pins;
      subCircuit.logicalPins = allPins;
      circuit = subCircuit;
    } else {
      circuit = createDefaultLogicalCircuit(selection.subCircuitId ?? "sub-circuit", selection.name);
    }
    if (!project.circuits.has(circuit.circuitId)) {
      project.circuits.set(circuit.circuitId, circuit);
    }
  } else if (selection.type === "not") {
    const gate = createGate("not", 1, true);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "and") {
    const gate = createGate("and", selection.inputCount ?? 2, false);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "nand") {
    const gate = createGate("and", selection.inputCount ?? 2, true);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "or") {
    const gate = createGate("or", selection.inputCount ?? 2, false);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "nor") {
    const gate = createGate("or", selection.inputCount ?? 2, true);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "xor") {
    const gate = createGate("xor", selection.inputCount ?? 2, false);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "xnor") {
    const gate = createGate("xor", selection.inputCount ?? 2, true);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "triState1") {
    const gate = createGate("triState1", 2, false);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "triState2") {
    const gate = createGate("triState2", 2, false);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "clock") {
    const gate = createGate("clock", 0, false);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "led") {
    const color = selection.color ?? "red";
    const gate = createGate("led", 1, false, color);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "sevenSegment") {
    const color = selection.color ?? "red";
    const gate = createGate("led", 8, false, color);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  } else if (selection.type === "ledMatrix") {
    const matrixId = generateEntityUuid();
    const matrix = createLedMatrix(
      matrixId,
      selection.rows ?? 4,
      selection.columns ?? 4,
      selection.matrixType ?? "individual",
      selection.cellShape ?? "round",
      selection.colors ?? 1,
      selection.persistenceMultiplier ?? 1,
    );
    if (selection.note !== undefined) {
      matrix.note = selection.note;
    }
    circuit = matrix;
    project.ledMatrices.push(matrix);
    project.circuits.set(matrix.circuitId, matrix);
  } else if (selection.type === "button") {
    const btnId = generateEntityUuid();
    const notation = selection.notation !== undefined
      ? selection.notation
      : (selection.name && selection.name !== "Taster / Schalter" ? selection.name : "");
    const isToggle = selection.isToggle ?? false;
    const btn = createCircuitButton(
      btnId,
      notation,
      isToggle,
      selection.pinSide ?? "right",
      selection.inverted ?? false,
      selection.width ?? BUTTON_MIN_GRID_SIZE,
      selection.height ?? BUTTON_MIN_GRID_SIZE,
    );
    btn.name = notation || selection.name || (isToggle ? "Schalter" : "Taster");
    if (selection.keyCode !== undefined) {
      btn.keyCode = selection.keyCode;
    }
    if (selection.modifiers !== undefined) {
      btn.modifiers = selection.modifiers;
    }
    if (selection.note !== undefined) {
      btn.note = selection.note;
    }
    circuit = btn;
    project.circuitButtons.push(btn);
    project.circuits.set(btn.circuitId, btn);
  } else if (selection.type === "constant") {
    const constId = generateEntityUuid();
    const isHex = selection.isHex !== undefined ? selection.isHex : true;
    const constant = createConstant(
      constId,
      selection.bitWidth ?? 1,
      selection.value ?? 1,
      selection.pinSide ?? "right",
      isHex,
      selection.width ?? RESIZABLE_SYMBOL_MIN_GRID_SIZE,
      selection.height ?? RESIZABLE_SYMBOL_MIN_GRID_SIZE,
    );
    if (selection.note !== undefined) {
      constant.note = selection.note;
    }
    circuit = constant;
    project.constants.push(constant);
    project.circuits.set(constant.circuitId, constant);
  } else if (selection.type === "probe") {
    const probeId = generateEntityUuid();
    const probeName = selection.notation !== undefined
      ? selection.notation.trim()
      : (selection.name && selection.name !== "Signal-Sonde (Probe)" ? selection.name : "");
    const displayFormat = selection.displayFormat;
    const isHex = selection.isHex ?? (displayFormat === "hex");
    const probe = createCircuitProbe(
      probeId,
      probeName,
      selection.pinSide ?? "left",
      selection.width ?? RESIZABLE_SYMBOL_MIN_GRID_SIZE,
      selection.height ?? RESIZABLE_SYMBOL_MIN_GRID_SIZE,
      isHex,
    );
    if (displayFormat !== undefined) {
      probe.displayFormat = displayFormat;
    }
    if (selection.note !== undefined) {
      probe.note = selection.note;
    }
    circuit = probe;
    project.circuitProbes.push(probe);
    project.circuits.set(probe.circuitId, probe);
  } else if (selection.type === "pinIn" || selection.type === "pin") {
    const pinId = generateEntityUuid();
    const targetLc = project.logicalCircuits.find((lc) => lc.logicalCircuitId === logicalCircuitId);
    const existingPins = [
      ...project.pins.filter((p) => p.circuitId === logicalCircuitId),
      ...(targetLc ? targetLc.logicalPins : []),
    ];
    const rawPinName = selection.notation !== undefined && selection.notation.trim() !== ""
      ? selection.notation.trim()
      : (selection.name && selection.name !== "Pin (Eingang)" ? selection.name : "X");
    const pinName = generateUniquePinName(rawPinName, existingPins);
    const resolvedJamNotation = selection.jamNotation !== undefined
      ? selection.jamNotation
      : (selection.notation !== undefined && selection.notation.trim() === "" ? "" : pinName);
    const { pin, pinCircuit } = createPinCircuit(
      pinId,
      logicalCircuitId,
      "input",
      pinName,
      selection.bitWidth ?? 1,
      selection.pinSide ?? "left",
      selection.inverted ?? false,
      0,
      selection.width ?? RESIZABLE_SYMBOL_MIN_GRID_SIZE,
      selection.height ?? RESIZABLE_SYMBOL_MIN_GRID_SIZE,
      resolvedJamNotation,
    );
    if (selection.note !== undefined) {
      pin.note = selection.note;
      pinCircuit.note = selection.note;
    }
    circuit = pinCircuit;
    project.pins.push(pin);
    if (targetLc && !targetLc.logicalPins.some((p) => p.pinId === pin.pinId)) {
      targetLc.logicalPins.push(pin);
    }
    project.circuits.set(pinCircuit.circuitId, pinCircuit);
  } else if (selection.type === "pinOut") {
    const pinId = generateEntityUuid();
    const targetLc = project.logicalCircuits.find((lc) => lc.logicalCircuitId === logicalCircuitId);
    const existingPins = [
      ...project.pins.filter((p) => p.circuitId === logicalCircuitId),
      ...(targetLc ? targetLc.logicalPins : []),
    ];
    const rawPinName = selection.notation !== undefined && selection.notation.trim() !== ""
      ? selection.notation.trim()
      : (selection.name && selection.name !== "Pin (Ausgang)" ? selection.name : "Q");
    const pinName = generateUniquePinName(rawPinName, existingPins);
    const resolvedJamNotation = selection.jamNotation !== undefined
      ? selection.jamNotation
      : (selection.notation !== undefined && selection.notation.trim() === "" ? "" : pinName);
    const { pin, pinCircuit } = createPinCircuit(
      pinId,
      logicalCircuitId,
      "output",
      pinName,
      selection.bitWidth ?? 1,
      selection.pinSide ?? "right",
      selection.inverted ?? false,
      0,
      selection.width ?? RESIZABLE_SYMBOL_MIN_GRID_SIZE,
      selection.height ?? RESIZABLE_SYMBOL_MIN_GRID_SIZE,
      resolvedJamNotation,
    );
    if (selection.note !== undefined) {
      pin.note = selection.note;
      pinCircuit.note = selection.note;
    }
    circuit = pinCircuit;
    project.pins.push(pin);
    if (targetLc && !targetLc.logicalPins.some((p) => p.pinId === pin.pinId)) {
      targetLc.logicalPins.push(pin);
    }
    project.circuits.set(pinCircuit.circuitId, pinCircuit);
  } else if (selection.type === "splitter") {
    const splitterId = generateEntityUuid();
    const pinCount = selection.pinCount ?? 3;
    const pinBitWidth = selection.pinBitWidth ?? 1;
    const totalBitWidth = selection.bitWidth ?? pinCount * pinBitWidth;
    const clockwise = selection.clockwise ?? true;
    const splitter = createSplitter(splitterId, totalBitWidth, pinCount, clockwise);
    if (selection.note !== undefined) {
      splitter.note = selection.note;
    }
    circuit = splitter;
    project.splitters.push(splitter);
    project.circuits.set(splitter.circuitId, splitter);
  } else if (selection.type === "sensor") {
    const sensorId = generateEntityUuid();
    const sensor = createSensor(
      sensorId,
      selection.sensorType ?? "random",
      selection.bitWidth ?? 1,
      selection.pinSide ?? "right",
      selection.notation ?? "",
      selection.data ?? "",
      selection.note ?? "",
    );
    circuit = sensor;
    project.sensors.push(sensor);
    project.circuits.set(sensor.circuitId, sensor);
  } else if (selection.type === "rom" || selection.type === "ram") {
    const memoryId = generateEntityUuid();
    const writable = selection.type === "ram";
    const memory = createMemory(
      memoryId,
      writable,
      selection.addressBitWidth ?? 8,
      selection.dataBitWidth ?? 8,
      {
        writeOn1: writable ? (selection.writeOn1 ?? false) : false,
        onStart: writable ? (selection.onStart ?? "random") : "random",
        dualPort: selection.dualPort ?? false,
        data: selection.data ?? "",
        note: selection.note ?? "",
      },
    );
    circuit = memory;
    project.memories.push(memory);
    project.circuits.set(memory.circuitId, memory);
  } else if (selection.type === "sound") {
    const soundId = generateEntityUuid();
    const sound = createSound(
      soundId,
      selection.pinSide ?? "left",
      selection.notation ?? "",
      selection.note ?? "",
      selection.frequency ?? SOUND_DEFAULT_FREQUENCY,
      selection.waveform ?? "sine",
    );
    circuit = sound;
    project.sounds.push(sound);
    project.circuits.set(sound.circuitId, sound);
  } else if (selection.type === "synthesizer") {
    const synthesizerId = generateEntityUuid();
    const synthesizer = createSynthesizer(
      synthesizerId,
      selection.synthesizerMode ?? "square",
      selection.notation ?? "",
      selection.note ?? "",
    );
    circuit = synthesizer;
    project.synthesizers.push(synthesizer);
    project.circuits.set(synthesizer.circuitId, synthesizer);
  } else if (selection.type === "graphicsArray") {
    const graphicsArrayId = generateEntityUuid();
    const ga = createGraphicsArray(graphicsArrayId, {
      writeOn1: selection.writeOn1,
      onStart: selection.onStart,
      dataBitWidth: selection.dataBitWidth,
      bitsPerPixel: selection.bitsPerPixel,
      width: selection.width,
      height: selection.height,
      zoom: selection.zoom,
      note: selection.note,
    });
    circuit = ga;
    project.graphicsArrays.push(ga);
    project.circuits.set(ga.circuitId, ga);
  } else {
    const gate = createGate("and", 2, false);
    circuit = project.gates.get(gate.circuitId) ?? gate;
    project.gates.set(circuit.circuitId, circuit as Gate);
    project.circuits.set(circuit.circuitId, circuit);
  }

  if (circuit.kind === "gate" && selection.note !== undefined && selection.note !== "") {
    circuit = { ...circuit, note: selection.note };
  }

  const symbolId = generateEntityUuid();
  const circuitSymbol = createCircuitSymbol(
    circuit,
    logicalCircuitId,
    gridPoint.x,
    gridPoint.y,
    selection.rotation ?? "up",
    symbolId,
  );

  return { circuit, circuitSymbol };
}

// Berechnet Mindestbreite und -höhe einer Subschaltung analog zu LogicalCircuit.CircuitSymbolWidth/Height
export function getLogicalCircuitMinDimensions(
  circuit: LogicalCircuit,
  logicalCircuitsById?: ReadonlyMap<string, LogicalCircuit>,
): { minWidth: number; minHeight: number } {
  const isDisplayShape = circuit.circuitShape === "display" || circuit.isDisplay;
  if (isDisplayShape) {
    const displayBounds = getCircuitDisplayBounds(circuit, logicalCircuitsById);
    if (displayBounds) {
      const { marginX, marginY } = getDisplayMarginOffsets(circuit.displayMargin);
      const displayGridWidth = (displayBounds.maxX - displayBounds.minX) + 2 * marginX;
      const displayGridHeight = (displayBounds.maxY - displayBounds.minY) + 2 * marginY;
      return {
        minWidth: Math.max(2, displayGridWidth),
        minHeight: Math.max(2, displayGridHeight),
      };
    }
  }
  return { minWidth: 3, minHeight: 4 };
}

// Synchronisiert Pins, Dimensionen und platzierte Instanzen aller LogicalCircuits analog zu LogicalCircuit.ResetPins()
export function syncProjectLogicalCircuits(project: CircuitProject): CircuitProject {
  const circuitsMap = new Map(project.circuits);
  const logicalCircuitsMap = new Map<string, LogicalCircuit>();

  for (const lc of project.logicalCircuits) {
    logicalCircuitsMap.set(lc.logicalCircuitId, lc);
  }

  // Abmessungen und Pins für jede Schaltung iterativ anhand der enthaltenen Pins und Display-Bounds aktualisieren
  const maxPasses = Math.max(1, project.logicalCircuits.length);
  for (let pass = 0; pass < maxPasses; pass++) {
    let anyDimensionChanged = false;

    for (const lc of project.logicalCircuits) {
      const currentLc = logicalCircuitsMap.get(lc.logicalCircuitId) ?? lc;
      const circuitPins = project.pins.filter((p) => p.circuitId === currentLc.logicalCircuitId);
      const pinMap = new Map<string, Pin>();
      for (const p of circuitPins) {
        pinMap.set(p.pinId, p);
      }
      for (const p of currentLc.logicalPins) {
        if (!pinMap.has(p.pinId)) {
          pinMap.set(p.pinId, p);
        }
      }
      const allPins = Array.from(pinMap.values());

      const symbolCoords = new Map<string, GridPoint>();
      const updatedChildSymbols = currentLc.circuitSymbols.map((sym) => {
        if (sym.circuit.kind === "pin") {
          symbolCoords.set(sym.circuit.circuitId, { x: sym.x, y: sym.y });
          return sym;
        }
        if (sym.circuit.kind === "logicalCircuit") {
          const targetId = (sym.circuit as LogicalCircuit).logicalCircuitId ?? sym.circuitId;
          const updatedSub = logicalCircuitsMap.get(targetId);
          if (updatedSub && updatedSub !== sym.circuit) {
            return { ...sym, circuit: updatedSub };
          }
        }
        return sym;
      });

      const lcWithUpdatedRefs: LogicalCircuit = {
        ...currentLc,
        circuitSymbols: updatedChildSymbols,
      };

      const { minWidth, minHeight } = getLogicalCircuitMinDimensions(
        lcWithUpdatedRefs,
        logicalCircuitsMap,
      );

      const layout = calculateCircuitDimensionsAndPins(allPins, minWidth, minHeight, symbolCoords);

      if (
        layout.gridWidth !== currentLc.symbolWidth ||
        layout.gridHeight !== currentLc.symbolHeight
      ) {
        anyDimensionChanged = true;
      }

      const updatedLc: LogicalCircuit = {
        ...currentLc,
        symbolWidth: layout.gridWidth,
        symbolHeight: layout.gridHeight,
        pins: layout.pins,
        logicalPins: allPins,
      };
      logicalCircuitsMap.set(currentLc.logicalCircuitId, updatedLc);
      circuitsMap.set(currentLc.logicalCircuitId, updatedLc);
    }

    if (!anyDimensionChanged) {
      break;
    }
  }

  // Platziertes Symbol einer Sub-Schaltung mit den neu berechneten Pins und Jams aktualisieren
  const updateSubCircuitSymbol = (sym: CircuitSymbol): CircuitSymbol => {
    if (sym.circuit.kind !== "logicalCircuit") {
      return sym;
    }
    const targetId = (sym.circuit as LogicalCircuit).logicalCircuitId ?? sym.circuitId;
    const subCircuit = logicalCircuitsMap.get(targetId);
    if (!subCircuit) {
      return sym;
    }

    const innerPinSymbolsByPinId = new Map<string, CircuitSymbol>();
    for (const s of subCircuit.circuitSymbols) {
      if (s.circuit.kind === "pin") {
        innerPinSymbolsByPinId.set(s.circuit.circuitId, s);
      }
    }

    const updatedJams: Jam[] = subCircuit.pins.map((pin) => {
      const isSubCircuitPin = (pin as Partial<Pin>).kind === "pin";
      const effectivePinType: PinType = isSubCircuitPin ? "none" : pin.pinType;
      const absolutePoint = calculateJamAbsolutePoint(
        sym.x,
        sym.y,
        subCircuit.symbolWidth,
        subCircuit.symbolHeight,
        sym.rotation,
        pin.gridPoint,
      );
      const innerSymbol = innerPinSymbolsByPinId.get(pin.pinId);
      const innerJam = innerSymbol?.jams[0];

      return {
        pin,
        circuitSymbolId: sym.circuitSymbolId,
        x: pin.gridPoint.x,
        y: pin.gridPoint.y,
        z: pin.inverted ? 2 : 0,
        effectivePinType,
        absolutePoint,
        innerJam,
      };
    });

    return {
      ...sym,
      circuit: subCircuit,
      jams: updatedJams,
    };
  };

  for (const updatedLc of logicalCircuitsMap.values()) {
    updatedLc.circuitSymbols = updatedLc.circuitSymbols.map(updateSubCircuitSymbol);
  }

  const updatedLogicalCircuits = project.logicalCircuits.map(
    (lc) => logicalCircuitsMap.get(lc.logicalCircuitId) ?? lc,
  );

  const updatedProjectSymbols = project.circuitSymbols.map(updateSubCircuitSymbol);

  return {
    ...project,
    circuits: circuitsMap,
    logicalCircuits: updatedLogicalCircuits,
    circuitSymbols: updatedProjectSymbols,
  };
}

// Baut nach dem XML-Import alle abgeleiteten Layouts, DevicePins, Jams und ConductorMaps konsistent neu auf
export function rebuildImportedProjectLayout(project: CircuitProject): CircuitProject {
  const circuitsMap = new Map(project.circuits);
  const gatesMap = new Map(project.gates);
  const devicePins: DevicePin[] = [];

  for (const gate of gatesMap.values()) {
    circuitsMap.set(gate.circuitId, gate);
  }
  for (const lc of project.logicalCircuits) {
    circuitsMap.set(lc.circuitId, lc);
  }
  for (const circuit of circuitsMap.values()) {
    for (const pin of circuit.pins) {
      if ((pin as Partial<DevicePin>).kind === "devicePin") {
        devicePins.push(pin as DevicePin);
      }
    }
  }

  const synced = syncProjectLogicalCircuits({
    ...project,
    circuits: circuitsMap,
    gates: gatesMap,
    devicePins,
  });

  const updatedLogicalCircuits = synced.logicalCircuits.map((lc) => ({
    ...lc,
    conductorMap: buildConductorMap(lc.wires, 3),
  }));

  return {
    ...synced,
    logicalCircuits: updatedLogicalCircuits,
  };
}

// Erzeugt ein voll ausgestattetes Demo-Projekt mit Beispielen analog zum C#-Referenzprogramm
export function createDemoCircuitProject(): CircuitProject {
  const project = createEmptyCircuitProject(
    "Schaltungs-Projekt",
    "Haupt-Schaltung",
    "e5740eb6-ace6-4379-af8f-e0829efd76d7",
    "abd89a50-0165-41a9-a47f-fadf22479b7d",
  );
  const mainCircuit = project.logicalCircuits[0];

  const subPower = createDefaultLogicalCircuit("sub-power", "Power", "Helpers");
  const sub7Seg = createDefaultLogicalCircuit("sub-7seg-4bit", "7 Segment 04 Bit", "LED");
  project.logicalCircuits.push(subPower, sub7Seg);
  project.circuits.set(subPower.circuitId, subPower);
  project.circuits.set(sub7Seg.circuitId, sub7Seg);

  // Gates für Haupt-Schaltung registrieren
  const andGate = createGate("and", 2, false);
  andGate.circuitId = "00000000-0000-0000-0000-000000040200";
  andGate.gateId = "00000000-0000-0000-0000-000000040200";
  project.gates.set(andGate.circuitId, andGate);
  project.circuits.set(andGate.circuitId, andGate);

  const orGate = createGate("or", 2, false);
  orGate.circuitId = "00000000-0000-0000-0000-000000030200";
  orGate.gateId = "00000000-0000-0000-0000-000000030200";
  project.gates.set(orGate.circuitId, orGate);
  project.circuits.set(orGate.circuitId, orGate);

  const xorGate = createGate("xor", 2, false);
  xorGate.circuitId = "00000000-0000-0000-0000-000000050200";
  xorGate.gateId = "00000000-0000-0000-0000-000000050200";
  project.gates.set(xorGate.circuitId, xorGate);
  project.circuits.set(xorGate.circuitId, xorGate);

  const triState2Gate = createGate("triState2", 2, false);
  triState2Gate.circuitId = "00000000-0000-0000-0000-0000000b0200";
  triState2Gate.gateId = "00000000-0000-0000-0000-0000000b0200";
  project.gates.set(triState2Gate.circuitId, triState2Gate);
  project.circuits.set(triState2Gate.circuitId, triState2Gate);

  const ledGate = createGate("led", 1, false, "red");
  ledGate.circuitId = "00000000-0000-0000-0000-000000080100";
  ledGate.gateId = "00000000-0000-0000-0000-000000080100";
  project.gates.set(ledGate.circuitId, ledGate);
  project.circuits.set(ledGate.circuitId, ledGate);
  project.gates.set("00000000-0000-0000-0000-000000080100-red", ledGate);
  project.circuits.set("00000000-0000-0000-0000-000000080100-red", ledGate);

  // Buttons für Haupt-Schaltung
  const buttonDefs = [
    { id: "191c70b1-522b-46d2-b125-167f7f1d257b", notation: "B", isToggle: true },
    { id: "1f8c9136-e87c-4922-b5f7-57c129ef1537", notation: "B", isToggle: true },
    { id: "348dfaa5-19ba-4460-842e-43900abd6b06", notation: "A", isToggle: true },
    { id: "7b5bb0ae-c845-438f-b817-cf11cc5e0ffb", notation: "A", isToggle: true },
    { id: "5d899dbd-97cf-410f-a19b-c1daa46d04d7", notation: "A", isToggle: true },
    { id: "438acc15-23a5-4f5a-84bb-f2480d631ca0", notation: "B", isToggle: true },
    { id: "27f8a467-8b92-4557-b204-7215f5822981", notation: "A", isToggle: true },
    { id: "1706e68f-f15e-4d0a-9f19-5f2368e25625", notation: "B", isToggle: true },
  ];

  for (const b of buttonDefs) {
    const btn = createCircuitButton(b.id, b.notation, b.isToggle);
    project.circuitButtons.push(btn);
    project.circuits.set(btn.circuitId, btn);
  }

  // Symbole für Haupt-Schaltung
  const symbolDefs = [
    { symbolId: "21845777-e44f-408f-8998-3f01ed2d54b4", circuitId: "00000000-0000-0000-0000-000000040200", x: 6, y: 3 },
    { symbolId: "bc721228-4ae3-4ba6-8f9e-2bd2e3a38258", circuitId: "00000000-0000-0000-0000-000000080100", x: 11, y: 4 },
    { symbolId: "3920260a-9c95-45e5-baf1-f3263a6b521a", circuitId: "00000000-0000-0000-0000-000000080100", x: 11, y: 9 },
    { symbolId: "f1d3956d-7111-49a5-8124-bb084822386e", circuitId: "191c70b1-522b-46d2-b125-167f7f1d257b", x: 2, y: 15 },
    { symbolId: "0a85153c-7b29-41ab-84cb-dede989bcb9c", circuitId: "00000000-0000-0000-0000-0000000b0200", x: 6, y: 19 },
    { symbolId: "f8bed590-1572-4a03-9cea-fa32d3ce940b", circuitId: "1f8c9136-e87c-4922-b5f7-57c129ef1537", x: 2, y: 20 },
    { symbolId: "a1e98fcc-e038-44b4-9b05-12ce366d4be9", circuitId: "348dfaa5-19ba-4460-842e-43900abd6b06", x: 2, y: 18 },
    { symbolId: "29026b3a-1b9a-4748-8be2-cdcf39c3345e", circuitId: "00000000-0000-0000-0000-000000080100", x: 11, y: 20 },
    { symbolId: "5316a294-8b93-491a-9186-bad8f1d5ae26", circuitId: "00000000-0000-0000-0000-000000080100", x: 11, y: 14 },
    { symbolId: "33256378-75b6-4323-b5fb-3a87d4d84381", circuitId: "00000000-0000-0000-0000-000000050200", x: 6, y: 13 },
    { symbolId: "0982ff4f-9309-4b39-8ff1-a81ed82f030f", circuitId: "00000000-0000-0000-0000-000000030200", x: 6, y: 8 },
    { symbolId: "82821fa6-112c-4856-9200-d369824e7129", circuitId: "7b5bb0ae-c845-438f-b817-cf11cc5e0ffb", x: 2, y: 13 },
    { symbolId: "87a29cbf-e6f0-4f81-8fe4-5b8d71d896c3", circuitId: "5d899dbd-97cf-410f-a19b-c1daa46d04d7", x: 2, y: 8 },
    { symbolId: "df315b4b-e59d-4062-bf23-14af5d256edf", circuitId: "438acc15-23a5-4f5a-84bb-f2480d631ca0", x: 2, y: 10 },
    { symbolId: "2ad340a0-85ae-40da-a9c4-94d703f4b173", circuitId: "27f8a467-8b92-4557-b204-7215f5822981", x: 2, y: 3 },
    { symbolId: "9e1e23cd-fbec-4ac3-bdb0-0f135667aa20", circuitId: "1706e68f-f15e-4d0a-9f19-5f2368e25625", x: 2, y: 5 },
  ];

  for (const s of symbolDefs) {
    const circuit = project.circuits.get(s.circuitId);
    if (!circuit) {
      continue;
    }
    const symbol = createCircuitSymbol(
      circuit,
      mainCircuit.logicalCircuitId,
      s.x,
      s.y,
      "up",
      s.symbolId,
    );
    mainCircuit.circuitSymbols.push(symbol);
    project.circuitSymbols.push(symbol);
  }

  // Wires für Haupt-Schaltung
  const wireDefs = [
    { wireId: "e1f7c45c-614f-4b7d-b9c9-eea21b5fd1bd", x1: 4, y1: 6, x2: 6, y2: 6 },
    { wireId: "5a5d6550-1687-4f81-9afd-add3a42403bf", x1: 4, y1: 11, x2: 6, y2: 11 },
    { wireId: "cbdcc7ad-3505-4d56-986a-9b01353e2469", x1: 9, y1: 15, x2: 11, y2: 15 },
    { wireId: "200633fe-3be8-4b5d-af43-3f8aa45c122d", x1: 4, y1: 16, x2: 6, y2: 16 },
    { wireId: "8103a1ed-42af-493f-9e93-4d30ad5af0fa", x1: 4, y1: 19, x2: 7, y2: 19 },
    { wireId: "a68aba61-3bd4-470c-b111-b2b05b2bbb1b", x1: 4, y1: 21, x2: 6, y2: 21 },
    { wireId: "11a33701-d63d-481d-9120-1cc0d4731ff6", x1: 9, y1: 21, x2: 11, y2: 21 },
    { wireId: "35c4f27c-acba-493f-b7b5-52aee02a466b", x1: 9, y1: 10, x2: 11, y2: 10 },
    { wireId: "d85664b3-2b3a-4e06-8e52-ec50a7e63a02", x1: 4, y1: 14, x2: 6, y2: 14 },
    { wireId: "0067638c-049d-4351-aff0-b2af0b7a4007", x1: 9, y1: 5, x2: 11, y2: 5 },
    { wireId: "195fd273-6a1b-4372-a1b5-d17683b4c6a1", x1: 4, y1: 9, x2: 6, y2: 9 },
    { wireId: "368dd642-aa08-4ade-99e4-004f5608432b", x1: 4, y1: 4, x2: 6, y2: 4 },
  ];

  for (const w of wireDefs) {
    const wire: Wire = {
      wireId: w.wireId,
      logicalCircuitId: mainCircuit.logicalCircuitId,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      point1: { x: w.x1, y: w.y1 },
      point2: { x: w.x2, y: w.y2 },
    };
    mainCircuit.wires.push(wire);
    project.wires.push(wire);
  }

  mainCircuit.conductorMap = buildConductorMap(mainCircuit.wires);

  // Sub-Projekte Power und 7 Segment 04 Bit beibehalten für Pin-Tests
  const placeInCircuit = (target: LogicalCircuit, selection: PaletteSelection, pt: GridPoint) => {
    const { circuitSymbol } = instantiateCircuitFromPalette(project, target.logicalCircuitId, selection, pt);
    target.circuitSymbols.push(circuitSymbol);
    project.circuitSymbols.push(circuitSymbol);
  };

  const addNote = (target: LogicalCircuit, note: TextNote) => {
    target.textNotes.push(note);
    project.textNotes.push(note);
  };

  // Demo-Inhalt für Sub-Circuit "Power"
  addNote(subPower, {
    textNoteId: "note-power-1",
    logicalCircuitId: subPower.logicalCircuitId,
    x: 3,
    y: 2,
    width: 16,
    height: 1,
    note: "STROMVERSORGUNG (POWER)",
    rotation: "up",
  });
  placeInCircuit(subPower, { type: "constant", name: "1" }, { x: 3, y: 5 });
  placeInCircuit(subPower, { type: "pinOut", name: "VCC" }, { x: 8, y: 5 });

  // Demo-Inhalt für Sub-Circuit "7 Segment 04 Bit"
  addNote(sub7Seg, {
    textNoteId: "note-7seg-1",
    logicalCircuitId: sub7Seg.logicalCircuitId,
    x: 3,
    y: 2,
    width: 16,
    height: 1,
    note: "7-SEGMENT DECODER (4-BIT)",
    rotation: "up",
  });
  placeInCircuit(sub7Seg, { type: "pinIn", name: "In 0" }, { x: 3, y: 5 });
  placeInCircuit(sub7Seg, { type: "pinIn", name: "In 1" }, { x: 3, y: 8 });
  placeInCircuit(sub7Seg, { type: "pinIn", name: "In 2" }, { x: 3, y: 11 });
  placeInCircuit(sub7Seg, { type: "pinIn", name: "In 3" }, { x: 3, y: 14 });
  placeInCircuit(sub7Seg, { type: "and", inputCount: 4, name: "AND" }, { x: 8, y: 5 });
  placeInCircuit(sub7Seg, { type: "pinOut", name: "Seg A" }, { x: 14, y: 6 });
  placeInCircuit(sub7Seg, { type: "sevenSegment", name: "7-Segment" }, { x: 20, y: 5 });
  placeInCircuit(sub7Seg, { type: "led", name: "LED" }, { x: 25, y: 5 });
  placeInCircuit(sub7Seg, { type: "ledMatrix", name: "LED-Matrix" }, { x: 29, y: 5 });

  return project;
}
