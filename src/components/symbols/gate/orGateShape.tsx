import React from "react";

import styled from "@emotion/styled";

import type GateShapeProps from "./gateShapeProps";

// OR- und NOR-Gattergeometrie (geschwungene Schildform; Invertierung wird über den Ausgangs-Pin dargestellt)
const OrGateShape = styled(({
  width,
  height,
  inputCount = 2,
  isInverted: _isInverted,
  ...other
}: GateShapeProps) => {
  const centerY = Math.floor(height / 36) * 18;
  const backX = 3;
  const noseX = width;
  const topY = centerY - 27;
  const bottomY = centerY + 27;

  const minInputY = 18;
  const maxInputY = inputCount === 2 ? 54 : inputCount * 18;

  const pathD = [
    `M ${noseX} ${centerY}`,
    `A 60 60 0 0 1 ${backX} ${bottomY}`,
    `A 60 60 0 0 0 ${backX} ${topY}`,
    `A 60 60 0 0 1 ${noseX} ${centerY}`,
    "Z",
  ].join(" ");

  const getBackX = (y: number) => {
    const dy = Math.abs(y - centerY);
    if (dy > 27) {
      return backX;
    }
    return backX + (60 - Math.sqrt(Math.max(0, 3600 - dy * dy)));
  };

  return (
    <g {...other} data-component="OrGateShape">
      {minInputY < topY && (
        <line
          x1={backX}
          y1={topY}
          x2={backX}
          y2={minInputY}
          className="gate-lead"
        />
      )}

      <path
        d={pathD}
        className="gate-body"
      />

      {maxInputY > bottomY && (
        <line
          x1={backX}
          y1={bottomY}
          x2={backX}
          y2={maxInputY}
          className="gate-lead"
        />
      )}

      {inputCount === 2 ? (
        <>
          <line x1={0} y1={18} x2={getBackX(18)} y2={18} className="gate-lead" />
          <line x1={0} y1={54} x2={getBackX(54)} y2={54} className="gate-lead" />
        </>
      ) : (
        Array.from({ length: inputCount }, (_, i) => {
          const pinY = (i + 1) * 18;
          return (
            <line
              key={i}
              x1={0}
              y1={pinY}
              x2={getBackX(pinY)}
              y2={pinY}
              className="gate-lead"
            />
          );
        })
      )}
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

export default OrGateShape;
