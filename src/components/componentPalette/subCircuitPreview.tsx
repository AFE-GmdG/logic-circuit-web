import React from "react";

import styled from "@emotion/styled";

import type LogicalCircuit from "../../types/circuit/logicalCircuit";

import { createCircuitSymbol } from "../../utils/circuitLayout";
import { GRID_SIZE } from "../../utils/coordinateSystem";

import CircuitSymbolView from "../circuitCanvas/circuitSymbolView";

type SubCircuitPreviewProps = React.ComponentPropsWithoutRef<"svg"> & {
  circuit: LogicalCircuit;
  width?: number;
  height?: number;
};

const SubCircuitPreview = styled(({
  circuit,
  width = 54,
  height = 36,
  ...other
}: SubCircuitPreviewProps) => {
  const reactId = React.useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");

  const previewSymbol = React.useMemo(
    () => createCircuitSymbol(
      circuit,
      "__preview__",
      0,
      0,
      "up",
      `preview-${safeId}-${circuit.logicalCircuitId}`,
    ),
    [circuit, safeId],
  );

  const pixelWidth = circuit.symbolWidth * GRID_SIZE;
  const pixelHeight = circuit.symbolHeight * GRID_SIZE;
  const hasTopPins = previewSymbol.jams.some((j) => j.pin.pinSide === "top");
  const labelText = circuit.notation;
  const showLabelAbove = Boolean(circuit.showLabelAbove && labelText);
  const padTop = showLabelAbove ? (hasTopPins ? 20 : 17) : 6;
  const padBottom = 6;
  const estimatedLabelWidth = showLabelAbove ? labelText.length * 5.8 : 0;
  const padX = Math.max(6, Math.ceil((estimatedLabelWidth - pixelWidth) / 2) + 4);

  return (
    <svg
      {...other}
      data-component="SubCircuitPreview"
      width={width}
      height={height}
      viewBox={`${-padX} ${-padTop} ${pixelWidth + padX * 2} ${pixelHeight + padTop + padBottom}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <CircuitSymbolView symbol={previewSymbol} isPreview={true} />
    </svg>
  );
})({
  flexShrink: 0,
  overflow: "visible",
});

export default SubCircuitPreview;
