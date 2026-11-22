import type GridPoint from "../types/canvas/gridPoint";
import type Circuit from "../types/circuit/circuit";
import type CircuitProject from "../types/circuit/circuitProject";
import type ComponentCatalogEntry from "../types/circuit/componentCatalogEntry";
import type ComponentCatalogPin from "../types/circuit/componentCatalogPin";
import type ComponentCatalogProperty from "../types/circuit/componentCatalogProperty";
import type ComponentPaletteCategory from "../types/circuit/componentPaletteCategory";
import type DisplayColor from "../types/circuit/displayColor";
import type LedMatrixCellShape from "../types/circuit/ledMatrixCellShape";
import type LedMatrixType from "../types/circuit/ledMatrixType";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type MemoryOnStart from "../types/circuit/memoryOnStart";
import type PaletteGateType from "../types/circuit/paletteGateType";
import type PaletteSelection from "../types/circuit/paletteSelection";
import type Pin from "../types/circuit/pin";
import type PinSide from "../types/circuit/pinSide";
import type ProbeFormat from "../types/circuit/probeFormat";
import type Rotation from "../types/circuit/rotation";
import type SensorType from "../types/circuit/sensorType";
import type SoundWaveform from "../types/circuit/soundWaveform";
import type SynthesizerMode from "../types/circuit/synthesizerMode";
import type TextNoteFontFamily from "../types/circuit/textNoteFontFamily";
import type TextNoteLineHeight from "../types/circuit/textNoteLineHeight";

import {
  SOUND_DEFAULT_FREQUENCY,
  SOUND_MAX_FREQUENCY,
  SOUND_MIN_FREQUENCY,
} from "./audioPitchTable";
import {
  BUTTON_MAX_GRID_SIZE,
  BUTTON_MIN_GRID_SIZE,
  calculateCircuitDimensionsAndPins,
  createCircuitButton,
  createCircuitProbe,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createPinCircuit,
  createTextNote,
  getLogicalCircuitMinDimensions,
  instantiateCircuitFromPalette,
  LED_MATRIX_MAX_DIM,
  LED_MATRIX_MIN_DIM,
  MAX_BIT_WIDTH,
  MAX_GATE_INPUT_COUNT,
  RESIZABLE_SYMBOL_MAX_GRID_SIZE,
  RESIZABLE_SYMBOL_MIN_GRID_SIZE,
  TEXT_NOTE_MAX_GRID_SIZE,
  TEXT_NOTE_MIN_GRID_SIZE,
} from "./circuitLayout";
import { GRID_SIZE } from "./coordinateSystem";
import {
  GRAPHICS_ARRAY_BITS_PER_PIXEL,
  GRAPHICS_ARRAY_DATA_BIT_WIDTHS,
  GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL,
  GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH,
  GRAPHICS_ARRAY_DEFAULT_HEIGHT,
  GRAPHICS_ARRAY_DEFAULT_WIDTH,
  GRAPHICS_ARRAY_DEFAULT_ZOOM,
  GRAPHICS_ARRAY_MAX_HEIGHT,
  GRAPHICS_ARRAY_MAX_WIDTH,
  GRAPHICS_ARRAY_MAX_ZOOM,
  GRAPHICS_ARRAY_MIN_HEIGHT,
  GRAPHICS_ARRAY_MIN_WIDTH,
  GRAPHICS_ARRAY_MIN_ZOOM,
  GRAPHICS_ARRAY_ON_START_MODES,
} from "./graphicsArrayUtils";
import {
  MEMORY_MAX_ADDRESS_BIT_WIDTH,
  MEMORY_MIN_ADDRESS_BIT_WIDTH,
} from "./memoryDataUtils";

export type ComponentToolType = PaletteGateType | "subCircuit" | "textNote";

export {
  BUTTON_MAX_GRID_SIZE,
  BUTTON_MIN_GRID_SIZE,
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
  MEMORY_MAX_ADDRESS_BIT_WIDTH,
  MEMORY_MIN_ADDRESS_BIT_WIDTH,
  RESIZABLE_SYMBOL_MAX_GRID_SIZE,
  RESIZABLE_SYMBOL_MIN_GRID_SIZE,
  TEXT_NOTE_MAX_GRID_SIZE,
  TEXT_NOTE_MIN_GRID_SIZE,
};

export const MEMORY_ON_START_MODES: readonly MemoryOnStart[] = ["random", "zeros", "ones", "data"];

export const PIN_SIDES: readonly PinSide[] = ["left", "top", "right", "bottom"];
export const ROTATIONS: readonly Rotation[] = ["up", "right", "down", "left"];
export const DISPLAY_COLORS: readonly DisplayColor[] = ["red", "yellow", "green", "blue"];
export const MATRIX_TYPES: readonly LedMatrixType[] = ["individual", "selector"];
export const MATRIX_CELL_SHAPES: readonly LedMatrixCellShape[] = ["round", "rect"];
export const SENSOR_TYPES: readonly SensorType[] = [
  "random",
  "manual",
  "series",
  "loop",
  "ascii",
  "keyCode",
  "sequence",
  "clock",
];
export const PROBE_FORMATS: readonly ProbeFormat[] = ["hex", "dec", "bin"];
export const SOUND_WAVEFORMS: readonly SoundWaveform[] = ["sine", "triangle", "square", "sawtooth"];
export const SYNTHESIZER_MODES: readonly SynthesizerMode[] = [
  "sine",
  "triangle",
  "square",
  "sawtooth",
  "noise",
];
export const TEXT_NOTE_FONT_FAMILIES: readonly TextNoteFontFamily[] = ["mono", "sans"];
export const TEXT_NOTE_LINE_HEIGHTS: readonly TextNoteLineHeight[] = [9, 12, 18, 36];

export const COMPONENT_PALETTE_CATEGORIES: readonly ComponentPaletteCategory[] = [
  "io",
  "displays",
  "gates",
  "decoration",
  "circuits",
];

type ComponentRegistryDefinition = {
  paletteCategory: ComponentPaletteCategory;
  labelKey: string;
  label: string;
  description: string;
  paletteVisible: boolean;
  aliasOf?: PaletteGateType;
  hasVariableInputs?: boolean;
  resizable: boolean;
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
  hasDynamicPinLayout: boolean;
  pinLayoutDependsOn: readonly string[];
  wiringHint?: string;
  properties: ComponentCatalogProperty[];
};

