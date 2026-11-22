import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type DisplayMargin from "../../types/circuit/displayMargin";
import type Gate from "../../types/circuit/gate";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";

import i18n from "../../i18n";

import { circuitContainsDisplays } from "../circuitLayout";

export type DesktopExportWarningCategory = "pin-layout-shift" | "unsupported-component";

export type DesktopExportWarningCode =
  | "display-margin-pin-shift"
  | "resized-probe-pin-shift"
  | "resized-constant-pin-shift"
  | "resized-pin-pin-shift"
  | "unsupported-button-dimensions"
  | "unsupported-led-matrix-dimensions"
  | "unsupported-component-kind"
  | "unsupported-gate-type"
  | "unsupported-gate-inputs";

export type DesktopExportWarning = {
  code: DesktopExportWarningCode;
  category: DesktopExportWarningCategory;
  circuitName: string;
  message: string;
};

export type DesktopExportCompatibilityReport = {
  hasWarnings: boolean;
  warnings: DesktopExportWarning[];
};

const DESKTOP_SUPPORTED_CIRCUIT_KINDS: ReadonlySet<string> = new Set([
  "logicalCircuit",
  "gate",
  "pin",
  "circuitProbe",
  "constant",
  "circuitButton",
  "memory",
  "ledMatrix",
  "splitter",
  "sensor",
  "sound",
  "graphicsArray",
]);

const DESKTOP_SUPPORTED_GATE_TYPES: ReadonlySet<string> = new Set([
  "nop",
  "clock",
  "not",
  "or",
  "and",
  "xor",
  "led",
  "triState1",
  "triState2",
]);

function formatDisplayMarginLabel(margin: DisplayMargin): string {
  switch (margin) {
    case "horizontal":
      return i18n.t("common.displayMargins.horizontal");
    case "vertical":
      return i18n.t("common.displayMargins.vertical");
    case "all":
      return i18n.t("common.displayMargins.all");
    case "none":
      return i18n.t("common.displayMargins.none");
  }
}

function buildSubCircuitUsageMap(project: CircuitProject): Map<string, string[]> {
  const usageMap = new Map<string, string[]>();
  for (const parentCircuit of project.logicalCircuits) {
    for (const sym of parentCircuit.circuitSymbols) {
      if (sym.circuit.kind !== "logicalCircuit") {
        continue;
      }
      const subId = (sym.circuit as LogicalCircuit).logicalCircuitId ?? sym.circuitId;
      const list = usageMap.get(subId) ?? [];
      if (!list.includes(parentCircuit.name)) {
        list.push(parentCircuit.name);
        usageMap.set(subId, list);
      }
    }
  }
  return usageMap;
}

function checkGateSymbol(
  lc: LogicalCircuit,
  gate: Gate,
  warnings: DesktopExportWarning[],
): void {
  if (!DESKTOP_SUPPORTED_GATE_TYPES.has(gate.gateType)) {
    warnings.push({
      code: "unsupported-gate-type",
      category: "unsupported-component",
      circuitName: lc.name,
      message: i18n.t("errors.desktopExport.unsupportedGateType", {
        circuitName: lc.name,
        gateType: gate.gateType,
      }),
    });
    return;
  }

  // LED-Farbe wird bewusst ignoriert, da Desktop lediglich rot darstellt und die Schaltungsfunktion erhalten bleibt
  if (gate.gateType === "led") {
    if (gate.inputCount !== 1 && gate.inputCount !== 8) {
      warnings.push({
        code: "unsupported-gate-inputs",
        category: "unsupported-component",
        circuitName: lc.name,
        message: i18n.t("errors.desktopExport.unsupportedLedInputs", {
          circuitName: lc.name,
          count: gate.inputCount,
        }),
      });
    }
    return;
  }

  if (
    (gate.gateType === "and" || gate.gateType === "or" || gate.gateType === "xor") &&
    (gate.inputCount < 2 || gate.inputCount > 18)
  ) {
    warnings.push({
      code: "unsupported-gate-inputs",
      category: "pin-layout-shift",
      circuitName: lc.name,
      message: i18n.t("errors.desktopExport.unsupportedGateInputs", {
        circuitName: lc.name,
        gateType: gate.gateType.toUpperCase(),
        count: gate.inputCount,
      }),
    });
  }
}

