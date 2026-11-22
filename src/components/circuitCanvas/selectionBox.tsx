import React from "react";

import styled from "@emotion/styled";

import type SelectionBoxType from "../../types/canvas/selectionBox";

type SelectionBoxProps = React.ComponentPropsWithoutRef<"rect"> & {
  box: SelectionBoxType | null;
};

const SelectionBox = styled(({ box, ...other }: SelectionBoxProps) => {
  if (!box) {
    return null;
  }

  const x = Math.min(box.startX, box.currentX);
  const y = Math.min(box.startY, box.currentY);
  const width = Math.abs(box.currentX - box.startX);
  const height = Math.abs(box.currentY - box.startY);

  if (width < 2 && height < 2) {
    return null;
  }

  return (
    <rect
      {...other}
      data-component="SelectionBox"
      x={x}
      y={y}
      width={width}
      height={height}
    />
  );
})({
  fill: "var(--color-selection-fill)",
  stroke: "var(--color-accent-primary)",
  strokeWidth: 1.5,
  strokeDasharray: "4 3",
  pointerEvents: "none",
});

export default SelectionBox;
