import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";

// Liest einen optionalen String-Parameter mit Typprüfung
export function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Parameter "${key}" muss ein String sein.`);
  }
  return value;
}

// Liest einen erforderlichen nicht-leeren String-Parameter
export function readRequiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Parameter "${key}" muss ein nicht-leerer String sein.`);
  }
  return value;
}

// Liest eine optionale endliche Zahl mit optionaler Bereichsprüfung
export function readOptionalNumber(
  params: Record<string, unknown>,
  key: string,
  min?: number,
  max?: number,
): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Parameter "${key}" muss eine Zahl sein.`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`Parameter "${key}" muss mindestens ${min} sein.`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`Parameter "${key}" darf höchstens ${max} sein.`);
  }
  return value;
}

// Liest eine erforderliche endliche Zahl mit optionaler Bereichsprüfung
export function readRequiredNumber(
  params: Record<string, unknown>,
  key: string,
  min?: number,
  max?: number,
): number {
  const value = readOptionalNumber(params, key, min, max);
  if (value === undefined) {
    throw new Error(`Parameter "${key}" ist erforderlich und muss eine Zahl sein.`);
  }
  return value;
}

// Liest eine optionale Ganzzahl mit optionaler Bereichsprüfung
export function readOptionalInteger(
  params: Record<string, unknown>,
  key: string,
  min?: number,
  max?: number,
): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new Error(`Parameter "${key}" muss eine Ganzzahl sein.`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`Parameter "${key}" muss mindestens ${min} sein.`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`Parameter "${key}" darf höchstens ${max} sein.`);
  }
  return value;
}

// Liest eine erforderliche Ganzzahl
export function readRequiredInteger(params: Record<string, unknown>, key: string): number {
  const value = readOptionalInteger(params, key);
  if (value === undefined) {
    throw new Error(`Parameter "${key}" ist erforderlich und muss eine Ganzzahl sein.`);
  }
  return value;
}

// Liest einen optionalen Boolean-Parameter
export function readOptionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Parameter "${key}" muss ein Boolean sein.`);
  }
  return value;
}

// Liest einen optionalen Enum-Parameter
export function readOptionalEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Parameter "${key}" muss einer der Werte [${allowed.join(", ")}] sein.`);
  }
  return value as T;
}

// Liest ein optionales String-Array mit Prüfung auf nicht-leere Strings
export function readOptionalStringArray(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Parameter "${key}" muss ein Array aus Strings sein.`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`Alle Einträge in "${key}" müssen nicht-leere Strings sein.`);
    }
  }
  return value;
}

// Ermittelt den aktuellsten Editor-Snapshot (falls Live-Getter über Context-Aktionen bereitstehen)
export function resolveLiveSnapshot(snapshot: McpCircuitSnapshot): McpCircuitSnapshot {
  const project = snapshot.actions?.getProject ? snapshot.actions.getProject() : snapshot.project;
  const currentCircuit = snapshot.actions?.getCurrentCircuit
    ? snapshot.actions.getCurrentCircuit()
    : snapshot.currentCircuit;
  return {
    ...snapshot,
    project,
    currentCircuit,
  };
}

// Ermittelt die angefragte Schaltung oder fällt auf die aktive Schaltung zurück
export function resolveCircuit(snapshot: McpCircuitSnapshot, circuitId?: string): LogicalCircuit {
  const live = resolveLiveSnapshot(snapshot);
  if (!circuitId) {
    return live.currentCircuit;
  }
  const circuit = live.project.logicalCircuits.find((lc) => lc.logicalCircuitId === circuitId);
  if (!circuit) {
    const known = live.project.logicalCircuits.map((lc) => lc.logicalCircuitId).join(", ");
    throw new Error(`Schaltung "${circuitId}" nicht gefunden. Verfügbare IDs: ${known}`);
  }
  return circuit;
}
