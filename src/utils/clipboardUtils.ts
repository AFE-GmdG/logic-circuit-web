import type Circuit from "../types/circuit/circuit";
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
import type PreparedPastePayload from "../types/circuit/preparedPastePayload";
import type Sensor from "../types/circuit/sensor";
import type Sound from "../types/circuit/sound";
import type Splitter from "../types/circuit/splitter";
import type Synthesizer from "../types/circuit/synthesizer";
import type TextNote from "../types/circuit/textNote";
import type Wire from "../types/circuit/wire";

import i18n from "../i18n";

import {
  createPinCircuit,
  generateUniquePinName,
  wouldCreateCircuitCycle,
} from "./circuitLayout";
import {
  isNativeCircuitJson,
  parseNativeSnippet,
} from "./storage/nativeProjectReader";
import { serializeNativeSelection } from "./storage/nativeProjectWriter";
import { parseLogicCircuitSnippetXml } from "./xml/logicCircuitXmlReader";
import { serializeSelectionToXml } from "./xml/logicCircuitXmlWriter";

// Interner Fallback-Zwischenspeicher, falls Browser-Clipboard-Rechte eingeschränkt sind
let inMemoryClipboardText = "";

export function setInMemoryClipboardText(text: string): void {
  inMemoryClipboardText = text;
}

export function getInMemoryClipboardText(): string {
  return inMemoryClipboardText;
}

export function clearInMemoryClipboardText(): void {
  inMemoryClipboardText = "";
}

// Prüft analog zu CircuitProject.CanPaste, ob ein String ein gültiges LogicCircuit-XML-Snippet enthält
export function isCircuitClipboardXml(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.includes("<CircuitProject") || trimmed.includes("<lc:CircuitProject");
}

// Prüft, ob ein String ein gültiges natives Web-JSON-Snippet enthält
export function isCircuitClipboardNative(text: string | null | undefined): boolean {
  return isNativeCircuitJson(text);
}

// Prüft, ob ein Zwischenablage-Text entweder als natives Web-JSON oder als Desktop-XML einfügbar ist
export function isCircuitClipboardText(text: string | null | undefined): boolean {
  return isCircuitClipboardNative(text) || isCircuitClipboardXml(text);
}

// Serialisiert die aktuelle Auswahl eines Schaltplans als Desktop-kompatibles XML-Snippet
export function buildClipboardXml(
  project: CircuitProject,
  circuit: LogicalCircuit,
  symbolIds: string[],
  wireIds: string[],
  textNoteIds: string[],
): string {
  return serializeSelectionToXml(project, circuit, symbolIds, wireIds, textNoteIds);
}

// Serialisiert die aktuelle Auswahl eines Schaltplans verlustfrei im nativen Web-JSON-Format
export function buildClipboardNativeJson(
  project: CircuitProject,
  circuit: LogicalCircuit,
  symbolIds: string[],
  wireIds: string[],
  textNoteIds: string[],
): string {
  return serializeNativeSelection(project, circuit, symbolIds, wireIds, textNoteIds);
}

// Standard-Clipboard-Serialisierung der WebApp (natives Web-JSON-Snippet)
export function buildClipboardContent(
  project: CircuitProject,
  circuit: LogicalCircuit,
  symbolIds: string[],
  wireIds: string[],
  textNoteIds: string[],
): string {
  return buildClipboardNativeJson(project, circuit, symbolIds, wireIds, textNoteIds);
}

// Synchroner Fallback über ein temporäres Textarea-Element für zuverlässiges OS-Clipboard-Schreiben
function tryWriteClipboardViaExecCommand(text: string): boolean {
  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  const previousActiveElement = document.activeElement as HTMLElement | null;
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  const savedRanges: Range[] = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) {
      savedRanges.push(selection.getRangeAt(i).cloneRange());
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("data-clipboard-helper", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  let copied = false;
  try {
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
    if (selection) {
      selection.removeAllRanges();
      for (const range of savedRanges) {
        selection.addRange(range);
      }
    }
    if (previousActiveElement && typeof previousActiveElement.focus === "function") {
      try {
        previousActiveElement.focus({ preventScroll: true });
      } catch {
        // Fokus-Wiederherstellung optional ignorieren
      }
    }
  }

  return copied;
}

// Schreibt Text in die System-Zwischenablage und aktualisiert immer den In-Memory-Fallback
export async function writeClipboardText(text: string): Promise<boolean> {
  inMemoryClipboardText = text;
  // Zuerst synchron während der aktiven Nutzeraktion schreiben, damit kein Rechteverlust nach await entsteht
  const syncCopied = tryWriteClipboardViaExecCommand(text);

  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return syncCopied;
    }
  }

  return syncCopied;
}