function checkResizedFixedComponent(
  lc: LogicalCircuit,
  sym: CircuitSymbol,
  warnings: DesktopExportWarning[],
): boolean {
  const { symbolWidth, symbolHeight, name, kind } = sym.circuit;
  if (symbolWidth === 2 && symbolHeight === 2) {
    return false;
  }

  let cfg: { code: DesktopExportWarningCode; label: string } | undefined;
  if (kind === "circuitProbe") {
    cfg = {
      code: "resized-probe-pin-shift",
      label: i18n.t("errors.desktopExport.componentProbe", { name }),
    };
  } else if (kind === "constant") {
    cfg = {
      code: "resized-constant-pin-shift",
      label: i18n.t("errors.desktopExport.componentConstant"),
    };
  } else if (kind === "pin") {
    cfg = {
      code: "resized-pin-pin-shift",
      label: i18n.t("errors.desktopExport.componentPin", { name }),
    };
  }

  if (!cfg) {
    return false;
  }

  warnings.push({
    code: cfg.code,
    category: "pin-layout-shift",
    circuitName: lc.name,
    message: i18n.t("errors.desktopExport.resizedFixedComponent", {
      circuitName: lc.name,
      componentLabel: cfg.label,
      width: symbolWidth,
      height: symbolHeight,
    }),
  });
  return true;
}

function checkPlacedSymbol(
  lc: LogicalCircuit,
  sym: CircuitSymbol,
  warnings: DesktopExportWarning[],
): void {
  const kind = sym.circuit.kind;
  if (!kind || !DESKTOP_SUPPORTED_CIRCUIT_KINDS.has(kind)) {
    warnings.push({
      code: "unsupported-component-kind",
      category: "unsupported-component",
      circuitName: lc.name,
      message: i18n.t("errors.desktopExport.unsupportedComponentKind", {
        circuitName: lc.name,
        name: sym.circuit.name,
        kind: kind ?? i18n.t("common.unknown"),
      }),
    });
    return;
  }

  if (kind === "gate") {
    checkGateSymbol(lc, sym.circuit as Gate, warnings);
    return;
  }

  if (checkResizedFixedComponent(lc, sym, warnings)) {
    return;
  }

  if (kind === "circuitButton") {
    const button = sym.circuit as CircuitButton;
    if (button.width < 2 || button.width > 20 || button.height < 2 || button.height > 20) {
      warnings.push({
        code: "unsupported-button-dimensions",
        category: "pin-layout-shift",
        circuitName: lc.name,
        message: i18n.t("errors.desktopExport.unsupportedButtonDimensions", {
          circuitName: lc.name,
          name: button.notation || button.name,
          width: button.width,
          height: button.height,
        }),
      });
    }
    return;
  }

  if (kind === "ledMatrix") {
    const matrix = sym.circuit as LedMatrix;
    if (
      matrix.rows < 1 ||
      matrix.rows > 10 ||
      matrix.columns < 1 ||
      matrix.columns > 10 ||
      matrix.colors < 1 ||
      matrix.colors > 3
    ) {
      warnings.push({
        code: "unsupported-led-matrix-dimensions",
        category: "pin-layout-shift",
        circuitName: lc.name,
        message: i18n.t("errors.desktopExport.unsupportedLedMatrixDimensions", {
          circuitName: lc.name,
          rows: matrix.rows,
          columns: matrix.columns,
          count: matrix.colors,
        }),
      });
    }
  }
}

// Prüft vor einem .CircuitProject-Export auf Abweichungen, die Pin-Layouts verschieben oder im Desktop fehlen
export function analyzeDesktopExportCompatibility(
  project: CircuitProject,
): DesktopExportCompatibilityReport {
  const warnings: DesktopExportWarning[] = [];
  const logicalCircuitsById = new Map(
    project.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
  );
  const usedInBySubCircuitId = buildSubCircuitUsageMap(project);

  for (const lc of project.logicalCircuits) {
    const isDisplayCircuit = lc.circuitShape === "display" || lc.isDisplay;
    if (
      isDisplayCircuit &&
      lc.displayMargin &&
      lc.displayMargin !== "none" &&
      circuitContainsDisplays(lc, logicalCircuitsById)
    ) {
      const marginLabel = formatDisplayMarginLabel(lc.displayMargin);
      const usedIn = usedInBySubCircuitId.get(lc.logicalCircuitId) ?? [];
      const usageInfo = usedIn.length > 0
        ? i18n.t("errors.desktopExport.usedInSuffix", { circuits: usedIn.join(", ") })
        : "";
      warnings.push({
        code: "display-margin-pin-shift",
        category: "pin-layout-shift",
        circuitName: lc.name,
        message: i18n.t("errors.desktopExport.displayMarginPinShift", {
          circuitName: lc.name,
          usageInfo,
          marginLabel,
        }),
      });
    }

    for (const sym of lc.circuitSymbols) {
      checkPlacedSymbol(lc, sym, warnings);
    }
  }

  return {
    hasWarnings: warnings.length > 0,
    warnings,
  };
}
