import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Project from "../types/circuit/project";
import type { NativeLogicalCircuit } from "../types/storage/nativeProjectFormat";

import { buildCircuitProjectFromNativeCircuits } from "./storage/nativeProjectReader";

const PREVIEW_PROJECT_META: Project = {
  projectId: "preview-library",
  name: "Library Preview",
  note: "",
  zoom: 1,
  frequency: 1,
  isMaximumSpeed: false,
  logicalCircuitId: "",
  categoryTextNoteCollapsed: false,
  categoryInputOutputCollapsed: false,
  categoryPrimitivesCollapsed: false,
};

const hydratedNativeCircuitsCache = new WeakMap<
  readonly NativeLogicalCircuit[],
  Map<string, LogicalCircuit>
>();

// Hydriert native Bibliotheksschaltungen mit vollständigen Layout-, Pin- und Display-Daten für Vorschauen
export function getHydratedNativeCircuitsMap(
  nativeCircuits: readonly NativeLogicalCircuit[],
): Map<string, LogicalCircuit> {
  if (nativeCircuits.length === 0) {
    return new Map();
  }

  const cached = hydratedNativeCircuitsCache.get(nativeCircuits);
  if (cached) {
    return cached;
  }

  const result = new Map<string, LogicalCircuit>();
  try {
    const hydratedProject = buildCircuitProjectFromNativeCircuits(
      PREVIEW_PROJECT_META,
      [],
      [...nativeCircuits],
    );
    for (const lc of hydratedProject.logicalCircuits) {
      result.set(lc.logicalCircuitId, lc);
    }
  } catch {
    return result;
  }

  hydratedNativeCircuitsCache.set(nativeCircuits, result);
  return result;
}
