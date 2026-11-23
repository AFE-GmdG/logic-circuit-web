import React from "react";

import { keyframes } from "@emotion/react";
import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import SimulationContext from "../../contexts/simulationContext";

import type Circuit from "../../types/circuit/circuit";
import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitShape from "../../types/circuit/circuitShape";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Constant from "../../types/circuit/constant";
import type DevicePin from "../../types/circuit/devicePin";
import type DisplayColor from "../../types/circuit/displayColor";
import type Gate from "../../types/circuit/gate";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type PaletteGateType from "../../types/circuit/paletteGateType";
import type Sensor from "../../types/circuit/sensor";
import type Sound from "../../types/circuit/sound";
import type Splitter from "../../types/circuit/splitter";
import type Synthesizer from "../../types/circuit/synthesizer";
import type State from "../../types/simulation/state";
import { STATE_OFF, STATE_ON1 } from "../../types/simulation/state";

import type CircuitMap from "../../simulation/compiler/circuitMap";
import {
  getAudioInstanceId,
  getButtonInstanceId,
  getCircuitMapSymbolChain,
  getGraphicsArrayInstanceId,
  getProbeInstanceId,
} from "../../simulation/compiler/circuitMap";
import { formatSensorValueText, parseHexUint } from "../../simulation/functions/io/functionSensor";
import type { SimulationSnapshot } from "../../simulation/worker/workerMessages";
import {
  circuitContainsDisplays,
  getCircuitDisplayBounds,
  getCircuitDisplaySymbols,
  getPinJamDisplayLabel,
  getRotationAngle,
  getRotationCenter,
} from "../../utils/circuitLayout";
import { GRID_SIZE } from "../../utils/coordinateSystem";
import { keyboardEventToWpfKeyCode } from "../../utils/keyGesture";

import SymbolRenderer, { getSubCircuitShapePath } from "../symbols/symbolRenderer";

export const CLEANUP_DIM_OPACITY = 0.25;

export function isResizableCircuitKind(kind?: string): boolean {
  return (
    kind === "circuitButton" ||
    kind === "constant" ||
    kind === "circuitProbe" ||
    kind === "pin" ||
    kind === "ledMatrix"
  );
}

type ResizeHandleDef = {
  key: string;
  hx: 0 | 1 | 2;
  hy: 0 | 1 | 2;
  cursor: string;
};

const RESIZE_HANDLES: ResizeHandleDef[] = [
  { key: "nw", hx: 0, hy: 0, cursor: "nwse-resize" },
  { key: "n", hx: 1, hy: 0, cursor: "ns-resize" },
  { key: "ne", hx: 2, hy: 0, cursor: "nesw-resize" },
  { key: "e", hx: 2, hy: 1, cursor: "ew-resize" },
  { key: "se", hx: 2, hy: 2, cursor: "nwse-resize" },
  { key: "s", hx: 1, hy: 2, cursor: "ns-resize" },
  { key: "sw", hx: 0, hy: 2, cursor: "nesw-resize" },
  { key: "w", hx: 0, hy: 1, cursor: "ew-resize" },
];

const AI_HIGHLIGHT_PULSE = keyframes({
  "0%, 100%": {
    opacity: 0.9,
  },
  "50%": {
    opacity: 0.45,
  },
});

type CircuitSymbolViewProps = React.ComponentPropsWithoutRef<"g"> & {
  symbol: CircuitSymbol;
  isSelected?: boolean;
  isCandidateSelected?: boolean;
  isOnlySelected?: boolean;
  isAiHighlighted?: boolean;
  isCleanUpDimmed?: boolean;
  onSymbolPointerDown?: (event: React.PointerEvent<SVGGElement>, symbol: CircuitSymbol) => void;
  onSymbolDoubleClick?: (event: React.MouseEvent<SVGGElement>, symbol: CircuitSymbol) => void;
  onResizeHandlePointerDown?: (
    event: React.PointerEvent<SVGRectElement>,
    symbol: CircuitSymbol,
    hx: 0 | 1 | 2,
    hy: 0 | 1 | 2,
  ) => void;
};

// Ermittelt die Paletten-Gatterform und Eingangsanzahl für ein beliebiges Circuit-Objekt
function getPaletteGateType(circuit: Circuit): {
  type: PaletteGateType;
  inputCount: number;
} | null {
  if ((circuit as Partial<Gate>).kind === "gate") {
    const gate = circuit as Gate;
    let type: PaletteGateType = "and";

    if (gate.gateType === "not") {
      type = "not";
    } else if (gate.gateType === "and") {
      type = gate.invertedOutput ? "nand" : "and";
    } else if (gate.gateType === "or") {
      type = gate.invertedOutput ? "nor" : "or";
    } else if (gate.gateType === "xor") {
      type = gate.invertedOutput ? "xnor" : "xor";
    } else if (gate.gateType === "triState1") {
      type = "triState1";
    } else if (gate.gateType === "triState2") {
      type = "triState2";
    } else if (gate.gateType === "clock") {
      type = "clock";
    } else if (gate.gateType === "led") {
      type = gate.inputCount === 8 ? "sevenSegment" : "led";
    }

    return { type, inputCount: gate.inputCount };
  }

  if (circuit.kind === "ledMatrix") {
    return { type: "ledMatrix", inputCount: 1 };
  }

  if (circuit.kind === "splitter") {
    const splitter = circuit as Splitter;
    return { type: "splitter", inputCount: splitter.pinCount };
  }

  if (circuit.kind === "circuitButton") {
    return { type: "button", inputCount: 1 };
  }
  if (circuit.kind === "constant") {
    return { type: "constant", inputCount: 1 };
  }
  if (circuit.kind === "circuitProbe") {
    return { type: "probe", inputCount: 1 };
  }
  if (circuit.kind === "sensor") {
    return { type: "sensor", inputCount: 1 };
  }
  if (circuit.kind === "sound") {
    return { type: "sound", inputCount: 1 };
  }
  if (circuit.kind === "synthesizer") {
    return { type: "synthesizer", inputCount: 1 };
  }
  if (circuit.kind === "graphicsArray") {
    return { type: "graphicsArray", inputCount: 1 };
  }
  if (circuit.kind === "memory") {
    const memory = circuit as Memory;
    return { type: memory.writable ? "ram" : "rom", inputCount: 1 };
  }
  if (circuit.kind === "pin") {
    const isOut =
      circuit.pins[0]?.pinSide === "left" ||
      circuit.notation.startsWith("Out") ||
      circuit.name.toLowerCase().includes("out");
    return {
      type: isOut ? "pinOut" : "pinIn",
      inputCount: 1,
    };
  }

  return null;
}

