import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";
import type SoundWaveform from "../../../types/circuit/soundWaveform";

import { SOUND_DEFAULT_FREQUENCY } from "../../../utils/audioPitchTable";

export type SoundShapeProps = IOProps & {
  waveform?: SoundWaveform;
  frequency?: number;
  notation?: string;
  isActive?: boolean;
};

/** Standard-Summer-Symbol (3x3 Raster) mit Lautsprecher-Icon und aktivem Schallwellen-Indikator. */
const SoundShape = styled(({
  width,
  height,
  waveform = "sine",
  frequency = SOUND_DEFAULT_FREQUENCY,
  notation,
  isActive = false,
  ...other
}: SoundShapeProps) => {
  const cx = width / 2 - 1;
  const cy = height / 2 - 4;
  const subtitle = notation?.trim() ? notation.trim() : `${Math.round(frequency)}Hz`;

  return (
    <g
      {...other}
      data-component="SoundShape"
      data-waveform={waveform}
      data-active={isActive ? "true" : "false"}
    >
      <rect
        x={0.5}
        y={0.5}
        width={Math.max(1, width - 1)}
        height={Math.max(1, height - 1)}
        rx={3}
        className={`sound-body${isActive ? " active" : ""}`}
      />
      <path
        d={
          `M ${cx - 8} ${cy - 4} L ${cx - 3} ${cy - 4} ` +
          `L ${cx + 3} ${cy - 8} L ${cx + 3} ${cy + 8} ` +
          `L ${cx - 3} ${cy + 4} L ${cx - 8} ${cy + 4} Z`
        }
        className={`sound-speaker${isActive ? " active" : ""}`}
      />
      <path
        d={`M ${cx + 6} ${cy - 4} Q ${cx + 10} ${cy} ${cx + 6} ${cy + 4}`}
        className={`sound-wave-inner${isActive ? " active" : ""}`}
      />
      <path
        d={`M ${cx + 9} ${cy - 7} Q ${cx + 14} ${cy} ${cx + 9} ${cy + 7}`}
        className={`sound-wave-outer${isActive ? " active" : ""}`}
      />
      <text
        x={width / 2}
        y={height - 5}
        textAnchor="middle"
        className={`sound-subtitle${isActive ? " active" : ""}`}
      >
        {subtitle}
      </text>
    </g>
  );
})({
  "& > .sound-body": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-border-strong)",
    strokeWidth: 1.5,

    "&.active": {
      fill: "rgba(34, 197, 94, 0.14)",
      stroke: "var(--color-logic-high)",
    },
  },

  "& > .sound-speaker": {
    fill: "none",
    stroke: "var(--color-text-secondary)",
    strokeWidth: 1.5,
    strokeLinejoin: "round",

    "&.active": {
      fill: "var(--color-logic-high)",
      stroke: "var(--color-logic-high)",
    },
  },

  "& > .sound-wave-inner": {
    fill: "none",
    stroke: "var(--color-text-secondary)",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    opacity: 0.45,

    "&.active": {
      stroke: "var(--color-logic-high)",
      opacity: 1,
    },
  },

  "& > .sound-wave-outer": {
    fill: "none",
    stroke: "var(--color-text-secondary)",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    opacity: 0.3,

    "&.active": {
      stroke: "var(--color-logic-high)",
      opacity: 1,
    },
  },

  "& > .sound-subtitle": {
    fill: "var(--color-text-muted)",
    fontSize: "0.5rem",
    fontWeight: 600,
    fontFamily: "var(--font-family-mono)",
    pointerEvents: "none",

    "&.active": {
      fill: "var(--color-logic-high)",
    },
  },
});

export default SoundShape;
