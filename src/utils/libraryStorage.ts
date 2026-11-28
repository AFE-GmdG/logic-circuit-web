import type Project from "../types/circuit/project";
import type CircuitLibraryDocument from "../types/storage/circuitLibrary";
import type {
  LibraryPersistenceState,
  LibraryProjectCircuitCandidate,
} from "../types/storage/circuitLibrary";
import {
  LIBRARY_FILE_EXTENSION,
  LIBRARY_FORMAT,
} from "../types/storage/circuitLibrary";
import type { NativeLogicalCircuit } from "../types/storage/nativeProjectFormat";
import { NATIVE_PROJECT_SCHEMA_VERSION } from "../types/storage/nativeProjectFormat";

import {
  type FileSystemDeps,
  type FileSystemDirectoryHandleLike,
  type FileSystemFileHandleLike,
  isFileSystemAccessSupported,
  loadLibraryCacheRecord,
  loadLibraryFileHandle,
  openLibraryFileWithPicker,
  queryHandlePermission,
  requestHandlePermission,
  saveLibraryCacheRecord,
  saveLibraryFileHandle,
  saveLibraryFileWithFileSystem,
  writeProjectToFileHandle,
} from "./fileSystemStorage";
import {
  buildCircuitProjectFromNativeCircuits,
  parseNativeDocumentHeader,
  parseNativeJsonObject,
  parseNativeLogicalCircuits,
  parseNativeProjectDocument,
} from "./storage/nativeProjectReader";
import {
  type NativeProjectSerializeOptions,
  buildNativeProjectDocument,
  buildNativeProjectDocumentFromCircuits,
  resolveNativeAppVersion,
} from "./storage/nativeProjectWriter";
import {
  detectProjectFileFormat,
  parseProjectFileText,
} from "./storage/projectFileUtils";
import { serializeCircuitProjectToXml } from "./xml/logicCircuitXmlWriter";

// Erstellt ein flaches, versioniertes CircuitLibraryDocument aus einem Schaltungs-Array
export function buildCircuitLibraryDocument(
  logicalCircuits: readonly NativeLogicalCircuit[],
  options?: { appVersion?: string },
): CircuitLibraryDocument {
  return {
    format: LIBRARY_FORMAT,
    schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION,
    appVersion: resolveNativeAppVersion(options?.appVersion),
    logicalCircuits: [...logicalCircuits],
  };
}

// Serialisiert ein Bibliotheks-Dokument oder Schaltungs-Array als .lclib-JSON
export function serializeCircuitLibrary(
  docOrCircuits: CircuitLibraryDocument | readonly NativeLogicalCircuit[],
  options?: NativeProjectSerializeOptions,
): string {
  const doc = Array.isArray(docOrCircuits)
    ? buildCircuitLibraryDocument(docOrCircuits, options)
    : (docOrCircuits as CircuitLibraryDocument);
  const indent = options?.pretty === false ? undefined : 2;
  return JSON.stringify(doc, null, indent);
}

// Parst und validiert ein .lclib-Bibliotheksdokument inklusive Subschaltungs- und Zyklusprüfung
export function parseCircuitLibraryDocument(jsonText: string): CircuitLibraryDocument {
  const root = parseNativeJsonObject(jsonText);
  const header = parseNativeDocumentHeader(root, [LIBRARY_FORMAT]);
  const logicalCircuits = parseNativeLogicalCircuits(root.logicalCircuits, {
    allowEmpty: true,
  });

  return {
    format: LIBRARY_FORMAT,
    schemaVersion: header.schemaVersion,
    appVersion: header.appVersion,
    logicalCircuits,
  };
}

// Prüft schnell und sicher, ob ein Text ein .lclib-Bibliotheksdokument enthält
export function isCircuitLibraryJson(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).format === LIBRARY_FORMAT
    );
  } catch {
    return false;
  }
}

