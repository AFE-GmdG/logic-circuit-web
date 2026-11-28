import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import CollabContext from "../../contexts/collabContext";
import LibraryContext from "../../contexts/libraryContext";
import SimulationContext from "../../contexts/simulationContext";

import type GridPoint from "../../types/canvas/gridPoint";
import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitPropertiesUpdate from "../../types/circuit/circuitPropertiesUpdate";
import type CircuitShape from "../../types/circuit/circuitShape";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type CircuitSymbolPropertiesUpdate from "../../types/circuit/circuitSymbolPropertiesUpdate";
import type Constant from "../../types/circuit/constant";
import type CreateCircuitInput from "../../types/circuit/createCircuitInput";
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
import type MemoryTextFormat from "../../types/circuit/memoryTextFormat";
import type Pin from "../../types/circuit/pin";
import type PinSide from "../../types/circuit/pinSide";
import type PinType from "../../types/circuit/pinType";
import type ProbeFormat from "../../types/circuit/probeFormat";
import type Sensor from "../../types/circuit/sensor";
import type SensorType from "../../types/circuit/sensorType";
import type Sound from "../../types/circuit/sound";
import type SoundWaveform from "../../types/circuit/soundWaveform";
import type Splitter from "../../types/circuit/splitter";
import type Synthesizer from "../../types/circuit/synthesizer";
import type SynthesizerMode from "../../types/circuit/synthesizerMode";
import type { CollabSoftLockEntry } from "../../types/collab/modelSyncMessage";

import {
  DEFAULT_RANDOM_DATA,
  normalizeSensorValue,
  parseHexUint,
  parseSensorSeries,
  saveSensorSeries,
  tryParseRandomRange,
} from "../../simulation/functions/io/functionSensor";
import {
  formatPitchTableCopyText,
  MIDI_PITCH_TABLE,
  resolveNoiseFilterFrequency,
  SOUND_DEFAULT_FREQUENCY,
  SOUND_MAX_FREQUENCY,
  SOUND_MIN_FREQUENCY,
} from "../../utils/audioPitchTable";
import { triggerBlobDownload } from "../../utils/circuitCapture";
import { circuitContainsDisplays, comparePins } from "../../utils/circuitLayout";
import { SOUND_WAVEFORMS, SYNTHESIZER_MODES } from "../../utils/componentCatalog";
import { GRID_SIZE } from "../../utils/coordinateSystem";
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
  getGraphicsArrayStrides,
  normalizeGraphicsArrayOnStart,
} from "../../utils/graphicsArrayUtils";
import {
  formatKeyGesture,
  getKeyboardEventModifiers,
  isModifierOnlyKey,
  keyboardEventToWpfKeyCode,
} from "../../utils/keyGesture";
import {
  clampAddressBitWidth,
  clampDataBitWidth,
  decodeMemoryData,
  encodeMemoryData,
  exportMemoryToBinary,
  exportMemoryToText,
  importBinaryIntoMemory,
  importTextIntoMemory,
  MEMORY_MAX_ADDRESS_BIT_WIDTH,
  MEMORY_MAX_DATA_BIT_WIDTH,
  numberCellsFor,
  reallocateMemoryData,
  setCellValue,
  totalBytesFor,
} from "../../utils/memoryDataUtils";

import MemoryDataGrid from "./memoryDataGrid";

export type PropertyDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  symbol?: CircuitSymbol | null;
  circuit?: LogicalCircuit | null;
  contextCircuits?: readonly LogicalCircuit[];
  isCreatingCircuit?: boolean;
  categories?: string[];
  initialPitchTableOpen?: boolean;
  accentVariant?: "default" | "library";
  customTitle?: string;
  customSaveLabel?: string;
  onSaveSymbol?: (symbolId: string, updates: CircuitSymbolPropertiesUpdate) => void;
  onSaveCircuit?: (circuitId: string, updates: CircuitPropertiesUpdate) => void;
  onCreateCircuit?: (input: CreateCircuitInput) => void;
  onClose: () => void;
};

const GATE_INPUT_OPTIONS = [2, 3, 4, 5, 6, 7, 8];
const GRAPHICS_ZOOM_OPTIONS = Array.from(
  { length: GRAPHICS_ARRAY_MAX_ZOOM - GRAPHICS_ARRAY_MIN_ZOOM + 1 },
  (_, i) => GRAPHICS_ARRAY_MIN_ZOOM + i,
);

