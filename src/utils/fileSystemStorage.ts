import i18n from "../i18n";

export type FileSystemPermissionMode = "read" | "readwrite";

export type FileSystemPermissionStatus = "granted" | "prompt" | "denied" | "unsupported";

export type FileSystemWritableStreamLike = {
  write: (data: string | BufferSource | Blob) => Promise<void>;
  close: () => Promise<void>;
};

export type FileSystemHandleLike = {
  kind: "file" | "directory";
  name: string;
  isSameEntry?: (other: FileSystemHandleLike) => Promise<boolean>;
  queryPermission?: (descriptor?: { mode?: FileSystemPermissionMode }) => Promise<"granted" | "prompt" | "denied">;
  requestPermission?: (descriptor?: { mode?: FileSystemPermissionMode }) => Promise<"granted" | "prompt" | "denied">;
};

export type FileSystemFileHandleLike = FileSystemHandleLike & {
  kind: "file";
  getFile: () => Promise<File>;
  createWritable: () => Promise<FileSystemWritableStreamLike>;
};

export type FileSystemDirectoryHandleLike = FileSystemHandleLike & {
  kind: "directory";
  getFileHandle?: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandleLike>;
};

export type FilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};

export type FileSystemPickerWindow = {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
    startIn?: FileSystemHandleLike | string;
  }) => Promise<FileSystemFileHandleLike[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
    startIn?: FileSystemHandleLike | string;
  }) => Promise<FileSystemFileHandleLike>;
  showDirectoryPicker?: (options?: {
    mode?: FileSystemPermissionMode;
    startIn?: FileSystemHandleLike | string;
  }) => Promise<FileSystemDirectoryHandleLike>;
  indexedDB?: IDBFactory;
};

export type StoredDirectoryEntry = {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandleLike;
  isDefault: boolean;
  addedAt: number;
};

export type StoredDirectoryWithPermission = StoredDirectoryEntry & {
  permission: FileSystemPermissionStatus;
};

export type LastProjectHandleRecord = {
  id: "last-project";
  fileName: string;
  handle: FileSystemFileHandleLike;
  savedAt: number;
};

export type HandleStoreAdapter = {
  getAllDirectories: () => Promise<StoredDirectoryEntry[]>;
  putDirectory: (entry: StoredDirectoryEntry) => Promise<void>;
  deleteDirectory: (id: string) => Promise<void>;
  getLastProject: () => Promise<LastProjectHandleRecord | null>;
  putLastProject: (record: LastProjectHandleRecord | null) => Promise<void>;
};

export type FileSystemDeps = {
  win?: FileSystemPickerWindow | null;
  store?: HandleStoreAdapter;
};

export type OpenProjectPickerResult =
  | { kind: "opened"; fileName: string; content: string; xmlText: string; handle: FileSystemFileHandleLike }
  | { kind: "cancelled" }
  | { kind: "unsupported" };

export type SaveProjectFileResult =
  | { kind: "saved"; fileName: string; handle: FileSystemFileHandleLike }
  | { kind: "cancelled" }
  | { kind: "fallback-required" };

export type LoadLastProjectResult =
  | { kind: "loaded"; fileName: string; content: string; xmlText: string; handle: FileSystemFileHandleLike }
  | { kind: "unavailable"; reason: string };

const DB_NAME = "logicCircuit-fs";
const DB_VERSION = 1;
const STORE_DIRECTORIES = "directories";
const STORE_LAST_PROJECT = "lastProject";
const LAST_PROJECT_RECORD_ID = "last-project";

export const OPEN_PROJECT_PICKER_TYPES: FilePickerAcceptType[] = [
  {
    description: "Logic Circuit Projekte (.lcweb, .CircuitProject)",
    accept: {
      "application/json": [".lcweb"],
      "application/xml": [".CircuitProject", ".xml"],
    },
  },
  {
    description: "Logic Circuit Web Projekt (.lcweb)",
    accept: {
      "application/json": [".lcweb"],
    },
  },
  {
    description: "LogicCircuit Desktop Projekt (.CircuitProject)",
    accept: {
      "application/xml": [".CircuitProject", ".xml"],
    },
  },
];

