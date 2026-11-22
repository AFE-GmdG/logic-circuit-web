import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";

// Taktgenerator (Clock) mit grüner Rechteckschwingung
const ClockShape = styled(({ width, height, ...other }: IOProps) => {
  return (
    <g {...other} data-component="ClockShape">
      <rect
        x={2}
        y={2}
        width={width - 4}
        height={height - 4}
        rx={5}
        className="clock-border"
      />
      <polyline
        points="6,24 11,24 11,12 18,12 18,24 25,24 25,12 30,12"
        className="clock-wave"
      />
    </g>
  );
})({
  "& > .clock-border": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .clock-wave": {
    fill: "none",
    stroke: "#4EAC0E",
    strokeWidth: 2,
    strokeLinecap: "square",
  },
});

export default ClockShape;
