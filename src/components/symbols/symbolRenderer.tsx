import React from "react";

import styled from "@emotion/styled";

import type BasePin from "../../types/circuit/basePin";
import type CircuitShape from "../../types/circuit/circuitShape";
import type DevicePin from "../../types/circuit/devicePin";
import type DisplayColor from "../../types/circuit/displayColor";
import type LedMatrixCellShape from "../../types/circuit/ledMatrixCellShape";
import type LedMatrixType from "../../types/circuit/ledMatrixType";
import type PaletteGateType from "../../types/circuit/paletteGateType";
import type PinSide from "../../types/circuit/pinSide";
import type SensorType from "../../types/circuit/sensorType";
import type SoundWaveform from "../../types/circuit/soundWaveform";
import type SynthesizerMode from "../../types/circuit/synthesizerMode";
import type State from "../../types/simulation/state";

import { getComponentLayout } from "../../utils/circuitLayout";
import { GRID_SIZE } from "../../utils/coordinateSystem";

import GraphicsArrayShape from "./display/graphicsArrayShape";
import LedDisplayShape from "./display/ledDisplayShape";
import LedMatrixShape from "./display/ledMatrixShape";
import SevenSegmentShape from "./display/sevenSegmentShape";
import AndGateShape from "./gate/andGateShape";
import NotGateShape from "./gate/notGateShape";
import OrGateShape from "./gate/orGateShape";
import TriStateGateShape from "./gate/triStateGateShape";
import XorGateShape from "./gate/xorGateShape";
import ButtonShape from "./io/buttonShape";
import ClockShape from "./io/clockShape";
import ConstantShape from "./io/constantShape";
import MemoryShape from "./io/memoryShapes";
import PinShape from "./io/pinShape";
import ProbeShape from "./io/probeShape";
import SensorShape from "./io/sensorShape";
import SoundShape from "./io/soundShape";
import SplitterShape from "./io/splitterShape";
import SynthesizerShape from "./io/synthesizerShape";

// Erzeugt den SVG-Gehäusepfad für trapezförmige Sub-Schaltungen analog zu SymbolShapes/*.xaml
export function getSubCircuitShapePath(
  shape: CircuitShape,
  pixelWidth: number,
  pixelHeight: number,
): string | null {
  switch (shape) {
    case "mux":
      return `M 0.5 0.5 L ${pixelWidth - 0.5} 12 L ${pixelWidth - 0.5} ${pixelHeight - 12} L 0.5 ${pixelHeight - 0.5} Z`;
    case "demux":
      return `M 0.5 12 L ${pixelWidth - 0.5} 0.5 L ${pixelWidth - 0.5} ${pixelHeight - 0.5} L 0.5 ${pixelHeight - 12} Z`;
    case "alu":
      return (
        `M 0.5 0.5 L ${pixelWidth - 0.5} 12 L ${pixelWidth - 0.5} ${pixelHeight - 12} ` +
        `L 0.5 ${pixelHeight - 0.5} L 0.5 ${pixelHeight / 2 + 12} ` +
        `L 15 ${pixelHeight / 2} L 0.5 ${pixelHeight / 2 - 12} Z`
      );
    case "rectangular":
    case "flipFlop":
    case "display":
    default:
      return null;
  }
}

type SymbolRendererProps = React.ComponentPropsWithoutRef<"g"> & {
  type: PaletteGateType;
  inputCount?: number;
  showPins?: boolean;
  name?: string;
  width?: number;
  height?: number;
  value?: string;
  notation?: string;
  symbolId?: string;
  pins?: BasePin[];
  isToggle?: boolean;
  isOn?: boolean;
  isDisconnected?: boolean;
  ledState?: State;
  color?: DisplayColor;
  segments?: boolean[];
  matrixType?: LedMatrixType;
  cellShape?: LedMatrixCellShape;
  rows?: number;
  columns?: number;
  colors?: number;
  persistenceMultiplier?: 1 | 2 | 3;
  cellValues?: number[][];
  clockwise?: boolean;
  pinCount?: number;
  bitWidth?: number;
  pinSide?: PinSide;
  sensorType?: SensorType;
  addressBitWidth?: number;
  dataBitWidth?: number;
  writeOn1?: boolean;
  dualPort?: boolean;
  isInteractive?: boolean;
  frequency?: number;
  waveform?: SoundWaveform;
  synthesizerMode?: SynthesizerMode;
  isAudioActive?: boolean;
  activeAudioFrequencyHz?: number | null;
  graphicsWidth?: number;
  graphicsHeight?: number;
  bitsPerPixel?: number;
  graphicsZoom?: number;
  graphicsVram?: Uint8Array;
  graphicsBitmapStride?: number;
  graphicsVramRevision?: number;
  isPalettePreview?: boolean;
};