export const SAVE_NATIVE_PROJECT_PICKER_TYPES: FilePickerAcceptType[] = [
  {
    description: "Logic Circuit Web Projekt (.lcweb)",
    accept: {
      "application/json": [".lcweb"],
    },
  },
];

export const SAVE_DESKTOP_XML_PICKER_TYPES: FilePickerAcceptType[] = [
  {
    description: "LogicCircuit Desktop Projekt (.CircuitProject)",
    accept: {
      "application/xml": [".CircuitProject"],
    },
  },
];

// Liefert die lokalisierten Dateifilter zum Öffnen von Projekten
export function getOpenProjectPickerTypes(): FilePickerAcceptType[] {
  return [
    {
      description: i18n.t("filePicker.allProjects"),
      accept: {
        "application/json": [".lcweb"],
        "application/xml": [".CircuitProject", ".xml"],
      },
    },
    {
      description: i18n.t("filePicker.nativeProject"),
      accept: {
        "application/json": [".lcweb"],
      },
    },
    {
      description: i18n.t("filePicker.desktopProject"),
      accept: {
        "application/xml": [".CircuitProject", ".xml"],
      },
    },
  ];
}

// Liefert die lokalisierten Dateifilter zum Speichern nativer Web-Projekte
export function getSaveNativeProjectPickerTypes(): FilePickerAcceptType[] {
  return [
    {
      description: i18n.t("filePicker.nativeProject"),
      accept: {
        "application/json": [".lcweb"],
      },
    },
  ];
}

// Liefert die lokalisierten Dateifilter zum Exportieren als Desktop-XML
export function getSaveDesktopXmlPickerTypes(): FilePickerAcceptType[] {
  return [
    {
      description: i18n.t("filePicker.desktopSaveProject"),
      accept: {
        "application/xml": [".CircuitProject"],
      },
    },
  ];
}

