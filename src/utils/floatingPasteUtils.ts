import type BoundingBox from "../types/canvas/boundingBox";
import type FloatingMoveMeta from "../types/canvas/floatingMoveMeta";
import type FloatingMoveRubberbandWire from "../types/canvas/floatingMoveRubberbandWire";
import type FloatingPasteState from "../types/canvas/floatingPasteState";
import type GridPoint from "../types/canvas/gridPoint";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type PreparedPastePayload from "../types/circuit/preparedPastePayload";
import type RotationDirection from "../types/circuit/rotationDirection";
import type TextNote from "../types/circuit/textNote";
import type Wire from "../types/circuit/wire";

import {
  doBoundingBoxesIntersect,
  getSymbolGridBoundingBox,
  getTextNoteGridBoundingBox,
  gridPointKey,
  rotateCircuitEntities,
} from "./circuitLayout";

const MAX_SHIFT_STEPS = 16;
const PASTE_SHIFT_STEP = 2;

function doBoxesOverlapInterior(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function isPointStrictlyInsideBox(point: GridPoint, box: BoundingBox): boolean {
  return point.x > box.minX && point.x < box.maxX && point.y > box.minY && point.y < box.maxY;
}

// Berechnet die gemeinsame Grid-Bounding-Box aller schwebenden Symbole, Textnotizen und Leitungen
export function getFloatingPasteBoundingBox(payload: PreparedPastePayload): BoundingBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includeBox = (box: BoundingBox) => {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  };

  for (const entry of payload.symbols) {
    includeBox(getSymbolGridBoundingBox(entry.symbol));
  }
  for (const note of payload.textNotes) {
    includeBox(getTextNoteGridBoundingBox(note));
  }
  for (const wire of payload.wires) {
    includeBox({
      minX: Math.min(wire.x1, wire.x2),
      minY: Math.min(wire.y1, wire.y2),
      maxX: Math.max(wire.x1, wire.x2),
      maxY: Math.max(wire.y1, wire.y2),
    });
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

// Verschiebt alle schwebenden Elemente um (dx, dy) im Ganzzahl-Raster
export function translatePastePayload(
  payload: PreparedPastePayload,
  dx: number,
  dy: number,
): PreparedPastePayload {
  if (dx === 0 && dy === 0) {
    return payload;
  }

  const movedSymbols = payload.symbols.map((entry) => {
    const sym: CircuitSymbol = {
      ...entry.symbol,
      x: entry.symbol.x + dx,
      y: entry.symbol.y + dy,
      jams: entry.symbol.jams.map((jam) => ({
        ...jam,
        x: jam.x + dx,
        y: jam.y + dy,
        absolutePoint: {
          x: jam.absolutePoint.x + dx,
          y: jam.absolutePoint.y + dy,
        },
      })),
    };
    return { ...entry, symbol: sym };
  });

  const movedNotes: TextNote[] = payload.textNotes.map((note) => ({
    ...note,
    x: note.x + dx,
    y: note.y + dy,
  }));

  const movedWires: Wire[] = payload.wires.map((wire) => ({
    ...wire,
    x1: wire.x1 + dx,
    y1: wire.y1 + dy,
    x2: wire.x2 + dx,
    y2: wire.y2 + dy,
    point1: { x: wire.point1.x + dx, y: wire.point1.y + dy },
    point2: { x: wire.point2.x + dx, y: wire.point2.y + dy },
  }));

  return {
    ...payload,
    symbols: movedSymbols,
    textNotes: movedNotes,
    wires: movedWires,
  };
}

// Dreht den schwebenden Block um 90° um sein gemeinsames Zentrum
export function rotatePastePayload(
  payload: PreparedPastePayload,
  direction: RotationDirection,
): PreparedPastePayload {
  const { symbols: rotatedSymbols, textNotes: rotatedNotes, wires: rotatedWires } = rotateCircuitEntities(
    payload.symbols.map((entry) => entry.symbol),
    payload.textNotes,
    direction,
    payload.wires,
  );

  const rotatedById = new Map(rotatedSymbols.map((sym) => [sym.circuitSymbolId, sym]));
  return {
    ...payload,
    symbols: payload.symbols.map((entry) => ({
      ...entry,
      symbol: rotatedById.get(entry.symbol.circuitSymbolId) ?? entry.symbol,
    })),
    textNotes: rotatedNotes,
    wires: rotatedWires,
  };
}

// Prüft, ob schwebende Bauteile oder deren Pins direkt über vorhandenen Bauteilen landen würden
export function checkFloatingPasteOverlap(
  payload: PreparedPastePayload,
  targetCircuit: LogicalCircuit,
): {
  hasOverlapWarning: boolean;
  overlappingSymbolIds: string[];
  overlappingPoints: GridPoint[];
} {
  const existingSymbolBoxes = targetCircuit.circuitSymbols.map((sym) => ({
    symbol: sym,
    box: getSymbolGridBoundingBox(sym),
  }));

  const overlappingSymbolIdSet = new Set<string>();
  const overlappingPointMap = new Map<string, GridPoint>();

  const addPoint = (pt: GridPoint) => {
    overlappingPointMap.set(`${pt.x},${pt.y}`, pt);
  };

  for (const entry of payload.symbols) {
    const floatSym = entry.symbol;
    const floatBox = getSymbolGridBoundingBox(floatSym);

    for (const existing of existingSymbolBoxes) {
      const symbolOverlap = doBoxesOverlapInterior(floatBox, existing.box);
      if (symbolOverlap) {
        overlappingSymbolIdSet.add(floatSym.circuitSymbolId);
      }

      // Pin (Jam) eines schwebenden Bauteils landet im Inneren eines bestehenden Bauteils
      for (const floatJam of floatSym.jams) {
        if (isPointStrictlyInsideBox(floatJam.absolutePoint, existing.box)) {
          overlappingSymbolIdSet.add(floatSym.circuitSymbolId);
          addPoint(floatJam.absolutePoint);
        } else if (
          symbolOverlap &&
          existing.symbol.jams.some(
            (exJam) =>
              exJam.absolutePoint.x === floatJam.absolutePoint.x &&
              exJam.absolutePoint.y === floatJam.absolutePoint.y,
          )
        ) {
          addPoint(floatJam.absolutePoint);
        }
      }

      // Pin (Jam) eines bestehenden Bauteils würde vom Körper des schwebenden Bauteils verdeckt
      for (const existingJam of existing.symbol.jams) {
        if (isPointStrictlyInsideBox(existingJam.absolutePoint, floatBox)) {
          overlappingSymbolIdSet.add(floatSym.circuitSymbolId);
          addPoint(existingJam.absolutePoint);
        }
      }
    }
  }

  return {
    hasOverlapWarning: overlappingSymbolIdSet.size > 0 || overlappingPointMap.size > 0,
    overlappingSymbolIds: Array.from(overlappingSymbolIdSet),
    overlappingPoints: Array.from(overlappingPointMap.values()),
  };
}

function hasAnyPlacementCollision(
  payload: PreparedPastePayload,
  targetCircuit: LogicalCircuit,
): boolean {
  const symbolCheck = checkFloatingPasteOverlap(payload, targetCircuit);
  if (symbolCheck.hasOverlapWarning) {
    return true;
  }

  // Zusätzlicher NeedToShift-Check für deckungsgleiche Textnotizen und Leitungen
  for (const note of payload.textNotes) {
    if (
      targetCircuit.textNotes.some(
        (existing) => existing.x === note.x && existing.y === note.y,
      )
    ) {
      return true;
    }
  }

  for (const wire of payload.wires) {
    const sameSegment = targetCircuit.wires.some(
      (existing) =>
        (existing.x1 === wire.x1 && existing.y1 === wire.y1 && existing.x2 === wire.x2 && existing.y2 === wire.y2) ||
        (existing.x1 === wire.x2 && existing.y1 === wire.y2 && existing.x2 === wire.x1 && existing.y2 === wire.y1),
    );
    if (sameSegment) {
      return true;
    }
  }

  return false;
}

// Berechnet den initialen Raster-Versatz (+2/+2 bzw. Viewport-Zentrierung) analog zu CircuitProject.NeedToShift
export function computeInitialFloatingPasteOffset(
  payload: PreparedPastePayload,
  targetCircuit: LogicalCircuit,
  viewportBoundsGrid?: BoundingBox | null,
): GridPoint {
  const pasteBox = getFloatingPasteBoundingBox(payload);
  if (!pasteBox) {
    return { x: 0, y: 0 };
  }

  let baseDx = PASTE_SHIFT_STEP;
  let baseDy = PASTE_SHIFT_STEP;

  if (viewportBoundsGrid && !doBoundingBoxesIntersect(pasteBox, viewportBoundsGrid)) {
    const pasteCenterX = (pasteBox.minX + pasteBox.maxX) / 2;
    const pasteCenterY = (pasteBox.minY + pasteBox.maxY) / 2;
    const viewCenterX = (viewportBoundsGrid.minX + viewportBoundsGrid.maxX) / 2;
    const viewCenterY = (viewportBoundsGrid.minY + viewportBoundsGrid.maxY) / 2;
    baseDx = Math.round(viewCenterX - pasteCenterX);
    baseDy = Math.round(viewCenterY - pasteCenterY);
  }

  for (let step = 0; step <= MAX_SHIFT_STEPS; step += 1) {
    const dx = baseDx + step * PASTE_SHIFT_STEP;
    const dy = baseDy + step * PASTE_SHIFT_STEP;
    const candidate = translatePastePayload(payload, dx, dy);
    if (!hasAnyPlacementCollision(candidate, targetCircuit)) {
      return { x: dx, y: dy };
    }
  }

  return { x: baseDx, y: baseDy };
}

// Erstellt den kompletten schwebenden Paste-Zustand inklusive initialem Versatz (optional mit Oben-Links-Anker) und Überlappungsprüfung
export function createFloatingPasteState(
  payload: PreparedPastePayload,
  targetCircuit: LogicalCircuit,
  viewportBoundsGrid?: BoundingBox | null,
  anchorGridPoint?: GridPoint | null,
): FloatingPasteState {
  let offset: GridPoint;
  const pasteBox = getFloatingPasteBoundingBox(payload);
  if (anchorGridPoint && pasteBox) {
    offset = {
      x: Math.round(anchorGridPoint.x - pasteBox.minX),
      y: Math.round(anchorGridPoint.y - pasteBox.minY),
    };
  } else {
    offset = computeInitialFloatingPasteOffset(payload, targetCircuit, viewportBoundsGrid);
  }
  const shiftedPayload = translatePastePayload(payload, offset.x, offset.y);
  const overlap = checkFloatingPasteOverlap(shiftedPayload, targetCircuit);
  return {
    mode: "paste",
    payload: shiftedPayload,
    ...overlap,
  };
}

// Blendet beim schwebenden Verschieben bereits selektierte Original-Elemente aus dem Ziel-Vergleich aus
function excludeFloatingMoveEntities(
  targetCircuit: LogicalCircuit,
  meta: Pick<FloatingMoveMeta, "symbolIds" | "textNoteIds" | "wireIds">,
): LogicalCircuit {
  const symSet = new Set(meta.symbolIds);
  const noteSet = new Set(meta.textNoteIds);
  const wireSet = new Set(meta.wireIds);
  return {
    ...targetCircuit,
    circuitSymbols: targetCircuit.circuitSymbols.filter((s) => !symSet.has(s.circuitSymbolId)),
    textNotes: targetCircuit.textNotes.filter((n) => !noteSet.has(n.textNoteId)),
    wires: targetCircuit.wires.filter((w) => !wireSet.has(w.wireId)),
  };
}

// Aktiviert den Schwebemodus beim Verschieben markierter Elemente (ohne vorzeitiges Wire-Merging)
export function createFloatingMoveState(
  targetCircuit: LogicalCircuit,
  params: {
    symbolIds: string[];
    textNoteIds: string[];
    wireIds: string[];
    dx: number;
    dy: number;
    withWires?: boolean;
    initialRotation?: RotationDirection;
  },
): FloatingPasteState | null {
  const symIdSet = new Set(params.symbolIds);
  const noteIdSet = new Set(params.textNoteIds);
  const wireIdSet = new Set(params.wireIds);

  const movedSymbols = targetCircuit.circuitSymbols.filter((s) => symIdSet.has(s.circuitSymbolId));
  const movedNotes = targetCircuit.textNotes.filter((n) => noteIdSet.has(n.textNoteId));
  const movedWires = targetCircuit.wires.filter((w) => wireIdSet.has(w.wireId));

  if (movedSymbols.length === 0 && movedNotes.length === 0 && movedWires.length === 0) {
    return null;
  }

  const movedPointKeys = new Set<string>();
  for (const sym of movedSymbols) {
    for (const jam of sym.jams) {
      movedPointKeys.add(gridPointKey(jam.absolutePoint));
    }
  }
  for (const wire of movedWires) {
    movedPointKeys.add(gridPointKey(wire.point1));
    movedPointKeys.add(gridPointKey(wire.point2));
  }

  const rubberbandPreviewWires: FloatingMoveRubberbandWire[] = [];
  for (const wire of targetCircuit.wires) {
    if (wireIdSet.has(wire.wireId)) {
      continue;
    }
    const p1Key = gridPointKey(wire.point1);
    const p2Key = gridPointKey(wire.point2);
    const movePoint1 = movedPointKeys.has(p1Key);
    const movePoint2 = movedPointKeys.has(p2Key);
    if (movePoint1 || movePoint2) {
      rubberbandPreviewWires.push({
        wire,
        movePoint1,
        movePoint2,
        point1OriginKey: movePoint1 ? p1Key : null,
        point2OriginKey: movePoint2 ? p2Key : null,
      });
    }
  }

  const basePayload: PreparedPastePayload = {
    targetCircuitId: targetCircuit.logicalCircuitId,
    symbols: movedSymbols.map((symbol) => ({
      symbol,
      circuit: symbol.circuit,
    })),
    textNotes: movedNotes,
    wires: movedWires,
    importedSubCircuits: [],
    importedGates: [],
    importedPins: [],
    importedButtons: [],
    importedConstants: [],
    importedProbes: [],
    importedLedMatrices: [],
    importedSplitters: [],
    importedMemories: [],
    importedSensors: [],
    importedSounds: [],
    importedSynthesizers: [],
    importedGraphicsArrays: [],
  };

  const rotationStepDelta =
    params.initialRotation === "clockwise"
      ? 1
      : params.initialRotation === "counterClockwise"
        ? -1
        : 0;

  const meta: FloatingMoveMeta = {
    symbolIds: movedSymbols.map((s) => s.circuitSymbolId),
    textNoteIds: movedNotes.map((n) => n.textNoteId),
    wireIds: movedWires.map((w) => w.wireId),
    dx: params.dx,
    dy: params.dy,
    withWires: params.withWires !== false,
    rotationSteps: rotationStepDelta,
    lastRotationDirection: params.initialRotation,
    initialSymbols: movedSymbols,
    initialNotes: movedNotes,
    initialWires: movedWires,
    rubberbandPreviewWires,
  };

  const shiftedPayload =
    params.dx !== 0 || params.dy !== 0
      ? translatePastePayload(basePayload, params.dx, params.dy)
      : basePayload;
  const transformedPayload = params.initialRotation
    ? rotatePastePayload(shiftedPayload, params.initialRotation)
    : shiftedPayload;

  const filteredCircuit = excludeFloatingMoveEntities(targetCircuit, meta);
  const overlap = checkFloatingPasteOverlap(transformedPayload, filteredCircuit);

  return {
    mode: "move",
    payload: transformedPayload,
    ...overlap,
    moveMeta: meta,
  };
}

// Verschiebt einen aktiven Schwebeblock (Paste oder Move) um (deltaX, deltaY) inklusive Kollisionsprüfung
export function translateFloatingState(
  state: FloatingPasteState,
  deltaX: number,
  deltaY: number,
  targetCircuit: LogicalCircuit,
  options?: { withWires?: boolean },
): FloatingPasteState {
  const shiftedPayload = translatePastePayload(state.payload, deltaX, deltaY);

  if (state.mode === "move" && state.moveMeta) {
    const nextMeta: FloatingMoveMeta = {
      ...state.moveMeta,
      dx: state.moveMeta.dx + deltaX,
      dy: state.moveMeta.dy + deltaY,
      withWires: options?.withWires === false ? false : state.moveMeta.withWires,
    };
    const filteredCircuit = excludeFloatingMoveEntities(targetCircuit, nextMeta);
    const overlap = checkFloatingPasteOverlap(shiftedPayload, filteredCircuit);
    return {
      mode: "move",
      payload: shiftedPayload,
      ...overlap,
      moveMeta: nextMeta,
    };
  }

  const overlap = checkFloatingPasteOverlap(shiftedPayload, targetCircuit);
  return {
    mode: state.mode ?? "paste",
    payload: shiftedPayload,
    ...overlap,
  };
}

// Dreht einen aktiven Schwebeblock (Paste oder Move) um 90° inklusive Kollisionsprüfung
export function rotateFloatingState(
  state: FloatingPasteState,
  direction: RotationDirection,
  targetCircuit: LogicalCircuit,
  options?: { withWires?: boolean },
): FloatingPasteState {
  const rotatedPayload = rotatePastePayload(state.payload, direction);
  const stepDelta = direction === "clockwise" ? 1 : -1;

  if (state.mode === "move" && state.moveMeta) {
    const nextMeta: FloatingMoveMeta = {
      ...state.moveMeta,
      rotationSteps: state.moveMeta.rotationSteps + stepDelta,
      lastRotationDirection: direction,
      withWires: options?.withWires === false ? false : state.moveMeta.withWires,
    };
    const filteredCircuit = excludeFloatingMoveEntities(targetCircuit, nextMeta);
    const overlap = checkFloatingPasteOverlap(rotatedPayload, filteredCircuit);
    return {
      mode: "move",
      payload: rotatedPayload,
      ...overlap,
      moveMeta: nextMeta,
    };
  }

  const overlap = checkFloatingPasteOverlap(rotatedPayload, targetCircuit);
  return {
    mode: state.mode ?? "paste",
    payload: rotatedPayload,
    ...overlap,
  };
}

// Erstellt die Punkt-Migrationskarte von Ausgangs-Pins/Endpunkten zu ihrer aktuellen Schwebeposition
export function buildFloatingMovePointMigration(
  moveMeta: FloatingMoveMeta,
  payload: PreparedPastePayload,
): Map<string, GridPoint> {
  const migration = new Map<string, GridPoint>();

  for (let i = 0; i < moveMeta.initialSymbols.length; i++) {
    const oldSym = moveMeta.initialSymbols[i];
    const newSym = payload.symbols[i]?.symbol;
    if (!newSym || oldSym.jams.length !== newSym.jams.length) {
      continue;
    }
    for (let j = 0; j < oldSym.jams.length; j++) {
      migration.set(gridPointKey(oldSym.jams[j].absolutePoint), newSym.jams[j].absolutePoint);
    }
  }

  for (let i = 0; i < moveMeta.initialWires.length; i++) {
    const oldWire = moveMeta.initialWires[i];
    const newWire = payload.wires[i];
    if (!newWire) {
      continue;
    }
    migration.set(gridPointKey(oldWire.point1), newWire.point1);
    migration.set(gridPointKey(oldWire.point2), newWire.point2);
  }

  return migration;
}

// Berechnet die vorläufig gestreckten Rubberband-Leitungen während eines schwebenden Verschiebe-/Drehvorgangs
export function getRubberbandPreviewSegments(
  moveMeta?: FloatingMoveMeta,
  payload?: PreparedPastePayload,
): Wire[] {
  if (!moveMeta || !moveMeta.withWires || moveMeta.rubberbandPreviewWires.length === 0) {
    return [];
  }

  const migration = payload ? buildFloatingMovePointMigration(moveMeta, payload) : null;
  const segments: Wire[] = [];
  for (const item of moveMeta.rubberbandPreviewWires) {
    const migratedP1 =
      item.movePoint1 && item.point1OriginKey ? migration?.get(item.point1OriginKey) : undefined;
    const migratedP2 =
      item.movePoint2 && item.point2OriginKey ? migration?.get(item.point2OriginKey) : undefined;

    const x1 = migratedP1 ? migratedP1.x : item.wire.x1 + (item.movePoint1 ? moveMeta.dx : 0);
    const y1 = migratedP1 ? migratedP1.y : item.wire.y1 + (item.movePoint1 ? moveMeta.dy : 0);
    const x2 = migratedP2 ? migratedP2.x : item.wire.x2 + (item.movePoint2 ? moveMeta.dx : 0);
    const y2 = migratedP2 ? migratedP2.y : item.wire.y2 + (item.movePoint2 ? moveMeta.dy : 0);
    if (x1 === x2 && y1 === y2) {
      continue;
    }
    segments.push({
      ...item.wire,
      x1,
      y1,
      x2,
      y2,
      point1: { x: x1, y: y1 },
      point2: { x: x2, y: y2 },
    });
  }
  return segments;
}
