import React from "react";

import styled from "@emotion/styled";

import type DisplayColor from "../../../types/circuit/displayColor";

type SevenSegmentShapeProps = React.ComponentPropsWithoutRef<"g"> & {
  width?: number;
  height?: number;
  segments?: boolean[];
  color?: DisplayColor;
  symbolId?: string;
};

const COLOR_MAP: Record<DisplayColor, {
  off: string;
  on: string;
  glow: string;
}> = {
  red: {
    off: "#2e1313",
    on: "#ff4d4f",
    glow: "rgba(255, 77, 79, 0.5)",
  },
  yellow: {
    off: "#2d240b",
    on: "#faad14",
    glow: "rgba(250, 173, 20, 0.5)",
  },
  green: {
    off: "#0f2615",
    on: "#52c41a",
    glow: "rgba(82, 196, 26, 0.5)",
  },
  blue: {
    off: "#0c1e33",
    on: "#1677ff",
    glow: "rgba(22, 119, 255, 0.5)",
  },
};

// Siebensegment-Anzeige mit Dezimalpunkt (8 Eingänge: a, b, c, d, e, f, g, dp)
// Standardmaße: 3x5 Rasterpunkte (54px x 90px)
const SevenSegmentShape = styled(({
  width = 54,
  height = 90,
  segments = [false, false, false, false, false, false, false, false],
  color = "red",
  symbolId: _symbolId,
  ...other
}: SevenSegmentShapeProps) => {
  const colorSpec = COLOR_MAP[color] ?? COLOR_MAP.red;

  // 8 Segmente: a, b, c, d, e, f, g, dp
  const [a, b, c, d, e, f, g, dp] = segments;

  const getSegmentStyle = (isActive: boolean) => ({
    stroke: isActive ? colorSpec.on : colorSpec.off,
    filter: isActive ? `drop-shadow(0 0 4px ${colorSpec.glow})` : undefined,
  });

  const getDotStyle = (isActive: boolean) => ({
    fill: isActive ? colorSpec.on : colorSpec.off,
    filter: isActive ? `drop-shadow(0 0 4px ${colorSpec.glow})` : undefined,
  });

  // Skalierungsfaktor bezogen auf 54x90
  const scaleX = width / 54;
  const scaleY = height / 90;

  return (
    <g {...other} data-component="SevenSegmentShape">
      {/* Gehäuse-Rahmen im abgerundeten Dark-Design */}
      <rect
        x={2}
        y={2}
        width={width - 4}
        height={height - 4}
        rx={4}
        ry={4}
        className="segment-case"
      />

      {/* Leicht geneigte 7-Segment-Geometrie (-8° Skew analog zum Original) */}
      <g
        transform={`scale(${scaleX}, ${scaleY}) translate(27, 45) skewX(-8) translate(-27, -45)`}
      >
        {/* Segment a (oben) */}
        <line
          x1={17}
          y1={15}
          x2={37}
          y2={15}
          style={getSegmentStyle(Boolean(a))}
          className={`segment-line segment-a ${a ? "segment-on" : "segment-off"}`}
        />
        {/* Segment b (oben rechts) */}
        <line
          x1={39}
          y1={18}
          x2={39}
          y2={41}
          style={getSegmentStyle(Boolean(b))}
          className={`segment-line segment-b ${b ? "segment-on" : "segment-off"}`}
        />
        {/* Segment c (unten rechts) */}
        <line
          x1={39}
          y1={49}
          x2={39}
          y2={72}
          style={getSegmentStyle(Boolean(c))}
          className={`segment-line segment-c ${c ? "segment-on" : "segment-off"}`}
        />
        {/* Segment d (unten) */}
        <line
          x1={17}
          y1={75}
          x2={37}
          y2={75}
          style={getSegmentStyle(Boolean(d))}
          className={`segment-line segment-d ${d ? "segment-on" : "segment-off"}`}
        />
        {/* Segment e (unten links) */}
        <line
          x1={15}
          y1={49}
          x2={15}
          y2={72}
          style={getSegmentStyle(Boolean(e))}
          className={`segment-line segment-e ${e ? "segment-on" : "segment-off"}`}
        />
        {/* Segment f (oben links) */}
        <line
          x1={15}
          y1={18}
          x2={15}
          y2={41}
          style={getSegmentStyle(Boolean(f))}
          className={`segment-line segment-f ${f ? "segment-on" : "segment-off"}`}
        />
        {/* Segment g (Mitte) */}
        <line
          x1={17}
          y1={45}
          x2={37}
          y2={45}
          style={getSegmentStyle(Boolean(g))}
          className={`segment-line segment-g ${g ? "segment-on" : "segment-off"}`}
        />
        {/* Dezimalpunkt dp */}
        <circle
          cx={44}
          cy={75}
          r={3}
          style={getDotStyle(Boolean(dp))}
          className={`segment-dot segment-dp ${dp ? "segment-on" : "segment-off"}`}
        />
      </g>
    </g>
  );
})({
  "& > .segment-case": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& .segment-line": {
    strokeWidth: 4,
    strokeLinecap: "round",
    transition: "stroke 0.15s ease, filter 0.15s ease",
  },
  "& .segment-dot": {
    transition: "fill 0.15s ease, filter 0.15s ease",
  },
});

export default SevenSegmentShape;