const SymbolRenderer = styled(({
  type,
  inputCount = 2,
  showPins = false,
  name,
  width,
  height,
  value,
  notation,
  symbolId,
  pins,
  isToggle = false,
  isOn = false,
  isDisconnected = false,
  ledState,
  color,
  segments,
  matrixType,
  cellShape,
  rows,
  columns,
  colors,
  persistenceMultiplier,
  cellValues,
  clockwise = true,
  pinCount = 3,
  bitWidth,
  pinSide,
  sensorType,
  addressBitWidth,
  dataBitWidth,
  writeOn1,
  dualPort,
  isInteractive = false,
  frequency,
  waveform,
  synthesizerMode,
  isAudioActive = false,
  activeAudioFrequencyHz = null,
  graphicsWidth,
  graphicsHeight,
  bitsPerPixel,
  graphicsZoom,
  graphicsVram,
  graphicsBitmapStride,
  graphicsVramRevision,
  isPalettePreview = false,
  ...other
}: SymbolRendererProps) => {
  const layout = React.useMemo(
    () => {
      return getComponentLayout(type, {
        inputCount,
        rows,
        columns,
        matrixType,
        cellShape,
        color,
        pinCount,
        clockwise,
        bitWidth,
        pinSide,
        sensorType,
        addressBitWidth,
        dataBitWidth,
        bitsPerPixel,
        width: graphicsWidth,
        height: graphicsHeight,
        zoom: graphicsZoom,
        writeOn1,
        dualPort,
        frequency,
        waveform,
        synthesizerMode,
      });
    },
    [
      addressBitWidth,
      bitWidth,
      bitsPerPixel,
      cellShape,
      clockwise,
      color,
      columns,
      dataBitWidth,
      dualPort,
      frequency,
      graphicsHeight,
      graphicsWidth,
      graphicsZoom,
      inputCount,
      matrixType,
      pinCount,
      pinSide,
      rows,
      sensorType,
      synthesizerMode,
      type,
      waveform,
      writeOn1,
    ],
  );

  const pixelWidth = width ?? layout.gridWidth * GRID_SIZE;
  const pixelHeight = height ?? layout.gridHeight * GRID_SIZE;

  // Berechnet die Pin-Rasterpunkte basierend auf den tatsächlichen Symbol-Pins oder benutzerdefinierten Maßen
  const effectivePins = React.useMemo(
    () => {
      if (pins && pins.length > 0) {
        return pins;
      }
      if (width !== undefined || height !== undefined) {
        const gridW = width !== undefined ? Math.max(2, Math.round(width / GRID_SIZE)) : layout.gridWidth;
        const gridH = height !== undefined ? Math.max(2, Math.round(height / GRID_SIZE)) : layout.gridHeight;
        const centerY = Math.floor(gridH / 2);

        if (type === "button" || type === "constant") {
          const side = pinSide ?? "right";
          const p: DevicePin = {
            kind: "devicePin",
            pinId: `${symbolId || "prev"}-out`,
            circuitId: "preview",
            bitWidth: 1,
            pinType: "output",
            pinSide: side,
            inverted: false,
            name: "Out",
            note: "",
            jamNotation: "",
            order: 0,
            gridPoint: {
              x: side === "left" ? 0 : side === "right" ? gridW : Math.floor(gridW / 2),
              y: side === "top" ? 0 : side === "bottom" ? gridH : centerY,
            },
          };
          return [p];
        }
        if (type === "probe") {
          const p: DevicePin = {
            kind: "devicePin",
            pinId: `${symbolId || "prev"}-in`,
            circuitId: "preview",
            bitWidth: 1,
            pinType: "input",
            pinSide: "left",
            inverted: false,
            name: "In",
            note: "",
            jamNotation: "",
            order: 0,
            gridPoint: { x: 0, y: centerY },
          };
          return [p];
        }
        if (type === "pin" || type === "pinIn") {
          const p: DevicePin = {
            kind: "devicePin",
            pinId: `${symbolId || "prev"}-pin-in`,
            circuitId: "preview",
            bitWidth: 1,
            pinType: "output",
            pinSide: "right",
            inverted: false,
            name: "In",
            note: "",
            jamNotation: "",
            order: 0,
            gridPoint: { x: gridW, y: centerY },
          };
          return [p];
        }
        if (type === "pinOut") {
          const p: DevicePin = {
            kind: "devicePin",
            pinId: `${symbolId || "prev"}-pin-out`,
            circuitId: "preview",
            bitWidth: 1,
            pinType: "input",
            pinSide: "left",
            inverted: false,
            name: "Out",
            note: "",
            jamNotation: "",
            order: 0,
            gridPoint: { x: 0, y: centerY },
          };
          return [p];
        }
        if (type === "led") {
          const p: DevicePin = {
            kind: "devicePin",
            pinId: `${symbolId || "prev"}-led-in`,
            circuitId: "preview",
            bitWidth: 1,
            pinType: "input",
            pinSide: "left",
            inverted: false,
            name: "In",
            note: "",
            jamNotation: "",
            order: 0,
            gridPoint: { x: 0, y: centerY },
          };
          return [p];
        }
      }
      return layout.pins;
    },
    [
      height,
      layout.gridHeight,
      layout.gridWidth,
      layout.pins,
      pinSide,
      pins,
      symbolId,
      type,
      width,
    ],
  );

  const normalPins = React.useMemo(
    () => {
      return effectivePins.filter((pin) => !pin.inverted);
    },
    [effectivePins],
  );

  const invertedPins = React.useMemo(
    () => {
      return effectivePins.filter((pin) => pin.inverted);
    },
    [effectivePins],
  );

  // Rendert die spezifische ANSI-Vektorform
  const renderShape = () => {
    switch (type) {
      case "not":
        return <NotGateShape width={pixelWidth} height={pixelHeight} />;
      case "and":
        return <AndGateShape width={pixelWidth} height={pixelHeight} inputCount={inputCount} isInverted={false} />;
      case "nand":
        return <AndGateShape width={pixelWidth} height={pixelHeight} inputCount={inputCount} isInverted={true} />;
      case "or":
        return <OrGateShape width={pixelWidth} height={pixelHeight} inputCount={inputCount} isInverted={false} />;
      case "nor":
        return <OrGateShape width={pixelWidth} height={pixelHeight} inputCount={inputCount} isInverted={true} />;
      case "xor":
        return <XorGateShape width={pixelWidth} height={pixelHeight} inputCount={inputCount} isInverted={false} />;
      case "xnor":
        return <XorGateShape width={pixelWidth} height={pixelHeight} inputCount={inputCount} isInverted={true} />;
      case "triState1":
        return <TriStateGateShape width={pixelWidth} height={pixelHeight} enableFromTop={false} />;
      case "triState2":
        return <TriStateGateShape width={pixelWidth} height={pixelHeight} enableFromTop={true} />;
      case "clock":
        return <ClockShape width={pixelWidth} height={pixelHeight} />;
      case "button":
        return (
          <ButtonShape
            width={pixelWidth}
            height={pixelHeight}
            notation={notation}
            symbolId={symbolId}
            isToggle={isToggle}
            isOn={isOn}
          />
        );
      case "constant":
        return <ConstantShape width={pixelWidth} height={pixelHeight} value={value} symbolId={symbolId} />;
      case "probe":
        return <ProbeShape width={pixelWidth} height={pixelHeight} name={name} value={value ?? "?"} symbolId={symbolId} />;
      case "pin":
      case "pinIn":
        return <PinShape width={pixelWidth} height={pixelHeight} name={name ?? "X"} pinType="in" symbolId={symbolId} />;
      case "pinOut":
        return <PinShape width={pixelWidth} height={pixelHeight} name={name ?? "Q"} pinType="out" symbolId={symbolId} />;
      case "led":
        return (
          <LedDisplayShape
            width={pixelWidth}
            height={pixelHeight}
            isOn={isOn}
            isDisconnected={isDisconnected}
            state={ledState}
            color={color}
            symbolId={symbolId}
          />
        );
      case "sevenSegment":
        return (
          <SevenSegmentShape
            width={pixelWidth}
            height={pixelHeight}
            segments={segments}
            color={color}
            symbolId={symbolId}
          />
        );
      case "ledMatrix":
        return (
          <LedMatrixShape
            width={pixelWidth}
            height={pixelHeight}
            rows={rows}
            columns={columns}
            matrixType={matrixType}
            cellShape={cellShape}
            colors={colors}
            persistenceMultiplier={persistenceMultiplier}
            cellValues={cellValues}
            symbolId={symbolId}
          />
        );
      case "splitter":
        return (
          <SplitterShape
            width={pixelWidth}
            height={pixelHeight}
            clockwise={clockwise}
            pinCount={pinCount}
            bitWidth={bitWidth}
            symbolId={symbolId}
          />
        );
      case "sensor":
        return (
          <SensorShape
            width={pixelWidth}
            height={pixelHeight}
            sensorType={sensorType}
            notation={notation}
            value={value}
            symbolId={symbolId}
            isInteractive={isInteractive}
          />
        );
      case "rom":
      case "ram":
        return (
          <MemoryShape
            width={pixelWidth}
            height={pixelHeight}
            writable={type === "ram"}
            writeOn1={writeOn1}
            dualPort={dualPort}
            pins={effectivePins}
          />
        );
      case "sound":
        return (
          <SoundShape
            width={pixelWidth}
            height={pixelHeight}
            waveform={waveform}
            frequency={frequency}
            notation={notation}
            isActive={isAudioActive}
          />
        );
      case "synthesizer":
        return (
          <SynthesizerShape
            width={pixelWidth}
            height={pixelHeight}
            mode={synthesizerMode}
            activeFrequencyHz={activeAudioFrequencyHz}
            notation={notation}
            isActive={isAudioActive}
            pins={effectivePins}
          />
        );
      case "graphicsArray":
        return (
          <GraphicsArrayShape
            width={pixelWidth}
            height={pixelHeight}
            displayWidth={graphicsWidth}
            displayHeight={graphicsHeight}
            bitsPerPixel={bitsPerPixel}
            zoom={graphicsZoom}
            vram={graphicsVram}
            bitmapStride={graphicsBitmapStride}
            vramRevision={graphicsVramRevision}
            isPalettePreview={isPalettePreview}
          />
        );
      default:
        return null;
    }
  };

  return (
    <g {...other} data-component="SymbolRenderer">
      {/* Normale Pins: Werden VOR dem Symbol gezeichnet (Z-Ebene darunter) */}
      {showPins && normalPins.map((pin) => (
        <circle
          key={pin.pinId}
          cx={pin.gridPoint.x * GRID_SIZE}
          cy={pin.gridPoint.y * GRID_SIZE}
          r={3}
          className={`pin-point pin-${pin.pinType}`}
        />
      ))}

      {renderShape()}

      {/* Invertierte Pins: Werden NACH dem Symbol gezeichnet (Z-Ebene darüber) */}
      {showPins && invertedPins.map((pin) => (
        <circle
          key={pin.pinId}
          cx={pin.gridPoint.x * GRID_SIZE}
          cy={pin.gridPoint.y * GRID_SIZE}
          r={3}
          className={`pin-point pin-inverted pin-${pin.pinType}`}
        />
      ))}
    </g>
  );
})({
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
  "& > .pin-none:not(.pin-inverted)": {
    fill: "var(--color-text-primary)",
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
});

export default SymbolRenderer;