function resolvePickerWindow(deps?: FileSystemDeps): FileSystemPickerWindow | null {
  if (deps && "win" in deps) {
    return deps.win ?? null;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window as unknown as FileSystemPickerWindow;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function generateDirectoryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dir-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Prüft, ob die File System Access API im aktuellen Browser verfügbar ist
export function isFileSystemAccessSupported(deps?: FileSystemDeps): boolean {
  const win = resolvePickerWindow(deps);
  if (!win) {
    return false;
  }
  return (
    typeof win.showOpenFilePicker === "function" &&
    typeof win.showSaveFilePicker === "function" &&
    typeof win.showDirectoryPicker === "function"
  );
}

// Prüft, ob ein Handle noch gültige Berechtigungen besitzt (ohne Nutzerabfrage)
export async function queryHandlePermission(
  handle: FileSystemHandleLike | null | undefined,
  mode: FileSystemPermissionMode = "readwrite",
): Promise<FileSystemPermissionStatus> {
  if (!handle) {
    return "unsupported";
  }
  if (typeof handle.queryPermission !== "function") {
    return "granted";
  }
  try {
    return await handle.queryPermission({ mode });
  } catch {
    return "denied";
  }
}

// Fordert bei Bedarf eine Lese- oder Schreibberechtigung für ein Handle an
export async function requestHandlePermission(
  handle: FileSystemHandleLike | null | undefined,
  mode: FileSystemPermissionMode = "readwrite",
): Promise<FileSystemPermissionStatus> {
  if (!handle) {
    return "unsupported";
  }
  const current = await queryHandlePermission(handle, mode);
  if (current === "granted" || current === "unsupported") {
    return current;
  }
  if (typeof handle.requestPermission !== "function") {
    return current;
  }
  try {
    return await handle.requestPermission({ mode });
  } catch {
    return "denied";
  }
}

// Erstellt einen IndexedDB-Adapter zum dauerhaften Speichern von Verzeichnis- und Dateihandles
function createIndexedDbHandleStore(idbFactory?: IDBFactory): HandleStoreAdapter {
  const resolveFactory = (): IDBFactory | null => {
    if (idbFactory) {
      return idbFactory;
    }
    if (typeof window !== "undefined" && window.indexedDB) {
      return window.indexedDB;
    }
    return null;
  };

  const closeQuietly = (db: IDBDatabase): void => {
    try {
      db.close();
    } catch {
      // Bereits geschlossen
    }
  };

  const openDatabase = (): Promise<IDBDatabase | null> =>
    new Promise((resolve) => {
      const factory = resolveFactory();
      if (!factory) {
        resolve(null);
        return;
      }

      let settled = false;
      const finish = (db: IDBDatabase | null) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(db);
      };

      try {
        const request = factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_DIRECTORIES)) {
            db.createObjectStore(STORE_DIRECTORIES, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(STORE_LAST_PROJECT)) {
            db.createObjectStore(STORE_LAST_PROJECT, { keyPath: "id" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => closeQuietly(db);
          finish(db);
        };
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
      } catch {
        finish(null);
      }
    });

  const runTransaction = async <T>(
    storeName: string,
    mode: IDBTransactionMode,
    fallback: T,
    execute: (
      store: IDBObjectStore,
      bind: <R>(request: IDBRequest<R>, mapResult: (raw: R) => T) => void,
    ) => void,
  ): Promise<T> => {
    const db = await openDatabase();
    if (!db) {
      return fallback;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: T) => {
        if (settled) {
          return;
        }
        settled = true;
        closeQuietly(db);
        resolve(value);
      };

      if (!db.objectStoreNames.contains(storeName)) {
        finish(fallback);
        return;
      }

      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let resultValue = fallback;

        const bind = <R>(request: IDBRequest<R>, mapResult: (raw: R) => T): void => {
          request.onsuccess = () => {
            try {
              resultValue = mapResult(request.result);
            } catch {
              resultValue = fallback;
            }
          };
          request.onerror = () => finish(fallback);
        };

        execute(store, bind);
        tx.oncomplete = () => finish(resultValue);
        tx.onerror = () => finish(fallback);
        tx.onabort = () => finish(fallback);
      } catch {
        finish(fallback);
      }
    });
  };

  return {
    async getAllDirectories() {
      return runTransaction<StoredDirectoryEntry[]>(
        STORE_DIRECTORIES,
        "readonly",
        [],
        (store, bind) => {
          bind(store.getAll(), (raw) => {
            const list = Array.isArray(raw) ? (raw as StoredDirectoryEntry[]) : [];
            return list.slice().sort((a, b) => a.addedAt - b.addedAt);
          });
        },
      );
    },

    async putDirectory(entry) {
      await runTransaction<void>(STORE_DIRECTORIES, "readwrite", undefined, (store, bind) => {
        bind(store.put(entry), () => undefined);
      });
    },

    async deleteDirectory(id) {
      await runTransaction<void>(STORE_DIRECTORIES, "readwrite", undefined, (store, bind) => {
        bind(store.delete(id), () => undefined);
      });
    },

    async getLastProject() {
      return runTransaction<LastProjectHandleRecord | null>(
        STORE_LAST_PROJECT,
        "readonly",
        null,
        (store, bind) => {
          bind(
            store.get(LAST_PROJECT_RECORD_ID),
            (raw) => (raw as LastProjectHandleRecord | undefined) ?? null,
          );
        },
      );
    },

    async putLastProject(record) {
      await runTransaction<void>(STORE_LAST_PROJECT, "readwrite", undefined, (store, bind) => {
        if (record) {
          bind(store.put(record), () => undefined);
        } else {
          bind(store.delete(LAST_PROJECT_RECORD_ID), () => undefined);
        }
      });
    },
  };
}

function resolveStore(deps?: FileSystemDeps): HandleStoreAdapter {
  if (deps?.store) {
    return deps.store;
  }
  const win = resolvePickerWindow(deps);
  return createIndexedDbHandleStore(win?.indexedDB);
}

