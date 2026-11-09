import React from "react";

import styled from "@emotion/styled";

type CircuitCanvasProps = React.ComponentPropsWithoutRef<"main"> & {
  zoom: number;
};

const CircuitCanvas = styled(({ zoom, ...other }: CircuitCanvasProps) => {
  return (
    <main {...other} data-component="CircuitCanvas">
      <svg className="schematic-viewport">
        <defs>
          <pattern
            id="canvas-grid"
            width={20 * zoom}
            height={20 * zoom}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={2}
              cy={2}
              r={1}
              fill="var(--color-grid-dots)"
            />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill="url(#canvas-grid)" />

        {/* Demo-Visualisierung für Schaltungselemente */}
        <g transform={`scale(${zoom}) translate(60, 60)`}>
          {/* Beispiel-Gatter: AND */}
          <rect
            x={100}
            y={80}
            width={80}
            height={60}
            rx={6}
            fill="var(--color-bg-elevated)"
            stroke="var(--color-border-strong)"
            strokeWidth={1.5}
          />
          <text
            x={140}
            y={115}
            textAnchor="middle"
            fill="var(--color-text-primary)"
            fontSize={14}
            fontWeight={600}
            fontFamily="var(--font-family-mono)"
          >
            AND
          </text>

          {/* Eingangs-Pins */}
          <circle cx={100} cy={95} r={4} fill="var(--color-logic-high)" />
          <circle cx={100} cy={125} r={4} fill="var(--color-logic-low)" />

          {/* Ausgangs-Pin */}
          <circle cx={180} cy={110} r={4} fill="var(--color-logic-low)" />

          {/* Hinweistext */}
          <text
            x={100}
            y={170}
            fill="var(--color-text-muted)"
            fontSize={12}
            fontFamily="var(--font-family-base)"
          >
            Logic Circuit Web Canvas • Bereit für CAD- und Simulations-Engine
          </text>
        </g>
      </svg>
    </main>
  );
})({
  flex: 1,
  position: "relative",
  overflow: "hidden",
  backgroundColor: "var(--color-grid-canvas)",

  "& > .schematic-viewport": {
    width: "100%",
    height: "100%",
    display: "block",
  },
});

export default CircuitCanvas;
