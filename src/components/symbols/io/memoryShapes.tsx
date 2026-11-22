import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";
import type BasePin from "../../../types/circuit/basePin";

import { GRID_SIZE } from "../../../utils/coordinateSystem";

type MemoryShapeProps = IOProps & {
  writable: boolean;
  writeOn1?: boolean;
  dualPort?: boolean;
  pins?: BasePin[];
};

// Vektorsymbol für digitale Speicherbausteine (ROM und RAM) analog zu Memory.CreateGlyph
const MemoryShape = styled(({
  width,
  height,
  writable,
  writeOn1 = false,
  dualPort = false,
  pins = [],
  ...other
}: MemoryShapeProps) => {
  const safeWidth = Math.max(0, width - 1);
  const safeHeight = Math.max(0, height - 1);

  return (
    <g
      {...other}
      data-component="MemoryShape"
      data-writable={writable ? "true" : "false"}
      data-write-on={writable ? (writeOn1 ? "1" : "0") : undefined}
      data-dual-port={dualPort ? "true" : undefined}
    >
      <rect
        x={0.5}
        y={0.5}
        width={safeWidth}
        height={safeHeight}
        rx={3}
        className="memory-body"
      />
      {pins.map((pin) => {
        const pinLabel = pin.jamNotation || pin.name.slice(0, 2);
        if (pin.pinSide === "left") {
          return (
            <text
              key={pin.pinId}
              x={4}
              y={pin.gridPoint.y * GRID_SIZE + 3}
              textAnchor="start"
              className="memory-pin-label"
            >
              {pinLabel}
            </text>
          );
        }
        if (pin.pinSide === "right") {
          return (
            <text
              key={pin.pinId}
              x={width - 4}
              y={pin.gridPoint.y * GRID_SIZE + 3}
              textAnchor="end"
              className="memory-pin-label"
            >
              {pinLabel}
            </text>
          );
        }
        if (pin.pinSide === "bottom") {
          return (
            <text
              key={pin.pinId}
              x={pin.gridPoint.x * GRID_SIZE}
              y={height - 4}
              textAnchor="middle"
              className="memory-pin-label"
            >
              {pinLabel}
            </text>
          );
        }
        return (
          <text
            key={pin.pinId}
            x={pin.gridPoint.x * GRID_SIZE}
            y={10}
            textAnchor="middle"
            className="memory-pin-label"
          >
            {pinLabel}
          </text>
        );
      })}
      <text
        x={width / 2}
        y={writable ? height / 2 - 2 : height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="memory-title"
      >
        {writable ? "RAM" : "ROM"}
      </text>
    </g>
  );
})({
  "& > .memory-body": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .memory-pin-label": {
    fill: "var(--color-text-secondary)",
    fontSize: "0.5rem",
    fontWeight: 600,
    fontFamily: "var(--font-family-mono)",
    pointerEvents: "none",
  },
  "& > .memory-title": {
    fill: "var(--color-text-primary)",
    fontSize: "0.625rem",
    fontWeight: 700,
    fontFamily: "var(--font-family-mono)",
    pointerEvents: "none",
  },
});

export default MemoryShape;