// Lädt alle gespeicherten Projektverzeichnisse inkl. aktuellem Berechtigungsstatus
export async function listStoredDirectories(
  deps?: FileSystemDeps,
): Promise<StoredDirectoryWithPermission[]> {
  const store = resolveStore(deps);
  const entries = await store.getAllDirectories();
  const withPermissions = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      permission: await queryHandlePermission(entry.handle, "readwrite"),
    })),
  );
  return withPermissions.sort((a, b) => a.addedAt - b.addedAt);
}

// Fügt ein ausgewähltes Verzeichnis-Handle hinzu (Duplikate über isSameEntry werden aktualisiert)
export async function addProjectDirectory(
  handle: FileSystemDirectoryHandleLike,
  deps?: FileSystemDeps,
): Promise<StoredDirectoryWithPermission[]> {
  const store = resolveStore(deps);
  const existing = await store.getAllDirectories();

  for (const item of existing) {
    if (typeof item.handle.isSameEntry === "function") {
      try {
        if (await item.handle.isSameEntry(handle)) {
          await store.putDirectory({
            ...item,
            name: handle.name,
            handle,
          });
          return listStoredDirectories(deps);
        }
      } catch {
        // Vergleich fehlgeschlagen, regulär neu anlegen
      }
    }
  }

  const hasDefault = existing.some((entry) => entry.isDefault);
  const newEntry: StoredDirectoryEntry = {
    id: generateDirectoryId(),
    name: handle.name,
    handle,
    isDefault: !hasDefault,
    addedAt: Date.now(),
  };

  await store.putDirectory(newEntry);
  return listStoredDirectories(deps);
}

// Öffnet den Browser-Verzeichnisauswahldialog und speichert das Verzeichnis dauerhaft
export async function pickAndAddProjectDirectory(
  deps?: FileSystemDeps,
): Promise<{
  kind: "added" | "cancelled" | "unsupported";
  directories: StoredDirectoryWithPermission[];
}> {
  const win = resolvePickerWindow(deps);
  if (!win || typeof win.showDirectoryPicker !== "function") {
    return {
      kind: "unsupported",
      directories: await listStoredDirectories(deps),
    };
  }

  try {
    const dirHandle = await win.showDirectoryPicker({ mode: "readwrite" });
    await requestHandlePermission(dirHandle, "readwrite");
    const directories = await addProjectDirectory(dirHandle, deps);
    return { kind: "added", directories };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        kind: "cancelled",
        directories: await listStoredDirectories(deps),
      };
    }
    throw error;
  }
}

// Entfernt ein gespeichertes Projektverzeichnis und wählt bei Bedarf ein neues Standardverzeichnis
export async function removeProjectDirectory(
  id: string,
  deps?: FileSystemDeps,
): Promise<StoredDirectoryWithPermission[]> {
  const store = resolveStore(deps);
  const existing = await store.getAllDirectories();
  const target = existing.find((entry) => entry.id === id);
  await store.deleteDirectory(id);

  if (target?.isDefault) {
    const remaining = existing.filter((entry) => entry.id !== id);
    if (remaining[0]) {
      await store.putDirectory({ ...remaining[0], isDefault: true });
    }
  }

  return listStoredDirectories(deps);
}

// Markiert ein gespeichertes Verzeichnis als Standard-Projektverzeichnis
export async function setDefaultProjectDirectory(
  id: string,
  deps?: FileSystemDeps,
): Promise<StoredDirectoryWithPermission[]> {
  const store = resolveStore(deps);
  const existing = await store.getAllDirectories();
  for (const entry of existing) {
    const shouldBeDefault = entry.id === id;
    if (entry.isDefault !== shouldBeDefault) {
      await store.putDirectory({ ...entry, isDefault: shouldBeDefault });
    }
  }
  return listStoredDirectories(deps);
}

// Ermittelt das aktive Standard-Projektverzeichnis (falls vorhanden)
export async function getDefaultDirectoryHandle(
  deps?: FileSystemDeps,
): Promise<StoredDirectoryEntry | null> {
  const store = resolveStore(deps);
  const entries = await store.getAllDirectories();
  if (entries.length === 0) {
    return null;
  }
  return entries.find((entry) => entry.isDefault) ?? entries[0];
}

