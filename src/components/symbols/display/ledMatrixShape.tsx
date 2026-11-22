import React from "react";

import styled from "@emotion/styled";

import type LedMatrixCellShape from "../../../types/circuit/ledMatrixCellShape";
import type LedMatrixType from "../../../types/circuit/ledMatrixType";

import { GRID_SIZE } from "../../../utils/coordinateSystem";

type LedMatrixShapeProps = React.ComponentPropsWithoutRef<"g"> & {
  width?: number;
  height?: number;
  rows?: number;
  columns?: number;
  matrixType?: LedMatrixType;
  cellShape?: LedMatrixCellShape;
  colors?: number;
  persistenceMultiplier?: 1 | 2 | 3;
  cellValues?: number[][];
  symbolId?: string;
};

// Konfigurierbare LED-Matrix (Rund oder Rechteckig, Zeilenweise oder Auswahl, 1..3 Bit MultiColor)
const LedMatrixShape = styled(({
  width: customWidth,
  height: customHeight,
  rows = 4,
  columns = 4,
  matrixType = "individual",
  cellShape = "round",
  colors = 1,
  persistenceMultiplier = 1,
  cellValues,
  symbolId: _symbolId,
  ...other
}: LedMatrixShapeProps) => {
  const width = customWidth ?? (columns + 1) * GRID_SIZE;
  const height = customHeight ?? (rows + 1) * GRID_SIZE;

  const getColorIndex = (rawVal: number): number => {
    if (colors === 1) {
      return rawVal > 0 ? 1 : 0;
    }
    if (colors === 2) {
      return rawVal & 3;
    }
    return rawVal & 7;
  };

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cx = (c + 1) * GRID_SIZE;
      const cy = (r + 1) * GRID_SIZE;
      const rawVal = cellValues?.[r]?.[c] ?? 0;
      const colorIndex = getColorIndex(rawVal);

      if (cellShape === "round") {
        cells.push(
          <circle
            key={`${r}-${c}`}
            cx={cx}
            cy={cy}
            r={6.5}
            data-cell={`${r}-${c}`}
            className={`matrix-cell-round color-${colorIndex}`}
          />,
        );
      } else {
        cells.push(
          <rect
            key={`${r}-${c}`}
            x={cx - 7}
            y={cy - 7}
            width={14}
            height={14}
            rx={1.5}
            data-cell={`${r}-${c}`}
            className={`matrix-cell-rect color-${colorIndex}`}
          />,
        );
      }
    }
  }

  return (
    <g
      {...other}
      data-component="LedMatrixShape"
      data-matrix-type={matrixType}
      data-persistence={persistenceMultiplier}
      data-colors={colors}
    >
      {/* Gehäuse der Matrix */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={3}
        ry={3}
        className="matrix-case"
      />

      {/* Raster der Leucht-Zellen ohne Inline-Styles */}
      {cells}
    </g>
  );
})({
  "& > .matrix-case": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& .matrix-cell-round": {
    strokeWidth: 1,
    transition: "fill 0.1s ease, filter 0.1s ease",
  },
  "& .matrix-cell-rect": {
    strokeWidth: 1,
    transition: "fill 0.1s ease, filter 0.1s ease",
  },

  /* Standard-Farbdefinitionen für Farb-Indexe 0 bis 7 */
  "& .color-0": {
    fill: "#1f242c",
    stroke: "#2d333b",
  },
  "& .color-1": {
    fill: "#52c41a",
    stroke: "#95de64",
    filter: "drop-shadow(0 0 2px rgba(82, 196, 26, 0.4))",
  },
  "& .color-2": {
    fill: "#52c41a",
    stroke: "#95de64",
    filter: "drop-shadow(0 0 2px rgba(82, 196, 26, 0.45))",
  },
  "& .color-3": {
    fill: "#faad14",
    stroke: "#ffd666",
    filter: "drop-shadow(0 0 2px rgba(250, 173, 20, 0.45))",
  },
  "& .color-4": {
    fill: "#ff4d4f",
    stroke: "#ff7875",
    filter: "drop-shadow(0 0 2px rgba(255, 77, 79, 0.45))",
  },
  "& .color-5": {
    fill: "#eb2f96",
    stroke: "#ff85c0",
    filter: "drop-shadow(0 0 2px rgba(235, 47, 150, 0.45))",
  },
  "& .color-6": {
    fill: "#faad14",
    stroke: "#ffd666",
    filter: "drop-shadow(0 0 2px rgba(250, 173, 20, 0.45))",
  },
  "& .color-7": {
    fill: "#f0f0f0",
    stroke: "#ffffff",
    filter: "drop-shadow(0 0 2px rgba(255, 255, 255, 0.55))",
  },

  /* Farbdefinitionen im Zwei-Bit-Modus: Rot, Grün, Gelb */
  "&[data-colors='2'] .color-1": {
    fill: "#ff4d4f",
    stroke: "#ff7875",
    filter: "drop-shadow(0 0 2px rgba(255, 77, 79, 0.45))",
  },
  "&[data-colors='2'] .color-2": {
    fill: "#52c41a",
    stroke: "#95de64",
    filter: "drop-shadow(0 0 2px rgba(82, 196, 26, 0.45))",
  },
  "&[data-colors='2'] .color-3": {
    fill: "#faad14",
    stroke: "#ffd666",
    filter: "drop-shadow(0 0 2px rgba(250, 173, 20, 0.45))",
  },

  /* Farbdefinitionen im Drei-Bit-RGB-Modus: Blau, Grün, Cyan, Rot, Magenta, Gelb, Weiß */
  "&[data-colors='3'] .color-1": {
    fill: "#1677ff",
    stroke: "#69b1ff",
    filter: "drop-shadow(0 0 2px rgba(22, 119, 255, 0.45))",
  },
  "&[data-colors='3'] .color-2": {
    fill: "#52c41a",
    stroke: "#95de64",
    filter: "drop-shadow(0 0 2px rgba(82, 196, 26, 0.45))",
  },
  "&[data-colors='3'] .color-3": {
    fill: "#13c2c2",
    stroke: "#5cdbd3",
    filter: "drop-shadow(0 0 2px rgba(19, 194, 194, 0.45))",
  },
  "&[data-colors='3'] .color-4": {
    fill: "#ff4d4f",
    stroke: "#ff7875",
    filter: "drop-shadow(0 0 2px rgba(255, 77, 79, 0.45))",
  },
  "&[data-colors='3'] .color-5": {
    fill: "#eb2f96",
    stroke: "#ff85c0",
    filter: "drop-shadow(0 0 2px rgba(235, 47, 150, 0.45))",
  },
  "&[data-colors='3'] .color-6": {
    fill: "#faad14",
    stroke: "#ffd666",
    filter: "drop-shadow(0 0 2px rgba(250, 173, 20, 0.45))",
  },
  "&[data-colors='3'] .color-7": {
    fill: "#f0f0f0",
    stroke: "#ffffff",
    filter: "drop-shadow(0 0 2px rgba(255, 255, 255, 0.55))",
  },
});

export default LedMatrixShape;
