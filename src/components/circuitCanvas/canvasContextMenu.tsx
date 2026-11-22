import React from "react";

import { useTranslation } from "react-i18next";

import type GridPoint from "../../types/canvas/gridPoint";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type TextNote from "../../types/circuit/textNote";
import type Wire from "../../types/circuit/wire";

import i18n from "../../i18n";

import ContextMenuPopup, { type ContextMenuItem } from "./contextMenuPopup";

export type CanvasContextTarget =
  | { kind: "canvas"; gridPoint: GridPoint; screenX: number; screenY: number }
  | { kind: "symbol"; symbol: CircuitSymbol; gridPoint: GridPoint; screenX: number; screenY: number }
  | { kind: "textNote"; textNote: TextNote; gridPoint: GridPoint; screenX: number; screenY: number }
  | { kind: "wire"; wire: Wire; gridPoint: GridPoint; screenX: number; screenY: number };

export type CanvasContextMenuProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  target: CanvasContextTarget | null;
  selectedCount: number;
  canPaste: boolean;
  hasCircuitElements: boolean;
  canRotateSelection: boolean;
  onClose: () => void;
  onCut: () => void;
  onCopy: () => void;
  onCopyForDesktop?: () => void;
  onPasteAt: (gridPoint: GridPoint) => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  onRotateRight: () => void;
  onRotateLeft: () => void;
  onOpenSubCircuit: (circuitId: string) => void;
  onEditSymbol: (symbol: CircuitSymbol) => void;
  onEditTextNote: (textNote: TextNote) => void;
  onEditCurrentCircuit: () => void;
  onSelectConductor: (wireId: string) => void;
  onSplitWire: (wireId: string, splitPoint: GridPoint) => void;
};

// Ermittelt einen gültigen inneren Auftrennpunkt auf einem Leitungssegment (null an Endpunkten oder abseits des Segments)
export function resolveWireSplitPoint(wire: Wire, point: GridPoint): GridPoint | null {
  let candidate: GridPoint = point;

  if (wire.y1 === wire.y2 && wire.x1 !== wire.x2) {
    const minX = Math.min(wire.x1, wire.x2);
    const maxX = Math.max(wire.x1, wire.x2);
    if (point.x > minX && point.x < maxX && Math.abs(point.y - wire.y1) <= 1) {
      candidate = { x: point.x, y: wire.y1 };
    }
  } else if (wire.x1 === wire.x2 && wire.y1 !== wire.y2) {
    const minY = Math.min(wire.y1, wire.y2);
    const maxY = Math.max(wire.y1, wire.y2);
    if (point.y > minY && point.y < maxY && Math.abs(point.x - wire.x1) <= 1) {
      candidate = { x: wire.x1, y: point.y };
    }
  }

  if (
    (candidate.x === wire.x1 && candidate.y === wire.y1) ||
    (candidate.x === wire.x2 && candidate.y === wire.y2)
  ) {
    return null;
  }

  const dx = wire.x2 - wire.x1;
  const dy = wire.y2 - wire.y1;
  const px = candidate.x - wire.x1;
  const py = candidate.y - wire.y1;
  const cross = px * dy - py * dx;
  if (cross !== 0) {
    return null;
  }

  const dot = px * dx + py * dy;
  const lenSq = dx * dx + dy * dy;
  if (dot <= 0 || dot >= lenSq) {
    return null;
  }

  return candidate;
}

