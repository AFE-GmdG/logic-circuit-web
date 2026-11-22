import type WireCleanUpInfo from "./wireCleanUpInfo";

// Diagnose-Ergebnis der CleanUp-Analyse für eine Schaltungsinstanz (ungenutzte Symbole und Leitungs-Bitnutzung)
type CircuitCleanUpReport = {
  circuitId: string;
  unusedSymbolIds: Set<string>;
  wireInfoById: Map<string, WireCleanUpInfo>;
  unusedCount: number;
};

export default CircuitCleanUpReport;
