import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import SimulationContext from "../../contexts/simulationContext";

import type DisplayColor from "../../types/circuit/displayColor";
import type LedMatrixType from "../../types/circuit/ledMatrixType";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type PaletteGateType from "../../types/circuit/paletteGateType";
import type PaletteSelection from "../../types/circuit/paletteSelection";
import type PinSide from "../../types/circuit/pinSide";
import type SensorType from "../../types/circuit/sensorType";
import type SoundWaveform from "../../types/circuit/soundWaveform";
import type SynthesizerMode from "../../types/circuit/synthesizerMode";

import {
  clampSoundFrequency,
  SOUND_DEFAULT_FREQUENCY,
  SOUND_MAX_FREQUENCY,
  SOUND_MIN_FREQUENCY,
} from "../../utils/audioPitchTable";
import { getComponentLayout } from "../../utils/circuitLayout";
import { SOUND_WAVEFORMS, SYNTHESIZER_MODES } from "../../utils/componentCatalog";
import { GRID_SIZE } from "../../utils/coordinateSystem";
import { hideBrowserDragImage } from "../../utils/dragImage";
import {
  GRAPHICS_ARRAY_BITS_PER_PIXEL,
  GRAPHICS_ARRAY_DATA_BIT_WIDTHS,
  GRAPHICS_ARRAY_PREVIEW_HEIGHT,
  GRAPHICS_ARRAY_PREVIEW_WIDTH,
} from "../../utils/graphicsArrayUtils";

import SubCircuitGlyph from "./subCircuitGlyph";
import SubCircuitPreview from "./subCircuitPreview";
import SymbolRenderer from "../symbols/symbolRenderer";

const BIT_WIDTH_OPTIONS = Array.from({ length: 32 }, (_, i) => i + 1);
const MEMORY_ADDRESS_BIT_WIDTH_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 1);
const SPLITTER_PIN_COUNT_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 2);

export type PaletteItemProps = React.ComponentPropsWithoutRef<"div"> & {
  type: PaletteGateType | "subCircuit" | "textNote";
  label: string;
  subCircuitId?: string;
  subCircuit?: LogicalCircuit;

  // Gate Eingänge
  inputCount?: number;
  hasVariableInputs?: boolean;
  onInputCountChange?: (count: number) => void;

  // Bit- / Busbreite
  bitWidth?: number;
  hasBitWidth?: boolean;
  onBitWidthChange?: (width: number) => void;

  // Pin-Seite
  pinSide?: PinSide;
  hasPinSide?: boolean;
  onPinSideChange?: (side: PinSide) => void;

  // Hex- / Dezimal-Format
  isHex?: boolean;
  hasHexFormat?: boolean;
  onHexFormatChange?: (isHex: boolean) => void;

  // Signalfarbe
  color?: DisplayColor;
  hasColor?: boolean;
  onColorChange?: (color: DisplayColor) => void;

  // LED Matrix Konfiguration
  matrixType?: LedMatrixType;
  rows?: number;
  columns?: number;
  hasMatrixConfig?: boolean;
  onMatrixTypeChange?: (matrixType: LedMatrixType) => void;
  onRowsChange?: (rows: number) => void;
  onColumnsChange?: (columns: number) => void;

  // Splitter Konfiguration
  hasSplitterConfig?: boolean;
  pinCount?: number;
  onPinCountChange?: (count: number) => void;
  pinBitWidth?: number;
  onPinBitWidthChange?: (width: number) => void;
  clockwise?: boolean;
  onClockwiseChange?: (clockwise: boolean) => void;

  // Beschriftung / Notation (z. B. für Button, Pin Eingang, Pin Ausgang)
  hasNotation?: boolean;
  notation?: string;
  onNotationChange?: (notation: string) => void;

  // Button / Taster / Schalter Konfiguration
  hasButtonConfig?: boolean;
  isToggle?: boolean;
  onToggleChange?: (isToggle: boolean) => void;

  // Sensor Konfiguration
  hasSensorConfig?: boolean;
  sensorType?: SensorType;
  onSensorTypeChange?: (sensorType: SensorType) => void;

  // Speicher (ROM / RAM) Konfiguration
  hasMemoryConfig?: boolean;
  addressBitWidth?: number;
  dataBitWidth?: number;
  onAddressBitWidthChange?: (width: number) => void;
  onDataBitWidthChange?: (width: number) => void;

  // Standard-Summer (Sound) Konfiguration
  hasSoundConfig?: boolean;
  waveform?: SoundWaveform;
  onWaveformChange?: (waveform: SoundWaveform) => void;
  frequency?: number;
  onFrequencyChange?: (frequency: number) => void;

  // Synthesizer-Konfiguration (8-Bit)
  hasSynthesizerConfig?: boolean;
  synthesizerMode?: SynthesizerMode;
  onSynthesizerModeChange?: (mode: SynthesizerMode) => void;

  // Grafisches Display (GraphicsArray) Konfiguration
  hasGraphicsArrayConfig?: boolean;
  bitsPerPixel?: number;
  onBitsPerPixelChange?: (bitsPerPixel: number) => void;

  onSelect?: () => void;
  isActive?: boolean;
  isCycle?: boolean;
  isReadOnly?: boolean;
  readOnlyTooltip?: string;
  presenceParticipants?: ReadonlyArray<{ peerId: string; displayName: string; color: string }>;
  onActivate?: () => void;
  onDelete?: () => void;
  deleteDisabledReason?: string;
};