// Prüft, ob ein Dateiname eine unterstützte Bibliotheksendung besitzt
export function isSupportedLibraryFile(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return lower.endsWith(LIBRARY_FILE_EXTENSION) || lower.endsWith(".json");
}

// Erzeugt einen sicheren Dateinamen im Format <name>.lclib
export function buildLibraryFileName(baseName = "CircuitLibrary"): string {
  const sanitized = baseName.trim().replace(/[/\\?%*:|"<>]/g, "_");
  const withoutKnownExtension = sanitized
    .replace(/\.(lclib|lcweb|circuitproject|xml|json)$/i, "")
    .trim();
  const resolvedBase = withoutKnownExtension.length > 0 ? withoutKnownExtension : "CircuitLibrary";
  return `${resolvedBase}${LIBRARY_FILE_EXTENSION}`;
}

function tryParseCachedLibrary(content: string | null | undefined): {
  document: CircuitLibraryDocument | null;
  errorReason?: string;
} {
  if (!content) {
    return { document: null };
  }
  try {
    return { document: parseCircuitLibraryDocument(content) };
  } catch (error) {
    return {
      document: null,
      errorReason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readAndSyncFromHandle(
  handle: FileSystemFileHandleLike,
  deps?: FileSystemDeps,
): Promise<LibraryPersistenceState> {
  const file = await handle.getFile();
  const content = await file.text();
  const document = parseCircuitLibraryDocument(content);
  const fileName = file.name || handle.name;
  const now = Date.now();

  await saveLibraryCacheRecord({ fileName, content, cachedAt: now }, deps);

  return {
    status: "synced",
    isReadOnly: false,
    fileName,
    handle,
    cachedAt: now,
    lastSyncedAt: now,
    document,
  };
}

// Lädt den initialen Bibliothekszustand (FSA-Datei hat Vorrang; bei Prompt/Unsupported Read-Only-Cache)
export async function loadInitialLibraryState(
  deps?: FileSystemDeps,
): Promise<LibraryPersistenceState> {
  const [handleRecord, cacheRecord] = await Promise.all([
    loadLibraryFileHandle(deps),
    loadLibraryCacheRecord(deps),
  ]);
  const cached = tryParseCachedLibrary(cacheRecord?.content);
  const fsaSupported = isFileSystemAccessSupported(deps);

  if (!fsaSupported) {
    if (!cacheRecord) {
      return {
        status: "uninitialized",
        isReadOnly: true,
        fileName: null,
        cachedAt: null,
        lastSyncedAt: null,
        document: null,
      };
    }
    return {
      status: "unsupported",
      isReadOnly: true,
      fileName: cacheRecord.fileName,
      cachedAt: cacheRecord.cachedAt,
      lastSyncedAt: null,
      document: cached.document,
      errorReason: cached.errorReason,
    };
  }

  if (!handleRecord?.handle) {
    if (!cacheRecord) {
      return {
        status: "uninitialized",
        isReadOnly: true,
        fileName: null,
        cachedAt: null,
        lastSyncedAt: null,
        document: null,
      };
    }
    return {
      status: "handle-invalid",
      isReadOnly: true,
      fileName: cacheRecord.fileName,
      cachedAt: cacheRecord.cachedAt,
      lastSyncedAt: null,
      document: cached.document,
      errorReason: cached.errorReason,
    };
  }

  const permission = await queryHandlePermission(handleRecord.handle, "readwrite");
  if (permission === "granted") {
    try {
      return await readAndSyncFromHandle(handleRecord.handle, deps);
    } catch (error) {
      return {
        status: "handle-invalid",
        isReadOnly: true,
        fileName: handleRecord.fileName,
        cachedAt: cacheRecord?.cachedAt ?? null,
        lastSyncedAt: null,
        document: cached.document,
        errorReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (permission === "prompt") {
    return {
      status: "needs-permission",
      isReadOnly: true,
      fileName: handleRecord.fileName,
      handle: handleRecord.handle,
      cachedAt: cacheRecord?.cachedAt ?? null,
      lastSyncedAt: null,
      document: cached.document,
      errorReason: cached.errorReason,
    };
  }

  return {
    status: "handle-invalid",
    isReadOnly: true,
    fileName: handleRecord.fileName,
    handle: handleRecord.handle,
    cachedAt: cacheRecord?.cachedAt ?? null,
    lastSyncedAt: null,
    document: cached.document,
    errorReason: cached.errorReason,
  };
}

// Reaktiviert per Benutzer-Geste die Schreibberechtigung; beim Resync gewinnt immer die lokale Datei
export async function resyncLibraryWithPermission(
  deps?: FileSystemDeps,
  existingHandle?: FileSystemFileHandleLike | null,
): Promise<LibraryPersistenceState> {
  const [handleRecord, cacheRecord] = await Promise.all([
    loadLibraryFileHandle(deps),
    loadLibraryCacheRecord(deps),
  ]);
  const cached = tryParseCachedLibrary(cacheRecord?.content);
  const targetHandle = handleRecord?.handle ?? existingHandle ?? null;
  const targetFileName = handleRecord?.fileName ?? existingHandle?.name ?? cacheRecord?.fileName ?? null;

  if (!targetHandle) {
    return {
      status: cacheRecord ? "handle-invalid" : "uninitialized",
      isReadOnly: true,
      fileName: targetFileName,
      handle: null,
      cachedAt: cacheRecord?.cachedAt ?? null,
      lastSyncedAt: null,
      document: cached.document,
      errorReason: cached.errorReason,
    };
  }

  const permission = await requestHandlePermission(targetHandle, "readwrite");
  if (permission !== "granted") {
    return {
      status: permission === "prompt" ? "needs-permission" : "handle-invalid",
      isReadOnly: true,
      fileName: targetFileName,
      handle: targetHandle,
      cachedAt: cacheRecord?.cachedAt ?? null,
      lastSyncedAt: null,
      document: cached.document,
      errorReason: cached.errorReason,
    };
  }

  try {
    return await readAndSyncFromHandle(targetHandle, deps);
  } catch (error) {
    return {
      status: "handle-invalid",
      isReadOnly: true,
      fileName: targetFileName,
      handle: targetHandle,
      cachedAt: cacheRecord?.cachedAt ?? null,
      lastSyncedAt: null,
      document: cached.document,
      errorReason: error instanceof Error ? error.message : String(error),
    };
  }
}

// Öffnet eine bestehende .lclib-Bibliotheksdatei per File-Picker, verknüpft das Handle und aktualisiert den Cache
export async function openAndLinkLibraryFile(
  options?: { startInHandle?: FileSystemDirectoryHandleLike | null },
  deps?: FileSystemDeps,
): Promise<LibraryPersistenceState | { status: "cancelled" }> {
  const picked = await openLibraryFileWithPicker(options?.startInHandle, deps);
  if (picked.kind === "cancelled") {
    return { status: "cancelled" };
  }
  if (picked.kind === "unsupported") {
    return loadInitialLibraryState(deps);
  }

  const document = parseCircuitLibraryDocument(picked.content);
  const permission = await requestHandlePermission(picked.handle, "readwrite");
  const now = Date.now();

  await saveLibraryFileHandle(picked.handle, deps);
  await saveLibraryCacheRecord({
    fileName: picked.fileName,
    content: picked.content,
    cachedAt: now,
  }, deps);

  if (permission !== "granted") {
    return {
      status: permission === "prompt" ? "needs-permission" : "handle-invalid",
      isReadOnly: true,
      fileName: picked.fileName,
      handle: picked.handle,
      cachedAt: now,
      lastSyncedAt: null,
      document,
    };
  }

  return {
    status: "synced",
    isReadOnly: false,
    fileName: picked.fileName,
    handle: picked.handle,
    cachedAt: now,
    lastSyncedAt: now,
    document,
  };
}

// Legt eine neue .lclib-Bibliotheksdatei per Save-Picker an und verknüpft sie dauerhaft
export async function createAndLinkLibraryFile(
  options?: {
    suggestedName?: string;
    initialDocument?: CircuitLibraryDocument;
    startInHandle?: FileSystemDirectoryHandleLike | null;
  },
  deps?: FileSystemDeps,
): Promise<LibraryPersistenceState | { status: "cancelled" }> {
  const doc = options?.initialDocument ?? buildCircuitLibraryDocument([]);
  const content = serializeCircuitLibrary(doc);
  const suggestedName = buildLibraryFileName(options?.suggestedName);

  const saved = await saveLibraryFileWithFileSystem(
    content,
    suggestedName,
    {
      forceSaveAs: true,
      startInHandle: options?.startInHandle,
    },
    deps,
  );

  if (saved.kind === "cancelled") {
    return { status: "cancelled" };
  }
  if (saved.kind === "fallback-required") {
    return loadInitialLibraryState(deps);
  }

  const now = Date.now();
  await saveLibraryFileHandle(saved.handle, deps);
  await saveLibraryCacheRecord({
    fileName: saved.fileName,
    content,
    cachedAt: now,
  }, deps);

  return {
    status: "synced",
    isReadOnly: false,
    fileName: saved.fileName,
    handle: saved.handle,
    cachedAt: now,
    lastSyncedAt: now,
    document: doc,
  };
}

// Schreibt das aktuelle Bibliotheks-Dokument in die verknüpfte .lclib-Datei (verweigert reine Cache-Schreibvorgänge)
export async function saveLibraryDocumentToLinkedFile(
  doc: CircuitLibraryDocument,
  options?: {
    requestPermission?: boolean;
    existingHandle?: FileSystemFileHandleLike | null;
    existingFileName?: string | null;
  },
  deps?: FileSystemDeps,
): Promise<LibraryPersistenceState> {
  const [handleRecord, cacheRecord] = await Promise.all([
    loadLibraryFileHandle(deps),
    loadLibraryCacheRecord(deps),
  ]);
  const cached = tryParseCachedLibrary(cacheRecord?.content);
  const targetHandle = handleRecord?.handle ?? options?.existingHandle ?? null;
  const targetFileName =
    handleRecord?.fileName ??
    options?.existingHandle?.name ??
    options?.existingFileName ??
    cacheRecord?.fileName ??
    null;

  if (!targetHandle) {
    return {
      status: cacheRecord ? "handle-invalid" : "uninitialized",
      isReadOnly: true,
      fileName: targetFileName,
      handle: null,
      cachedAt: cacheRecord?.cachedAt ?? null,
      lastSyncedAt: null,
      document: cached.document,
    };
  }

  // Falls der Handle-Store leer war, das aktive Handle nachträglich erneut sichern
  if (!handleRecord?.handle && options?.existingHandle) {
    await saveLibraryFileHandle(options.existingHandle, deps);
  }

  const allowPrompt = options?.requestPermission !== false;
  const currentPermission = await queryHandlePermission(targetHandle, "readwrite");
  if (currentPermission !== "granted" && !allowPrompt) {
    return {
      status: currentPermission === "prompt" ? "needs-permission" : "handle-invalid",
      isReadOnly: true,
      fileName: targetFileName,
      handle: targetHandle,
      cachedAt: cacheRecord?.cachedAt ?? null,
      lastSyncedAt: null,
      document: cached.document,
    };
  }

  const content = serializeCircuitLibrary(doc);
  try {
    const ok = await writeProjectToFileHandle(targetHandle, content);
    if (!ok) {
      const nextPermission = await queryHandlePermission(targetHandle, "readwrite");
      return {
        status: nextPermission === "prompt" ? "needs-permission" : "handle-invalid",
        isReadOnly: true,
        fileName: targetFileName,
        handle: targetHandle,
        cachedAt: cacheRecord?.cachedAt ?? null,
        lastSyncedAt: null,
        document: cached.document,
      };
    }
  } catch (error) {
    return {
      status: "handle-invalid",
      isReadOnly: true,
      fileName: targetFileName,
      handle: targetHandle,
      cachedAt: cacheRecord?.cachedAt ?? null,
      lastSyncedAt: null,
      document: cached.document,
      errorReason: error instanceof Error ? error.message : String(error),
    };
  }

  const now = Date.now();
  await saveLibraryCacheRecord({
    fileName: targetFileName,
    content,
    cachedAt: now,
  }, deps);

  return {
    status: "synced",
    isReadOnly: false,
    fileName: targetFileName,
    handle: targetHandle,
    cachedAt: now,
    lastSyncedAt: now,
    document: doc,
  };
}

// Löst die Verknüpfung zur lokalen Bibliotheksdatei und leert optional auch den Read-Only-Cache
export async function unlinkLibraryFile(
  options?: { clearCache?: boolean },
  deps?: FileSystemDeps,
): Promise<LibraryPersistenceState> {
  await saveLibraryFileHandle(null, deps);
  if (options?.clearCache) {
    await saveLibraryCacheRecord(null, deps);
  }
  return loadInitialLibraryState(deps);
}

// Sammelt eine oder mehrere Schaltungen samt allen transitiv referenzierten Sub-Schaltungen (zyklussicher)
export function collectTransitiveNativeCircuits(
  allCircuits: readonly NativeLogicalCircuit[],
  rootCircuitIds: readonly string[],
): NativeLogicalCircuit[] {
  const byId = new Map(allCircuits.map((lc) => [lc.logicalCircuitId, lc]));
  const collected: NativeLogicalCircuit[] = [];
  const visited = new Set<string>();

  const visit = (circuitId: string): void => {
    if (visited.has(circuitId)) {
      return;
    }
    const lc = byId.get(circuitId);
    if (!lc) {
      throw new Error(`Schaltplan "${circuitId}" wurde nicht gefunden.`);
    }
    visited.add(circuitId);
    collected.push(lc);

    for (const elem of lc.elements) {
      if (elem.kind === "subCircuit") {
        visit(elem.logicalCircuitId);
      }
    }
  };

  for (const rootId of rootCircuitIds) {
    visit(rootId);
  }

  return collected;
}

// Exportiert eine ausgewählte Bibliotheksschaltung samt ihren Sub-Schaltungen als natives .lcweb-Projekt
export function exportLibraryCircuitAsNativeProject(
  allCircuits: readonly NativeLogicalCircuit[],
  rootCircuitId: string,
  options?: NativeProjectSerializeOptions,
): string {
  const circuits = collectTransitiveNativeCircuits(allCircuits, [rootCircuitId]);
  const doc = buildNativeProjectDocumentFromCircuits(circuits, rootCircuitId, options);
  const indent = options?.pretty === false ? undefined : 2;
  return JSON.stringify(doc, null, indent);
}

// Exportiert eine ausgewählte Bibliotheksschaltung samt ihren Sub-Schaltungen als .CircuitProject-XML
export function exportLibraryCircuitAsDesktopXml(
  allCircuits: readonly NativeLogicalCircuit[],
  rootCircuitId: string,
): string {
  const circuits = collectTransitiveNativeCircuits(allCircuits, [rootCircuitId]);
  const rootCircuit = circuits[0];
  const projectMeta: Project = {
    projectId: rootCircuit.logicalCircuitId,
    name: rootCircuit.name,
    note: rootCircuit.note,
    zoom: 1,
    frequency: 10,
    isMaximumSpeed: false,
    logicalCircuitId: rootCircuit.logicalCircuitId,
    startupCircuitId: undefined,
    categoryTextNoteCollapsed: false,
    categoryInputOutputCollapsed: false,
    categoryPrimitivesCollapsed: false,
  };
  const project = buildCircuitProjectFromNativeCircuits(projectMeta, [], circuits);
  return serializeCircuitProjectToXml(project);
}

function extractNativeCircuitsFromProjectText(rawText: string): {
  sourceFormat: "native" | "xml";
  rootCircuitId: string;
  logicalCircuits: NativeLogicalCircuit[];
} {
  const detected = detectProjectFileFormat(rawText);
  if (detected === "native") {
    const raw = parseNativeJsonObject(rawText);
    const doc = parseNativeProjectDocument(raw);
    return {
      sourceFormat: "native",
      rootCircuitId: doc.project.logicalCircuitId,
      logicalCircuits: doc.logicalCircuits,
    };
  }
  if (detected === "xml") {
    const parsed = parseProjectFileText(rawText);
    const doc = buildNativeProjectDocument(parsed.project);
    return {
      sourceFormat: "xml",
      rootCircuitId: doc.project.logicalCircuitId,
      logicalCircuits: doc.logicalCircuits,
    };
  }

  // Löst die lokalisierte Format-Fehlermeldung von parseProjectFileText aus
  parseProjectFileText(rawText);
  return {
    sourceFormat: "native",
    rootCircuitId: "",
    logicalCircuits: [],
  };
}

// Listet alle Schaltungen eines .lcweb- oder .CircuitProject-Dokuments inklusive transitiver Abhängigkeiten auf
export function listProjectCircuitCandidates(rawText: string): LibraryProjectCircuitCandidate[] {
  const { rootCircuitId, logicalCircuits } = extractNativeCircuitsFromProjectText(rawText);
  return logicalCircuits.map((lc) => {
    const transitive = collectTransitiveNativeCircuits(logicalCircuits, [lc.logicalCircuitId]);
    return {
      logicalCircuitId: lc.logicalCircuitId,
      name: lc.name,
      category: lc.category,
      note: lc.note,
      isProjectRoot: lc.logicalCircuitId === rootCircuitId,
      transitiveCircuitIds: transitive.map((item) => item.logicalCircuitId),
    };
  });
}

// Extrahiert ausgewählte (oder alle) Schaltungen samt Sub-Schaltungen aus einer .lcweb- oder .CircuitProject-Datei
export function importCircuitsFromProjectText(
  rawText: string,
  selectedCircuitIds?: readonly string[],
): NativeLogicalCircuit[] {
  const { logicalCircuits } = extractNativeCircuitsFromProjectText(rawText);
  if (!selectedCircuitIds) {
    return logicalCircuits;
  }
  return collectTransitiveNativeCircuits(logicalCircuits, selectedCircuitIds);
}

// Importiert Schaltungen wahlweise aus einer .lclib-Bibliothek, einer .lcweb-Datei oder einem .CircuitProject-XML
export function importCircuitsFromFileText(
  rawText: string,
  selectedCircuitIds?: readonly string[],
): {
  sourceFormat: "library" | "native" | "xml";
  logicalCircuits: NativeLogicalCircuit[];
} {
  if (isCircuitLibraryJson(rawText)) {
    const lib = parseCircuitLibraryDocument(rawText);
    const logicalCircuits = selectedCircuitIds
      ? collectTransitiveNativeCircuits(lib.logicalCircuits, selectedCircuitIds)
      : lib.logicalCircuits;
    return {
      sourceFormat: "library",
      logicalCircuits,
    };
  }

  const { sourceFormat, logicalCircuits } = extractNativeCircuitsFromProjectText(rawText);
  return {
    sourceFormat,
    logicalCircuits: selectedCircuitIds
      ? collectTransitiveNativeCircuits(logicalCircuits, selectedCircuitIds)
      : logicalCircuits,
  };
}
