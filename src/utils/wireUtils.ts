import type CanvasPoint from "../types/canvas/canvasPoint";
import type GridPoint from "../types/canvas/gridPoint";
import type CircuitProject from "../types/circuit/circuitProject";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type Conductor from "../types/circuit/conductor";
import type ConductorMap from "../types/circuit/conductorMap";
import type Gate from "../types/circuit/gate";
import type Jam from "../types/circuit/jam";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Wire from "../types/circuit/wire";
import type WireErrorIndicator from "../types/circuit/wireErrorIndicator";
import type State from "../types/simulation/state";
import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../types/simulation/state";
import type WireCleanUpInfo from "../types/simulation/wireCleanUpInfo";

import i18n from "../i18n";

import { buildConductorMap, gridPointKey, syncProjectLogicalCircuits } from "./circuitLayout";
import { GRID_SIZE } from "./coordinateSystem";

// Fangradius um einen Pin oder Leitungsendpunkt in Canvas-Pixeln (analog zu EditorDiagram.IsPinClose)
export const PIN_CLICK_RADIUS_PX = 7.5;

// Klick-Toleranz für Leitungssegmente in Canvas-Pixeln (analog zu EditorDiagram.ClickProximity = 6)
export const WIRE_CLICK_TOLERANCE_PX = 6;

