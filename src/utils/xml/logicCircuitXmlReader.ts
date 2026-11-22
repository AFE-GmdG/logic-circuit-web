import type Circuit from "../../types/circuit/circuit";
import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitShape from "../../types/circuit/circuitShape";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type CollapsedCategory from "../../types/circuit/collapsedCategory";
import type Constant from "../../types/circuit/constant";
import type DisplayColor from "../../types/circuit/displayColor";
import type DisplayMargin from "../../types/circuit/displayMargin";
import type Gate from "../../types/circuit/gate";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type Pin from "../../types/circuit/pin";
import type Project from "../../types/circuit/project";
import type Sensor from "../../types/circuit/sensor";
import type Sound from "../../types/circuit/sound";
import type Splitter from "../../types/circuit/splitter";
import type Synthesizer from "../../types/circuit/synthesizer";
import type TextNote from "../../types/circuit/textNote";
import type TextNoteLineHeight from "../../types/circuit/textNoteLineHeight";
import type Wire from "../../types/circuit/wire";

import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createGate,
  createGraphicsArray,
  createLedMatrix,
  createMemory,
  createPinCircuit,
  createSensor,
  createSound,
  createSplitter,
  extractLedColorFromGateId,
  parseGateGuid,
  rebuildImportedProjectLayout,
} from "../circuitLayout";
import { createWire } from "../wireUtils";
import {
  EMPTY_GUID,
  isLegacyUnsupportedNamespace,
  isSupportedLogicCircuitNamespace,
  LOGICAL_CIRCUIT_DEFAULTS,
  normalizeGuid,
  parseCircuitShape,
  parseDisplayColor,
  parseLedMatrixCellShape,
  parseLedMatrixType,
  parseMemoryOnStart,
  parsePinSide,
  parsePinType,
  parseRotation,
  parseSensorType,
  parseSoundWaveform,
  parseTextNoteFontFamily,
  parseTextNoteLineHeight,
  parseXmlBoolean,
  parseXmlFloat,
  parseXmlInt,
  PROJECT_DEFAULTS,
  SOUND_WEB_DEFAULTS,
  XML_ROOT_NAME,
  XML_TABLES,
} from "./logicCircuitXmlConstants";

type XmlNodeElement = {
  localName: string;
  namespaceUri: string;
  attributes: Record<string, string>;
  children: XmlNodeElement[];
  textContent: string;
};

export type LogicCircuitXmlReadOptions = {
  allowPartialSnippet?: boolean;
};

// Dekodiert XML-Standardentitäten und numerische Zeichenreferenzen
function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (full, entity: string) => {
    switch (entity) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return "\"";
      case "apos":
        return "'";
      default:
        if (entity.startsWith("#x")) {
          const code = Number.parseInt(entity.slice(2), 16);
          return Number.isFinite(code) ? String.fromCodePoint(code) : full;
        }
        if (entity.startsWith("#")) {
          const code = Number.parseInt(entity.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : full;
        }
        return full;
    }
  });
}

// Konvertiert ein natives Browser-DOM-Element in die einheitliche XmlNodeElement-Struktur
function domElementToNode(element: Element): XmlNodeElement {
  const attributes: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    attributes[attr.name] = attr.value;
  }

  const children: XmlNodeElement[] = [];
  let textContent = "";

  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i];
    if (child.nodeType === 1) {
      children.push(domElementToNode(child as Element));
    } else if (child.nodeType === 3 || child.nodeType === 4) {
      textContent += child.nodeValue ?? "";
    }
  }

  return {
    localName: element.localName || element.tagName.replace(/^[^:]+:/, ""),
    namespaceUri: element.namespaceURI ?? "",
    attributes,
    children,
    textContent: children.length === 0 ? textContent : element.textContent ?? textContent,
  };
}

// Parst Attribute eines XML-Start-Tags in einer Fallback-Umgebung ohne DOMParser
function parseXmlTagAttributes(attrSource: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrRegex = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = attrRegex.exec(attrSource);
  while (match !== null) {
    const name = match[1];
    const rawValue = match[2] ?? match[3] ?? "";
    attributes[name] = decodeXmlEntities(rawValue);
    match = attrRegex.exec(attrSource);
  }
  return attributes;
}

// Löst den effektiven XML-Namespace für ein Tag-Präfix anhand des Namespace-Stacks auf
function resolveNamespaceForTag(
  tagName: string,
  nsStack: Map<string, string>[],
): string {
  const colonIdx = tagName.indexOf(":");
  const prefix = colonIdx >= 0 ? tagName.slice(0, colonIdx) : "";
  for (let i = nsStack.length - 1; i >= 0; i--) {
    const uri = nsStack[i].get(prefix);
    if (uri !== undefined) {
      return uri;
    }
  }
  return "";
}

