import React from "react";

import styled from "@emotion/styled";

import type GateShapeProps from "./gateShapeProps";

// AND- und NAND-Gattergeometrie (D-Form; Invertierung wird über den Ausgangs-Pin dargestellt)
const AndGateShape = styled(({
  width,
  height,
  inputCount = 2,
  isInverted: _isInverted,
  ...other
}: GateShapeProps) => {
  // In LogicCircuit ist der Ausgang zentriert auf Math.floor(gridHeight / 2) * 18
  const centerY = Math.floor(height / 36) * 18;
  const backX = 3;
  const noseX = width;
  const radius = 27;
  const straightLength = Math.max(0, noseX - radius - backX);

  const topY = centerY - radius;
  const bottomY = centerY + radius;

  const minInputY = 18;
  const maxInputY = inputCount === 2 ? 54 : inputCount * 18;

  const pathD = [
    `M ${backX} ${topY}`,
    `L ${backX + straightLength} ${topY}`,
    `A ${radius} ${radius} 0 0 1 ${backX + straightLength} ${bottomY}`,
    `L ${backX} ${bottomY}`,
    "Z",
  ].join(" ");

  return (
    <g {...other} data-component="AndGateShape">
      {/* Vertikale Verlängerungslinie oben bei mehr als 3 Eingängen */}
      {minInputY < topY && (
        <line
          x1={backX}
          y1={topY}
          x2={backX}
          y2={minInputY}
          className="gate-lead"
        />
      )}

      {/* Hauptkörper */}
      <path
        d={pathD}
        className="gate-body"
      />

      {/* Vertikale Verlängerungslinie unten bei mehr als 3 Eingängen */}
      {maxInputY > bottomY && (
        <line
          x1={backX}
          y1={bottomY}
          x2={backX}
          y2={maxInputY}
          className="gate-lead"
        />
      )}

      {/* Anschluss-Linien von x=0 zu x=backX für jeden Pin */}
      {inputCount === 2 ? (
        <>
          <line x1={0} y1={18} x2={backX} y2={18} className="gate-lead" />
          <line x1={0} y1={54} x2={backX} y2={54} className="gate-lead" />
        </>
      ) : (
        Array.from({ length: inputCount }, (_, i) => {
          const pinY = (i + 1) * 18;
          return (
            <line
              key={i}
              x1={0}
              y1={pinY}
              x2={backX}
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

export default AndGateShape;