// Prüft bzw. fordert beim Programmstart oder Zugriff Schreibrechte für verknüpfte Verzeichnisse an
export async function ensureDirectoryPermission(
  entry: StoredDirectoryEntry,
  mode: FileSystemPermissionMode = "readwrite",
): Promise<FileSystemPermissionStatus> {
  return requestHandlePermission(entry.handle, mode);
}

// Speichert oder löscht das Handle der zuletzt geöffneten/gespeicherten Projektdatei
export async function saveLastProjectFileHandle(
  handle: FileSystemFileHandleLike | null,
  deps?: FileSystemDeps,
): Promise<void> {
  const store = resolveStore(deps);
  if (!handle) {
    await store.putLastProject(null);
    return;
  }
  await store.putLastProject({
    id: LAST_PROJECT_RECORD_ID,
    fileName: handle.name,
    handle,
    savedAt: Date.now(),
  });
}

// Öffnet den System-Dateidialog zum Laden einer .lcweb- oder .CircuitProject-Datei
export async function openProjectFileWithPicker(
  startInHandle?: FileSystemDirectoryHandleLike | null,
  deps?: FileSystemDeps,
): Promise<OpenProjectPickerResult> {
  const win = resolvePickerWindow(deps);
  if (!win || typeof win.showOpenFilePicker !== "function") {
    return { kind: "unsupported" };
  }

  try {
    const pickerTypes = getOpenProjectPickerTypes();
    let handles: FileSystemFileHandleLike[];
    try {
      handles = await win.showOpenFilePicker({
        multiple: false,
        types: pickerTypes,
        startIn: startInHandle ?? undefined,
      });
    } catch (firstError) {
      if (isAbortError(firstError) || !startInHandle) {
        throw firstError;
      }
      // Falls startIn wegen fehlender Verzeichnis-Permission abgelehnt wird, ohne startIn öffnen
      handles = await win.showOpenFilePicker({
        multiple: false,
        types: pickerTypes,
      });
    }

    const fileHandle = handles[0];
    if (!fileHandle) {
      return { kind: "cancelled" };
    }

    const file = await fileHandle.getFile();
    const content = await file.text();
    await saveLastProjectFileHandle(fileHandle, deps);
    return {
      kind: "opened",
      fileName: file.name || fileHandle.name,
      content,
      xmlText: content,
      handle: fileHandle,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { kind: "cancelled" };
    }
    return { kind: "unsupported" };
  }
}

// Schreibt Inhalte direkt über ein bestehendes FileSystemFileHandle auf die lokale Festplatte
export async function writeProjectToFileHandle(
  handle: FileSystemFileHandleLike,
  content: string,
): Promise<boolean> {
  const permission = await requestHandlePermission(handle, "readwrite");
  if (permission !== "granted") {
    return false;
  }

  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  return true;
}

// Speichert eine Projektdatei (Standard: natives .lcweb) über vorhandenes FileHandle oder per "Speichern unter"
export async function saveProjectFileWithFileSystem(
  content: string,
  suggestedName: string,
  options?: {
    existingHandle?: FileSystemFileHandleLike | null;
    forceSaveAs?: boolean;
    startInHandle?: FileSystemDirectoryHandleLike | null;
    types?: FilePickerAcceptType[];
    persistLastProject?: boolean;
  },
  deps?: FileSystemDeps,
): Promise<SaveProjectFileResult> {
  const forceSaveAs = options?.forceSaveAs === true;
  const existingHandle = options?.existingHandle ?? null;
  const pickerTypes = options?.types ?? getSaveNativeProjectPickerTypes();
  const persistLastProject = options?.persistLastProject !== false;

  if (!forceSaveAs && existingHandle) {
    try {
      const ok = await writeProjectToFileHandle(existingHandle, content);
      if (ok) {
        if (persistLastProject) {
          await saveLastProjectFileHandle(existingHandle, deps);
        }
        return {
          kind: "saved",
          fileName: existingHandle.name,
          handle: existingHandle,
        };
      }
    } catch {
      // Permission verweigert oder Handle ungültig -> unten Dialog bzw. Fallback
    }
  }

  const win = resolvePickerWindow(deps);
  if (!win || typeof win.showSaveFilePicker !== "function") {
    return { kind: "fallback-required" };
  }

  try {
    let targetHandle: FileSystemFileHandleLike;
    try {
      targetHandle = await win.showSaveFilePicker({
        suggestedName,
        types: pickerTypes,
        startIn: options?.startInHandle ?? undefined,
      });
    } catch (firstError) {
      if (isAbortError(firstError) || !options?.startInHandle) {
        throw firstError;
      }
      targetHandle = await win.showSaveFilePicker({
        suggestedName,
        types: pickerTypes,
      });
    }

    const ok = await writeProjectToFileHandle(targetHandle, content);
    if (!ok) {
      return { kind: "fallback-required" };
    }

    if (persistLastProject) {
      await saveLastProjectFileHandle(targetHandle, deps);
    }
    return {
      kind: "saved",
      fileName: targetHandle.name,
      handle: targetHandle,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { kind: "cancelled" };
    }
    return { kind: "fallback-required" };
  }
}

