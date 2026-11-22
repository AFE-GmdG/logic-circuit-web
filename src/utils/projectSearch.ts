import type GridPoint from "../types/canvas/gridPoint";
import type CircuitButton from "../types/circuit/circuitButton";
import type CircuitProbe from "../types/circuit/circuitProbe";
import type CircuitProject from "../types/circuit/circuitProject";
import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type Constant from "../types/circuit/constant";
import type Gate from "../types/circuit/gate";
import type GraphicsArray from "../types/circuit/graphicsArray";
import type LedMatrix from "../types/circuit/ledMatrix";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Memory from "../types/circuit/memory";
import type Pin from "../types/circuit/pin";
import type Sensor from "../types/circuit/sensor";
import type Sound from "../types/circuit/sound";
import type Splitter from "../types/circuit/splitter";
import type Synthesizer from "../types/circuit/synthesizer";
import type TextNote from "../types/circuit/textNote";
import type FindItemKind from "../types/find/findItemKind";
import type FindMatchSource from "../types/find/findMatchSource";
import type FindResult from "../types/find/findResult";
import type FindScope from "../types/find/findScope";

import { getSymbolGridBoundingBox, getTextNoteGridBoundingBox } from "./circuitLayout";

export type ProjectSearchOptions = {
  scope: FindScope;
  currentCircuitId: string;
  matchCase: boolean;
  wholeWord: boolean;
  includeNotes: boolean;
};

export type TextHighlightSegment = {
  text: string;
  matched: boolean;
};

type SearchCandidate = {
  text: string;
  source: FindMatchSource;
};

const WORD_CHAR_PATTERN = /[\p{L}\p{N}_]/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Erstellt einen sicheren, Unicode-fähigen Suchausdruck für Substring-, Groß-/Kleinschreibungs- und Ganzwortsuche
export function buildSearchRegExp(
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  globalFlag = false,
): RegExp | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  let pattern = escapeRegExp(trimmed);
  if (wholeWord) {
    const chars = Array.from(trimmed);
    const firstChar = chars[0] ?? "";
    const lastChar = chars[chars.length - 1] ?? "";
    const leftBoundary = WORD_CHAR_PATTERN.test(firstChar) ? "(?<![\\p{L}\\p{N}_])" : "";
    const rightBoundary = WORD_CHAR_PATTERN.test(lastChar) ? "(?![\\p{L}\\p{N}_])" : "";
    pattern = `${leftBoundary}${pattern}${rightBoundary}`;
  }

  const flags = `${globalFlag ? "g" : ""}${matchCase ? "" : "i"}u`;
  return new RegExp(pattern, flags);
}

// Prüft, ob ein Text dem Suchausdruck entspricht
export function matchesSearchQuery(
  text: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
): boolean {
  if (!text) {
    return false;
  }
  const regex = buildSearchRegExp(query, matchCase, wholeWord, false);
  if (!regex) {
    return false;
  }
  return regex.test(text);
}

// Zerlegt Text in normale und gefundene Segmente zur Hervorhebung im UI
export function splitHighlightSegments(
  text: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
): TextHighlightSegment[] {
  if (!text) {
    return [];
  }
  const regex = buildSearchRegExp(query, matchCase, wholeWord, true);
  if (!regex) {
    return [{ text, matched: false }];
  }

  const segments: TextHighlightSegment[] = [];
  let lastIndex = 0;
  let match = regex.exec(text);

  while (match !== null) {
    const matchText = match[0];
    if (matchText.length === 0) {
      regex.lastIndex += 1;
      match = regex.exec(text);
      continue;
    }
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        matched: false,
      });
    }
    segments.push({
      text: matchText,
      matched: true,
    });
    lastIndex = match.index + matchText.length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      matched: false,
    });
  }

  return segments.length > 0 ? segments : [{ text, matched: false }];
}

// Extrahiert einen kompakten einzeiligen Textausschnitt rund um den ersten Treffer
export function extractNoteSnippet(
  note: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  maxLen = 72,
): string {
  const normalized = note.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const regex = buildSearchRegExp(query, matchCase, wholeWord, false);
  const match = regex ? regex.exec(normalized) : null;
  if (!match || normalized.length <= maxLen) {
    return normalized.length > maxLen
      ? `${normalized.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`
      : normalized;
  }

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  const contextBudget = Math.max(8, Math.floor((maxLen - match[0].length) / 2));
  const start = Math.max(0, matchStart - contextBudget);
  let end = Math.min(normalized.length, matchEnd + contextBudget);

  if (end - start > maxLen) {
    end = start + maxLen;
  }

  let snippet = normalized.slice(start, end).trim();
  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < normalized.length) {
    snippet = `${snippet}…`;
  }
  return snippet;
}

