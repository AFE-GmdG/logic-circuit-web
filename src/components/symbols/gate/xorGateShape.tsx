import React from "react";

import styled from "@emotion/styled";

import type GateShapeProps from "./gateShapeProps";

// XOR- und XNOR-Gattergeometrie (Doppelbogen auf der Eingangsseite; Invertierung wird über den Ausgangs-Pin dargestellt)
const XorGateShape = styled(({
  width,
  height,
  inputCount = 2,
  isInverted: _isInverted,
  ...other
}: GateShapeProps) => {
  const centerY = Math.floor(height / 36) * 18;
  const inputArcX = 1;
  const bodyBackX = 6;
  const noseX = width;
  const topY = centerY - 27;
  const bottomY = centerY + 27;

  const minInputY = 18;
  const maxInputY = inputCount === 2 ? 54 : inputCount * 18;

  const mainD = [
    `M ${noseX} ${centerY}`,
    `A 60 60 0 0 1 ${bodyBackX} ${bottomY}`,
    `A 60 60 0 0 0 ${bodyBackX} ${topY}`,
    `A 60 60 0 0 1 ${noseX} ${centerY}`,
    "Z",
  ].join(" ");

  const arcD = `M ${inputArcX} ${topY} A 60 60 0 0 1 ${inputArcX} ${bottomY}`;

  const getArcX = (y: number) => {
    const dy = Math.abs(y - centerY);
    if (dy > 27) {
      return inputArcX;
    }
    return inputArcX + (60 - Math.sqrt(Math.max(0, 3600 - dy * dy)));
  };

  return (
    <g {...other} data-component="XorGateShape">
      {minInputY < topY && (
        <line
          x1={inputArcX}
          y1={topY}
          x2={inputArcX}
          y2={minInputY}
          className="gate-lead"
        />
      )}

      <path
        d={arcD}
        className="xor-arc"
      />

      {maxInputY > bottomY && (
        <line
          x1={inputArcX}
          y1={bottomY}
          x2={inputArcX}
          y2={maxInputY}
          className="gate-lead"
        />
      )}

      <path
        d={mainD}
        className="gate-body"
      />

      {inputCount === 2 ? (
        <>
          <line x1={0} y1={18} x2={getArcX(18)} y2={18} className="gate-lead" />
          <line x1={0} y1={54} x2={getArcX(54)} y2={54} className="gate-lead" />
        </>
      ) : (
        Array.from({ length: inputCount }, (_, i) => {
          const pinY = (i + 1) * 18;
          return (
            <line
              key={i}
              x1={0}
              y1={pinY}
              x2={getArcX(pinY)}
              y2={pinY}
              className="gate-lead"
            />
          );
        })
      )}
    </g>
  );
})({
  "& > .xor-arc": {
    fill: "none",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
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

export default XorGateShape;