type SymbolRenderState = {
  displayValue: string | undefined;
  isButtonOn: boolean;
  isLedOn: boolean;
  ledState: State;
  segments: boolean[] | undefined;
  cellValues: number[][] | undefined;
  isAudioActive: boolean;
  activeAudioFrequencyHz: number | null;
  graphicsVram?: Uint8Array;
  graphicsBitmapStride?: number;
  graphicsVramRevision?: number;
};

// Ermittelt die aktuellen Darstellungs- und Live-Simulationswerte eines Symbols für den Renderer
function resolveSymbolRenderState(
  targetSymbol: CircuitSymbol,
  gateInfo: { type: PaletteGateType; inputCount: number } | null,
  isSimulating: boolean,
  snapshot: SimulationSnapshot | null,
  targetCircuitMap: CircuitMap | null | undefined,
  buttonInstancePath?: string,
  graphicsInstancePath?: string,
  probeInstancePath?: string,
): SymbolRenderState {
  let displayValue: string | undefined;
  if (targetSymbol.circuit.kind === "constant") {
    const c = targetSymbol.circuit as Constant;
    if (c.notation) {
      displayValue = c.notation;
    } else if (c.isHex) {
      displayValue = `0x${(c.value ?? 0).toString(16).toUpperCase()}`;
    } else {
      displayValue = String(c.value ?? 0);
    }
  } else if (targetSymbol.circuit.kind === "circuitProbe") {
    const probe = targetSymbol.circuit as Partial<CircuitProbe>;
    const rawProbeId = probe.circuitProbeId ?? targetSymbol.circuit.circuitId;
    const instanceKey = probeInstancePath ?? getProbeInstanceId(targetCircuitMap, targetSymbol);
    const probeSnap = snapshot?.probes[instanceKey] ?? snapshot?.probes[rawProbeId];
    if (isSimulating && probeSnap) {
      displayValue = probeSnap.text;
    } else {
      displayValue = targetSymbol.circuit.notation || "?";
    }
  } else if (targetSymbol.circuit.kind === "sensor") {
    const sensor = targetSymbol.circuit as Sensor;
    const sensorId = sensor.sensorId ?? sensor.circuitId;
    const sensorSnap = snapshot?.sensors?.[sensorId];
    if (isSimulating && sensorSnap) {
      displayValue = sensorSnap.text;
    } else if (sensor.sensorType === "manual") {
      displayValue = formatSensorValueText("manual", parseHexUint(sensor.data) ?? 0, sensor.bitWidth);
    } else if (sensor.sensorType === "random") {
      displayValue = sensor.data || "A:14";
    } else {
      displayValue = "";
    }
  }

  let isButtonOn = false;
  if (targetSymbol.circuit.kind === "circuitButton") {
    const btn = targetSymbol.circuit as CircuitButton;
    const rawButtonId = btn.circuitButtonId ?? btn.circuitId;
    const instanceKey = buttonInstancePath ?? getButtonInstanceId(targetCircuitMap, targetSymbol);
    const buttonSnap = snapshot?.buttons[instanceKey] ?? snapshot?.buttons[rawButtonId];
    isButtonOn = isSimulating && buttonSnap ? buttonSnap.isOn : (btn.isOn ?? false);
  }

  let isLedOn = false;
  let ledState: State = STATE_OFF;
  if (gateInfo?.type === "led") {
    if (isSimulating && snapshot && targetCircuitMap) {
      const inJam = targetSymbol.jams.find((j) => j.pin.pinType === "input");
      if (inJam) {
        const idxs = targetCircuitMap.jamStateIndexes(inJam);
        if (idxs.length > 0 && idxs[0] !== null && idxs[0] !== undefined) {
          ledState = snapshot.stateArray[idxs[0]] as State;
          isLedOn = ledState === STATE_ON1;
        }
      }
    } else {
      isLedOn = (targetSymbol.circuit as Partial<Gate>).isOn ?? false;
      ledState = isLedOn ? STATE_ON1 : STATE_OFF;
    }
  }

  let segments: boolean[] | undefined;
  if (gateInfo?.type === "sevenSegment") {
    if (isSimulating && snapshot && targetCircuitMap) {
      segments = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const jam = targetSymbol.jams.find(
          (j) => (j.pin as Partial<DevicePin>).order === i || j.pin.pinId === `in-${i}`,
        );
        if (jam) {
          const idxs = targetCircuitMap.jamStateIndexes(jam);
          if (idxs.length > 0 && idxs[0] !== null && idxs[0] !== undefined) {
            const state = snapshot.stateArray[idxs[0]] as State;
            return state === STATE_ON1;
          }
        }
        return false;
      });
    } else {
      segments = [false, false, false, false, false, false, false, false];
    }
  }

  let cellValues: number[][] | undefined;
  if (targetSymbol.circuit.kind === "ledMatrix" && isSimulating && snapshot?.ledMatrices) {
    const matrix = targetSymbol.circuit as Partial<LedMatrix>;
    const matrixKey = matrix.ledMatrixId ?? targetSymbol.circuit.circuitId;
    cellValues = snapshot.ledMatrices[matrixKey];
  }

  let isAudioActive = false;
  let activeAudioFrequencyHz: number | null = null;
  if (
    isSimulating &&
    (targetSymbol.circuit.kind === "sound" || targetSymbol.circuit.kind === "synthesizer")
  ) {
    const channelId = getAudioInstanceId(targetCircuitMap, targetSymbol);
    const channelSnap = snapshot?.audioChannels?.[channelId];
    isAudioActive = Boolean(channelSnap?.active);
    activeAudioFrequencyHz = channelSnap?.frequencyHz ?? null;
  }

  let graphicsVram: Uint8Array | undefined;
  let graphicsBitmapStride: number | undefined;
  let graphicsVramRevision: number | undefined;
  if (targetSymbol.circuit.kind === "graphicsArray" && isSimulating && snapshot?.graphicsArrays) {
    const instanceId = targetCircuitMap
      ? getGraphicsArrayInstanceId(targetCircuitMap, targetSymbol)
      : (graphicsInstancePath ?? targetSymbol.circuitSymbolId);
    const gaSnap = snapshot.graphicsArrays[instanceId];
    if (gaSnap) {
      graphicsVram = gaSnap.vram;
      graphicsBitmapStride = gaSnap.bitmapStride;
      graphicsVramRevision = gaSnap.revision;
    }
  }

  return {
    displayValue,
    isButtonOn,
    isLedOn,
    ledState,
    segments,
    cellValues,
    isAudioActive,
    activeAudioFrequencyHz,
    graphicsVram,
    graphicsBitmapStride,
    graphicsVramRevision,
  };
}

