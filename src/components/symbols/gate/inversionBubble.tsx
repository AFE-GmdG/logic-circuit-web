import React from "react";

import styled from "@emotion/styled";

type InversionBubbleProps = React.ComponentPropsWithoutRef<"circle"> & {
  cx: number;
  cy: number;
};

/**
 * @deprecated Invertierungen werden im ANSI-/LogicCircuit-Standard direkt über die Pin-Lötpunkte (SymbolRenderer) abgebildet.
 */
const InversionBubble = styled(({ cx, cy, ...other }: InversionBubbleProps) => (
  <circle
    {...other}
    data-component="InversionBubble"
    cx={cx}
    cy={cy}
    r={3.5}
  />
))({
  fill: "var(--color-bg-base)",
  stroke: "var(--color-text-primary)",
  strokeWidth: 1.5,
});

export default InversionBubble;