const PIN_SIDE_PROPERTY = (defaultValue: PinSide, description: string): ComponentCatalogProperty => ({
  name: "pinSide",
  type: "enum",
  description,
  defaultValue,
  enumValues: PIN_SIDES,
  settableOnCreate: true,
  settableOnUpdate: true,
});

const BIT_WIDTH_PROPERTY = (description: string): ComponentCatalogProperty => ({
  name: "bitWidth",
  type: "integer",
  description,
  defaultValue: 1,
  min: 1,
  max: MAX_BIT_WIDTH,
  settableOnCreate: true,
  settableOnUpdate: true,
});

const WIDTH_HEIGHT_PROPERTIES = (
  maxWidth: number,
  maxHeight: number,
  minWidth = 2,
  minHeight = 2,
): ComponentCatalogProperty[] => [
  {
    name: "width",
    type: "integer",
    description: `Grid width of the symbol (${minWidth}..${maxWidth}).`,
    defaultValue: minWidth,
    min: minWidth,
    max: maxWidth,
    settableOnCreate: true,
    settableOnUpdate: true,
  },
  {
    name: "height",
    type: "integer",
    description: `Grid height of the symbol (${minHeight}..${maxHeight}).`,
    defaultValue: minHeight,
    min: minHeight,
    max: maxHeight,
    settableOnCreate: true,
    settableOnUpdate: true,
  },
];

const NOTE_PROPERTY: ComponentCatalogProperty = {
  name: "note",
  type: "string",
  description: "Optional component note or description.",
  defaultValue: "",
  settableOnCreate: true,
  settableOnUpdate: true,
};

const ROTATION_PROPERTY: ComponentCatalogProperty = {
  name: "rotation",
  type: "enum",
  description: "Initial grid orientation ('up'=0°, 'right'=90°, 'down'=180°, 'left'=-90°).",
  defaultValue: "up",
  enumValues: ROTATIONS,
  settableOnCreate: true,
  settableOnUpdate: false,
};

const VARIABLE_GATE_PROPERTIES: ComponentCatalogProperty[] = [
  {
    name: "inputCount",
    type: "integer",
    description: "Number of input pins on the multi-input gate.",
    defaultValue: 2,
    min: 2,
    max: MAX_GATE_INPUT_COUNT,
    settableOnCreate: true,
    settableOnUpdate: true,
  },
  {
    name: "invertedOutput",
    type: "boolean",
    description: "Toggles output inversion on update (e.g. AND <-> NAND, OR <-> NOR, XOR <-> XNOR).",
    settableOnCreate: false,
    settableOnUpdate: true,
  },
  NOTE_PROPERTY,
  ROTATION_PROPERTY,
];

const COLOR_PROPERTY: ComponentCatalogProperty = {
  name: "color",
  type: "enum",
  description: "Signal color of the display.",
  defaultValue: "red",
  enumValues: DISPLAY_COLORS,
  settableOnCreate: true,
  settableOnUpdate: true,
};

