import React from "react";

import styled from "@emotion/styled";

import { GRID_SIZE } from "../../utils/coordinateSystem";

type CanvasGridProps = React.ComponentPropsWithoutRef<"g"> & {
  panX: number;
  panY: number;
  zoom: number;
};

const CanvasGrid = styled(({ panX, panY, zoom, ...other }: CanvasGridProps) => {
  return (
    <g {...other} data-component="CanvasGrid">
      <defs>
        <pattern
          id="circuit-canvas-grid-pattern"
          width={GRID_SIZE}
          height={GRID_SIZE}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${panX - (GRID_SIZE / 2) * zoom}, ${panY - (GRID_SIZE / 2) * zoom}) scale(${zoom})`}
        >
          <circle
            cx={GRID_SIZE / 2}
            cy={GRID_SIZE / 2}
            r={1}
            fill="var(--color-grid-dots)"
          />
        </pattern>
      </defs>

      <rect
        width="100%"
        height="100%"
        fill="url(#circuit-canvas-grid-pattern)"
        pointerEvents="none"
      />
    </g>
  );
})({
  pointerEvents: "none",
});

export default CanvasGrid;
