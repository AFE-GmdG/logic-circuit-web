import React from "react";

import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type CircuitCleanUpReport from "../types/simulation/circuitCleanUpReport";

import CircuitMap from "../simulation/compiler/circuitMap";

export type UseCircuitCleanUpAnalysisOptions = {
  treatRootPinsAsBoundary?: boolean;
  debounceMs?: number;
};

// Berechnet den CleanUp-Analysebericht synchron für eine Schaltung und fängt Topologie-/Compilerfehler sicher ab
export function computeCircuitCleanUpReport(
  circuit: LogicalCircuit,
  treatRootPinsAsBoundary = false,
): CircuitCleanUpReport | null {
  try {
    const map = new CircuitMap(circuit, null, null, { treatRootPinsAsBoundary });
    map.prepareCleanUpAnalysis();
    return map.analyzeCleanUp();
  } catch {
    return null;
  }
}

// Entprellte Leichtgewichts-Analyse für den Editiermodus zur Markierung ungenutzter Bauteile und Leitungen
export default function useCircuitCleanUpAnalysis(
  circuit: LogicalCircuit | null | undefined,
  enabled: boolean,
  options?: UseCircuitCleanUpAnalysisOptions,
): CircuitCleanUpReport | null {
  const treatRootPinsAsBoundary = Boolean(options?.treatRootPinsAsBoundary);
  const debounceMs = options?.debounceMs ?? 180;
  const [report, setReport] = React.useState<CircuitCleanUpReport | null>(null);

  React.useEffect(
    () => {
      if (!enabled || !circuit) {
        setReport(null);
        return;
      }

      if (debounceMs <= 0) {
        setReport(computeCircuitCleanUpReport(circuit, treatRootPinsAsBoundary));
        return;
      }

      const timerId = window.setTimeout(
        () => {
          setReport(computeCircuitCleanUpReport(circuit, treatRootPinsAsBoundary));
        },
        debounceMs,
      );

      return () => {
        window.clearTimeout(timerId);
      };
    },
    [
      circuit,
      debounceMs,
      enabled,
      treatRootPinsAsBoundary,
    ],
  );

  return enabled && circuit ? report : null;
}
