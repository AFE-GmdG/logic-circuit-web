import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";

type LedShapeProps = IOProps & {
  isOn?: boolean;
  symbolId?: string;
};

// Signallampe / LED (Single-Bit Indikator)
const LedShape = styled(({
  width,
  height,
  isOn = false,
  symbolId,
  ...other
}: LedShapeProps) => {
  const gradId = `led-glow-${symbolId || "def"}`;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(3, Math.min(width, height) / 2 - 3);

  return (
    <g {...other} data-component="LedShape">
      <defs>
        <radialGradient id={gradId} cx="50%" cy="50%" fx="50%" fy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFF70" />
          <stop offset="20%" stopColor="#FB0303" />
          <stop offset="90%" stopColor="#985A5A" />
          <stop offset="100%" stopColor="#787878" />
        </radialGradient>
      </defs>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        className={`led-bulb ${isOn ? "led-on" : "led-off"}`}
        fill={isOn ? `url(#${gradId})` : undefined}
      />
    </g>
  );
})({
  "& > .led-bulb": {
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .led-off": {
    fill: "#5B4949",
  },
  "& > .led-on": {
    filter: "drop-shadow(0 0 5px #ff2200)",
  },
});

export default LedShape;