// Parst eine strenge nicht-negative Ganzzahl innerhalb der angegebenen Grenzen
function parsePositiveIntInRange(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

// Zeichnet ein kompaktes Miniatur-SVG-Icon für jede Subschaltungs-Symbolform
function renderCircuitShapeMiniIcon(shape: CircuitShape): React.ReactNode {
  switch (shape) {
    case "flipFlop":
      return (
        <svg width={28} height={20} viewBox="0 0 28 20" aria-hidden="true" className="shape-preview-svg">
          <rect x={2} y={2} width={24} height={16} rx={2} />
          <line x1={8} y1={2} x2={8} y2={18} />
        </svg>
      );
    case "mux":
      return (
        <svg width={28} height={20} viewBox="0 0 28 20" aria-hidden="true" className="shape-preview-svg">
          <polygon points="3,2 25,6 25,14 3,18" />
        </svg>
      );
    case "demux":
      return (
        <svg width={28} height={20} viewBox="0 0 28 20" aria-hidden="true" className="shape-preview-svg">
          <polygon points="3,6 25,2 25,18 3,14" />
        </svg>
      );
    case "alu":
      return (
        <svg width={28} height={20} viewBox="0 0 28 20" aria-hidden="true" className="shape-preview-svg">
          <polygon points="3,2 25,5 25,15 3,18 3,13 9,10 3,7" />
        </svg>
      );
    case "display":
      return (
        <svg width={28} height={20} viewBox="0 0 28 20" aria-hidden="true" className="shape-preview-svg">
          <rect x={2} y={2} width={24} height={16} rx={2} />
          <circle cx={10} cy={10} r={3.2} className="shape-preview-accent" />
          <rect x={16} y={7} width={6} height={6} rx={1} className="shape-preview-accent" />
        </svg>
      );
    case "rectangular":
    default:
      return (
        <svg width={28} height={20} viewBox="0 0 28 20" aria-hidden="true" className="shape-preview-svg">
          <rect x={2} y={2} width={24} height={16} rx={2} />
        </svg>
      );
  }
}

// Ermittelt alle Pins und internen Pin-Symbolkoordinaten einer logischen Schaltung
function resolveCircuitPinState(
  lc: LogicalCircuit | null,
  projectPins?: readonly Pin[],
): { pins: Pin[]; symbolCoords: Map<string, GridPoint> } {
  const symbolCoords = new Map<string, GridPoint>();
  if (!lc) {
    return { pins: [], symbolCoords };
  }

  for (const sym of lc.circuitSymbols) {
    if (sym.circuit.kind === "pin") {
      symbolCoords.set(sym.circuit.circuitId, { x: sym.x, y: sym.y });
    }
  }

  const pinMap = new Map<string, Pin>();
  if (projectPins) {
    for (const p of projectPins) {
      if (p.circuitId === lc.logicalCircuitId) {
        pinMap.set(p.pinId, { ...p });
      }
    }
  }
  for (const p of lc.logicalPins) {
    if (!pinMap.has(p.pinId)) {
      pinMap.set(p.pinId, { ...p });
    }
  }
  if (pinMap.size === 0) {
    for (const p of lc.pins) {
      if ((p as Partial<Pin>).kind === "pin") {
        pinMap.set(p.pinId, { ...(p as Pin) });
      }
    }
  }

  return {
    pins: Array.from(pinMap.values()),
    symbolCoords,
  };
}

// Liest die echten Pin-Eigenschaften (statt des invertierten internen DevicePins) fuer den Dialog aus
function resolvePinFormValues(
  circ: CircuitSymbol["circuit"],
  projectPins?: readonly Pin[],
): {
  name: string;
  jamNotation: string;
  pinType: PinType;
  bitWidth: number;
  pinSide: PinSide;
  inverted: boolean;
} {
  const realPin = projectPins?.find((entry) => entry.pinId === circ.circuitId);
  if (realPin) {
    return {
      name: realPin.name,
      jamNotation: realPin.jamNotation ?? "",
      pinType: realPin.pinType,
      bitWidth: realPin.bitWidth,
      pinSide: realPin.pinSide,
      inverted: realPin.inverted,
    };
  }
  const internalPin = circ.pins[0];
  const fallbackPin = circ as unknown as Partial<Pin>;
  const inferredType: PinType =
    fallbackPin.pinType ??
    (internalPin?.pinType === "input"
      ? "output"
      : internalPin?.pinType === "output"
        ? "input"
        : circ.notation.startsWith("Out:") || circ.name.toLowerCase().includes("out")
          ? "output"
          : "input");
  return {
    name: fallbackPin.name ?? circ.name ?? "",
    jamNotation: fallbackPin.jamNotation ?? internalPin?.jamNotation ?? "",
    pinType: inferredType,
    bitWidth: fallbackPin.bitWidth ?? internalPin?.bitWidth ?? 1,
    pinSide: fallbackPin.pinSide ?? (inferredType === "output" ? "right" : "left"),
    inverted: fallbackPin.inverted ?? internalPin?.inverted ?? false,
  };
}

const PropertyDialog = styled(({
  isOpen,
  symbol,
  circuit,
  isCreatingCircuit = false,
  categories,
  initialPitchTableOpen = false,
  accentVariant = "default",
  customTitle,
  customSaveLabel,
  contextCircuits,
  onSaveSymbol,
  onSaveCircuit,
  onCreateCircuit,
  onClose,
  ...other
}: PropertyDialogProps) => {
  const { t, i18n } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const collabContext = React.useContext(CollabContext);
  const libraryContext = React.useContext(LibraryContext);
  const simulationContext = React.useContext(SimulationContext);

  const isLibraryContext = accentVariant === "library" || Boolean(libraryContext?.isEditingLibrary);
  const isSharedCollabTarget = Boolean(
    isOpen && !isCreatingCircuit && !isLibraryContext && collabContext?.isInSession,
  );
  const lockTargetType = symbol ? ("symbol" as const) : circuit ? ("logicalCircuit" as const) : null;
  const lockTargetId = symbol ? symbol.circuitSymbolId : circuit ? circuit.logicalCircuitId : undefined;
  const lockTargetCircuitId = symbol ? symbol.logicalCircuitId : circuit ? circuit.logicalCircuitId : undefined;
  const isCollabReadOnly = Boolean(
    isSharedCollabTarget &&
    (collabContext?.modelSyncState?.isReadOnlyForGuest || collabContext?.modelSyncState?.isQuiesced),
  );
  const foreignLock: CollabSoftLockEntry | null = React.useMemo(
    () => {
      if (!isSharedCollabTarget || !lockTargetType || !lockTargetId) {
        return null;
      }
      const liveMatch = (collabContext?.modelSyncState?.softLocks ?? []).find(
        (lock) =>
          lock.targetType === lockTargetType &&
          lock.targetId === lockTargetId &&
          lock.ownerPeerId !== collabContext?.selfPeerId,
      );
      return liveMatch ?? collabContext?.getForeignLockForTarget?.(lockTargetType, lockTargetId) ?? null;
    },
    [
      collabContext,
      isSharedCollabTarget,
      lockTargetId,
      lockTargetType,
    ],
  );
  const isDialogReadOnly = isCollabReadOnly || foreignLock !== null;
  const acquireSoftLocks = collabContext?.acquireSoftLocks;
  const releaseSoftLocks = collabContext?.releaseSoftLocks;

  React.useEffect(
    () => {
      if (
        !isSharedCollabTarget ||
        !lockTargetType ||
        !lockTargetId ||
        !lockTargetCircuitId ||
        isCollabReadOnly
      ) {
        return undefined;
      }
      const target = {
        targetType: lockTargetType,
        targetId: lockTargetId,
        logicalCircuitId: lockTargetCircuitId,
      };
      const result = acquireSoftLocks?.([target], "property-dialog");
      if (result && !result.ok) {
        return undefined;
      }
      return () => {
        releaseSoftLocks?.([{ targetType: lockTargetType, targetId: lockTargetId }]);
      };
    },
    [
      acquireSoftLocks,
      isCollabReadOnly,
      isSharedCollabTarget,
      lockTargetCircuitId,
      lockTargetId,
      lockTargetType,
      releaseSoftLocks,
    ],
  );

  const pinSideOptions: { value: PinSide; label: string }[] = [
    { value: "right", label: t("common.pinSideDefaultRight") },
    { value: "left", label: t("common.pinSides.left") },
    { value: "top", label: t("common.pinSides.top") },
    { value: "bottom", label: t("common.pinSides.bottom") },
  ];

  const displayColorOptions: { value: DisplayColor; label: string }[] = [
    { value: "red", label: t("common.colors.redDefault") },
    { value: "yellow", label: t("common.colors.yellow") },
    { value: "green", label: t("common.colors.green") },
    { value: "blue", label: t("common.colors.blue") },
  ];

  const sensorTypeOptions: { value: SensorType; label: string }[] = [
    { value: "random", label: t("dialog.property.sensorTypes.random") },
    { value: "manual", label: t("dialog.property.sensorTypes.manual") },
    { value: "series", label: t("dialog.property.sensorTypes.series") },
    { value: "loop", label: t("dialog.property.sensorTypes.loop") },
    { value: "ascii", label: t("dialog.property.sensorTypes.ascii") },
    { value: "keyCode", label: t("dialog.property.sensorTypes.keyCode") },
    { value: "sequence", label: t("dialog.property.sensorTypes.sequence") },
    { value: "clock", label: t("dialog.property.sensorTypes.clock") },
  ];

  const soundWaveformOptions: { value: SoundWaveform; label: string }[] = SOUND_WAVEFORMS.map((wf) => ({
    value: wf,
    label: t(`common.soundWaveforms.${wf}`),
  }));

  const synthesizerModeOptions: { value: SynthesizerMode; label: string }[] = SYNTHESIZER_MODES.map((m) => ({
    value: m,
    label: t(`common.synthesizerModes.${m}`),
  }));

  const circuitShapeOptions: { value: CircuitShape; label: string }[] = [
    { value: "rectangular", label: t("dialog.property.shapes.rectangular") },
    { value: "flipFlop", label: t("dialog.property.shapes.flipFlop") },
    { value: "mux", label: t("dialog.property.shapes.mux") },
    { value: "demux", label: t("dialog.property.shapes.demux") },
    { value: "alu", label: t("dialog.property.shapes.alu") },
    { value: "display", label: t("dialog.property.shapes.display") },
  ];

  const displayMarginOptions: { value: DisplayMargin; label: string }[] = [
    { value: "none", label: t("dialog.property.displayMargins.none") },
    { value: "horizontal", label: t("dialog.property.displayMargins.horizontal") },
    { value: "vertical", label: t("dialog.property.displayMargins.vertical") },
    { value: "all", label: t("dialog.property.displayMargins.all") },
  ];

  const pinOrderSides: { side: PinSide; label: string }[] = [
    { side: "top", label: t("common.pinSides.top") },
    { side: "left", label: t("common.pinSides.left") },
    { side: "right", label: t("common.pinSides.right") },
    { side: "bottom", label: t("common.pinSides.bottom") },
  ];

  // Sammelt alle bekannten Kategorien aus dem Projekt für die Autovervollständigung
  const availableCategories = React.useMemo(
    () => {
      const set = new Set<string>();
      if (categories) {
        for (const cat of categories) {
          const trimmed = cat.trim();
          if (trimmed) {
            set.add(trimmed);
          }
        }
      }
      if (circuitContext?.project?.logicalCircuits) {
        for (const lc of circuitContext.project.logicalCircuits) {
          const trimmed = lc.category?.trim();
          if (trimmed) {
            set.add(trimmed);
          }
        }
      }
      const currentCat = (
        circuit?.category ??
        (symbol?.circuit.kind === "logicalCircuit" ? (symbol.circuit as LogicalCircuit).category : undefined)
      )?.trim();
      if (currentCat) {
        set.add(currentCat);
      }
      return Array.from(set).sort((a, b) =>
        a.localeCompare(b, i18n.language || "de", { sensitivity: "base" }),
      );
    },
    [
      categories,
      circuit,
      circuitContext?.project?.logicalCircuits,
      i18n.language,
      symbol,
    ],
  );

  // Gate-spezifische Formularfelder
  const [gateType, setGateType] = React.useState<GateType>(() => {
    if (symbol?.circuit.kind === "gate") {
      return (symbol.circuit as Gate).gateType ?? "and";
    }
    return "and";
  });
  const [gateInputCount, setGateInputCount] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "gate") {
      return (symbol.circuit as Gate).inputCount ?? 2;
    }
    return 2;
  });
  const [gateInvertedOutput, setGateInvertedOutput] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "gate") {
      return (symbol.circuit as Gate).invertedOutput ?? false;
    }
    return false;
  });
  const [displayColor, setDisplayColor] = React.useState<DisplayColor>(() => {
    if (symbol?.circuit.kind === "gate") {
      return (symbol.circuit as Gate).color ?? "red";
    }
    return "red";
  });

  // LED-Matrix-spezifische Formularfelder
  const [matrixRows, setMatrixRows] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "ledMatrix") {
      return (symbol.circuit as LedMatrix).rows ?? 4;
    }
    return 4;
  });
  const [matrixColumns, setMatrixColumns] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "ledMatrix") {
      return (symbol.circuit as LedMatrix).columns ?? 4;
    }
    return 4;
  });
  const [matrixType, setMatrixType] = React.useState<LedMatrixType>(() => {
    if (symbol?.circuit.kind === "ledMatrix") {
      return (symbol.circuit as LedMatrix).matrixType ?? "individual";
    }
    return "individual";
  });
  const [matrixCellShape, setMatrixCellShape] = React.useState<LedMatrixCellShape>(() => {
    if (symbol?.circuit.kind === "ledMatrix") {
      return (symbol.circuit as LedMatrix).cellShape ?? "round";
    }
    return "round";
  });
  const [matrixColors, setMatrixColors] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "ledMatrix") {
      return (symbol.circuit as LedMatrix).colors ?? 1;
    }
    return 1;
  });
  const [matrixPersistence, setMatrixPersistence] = React.useState<1 | 2 | 3>(() => {
    if (symbol?.circuit.kind === "ledMatrix") {
      return (symbol.circuit as LedMatrix).persistenceMultiplier ?? 1;
    }
    return 1;
  });

  // Button-spezifische Formularfelder
  const [buttonIsToggle, setButtonIsToggle] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "circuitButton") {
      return (symbol.circuit as CircuitButton).isToggle ?? false;
    }
    return false;
  });
  const [buttonNotation, setButtonNotation] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "circuitButton") {
      return (symbol.circuit as CircuitButton).notation ?? "";
    }
    return "";
  });
  const [buttonInverted, setButtonInverted] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "circuitButton") {
      return (symbol.circuit as CircuitButton).inverted ?? false;
    }
    return false;
  });
  const [buttonPinSide, setButtonPinSide] = React.useState<PinSide>(() => {
    if (symbol?.circuit.kind === "circuitButton") {
      return (symbol.circuit as CircuitButton).pinSide ?? "right";
    }
    return "right";
  });
  const [buttonKeyCode, setButtonKeyCode] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "circuitButton") {
      return (symbol.circuit as CircuitButton).keyCode ?? 0;
    }
    return 0;
  });
  const [buttonModifiers, setButtonModifiers] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "circuitButton") {
      return (symbol.circuit as CircuitButton).modifiers ?? 0;
    }
    return 0;
  });
  const [isCapturingShortcut, setIsCapturingShortcut] = React.useState<boolean>(false);

  // Constant-spezifische Formularfelder
  const [constantBitWidth, setConstantBitWidth] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "constant") {
      return (symbol.circuit as Constant).bitWidth ?? 1;
    }
    return 1;
  });
  const [constantIsHex, setConstantIsHex] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "constant") {
      return (symbol.circuit as Constant).isHex ?? true;
    }
    return true;
  });
  const [constantValueStr, setConstantValueStr] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "constant") {
      const c = symbol.circuit as Constant;
      const isHex = c.isHex ?? true;
      return c.value !== undefined
        ? (isHex ? c.value.toString(16).toUpperCase() : c.value.toString(10))
        : "0";
    }
    return "0";
  });
  const [constantPinSide, setConstantPinSide] = React.useState<PinSide>(() => {
    if (symbol?.circuit.kind === "constant") {
      return (symbol.circuit as Constant).pinSide ?? "right";
    }
    return "right";
  });

  // Pin-spezifische Formularfelder
  const [pinName, setPinName] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "pin") {
      return resolvePinFormValues(symbol.circuit, circuitContext?.project?.pins).name;
    }
    return "";
  });
  const [pinJamNotation, setPinJamNotation] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "pin") {
      return resolvePinFormValues(symbol.circuit, circuitContext?.project?.pins).jamNotation;
    }
    return "";
  });
  const [pinType, setPinType] = React.useState<PinType>(() => {
    if (symbol?.circuit.kind === "pin") {
      return resolvePinFormValues(symbol.circuit, circuitContext?.project?.pins).pinType;
    }
    return "input";
  });
  const [pinBitWidth, setPinBitWidth] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "pin") {
      return resolvePinFormValues(symbol.circuit, circuitContext?.project?.pins).bitWidth;
    }
    return 1;
  });
  const [pinSide, setPinSide] = React.useState<PinSide>(() => {
    if (symbol?.circuit.kind === "pin") {
      return resolvePinFormValues(symbol.circuit, circuitContext?.project?.pins).pinSide;
    }
    return "left";
  });
  const [pinInverted, setPinInverted] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "pin") {
      return resolvePinFormValues(symbol.circuit, circuitContext?.project?.pins).inverted;
    }
    return false;
  });

  // Probe-spezifische Formularfelder
  const [probeName, setProbeName] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "circuitProbe") {
      const probe = symbol.circuit as CircuitProbe;
      return probe.name.trim().toLowerCase() === probe.circuitProbeId.toLowerCase() ? "" : (probe.name ?? "");
    }
    return "";
  });
  const [probePinSide, setProbePinSide] = React.useState<PinSide>(() => {
    if (symbol?.circuit.kind === "circuitProbe") {
      return (symbol.circuit as CircuitProbe).pinSide ?? "left";
    }
    return "left";
  });
  const [probeFormat, setProbeFormat] = React.useState<ProbeFormat>(() => {
    if (symbol?.circuit.kind === "circuitProbe") {
      const probe = symbol.circuit as CircuitProbe;
      return probe.displayFormat ?? (probe.isHex ? "hex" : "bin");
    }
    return "bin";
  });

  // Splitter-spezifische Formularfelder
  const [splitterPinCount, setSplitterPinCount] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "splitter") {
      return (symbol.circuit as Splitter).pinCount ?? 3;
    }
    return 3;
  });
  const [splitterPinBitWidth, setSplitterPinBitWidth] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "splitter") {
      const s = symbol.circuit as Splitter;
      return Math.max(1, Math.floor(s.bitWidth / s.pinCount));
    }
    return 1;
  });
  const [splitterClockwise, setSplitterClockwise] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "splitter") {
      return (symbol.circuit as Splitter).clockwise ?? true;
    }
    return true;
  });

  // Sensor-spezifische Formularfelder
  const [sensorType, setSensorType] = React.useState<SensorType>(() => {
    if (symbol?.circuit.kind === "sensor") {
      return (symbol.circuit as Sensor).sensorType ?? "random";
    }
    return "random";
  });
  const [sensorBitWidth, setSensorBitWidth] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "sensor") {
      return (symbol.circuit as Sensor).bitWidth ?? 1;
    }
    return 1;
  });
  const [sensorPinSide, setSensorPinSide] = React.useState<PinSide>(() => {
    if (symbol?.circuit.kind === "sensor") {
      return (symbol.circuit as Sensor).pinSide ?? "right";
    }
    return "right";
  });
  const [sensorNotation, setSensorNotation] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "sensor") {
      return (symbol.circuit as Sensor).notation ?? "";
    }
    return "";
  });
  const [sensorData, setSensorData] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "sensor") {
      return (symbol.circuit as Sensor).data ?? DEFAULT_RANDOM_DATA;
    }
    return DEFAULT_RANDOM_DATA;
  });
  const [sensorError, setSensorError] = React.useState<string | null>(null);

  // Sound- und Synthesizer-spezifische Formularfelder
  const [soundNotation, setSoundNotation] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "sound") {
      return (symbol.circuit as Sound).notation ?? "";
    }
    return "";
  });
  const [soundPinSide, setSoundPinSide] = React.useState<PinSide>(() => {
    if (symbol?.circuit.kind === "sound") {
      return (symbol.circuit as Sound).pinSide ?? "left";
    }
    return "left";
  });
  const [soundWaveform, setSoundWaveform] = React.useState<SoundWaveform>(() => {
    if (symbol?.circuit.kind === "sound") {
      return (symbol.circuit as Sound).waveform ?? "sine";
    }
    return "sine";
  });
  const [soundFrequencyStr, setSoundFrequencyStr] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "sound") {
      return String((symbol.circuit as Sound).frequency ?? SOUND_DEFAULT_FREQUENCY);
    }
    return String(SOUND_DEFAULT_FREQUENCY);
  });
  const [soundError, setSoundError] = React.useState<string | null>(null);

  const [synthesizerNotation, setSynthesizerNotation] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "synthesizer") {
      return (symbol.circuit as Synthesizer).notation ?? "";
    }
    return "";
  });
  const [synthesizerMode, setSynthesizerMode] = React.useState<SynthesizerMode>(() => {
    if (symbol?.circuit.kind === "synthesizer") {
      return (symbol.circuit as Synthesizer).mode ?? "square";
    }
    return "square";
  });
  const [isPitchTableOpen, setIsPitchTableOpen] = React.useState<boolean>(initialPitchTableOpen);
  const [pitchTableCopied, setPitchTableCopied] = React.useState<boolean>(false);

  // Speicher-spezifische Formularfelder (ROM & RAM)
  const [memoryAddressBitWidth, setMemoryAddressBitWidth] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "memory") {
      return (symbol.circuit as Memory).addressBitWidth ?? 8;
    }
    return 8;
  });
  const [memoryDataBitWidth, setMemoryDataBitWidth] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "memory") {
      return (symbol.circuit as Memory).dataBitWidth ?? 8;
    }
    return 8;
  });
  const [memoryWriteOn1, setMemoryWriteOn1] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "memory") {
      return (symbol.circuit as Memory).writeOn1 ?? false;
    }
    return false;
  });
  const [memoryOnStart, setMemoryOnStart] = React.useState<MemoryOnStart>(() => {
    if (symbol?.circuit.kind === "memory") {
      const m = symbol.circuit as Memory;
      return m.writable ? (m.onStart ?? "random") : "data";
    }
    return "random";
  });
  const [memoryDualPort, setMemoryDualPort] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "memory") {
      return (symbol.circuit as Memory).dualPort ?? false;
    }
    return false;
  });
  const [memoryBytes, setMemoryBytes] = React.useState<Uint8Array>(() => {
    if (symbol?.circuit.kind === "memory") {
      const m = symbol.circuit as Memory;
      return decodeMemoryData(m.data, m.addressBitWidth, m.dataBitWidth);
    }
    return new Uint8Array(256);
  });
  const [memoryFormat, setMemoryFormat] = React.useState<MemoryTextFormat>("hex");
  const [memoryFileFormat, setMemoryFileFormat] = React.useState<MemoryTextFormat>("hex");
  const [memoryGridPage, setMemoryGridPage] = React.useState<number>(0);
  const [memoryFileError, setMemoryFileError] = React.useState<string | null>(null);
  const [memoryFileNotice, setMemoryFileNotice] = React.useState<string | null>(null);
  const binaryMemoryInputRef = React.useRef<HTMLInputElement | null>(null);
  const textMemoryInputRef = React.useRef<HTMLInputElement | null>(null);

  // Grafisches-Display-spezifische Formularfelder (GraphicsArray)
  const [gaWriteOn1, setGaWriteOn1] = React.useState<boolean>(() => {
    if (symbol?.circuit.kind === "graphicsArray") {
      return (symbol.circuit as GraphicsArray).writeOn1 ?? false;
    }
    return false;
  });
  const [gaOnStart, setGaOnStart] = React.useState<"random" | "zeros" | "ones">(() => {
    if (symbol?.circuit.kind === "graphicsArray") {
      return normalizeGraphicsArrayOnStart((symbol.circuit as GraphicsArray).onStart);
    }
    return "zeros";
  });
  const [gaDataBitWidth, setGaDataBitWidth] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "graphicsArray") {
      return (symbol.circuit as GraphicsArray).dataBitWidth ?? GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH;
    }
    return GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH;
  });
  const [gaBitsPerPixel, setGaBitsPerPixel] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "graphicsArray") {
      return (symbol.circuit as GraphicsArray).bitsPerPixel ?? GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL;
    }
    return GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL;
  });
  const [gaWidthStr, setGaWidthStr] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "graphicsArray") {
      return String((symbol.circuit as GraphicsArray).width ?? GRAPHICS_ARRAY_DEFAULT_WIDTH);
    }
    return String(GRAPHICS_ARRAY_DEFAULT_WIDTH);
  });
  const [gaHeightStr, setGaHeightStr] = React.useState<string>(() => {
    if (symbol?.circuit.kind === "graphicsArray") {
      return String((symbol.circuit as GraphicsArray).height ?? GRAPHICS_ARRAY_DEFAULT_HEIGHT);
    }
    return String(GRAPHICS_ARRAY_DEFAULT_HEIGHT);
  });
  const [gaZoom, setGaZoom] = React.useState<number>(() => {
    if (symbol?.circuit.kind === "graphicsArray") {
      return (symbol.circuit as GraphicsArray).zoom ?? GRAPHICS_ARRAY_DEFAULT_ZOOM;
    }
    return GRAPHICS_ARRAY_DEFAULT_ZOOM;
  });

  const effectiveProjectPins = contextCircuits ? undefined : circuitContext?.project?.pins;

  const initialTargetCircuit = React.useMemo(
    () => {
      const raw = circuit ?? (symbol?.circuit.kind === "logicalCircuit" ? (symbol.circuit as LogicalCircuit) : null);
      if (!raw) {
        return null;
      }
      const sourceCircuits = contextCircuits ?? circuitContext?.project?.logicalCircuits;
      return sourceCircuits?.find(
        (lc) => lc.logicalCircuitId === raw.logicalCircuitId,
      ) ?? raw;
    },
    [
      circuit,
      circuitContext?.project?.logicalCircuits,
      contextCircuits,
      symbol,
    ],
  );

  // Circuit-spezifische Formularfelder
  const [circuitTab, setCircuitTab] = React.useState<"schematic" | "pinOrder">("schematic");
  const [circuitName, setCircuitName] = React.useState<string>(
    () => initialTargetCircuit?.name ?? (isCreatingCircuit ? t("dialog.property.newCircuitDefaultName") : ""),
  );
  const [circuitNotation, setCircuitNotation] = React.useState<string>(
    () => initialTargetCircuit?.notation ?? (isCreatingCircuit ? t("dialog.property.newCircuitDefaultName") : ""),
  );
  const [circuitNotationTouched, setCircuitNotationTouched] = React.useState<boolean>(false);
  const [circuitCategory, setCircuitCategory] = React.useState<string>(
    () => initialTargetCircuit?.category ?? "",
  );
  const [circuitNote, setCircuitNote] = React.useState<string>(
    () => initialTargetCircuit?.note ?? "",
  );
  const [circuitShape, setCircuitShape] = React.useState<CircuitShape>(
    () => initialTargetCircuit?.circuitShape ?? (initialTargetCircuit?.isDisplay ? "display" : "rectangular"),
  );
  const [circuitShowLabelAbove, setCircuitShowLabelAbove] = React.useState<boolean>(
    () => Boolean(initialTargetCircuit?.showLabelAbove),
  );
  const [circuitShowLabelAboveTouched, setCircuitShowLabelAboveTouched] = React.useState<boolean>(false);
  const [circuitDisplayMargin, setCircuitDisplayMargin] = React.useState<DisplayMargin>(
    () => initialTargetCircuit?.displayMargin ?? "none",
  );
  const [circuitExportToHDL, setCircuitExportToHDL] = React.useState<boolean>(
    () => initialTargetCircuit?.exportToHDL ?? true,
  );
  const [pinOrderDraft, setPinOrderDraft] = React.useState<Pin[]>(
    () => resolveCircuitPinState(initialTargetCircuit, effectiveProjectPins).pins,
  );
  const [useGraphicalPinOrder, setUseGraphicalPinOrder] = React.useState<boolean>(() => {
    const { pins } = resolveCircuitPinState(initialTargetCircuit, effectiveProjectPins);
    return pins.every((p) => (p.index ?? 0) === 0);
  });
  const [selectedPinIdBySide, setSelectedPinIdBySide] = React.useState<Partial<Record<PinSide, string>>>({});

  // Allgemeine Notiz für Bauteile
  const [generalNote, setGeneralNote] = React.useState<string>(() => {
    return symbol?.circuit.note ?? "";
  });

  // Prüft anhand des übergebenen Kontexts (Projekt oder Bibliothek), ob Display-Bauteile vorliegen
  const canUseDisplayShape = React.useMemo(
    () => {
      if (!initialTargetCircuit) {
        return false;
      }
      const sourceCircuits = contextCircuits ?? circuitContext?.project?.logicalCircuits;
      const lcMap = sourceCircuits
        ? new Map(sourceCircuits.map((lc) => [lc.logicalCircuitId, lc]))
        : undefined;
      return circuitContainsDisplays(initialTargetCircuit, lcMap);
    },
    [
      circuitContext?.project?.logicalCircuits,
      contextCircuits,
      initialTargetCircuit,
    ],
  );

  // Interne Koordinaten der Pin-Symbole für die grafische Sortierung
  const pinSymbolCoords = React.useMemo(
    () => resolveCircuitPinState(initialTargetCircuit, effectiveProjectPins).symbolCoords,
    [effectiveProjectPins, initialTargetCircuit],
  );

  // Nach Bauteilseite sortierte Pin-Listen für den Pin-Reihenfolge-Editor
  const pinsBySide = React.useMemo(
    () => {
      const grouped: Record<PinSide, Pin[]> = {
        left: [],
        right: [],
        top: [],
        bottom: [],
      };
      for (const pin of pinOrderDraft) {
        const side: PinSide = pin.pinSide ?? "left";
        grouped[side].push(pin);
      }
      for (const side of ["left", "right", "top", "bottom"] as PinSide[]) {
        grouped[side].sort((a, b) => comparePins(a, b, pinSymbolCoords));
      }
      return grouped;
    },
    [pinOrderDraft, pinSymbolCoords],
  );

  const effectiveSelectedPinIdBySide = React.useMemo(
    () => {
      const result: Partial<Record<PinSide, string>> = {};
      for (const side of ["left", "right", "top", "bottom"] as PinSide[]) {
        const list = pinsBySide[side];
        const currentSel = selectedPinIdBySide[side];
        if (currentSel && list.some((p) => p.pinId === currentSel)) {
          result[side] = currentSel;
        } else if (list.length > 0) {
          result[side] = list[0].pinId;
        }
      }
      return result;
    },
    [pinsBySide, selectedPinIdBySide],
  );

  // Formularwerte bei Öffnung mit aktuellen Daten des ausgewählten Objekts synchronisieren
  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }

      if (symbol) {
        const circ = symbol.circuit;
        setGeneralNote(circ.note ?? "");

        if (circ.kind === "gate") {
          const gate = circ as Gate;
          setGateType(gate.gateType ?? "and");
          setGateInputCount(gate.inputCount ?? 2);
          setGateInvertedOutput(gate.invertedOutput ?? false);
          setDisplayColor(gate.color ?? "red");
        } else if (circ.kind === "ledMatrix") {
          const matrix = circ as LedMatrix;
          setMatrixRows(matrix.rows ?? 4);
          setMatrixColumns(matrix.columns ?? 4);
          setMatrixType(matrix.matrixType ?? "individual");
          setMatrixCellShape(matrix.cellShape ?? "round");
          setMatrixColors(matrix.colors ?? 1);
          setMatrixPersistence(matrix.persistenceMultiplier ?? 1);
        } else if (circ.kind === "circuitButton") {
          const button = circ as CircuitButton;
          setButtonIsToggle(button.isToggle ?? false);
          setButtonNotation(button.notation ?? "");
          setButtonInverted(button.inverted ?? false);
          setButtonPinSide(button.pinSide ?? "right");
          setButtonKeyCode(button.keyCode ?? 0);
          setButtonModifiers(button.modifiers ?? 0);
          setIsCapturingShortcut(false);
        } else if (circ.kind === "constant") {
          const constant = circ as Constant;
          const isHex = constant.isHex ?? true;
          setConstantBitWidth(constant.bitWidth ?? 1);
          setConstantIsHex(isHex);
          setConstantValueStr(
            constant.value !== undefined
              ? (isHex ? constant.value.toString(16).toUpperCase() : constant.value.toString(10))
              : "0",
          );
          setConstantPinSide(constant.pinSide ?? "right");
        } else if (circ.kind === "pin") {
          const pinValues = resolvePinFormValues(circ, circuitContext?.project?.pins);
          setPinName(pinValues.name);
          setPinJamNotation(pinValues.jamNotation);
          setPinType(pinValues.pinType);
          setPinBitWidth(pinValues.bitWidth);
          setPinSide(pinValues.pinSide);
          setPinInverted(pinValues.inverted);
        } else if (circ.kind === "circuitProbe") {
          const probe = circ as CircuitProbe;
          const isUnnamed = probe.name.trim().toLowerCase() === probe.circuitProbeId.toLowerCase();
          setProbeName(isUnnamed ? "" : (probe.name ?? ""));
          setProbePinSide(probe.pinSide ?? "left");
          setProbeFormat(probe.displayFormat ?? (probe.isHex ? "hex" : "bin"));
        } else if (circ.kind === "splitter") {
          const s = circ as Splitter;
          setSplitterPinCount(s.pinCount ?? 3);
          setSplitterPinBitWidth(Math.max(1, Math.floor(s.bitWidth / s.pinCount)));
          setSplitterClockwise(s.clockwise ?? true);
        } else if (circ.kind === "sensor") {
          const s = circ as Sensor;
          setSensorType(s.sensorType ?? "random");
          setSensorBitWidth(s.bitWidth ?? 1);
          setSensorPinSide(s.pinSide ?? "right");
          setSensorNotation(s.notation ?? "");
          setSensorData(s.data ?? "");
          setSensorError(null);
        } else if (circ.kind === "sound") {
          const sound = circ as Sound;
          setSoundNotation(sound.notation ?? "");
          setSoundPinSide(sound.pinSide ?? "left");
          setSoundWaveform(sound.waveform ?? "sine");
          setSoundFrequencyStr(String(sound.frequency ?? SOUND_DEFAULT_FREQUENCY));
          setSoundError(null);
        } else if (circ.kind === "synthesizer") {
          const synth = circ as Synthesizer;
          setSynthesizerNotation(synth.notation ?? "");
          setSynthesizerMode(synth.mode ?? "square");
          setIsPitchTableOpen(initialPitchTableOpen);
          setPitchTableCopied(false);
        } else if (circ.kind === "memory") {
          const mem = circ as Memory;
          setMemoryAddressBitWidth(mem.addressBitWidth);
          setMemoryDataBitWidth(mem.dataBitWidth);
          setMemoryWriteOn1(mem.writeOn1);
          setMemoryOnStart(mem.writable ? mem.onStart : "data");
          setMemoryDualPort(mem.dualPort);
          setMemoryBytes(decodeMemoryData(mem.data, mem.addressBitWidth, mem.dataBitWidth));
          setMemoryGridPage(0);
          setMemoryFileError(null);
          setMemoryFileNotice(null);
        } else if (circ.kind === "graphicsArray") {
          const ga = circ as GraphicsArray;
          setGaWriteOn1(ga.writeOn1 ?? false);
          setGaOnStart(normalizeGraphicsArrayOnStart(ga.onStart));
          setGaDataBitWidth(ga.dataBitWidth ?? GRAPHICS_ARRAY_DEFAULT_DATA_BIT_WIDTH);
          setGaBitsPerPixel(ga.bitsPerPixel ?? GRAPHICS_ARRAY_DEFAULT_BITS_PER_PIXEL);
          setGaWidthStr(String(ga.width ?? GRAPHICS_ARRAY_DEFAULT_WIDTH));
          setGaHeightStr(String(ga.height ?? GRAPHICS_ARRAY_DEFAULT_HEIGHT));
          setGaZoom(ga.zoom ?? GRAPHICS_ARRAY_DEFAULT_ZOOM);
        } else if (circ.kind === "logicalCircuit") {
          const lc = initialTargetCircuit ?? (circ as LogicalCircuit);
          const { pins } = resolveCircuitPinState(lc, effectiveProjectPins);
          setCircuitTab("schematic");
          setCircuitName(lc.name ?? "");
          setCircuitNotation(lc.notation ?? "");
          setCircuitNotationTouched(false);
          setCircuitCategory(lc.category ?? "");
          setCircuitNote(lc.note ?? "");
          setCircuitShape(lc.circuitShape ?? (lc.isDisplay ? "display" : "rectangular"));
          setCircuitShowLabelAbove(Boolean(lc.showLabelAbove));
          setCircuitShowLabelAboveTouched(false);
          setCircuitDisplayMargin(lc.displayMargin ?? "none");
          setCircuitExportToHDL(lc.exportToHDL ?? true);
          setPinOrderDraft(pins);
          setUseGraphicalPinOrder(pins.every((p) => (p.index ?? 0) === 0));
          setSelectedPinIdBySide({});
        }
      } else if (circuit) {
        const lc = initialTargetCircuit ?? circuit;
        const { pins } = resolveCircuitPinState(lc, effectiveProjectPins);
        setCircuitTab("schematic");
        setCircuitName(lc.name ?? "");
        setCircuitNotation(lc.notation ?? "");
        setCircuitNotationTouched(false);
        setCircuitCategory(lc.category ?? "");
        setCircuitNote(lc.note ?? "");
        setCircuitShape(lc.circuitShape ?? (lc.isDisplay ? "display" : "rectangular"));
        setCircuitShowLabelAbove(Boolean(lc.showLabelAbove));
        setCircuitShowLabelAboveTouched(false);
        setCircuitDisplayMargin(lc.displayMargin ?? "none");
        setCircuitExportToHDL(lc.exportToHDL ?? true);
        setPinOrderDraft(pins);
        setUseGraphicalPinOrder(pins.every((p) => (p.index ?? 0) === 0));
        setSelectedPinIdBySide({});
      } else if (isCreatingCircuit) {
        setCircuitTab("schematic");
        setCircuitName(t("dialog.property.newCircuitDefaultName"));
        setCircuitNotation(t("dialog.property.newCircuitDefaultName"));
        setCircuitNotationTouched(false);
        setCircuitCategory("");
        setCircuitNote("");
        setCircuitShape("rectangular");
        setCircuitShowLabelAbove(false);
        setCircuitShowLabelAboveTouched(false);
        setCircuitDisplayMargin("none");
        setCircuitExportToHDL(true);
        setPinOrderDraft([]);
        setUseGraphicalPinOrder(true);
        setSelectedPinIdBySide({});
      }
    },
    [
      circuit,
      effectiveProjectPins,
      initialPitchTableOpen,
      initialTargetCircuit,
      isCreatingCircuit,
      isOpen,
      symbol,
      t,
    ],
  );

  const handleSelectCircuitShape = React.useCallback(
    (nextShape: CircuitShape) => {
      if (nextShape === "display" && !canUseDisplayShape) {
        return;
      }
      setCircuitShape(nextShape);
      if (nextShape === "display" && !circuitShowLabelAboveTouched && !circuitShowLabelAbove) {
        setCircuitShowLabelAbove(true);
      }
    },
    [
      canUseDisplayShape,
      circuitShowLabelAbove,
      circuitShowLabelAboveTouched,
    ],
  );

  const handleToggleGraphicalPinOrder = React.useCallback(
    (checked: boolean) => {
      setUseGraphicalPinOrder(checked);
      if (checked) {
        setPinOrderDraft((prev) => prev.map((pin) => ({ ...pin, index: 0 })));
        return;
      }
      const explicitIndexByPinId = new Map<string, number>();
      for (const side of ["left", "right", "top", "bottom"] as PinSide[]) {
        pinsBySide[side].forEach((pin, idx) => {
          explicitIndexByPinId.set(pin.pinId, idx + 1);
        });
      }
      setPinOrderDraft((prev) =>
        prev.map((pin) => ({
          ...pin,
          index: explicitIndexByPinId.get(pin.pinId) ?? (pin.index ?? 0),
        })),
      );
    },
    [pinsBySide],
  );

  const handleMovePinOnSide = React.useCallback(
    (side: PinSide, direction: -1 | 1) => {
      const list = [...pinsBySide[side]];
      const selectedId = effectiveSelectedPinIdBySide[side];
      if (!selectedId || list.length < 2) {
        return;
      }
      const idx = list.findIndex((p) => p.pinId === selectedId);
      const nextIdx = idx + direction;
      if (idx < 0 || nextIdx < 0 || nextIdx >= list.length) {
        return;
      }
      const [moved] = list.splice(idx, 1);
      list.splice(nextIdx, 0, moved);

      const nextIndexByPinId = new Map<string, number>();
      list.forEach((pin, pos) => {
        nextIndexByPinId.set(pin.pinId, pos + 1);
      });

      setUseGraphicalPinOrder(false);
      setPinOrderDraft((prev) =>
        prev.map((pin) => {
          const explicit = nextIndexByPinId.get(pin.pinId);
          return explicit !== undefined ? { ...pin, index: explicit } : pin;
        }),
      );
    },
    [effectiveSelectedPinIdBySide, pinsBySide],
  );

  const handleToggleHex = React.useCallback(
    (newIsHex: boolean) => {
      setConstantIsHex(newIsHex);
      const clean = constantValueStr.trim();
      let parsedVal = 0;
      if (constantIsHex) {
        parsedVal = parseInt(clean || "0", 16);
      } else {
        parsedVal = parseInt(clean || "0", 10);
      }
      if (Number.isNaN(parsedVal)) {
        parsedVal = 0;
      }
      const clampedBitWidth = Math.max(1, Math.min(32, constantBitWidth));
      const normalized = clampedBitWidth < 32 ? parsedVal & ((1 << clampedBitWidth) - 1) : parsedVal;
      if (newIsHex) {
        setConstantValueStr(normalized.toString(16).toUpperCase());
      } else {
        setConstantValueStr(normalized.toString(10));
      }
    },
    [
      constantBitWidth,
      constantIsHex,
      constantValueStr,
    ],
  );

  const handleSave = React.useCallback(
    () => {
      if (isDialogReadOnly) {
        return;
      }
      if (symbol) {
        const circ = symbol.circuit;

        if (circ.kind === "gate") {
          onSaveSymbol?.(symbol.circuitSymbolId, {
            gateType,
            inputCount: gateInputCount,
            invertedOutput: gateInvertedOutput,
            color: displayColor,
            note: generalNote,
          });
        } else if (circ.kind === "ledMatrix") {
          onSaveSymbol?.(symbol.circuitSymbolId, {
            matrixType,
            cellShape: matrixCellShape,
            rows: Math.max(1, Math.min(10, matrixRows)),
            columns: Math.max(1, Math.min(10, matrixColumns)),
            colors: matrixColors,
            persistenceMultiplier: matrixPersistence,
            note: generalNote,
          });
        } else if (circ.kind === "circuitButton") {
          onSaveSymbol?.(symbol.circuitSymbolId, {
            isToggle: buttonIsToggle,
            notation: buttonNotation,
            inverted: buttonInverted,
            pinSide: buttonPinSide,
            keyCode: buttonKeyCode,
            modifiers: buttonModifiers,
            note: generalNote,
          });
        } else if (circ.kind === "constant") {
          const cleanStr = constantValueStr.trim();
          if (!cleanStr) {
            return;
          }
          const parsedVal = constantIsHex ? parseInt(cleanStr, 16) : parseInt(cleanStr, 10);
          if (Number.isNaN(parsedVal)) {
            return;
          }

          const clampedBitWidth = Math.max(1, Math.min(32, constantBitWidth));
          const normalizedVal = clampedBitWidth < 32 ? parsedVal & ((1 << clampedBitWidth) - 1) : parsedVal;

          onSaveSymbol?.(symbol.circuitSymbolId, {
            bitWidth: clampedBitWidth,
            value: normalizedVal,
            isHex: constantIsHex,
            pinSide: constantPinSide,
            note: generalNote,
          });
        } else if (circ.kind === "pin") {
          onSaveSymbol?.(symbol.circuitSymbolId, {
            name: pinName.trim() || t("dialog.property.pinNameFallback"),
            jamNotation: pinJamNotation.trim(),
            pinType,
            bitWidth: Math.max(1, Math.min(32, pinBitWidth)),
            pinSide,
            inverted: pinInverted,
            note: generalNote,
          });
        } else if (circ.kind === "circuitProbe") {
          onSaveSymbol?.(symbol.circuitSymbolId, {
            name: probeName.trim(),
            pinSide: probePinSide,
            displayFormat: probeFormat,
            isHex: probeFormat === "hex",
            note: generalNote,
          });
        } else if (circ.kind === "splitter") {
          const safePinCount = Math.max(2, Math.min(32, splitterPinCount));
          const safePinBitWidth = Math.max(1, Math.min(32, splitterPinBitWidth));
          onSaveSymbol?.(symbol.circuitSymbolId, {
            pinCount: safePinCount,
            pinBitWidth: safePinBitWidth,
            bitWidth: safePinCount * safePinBitWidth,
            clockwise: splitterClockwise,
            note: generalNote,
          });
        } else if (circ.kind === "sensor") {
          const clampedBitWidth = Math.max(1, Math.min(32, sensorBitWidth));
          let normalizedData = "";
          if (sensorType === "manual") {
            const trimmed = sensorData.trim();
            if (trimmed) {
              const parsed = parseHexUint(trimmed);
              if (parsed === null) {
                setSensorError(t("dialog.property.sensorInvalidManualHex"));
                return;
              }
              normalizedData = normalizeSensorValue(parsed, clampedBitWidth).toString(16).toUpperCase();
            } else {
              normalizedData = "0";
            }
          } else if (sensorType === "random") {
            const range = tryParseRandomRange(sensorData);
            if (!range.ok) {
              setSensorError(range.error);
              return;
            }
            normalizedData = sensorData.trim() || DEFAULT_RANDOM_DATA;
          } else if (sensorType === "series" || sensorType === "loop") {
            const seriesResult = parseSensorSeries(sensorData, clampedBitWidth);
            if (!seriesResult.ok) {
              setSensorError(seriesResult.error);
              return;
            }
            normalizedData = seriesResult.points.length > 0 ? saveSensorSeries(seriesResult.points) : "0:0";
          }
          setSensorError(null);
          onSaveSymbol?.(symbol.circuitSymbolId, {
            sensorType,
            bitWidth: clampedBitWidth,
            pinSide: sensorPinSide,
            notation: sensorNotation,
            data: normalizedData,
            note: generalNote,
          });
        } else if (circ.kind === "sound") {
          const parsedFreq = Number(soundFrequencyStr.trim().replace(",", "."));
          if (
            !Number.isFinite(parsedFreq) ||
            parsedFreq < SOUND_MIN_FREQUENCY ||
            parsedFreq > SOUND_MAX_FREQUENCY
          ) {
            setSoundError(
              t("dialog.property.soundInvalidFrequency", {
                min: SOUND_MIN_FREQUENCY,
                max: SOUND_MAX_FREQUENCY,
              }),
            );
            return;
          }
          setSoundError(null);
          onSaveSymbol?.(symbol.circuitSymbolId, {
            notation: soundNotation,
            pinSide: soundPinSide,
            waveform: soundWaveform,
            frequency: parsedFreq,
            note: generalNote,
          });
        } else if (circ.kind === "synthesizer") {
          onSaveSymbol?.(symbol.circuitSymbolId, {
            notation: synthesizerNotation,
            synthesizerMode,
            note: generalNote,
          });
        } else if (circ.kind === "memory") {
          const mem = circ as Memory;
          const saveData = !mem.writable || memoryOnStart === "data";
          const encodedData = saveData
            ? encodeMemoryData(memoryBytes, memoryAddressBitWidth, memoryDataBitWidth)
            : "";
          onSaveSymbol?.(symbol.circuitSymbolId, {
            addressBitWidth: memoryAddressBitWidth,
            dataBitWidth: memoryDataBitWidth,
            writeOn1: mem.writable ? memoryWriteOn1 : false,
            onStart: mem.writable ? memoryOnStart : "random",
            dualPort: memoryDualPort,
            data: encodedData,
            note: generalNote,
          });
        } else if (circ.kind === "graphicsArray") {
          const validWidth = parsePositiveIntInRange(
            gaWidthStr,
            GRAPHICS_ARRAY_MIN_WIDTH,
            GRAPHICS_ARRAY_MAX_WIDTH,
          );
          const validHeight = parsePositiveIntInRange(
            gaHeightStr,
            GRAPHICS_ARRAY_MIN_HEIGHT,
            GRAPHICS_ARRAY_MAX_HEIGHT,
          );
          if (validWidth === null || validHeight === null) {
            return;
          }
          onSaveSymbol?.(symbol.circuitSymbolId, {
            writeOn1: gaWriteOn1,
            onStart: gaOnStart,
            dataBitWidth: gaDataBitWidth,
            bitsPerPixel: gaBitsPerPixel,
            width: validWidth,
            height: validHeight,
            zoom: gaZoom,
            note: generalNote,
          });
        } else if (circ.kind === "logicalCircuit") {
          const resolvedName = circuitName.trim() || circ.name;
          onSaveCircuit?.((circ as LogicalCircuit).logicalCircuitId, {
            name: resolvedName,
            notation: circuitNotation.trim(),
            category: circuitCategory.trim(),
            note: circuitNote,
            circuitShape,
            showLabelAbove: circuitShowLabelAbove,
            displayMargin: circuitDisplayMargin,
            exportToHDL: circuitExportToHDL,
            pinOrder: pinOrderDraft.map((p) => ({ pinId: p.pinId, index: p.index ?? 0 })),
          });
        }
      } else if (circuit) {
        const resolvedName = circuitName.trim() || circuit.name;
        onSaveCircuit?.(circuit.logicalCircuitId, {
          name: resolvedName,
          notation: circuitNotation.trim(),
          category: circuitCategory.trim(),
          note: circuitNote,
          circuitShape,
          showLabelAbove: circuitShowLabelAbove,
          displayMargin: circuitDisplayMargin,
          exportToHDL: circuitExportToHDL,
          pinOrder: pinOrderDraft.map((p) => ({ pinId: p.pinId, index: p.index ?? 0 })),
        });
      } else if (isCreatingCircuit) {
        const trimmedName = circuitName.trim();
        if (!trimmedName) {
          return;
        }
        onCreateCircuit?.({
          name: trimmedName,
          notation: circuitNotation.trim(),
          category: circuitCategory.trim(),
          note: circuitNote,
          circuitShape: circuitShape === "display" ? "rectangular" : circuitShape,
          showLabelAbove: circuitShowLabelAbove,
          displayMargin: circuitDisplayMargin,
          exportToHDL: circuitExportToHDL,
        });
      }

      onClose();
    },
    [
      buttonInverted,
      buttonIsToggle,
      buttonKeyCode,
      buttonModifiers,
      buttonNotation,
      buttonPinSide,
      circuit,
      circuitCategory,
      circuitDisplayMargin,
      circuitExportToHDL,
      circuitName,
      circuitNotation,
      circuitNote,
      circuitShape,
      circuitShowLabelAbove,
      constantBitWidth,
      constantIsHex,
      constantPinSide,
      constantValueStr,
      displayColor,
      gaBitsPerPixel,
      gaDataBitWidth,
      gaHeightStr,
      gaOnStart,
      gaWidthStr,
      gaWriteOn1,
      gaZoom,
      gateInputCount,
      gateInvertedOutput,
      gateType,
      generalNote,
      isCreatingCircuit,
      isDialogReadOnly,
      matrixCellShape,
      matrixColors,
      matrixColumns,
      matrixPersistence,
      matrixRows,
      matrixType,
      memoryAddressBitWidth,
      memoryBytes,
      memoryDataBitWidth,
      memoryDualPort,
      memoryOnStart,
      memoryWriteOn1,
      onClose,
      onCreateCircuit,
      onSaveCircuit,
      onSaveSymbol,
      pinBitWidth,
      pinInverted,
      pinJamNotation,
      pinName,
      pinOrderDraft,
      pinSide,
      pinType,
      probeFormat,
      probeName,
      probePinSide,
      sensorBitWidth,
      sensorData,
      sensorNotation,
      sensorPinSide,
      sensorType,
      soundFrequencyStr,
      soundNotation,
      soundPinSide,
      soundWaveform,
      splitterClockwise,
      splitterPinBitWidth,
      splitterPinCount,
      symbol,
      synthesizerMode,
      synthesizerNotation,
      t,
    ],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.nativeEvent) {
        e.nativeEvent.stopImmediatePropagation();
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("[data-component='MemoryDataGrid']")) {
          return;
        }
        if (target?.tagName?.toLowerCase() === "textarea") {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleSave();
          }
        } else {
          e.preventDefault();
          handleSave();
        }
      }
    },
    [handleSave, onClose],
  );

  if (!isOpen || (!symbol && !circuit && !isCreatingCircuit)) {
    return null;
  }

  const kind = symbol ? symbol.circuit.kind : "circuit";
  let title = t("dialog.property.titleDefault");
  if (kind === "gate") {
    const rawType = (symbol?.circuit as Gate)?.gateType;
    if (rawType === "led") {
      const inputCount = (symbol?.circuit as Gate)?.inputCount;
      title = inputCount === 8
        ? t("dialog.property.titleSevenSegment")
        : t("dialog.property.titleLed");
    } else if (rawType === "triState1" || rawType === "triState2") {
      title = t("dialog.property.titleTriState");
    } else {
      let gType = rawType?.toUpperCase() ?? t("dialog.property.gateFallback");
      if (rawType === "and" && gateInvertedOutput) {
        gType = "NAND";
      } else if (rawType === "or" && gateInvertedOutput) {
        gType = "NOR";
      } else if (rawType === "xor" && gateInvertedOutput) {
        gType = "XNOR";
      }
      title = t("dialog.property.titleGate", { gateType: gType });
    }
  } else if (kind === "circuitButton") {
    title = t("dialog.property.titleButton");
  } else if (kind === "constant") {
    title = t("dialog.property.titleConstant");
  } else if (kind === "pin") {
    title = t("dialog.property.titlePin");
  } else if (kind === "circuitProbe") {
    title = t("dialog.property.titleProbe");
  } else if (kind === "ledMatrix") {
    title = t("dialog.property.titleLedMatrix");
  } else if (kind === "splitter") {
    title = t("dialog.property.titleSplitter");
  } else if (kind === "sensor") {
    title = t("dialog.property.titleSensor");
  } else if (kind === "sound") {
    title = t("dialog.property.titleSound");
  } else if (kind === "synthesizer") {
    title = t("dialog.property.titleSynthesizer");
  } else if (kind === "memory") {
    const mem = symbol?.circuit as Memory | undefined;
    title = mem?.writable ? t("dialog.property.titleRam") : t("dialog.property.titleRom");
  } else if (kind === "graphicsArray") {
    title = t("dialog.property.titleGraphicsArray");
  } else if (isCreatingCircuit && !circuit && !symbol) {
    title = t("dialog.property.titleNewCircuit");
  } else {
    title = t("dialog.property.titleCircuit", { name: circuit?.name ?? symbol?.circuit.name });
  }

  const isTriStateGate =
    kind === "gate" &&
    (gateType === "triState1" || gateType === "triState2");

  const isVariableGate =
    kind === "gate" &&
    ["and", "or", "xor"].includes(gateType);

  const memoryCircuit = kind === "memory" ? (symbol?.circuit as Memory) : null;
  const isMemoryDataEditable = memoryCircuit ? (!memoryCircuit.writable || memoryOnStart === "data") : false;

  const parsedGaWidth = kind === "graphicsArray"
    ? parsePositiveIntInRange(gaWidthStr, GRAPHICS_ARRAY_MIN_WIDTH, GRAPHICS_ARRAY_MAX_WIDTH)
    : null;
  const parsedGaHeight = kind === "graphicsArray"
    ? parsePositiveIntInRange(gaHeightStr, GRAPHICS_ARRAY_MIN_HEIGHT, GRAPHICS_ARRAY_MAX_HEIGHT)
    : null;
  const isGaWidthInvalid = kind === "graphicsArray" && parsedGaWidth === null;
  const isGaHeightInvalid = kind === "graphicsArray" && parsedGaHeight === null;
  const gaStrides = kind === "graphicsArray" && parsedGaWidth !== null && parsedGaHeight !== null
    ? getGraphicsArrayStrides(gaDataBitWidth, gaBitsPerPixel, parsedGaWidth, parsedGaHeight)
    : null;
  const gaGridWidth = parsedGaWidth !== null
    ? Math.max(2, Math.ceil((parsedGaWidth * gaZoom + 3) / GRID_SIZE))
    : null;
  const gaGridHeight = parsedGaHeight !== null
    ? Math.max(3, Math.ceil((parsedGaHeight * gaZoom + 3) / GRID_SIZE))
    : null;

  const modalContent = (
    <div
      {...other}
      data-component="PropertyDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="property-dialog-title"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-backdrop" onClick={onClose} />
      <div
        className={
          `modal-dialog${
            kind === "logicalCircuit" || kind === "circuit" || (kind === "synthesizer" && isPitchTableOpen)
              ? " modal-dialog-wide"
              : ""
          }` +
          `${kind === "memory" ? " modal-dialog-memory" : ""}` +
          `${accentVariant === "library" ? " library-accent" : ""}`
        }
        data-accent-variant={accentVariant}
      >
        <div className="modal-header">
          <h3 id="property-dialog-title" className="modal-title">
            {customTitle ?? title}
          </h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {isDialogReadOnly && (
            <div
              className={`collab-dialog-banner${foreignLock ? " is-locked" : " is-readonly"}`}
              data-testid={foreignLock ? "property-dialog-lock-banner" : "property-dialog-readonly-banner"}
              role="status"
            >
              {foreignLock
                ? t("collabSync.dialogLockedBanner", { name: foreignLock.ownerDisplayName })
                : t("collabSync.dialogGuestReadOnlyBanner")}
            </div>
          )}
          {/* Gatter-Eigenschaften */}
          {kind === "gate" && (
            <>
              {gateType === "led" ? (
                <div className="form-group">
                  <label htmlFor="led-color-select" className="form-label">
                    {t("dialog.property.ledColorLabel")}
                  </label>
                  <select
                    id="led-color-select"
                    className="form-select"
                    value={displayColor}
                    onChange={(e) => setDisplayColor(e.target.value as DisplayColor)}
                    autoFocus={true}
                  >
                    {displayColorOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : isTriStateGate ? (
                <div className="form-group">
                  <label htmlFor="tristate-type-select" className="form-label">
                    {t("dialog.property.enableSideLabel")}
                  </label>
                  <div
                    className="tristate-switcher"
                    role="radiogroup"
                    aria-label={t("dialog.property.enableSideGroupAria")}
                  >
                    <button
                      type="button"
                      id="tristate-type-down-btn"
                      className={`switcher-btn ${gateType === "triState1" ? "active" : ""}`}
                      onClick={() => setGateType("triState1")}
                      aria-pressed={gateType === "triState1"}
                    >
                      <span className="arrow-icon">▼</span> {t("dialog.property.enableSideDown")}
                    </button>
                    <button
                      type="button"
                      id="tristate-type-up-btn"
                      className={`switcher-btn ${gateType === "triState2" ? "active" : ""}`}
                      onClick={() => setGateType("triState2")}
                      aria-pressed={gateType === "triState2"}
                    >
                      <span className="arrow-icon">▲</span> {t("dialog.property.enableSideUp")}
                    </button>
                  </div>
                  <select
                    id="tristate-type-select"
                    className="form-select visually-hidden-select"
                    value={gateType}
                    onChange={(e) => setGateType(e.target.value as "triState1" | "triState2")}
                    aria-hidden="true"
                    tabIndex={-1}
                  >
                    <option value="triState1">{t("dialog.property.enableSideDown")}</option>
                    <option value="triState2">{t("dialog.property.enableSideUp")}</option>
                  </select>
                  <span className="form-hint">
                    {t("dialog.property.enableSideHint")}
                  </span>
                </div>
              ) : isVariableGate ? (
                <div className="form-group">
                  <label htmlFor="gate-input-count" className="form-label">
                    {t("dialog.property.inputCountLabel")}
                  </label>
                  <select
                    id="gate-input-count"
                    className="form-select"
                    value={gateInputCount}
                    onChange={(e) => setGateInputCount(Number(e.target.value))}
                    autoFocus={true}
                  >
                    {GATE_INPUT_OPTIONS.map((count) => (
                      <option key={count} value={count}>
                        {t("dialog.property.inputCountOption", { count })}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {isVariableGate && (
                <div className="form-group">
                  <label className="checkbox-label" htmlFor="gate-inverted-toggle">
                    <input
                      id="gate-inverted-toggle"
                      type="checkbox"
                      checked={gateInvertedOutput}
                      onChange={(e) => setGateInvertedOutput(e.target.checked)}
                    />
                    <span>
                      {gateType === "and"
                        ? t("dialog.property.invertOutputSpecific", { gate: "NAND" })
                        : gateType === "or"
                          ? t("dialog.property.invertOutputSpecific", { gate: "NOR" })
                          : gateType === "xor"
                            ? t("dialog.property.invertOutputSpecific", { gate: "XNOR" })
                            : t("dialog.property.invertOutputGeneric")}
                    </span>
                  </label>
                </div>
              )}
            </>
          )}

          {/* LED-Matrix-Eigenschaften */}
          {kind === "ledMatrix" && (
            <>
              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="matrix-type-select" className="form-label">
                    {t("dialog.property.matrixModeLabel")}
                  </label>
                  <select
                    id="matrix-type-select"
                    className="form-select"
                    value={matrixType}
                    onChange={(e) => setMatrixType(e.target.value as LedMatrixType)}
                    autoFocus={true}
                  >
                    <option value="individual">{t("dialog.property.matrixModeIndividual")}</option>
                    <option value="selector">{t("dialog.property.matrixModeSelector")}</option>
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="matrix-shape-select" className="form-label">
                    {t("dialog.property.cellShapeLabel")}
                  </label>
                  <select
                    id="matrix-shape-select"
                    className="form-select"
                    value={matrixCellShape}
                    onChange={(e) => setMatrixCellShape(e.target.value as LedMatrixCellShape)}
                  >
                    <option value="round">{t("dialog.property.cellShapeRound")}</option>
                    <option value="rect">{t("dialog.property.cellShapeRect")}</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="matrix-rows-input" className="form-label">
                    {t("dialog.property.rowsLabel")}
                  </label>
                  <input
                    id="matrix-rows-input"
                    type="number"
                    min={1}
                    max={10}
                    className="form-input"
                    value={matrixRows}
                    onChange={(e) => setMatrixRows(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  />
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="matrix-columns-input" className="form-label">
                    {t("dialog.property.columnsLabel")}
                  </label>
                  <input
                    id="matrix-columns-input"
                    type="number"
                    min={1}
                    max={10}
                    className="form-input"
                    value={matrixColumns}
                    onChange={(e) => setMatrixColumns(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="matrix-colors-select" className="form-label">
                    {t("dialog.property.colorChannelsLabel")}
                  </label>
                  <select
                    id="matrix-colors-select"
                    className="form-select"
                    value={matrixColors}
                    onChange={(e) => setMatrixColors(Number(e.target.value))}
                  >
                    <option value={1}>{t("dialog.property.colorChannels1")}</option>
                    <option value={2}>{t("dialog.property.colorChannels2")}</option>
                    <option value={3}>{t("dialog.property.colorChannels3")}</option>
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="matrix-persistence-select" className="form-label">
                    {t("dialog.property.persistenceLabel")}
                  </label>
                  <select
                    id="matrix-persistence-select"
                    className="form-select"
                    value={matrixPersistence}
                    onChange={(e) => setMatrixPersistence(Number(e.target.value) as 1 | 2 | 3)}
                  >
                    <option value={1}>{t("dialog.property.persistence1")}</option>
                    <option value={2}>2x</option>
                    <option value={3}>3x</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Taster-/Schalter-Eigenschaften */}
          {kind === "circuitButton" && (
            <>
              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="button-mode-select" className="form-label">
                    {t("dialog.property.buttonModeLabel")}
                  </label>
                  <select
                    id="button-mode-select"
                    className="form-select"
                    value={buttonIsToggle ? "toggle" : "momentary"}
                    onChange={(e) => setButtonIsToggle(e.target.value === "toggle")}
                    autoFocus={true}
                  >
                    <option value="momentary">{t("palette.item.buttonMomentary")}</option>
                    <option value="toggle">{t("palette.item.buttonToggle")}</option>
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="button-pinside-select" className="form-label">
                    {t("dialog.property.pinSideLabel")}
                  </label>
                  <select
                    id="button-pinside-select"
                    className="form-select"
                    value={buttonPinSide}
                    onChange={(e) => setButtonPinSide(e.target.value as PinSide)}
                  >
                    {pinSideOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="button-notation-input" className="form-label">
                  {t("dialog.property.buttonNotationLabel")}
                </label>
                <input
                  id="button-notation-input"
                  type="text"
                  className="form-input"
                  value={buttonNotation}
                  onChange={(e) => setButtonNotation(e.target.value)}
                  placeholder={t("dialog.property.buttonNotationPlaceholder")}
                />
              </div>

              <div className="form-group">
                <label className="checkbox-label" htmlFor="button-inverted-toggle">
                  <input
                    id="button-inverted-toggle"
                    type="checkbox"
                    checked={buttonInverted}
                    onChange={(e) => setButtonInverted(e.target.checked)}
                  />
                  <span>{t("dialog.property.buttonInvertedLabel")}</span>
                </label>
              </div>

              <div className="form-group">
                <label htmlFor="button-shortcut-input" className="form-label">
                  {t("dialog.property.shortcutLabel")}
                </label>
                <div className="form-row">
                  <input
                    id="button-shortcut-input"
                    type="text"
                    readOnly={true}
                    className="form-input flex-1"
                    value={
                      isCapturingShortcut
                        ? t("dialog.property.shortcutCapturing")
                        : (buttonKeyCode > 0
                          ? formatKeyGesture(buttonKeyCode, buttonModifiers)
                          : t("dialog.property.shortcutNone"))
                    }
                    onFocus={() => setIsCapturingShortcut(true)}
                    onBlur={() => setIsCapturingShortcut(false)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.nativeEvent) {
                        e.nativeEvent.stopImmediatePropagation();
                      }
                      if (e.key === "Escape" && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
                        e.preventDefault();
                        setIsCapturingShortcut(false);
                        return;
                      }
                      if (isModifierOnlyKey(e.key)) {
                        e.preventDefault();
                        return;
                      }
                      const nextKeyCode = keyboardEventToWpfKeyCode(e);
                      if (nextKeyCode > 0) {
                        e.preventDefault();
                        setButtonKeyCode(nextKeyCode);
                        setButtonModifiers(getKeyboardEventModifiers(e));
                        setIsCapturingShortcut(false);
                      }
                    }}
                  />
                  {buttonKeyCode > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setButtonKeyCode(0);
                        setButtonModifiers(0);
                        setIsCapturingShortcut(false);
                      }}
                    >
                      {t("common.reset")}
                    </button>
                  )}
                </div>
                <div className="form-hint">
                  {t("dialog.property.shortcutHint")}
                </div>
              </div>
            </>
          )}

          {/* Konstanten-Eigenschaften */}
          {kind === "constant" && (
            <>
              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="constant-bitwidth-input" className="form-label">
                    {t("dialog.property.bitWidthLabel")}
                  </label>
                  <input
                    id="constant-bitwidth-input"
                    type="number"
                    min={1}
                    max={32}
                    className="form-input"
                    value={constantBitWidth}
                    onChange={(e) => setConstantBitWidth(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
                    autoFocus={true}
                  />
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="constant-pinside-select" className="form-label">
                    {t("dialog.property.pinSideLabel")}
                  </label>
                  <select
                    id="constant-pinside-select"
                    className="form-select"
                    value={constantPinSide}
                    onChange={(e) => setConstantPinSide(e.target.value as PinSide)}
                  >
                    {pinSideOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="constant-value-input" className="form-label">
                  {constantIsHex ? t("dialog.property.valueHexLabel") : t("dialog.property.valueDecLabel")}
                </label>
                <div className="form-row-inline">
                  {constantIsHex && <span className="hex-prefix">0x</span>}
                  <input
                    id="constant-value-input"
                    type="text"
                    required={true}
                    pattern={constantIsHex ? "^[0-9a-fA-F]+$" : "^[0-9]+$"}
                    className="form-input flex-1"
                    value={constantValueStr}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const allowed = constantIsHex ? /^[0-9a-fA-F]*$/ : /^[0-9]*$/;
                      if (allowed.test(raw)) {
                        setConstantValueStr(raw);
                      }
                    }}
                    placeholder={
                      constantIsHex
                        ? t("dialog.property.valueHexPlaceholder")
                        : t("dialog.property.valueDecPlaceholder")
                    }
                  />
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      checked={constantIsHex}
                      onChange={(e) => handleToggleHex(e.target.checked)}
                    />
                    {t("dialog.property.hexCheckboxLabel")}
                  </label>
                </div>
                <span className="form-hint">
                  {constantIsHex
                    ? t("dialog.property.valueHexHint")
                    : t("dialog.property.valueDecHint")}
                </span>
              </div>
            </>
          )}

          {/* Pin-Eigenschaften */}
          {kind === "pin" && (
            <>
              <div className="form-group">
                <label htmlFor="pin-name-input" className="form-label">
                  {t("dialog.property.pinNameLabel")}
                </label>
                <input
                  id="pin-name-input"
                  type="text"
                  className="form-input"
                  value={pinName}
                  onChange={(e) => setPinName(e.target.value)}
                  placeholder={t("dialog.property.pinNamePlaceholder")}
                  autoFocus={true}
                />
              </div>

              <div className="form-group">
                <label htmlFor="pin-jam-notation-input" className="form-label">
                  {t("dialog.property.jamNotationLabel")}
                </label>
                <input
                  id="pin-jam-notation-input"
                  type="text"
                  maxLength={4}
                  className="form-input"
                  value={pinJamNotation}
                  onChange={(e) => setPinJamNotation(e.target.value)}
                  placeholder={t("dialog.property.jamNotationPlaceholder")}
                />
                <span className="form-hint">
                  {t("dialog.property.jamNotationHint")}
                </span>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="pin-type-select" className="form-label">
                    {t("dialog.property.pinTypeLabel")}
                  </label>
                  <select
                    id="pin-type-select"
                    className="form-select"
                    value={pinType}
                    onChange={(e) => {
                      const nextType = e.target.value as PinType;
                      setPinType(nextType);
                      setPinSide(nextType === "output" ? "right" : "left");
                    }}
                  >
                    <option value="input">{t("dialog.property.pinTypeInput")}</option>
                    <option value="output">{t("dialog.property.pinTypeOutput")}</option>
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="pin-bitwidth-input" className="form-label">
                    {t("dialog.property.bitWidthLabel")}
                  </label>
                  <input
                    id="pin-bitwidth-input"
                    type="number"
                    min={1}
                    max={32}
                    className="form-input"
                    value={pinBitWidth}
                    onChange={(e) => setPinBitWidth(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="pin-side-select" className="form-label">
                    {t("dialog.property.pinSideFieldLabel")}
                  </label>
                  <select
                    id="pin-side-select"
                    className="form-select"
                    value={pinSide}
                    onChange={(e) => setPinSide(e.target.value as PinSide)}
                  >
                    {pinSideOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group flex-1 flex-center">
                  <label className="checkbox-label" htmlFor="pin-inverted-toggle">
                    <input
                      id="pin-inverted-toggle"
                      type="checkbox"
                      checked={pinInverted}
                      onChange={(e) => setPinInverted(e.target.checked)}
                    />
                    <span>{t("dialog.property.pinInvertedLabel")}</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* Probe-Eigenschaften */}
          {kind === "circuitProbe" && (
            <>
              <div className="form-group">
                <label htmlFor="probe-name-input" className="form-label">
                  {t("dialog.property.probeNameLabel")}
                </label>
                <input
                  id="probe-name-input"
                  type="text"
                  className="form-input"
                  value={probeName}
                  onChange={(e) => setProbeName(e.target.value)}
                  placeholder={t("dialog.property.probeNamePlaceholder")}
                  autoFocus={true}
                />
              </div>

              <div className="form-group">
                <label htmlFor="probe-side-select" className="form-label">
                  {t("dialog.property.pinSideLabel")}
                </label>
                <select
                  id="probe-side-select"
                  className="form-select"
                  value={probePinSide}
                  onChange={(e) => setProbePinSide(e.target.value as PinSide)}
                >
                  {pinSideOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="probe-format-select" className="form-label">
                  {t("dialog.property.displayFormatLabel")}
                </label>
                <select
                  id="probe-format-select"
                  className="form-select"
                  value={probeFormat}
                  onChange={(e) => setProbeFormat(e.target.value as ProbeFormat)}
                >
                  <option value="bin">{t("dialog.property.probeFormatBin")}</option>
                  <option value="hex">{t("dialog.property.probeFormatHex")}</option>
                  <option value="dec">{t("dialog.property.probeFormatDec")}</option>
                </select>
              </div>
            </>
          )}

          {/* Splitter-Eigenschaften */}
          {kind === "splitter" && (
            <>
              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="splitter-pincount-select" className="form-label">
                    {t("dialog.property.splitterPinCountLabel")}
                  </label>
                  <select
                    id="splitter-pincount-select"
                    className="form-select"
                    value={splitterPinCount}
                    onChange={(e) => setSplitterPinCount(Number(e.target.value))}
                    autoFocus={true}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 2).map((count) => (
                      <option key={count} value={count}>
                        {t("dialog.property.splitterPinCountOption", { count })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="splitter-bitwidth-select" className="form-label">
                    {t("dialog.property.splitterBitWidthLabel")}
                  </label>
                  <select
                    id="splitter-bitwidth-select"
                    className="form-select"
                    value={splitterPinBitWidth}
                    onChange={(e) => setSplitterPinBitWidth(Number(e.target.value))}
                  >
                    {Array.from({ length: 32 }, (_, i) => i + 1).map((w) => (
                      <option key={w} value={w}>
                        {t("common.bitCount", { count: w })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="splitter-clockwise-select" className="form-label">
                  {t("dialog.property.splitterModeLabel")}
                </label>
                <select
                  id="splitter-clockwise-select"
                  className="form-select"
                  value={splitterClockwise ? "clockwise" : "counterclockwise"}
                  onChange={(e) => setSplitterClockwise(e.target.value === "clockwise")}
                >
                  <option value="clockwise">{t("dialog.property.splitterBranchFull")}</option>
                  <option value="counterclockwise">{t("dialog.property.splitterBundleFull")}</option>
                </select>
                <span className="form-hint">
                  {splitterClockwise
                    ? t("dialog.property.splitterHintBranch", {
                      totalBits: splitterPinCount * splitterPinBitWidth,
                      count: splitterPinCount,
                      pinBitText: t("dialog.property.splitterHintBitWidth", { count: splitterPinBitWidth }),
                    })
                    : t("dialog.property.splitterHintBundle", {
                      totalBits: splitterPinCount * splitterPinBitWidth,
                      count: splitterPinCount,
                      pinBitText: t("dialog.property.splitterHintBitWidth", { count: splitterPinBitWidth }),
                    })}
                </span>
              </div>
            </>
          )}

          {/* Sensor-Eigenschaften */}
          {kind === "sensor" && (
            <>
              <div className="form-group">
                <label htmlFor="sensor-type-select" className="form-label">
                  {t("dialog.property.sensorTypeLabel")}
                </label>
                <select
                  id="sensor-type-select"
                  className="form-select"
                  value={sensorType}
                  autoFocus={true}
                  onChange={(e) => {
                    const nextType = e.target.value as SensorType;
                    setSensorType(nextType);
                    setSensorError(null);
                    if (nextType === "random" && !tryParseRandomRange(sensorData).ok) {
                      setSensorData(DEFAULT_RANDOM_DATA);
                    } else if ((nextType === "series" || nextType === "loop") && !sensorData.trim()) {
                      setSensorData("0:0");
                    } else if (nextType === "manual" && parseHexUint(sensorData) === null) {
                      setSensorData("0");
                    }
                  }}
                >
                  {sensorTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="sensor-bitwidth-select" className="form-label">
                    {t("dialog.property.sensorBitWidthLabel")}
                  </label>
                  <select
                    id="sensor-bitwidth-select"
                    className="form-select"
                    value={sensorBitWidth}
                    onChange={(e) => {
                      setSensorBitWidth(Number(e.target.value));
                      setSensorError(null);
                    }}
                  >
                    {Array.from({ length: 32 }, (_, i) => i + 1).map((w) => (
                      <option key={w} value={w}>
                        {t("common.bitCount", { count: w })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="sensor-pinside-select" className="form-label">
                    {t("dialog.property.sensorPinSideLabel")}
                  </label>
                  <select
                    id="sensor-pinside-select"
                    className="form-select"
                    value={sensorPinSide}
                    onChange={(e) => setSensorPinSide(e.target.value as PinSide)}
                  >
                    {pinSideOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="sensor-notation-input" className="form-label">
                  {t("dialog.property.sensorNotationLabel")}
                </label>
                <input
                  id="sensor-notation-input"
                  type="text"
                  className="form-input"
                  value={sensorNotation}
                  onChange={(e) => setSensorNotation(e.target.value)}
                  placeholder={t("dialog.property.sensorNotationPlaceholder")}
                />
              </div>

              {(sensorType === "series" || sensorType === "loop") && (
                <div className="form-group">
                  <label htmlFor="sensor-data-input" className="form-label">
                    {t("dialog.property.sensorSeriesLabel")}
                  </label>
                  <textarea
                    id="sensor-data-input"
                    rows={3}
                    className="form-textarea"
                    value={sensorData}
                    onChange={(e) => {
                      setSensorData(e.target.value);
                      setSensorError(null);
                    }}
                    placeholder={t("dialog.property.sensorSeriesPlaceholder")}
                  />
                  <span className="form-hint">
                    {t("dialog.property.sensorSeriesHint")}
                  </span>
                </div>
              )}

              {(sensorType === "random" || sensorType === "manual") && (
                <div className="form-group">
                  <label htmlFor="sensor-data-input" className="form-label">
                    {sensorType === "random"
                      ? t("dialog.property.sensorRandomLabel")
                      : t("dialog.property.sensorManualLabel")}
                  </label>
                  <input
                    id="sensor-data-input"
                    type="text"
                    className="form-input"
                    value={sensorData}
                    onChange={(e) => {
                      setSensorData(e.target.value);
                      setSensorError(null);
                    }}
                    placeholder={sensorType === "random" ? "A:14" : "0"}
                  />
                  <span className="form-hint">
                    {sensorType === "random"
                      ? t("dialog.property.sensorRandomHint")
                      : t("dialog.property.sensorManualHint")}
                  </span>
                </div>
              )}

              {sensorError && (
                <div className="form-error" role="alert">
                  {sensorError}
                </div>
              )}
            </>
          )}

          {/* Standard-Summer-Eigenschaften */}
          {kind === "sound" && (
            <>
              <div className="form-group">
                <label htmlFor="sound-notation-input" className="form-label">
                  {t("dialog.property.soundNotationLabel")}
                </label>
                <input
                  id="sound-notation-input"
                  type="text"
                  className="form-input"
                  value={soundNotation}
                  onChange={(e) => setSoundNotation(e.target.value)}
                  placeholder={t("dialog.property.soundNotationPlaceholder")}
                  autoFocus={true}
                />
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="sound-waveform-select" className="form-label">
                    {t("dialog.property.soundWaveformLabel")}
                  </label>
                  <select
                    id="sound-waveform-select"
                    data-testid="property-sound-waveform"
                    className="form-select"
                    value={soundWaveform}
                    onChange={(e) => setSoundWaveform(e.target.value as SoundWaveform)}
                  >
                    {soundWaveformOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="sound-pinside-select" className="form-label">
                    {t("dialog.property.soundPinSideLabel")}
                  </label>
                  <select
                    id="sound-pinside-select"
                    className="form-select"
                    value={soundPinSide}
                    onChange={(e) => setSoundPinSide(e.target.value as PinSide)}
                  >
                    {pinSideOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="sound-frequency-input" className="form-label">
                  {t("dialog.property.soundFrequencyLabel")}
                </label>
                <div className="sound-preview-row">
                  <input
                    id="sound-frequency-input"
                    data-testid="property-sound-frequency"
                    type="number"
                    min={SOUND_MIN_FREQUENCY}
                    max={SOUND_MAX_FREQUENCY}
                    step="any"
                    className="form-input"
                    value={soundFrequencyStr}
                    onChange={(e) => {
                      setSoundFrequencyStr(e.target.value);
                      setSoundError(null);
                    }}
                  />
                  <button
                    type="button"
                    data-testid="property-sound-preview-btn"
                    className="preview-tone-btn"
                    onClick={() => {
                      const parsedFreq = Number(soundFrequencyStr.trim().replace(",", "."));
                      if (
                        !Number.isFinite(parsedFreq) ||
                        parsedFreq < SOUND_MIN_FREQUENCY ||
                        parsedFreq > SOUND_MAX_FREQUENCY
                      ) {
                        setSoundError(
                          t("dialog.property.soundInvalidFrequency", {
                            min: SOUND_MIN_FREQUENCY,
                            max: SOUND_MAX_FREQUENCY,
                          }),
                        );
                        return;
                      }
                      setSoundError(null);
                      simulationContext.playPreviewTone?.(soundWaveform, parsedFreq);
                    }}
                  >
                    {t("dialog.property.testToneButton")}
                  </button>
                </div>
                <span className="form-hint">
                  {t("dialog.property.soundFrequencyHint", {
                    min: SOUND_MIN_FREQUENCY,
                    max: SOUND_MAX_FREQUENCY,
                  })}
                </span>
                {soundError && (
                  <div className="form-error" role="alert">
                    {soundError}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Synthesizer-Eigenschaften (8-Bit) */}
          {kind === "synthesizer" && (
            <>
              <div className="form-group">
                <label htmlFor="synth-notation-input" className="form-label">
                  {t("dialog.property.synthesizerNotationLabel")}
                </label>
                <input
                  id="synth-notation-input"
                  type="text"
                  className="form-input"
                  value={synthesizerNotation}
                  onChange={(e) => setSynthesizerNotation(e.target.value)}
                  placeholder={t("dialog.property.synthesizerNotationPlaceholder")}
                  autoFocus={true}
                />
              </div>

              <div className="form-group">
                <label htmlFor="synth-mode-select" className="form-label">
                  {t("dialog.property.synthesizerModeLabel")}
                </label>
                <div className="sound-preview-row">
                  <select
                    id="synth-mode-select"
                    data-testid="property-synthesizer-mode"
                    className="form-select flex-1"
                    value={synthesizerMode}
                    onChange={(e) => setSynthesizerMode(e.target.value as SynthesizerMode)}
                  >
                    {synthesizerModeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid="property-synthesizer-preview-btn"
                    className="preview-tone-btn"
                    onClick={() => {
                      const previewHz =
                        synthesizerMode === "noise"
                          ? (resolveNoiseFilterFrequency(69) ?? 1000)
                          : 440;
                      simulationContext.playPreviewTone?.(synthesizerMode, previewHz);
                    }}
                  >
                    {t("dialog.property.testToneButton")}
                  </button>
                </div>
                <span className="form-hint">
                  {t("dialog.property.synthesizerPinHint")}
                </span>
              </div>

              <div className="pitch-reference-section">
                <div className="pitch-reference-header">
                  <button
                    type="button"
                    data-testid="pitch-table-toggle-btn"
                    className="pitch-reference-toggle"
                    aria-expanded={isPitchTableOpen}
                    onClick={() => setIsPitchTableOpen((prev) => !prev)}
                  >
                    {isPitchTableOpen
                      ? t("dialog.property.pitchTableHide")
                      : t("dialog.property.pitchTableShow")}
                  </button>
                  <button
                    type="button"
                    data-testid="pitch-table-copy-btn"
                    className="pitch-reference-copy"
                    onClick={() => {
                      const text = formatPitchTableCopyText();
                      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(text).catch(() => {});
                      }
                      setPitchTableCopied(true);
                    }}
                  >
                    {pitchTableCopied ? t("common.copied") : t("common.copy")}
                  </button>
                </div>

                {isPitchTableOpen && (
                  <div
                    className="pitch-reference-panel"
                    data-testid="pitch-reference-table"
                  >
                    <p className="pitch-reference-hint">
                      {t("dialog.property.pitchTableHint")}
                    </p>
                    <table className="pitch-reference-table">
                      <thead>
                        <tr>
                          <th>{t("dialog.property.pitchColDec")}</th>
                          <th>{t("dialog.property.pitchColHex")}</th>
                          <th>{t("dialog.property.pitchColMirror")}</th>
                          <th>{t("dialog.property.pitchColNote")}</th>
                          <th>{t("dialog.property.pitchColHz")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MIDI_PITCH_TABLE.map((entry) => (
                          <tr key={entry.midiNote}>
                            <td>{entry.midiNote}</td>
                            <td>{entry.hex}</td>
                            <td>{entry.mirrorHex}</td>
                            <td>
                              {entry.midiNote === 0
                                ? t("dialog.property.pitchTableMuteLabel")
                                : entry.label}
                            </td>
                            <td>
                              {entry.midiNote === 0 ? "0" : entry.frequencyHz.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Speicher-Eigenschaften (ROM / RAM) */}
          {kind === "memory" && memoryCircuit && (
            <>
              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="memory-address-bitwidth-select" className="form-label">
                    {t("dialog.property.memoryAddressBitWidthLabel")}
                  </label>
                  <select
                    id="memory-address-bitwidth-select"
                    className="form-select"
                    value={memoryAddressBitWidth}
                    autoFocus={true}
                    onChange={(e) => {
                      const nextAddr = clampAddressBitWidth(Number(e.target.value));
                      setMemoryBytes((prev) =>
                        reallocateMemoryData(
                          prev,
                          memoryAddressBitWidth,
                          memoryDataBitWidth,
                          nextAddr,
                          memoryDataBitWidth,
                        ),
                      );
                      setMemoryAddressBitWidth(nextAddr);
                      setMemoryGridPage(0);
                      setMemoryFileError(null);
                      setMemoryFileNotice(null);
                    }}
                  >
                    {Array.from({ length: MEMORY_MAX_ADDRESS_BIT_WIDTH }, (_, i) => i + 1).map((w) => (
                      <option key={w} value={w}>
                        {t("common.bitCount", { count: w })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="memory-data-bitwidth-select" className="form-label">
                    {t("dialog.property.memoryDataBitWidthLabel")}
                  </label>
                  <select
                    id="memory-data-bitwidth-select"
                    className="form-select"
                    value={memoryDataBitWidth}
                    onChange={(e) => {
                      const nextData = clampDataBitWidth(Number(e.target.value));
                      setMemoryBytes((prev) =>
                        reallocateMemoryData(
                          prev,
                          memoryAddressBitWidth,
                          memoryDataBitWidth,
                          memoryAddressBitWidth,
                          nextData,
                        ),
                      );
                      setMemoryDataBitWidth(nextData);
                      setMemoryFileError(null);
                      setMemoryFileNotice(null);
                    }}
                  >
                    {Array.from({ length: MEMORY_MAX_DATA_BIT_WIDTH }, (_, i) => i + 1).map((w) => (
                      <option key={w} value={w}>
                        {t("common.bitCount", { count: w })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {memoryCircuit.writable && (
                <div className="form-row">
                  <div className="form-group flex-1">
                    <label htmlFor="memory-writeon-select" className="form-label">
                      {t("dialog.property.memoryWriteOnLabel")}
                    </label>
                    <select
                      id="memory-writeon-select"
                      className="form-select"
                      value={memoryWriteOn1 ? "rising" : "falling"}
                      onChange={(e) => setMemoryWriteOn1(e.target.value === "rising")}
                    >
                      <option value="falling">{t("dialog.property.memoryWriteOn0")}</option>
                      <option value="rising">{t("dialog.property.memoryWriteOn1")}</option>
                    </select>
                  </div>

                  <div className="form-group flex-1">
                    <label htmlFor="memory-onstart-select" className="form-label">
                      {t("dialog.property.memoryOnStartLabel")}
                    </label>
                    <select
                      id="memory-onstart-select"
                      className="form-select"
                      value={memoryOnStart}
                      onChange={(e) => {
                        setMemoryOnStart(e.target.value as MemoryOnStart);
                        setMemoryFileError(null);
                        setMemoryFileNotice(null);
                      }}
                    >
                      <option value="random">{t("dialog.property.memoryOnStartRandom")}</option>
                      <option value="zeros">{t("dialog.property.memoryOnStartZeros")}</option>
                      <option value="ones">{t("dialog.property.memoryOnStartOnes")}</option>
                      <option value="data">{t("dialog.property.memoryOnStartData")}</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="checkbox-label" htmlFor="memory-dualport-toggle">
                  <input
                    id="memory-dualport-toggle"
                    type="checkbox"
                    checked={memoryDualPort}
                    onChange={(e) => setMemoryDualPort(e.target.checked)}
                  />
                  <span>{t("dialog.property.memoryDualPortLabel")}</span>
                </label>
              </div>

              <div className="form-group">
                <span className="form-label">{t("dialog.property.memoryDataSectionLabel")}</span>
                {memoryCircuit.writable && !isMemoryDataEditable && (
                  <span className="form-hint">
                    {t("dialog.property.memoryDataDisabledHint")}
                  </span>
                )}

                <div className="memory-file-toolbar">
                  <input
                    ref={binaryMemoryInputRef}
                    type="file"
                    className="visually-hidden-select"
                    tabIndex={-1}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) {
                        return;
                      }
                      try {
                        const rawBuf = await file.arrayBuffer();
                        const imported = importBinaryIntoMemory(
                          new Uint8Array(rawBuf),
                          memoryAddressBitWidth,
                          memoryDataBitWidth,
                        );
                        setMemoryBytes(imported);
                        setMemoryFileError(null);
                        setMemoryFileNotice(
                          t("dialog.property.memoryImportedNotice", {
                            count: numberCellsFor(memoryAddressBitWidth),
                          }),
                        );
                      } catch {
                        setMemoryFileError(t("dialog.property.memoryErrorFileRead"));
                        setMemoryFileNotice(null);
                      }
                    }}
                  />
                  <input
                    ref={textMemoryInputRef}
                    type="file"
                    accept=".txt,.hex,.csv,.dat,text/plain"
                    className="visually-hidden-select"
                    tabIndex={-1}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) {
                        return;
                      }
                      try {
                        const rawText = await file.text();
                        const result = importTextIntoMemory(
                          rawText,
                          memoryFileFormat,
                          memoryAddressBitWidth,
                          memoryDataBitWidth,
                        );
                        if (!result.ok) {
                          setMemoryFileError(t(result.errorKey, result.errorParams));
                          setMemoryFileNotice(null);
                          return;
                        }
                        setMemoryBytes(result.data);
                        setMemoryFileError(null);
                        setMemoryFileNotice(
                          t("dialog.property.memoryImportedNotice", { count: result.importedCells }),
                        );
                      } catch {
                        setMemoryFileError(t("dialog.property.memoryErrorFileRead"));
                        setMemoryFileNotice(null);
                      }
                    }}
                  />

                  <button
                    type="button"
                    className="memory-action-btn"
                    disabled={!isMemoryDataEditable}
                    onClick={() => binaryMemoryInputRef.current?.click()}
                  >
                    {t("dialog.property.memoryLoadBinary")}
                  </button>
                  <button
                    type="button"
                    className="memory-action-btn"
                    disabled={!isMemoryDataEditable}
                    onClick={() => {
                      const bin = exportMemoryToBinary(
                        memoryBytes,
                        memoryAddressBitWidth,
                        memoryDataBitWidth,
                      );
                      const prefix = memoryCircuit.writable ? "ram" : "rom";
                      triggerBlobDownload(
                        new Blob([new Uint8Array(bin)], { type: "application/octet-stream" }),
                        `${prefix}-${memoryAddressBitWidth}x${memoryDataBitWidth}.bin`,
                      );
                    }}
                  >
                    {t("dialog.property.memorySaveBinary")}
                  </button>

                  <span className="toolbar-divider" />

                  <select
                    className="memory-format-select"
                    disabled={!isMemoryDataEditable}
                    value={memoryFileFormat}
                    aria-label={t("dialog.property.memoryTextFormatAriaLabel")}
                    onChange={(e) => setMemoryFileFormat(e.target.value as MemoryTextFormat)}
                  >
                    <option value="hex">{t("common.numberFormats.hex")}</option>
                    <option value="dec">{t("common.numberFormats.dec")}</option>
                    <option value="bin">{t("common.numberFormats.bin")}</option>
                  </select>
                  <button
                    type="button"
                    className="memory-action-btn"
                    disabled={!isMemoryDataEditable}
                    onClick={() => textMemoryInputRef.current?.click()}
                  >
                    {t("dialog.property.memoryLoadText")}
                  </button>
                  <button
                    type="button"
                    className="memory-action-btn"
                    disabled={!isMemoryDataEditable}
                    onClick={() => {
                      const content = exportMemoryToText(
                        memoryBytes,
                        memoryFileFormat,
                        memoryAddressBitWidth,
                        memoryDataBitWidth,
                      );
                      const prefix = memoryCircuit.writable ? "ram" : "rom";
                      triggerBlobDownload(
                        new Blob([content], { type: "text/plain;charset=utf-8" }),
                        `${prefix}-${memoryAddressBitWidth}x${memoryDataBitWidth}.${memoryFileFormat}.txt`,
                      );
                    }}
                  >
                    {t("dialog.property.memorySaveText")}
                  </button>

                  <button
                    type="button"
                    className="memory-action-btn"
                    disabled={!isMemoryDataEditable}
                    onClick={() => {
                      setMemoryBytes(
                        new Uint8Array(totalBytesFor(memoryAddressBitWidth, memoryDataBitWidth)),
                      );
                      setMemoryFileError(null);
                      setMemoryFileNotice(null);
                    }}
                  >
                    {t("dialog.property.memoryClearData")}
                  </button>
                </div>

                {memoryFileError && (
                  <div className="form-error" role="alert">
                    {memoryFileError}
                  </div>
                )}
                {memoryFileNotice && (
                  <div className="form-hint">
                    {memoryFileNotice}
                  </div>
                )}

                <MemoryDataGrid
                  addressBitWidth={memoryAddressBitWidth}
                  dataBitWidth={memoryDataBitWidth}
                  data={memoryBytes}
                  format={memoryFormat}
                  onFormatChange={setMemoryFormat}
                  disabled={!isMemoryDataEditable}
                  page={memoryGridPage}
                  onPageChange={setMemoryGridPage}
                  onCellChange={(address, cellVal) => {
                    setMemoryBytes((prev) => {
                      const next = new Uint8Array(prev);
                      setCellValue(next, memoryDataBitWidth, address, cellVal);
                      return next;
                    });
                    setMemoryFileError(null);
                    setMemoryFileNotice(null);
                  }}
                />
              </div>
            </>
          )}

          {/* Grafisches Display (GraphicsArray) */}
          {kind === "graphicsArray" && (
            <>
              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="graphics-writeon-select" className="form-label">
                    {t("dialog.property.memoryWriteOnLabel")}
                  </label>
                  <select
                    id="graphics-writeon-select"
                    className="form-select"
                    value={gaWriteOn1 ? "rising" : "falling"}
                    autoFocus={true}
                    onChange={(e) => setGaWriteOn1(e.target.value === "rising")}
                  >
                    <option value="falling">{t("dialog.property.memoryWriteOn0")}</option>
                    <option value="rising">{t("dialog.property.memoryWriteOn1")}</option>
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="graphics-onstart-select" className="form-label">
                    {t("dialog.property.memoryOnStartLabel")}
                  </label>
                  <select
                    id="graphics-onstart-select"
                    className="form-select"
                    value={gaOnStart}
                    onChange={(e) => setGaOnStart(e.target.value as "random" | "zeros" | "ones")}
                  >
                    <option value="random">{t("dialog.property.memoryOnStartRandom")}</option>
                    <option value="zeros">{t("dialog.property.memoryOnStartZeros")}</option>
                    <option value="ones">{t("dialog.property.memoryOnStartOnes")}</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="graphics-databitwidth-select" className="form-label">
                    {t("dialog.property.memoryDataBitWidthLabel")}
                  </label>
                  <select
                    id="graphics-databitwidth-select"
                    className="form-select"
                    value={gaDataBitWidth}
                    onChange={(e) => setGaDataBitWidth(Number(e.target.value))}
                  >
                    {GRAPHICS_ARRAY_DATA_BIT_WIDTHS.map((w) => (
                      <option key={w} value={w}>
                        {t("common.bitCount", { count: w })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="graphics-bpp-select" className="form-label">
                    {t("dialog.property.graphicsBitsPerPixelLabel")}
                  </label>
                  <select
                    id="graphics-bpp-select"
                    className="form-select"
                    value={gaBitsPerPixel}
                    onChange={(e) => setGaBitsPerPixel(Number(e.target.value))}
                  >
                    {GRAPHICS_ARRAY_BITS_PER_PIXEL.map((bpp) => (
                      <option key={bpp} value={bpp}>
                        {t("dialog.property.graphicsBitsPerPixelOption", {
                          bits: bpp,
                          colors: 1 << bpp,
                        })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="graphics-width-input" className="form-label">
                    {t("dialog.property.graphicsWidthLabel")}
                  </label>
                  <input
                    id="graphics-width-input"
                    data-testid="property-graphics-width"
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    className="form-input"
                    value={gaWidthStr}
                    onChange={(e) => setGaWidthStr(e.target.value)}
                  />
                  {isGaWidthInvalid && (
                    <div className="form-error" role="alert">
                      {t("dialog.property.graphicsRangeError", {
                        min: GRAPHICS_ARRAY_MIN_WIDTH,
                        max: GRAPHICS_ARRAY_MAX_WIDTH,
                      })}
                    </div>
                  )}
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="graphics-height-input" className="form-label">
                    {t("dialog.property.graphicsHeightLabel")}
                  </label>
                  <input
                    id="graphics-height-input"
                    data-testid="property-graphics-height"
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    className="form-input"
                    value={gaHeightStr}
                    onChange={(e) => setGaHeightStr(e.target.value)}
                  />
                  {isGaHeightInvalid && (
                    <div className="form-error" role="alert">
                      {t("dialog.property.graphicsRangeError", {
                        min: GRAPHICS_ARRAY_MIN_HEIGHT,
                        max: GRAPHICS_ARRAY_MAX_HEIGHT,
                      })}
                    </div>
                  )}
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="graphics-zoom-select" className="form-label">
                    {t("dialog.property.graphicsZoomLabel")}
                  </label>
                  <select
                    id="graphics-zoom-select"
                    className="form-select"
                    value={gaZoom}
                    onChange={(e) => setGaZoom(Number(e.target.value))}
                  >
                    {GRAPHICS_ZOOM_OPTIONS.map((z) => (
                      <option key={z} value={z}>
                        {`${z}×`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {gaStrides && gaGridWidth !== null && gaGridHeight !== null && (
                <div className="form-info-box" data-testid="property-graphics-derived-info">
                  {t("dialog.property.graphicsDerivedInfo", {
                    addressBits: gaStrides.addressBitWidth,
                    cells: gaStrides.totalCells,
                    gridWidth: gaGridWidth,
                    gridHeight: gaGridHeight,
                  })}
                </div>
              )}
            </>
          )}

          {/* Schaltungs-Eigenschaften mit Tabs „Schaltplan“ & „Pin Reihenfolge“ */}
          {(kind === "logicalCircuit" || kind === "circuit") && (
            <>
              <div
                className="circuit-tabs"
                role="tablist"
                aria-label={t("dialog.property.tabsAriaLabel")}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    e.stopPropagation();
                    setCircuitTab((prev) => (prev === "schematic" ? "pinOrder" : "schematic"));
                  }
                }}
              >
                <button
                  type="button"
                  id="circuit-tab-schematic"
                  role="tab"
                  aria-selected={circuitTab === "schematic"}
                  aria-controls="circuit-tabpanel-schematic"
                  className={`circuit-tab-btn${circuitTab === "schematic" ? " active" : ""}`}
                  onClick={() => setCircuitTab("schematic")}
                >
                  {t("dialog.property.tabSchematic")}
                </button>
                <button
                  type="button"
                  id="circuit-tab-pin-order"
                  role="tab"
                  aria-selected={circuitTab === "pinOrder"}
                  aria-controls="circuit-tabpanel-pin-order"
                  disabled={isCreatingCircuit && !circuit && !symbol}
                  className={`circuit-tab-btn${circuitTab === "pinOrder" ? " active" : ""}`}
                  onClick={() => setCircuitTab("pinOrder")}
                >
                  <span>{t("dialog.property.tabPinOrder")}</span>
                  <span className="tab-count-badge">{pinOrderDraft.length}</span>
                </button>
              </div>

              {circuitTab === "schematic" && (
                <div
                  id="circuit-tabpanel-schematic"
                  role="tabpanel"
                  aria-labelledby="circuit-tab-schematic"
                  className="circuit-tabpanel"
                >
                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label htmlFor="circuit-name-input" className="form-label">
                        {t("dialog.property.circuitNameLabel")}
                      </label>
                      <input
                        id="circuit-name-input"
                        type="text"
                        className="form-input"
                        value={circuitName}
                        onChange={(e) => {
                          const nextName = e.target.value;
                          setCircuitName(nextName);
                          if (isCreatingCircuit && !circuitNotationTouched) {
                            setCircuitNotation(nextName);
                          }
                        }}
                        placeholder={t("dialog.property.circuitNamePlaceholder")}
                        autoFocus={true}
                      />
                    </div>

                    <div className="form-group flex-1">
                      <label htmlFor="circuit-notation-input" className="form-label">
                        {t("dialog.property.circuitNotationLabel")}
                      </label>
                      <input
                        id="circuit-notation-input"
                        type="text"
                        className="form-input"
                        value={circuitNotation}
                        onChange={(e) => {
                          setCircuitNotationTouched(true);
                          setCircuitNotation(e.target.value);
                        }}
                        placeholder={t("dialog.property.circuitNotationPlaceholder")}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="circuit-category-input" className="form-label">
                      {t("dialog.property.circuitCategoryLabel")}
                    </label>
                    <input
                      id="circuit-category-input"
                      type="text"
                      className="form-input"
                      list="circuit-category-suggestions"
                      value={circuitCategory}
                      onChange={(e) => setCircuitCategory(e.target.value)}
                      placeholder={t("dialog.property.circuitCategoryPlaceholder")}
                    />
                    <datalist id="circuit-category-suggestions">
                      {availableCategories.map((cat) => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  </div>

                  <div className="form-group">
                    <label htmlFor="circuit-shape-select" className="form-label">
                      {t("dialog.property.circuitShapeLabel")}
                    </label>
                    <div
                      className="shape-selector-grid"
                      role="radiogroup"
                      aria-label={t("dialog.property.circuitShapeGroupAria")}
                    >
                      {circuitShapeOptions.map((opt) => {
                        const isDisplayOpt = opt.value === "display";
                        const disabled = isDisplayOpt && !canUseDisplayShape;
                        const active = circuitShape === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            data-testid={`circuit-shape-btn-${opt.value}`}
                            disabled={disabled}
                            aria-pressed={active}
                            className={`shape-option-btn${active ? " active" : ""}`}
                            onClick={() => handleSelectCircuitShape(opt.value)}
                          >
                            {renderCircuitShapeMiniIcon(opt.value)}
                            <span className="shape-option-label">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <select
                      id="circuit-shape-select"
                      className="form-select visually-hidden-select"
                      value={circuitShape}
                      onChange={(e) => handleSelectCircuitShape(e.target.value as CircuitShape)}
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      {circuitShapeOptions.map((opt) => (
                        <option
                          key={opt.value}
                          value={opt.value}
                          disabled={opt.value === "display" && !canUseDisplayShape}
                        >
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {!canUseDisplayShape && (
                      <span className="form-hint">
                        {t("dialog.property.displayShapeHint")}
                      </span>
                    )}
                  </div>

                  <div className="advanced-placement-box">
                    <div className="advanced-placement-title">{t("dialog.property.advancedPlacementTitle")}</div>
                    <div className="form-group">
                      <label className="checkbox-label" htmlFor="circuit-show-label-above-checkbox">
                        <input
                          id="circuit-show-label-above-checkbox"
                          type="checkbox"
                          checked={circuitShowLabelAbove}
                          onChange={(e) => {
                            setCircuitShowLabelAboveTouched(true);
                            setCircuitShowLabelAbove(e.target.checked);
                          }}
                        />
                        <span>{t("dialog.property.showLabelAboveCheckbox")}</span>
                      </label>
                      <span className="form-hint">
                        {t("dialog.property.showLabelAboveHint")}
                      </span>
                    </div>

                    <div className="form-group">
                      <label htmlFor="circuit-display-margin-select" className="form-label">
                        {t("dialog.property.displayMarginLabel")}
                      </label>
                      <select
                        id="circuit-display-margin-select"
                        className="form-select"
                        value={circuitDisplayMargin}
                        disabled={circuitShape !== "display"}
                        onChange={(e) => setCircuitDisplayMargin(e.target.value as DisplayMargin)}
                      >
                        {displayMarginOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span className="form-hint">
                        {t("dialog.property.displayMarginHint")}
                      </span>
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="circuit-note-input" className="form-label">
                      {t("dialog.property.circuitNoteLabel")}
                    </label>
                    <textarea
                      id="circuit-note-input"
                      rows={3}
                      className="form-textarea"
                      value={circuitNote}
                      onChange={(e) => setCircuitNote(e.target.value)}
                      placeholder={t("dialog.property.circuitNotePlaceholder")}
                    />
                  </div>

                  <div className="form-group">
                    <label className="checkbox-label" htmlFor="circuit-export-hdl-checkbox">
                      <input
                        id="circuit-export-hdl-checkbox"
                        type="checkbox"
                        checked={circuitExportToHDL}
                        onChange={(e) => setCircuitExportToHDL(e.target.checked)}
                      />
                      <span>{t("dialog.property.exportHdlCheckbox")}</span>
                    </label>
                  </div>
                </div>
              )}

              {circuitTab === "pinOrder" && (
                <div
                  id="circuit-tabpanel-pin-order"
                  role="tabpanel"
                  aria-labelledby="circuit-tab-pin-order"
                  className="circuit-tabpanel pin-order-editor"
                >
                  <div className="form-group">
                    <label className="checkbox-label" htmlFor="circuit-pin-graphical-order-checkbox">
                      <input
                        id="circuit-pin-graphical-order-checkbox"
                        type="checkbox"
                        checked={useGraphicalPinOrder}
                        onChange={(e) => handleToggleGraphicalPinOrder(e.target.checked)}
                      />
                      <span>{t("dialog.property.graphicalOrderCheckbox")}</span>
                    </label>
                    <span className="form-hint">
                      {t("dialog.property.graphicalOrderHint")}
                    </span>
                  </div>

                  <div className="pin-order-grid">
                    {pinOrderSides.map(({ side, label }) => {
                      const list = pinsBySide[side];
                      const selectedId = effectiveSelectedPinIdBySide[side];
                      const selectedIndex = list.findIndex((p) => p.pinId === selectedId);
                      const canMovePrev = selectedIndex > 0;
                      const canMoveNext = selectedIndex >= 0 && selectedIndex < list.length - 1;

                      return (
                        <div key={side} className={`pin-side-panel side-${side}`} data-testid={`pin-side-panel-${side}`}>
                          <div className="pin-side-header">
                            <span className="pin-side-title">
                              {label} ({list.length})
                            </span>
                            <div className="pin-order-actions">
                              <button
                                type="button"
                                className="pin-move-btn"
                                data-testid={`pin-move-prev-${side}`}
                                aria-label={t("dialog.property.pinMovePrevAriaLabel", { side: label })}
                                disabled={!canMovePrev}
                                onClick={() => handleMovePinOnSide(side, -1)}
                              >
                                &lt;
                              </button>
                              <button
                                type="button"
                                className="pin-move-btn"
                                data-testid={`pin-move-next-${side}`}
                                aria-label={t("dialog.property.pinMoveNextAriaLabel", { side: label })}
                                disabled={!canMoveNext}
                                onClick={() => handleMovePinOnSide(side, 1)}
                              >
                                &gt;
                              </button>
                            </div>
                          </div>

                          <div className="pin-tile-list">
                            {list.length === 0 ? (
                              <span className="pin-side-empty">{t("dialog.property.noPins")}</span>
                            ) : (
                              list.map((pin) => {
                                const isSel = pin.pinId === selectedId;
                                const trimmedJam = pin.jamNotation?.trim();
                                const showJamBadge = Boolean(trimmedJam && trimmedJam !== pin.name);
                                return (
                                  <button
                                    key={pin.pinId}
                                    type="button"
                                    data-testid={`pin-order-tile-${pin.pinId}`}
                                    aria-pressed={isSel}
                                    className={`pin-order-tile${isSel ? " selected" : ""}`}
                                    onClick={() =>
                                      setSelectedPinIdBySide((prev) => ({ ...prev, [side]: pin.pinId }))
                                    }
                                  >
                                    <span className={`pin-dir-badge dir-${pin.pinType}`}>
                                      {pin.pinType === "input"
                                        ? t("dialog.property.pinDirInputShort")
                                        : t("dialog.property.pinDirOutputShort")}
                                    </span>
                                    <span className="pin-tile-name">{pin.name}</span>
                                    {showJamBadge && (
                                      <span className="pin-jam-badge">[{trimmedJam}]</span>
                                    )}
                                    {pin.bitWidth > 1 && (
                                      <span className="pin-bits-badge">{pin.bitWidth}b</span>
                                    )}
                                    {pin.inverted && (
                                      <span className="pin-inv-badge">inv</span>
                                    )}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Zusätzliche Notiz für Bauteile */}
          {kind !== "logicalCircuit" && kind !== "circuit" && (
            <div className="form-group">
              <label htmlFor="general-note-input" className="form-label">
                {t("dialog.property.generalNoteLabel")}
              </label>
              <textarea
                id="general-note-input"
                rows={2}
                className="form-textarea"
                value={generalNote}
                onChange={(e) => setGeneralNote(e.target.value)}
                placeholder={t("dialog.property.generalNotePlaceholder")}
                autoFocus={kind === "gate" && !isVariableGate && !isTriStateGate}
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="shortcut-hint">{t("dialog.property.footerShortcutHint")}</span>
          <div className="footer-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                isDialogReadOnly ||
                (kind === "constant" && !constantValueStr.trim()) ||
                isGaWidthInvalid ||
                isGaHeightInvalid ||
                (isCreatingCircuit && !circuitName.trim())
              }
              onClick={handleSave}
            >
              {customSaveLabel
                ? customSaveLabel
                : isCreatingCircuit && !circuit && !symbol
                  ? t("dialog.property.createButton")
                  : t("dialog.property.saveButton")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return ReactDOM.createPortal(modalContent, document.body);
  }

  return modalContent;
})({
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",

  "& > .modal-backdrop": {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    backdropFilter: "blur(2px)",
  },

  "& > .modal-dialog": {
    position: "relative",
    width: "32rem",
    maxWidth: "92vw",
    maxHeight: "88vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--color-bg-surface)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "0.5rem",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
    overflow: "hidden",
    color: "var(--color-text-primary)",

    "&.modal-dialog-wide": {
      width: "38rem",
    },

    "&.modal-dialog-memory": {
      width: "54rem",
      maxWidth: "95vw",
    },

    "&.library-accent": {
      border: "2px solid var(--color-library-accent)",
      boxShadow: "0 10px 28px rgba(245, 158, 11, 0.22)",
    },

    "& > .modal-header": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.85rem 1.25rem",
      borderBottom: "1px solid var(--color-border-subtle)",

      "& > .modal-title": {
        margin: 0,
        fontSize: "1.1rem",
        fontWeight: 600,
      },

      "& > .modal-close-btn": {
        background: "transparent",
        border: "none",
        color: "var(--color-text-secondary)",
        fontSize: "1.4rem",
        cursor: "pointer",
        lineHeight: 1,
        padding: "0 0.25rem",
        borderRadius: "0.25rem",

        "&:hover": {
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-surface-hover)",
        },
      },
    },

    "& > .modal-body": {
      padding: "1rem 1.25rem",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "0.85rem",

      "& > .collab-dialog-banner": {
        padding: "0.55rem 0.75rem",
        borderRadius: "0.375rem",
        fontSize: "0.8125rem",
        fontWeight: 600,
        lineHeight: 1.35,
        backgroundColor: "var(--color-warning-bg)",
        border: "1px solid var(--color-warning-border)",
        color: "var(--color-text-primary)",
      },

      "& .form-row": {
        display: "flex",
        gap: "0.75rem",
      },

      "& .form-row-inline": {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",

        "& > .hex-prefix": {
          fontFamily: "var(--font-family-mono)",
          fontWeight: 700,
          fontSize: "0.95rem",
          color: "var(--color-text-secondary)",
          padding: "0 0.15rem",
          userSelect: "none",
        },

        "& > .form-checkbox-label": {
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          fontSize: "0.85rem",
          cursor: "pointer",
          userSelect: "none",
          whiteSpace: "nowrap",
        },
      },

      "& .flex-1": {
        flex: 1,
      },

      "& .flex-center": {
        display: "flex",
        alignItems: "center",
        paddingTop: "1.2rem",
      },

      "& .form-group": {
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",

        "& > .form-label": {
          fontSize: "0.825rem",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
        },

        "& > .form-hint": {
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
        },

        "& > .form-error": {
          fontSize: "0.75rem",
          color: "var(--color-logic-error)",
        },

        "& > .form-input": {
          width: "100%",
          padding: "0.45rem 0.65rem",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.375rem",
          fontSize: "0.9rem",
          boxSizing: "border-box",

          "&:focus": {
            outline: "none",
            borderColor: "var(--color-accent-primary)",
            boxShadow: "0 0 0 2px var(--color-accent-primary-bg)",
          },
        },

        "& > .form-textarea": {
          width: "100%",
          padding: "0.45rem 0.65rem",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.375rem",
          fontSize: "0.9rem",
          lineHeight: 1.4,
          resize: "vertical",
          boxSizing: "border-box",

          "&:focus": {
            outline: "none",
            borderColor: "var(--color-accent-primary)",
            boxShadow: "0 0 0 2px var(--color-accent-primary-bg)",
          },
        },

        "& > .form-select": {
          padding: "0.45rem 0.5rem",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.375rem",
          fontSize: "0.85rem",

          "&:focus": {
            outline: "none",
            borderColor: "var(--color-accent-primary)",
          },
        },

        "& > .checkbox-label": {
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.85rem",
          cursor: "pointer",
          userSelect: "none",
        },
      },

      "& .form-info-box": {
        padding: "0.6rem 0.8rem",
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.375rem",
        fontSize: "0.825rem",
        color: "var(--color-text-secondary)",
      },

      "& .tristate-switcher": {
        display: "flex",
        gap: "0.5rem",
        marginTop: "0.2rem",
      },

      "& .switcher-btn": {
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        padding: "0.55rem 0.85rem",
        backgroundColor: "var(--color-bg-base)",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.375rem",
        fontSize: "0.85rem",
        fontWeight: 500,
        cursor: "pointer",
        userSelect: "none",
        transition: "all 0.15s ease",

        "&:hover": {
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-bg-elevated)",
        },

        "&.active": {
          borderColor: "var(--color-accent-primary)",
          backgroundColor: "var(--color-accent-primary-bg)",
          color: "var(--color-text-primary)",
          fontWeight: 600,
          boxShadow: "0 0 0 1px var(--color-accent-primary)",
        },

        "& > .arrow-icon": {
          fontSize: "0.75rem",
          color: "var(--color-accent-primary)",
        },
      },

      "& .visually-hidden-select": {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-0.0625rem",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      },

      "& .circuit-tabs": {
        display: "flex",
        gap: "0.35rem",
        borderBottom: "1px solid var(--color-border-subtle)",
        paddingBottom: "0.5rem",
      },

      "& .circuit-tab-btn": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.4rem 0.8rem",
        backgroundColor: "transparent",
        color: "var(--color-text-secondary)",
        border: "1px solid transparent",
        borderRadius: "0.375rem",
        fontSize: "0.85rem",
        fontWeight: 500,
        cursor: "pointer",

        "&:hover:not(:disabled)": {
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
        },

        "&.active": {
          backgroundColor: "var(--color-accent-primary-bg)",
          borderColor: "var(--color-accent-primary)",
          color: "var(--color-text-primary)",
          fontWeight: 600,
        },

        "&:disabled": {
          opacity: 0.45,
          cursor: "not-allowed",
        },

        "& > .tab-count-badge": {
          fontSize: "0.72rem",
          padding: "0.05rem 0.35rem",
          borderRadius: "999rem",
          backgroundColor: "var(--color-bg-base)",
          border: "1px solid var(--color-border-subtle)",
          color: "var(--color-text-secondary)",
        },
      },

      "& .circuit-tabpanel": {
        display: "flex",
        flexDirection: "column",
        gap: "0.85rem",
      },

      "& .shape-selector-grid": {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: "0.45rem",
      },

      "& .shape-option-btn": {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.4rem 0.55rem",
        backgroundColor: "var(--color-bg-base)",
        color: "var(--color-text-secondary)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.375rem",
        fontSize: "0.8rem",
        cursor: "pointer",
        textAlign: "left",

        "&:hover:not(:disabled)": {
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text-primary)",
          backgroundColor: "var(--color-bg-elevated)",
        },

        "&.active": {
          borderColor: "var(--color-accent-primary)",
          backgroundColor: "var(--color-accent-primary-bg)",
          color: "var(--color-text-primary)",
          fontWeight: 600,
          boxShadow: "0 0 0 1px var(--color-accent-primary)",
        },

        "&:disabled": {
          opacity: 0.4,
          cursor: "not-allowed",
        },

        "& > .shape-preview-svg": {
          flexShrink: 0,
          fill: "var(--color-bg-elevated)",
          stroke: "currentColor",
          strokeWidth: 1.4,

          "& > .shape-preview-accent": {
            fill: "var(--color-accent-primary)",
            stroke: "none",
          },
        },

        "& > .shape-option-label": {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      },

      "& .advanced-placement-box": {
        display: "flex",
        flexDirection: "column",
        gap: "0.65rem",
        padding: "0.65rem 0.75rem",
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.375rem",

        "& > .advanced-placement-title": {
          fontSize: "0.78rem",
          fontWeight: 700,
          color: "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        },
      },

      "& .pin-order-grid": {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "0.65rem",

        "& > .side-top, & > .side-bottom": {
          gridColumn: "1 / -1",
        },
      },

      "& .pin-side-panel": {
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        padding: "0.55rem",
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.375rem",

        "& > .pin-side-header": {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",

          "& > .pin-side-title": {
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--color-text-secondary)",
          },

          "& > .pin-order-actions": {
            display: "flex",
            gap: "0.25rem",

            "& > .pin-move-btn": {
              padding: "0.15rem 0.5rem",
              backgroundColor: "var(--color-bg-surface)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "0.25rem",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",

              "&:hover:not(:disabled)": {
                borderColor: "var(--color-accent-primary)",
              },

              "&:disabled": {
                opacity: 0.35,
                cursor: "not-allowed",
              },
            },
          },
        },

        "& > .pin-tile-list": {
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          minHeight: "2rem",
          alignItems: "center",

          "& > .pin-side-empty": {
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
            fontStyle: "italic",
          },
        },
      },

      "& .pin-order-tile": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.25rem 0.45rem",
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.3rem",
        fontSize: "0.78rem",
        fontFamily: "var(--font-family-mono)",
        cursor: "pointer",

        "&:hover": {
          borderColor: "var(--color-border-strong)",
        },

        "&.selected": {
          borderColor: "var(--color-accent-primary)",
          backgroundColor: "var(--color-accent-primary-bg)",
          boxShadow: "0 0 0 1px var(--color-accent-primary)",
        },

        "& > .pin-dir-badge": {
          fontSize: "0.68rem",
          fontWeight: 700,
          padding: "0.05rem 0.25rem",
          borderRadius: "0.2rem",

          "&.dir-input": {
            backgroundColor: "var(--color-accent-tint)",
            color: "var(--color-accent-primary)",
          },

          "&.dir-output": {
            backgroundColor: "var(--color-success-bg)",
            color: "var(--color-logic-high)",
          },
        },

        "& > .pin-jam-badge": {
          fontSize: "0.7rem",
          color: "var(--color-text-secondary)",
        },

        "& > .pin-bits-badge": {
          fontSize: "0.68rem",
          color: "var(--color-text-muted)",
        },

        "& > .pin-inv-badge": {
          fontSize: "0.68rem",
          fontWeight: 700,
          padding: "0.05rem 0.2rem",
          borderRadius: "0.2rem",
          backgroundColor: "var(--color-error-bg)",
          color: "var(--color-logic-error)",
        },
      },

      "& .memory-file-toolbar": {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.4rem",

        "& > .memory-action-btn": {
          padding: "0.28rem 0.55rem",
          borderRadius: "0.3rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          fontSize: "0.78rem",
          cursor: "pointer",

          "&:hover:not(:disabled)": {
            borderColor: "var(--color-accent-primary)",
          },

          "&:disabled": {
            opacity: 0.4,
            cursor: "not-allowed",
          },
        },

        "& > .memory-format-select": {
          padding: "0.26rem 0.45rem",
          borderRadius: "0.3rem",
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          fontSize: "0.78rem",

          "&:disabled": {
            opacity: 0.4,
            cursor: "not-allowed",
          },
        },

        "& > .toolbar-divider": {
          width: "1px",
          height: "1.25rem",
          backgroundColor: "var(--color-border-subtle)",
        },
      },

      "& .sound-preview-row": {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",

        "& > .form-input, & > .form-select": {
          flex: 1,
          padding: "0.45rem 0.65rem",
          backgroundColor: "var(--color-bg-base)",
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "0.375rem",
          fontSize: "0.9rem",
          boxSizing: "border-box",

          "&:focus": {
            outline: "none",
            borderColor: "var(--color-accent-primary)",
          },
        },

        "& > .preview-tone-btn": {
          padding: "0.45rem 0.75rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border-strong)",
          backgroundColor: "var(--color-bg-elevated)",
          color: "var(--color-text-primary)",
          fontSize: "0.82rem",
          fontWeight: 500,
          cursor: "pointer",
          whiteSpace: "nowrap",

          "&:hover": {
            borderColor: "var(--color-accent-primary)",
            color: "var(--color-accent-primary)",
          },
        },
      },

      "& .pitch-reference-section": {
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.55rem 0.65rem",
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.375rem",

        "& > .pitch-reference-header": {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",

          "& > .pitch-reference-toggle, & > .pitch-reference-copy": {
            padding: "0.28rem 0.6rem",
            borderRadius: "0.3rem",
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-elevated)",
            color: "var(--color-text-primary)",
            fontSize: "0.78rem",
            fontWeight: 500,
            cursor: "pointer",

            "&:hover": {
              borderColor: "var(--color-accent-primary)",
            },
          },
        },

        "& > .pitch-reference-panel": {
          display: "flex",
          flexDirection: "column",
          gap: "0.45rem",
          maxHeight: "15rem",
          overflowY: "auto",
          userSelect: "text",
          paddingTop: "0.25rem",

          "& > .pitch-reference-hint": {
            margin: 0,
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
            lineHeight: 1.4,
          },

          "& > .pitch-reference-table": {
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.75rem",
            userSelect: "text",

            "& th, & td": {
              padding: "0.2rem 0.45rem",
              borderBottom: "1px solid var(--color-border-subtle)",
              textAlign: "left",
              userSelect: "text",
            },

            "& th": {
              position: "sticky",
              top: 0,
              backgroundColor: "var(--color-bg-elevated)",
              color: "var(--color-text-secondary)",
              fontWeight: 600,
            },
          },
        },
      },
    },

    "& > .modal-footer": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0.75rem 1.25rem",
      borderTop: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-base)",

      "& > .shortcut-hint": {
        fontSize: "0.75rem",
        color: "var(--color-text-secondary)",
      },

      "& > .footer-actions": {
        display: "flex",
        gap: "0.5rem",

        "& > .btn": {
          padding: "0.4rem 0.85rem",
          fontSize: "0.85rem",
          fontWeight: 500,
          borderRadius: "0.375rem",
          cursor: "pointer",
          border: "1px solid transparent",
          transition: "all 0.15s ease-in-out",

          "&.btn-secondary": {
            backgroundColor: "transparent",
            borderColor: "var(--color-border-subtle)",
            color: "var(--color-text-primary)",

            "&:hover": {
              backgroundColor: "var(--color-surface-hover)",
            },
          },

          "&.btn-primary": {
            backgroundColor: "var(--color-accent-primary)",
            color: "var(--color-text-on-strong)",

            "&:hover": {
              backgroundColor: "var(--color-accent-primary-hover)",
            },
          },
        },
      },
    },
  },
});

export default PropertyDialog;
