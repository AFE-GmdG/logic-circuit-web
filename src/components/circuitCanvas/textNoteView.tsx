import React from "react";

import { keyframes } from "@emotion/react";
import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type TextNote from "../../types/circuit/textNote";
import type TextNoteLineHeight from "../../types/circuit/textNoteLineHeight";
import type { CollabSoftLockEntry } from "../../types/collab/modelSyncMessage";
import type CollabRemoteSelectionOwner from "../../types/collab/remoteEntityHighlight";

import {
  getRotationAngle,
  getRotationCenter,
  getTextNoteGridDimensions,
} from "../../utils/circuitLayout";
import { getParticipantContrastTextColor } from "../../utils/collabParticipantColors";
import { GRID_SIZE } from "../../utils/coordinateSystem";

const AI_HIGHLIGHT_PULSE = keyframes({
  "0%, 100%": {
    opacity: 0.9,
  },
  "50%": {
    opacity: 0.45,
  },
});

export type TextNoteViewProps = Omit<React.ComponentPropsWithoutRef<"g">, "onDoubleClick"> & {
  textNote: TextNote;
  isSelected?: boolean;
  isCandidateSelected?: boolean;
  isOnlySelected?: boolean;
  isAiHighlighted?: boolean;
  foreignLock?: CollabSoftLockEntry | null;
  foreignLockColor?: string;
  foreignSelections?: ReadonlyArray<CollabRemoteSelectionOwner>;
  isReadOnly?: boolean;
  onTextNotePointerDown?: (event: React.PointerEvent<SVGGElement>, textNote: TextNote) => void;
  onTextNoteDoubleClick?: (event: React.MouseEvent<SVGGElement> | React.PointerEvent<SVGGElement>, textNote: TextNote) => void;
  onResizeHandlePointerDown?: (
    event: React.PointerEvent<SVGRectElement>,
    textNote: TextNote,
    hx: 0 | 1 | 2,
    hy: 0 | 1 | 2,
  ) => void;
};

// Ermittelt die visuelle Schriftgröße passend zur Zeilenhöhe
export function getFontSizeForLineHeight(lineHeight: TextNoteLineHeight): number {
  switch (lineHeight) {
    case 9:
      return 7;
    case 12:
      return 9.5;
    case 18:
      return 13.5;
    case 36:
      return 26;
    default:
      return 13.5;
  }
}

type ResizeHandleDef = {
  key: string;
  hx: 0 | 1 | 2;
  hy: 0 | 1 | 2;
  cursor: string;
};

const RESIZE_HANDLES: ResizeHandleDef[] = [
  { key: "nw", hx: 0, hy: 0, cursor: "nwse-resize" },
  { key: "n", hx: 1, hy: 0, cursor: "ns-resize" },
  { key: "ne", hx: 2, hy: 0, cursor: "nesw-resize" },
  { key: "e", hx: 2, hy: 1, cursor: "ew-resize" },
  { key: "se", hx: 2, hy: 2, cursor: "nwse-resize" },
  { key: "s", hx: 1, hy: 2, cursor: "ns-resize" },
  { key: "sw", hx: 0, hy: 2, cursor: "nesw-resize" },
  { key: "w", hx: 0, hy: 1, cursor: "ew-resize" },
];

// Ermittelt die kompakte Badge-Beschriftung für fremdselektierte Textnotizen inklusive Mehrfach-Auswahl
function formatForeignSelectionLabel(owners: ReadonlyArray<CollabRemoteSelectionOwner>): string {
  const primary = owners[0];
  if (!primary) {
    return "";
  }
  const baseName = primary.displayName.length > 18
    ? `${primary.displayName.slice(0, 17)}…`
    : primary.displayName;
  const prefix = primary.hasOpenDialog ? "✎ " : "";
  const extraSuffix = owners.length > 1 ? ` +${owners.length - 1}` : "";
  return `${prefix}${baseName}${extraSuffix}`;
}

