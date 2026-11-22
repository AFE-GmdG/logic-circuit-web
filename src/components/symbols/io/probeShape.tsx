import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";

type ProbeShapeProps = IOProps & {
  name?: string;
  value?: string;
  symbolId?: string;
};

// Prüfspitze (Probe / Messsonde)
const ProbeShape = styled(({
  width,
  height,
  name: _name,
  value = "?",
  symbolId,
  ...other
}: ProbeShapeProps) => {
  const clipId = `probe-clip-${symbolId || "def"}`;
  const lines = String(value).split("\n");

  return (
    <g {...other} data-component="ProbeShape">
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
        className="probe-base"
      />
      <text
        x={width / 2}
        y={lines.length > 1 ? height / 2 - ((lines.length - 1) * 6) : height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        clipPath={`url(#${clipId})`}
        fill="var(--color-logic-high)"
        className="probe-text"
      >
        {lines.length === 1 ? (
          lines[0]
        ) : (
          lines.map((line, idx) => (
            <tspan key={idx} x={width / 2} dy={idx === 0 ? 0 : 13}>
              {line}
            </tspan>
          ))
        )}
      </text>
    </g>
  );
})({
  "& > .probe-base": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& .probe-text": {
    fill: "var(--color-logic-high)",
    fontSize: "12px",
    fontWeight: 700,
    fontFamily: "var(--font-family-mono)",
  },
});

export default ProbeShape;
