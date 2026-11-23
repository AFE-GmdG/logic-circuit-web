import React from "react";
import ReactDOM from "react-dom";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import SimulationContext from "../../contexts/simulationContext";

import type ProbeFormat from "../../types/circuit/probeFormat";
import type {
  OscilloscopeBusSample,
  OscilloscopeChannelSnapshot,
  OscilloscopeSnapshot,
} from "../../types/simulation/oscilloscope";
import type State from "../../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import {
  clampFloatingDialogPosition,
  type FloatingDialogPosition,
} from "./probeHistoryDialog";

export type OscilloscopeDisplayMode = "bus" | "bits";

export type OscilloscopeBusSegment = {
  startIndex: number;
  endIndex: number;
  length: number;
  sample: OscilloscopeBusSample;
  label: string;
};

export type OscilloscopeDialogProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  initialData?: OscilloscopeSnapshot | null;
  initialMode?: OscilloscopeDisplayMode;
  initialFormat?: ProbeFormat;
  initialCursorIndex?: number | null;
  onClose: () => void;
};

const DEFAULT_FLOATING_WIDTH_PX = 760;
const DEFAULT_FLOATING_HEIGHT_PX = 460;
const DEFAULT_STEP_WIDTH_PX = 16;
const MIN_STEP_WIDTH_PX = 8;
const MAX_STEP_WIDTH_PX = 40;
const SINGLE_BIT_ROW_STEP_Y = 14;
const SINGLE_BIT_TOP_PADDING_Y = 6;
const SINGLE_BIT_SVG_HEIGHT = 40;
const BUS_SVG_HEIGHT = 36;
const LIVE_REFRESH_INTERVAL_MS = 50;

function formatBusSampleValue(sample: OscilloscopeBusSample, format: ProbeFormat): string {
  if (format === "dec") {
    return sample.textDec;
  }
  if (format === "bin") {
    return sample.textBin;
  }
  return sample.textHex;
}

// Erzeugt SVG-Polyline-Koordinaten für eine digitale Einzelbit-Rechteckkurve (1, 0, Z)
export function buildSingleBitPolylinePoints(
  states: readonly State[],
  stepWidthPx: number,
  rowStepY = SINGLE_BIT_ROW_STEP_Y,
  topPaddingY = SINGLE_BIT_TOP_PADDING_Y,
): string {
  if (states.length === 0) {
    return "";
  }
  const levelToY = (state: State): number => topPaddingY + (2 - state) * rowStepY;
  const points: string[] = [];
  let current = states[0] ?? STATE_OFF;
  points.push(`0,${levelToY(current)}`);

  for (let i = 1; i < states.length; i++) {
    const next = states[i] ?? STATE_OFF;
    const x = i * stepWidthPx;
    if (next !== current) {
      points.push(`${x},${levelToY(current)}`);
      current = next;
    }
    points.push(`${x},${levelToY(current)}`);
  }

  points.push(`${states.length * stepWidthPx},${levelToY(current)}`);
  return points.join(" ");
}

// Gruppiert aufeinanderfolgende identische Bus-Abtastwerte in zusammenhängende Bus-Blöcke
export function buildBusSegments(
  samples: readonly OscilloscopeBusSample[],
  format: ProbeFormat,
): OscilloscopeBusSegment[] {
  if (samples.length === 0) {
    return [];
  }
  const segments: OscilloscopeBusSegment[] = [];
  let startIndex = 0;
  let activeSample = samples[0]!;

  for (let i = 1; i < samples.length; i++) {
    const nextSample = samples[i]!;
    if (nextSample.textBin !== activeSample.textBin) {
      segments.push({
        startIndex,
        endIndex: i - 1,
        length: i - startIndex,
        sample: activeSample,
        label: formatBusSampleValue(activeSample, format),
      });
      startIndex = i;
      activeSample = nextSample;
    }
  }

  segments.push({
    startIndex,
    endIndex: samples.length - 1,
    length: samples.length - startIndex,
    sample: activeSample,
    label: formatBusSampleValue(activeSample, format),
  });

  return segments;
}

