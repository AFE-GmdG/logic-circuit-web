import React from "react";

import styled from "@emotion/styled";

import type GateShapeProps from "./gateShapeProps";

type TriStateGateShapeProps = GateShapeProps & {
  enableFromTop?: boolean;
};

// Tri-State-Buffer (Dreieck mit oberem oder unterem Freigabe-Pin)
const TriStateGateShape = styled(({
  width,
  height,
  enableFromTop = false,
  inputCount: _inputCount,
  isInverted: _isInverted,
  ...other
}: TriStateGateShapeProps) => {
  const centerY = height / 2;
  const startX = 3;
  const noseX = width;
  const topY = centerY - 24;
  const bottomY = centerY + 24;

  const pathD = `M ${startX} ${topY} L ${noseX} ${centerY} L ${startX} ${bottomY} Z`;

  const enableX = 18;
  const lineY1 = enableFromTop ? 0 : height;
  const lineY2 = enableFromTop ? centerY - 14 : centerY + 14;

  return (
    <g {...other} data-component="TriStateGateShape">
      <line x1={0} y1={centerY} x2={startX} y2={centerY} className="enable-line" />
      <line
        x1={enableX}
        y1={lineY1}
        x2={enableX}
        y2={lineY2}
        className="enable-line"
      />
      <path
        d={pathD}
        className="gate-body"
      />
    </g>
  );
})({
  "& > .enable-line": {
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .gate-body": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
});

export default TriStateGateShape;
