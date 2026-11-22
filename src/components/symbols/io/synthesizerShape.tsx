import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";
import type BasePin from "../../../types/circuit/basePin";
import type SynthesizerMode from "../../../types/circuit/synthesizerMode";

import { GRID_SIZE } from "../../../utils/coordinateSystem";

export type SynthesizerShapeProps = IOProps & {
  mode?: SynthesizerMode;
  activeFrequencyHz?: number | null;
  notation?: string;
  isActive?: boolean;
  pins?: BasePin[];
};

const MODE_BADGE_MAP: Record<SynthesizerMode, string> = {
  sine: "SIN",
  triangle: "TRI",
  square: "SQR",
  sawtooth: "SAW",
  noise: "NOI",
};

const getWaveformPath = (mode: SynthesizerMode, cx: number, cy: number): string => {
  switch (mode) {
    case "sine":
      return (
        `M ${cx - 10} ${cy} ` +
        `Q ${cx - 5} ${cy - 9} ${cx} ${cy} ` +
        `Q ${cx + 5} ${cy + 9} ${cx + 10} ${cy}`
      );
    case "triangle":
      return `M ${cx - 10} ${cy} L ${cx - 5} ${cy - 6} L ${cx + 5} ${cy + 6} L ${cx + 10} ${cy}`;
    case "square":
      return (
        `M ${cx - 10} ${cy + 5} L ${cx - 10} ${cy - 5} L ${cx} ${cy - 5} ` +
        `L ${cx} ${cy + 5} L ${cx + 10} ${cy + 5} L ${cx + 10} ${cy - 5}`
      );
    case "sawtooth":
      return `M ${cx - 10} ${cy + 5} L ${cx} ${cy - 5} L ${cx} ${cy + 5} L ${cx + 10} ${cy - 5}`;
    case "noise":
      return (
        `M ${cx - 10} ${cy + 2} L ${cx - 7} ${cy - 5} L ${cx - 4} ${cy + 4} ` +
        `L ${cx - 1} ${cy - 6} L ${cx + 2} ${cy + 5} L ${cx + 6} ${cy - 4} L ${cx + 10} ${cy + 1}`
      );
  }
};

/** Polyphones 8-Bit-Synthesizer-Symbol (3x4 Raster) mit F/V/E-Pin-Labels und Wellenform-Anzeige. */
const SynthesizerShape = styled(({
  width,
  height,
  mode = "square",
  activeFrequencyHz = null,
  notation,
  isActive = false,
  pins = [],
  ...other
}: SynthesizerShapeProps) => {
  const cx = width / 2 + 5;
  const cy = height / 2 - 6;
  const badgeText = MODE_BADGE_MAP[mode] ?? "SQR";
  const topLabel = notation?.trim() ?? "";

  return (
    <g
      {...other}
      data-component="SynthesizerShape"
      data-mode={mode}
      data-active={isActive ? "true" : "false"}
      data-active-hz={activeFrequencyHz ?? undefined}
    >
      <rect
        x={0.5}
        y={0.5}
        width={Math.max(1, width - 1)}
        height={Math.max(1, height - 1)}
        rx={3}
        className={`synth-body${isActive ? " active" : ""}`}
      />
      {pins.map((pin) => {
        const pinLabel = pin.jamNotation || pin.name.slice(0, 1);
        if (pin.pinSide === "left") {
          return (
            <text
              key={pin.pinId}
              x={4}
              y={pin.gridPoint.y * GRID_SIZE + 3}
              textAnchor="start"
              className="synth-pin-label"
            >
              {pinLabel}
            </text>
          );
        }
        if (pin.pinSide === "right") {
          return (
            <text
              key={pin.pinId}
              x={width - 4}
              y={pin.gridPoint.y * GRID_SIZE + 3}
              textAnchor="end"
              className="synth-pin-label"
            >
              {pinLabel}
            </text>
          );
        }
        if (pin.pinSide === "bottom") {
          return (
            <text
              key={pin.pinId}
              x={pin.gridPoint.x * GRID_SIZE}
              y={height - 4}
              textAnchor="middle"
              className="synth-pin-label"
            >
              {pinLabel}
            </text>
          );
        }
        return (
          <text
            key={pin.pinId}
            x={pin.gridPoint.x * GRID_SIZE}
            y={10}
            textAnchor="middle"
            className="synth-pin-label"
          >
            {pinLabel}
          </text>
        );
      })}
      {topLabel !== "" && (
        <text
          x={cx}
          y={11}
          textAnchor="middle"
          className="synth-notation"
        >
          {topLabel}
        </text>
      )}
      {isActive && (
        <circle
          cx={width - 6}
          cy={6}
          r={2.5}
          className="synth-active-dot"
        />
      )}
      <path
        d={getWaveformPath(mode, cx, cy)}
        className={`synth-wave${isActive ? " active" : ""}`}
      />
      <text
        x={cx}
        y={height / 2 + 11}
        textAnchor="middle"
        className={`synth-badge${isActive ? " active" : ""}`}
      >
        {badgeText}
      </text>
    </g>
  );
})({
  "& > .synth-body": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-border-strong)",
    strokeWidth: 1.5,

    "&.active": {
      fill: "rgba(34, 197, 94, 0.14)",
      stroke: "var(--color-logic-high)",
    },
  },

  "& > .synth-pin-label": {
    fill: "var(--color-text-secondary)",
    fontSize: "0.5rem",
    fontWeight: 600,
    fontFamily: "var(--font-family-mono)",
    pointerEvents: "none",
  },

  "& > .synth-notation": {
    fill: "var(--color-text-primary)",
    fontSize: "0.5rem",
    fontWeight: 600,
    fontFamily: "var(--font-family-base)",
    pointerEvents: "none",
  },

  "& > .synth-active-dot": {
    fill: "var(--color-logic-high)",
  },

  "& > .synth-wave": {
    fill: "none",
    stroke: "var(--color-text-secondary)",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",

    "&.active": {
      stroke: "var(--color-logic-high)",
    },
  },

  "& > .synth-badge": {
    fill: "var(--color-text-secondary)",
    fontSize: "0.53rem",
    fontWeight: 700,
    fontFamily: "var(--font-family-mono)",
    pointerEvents: "none",

    "&.active": {
      fill: "var(--color-logic-high)",
    },
  },
});

export default SynthesizerShape;