// Reiner TypeScript-XML-Parser als Fallback für Node-/Vitest-Umgebungen ohne globale DOMParser-API
function parseXmlFallback(xmlText: string): XmlNodeElement {
  const cleaned = xmlText.replace(/^\uFEFF/, "");
  const stack: XmlNodeElement[] = [];
  const nsStack: Map<string, string>[] = [];
  let root: XmlNodeElement | null = null;
  let pos = 0;

  while (pos < cleaned.length) {
    const ltIndex = cleaned.indexOf("<", pos);
    if (ltIndex === -1) {
      const trailing = cleaned.slice(pos);
      if (stack.length === 0 && trailing.trim() !== "") {
        throw new Error("Ungültiges XML: Unerwarteter Text außerhalb des Root-Elements.");
      }
      if (stack.length > 0) {
        stack[stack.length - 1].textContent += decodeXmlEntities(trailing);
      }
      break;
    }

    if (ltIndex > pos) {
      const textChunk = cleaned.slice(pos, ltIndex);
      if (stack.length > 0) {
        stack[stack.length - 1].textContent += decodeXmlEntities(textChunk);
      } else if (textChunk.trim() !== "") {
        throw new Error("Ungültiges XML: Unerwarteter Text vor dem Root-Element.");
      }
    }

    if (cleaned.startsWith("<!--", ltIndex)) {
      const endComment = cleaned.indexOf("-->", ltIndex + 4);
      if (endComment === -1) {
        throw new Error("Ungültiges XML: Nicht geschlossener Kommentar.");
      }
      pos = endComment + 3;
      continue;
    }

    if (cleaned.startsWith("<![CDATA[", ltIndex)) {
      const endCdata = cleaned.indexOf("]]>", ltIndex + 9);
      if (endCdata === -1) {
        throw new Error("Ungültiges XML: Nicht geschlossener CDATA-Abschnitt.");
      }
      if (stack.length > 0) {
        stack[stack.length - 1].textContent += cleaned.slice(ltIndex + 9, endCdata);
      }
      pos = endCdata + 3;
      continue;
    }

    if (cleaned.startsWith("<?", ltIndex)) {
      const endPi = cleaned.indexOf("?>", ltIndex + 2);
      if (endPi === -1) {
        throw new Error("Ungültiges XML: Nicht geschlossene Processing Instruction.");
      }
      pos = endPi + 2;
      continue;
    }

    if (cleaned.startsWith("<!", ltIndex)) {
      const endDecl = cleaned.indexOf(">", ltIndex + 2);
      if (endDecl === -1) {
        throw new Error("Ungültiges XML: Nicht geschlossene Deklaration.");
      }
      pos = endDecl + 1;
      continue;
    }

    // Tag-Ende unter Berücksichtigung von Attribut-Anführungszeichen finden
    let gtIndex = -1;
    let quoteChar: string | null = null;
    for (let i = ltIndex + 1; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (quoteChar) {
        if (ch === quoteChar) {
          quoteChar = null;
        }
      } else if (ch === "\"" || ch === "'") {
        quoteChar = ch;
      } else if (ch === ">") {
        gtIndex = i;
        break;
      }
    }

    if (gtIndex === -1) {
      throw new Error("Ungültiges XML: Tag nicht geschlossen.");
    }

    const rawTag = cleaned.slice(ltIndex + 1, gtIndex).trim();
    pos = gtIndex + 1;

    if (!rawTag) {
      throw new Error("Ungültiges XML: Leeres Tag gefunden.");
    }

    if (rawTag.startsWith("/")) {
      const closeTagName = rawTag.slice(1).trim();
      const closeLocal = closeTagName.replace(/^[^:]+:/, "");
      const current = stack.pop();
      nsStack.pop();
      if (!current || current.localName !== closeLocal) {
        throw new Error(
          `Ungültiges XML: Schließendes Tag </${closeTagName}> passt nicht zu <${current?.localName ?? ""}>.`,
        );
      }
      continue;
    }

    const isSelfClosing = rawTag.endsWith("/");
    const tagBody = isSelfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const spaceMatch = tagBody.match(/^([^\s/]+)([\s\S]*)$/);
    if (!spaceMatch) {
      throw new Error("Ungültiges XML: Tag-Name konnte nicht gelesen werden.");
    }

    const fullName = spaceMatch[1];
    const attrPart = spaceMatch[2] ?? "";
    const attributes = parseXmlTagAttributes(attrPart);

    const localNsMap = new Map<string, string>();
    for (const [attrName, attrVal] of Object.entries(attributes)) {
      if (attrName === "xmlns") {
        localNsMap.set("", attrVal);
      } else if (attrName.startsWith("xmlns:")) {
        localNsMap.set(attrName.slice(6), attrVal);
      }
    }
    nsStack.push(localNsMap);

    const colonIdx = fullName.indexOf(":");
    const localName = colonIdx >= 0 ? fullName.slice(colonIdx + 1) : fullName;
    const namespaceUri = resolveNamespaceForTag(fullName, nsStack);

    const node: XmlNodeElement = {
      localName,
      namespaceUri,
      attributes,
      children: [],
      textContent: "",
    };

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else if (root === null) {
      root = node;
    } else {
      throw new Error("Ungültiges XML: Mehrere Root-Elemente gefunden.");
    }

    if (isSelfClosing) {
      nsStack.pop();
    } else {
      stack.push(node);
    }
  }

  if (stack.length > 0 || !root) {
    throw new Error("Ungültiges XML: Dokument ist unvollständig oder leer.");
  }

  return root;
}

// Parst einen XML-Text bevorzugt über die Browser-DOMParser-API mit Fallback für Node-Tests
function parseXmlToElementTree(xmlText: string): XmlNodeElement {
  if (!xmlText || !xmlText.trim()) {
    throw new Error("Die XML-Datei ist leer.");
  }

  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parserErrors = doc.getElementsByTagName("parsererror");
    if (parserErrors.length > 0 || doc.documentElement?.localName === "parsererror") {
      const message = parserErrors[0]?.textContent?.trim() || "Ungültige XML-Syntax.";
      throw new Error(`Fehler beim XML-Parsen: ${message}`);
    }
    if (!doc.documentElement) {
      throw new Error("Die XML-Datei enthält kein Root-Element.");
    }
    return domElementToNode(doc.documentElement);
  }

  return parseXmlFallback(xmlText);
}

