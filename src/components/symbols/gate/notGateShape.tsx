import React from "react";

import styled from "@emotion/styled";

import type GateShapeProps from "./gateShapeProps";

// NOT-Inverter (Dreiecksform; Invertierung wird über den Ausgangs-Pin dargestellt)
const NotGateShape = styled(({
  width,
  height,
  inputCount: _inputCount,
  isInverted: _isInverted,
  ...other
}: GateShapeProps) => {
  const centerY = height / 2;
  const startX = 3;
  const noseX = width;
  const topY = centerY - 24;
  const bottomY = centerY + 24;

  const pathD = `M ${startX} ${topY} L ${noseX} ${centerY} L ${startX} ${bottomY} Z`;

  return (
    <g {...other} data-component="NotGateShape">
      {/* Anschlussleitung vom linken Pin */}
      <line x1={0} y1={centerY} x2={startX} y2={centerY} className="gate-lead" />

      <path
        d={pathD}
        className="gate-body"
      />
    </g>
  );
})({
  "& > .gate-body": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .gate-lead": {
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
});

export default NotGateShape;