const PaletteItem = styled(({
  type,
  label,
  subCircuitId,
  subCircuit,
  inputCount = 2,
  hasVariableInputs = false,
  onInputCountChange,
  bitWidth = 1,
  hasBitWidth = false,
  onBitWidthChange,
  pinSide,
  hasPinSide = false,
  onPinSideChange,
  isHex = false,
  hasHexFormat = false,
  onHexFormatChange,
  color = "red",
  hasColor = false,
  onColorChange,
  matrixType = "individual",
  rows = 4,
  columns = 4,
  hasMatrixConfig = false,
  onMatrixTypeChange,
  onRowsChange,
  onColumnsChange,
  hasSplitterConfig = false,
  pinCount = 3,
  onPinCountChange,
  pinBitWidth = 1,
  onPinBitWidthChange,
  clockwise = true,
  onClockwiseChange,
  hasNotation = false,
  notation = "",
  onNotationChange,
  hasButtonConfig = false,
  isToggle = false,
  onToggleChange,
  hasSensorConfig = false,
  sensorType = "random",
  onSensorTypeChange,
  hasMemoryConfig = false,
  addressBitWidth = 8,
  dataBitWidth = 8,
  onAddressBitWidthChange,
  onDataBitWidthChange,
  hasSoundConfig = false,
  waveform = "sine",
  onWaveformChange,
  frequency = SOUND_DEFAULT_FREQUENCY,
  onFrequencyChange,
  hasSynthesizerConfig = false,
  synthesizerMode = "square",
  onSynthesizerModeChange,
  hasGraphicsArrayConfig = false,
  bitsPerPixel = 1,
  onBitsPerPixelChange,
  onSelect,
  isActive = false,
  isCycle = false,
  isReadOnly = false,
  readOnlyTooltip,
  presenceParticipants,
  onActivate,
  onDelete,
  deleteDisabledReason,
  className,
  ...other
}: PaletteItemProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const { isSimulating } = React.useContext(SimulationContext);
  const isSubCircuit = type === "subCircuit";
  const isTextNote = type === "textNote";
  const isDragBlocked = (isSubCircuit && (isActive || isCycle)) || isSimulating || isReadOnly;

  const sensorTypeOptions: { value: SensorType; label: string }[] = [
    { value: "random", label: t("palette.sensorModes.random") },
    { value: "manual", label: t("palette.sensorModes.manual") },
    { value: "series", label: t("palette.sensorModes.series") },
    { value: "loop", label: t("palette.sensorModes.loop") },
    { value: "ascii", label: t("palette.sensorModes.ascii") },
    { value: "keyCode", label: t("palette.sensorModes.keyCode") },
    { value: "sequence", label: t("palette.sensorModes.sequence") },
    { value: "clock", label: t("palette.sensorModes.clock") },
  ];

  const hasAnyControl =
    (hasVariableInputs && !!onInputCountChange) ||
    (hasBitWidth && !!onBitWidthChange) ||
    (hasPinSide && !!onPinSideChange) ||
    (hasHexFormat && !!onHexFormatChange) ||
    (hasColor && !!onColorChange) ||
    (hasMatrixConfig && (!!onMatrixTypeChange || !!onRowsChange || !!onColumnsChange)) ||
    (hasSplitterConfig && (!!onPinCountChange || !!onPinBitWidthChange || !!onClockwiseChange)) ||
    (hasButtonConfig && !!onToggleChange) ||
    (hasSensorConfig && !!onSensorTypeChange) ||
    (hasMemoryConfig && (!!onAddressBitWidthChange || !!onDataBitWidthChange)) ||
    (hasSoundConfig && (!!onWaveformChange || !!onFrequencyChange)) ||
    (hasSynthesizerConfig && !!onSynthesizerModeChange) ||
    (hasGraphicsArrayConfig && (!!onDataBitWidthChange || !!onBitsPerPixelChange)) ||
    (hasNotation && !!onNotationChange);

  const layout = React.useMemo(
    () => {
      if (isSubCircuit || isTextNote) {
        return { gridWidth: 2, gridHeight: 2, pins: [] };
      }
      return getComponentLayout(type, {
        inputCount,
        rows,
        columns,
        matrixType,
        bitWidth: hasSplitterConfig ? pinCount * pinBitWidth : bitWidth,
        pinSide,
        color,
        pinCount,
        pinBitWidth,
        clockwise,
        sensorType: hasSensorConfig ? sensorType : undefined,
        addressBitWidth: hasMemoryConfig ? addressBitWidth : undefined,
        dataBitWidth: hasMemoryConfig || hasGraphicsArrayConfig ? dataBitWidth : undefined,
        bitsPerPixel: hasGraphicsArrayConfig ? bitsPerPixel : undefined,
        width: hasGraphicsArrayConfig ? GRAPHICS_ARRAY_PREVIEW_WIDTH : undefined,
        height: hasGraphicsArrayConfig ? GRAPHICS_ARRAY_PREVIEW_HEIGHT : undefined,
        zoom: hasGraphicsArrayConfig ? 1 : undefined,
        frequency: hasSoundConfig ? frequency : undefined,
        waveform: hasSoundConfig ? waveform : undefined,
        synthesizerMode: hasSynthesizerConfig ? synthesizerMode : undefined,
      });
    },
    [
      addressBitWidth,
      bitWidth,
      bitsPerPixel,
      clockwise,
      color,
      columns,
      dataBitWidth,
      frequency,
      hasGraphicsArrayConfig,
      hasMemoryConfig,
      hasSensorConfig,
      hasSoundConfig,
      hasSplitterConfig,
      hasSynthesizerConfig,
      inputCount,
      isSubCircuit,
      isTextNote,
      matrixType,
      pinBitWidth,
      pinCount,
      pinSide,
      rows,
      sensorType,
      synthesizerMode,
      type,
      waveform,
    ],
  );

  const pixelWidth = layout.gridWidth * GRID_SIZE;
  const pixelHeight = layout.gridHeight * GRID_SIZE;
  const defaultButtonName = isToggle
    ? t("palette.defaults.toggleSwitch")
    : t("palette.defaults.pushButton");

  const handleDragStart = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (isDragBlocked) {
        event.preventDefault();
        return;
      }
      const defaultPinName = type === "pinOut" ? "Q" : "X";
      const isPin = type === "pinIn" || type === "pinOut" || type === "pin";
      const selection: PaletteSelection = {
        type,
        inputCount: isSubCircuit || isTextNote ? undefined : inputCount,
        subCircuitId,
        name: type === "button"
          ? (notation || defaultButtonName)
          : isPin
            ? (notation || defaultPinName)
            : label,
        notation: (type === "button" || isPin) ? notation : undefined,
        isToggle: type === "button" ? (isToggle ?? false) : undefined,
        bitWidth: hasSplitterConfig ? pinCount * pinBitWidth : (hasBitWidth ? bitWidth : undefined),
        pinSide: hasPinSide ? pinSide : undefined,
        isHex: hasHexFormat ? isHex : undefined,
        color: hasColor ? color : undefined,
        matrixType: hasMatrixConfig ? matrixType : undefined,
        rows: hasMatrixConfig ? rows : undefined,
        columns: hasMatrixConfig ? columns : undefined,
        pinCount: hasSplitterConfig ? pinCount : undefined,
        pinBitWidth: hasSplitterConfig ? pinBitWidth : undefined,
        clockwise: hasSplitterConfig ? clockwise : undefined,
        sensorType: hasSensorConfig ? sensorType : undefined,
        addressBitWidth: hasMemoryConfig ? addressBitWidth : undefined,
        dataBitWidth: hasMemoryConfig || hasGraphicsArrayConfig ? dataBitWidth : undefined,
        bitsPerPixel: hasGraphicsArrayConfig ? bitsPerPixel : undefined,
        frequency: hasSoundConfig ? frequency : undefined,
        waveform: hasSoundConfig ? waveform : undefined,
        synthesizerMode: hasSynthesizerConfig ? synthesizerMode : undefined,
      };
      event.dataTransfer.setData("application/json", JSON.stringify(selection));
      event.dataTransfer.effectAllowed = "copy";
      hideBrowserDragImage(event.dataTransfer);
      circuitContext?.setActivePaletteDrag?.(selection);
    },
    [
      addressBitWidth,
      bitWidth,
      bitsPerPixel,
      circuitContext,
      clockwise,
      color,
      columns,
      dataBitWidth,
      defaultButtonName,
      frequency,
      hasBitWidth,
      hasColor,
      hasGraphicsArrayConfig,
      hasHexFormat,
      hasMatrixConfig,
      hasMemoryConfig,
      hasPinSide,
      hasSensorConfig,
      hasSoundConfig,
      hasSplitterConfig,
      hasSynthesizerConfig,
      inputCount,
      isDragBlocked,
      isHex,
      isSubCircuit,
      isTextNote,
      isToggle,
      label,
      matrixType,
      notation,
      pinBitWidth,
      pinCount,
      pinSide,
      rows,
      sensorType,
      subCircuitId,
      synthesizerMode,
      type,
      waveform,
    ],
  );

  const handleDragEnd = React.useCallback(
    () => {
      circuitContext?.setActivePaletteDrag?.(null);
    },
    [circuitContext],
  );

  const handleDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isSimulating) {
        return;
      }
      other.onDoubleClick?.(event);
      if (isSubCircuit && onActivate) {
        onActivate();
      }
    },
    [
      isSimulating,
      isSubCircuit,
      onActivate,
      other,
    ],
  );

  const itemClassName = [
    className,
    "palette-item",
    isActive ? "active" : "",
    isCycle ? "cycle-blocked" : "",
    isReadOnly ? "readonly-blocked" : "",
    hasAnyControl ? "has-controls" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      {...other}
      data-component="PaletteItem"
      className={itemClassName}
      role="button"
      tabIndex={0}
      draggable={!isDragBlocked}
      title={
        other.title ??
        (isActive
          ? t("palette.item.titleActive", { label })
          : isCycle
            ? t("palette.item.titleCycleBlocked", { label })
            : isSubCircuit
              ? t("palette.item.titleSubCircuit", { label })
              : isReadOnly && readOnlyTooltip
                ? readOnlyTooltip
                : label)
      }
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        if (!isSimulating) {
          onSelect?.();
          other.onClick?.(e);
        }
      }}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        other.onKeyDown?.(e);
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
          if (e.key === "Enter" && isSubCircuit && onActivate) {
            onActivate();
          }
        }
      }}
    >
      {/* Spalte 1: Bauteil-Vorschau ohne störenden Rahmen */}
      <div className="item-preview">
        {isSubCircuit ? (
          subCircuit ? (
            <SubCircuitPreview
              circuit={subCircuit}
              width={54}
              height={36}
              className="preview-svg"
            />
          ) : (
            <SubCircuitGlyph name={label} />
          )
        ) : isTextNote ? (
          <svg
            width={54}
            height={36}
            viewBox="0 0 54 36"
            className="preview-svg"
          >
            <rect
              x={6}
              y={5}
              width={42}
              height={26}
              rx={3}
              fill="none"
              stroke="var(--color-border-subtle)"
              strokeDasharray="3 2"
            />
            <text
              x={27}
              y={23}
              textAnchor="middle"
              fontSize={17}
              fontWeight="bold"
              fontFamily="sans-serif"
              fill="var(--color-text-primary)"
            >
              T
            </text>
          </svg>
        ) : (
          <svg
            width={54}
            height={36}
            viewBox={`-4 -4 ${pixelWidth + 8} ${pixelHeight + 8}`}
            preserveAspectRatio="xMidYMid meet"
            className="preview-svg"
          >
            <SymbolRenderer
              type={type}
              inputCount={inputCount}
              showPins={true}
              name={
                type === "button"
                  ? (notation || defaultButtonName)
                  : type === "pinIn" || type === "pin"
                    ? (notation || "X")
                    : type === "pinOut"
                      ? (notation || "Q")
                      : label
              }
              notation={notation}
              isToggle={type === "button" ? isToggle : undefined}
              pinSide={hasPinSide ? pinSide : undefined}
              pins={"pins" in layout ? layout.pins : undefined}
              color={color}
              rows={rows}
              columns={columns}
              matrixType={matrixType}
              clockwise={clockwise}
              pinCount={pinCount}
              bitWidth={hasSplitterConfig ? pinCount * pinBitWidth : bitWidth}
              sensorType={hasSensorConfig ? sensorType : undefined}
              addressBitWidth={hasMemoryConfig ? addressBitWidth : undefined}
              dataBitWidth={hasMemoryConfig || hasGraphicsArrayConfig ? dataBitWidth : undefined}
              bitsPerPixel={hasGraphicsArrayConfig ? bitsPerPixel : undefined}
              graphicsWidth={hasGraphicsArrayConfig ? GRAPHICS_ARRAY_PREVIEW_WIDTH : undefined}
              graphicsHeight={hasGraphicsArrayConfig ? GRAPHICS_ARRAY_PREVIEW_HEIGHT : undefined}
              graphicsZoom={hasGraphicsArrayConfig ? 1 : undefined}
              isPalettePreview={hasGraphicsArrayConfig}
              frequency={hasSoundConfig ? frequency : undefined}
              waveform={hasSoundConfig ? waveform : undefined}
              synthesizerMode={hasSynthesizerConfig ? synthesizerMode : undefined}
            />
          </svg>
        )}
      </div>

      {/* Spalte 2: Bezeichnung und optionale Einstellungs-Dropdowns */}
      <div className="item-body">
        <div className="item-header">
          <span className="item-label">{label}</span>
          {isSubCircuit && presenceParticipants && presenceParticipants.length > 0 && (
            <span
              className="presence-dots"
              data-testid={`palette-circuit-presence-${subCircuitId ?? ""}`}
              title={t("palette.item.presenceTooltip", {
                names: presenceParticipants.map((participant) => participant.displayName).join(", "),
              })}
            >
              {presenceParticipants.slice(0, 5).map((participant) => (
                <span
                  key={participant.peerId}
                  className="presence-dot"
                  data-testid={`palette-circuit-presence-dot-${subCircuitId ?? ""}-${participant.peerId}`}
                  data-color={participant.color}
                  style={{ backgroundColor: participant.color }}
                />
              ))}
              {presenceParticipants.length > 5 && (
                <span className="presence-more">+{presenceParticipants.length - 5}</span>
              )}
            </span>
          )}
          {isActive && <span className="active-badge">{t("palette.item.activeBadge")}</span>}
          {isSubCircuit && onDelete && (
            <button
              type="button"
              className="delete-circuit-button"
              disabled={Boolean(deleteDisabledReason)}
              title={deleteDisabledReason ?? t("palette.item.deleteCircuitTitle", { label })}
              aria-label={t("palette.item.deleteCircuitTitle", { label })}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (!deleteDisabledReason) {
                  onDelete();
                }
              }}
            >
              ×
            </button>
          )}
        </div>

        {hasAnyControl && (
          <div className="item-controls" onClick={(e) => e.stopPropagation()}>
            {hasNotation && onNotationChange && (
              <div className="control-row">
                <span className="control-label">{t("palette.item.notationLabel")}</span>
                <input
                  type="text"
                  className="palette-input"
                  value={notation ?? ""}
                  placeholder=""
                  maxLength={10}
                  onChange={(e) => onNotationChange(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  draggable={false}
                  onDragStart={(e) => e.stopPropagation()}
                  aria-label={t("palette.item.notationAriaLabel", { label })}
                />
              </div>
            )}

            {hasButtonConfig && onToggleChange && (
              <div className="control-row">
                <span className="control-label">{t("palette.item.buttonModeLabel")}</span>
                <select
                  className="palette-select"
                  value={isToggle ? "toggle" : "momentary"}
                  onChange={(e) => onToggleChange(e.target.value === "toggle")}
                  aria-label={t("palette.item.buttonModeAriaLabel", { label })}
                >
                  <option value="momentary">{t("palette.item.buttonMomentary")}</option>
                  <option value="toggle">{t("palette.item.buttonToggle")}</option>
                </select>
              </div>
            )}

            {hasSensorConfig && onSensorTypeChange && (
              <div className="control-row">
                <span className="control-label">{t("palette.item.sensorModeLabel")}</span>
                <select
                  className="palette-select"
                  value={sensorType}
                  onChange={(e) => onSensorTypeChange(e.target.value as SensorType)}
                  aria-label={t("palette.item.sensorTypeAriaLabel", { label })}
                >
                  {sensorTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {hasMemoryConfig && (
              <div className="control-row-inline">
                {onAddressBitWidthChange && (
                  <div className="control-inline-item">
                    <span className="control-label">{t("palette.item.memoryAddressBitsLabel")}</span>
                    <select
                      className="palette-select short"
                      value={addressBitWidth}
                      onChange={(e) => onAddressBitWidthChange(Number(e.target.value))}
                      aria-label={t("palette.item.memoryAddressBitsAriaLabel", { label })}
                    >
                      {MEMORY_ADDRESS_BIT_WIDTH_OPTIONS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {onDataBitWidthChange && (
                  <div className="control-inline-item">
                    <span className="control-label">{t("palette.item.memoryDataBitsLabel")}</span>
                    <select
                      className="palette-select short"
                      value={dataBitWidth}
                      onChange={(e) => onDataBitWidthChange(Number(e.target.value))}
                      aria-label={t("palette.item.memoryDataBitsAriaLabel", { label })}
                    >
                      {BIT_WIDTH_OPTIONS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {hasVariableInputs && onInputCountChange && (
              <div className="control-row">
                <span className="control-label">{t("palette.item.inputsLabel")}</span>
                <select
                  className="palette-select input-count-select"
                  value={inputCount}
                  onChange={(e) => onInputCountChange(Number(e.target.value))}
                  aria-label={t("palette.item.inputsAriaLabel", { label })}
                >
                  {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {hasBitWidth && onBitWidthChange && (
              <div className="control-row">
                <span className="control-label">{t("palette.item.bitWidthLabel")}</span>
                <select
                  className="palette-select"
                  value={bitWidth}
                  onChange={(e) => onBitWidthChange(Number(e.target.value))}
                  aria-label={t("palette.item.bitWidthAriaLabel", { label })}
                >
                  {BIT_WIDTH_OPTIONS.map((w) => (
                    <option key={w} value={w}>
                      {t("common.bitCount", { count: w })}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {hasPinSide && onPinSideChange && (
              <div className="control-row">
                <span className="control-label">
                  {hasButtonConfig ? t("palette.item.pinSideButtonLabel") : t("palette.item.pinSideDefaultLabel")}
                </span>
                <select
                  className="palette-select"
                  value={pinSide}
                  onChange={(e) => onPinSideChange(e.target.value as PinSide)}
                  aria-label={t("palette.item.pinSideAriaLabel", { label })}
                >
                  <option value="left">{t("common.pinSides.left")}</option>
                  <option value="right">{t("common.pinSides.right")}</option>
                  <option value="top">{t("common.pinSides.top")}</option>
                  <option value="bottom">{t("common.pinSides.bottom")}</option>
                </select>
              </div>
            )}

            {hasHexFormat && onHexFormatChange && (
              <div className="control-row">
                <span className="control-label">{t("palette.item.formatLabel")}</span>
                <select
                  className="palette-select"
                  value={isHex ? "hex" : "dec"}
                  onChange={(e) => onHexFormatChange(e.target.value === "hex")}
                  aria-label={t("palette.item.formatAriaLabel", { label })}
                >
                  <option value="dec">{t("common.numberFormats.dec")}</option>
                  <option value="hex">{t("common.numberFormats.hex")}</option>
                </select>
              </div>
            )}

            {hasColor && onColorChange && (
              <div className="control-row">
                <span className="control-label">{t("palette.item.colorLabel")}</span>
                <select
                  className="palette-select"
                  value={color}
                  onChange={(e) => onColorChange(e.target.value as DisplayColor)}
                  aria-label={t("palette.item.colorAriaLabel", { label })}
                >
                  <option value="red">{t("common.colors.red")}</option>
                  <option value="yellow">{t("common.colors.yellow")}</option>
                  <option value="green">{t("common.colors.green")}</option>
                  <option value="blue">{t("common.colors.blue")}</option>
                </select>
              </div>
            )}

            {hasMatrixConfig && (
              <>
                {onMatrixTypeChange && (
                  <div className="control-row">
                    <span className="control-label">{t("palette.item.matrixTypeLabel")}</span>
                    <select
                      className="palette-select"
                      value={matrixType}
                      onChange={(e) => onMatrixTypeChange(e.target.value as LedMatrixType)}
                      aria-label={t("palette.item.matrixTypeAriaLabel", { label })}
                    >
                      <option value="individual">{t("palette.item.matrixTypeIndividual")}</option>
                      <option value="selector">{t("palette.item.matrixTypeSelector")}</option>
                    </select>
                  </div>
                )}
                <div className="control-row-inline">
                  {onRowsChange && (
                    <div className="control-inline-item">
                      <span className="control-label">{t("palette.item.matrixRowsLabel")}</span>
                      <select
                        className="palette-select short"
                        value={rows}
                        onChange={(e) => onRowsChange(Number(e.target.value))}
                        aria-label={t("palette.item.matrixRowsAriaLabel", { label })}
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {onColumnsChange && (
                    <div className="control-inline-item">
                      <span className="control-label">{t("palette.item.matrixColumnsLabel")}</span>
                      <select
                        className="palette-select short"
                        value={columns}
                        onChange={(e) => onColumnsChange(Number(e.target.value))}
                        aria-label={t("palette.item.matrixColumnsAriaLabel", { label })}
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </>
            )}

            {hasSplitterConfig && (
              <>
                {onPinCountChange && (
                  <div className="control-row">
                    <span className="control-label">{t("palette.item.splitterPinsLabel")}</span>
                    <select
                      className="palette-select"
                      value={pinCount}
                      onChange={(e) => onPinCountChange(Number(e.target.value))}
                      aria-label={t("palette.item.splitterPinsAriaLabel", { label })}
                    >
                      {SPLITTER_PIN_COUNT_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {onPinBitWidthChange && (
                  <div className="control-row">
                    <span className="control-label">{t("palette.item.splitterWidthLabel")}</span>
                    <select
                      className="palette-select"
                      value={pinBitWidth}
                      onChange={(e) => onPinBitWidthChange(Number(e.target.value))}
                      aria-label={t("palette.item.splitterWidthAriaLabel", { label })}
                    >
                      {BIT_WIDTH_OPTIONS.map((w) => (
                        <option key={w} value={w}>
                          {t("common.bitCount", { count: w })}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {onClockwiseChange && (
                  <div className="control-row">
                    <span className="control-label">{t("palette.item.splitterModeLabel")}</span>
                    <select
                      className="palette-select"
                      value={clockwise ? "cw" : "ccw"}
                      onChange={(e) => onClockwiseChange(e.target.value === "cw")}
                      aria-label={t("palette.item.splitterModeAriaLabel", { label })}
                    >
                      <option value="cw">{t("palette.item.splitterBranch")}</option>
                      <option value="ccw">{t("palette.item.splitterBundle")}</option>
                    </select>
                  </div>
                )}
              </>
            )}

            {hasSoundConfig && (
              <>
                {onWaveformChange && (
                  <div className="control-row">
                    <span className="control-label">{t("palette.item.soundWaveformLabel")}</span>
                    <select
                      className="palette-select"
                      value={waveform}
                      onChange={(e) => onWaveformChange(e.target.value as SoundWaveform)}
                      aria-label={t("palette.item.soundWaveformAriaLabel", { label })}
                    >
                      {SOUND_WAVEFORMS.map((wf) => (
                        <option key={wf} value={wf}>
                          {t(`common.soundWaveforms.${wf}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {onFrequencyChange && (
                  <div className="control-row">
                    <span className="control-label">{t("palette.item.soundFrequencyLabel")}</span>
                    <input
                      type="number"
                      className="palette-input"
                      min={SOUND_MIN_FREQUENCY}
                      max={SOUND_MAX_FREQUENCY}
                      step={1}
                      value={frequency}
                      onChange={(e) => onFrequencyChange(clampSoundFrequency(Number(e.target.value)))}
                      onKeyDown={(e) => e.stopPropagation()}
                      draggable={false}
                      onDragStart={(e) => e.stopPropagation()}
                      aria-label={t("palette.item.soundFrequencyAriaLabel", { label })}
                    />
                  </div>
                )}
              </>
            )}

            {hasSynthesizerConfig && onSynthesizerModeChange && (
              <div className="control-row">
                <span className="control-label">{t("palette.item.synthesizerModeLabel")}</span>
                <select
                  className="palette-select"
                  value={synthesizerMode}
                  onChange={(e) => onSynthesizerModeChange(e.target.value as SynthesizerMode)}
                  aria-label={t("palette.item.synthesizerModeAriaLabel", { label })}
                >
                  {SYNTHESIZER_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`common.synthesizerModes.${m}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {hasGraphicsArrayConfig && (
              <div className="control-row-inline">
                {onDataBitWidthChange && (
                  <div className="control-inline-item">
                    <span className="control-label">{t("palette.item.graphicsDataBitsLabel")}</span>
                    <select
                      className="palette-select short"
                      value={dataBitWidth}
                      onChange={(e) => onDataBitWidthChange(Number(e.target.value))}
                      aria-label={t("palette.item.graphicsDataBitsAriaLabel", { label })}
                    >
                      {GRAPHICS_ARRAY_DATA_BIT_WIDTHS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {onBitsPerPixelChange && (
                  <div className="control-inline-item">
                    <span className="control-label">{t("palette.item.graphicsBitsPerPixelLabel")}</span>
                    <select
                      className="palette-select short"
                      value={bitsPerPixel}
                      onChange={(e) => onBitsPerPixelChange(Number(e.target.value))}
                      aria-label={t("palette.item.graphicsBitsPerPixelAriaLabel", { label })}
                    >
                      {GRAPHICS_ARRAY_BITS_PER_PIXEL.map((bpp) => (
                        <option key={bpp} value={bpp}>
                          {bpp}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
})({
  display: "flex",
  alignItems: "flex-start",
  minHeight: "2.75rem",
  padding: "0.35rem 0.4rem",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: "0.3rem",
  cursor: "grab",
  transition: "background-color 0.12s ease, border-color 0.12s ease",
  userSelect: "none",
  boxSizing: "border-box",

  "&.active": {
    borderColor: "var(--color-accent-primary)",
    backgroundColor: "var(--color-accent-tint)",
    cursor: "default",
  },

  "&.cycle-blocked": {
    opacity: 0.6,
  },

  "&.cycle-blocked:hover": {
    cursor: "not-allowed",
  },

  "&.readonly-blocked": {
    opacity: 0.72,
    cursor: "default",
  },

  "&.readonly-blocked:active:not(.active)": {
    cursor: "default",
  },

  "&:active:not(.active)": {
    cursor: "grabbing",
  },

  "&:hover": {
    backgroundColor: "var(--color-accent-tint)",
    borderColor: "var(--color-accent-primary)",
  },

  "&.active:hover": {
    backgroundColor: "var(--color-accent-tint-strong)",
    borderColor: "var(--color-accent-primary)",
  },

  "&:focus-visible": {
    outline: "0.125rem solid var(--color-accent-primary)",
    outlineOffset: "1px",
  },

  "& > .item-preview": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "3.5rem",
    minWidth: "3.5rem",
    height: "2.375rem",
    flexShrink: 0,
    marginTop: "0.125rem",

    "& > .preview-svg": {
      display: "block",
    },
  },

  "& > .item-body": {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    paddingLeft: "0.45rem",

    "& > .item-header": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: "1.375rem",

      "& > .item-label": {
        flex: 1,
        fontSize: "0.85rem",
        fontWeight: 600,
        color: "var(--color-text-primary)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },

      "& > .presence-dots": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.2rem",
        marginLeft: "0.35rem",
        flexShrink: 0,

        "& > .presence-dot": {
          width: "0.5rem",
          height: "0.5rem",
          borderRadius: "50%",
          border: "1px solid rgba(255, 255, 255, 0.55)",
        },

        "& > .presence-more": {
          fontSize: "0.68rem",
          fontWeight: 700,
          color: "var(--color-text-secondary)",
        },
      },

      "& > .active-badge": {
        fontSize: "0.68rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "0.15rem 0.4rem",
        borderRadius: "0.25rem",
        backgroundColor: "var(--color-accent-primary)",
        color: "var(--color-text-on-strong)",
        marginLeft: "0.4rem",
        flexShrink: 0,
      },

      "& > .delete-circuit-button": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1.25rem",
        height: "1.25rem",
        marginLeft: "0.3rem",
        padding: 0,
        backgroundColor: "transparent",
        border: "1px solid transparent",
        borderRadius: "0.25rem",
        color: "var(--color-text-muted)",
        fontSize: "0.9rem",
        lineHeight: 1,
        cursor: "pointer",
        flexShrink: 0,
        transition: "all 0.12s ease",

        "&:hover:not(:disabled)": {
          color: "var(--color-status-stopped)",
          backgroundColor: "var(--color-error-bg)",
          borderColor: "var(--color-status-stopped)",
        },

        "&:disabled": {
          opacity: 0.35,
          cursor: "not-allowed",
        },
      },
    },

    "& > .item-controls": {
      display: "flex",
      flexDirection: "column",
      gap: "0.25rem",
      width: "100%",

      "& .control-row": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.4rem",
      },

      "& .control-row-inline": {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        width: "100%",
      },

      "& .control-inline-item": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.25rem",
        flex: 1,
      },

      "& .control-label": {
        fontSize: "0.72rem",
        color: "var(--color-text-secondary)",
        fontWeight: 500,
        whiteSpace: "nowrap",
      },

      "& .palette-select": {
        height: "1.375rem",
        padding: "0 0.3rem",
        fontSize: "0.75rem",
        fontFamily: "var(--font-family-mono)",
        fontWeight: 600,
        color: "var(--color-text-primary)",
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.25rem",
        cursor: "pointer",
        outline: "none",
        minWidth: "3.875rem",

        "&.short": {
          minWidth: "2.5rem",
          width: "2.5rem",
        },

        "&:hover": {
          borderColor: "var(--color-accent-primary)",
        },

        "&:focus": {
          borderColor: "var(--color-accent-primary)",
        },
      },

      "& .palette-input": {
        height: "1.375rem",
        padding: "0 0.35rem",
        fontSize: "0.75rem",
        fontFamily: "var(--font-family-base)",
        fontWeight: 500,
        color: "var(--color-text-primary)",
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.25rem",
        outline: "none",
        minWidth: "3.875rem",
        width: "4.5rem",
        boxSizing: "border-box",

        "&:hover": {
          borderColor: "var(--color-accent-primary)",
        },

        "&:focus": {
          borderColor: "var(--color-accent-primary)",
          boxShadow: "0 0 0 1px var(--color-accent-primary)",
        },
      },
    },
  },
});

export default PaletteItem;
