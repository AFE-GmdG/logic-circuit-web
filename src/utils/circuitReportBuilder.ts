import type AiHighlightState from "../types/canvas/aiHighlightState";
import type GridPoint from "../types/canvas/gridPoint";
import type CircuitProject from "../types/circuit/circuitProject";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";

import i18n from "../i18n";
import CircuitMap from "../simulation/compiler/circuitMap";

export type CircuitUsageEntry = {
  parentCircuit: LogicalCircuit;
  symbolIds: string[];
  count: number;
  firstPoint: GridPoint | null;
};

export type CircuitFunctionUsageItem = {
  reportName: string;
  count: number;
};

export type CircuitReportData = {
  projectName: string;
  projectNote: string;
  targetCircuitName: string;
  circuitCount: number;
  categoryCount: number;
  symbolCount: number;
  wireCount: number;
  totalFunctions: number;
  functions: CircuitFunctionUsageItem[];
  compileError: string | null;
};

// Sammelt alle Symbole einer Schaltung dedupliziert über LogicalCircuit- und Projekt-Arrays
function collectCircuitSymbols(project: CircuitProject, circuit: LogicalCircuit): CircuitSymbol[] {
  const seen = new Map<string, CircuitSymbol>();
  for (const symbol of circuit.circuitSymbols) {
    seen.set(symbol.circuitSymbolId, symbol);
  }
  for (const symbol of project.circuitSymbols) {
    if (symbol.logicalCircuitId === circuit.logicalCircuitId && !seen.has(symbol.circuitSymbolId)) {
      seen.set(symbol.circuitSymbolId, symbol);
    }
  }
  return Array.from(seen.values());
}

// Zählt eindeutige Entitäten (Symbole oder Leitungen) über Projekt- und Schaltungslisten hinweg
function countProjectSymbols(project: CircuitProject): number {
  const ids = new Set<string>();
  for (const symbol of project.circuitSymbols) {
    ids.add(symbol.circuitSymbolId);
  }
  for (const circuit of project.logicalCircuits) {
    for (const symbol of circuit.circuitSymbols) {
      ids.add(symbol.circuitSymbolId);
    }
  }
  return ids.size;
}

function countProjectWires(project: CircuitProject): number {
  const ids = new Set<string>();
  for (const wire of project.wires) {
    ids.add(wire.wireId);
  }
  for (const circuit of project.logicalCircuits) {
    for (const wire of circuit.wires) {
      ids.add(wire.wireId);
    }
  }
  return ids.size;
}