// Berechnet Textkoordinaten einer Jam-Beschriftung unter Berücksichtigung von Trapezschrägen und ALU-Kerbe
function getSubCircuitJamLabelLayout(
  jam: CircuitSymbol["jams"][number],
  shape: CircuitShape,
  symbolGridWidth: number,
  pixelWidth: number,
  pixelHeight: number,
): { x: number; y: number; textAnchor: "start" | "end" | "middle" } {
  const side = jam.pin.pinSide;
  const safeGridW = Math.max(1, symbolGridWidth);
  if (side === "left") {
    let textX = 5;
    if (shape === "alu") {
      const dist = Math.abs(jam.y * GRID_SIZE - pixelHeight / 2);
      if (dist < 12) {
        textX = 5 + Math.round(15 * (1 - dist / 12));
      }
    }
    return { x: textX, y: jam.y * GRID_SIZE + 3, textAnchor: "start" };
  }
  if (side === "right") {
    return { x: pixelWidth - 5, y: jam.y * GRID_SIZE + 3, textAnchor: "end" };
  }
  if (side === "top") {
    let textY = 10;
    if (shape === "mux" || shape === "alu") {
      textY = 10 + Math.round(11 * (jam.x / safeGridW));
    } else if (shape === "demux") {
      textY = 10 + Math.round(11 * ((safeGridW - jam.x) / safeGridW));
    }
    return { x: jam.x * GRID_SIZE, y: textY, textAnchor: "middle" };
  }
  let textY = pixelHeight - 5;
  if (shape === "mux" || shape === "alu") {
    textY = pixelHeight - 5 - Math.round(11 * (jam.x / safeGridW));
  } else if (shape === "demux") {
    textY = pixelHeight - 5 - Math.round(11 * ((safeGridW - jam.x) / safeGridW));
  }
  return { x: jam.x * GRID_SIZE, y: textY, textAnchor: "middle" };
}

