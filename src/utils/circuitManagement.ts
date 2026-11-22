import type CircuitProject from "../types/circuit/circuitProject";
import type LogicalCircuit from "../types/circuit/logicalCircuit";

import i18n from "../i18n";

// Ermittelt, warum eine Schaltung nicht gelöscht werden darf, oder null falls löschbar
export const getCircuitDeletionBlockReason = (
  project: CircuitProject | null | undefined,
  circuitId: string | null | undefined,
): string | null => {
  if (!project || !circuitId) {
    return i18n.t("errors.circuitManagement.noCircuitSelected");
  }

  if (project.logicalCircuits.length <= 1) {
    return i18n.t("errors.circuitManagement.lastCircuitCannotBeDeleted");
  }

  for (const lc of project.logicalCircuits) {
    if (lc.logicalCircuitId === circuitId) {
      continue;
    }
    const isReferenced = lc.circuitSymbols.some((sym) => {
      if (sym.circuit.kind !== "logicalCircuit") {
        return false;
      }
      const sub = sym.circuit as LogicalCircuit;
      return sub.logicalCircuitId === circuitId || sub.circuitId === circuitId;
    });
    if (isReferenced) {
      return i18n.t("errors.circuitManagement.circuitStillReferenced", { name: lc.name });
    }
  }

  return null;
};