// Serialisiert ein XmlNodeElement wieder in XML-Text (für eingebettete FlowDocument-Notizen)
function serializeXmlNode(node: XmlNodeElement): string {
  const attrs = Object.entries(node.attributes)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  if (node.children.length === 0 && !node.textContent) {
    return `<${node.localName}${attrs}/>`;
  }
  const inner = node.children.length > 0
    ? node.children.map(serializeXmlNode).join("")
    : node.textContent;
  return `<${node.localName}${attrs}>${inner}</${node.localName}>`;
}

// Liest Attribute und Kind-Elemente eines Datensatz-Knotens einheitlich aus (unterstützt 2.0.0.14+ Attribute und ältere Kind-Elemente)
function extractRecordFields(recordNode: XmlNodeElement): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [key, value] of Object.entries(recordNode.attributes)) {
    if (key === "xmlns" || key.startsWith("xmlns:")) {
      continue;
    }
    const localKey = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
    fields[localKey] = value;
  }

  for (const child of recordNode.children) {
    if (child.children.length > 0) {
      fields[child.localName] = child.children.map(serializeXmlNode).join("");
    } else {
      fields[child.localName] = child.textContent;
    }
  }

  return fields;
}

// Extrahiert lesbaren Fließtext aus einem WPF-FlowDocument-XML
function extractFlowDocumentLines(node: XmlNodeElement, lines: string[], currentLine: { value: string }): void {
  const name = node.localName;
  if (name === "LineBreak") {
    lines.push(currentLine.value);
    currentLine.value = "";
    return;
  }

  const isBlockElement = name === "Paragraph" || name === "ListItem" || name === "TableCell";

  if (node.children.length === 0) {
    currentLine.value += node.textContent;
  } else {
    for (const child of node.children) {
      extractFlowDocumentLines(child, lines, currentLine);
    }
  }

  if (isBlockElement) {
    lines.push(currentLine.value);
    currentLine.value = "";
  }
}

// Konvertiert Notiz-Inhalte aus LogicCircuit-Desktop (<FlowDocument>) in darstellbaren Text
function parseTextNoteContent(rawNote: string): { text: string; isValid: boolean } {
  const trimmedStart = rawNote.trimStart();
  if (!trimmedStart.startsWith("<FlowDocument")) {
    return {
      text: rawNote,
      isValid: rawNote.length > 0,
    };
  }

  try {
    const flowRoot = parseXmlToElementTree(trimmedStart);
    const lines: string[] = [];
    const currentLine = { value: "" };
    extractFlowDocumentLines(flowRoot, lines, currentLine);
    if (currentLine.value.length > 0) {
      lines.push(currentLine.value);
    }
    const joined = lines.join("\n").replace(/\r\n/g, "\n").trimEnd();
    return {
      text: joined,
      isValid: joined.trim().length > 0,
    };
  } catch {
    return {
      text: rawNote,
      isValid: false,
    };
  }
}

// Parst optionale Web-Erweiterung für zeilenweise Zeilenhöhen einer TextNote
function parseLineHeights(raw: string | undefined): TextNoteLineHeight[] | undefined {
  if (!raw || !raw.trim()) {
    return undefined;
  }
  const parsed = raw
    .split(",")
    .map((part) => parseTextNoteLineHeight(part))
    .filter((val): val is TextNoteLineHeight => val !== undefined);
  return parsed.length > 0 ? parsed : undefined;
}

// Wandelt veraltete Gate-GUIDs aus älteren Schema-Versionen (< 2.0.0.4) in aktuelle Äquivalente um
function translateLegacyGateGuid(normalizedGuid: string): {
  kind: "gate" | "legacyProbe" | "unknown";
  gateId: string;
} {
  // Odd (06) -> XOR (05), Even (07) -> XNOR (05...01)
  if (normalizedGuid.startsWith("00000000-0000-0000-0000-00000006")) {
    const suffix = normalizedGuid.slice(32);
    return {
      kind: "gate",
      gateId: `00000000-0000-0000-0000-00000005${suffix}`,
    };
  }
  if (normalizedGuid.startsWith("00000000-0000-0000-0000-00000007")) {
    const inputHex = normalizedGuid.slice(32, 34);
    return {
      kind: "gate",
      gateId: `00000000-0000-0000-0000-00000005${inputHex}01`,
    };
  }
  // Veraltetes Probe-Gate (09) vor Version 2.0.0.6
  if (normalizedGuid.startsWith("00000000-0000-0000-0000-00000009")) {
    return {
      kind: "legacyProbe",
      gateId: normalizedGuid,
    };
  }
  return {
    kind: "gate",
    gateId: normalizedGuid,
  };
}