const PIN_IN_PROPERTIES: ComponentCatalogProperty[] = [
  {
    name: "notation",
    type: "string",
    description: "Pin label / name (made unique within the circuit).",
    defaultValue: "X",
    settableOnCreate: true,
    settableOnUpdate: true,
  },
  {
    name: "name",
    type: "string",
    description: "Alternative pin name used if 'notation' is omitted.",
    defaultValue: "X",
    settableOnCreate: true,
    settableOnUpdate: true,
  },
  {
    name: "jamNotation",
    type: "string",
    description: "Short pin label on the outer sub-circuit symbol (e.g. 'CLK', 'D', 'Q', 'EN').",
    defaultValue: "",
    settableOnCreate: true,
    settableOnUpdate: true,
  },
  BIT_WIDTH_PROPERTY("Bit width of the input pin (1..32)."),
  PIN_SIDE_PROPERTY("left", "Side on the outer sub-circuit symbol (left, top, right, bottom)."),
  {
    name: "inverted",
    type: "boolean",
    description: "Inverts the input signal at the pin terminal.",
    defaultValue: false,
    settableOnCreate: true,
    settableOnUpdate: true,
  },
  ...WIDTH_HEIGHT_PROPERTIES(RESIZABLE_SYMBOL_MAX_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
  NOTE_PROPERTY,
  ROTATION_PROPERTY,
];

// Typsichere Single-Source-of-Truth-Registry für alle PaletteGateType-Bausteine
const PALETTE_GATE_REGISTRY: Record<PaletteGateType, ComponentRegistryDefinition> = {
  button: {
    paletteCategory: "io",
    labelKey: "palette.components.button",
    label: "Button / Switch",
    description:
      "Interactive momentary push button (isToggle=false) or latching toggle switch (isToggle=true) " +
      "with a configurable output pin side and resizable dimensions.",
    paletteVisible: true,
    resizable: true,
    minSize: { width: BUTTON_MIN_GRID_SIZE, height: BUTTON_MIN_GRID_SIZE },
    maxSize: { width: BUTTON_MAX_GRID_SIZE, height: BUTTON_MAX_GRID_SIZE },
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinSide", "width", "height"],
    wiringHint: "Pin 'Out' is centered on the selected 'pinSide' edge.",
    properties: [
      {
        name: "isToggle",
        type: "boolean",
        description: "false = momentary push button, true = latching toggle switch.",
        defaultValue: false,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      PIN_SIDE_PROPERTY("right", "Side of the output pin (left, top, right, bottom)."),
      {
        name: "notation",
        type: "string",
        description: "Label rendered directly on the button or switch.",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "name",
        type: "string",
        description: "Optional display name (fallback for the label).",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "inverted",
        type: "boolean",
        description: "Inverts the output signal (idle 1, pressed 0).",
        defaultValue: false,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "keyCode",
        type: "integer",
        description: "Optional WPF key code for keyboard triggers during simulation.",
        defaultValue: 0,
        min: 0,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "modifiers",
        type: "integer",
        description: "Optional modifier bitmask for keyboard triggers.",
        defaultValue: 0,
        min: 0,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      ...WIDTH_HEIGHT_PROPERTIES(BUTTON_MAX_GRID_SIZE, BUTTON_MAX_GRID_SIZE, BUTTON_MIN_GRID_SIZE, BUTTON_MIN_GRID_SIZE),
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  constant: {
    paletteCategory: "io",
    labelKey: "palette.components.constant",
    label: "Constant (0/1)",
    description: "Fixed digital signal source with configurable numeric value (1..32 bits) and selectable pin side.",
    paletteVisible: true,
    resizable: true,
    minSize: { width: RESIZABLE_SYMBOL_MIN_GRID_SIZE, height: RESIZABLE_SYMBOL_MIN_GRID_SIZE },
    maxSize: { width: RESIZABLE_SYMBOL_MAX_GRID_SIZE, height: RESIZABLE_SYMBOL_MAX_GRID_SIZE },
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinSide", "width", "height"],
    properties: [
      {
        name: "value",
        type: "integer",
        description: "Output value of the constant (masked to bitWidth).",
        defaultValue: 1,
        min: 0,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      BIT_WIDTH_PROPERTY("Bit width of the constant (1..32)."),
      PIN_SIDE_PROPERTY("right", "Side of the output pin (left, top, right, bottom)."),
      {
        name: "isHex",
        type: "boolean",
        description: "true = hexadecimal display, false = decimal display.",
        defaultValue: true,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      ...WIDTH_HEIGHT_PROPERTIES(RESIZABLE_SYMBOL_MAX_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  clock: {
    paletteCategory: "io",
    labelKey: "palette.components.clock",
    label: "Clock Generator",
    description: "Generates an alternating clock signal (0/1) on every simulation tick.",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: false,
    pinLayoutDependsOn: [],
    properties: [NOTE_PROPERTY, ROTATION_PROPERTY],
  },
  probe: {
    paletteCategory: "displays",
    labelKey: "palette.components.probe",
    label: "Signal Probe",
    description: "Measurement probe for live inspection of 1- to 32-bit signals during simulation (including telemetry names).",
    paletteVisible: true,
    resizable: true,
    minSize: { width: RESIZABLE_SYMBOL_MIN_GRID_SIZE, height: RESIZABLE_SYMBOL_MIN_GRID_SIZE },
    maxSize: { width: RESIZABLE_SYMBOL_MAX_GRID_SIZE, height: RESIZABLE_SYMBOL_MAX_GRID_SIZE },
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinSide", "width", "height"],
    properties: [
      {
        name: "notation",
        type: "string",
        description: "Optional probe label for display and telemetry.",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "name",
        type: "string",
        description: "Alternative name of the signal probe.",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      PIN_SIDE_PROPERTY("left", "Side of the input pin (left, top, right, bottom)."),
      {
        name: "isHex",
        type: "boolean",
        description: "true = hexadecimal display, false = binary/standard display.",
        defaultValue: false,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "displayFormat",
        type: "enum",
        description: "Display format during simulation ('hex', 'dec', 'bin').",
        defaultValue: "bin",
        enumValues: PROBE_FORMATS,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      ...WIDTH_HEIGHT_PROPERTIES(RESIZABLE_SYMBOL_MAX_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  pinIn: {
    paletteCategory: "io",
    labelKey: "palette.components.pinIn",
    label: "Pin (Input)",
    description: "External input terminal of a circuit for reuse as a sub-circuit.",
    paletteVisible: true,
    resizable: true,
    minSize: { width: RESIZABLE_SYMBOL_MIN_GRID_SIZE, height: RESIZABLE_SYMBOL_MIN_GRID_SIZE },
    maxSize: { width: RESIZABLE_SYMBOL_MAX_GRID_SIZE, height: RESIZABLE_SYMBOL_MAX_GRID_SIZE },
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinSide", "width", "height"],
    wiringHint:
      "Inside the circuit, the internal terminal is on the right (Output); " +
      "'pinSide' determines the edge on the outer sub-circuit symbol.",
    properties: PIN_IN_PROPERTIES,
  },
  pinOut: {
    paletteCategory: "io",
    labelKey: "palette.components.pinOut",
    label: "Pin (Output)",
    description: "External output terminal of a circuit for reuse as a sub-circuit.",
    paletteVisible: true,
    resizable: true,
    minSize: { width: RESIZABLE_SYMBOL_MIN_GRID_SIZE, height: RESIZABLE_SYMBOL_MIN_GRID_SIZE },
    maxSize: { width: RESIZABLE_SYMBOL_MAX_GRID_SIZE, height: RESIZABLE_SYMBOL_MAX_GRID_SIZE },
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinSide", "width", "height"],
    wiringHint:
      "Inside the circuit, the internal terminal is on the left (Input); " +
      "'pinSide' determines the edge on the outer sub-circuit symbol.",
    properties: [
      {
        name: "notation",
        type: "string",
        description: "Pin label / name (made unique within the circuit).",
        defaultValue: "Q",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "name",
        type: "string",
        description: "Alternative pin name used if 'notation' is omitted.",
        defaultValue: "Q",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "jamNotation",
        type: "string",
        description: "Short pin label on the outer sub-circuit symbol (e.g. 'CLK', 'D', 'Q', 'EN').",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      BIT_WIDTH_PROPERTY("Bit width of the output pin (1..32)."),
      PIN_SIDE_PROPERTY("right", "Side on the outer sub-circuit symbol (left, top, right, bottom)."),
      {
        name: "inverted",
        type: "boolean",
        description: "Inverts the output signal at the pin terminal.",
        defaultValue: false,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      ...WIDTH_HEIGHT_PROPERTIES(RESIZABLE_SYMBOL_MAX_GRID_SIZE, RESIZABLE_SYMBOL_MAX_GRID_SIZE),
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  pin: {
    paletteCategory: "io",
    labelKey: "palette.components.pin",
    label: "Pin (Input)",
    description: "Legacy alias for 'pinIn' (circuit input pin).",
    paletteVisible: false,
    aliasOf: "pinIn",
    resizable: true,
    minSize: { width: RESIZABLE_SYMBOL_MIN_GRID_SIZE, height: RESIZABLE_SYMBOL_MIN_GRID_SIZE },
    maxSize: { width: RESIZABLE_SYMBOL_MAX_GRID_SIZE, height: RESIZABLE_SYMBOL_MAX_GRID_SIZE },
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinSide", "width", "height"],
    wiringHint: "Legacy alias for 'pinIn'. Prefer 'pinIn' or 'pinOut'.",
    properties: PIN_IN_PROPERTIES,
  },
  sensor: {
    paletteCategory: "io",
    labelKey: "palette.components.sensor",
    label: "Sensor",
    description:
      "Configurable signal source for random values, manual hex input, series/loops, keyboard ASCII/key codes, or BCD clock time.",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinSide"],
    properties: [
      BIT_WIDTH_PROPERTY("Bit width of the sensor output (1..32)."),
      PIN_SIDE_PROPERTY("right", "Side of the output pin (left, top, right, bottom)."),
      {
        name: "notation",
        type: "string",
        description: "Optional label rendered on the sensor symbol.",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "sensorType",
        type: "enum",
        description: "Operating mode of the sensor.",
        defaultValue: "random",
        enumValues: SENSOR_TYPES,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "data",
        type: "string",
        description: "Configuration data (e.g. random range 'A:14', manual hex values, or tick pairs '0:1,10:2').",
        defaultValue: "A:14",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  splitter: {
    paletteCategory: "io",
    labelKey: "palette.components.splitter",
    label: "Bus Splitter",
    description: "Splits a multi-bit bus into individual taps or bundles individual signals into a bus.",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinCount", "pinBitWidth", "bitWidth", "clockwise"],
    wiringHint: "The wide pin is named 'Bus'; taps are named by their bit ranges (e.g. '0', '1', '0-3').",
    properties: [
      {
        name: "pinCount",
        type: "integer",
        description: "Number of individual taps.",
        defaultValue: 3,
        min: 2,
        max: MAX_BIT_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "pinBitWidth",
        type: "integer",
        description: "Bit width per individual tap (unless 'bitWidth' is explicitly specified).",
        defaultValue: 1,
        min: 1,
        max: MAX_BIT_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "bitWidth",
        type: "integer",
        description: "Total bit width of the bus pin (default: pinCount * pinBitWidth).",
        defaultValue: 3,
        min: 2,
        max: MAX_BIT_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "clockwise",
        type: "boolean",
        description: "Pin arrangement (true = Bus left / taps right, false = mirrored).",
        defaultValue: true,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  led: {
    paletteCategory: "displays",
    labelKey: "palette.components.led",
    label: "LED",
    description: "Visual 1-bit indicator LED (illuminates on High / 1 signal).",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: false,
    pinLayoutDependsOn: [],
    properties: [COLOR_PROPERTY, NOTE_PROPERTY, ROTATION_PROPERTY],
  },
  sevenSegment: {
    paletteCategory: "displays",
    labelKey: "palette.components.sevenSegment",
    label: "7-Segment Display",
    description: "7-segment display with 8 inputs (a..g and decimal point dp).",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: false,
    pinLayoutDependsOn: [],
    properties: [COLOR_PROPERTY, NOTE_PROPERTY, ROTATION_PROPERTY],
  },
  ledMatrix: {
    paletteCategory: "displays",
    labelKey: "palette.components.ledMatrix",
    label: "LED Matrix",
    description: "Configurable pixel matrix (1..10 rows x 1..10 columns) in individual or selector mode.",
    paletteVisible: true,
    resizable: true,
    minSize: { width: LED_MATRIX_MIN_DIM + 1, height: LED_MATRIX_MIN_DIM + 1 },
    maxSize: { width: LED_MATRIX_MAX_DIM + 1, height: LED_MATRIX_MAX_DIM + 1 },
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["rows", "columns", "matrixType"],
    wiringHint:
      "In 'individual' mode, row pins ('Row 1'..) are on the left; in 'selector' mode, column pins ('Col 1'..) are also on the top.",
    properties: [
      {
        name: "rows",
        type: "integer",
        description: "Number of LED rows (determines symbol height = rows + 1).",
        defaultValue: 4,
        min: LED_MATRIX_MIN_DIM,
        max: LED_MATRIX_MAX_DIM,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "columns",
        type: "integer",
        description: "Number of LED columns (determines symbol width = columns + 1).",
        defaultValue: 4,
        min: LED_MATRIX_MIN_DIM,
        max: LED_MATRIX_MAX_DIM,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "matrixType",
        type: "enum",
        description: "'individual' = per-row multi-bit drive, 'selector' = matrix multiplexing (columns top, rows left).",
        defaultValue: "individual",
        enumValues: MATRIX_TYPES,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "cellShape",
        type: "enum",
        description: "Visual shape of individual LED cells ('round' or 'rect').",
        defaultValue: "round",
        enumValues: MATRIX_CELL_SHAPES,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "colors",
        type: "integer",
        description: "Bits per LED for RGB color depth (1..3).",
        defaultValue: 1,
        min: 1,
        max: 3,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "persistenceMultiplier",
        type: "integer",
        description: "Persistence multiplier for multiplexing (1..3).",
        defaultValue: 1,
        min: 1,
        max: 3,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  sound: {
    paletteCategory: "displays",
    labelKey: "palette.components.sound",
    label: "Sound",
    description: "1-bit acoustic output buzzer with configurable waveform and frequency (20..20000 Hz).",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["pinSide"],
    properties: [
      {
        name: "notation",
        type: "string",
        description: "Optional label printed inside the sound block.",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      PIN_SIDE_PROPERTY("left", "Side of the 1-bit enable input pin (left, top, right, bottom)."),
      {
        name: "frequency",
        type: "integer",
        description: "Tone frequency in Hz (20..20000).",
        defaultValue: SOUND_DEFAULT_FREQUENCY,
        min: SOUND_MIN_FREQUENCY,
        max: SOUND_MAX_FREQUENCY,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "waveform",
        type: "enum",
        description: "Oscillator waveform ('sine', 'triangle', 'square', 'sawtooth').",
        defaultValue: "sine",
        enumValues: SOUND_WAVEFORMS,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  synthesizer: {
    paletteCategory: "displays",
    labelKey: "palette.components.synthesizer",
    label: "Synthesizer",
    description:
      "Polyphonic 8-bit synthesizer (3x4 IC) with 8-bit MIDI pitch input (F), " +
      "8-bit channel volume (V), and 1-bit enable (E).",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: false,
    pinLayoutDependsOn: [],
    wiringHint:
      "All 3 inputs are mandatory: 'Frequency' (F, 8-bit left y=1; 0/128 = mute, " +
      "1..127 & 129..255 = MIDI notes ignoring bit 7), 'Volume' (V, 8-bit left y=3; 0..255), " +
      "and 'Enable' (E, 1-bit bottom x=1).",
    properties: [
      {
        name: "notation",
        type: "string",
        description: "Optional short channel label printed inside the synthesizer IC.",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "synthesizerMode",
        type: "enum",
        description: "Synthesis mode ('sine', 'triangle', 'square', 'sawtooth', 'noise').",
        defaultValue: "square",
        enumValues: SYNTHESIZER_MODES,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  graphicsArray: {
    paletteCategory: "displays",
    labelKey: "palette.components.graphicsArray",
    label: "Graphics Array",
    description:
      "Memory-mapped graphical pixel display (1..640 x 1..480 px) with configurable color depth " +
      "(1/2/4/8 bpp), data bus width (1..32 bits), pixel zoom (1x..4x), and RAM-style write control.",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["width", "height", "bitsPerPixel", "dataBitWidth", "zoom", "writeOn1"],
    wiringHint:
      "Pins: left 'Address' (computed addressBitWidth) and 'DataIn' (dataBitWidth), " +
      "right optional 'Data' (dataBitWidth), bottom 'Write (0)'/'Write (1)' (1-bit).",
    properties: [
      {
        name: "writeOn1",
        type: "boolean",
        description: "Write edge polarity: false = falling edge (1 -> 0), true = rising edge (0 -> 1).",
        defaultValue: false,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "onStart",
        type: "enum",
        description: "VRAM initialization mode on simulation start ('random', 'zeros', or 'ones').",
        defaultValue: "zeros",
        enumValues: GRAPHICS_ARRAY_ON_START_MODES,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "dataBitWidth",
        type: "integer",
        description: "Data word bit width (1, 2, 4, 8, 16, or 32).",
        defaultValue: GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH,
        min: 1,
        max: MAX_BIT_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "bitsPerPixel",
        type: "integer",
        description: "Color depth in bits per pixel (1 = 2 colors, 2 = 4 grays, 4 = 16 colors, 8 = 256 colors).",
        defaultValue: GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL,
        min: 1,
        max: 8,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "width",
        type: "integer",
        description: `Display width in pixels (${GRAPHICS_ARRAY_MIN_WIDTH}..${GRAPHICS_ARRAY_MAX_WIDTH}).`,
        defaultValue: GRAPHICS_ARRAY_DEFAULT_WIDTH,
        min: GRAPHICS_ARRAY_MIN_WIDTH,
        max: GRAPHICS_ARRAY_MAX_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "height",
        type: "integer",
        description: `Display height in pixels (${GRAPHICS_ARRAY_MIN_HEIGHT}..${GRAPHICS_ARRAY_MAX_HEIGHT}).`,
        defaultValue: GRAPHICS_ARRAY_DEFAULT_HEIGHT,
        min: GRAPHICS_ARRAY_MIN_HEIGHT,
        max: GRAPHICS_ARRAY_MAX_HEIGHT,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "zoom",
        type: "integer",
        description: `Pixel display zoom factor (${GRAPHICS_ARRAY_MIN_ZOOM}..${GRAPHICS_ARRAY_MAX_ZOOM}).`,
        defaultValue: GRAPHICS_ARRAY_DEFAULT_ZOOM,
        min: GRAPHICS_ARRAY_MIN_ZOOM,
        max: GRAPHICS_ARRAY_MAX_ZOOM,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  not: {
    paletteCategory: "gates",
    labelKey: "palette.components.not",
    label: "Not",
    description: "Logical inverter (negation: 1 input, 1 inverted output).",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: false,
    pinLayoutDependsOn: [],
    properties: [NOTE_PROPERTY, ROTATION_PROPERTY],
  },
  triState1: {
    paletteCategory: "gates",
    labelKey: "palette.components.triState1",
    label: "Tri-state (bottom)",
    description: "Tri-state buffer with enable control input on the bottom edge.",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: false,
    pinLayoutDependsOn: [],
    properties: [NOTE_PROPERTY, ROTATION_PROPERTY],
  },
  triState2: {
    paletteCategory: "gates",
    labelKey: "palette.components.triState2",
    label: "Tri-state (top)",
    description: "Tri-state buffer with enable control input on the top edge.",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: false,
    pinLayoutDependsOn: [],
    properties: [NOTE_PROPERTY, ROTATION_PROPERTY],
  },
  and: {
    paletteCategory: "gates",
    labelKey: "palette.components.and",
    label: "And",
    description: "Logical AND gate with configurable number of inputs.",
    paletteVisible: true,
    hasVariableInputs: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["inputCount"],
    properties: VARIABLE_GATE_PROPERTIES,
  },
  nand: {
    paletteCategory: "gates",
    labelKey: "palette.components.nand",
    label: "NAnd",
    description: "Inverted AND gate (NAND) with configurable number of inputs.",
    paletteVisible: true,
    hasVariableInputs: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["inputCount"],
    properties: VARIABLE_GATE_PROPERTIES,
  },
  or: {
    paletteCategory: "gates",
    labelKey: "palette.components.or",
    label: "Or",
    description: "Logical OR gate with configurable number of inputs.",
    paletteVisible: true,
    hasVariableInputs: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["inputCount"],
    properties: VARIABLE_GATE_PROPERTIES,
  },
  nor: {
    paletteCategory: "gates",
    labelKey: "palette.components.nor",
    label: "NOr",
    description: "Inverted OR gate (NOR) with configurable number of inputs.",
    paletteVisible: true,
    hasVariableInputs: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["inputCount"],
    properties: VARIABLE_GATE_PROPERTIES,
  },
  xor: {
    paletteCategory: "gates",
    labelKey: "palette.components.xor",
    label: "Xor",
    description: "Exclusive OR gate (XOR) with configurable number of inputs.",
    paletteVisible: true,
    hasVariableInputs: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["inputCount"],
    properties: VARIABLE_GATE_PROPERTIES,
  },
  xnor: {
    paletteCategory: "gates",
    labelKey: "palette.components.xnor",
    label: "XNor",
    description: "Inverted exclusive OR gate (XNOR) with configurable number of inputs.",
    paletteVisible: true,
    hasVariableInputs: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["inputCount"],
    properties: VARIABLE_GATE_PROPERTIES,
  },
  rom: {
    paletteCategory: "gates",
    labelKey: "palette.components.rom",
    label: "ROM",
    description:
      "Read-only memory (ROM) with configurable address bit width (1..16), " +
      "data bit width (1..32), optional dual read port, and persistent Base64 data.",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["dualPort"],
    wiringHint:
      "Pins: left 'Address' (A), right 'Data' (D); with dualPort=true, second read port uses left 'Address2' (A2) and right 'Data2' (D2).",
    properties: [
      {
        name: "addressBitWidth",
        type: "integer",
        description: "Address bus bit width (1..16, defining 2^addressBitWidth cells).",
        defaultValue: 8,
        min: MEMORY_MIN_ADDRESS_BIT_WIDTH,
        max: MEMORY_MAX_ADDRESS_BIT_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "dataBitWidth",
        type: "integer",
        description: "Data word bit width per memory cell (1..32).",
        defaultValue: 8,
        min: 1,
        max: MAX_BIT_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "dualPort",
        type: "boolean",
        description: "Enables a second independent read port (Address2 / Data2).",
        defaultValue: false,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "data",
        type: "string",
        description: "Base64-encoded initial ROM contents (little-endian cells, trailing zeros trimmed).",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
  ram: {
    paletteCategory: "gates",
    labelKey: "palette.components.ram",
    label: "RAM",
    description:
      "Writable random-access memory (RAM) with configurable address/data bit widths, " +
      "write edge polarity, startup initialization mode, and optional dual read port.",
    paletteVisible: true,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["dualPort", "writeOn1"],
    wiringHint:
      "Pins: left 'Address' (A) and 'DataIn' (D), right 'Data' (D), " +
      "bottom 'Write (0)'/'Write (1)' (W); with dualPort=true, left 'Address2' (A2) and right 'Data2' (D2).",
    properties: [
      {
        name: "addressBitWidth",
        type: "integer",
        description: "Address bus bit width (1..16, defining 2^addressBitWidth cells).",
        defaultValue: 8,
        min: MEMORY_MIN_ADDRESS_BIT_WIDTH,
        max: MEMORY_MAX_ADDRESS_BIT_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "dataBitWidth",
        type: "integer",
        description: "Data word bit width per memory cell (1..32).",
        defaultValue: 8,
        min: 1,
        max: MAX_BIT_WIDTH,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "writeOn1",
        type: "boolean",
        description: "Write edge polarity: false = falling edge (1 -> 0), true = rising edge (0 -> 1).",
        defaultValue: false,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "onStart",
        type: "enum",
        description: "Initialization mode on simulation start ('random', 'zeros', 'ones', or 'data').",
        defaultValue: "random",
        enumValues: MEMORY_ON_START_MODES,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "dualPort",
        type: "boolean",
        description: "Enables a second independent read port (Address2 / Data2).",
        defaultValue: false,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "data",
        type: "string",
        description: "Base64-encoded persistent RAM contents used when onStart='data'.",
        defaultValue: "",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      NOTE_PROPERTY,
      ROTATION_PROPERTY,
    ],
  },
};

const SPECIAL_COMPONENT_REGISTRY: Record<"subCircuit" | "textNote", ComponentRegistryDefinition> = {
  subCircuit: {
    paletteCategory: "circuits",
    labelKey: "palette.components.subCircuit",
    label: "Sub-Circuit",
    description:
      "Embeds another LogicalCircuit from the project as a reusable IC symbol. " +
      "Dimensions and pins depend dynamically on the circuit's Pin components and symbol shape.",
    paletteVisible: false,
    resizable: false,
    hasDynamicPinLayout: true,
    pinLayoutDependsOn: ["subCircuitId"],
    wiringHint:
      "Outer pins and dimensions of each project circuit are returned in 'subCircuits' or via 'preview: { subCircuitId }'.",
    properties: [
      {
        name: "subCircuitId",
        type: "string",
        description: "ID of the LogicalCircuit to embed.",
        settableOnCreate: true,
        settableOnUpdate: false,
      },
      {
        name: "name",
        type: "string",
        description: "Optional display name (defaults to target circuit name).",
        settableOnCreate: true,
        settableOnUpdate: false,
      },
      ROTATION_PROPERTY,
    ],
  },
  textNote: {
    paletteCategory: "decoration",
    labelKey: "palette.components.textNote",
    label: "Text Note",
    description: "Free-text annotation box on the schematic without electrical connections.",
    paletteVisible: true,
    resizable: true,
    minSize: { width: TEXT_NOTE_MIN_GRID_SIZE, height: TEXT_NOTE_MIN_GRID_SIZE },
    maxSize: { width: TEXT_NOTE_MAX_GRID_SIZE, height: TEXT_NOTE_MAX_GRID_SIZE },
    hasDynamicPinLayout: false,
    pinLayoutDependsOn: [],
    properties: [
      {
        name: "note",
        type: "string",
        description: "Text content of the note.",
        defaultValue: "Text Note",
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "name",
        type: "string",
        description: "Alternative text content used if 'note' is omitted.",
        defaultValue: "Text Note",
        settableOnCreate: true,
        settableOnUpdate: false,
      },
      ...WIDTH_HEIGHT_PROPERTIES(
        TEXT_NOTE_MAX_GRID_SIZE,
        TEXT_NOTE_MAX_GRID_SIZE,
        TEXT_NOTE_MIN_GRID_SIZE,
        TEXT_NOTE_MIN_GRID_SIZE,
      ),
      {
        name: "fontFamily",
        type: "enum",
        description: "Font family of the text note ('mono' or 'sans').",
        defaultValue: "mono",
        enumValues: TEXT_NOTE_FONT_FAMILIES,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        name: "lineHeight",
        type: "integer",
        description: "Line height in pixels (9, 12, 18, or 36).",
        defaultValue: 18,
        min: 9,
        max: 36,
        settableOnCreate: true,
        settableOnUpdate: true,
      },
      {
        ...ROTATION_PROPERTY,
        settableOnUpdate: true,
      },
    ],
  },
};

export type PaletteGateDescriptor = {
  type: PaletteGateType;
  labelKey: string;
  label: string;
  hasVariableInputs?: boolean;
};

// Liefert alle sichtbaren Standard-Bausteine einer Paletten-Kategorie in definierter UI-Reihenfolge
export function getPaletteGateItems(
  category: "io" | "displays" | "gates",
): PaletteGateDescriptor[] {
  const entries: PaletteGateDescriptor[] = [];
  for (const [type, def] of Object.entries(PALETTE_GATE_REGISTRY) as [PaletteGateType, ComponentRegistryDefinition][]) {
    if (def.paletteVisible && def.paletteCategory === category) {
      entries.push({
        type,
        labelKey: def.labelKey,
        label: def.label,
        ...(def.hasVariableInputs ? { hasVariableInputs: true } : {}),
      });
    }
  }
  return entries;
}

// Liefert den Übersetzungsschlüssel der Text-Notiz aus derselben zentralen Registry
export function getTextNotePaletteLabelKey(): string {
  return SPECIAL_COMPONENT_REGISTRY.textNote.labelKey;
}

// Liefert den Anzeigenamen der Text-Notiz aus derselben zentralen Registry
export function getTextNotePaletteLabel(): string {
  return SPECIAL_COMPONENT_REGISTRY.textNote.label;
}

// Liefert alle registrierten PaletteGateType-Schlüssel (für Single-Source-of-Truth-Tests)
export function getRegisteredPaletteGateTypes(): PaletteGateType[] {
  return Object.keys(PALETTE_GATE_REGISTRY) as PaletteGateType[];
}

// Liefert alle in add_elements zulässigen Komponententypen direkt aus der Registry
export function getAllowedComponentTypes(): ComponentToolType[] {
  return [
    ...(Object.keys(PALETTE_GATE_REGISTRY) as PaletteGateType[]),
    "subCircuit",
    "textNote",
  ];
}

// Prüft, ob ein gegebener String ein gültiger Komponententyp der Registry ist
export function isKnownComponentType(value: string): value is ComponentToolType {
  return (
    Object.hasOwn(PALETTE_GATE_REGISTRY, value) ||
    Object.hasOwn(SPECIAL_COMPONENT_REGISTRY, value)
  );
}

export type ComponentPreviewParams = Partial<PaletteSelection> & {
  width?: number;
  height?: number;
  inverted?: boolean;
};

function clampSize(value: number | undefined, fallback: number, min: number, max?: number): number {
  if (value === undefined) {
    return fallback;
  }
  const lowerBounded = Math.max(min, value);
  return max !== undefined ? Math.min(max, lowerBounded) : lowerBounded;
}

function mapCircuitPins(circuit: Pick<Circuit, "pins">): ComponentCatalogPin[] {
  return circuit.pins.map((pin) => ({
    name: pin.name,
    pinType: pin.pinType,
    pinSide: pin.pinSide,
    bitWidth: pin.bitWidth,
    inverted: pin.inverted,
    gridPoint: { x: pin.gridPoint.x, y: pin.gridPoint.y },
  }));
}

// Berechnet die aktuellen äußeren Maße und Pins einer LogicalCircuit (auch vor der ersten Platzierung)
function resolveLogicalCircuitLayout(
  lc: LogicalCircuit,
  project?: CircuitProject,
): {
  symbolWidth: number;
  symbolHeight: number;
  pins: Pin[];
} {
  const pinMap = new Map<string, Pin>();
  for (const p of project?.pins ?? []) {
    if (p.circuitId === lc.logicalCircuitId) {
      pinMap.set(p.pinId, p);
    }
  }
  for (const p of lc.logicalPins) {
    if (!pinMap.has(p.pinId)) {
      pinMap.set(p.pinId, p);
    }
  }
  for (const p of lc.pins) {
    if (!pinMap.has(p.pinId)) {
      pinMap.set(p.pinId, p as Pin);
    }
  }

  const allPins = Array.from(pinMap.values());
  const symbolCoords = new Map<string, GridPoint>();
  for (const sym of lc.circuitSymbols) {
    if (sym.circuit.kind === "pin") {
      symbolCoords.set(sym.circuit.circuitId, { x: sym.x, y: sym.y });
    }
  }

  const logicalCircuitsById = project
    ? new Map(project.logicalCircuits.map((entry) => [entry.logicalCircuitId, entry]))
    : undefined;
  const { minWidth, minHeight } = getLogicalCircuitMinDimensions(lc, logicalCircuitsById);
  const layout = calculateCircuitDimensionsAndPins(allPins, minWidth, minHeight, symbolCoords);

  return {
    symbolWidth: layout.gridWidth,
    symbolHeight: layout.gridHeight,
    pins: layout.pins as Pin[],
  };
}

// Erzeugt über die echten Factory-Funktionen aus circuitLayout.ts die aktuelle Geometrie und Pin-Belegung
function inspectComponentGeometry(
  type: ComponentToolType,
  def: ComponentRegistryDefinition,
  preview?: ComponentPreviewParams,
  project?: CircuitProject,
): {
  defaultSize: { width: number; height: number };
  isDisplay: boolean;
  pins: ComponentCatalogPin[];
} {
  if (type === "textNote") {
    const noteText = preview?.name ?? "Text Note";
    const note = createTextNote("catalog-preview", 0, 0, noteText);
    const width = preview?.width !== undefined ? Math.max(1, preview.width) : note.width;
    const height = preview?.height !== undefined ? Math.max(1, preview.height) : note.height;
    return {
      defaultSize: { width, height },
      isDisplay: false,
      pins: [],
    };
  }

  if (type === "subCircuit") {
    const targetSub = preview?.subCircuitId && project
      ? project.logicalCircuits.find((lc) => lc.logicalCircuitId === preview.subCircuitId)
      : undefined;
    if (targetSub) {
      const resolved = resolveLogicalCircuitLayout(targetSub, project);
      return {
        defaultSize: { width: resolved.symbolWidth, height: resolved.symbolHeight },
        isDisplay: targetSub.isDisplay,
        pins: mapCircuitPins(resolved),
      };
    }
    const placeholder = createDefaultLogicalCircuit("catalog-sub", preview?.name ?? "Sub-Circuit");
    return {
      defaultSize: { width: placeholder.symbolWidth, height: placeholder.symbolHeight },
      isDisplay: placeholder.isDisplay,
      pins: mapCircuitPins(placeholder),
    };
  }

  const minW = def.minSize?.width ?? 2;
  const minH = def.minSize?.height ?? 2;
  const maxW = def.maxSize?.width;
  const maxH = def.maxSize?.height;

  // Resizable Bauteile unterstützen im Preview direkte width/height-Berechnung über ihre Factory
  if (preview && (preview.width !== undefined || preview.height !== undefined || preview.inverted !== undefined)) {
    if (type === "button") {
      const btn = createCircuitButton(
        "catalog-btn",
        preview.notation ?? "",
        preview.isToggle ?? false,
        preview.pinSide ?? "right",
        preview.inverted ?? false,
        clampSize(preview.width, 2, minW, maxW),
        clampSize(preview.height, 2, minH, maxH),
      );
      return {
        defaultSize: { width: btn.symbolWidth, height: btn.symbolHeight },
        isDisplay: btn.isDisplay,
        pins: mapCircuitPins(btn),
      };
    }
    if (type === "constant") {
      const constant = createConstant(
        "catalog-const",
        preview.bitWidth ?? 1,
        preview.value ?? 1,
        preview.pinSide ?? "right",
        preview.isHex ?? true,
        clampSize(preview.width, 2, minW, maxW),
        clampSize(preview.height, 2, minH, maxH),
      );
      return {
        defaultSize: { width: constant.symbolWidth, height: constant.symbolHeight },
        isDisplay: constant.isDisplay,
        pins: mapCircuitPins(constant),
      };
    }
    if (type === "probe") {
      const probe = createCircuitProbe(
        "catalog-probe",
        preview.notation ?? preview.name ?? "",
        preview.pinSide ?? "left",
        clampSize(preview.width, 2, minW, maxW),
        clampSize(preview.height, 2, minH, maxH),
        preview.isHex ?? false,
      );
      return {
        defaultSize: { width: probe.symbolWidth, height: probe.symbolHeight },
        isDisplay: probe.isDisplay,
        pins: mapCircuitPins(probe),
      };
    }
    if (type === "pin" || type === "pinIn" || type === "pinOut") {
      const isOut = type === "pinOut";
      const { pinCircuit } = createPinCircuit(
        "catalog-pin",
        "catalog-lc",
        isOut ? "output" : "input",
        preview.notation ?? preview.name ?? (isOut ? "Q" : "X"),
        preview.bitWidth ?? 1,
        preview.pinSide ?? (isOut ? "right" : "left"),
        preview.inverted ?? false,
        0,
        clampSize(preview.width, 2, minW, maxW),
        clampSize(preview.height, 2, minH, maxH),
      );
      return {
        defaultSize: { width: pinCircuit.symbolWidth, height: pinCircuit.symbolHeight },
        isDisplay: pinCircuit.isDisplay,
        pins: mapCircuitPins(pinCircuit),
      };
    }
  }

  const sandbox = createEmptyCircuitProject();
  const selection: PaletteSelection = {
    type,
    name: preview?.name ?? def.label,
    ...preview,
  };
  const { circuit } = instantiateCircuitFromPalette(
    sandbox,
    sandbox.logicalCircuits[0].logicalCircuitId,
    selection,
    { x: 0, y: 0 },
  );

  return {
    defaultSize: { width: circuit.symbolWidth, height: circuit.symbolHeight },
    isDisplay: circuit.isDisplay,
    pins: mapCircuitPins(circuit),
  };
}

export type SubCircuitCatalogItem = {
  logicalCircuitId: string;
  name: string;
  notation: string;
  category: string;
  note: string;
  circuitShape: LogicalCircuit["circuitShape"];
  isDisplay: boolean;
  showLabelAbove: boolean;
  displayMargin: NonNullable<LogicalCircuit["displayMargin"]>;
  symbolWidth: number;
  symbolHeight: number;
  pinCount: number;
  pins: (ComponentCatalogPin & { pinId: string; jamNotation: string })[];
};

export type ComponentCatalogResponse = {
  gridUnitPixels: number;
  categories: readonly ComponentPaletteCategory[];
  wiringNote: string;
  components: ComponentCatalogEntry[];
  subCircuits?: SubCircuitCatalogItem[];
};

export type BuildComponentCatalogOptions = {
  category?: ComponentPaletteCategory;
  type?: ComponentToolType;
  includeAliases?: boolean;
  includeSubCircuits?: boolean;
  preview?: ComponentPreviewParams;
  project?: CircuitProject;
};

// Baut den vollständigen, direkt aus dem Code abgeleiteten Komponenten-Katalog für Palette & MCP auf
export function buildComponentCatalog(options: BuildComponentCatalogOptions = {}): ComponentCatalogResponse {
  const {
    category,
    type,
    includeAliases = false,
    includeSubCircuits = true,
    preview,
    project,
  } = options;

  if (preview && !type) {
    throw new Error("Parameter \"preview\" kann nur zusammen mit \"type\" angegeben werden.");
  }

  const allEntries: [ComponentToolType, ComponentRegistryDefinition][] = [
    ...(Object.entries(PALETTE_GATE_REGISTRY) as [PaletteGateType, ComponentRegistryDefinition][]),
    ...(Object.entries(SPECIAL_COMPONENT_REGISTRY) as ["subCircuit" | "textNote", ComponentRegistryDefinition][]),
  ];

  const components: ComponentCatalogEntry[] = [];

  for (const [entryType, def] of allEntries) {
    if (type !== undefined && entryType !== type) {
      continue;
    }
    if (type === undefined && !includeAliases && def.aliasOf) {
      continue;
    }
    if (category !== undefined && def.paletteCategory !== category) {
      continue;
    }

    const effectivePreview = type === entryType ? preview : undefined;
    const geometry = inspectComponentGeometry(entryType, def, effectivePreview, project);

    components.push({
      type: entryType,
      paletteCategory: def.paletteCategory,
      label: def.label,
      description: def.description,
      paletteVisible: def.paletteVisible,
      ...(def.aliasOf ? { aliasOf: def.aliasOf } : {}),
      ...(def.hasVariableInputs ? { hasVariableInputs: true } : {}),
      defaultSize: geometry.defaultSize,
      resizable: def.resizable,
      ...(def.minSize ? { minSize: def.minSize } : {}),
      ...(def.maxSize ? { maxSize: def.maxSize } : {}),
      isDisplay: geometry.isDisplay,
      hasDynamicPinLayout: def.hasDynamicPinLayout,
      pinLayoutDependsOn: def.pinLayoutDependsOn,
      ...(def.wiringHint ? { wiringHint: def.wiringHint } : {}),
      pins: geometry.pins,
      properties: def.properties,
    });
  }

  const result: ComponentCatalogResponse = {
    gridUnitPixels: GRID_SIZE,
    categories: COMPONENT_PALETTE_CATEGORIES,
    wiringNote:
      "All coordinates are grid units (1 unit = 18 px). For components with 'hasDynamicPinLayout: true', size and pin " +
      "coordinates depend on parameters; when wiring in 'add_elements', { ref, pinName } or { ref, jamIndex } is recommended.",
    components,
  };

  if (includeSubCircuits && project) {
    result.subCircuits = project.logicalCircuits.map((lc) => {
      const resolved = resolveLogicalCircuitLayout(lc, project);
      return {
        logicalCircuitId: lc.logicalCircuitId,
        name: lc.name,
        notation: lc.notation,
        category: lc.category,
        note: lc.note,
        circuitShape: lc.circuitShape,
        isDisplay: lc.isDisplay,
        showLabelAbove: Boolean(lc.showLabelAbove),
        displayMargin: lc.displayMargin ?? "none",
        symbolWidth: resolved.symbolWidth,
        symbolHeight: resolved.symbolHeight,
        pinCount: resolved.pins.length,
        pins: resolved.pins.map((pin) => ({
          pinId: pin.pinId,
          name: pin.name,
          jamNotation: pin.jamNotation ?? "",
          pinType: pin.pinType,
          pinSide: pin.pinSide,
          bitWidth: pin.bitWidth,
          inverted: pin.inverted,
          gridPoint: { x: pin.gridPoint.x, y: pin.gridPoint.y },
        })),
      };
    });
  }

  return result;
}
