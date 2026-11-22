import React from "react";

import styled from "@emotion/styled";

type SubCircuitGlyphProps = React.ComponentPropsWithoutRef<"svg"> & {
  name: string;
};

const SubCircuitGlyph = styled(({ name, ...other }: SubCircuitGlyphProps) => {
  const shortName = name.length > 5 ? name.slice(0, 4) + "." : name;

  return (
    <svg
      {...other}
      data-component="SubCircuitGlyph"
      viewBox="0 0 36 36"
      width={36}
      height={36}
    >
      <rect
        x={2}
        y={2}
        width={32}
        height={32}
        rx={4}
        className="chip-base"
      />
      {/* Anschluss-Pins auf der linken und rechten Seite */}
      <line x1={0} y1={12} x2={2} y2={12} className="chip-pin" />
      <line x1={0} y1={24} x2={2} y2={24} className="chip-pin" />
      <line x1={34} y1={18} x2={36} y2={18} className="chip-pin" />

      {/* Subschaltungs-Name zentriert im Baustein */}
      <text
        x={18}
        y={21}
        textAnchor="middle"
        className="chip-text"
      >
        {shortName}
      </text>
    </svg>
  );
})({
  flexShrink: 0,
  "& > .chip-base": {
    fill: "var(--color-bg-elevated)",
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .chip-pin": {
    stroke: "var(--color-text-primary)",
    strokeWidth: 1.5,
  },
  "& > .chip-text": {
    fill: "var(--color-text-primary)",
    fontSize: "8px",
    fontWeight: 700,
    fontFamily: "var(--font-family-mono)",
  },
});

export default SubCircuitGlyph;