// Liest Text aus explizitem Paste-Text, Browser-Zwischenablage oder In-Memory-Fallback
export async function readClipboardText(explicitText?: string): Promise<string> {
  if (explicitText !== undefined) {
    return explicitText;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.readText === "function") {
    try {
      const systemText = await navigator.clipboard.readText();
      if (systemText) {
        return systemText;
      }
    } catch {
      // Falls Clipboard-Leserecht verweigert wurde, auf internen Zwischenspeicher ausweichen
    }
  }

  return inMemoryClipboardText;
}

function generateFreshId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneSymbolWithCircuit(
  sym: CircuitSymbol,
  newCircuit: Circuit,
  targetCircuitId: string,
): CircuitSymbol {
  const freshSymbolId = generateFreshId("sym");
  const clonedJams = sym.jams.map((jam, idx) => {
    const matchedPin = newCircuit.pins[idx];
    return {
      ...jam,
      circuitSymbolId: freshSymbolId,
      pin: matchedPin
        ? { ...matchedPin, gridPoint: { ...matchedPin.gridPoint } }
        : { ...jam.pin, circuitId: newCircuit.circuitId, gridPoint: { ...jam.pin.gridPoint } },
      absolutePoint: { ...jam.absolutePoint },
    };
  });

  return {
    ...sym,
    circuitSymbolId: freshSymbolId,
    circuitId: newCircuit.circuitId,
    logicalCircuitId: targetCircuitId,
    circuit: newCircuit,
    jams: clonedJams,
  };
}

function isUnnamedProbe(probe: CircuitProbe, originalId?: string): boolean {
  const trimmed = probe.name.trim().toLowerCase();
  if (trimmed === "" || trimmed === probe.circuitProbeId.toLowerCase()) {
    return true;
  }
  return originalId !== undefined && trimmed === originalId.toLowerCase();
}

function cloneIndividualCircuit(circuit: Circuit): Circuit {
  const kind = circuit.kind ?? "circuit";
  const newId = generateFreshId(kind);
  const clonedPins = circuit.pins.map((pin) => ({
    ...pin,
    circuitId: newId,
    gridPoint: { ...pin.gridPoint },
  }));

  switch (kind) {
    case "circuitButton": {
      const btn = circuit as CircuitButton;
      const cloned: CircuitButton = { ...btn, circuitId: newId, circuitButtonId: newId, pins: clonedPins };
      return cloned;
    }
    case "constant": {
      const constant = circuit as Constant;
      const cloned: Constant = { ...constant, circuitId: newId, constantId: newId, pins: clonedPins };
      return cloned;
    }
    case "circuitProbe": {
      const probe = circuit as CircuitProbe;
      const cloned: CircuitProbe = { ...probe, circuitId: newId, circuitProbeId: newId, pins: clonedPins };
      return cloned;
    }
    case "splitter": {
      const splitter = circuit as Splitter;
      const cloned: Splitter = { ...splitter, circuitId: newId, splitterId: newId, pins: clonedPins };
      return cloned;
    }
    case "memory": {
      const mem = circuit as Memory;
      const cloned: Memory = { ...mem, circuitId: newId, memoryId: newId, pins: clonedPins };
      return cloned;
    }
    case "ledMatrix": {
      const matrix = circuit as LedMatrix;
      const cloned: LedMatrix = { ...matrix, circuitId: newId, ledMatrixId: newId, pins: clonedPins };
      return cloned;
    }
    case "sensor": {
      const sensor = circuit as Sensor;
      const cloned: Sensor = { ...sensor, circuitId: newId, sensorId: newId, pins: clonedPins };
      return cloned;
    }
    case "sound": {
      const sound = circuit as Sound;
      const cloned: Sound = { ...sound, circuitId: newId, soundId: newId, pins: clonedPins };
      return cloned;
    }
    case "synthesizer": {
      const synth = circuit as Synthesizer;
      const cloned: Synthesizer = {
        ...synth,
        circuitId: newId,
        synthesizerId: newId,
        pins: clonedPins,
      };
      return cloned;
    }
    case "graphicsArray": {
      const ga = circuit as GraphicsArray;
      const cloned: GraphicsArray = { ...ga, circuitId: newId, graphicsArrayId: newId, pins: clonedPins };
      return cloned;
    }
    default:
      return { ...circuit, circuitId: newId, pins: clonedPins };
  }
}