// Erzeugt ein neues Wire-Objekt zwischen zwei Rasterpunkten
export function createWire(
  logicalCircuitId: string,
  point1: GridPoint,
  point2: GridPoint,
  wireId = `wire-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  markedBad = false,
): Wire {
  return {
    wireId,
    logicalCircuitId,
    x1: point1.x,
    y1: point1.y,
    x2: point2.x,
    y2: point2.y,
    point1: { x: point1.x, y: point1.y },
    point2: { x: point2.x, y: point2.y },
    markedBad,
  };
}

// Aktualisiert die Koordinaten eines bestehenden Wire-Objekts konsistent mit point1 und point2
export function updateWireEndpoints(
  wire: Wire,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Wire {
  return {
    ...wire,
    x1,
    y1,
    x2,
    y2,
    point1: { x: x1, y: y1 },
    point2: { x: x2, y: y2 },
  };
}

// Prüft, ob ein bestehendes Wire-Segment bereits exakt dieselben beiden Endpunkte verbindet
export function isSameWireSegment(
  wire: { x1: number; y1: number; x2: number; y2: number },
  p1: GridPoint,
  p2: GridPoint,
): boolean {
  return (
    (wire.x1 === p1.x && wire.y1 === p1.y && wire.x2 === p2.x && wire.y2 === p2.y) ||
    (wire.x1 === p2.x && wire.y1 === p2.y && wire.x2 === p1.x && wire.y2 === p1.y)
  );
}

// Berechnet das Quadrat des kürzesten Abstands eines Punktes (px, py) zu einem Liniensegment (x1, y1)-(x2, y2)
export function distanceToSegmentSquared(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    const dpx = px - x1;
    const dpy = py - y1;
    return dpx * dpx + dpy * dpy;
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const distX = px - projX;
  const distY = py - projY;
  return distX * distX + distY * distY;
}

// Prüft, ob ein Canvas-Punkt nahe genug an einem Rasterpunkt liegt (analog zu EditorDiagram.IsPinClose)
export function isPointNearGridPoint(
  canvasPoint: CanvasPoint,
  gridPoint: GridPoint,
  radiusPx = PIN_CLICK_RADIUS_PX,
): boolean {
  const gx = gridPoint.x * GRID_SIZE;
  const gy = gridPoint.y * GRID_SIZE;
  const dx = canvasPoint.x - gx;
  const dy = canvasPoint.y - gy;
  return dx * dx + dy * dy <= radiusPx * radiusPx;
}

// Findet einen Bauteil-Pin (Jam) exakt an einem gegebenen Rasterpunkt (analog zu EditorDiagram.JamAt)
export function findJamAt(
  gridPoint: GridPoint,
  symbols: CircuitSymbol[],
): { symbol: CircuitSymbol; jam: Jam } | null {
  for (const symbol of symbols) {
    for (const jam of symbol.jams) {
      if (jam.absolutePoint.x === gridPoint.x && jam.absolutePoint.y === gridPoint.y) {
        return { symbol, jam };
      }
    }
  }
  return null;
}

// Findet einen Bauteil-Pin (Jam) in der Nähe eines Canvas-Punktes (analog zu EditorDiagram.JamNear)
export function findJamNear(
  canvasPoint: CanvasPoint,
  symbols: CircuitSymbol[],
  radiusPx = PIN_CLICK_RADIUS_PX,
): { symbol: CircuitSymbol; jam: Jam } | null {
  let bestMatch: { symbol: CircuitSymbol; jam: Jam } | null = null;
  let bestDistSq = radiusPx * radiusPx;

  for (const symbol of symbols) {
    for (const jam of symbol.jams) {
      const gx = jam.absolutePoint.x * GRID_SIZE;
      const gy = jam.absolutePoint.y * GRID_SIZE;
      const dx = canvasPoint.x - gx;
      const dy = canvasPoint.y - gy;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        bestMatch = { symbol, jam };
      }
    }
  }

  return bestMatch;
}

// Findet das nächstgelegene Wire-Segment innerhalb der Klick-Toleranz (analog zu EditorDiagram.FindWireNear)
export function findWireNear(
  canvasPoint: CanvasPoint,
  wires: Wire[],
  tolerancePx = WIRE_CLICK_TOLERANCE_PX,
): Wire | null {
  let bestWire: Wire | null = null;
  let bestDistSq = tolerancePx * tolerancePx;

  for (const wire of wires) {
    const x1 = wire.x1 * GRID_SIZE;
    const y1 = wire.y1 * GRID_SIZE;
    const x2 = wire.x2 * GRID_SIZE;
    const y2 = wire.y2 * GRID_SIZE;
    const distSq = distanceToSegmentSquared(canvasPoint.x, canvasPoint.y, x1, y1, x2, y2);
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      bestWire = wire;
    }
  }

  return bestWire;
}

// Findet einen Leitungsendpunkt (point1 oder point2) in der Nähe des Canvas-Punktes
export function findWireEndpointNear(
  canvasPoint: CanvasPoint,
  wires: Wire[],
  radiusPx = PIN_CLICK_RADIUS_PX,
): { wire: Wire; endpoint: 1 | 2; point: GridPoint } | null {
  let best: { wire: Wire; endpoint: 1 | 2; point: GridPoint } | null = null;
  let bestDistSq = radiusPx * radiusPx;

  for (const wire of wires) {
    const d1x = canvasPoint.x - wire.x1 * GRID_SIZE;
    const d1y = canvasPoint.y - wire.y1 * GRID_SIZE;
    const dist1Sq = d1x * d1x + d1y * d1y;
    if (dist1Sq <= bestDistSq) {
      bestDistSq = dist1Sq;
      best = { wire, endpoint: 1, point: wire.point1 };
    }

    const d2x = canvasPoint.x - wire.x2 * GRID_SIZE;
    const d2y = canvasPoint.y - wire.y2 * GRID_SIZE;
    const dist2Sq = d2x * d2x + d2y * d2y;
    if (dist2Sq <= bestDistSq) {
      bestDistSq = dist2Sq;
      best = { wire, endpoint: 2, point: wire.point2 };
    }
  }

  return best;
}

function resolveColorLabel(color: string): string {
  switch (color) {
    case "green":
      return i18n.t("common.colorsLower.green");
    case "blue":
      return i18n.t("common.colorsLower.blue");
    case "yellow":
      return i18n.t("common.colorsLower.yellow");
    case "red":
    default:
      return i18n.t("common.colorsLower.red");
  }
}

// Formatiert den Pin-Tooltip beim Hovern über einen Jam (Name, Richtung, Bitbreite, Splitter-Bitbereich, Notiz)
export function formatJamTooltip(symbol: CircuitSymbol, jam: Jam): string {
  const pin = jam.pin;
  const noteSuffix = pin.note?.trim() ? `\n${pin.note.trim()}` : "";
  const bitText = i18n.t("wire.jamTooltip.bitWidth", { count: pin.bitWidth });

  if (symbol.circuit.kind === "splitter") {
    if (pin.name === "Bus") {
      const rangeText = pin.bitWidth === 1
        ? i18n.t("wire.jamTooltip.bitSingle", { bit: 0 })
        : i18n.t("wire.jamTooltip.bitRange", { range: `0–${pin.bitWidth - 1}` });
      return `${i18n.t("wire.jamTooltip.bus", { range: rangeText, bitText })}${noteSuffix}`;
    }
    const rangeLabel = pin.bitWidth === 1
      ? i18n.t("wire.jamTooltip.bitSingle", { bit: pin.name })
      : i18n.t("wire.jamTooltip.bitRange", { range: pin.name.replace("-", "–") });
    return `${i18n.t("wire.jamTooltip.splitterPin", {
      name: pin.name,
      range: rangeLabel,
      bitText,
    })}${noteSuffix}`;
  }

  if (symbol.circuit.kind === "circuitProbe") {
    return `${i18n.t("wire.jamTooltip.probe", { name: symbol.circuit.name })}${noteSuffix}`;
  }

  if (symbol.circuit.kind === "gate") {
    const gate = symbol.circuit as Gate;
    if (gate.gateType === "led") {
      const color = resolveColorLabel(gate.color || "red");
      if (gate.inputCount === 8) {
        return `${i18n.t("wire.jamTooltip.sevenSegmentInput", { pinName: pin.name, color })}${noteSuffix}`;
      }
      return `${i18n.t("wire.jamTooltip.led", { color })}${noteSuffix}`;
    }
  }

  const pinDisplayName = pin.name || symbol.circuit.name;

  if (jam.effectivePinType === "input" || pin.pinType === "input") {
    return `${i18n.t("wire.jamTooltip.input", { name: pinDisplayName, bitText })}${noteSuffix}`;
  }
  if (jam.effectivePinType === "output" || pin.pinType === "output") {
    return `${i18n.t("wire.jamTooltip.output", { name: pinDisplayName, bitText })}${noteSuffix}`;
  }
  return `${i18n.t("wire.jamTooltip.connection", { name: pinDisplayName, bitText })}${noteSuffix}`;
}

// Ermittelt alle Wires des Conductors, zu dem das angegebene Wire gehört (analog zu EditorDiagram.SelectConductor)
export function getConductorWiresForWire(wire: Wire, conductorMap?: ConductorMap): Wire[] {
  if (!conductorMap) {
    return [wire];
  }
  const key = gridPointKey(wire.point1);
  const conductor: Conductor | undefined = conductorMap.byPointKey.get(key);
  if (!conductor) {
    return [wire];
  }
  return conductor.wires;
}

// Prüft, ob ein Jam ein aktiv treibender Ausgang ist (mit Ausnahme von In/Out-Pins und Subcircuit-Pins, die über Ebenen hinweg kommunizieren)
function isDrivingOutputJam(symbol: CircuitSymbol, jam: Jam): boolean {
  if (symbol.circuit.kind === "pin" || symbol.circuit.kind === "logicalCircuit") {
    return false;
  }
  if (jam.effectivePinType === "none") {
    return false;
  }
  return jam.effectivePinType === "output" || jam.pin.pinType === "output";
}

// Prüft, ob ein treibender Ausgang zu einem Tri-State-Treiber gehört (Tri-State-Ausgänge dürfen sich einen Bus teilen)
function isTriStateOutputJam(symbol: CircuitSymbol): boolean {
  if (symbol.circuit.kind !== "gate") {
    return false;
  }
  const gateType = (symbol.circuit as { gateType?: string }).gateType;
  return gateType === "triState1" || gateType === "triState2";
}

// Prüft alle Conductors einer Schaltung auf Bitbreiten-Konflikte sowie Mehrfach-Ausgänge (Kurzschluss)
// und erzeugt rote Fehler-Indikatoren direkt an den Konflikt-Pins
export function validateCircuitWires(
  symbols: CircuitSymbol[],
  wires: Wire[],
  existingConductorMap?: ConductorMap,
): {
  wires: Wire[];
  conductorMap: ConductorMap;
  errorIndicators: WireErrorIndicator[];
  badPointKeys: Set<string>;
} {
  // Zuerst alle Jams der Schaltung nach ihrem Rasterpunkt indizieren
  const jamsByPointKey = new Map<string, { symbol: CircuitSymbol; jam: Jam }[]>();
  for (const symbol of symbols) {
    for (const jam of symbol.jams) {
      const key = gridPointKey(jam.absolutePoint);
      const list = jamsByPointKey.get(key);
      if (list) {
        list.push({ symbol, jam });
      } else {
        jamsByPointKey.set(key, [{ symbol, jam }]);
      }
    }
  }

  const baseMap = existingConductorMap ?? buildConductorMap(wires, 3);
  const badWireIds = new Set<string>();
  const badPointKeys = new Set<string>();
  const indicatorsByKey = new Map<string, WireErrorIndicator>();

  for (const conductor of baseMap.conductors) {
    const connectedAllJams: { symbol: CircuitSymbol; jam: Jam }[] = [];
    const connectedNonProbeJams: { symbol: CircuitSymbol; jam: Jam }[] = [];
    for (const pt of conductor.points) {
      const key = gridPointKey(pt);
      const jamsAtPoint = jamsByPointKey.get(key);
      if (jamsAtPoint) {
        for (const item of jamsAtPoint) {
          connectedAllJams.push(item);
          // Analog zu WireValidator.cs Zeile 70: CircuitProbe akzeptiert jede Bitbreite
          if (item.symbol.circuit.kind !== "circuitProbe") {
            connectedNonProbeJams.push(item);
          }
        }
      }
    }

    const distinctBitWidths = Array.from(
      new Set(connectedNonProbeJams.map((item) => item.jam.pin.bitWidth)),
    ).sort((a, b) => a - b);

    const hasBitWidthConflict = distinctBitWidths.length > 1;

    // Mehrfach-Ausgang-Prüfung (z.B. 2 Buttons, Button + Clock, 2 Gatter-Ausgänge auf demselben Conductor;
    // Ausnahme: In/Out-Pins kommunizieren über mehrere Ebenen und reine Tri-State-Gruppen teilen sich einen Bus)
    const drivingOutputs = connectedAllJams.filter(({ symbol, jam }) =>
      isDrivingOutputJam(symbol, jam),
    );
    const hasMultipleOutputsConflict =
      drivingOutputs.length > 1 &&
      !drivingOutputs.every(({ symbol }) => isTriStateOutputJam(symbol));

    if (hasBitWidthConflict || hasMultipleOutputsConflict) {
      // Dieser Conductor ist fehlerhaft -> gesamten Conductor rot markieren
      for (const w of conductor.wires) {
        badWireIds.add(w.wireId);
      }
      for (const pt of conductor.points) {
        badPointKeys.add(gridPointKey(pt));
      }
    }

    if (hasBitWidthConflict) {
      // Roten Fehler-Indikatorkreis direkt an jedem konfligierenden Pin-Anschlusspunkt erzeugen
      const bitWidthsLabel = distinctBitWidths
        .map((bw) => i18n.t("wire.jamTooltip.bitWidth", { count: bw }))
        .join(" ↔ ");
      for (const { symbol, jam } of connectedNonProbeJams) {
        const pinLabel = jam.pin.name || symbol.circuit.name;
        const indicatorKey = `${symbol.circuitSymbolId}:${jam.pin.pinId}`;
        indicatorsByKey.set(indicatorKey, {
          point: { x: jam.absolutePoint.x, y: jam.absolutePoint.y },
          symbolId: symbol.circuitSymbolId,
          pinId: jam.pin.pinId,
          pinName: pinLabel,
          pinBitWidth: jam.pin.bitWidth,
          conflictingBitWidths: distinctBitWidths,
          errorKind: "bitWidthMismatch",
          tooltip: i18n.t("wire.validation.bitWidthConflict", {
            pinLabel,
            bitText: i18n.t("wire.jamTooltip.bitWidth", { count: jam.pin.bitWidth }),
            widthsSummary: bitWidthsLabel,
          }),
        });
      }
    }

    if (hasMultipleOutputsConflict) {
      const driverLabels = drivingOutputs.map(
        ({ symbol, jam }) => symbol.circuit.notation || symbol.circuit.name || jam.pin.name,
      );
      const driversSummary = driverLabels.join(", ");
      for (const { symbol, jam } of drivingOutputs) {
        const pinLabel = jam.pin.name || symbol.circuit.name;
        const componentLabel = symbol.circuit.notation || symbol.circuit.name;
        const multiOutTooltip = i18n.t("wire.validation.multipleOutputs", {
          count: drivingOutputs.length,
          component: componentLabel,
          pinLabel,
          drivers: driversSummary,
        });
        const indicatorKey = `${symbol.circuitSymbolId}:${jam.pin.pinId}`;
        const existing = indicatorsByKey.get(indicatorKey);
        if (existing) {
          indicatorsByKey.set(indicatorKey, {
            ...existing,
            errorKind: "both",
            tooltip: `${existing.tooltip}\n${multiOutTooltip}`,
          });
        } else {
          indicatorsByKey.set(indicatorKey, {
            point: { x: jam.absolutePoint.x, y: jam.absolutePoint.y },
            symbolId: symbol.circuitSymbolId,
            pinId: jam.pin.pinId,
            pinName: pinLabel,
            pinBitWidth: jam.pin.bitWidth,
            conflictingBitWidths: distinctBitWidths,
            errorKind: "multipleOutputs",
            tooltip: multiOutTooltip,
          });
        }
      }
    }
  }

  const errorIndicators = Array.from(indicatorsByKey.values());

  const updatedWires = wires.map((w) => {
    const shouldMarkBad = badWireIds.has(w.wireId);
    if (w.markedBad === shouldMarkBad) {
      return w;
    }
    return {
      ...w,
      markedBad: shouldMarkBad,
    };
  });

  const finalConductorMap = buildConductorMap(updatedWires, 3);

  return {
    wires: updatedWires,
    conductorMap: finalConductorMap,
    errorIndicators,
    badPointKeys,
  };
}

// Aktualisiert ConductorMap und markedBad-Status für eine LogicalCircuit-Instanz
export function recalculateLogicalCircuitWires(logicalCircuit: LogicalCircuit): LogicalCircuit {
  const { wires, conductorMap } = validateCircuitWires(
    logicalCircuit.circuitSymbols,
    logicalCircuit.wires,
  );
  return {
    ...logicalCircuit,
    wires,
    conductorMap,
  };
}

// Aktualisiert ConductorMap und markedBad-Status für alle LogicalCircuits eines Projekts
export function recalculateProjectWires(project: CircuitProject): CircuitProject {
  const syncedProject = syncProjectLogicalCircuits(project);
  const updatedLogicalCircuits = syncedProject.logicalCircuits.map(recalculateLogicalCircuitWires);
  const wiresById = new Map<string, Wire>();
  for (const lc of updatedLogicalCircuits) {
    for (const w of lc.wires) {
      wiresById.set(w.wireId, w);
    }
  }

  const updatedProjectWires = syncedProject.wires.map((w) => wiresById.get(w.wireId) ?? w);

  return {
    ...syncedProject,
    wires: updatedProjectWires,
    logicalCircuits: updatedLogicalCircuits,
  };
}

// Formatiert Signalzustände für Tooltips im Simulationsmodus (1-Bit Pegel oder Multi-Bit Hex & Nibble-Binärdarstellung)
export function formatSignalTooltip(stateIndices: (number | null)[], stateArray: Uint8Array): string {
  if (stateIndices.length === 0) {
    return "";
  }

  const bitWidth = stateIndices.length;
  const states = stateIndices.map((idx) =>
    idx === null || idx === undefined ? STATE_OFF : (stateArray[idx] as State),
  );

  // Einzelbit-Signal
  if (bitWidth === 1) {
    const s = states[0];
    if (s === STATE_ON1) {
      return "1 (High)";
    }
    if (s === STATE_ON0) {
      return "0 (Low)";
    }
    return "x (Tri-State)";
  }

  // Multi-Bit Signal: Bit 0 = LSB, Bit bitWidth-1 = MSB
  let hasOff = false;
  let numericValue = 0;
  const bitChars: string[] = [];

  for (let i = bitWidth - 1; i >= 0; i--) {
    const s = states[i];
    if (s === STATE_ON1) {
      bitChars.push("1");
      numericValue = numericValue * 2 + 1;
    } else if (s === STATE_ON0) {
      bitChars.push("0");
      numericValue = numericValue * 2;
    } else {
      bitChars.push("x");
      hasOff = true;
    }
  }

  // 4er-Gruppierung (Nibbles) von LSB nach MSB
  const groupedBits: string[] = [];
  for (let i = 0; i < bitChars.length; i++) {
    const remaining = bitChars.length - i;
    groupedBits.push(bitChars[i]);
    if (remaining > 1 && remaining % 4 === 1) {
      groupedBits.push(" ");
    }
  }
  const bitString = groupedBits.join("");
  const hexString = hasOff ? "0x?" : `0x${numericValue.toString(16)}`;

  return `${bitWidth}-Bit: ${hexString}\n${bitString}`;
}

// Erzeugt einen optionalen CleanUp-Diagnosehinweis für ungenutzte Leitungen oder teilgenutzte Multi-Bit-Busse
export function formatWireCleanUpTooltip(info: WireCleanUpInfo | undefined): string {
  if (!info) {
    return "";
  }
  if (!info.isUsed) {
    return i18n.t("wire.cleanUp.unused");
  }
  if (info.isPartiallyUsed) {
    return i18n.t("wire.cleanUp.partiallyUsed", { used: info.usedBits, count: info.bitWidth });
  }
  return "";
}