// Ermittelt den benutzerdefinierten Namen einer Messsonde unter Ausschluss interner GUIDs und des "?"-Platzhalters
export function getProbeDisplayName(probe: CircuitProbe): string {
  const rawName = (probe.name ?? "").trim();
  const idLower = (probe.circuitProbeId ?? "").toLowerCase();
  const circuitIdLower = (probe.circuitId ?? "").toLowerCase();

  if (
    rawName !== "" &&
    rawName !== "?" &&
    rawName.toLowerCase() !== idLower &&
    rawName.toLowerCase() !== circuitIdLower
  ) {
    return rawName;
  }

  const rawNotation = (probe.notation ?? "").trim();
  const strippedNotation = rawNotation.replace(/^\?\s*\n?/, "").trim();
  if (
    strippedNotation !== "" &&
    strippedNotation !== "?" &&
    strippedNotation.toLowerCase() !== idLower &&
    strippedNotation.toLowerCase() !== circuitIdLower
  ) {
    return strippedNotation;
  }

  return "";
}

export function hasCustomProbeName(probe: CircuitProbe): boolean {
  return getProbeDisplayName(probe) !== "";
}

function getGateAliasPrefix(gate: Gate): string {
  switch (gate.gateType) {
    case "clock":
      return "Clock";
    case "not":
      return "NOT";
    case "and":
      return gate.invertedOutput ? "NAND" : "AND";
    case "or":
      return gate.invertedOutput ? "NOR" : "OR";
    case "xor":
      return gate.invertedOutput ? "XNOR" : "XOR";
    case "triState1":
    case "triState2":
      return "Tri-State";
    case "led":
      return gate.inputCount === 8 ? "7-Segment" : "LED";
    default: {
      const cleaned = (gate.name ?? "").replace(/\s+/g, "").trim();
      return cleaned || "Gate";
    }
  }
}

function getSymbolAliasPrefix(symbol: CircuitSymbol): string | null {
  const circuit = symbol.circuit;
  switch (circuit.kind) {
    case "gate":
      return getGateAliasPrefix(circuit as Gate);
    case "memory":
      return (circuit as Memory).writable ? "RAM" : "ROM";
    case "splitter":
      return "Splitter";
    case "ledMatrix":
      return "LEDMatrix";
    case "graphicsArray":
      return "GraphicsArray";
    case "constant":
      return "Constant";
    case "sensor":
      return "Sensor";
    case "sound":
      return "Sound";
    case "synthesizer":
      return "Synthesizer";
    case "circuitButton":
      return (circuit as CircuitButton).isToggle ? "Switch" : "Button";
    default:
      return null;
  }
}

function getSymbolItemKind(symbol: CircuitSymbol, pin?: Pin): FindItemKind {
  const circuit = symbol.circuit;
  switch (circuit.kind) {
    case "logicalCircuit":
      return "subCircuit";
    case "pin":
      return pin?.pinType === "output" ? "pinOut" : "pinIn";
    case "circuitProbe":
      return "probe";
    case "circuitButton":
      return "button";
    case "constant":
      return "constant";
    case "memory":
      return "memory";
    case "sensor":
      return "sensor";
    case "splitter":
      return "splitter";
    case "ledMatrix":
      return "ledMatrix";
    case "sound":
      return "sound";
    case "synthesizer":
      return "synthesizer";
    case "graphicsArray":
      return "graphicsArray";
    case "gate": {
      const gate = circuit as Gate;
      if (gate.gateType === "clock") {
        return "clock";
      }
      if (gate.gateType === "led") {
        return gate.inputCount === 8 ? "sevenSegment" : "led";
      }
      return "gate";
    }
    default:
      return "gate";
  }
}

function computeCandidateScore(
  text: string,
  source: FindMatchSource,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  isCurrentCircuit: boolean,
): number | null {
  const regex = buildSearchRegExp(query, matchCase, wholeWord, false);
  if (!regex) {
    return null;
  }
  const match = regex.exec(text);
  if (!match) {
    return null;
  }

  let sourceWeight = 0;
  switch (source) {
    case "name":
      sourceWeight = 120;
      break;
    case "notation":
      sourceWeight = 115;
      break;
    case "jamNotation":
      sourceWeight = 110;
      break;
    case "alias":
      sourceWeight = 105;
      break;
    case "textNote":
      sourceWeight = 95;
      break;
    case "category":
      sourceWeight = 80;
      break;
    case "note":
      sourceWeight = 60;
      break;
  }

  const trimmedQuery = query.trim();
  const normalizedText = matchCase ? text.trim() : text.trim().toLowerCase();
  const normalizedQuery = matchCase ? trimmedQuery : trimmedQuery.toLowerCase();

  let matchQualityWeight = 0;
  if (normalizedText === normalizedQuery) {
    matchQualityWeight = 60;
  } else if (match.index === 0) {
    matchQualityWeight = 30;
  }

  const circuitBonus = isCurrentCircuit ? 10 : 0;
  return sourceWeight + matchQualityWeight + circuitBonus;
}

