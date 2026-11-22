import type CircuitProject from "../../types/circuit/circuitProject";

import i18n from "../../i18n";

import {
  isSupportedNativeProjectFile,
  parseNativeProject,
} from "./nativeProjectReader";
import {
  isSupportedLogicCircuitFile,
  parseLogicCircuitXml,
  readLogicCircuitFileText,
} from "../xml/logicCircuitXmlReader";

export type DetectedProjectFormat = "native" | "xml";

export type ParsedProjectFileResult = {
  project: CircuitProject;
  format: DetectedProjectFormat;
};

// Erkennt das Dateiformat anhand des führenden Inhaltszeichens (JSON vs. XML)
export function detectProjectFileFormat(rawText: string): DetectedProjectFormat | null {
  const trimmed = rawText.trimStart();
  if (trimmed.startsWith("{")) {
    return "native";
  }
  if (trimmed.startsWith("<")) {
    return "xml";
  }
  return null;
}

// Parst eine Projektdatei automatisch als natives Web-JSON oder LogicCircuit-XML
export function parseProjectFileText(rawText: string): ParsedProjectFileResult {
  if (!rawText || !rawText.trim()) {
    throw new Error(i18n.t("errors.projectFile.emptyFile"));
  }

  const format = detectProjectFileFormat(rawText);
  if (format === "native") {
    return {
      project: parseNativeProject(rawText),
      format: "native",
    };
  }
  if (format === "xml") {
    return {
      project: parseLogicCircuitXml(rawText),
      format: "xml",
    };
  }

  throw new Error(i18n.t("errors.projectFile.unknownFormat"));
}

// Prüft, ob der Dateiname eine unterstützte native oder Desktop-Projektendung besitzt
export function isSupportedProjectFile(fileName: string): boolean {
  return isSupportedNativeProjectFile(fileName) || isSupportedLogicCircuitFile(fileName);
}

// Liest den Textinhalt einer ausgewählten/abgelegten Projektdatei aus
export async function readProjectFileText(file: File): Promise<string> {
  return readLogicCircuitFileText(file);
}
