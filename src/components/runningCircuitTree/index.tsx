import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import SimulationContext from "../../contexts/simulationContext";

import type CircuitMap from "../../simulation/compiler/circuitMap";

import RunningTreeNode from "./runningTreeNode";
import TelemetryFooter from "./telemetryFooter";

type RunningCircuitTreeProps = React.ComponentPropsWithoutRef<"aside">;

function collectAncestorPaths(map: CircuitMap | null, targetCircuitId: string, set: Set<string>): boolean {
  if (!map) {
    return false;
  }
  if (map.circuit.logicalCircuitId === targetCircuitId) {
    set.add(map.path());
    let curr = map.parent;
    while (curr) {
      set.add(curr.path());
      curr = curr.parent;
    }
    return true;
  }
  for (const child of map.children.values()) {
    if (collectAncestorPaths(child, targetCircuitId, set)) {
      set.add(map.path());
      return true;
    }
  }
  return false;
}

const RunningCircuitTree = styled(({ ...other }: RunningCircuitTreeProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const simulationContext = React.useContext(SimulationContext);

  const rootCircuitMap = simulationContext?.rootCircuitMap ?? simulationContext?.circuitMap ?? null;
  const selectedCircuitMap = simulationContext?.selectedCircuitMap ?? null;
  const selectCircuitMap = simulationContext?.selectCircuitMap;

  const currentCircuitId = circuitContext?.currentCircuitId ?? circuitContext?.currentCircuit?.logicalCircuitId ?? "";

  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (rootCircuitMap) {
      initial.add(rootCircuitMap.path());
      if (selectedCircuitMap) {
        initial.add(selectedCircuitMap.path());
        let curr = selectedCircuitMap.parent;
        while (curr) {
          initial.add(curr.path());
          curr = curr.parent;
        }
      } else if (currentCircuitId) {
        collectAncestorPaths(rootCircuitMap, currentCircuitId, initial);
      }
    }
    return initial;
  });

  // Wurzel und aktive Schaltungsinstanz standardmäßig aufklappen
  React.useEffect(
    () => {
      if (rootCircuitMap) {
        setExpandedKeys((prev) => {
          const next = new Set(prev);
          next.add(rootCircuitMap.path());

          // Vorfahren der ausgewählten Schaltungsinstanz ebenfalls aufklappen
          let curr = selectedCircuitMap?.parent;
          while (curr) {
            next.add(curr.path());
            curr = curr.parent;
          }

          return next;
        });
      }
    },
    [rootCircuitMap, selectedCircuitMap],
  );

  const toggleExpand = React.useCallback(
    (path: string) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    },
    [],
  );

  const handleSelectMap = React.useCallback(
    (map: typeof rootCircuitMap) => {
      if (map && selectCircuitMap) {
        selectCircuitMap(map);
      }
    },
    [selectCircuitMap],
  );

  return (
    <aside {...other} data-component="RunningCircuitTree">
      <div className="tree-header">
        <h2 className="tree-title">{t("runningTree.title")}</h2>
      </div>

      <div className="tree-content" role="tree">
        {rootCircuitMap ? (
          <RunningTreeNode
            map={rootCircuitMap}
            level={0}
            selectedMap={selectedCircuitMap}
            currentCircuitId={currentCircuitId}
            expandedKeys={expandedKeys}
            onToggleExpand={toggleExpand}
            onSelectMap={handleSelectMap}
          />
        ) : (
          <div className="tree-empty">{t("runningTree.empty")}</div>
        )}
      </div>

      <TelemetryFooter
        actualFrequency={simulationContext?.actualFrequency ?? 0}
        frameRateLimit={simulationContext?.frameRateLimit ?? 30}
        totalSteps={simulationContext?.totalSteps ?? 0}
        isRunning={simulationContext?.isRunning ?? false}
        isPaused={simulationContext?.isPaused ?? false}
        isOscillating={simulationContext?.isOscillating ?? false}
        onFrameRateLimitChange={simulationContext?.setFrameRateLimit}
      />
    </aside>
  );
})({
  display: "flex",
  flexDirection: "column",
  width: "21.5rem",
  minWidth: "20.5rem",
  height: "100%",
  backgroundColor: "var(--color-bg-surface)",
  borderRight: "1px solid var(--color-border-subtle)",
  overflow: "hidden",
  userSelect: "none",

  "& > .tree-header": {
    padding: "0.85rem 1rem",
    borderBottom: "1px solid var(--color-border-subtle)",
    flexShrink: 0,

    "& > .tree-title": {
      margin: 0,
      fontSize: "0.95rem",
      fontWeight: 600,
      color: "var(--color-text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.05rem",
    },
  },

  "& > .tree-content": {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 0",
    padding: "0.5rem 0.5rem",
    gap: "0.2rem",
    overflowY: "auto",

    "& > .tree-empty": {
      padding: "1rem",
      fontSize: "0.85rem",
      color: "var(--color-text-muted)",
      fontStyle: "italic",
      textAlign: "center",
    },
  },
});

export default RunningCircuitTree;