function getDefaultOscilloscopePosition(): FloatingDialogPosition {
  if (typeof window === "undefined") {
    return { x: 40, y: 72 };
  }
  return clampFloatingDialogPosition(
    {
      x: Math.round((window.innerWidth - DEFAULT_FLOATING_WIDTH_PX) / 2),
      y: Math.max(64, window.innerHeight - DEFAULT_FLOATING_HEIGHT_PX - 44),
    },
    {
      width: DEFAULT_FLOATING_WIDTH_PX,
      height: DEFAULT_FLOATING_HEIGHT_PX,
    },
    {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  );
}

type TrackRow =
  | {
    key: string;
    kind: "single";
    probeId: string;
    name: string;
    path: string;
    bitWidth: number;
    states: State[];
    busSamples?: OscilloscopeBusSample[];
  }
  | {
    key: string;
    kind: "bus";
    channel: OscilloscopeChannelSnapshot;
  };

function formatSingleBitDisplay(state: State | undefined): string {
  if (state === STATE_ON1) {
    return "1";
  }
  if (state === STATE_ON0) {
    return "0";
  }
  return "Z";
}

// Schwebendes, verschiebbares Mehrkanal-Oszilloskop & Timing-Diagramm (DialogOscilloscope)
const OscilloscopeDialog = styled(({
  isOpen,
  initialData = null,
  initialMode = "bus",
  initialFormat = "hex",
  initialCursorIndex = null,
  onClose,
  style: externalStyle,
  ...other
}: OscilloscopeDialogProps) => {
  const { t } = useTranslation();
  const {
    isSimulating,
    isRunning,
    snapshot,
    setOscilloscoping,
    readOscilloscope,
    clearOscilloscope,
  } = React.useContext(SimulationContext);

  const [oscData, setOscData] = React.useState<OscilloscopeSnapshot | null>(initialData);
  const [displayMode, setDisplayMode] = React.useState<OscilloscopeDisplayMode>(initialMode);
  const [busFormat, setBusFormat] = React.useState<ProbeFormat>(initialFormat);
  const [stepWidthPx, setStepWidthPx] = React.useState<number>(DEFAULT_STEP_WIDTH_PX);
  const [cursorIndex, setCursorIndex] = React.useState<number | null>(initialCursorIndex);
  const [expandedBusIds, setExpandedBusIds] = React.useState<Record<string, boolean>>({});
  const [position, setPosition] = React.useState<FloatingDialogPosition>(() => getDefaultOscilloscopePosition());
  const [isDragging, setIsDragging] = React.useState(false);

  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = React.useRef<HTMLDivElement | null>(null);
  const dragOriginRef = React.useRef<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);

  React.useEffect(
    () => {
      if (!isOpen) {
        setIsDragging(false);
        dragOriginRef.current = null;
        return;
      }
      setDisplayMode(initialMode);
      setBusFormat(initialFormat);
      setCursorIndex(initialCursorIndex);
      if (initialData !== null) {
        setOscData(initialData);
      }
    },
    [
      initialCursorIndex,
      initialData,
      initialFormat,
      initialMode,
      isOpen,
    ],
  );

  // Positioniert das schwebende Oszilloskop beim Öffnen mittig am unteren Rand
  React.useEffect(
    () => {
      if (isOpen) {
        setPosition(getDefaultOscilloscopePosition());
      }
    },
    [isOpen],
  );

  // Aktiviert beim Öffnen die Aufzeichnung und lädt den initialen Oszilloskop-Puffer
  React.useEffect(
    () => {
      if (!isOpen || !isSimulating) {
        return undefined;
      }
      let cancelled = false;
      void setOscilloscoping(true).then((data) => {
        if (!cancelled && data) {
          setOscData(data);
        }
      });
      return () => {
        cancelled = true;
      };
    },
    [
      isOpen,
      isSimulating,
      setOscilloscoping,
    ],
  );

  // Aktualisiert die Kurven bei Snapshot-Änderungen (z. B. Step oder Schalterklick ohne Taktgeber)
  React.useEffect(
    () => {
      if (!isOpen || !isSimulating) {
        return undefined;
      }
      let cancelled = false;
      void readOscilloscope().then((data) => {
        if (!cancelled && data) {
          setOscData(data);
        }
      });
      return () => {
        cancelled = true;
      };
    },
    [
      isOpen,
      isSimulating,
      readOscilloscope,
      snapshot,
    ],
  );

  // Periodischer 20-Hz-Live-Refresh während laufender Simulation und aktiver Aufzeichnung
  const isRecording = oscData?.isOscilloscoping ?? false;
  React.useEffect(
    () => {
      if (!isOpen || !isSimulating || !isRunning || !isRecording) {
        return undefined;
      }
      let cancelled = false;
      const timerId = window.setInterval(() => {
        void readOscilloscope().then((data) => {
          if (!cancelled && data) {
            setOscData(data);
          }
        });
      }, LIVE_REFRESH_INTERVAL_MS);
      return () => {
        cancelled = true;
        window.clearInterval(timerId);
      };
    },
    [
      isOpen,
      isRecording,
      isRunning,
      isSimulating,
      readOscilloscope,
    ],
  );

  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
    },
    [isOpen, onClose],
  );

  React.useEffect(
    () => {
      if (!isOpen || typeof window === "undefined") {
        return;
      }
      const handleResize = () => {
        const rect = dialogRef.current?.getBoundingClientRect();
        const dialogSize = {
          width: rect && rect.width > 0 ? rect.width : DEFAULT_FLOATING_WIDTH_PX,
          height: rect && rect.height > 0 ? rect.height : DEFAULT_FLOATING_HEIGHT_PX,
        };
        setPosition((prev) =>
          clampFloatingDialogPosition(prev, dialogSize, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    },
    [isOpen],
  );

  React.useEffect(
    () => {
      if (!isDragging || typeof window === "undefined") {
        return;
      }

      const handlePointerMove = (event: PointerEvent) => {
        const origin = dragOriginRef.current;
        if (!origin) {
          return;
        }
        const rect = dialogRef.current?.getBoundingClientRect();
        const dialogSize = {
          width: rect && rect.width > 0 ? rect.width : DEFAULT_FLOATING_WIDTH_PX,
          height: rect && rect.height > 0 ? rect.height : DEFAULT_FLOATING_HEIGHT_PX,
        };
        const nextRaw = {
          x: origin.startX + (event.clientX - origin.pointerX),
          y: origin.startY + (event.clientY - origin.pointerY),
        };
        setPosition(
          clampFloatingDialogPosition(nextRaw, dialogSize, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      };

      const stopDragging = () => {
        dragOriginRef.current = null;
        setIsDragging(false);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopDragging);
        window.removeEventListener("pointercancel", stopDragging);
      };
    },
    [isDragging],
  );

  const handleHeaderPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("button")) {
        return;
      }
      event.preventDefault();
      dragOriginRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        startX: position.x,
        startY: position.y,
      };
      setIsDragging(true);
    },
    [position.x, position.y],
  );

  const handleToggleRecording = React.useCallback(
    async () => {
      const nextEnabled = !isRecording;
      const updated = await setOscilloscoping(nextEnabled);
      if (updated) {
        setOscData(updated);
      }
    },
    [isRecording, setOscilloscoping],
  );

  const handleClear = React.useCallback(
    async () => {
      const updated = await clearOscilloscope();
      if (updated) {
        setOscData(updated);
        setCursorIndex(null);
      }
    },
    [clearOscilloscope],
  );

  const toggleBusExpanded = React.useCallback(
    (probeId: string) => {
      setExpandedBusIds((prev) => ({
        ...prev,
        [probeId]: !prev[probeId],
      }));
    },
    [],
  );

  const channels = oscData?.channels ?? [];
  const sampleCount = oscData?.sampleCount ?? 0;

  const trackRows = React.useMemo<TrackRow[]>(
    () => {
      const rows: TrackRow[] = [];
      for (const ch of channels) {
        if (ch.bitWidth <= 1) {
          rows.push({
            key: ch.probeId,
            kind: "single",
            probeId: ch.probeId,
            name: ch.label,
            path: ch.path,
            bitWidth: ch.bitWidth,
            states: ch.bitTraces[0] ?? [],
            busSamples: ch.busSamples,
          });
          continue;
        }

        const isIndividuallyExpanded = displayMode === "bits" || Boolean(expandedBusIds[ch.probeId]);
        if (displayMode === "bus") {
          rows.push({
            key: ch.probeId,
            kind: "bus",
            channel: ch,
          });
        }
        if (isIndividuallyExpanded) {
          for (let bit = 0; bit < ch.bitWidth; bit++) {
            rows.push({
              key: `${ch.probeId}__bit_${bit}`,
              kind: "single",
              probeId: ch.probeId,
              name: `${ch.label}[${bit}]`,
              path: `${ch.path}[${bit}]`,
              bitWidth: 1,
              states: ch.bitTraces[bit] ?? [],
            });
          }
        }
      }
      return rows;
    },
    [
      channels,
      displayMode,
      expandedBusIds,
    ],
  );

  if (!isOpen) {
    return null;
  }

  const effectiveCursorIndex =
    cursorIndex !== null && cursorIndex >= 0 && cursorIndex < sampleCount
      ? cursorIndex
      : null;
  const activeSampleIndex =
    effectiveCursorIndex !== null
      ? effectiveCursorIndex
      : sampleCount > 0
        ? sampleCount - 1
        : null;
  const svgWidth = Math.max(360, sampleCount * stepWidthPx);
  const gridTickStride = stepWidthPx >= 20 ? 1 : stepWidthPx >= 12 ? 2 : 5;

  const handleWaveformClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (sampleCount === 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = Math.max(0, event.clientX - rect.left);
    const clickedIdx = Math.min(sampleCount - 1, Math.floor(localX / stepWidthPx));
    setCursorIndex((prev) => (prev === clickedIdx ? null : clickedIdx));
  };

  const floatingContent = (
    <div
      {...other}
      ref={dialogRef}
      data-component="OscilloscopeDialog"
      data-dragging={isDragging ? "true" : "false"}
      role="dialog"
      aria-modal="false"
      aria-labelledby="oscilloscope-dialog-title"
      style={{
        ...externalStyle,
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div
        className={`modal-header${isDragging ? " is-dragging" : ""}`}
        onPointerDown={handleHeaderPointerDown}
      >
        <h2 id="oscilloscope-dialog-title" className="modal-title">
          {t("dialog.oscilloscope.title")}
        </h2>
        <button
          type="button"
          className="close-btn"
          aria-label={t("dialog.oscilloscope.closeAriaLabel")}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="modal-toolbar">
        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn record-btn${isRecording ? " is-recording" : ""}`}
            data-testid="oscilloscope-record-toggle"
            title={t("dialog.oscilloscope.recordToggleTooltip")}
            onClick={() => {
              void handleToggleRecording();
            }}
          >
            <span className="record-dot" aria-hidden="true" />
            <span>
              {isRecording
                ? t("dialog.oscilloscope.recordToggleActive")
                : t("dialog.oscilloscope.recordTogglePaused")}
            </span>
          </button>

          <button
            type="button"
            className="toolbar-btn"
            data-testid="oscilloscope-clear-btn"
            title={t("dialog.oscilloscope.clearButtonTooltip")}
            disabled={sampleCount === 0}
            onClick={() => {
              void handleClear();
            }}
          >
            {t("dialog.oscilloscope.clearButton")}
          </button>
        </div>

        <div className="toolbar-group">
          <div
            className="segmented-control"
            role="group"
            aria-label={t("dialog.oscilloscope.modeGroupAriaLabel")}
          >
            <button
              type="button"
              className={`seg-btn${displayMode === "bus" ? " active" : ""}`}
              data-testid="oscilloscope-mode-bus"
              aria-pressed={displayMode === "bus"}
              onClick={() => setDisplayMode("bus")}
            >
              {t("dialog.oscilloscope.modeBus")}
            </button>
            <button
              type="button"
              className={`seg-btn${displayMode === "bits" ? " active" : ""}`}
              data-testid="oscilloscope-mode-bits"
              aria-pressed={displayMode === "bits"}
              onClick={() => setDisplayMode("bits")}
            >
              {t("dialog.oscilloscope.modeBits")}
            </button>
          </div>

          <div
            className="segmented-control"
            role="group"
            aria-label={t("dialog.oscilloscope.formatGroupAriaLabel")}
          >
            {(["hex", "dec", "bin"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`seg-btn${busFormat === candidate ? " active" : ""}`}
                aria-pressed={busFormat === candidate}
                onClick={() => setBusFormat(candidate)}
              >
                {candidate === "hex"
                  ? t("dialog.oscilloscope.formatHex")
                  : candidate === "dec"
                    ? t("dialog.oscilloscope.formatDec")
                    : t("dialog.oscilloscope.formatBin")}
              </button>
            ))}
          </div>

          <div className="segmented-control">
            <button
              type="button"
              className="seg-btn"
              aria-label={t("dialog.oscilloscope.zoomOutAriaLabel")}
              disabled={stepWidthPx <= MIN_STEP_WIDTH_PX}
              onClick={() => setStepWidthPx((prev) => Math.max(MIN_STEP_WIDTH_PX, prev - 4))}
            >
              −
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-label={t("dialog.oscilloscope.zoomResetAriaLabel")}
              onClick={() => setStepWidthPx(DEFAULT_STEP_WIDTH_PX)}
            >
              {Math.round((stepWidthPx / DEFAULT_STEP_WIDTH_PX) * 100)}%
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-label={t("dialog.oscilloscope.zoomInAriaLabel")}
              disabled={stepWidthPx >= MAX_STEP_WIDTH_PX}
              onClick={() => setStepWidthPx((prev) => Math.min(MAX_STEP_WIDTH_PX, prev + 4))}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="modal-body">
        {channels.length === 0 ? (
          <div className="empty-state" data-testid="oscilloscope-empty-probes">
            {t("dialog.oscilloscope.emptyNoProbes")}
          </div>
        ) : (
          <div className="oscilloscope-grid">
            <div className="sidebar-column">
              <div className="column-header">
                <span className="col-probe">{t("dialog.oscilloscope.probeColumnHeader")}</span>
                <span className="col-value">
                  {effectiveCursorIndex !== null
                    ? t("dialog.oscilloscope.cursorColumnHeader", { index: effectiveCursorIndex })
                    : t("dialog.oscilloscope.valueColumnHeader")}
                </span>
              </div>

              {trackRows.map((row) => {
                if (row.kind === "bus") {
                  const busSample =
                    activeSampleIndex !== null ? row.channel.busSamples[activeSampleIndex] : undefined;
                  const isExpanded = Boolean(expandedBusIds[row.channel.probeId]);
                  return (
                    <div
                      key={row.key}
                      className="track-label-row is-bus"
                      data-testid="oscilloscope-bus-row-label"
                    >
                      <div className="probe-name-wrap">
                        <button
                          type="button"
                          className="expand-bus-btn"
                          title={t("dialog.oscilloscope.expandBusTooltip")}
                          aria-expanded={isExpanded}
                          onClick={() => toggleBusExpanded(row.channel.probeId)}
                        >
                          {isExpanded ? "▾" : "▸"}
                        </button>
                        <span className="probe-name" title={row.channel.path}>
                          {row.channel.label}
                        </span>
                        <span className="bit-width-tag">{row.channel.bitWidth}b</span>
                      </div>
                      <span className="probe-value">
                        {busSample ? formatBusSampleValue(busSample, busFormat) : "—"}
                      </span>
                    </div>
                  );
                }

                const bitVal =
                  activeSampleIndex !== null ? row.states[activeSampleIndex] : undefined;
                return (
                  <div
                    key={row.key}
                    className="track-label-row is-single"
                    data-testid="oscilloscope-single-row-label"
                  >
                    <span className="probe-name" title={row.path}>
                      {row.name}
                    </span>
                    <span
                      className={`probe-value${bitVal === STATE_ON1 ? " is-high" : bitVal === STATE_OFF ? " is-off" : ""}`}
                    >
                      {activeSampleIndex !== null ? formatSingleBitDisplay(bitVal) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="timeline-scroll" ref={timelineScrollRef}>
              <div className="timeline-inner" style={{ width: `${svgWidth}px` }}>
                <div className="timeline-ruler">
                  {Array.from({ length: sampleCount }, (_, idx) => (
                    <span
                      key={idx}
                      className={`ruler-tick${effectiveCursorIndex === idx ? " is-cursor" : ""}`}
                      style={{ left: `${idx * stepWidthPx}px`, width: `${stepWidthPx}px` }}
                    >
                      {idx % gridTickStride === 0 ? idx : ""}
                    </span>
                  ))}
                </div>

                {sampleCount === 0 ? (
                  <div className="timeline-empty" data-testid="oscilloscope-empty-samples">
                    {t("dialog.oscilloscope.emptyNoSamples")}
                  </div>
                ) : (
                  trackRows.map((row) => {
                    if (row.kind === "bus") {
                      const segments = buildBusSegments(row.channel.busSamples, busFormat);
                      return (
                        <div
                          key={row.key}
                          className="waveform-row is-bus"
                          data-testid="oscilloscope-bus-waveform"
                        >
                          <svg
                            width={svgWidth}
                            height={BUS_SVG_HEIGHT}
                            viewBox={`0 0 ${svgWidth} ${BUS_SVG_HEIGHT}`}
                            className="waveform-svg"
                            onClick={handleWaveformClick}
                          >
                            {Array.from({ length: sampleCount + 1 }, (_, idx) => (
                              <line
                                key={`grid-${idx}`}
                                x1={idx * stepWidthPx}
                                y1={0}
                                x2={idx * stepWidthPx}
                                y2={BUS_SVG_HEIGHT}
                                className="grid-line"
                              />
                            ))}

                            {segments.map((seg) => {
                              const x0 = seg.startIndex * stepWidthPx;
                              const segWidth = seg.length * stepWidthPx;
                              const x1 = x0 + segWidth;
                              const midY = BUS_SVG_HEIGHT / 2;
                              const topY = 6;
                              const botY = BUS_SVG_HEIGHT - 6;
                              const bevel = Math.min(4, Math.floor(segWidth / 3));
                              const points = segWidth >= 8
                                ? [
                                  `${x0},${midY}`,
                                  `${x0 + bevel},${topY}`,
                                  `${x1 - bevel},${topY}`,
                                  `${x1},${midY}`,
                                  `${x1 - bevel},${botY}`,
                                  `${x0 + bevel},${botY}`,
                                ].join(" ")
                                : `${x0},${topY} ${x1},${topY} ${x1},${botY} ${x0},${botY}`;
                              return (
                                <g key={`${seg.startIndex}-${seg.endIndex}`} className="bus-segment">
                                  <title>{`#${seg.startIndex}–#${seg.endIndex}: ${seg.label}`}</title>
                                  <polygon
                                    points={points}
                                    className={`bus-polygon${seg.sample.hasTriState ? " has-tristate" : ""}`}
                                  />
                                  {segWidth >= 18 && (
                                    <text
                                      x={x0 + segWidth / 2}
                                      y={midY + 4}
                                      textAnchor="middle"
                                      className="bus-text"
                                    >
                                      {seg.label}
                                    </text>
                                  )}
                                </g>
                              );
                            })}

                            {effectiveCursorIndex !== null && (
                              <line
                                x1={effectiveCursorIndex * stepWidthPx + stepWidthPx / 2}
                                y1={0}
                                x2={effectiveCursorIndex * stepWidthPx + stepWidthPx / 2}
                                y2={BUS_SVG_HEIGHT}
                                className="cursor-line"
                              />
                            )}
                          </svg>
                        </div>
                      );
                    }

                    const polyPoints = buildSingleBitPolylinePoints(row.states, stepWidthPx);
                    return (
                      <div
                        key={row.key}
                        className="waveform-row is-single"
                        data-testid="oscilloscope-single-waveform"
                      >
                        <div className="level-scale left" aria-hidden="true">
                          <span>{t("dialog.oscilloscope.level1")}</span>
                          <span>{t("dialog.oscilloscope.level0")}</span>
                          <span>{t("dialog.oscilloscope.levelOff")}</span>
                        </div>

                        <svg
                          width={svgWidth}
                          height={SINGLE_BIT_SVG_HEIGHT}
                          viewBox={`0 0 ${svgWidth} ${SINGLE_BIT_SVG_HEIGHT}`}
                          className="waveform-svg"
                          onClick={handleWaveformClick}
                        >
                          {[0, 1, 2].map((lvl) => {
                            const y = SINGLE_BIT_TOP_PADDING_Y + lvl * SINGLE_BIT_ROW_STEP_Y;
                            return (
                              <line
                                key={`lvl-${lvl}`}
                                x1={0}
                                y1={y}
                                x2={svgWidth}
                                y2={y}
                                className="level-guide"
                              />
                            );
                          })}
                          {Array.from({ length: sampleCount + 1 }, (_, idx) => (
                            <line
                              key={`grid-${idx}`}
                              x1={idx * stepWidthPx}
                              y1={0}
                              x2={idx * stepWidthPx}
                              y2={SINGLE_BIT_SVG_HEIGHT}
                              className="grid-line"
                            />
                          ))}
                          {polyPoints && (
                            <polyline points={polyPoints} className="signal-polyline" />
                          )}
                          {effectiveCursorIndex !== null && (
                            <line
                              x1={effectiveCursorIndex * stepWidthPx + stepWidthPx / 2}
                              y1={0}
                              x2={effectiveCursorIndex * stepWidthPx + stepWidthPx / 2}
                              y2={SINGLE_BIT_SVG_HEIGHT}
                              className="cursor-line"
                            />
                          )}
                        </svg>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="modal-footer">
        <span className="status-text">
          {t("dialog.oscilloscope.statusFooter", {
            samples: sampleCount,
            capacity: oscData?.historySize ?? 100,
            totalSteps: oscData?.totalSteps ?? 0,
          })}
        </span>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return ReactDOM.createPortal(floatingContent, document.body);
  }

  return floatingContent;
})({
  position: "fixed",
  zIndex: 1100,
  width: "47.5rem",
  maxWidth: "calc(100vw - 1rem)",
  maxHeight: "calc(100vh - 1rem)",
  backgroundColor: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  boxShadow: "0 0.75rem 2.25rem rgba(0, 0, 0, 0.55)",
  color: "var(--color-text-primary)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",

  "& > .modal-header": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.7rem 1rem",
    borderBottom: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-elevated)",
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",

    "&.is-dragging": {
      cursor: "grabbing",
    },

    "& > .modal-title": {
      margin: 0,
      fontSize: "0.92rem",
      fontWeight: 600,
      color: "var(--color-text-primary)",
    },

    "& > .close-btn": {
      background: "transparent",
      border: "none",
      color: "var(--color-text-secondary)",
      fontSize: "1rem",
      cursor: "pointer",
      padding: "0.2rem 0.4rem",
      borderRadius: "0.25rem",

      "&:hover": {
        color: "var(--color-text-primary)",
        backgroundColor: "var(--color-bg-surface)",
      },
    },
  },

  "& > .modal-toolbar": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.6rem",
    flexWrap: "wrap",
    padding: "0.55rem 1rem",
    borderBottom: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-base)",

    "& > .toolbar-group": {
      display: "flex",
      alignItems: "center",
      gap: "0.45rem",
      flexWrap: "wrap",
    },

    "& .toolbar-btn": {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.4rem",
      padding: "0.28rem 0.65rem",
      borderRadius: "0.3rem",
      border: "1px solid var(--color-border-strong)",
      backgroundColor: "var(--color-bg-elevated)",
      color: "var(--color-text-primary)",
      fontSize: "0.76rem",
      fontWeight: 600,
      cursor: "pointer",

      "&:disabled": {
        opacity: 0.45,
        cursor: "not-allowed",
      },

      "&.record-btn": {
        "& > .record-dot": {
          width: "0.55rem",
          height: "0.55rem",
          borderRadius: "50%",
          backgroundColor: "var(--color-text-muted)",
        },

        "&.is-recording": {
          borderColor: "var(--color-logic-high)",
          backgroundColor: "var(--color-success-bg)",

          "& > .record-dot": {
            backgroundColor: "var(--color-logic-high)",
          },
        },
      },
    },

    "& .segmented-control": {
      display: "inline-flex",
      borderRadius: "0.3rem",
      border: "1px solid var(--color-border-strong)",
      overflow: "hidden",

      "& > .seg-btn": {
        padding: "0.26rem 0.55rem",
        border: "none",
        backgroundColor: "var(--color-bg-elevated)",
        color: "var(--color-text-secondary)",
        fontSize: "0.74rem",
        fontWeight: 600,
        cursor: "pointer",

        "&:not(:last-child)": {
          borderRight: "1px solid var(--color-border-subtle)",
        },

        "&:disabled": {
          opacity: 0.45,
          cursor: "not-allowed",
        },

        "&.active": {
          backgroundColor: "var(--color-accent-primary)",
          color: "var(--color-text-on-accent)",
        },
      },
    },
  },

  "& > .modal-body": {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    minHeight: "12rem",
    maxHeight: "26rem",
    backgroundColor: "var(--color-bg-base)",

    "& > .empty-state": {
      margin: "1rem",
      padding: "1.15rem",
      borderRadius: "0.35rem",
      border: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-bg-surface)",
      color: "var(--color-text-secondary)",
      fontSize: "0.85rem",
      textAlign: "center",
    },

    "& > .oscilloscope-grid": {
      display: "flex",
      alignItems: "stretch",
      minHeight: "100%",

      "& > .sidebar-column": {
        flex: "0 0 13.5rem",
        borderRight: "1px solid var(--color-border-strong)",
        backgroundColor: "var(--color-bg-surface)",
        display: "flex",
        flexDirection: "column",

        "& > .column-header": {
          height: "1.65rem",
          padding: "0 0.65rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-elevated)",
          fontSize: "0.7rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--color-text-muted)",
        },

        "& > .track-label-row": {
          padding: "0 0.65rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.4rem",
          borderBottom: "1px solid var(--color-border-subtle)",
          fontSize: "0.8rem",

          "&.is-single": {
            height: "40px",
          },

          "&.is-bus": {
            height: "36px",
            backgroundColor: "var(--color-surface-subtle)",
          },

          "& .probe-name-wrap": {
            display: "flex",
            alignItems: "center",
            gap: "0.3rem",
            minWidth: 0,
          },

          "& .expand-bus-btn": {
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            padding: "0 0.15rem",
            fontSize: "0.78rem",
            flexShrink: 0,
          },

          "& .probe-name": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--color-text-primary)",
            fontWeight: 500,
          },

          "& .bit-width-tag": {
            flexShrink: 0,
            padding: "0.05rem 0.3rem",
            borderRadius: "0.2rem",
            backgroundColor: "var(--color-bg-elevated)",
            color: "var(--color-text-muted)",
            fontSize: "0.68rem",
            fontFamily: "var(--font-family-mono)",
          },

          "& .probe-value": {
            flexShrink: 0,
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.78rem",
            fontWeight: 700,
            color: "var(--color-text-primary)",

            "&.is-high": {
              color: "var(--color-logic-high)",
            },

            "&.is-off": {
              color: "var(--color-text-muted)",
            },
          },
        },
      },

      "& > .timeline-scroll": {
        flex: "1 1 0",
        overflowX: "auto",
        overflowY: "hidden",

        "& > .timeline-inner": {
          minWidth: "100%",
          display: "flex",
          flexDirection: "column",

          "& > .timeline-ruler": {
            position: "relative",
            height: "1.65rem",
            borderBottom: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-elevated)",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.68rem",
            color: "var(--color-text-muted)",

            "& > .ruler-tick": {
              position: "absolute",
              top: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderLeft: "1px solid var(--color-border-subtle)",

              "&.is-cursor": {
                backgroundColor: "var(--color-accent-tint)",
                color: "var(--color-accent-primary)",
                fontWeight: 700,
              },
            },
          },

          "& > .timeline-empty": {
            padding: "1.5rem 1rem",
            fontSize: "0.82rem",
            color: "var(--color-text-secondary)",
            textAlign: "center",
          },

          "& > .waveform-row": {
            position: "relative",
            display: "flex",
            alignItems: "stretch",
            borderBottom: "1px solid var(--color-border-subtle)",

            "&.is-single": {
              height: "40px",
            },

            "&.is-bus": {
              height: "36px",
              backgroundColor: "var(--color-surface-subtle)",
            },

            "& > .level-scale": {
              position: "sticky",
              left: 0,
              zIndex: 2,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "0.1rem 0.25rem",
              fontFamily: "var(--font-family-mono)",
              fontSize: "0.62rem",
              lineHeight: 1,
              color: "var(--color-text-muted)",
              backgroundColor: "var(--color-bg-base)",
              borderRight: "1px solid var(--color-border-subtle)",
              pointerEvents: "none",
            },

            "& > .waveform-svg": {
              display: "block",
              cursor: "crosshair",
              flexShrink: 0,

              "& .grid-line": {
                stroke: "var(--color-border-subtle)",
                strokeWidth: 1,
                opacity: 0.45,
              },

              "& .level-guide": {
                stroke: "var(--color-border-subtle)",
                strokeWidth: 1,
                strokeDasharray: "2 3",
                opacity: 0.35,
              },

              "& .signal-polyline": {
                fill: "none",
                stroke: "var(--color-logic-high)",
                strokeWidth: 2,
                strokeLinejoin: "miter",
              },

              "& .bus-polygon": {
                fill: "var(--color-bg-elevated)",
                stroke: "var(--color-logic-high)",
                strokeWidth: 1.4,

                "&.has-tristate": {
                  stroke: "var(--color-text-muted)",
                  strokeDasharray: "3 2",
                },
              },

              "& .bus-text": {
                fill: "var(--color-text-primary)",
                fontFamily: "var(--font-family-mono)",
                fontSize: "10px",
                fontWeight: 600,
                pointerEvents: "none",
              },

              "& .cursor-line": {
                stroke: "var(--color-accent-primary)",
                strokeWidth: 1.5,
                strokeDasharray: "3 2",
                pointerEvents: "none",
              },
            },
          },
        },
      },
    },
  },

  "& > .modal-footer": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.65rem 1rem",
    borderTop: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-elevated)",

    "& > .status-text": {
      fontSize: "0.76rem",
      color: "var(--color-text-secondary)",
      fontFamily: "var(--font-family-mono)",
    },

    "& > .btn": {
      padding: "0.4rem 0.85rem",
      borderRadius: "0.3rem",
      fontSize: "0.84rem",
      fontWeight: 600,
      cursor: "pointer",
      border: "1px solid transparent",

      "&.btn-primary": {
        backgroundColor: "var(--color-accent-primary)",
        color: "var(--color-text-on-accent)",

        "&:hover": {
          backgroundColor: "var(--color-accent-primary-hover)",
        },
      },
    },
  },
});

export default OscilloscopeDialog;