export function buildCanvasContextMenuItems({
  target,
  selectedCount,
  canPaste,
  hasCircuitElements,
  canRotateSelection,
  onCut,
  onCopy,
  onCopyForDesktop,
  onPasteAt,
  onDeleteSelected,
  onSelectAll,
  onRotateRight,
  onRotateLeft,
  onOpenSubCircuit,
  onEditSymbol,
  onEditTextNote,
  onEditCurrentCircuit,
  onSelectConductor,
  onSplitWire,
  t: translateArg,
}: Omit<CanvasContextMenuProps, "onClose"> & { t?: (key: string) => string }): ContextMenuItem[] {
  const t = translateArg ?? i18n.t.bind(i18n);

  if (!target) {
    return [];
  }

  if (target.kind === "canvas") {
    return [
      {
        id: "canvas-paste",
        label: t("canvas.contextMenu.paste"),
        shortcut: t("canvas.contextMenu.shortcutPaste"),
        disabled: !canPaste,
        tooltip: !canPaste ? t("canvas.contextMenu.emptyClipboardTooltip") : undefined,
        onSelect: () => onPasteAt(target.gridPoint),
      },
      {
        id: "canvas-select-all",
        label: t("canvas.contextMenu.selectAll"),
        shortcut: t("canvas.contextMenu.shortcutSelectAll"),
        disabled: !hasCircuitElements,
        tooltip: !hasCircuitElements ? t("canvas.contextMenu.noElementsTooltip") : undefined,
        onSelect: onSelectAll,
      },
      {
        id: "canvas-properties",
        label: t("canvas.contextMenu.properties"),
        shortcut: t("canvas.contextMenu.shortcutProperties"),
        separatorBefore: true,
        onSelect: onEditCurrentCircuit,
      },
    ];
  }

  const selectionCommonItems: ContextMenuItem[] = [
    {
      id: "ctx-cut",
      label: t("canvas.contextMenu.cut"),
      shortcut: t("canvas.contextMenu.shortcutCut"),
      onSelect: onCut,
    },
    {
      id: "ctx-copy",
      label: t("canvas.contextMenu.copy"),
      shortcut: t("canvas.contextMenu.shortcutCopy"),
      onSelect: onCopy,
    },
    ...(onCopyForDesktop
      ? [
        {
          id: "ctx-copy-desktop",
          label: t("canvas.contextMenu.copyForDesktop"),
          tooltip: t("canvas.contextMenu.copyForDesktopTooltip"),
          onSelect: onCopyForDesktop,
        },
      ]
      : []),
    {
      id: "ctx-delete",
      label: t("canvas.contextMenu.delete"),
      shortcut: t("canvas.contextMenu.shortcutDelete"),
      danger: true,
      onSelect: onDeleteSelected,
    },
  ];

  if (target.kind === "symbol") {
    const isSubCircuit = target.symbol.circuit.kind === "logicalCircuit";
    const items: ContextMenuItem[] = [
      ...selectionCommonItems,
      {
        id: "ctx-rotate-right",
        label: t("canvas.contextMenu.rotateRight"),
        shortcut: t("canvas.contextMenu.shortcutRotateRight"),
        separatorBefore: true,
        disabled: !canRotateSelection,
        onSelect: onRotateRight,
      },
      {
        id: "ctx-rotate-left",
        label: t("canvas.contextMenu.rotateLeft"),
        shortcut: t("canvas.contextMenu.shortcutRotateLeft"),
        disabled: !canRotateSelection,
        onSelect: onRotateLeft,
      },
    ];

    if (isSubCircuit && selectedCount <= 1) {
      const subCircuit = target.symbol.circuit as LogicalCircuit;
      items.push({
        id: "ctx-open-subcircuit",
        label: t("canvas.contextMenu.openSubCircuit"),
        separatorBefore: true,
        onSelect: () => onOpenSubCircuit(subCircuit.logicalCircuitId),
      });
    }

    if (selectedCount <= 1) {
      items.push({
        id: "ctx-properties",
        label: t("canvas.contextMenu.properties"),
        shortcut: t("canvas.contextMenu.shortcutProperties"),
        separatorBefore: !isSubCircuit,
        onSelect: () => onEditSymbol(target.symbol),
      });
    }

    return items;
  }

  if (target.kind === "textNote") {
    const items: ContextMenuItem[] = [...selectionCommonItems];
    if (selectedCount <= 1) {
      items.push({
        id: "ctx-properties",
        label: t("canvas.contextMenu.properties"),
        shortcut: t("canvas.contextMenu.shortcutProperties"),
        separatorBefore: true,
        onSelect: () => onEditTextNote(target.textNote),
      });
    }
    return items;
  }

  const splitPoint = resolveWireSplitPoint(target.wire, target.gridPoint);
  return [
    ...selectionCommonItems,
    {
      id: "ctx-select-conductor",
      label: t("canvas.contextMenu.selectConductor"),
      separatorBefore: true,
      onSelect: () => onSelectConductor(target.wire.wireId),
    },
    {
      id: "ctx-split-wire",
      label: t("canvas.contextMenu.splitWire"),
      disabled: splitPoint === null,
      tooltip: splitPoint === null ? t("canvas.contextMenu.splitWireTooltip") : undefined,
      onSelect: () => {
        if (splitPoint) {
          onSplitWire(target.wire.wireId, splitPoint);
        }
      },
    },
  ];
}

const CanvasContextMenu = ({
  target,
  selectedCount,
  canPaste,
  hasCircuitElements,
  canRotateSelection,
  onClose,
  onCut,
  onCopy,
  onCopyForDesktop,
  onPasteAt,
  onDeleteSelected,
  onSelectAll,
  onRotateRight,
  onRotateLeft,
  onOpenSubCircuit,
  onEditSymbol,
  onEditTextNote,
  onEditCurrentCircuit,
  onSelectConductor,
  onSplitWire,
  ...other
}: CanvasContextMenuProps) => {
  const { t } = useTranslation();
  const items = buildCanvasContextMenuItems({
    target,
    selectedCount,
    canPaste,
    hasCircuitElements,
    canRotateSelection,
    onCut,
    onCopy,
    onCopyForDesktop,
    onPasteAt,
    onDeleteSelected,
    onSelectAll,
    onRotateRight,
    onRotateLeft,
    onOpenSubCircuit,
    onEditSymbol,
    onEditTextNote,
    onEditCurrentCircuit,
    onSelectConductor,
    onSplitWire,
    t,
  });

  return (
    <ContextMenuPopup
      {...other}
      isOpen={target !== null}
      x={target?.screenX ?? 0}
      y={target?.screenY ?? 0}
      items={items}
      ariaLabel={t("canvas.contextMenu.ariaLabel")}
      onClose={onClose}
    />
  );
};

export default CanvasContextMenu;