// Deserialisiert einen XML-String einer .CircuitProject-Datei (oder eines Snippets) in ein CircuitProject
export function parseLogicCircuitXml(
  xmlText: string,
  options?: LogicCircuitXmlReadOptions,
): CircuitProject {
  const allowPartialSnippet = options?.allowPartialSnippet ?? false;
  const root = parseXmlToElementTree(xmlText);

  if (root.localName !== XML_ROOT_NAME) {
    throw new Error(
      `Ungültiges Dateiformat: Root-Element "${root.localName}" gefunden, erwartet wurde "${XML_ROOT_NAME}".`,
    );
  }

  const namespaceUri = root.namespaceUri || root.attributes.xmlns || "";
  if (isLegacyUnsupportedNamespace(namespaceUri)) {
    throw new Error(
      `Die Schema-Version "${namespaceUri}" (1.0.0.x) wird nicht direkt unterstützt. ` +
      "Bitte öffnen und speichern Sie das Projekt zunächst in LogicCircuit Desktop 2.x.",
    );
  }

  if (!namespaceUri || !isSupportedLogicCircuitNamespace(namespaceUri)) {
    throw new Error(
      `Nicht unterstützte oder fehlende Schema-Version "${namespaceUri || "(kein Namespace)"}". ` +
      "Erwartet wird http://LogicCircuit.net/2.0.0.15/CircuitProject.xsd (oder 2.0.0.x).",
    );
  }

  const projects: Project[] = [];
  const collapsedCategories: CollapsedCategory[] = [];
  const logicalCircuits: LogicalCircuit[] = [];
  const pins: Pin[] = [];
  const circuitProbes: CircuitProbe[] = [];
  const constants: Constant[] = [];
  const circuitButtons: CircuitButton[] = [];
  const memories: Memory[] = [];
  const ledMatrices: LedMatrix[] = [];
  const splitters: Splitter[] = [];
  const sensors: Sensor[] = [];
  const sounds: Sound[] = [];
  const synthesizers: Synthesizer[] = [];
  const graphicsArrays: GraphicsArray[] = [];
  const circuits = new Map<string, Circuit>();
  const gates = new Map<string, Gate>();

  const rawSymbols: {
    circuitSymbolId: string;
    circuitId: string;
    logicalCircuitId: string;
    x: number;
    y: number;
    rotation: ReturnType<typeof parseRotation>;
    color?: DisplayColor;
  }[] = [];
  const rawWires: Wire[] = [];
  const rawTextNotes: TextNote[] = [];

  for (const child of root.children) {
    const fields = extractRecordFields(child);

    switch (child.localName) {
      case XML_TABLES.project: {
        const rawZoom = parseXmlFloat(fields.Zoom, PROJECT_DEFAULTS.zoom);
        const rawFreq = parseXmlInt(fields.Frequency, PROJECT_DEFAULTS.frequency);
        const rawStartup = normalizeGuid(fields.StartupCircuitId);
        projects.push({
          projectId: normalizeGuid(fields.ProjectId) || "imported-project",
          name: fields.Name ?? PROJECT_DEFAULTS.name,
          note: fields.Note ?? fields.Description ?? PROJECT_DEFAULTS.note,
          zoom: Math.max(0.1, Math.min(3.0, rawZoom)),
          frequency: Math.max(1, Math.min(50, rawFreq)),
          isMaximumSpeed: parseXmlBoolean(fields.IsMaximumSpeed, PROJECT_DEFAULTS.isMaximumSpeed),
          logicalCircuitId: normalizeGuid(fields.LogicalCircuitId),
          startupCircuitId: rawStartup && rawStartup !== EMPTY_GUID ? rawStartup : undefined,
          categoryTextNoteCollapsed: parseXmlBoolean(
            fields.CategoryTextNoteCollapsed,
            PROJECT_DEFAULTS.categoryTextNoteCollapsed,
          ),
          categoryInputOutputCollapsed: parseXmlBoolean(
            fields.CategoryInputOutputCollapsed,
            PROJECT_DEFAULTS.categoryInputOutputCollapsed,
          ),
          categoryPrimitivesCollapsed: parseXmlBoolean(
            fields.CategoryPrimitivesCollapsed,
            PROJECT_DEFAULTS.categoryPrimitivesCollapsed,
          ),
        });
        break;
      }

      case XML_TABLES.collapsedCategory: {
        const name = fields.Name ?? "";
        if (name && !collapsedCategories.some((c) => c.name === name)) {
          collapsedCategories.push({ name });
        }
        break;
      }

      case XML_TABLES.logicalCircuit: {
        const logicalCircuitId = normalizeGuid(fields.LogicalCircuitId);
        if (!logicalCircuitId) {
          break;
        }
        const lc = createDefaultLogicalCircuit(
          logicalCircuitId,
          fields.Name ?? LOGICAL_CIRCUIT_DEFAULTS.name,
          fields.Category ?? LOGICAL_CIRCUIT_DEFAULTS.category,
          fields.Note ?? fields.Description ?? LOGICAL_CIRCUIT_DEFAULTS.note,
        );
        const hasDisplayFlag = parseXmlBoolean(fields.IsDisplay, false);
        const shape: CircuitShape = fields.CircuitShape
          ? parseCircuitShape(fields.CircuitShape, "rectangular")
          : hasDisplayFlag
            ? "display"
            : "rectangular";
        lc.notation = fields.Notation ?? LOGICAL_CIRCUIT_DEFAULTS.notation;
        lc.circuitShape = shape;
        lc.isDisplay = shape === "display";
        lc.showLabelAbove = parseXmlBoolean(fields.ShowLabelAbove, false);
        const rawMargin = (fields.DisplayMargin ?? "").trim().toLowerCase();
        const parsedMargin: DisplayMargin =
          rawMargin === "horizontal" || rawMargin === "vertical" || rawMargin === "all"
            ? rawMargin
            : "none";
        lc.displayMargin = parsedMargin;
        lc.validators = fields.Validators ?? LOGICAL_CIRCUIT_DEFAULTS.validators;
        lc.exportToHDL = parseXmlBoolean(fields.ExportToHDL, LOGICAL_CIRCUIT_DEFAULTS.exportToHDL);
        logicalCircuits.push(lc);
        circuits.set(lc.circuitId, lc);
        break;
      }

      case XML_TABLES.pin: {
        const pinId = normalizeGuid(fields.PinId);
        const circuitId = normalizeGuid(fields.CircuitId || fields.LogicalCircuitId);
        if (!pinId || !circuitId) {
          break;
        }
        const pinTypeRaw = parsePinType(fields.PinType, "input");
        const pinType: "input" | "output" = pinTypeRaw === "output" ? "output" : "input";
        const bitWidth = Math.max(1, Math.min(32, parseXmlInt(fields.BitWidth, 1)));
        // Laut CircuitProject.xml-Schema ist PinSide.Left der Spalten-Default fuer alle Pins (auch Output-Pins),
        // weshalb Desktop-LogicCircuit PinSide="Left" beim Speichern weglasst.
        const pinSide = parsePinSide(fields.PinSide, "left");
        const inverted = parseXmlBoolean(fields.Inverted, false);
        const name = fields.Name ?? (pinType === "input" ? "In" : "Out");
        const index = parseXmlInt(fields.Index, 0);
        const note = fields.Note ?? "";
        const jamNotation = fields.JamNotation ?? "";

        const { pin, pinCircuit } = createPinCircuit(
          pinId,
          circuitId,
          pinType,
          name,
          bitWidth,
          pinSide,
          inverted,
          index,
        );
        pin.note = note;
        pin.jamNotation = jamNotation;
        pinCircuit.note = note;

        pins.push(pin);
        circuits.set(pinCircuit.circuitId, pinCircuit);
        break;
      }

      case XML_TABLES.circuitProbe: {
        const circuitProbeId = normalizeGuid(fields.CircuitProbeId);
        if (!circuitProbeId) {
          break;
        }
        const rawName = (fields.Name ?? "").trim();
        const isUnnamed = !rawName || rawName.toLowerCase() === circuitProbeId;
        const pinSide = parsePinSide(fields.PinSide, "left");
        const width = Math.max(2, Math.min(40, parseXmlInt(fields.Width, 2)));
        const height = Math.max(2, Math.min(40, parseXmlInt(fields.Height, 2)));
        const isHexAttr = parseXmlBoolean(fields.IsHex, false);
        const rawDisplayFormat = fields.DisplayFormat?.trim().toLowerCase();
        const displayFormat =
          rawDisplayFormat === "dec" || rawDisplayFormat === "hex" || rawDisplayFormat === "bin"
            ? rawDisplayFormat
            : (isHexAttr ? "hex" : "bin");
        const probe = createCircuitProbe(
          circuitProbeId,
          isUnnamed ? "" : rawName,
          pinSide,
          width,
          height,
          displayFormat === "hex",
        );
        probe.displayFormat = displayFormat;
        probe.note = fields.Note ?? "";
        circuitProbes.push(probe);
        circuits.set(probe.circuitId, probe);
        break;
      }

      case XML_TABLES.constant: {
        const constantId = normalizeGuid(fields.ConstantId);
        if (!constantId) {
          break;
        }
        const bitWidth = Math.max(1, Math.min(32, parseXmlInt(fields.BitWidth, 1)));
        const value = parseXmlInt(fields.Value, 0);
        const pinSide = parsePinSide(fields.PinSide, "right");
        const isHex = parseXmlBoolean(fields.IsHex, true);
        const constant = createConstant(constantId, bitWidth, value, pinSide, isHex);
        constant.note = fields.Note ?? "";
        constants.push(constant);
        circuits.set(constant.circuitId, constant);
        break;
      }

      case XML_TABLES.circuitButton: {
        const circuitButtonId = normalizeGuid(fields.CircuitButtonId);
        if (!circuitButtonId) {
          break;
        }
        const notation = fields.Notation ?? "";
        const isToggle = parseXmlBoolean(fields.IsToggle, false);
        const pinSide = parsePinSide(fields.PinSide, "right");
        const inverted = parseXmlBoolean(fields.Inverted, false);
        const width = Math.max(2, Math.min(20, parseXmlInt(fields.Width, 2)));
        const height = Math.max(2, Math.min(20, parseXmlInt(fields.Height, 2)));
        const btn = createCircuitButton(
          circuitButtonId,
          notation,
          isToggle,
          pinSide,
          inverted,
          width,
          height,
          false,
        );
        btn.modifiers = parseXmlInt(fields.Modifiers, 0);
        btn.keyCode = parseXmlInt(fields.KeyCode, 0);
        btn.note = fields.Note ?? "";
        btn.name = notation || (isToggle ? "Schalter" : "Button");
        circuitButtons.push(btn);
        circuits.set(btn.circuitId, btn);
        break;
      }

      case XML_TABLES.memory: {
        const memoryId = normalizeGuid(fields.MemoryId);
        if (!memoryId) {
          break;
        }
        const writable = parseXmlBoolean(fields.Writable, false);
        const writeOn1 = parseXmlBoolean(fields.WriteOn1, false);
        const onStart = parseMemoryOnStart(fields.OnStart, "random");
        const addressBitWidth = Math.max(1, Math.min(16, parseXmlInt(fields.AddressBitWidth, 8)));
        const dataBitWidth = Math.max(1, Math.min(32, parseXmlInt(fields.DataBitWidth, 8)));
        const dualPort = parseXmlBoolean(fields.DualPort, false);
        const data = fields.Data ?? "";
        const note = fields.Note ?? "";
        const memory = createMemory(memoryId, writable, addressBitWidth, dataBitWidth, {
          writeOn1,
          onStart,
          dualPort,
          data,
          note,
        });
        memories.push(memory);
        circuits.set(memory.circuitId, memory);
        break;
      }

      case XML_TABLES.ledMatrix: {
        const ledMatrixId = normalizeGuid(fields.LedMatrixId);
        if (!ledMatrixId) {
          break;
        }
        const matrixType = parseLedMatrixType(fields.MatrixType, "individual");
        const cellShape = parseLedMatrixCellShape(fields.CellShape, "round");
        const rows = Math.max(1, Math.min(10, parseXmlInt(fields.Rows, 4)));
        const columns = Math.max(1, Math.min(10, parseXmlInt(fields.Columns, 4)));
        const colors = Math.max(1, Math.min(3, parseXmlInt(fields.Colors, 1)));
        const rawPersistence = parseXmlInt(fields.PersistenceMultiplier, 1);
        const persistenceMultiplier: 1 | 2 | 3 =
          rawPersistence === 2 || rawPersistence === 3 ? rawPersistence : 1;
        const matrix = createLedMatrix(
          ledMatrixId,
          rows,
          columns,
          matrixType,
          cellShape,
          colors,
          persistenceMultiplier,
        );
        matrix.note = fields.Note ?? "";
        ledMatrices.push(matrix);
        circuits.set(matrix.circuitId, matrix);
        break;
      }

      case XML_TABLES.splitter: {
        const splitterId = normalizeGuid(fields.SplitterId);
        if (!splitterId) {
          break;
        }
        const pinCount = Math.max(2, Math.min(32, parseXmlInt(fields.PinCount, 2)));
        const bitWidth = Math.max(pinCount, Math.min(32, parseXmlInt(fields.BitWidth, pinCount)));
        const clockwise = parseXmlBoolean(fields.Clockwise, false);
        const splitter = createSplitter(splitterId, bitWidth, pinCount, clockwise);
        splitters.push(splitter);
        circuits.set(splitter.circuitId, splitter);
        break;
      }

      case XML_TABLES.sensor: {
        const sensorId = normalizeGuid(fields.SensorId);
        if (!sensorId) {
          break;
        }
        const sensorType = parseSensorType(fields.SensorType, "random");
        const bitWidth = Math.max(1, Math.min(32, parseXmlInt(fields.BitWidth, 1)));
        const pinSide = parsePinSide(fields.PinSide, "right");
        const notation = fields.Notation ?? "";
        const data = fields.Data ?? "";
        const note = fields.Note ?? "";
        const sensor = createSensor(sensorId, sensorType, bitWidth, pinSide, notation, data, note);
        sensors.push(sensor);
        circuits.set(sensor.circuitId, sensor);
        break;
      }

      case XML_TABLES.sound: {
        const soundId = normalizeGuid(fields.SoundId);
        if (!soundId) {
          break;
        }
        const pinSide = parsePinSide(fields.PinSide, "left");
        const notation = fields.Notation ?? "";
        const note = fields.Note ?? "";
        const frequency = Math.max(
          20,
          Math.min(20000, parseXmlFloat(fields.Frequency, SOUND_WEB_DEFAULTS.frequency)),
        );
        const waveform = parseSoundWaveform(fields.Waveform, SOUND_WEB_DEFAULTS.waveform);
        const sound = createSound(soundId, pinSide, notation, note, frequency, waveform);
        sounds.push(sound);
        circuits.set(sound.circuitId, sound);
        break;
      }

      case XML_TABLES.graphicsArray: {
        const graphicsArrayId = normalizeGuid(fields.GraphicsArrayId);
        if (!graphicsArrayId) {
          break;
        }
        const graphicsArray = createGraphicsArray(graphicsArrayId, {
          writeOn1: parseXmlBoolean(fields.WriteOn1, false),
          onStart: parseMemoryOnStart(fields.OnStart, "zeros"),
          dataBitWidth: parseXmlInt(fields.DataBitWidth, 8),
          bitsPerPixel: parseXmlInt(fields.BitsPerPixel, 1),
          width: parseXmlInt(fields.Width, 160),
          height: parseXmlInt(fields.Height, 120),
          zoom: parseXmlInt(fields.Zoom, 1),
          note: fields.Note ?? "",
        });
        graphicsArrays.push(graphicsArray);
        circuits.set(graphicsArray.circuitId, graphicsArray);
        break;
      }

      case XML_TABLES.circuitSymbol: {
        const circuitSymbolId = normalizeGuid(fields.CircuitSymbolId);
        const circuitId = normalizeGuid(fields.CircuitId);
        const logicalCircuitId = normalizeGuid(fields.LogicalCircuitId);
        if (!circuitSymbolId || !circuitId || !logicalCircuitId) {
          break;
        }
        rawSymbols.push({
          circuitSymbolId,
          circuitId,
          logicalCircuitId,
          x: parseXmlInt(fields.X, 0),
          y: parseXmlInt(fields.Y, 0),
          rotation: parseRotation(fields.Rotation, "up"),
          color: fields.Color ? parseDisplayColor(fields.Color, "red") : undefined,
        });
        break;
      }

      case XML_TABLES.wire: {
        const wireId = normalizeGuid(fields.WireId);
        const logicalCircuitId = normalizeGuid(fields.LogicalCircuitId);
        if (!wireId || !logicalCircuitId) {
          break;
        }
        const x1 = parseXmlInt(fields.X1, 0);
        const y1 = parseXmlInt(fields.Y1, 0);
        const x2 = parseXmlInt(fields.X2, 0);
        const y2 = parseXmlInt(fields.Y2, 0);
        // Null-Längen-Leitungen analog zu CircuitProject.Load entfernen
        if (x1 === x2 && y1 === y2) {
          break;
        }
        rawWires.push(createWire(logicalCircuitId, { x: x1, y: y1 }, { x: x2, y: y2 }, wireId));
        break;
      }

      case XML_TABLES.textNote: {
        const textNoteId = normalizeGuid(fields.TextNoteId);
        const logicalCircuitId = normalizeGuid(fields.LogicalCircuitId);
        if (!textNoteId || !logicalCircuitId) {
          break;
        }
        const rawNote = fields.Note ?? "";
        const parsedNote = parseTextNoteContent(rawNote);
        if (!parsedNote.isValid) {
          break;
        }
        const width = Math.max(1, parseXmlInt(fields.Width, 10));
        const height = Math.max(1, parseXmlInt(fields.Height, 10));
        rawTextNotes.push({
          textNoteId,
          logicalCircuitId,
          x: parseXmlInt(fields.X, 0),
          y: parseXmlInt(fields.Y, 0),
          width,
          height,
          note: parsedNote.text,
          rotation: parseRotation(fields.Rotation, "up"),
          lineHeight: parseTextNoteLineHeight(fields.LineHeight),
          fontFamily: parseTextNoteFontFamily(fields.FontFamily),
          lineHeights: parseLineHeights(fields.LineHeights),
        });
        break;
      }

      default:
        break;
    }
  }

  if (!allowPartialSnippet) {
    if (projects.length > 1) {
      throw new Error("Ungültige Projektdatei: Es darf nur genau ein Project-Datensatz enthalten sein.");
    }
    if (projects.length === 0) {
      throw new Error("Ungültige Projektdatei: Es wurde kein Project-Datensatz gefunden.");
    }
    if (logicalCircuits.length === 0) {
      throw new Error("Ungültige Projektdatei: Es wurde keine LogicalCircuit-Schaltung gefunden.");
    }
  }

  const logicalCircuitById = new Map(logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]));

  // Symbole auf bestehende Circuits oder deterministische Gate-GUIDs auflösen
  const resolvedSymbols: CircuitSymbol[] = [];
  for (const rawSym of rawSymbols) {
    if (!logicalCircuitById.has(rawSym.logicalCircuitId)) {
      continue;
    }

    const legacyTranslation = translateLegacyGateGuid(rawSym.circuitId);
    const parsedGate =
      legacyTranslation.kind === "gate" ? parseGateGuid(legacyTranslation.gateId) : null;
    // Bei LEDs mit expliziter Farbe muss die farbabhängige Gate-ID statt der roten Basis-GUID aufgelöst werden.
    const isColoredLedOverride = Boolean(rawSym.color && parsedGate?.gateType === "led");

    let targetCircuit = isColoredLedOverride ? undefined : circuits.get(rawSym.circuitId);
    if (!targetCircuit) {
      if (legacyTranslation.kind === "legacyProbe") {
        const migratedProbe = createCircuitProbe(rawSym.circuitSymbolId, "", "left");
        circuitProbes.push(migratedProbe);
        circuits.set(migratedProbe.circuitId, migratedProbe);
        targetCircuit = migratedProbe;
      } else if (parsedGate) {
        const color: DisplayColor =
          parsedGate.gateType === "led"
            ? (rawSym.color ?? extractLedColorFromGateId(rawSym.circuitId))
            : "red";
        const gate = createGate(
          parsedGate.gateType,
          parsedGate.inputCount,
          parsedGate.invertedOutput,
          color,
        );
        const existingGate = gates.get(gate.circuitId);
        targetCircuit = existingGate ?? gate;
        gates.set(gate.circuitId, targetCircuit as Gate);
        circuits.set(gate.circuitId, targetCircuit);
      }
    }

    if (!targetCircuit) {
      continue;
    }

    resolvedSymbols.push(
      createCircuitSymbol(
        targetCircuit,
        rawSym.logicalCircuitId,
        rawSym.x,
        rawSym.y,
        rawSym.rotation,
        rawSym.circuitSymbolId,
      ),
    );
  }

  // DistinctSymbol-Bereinigung analog zu CircuitProject.Load: jedes Einzel-Bauteil besitzt genau ein CircuitSymbol
  const singleInstanceKinds = new Set([
    "pin",
    "circuitProbe",
    "constant",
    "circuitButton",
    "memory",
    "ledMatrix",
    "splitter",
    "sensor",
    "sound",
    "synthesizer",
    "graphicsArray",
  ]);

  const seenSingleCircuitIds = new Set<string>();
  const deduplicatedSymbols: CircuitSymbol[] = [];
  for (const sym of resolvedSymbols) {
    if (sym.circuit.kind && singleInstanceKinds.has(sym.circuit.kind)) {
      if (seenSingleCircuitIds.has(sym.circuitId)) {
        continue;
      }
      seenSingleCircuitIds.add(sym.circuitId);
    }
    deduplicatedSymbols.push(sym);
  }

  // Verwaiste Einzel-Circuits entfernen (keine Referenz durch ein CircuitSymbol)
  const filterOrphanedCircuits = <T extends { circuitId: string }>(items: T[]): T[] => {
    const kept: T[] = [];
    for (const item of items) {
      if (seenSingleCircuitIds.has(item.circuitId)) {
        kept.push(item);
      } else {
        circuits.delete(item.circuitId);
      }
    }
    return kept;
  };

  // Bei Pins ist pinId die Circuit-ID des Pin-Symbols und circuitId die ID des besitzenden LogicalCircuit
  const validPins: Pin[] = [];
  for (const pin of pins) {
    if (seenSingleCircuitIds.has(pin.pinId) && logicalCircuitById.has(pin.circuitId)) {
      validPins.push(pin);
    } else {
      circuits.delete(pin.pinId);
    }
  }

  const validProbes = filterOrphanedCircuits(circuitProbes);
  const validConstants = filterOrphanedCircuits(constants);
  const validButtons = filterOrphanedCircuits(circuitButtons);
  const validMemories = filterOrphanedCircuits(memories);
  const validLedMatrices = filterOrphanedCircuits(ledMatrices);
  const validSplitters = filterOrphanedCircuits(splitters);
  const validSensors = filterOrphanedCircuits(sensors);
  const validSounds = filterOrphanedCircuits(sounds);
  const validGraphicsArrays = filterOrphanedCircuits(graphicsArrays);

  // CollapsedCategory-Einträge bereinigen analog zu CollapsedCategorySet.Purge
  const usedCategories = new Set(logicalCircuits.map((lc) => lc.category));
  const validCollapsedCategories = collapsedCategories.filter((c) => usedCategories.has(c.name));

  // Leitungen und Textnotizen auf gültige LogicalCircuits filtern
  const validWires = rawWires.filter((w) => logicalCircuitById.has(w.logicalCircuitId));
  const validTextNotes = rawTextNotes.filter((n) => logicalCircuitById.has(n.logicalCircuitId));

  // Entitäten ihren jeweiligen LogicalCircuits zuordnen
  const populatedCircuits = logicalCircuits.map((lc) => {
    const lcSymbols = deduplicatedSymbols.filter((s) => s.logicalCircuitId === lc.logicalCircuitId);
    const lcWires = validWires.filter((w) => w.logicalCircuitId === lc.logicalCircuitId);
    const lcNotes = validTextNotes.filter((n) => n.logicalCircuitId === lc.logicalCircuitId);
    const lcPins = validPins.filter((p) => p.circuitId === lc.logicalCircuitId);
    return {
      ...lc,
      circuitSymbols: lcSymbols,
      wires: lcWires,
      textNotes: lcNotes,
      logicalPins: lcPins,
    };
  });

  // Aktiven und Startup-Schaltplan validieren
  const fallbackCircuitId = populatedCircuits[0]?.logicalCircuitId ?? "";
  const baseProject: Project = projects[0] ?? {
    projectId: "snippet-project",
    name: PROJECT_DEFAULTS.name,
    note: "",
    zoom: 1,
    frequency: 10,
    isMaximumSpeed: false,
    logicalCircuitId: fallbackCircuitId,
    startupCircuitId: undefined,
    categoryTextNoteCollapsed: false,
    categoryInputOutputCollapsed: false,
    categoryPrimitivesCollapsed: false,
  };

  const finalLogicalCircuitId = logicalCircuitById.has(baseProject.logicalCircuitId)
    ? baseProject.logicalCircuitId
    : fallbackCircuitId;
  const finalStartupCircuitId =
    baseProject.startupCircuitId && logicalCircuitById.has(baseProject.startupCircuitId)
      ? baseProject.startupCircuitId
      : undefined;

  const assembledProject: CircuitProject = {
    project: {
      ...baseProject,
      logicalCircuitId: finalLogicalCircuitId,
      startupCircuitId: finalStartupCircuitId,
    },
    collapsedCategories: validCollapsedCategories,
    circuits,
    logicalCircuits: populatedCircuits,
    gates,
    pins: validPins,
    devicePins: [],
    constants: validConstants,
    circuitButtons: validButtons,
    circuitProbes: validProbes,
    splitters: validSplitters,
    memories: validMemories,
    ledMatrices: validLedMatrices,
    sensors: validSensors,
    sounds: validSounds,
    synthesizers,
    graphicsArrays: validGraphicsArrays,
    circuitSymbols: deduplicatedSymbols,
    wires: validWires,
    textNotes: validTextNotes,
  };

  return rebuildImportedProjectLayout(assembledProject);
}

export const importProjectFromXml = parseLogicCircuitXml;

// Prüft, ob der Dateiname eine unterstützte .CircuitProject- oder .xml-Endung besitzt
export function isSupportedLogicCircuitFile(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return (
    lower.endsWith(".circuitproject") ||
    lower.endsWith(".xml")
  );
}

// Liest den Textinhalt einer hochgeladenen/abgelegten Datei browser- und testkompatibel aus
export async function readLogicCircuitFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Datei konnte nicht gelesen werden."));
    reader.readAsText(file);
  });
}

// Parst ein XML-Zwischenablage-Snippet (Clipboard) tolerant als Teil-Projekt
export function parseLogicCircuitSnippetXml(xmlText: string): CircuitProject {
  return parseLogicCircuitXml(xmlText, { allowPartialSnippet: true });
}
