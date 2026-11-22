import React from "react";

import styled from "@emotion/styled";

import type IOProps from "./ioProps";

export type SplitterShapeProps = IOProps & {
  clockwise?: boolean;
  pinCount?: number;
  bitWidth?: number;
  symbolId?: string;
};

// Authentische Bus-Splitter-Vektorglyphe nach der C#-Vorlage Splitter.xaml
const SplitterShape = styled(({
  width,
  height,
  clockwise: _clockwise = true,
  pinCount: _pinCount = 3,
  bitWidth: _bitWidth,
  symbolId: _symbolId,
  ...other
}: SplitterShapeProps) => {
  const cx = width / 2;
  const arrowTipY = 13;
  const arrowBaseY = 18;
  const arrowHalfWidth = 3.5;

  return (
    <g {...other} data-component="SplitterShape">
      {/* Schlanker Bauteilkörper analog zu Splitter.xaml (<Rectangle Fill="Black" Margin="3"/>) */}
      <rect
        x={3}
        y={3}
        width={Math.max(2, width - 6)}
        height={Math.max(2, height - 6)}
        rx={1}
        className="splitter-body"
      />

      {/* Richtungspfeil / Keil an der Oberseite für niederwertige Bits (Bit 0) */}
      <polygon
        points={`${cx},${arrowTipY} ${cx - arrowHalfWidth},${arrowBaseY} ${cx + arrowHalfWidth},${arrowBaseY}`}
        className="splitter-arrow"
      />
    </g>
  );
})({
  "& > .splitter-body": {
    fill: "var(--color-text-secondary)",
    stroke: "none",
  },
  "& > .splitter-arrow": {
    fill: "var(--color-bg-base)",
    stroke: "none",
  },
});

export default SplitterShape;