// Rendert eingebettete Display-Elemente einer "display"-Subschaltung rekursiv und maßstabsgetreu zentriert
function renderEmbeddedDisplayElements(
  targetLc: LogicalCircuit,
  targetWidthPx: number,
  targetHeightPx: number,
  isSimulating: boolean,
  snapshot: SimulationSnapshot | null,
  targetCircuitMap: CircuitMap | null | undefined,
  idPrefix: string,
  instanceSymbolChain: readonly string[],
  visitedIds: ReadonlySet<string> = new Set(),
): React.ReactNode {
  if (visitedIds.has(targetLc.logicalCircuitId)) {
    return null;
  }
  const bounds = getCircuitDisplayBounds(targetLc);
  if (!bounds) {
    return null;
  }
  const displaySymbols = getCircuitDisplaySymbols(targetLc);
  const dx = (targetWidthPx - (bounds.maxX - bounds.minX) * GRID_SIZE) / 2;
  const dy = (targetHeightPx - (bounds.maxY - bounds.minY) * GRID_SIZE) / 2;
  const nextVisited = new Set(visitedIds);
  nextVisited.add(targetLc.logicalCircuitId);

  return displaySymbols.map((childSym) => {
    const childWidthPx = childSym.circuit.symbolWidth * GRID_SIZE;
    const childHeightPx = childSym.circuit.symbolHeight * GRID_SIZE;
    const localX = (childSym.x - bounds.minX) * GRID_SIZE + dx;
    const localY = (childSym.y - bounds.minY) * GRID_SIZE + dy;
    const childAngle = getRotationAngle(childSym.rotation);
    const childOrigin = getRotationCenter(childSym.circuit.symbolWidth, childSym.circuit.symbolHeight);
    const childCenterX = childSym.circuit.symbolWidth * childOrigin.x * GRID_SIZE;
    const childCenterY = childSym.circuit.symbolHeight * childOrigin.y * GRID_SIZE;
    const childRotation = childAngle !== 0 ? ` rotate(${childAngle}, ${childCenterX}, ${childCenterY})` : "";
    const childTransform = `translate(${localX}, ${localY})${childRotation}`;
    const childIdPrefix = `${idPrefix}-${childSym.circuitSymbolId}`;

    if (childSym.circuit.kind === "logicalCircuit") {
      const nestedLc = childSym.circuit as LogicalCircuit;
      return (
        <g
          key={childSym.circuitSymbolId}
          className="embedded-display-symbol"
          data-embedded-symbol-id={childSym.circuitSymbolId}
          transform={childTransform}
        >
          {renderEmbeddedDisplayElements(
            nestedLc,
            childWidthPx,
            childHeightPx,
            isSimulating,
            snapshot,
            targetCircuitMap?.child(childSym),
            childIdPrefix,
            [...instanceSymbolChain, childSym.circuitSymbolId],
            nextVisited,
          )}
        </g>
      );
    }

    const childGateInfo = getPaletteGateType(childSym.circuit);
    if (!childGateInfo) {
      return null;
    }

    const isButtonElement = childSym.circuit.kind === "circuitButton";
    const embeddedBtn = isButtonElement ? (childSym.circuit as CircuitButton) : null;
    const rawButtonId = embeddedBtn ? (embeddedBtn.circuitButtonId ?? embeddedBtn.circuitId) : undefined;
    const displayButtonPath = rawButtonId
      ? (instanceSymbolChain.length > 0 ? `${instanceSymbolChain.join("/")}/${rawButtonId}` : rawButtonId)
      : undefined;

    const childSensor = childSym.circuit.kind === "sensor" ? (childSym.circuit as Sensor) : null;
    const childGraphics = childSym.circuit.kind === "graphicsArray"
      ? (childSym.circuit as GraphicsArray)
      : null;
    const embeddedGraphicsPath = childGraphics
      ? (instanceSymbolChain.length > 0
        ? `${instanceSymbolChain.join("/")}/${childSym.circuitSymbolId}`
        : childSym.circuitSymbolId)
      : undefined;
    const embeddedProbe = childSym.circuit.kind === "circuitProbe"
      ? (childSym.circuit as Partial<CircuitProbe>)
      : null;
    const rawEmbeddedProbeId = embeddedProbe
      ? (embeddedProbe.circuitProbeId ?? childSym.circuit.circuitId)
      : undefined;
    const embeddedProbePath = rawEmbeddedProbeId
      ? (instanceSymbolChain.length > 0
        ? `${instanceSymbolChain.join("/")}/${rawEmbeddedProbeId}`
        : rawEmbeddedProbeId)
      : undefined;
    const childState = resolveSymbolRenderState(
      childSym,
      childGateInfo,
      isSimulating,
      snapshot,
      targetCircuitMap,
      displayButtonPath,
      embeddedGraphicsPath,
      embeddedProbePath,
    );

    return (
      <g
        key={childSym.circuitSymbolId}
        className={`embedded-display-symbol${isButtonElement ? " embedded-display-button" : ""}`}
        data-embedded-symbol-id={childSym.circuitSymbolId}
        data-display-button-path={displayButtonPath}
        data-display-button-id={rawButtonId}
        data-display-button-toggle={embeddedBtn ? (embeddedBtn.isToggle ? "true" : "false") : undefined}
        style={isButtonElement && isSimulating ? { cursor: "pointer" } : undefined}
        transform={childTransform}
      >
        <SymbolRenderer
          type={childGateInfo.type}
          inputCount={childGateInfo.inputCount}
          showPins={false}
          name={childSym.circuit.name}
          width={childWidthPx}
          height={childHeightPx}
          value={childState.displayValue}
          notation={childSym.circuit.notation}
          symbolId={childIdPrefix}
          pins={childSym.circuit.pins}
          isToggle={(childSym.circuit as Partial<CircuitButton>).isToggle}
          isOn={
            childState.isButtonOn ||
            childState.isLedOn ||
            (childSym.circuit as Partial<Gate>).isOn ||
            false
          }
          ledState={childState.ledState}
          color={(childSym.circuit as Partial<Gate>).color}
          segments={childState.segments}
          rows={(childSym.circuit as Partial<LedMatrix>).rows}
          columns={(childSym.circuit as Partial<LedMatrix>).columns}
          matrixType={(childSym.circuit as Partial<LedMatrix>).matrixType}
          cellShape={(childSym.circuit as Partial<LedMatrix>).cellShape}
          colors={(childSym.circuit as Partial<LedMatrix>).colors}
          persistenceMultiplier={(childSym.circuit as Partial<LedMatrix>).persistenceMultiplier}
          cellValues={childState.cellValues}
          clockwise={(childSym.circuit as Partial<Splitter>).clockwise}
          pinCount={(childSym.circuit as Partial<Splitter>).pinCount}
          bitWidth={childSensor?.bitWidth ?? (childSym.circuit as Partial<Splitter>).bitWidth}
          sensorType={childSensor?.sensorType}
          graphicsWidth={childGraphics?.width}
          graphicsHeight={childGraphics?.height}
          bitsPerPixel={childGraphics?.bitsPerPixel}
          graphicsZoom={childGraphics?.zoom}
          graphicsVram={childState.graphicsVram}
          graphicsBitmapStride={childState.graphicsBitmapStride}
          graphicsVramRevision={childState.graphicsVramRevision}
          isInteractive={false}
        />
        {isButtonElement && displayButtonPath && (
          <rect
            x={0}
            y={0}
            width={childWidthPx}
            height={childHeightPx}
            fill="transparent"
            className="display-button-hit-target"
            data-display-button-path={displayButtonPath}
            data-display-button-id={rawButtonId}
            data-display-button-toggle={embeddedBtn?.isToggle ? "true" : "false"}
            style={isSimulating ? { cursor: "pointer" } : undefined}
            onClick={(e) => {
              if (isSimulating) {
                e.stopPropagation();
              }
            }}
            onDoubleClick={(e) => {
              if (isSimulating) {
                e.stopPropagation();
              }
            }}
          />
        )}
      </g>
    );
  });
}