// Abwärtskompatibler Wrapper zum Speichern im Desktop-XML-Format
export async function saveProjectXmlWithFileSystem(
  xmlText: string,
  suggestedName: string,
  options?: {
    existingHandle?: FileSystemFileHandleLike | null;
    forceSaveAs?: boolean;
    startInHandle?: FileSystemDirectoryHandleLike | null;
  },
  deps?: FileSystemDeps,
): Promise<SaveProjectFileResult> {
  return saveProjectFileWithFileSystem(
    xmlText,
    suggestedName,
    {
      ...options,
      types: getSaveDesktopXmlPickerTypes(),
    },
    deps,
  );
}

// Lädt beim Programmstart das zuletzt geöffnete/gespeicherte Projekt über sein Handle
export async function loadLastProjectFromStorage(
  deps?: FileSystemDeps,
): Promise<LoadLastProjectResult> {
  const store = resolveStore(deps);
  const record = await store.getLastProject();
  if (!record?.handle) {
    return { kind: "unavailable", reason: i18n.t("errors.fileSystem.noLastProject") };
  }

  const currentPerm = await queryHandlePermission(record.handle, "read");
  const effectivePerm =
    currentPerm === "granted"
      ? "granted"
      : await requestHandlePermission(record.handle, "read");

  if (effectivePerm !== "granted") {
    return {
      kind: "unavailable",
      reason: i18n.t("errors.fileSystem.noReadPermission"),
    };
  }

  try {
    const file = await record.handle.getFile();
    const content = await file.text();
    return {
      kind: "loaded",
      fileName: file.name || record.fileName,
      content,
      xmlText: content,
      handle: record.handle,
    };
  } catch {
    return {
      kind: "unavailable",
      reason: i18n.t("errors.fileSystem.lastProjectReadFailed"),
    };
  }
}

// Wiederverwendbarer Helfer für künftige Datei-Persistierung direkt in einem Projektverzeichnis (z. B. RAM)
export async function writeFileInDirectory(
  dirHandle: FileSystemDirectoryHandleLike,
  fileName: string,
  content: string | BufferSource | Blob,
): Promise<boolean> {
  if (typeof dirHandle.getFileHandle !== "function") {
    return false;
  }
  const permission = await requestHandlePermission(dirHandle, "readwrite");
  if (permission !== "granted") {
    return false;
  }

  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return true;
}

// Wiederverwendbarer Helfer zum Auslesen einer Datei aus einem Projektverzeichnis
export async function readFileFromDirectory(
  dirHandle: FileSystemDirectoryHandleLike,
  fileName: string,
): Promise<string | null> {
  if (typeof dirHandle.getFileHandle !== "function") {
    return null;
  }
  const permission = await queryHandlePermission(dirHandle, "read");
  const effective = permission === "granted"
    ? "granted"
    : await requestHandlePermission(dirHandle, "read");
  if (effective !== "granted") {
    return null;
  }

  try {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}