const TextNoteView = styled(({
  textNote,
  isSelected = false,
  isCandidateSelected = false,
  isOnlySelected = true,
  isAiHighlighted = false,
  foreignLock = null,
  foreignLockColor,
  foreignSelections,
  isReadOnly = false,
  onTextNotePointerDown,
  onTextNoteDoubleClick,
  onResizeHandlePointerDown,
  ...other
}: TextNoteViewProps) => {
  const { t } = useTranslation();
  const { gridWidth, gridHeight } = getTextNoteGridDimensions(textNote);
  const lockOwnerLabel = foreignLock
    ? (foreignLock.ownerDisplayName.length > 20
      ? `${foreignLock.ownerDisplayName.slice(0, 19)}…`
      : foreignLock.ownerDisplayName)
    : "";
  const lockBadgeText = lockOwnerLabel ? `🔒 ${lockOwnerLabel}` : "";
  const lockBadgeWidth = Math.max(46, lockBadgeText.length * 5.6 + 12);
  const pixelWidth = gridWidth * GRID_SIZE;
  const pixelHeight = gridHeight * GRID_SIZE;

  const effectiveForeignSelections = React.useMemo(
    () => {
      if (!foreignSelections || foreignSelections.length === 0) {
        return [];
      }
      return foreignLock
        ? foreignSelections.filter((owner) => owner.peerId !== foreignLock.ownerPeerId)
        : [...foreignSelections];
    },
    [foreignLock, foreignSelections],
  );
  const primaryForeignSelection = effectiveForeignSelections[0] ?? null;
  const foreignSelectionBadgeText = primaryForeignSelection
    ? formatForeignSelectionLabel(effectiveForeignSelections)
    : "";
  const foreignSelectionBadgeWidth = Math.max(40, foreignSelectionBadgeText.length * 5.6 + 12);

  const angle = getRotationAngle(textNote.rotation);
  const origin = getRotationCenter(gridWidth, gridHeight);
  const centerX = gridWidth * origin.x * GRID_SIZE;
  const centerY = gridHeight * origin.y * GRID_SIZE;

  const rotationTransform = angle !== 0 ? ` rotate(${angle}, ${centerX}, ${centerY})` : "";
  const transform = `translate(${textNote.x * GRID_SIZE}, ${textNote.y * GRID_SIZE})${rotationTransform}`;

  const lines = React.useMemo(
    () => textNote.note.split("\n"),
    [textNote.note],
  );
  const defaultLineHeight = textNote.lineHeight ?? 18;
  const fontFamily = textNote.fontFamily === "sans"
    ? "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    : "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

  // Berechnet die vertikale Position jeder Zeile
  const lineElements = React.useMemo(
    () => {
      let currentY = 0;
      return lines.map((line, index) => {
        const lh = textNote.lineHeights?.[index] ?? defaultLineHeight;
        const centerYPos = currentY + lh / 2;
        currentY += lh;
        const fontSize = getFontSizeForLineHeight(lh);
        const isHeader = lh === 36;

        return (
          <text
            key={index}
            x={6}
            y={centerYPos}
            dominantBaseline="central"
            fontFamily={fontFamily}
            fontSize={fontSize}
            fontWeight={isHeader ? 700 : 500}
            fill="var(--color-text-primary)"
            className="text-line"
          >
            {line || " "}
          </text>
        );
      });
    },
    [
      defaultLineHeight,
      fontFamily,
      lines,
      textNote.lineHeights,
    ],
  );

  return (
    <g
      {...other}
      data-component="TextNoteView"
      data-ai-highlighted={isAiHighlighted ? "true" : undefined}
      data-foreign-locked={foreignLock ? "true" : undefined}
      data-locked-by={foreignLock?.ownerDisplayName}
      data-lock-color={foreignLock ? foreignLockColor : undefined}
      data-foreign-selected={primaryForeignSelection ? "true" : undefined}
      data-foreign-selected-by={
        effectiveForeignSelections.length > 0
          ? effectiveForeignSelections.map((owner) => owner.displayName).join(", ")
          : undefined
      }
      data-readonly={isReadOnly ? "true" : undefined}
      transform={transform}
      onPointerDown={(event) => {
        if (event.detail >= 2) {
          onTextNoteDoubleClick?.(event, textNote);
        }
        onTextNotePointerDown?.(event, textNote);
      }}
      onDoubleClick={(event) => onTextNoteDoubleClick?.(event, textNote)}
    >
      {foreignLock && (
        <title>{`🔒 ${t("collabSync.lockedByTooltip", { name: foreignLock.ownerDisplayName })}`}</title>
      )}
      {/* Transparenter Klick- und Zieh-Bereich über die gesamte Text-Fläche */}
      <rect
        x={0}
        y={0}
        width={pixelWidth}
        height={pixelHeight}
        className="hit-rect"
      />

      {/* Dezente, zeitlich begrenzte Hervorhebung für von der KI platzierte/geänderte Text-Notizen */}
      {isAiHighlighted && (
        <rect
          x={-3}
          y={-3}
          width={pixelWidth + 6}
          height={pixelHeight + 6}
          rx={3}
          className="ai-highlight-box"
        />
      )}

      {/* Soft-Lock-Rahmen und Besitzer-Badge in der lokalen Teilnehmerfarbe */}
      {foreignLock && (
        <>
          <rect
            x={-2}
            y={-2}
            width={pixelWidth + 4}
            height={pixelHeight + 4}
            rx={3}
            className="soft-lock-box"
            style={foreignLockColor
              ? {
                stroke: foreignLockColor,
                fill: foreignLockColor,
                fillOpacity: 0.16,
              }
              : undefined}
          />
          <g className="soft-lock-badge">
            <rect
              x={(pixelWidth - lockBadgeWidth) / 2}
              y={-18}
              width={lockBadgeWidth}
              height={15}
              rx={4}
              className="soft-lock-badge-bg"
              style={foreignLockColor ? { stroke: foreignLockColor } : undefined}
            />
            <text
              x={pixelWidth / 2}
              y={-7.5}
              textAnchor="middle"
              className="soft-lock-badge-text"
            >
              {lockBadgeText}
            </text>
          </g>
        </>
      )}

      {/* Farbige Kennzeichnung für fremdselektierte Textnotizen */}
      {!foreignLock && primaryForeignSelection && (
        <>
          <rect
            x={-2}
            y={-2}
            width={pixelWidth + 4}
            height={pixelHeight + 4}
            rx={3}
            className="foreign-selection-box"
            style={{
              stroke: primaryForeignSelection.color,
              fill: primaryForeignSelection.color,
              fillOpacity: 0.12,
            }}
          />
          <g className="foreign-selection-badge">
            <rect
              x={(pixelWidth - foreignSelectionBadgeWidth) / 2}
              y={-17}
              width={foreignSelectionBadgeWidth}
              height={14}
              rx={4}
              className="foreign-selection-badge-bg"
              style={{
                fill: primaryForeignSelection.color,
                stroke: primaryForeignSelection.color,
              }}
            />
            <text
              x={pixelWidth / 2}
              y={-7}
              textAnchor="middle"
              className="foreign-selection-badge-text"
              style={{ fill: getParticipantContrastTextColor(primaryForeignSelection.color) }}
            >
              {foreignSelectionBadgeText}
            </text>
          </g>
        </>
      )}

      {/* Visueller Auswahlrahmen analog zur Original-LogicCircuit TextNote-Darstellung */}
      {isSelected && (
        <rect
          x={0}
          y={0}
          width={pixelWidth}
          height={pixelHeight}
          className="selection-box"
        />
      )}

      {/* Visueller Rahmen für Notizen in der Rechteck-Vorauswahl */}
      {!isSelected && isCandidateSelected && (
        <rect
          x={-2}
          y={-2}
          width={pixelWidth + 4}
          height={pixelHeight + 4}
          rx={2}
          className="candidate-box"
        />
      )}

      {/* SVG ClipPath begrenzt den Text exakt auf die Kasten-Dimensionen */}
      <defs>
        <clipPath id={`text-clip-${textNote.textNoteId}`}>
          <rect x={0} y={0} width={pixelWidth} height={pixelHeight} />
        </clipPath>
      </defs>

      {/* Zeilenweise gerenderter Text, auf Kasten-Grenzen geclippt */}
      <g className="text-content" clipPath={`url(#text-clip-${textNote.textNoteId})`}>
        {lineElements}
      </g>

      {/* 8 Resize-Anfasser für Größenänderung am Raster */}
      {!foreignLock && !isReadOnly && isSelected && isOnlySelected && (
        <g className="resize-markers">
          {RESIZE_HANDLES.map((handle) => {
            const hxPos = (pixelWidth * handle.hx) / 2;
            const hyPos = (pixelHeight * handle.hy) / 2;
            return (
              <rect
                key={handle.key}
                x={hxPos - 3.5}
                y={hyPos - 3.5}
                width={7}
                height={7}
                style={{ cursor: handle.cursor }}
                className="resize-handle"
                onPointerDown={(e) => onResizeHandlePointerDown?.(e, textNote, handle.hx, handle.hy)}
              />
            );
          })}
        </g>
      )}
    </g>
  );
})({
  cursor: "move",
  userSelect: "none",

  "&[data-foreign-locked=\"true\"]": {
    cursor: "not-allowed",
  },

  "&[data-readonly=\"true\"]:not([data-foreign-locked=\"true\"])": {
    cursor: "default",
  },

  "& > .hit-rect": {
    fill: "rgba(0, 0, 0, 0.001)",
    pointerEvents: "all",
  },

  "& .text-line": {
    fill: "var(--color-text-primary)",
    pointerEvents: "none",
  },

  "& > .soft-lock-box": {
    fill: "var(--color-warning-bg)",
    fillOpacity: 0.25,
    stroke: "var(--color-warning-border)",
    strokeWidth: 1.75,
    strokeDasharray: "4 2",
    pointerEvents: "none",
  },

  "& > .soft-lock-badge": {
    pointerEvents: "none",

    "& > .soft-lock-badge-bg": {
      fill: "var(--color-bg-elevated)",
      stroke: "var(--color-warning-border)",
      strokeWidth: 1,
    },

    "& > .soft-lock-badge-text": {
      fill: "var(--color-text-primary)",
      fontSize: "9px",
      fontWeight: 700,
      fontFamily: "var(--font-family-base)",
    },
  },

  "& > .foreign-selection-box": {
    fillOpacity: 0.12,
    strokeWidth: 1.5,
    strokeDasharray: "3 2",
    pointerEvents: "none",
  },

  "& > .foreign-selection-badge": {
    pointerEvents: "none",

    "& > .foreign-selection-badge-bg": {
      strokeWidth: 1,
    },

    "& > .foreign-selection-badge-text": {
      fontSize: "8.5px",
      fontWeight: 700,
      fontFamily: "var(--font-family-base)",
    },
  },

  "& > .ai-highlight-box": {
    fill: "var(--color-ai-highlight-fill)",
    stroke: "var(--color-ai-highlight)",
    strokeWidth: 1.5,
    strokeDasharray: "3 2",
    pointerEvents: "none",
    animation: `${AI_HIGHLIGHT_PULSE} 1.2s ease-in-out infinite`,
  },

  "& > .selection-box": {
    fill: "var(--color-accent-tint)",
    stroke: "var(--color-accent-primary)",
    strokeWidth: 1.5,
    pointerEvents: "none",
  },

  "& > .candidate-box": {
    fill: "var(--color-candidate-fill)",
    stroke: "var(--color-accent-primary-hover)",
    strokeWidth: 1.5,
    strokeDasharray: "2 2",
    pointerEvents: "none",
  },

  "& .resize-handle": {
    fill: "var(--color-bg-base)",
    stroke: "var(--color-accent-primary)",
    strokeWidth: 1.2,
  },
});

export default TextNoteView;