const CircuitSymbolView = styled(({
  symbol,
  isSelected = false,
  isCandidateSelected = false,
  isOnlySelected = true,
  isAiHighlighted = false,
  isCleanUpDimmed = false,
  onSymbolPointerDown,
  onSymbolDoubleClick,
  onResizeHandlePointerDown,
  ...other
}: CircuitSymbolViewProps) => {
  const { t } = useTranslation();
  const pixelWidth = symbol.circuit.symbolWidth * GRID_SIZE;
  const pixelHeight = symbol.circuit.symbolHeight * GRID_SIZE;

  const angle = getRotationAngle(symbol.rotation);
  const origin = getRotationCenter(symbol.circuit.symbolWidth, symbol.circuit.symbolHeight);
  const centerX = symbol.circuit.symbolWidth * origin.x * GRID_SIZE;
  const centerY = symbol.circuit.symbolHeight * origin.y * GRID_SIZE;

  const rotationTransform = angle !== 0 ? ` rotate(${angle}, ${centerX}, ${centerY})` : "";
  const transform = `translate(${symbol.x * GRID_SIZE}, ${symbol.y * GRID_SIZE})${rotationTransform}`;

  const {
    isSimulating,
    snapshot,
    circuitMap,
    selectedCircuitMap,
    setSensorValue,
  } = React.useContext(SimulationContext);
  const activeCircuitMap = selectedCircuitMap ?? circuitMap;
  const gateInfo = getPaletteGateType(symbol.circuit);
  const isSubCircuit = symbol.circuit.kind === "logicalCircuit";

  const trimmedNote = symbol.circuit.note?.trim();
  const resolveLedColorName = (rawColor: DisplayColor): string => {
    switch (rawColor) {
      case "green":
        return t("common.colorsLower.green");
      case "blue":
        return t("common.colorsLower.blue");
      case "yellow":
        return t("common.colorsLower.yellow");
      case "red":
      default:
        return t("common.colorsLower.red");
    }
  };
  let baseName = symbol.circuit.name;
  if (gateInfo?.type === "led") {
    const color = ((symbol.circuit as Partial<Gate>).color || "red") as DisplayColor;
    baseName = t("canvas.symbol.ledName", { color: resolveLedColorName(color) });
  } else if (gateInfo?.type === "sevenSegment") {
    const color = ((symbol.circuit as Partial<Gate>).color || "red") as DisplayColor;
    baseName = t("canvas.symbol.sevenSegmentName", { color: resolveLedColorName(color) });
  } else if (symbol.circuit.kind === "memory") {
    const mem = symbol.circuit as Memory;
    baseName = t(mem.writable ? "canvas.symbol.ramName" : "canvas.symbol.romName", {
      addressBits: mem.addressBitWidth,
      dataBits: mem.dataBitWidth,
    });
  } else if (symbol.circuit.kind === "graphicsArray") {
    const ga = symbol.circuit as GraphicsArray;
    baseName = t("canvas.symbol.graphicsArrayName", {
      width: ga.width,
      height: ga.height,
      bitsPerPixel: ga.bitsPerPixel,
      colors: 1 << ga.bitsPerPixel,
    });
  }
  const baseTooltipText = trimmedNote
    ? `${baseName}\n\n${trimmedNote}`
    : baseName;
  const tooltipText = isCleanUpDimmed
    ? `${baseTooltipText}\n${t("canvas.symbol.unusedTooltip")}`
    : baseTooltipText;

  const {
    displayValue,
    isButtonOn,
    isLedOn,
    ledState,
    segments,
    cellValues,
    isAudioActive,
    activeAudioFrequencyHz,
    graphicsVram,
    graphicsBitmapStride,
    graphicsVramRevision,
  } = resolveSymbolRenderState(symbol, gateInfo, isSimulating, snapshot, activeCircuitMap);

  const memoryCircuit = symbol.circuit.kind === "memory" ? (symbol.circuit as Memory) : null;
  const graphicsCircuit = symbol.circuit.kind === "graphicsArray"
    ? (symbol.circuit as GraphicsArray)
    : null;
  const sensorCircuit = symbol.circuit.kind === "sensor" ? (symbol.circuit as Sensor) : null;
  const soundCircuit = symbol.circuit.kind === "sound" ? (symbol.circuit as Sound) : null;
  const synthesizerCircuit =
    symbol.circuit.kind === "synthesizer" ? (symbol.circuit as Synthesizer) : null;
  const isInteractiveSensor = Boolean(
    isSimulating
    && sensorCircuit
    && (sensorCircuit.sensorType === "manual"
      || sensorCircuit.sensorType === "ascii"
      || sensorCircuit.sensorType === "keyCode"),
  );
  const [sensorDraft, setSensorDraft] = React.useState(displayValue ?? "0");
  const [isSensorFocused, setIsSensorFocused] = React.useState(false);

  React.useEffect(
    () => {
      if (!isSensorFocused && displayValue !== undefined) {
        setSensorDraft(displayValue);
      }
    },
    [displayValue, isSensorFocused],
  );

  const subCircuit = isSubCircuit ? (symbol.circuit as LogicalCircuit) : null;
  const rawSubShape: CircuitShape = subCircuit
    ? (subCircuit.circuitShape ?? (subCircuit.isDisplay ? "display" : "rectangular"))
    : "rectangular";
  const isValidSubDisplay = Boolean(
    subCircuit && rawSubShape === "display" && circuitContainsDisplays(subCircuit),
  );
  const effectiveSubShape: CircuitShape =
    rawSubShape === "display" && !isValidSubDisplay ? "rectangular" : rawSubShape;
  const subShapePath = isSubCircuit
    ? getSubCircuitShapePath(effectiveSubShape, pixelWidth, pixelHeight)
    : null;
  const subCircuitMap = isSubCircuit ? activeCircuitMap?.child(symbol) : undefined;
  const hasPinStemLines =
    effectiveSubShape === "mux" || effectiveSubShape === "demux" || effectiveSubShape === "alu";
  const chipLabel = subCircuit ? (subCircuit.notation || subCircuit.name) : symbol.circuit.name;
  const hasTopPins = isSubCircuit && symbol.jams.some((j) => j.pin.pinSide === "top");
  const insideChipLabelX =
    effectiveSubShape === "alu"
      ? Math.round((15 + pixelWidth) / 2)
      : effectiveSubShape === "flipFlop"
        ? Math.round((11 + pixelWidth) / 2)
        : pixelWidth / 2;

  const normalJams = React.useMemo(
    () => {
      return symbol.jams.filter((jam) => !jam.pin.inverted);
    },
    [symbol.jams],
  );

  const invertedJams = React.useMemo(
    () => {
      return symbol.jams.filter((jam) => jam.pin.inverted);
    },
    [symbol.jams],
  );

  const isMatrix = symbol.circuit.kind === "ledMatrix";
  const isSimulatingButton = isSimulating && symbol.circuit.kind === "circuitButton";
  const selectionPadding = isMatrix ? 6 : 3;
  const selectionRx = isMatrix ? 4 : 2;

  return (
    <g
      {...other}
      data-component="CircuitSymbolView"
      data-symbol-id={symbol.circuitSymbolId}
      data-sim-button={isSimulatingButton ? "true" : undefined}
      data-ai-highlighted={isAiHighlighted ? "true" : undefined}
      data-cleanup-unused={isCleanUpDimmed ? "true" : undefined}
      opacity={isCleanUpDimmed && !isSelected && !isCandidateSelected ? CLEANUP_DIM_OPACITY : undefined}
      transform={transform}
      onPointerDown={(event) => onSymbolPointerDown?.(event, symbol)}
      onDoubleClick={(event) => onSymbolDoubleClick?.(event, symbol)}
    >
      {/* Nativer Browser-Tooltip bei Mausberührung */}
      <title>{tooltipText}</title>

      {/* Dezente, zeitlich begrenzte Hervorhebung für von der KI platzierte/geänderte Bausteine */}
      {isAiHighlighted && (
        <rect
          x={-selectionPadding - 2}
          y={-selectionPadding - 2}
          width={pixelWidth + (selectionPadding + 2) * 2}
          height={pixelHeight + (selectionPadding + 2) * 2}
          rx={selectionRx + 2}
          className="ai-highlight-box"
        />
      )}

      {/* Visueller Auswahlrahmen bei selektiertem Baustein */}
      {isSelected && (
        <rect
          x={-selectionPadding}
          y={-selectionPadding}
          width={pixelWidth + selectionPadding * 2}
          height={pixelHeight + selectionPadding * 2}
          rx={selectionRx}
          className="selection-box"
        />
      )}

      {/* Visueller Rahmen für Bausteine in der aktiven Rechteck-Vorauswahl */}
      {!isSelected && isCandidateSelected && (
        <rect
          x={-selectionPadding}
          y={-selectionPadding}
          width={pixelWidth + selectionPadding * 2}
          height={pixelHeight + selectionPadding * 2}
          rx={selectionRx}
          className="candidate-box"
        />
      )}

      {/* Darstellung als Sub-Circuit-Chip oder Standard-Gatter */}
      {isSubCircuit && subCircuit ? (
        <g className="sub-circuit-chip" data-circuit-shape={effectiveSubShape}>
          {/* Anschluss-Hilfslinien für abgeschrägte Kanten (Mux, Demux, ALU) */}
          {hasPinStemLines && symbol.jams.map((jam) => {
            if (jam.pin.pinSide === "top") {
              return (
                <line
                  key={`stem-${jam.pin.pinId}`}
                  x1={jam.x * GRID_SIZE}
                  y1={0}
                  x2={jam.x * GRID_SIZE}
                  y2={GRID_SIZE}
                  className="pin-stem-line"
                />
              );
            }
            if (jam.pin.pinSide === "bottom") {
              return (
                <line
                  key={`stem-${jam.pin.pinId}`}
                  x1={jam.x * GRID_SIZE}
                  y1={pixelHeight - GRID_SIZE}
                  x2={jam.x * GRID_SIZE}
                  y2={pixelHeight}
                  className="pin-stem-line"
                />
              );
            }
            if (
              effectiveSubShape === "alu" &&
              jam.pin.pinSide === "left" &&
              Math.abs(jam.y * GRID_SIZE - pixelHeight / 2) < 12
            ) {
              return (
                <line
                  key={`stem-${jam.pin.pinId}`}
                  x1={0}
                  y1={jam.y * GRID_SIZE}
                  x2={15}
                  y2={jam.y * GRID_SIZE}
                  className="pin-stem-line"
                />
              );
            }
            return null;
          })}
          {/* Normale Pins unter dem Chip-Körper */}
          {normalJams.map((jam) => (
            <circle
              key={jam.pin.pinId}
              cx={jam.x * GRID_SIZE}
              cy={jam.y * GRID_SIZE}
              r={3}
              className={`pin-point pin-${jam.pin.pinType}`}
            />
          ))}
          {/* Gehäusekörper entsprechend CircuitShape */}
          {subShapePath ? (
            <path
              d={subShapePath}
              className={`chip-body shape-${effectiveSubShape}`}
            />
          ) : (
            <rect
              x={0}
              y={0}
              width={pixelWidth}
              height={pixelHeight}
              rx={effectiveSubShape === "display" ? 3 : 4}
              className={`chip-body shape-${effectiveSubShape}`}
            />
          )}
          {/* Vertikale Trennlinie für Flipflop-Symbolform */}
          {effectiveSubShape === "flipFlop" && (
            <line
              x1={11}
              y1={0}
              x2={11}
              y2={pixelHeight}
              className="chip-divider-line"
            />
          )}
          {/* Zentrierte Vorschau enthaltener Display-Elemente bei Symbolform "display" */}
          {effectiveSubShape === "display" && (
            <g className="display-chip-content">
              {renderEmbeddedDisplayElements(
                subCircuit,
                pixelWidth,
                pixelHeight,
                isSimulating,
                snapshot,
                subCircuitMap,
                symbol.circuitSymbolId,
                subCircuitMap
                  ? getCircuitMapSymbolChain(subCircuitMap)
                  : [...getCircuitMapSymbolChain(activeCircuitMap), symbol.circuitSymbolId],
              )}
            </g>
          )}
          {/* Invertierte Pins über dem Chip-Körper */}
          {invertedJams.map((jam) => (
            <circle
              key={jam.pin.pinId}
              cx={jam.x * GRID_SIZE}
              cy={jam.y * GRID_SIZE}
              r={3}
              className={`pin-point pin-inverted pin-${jam.pin.pinType}`}
            />
          ))}
          {/* Pin-Kurzbezeichnungen (Jam-Notation oder Pin-Name-Fallback) an allen Kanten */}
          {symbol.jams.map((jam) => {
            const label = getPinJamDisplayLabel(jam.pin);
            if (!label) {
              return null;
            }
            const layout = getSubCircuitJamLabelLayout(
              jam,
              effectiveSubShape,
              subCircuit.symbolWidth,
              pixelWidth,
              pixelHeight,
            );
            return (
              <text
                key={`jam-label-${jam.pin.pinId}`}
                x={layout.x}
                y={layout.y}
                textAnchor={layout.textAnchor}
                data-pin-id={jam.pin.pinId}
                data-pin-side={jam.pin.pinSide}
                className="pin-jam-label"
              >
                {label}
              </text>
            );
          })}
          {/* Chip-Bezeichnung: optional frei stehend oberhalb oder zentriert im Gehäuse */}
          {subCircuit.showLabelAbove ? (
            <text
              x={pixelWidth / 2}
              y={hasTopPins ? -9 : -6}
              textAnchor="middle"
              className="chip-name chip-name-above"
            >
              {chipLabel}
            </text>
          ) : effectiveSubShape !== "display" ? (
            <text
              x={insideChipLabelX}
              y={pixelHeight / 2 + 3}
              textAnchor="middle"
              className="chip-name"
            >
              {chipLabel}
            </text>
          ) : null}
        </g>
      ) : gateInfo ? (
        <SymbolRenderer
          type={gateInfo.type}
          inputCount={gateInfo.inputCount}
          showPins={true}
          name={symbol.circuit.name}
          width={pixelWidth}
          height={pixelHeight}
          value={displayValue}
          notation={symbol.circuit.notation}
          symbolId={symbol.circuitSymbolId}
          pins={symbol.circuit.pins}
          isToggle={(symbol.circuit as Partial<CircuitButton>).isToggle}
          isOn={
            isButtonOn ||
            isLedOn ||
            (symbol.circuit as Partial<Gate>).isOn ||
            false
          }
          ledState={ledState}
          color={(symbol.circuit as Partial<Gate>).color}
          segments={segments}
          rows={(symbol.circuit as Partial<LedMatrix>).rows}
          columns={(symbol.circuit as Partial<LedMatrix>).columns}
          matrixType={(symbol.circuit as Partial<LedMatrix>).matrixType}
          cellShape={(symbol.circuit as Partial<LedMatrix>).cellShape}
          colors={(symbol.circuit as Partial<LedMatrix>).colors}
          persistenceMultiplier={(symbol.circuit as Partial<LedMatrix>).persistenceMultiplier}
          cellValues={cellValues}
          clockwise={(symbol.circuit as Partial<Splitter>).clockwise}
          pinCount={(symbol.circuit as Partial<Splitter>).pinCount}
          bitWidth={
            sensorCircuit?.bitWidth ?? (symbol.circuit as Partial<Splitter>).bitWidth
          }
          sensorType={sensorCircuit?.sensorType}
          addressBitWidth={memoryCircuit?.addressBitWidth}
          dataBitWidth={memoryCircuit?.dataBitWidth}
          writeOn1={memoryCircuit?.writeOn1}
          dualPort={memoryCircuit?.dualPort}
          isInteractive={isInteractiveSensor}
          frequency={soundCircuit?.frequency}
          waveform={soundCircuit?.waveform}
          synthesizerMode={synthesizerCircuit?.mode}
          isAudioActive={isAudioActive}
          activeAudioFrequencyHz={activeAudioFrequencyHz}
          graphicsWidth={graphicsCircuit?.width}
          graphicsHeight={graphicsCircuit?.height}
          bitsPerPixel={graphicsCircuit?.bitsPerPixel}
          graphicsZoom={graphicsCircuit?.zoom}
          graphicsVram={graphicsVram}
          graphicsBitmapStride={graphicsBitmapStride}
          graphicsVramRevision={graphicsVramRevision}
        />
      ) : null}

      {/* Interaktive Direkteingabe für manuelle / Tastatur-Sensoren während der Simulation */}
      {isInteractiveSensor && sensorCircuit && (
        <foreignObject
          x={5}
          y={Math.round(pixelHeight * 0.42)}
          width={Math.max(16, pixelWidth - 10)}
          height={Math.max(18, Math.round(pixelHeight * 0.52))}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            className="sensor-live-input"
            aria-label={t("canvas.symbol.sensorLiveInputAriaLabel", {
              sensorType: sensorCircuit.sensorType,
            })}
            readOnly={sensorCircuit.sensorType !== "manual"}
            value={sensorCircuit.sensorType === "manual" ? sensorDraft : (displayValue ?? "")}
            onFocus={() => setIsSensorFocused(true)}
            onBlur={() => {
              setIsSensorFocused(false);
              if (sensorCircuit.sensorType === "keyCode") {
                void setSensorValue(sensorCircuit.sensorId ?? sensorCircuit.circuitId, 0);
              }
            }}
            onChange={(e) => {
              if (sensorCircuit.sensorType !== "manual") {
                return;
              }
              const cleaned = e.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 8);
              setSensorDraft(cleaned);
              const parsed = cleaned === "" ? 0 : parseHexUint(cleaned);
              if (parsed !== null) {
                void setSensorValue(sensorCircuit.sensorId ?? sensorCircuit.circuitId, parsed);
              }
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              const targetId = sensorCircuit.sensorId ?? sensorCircuit.circuitId;
              if (sensorCircuit.sensorType === "ascii") {
                let code: number | null = null;
                if (e.key === "Enter") {
                  code = 13;
                } else if (e.key === "Backspace") {
                  code = 8;
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  code = 9;
                } else if (e.key === "Escape") {
                  code = 27;
                } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  e.preventDefault();
                  code = e.key.charCodeAt(0);
                }
                if (code !== null) {
                  void setSensorValue(targetId, code);
                }
              } else if (sensorCircuit.sensorType === "keyCode") {
                e.preventDefault();
                const wpfCode = keyboardEventToWpfKeyCode(e);
                if (wpfCode > 0) {
                  void setSensorValue(targetId, wpfCode);
                }
              }
            }}
            onKeyUp={(e) => {
              e.stopPropagation();
              if (sensorCircuit.sensorType === "keyCode") {
                const targetId = sensorCircuit.sensorId ?? sensorCircuit.circuitId;
                void setSensorValue(targetId, 0);
              }
            }}
          />
        </foreignObject>
      )}

      {/* 8 Resize-Anfasser für dynamisch größenveränderbare Symbole */}
      {!isSimulating && isSelected && isOnlySelected && isResizableCircuitKind(symbol.circuit.kind) && (
        <g className="resize-markers">
          {RESIZE_HANDLES.map((handle) => {
            const hxPos = (pixelWidth * handle.hx) / 2;
            const hyPos = (pixelHeight * handle.hy) / 2;
            return (
              <rect
                key={handle.key}
                x={hxPos - 3.5}
                y={hyPos - 3.5}
                width={7}
                height={7}
                style={{ cursor: handle.cursor }}
                className="resize-handle"
                onPointerDown={(e) =>
                  onResizeHandlePointerDown?.(e, symbol, handle.hx, handle.hy)
                }
              />
            );
          })}
        </g>
      )}
    </g>
  );
})({
  cursor: "move",
  userSelect: "none",

  "&[data-sim-button=\"true\"]": {
    cursor: "pointer",
  },

  "& > .ai-highlight-box": {
    fill: "var(--color-ai-highlight-fill)",
    stroke: "var(--color-ai-highlight)",
    strokeWidth: 1.5,
    strokeDasharray: "3 2",
    pointerEvents: "none",
    animation: `${AI_HIGHLIGHT_PULSE} 1.2s ease-in-out infinite`,
  },

  "& > .selection-box": {
    fill: "var(--color-accent-tint-subtle)",
    stroke: "var(--color-accent-primary)",
    strokeWidth: 1.5,
    strokeDasharray: "4 2",
    pointerEvents: "none",
  },

  "& > .candidate-box": {
    fill: "var(--color-candidate-fill)",
    stroke: "var(--color-accent-primary-hover)",
    strokeWidth: 1.5,
    strokeDasharray: "2 2",
    pointerEvents: "none",
  },

  "& > .sub-circuit-chip": {
    "& > .chip-body": {
      fill: "var(--color-bg-elevated)",
      stroke: "var(--color-text-primary)",
      strokeWidth: 1.5,
    },
    "& > .chip-body.shape-display": {
      fill: "var(--color-bg-surface)",
    },
    "& > .pin-stem-line": {
      stroke: "var(--color-text-primary)",
      strokeWidth: 1.5,
      pointerEvents: "none",
    },
    "& > .chip-divider-line": {
      stroke: "var(--color-text-primary)",
      strokeWidth: 1.2,
      pointerEvents: "none",
    },
    "& > .chip-name": {
      fill: "var(--color-text-primary)",
      fontSize: "9px",
      fontWeight: 700,
      fontFamily: "var(--font-family-mono)",
      pointerEvents: "none",
    },
    "& > .pin-jam-label": {
      fill: "var(--color-text-secondary)",
      fontSize: "8px",
      fontWeight: 600,
      fontFamily: "var(--font-family-mono)",
      pointerEvents: "none",
    },
    "& > .pin-point": {
      strokeWidth: 1.5,
    },
    "& > .pin-input:not(.pin-inverted)": {
      fill: "var(--color-accent-primary)",
      stroke: "none",
    },
    "& > .pin-output:not(.pin-inverted)": {
      fill: "var(--color-logic-high)",
      stroke: "none",
    },
    "& > .pin-inverted": {
      fill: "var(--color-bg-base)",
    },
    "& > .pin-inverted.pin-input": {
      stroke: "var(--color-accent-primary)",
    },
    "& > .pin-inverted.pin-output": {
      stroke: "var(--color-logic-high)",
    },
  },

  "& .resize-handle": {
    fill: "var(--color-bg-base)",
    stroke: "var(--color-accent-primary)",
    strokeWidth: 1.2,
  },

  "& .sensor-live-input": {
    width: "100%",
    height: "100%",
    padding: "0 0.125rem",
    boxSizing: "border-box",
    border: "1px solid var(--color-accent-primary)",
    borderRadius: "0.125rem",
    backgroundColor: "var(--color-bg-surface)",
    color: "var(--color-text-primary)",
    fontFamily: "var(--font-family-mono)",
    fontSize: "0.6875rem",
    fontWeight: 700,
    textAlign: "center",
    outline: "none",
  },
});

export default CircuitSymbolView;
