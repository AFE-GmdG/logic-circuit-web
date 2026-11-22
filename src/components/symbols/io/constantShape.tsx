import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";

type ConstantShapeProps = IOProps & {
  value?: string;
  symbolId?: string;
};

// Feste Signal-Konstante (0 oder 1, bzw. Hex/Dezimal)
const ConstantShape = styled(({
  width,
  height,
  value = "1",
  symbolId,
  ...other
}: ConstantShapeProps) => {
  const clipId = `const-clip-${symbolId || "def"}`;

  return (
    <g {...other} data-component="ConstantShape">
      <defs>
        <clipPath id={clipId}>
          <rect
            x={2}
            y={2}
            width={Math.max(0, width - 4)}
            height={Math.max(0, height - 4)}
            rx={4}
          />
        </clipPath>
      </defs>
      <rect
        x={2}
        y={2}
        width={width - 4}
        height={height - 4}
        rx={4}
        className="constant-base"
      />
      <text
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        clipPath={`url(#${clipId})`}
        fill="var(--color-text-primary)"
        className="constant-text"
      >
        {value}
      </text>
    </g>
  );
})({
  "& > .constant-base": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& .constant-text": {
    fill: "var(--color-text-primary)",
    fontSize: "13px",
    fontWeight: 700,
    fontFamily: "var(--font-family-mono)",
  },
});

export default ConstantShape;
