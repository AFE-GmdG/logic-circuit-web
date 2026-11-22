import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";

import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  applyDefaultFrequencyToProject,
  loadAppSettings,
  saveAppSettings,
} from "../utils/appSettingsStorage";
import { createEmptyCircuitProject } from "../utils/circuitLayout";
import {
  type FileSystemDirectoryHandleLike,
  type FileSystemFileHandleLike,
  type FileSystemPickerWindow,
  type HandleStoreAdapter,
  type LastProjectHandleRecord,
  type StoredDirectoryEntry,
  OPEN_PROJECT_PICKER_TYPES,
  SAVE_DESKTOP_XML_PICKER_TYPES,
  SAVE_NATIVE_PROJECT_PICKER_TYPES,
  addProjectDirectory,
  getDefaultDirectoryHandle,
  isFileSystemAccessSupported,
  listStoredDirectories,
  loadLastProjectFromStorage,
  openProjectFileWithPicker,
  pickAndAddProjectDirectory,
  readFileFromDirectory,
  removeProjectDirectory,
  saveProjectFileWithFileSystem,
  saveProjectXmlWithFileSystem,
  setDefaultProjectDirectory,
  writeFileInDirectory,
} from "../utils/fileSystemStorage";
import { serializeNativeProject } from "../utils/storage/nativeProjectWriter";
import { isSupportedProjectFile } from "../utils/storage/projectFileUtils";
import { serializeCircuitProjectToXml } from "../utils/xml/logicCircuitXmlWriter";

import OptionsDialog from "../components/app/optionsDialog";

const ContextProbe: React.FC<{
  onCircuit: (ctx: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onCircuit }) => {
  const ctx = React.useContext(CircuitContext);
  onCircuit(ctx);
  return null;
};

function createMemoryHandleStore(): HandleStoreAdapter {
  const directories = new Map<string, StoredDirectoryEntry>();
  let lastProject: LastProjectHandleRecord | null = null;

  return {
    async getAllDirectories() {
      return Array.from(directories.values()).sort((a, b) => a.addedAt - b.addedAt);
    },
    async putDirectory(entry) {
      directories.set(entry.id, entry);
    },
    async deleteDirectory(id) {
      directories.delete(id);
    },
    async getLastProject() {
      return lastProject;
    },
    async putLastProject(record) {
      lastProject = record;
    },
  };
}

function createMockFileHandle(
  name: string,
  initialContent: string,
  options?: { permission?: "granted" | "prompt" | "denied" },
): { handle: FileSystemFileHandleLike; getContent: () => string } {
  let content = initialContent;
  const perm = options?.permission ?? "granted";

  const handle: FileSystemFileHandleLike = {
    kind: "file",
    name,
    async queryPermission() {
      return perm;
    },
    async requestPermission() {
      return perm;
    },
    async getFile() {
      return {
        name,
        text: async () => content,
      } as unknown as File;
    },
    async createWritable() {
      let buffer = "";
      return {
        async write(data) {
          buffer = typeof data === "string" ? data : String(data);
        },
        async close() {
          content = buffer;
        },
      };
    },
  };

  return {
    handle,
    getContent: () => content,
  };
}

function createMockDirectoryHandle(
  name: string,
  options?: { permission?: "granted" | "prompt" | "denied" },
): FileSystemDirectoryHandleLike {
  const perm = options?.permission ?? "granted";
  const files = new Map<string, ReturnType<typeof createMockFileHandle>>();

  return {
    kind: "directory",
    name,
    async isSameEntry(other) {
      return other.kind === "directory" && other.name === name;
    },
    async queryPermission() {
      return perm;
    },
    async requestPermission() {
      return perm;
    },
    async getFileHandle(fileName, opts) {
      const existing = files.get(fileName);
      if (existing) {
        return existing.handle;
      }
      if (opts?.create) {
        const created = createMockFileHandle(fileName, "");
        files.set(fileName, created);
        return created.handle;
      }
      throw new Error("File not found");
    },
  };
}

const noop = () => undefined;

