import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import type CircuitMap from "../../simulation/compiler/circuitMap";

import SubCircuitGlyph from "../componentPalette/subCircuitGlyph";

type RunningTreeNodeProps = React.ComponentPropsWithoutRef<"div"> & {
  map: CircuitMap;
  level: number;
  selectedMap: CircuitMap | null;
  currentCircuitId: string;
  expandedKeys: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelectMap: (map: CircuitMap) => void;
};

const RunningTreeNode = styled(({
  map,
  level,
  selectedMap,
  currentCircuitId,
  expandedKeys,
  onToggleExpand,
  onSelectMap,
  className,
  ...other
}: RunningTreeNodeProps) => {
  const { t } = useTranslation();
  const nodeKey = map.path();
  const hasChildren = map.children.size > 0;
  const isExpanded = expandedKeys.has(nodeKey);

  // Knoten ist aktiv selektiert, wenn er der visibleMap entspricht oder (falls keine Auswahl) die Wurzel der aktiven Schaltung ist
  const isSelected = selectedMap
    ? selectedMap === map
    : (map.isRoot && map.circuit.logicalCircuitId === currentCircuitId);

  const label = map.circuit.notation || map.circuit.name;
  const coordinates = map.symbol ? `(${map.symbol.x}, ${map.symbol.y})` : null;

  const handleRowClick = React.useCallback(
    () => {
      onSelectMap(map);
    },
    [map, onSelectMap],
  );

  const handleRowDoubleClick = React.useCallback(
    () => {
      onSelectMap(map);
      if (hasChildren) {
        onToggleExpand(nodeKey);
      }
    },
    [
      hasChildren,
      map,
      nodeKey,
      onSelectMap,
      onToggleExpand,
    ],
  );

  const handleChevronClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand(nodeKey);
    },
    [onToggleExpand, nodeKey],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectMap(map);
      } else if (e.key === "ArrowRight" && hasChildren && !isExpanded) {
        e.preventDefault();
        onToggleExpand(nodeKey);
      } else if (e.key === "ArrowLeft" && hasChildren && isExpanded) {
        e.preventDefault();
        onToggleExpand(nodeKey);
      }
    },
    [
      map,
      onSelectMap,
      hasChildren,
      isExpanded,
      onToggleExpand,
      nodeKey,
    ],
  );

  return (
    <div
      data-component="RunningTreeNode"
      className={`${className} tree-node-wrapper`}
      {...other}
    >
      <div
        className={`node-row ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${0.35 + level * 1.15}rem` }}
        onClick={handleRowClick}
        onDoubleClick={handleRowDoubleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        tabIndex={0}
      >
        {hasChildren ? (
          <button
            type="button"
            className="chevron-button"
            onClick={handleChevronClick}
            aria-label={
              isExpanded
                ? t("runningTree.collapseAriaLabel", { label })
                : t("runningTree.expandAriaLabel", { label })
            }
            tabIndex={-1}
          >
            <svg
              viewBox="0 0 24 24"
              className={`chevron-icon ${isExpanded ? "expanded" : ""}`}
            >
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <span className="chevron-spacer" />
        )}

        <SubCircuitGlyph name={label} className="node-glyph" />

        <span className="node-label" title={map.path()}>
          {label}
        </span>

        {coordinates && (
          <span
            className="node-coordinates"
            title={t("runningTree.coordsTooltip", { coords: coordinates })}
          >
            {coordinates}
          </span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="node-children" role="group">
          {Array.from(map.children.values()).map((childMap) => (
            <RunningTreeNode
              key={childMap.path()}
              map={childMap}
              level={level + 1}
              selectedMap={selectedMap}
              currentCircuitId={currentCircuitId}
              expandedKeys={expandedKeys}
              onToggleExpand={onToggleExpand}
              onSelectMap={onSelectMap}
            />
          ))}
        </div>
      )}
    </div>
  );
})({
  display: "flex",
  flexDirection: "column",
  width: "100%",

  "& > .node-row": {
    display: "flex",
    alignItems: "center",
    gap: "0.45rem",
    paddingTop: "0.3rem",
    paddingBottom: "0.3rem",
    paddingRight: "0.5rem",
    borderRadius: "0.3rem",
    border: "0.125rem solid transparent",
    cursor: "pointer",
    outline: "none",
    transition: "background-color 0.15s ease, border-color 0.15s ease",

    "&:hover": {
      backgroundColor: "var(--color-bg-elevated)",
    },

    "&:focus-visible": {
      borderColor: "var(--color-accent-primary)",
    },

    "&.selected": {
      borderColor: "var(--color-accent-primary)",
      backgroundColor: "var(--color-accent-primary-bg)",
    },

    "& > .chevron-button": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "1.25rem",
      height: "1.25rem",
      padding: 0,
      background: "none",
      border: "none",
      color: "var(--color-text-secondary)",
      cursor: "pointer",
      flexShrink: 0,

      "&:hover": {
        color: "var(--color-text-primary)",
      },

      "& > .chevron-icon": {
        width: "1rem",
        height: "1rem",
        transition: "transform 0.15s ease",
      },

      "& > .chevron-icon.expanded": {
        transform: "rotate(90deg)",
      },
    },

    "& > .chevron-spacer": {
      width: "1.25rem",
      height: "1.25rem",
      flexShrink: 0,
    },

    "& > .node-glyph": {
      width: "1.35rem",
      height: "1.35rem",
      flexShrink: 0,
    },

    "& > .node-label": {
      fontSize: "0.875rem",
      fontWeight: 500,
      color: "var(--color-text-primary)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      flex: "1 1 auto",
    },

    "& > .node-coordinates": {
      fontSize: "0.75rem",
      fontFamily: "var(--font-family-mono)",
      color: "var(--color-text-muted)",
      marginLeft: "auto",
      flexShrink: 0,
    },
  },

  "& > .node-children": {
    display: "flex",
    flexDirection: "column",
    width: "100%",
  },
});

export default RunningTreeNode;