function evaluateCandidates(
  candidates: readonly SearchCandidate[],
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  isCurrentCircuit: boolean,
): { source: FindMatchSource; score: number } | null {
  let best: { source: FindMatchSource; score: number } | null = null;

  for (const candidate of candidates) {
    const trimmed = candidate.text.trim();
    if (!trimmed) {
      continue;
    }
    const score = computeCandidateScore(
      trimmed,
      candidate.source,
      query,
      matchCase,
      wholeWord,
      isCurrentCircuit,
    );
    if (score !== null && (best === null || score > best.score)) {
      best = { source: candidate.source, score };
    }
  }

  return best;
}

function getSymbolCenterPoint(symbol: CircuitSymbol): GridPoint {
  const box = getSymbolGridBoundingBox(symbol);
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
}

function getTextNoteCenterPoint(textNote: TextNote): GridPoint {
  const box = getTextNoteGridBoundingBox(textNote);
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
}

function buildSymbolDescriptor(
  symbol: CircuitSymbol,
  alias: string | null,
  pinMap: Map<string, Pin>,
  includeNotes: boolean,
): {
  itemKind: FindItemKind;
  label: string;
  secondaryLabel?: string;
  noteText: string;
  candidates: SearchCandidate[];
} {
  const circuit = symbol.circuit;
  const kind = circuit.kind;

  if (kind === "circuitProbe") {
    const probe = circuit as CircuitProbe;
    const customName = getProbeDisplayName(probe);
    const candidates: SearchCandidate[] = [];
    if (customName !== "") {
      candidates.push({ text: customName, source: "name" });
    }
    const noteText = (probe.note ?? "").trim();
    if (includeNotes && noteText !== "") {
      candidates.push({ text: noteText, source: "note" });
    }
    return {
      itemKind: "probe",
      label: customName || "Probe",
      noteText,
      candidates,
    };
  }

  if (kind === "pin") {
    const pin = pinMap.get(symbol.circuitId);
    const pinName = (pin?.name ?? circuit.name ?? "").trim();
    const jamNotation = (pin?.jamNotation ?? "").trim();
    const noteText = (pin?.note ?? circuit.note ?? "").trim();
    const candidates: SearchCandidate[] = [];
    if (pinName !== "") {
      candidates.push({ text: pinName, source: "name" });
    }
    if (jamNotation !== "") {
      candidates.push({ text: jamNotation, source: "jamNotation" });
    }
    if (includeNotes && noteText !== "") {
      candidates.push({ text: noteText, source: "note" });
    }
    const label = pinName || jamNotation || "Pin";
    const secondaryLabel =
      jamNotation !== "" && jamNotation !== label ? jamNotation : undefined;

    return {
      itemKind: getSymbolItemKind(symbol, pin),
      label,
      secondaryLabel,
      noteText,
      candidates,
    };
  }

  if (kind === "logicalCircuit") {
    const sub = circuit as LogicalCircuit;
    const candidates: SearchCandidate[] = [];
    if (sub.name) {
      candidates.push({ text: sub.name, source: "name" });
    }
    if (sub.notation) {
      candidates.push({ text: sub.notation, source: "notation" });
    }
    if (sub.category) {
      candidates.push({ text: sub.category, source: "category" });
    }
    const noteText = (sub.note ?? "").trim();
    if (includeNotes && noteText !== "") {
      candidates.push({ text: noteText, source: "note" });
    }
    const label = sub.name.trim() || sub.notation.trim() || "Circuit";
    const secondaryLabel =
      sub.notation.trim() && sub.notation.trim() !== label
        ? sub.notation.trim()
        : sub.category.trim() || undefined;
    return {
      itemKind: "subCircuit",
      label,
      secondaryLabel,
      noteText,
      candidates,
    };
  }

  const candidates: SearchCandidate[] = [];
  if (alias) {
    candidates.push({ text: alias, source: "alias" });
  }
  if (circuit.name) {
    candidates.push({ text: circuit.name, source: "name" });
  }
  if (circuit.notation) {
    candidates.push({ text: circuit.notation, source: "notation" });
  }

  const noteText = (circuit.note ?? "").trim();
  if (includeNotes && noteText !== "") {
    candidates.push({ text: noteText, source: "note" });
  }

  let label = alias || circuit.name || circuit.notation || "Component";
  let secondaryLabel: string | undefined;

  if (kind === "circuitButton") {
    const button = circuit as CircuitButton;
    const customLabel = button.notation.trim() || (button.name !== "Button" ? button.name.trim() : "");
    if (customLabel) {
      label = customLabel;
      if (alias && alias !== customLabel) {
        secondaryLabel = alias;
      }
    } else if (alias) {
      label = alias;
    }
  } else if (kind === "constant") {
    const constant = circuit as Constant;
    const valueText = constant.notation.trim();
    label = valueText ? `${alias ?? "Constant"} (${valueText})` : alias ?? "Constant";
  } else if (kind === "sensor") {
    const sensor = circuit as Sensor;
    const customLabel = sensor.notation.trim();
    if (customLabel) {
      label = customLabel;
      if (alias) {
        secondaryLabel = alias;
      }
    }
  } else if (kind === "sound") {
    const sound = circuit as Sound;
    const customLabel = sound.notation.trim();
    if (customLabel) {
      label = customLabel;
      if (alias) {
        secondaryLabel = alias;
      }
    }
  } else if (kind === "synthesizer") {
    const synth = circuit as Synthesizer;
    const customLabel = synth.notation.trim();
    if (customLabel) {
      label = customLabel;
      if (alias) {
        secondaryLabel = alias;
      }
    }
  } else if (kind === "memory") {
    const memory = circuit as Memory;
    secondaryLabel = `${memory.addressBitWidth}×${memory.dataBitWidth}`;
  } else if (kind === "ledMatrix") {
    const matrix = circuit as LedMatrix;
    secondaryLabel = `${matrix.rows}×${matrix.columns}`;
  } else if (kind === "graphicsArray") {
    const ga = circuit as GraphicsArray;
    secondaryLabel = `${ga.width}×${ga.height}`;
  } else if (kind === "splitter") {
    const splitter = circuit as Splitter;
    secondaryLabel = `${splitter.bitWidth}-Bit`;
  }

  return {
    itemKind: getSymbolItemKind(symbol),
    label,
    secondaryLabel,
    noteText,
    candidates,
  };
}

