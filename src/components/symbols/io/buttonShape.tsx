import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";

type ButtonShapeProps = IOProps & {
  notation?: string;
  symbolId?: string;
  isToggle?: boolean;
  isOn?: boolean;
};

// Interaktiver Taster / Sensor
const ButtonShape = styled(({
  width,
  height,
  notation,
  symbolId,
  isToggle = false,
  isOn = false,
  ...other
}: ButtonShapeProps) => {
  const clipId = `btn-clip-${symbolId || "def"}`;
  const pillWidth = Math.min(21, Math.max(10, width - 8));
  const pillHeight = 5;
  const pillX = (width - pillWidth) / 2;
  const pillY = height - pillHeight - 5;

  return (
    <g {...other} data-component="ButtonShape">
      <defs>
        <clipPath id={clipId}>
          <rect
            x={2}
            y={2}
            width={Math.max(0, width - 4)}
            height={Math.max(0, height - 4)}
            rx={3}
          />
        </clipPath>
      </defs>
      <rect
        x={2}
        y={2}
        width={width - 4}
        height={height - 4}
        rx={3}
        className="button-base"
      />
      {/* Optionaler Schalter-LED-Balken bei Rast-Schaltern (Toggle Buttons) */}
      {isToggle && (
        <rect
          x={pillX}
          y={pillY}
          width={pillWidth}
          height={pillHeight}
          rx={2}
          className={`toggle-indicator ${isOn ? "toggle-on" : "toggle-off"}`}
        />
      )}
      {notation && (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          clipPath={`url(#${clipId})`}
          className="button-text"
        >
          {notation}
        </text>
      )}
    </g>
  );
})({
  "& > .button-base": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .toggle-indicator": {
    strokeWidth: 1,
  },
  "& > .toggle-off": {
    fill: "var(--color-button-toggle-off)",
    stroke: "var(--color-button-toggle-off-border)",
  },
  "& > .toggle-on": {
    fill: "var(--color-button-toggle-on)",
    stroke: "var(--color-button-toggle-on-border)",
    filter: "drop-shadow(0 0 3px var(--color-button-toggle-on-glow))",
  },
  "& > .button-text": {
    fill: "var(--color-text-primary)",
    fontSize: "11px",
    fontWeight: 600,
    fontFamily: "var(--font-family-base, sans-serif)",
    pointerEvents: "none",
  },
});

export default ButtonShape;
