import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";

type PinShapeProps = IOProps & {
  name?: string;
  pinType?: "in" | "out";
  symbolId?: string;
};

// Schaltungs-Pin (Input/Output-Baustein analog zu Constant / Button)
const PinShape = styled(({
  width,
  height,
  name = "Pin",
  pinType = "in",
  symbolId,
  ...other
}: PinShapeProps) => {
  const clipId = `pin-clip-${symbolId || "def"}`;
  const isGeneric = name.toLowerCase() === "in" || name.toLowerCase() === "out" || name.toLowerCase() === "pin";

  return (
    <g {...other} data-component="PinShape">
      <defs>
        <clipPath id={clipId}>
          <rect
            x={2}
            y={2}
            width={Math.max(0, width - 4)}
            height={Math.max(0, height - 4)}
            rx={5}
          />
        </clipPath>
      </defs>
      <rect
        x={2}
        y={2}
        width={width - 4}
        height={height - 4}
        rx={5}
        className="pin-base"
      />
      <g clipPath={`url(#${clipId})`}>
        {isGeneric ? (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--color-text-primary)"
            className="pin-single-text"
          >
            {name}
          </text>
        ) : (
          <>
            <text
              x={width / 2}
              y={height / 2 - 4}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--color-text-primary)"
              className="pin-name"
            >
              {name}
            </text>
            <text
              x={width / 2}
              y={height / 2 + 8}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--color-text-muted)"
              className="pin-sub"
            >
              {pinType.toUpperCase()}
            </text>
          </>
        )}
      </g>
    </g>
  );
})({
  "& > .pin-base": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& .pin-single-text": {
    fill: "var(--color-text-primary)",
    fontSize: "12px",
    fontWeight: 600,
    fontFamily: "var(--font-family-mono)",
  },
  "& .pin-name": {
    fill: "var(--color-text-primary)",
    fontSize: "11px",
    fontWeight: 600,
    fontFamily: "var(--font-family-mono)",
  },
  "& .pin-sub": {
    fill: "var(--color-text-muted)",
    fontSize: "9px",
    fontWeight: 500,
    fontFamily: "var(--font-family-mono)",
  },
});

export default PinShape;