function getTextNoteDisplayLabel(
  noteText: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
): { label: string; extraSnippet?: string } {
  const lines = noteText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstLine = lines[0] ?? noteText.trim();
  const matchingLine = lines.find((line) =>
    matchesSearchQuery(line, query, matchCase, wholeWord),
  );

  if (matchingLine && matchingLine !== firstLine) {
    return {
      label: firstLine,
      extraSnippet: extractNoteSnippet(matchingLine, query, matchCase, wholeWord),
    };
  }
  return {
    label: firstLine,
  };
}

// Durchsucht das gesamte Projekt oder die aktuelle Schaltung nach Schaltungen, Bauteilen, Pins, Probes und Textnotizen
export function searchProject(
  project: CircuitProject,
  rawQuery: string,
  options: ProjectSearchOptions,
): FindResult[] {
  const trimmedQuery = rawQuery.trim();
  if (!trimmedQuery) {
    return [];
  }

  const pinMap = new Map<string, Pin>();
  for (const pin of project.pins) {
    pinMap.set(pin.pinId, pin);
  }

  const targetCircuits =
    options.scope === "current"
      ? project.logicalCircuits.filter((lc) => lc.logicalCircuitId === options.currentCircuitId)
      : project.logicalCircuits;

  const indexedResults: Array<{ result: FindResult; order: number }> = [];
  let orderCounter = 0;

  for (const circuit of targetCircuits) {
    const isCurrentCircuit = circuit.logicalCircuitId === options.currentCircuitId;

    if (options.scope === "project") {
      const circuitNote = (circuit.note ?? "").trim();
      const circuitCandidates: SearchCandidate[] = [];
      if (circuit.name) {
        circuitCandidates.push({ text: circuit.name, source: "name" });
      }
      if (circuit.notation) {
        circuitCandidates.push({ text: circuit.notation, source: "notation" });
      }
      if (circuit.category) {
        circuitCandidates.push({ text: circuit.category, source: "category" });
      }
      if (options.includeNotes && circuitNote !== "") {
        circuitCandidates.push({ text: circuitNote, source: "note" });
      }

      const circuitMatch = evaluateCandidates(
        circuitCandidates,
        trimmedQuery,
        options.matchCase,
        options.wholeWord,
        isCurrentCircuit,
      );

      if (circuitMatch) {
        const matchedNoteSnippet =
          options.includeNotes &&
          circuitNote !== "" &&
          matchesSearchQuery(circuitNote, trimmedQuery, options.matchCase, options.wholeWord)
            ? extractNoteSnippet(circuitNote, trimmedQuery, options.matchCase, options.wholeWord)
            : undefined;

        indexedResults.push({
          order: orderCounter++,
          result: {
            id: `circuit:${circuit.logicalCircuitId}`,
            entityType: "circuit",
            itemKind: "circuit",
            circuitId: circuit.logicalCircuitId,
            circuitName: circuit.name,
            label: circuit.name,
            secondaryLabel: circuit.category.trim() || undefined,
            matchedNoteSnippet,
            matchSource: circuitMatch.source,
            score: circuitMatch.score + 5,
          },
        });
      }
    }

    // Deterministische 1-basierte Bauteilnummerierung pro Schaltung unabhängig vom Suchbegriff
    const aliasCounters = new Map<string, number>();

    for (const symbol of circuit.circuitSymbols) {
      const prefix = getSymbolAliasPrefix(symbol);
      let alias: string | null = null;
      if (prefix) {
        const nextIndex = (aliasCounters.get(prefix) ?? 0) + 1;
        aliasCounters.set(prefix, nextIndex);
        alias = `${prefix}${nextIndex}`;
      }

      const descriptor = buildSymbolDescriptor(
        symbol,
        alias,
        pinMap,
        options.includeNotes,
      );

      const symbolMatch = evaluateCandidates(
        descriptor.candidates,
        trimmedQuery,
        options.matchCase,
        options.wholeWord,
        isCurrentCircuit,
      );

      if (symbolMatch) {
        const matchedNoteSnippet =
          options.includeNotes &&
          descriptor.noteText !== "" &&
          matchesSearchQuery(
            descriptor.noteText,
            trimmedQuery,
            options.matchCase,
            options.wholeWord,
          )
            ? extractNoteSnippet(
              descriptor.noteText,
              trimmedQuery,
              options.matchCase,
              options.wholeWord,
            )
            : undefined;

        indexedResults.push({
          order: orderCounter++,
          result: {
            id: `symbol:${circuit.logicalCircuitId}:${symbol.circuitSymbolId}`,
            entityType: "symbol",
            itemKind: descriptor.itemKind,
            circuitId: circuit.logicalCircuitId,
            circuitName: circuit.name,
            symbolId: symbol.circuitSymbolId,
            label: descriptor.label,
            secondaryLabel: descriptor.secondaryLabel,
            matchedNoteSnippet,
            matchSource: symbolMatch.source,
            gridPoint: { x: symbol.x, y: symbol.y },
            focusPoint: getSymbolCenterPoint(symbol),
            score: symbolMatch.score,
          },
        });
      }
    }

    for (const textNote of circuit.textNotes) {
      const noteContent = (textNote.note ?? "").trim();
      if (!noteContent) {
        continue;
      }

      const noteMatch = evaluateCandidates(
        [{ text: noteContent, source: "textNote" }],
        trimmedQuery,
        options.matchCase,
        options.wholeWord,
        isCurrentCircuit,
      );

      if (noteMatch) {
        const { label, extraSnippet } = getTextNoteDisplayLabel(
          noteContent,
          trimmedQuery,
          options.matchCase,
          options.wholeWord,
        );
        indexedResults.push({
          order: orderCounter++,
          result: {
            id: `note:${circuit.logicalCircuitId}:${textNote.textNoteId}`,
            entityType: "textNote",
            itemKind: "textNote",
            circuitId: circuit.logicalCircuitId,
            circuitName: circuit.name,
            textNoteId: textNote.textNoteId,
            label,
            matchedNoteSnippet: extraSnippet,
            matchSource: noteMatch.source,
            gridPoint: { x: textNote.x, y: textNote.y },
            focusPoint: getTextNoteCenterPoint(textNote),
            score: noteMatch.score,
          },
        });
      }
    }
  }

  indexedResults.sort((a, b) => {
    if (b.result.score !== a.result.score) {
      return b.result.score - a.result.score;
    }
    const ay = a.result.gridPoint?.y ?? -1;
    const by = b.result.gridPoint?.y ?? -1;
    if (ay !== by) {
      return ay - by;
    }
    const ax = a.result.gridPoint?.x ?? -1;
    const bx = b.result.gridPoint?.x ?? -1;
    if (ax !== bx) {
      return ax - bx;
    }
    return a.order - b.order;
  });

  return indexedResults.map((entry) => entry.result);
}