// Bereitet ein Zwischenablage-Snippet (natives JSON oder Desktop-XML) für den schwebenden Paste-Vorgang auf
export function prepareClipboardPaste(
  rawText: string,
  targetProject: CircuitProject,
  targetCircuitId: string,
): PreparedPastePayload {
  const snippet = isCircuitClipboardNative(rawText)
    ? parseNativeSnippet(rawText)
    : parseLogicCircuitSnippetXml(rawText);
  const sourceRoot =
    snippet.logicalCircuits.find((lc) => lc.logicalCircuitId === snippet.project.logicalCircuitId) ??
    snippet.logicalCircuits[0];

  if (!sourceRoot) {
    throw new Error(i18n.t("errors.clipboard.noPasteableCircuit"));
  }

  const targetCircuit = targetProject.logicalCircuits.find(
    (lc) => lc.logicalCircuitId === targetCircuitId,
  );
  if (!targetCircuit) {
    throw new Error(i18n.t("errors.clipboard.targetCircuitNotFound", { circuitId: targetCircuitId }));
  }

  // Bereits belegte Pin-Namen in der Zielschaltung sammeln
  const usedPinNames: { name: string }[] = [
    ...targetCircuit.logicalPins.map((p) => ({ name: p.name })),
    ...targetProject.pins
      .filter((p) => p.circuitId === targetCircuitId)
      .map((p) => ({ name: p.name })),
  ];

  // Bereits belegte Probe-Namen in der Zielschaltung sammeln (nur explizit benannte Probes)
  const usedProbeNames: { name: string }[] = targetCircuit.circuitSymbols
    .filter((s) => s.circuit.kind === "circuitProbe")
    .map((s) => s.circuit as CircuitProbe)
    .filter((probe) => !isUnnamedProbe(probe))
    .map((probe) => ({ name: probe.name.trim() }));

  const existingSubCircuitById = new Map(
    targetProject.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
  );
  const snippetSubCircuitById = new Map(
    snippet.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
  );

  const importedSubCircuitMap = new Map<string, LogicalCircuit>();
  const importedGatesMap = new Map<string, Gate>();
  const importedPins: Pin[] = [];
  const importedButtons: CircuitButton[] = [];
  const importedConstants: Constant[] = [];
  const importedProbes: CircuitProbe[] = [];
  const importedLedMatrices: LedMatrix[] = [];
  const importedSplitters: Splitter[] = [];
  const importedMemories: Memory[] = [];
  const importedSensors: Sensor[] = [];
  const importedSounds: Sound[] = [];
  const importedSynthesizers: Synthesizer[] = [];
  const importedGraphicsArrays: GraphicsArray[] = [];

  const registerSnippetCircuitEntity = (circuit: Circuit, snippetSubCircuit?: LogicalCircuit) => {
    switch (circuit.kind) {
      case "gate": {
        const g = snippet.gates.get(circuit.circuitId) ?? (circuit as Gate);
        if (!targetProject.gates.has(g.gateId)) {
          importedGatesMap.set(g.gateId, g);
        }
        break;
      }
      case "pin": {
        const pin =
          snippet.pins.find((p) => p.pinId === circuit.circuitId) ??
          snippetSubCircuit?.logicalPins.find((p) => p.pinId === circuit.circuitId);
        if (pin && !importedPins.some((p) => p.pinId === pin.pinId)) {
          importedPins.push(pin);
        }
        break;
      }
      case "circuitButton": {
        const b = snippet.circuitButtons.find((item) => item.circuitButtonId === circuit.circuitId) ??
          (circuit as CircuitButton);
        if (!importedButtons.some((item) => item.circuitButtonId === b.circuitButtonId)) {
          importedButtons.push(b);
        }
        break;
      }
      case "constant": {
        const c = snippet.constants.find((item) => item.constantId === circuit.circuitId) ??
          (circuit as Constant);
        if (!importedConstants.some((item) => item.constantId === c.constantId)) {
          importedConstants.push(c);
        }
        break;
      }
      case "circuitProbe": {
        const p = snippet.circuitProbes.find((item) => item.circuitProbeId === circuit.circuitId) ??
          (circuit as CircuitProbe);
        if (!importedProbes.some((item) => item.circuitProbeId === p.circuitProbeId)) {
          importedProbes.push(p);
        }
        break;
      }
      case "ledMatrix": {
        const m = snippet.ledMatrices.find((item) => item.ledMatrixId === circuit.circuitId) ??
          (circuit as LedMatrix);
        if (!importedLedMatrices.some((item) => item.ledMatrixId === m.ledMatrixId)) {
          importedLedMatrices.push(m);
        }
        break;
      }
      case "splitter": {
        const s = snippet.splitters.find((item) => item.splitterId === circuit.circuitId) ??
          (circuit as Splitter);
        if (!importedSplitters.some((item) => item.splitterId === s.splitterId)) {
          importedSplitters.push(s);
        }
        break;
      }
      case "memory": {
        const m = snippet.memories.find((item) => item.memoryId === circuit.circuitId) ??
          (circuit as Memory);
        if (!importedMemories.some((item) => item.memoryId === m.memoryId)) {
          importedMemories.push(m);
        }
        break;
      }
      case "sensor": {
        const s = snippet.sensors.find((item) => item.sensorId === circuit.circuitId) ??
          (circuit as Sensor);
        if (!importedSensors.some((item) => item.sensorId === s.sensorId)) {
          importedSensors.push(s);
        }
        break;
      }
      case "sound": {
        const s = snippet.sounds.find((item) => item.soundId === circuit.circuitId) ??
          (circuit as Sound);
        if (!importedSounds.some((item) => item.soundId === s.soundId)) {
          importedSounds.push(s);
        }
        break;
      }
      case "synthesizer": {
        const s =
          snippet.synthesizers.find((item) => item.synthesizerId === circuit.circuitId) ??
          (circuit as Synthesizer);
        if (!importedSynthesizers.some((item) => item.synthesizerId === s.synthesizerId)) {
          importedSynthesizers.push(s);
        }
        break;
      }
      case "graphicsArray": {
        const g = snippet.graphicsArrays.find((item) => item.graphicsArrayId === circuit.circuitId) ??
          (circuit as GraphicsArray);
        if (!importedGraphicsArrays.some((item) => item.graphicsArrayId === g.graphicsArrayId)) {
          importedGraphicsArrays.push(g);
        }
        break;
      }
      default:
        break;
    }
  };

  const resolveSubCircuit = (subCircuitId: string, visitedIds: Set<string>): LogicalCircuit => {
    const existing = existingSubCircuitById.get(subCircuitId);
    if (existing) {
      if (wouldCreateCircuitCycle(targetCircuitId, subCircuitId, targetProject)) {
        throw new Error(
          i18n.t("errors.clipboard.circularEmbedding", {
            subName: existing.name,
            targetName: targetCircuit.name,
          }),
        );
      }
      return existing;
    }

    const alreadyImported = importedSubCircuitMap.get(subCircuitId);
    if (alreadyImported) {
      return alreadyImported;
    }

    const fromSnippet = snippetSubCircuitById.get(subCircuitId);
    if (!fromSnippet) {
      throw new Error(i18n.t("errors.clipboard.missingSubCircuit", { subCircuitId }));
    }

    if (visitedIds.has(subCircuitId)) {
      throw new Error(
        i18n.t("errors.clipboard.circularInClipboard", { name: fromSnippet.name }),
      );
    }

    const nextVisited = new Set(visitedIds);
    nextVisited.add(subCircuitId);
    importedSubCircuitMap.set(subCircuitId, fromSnippet);

    for (const pin of fromSnippet.logicalPins) {
      if (!importedPins.some((p) => p.pinId === pin.pinId)) {
        importedPins.push(pin);
      }
    }

    for (const innerSym of fromSnippet.circuitSymbols) {
      if (innerSym.circuit.kind === "logicalCircuit") {
        if (innerSym.circuitId === targetCircuitId) {
          throw new Error(
            i18n.t("errors.clipboard.circularReferencesTarget", {
              subName: fromSnippet.name,
              targetName: targetCircuit.name,
            }),
          );
        }
        resolveSubCircuit(innerSym.circuitId, nextVisited);
      } else {
        registerSnippetCircuitEntity(innerSym.circuit, fromSnippet);
      }
    }

    return fromSnippet;
  };

  const preparedSymbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[] = [];

  for (const sym of sourceRoot.circuitSymbols) {
    if (sym.circuit.kind === "gate") {
      const baseGate =
        targetProject.gates.get(sym.circuitId) ??
        snippet.gates.get(sym.circuitId) ??
        (sym.circuit as Gate);
      const symGate = sym.circuit as Gate;
      const gate = symGate.note ? { ...baseGate, note: symGate.note } : baseGate;
      const clonedSym = cloneSymbolWithCircuit(sym, gate, targetCircuitId);
      preparedSymbols.push({ symbol: clonedSym, circuit: gate });
      continue;
    }

    if (sym.circuit.kind === "logicalCircuit") {
      const resolvedLc = resolveSubCircuit(sym.circuitId, new Set());
      const clonedSym = cloneSymbolWithCircuit(sym, resolvedLc, targetCircuitId);
      preparedSymbols.push({ symbol: clonedSym, circuit: resolvedLc });
      continue;
    }

    if (sym.circuit.kind === "pin") {
      const origPin =
        snippet.pins.find((p) => p.pinId === sym.circuitId) ??
        sourceRoot.logicalPins.find((p) => p.pinId === sym.circuitId);

      const newPinId = generateFreshId("pin");
      const rawName = origPin?.name ?? sym.circuit.name;
      const uniqueName = generateUniquePinName(rawName, usedPinNames);
      usedPinNames.push({ name: uniqueName });

      const { pin, pinCircuit } = createPinCircuit(
        newPinId,
        targetCircuitId,
        origPin?.pinType === "output" ? "output" : "input",
        uniqueName,
        origPin?.bitWidth ?? 1,
        origPin?.pinSide ?? "left",
        origPin?.inverted ?? false,
        origPin?.index ?? 0,
        sym.circuit.symbolWidth,
        sym.circuit.symbolHeight,
        origPin?.jamNotation ?? "",
      );
      if (origPin?.note) {
        pin.note = origPin.note;
        pinCircuit.note = origPin.note;
      }

      const clonedSym = cloneSymbolWithCircuit(sym, pinCircuit, targetCircuitId);
      preparedSymbols.push({ symbol: clonedSym, circuit: pinCircuit, pin });
      continue;
    }

    const origCircuitId = sym.circuitId;
    const clonedCircuit = cloneIndividualCircuit(sym.circuit);
    if (clonedCircuit.kind === "circuitProbe") {
      const probe = clonedCircuit as CircuitProbe;
      if (!isUnnamedProbe(probe, origCircuitId)) {
        const uniqueProbeName = generateUniquePinName(probe.name.trim(), usedProbeNames);
        usedProbeNames.push({ name: uniqueProbeName });
        probe.name = uniqueProbeName;
        probe.notation = `?\n${uniqueProbeName}`;
      } else {
        probe.name = probe.circuitProbeId;
        probe.notation = "?";
      }
    }

    const clonedSym = cloneSymbolWithCircuit(sym, clonedCircuit, targetCircuitId);
    preparedSymbols.push({ symbol: clonedSym, circuit: clonedCircuit });
  }

  const preparedTextNotes: TextNote[] = sourceRoot.textNotes.map((note) => ({
    ...note,
    textNoteId: generateFreshId("note"),
    logicalCircuitId: targetCircuitId,
  }));

  const preparedWires: Wire[] = sourceRoot.wires.map((wire) => ({
    ...wire,
    wireId: generateFreshId("wire"),
    logicalCircuitId: targetCircuitId,
    point1: { ...wire.point1 },
    point2: { ...wire.point2 },
  }));

  return {
    targetCircuitId,
    symbols: preparedSymbols,
    textNotes: preparedTextNotes,
    wires: preparedWires,
    importedSubCircuits: Array.from(importedSubCircuitMap.values()),
    importedGates: Array.from(importedGatesMap.values()),
    importedPins,
    importedButtons,
    importedConstants,
    importedProbes,
    importedLedMatrices,
    importedSplitters,
    importedMemories,
    importedSensors,
    importedSounds,
    importedSynthesizers,
    importedGraphicsArrays,
  };
}