function compareOrdinal(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

// Ermittelt alle übergeordneten LogicalCircuits, in denen targetCircuitId als Subschaltung platziert ist
export function findCircuitUsages(
  project: CircuitProject,
  targetCircuitId: string,
): CircuitUsageEntry[] {
  if (!targetCircuitId) {
    return [];
  }

  const usages: CircuitUsageEntry[] = [];
  for (const parentCircuit of project.logicalCircuits) {
    const symbols = collectCircuitSymbols(project, parentCircuit);
    const matching = symbols.filter(
      (symbol) => symbol.circuitId === targetCircuitId || symbol.circuit?.circuitId === targetCircuitId,
    );
    if (matching.length === 0) {
      continue;
    }

    const first = matching[0];
    usages.push({
      parentCircuit,
      symbolIds: matching.map((symbol) => symbol.circuitSymbolId),
      count: matching.length,
      firstPoint: first ? { x: first.x, y: first.y } : null,
    });
  }

  usages.sort((a, b) => compareOrdinal(a.parentCircuit.name, b.parentCircuit.name));
  return usages;
}

export type UsageNavigationParams = {
  entry: CircuitUsageEntry;
  isSimulating: boolean;
  currentCircuitId?: string;
  stopSimulation?: () => void | Promise<void>;
  setCurrentCircuitId?: (circuitId: string) => void;
  selectEntities?: (
    symbolIds: string[],
    textNoteIds: string[],
    additive?: boolean,
    wireIds?: string[],
  ) => void;
  highlightAiElements?: (elements: Partial<AiHighlightState>, durationMs?: number) => void;
  focusGridPoint?: (point: GridPoint, circuitId?: string) => void;
};

// Stoppt ggf. die Simulation, wechselt zur gewählten übergeordneten Schaltung und fokussiert deren Subschaltungs-Instanzen
export function navigateToCircuitUsage({
  entry,
  isSimulating,
  currentCircuitId,
  stopSimulation,
  setCurrentCircuitId,
  selectEntities,
  highlightAiElements,
  focusGridPoint,
}: UsageNavigationParams): void {
  if (isSimulating) {
    void stopSimulation?.();
  }

  if (entry.parentCircuit.logicalCircuitId !== currentCircuitId) {
    setCurrentCircuitId?.(entry.parentCircuit.logicalCircuitId);
  }

  selectEntities?.(entry.symbolIds, [], false, []);
  highlightAiElements?.({ symbolIds: entry.symbolIds });

  if (entry.firstPoint) {
    focusGridPoint?.(entry.firstPoint, entry.parentCircuit.logicalCircuitId);
  }
}

// Kompilierungs- und Strukturbericht analog zu ReportBuilder.Properties.cs / ReportBuilder.tt
export function buildCircuitReport(
  project: CircuitProject,
  targetCircuit?: LogicalCircuit | null,
): CircuitReportData {
  const resolvedTarget =
    targetCircuit ??
    project.logicalCircuits.find((c) => c.logicalCircuitId === project.project.logicalCircuitId) ??
    project.logicalCircuits[0] ??
    null;

  const categories = new Set<string>();
  for (const circuit of project.logicalCircuits) {
    const trimmed = circuit.category.trim();
    if (trimmed.length > 0) {
      categories.add(trimmed);
    }
  }

  let functions: CircuitFunctionUsageItem[] = [];
  let totalFunctions = 0;
  let compileError: string | null = null;

  if (resolvedTarget) {
    try {
      const map = new CircuitMap(resolvedTarget);
      const state = map.apply(1);
      const counts = new Map<string, number>();

      for (const fn of state.functions) {
        counts.set(fn.reportName, (counts.get(fn.reportName) ?? 0) + 1);
      }

      functions = Array.from(counts.entries())
        .map(([reportName, count]) => ({ reportName, count }))
        .sort((a, b) => compareOrdinal(a.reportName, b.reportName));

      totalFunctions = state.functions.length;
    } catch (error) {
      compileError = error instanceof Error ? error.message : String(error);
      functions = [];
      totalFunctions = 0;
    }
  }

  return {
    projectName: project.project.name,
    projectNote: project.project.note,
    targetCircuitName: resolvedTarget?.name ?? "",
    circuitCount: project.logicalCircuits.length,
    categoryCount: categories.size,
    symbolCount: countProjectSymbols(project),
    wireCount: countProjectWires(project),
    totalFunctions,
    functions,
    compileError,
  };
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// Formatiert den vollständigen Schaltungsbericht als lokalisierte Markdown-Dokumentation für die Zwischenablage
export function formatCircuitReportMarkdown(report: CircuitReportData): string {
  const lines: string[] = [];
  const projectTitle = report.projectName.trim() || i18n.t("dialog.report.untitledProject");
  lines.push(`# ${projectTitle}`);

  const trimmedNote = report.projectNote.trim();
  if (trimmedNote.length > 0) {
    lines.push("");
    lines.push(trimmedNote);
  }

  lines.push("");
  lines.push(`## ${i18n.t("dialog.report.statisticsTitle")}`);
  lines.push("");
  lines.push(`- **${i18n.t("dialog.report.circuitsLabel")}:** ${report.circuitCount}`);
  lines.push(`- **${i18n.t("dialog.report.categoriesLabel")}:** ${report.categoryCount}`);
  lines.push(`- **${i18n.t("dialog.report.symbolsLabel")}:** ${report.symbolCount}`);
  lines.push(`- **${i18n.t("dialog.report.wiresLabel")}:** ${report.wireCount}`);

  lines.push("");
  lines.push(`## ${i18n.t("dialog.report.functionsTitle", { circuitName: report.targetCircuitName })}`);
  lines.push("");

  if (report.compileError !== null) {
    lines.push(`> **${i18n.t("dialog.report.compileErrorTitle")}:** ${report.compileError}`);
  } else if (report.functions.length === 0) {
    lines.push(`_${i18n.t("dialog.report.noFunctions")}_`);
  } else {
    const fnHeader = i18n.t("dialog.report.functionColumn");
    const countHeader = i18n.t("dialog.report.countColumn");
    const totalLabel = i18n.t("dialog.report.totalRow");
    lines.push(`| ${escapeMarkdownCell(fnHeader)} | ${escapeMarkdownCell(countHeader)} |`);
    lines.push("| --- | ---: |");
    for (const item of report.functions) {
      lines.push(`| ${escapeMarkdownCell(item.reportName)} | ${item.count} |`);
    }
    lines.push(`| **${escapeMarkdownCell(totalLabel)}** | **${report.totalFunctions}** |`);
  }

  return lines.join("\n");
}
