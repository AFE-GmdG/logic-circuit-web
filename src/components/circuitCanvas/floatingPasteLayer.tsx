import React from "react";

import styled from "@emotion/styled";

import type FloatingPasteState from "../../types/canvas/floatingPasteState";

import { getSymbolGridBoundingBox } from "../../utils/circuitLayout";
import { GRID_SIZE } from "../../utils/coordinateSystem";
import {
  getFloatingPasteBoundingBox,
  getRubberbandPreviewSegments,
} from "../../utils/floatingPasteUtils";

import CircuitSymbolView from "./circuitSymbolView";
import TextNoteView from "./textNoteView";

export type FloatingPasteLayerProps = Omit<React.ComponentPropsWithoutRef<"g">, "onPointerDown"> & {
  floatingPaste: FloatingPasteState | null;
  onStartFloatingDrag: (event: React.PointerEvent<SVGElement>) => void;
};

// Isolierte SVG-Vorschau für schwebendes Einfügen vor endgültiger Platzierung auf dem Canvas
const FloatingPasteLayer = styled(({
  floatingPaste,
  onStartFloatingDrag,
  ...other
}: FloatingPasteLayerProps) => {
  if (!floatingPaste) {
    return null;
  }

  const { payload, hasOverlapWarning, overlappingSymbolIds, overlappingPoints, moveMeta } = floatingPaste;
  const boundingBox = getFloatingPasteBoundingBox(payload);
  if (!boundingBox) {
    return null;
  }

  const rubberbandSegments = getRubberbandPreviewSegments(moveMeta, payload);
  const overlappingSet = new Set(overlappingSymbolIds);
  const framePadPx = GRID_SIZE * 0.6;
  const frameX = boundingBox.minX * GRID_SIZE - framePadPx;
  const frameY = boundingBox.minY * GRID_SIZE - framePadPx;
  const frameW = Math.max(GRID_SIZE, (boundingBox.maxX - boundingBox.minX) * GRID_SIZE) + framePadPx * 2;
  const frameH = Math.max(GRID_SIZE, (boundingBox.maxY - boundingBox.minY) * GRID_SIZE) + framePadPx * 2;

  return (
    <g
      {...other}
      data-component="FloatingPasteLayer"
      data-testid="floating-paste-layer"
      data-floating-mode={floatingPaste.mode ?? "paste"}
      data-overlap-warning={hasOverlapWarning ? "true" : "false"}
    >
      {/* Vorläufige Rubberband-Leitungen beim schwebenden Verschieben (ohne vorzeitige Leiter-Verschmelzung) */}
      {rubberbandSegments.length > 0 && (
        <g className="floating-rubberband-wires" pointerEvents="none">
          {rubberbandSegments.map((wire) => (
            <line
              key={`rb-${wire.wireId}`}
              x1={wire.x1 * GRID_SIZE}
              y1={wire.y1 * GRID_SIZE}
              x2={wire.x2 * GRID_SIZE}
              y2={wire.y2 * GRID_SIZE}
              stroke="var(--color-accent-primary)"
              strokeWidth={1.75}
              strokeDasharray="4 2"
              strokeLinecap="round"
              opacity={0.78}
            />
          ))}
        </g>
      )}

      {/* Greifbarer Hintergrundrahmen für den schwebenden Block */}
      <rect
        x={frameX}
        y={frameY}
        width={frameW}
        height={frameH}
        rx={4}
        fill={hasOverlapWarning ? "rgba(248, 81, 73, 0.08)" : "rgba(56, 139, 253, 0.08)"}
        stroke={hasOverlapWarning ? "var(--color-logic-error)" : "var(--color-accent-primary)"}
        strokeWidth={1.75}
        strokeDasharray="6 3"
        style={{ cursor: "move" }}
        data-testid="floating-paste-frame"
        onPointerDown={onStartFloatingDrag}
      />

      {/* Schwebende Leitungen ohne Veränderung von currentCircuit.wires */}
      <g className="floating-paste-wires">
        {payload.wires.map((wire) => (
          <g key={wire.wireId}>
            <line
              x1={wire.x1 * GRID_SIZE}
              y1={wire.y1 * GRID_SIZE}
              x2={wire.x2 * GRID_SIZE}
              y2={wire.y2 * GRID_SIZE}
              stroke="transparent"
              strokeWidth={10}
              strokeLinecap="round"
              style={{ cursor: "move" }}
              onPointerDown={onStartFloatingDrag}
            />
            <line
              x1={wire.x1 * GRID_SIZE}
              y1={wire.y1 * GRID_SIZE}
              x2={wire.x2 * GRID_SIZE}
              y2={wire.y2 * GRID_SIZE}
              stroke={hasOverlapWarning ? "var(--color-logic-error)" : "var(--color-accent-primary)"}
              strokeWidth={2}
              strokeLinecap="round"
              pointerEvents="none"
            />
          </g>
        ))}
      </g>

      {/* Schwebende Textnotizen */}
      <g opacity={0.9}>
        {payload.textNotes.map((note) => (
          <TextNoteView
            key={note.textNoteId}
            textNote={note}
            isSelected={false}
            isCandidateSelected={false}
            isOnlySelected={false}
            onTextNotePointerDown={onStartFloatingDrag}
          />
        ))}
      </g>

      {/* Schwebende Schaltungssymbole */}
      <g opacity={0.9}>
        {payload.symbols.map((entry) => (
          <CircuitSymbolView
            key={entry.symbol.circuitSymbolId}
            symbol={entry.symbol}
            isSelected={false}
            isCandidateSelected={false}
            isOnlySelected={false}
            onSymbolPointerDown={onStartFloatingDrag}
          />
        ))}
      </g>

      {/* Kollisions-Hervorhebung bei Überlappung mit bestehenden Bauteilen oder Pins */}
      {hasOverlapWarning && (
        <g className="floating-paste-overlap-warnings" pointerEvents="none">
          {payload.symbols
            .filter((entry) => overlappingSet.has(entry.symbol.circuitSymbolId))
            .map((entry) => {
              const symBox = getSymbolGridBoundingBox(entry.symbol);
              return (
                <rect
                  key={`warn-${entry.symbol.circuitSymbolId}`}
                  x={symBox.minX * GRID_SIZE - 2}
                  y={symBox.minY * GRID_SIZE - 2}
                  width={(symBox.maxX - symBox.minX) * GRID_SIZE + 4}
                  height={(symBox.maxY - symBox.minY) * GRID_SIZE + 4}
                  rx={2}
                  fill="rgba(248, 81, 73, 0.16)"
                  stroke="var(--color-logic-error)"
                  strokeWidth={1.6}
                  strokeDasharray="3 2"
                />
              );
            })}
          {overlappingPoints.map((pt) => (
            <circle
              key={`warn-pt-${pt.x}-${pt.y}`}
              cx={pt.x * GRID_SIZE}
              cy={pt.y * GRID_SIZE}
              r={5.5}
              fill="rgba(248, 81, 73, 0.25)"
              stroke="var(--color-logic-error)"
              strokeWidth={1.8}
            />
          ))}
        </g>
      )}
    </g>
  );
})({});

export default FloatingPasteLayer;