describe("T-050: File System Access API & Systemeinstellungen (DialogOptions)", () => {
  const originalWindow = (globalThis as { window?: Window & typeof globalThis }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window & typeof globalThis }).window;
    } else {
      (globalThis as { window?: Window & typeof globalThis }).window = originalWindow;
    }
  });

  function installMockLocalStorage(): Map<string, string> {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;

    (globalThis as { window?: Window & typeof globalThis }).window = {
      localStorage: mockStorage,
    } as unknown as Window & typeof globalThis;

    return store;
  }

  it("speichert und lädt Systemeinstellungen in localStorage und wendet Standard-Taktfrequenz auf neue Projekte an", () => {
    const store = installMockLocalStorage();

    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);

    saveAppSettings({
      startupProjectMode: "last",
      defaultFrequency: 5,
      language: "de",
      audioVolume: 85,
      audioMuted: true,
    });
    expect(loadAppSettings()).toEqual({
      startupProjectMode: "last",
      defaultFrequency: 5,
      language: "de",
      audioVolume: 85,
      audioMuted: true,
    });

    saveAppSettings({
      startupProjectMode: "empty",
      defaultFrequency: "max",
      language: "en",
      audioVolume: 70,
      audioMuted: false,
    });
    expect(loadAppSettings()).toEqual({
      startupProjectMode: "empty",
      defaultFrequency: "max",
      language: "en",
      audioVolume: 70,
      audioMuted: false,
    });

    // Ungültige Werte und fehlerhaftes JSON fallen sauber auf Defaults zurück
    store.set(
      APP_SETTINGS_STORAGE_KEY,
      "{\"startupProjectMode\":\"invalid\",\"defaultFrequency\":99,\"language\":\"zz-UNKNOWN\"}",
    );
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    store.set(APP_SETTINGS_STORAGE_KEY, "{kaputt");
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);

    const empty = createEmptyCircuitProject("Neu");
    const updatedFixed = applyDefaultFrequencyToProject(empty, 2);
    expect(updatedFixed.project.frequency).toBe(2);
    expect(updatedFixed.project.isMaximumSpeed).toBe(false);

    const updatedMax = applyDefaultFrequencyToProject(empty, "max");
    expect(updatedMax.project.isMaximumSpeed).toBe(true);
  });

  it("berücksichtigt startupProjectMode ('empty', 'last' mit Empty-Fallback) und defaultFrequency im CircuitContextProvider", () => {
    installMockLocalStorage();
    saveAppSettings({
      startupProjectMode: "empty",
      defaultFrequency: 5,
      language: "de",
      audioVolume: 70,
      audioMuted: false,
    });

    let capturedCtx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider>
        <ContextProbe onCircuit={(ctx) => { capturedCtx = ctx; }} />
      </CircuitContextProvider>,
    );

    expect(capturedCtx.project.logicalCircuits).toHaveLength(1);
    expect(capturedCtx.project.project.frequency).toBe(5);
    expect(capturedCtx.appSettings).toEqual({
      startupProjectMode: "empty",
      defaultFrequency: 5,
      language: "de",
      audioVolume: 70,
      audioMuted: false,
    });

    // Wechsel auf Modus "last" ohne gespeichertes Datei-Handle fällt auf leeres Projekt zurück
    React.act(() => {
      capturedCtx.updateAppSettings({ startupProjectMode: "last", defaultFrequency: "max" });
    });

    let lastModeCtx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider>
        <ContextProbe onCircuit={(ctx) => { lastModeCtx = ctx; }} />
      </CircuitContextProvider>,
    );
    expect(lastModeCtx.project.logicalCircuits).toHaveLength(1);
    expect(lastModeCtx.project.project.isMaximumSpeed).toBe(true);

    // resetToEmptyProject übernimmt aktuelle defaultFps
    React.act(() => {
      capturedCtx.resetToEmptyProject();
    });
    expect(capturedCtx.project.project.isMaximumSpeed).toBe(true);
  });

  it("verwaltet Projektverzeichnisse, Permission-Status, direktes Speichern und Fallback ohne File System Access API", async () => {
    const store = createMemoryHandleStore();
    expect(isFileSystemAccessSupported({ win: null })).toBe(false);

    const dirA = createMockDirectoryHandle("Schaltungen", { permission: "granted" });
    const dirB = createMockDirectoryHandle("Archiv", { permission: "prompt" });

    let list = await addProjectDirectory(dirA, { store });
    expect(list).toHaveLength(1);
    expect(list[0].isDefault).toBe(true);
    expect(list[0].permission).toBe("granted");

    // Doppeltes Hinzufügen desselben Verzeichnisses über isSameEntry erzeugt kein Duplikat
    list = await addProjectDirectory(dirA, { store });
    expect(list).toHaveLength(1);

    list = await addProjectDirectory(dirB, { store });
    expect(list).toHaveLength(2);
    expect(list[1].isDefault).toBe(false);
    expect(list[1].permission).toBe("prompt");

    // Standard-Verzeichnis wechseln und erstes entfernen
    list = await setDefaultProjectDirectory(list[1].id, { store });
    expect((await getDefaultDirectoryHandle({ store }))?.name).toBe("Archiv");

    const remaining = await removeProjectDirectory(list[1].id, { store });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe("Schaltungen");
    expect(remaining[0].isDefault).toBe(true);

    // Wiederverwendbare Verzeichnis-Datei-Helfer (Basis für spätere RAM-Persistierung)
    expect(await writeFileInDirectory(dirA, "ram-dump.hex", "DEADBEEF")).toBe(true);
    expect(await readFileFromDirectory(dirA, "ram-dump.hex")).toBe("DEADBEEF");
  });

  it("fragt beim Hinzufügen eines Projektverzeichnisses direkt readwrite-Berechtigung an falls noch auf prompt", async () => {
    const store = createMemoryHandleStore();
    const pickerCalls: ({ mode?: "read" | "readwrite" } | undefined)[] = [];
    const promptRequestCalls: ({ mode?: "read" | "readwrite" } | undefined)[] = [];
    let promptPerm: "granted" | "prompt" | "denied" = "prompt";

    const promptDir: FileSystemDirectoryHandleLike = {
      kind: "directory",
      name: "NeuPrompt",
      async queryPermission() {
        return promptPerm;
      },
      async requestPermission(desc) {
        promptRequestCalls.push(desc);
        promptPerm = "granted";
        return promptPerm;
      },
    };

    const grantedRequestCalls: ({ mode?: "read" | "readwrite" } | undefined)[] = [];
    const grantedDir: FileSystemDirectoryHandleLike = {
      kind: "directory",
      name: "BereitsErlaubt",
      async queryPermission() {
        return "granted";
      },
      async requestPermission(desc) {
        grantedRequestCalls.push(desc);
        return "granted";
      },
    };

    const promptResult = await pickAndAddProjectDirectory({
      store,
      win: {
        async showOpenFilePicker() { return []; },
        async showSaveFilePicker() { throw new Error("unused"); },
        async showDirectoryPicker(options) {
          pickerCalls.push(options);
          return promptDir;
        },
      },
    });

    expect(promptResult.kind).toBe("added");
    expect(pickerCalls).toEqual([{ mode: "readwrite" }]);
    expect(promptRequestCalls).toEqual([{ mode: "readwrite" }]);
    expect(promptResult.directories).toHaveLength(1);
    expect(promptResult.directories[0].permission).toBe("granted");

    const grantedResult = await pickAndAddProjectDirectory({
      store,
      win: {
        async showOpenFilePicker() { return []; },
        async showSaveFilePicker() { throw new Error("unused"); },
        async showDirectoryPicker() {
          return grantedDir;
        },
      },
    });

    expect(grantedResult.kind).toBe("added");
    expect(grantedRequestCalls).toHaveLength(0);
    expect(grantedResult.directories).toHaveLength(2);
    expect(grantedResult.directories[1].permission).toBe("granted");
  });

  it("schließt IndexedDB-Verbindungen erst nach tx.oncomplete und hängt bei onabort/onblocked nicht", async () => {
    type MockDbLike = {
      objectStoreNames: { contains: (name: string) => boolean };
      createObjectStore: (name: string) => Record<string, never>;
      transaction: (storeName: string, mode: IDBTransactionMode) => Record<string, unknown>;
      close: () => void;
      onversionchange: (() => void) | null;
    };
    type MockIdbOptions = {
      blocked?: boolean;
      abortOnRead?: boolean;
      abortOnWrite?: boolean;
    };

    const createMockIdb = (opts: MockIdbOptions = {}) => {
      const tables = new Map<string, Map<string, Record<string, unknown>>>();
      const events: string[] = [];
      const openedDbs: MockDbLike[] = [];
      let closeCount = 0;

      const factory = {
        open() {
          const openReq: {
            result: MockDbLike | null;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
            onupgradeneeded: (() => void) | null;
            onblocked: (() => void) | null;
          } = {
            result: null,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
            onblocked: null,
          };

          queueMicrotask(() => {
            if (opts.blocked) {
              events.push("open.blocked");
              openReq.onblocked?.();
              return;
            }

            const db: MockDbLike = {
              objectStoreNames: {
                contains: (name) => tables.has(name),
              },
              createObjectStore: (name) => {
                if (!tables.has(name)) {
                  tables.set(name, new Map());
                }
                return {};
              },
              onversionchange: null,
              close: () => {
                closeCount++;
                events.push("db.close");
              },
              transaction: (storeName, mode) => {
                const tx: {
                  oncomplete: (() => void) | null;
                  onerror: (() => void) | null;
                  onabort: (() => void) | null;
                  objectStore: (target: string) => Record<string, unknown>;
                } = {
                  oncomplete: null,
                  onerror: null,
                  onabort: null,
                  objectStore: (target) => {
                    const table = tables.get(target) ?? new Map<string, Record<string, unknown>>();
                    tables.set(target, table);

                    const schedule = (produce: () => unknown) => {
                      const req: {
                        result: unknown;
                        onsuccess: (() => void) | null;
                        onerror: (() => void) | null;
                      } = {
                        result: undefined,
                        onsuccess: null,
                        onerror: null,
                      };

                      queueMicrotask(() => {
                        const shouldAbort =
                          (mode === "readonly" && opts.abortOnRead) ||
                          (mode === "readwrite" && opts.abortOnWrite);
                        if (shouldAbort) {
                          events.push("tx.abort");
                          tx.onabort?.();
                          return;
                        }
                        req.result = produce();
                        events.push("req.success");
                        req.onsuccess?.();
                        queueMicrotask(() => {
                          events.push("tx.complete");
                          tx.oncomplete?.();
                        });
                      });

                      return req;
                    };

                    return {
                      getAll: () => schedule(() => Array.from(table.values())),
                      get: (key: string) => schedule(() => table.get(key)),
                      put: (val: Record<string, unknown>) => schedule(() => {
                        table.set(String(val.id), val);
                        return val.id;
                      }),
                      delete: (key: string) => schedule(() => {
                        table.delete(key);
                        return undefined;
                      }),
                    };
                  },
                };
                void storeName;
                return tx;
              },
            };

            openedDbs.push(db);
            openReq.result = db;
            openReq.onupgradeneeded?.();
            openReq.onsuccess?.();
          });

          return openReq;
        },
      };

      return {
        factory: factory as unknown as IDBFactory,
        events,
        openedDbs,
        getCloseCount: () => closeCount,
      };
    };

    // Normaler Schreib- und Lesezyklus: db.close() darf erst nach tx.complete aufgerufen werden
    const normalIdb = createMockIdb();
    const dir = createMockDirectoryHandle("Projects", { permission: "granted" });
    const afterAdd = await addProjectDirectory(dir, { win: { indexedDB: normalIdb.factory } });
    expect(afterAdd).toHaveLength(1);
    expect(afterAdd[0].name).toBe("Projects");

    const listed = await listStoredDirectories({ win: { indexedDB: normalIdb.factory } });
    expect(listed).toHaveLength(1);
    expect(listed[0].permission).toBe("granted");

    // Für jede Transaktion kommt zuerst tx.complete und erst danach db.close
    const lifecycleEvents = normalIdb.events.filter((e) => e === "tx.complete" || e === "db.close");
    expect(lifecycleEvents.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < lifecycleEvents.length; i += 2) {
      expect(lifecycleEvents[i]).toBe("tx.complete");
      expect(lifecycleEvents[i + 1]).toBe("db.close");
    }

    // db.onversionchange schließt die offene Verbindung
    const closeBeforeVersionChange = normalIdb.getCloseCount();
    normalIdb.openedDbs[0]?.onversionchange?.();
    expect(normalIdb.getCloseCount()).toBe(closeBeforeVersionChange + 1);

    // tx.onabort darf weder Lesen noch Schreiben blockieren und schließt db sauber
    const abortReadIdb = createMockIdb({ abortOnRead: true });
    expect(await listStoredDirectories({ win: { indexedDB: abortReadIdb.factory } })).toEqual([]);
    expect(abortReadIdb.events).toEqual(["tx.abort", "db.close"]);

    const abortWriteIdb = createMockIdb({ abortOnWrite: true });
    expect(await addProjectDirectory(dir, { win: { indexedDB: abortWriteIdb.factory } })).toEqual([]);
    expect(abortWriteIdb.events).toContain("tx.abort");
    expect(abortWriteIdb.getCloseCount()).toBeGreaterThan(0);

    // request.onblocked liefert sauber leeres Ergebnis statt Hänger
    const blockedIdb = createMockIdb({ blocked: true });
    expect(await listStoredDirectories({ win: { indexedDB: blockedIdb.factory } })).toEqual([]);
    expect(blockedIdb.events).toEqual(["open.blocked"]);
  });

  it("öffnet/speichert über File Handles, reagiert auf Abbruch/Verweigerung und greift im Fallback-Browser sauber zurück", async () => {
    const store = createMemoryHandleStore();
    const existing = createMockFileHandle("demo.CircuitProject", "<xml>alt</xml>");
    const pickedAs = createMockFileHandle("kopie.CircuitProject", "");

    const mockWindow: FileSystemPickerWindow = {
      async showOpenFilePicker() {
        return [existing.handle];
      },
      async showSaveFilePicker() {
        return pickedAs.handle;
      },
      async showDirectoryPicker() {
        return createMockDirectoryHandle("Projekte");
      },
    };

    expect(isFileSystemAccessSupported({ win: mockWindow })).toBe(true);

    const openResult = await openProjectFileWithPicker(null, { win: mockWindow, store });
    expect(openResult.kind).toBe("opened");
    if (openResult.kind === "opened") {
      expect(openResult.fileName).toBe("demo.CircuitProject");
      expect(openResult.xmlText).toBe("<xml>alt</xml>");
    }

    // Direktes Speichern (Strg+S) überschreibt vorhandenes Handle
    const directSave = await saveProjectXmlWithFileSystem(
      "<xml>neu</xml>",
      "demo.CircuitProject",
      { existingHandle: existing.handle },
      { win: mockWindow, store },
    );
    expect(directSave.kind).toBe("saved");
    expect(existing.getContent()).toBe("<xml>neu</xml>");

    // Letztes Projekt kann danach direkt wieder geladen werden
    const lastLoaded = await loadLastProjectFromStorage({ store });
    expect(lastLoaded.kind).toBe("loaded");
    if (lastLoaded.kind === "loaded") {
      expect(lastLoaded.xmlText).toBe("<xml>neu</xml>");
    }

    // "Speichern unter" nutzt showSaveFilePicker
    const saveAs = await saveProjectXmlWithFileSystem(
      "<xml>kopie</xml>",
      "kopie.CircuitProject",
      { existingHandle: existing.handle, forceSaveAs: true },
      { win: mockWindow, store },
    );
    expect(saveAs.kind).toBe("saved");
    expect(pickedAs.getContent()).toBe("<xml>kopie</xml>");

    // Verweigerte Berechtigung beim Laden und beim Speichern ohne Picker-Support führt zum Fallback
    const denied = createMockFileHandle("gesperrt.CircuitProject", "<xml />", { permission: "denied" });
    await store.putLastProject({
      id: "last-project",
      fileName: "gesperrt.CircuitProject",
      handle: denied.handle,
      savedAt: Date.now(),
    });
    const deniedLoad = await loadLastProjectFromStorage({ store });
    expect(deniedLoad.kind).toBe("unavailable");

    const fallbackSave = await saveProjectXmlWithFileSystem(
      "<xml />",
      "fallback.CircuitProject",
      { existingHandle: denied.handle },
      { win: {}, store },
    );
    expect(fallbackSave.kind).toBe("fallback-required");

    // AbortError beim Picker wird als Abbruch behandelt
    const abortWindow: FileSystemPickerWindow = {
      async showOpenFilePicker() {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      },
      async showSaveFilePicker() {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      },
      async showDirectoryPicker() {
        return createMockDirectoryHandle("Test");
      },
    };
    const abortOpen = await openProjectFileWithPicker(null, { win: abortWindow, store });
    expect(abortOpen.kind).toBe("cancelled");
  });

  it("rendert OptionsDialog (DialogOptions) inklusive Startverhalten, Standard-FPS und Browser-Fallback-Hinweis", () => {
    const project = createEmptyCircuitProject();

    const html = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <OptionsDialog isOpen={true} onClose={noop} />
      </CircuitContextProvider>,
    );

    expect(html).toContain("data-component=\"OptionsDialog\"");
    expect(html).toContain("Einstellungen / Optionen");
    expect(html).toContain("id=\"options-language\"");
    expect(html).toContain("Sprache");
    expect(html).toContain("English");
    expect(html).toContain("Deutsch");
    expect(html).toContain("Automatisch (Browser:");
    expect(html).toContain("Verhalten beim Programmstart");
    expect(html).toContain("Demo-Projekt öffnen");
    expect(html).toContain("Leeres Projekt anlegen");
    expect(html).toContain("Letztes Projekt wiederherstellen");
    expect(html).toContain("Standard-Taktfrequenz für neue Projekte");
    expect(html).toContain("1 Hz");
    expect(html).toContain("60 Hz");
    expect(html).toContain("fs-unsupported-notice");
  });

  it("migriert XML-Dateien beim Laden auf .lcweb ohne Alt-Handle zu überschreiben und nutzt konforme Picker-Endungen", async () => {
    // Chromium erlaubt keine zusammengesetzten Endungen in types[].accept
    for (const group of [
      ...OPEN_PROJECT_PICKER_TYPES,
      ...SAVE_NATIVE_PROJECT_PICKER_TYPES,
      ...SAVE_DESKTOP_XML_PICKER_TYPES,
    ]) {
      for (const extensions of Object.values(group.accept)) {
        for (const ext of extensions) {
          expect(ext.indexOf(".", 1)).toBe(-1);
        }
      }
    }

    expect(SAVE_NATIVE_PROJECT_PICKER_TYPES).toHaveLength(1);
    expect(SAVE_NATIVE_PROJECT_PICKER_TYPES[0].accept["application/json"]).toEqual([".lcweb"]);
    expect(SAVE_DESKTOP_XML_PICKER_TYPES).toHaveLength(1);
    expect(SAVE_DESKTOP_XML_PICKER_TYPES[0].accept["application/xml"]).toEqual([".CircuitProject"]);

    expect(isSupportedProjectFile("demo.lcweb")).toBe(true);
    expect(isSupportedProjectFile("demo.json")).toBe(true);
    expect(isSupportedProjectFile("Digital Clock.CircuitProject")).toBe(true);
    expect(isSupportedProjectFile("sample.xml")).toBe(true);
    expect(isSupportedProjectFile("notes.txt")).toBe(false);

    let ctx!: React.ContextType<typeof CircuitContext>;
    renderToStaticMarkup(
      <CircuitContextProvider>
        <ContextProbe onCircuit={(c) => { ctx = c; }} />
      </CircuitContextProvider>,
    );

    const nativeProject = createEmptyCircuitProject("Natives Projekt");
    const nativeJson = serializeNativeProject(nativeProject);
    const nativeHandle = createMockFileHandle("natives.lcweb", nativeJson).handle;

    React.act(() => {
      ctx.importProjectFromText(nativeJson, { handle: nativeHandle, fileName: "natives.lcweb" });
    });
    expect(ctx.project.project.name).toBe("Natives Projekt");
    expect(ctx.activeFileHandle).toBe(nativeHandle);
    expect(ctx.activeFileName).toBe("natives.lcweb");

    const xmlProject = createEmptyCircuitProject("Altbestand");
    const xmlText = serializeCircuitProjectToXml(xmlProject);
    const xmlHandle = createMockFileHandle("alt.CircuitProject", xmlText).handle;

    React.act(() => {
      ctx.importProjectFromText(xmlText, { handle: xmlHandle, fileName: "alt.CircuitProject" });
    });
    expect(ctx.project.project.name).toBe("Altbestand");
    expect(ctx.activeFileHandle).toBeNull();
    expect(ctx.activeFileName).toBe("alt.lcweb");

    // Ein einmaliger Desktop-XML-Export darf das zuletzt geöffnete native Projekt im Store nicht überschreiben
    const store = createMemoryHandleStore();
    await store.putLastProject({
      id: "last-project",
      fileName: "natives.lcweb",
      handle: nativeHandle,
      savedAt: 1,
    });
    const exportHandle = createMockFileHandle("export.CircuitProject", "");
    const mockWindow: FileSystemPickerWindow = {
      async showSaveFilePicker() {
        return exportHandle.handle;
      },
    };
    const desktopSave = await saveProjectFileWithFileSystem(
      xmlText,
      "export.CircuitProject",
      {
        existingHandle: null,
        forceSaveAs: true,
        types: SAVE_DESKTOP_XML_PICKER_TYPES,
        persistLastProject: false,
      },
      { win: mockWindow, store },
    );
    expect(desktopSave.kind).toBe("saved");
    expect((await store.getLastProject())?.fileName).toBe("natives.lcweb");
  });
});
