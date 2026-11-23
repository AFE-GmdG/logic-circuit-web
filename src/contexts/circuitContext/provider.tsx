import React from "react";

import CircuitContext from ".";

import type FloatingPasteState from "../../types/canvas/floatingPasteState";
import type GridPoint from "../../types/canvas/gridPoint";
import type AddEntitiesParams from "../../types/circuit/addEntitiesParams";
import type AddEntitiesResult from "../../types/circuit/addEntitiesResult";
import type Circuit from "../../types/circuit/circuit";
import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitProject from "../../types/circuit/circuitProject";
import type CircuitPropertiesUpdate from "../../types/circuit/circuitPropertiesUpdate";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type CircuitSymbolPropertiesUpdate from "../../types/circuit/circuitSymbolPropertiesUpdate";
import type Constant from "../../types/circuit/constant";
import type CreateCircuitInput from "../../types/circuit/createCircuitInput";
import type DeleteCircuitsResult from "../../types/circuit/deleteCircuitsResult";
import type Gate from "../../types/circuit/gate";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type Jam from "../../types/circuit/jam";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type MoveEntitiesParams from "../../types/circuit/moveEntitiesParams";
import type MoveEntitiesResult from "../../types/circuit/moveEntitiesResult";
import type PaletteSelection from "../../types/circuit/paletteSelection";
import type Pin from "../../types/circuit/pin";
import type PreparedPastePayload from "../../types/circuit/preparedPastePayload";
import type ProjectPropertiesUpdate from "../../types/circuit/projectPropertiesUpdate";
import type RotationDirection from "../../types/circuit/rotationDirection";
import type Sensor from "../../types/circuit/sensor";
import type Sound from "../../types/circuit/sound";
import type Splitter from "../../types/circuit/splitter";
import type Synthesizer from "../../types/circuit/synthesizer";
import type TextNote from "../../types/circuit/textNote";
import type TextNoteFontFamily from "../../types/circuit/textNoteFontFamily";
import type TextNoteLineHeight from "../../types/circuit/textNoteLineHeight";
import type Wire from "../../types/circuit/wire";
import type WireEndpointUpdate from "../../types/circuit/wireEndpointUpdate";
import type CircuitDelta from "../../types/history/circuitDelta";
import type HistoryState from "../../types/history/historyState";
import type PropertyChange from "../../types/history/propertyChange";
import type AppSettings from "../../types/settings/appSettings";

import { applyLanguagePreference } from "../../i18n";
import {
  applyDefaultFrequencyToProject,
  loadAppSettings,
  saveAppSettings,
} from "../../utils/appSettingsStorage";
import { SOUND_DEFAULT_FREQUENCY } from "../../utils/audioPitchTable";
import {
  calculateJamAbsolutePoint,
  circuitContainsDisplays,
  clampGridDimension,
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createDemoCircuitProject,
  createEmptyCircuitProject,
  createGate,
  createGraphicsArray,
  createLedMatrix,
  createMemory,
  createPinCircuit,
  createSensor,
  createSound,
  createSplitter,
  createSynthesizer,
  createTextNote,
  generateUniquePinName,
  gridPointKey,
  instantiateCircuitFromPalette,
  rotateCircuitEntities,
  TEXT_NOTE_MAX_GRID_SIZE,
  TEXT_NOTE_MIN_GRID_SIZE,
} from "../../utils/circuitLayout";
import { GRID_SIZE } from "../../utils/coordinateSystem";
import { formatDocumentTitle } from "../../utils/documentTitle";
import {
  type FileSystemFileHandleLike,
  loadLastProjectFromStorage,
} from "../../utils/fileSystemStorage";
import { buildFloatingMovePointMigration } from "../../utils/floatingPasteUtils";
import {
  areByteArraysEqual,
  clampAddressBitWidth,
  clampDataBitWidth,
  decodeMemoryData,
  encodeMemoryData,
  reallocateMemoryData,
} from "../../utils/memoryDataUtils";
import { buildNativeProjectFileName } from "../../utils/storage/nativeProjectWriter";
import { parseProjectFileText } from "../../utils/storage/projectFileUtils";
import {
  loadCleanUpVisualizationEnabled,
  saveCleanUpVisualizationEnabled,
} from "../../utils/viewPreferencesStorage";
import {
  createWire,
  getConductorWiresForWire,
  isSameWireSegment,
  recalculateProjectWires,
  updateWireEndpoints,
} from "../../utils/wireUtils";

import {
  applyDeltaBackward,
  applyDeltaForward,
  createEmptyHistoryState,
  deleteEntities,
  pushDelta,
} from "./historyManager";

type CircuitContextProviderProps = {
  children: React.ReactNode;
  initialProject?: CircuitProject;
  initialCircuitId?: string;
};

// Liest einen Eigenschaftswert von einem Symbol bzw. seinem Circuit für das Vorher/Nachher-Delta aus
function readSymbolPropertyValue(
  symbol: CircuitSymbol,
  circuit: Circuit,
  pin: Pin | undefined,
  key: keyof CircuitSymbolPropertiesUpdate,
): unknown {
  if (key === "width") {
    return circuit.symbolWidth;
  }
  if (key === "height") {
    return circuit.symbolHeight;
  }
  if (key === "note" || key === "description") {
    return circuit.note;
  }
  if (key === "name") {
    return pin?.name ?? circuit.name;
  }
  if (circuit.kind === "pin") {
    if (key === "jamNotation") {
      return pin?.jamNotation ?? circuit.pins[0]?.jamNotation ?? "";
    }
    if (pin) {
      if (key === "bitWidth") {
        return pin.bitWidth;
      }
      if (key === "pinType") {
        return pin.pinType;
      }
      if (key === "pinSide") {
        return pin.pinSide;
      }
      if (key === "inverted") {
        return pin.inverted;
      }
    }
  }
  if (circuit.kind === "splitter" && key === "pinBitWidth") {
    const splitter = circuit as Splitter;
    return Math.max(1, Math.floor(splitter.bitWidth / splitter.pinCount));
  }
  if (circuit.kind === "synthesizer" && key === "synthesizerMode") {
    return (circuit as Synthesizer).mode;
  }
  if (circuit.kind === "sound") {
    const sound = circuit as Sound;
    if (key === "frequency") {
      return sound.frequency ?? SOUND_DEFAULT_FREQUENCY;
    }
    if (key === "waveform") {
      return sound.waveform ?? "sine";
    }
  }
  const record = circuit as unknown as Record<string, unknown>;
  if (key in record) {
    return record[key];
  }
  const symRecord = symbol as unknown as Record<string, unknown>;
  return symRecord[key];
}

// Berechnet mitzuführende oder kollabierende Leitungen, wenn sich Jam-Positionen eines Symbols ändern
function buildSymbolWireRubberband(
  beforeJams: Jam[],
  afterJams: Jam[],
  project: CircuitProject,
  logicalCircuitId: string,
): { wireChanges: WireEndpointUpdate[]; removedWires: Wire[] } {
  const wireChanges: WireEndpointUpdate[] = [];
  const removedWires: Wire[] = [];
  if (beforeJams.length !== afterJams.length) {
    return { wireChanges, removedWires };
  }

  const jamPointMap = new Map<string, GridPoint>();
  for (let i = 0; i < beforeJams.length; i++) {
    const oldPt = beforeJams[i].absolutePoint;
    const newPt = afterJams[i].absolutePoint;
    if (oldPt.x !== newPt.x || oldPt.y !== newPt.y) {
      jamPointMap.set(gridPointKey(oldPt), newPt);
    }
  }

  if (jamPointMap.size === 0) {
    return { wireChanges, removedWires };
  }

  const targetLc = project.logicalCircuits.find((lc) => lc.logicalCircuitId === logicalCircuitId);
  if (!targetLc) {
    return { wireChanges, removedWires };
  }

  for (const w of targetLc.wires) {
    const p1Next = jamPointMap.get(gridPointKey(w.point1)) ?? w.point1;
    const p2Next = jamPointMap.get(gridPointKey(w.point2)) ?? w.point2;
    if (p1Next.x !== w.x1 || p1Next.y !== w.y1 || p2Next.x !== w.x2 || p2Next.y !== w.y2) {
      if (p1Next.x === p2Next.x && p1Next.y === p2Next.y) {
        removedWires.push(w);
      } else {
        wireChanges.push({
          wireId: w.wireId,
          before: { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 },
          after: { x1: p1Next.x, y1: p1Next.y, x2: p2Next.x, y2: p2Next.y },
        });
      }
    }
  }

  return { wireChanges, removedWires };
}

const CircuitContextProvider: React.FC<CircuitContextProviderProps> = ({
  children,
  initialProject,
  initialCircuitId,
}) => {
  const [appSettings, setAppSettingsState] = React.useState<AppSettings>(() => loadAppSettings());
  const appSettingsRef = React.useRef<AppSettings>(appSettings);
  appSettingsRef.current = appSettings;

  const [isCleanUpVisualizationEnabled, setIsCleanUpVisualizationState] = React.useState<boolean>(
    () => loadCleanUpVisualizationEnabled(),
  );
  const isCleanUpVisualizationRef = React.useRef<boolean>(isCleanUpVisualizationEnabled);
  isCleanUpVisualizationRef.current = isCleanUpVisualizationEnabled;

  const [project, setProjectState] = React.useState<CircuitProject>(() => {
    if (initialProject) {
      return initialProject;
    }
    const settings = loadAppSettings();
    if (settings.startupProjectMode === "empty" || settings.startupProjectMode === "last") {
      return applyDefaultFrequencyToProject(createEmptyCircuitProject(), settings.defaultFrequency);
    }
    return createDemoCircuitProject();
  });
  const projectRef = React.useRef<CircuitProject>(project);
  projectRef.current = project;

  const [activeFileHandle, setActiveFileHandleState] = React.useState<FileSystemFileHandleLike | null>(null);
  const activeFileHandleRef = React.useRef<FileSystemFileHandleLike | null>(null);
  activeFileHandleRef.current = activeFileHandle;

  const [activeFileName, setActiveFileNameState] = React.useState<string | null>(null);
  const activeFileNameRef = React.useRef<string | null>(null);
  activeFileNameRef.current = activeFileName;

  const setActiveFileHandle = React.useCallback(
    (handle: FileSystemFileHandleLike | null, fileName?: string | null) => {
      activeFileHandleRef.current = handle;
      setActiveFileHandleState(handle);
      const resolvedName = fileName ?? handle?.name ?? null;
      activeFileNameRef.current = resolvedName;
      setActiveFileNameState(resolvedName);
    },
    [],
  );

  const hasUserProjectActionRef = React.useRef(false);

  const [hasUnsavedChanges, setHasUnsavedChangesState] = React.useState(false);
  const hasUnsavedChangesRef = React.useRef(false);
  hasUnsavedChangesRef.current = hasUnsavedChanges;

  const setHasUnsavedChanges = React.useCallback(
    (next: boolean) => {
      hasUnsavedChangesRef.current = next;
      setHasUnsavedChangesState(next);
    },
    [],
  );

  const updateAppSettings = React.useCallback(
    (updates: Partial<AppSettings>): AppSettings => {
      const next: AppSettings = {
        ...appSettingsRef.current,
        ...updates,
      };
      appSettingsRef.current = next;
      setAppSettingsState(next);
      saveAppSettings(next);
      if (updates.language !== undefined) {
        applyLanguagePreference(next.language);
      }
      return next;
    },
    [],
  );

  const setCleanUpVisualizationEnabled = React.useCallback(
    (enabled: boolean) => {
      isCleanUpVisualizationRef.current = enabled;
      setIsCleanUpVisualizationState(enabled);
      saveCleanUpVisualizationEnabled(enabled);
    },
    [],
  );

  const toggleCleanUpVisualization = React.useCallback(
    () => {
      setCleanUpVisualizationEnabled(!isCleanUpVisualizationRef.current);
    },
    [setCleanUpVisualizationEnabled],
  );

  // Warnt beim Neuladen oder Schließen des Tabs vor ungespeicherten Projektänderungen
  React.useEffect(
    () => {
      if (!hasUnsavedChanges || typeof window === "undefined") {
        return;
      }

      const handleBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };

      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    },
    [hasUnsavedChanges],
  );

  // Synchronisiert den Browser-Tab-Titel mit dem aktiven Dateinamen und Dirty-Indikator
  React.useEffect(
    () => {
      if (typeof document === "undefined") {
        return;
      }
      document.title = formatDocumentTitle(activeFileName, hasUnsavedChanges);
    },
    [activeFileName, hasUnsavedChanges],
  );

  const applyProjectChange = React.useCallback(
    (action: React.SetStateAction<CircuitProject>, markDirty = true) => {
      const next = typeof action === "function" ? action(projectRef.current) : action;
      projectRef.current = next;
      setProjectState(next);
      if (markDirty) {
        hasUserProjectActionRef.current = true;
        setHasUnsavedChanges(true);
      }
    },
    [setHasUnsavedChanges],
  );

  const setProject = React.useCallback(
    (action: React.SetStateAction<CircuitProject>) => {
      applyProjectChange(action, true);
    },
    [applyProjectChange],
  );

  const [historiesByCircuit, setHistoriesByCircuitState] = React.useState<Record<string, HistoryState>>(
    () => ({}),
  );
  const historiesByCircuitRef = React.useRef<Record<string, HistoryState>>(historiesByCircuit);
  historiesByCircuitRef.current = historiesByCircuit;

  const setHistoriesByCircuit = React.useCallback(
    (action: React.SetStateAction<Record<string, HistoryState>>) => {
      const next = typeof action === "function" ? action(historiesByCircuitRef.current) : action;
      historiesByCircuitRef.current = next;
      setHistoriesByCircuitState(next);
    },
    [],
  );

  const [currentCircuitId, setCurrentCircuitIdState] = React.useState<string>(
    () => initialCircuitId ?? project.project.logicalCircuitId,
  );
  const currentCircuitIdRef = React.useRef<string>(currentCircuitId);
  currentCircuitIdRef.current = currentCircuitId;

  const recordDelta = React.useCallback(
    (delta: CircuitDelta) => {
      const targetCircuitId = delta.logicalCircuitId || currentCircuitIdRef.current;
      setHistoriesByCircuit((prev) => ({
        ...prev,
        [targetCircuitId]: pushDelta(
          prev[targetCircuitId] ?? createEmptyHistoryState(),
          delta,
        ),
      }));
    },
    [setHistoriesByCircuit],
  );

  const clearHistory = React.useCallback(
    () => {
      const targetCircuitId = currentCircuitIdRef.current;
      setHistoriesByCircuit((prev) => ({
        ...prev,
        [targetCircuitId]: createEmptyHistoryState(),
      }));
    },
    [setHistoriesByCircuit],
  );

  const [selectedSymbolIds, setSelectedSymbolIdsState] = React.useState<string[]>([]);
  const selectedSymbolIdsRef = React.useRef<string[]>(selectedSymbolIds);
  selectedSymbolIdsRef.current = selectedSymbolIds;

  const setSelectedSymbolIds = React.useCallback(
    (action: React.SetStateAction<string[]>) => {
      const next = typeof action === "function" ? action(selectedSymbolIdsRef.current) : action;
      selectedSymbolIdsRef.current = next;
      setSelectedSymbolIdsState(next);
    },
    [],
  );

  const [selectedTextNoteIds, setSelectedTextNoteIdsState] = React.useState<string[]>([]);
  const selectedTextNoteIdsRef = React.useRef<string[]>(selectedTextNoteIds);
  selectedTextNoteIdsRef.current = selectedTextNoteIds;

  const setSelectedTextNoteIds = React.useCallback(
    (action: React.SetStateAction<string[]>) => {
      const next = typeof action === "function" ? action(selectedTextNoteIdsRef.current) : action;
      selectedTextNoteIdsRef.current = next;
      setSelectedTextNoteIdsState(next);
    },
    [],
  );

  const [selectedWireIds, setSelectedWireIdsState] = React.useState<string[]>([]);
  const selectedWireIdsRef = React.useRef<string[]>(selectedWireIds);
  selectedWireIdsRef.current = selectedWireIds;

  const setSelectedWireIds = React.useCallback(
    (action: React.SetStateAction<string[]>) => {
      const next = typeof action === "function" ? action(selectedWireIdsRef.current) : action;
      selectedWireIdsRef.current = next;
      setSelectedWireIdsState(next);
    },
    [],
  );

  const [activePaletteDrag, setActivePaletteDrag] = React.useState<PaletteSelection | null>(null);

  const setCurrentCircuitId = React.useCallback(
    (circuitId: string) => {
      currentCircuitIdRef.current = circuitId;
      setCurrentCircuitIdState(circuitId);
      // Aktive Schaltung direkt im Projekt-Metadatenfeld synchronisieren (für Speichern/Startschaltung)
      if (projectRef.current.project.logicalCircuitId !== circuitId) {
        applyProjectChange(
          (prev) => ({
            ...prev,
            project: {
              ...prev.project,
              logicalCircuitId: circuitId,
            },
          }),
          false,
        );
      }
      setSelectedSymbolIds([]);
      setSelectedTextNoteIds([]);
      setSelectedWireIds([]);
      setActivePaletteDrag(null);
    },
    [applyProjectChange],
  );

  const currentCircuit = React.useMemo(
    () => {
      return (
        project.logicalCircuits.find(
          (lc) => lc.logicalCircuitId === currentCircuitId,
        ) ?? project.logicalCircuits[0]
      );
    },
    [currentCircuitId, project.logicalCircuits],
  );

  const selectSymbol = React.useCallback(
    (symbolId: string | null, multiSelect = false) => {
      if (!symbolId) {
        setSelectedSymbolIds([]);
        return;
      }

      setSelectedSymbolIds((prev) => {
        if (!multiSelect) {
          return [symbolId];
        }
        if (prev.includes(symbolId)) {
          return prev.filter((id) => id !== symbolId);
        }
        return [...prev, symbolId];
      });
    },
    [],
  );

  const selectTextNote = React.useCallback(
    (textNoteId: string | null, multiSelect = false) => {
      if (!textNoteId) {
        setSelectedTextNoteIds([]);
        return;
      }

      setSelectedTextNoteIds((prev) => {
        if (!multiSelect) {
          return [textNoteId];
        }
        if (prev.includes(textNoteId)) {
          return prev.filter((id) => id !== textNoteId);
        }
        return [...prev, textNoteId];
      });
    },
    [],
  );

  const selectWire = React.useCallback(
    (wireId: string | null, multiSelect = false) => {
      if (!wireId) {
        setSelectedWireIds([]);
        return;
      }

      setSelectedWireIds((prev) => {
        if (!multiSelect) {
          return [wireId];
        }
        if (prev.includes(wireId)) {
          return prev.filter((id) => id !== wireId);
        }
        return [...prev, wireId];
      });
    },
    [],
  );

  const selectSymbols = React.useCallback(
    (symbolIds: string[], additive = false) => {
      setSelectedSymbolIds((prev) => {
        if (!additive) {
          return symbolIds;
        }
        const set = new Set([...prev, ...symbolIds]);
        return Array.from(set);
      });
    },
    [],
  );

  const selectTextNotes = React.useCallback(
    (textNoteIds: string[], additive = false) => {
      setSelectedTextNoteIds((prev) => {
        if (!additive) {
          return textNoteIds;
        }
        const set = new Set([...prev, ...textNoteIds]);
        return Array.from(set);
      });
    },
    [],
  );

  const selectWires = React.useCallback(
    (wireIds: string[], additive = false) => {
      setSelectedWireIds((prev) => {
        if (!additive) {
          return wireIds;
        }
        const set = new Set([...prev, ...wireIds]);
        return Array.from(set);
      });
    },
    [],
  );

  const selectConductor = React.useCallback(
    (wireId: string, mode: "replace" | "add" | "toggle" = "replace") => {
      const currentProj = projectRef.current;
      const targetCircuit = currentProj.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === currentCircuitIdRef.current,
      ) ?? currentProj.logicalCircuits[0];

      if (!targetCircuit) {
        return;
      }

      const targetWire = targetCircuit.wires.find((w) => w.wireId === wireId);
      if (!targetWire) {
        return;
      }

      const conductorWires = getConductorWiresForWire(targetWire, targetCircuit.conductorMap);
      const conductorWireIds = conductorWires.map((w) => w.wireId);

      if (mode === "replace") {
        setSelectedSymbolIds([]);
        setSelectedTextNoteIds([]);
        setSelectedWireIds(conductorWireIds);
        return;
      }

      if (mode === "add") {
        setSelectedWireIds((prev) => Array.from(new Set([...prev, ...conductorWireIds])));
        return;
      }

      // mode === "toggle": Wenn bereits alle oder die angeklickte Leitung ausgewählt sind, Conductor abwählen
      setSelectedWireIds((prev) => {
        const conductorSet = new Set(conductorWireIds);
        if (prev.includes(wireId)) {
          return prev.filter((id) => !conductorSet.has(id));
        }
        return Array.from(new Set([...prev, ...conductorWireIds]));
      });
    },
    [],
  );

  const selectEntities = React.useCallback(
    (
      symbolIds: string[],
      textNoteIds: string[],
      additive = false,
      wireIds: string[] = [],
    ) => {
      selectSymbols(symbolIds, additive);
      selectTextNotes(textNoteIds, additive);
      selectWires(wireIds, additive);
    },
    [
      selectSymbols,
      selectTextNotes,
      selectWires,
    ],
  );

  const cloneSandboxProject = React.useCallback(
    (source: CircuitProject): CircuitProject => ({
      ...source,
      circuits: new Map(source.circuits),
      gates: new Map(source.gates),
      pins: [...source.pins],
      circuitButtons: [...source.circuitButtons],
      constants: [...source.constants],
      circuitProbes: [...source.circuitProbes],
      ledMatrices: [...source.ledMatrices],
      memories: [...source.memories],
      sensors: [...source.sensors],
      sounds: [...source.sounds],
      synthesizers: [...source.synthesizers],
      graphicsArrays: [...source.graphicsArrays],
      splitters: [...source.splitters],
    }),
    [],
  );

  // Fügt beliebig viele Symbole, Textnotizen und Leitungen atomar als einzelnes Undo-Delta hinzu
  const addEntities = React.useCallback(
    (params: AddEntitiesParams): AddEntitiesResult => {
      const currentProj = projectRef.current;
      const targetCircuit = currentProj.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === currentCircuitIdRef.current,
      ) ?? currentProj.logicalCircuits[0];
      const targetCircuitId = targetCircuit?.logicalCircuitId ?? currentCircuitIdRef.current;

      const sandboxProject = cloneSandboxProject(currentProj);
      const deltaSymbols: { symbol: CircuitSymbol; circuit: Circuit; pin?: Pin }[] = [];
      const placedWithRefs: { ref?: string; symbol: CircuitSymbol }[] = [];

      for (const item of params.symbols ?? []) {
        const { circuitSymbol, circuit } = instantiateCircuitFromPalette(
          sandboxProject,
          targetCircuitId,
          item.selection,
          item.gridPoint,
        );
        const createdPin = circuit.kind === "pin"
          ? sandboxProject.pins.find((p) => p.pinId === circuit.circuitId)
          : undefined;

        deltaSymbols.push({ symbol: circuitSymbol, circuit, pin: createdPin });
        placedWithRefs.push({ ref: item.ref, symbol: circuitSymbol });
      }

      const createdNotes: TextNote[] = (params.textNotes ?? []).map((item) => createTextNote(
        targetCircuitId,
        item.gridPoint.x,
        item.gridPoint.y,
        item.note,
        item.options,
      ));

      const rawSegments = [
        ...(params.wireSegments ?? []),
        ...(params.resolveWires?.(placedWithRefs) ?? []),
      ];

      const existingWires = targetCircuit?.wires ?? [];
      const createdWires: Wire[] = [];

      for (const seg of rawSegments) {
        if (seg.point1.x === seg.point2.x && seg.point1.y === seg.point2.y) {
          continue;
        }
        const isDuplicate =
          existingWires.some((w) => isSameWireSegment(w, seg.point1, seg.point2)) ||
          createdWires.some((w) => isSameWireSegment(w, seg.point1, seg.point2));
        if (!isDuplicate) {
          createdWires.push(createWire(targetCircuitId, seg.point1, seg.point2));
        }
      }

      const placedSymbols = placedWithRefs.map((entry) => entry.symbol);
      if (deltaSymbols.length === 0 && createdNotes.length === 0 && createdWires.length === 0) {
        return { symbols: [], textNotes: [], wires: [] };
      }

      const delta: CircuitDelta = {
        type: "add",
        logicalCircuitId: targetCircuitId,
        symbols: deltaSymbols,
        textNotes: createdNotes,
        wires: createdWires.length > 0 ? createdWires : undefined,
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      recordDelta(delta);

      const updatedCircuit = projectRef.current.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === targetCircuitId,
      );
      const createdWireIdSet = new Set(createdWires.map((w) => w.wireId));
      const finalWires = updatedCircuit
        ? updatedCircuit.wires.filter((w) => createdWireIdSet.has(w.wireId))
        : createdWires;

      return {
        symbols: placedSymbols,
        textNotes: createdNotes,
        wires: finalWires,
      };
    },
    [
      cloneSandboxProject,
      recordDelta,
      setProject,
    ],
  );

  // Übernimmt einen vorbereiteten Paste-Payload (inkl. fehlender Subschaltungen) als einzelnen Undo-Schritt
  const commitPastePayload = React.useCallback(
    (payload: PreparedPastePayload): AddEntitiesResult => {
      const targetCircuitId = payload.targetCircuitId || currentCircuitIdRef.current;
      const targetCircuit = projectRef.current.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === targetCircuitId,
      );
      const existingWires = targetCircuit?.wires ?? [];
      const uniqueWires: Wire[] = [];
      for (const w of payload.wires) {
        if (w.point1.x === w.point2.x && w.point1.y === w.point2.y) {
          continue;
        }
        const dup =
          existingWires.some((ew) => isSameWireSegment(ew, w.point1, w.point2)) ||
          uniqueWires.some((uw) => isSameWireSegment(uw, w.point1, w.point2));
        if (!dup) {
          uniqueWires.push(w);
        }
      }

      if (payload.symbols.length === 0 && payload.textNotes.length === 0 && uniqueWires.length === 0) {
        return { symbols: [], textNotes: [], wires: [] };
      }

      const delta: CircuitDelta = {
        type: "add",
        logicalCircuitId: targetCircuitId,
        symbols: payload.symbols,
        textNotes: payload.textNotes,
        wires: uniqueWires.length > 0 ? uniqueWires : undefined,
      };

      setProject((prevProject) => {
        let base = prevProject;
        if (payload.importedSubCircuits.length > 0) {
          const nextCircuits = new Map(prevProject.circuits);
          const nextGates = new Map(prevProject.gates);
          const existingLcIds = new Set(prevProject.logicalCircuits.map((lc) => lc.logicalCircuitId));
          const addedLcs = payload.importedSubCircuits.filter(
            (lc) => !existingLcIds.has(lc.logicalCircuitId),
          );
          for (const lc of addedLcs) {
            nextCircuits.set(lc.circuitId, lc);
          }
          for (const gate of payload.importedGates) {
            nextGates.set(gate.gateId, gate);
            nextCircuits.set(gate.circuitId, gate);
          }
          const appendUnique = <T, >(current: T[], incoming: T[], getId: (item: T) => string): T[] => {
            if (incoming.length === 0) {
              return current;
            }
            const known = new Set(current.map(getId));
            const filtered = incoming.filter((item) => !known.has(getId(item)));
            return filtered.length > 0 ? [...current, ...filtered] : current;
          };

          base = {
            ...prevProject,
            circuits: nextCircuits,
            gates: nextGates,
            logicalCircuits: [...prevProject.logicalCircuits, ...addedLcs],
            pins: appendUnique(prevProject.pins, payload.importedPins, (p) => p.pinId),
            circuitButtons: appendUnique(prevProject.circuitButtons, payload.importedButtons, (b) => b.circuitButtonId),
            constants: appendUnique(prevProject.constants, payload.importedConstants, (c) => c.constantId),
            circuitProbes: appendUnique(prevProject.circuitProbes, payload.importedProbes, (p) => p.circuitProbeId),
            ledMatrices: appendUnique(prevProject.ledMatrices, payload.importedLedMatrices, (m) => m.ledMatrixId),
            splitters: appendUnique(prevProject.splitters, payload.importedSplitters, (s) => s.splitterId),
            memories: appendUnique(prevProject.memories, payload.importedMemories, (m) => m.memoryId),
            sensors: appendUnique(prevProject.sensors, payload.importedSensors, (s) => s.sensorId),
            sounds: appendUnique(prevProject.sounds, payload.importedSounds, (s) => s.soundId),
            synthesizers: appendUnique(
              prevProject.synthesizers,
              payload.importedSynthesizers,
              (s) => s.synthesizerId,
            ),
            graphicsArrays: appendUnique(prevProject.graphicsArrays, payload.importedGraphicsArrays, (g) => g.graphicsArrayId),
          };
        }

        return applyDeltaForward(base, delta);
      });

      recordDelta(delta);

      const pastedSymbolIds = payload.symbols.map((s) => s.symbol.circuitSymbolId);
      const pastedNoteIds = payload.textNotes.map((n) => n.textNoteId);
      const pastedWireIds = uniqueWires.map((w) => w.wireId);
      selectEntities(pastedSymbolIds, pastedNoteIds, false, pastedWireIds);

      const updatedCircuit = projectRef.current.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === targetCircuitId,
      );
      const createdWireIdSet = new Set(pastedWireIds);
      const finalWires = updatedCircuit
        ? updatedCircuit.wires.filter((w) => createdWireIdSet.has(w.wireId))
        : uniqueWires;

      return {
        symbols: payload.symbols.map((s) => s.symbol),
        textNotes: payload.textNotes,
        wires: finalWires,
      };
    },
    [
      recordDelta,
      selectEntities,
      setProject,
    ],
  );

  const addSymbol = React.useCallback(
    (selection: PaletteSelection, gridPoint: GridPoint): CircuitSymbol => {
      return addEntities({ symbols: [{ selection, gridPoint }] }).symbols[0];
    },
    [addEntities],
  );

  const addTextNote = React.useCallback(
    (
      note: string,
      gridPoint: GridPoint,
      options?: {
        lineHeight?: TextNoteLineHeight;
        fontFamily?: TextNoteFontFamily;
        lineHeights?: TextNoteLineHeight[];
      },
    ): TextNote => {
      return addEntities({ textNotes: [{ note, gridPoint, options }] }).textNotes[0];
    },
    [addEntities],
  );

  // Legt eine neue Leitung zwischen point1 und point2 an (analog zu EditorDiagram.CreateWire)
  const addWire = React.useCallback(
    (point1: GridPoint, point2: GridPoint): Wire | null => {
      const result = addEntities({ wireSegments: [{ point1, point2 }] });
      return result.wires[0] ?? null;
    },
    [addEntities],
  );

  // Teilt eine bestehende Leitung am angegebenen Rasterpunkt in zwei Segmente (analog zu EditorDiagram.Split)
  const splitWire = React.useCallback(
    (wireId: string, splitPoint: GridPoint): [Wire, Wire] | null => {
      const currentProj = projectRef.current;
      const targetCircuit = currentProj.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === currentCircuitIdRef.current,
      ) ?? currentProj.logicalCircuits[0];

      if (!targetCircuit) {
        return null;
      }

      const wire = targetCircuit.wires.find((w) => w.wireId === wireId);
      if (!wire) {
        return null;
      }

      if (
        (wire.x1 === splitPoint.x && wire.y1 === splitPoint.y) ||
        (wire.x2 === splitPoint.x && wire.y2 === splitPoint.y)
      ) {
        return null;
      }

      const wire2 = createWire(targetCircuit.logicalCircuitId, splitPoint, wire.point2);
      const updatedWire = updateWireEndpoints(wire, wire.x1, wire.y1, splitPoint.x, splitPoint.y);

      const delta: CircuitDelta = {
        type: "wireBatch",
        logicalCircuitId: targetCircuit.logicalCircuitId,
        addedWires: [wire2],
        removedWires: [],
        updatedWires: [
          {
            wireId: wire.wireId,
            before: { x1: wire.x1, y1: wire.y1, x2: wire.x2, y2: wire.y2 },
            after: { x1: updatedWire.x1, y1: updatedWire.y1, x2: updatedWire.x2, y2: updatedWire.y2 },
          },
        ],
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      recordDelta(delta);

      setSelectedSymbolIds([]);
      setSelectedTextNoteIds([]);
      setSelectedWireIds([wire.wireId, wire2.wireId]);

      return [updatedWire, wire2];
    },
    [recordDelta, setProject],
  );

  // Verschmilzt zwei aneinandergrenzende Leitungen am gemeinsamen Endpunkt (analog zu EditorDiagram.Merge)
  const mergeWires = React.useCallback(
    (wireId1: string, wireId2: string): Wire | null => {
      if (wireId1 === wireId2) {
        return null;
      }

      const currentProj = projectRef.current;
      const targetCircuit = currentProj.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === currentCircuitIdRef.current,
      ) ?? currentProj.logicalCircuits[0];

      if (!targetCircuit) {
        return null;
      }

      const wire1 = targetCircuit.wires.find((w) => w.wireId === wireId1);
      const wire2 = targetCircuit.wires.find((w) => w.wireId === wireId2);
      if (!wire1 || !wire2) {
        return null;
      }

      let point1: GridPoint | null = null;
      let point2: GridPoint | null = null;

      if (wire1.x1 === wire2.x1 && wire1.y1 === wire2.y1) {
        point1 = wire1.point2;
        point2 = wire2.point2;
      } else if (wire1.x1 === wire2.x2 && wire1.y1 === wire2.y2) {
        point1 = wire1.point2;
        point2 = wire2.point1;
      } else if (wire1.x2 === wire2.x1 && wire1.y2 === wire2.y1) {
        point1 = wire1.point1;
        point2 = wire2.point2;
      } else if (wire1.x2 === wire2.x2 && wire1.y2 === wire2.y2) {
        point1 = wire1.point1;
        point2 = wire2.point1;
      } else {
        return null;
      }

      if (point1.x === point2.x && point1.y === point2.y) {
        return null;
      }

      const mergedWire = updateWireEndpoints(wire1, point1.x, point1.y, point2.x, point2.y);

      const delta: CircuitDelta = {
        type: "wireBatch",
        logicalCircuitId: targetCircuit.logicalCircuitId,
        addedWires: [],
        removedWires: [wire2],
        updatedWires: [
          {
            wireId: wire1.wireId,
            before: { x1: wire1.x1, y1: wire1.y1, x2: wire1.x2, y2: wire1.y2 },
            after: { x1: mergedWire.x1, y1: mergedWire.y1, x2: mergedWire.x2, y2: mergedWire.y2 },
          },
        ],
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      recordDelta(delta);

      setSelectedSymbolIds([]);
      setSelectedTextNoteIds([]);
      setSelectedWireIds([wire1.wireId]);

      return mergedWire;
    },
    [recordDelta, setProject],
  );

  // Aktualisiert Leitungs-Koordinaten live während einer Drag-Bewegung ohne History-Eintrag
  const updateWiresLive = React.useCallback(
    (
      updates: { wireId: string; x1: number; y1: number; x2: number; y2: number }[],
      removedWireIds: string[] = [],
    ) => {
      if (updates.length === 0 && removedWireIds.length === 0) {
        return;
      }
      const updateMap = new Map(updates.map((u) => [u.wireId, u]));
      const removedSet = new Set(removedWireIds);

      setProject((prevProject) => {
        const updateList = (list: Wire[]): Wire[] =>
          list
            .filter((w) => !removedSet.has(w.wireId))
            .map((w) => {
              const u = updateMap.get(w.wireId);
              if (!u) {
                return w;
              }
              return updateWireEndpoints(w, u.x1, u.y1, u.x2, u.y2);
            });

        return recalculateProjectWires({
          ...prevProject,
          wires: updateList(prevProject.wires),
          logicalCircuits: prevProject.logicalCircuits.map((lc) => ({
            ...lc,
            wires: updateList(lc.wires),
          })),
        });
      });
    },
    [setProject],
  );

  const updateTextNote = React.useCallback(
    (
      textNoteId: string,
      updates: Partial<TextNote>,
      options?: { recordHistory?: boolean },
    ) => {
      const currentProj = projectRef.current;
      const existingNote = currentProj.textNotes.find((n) => n.textNoteId === textNoteId);
      if (!existingNote) {
        return;
      }

      const updated: TextNote = { ...existingNote, ...updates };
      if (updates.note !== undefined || updates.lineHeight !== undefined || updates.lineHeights !== undefined) {
        const lines = updated.note.split("\n");
        const defaultLh = updated.lineHeight ?? 18;
        const totalPxHeight = lines.reduce((sum, _, idx) => {
          const lh = updated.lineHeights?.[idx] ?? defaultLh;
          return sum + lh;
        }, 0);
        const minHeight = Math.max(1, Math.ceil(totalPxHeight / GRID_SIZE));
        const maxLineLen = Math.max(1, ...lines.map((l) => l.length));
        const minWidth = Math.max(4, Math.ceil((maxLineLen * 9 + 16) / GRID_SIZE));
        updated.width = Math.max(updated.width || 4, minWidth);
        updated.height = Math.max(updated.height || 1, minHeight);
      }
      if (updates.width !== undefined) {
        updated.width = clampGridDimension(updates.width, TEXT_NOTE_MIN_GRID_SIZE, TEXT_NOTE_MAX_GRID_SIZE);
      }
      if (updates.height !== undefined) {
        updated.height = clampGridDimension(updates.height, TEXT_NOTE_MIN_GRID_SIZE, TEXT_NOTE_MAX_GRID_SIZE);
      }

      const changes: Record<string, PropertyChange> = {};
      const keys: (keyof TextNote)[] = ["note", "x", "y", "width", "height", "rotation", "lineHeight", "fontFamily", "lineHeights"];
      for (const key of keys) {
        if (existingNote[key] !== updated[key]) {
          changes[key] = { before: existingNote[key], after: updated[key] };
        }
      }

      const replaceNote = (n: TextNote): TextNote => (n.textNoteId === textNoteId ? updated : n);
      setProject((prevProject) => ({
        ...prevProject,
        textNotes: prevProject.textNotes.map(replaceNote),
        logicalCircuits: prevProject.logicalCircuits.map((lc) => ({
          ...lc,
          textNotes: lc.textNotes.map(replaceNote),
        })),
      }));

      if (options?.recordHistory !== false && Object.keys(changes).length > 0) {
        recordDelta({
          type: "updateProperty",
          logicalCircuitId: existingNote.logicalCircuitId,
          targetType: "textNote",
          targetId: textNoteId,
          changes,
          beforeTextNote: existingNote,
          afterTextNote: updated,
        });
      }
    },
    [recordDelta, setProject],
  );

  const updateCircuitSymbolProperties = React.useCallback(
    (
      symbolId: string,
      updates: CircuitSymbolPropertiesUpdate,
      options?: { x?: number; y?: number; withWires?: boolean },
    ): CircuitSymbol | null => {
      const currentProject = projectRef.current;
      const symbol =
        currentProject.circuitSymbols.find((s) => s.circuitSymbolId === symbolId) ??
        currentProject.logicalCircuits.flatMap((lc) => lc.circuitSymbols).find((s) => s.circuitSymbolId === symbolId);
      if (!symbol) {
        return null;
      }

      const beforePin = symbol.circuit.kind === "pin"
        ? currentProject.pins.find((p) => p.pinId === symbol.circuit.circuitId)
        : undefined;

      let updatedCircuit: Circuit = symbol.circuit;
      let afterPin: Pin | undefined = beforePin;

      if (symbol.circuit.kind === "gate") {
        const gate = symbol.circuit as Gate;
        const gateType = updates.gateType !== undefined ? updates.gateType : gate.gateType;
        const inputCount = updates.inputCount !== undefined ? updates.inputCount : gate.inputCount;
        const invertedOutput = updates.invertedOutput !== undefined ? updates.invertedOutput : gate.invertedOutput;
        const nextColor = updates.color !== undefined ? updates.color : (gate.color ?? "red");
        const newGate = createGate(gateType, inputCount, invertedOutput, nextColor);
        if (updates.note !== undefined) {
          newGate.note = updates.note;
        } else {
          newGate.note = gate.note;
        }
        if (updates.name !== undefined) {
          newGate.name = updates.name;
        }
        updatedCircuit = newGate;
      } else if (symbol.circuit.kind === "circuitButton") {
        const button = symbol.circuit as CircuitButton;
        const notation = updates.notation !== undefined ? updates.notation : button.notation;
        const isToggle = updates.isToggle !== undefined ? updates.isToggle : button.isToggle;
        const pinSide = updates.pinSide !== undefined ? updates.pinSide : button.pinSide;
        const inverted = updates.inverted !== undefined ? updates.inverted : button.inverted;
        const width = updates.width !== undefined ? updates.width : button.width;
        const height = updates.height !== undefined ? updates.height : button.height;
        const modifiers = updates.modifiers !== undefined ? updates.modifiers : button.modifiers;
        const keyCode = updates.keyCode !== undefined ? updates.keyCode : button.keyCode;
        const newButton = createCircuitButton(
          button.circuitButtonId,
          notation,
          isToggle,
          pinSide,
          inverted,
          width,
          height,
          button.isOn ?? false,
        );
        newButton.name = updates.name !== undefined ? updates.name : button.name;
        newButton.modifiers = modifiers;
        newButton.keyCode = keyCode;
        newButton.note = updates.note !== undefined ? updates.note : button.note;
        updatedCircuit = newButton;
      } else if (symbol.circuit.kind === "constant") {
        const constant = symbol.circuit as Constant;
        const bitWidth = updates.bitWidth !== undefined ? updates.bitWidth : constant.bitWidth;
        const value = updates.value !== undefined ? updates.value : constant.value;
        const pinSide = updates.pinSide !== undefined ? updates.pinSide : constant.pinSide;
        const isHex = updates.isHex !== undefined ? updates.isHex : (constant.isHex ?? true);
        const symbolWidth = updates.width !== undefined ? updates.width : constant.symbolWidth;
        const symbolHeight = updates.height !== undefined ? updates.height : constant.symbolHeight;
        const newConstant = createConstant(
          constant.constantId,
          bitWidth,
          value,
          pinSide,
          isHex,
          symbolWidth,
          symbolHeight,
        );
        newConstant.note = updates.note !== undefined ? updates.note : constant.note;
        updatedCircuit = newConstant;
      } else if (symbol.circuit.kind === "pin") {
        const existingPin = beforePin;
        const rawName = updates.name !== undefined ? updates.name : (existingPin?.name ?? symbol.circuit.name);
        const otherPins = currentProject.pins.filter(
          (p) => p.circuitId === symbol.logicalCircuitId && p.pinId !== (existingPin?.pinId ?? symbol.circuit.circuitId),
        );
        const name = generateUniquePinName(rawName, otherPins);
        const bitWidth = updates.bitWidth !== undefined ? updates.bitWidth : (existingPin?.bitWidth ?? 1);
        const rawPinType = updates.pinType !== undefined ? updates.pinType : (existingPin?.pinType ?? "input");
        const pinType: "input" | "output" = rawPinType === "output" ? "output" : "input";
        const pinSide = updates.pinSide !== undefined ? updates.pinSide : existingPin?.pinSide;
        const inverted = updates.inverted !== undefined ? updates.inverted : (existingPin?.inverted ?? false);
        const index = existingPin?.index ?? 0;
        const symbolWidth = updates.width !== undefined ? updates.width : symbol.circuit.symbolWidth;
        const symbolHeight = updates.height !== undefined ? updates.height : symbol.circuit.symbolHeight;
        const jamNotation = updates.jamNotation !== undefined
          ? updates.jamNotation
          : (existingPin?.jamNotation ?? symbol.circuit.pins[0]?.jamNotation ?? "");

        const { pin: newPin, pinCircuit: newPinCircuit } = createPinCircuit(
          symbol.circuit.circuitId,
          symbol.logicalCircuitId,
          pinType,
          name,
          bitWidth,
          pinSide,
          inverted,
          index,
          symbolWidth,
          symbolHeight,
          jamNotation,
        );
        const nextNote = updates.note !== undefined ? updates.note : symbol.circuit.note;
        newPin.note = nextNote;
        newPinCircuit.note = nextNote;
        afterPin = newPin;
        updatedCircuit = newPinCircuit;
      } else if (symbol.circuit.kind === "circuitProbe") {
        const probe = symbol.circuit as CircuitProbe;
        const name = updates.name !== undefined ? updates.name : probe.name;
        const pinSide = updates.pinSide !== undefined ? updates.pinSide : probe.pinSide;
        const symbolWidth = updates.width !== undefined ? updates.width : symbol.circuit.symbolWidth;
        const symbolHeight = updates.height !== undefined ? updates.height : symbol.circuit.symbolHeight;
        const displayFormat = updates.displayFormat ?? probe.displayFormat ?? (probe.isHex ? "hex" : "bin");
        const isHex = updates.isHex !== undefined ? updates.isHex : displayFormat === "hex";
        const newProbe = createCircuitProbe(
          probe.circuitProbeId,
          name,
          pinSide,
          symbolWidth,
          symbolHeight,
          isHex,
        );
        newProbe.displayFormat = displayFormat;
        newProbe.note = updates.note !== undefined ? updates.note : probe.note;
        updatedCircuit = newProbe;
      } else if (symbol.circuit.kind === "ledMatrix") {
        const matrix = symbol.circuit as LedMatrix;
        const rows = updates.rows !== undefined ? updates.rows : matrix.rows;
        const columns = updates.columns !== undefined ? updates.columns : matrix.columns;
        const matrixType = updates.matrixType !== undefined ? updates.matrixType : matrix.matrixType;
        const cellShape = updates.cellShape !== undefined ? updates.cellShape : matrix.cellShape;
        const colors = updates.colors !== undefined ? updates.colors : matrix.colors;
        const persistenceMultiplier = updates.persistenceMultiplier !== undefined
          ? updates.persistenceMultiplier
          : (matrix.persistenceMultiplier ?? 1);
        const newMatrix = createLedMatrix(
          matrix.ledMatrixId,
          rows,
          columns,
          matrixType,
          cellShape,
          colors,
          persistenceMultiplier,
        );
        newMatrix.note = updates.note !== undefined ? updates.note : matrix.note;
        newMatrix.name = updates.name !== undefined ? updates.name : matrix.name;
        updatedCircuit = newMatrix;
      } else if (symbol.circuit.kind === "splitter") {
        const splitter = symbol.circuit as Splitter;
        const pinCount = updates.pinCount !== undefined ? updates.pinCount : splitter.pinCount;
        const pinBitWidth = updates.pinBitWidth !== undefined
          ? updates.pinBitWidth
          : Math.max(1, Math.floor(splitter.bitWidth / splitter.pinCount));
        const bitWidth = updates.bitWidth !== undefined ? updates.bitWidth : pinCount * pinBitWidth;
        const clockwise = updates.clockwise !== undefined ? updates.clockwise : splitter.clockwise;
        const newSplitter = createSplitter(splitter.splitterId, bitWidth, pinCount, clockwise);
        newSplitter.note = updates.note !== undefined ? updates.note : splitter.note;
        updatedCircuit = newSplitter;
      } else if (symbol.circuit.kind === "sensor") {
        const sensor = symbol.circuit as Sensor;
        const sensorType = updates.sensorType !== undefined ? updates.sensorType : sensor.sensorType;
        const bitWidth = updates.bitWidth !== undefined ? updates.bitWidth : sensor.bitWidth;
        const pinSide = updates.pinSide !== undefined ? updates.pinSide : sensor.pinSide;
        const notation = updates.notation !== undefined ? updates.notation : sensor.notation;
        const data = updates.data !== undefined ? updates.data : sensor.data;
        const note = updates.note !== undefined
          ? updates.note
          : (updates.description !== undefined ? updates.description : sensor.note);
        updatedCircuit = createSensor(
          sensor.sensorId,
          sensorType,
          bitWidth,
          pinSide,
          notation,
          data,
          note,
        );
      } else if (symbol.circuit.kind === "memory") {
        const memory = symbol.circuit as Memory;
        const nextAddressBitWidth = clampAddressBitWidth(
          updates.addressBitWidth !== undefined ? updates.addressBitWidth : memory.addressBitWidth,
        );
        const nextDataBitWidth = clampDataBitWidth(
          updates.dataBitWidth !== undefined ? updates.dataBitWidth : memory.dataBitWidth,
        );
        const nextWriteOn1 = memory.writable
          ? (updates.writeOn1 !== undefined ? updates.writeOn1 : memory.writeOn1)
          : false;
        const nextOnStart = memory.writable
          ? (updates.onStart !== undefined ? updates.onStart : memory.onStart)
          : "random";
        const nextDualPort = updates.dualPort !== undefined ? updates.dualPort : memory.dualPort;
        const nextNote = updates.note !== undefined
          ? updates.note
          : (updates.description !== undefined ? updates.description : memory.note);

        let nextData = "";
        if (!memory.writable || nextOnStart === "data") {
          if (updates.data !== undefined) {
            nextData = encodeMemoryData(
              decodeMemoryData(updates.data, nextAddressBitWidth, nextDataBitWidth),
              nextAddressBitWidth,
              nextDataBitWidth,
            );
          } else if (
            nextAddressBitWidth !== memory.addressBitWidth ||
            nextDataBitWidth !== memory.dataBitWidth
          ) {
            const oldBytes = decodeMemoryData(
              memory.data,
              memory.addressBitWidth,
              memory.dataBitWidth,
            );
            const reallocated = reallocateMemoryData(
              oldBytes,
              memory.addressBitWidth,
              memory.dataBitWidth,
              nextAddressBitWidth,
              nextDataBitWidth,
            );
            nextData = encodeMemoryData(reallocated, nextAddressBitWidth, nextDataBitWidth);
          } else {
            nextData = memory.data;
          }
        }

        updatedCircuit = createMemory(
          memory.memoryId,
          memory.writable,
          nextAddressBitWidth,
          nextDataBitWidth,
          {
            writeOn1: nextWriteOn1,
            onStart: nextOnStart,
            dualPort: nextDualPort,
            data: nextData,
            note: nextNote,
          },
        );
      } else if (symbol.circuit.kind === "sound") {
        const sound = symbol.circuit as Sound;
        const nextPinSide = updates.pinSide !== undefined ? updates.pinSide : sound.pinSide;
        const nextNotation = updates.notation !== undefined ? updates.notation : sound.notation;
        const nextNote = updates.note !== undefined ? updates.note : sound.note;
        const nextFrequency =
          updates.frequency !== undefined ? updates.frequency : (sound.frequency ?? SOUND_DEFAULT_FREQUENCY);
        const nextWaveform =
          updates.waveform !== undefined ? updates.waveform : (sound.waveform ?? "sine");
        updatedCircuit = createSound(
          sound.soundId,
          nextPinSide,
          nextNotation,
          nextNote,
          nextFrequency,
          nextWaveform,
        );
      } else if (symbol.circuit.kind === "synthesizer") {
        const synth = symbol.circuit as Synthesizer;
        const nextMode =
          updates.synthesizerMode !== undefined ? updates.synthesizerMode : synth.mode;
        const nextNotation = updates.notation !== undefined ? updates.notation : synth.notation;
        const nextNote = updates.note !== undefined ? updates.note : synth.note;
        updatedCircuit = createSynthesizer(
          synth.synthesizerId,
          nextMode,
          nextNotation,
          nextNote,
        );
      } else if (symbol.circuit.kind === "graphicsArray") {
        const ga = symbol.circuit as GraphicsArray;
        const nextWriteOn1 = updates.writeOn1 !== undefined ? updates.writeOn1 : ga.writeOn1;
        const nextOnStart = updates.onStart !== undefined ? updates.onStart : ga.onStart;
        const nextDataBitWidth =
          updates.dataBitWidth !== undefined ? updates.dataBitWidth : ga.dataBitWidth;
        const nextBitsPerPixel =
          updates.bitsPerPixel !== undefined ? updates.bitsPerPixel : ga.bitsPerPixel;
        const nextWidth = updates.width !== undefined ? updates.width : ga.width;
        const nextHeight = updates.height !== undefined ? updates.height : ga.height;
        const nextZoom = updates.zoom !== undefined ? updates.zoom : ga.zoom;
        const nextNote =
          updates.note !== undefined
            ? updates.note
            : (updates.description !== undefined ? updates.description : ga.note);

        updatedCircuit = createGraphicsArray(ga.graphicsArrayId, {
          writeOn1: nextWriteOn1,
          onStart: nextOnStart,
          dataBitWidth: nextDataBitWidth,
          bitsPerPixel: nextBitsPerPixel,
          width: nextWidth,
          height: nextHeight,
          zoom: nextZoom,
          note: nextNote,
        });
      }

      const targetX = options?.x ?? symbol.x;
      const targetY = options?.y ?? symbol.y;

      // Automatische Neuberechnung der Jams und Anschlusspunkte für das platzierte Symbol
      const updatedJams: Jam[] = updatedCircuit.pins.map((pin) => {
        const isSubCircuitPin = (pin as Partial<Pin>).kind === "pin";
        const effectivePinType = isSubCircuitPin ? "none" : pin.pinType;
        return {
          pin,
          circuitSymbolId: symbol.circuitSymbolId,
          x: pin.gridPoint.x,
          y: pin.gridPoint.y,
          z: pin.inverted ? 2 : 0,
          effectivePinType,
          absolutePoint: calculateJamAbsolutePoint(
            targetX,
            targetY,
            updatedCircuit.symbolWidth,
            updatedCircuit.symbolHeight,
            symbol.rotation,
            pin.gridPoint,
          ),
        };
      });

      const updatedSymbol: CircuitSymbol = {
        ...symbol,
        x: targetX,
        y: targetY,
        circuitId: updatedCircuit.circuitId,
        circuit: updatedCircuit,
        jams: updatedJams,
      };

      const changes: Record<string, PropertyChange> = {};
      if (symbol.x !== updatedSymbol.x) {
        changes.x = { before: symbol.x, after: updatedSymbol.x };
      }
      if (symbol.y !== updatedSymbol.y) {
        changes.y = { before: symbol.y, after: updatedSymbol.y };
      }
      for (const rawKey of Object.keys(updates) as (keyof CircuitSymbolPropertiesUpdate)[]) {
        if (updates[rawKey] !== undefined) {
          const beforeVal = readSymbolPropertyValue(symbol, symbol.circuit, beforePin, rawKey);
          const afterVal = readSymbolPropertyValue(updatedSymbol, updatedCircuit, afterPin, rawKey);
          if (beforeVal !== afterVal) {
            changes[rawKey] = { before: beforeVal, after: afterVal };
          }
        }
      }

      const { wireChanges, removedWires } = options?.withWires
        ? buildSymbolWireRubberband(symbol.jams, updatedJams, currentProject, symbol.logicalCircuitId)
        : { wireChanges: [], removedWires: [] };

      const delta: CircuitDelta = {
        type: "updateProperty",
        logicalCircuitId: symbol.logicalCircuitId,
        targetType: "symbol",
        targetId: symbolId,
        changes,
        beforeSymbol: { symbol, circuit: symbol.circuit, pin: beforePin },
        afterSymbol: { symbol: updatedSymbol, circuit: updatedCircuit, pin: afterPin },
        wireChanges: wireChanges.length > 0 ? wireChanges : undefined,
        removedWires: removedWires.length > 0 ? removedWires : undefined,
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      if (Object.keys(changes).length > 0) {
        recordDelta(delta);
      }

      return updatedSymbol;
    },
    [recordDelta, setProject],
  );

  // Schreibt geänderte persistente RAM-Daten aus der Simulation ohne Undo-Eintrag ins Projektmodell zurück
  const commitSimulatedMemoryData = React.useCallback(
    (updates: ReadonlyArray<{ memoryId: string; data: string }>): boolean => {
      if (updates.length === 0) {
        return false;
      }

      const currentProject = projectRef.current;
      const changedByMemoryId = new Map<string, string>();

      for (const entry of updates) {
        const existing =
          currentProject.memories.find((m) => m.memoryId === entry.memoryId) ??
          (() => {
            const candidate = currentProject.circuits.get(entry.memoryId);
            return candidate?.kind === "memory" ? (candidate as Memory) : undefined;
          })();
        if (!existing) {
          continue;
        }
        const existingBytes = decodeMemoryData(
          existing.data,
          existing.addressBitWidth,
          existing.dataBitWidth,
        );
        const nextBytes = decodeMemoryData(
          entry.data,
          existing.addressBitWidth,
          existing.dataBitWidth,
        );
        if (areByteArraysEqual(existingBytes, nextBytes)) {
          continue;
        }
        const normalized = encodeMemoryData(
          nextBytes,
          existing.addressBitWidth,
          existing.dataBitWidth,
        );
        changedByMemoryId.set(existing.memoryId, normalized);
      }

      if (changedByMemoryId.size === 0) {
        return false;
      }

      applyProjectChange(
        (prev) => {
          const nextCircuits = new Map(prev.circuits);
          const updatedMemoryById = new Map<string, Memory>();

          const nextMemories = prev.memories.map((m) => {
            const nextData = changedByMemoryId.get(m.memoryId);
            if (nextData === undefined) {
              return m;
            }
            const nextMemory: Memory = { ...m, data: nextData };
            nextCircuits.set(nextMemory.circuitId, nextMemory);
            updatedMemoryById.set(nextMemory.memoryId, nextMemory);
            return nextMemory;
          });

          for (const [memoryId, nextData] of changedByMemoryId.entries()) {
            if (updatedMemoryById.has(memoryId)) {
              continue;
            }
            const existingCircuit = nextCircuits.get(memoryId);
            if (existingCircuit?.kind === "memory") {
              const nextMemory: Memory = { ...(existingCircuit as Memory), data: nextData };
              nextCircuits.set(memoryId, nextMemory);
              updatedMemoryById.set(memoryId, nextMemory);
            }
          }

          const replaceMemorySymbol = (sym: CircuitSymbol): CircuitSymbol => {
            if (sym.circuit.kind !== "memory") {
              return sym;
            }
            const updatedMem = updatedMemoryById.get((sym.circuit as Memory).memoryId);
            return updatedMem ? { ...sym, circuit: updatedMem } : sym;
          };

          return {
            ...prev,
            circuits: nextCircuits,
            memories: nextMemories,
            circuitSymbols: prev.circuitSymbols.map(replaceMemorySymbol),
            logicalCircuits: prev.logicalCircuits.map((lc) => ({
              ...lc,
              circuitSymbols: lc.circuitSymbols.map(replaceMemorySymbol),
            })),
          };
        },
        true,
      );

      return true;
    },
    [applyProjectChange],
  );

  const updateCircuitProperties = React.useCallback(
    (circuitId: string, updates: CircuitPropertiesUpdate): LogicalCircuit | null => {
      const currentProject = projectRef.current;
      const targetIndex = currentProject.logicalCircuits.findIndex(
        (lc) => lc.logicalCircuitId === circuitId,
      );
      if (targetIndex < 0) {
        return null;
      }

      const currentLc = currentProject.logicalCircuits[targetIndex];
      const nextName = updates.name !== undefined ? updates.name.trim() : currentLc.name;
      const finalName = nextName || currentLc.name;

      let finalNotation: string;
      if (updates.notation !== undefined) {
        finalNotation = updates.notation.trim() || finalName;
      } else if (
        updates.name !== undefined &&
        (!currentLc.notation || currentLc.notation === currentLc.name)
      ) {
        finalNotation = finalName;
      } else {
        finalNotation = currentLc.notation;
      }

      const nextCategory = updates.category !== undefined ? updates.category.trim() : currentLc.category;
      const nextNote = updates.note !== undefined
        ? updates.note
        : (updates.description !== undefined ? updates.description : currentLc.note);

      const logicalCircuitsById = new Map(
        currentProject.logicalCircuits.map((lc) => [lc.logicalCircuitId, lc]),
      );
      const canUseDisplayShape = circuitContainsDisplays(currentLc, logicalCircuitsById);
      let finalShape = updates.circuitShape !== undefined ? updates.circuitShape : currentLc.circuitShape;
      if (finalShape === "display" && !canUseDisplayShape) {
        finalShape = currentLc.circuitShape !== "display" ? currentLc.circuitShape : "rectangular";
      }

      const currentShowLabelAbove = Boolean(currentLc.showLabelAbove);
      const finalShowLabelAbove = updates.showLabelAbove !== undefined
        ? updates.showLabelAbove
        : currentShowLabelAbove;

      const currentDisplayMargin = currentLc.displayMargin ?? "none";
      const finalDisplayMargin = updates.displayMargin !== undefined
        ? updates.displayMargin
        : currentDisplayMargin;

      const finalExportToHDL = updates.exportToHDL !== undefined
        ? updates.exportToHDL
        : currentLc.exportToHDL;
      const finalValidators = updates.validators !== undefined
        ? updates.validators
        : currentLc.validators;
      const hasValidatorsChange =
        updates.validators !== undefined && currentLc.validators !== updates.validators;

      let beforePinOrder: { pinId: string; index: number }[] | undefined;
      let afterPinOrder: { pinId: string; index: number }[] | undefined;
      if (updates.pinOrder !== undefined) {
        const existingPinsMap = new Map<string, Pin>();
        for (const p of currentProject.pins) {
          if (p.circuitId === circuitId) {
            existingPinsMap.set(p.pinId, p);
          }
        }
        for (const p of currentLc.logicalPins) {
          if (!existingPinsMap.has(p.pinId)) {
            existingPinsMap.set(p.pinId, p);
          }
        }
        const existingPins = Array.from(existingPinsMap.values());
        const requestedOrderMap = new Map(
          updates.pinOrder.map((entry) => [entry.pinId, Math.max(0, Math.trunc(entry.index))]),
        );
        beforePinOrder = existingPins.map((p) => ({ pinId: p.pinId, index: p.index ?? 0 }));
        afterPinOrder = existingPins.map((p) => ({
          pinId: p.pinId,
          index: requestedOrderMap.get(p.pinId) ?? p.index ?? 0,
        }));
      }

      const changes: Record<string, PropertyChange> = {};
      if (currentLc.name !== finalName) {
        changes.name = { before: currentLc.name, after: finalName };
      }
      if (currentLc.notation !== finalNotation) {
        changes.notation = { before: currentLc.notation, after: finalNotation };
      }
      if (currentLc.category !== nextCategory) {
        changes.category = { before: currentLc.category, after: nextCategory };
      }
      if (currentLc.note !== nextNote) {
        changes.note = { before: currentLc.note, after: nextNote };
      }
      if (currentLc.circuitShape !== finalShape) {
        changes.circuitShape = { before: currentLc.circuitShape, after: finalShape };
      }
      if (currentShowLabelAbove !== finalShowLabelAbove) {
        changes.showLabelAbove = { before: currentShowLabelAbove, after: finalShowLabelAbove };
      }
      if (currentDisplayMargin !== finalDisplayMargin) {
        changes.displayMargin = { before: currentDisplayMargin, after: finalDisplayMargin };
      }
      if (currentLc.exportToHDL !== finalExportToHDL) {
        changes.exportToHDL = { before: currentLc.exportToHDL, after: finalExportToHDL };
      }
      if (
        beforePinOrder &&
        afterPinOrder &&
        afterPinOrder.some((entry, idx) => entry.index !== beforePinOrder![idx].index)
      ) {
        changes.pinOrder = { before: beforePinOrder, after: afterPinOrder };
      }

      const delta: CircuitDelta = {
        type: "updateProperty",
        logicalCircuitId: circuitId,
        targetType: "logicalCircuit",
        targetId: circuitId,
        changes,
        beforeLogicalCircuit: {
          name: currentLc.name,
          notation: currentLc.notation,
          category: currentLc.category,
          note: currentLc.note,
          circuitShape: currentLc.circuitShape,
          showLabelAbove: currentShowLabelAbove,
          displayMargin: currentDisplayMargin,
          exportToHDL: currentLc.exportToHDL,
          validators: currentLc.validators,
          ...(beforePinOrder ? { pinOrder: beforePinOrder } : {}),
        },
        afterLogicalCircuit: {
          name: finalName,
          notation: finalNotation,
          category: nextCategory,
          note: nextNote,
          circuitShape: finalShape,
          showLabelAbove: finalShowLabelAbove,
          displayMargin: finalDisplayMargin,
          exportToHDL: finalExportToHDL,
          validators: finalValidators,
          ...(afterPinOrder ? { pinOrder: afterPinOrder } : {}),
        },
      };

      if (Object.keys(changes).length === 0 && !hasValidatorsChange) {
        return currentLc;
      }

      let updatedLc: LogicalCircuit | null = null;
      setProject((prevProject) => {
        const nextProj = applyDeltaForward(prevProject, delta);
        updatedLc = nextProj.logicalCircuits.find((lc) => lc.logicalCircuitId === circuitId) ?? null;
        return nextProj;
      });

      if (Object.keys(changes).length > 0) {
        recordDelta(delta);
      }

      return updatedLc;
    },
    [recordDelta, setProject],
  );

  // Größenänderung eines platzierbaren Bausteins (Button, Constant, Probe, Pin, LedMatrix) am Raster
  const resizeCircuitSymbol = React.useCallback(
    (
      symbolId: string,
      params: { x: number; y: number; width: number; height: number },
      options?: { recordHistory?: boolean; withWires?: boolean },
    ): CircuitSymbol | null => {
      const currentProject = projectRef.current;
      const symbol =
        currentProject.circuitSymbols.find((s) => s.circuitSymbolId === symbolId) ??
        currentProject.logicalCircuits.flatMap((lc) => lc.circuitSymbols).find((s) => s.circuitSymbolId === symbolId);
      if (!symbol) {
        return null;
      }

      const circ = symbol.circuit;
      const beforePin = circ.kind === "pin"
        ? currentProject.pins.find((p) => p.pinId === circ.circuitId)
        : undefined;

      let updatedCircuit: Circuit = circ;
      let afterPin: Pin | undefined = beforePin;

      if (circ.kind === "circuitButton") {
        const button = circ as CircuitButton;
        const newButton = createCircuitButton(
          button.circuitButtonId,
          button.notation,
          button.isToggle,
          button.pinSide,
          button.inverted,
          params.width,
          params.height,
          button.isOn ?? false,
        );
        newButton.modifiers = button.modifiers;
        newButton.keyCode = button.keyCode;
        newButton.note = button.note;
        updatedCircuit = newButton;
      } else if (circ.kind === "constant") {
        const constant = circ as Constant;
        const newConstant = createConstant(
          constant.constantId,
          constant.bitWidth,
          constant.value,
          constant.pinSide,
          constant.isHex ?? true,
          params.width,
          params.height,
        );
        newConstant.note = constant.note;
        updatedCircuit = newConstant;
      } else if (circ.kind === "circuitProbe") {
        const probe = circ as CircuitProbe;
        const newProbe = createCircuitProbe(
          probe.circuitProbeId,
          probe.name,
          probe.pinSide,
          params.width,
          params.height,
          probe.isHex ?? false,
        );
        newProbe.displayFormat = probe.displayFormat;
        newProbe.note = probe.note;
        updatedCircuit = newProbe;
      } else if (circ.kind === "pin") {
        const existingPin = beforePin;
        const rawPinType = existingPin?.pinType ?? "input";
        const pinType: "input" | "output" = rawPinType === "output" ? "output" : "input";
        const jamNotation = existingPin?.jamNotation ?? circ.pins[0]?.jamNotation ?? "";
        const { pin: newPin, pinCircuit: newPinCircuit } = createPinCircuit(
          circ.circuitId,
          symbol.logicalCircuitId,
          pinType,
          existingPin?.name ?? circ.name,
          existingPin?.bitWidth ?? 1,
          existingPin?.pinSide,
          existingPin?.inverted ?? false,
          existingPin?.index ?? 0,
          params.width,
          params.height,
          jamNotation,
        );
        newPin.note = circ.note;
        newPinCircuit.note = circ.note;
        afterPin = newPin;
        updatedCircuit = newPinCircuit;
      } else if (circ.kind === "ledMatrix") {
        const matrix = circ as LedMatrix;
        const safeCols = Math.max(1, Math.min(10, params.width - 1));
        const safeRows = Math.max(1, Math.min(10, params.height - 1));
        const newMatrix = createLedMatrix(
          matrix.ledMatrixId,
          safeRows,
          safeCols,
          matrix.matrixType,
          matrix.cellShape,
          matrix.colors,
          matrix.persistenceMultiplier,
        );
        newMatrix.note = matrix.note;
        newMatrix.name = matrix.name;
        updatedCircuit = newMatrix;
      } else {
        return null;
      }

      const updatedJams: Jam[] = updatedCircuit.pins.map((pin) => {
        const isSubCircuitPin = (pin as Partial<Pin>).kind === "pin";
        const effectivePinType = isSubCircuitPin ? "none" : pin.pinType;
        return {
          pin,
          circuitSymbolId: symbol.circuitSymbolId,
          x: pin.gridPoint.x,
          y: pin.gridPoint.y,
          z: pin.inverted ? 2 : 0,
          effectivePinType,
          absolutePoint: calculateJamAbsolutePoint(
            params.x,
            params.y,
            updatedCircuit.symbolWidth,
            updatedCircuit.symbolHeight,
            symbol.rotation,
            pin.gridPoint,
          ),
        };
      });

      const updatedSymbol: CircuitSymbol = {
        ...symbol,
        x: params.x,
        y: params.y,
        circuitId: updatedCircuit.circuitId,
        circuit: updatedCircuit,
        jams: updatedJams,
      };

      const changes: Record<string, PropertyChange> = {};
      if (symbol.x !== updatedSymbol.x) {
        changes.x = { before: symbol.x, after: updatedSymbol.x };
      }
      if (symbol.y !== updatedSymbol.y) {
        changes.y = { before: symbol.y, after: updatedSymbol.y };
      }
      if (circ.symbolWidth !== updatedCircuit.symbolWidth) {
        changes.width = { before: circ.symbolWidth, after: updatedCircuit.symbolWidth };
      }
      if (circ.symbolHeight !== updatedCircuit.symbolHeight) {
        changes.height = { before: circ.symbolHeight, after: updatedCircuit.symbolHeight };
      }

      const { wireChanges, removedWires } = options?.withWires !== false
        ? buildSymbolWireRubberband(symbol.jams, updatedJams, currentProject, symbol.logicalCircuitId)
        : { wireChanges: [], removedWires: [] };

      const delta: CircuitDelta = {
        type: "updateProperty",
        logicalCircuitId: symbol.logicalCircuitId,
        targetType: "symbol",
        targetId: symbolId,
        changes,
        beforeSymbol: { symbol, circuit: circ, pin: beforePin },
        afterSymbol: { symbol: updatedSymbol, circuit: updatedCircuit, pin: afterPin },
        wireChanges: wireChanges.length > 0 ? wireChanges : undefined,
        removedWires: removedWires.length > 0 ? removedWires : undefined,
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      if (options?.recordHistory !== false && Object.keys(changes).length > 0) {
        recordDelta(delta);
      }

      return updatedSymbol;
    },
    [recordDelta, setProject],
  );

  const moveSymbols = React.useCallback(
    (
      moves: { symbolId: string; gridPoint: GridPoint }[],
      options?: { recordHistory?: boolean; withWires?: boolean },
    ) => {
      if (moves.length === 0) {
        return;
      }

      const currentProj = projectRef.current;
      const moveMap = new Map(moves.map((m) => [m.symbolId, m.gridPoint]));
      const symbolPositions: { symbolId: string; before: GridPoint; after: GridPoint }[] = [];
      const movedJamShifts = new Map<string, { dx: number; dy: number }>();
      let dx = 0;
      let dy = 0;
      let logicalCircuitId = currentCircuitIdRef.current;

      for (const m of moves) {
        const existing = currentProj.circuitSymbols.find((s) => s.circuitSymbolId === m.symbolId);
        if (existing && (existing.x !== m.gridPoint.x || existing.y !== m.gridPoint.y)) {
          dx = m.gridPoint.x - existing.x;
          dy = m.gridPoint.y - existing.y;
          logicalCircuitId = existing.logicalCircuitId;
          symbolPositions.push({
            symbolId: m.symbolId,
            before: { x: existing.x, y: existing.y },
            after: { x: m.gridPoint.x, y: m.gridPoint.y },
          });
          for (const jam of existing.jams) {
            movedJamShifts.set(gridPointKey(jam.absolutePoint), { dx, dy });
          }
        }
      }

      const wireChanges: WireEndpointUpdate[] = [];
      const removedWires: Wire[] = [];
      const shouldMoveWires =
        options?.withWires === true ||
        (options?.withWires !== false && options?.recordHistory !== false);

      if (shouldMoveWires && movedJamShifts.size > 0) {
        const targetLc = currentProj.logicalCircuits.find(
          (lc) => lc.logicalCircuitId === logicalCircuitId,
        );
        if (targetLc) {
          for (const w of targetLc.wires) {
            const s1 = movedJamShifts.get(gridPointKey(w.point1));
            const s2 = movedJamShifts.get(gridPointKey(w.point2));
            if (s1 || s2) {
              const nx1 = w.x1 + (s1?.dx ?? 0);
              const ny1 = w.y1 + (s1?.dy ?? 0);
              const nx2 = w.x2 + (s2?.dx ?? 0);
              const ny2 = w.y2 + (s2?.dy ?? 0);
              if (nx1 === nx2 && ny1 === ny2) {
                removedWires.push(w);
              } else {
                wireChanges.push({
                  wireId: w.wireId,
                  before: { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 },
                  after: { x1: nx1, y1: ny1, x2: nx2, y2: ny2 },
                });
              }
            }
          }
        }
      }

      setProject((prevProject) => {
        const updateSymbol = (sym: CircuitSymbol): CircuitSymbol => {
          const targetPoint = moveMap.get(sym.circuitSymbolId);
          if (!targetPoint) {
            return sym;
          }
          return createCircuitSymbol(
            sym.circuit,
            sym.logicalCircuitId,
            targetPoint.x,
            targetPoint.y,
            sym.rotation,
            sym.circuitSymbolId,
          );
        };

        const wireMap = new Map(wireChanges.map((wc) => [wc.wireId, wc.after]));
        const removedWireSet = new Set(removedWires.map((w) => w.wireId));
        const updateWireList = (list: Wire[]): Wire[] =>
          list
            .filter((w) => !removedWireSet.has(w.wireId))
            .map((w) => {
              const after = wireMap.get(w.wireId);
              return after ? updateWireEndpoints(w, after.x1, after.y1, after.x2, after.y2) : w;
            });

        return recalculateProjectWires({
          ...prevProject,
          circuitSymbols: prevProject.circuitSymbols.map(updateSymbol),
          wires: shouldMoveWires ? updateWireList(prevProject.wires) : prevProject.wires,
          logicalCircuits: prevProject.logicalCircuits.map((lc) => ({
            ...lc,
            circuitSymbols: lc.circuitSymbols.map(updateSymbol),
            wires: shouldMoveWires ? updateWireList(lc.wires) : lc.wires,
          })),
        });
      });

      if (options?.recordHistory !== false && symbolPositions.length > 0) {
        recordDelta({
          type: "move",
          logicalCircuitId,
          symbolIds: symbolPositions.map((p) => p.symbolId),
          textNoteIds: [],
          dx,
          dy,
          symbolPositions,
          wireChanges: wireChanges.length > 0 ? wireChanges : undefined,
          removedWires: removedWires.length > 0 ? removedWires : undefined,
        });
      }
    },
    [recordDelta, setProject],
  );

  const moveSymbol = React.useCallback(
    (
      symbolId: string,
      gridPoint: GridPoint,
      options?: { recordHistory?: boolean; withWires?: boolean },
    ) => {
      moveSymbols([{ symbolId, gridPoint }], options);
    },
    [moveSymbols],
  );

  const moveTextNotes = React.useCallback(
    (
      moves: { textNoteId: string; gridPoint: GridPoint }[],
      options?: { recordHistory?: boolean },
    ) => {
      if (moves.length === 0) {
        return;
      }

      const currentProj = projectRef.current;
      const moveMap = new Map(moves.map((m) => [m.textNoteId, m.gridPoint]));
      const textNotePositions: { textNoteId: string; before: GridPoint; after: GridPoint }[] = [];
      let dx = 0;
      let dy = 0;
      let logicalCircuitId = currentCircuitIdRef.current;

      for (const m of moves) {
        const existing = currentProj.textNotes.find((n) => n.textNoteId === m.textNoteId);
        if (existing && (existing.x !== m.gridPoint.x || existing.y !== m.gridPoint.y)) {
          dx = m.gridPoint.x - existing.x;
          dy = m.gridPoint.y - existing.y;
          logicalCircuitId = existing.logicalCircuitId;
          textNotePositions.push({
            textNoteId: m.textNoteId,
            before: { x: existing.x, y: existing.y },
            after: { x: m.gridPoint.x, y: m.gridPoint.y },
          });
        }
      }

      setProject((prevProject) => {
        const updateNote = (n: TextNote): TextNote => {
          const pt = moveMap.get(n.textNoteId);
          if (!pt) {
            return n;
          }
          return {
            ...n,
            x: pt.x,
            y: pt.y,
          };
        };

        return {
          ...prevProject,
          textNotes: prevProject.textNotes.map(updateNote),
          logicalCircuits: prevProject.logicalCircuits.map((lc) => ({
            ...lc,
            textNotes: lc.textNotes.map(updateNote),
          })),
        };
      });

      if (options?.recordHistory !== false && textNotePositions.length > 0) {
        recordDelta({
          type: "move",
          logicalCircuitId,
          symbolIds: [],
          textNoteIds: textNotePositions.map((p) => p.textNoteId),
          dx,
          dy,
          textNotePositions,
        });
      }
    },
    [recordDelta, setProject],
  );

  // Verschiebt Symbole, Textnotizen und Leitungen gemeinsam um (dx, dy) als einzelnes Undo-Delta
  const moveEntities = React.useCallback(
    (params: MoveEntitiesParams): MoveEntitiesResult => {
      const { dx, dy } = params;
      const symIdSet = new Set(params.symbolIds ?? []);
      const noteIdSet = new Set(params.textNoteIds ?? []);
      const wireIdSet = new Set(params.wireIds ?? []);

      const currentProj = projectRef.current;
      const targetCircuit = currentProj.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === currentCircuitIdRef.current,
      ) ?? currentProj.logicalCircuits[0];

      if (!targetCircuit || (symIdSet.size === 0 && noteIdSet.size === 0 && wireIdSet.size === 0)) {
        return { symbols: [], textNotes: [], wires: [], removedWireIds: [] };
      }

      const movedSymbols = targetCircuit.circuitSymbols.filter((s) => symIdSet.has(s.circuitSymbolId));
      const movedNotes = targetCircuit.textNotes.filter((n) => noteIdSet.has(n.textNoteId));
      const explicitWires = targetCircuit.wires.filter((w) => wireIdSet.has(w.wireId));

      if (
        (dx === 0 && dy === 0) ||
        (movedSymbols.length === 0 && movedNotes.length === 0 && explicitWires.length === 0)
      ) {
        return {
          symbols: movedSymbols,
          textNotes: movedNotes,
          wires: explicitWires,
          removedWireIds: [],
        };
      }

      const symbolPositions = movedSymbols.map((s) => ({
        symbolId: s.circuitSymbolId,
        before: { x: s.x, y: s.y },
        after: { x: s.x + dx, y: s.y + dy },
      }));
      const textNotePositions = movedNotes.map((n) => ({
        textNoteId: n.textNoteId,
        before: { x: n.x, y: n.y },
        after: { x: n.x + dx, y: n.y + dy },
      }));

      const movedJamShifts = new Map<string, { dx: number; dy: number }>();
      for (const s of movedSymbols) {
        for (const jam of s.jams) {
          movedJamShifts.set(gridPointKey(jam.absolutePoint), { dx, dy });
        }
      }
      for (const w of explicitWires) {
        movedJamShifts.set(gridPointKey(w.point1), { dx, dy });
        movedJamShifts.set(gridPointKey(w.point2), { dx, dy });
      }

      const wireChanges: WireEndpointUpdate[] = [];
      const removedWires: Wire[] = [];
      const movedWireIds = new Set(explicitWires.map((w) => w.wireId));
      const withWires = params.withWires !== false;

      for (const w of targetCircuit.wires) {
        if (movedWireIds.has(w.wireId)) {
          wireChanges.push({
            wireId: w.wireId,
            before: { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 },
            after: { x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy },
          });
          continue;
        }
        if (withWires && movedJamShifts.size > 0) {
          const s1 = movedJamShifts.get(gridPointKey(w.point1));
          const s2 = movedJamShifts.get(gridPointKey(w.point2));
          if (s1 || s2) {
            const nx1 = w.x1 + (s1?.dx ?? 0);
            const ny1 = w.y1 + (s1?.dy ?? 0);
            const nx2 = w.x2 + (s2?.dx ?? 0);
            const ny2 = w.y2 + (s2?.dy ?? 0);
            if (nx1 === nx2 && ny1 === ny2) {
              removedWires.push(w);
            } else {
              wireChanges.push({
                wireId: w.wireId,
                before: { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 },
                after: { x1: nx1, y1: ny1, x2: nx2, y2: ny2 },
              });
            }
          }
        }
      }

      const delta: CircuitDelta = {
        type: "move",
        logicalCircuitId: targetCircuit.logicalCircuitId,
        symbolIds: movedSymbols.map((s) => s.circuitSymbolId),
        textNoteIds: movedNotes.map((n) => n.textNoteId),
        wireIds: Array.from(movedWireIds),
        dx,
        dy,
        symbolPositions,
        textNotePositions,
        wireChanges: wireChanges.length > 0 ? wireChanges : undefined,
        removedWires: removedWires.length > 0 ? removedWires : undefined,
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      if (params.recordHistory !== false) {
        recordDelta(delta);
      }

      if (removedWires.length > 0) {
        const removedSet = new Set(removedWires.map((w) => w.wireId));
        setSelectedWireIds((prev) => prev.filter((id) => !removedSet.has(id)));
      }

      const updatedCircuit = projectRef.current.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === targetCircuit.logicalCircuitId,
      );
      const changedWireSet = new Set(wireChanges.map((wc) => wc.wireId));
      return {
        symbols: updatedCircuit
          ? updatedCircuit.circuitSymbols.filter((s) => symIdSet.has(s.circuitSymbolId))
          : [],
        textNotes: updatedCircuit
          ? updatedCircuit.textNotes.filter((n) => noteIdSet.has(n.textNoteId))
          : [],
        wires: updatedCircuit
          ? updatedCircuit.wires.filter((w) => changedWireSet.has(w.wireId))
          : [],
        removedWireIds: removedWires.map((w) => w.wireId),
      };
    },
    [recordDelta, setProject],
  );

  const rotateSymbols = React.useCallback(
    (
      symbolIds: string[],
      direction: RotationDirection = "clockwise",
      textNoteIds: string[] = [],
      options?: { withWires?: boolean; wireIds?: string[] },
    ) => {
      const targetWireIds = options?.wireIds ?? [];
      if (symbolIds.length === 0 && textNoteIds.length === 0 && targetWireIds.length === 0) {
        return;
      }
      const targetSymSet = new Set(symbolIds);
      const targetNoteSet = new Set(textNoteIds);
      const targetWireSet = new Set(targetWireIds);

      const currentProj = projectRef.current;
      const targetCircuit = currentProj.logicalCircuits.find(
        (lc) => lc.logicalCircuitId === currentCircuitIdRef.current,
      ) ?? currentProj.logicalCircuits[0];

      if (!targetCircuit) {
        return;
      }

      const symTargets = targetCircuit.circuitSymbols.filter((s) => targetSymSet.has(s.circuitSymbolId));
      const noteTargets = targetCircuit.textNotes.filter((n) => targetNoteSet.has(n.textNoteId));
      const wireTargets = targetCircuit.wires.filter((w) => targetWireSet.has(w.wireId));
      if (symTargets.length === 0 && noteTargets.length === 0 && wireTargets.length === 0) {
        return;
      }

      const {
        symbols: rotatedSymbols,
        textNotes: rotatedNotes,
        wires: rotatedWires,
      } = rotateCircuitEntities(symTargets, noteTargets, direction, wireTargets);

      const rotatedSymMap = new Map(rotatedSymbols.map((s) => [s.circuitSymbolId, s]));
      const rotatedNoteMap = new Map(rotatedNotes.map((n) => [n.textNoteId, n]));
      const rotatedWireMap = new Map(rotatedWires.map((w) => [w.wireId, w]));

      const wireChanges: WireEndpointUpdate[] = [];
      const removedWires: Wire[] = [];
      const withWires = options?.withWires !== false;

      // Explizit mitrotierte Leitungen (inkl. Knick- und Verzweigungspunkten) übernehmen
      for (const wire of wireTargets) {
        const rotated = rotatedWireMap.get(wire.wireId);
        if (!rotated) {
          continue;
        }
        if (rotated.x1 === rotated.x2 && rotated.y1 === rotated.y2) {
          removedWires.push(wire);
        } else if (
          rotated.x1 !== wire.x1 ||
          rotated.y1 !== wire.y1 ||
          rotated.x2 !== wire.x2 ||
          rotated.y2 !== wire.y2
        ) {
          wireChanges.push({
            wireId: wire.wireId,
            before: { x1: wire.x1, y1: wire.y1, x2: wire.x2, y2: wire.y2 },
            after: { x1: rotated.x1, y1: rotated.y1, x2: rotated.x2, y2: rotated.y2 },
          });
        }
      }

      // Nicht explizit selektierte externe Leitungen an rotierten Symbol-Jams per Rubberbanding nachführen
      if (withWires && symTargets.length > 0) {
        // Abbildung alter Jam-Positionen auf neue Jam-Positionen (analog zu EditorDiagram.Rotate)
        const jamPointMigration = new Map<string, GridPoint>();
        for (const oldSym of symTargets) {
          const newSym = rotatedSymMap.get(oldSym.circuitSymbolId);
          if (newSym && oldSym.jams.length === newSym.jams.length) {
            for (let i = 0; i < oldSym.jams.length; i++) {
              const oldPt = oldSym.jams[i].absolutePoint;
              const newPt = newSym.jams[i].absolutePoint;
              if (oldPt.x !== newPt.x || oldPt.y !== newPt.y) {
                jamPointMigration.set(gridPointKey(oldPt), newPt);
              }
            }
          }
        }

        if (jamPointMigration.size > 0) {
          for (const wire of targetCircuit.wires) {
            if (targetWireSet.has(wire.wireId)) {
              continue;
            }
            const nextP1 = jamPointMigration.get(gridPointKey(wire.point1)) ?? wire.point1;
            const nextP2 = jamPointMigration.get(gridPointKey(wire.point2)) ?? wire.point2;
            if (
              nextP1.x !== wire.x1 ||
              nextP1.y !== wire.y1 ||
              nextP2.x !== wire.x2 ||
              nextP2.y !== wire.y2
            ) {
              if (nextP1.x === nextP2.x && nextP1.y === nextP2.y) {
                removedWires.push(wire);
              } else {
                wireChanges.push({
                  wireId: wire.wireId,
                  before: { x1: wire.x1, y1: wire.y1, x2: wire.x2, y2: wire.y2 },
                  after: { x1: nextP1.x, y1: nextP1.y, x2: nextP2.x, y2: nextP2.y },
                });
              }
            }
          }
        }
      }

      const delta: CircuitDelta = {
        type: "rotate",
        logicalCircuitId: targetCircuit.logicalCircuitId,
        direction,
        symbols: symTargets.map((s) => {
          const afterSym = rotatedSymMap.get(s.circuitSymbolId) ?? s;
          return {
            symbolId: s.circuitSymbolId,
            before: { x: s.x, y: s.y, rotation: s.rotation },
            after: { x: afterSym.x, y: afterSym.y, rotation: afterSym.rotation },
          };
        }),
        textNotes: noteTargets.map((n) => {
          const afterNote = rotatedNoteMap.get(n.textNoteId) ?? n;
          return {
            textNoteId: n.textNoteId,
            before: { x: n.x, y: n.y, rotation: n.rotation },
            after: { x: afterNote.x, y: afterNote.y, rotation: afterNote.rotation },
          };
        }),
        wireChanges: wireChanges.length > 0 ? wireChanges : undefined,
        removedWires: removedWires.length > 0 ? removedWires : undefined,
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      recordDelta(delta);

      if (removedWires.length > 0) {
        const removedSet = new Set(removedWires.map((w) => w.wireId));
        setSelectedWireIds((prev) => prev.filter((id) => !removedSet.has(id)));
      }
    },
    [recordDelta, setProject],
  );

  const rotateSelectedSymbols = React.useCallback(
    (
      direction: RotationDirection = "clockwise",
      options?: { withWires?: boolean },
    ) => {
      rotateSymbols(selectedSymbolIds, direction, selectedTextNoteIds, {
        withWires: options?.withWires,
        wireIds: selectedWireIds,
      });
    },
    [
      rotateSymbols,
      selectedSymbolIds,
      selectedTextNoteIds,
      selectedWireIds,
    ],
  );

  const commitFloatingMove = React.useCallback(
    (floatingState: FloatingPasteState) => {
      if (floatingState.mode !== "move" || !floatingState.moveMeta) {
        return;
      }
      const { moveMeta, payload } = floatingState;
      const netQuarterTurns = ((moveMeta.rotationSteps % 4) + 4) % 4;

      const currentProj = projectRef.current;
      const targetCircuit =
        currentProj.logicalCircuits.find((lc) => lc.logicalCircuitId === payload.targetCircuitId) ??
        currentProj.logicalCircuits.find((lc) => lc.logicalCircuitId === currentCircuitIdRef.current) ??
        currentProj.logicalCircuits[0];

      if (!targetCircuit) {
        return;
      }

      const symPayloadMap = new Map(
        payload.symbols.map((entry) => [entry.symbol.circuitSymbolId, entry.symbol]),
      );
      const notePayloadMap = new Map(payload.textNotes.map((n) => [n.textNoteId, n]));
      const wirePayloadMap = new Map(payload.wires.map((w) => [w.wireId, w]));

      const isPureTranslation =
        netQuarterTurns === 0 &&
        moveMeta.initialSymbols.every((oldSym) => {
          const newSym = symPayloadMap.get(oldSym.circuitSymbolId);
          return (
            newSym !== undefined &&
            newSym.rotation === oldSym.rotation &&
            newSym.x === oldSym.x + moveMeta.dx &&
            newSym.y === oldSym.y + moveMeta.dy
          );
        }) &&
        moveMeta.initialNotes.every((oldNote) => {
          const newNote = notePayloadMap.get(oldNote.textNoteId);
          return (
            newNote !== undefined &&
            newNote.rotation === oldNote.rotation &&
            newNote.x === oldNote.x + moveMeta.dx &&
            newNote.y === oldNote.y + moveMeta.dy
          );
        }) &&
        moveMeta.initialWires.every((oldWire) => {
          const newWire = wirePayloadMap.get(oldWire.wireId);
          return (
            newWire !== undefined &&
            newWire.x1 === oldWire.x1 + moveMeta.dx &&
            newWire.y1 === oldWire.y1 + moveMeta.dy &&
            newWire.x2 === oldWire.x2 + moveMeta.dx &&
            newWire.y2 === oldWire.y2 + moveMeta.dy
          );
        });

      // Reine Verschiebung ohne resultierende Rotation nutzt den kompakten Move-Delta-Pfad
      if (isPureTranslation) {
        if (moveMeta.dx !== 0 || moveMeta.dy !== 0) {
          moveEntities({
            dx: moveMeta.dx,
            dy: moveMeta.dy,
            symbolIds: moveMeta.symbolIds,
            textNoteIds: moveMeta.textNoteIds,
            wireIds: moveMeta.wireIds,
            withWires: moveMeta.withWires,
          });
        }
        return;
      }

      const symbolDeltas = moveMeta.initialSymbols.map((oldSym) => {
        const afterSym = symPayloadMap.get(oldSym.circuitSymbolId) ?? oldSym;
        return {
          symbolId: oldSym.circuitSymbolId,
          before: { x: oldSym.x, y: oldSym.y, rotation: oldSym.rotation },
          after: { x: afterSym.x, y: afterSym.y, rotation: afterSym.rotation },
        };
      });

      const noteDeltas = moveMeta.initialNotes.map((oldNote) => {
        const afterNote = notePayloadMap.get(oldNote.textNoteId) ?? oldNote;
        return {
          textNoteId: oldNote.textNoteId,
          before: { x: oldNote.x, y: oldNote.y, rotation: oldNote.rotation },
          after: { x: afterNote.x, y: afterNote.y, rotation: afterNote.rotation },
        };
      });

      const wireChanges: WireEndpointUpdate[] = [];
      const removedWires: Wire[] = [];
      const targetWireSet = new Set(moveMeta.wireIds);

      for (const oldWire of moveMeta.initialWires) {
        const afterWire = wirePayloadMap.get(oldWire.wireId);
        if (!afterWire) {
          continue;
        }
        if (afterWire.x1 === afterWire.x2 && afterWire.y1 === afterWire.y2) {
          removedWires.push(oldWire);
        } else if (
          afterWire.x1 !== oldWire.x1 ||
          afterWire.y1 !== oldWire.y1 ||
          afterWire.x2 !== oldWire.x2 ||
          afterWire.y2 !== oldWire.y2
        ) {
          wireChanges.push({
            wireId: oldWire.wireId,
            before: { x1: oldWire.x1, y1: oldWire.y1, x2: oldWire.x2, y2: oldWire.y2 },
            after: { x1: afterWire.x1, y1: afterWire.y1, x2: afterWire.x2, y2: afterWire.y2 },
          });
        }
      }

      if (moveMeta.withWires) {
        const migration = buildFloatingMovePointMigration(moveMeta, payload);
        if (migration.size > 0) {
          for (const wire of targetCircuit.wires) {
            if (targetWireSet.has(wire.wireId)) {
              continue;
            }
            const nextP1 = migration.get(gridPointKey(wire.point1)) ?? wire.point1;
            const nextP2 = migration.get(gridPointKey(wire.point2)) ?? wire.point2;
            if (
              nextP1.x !== wire.x1 ||
              nextP1.y !== wire.y1 ||
              nextP2.x !== wire.x2 ||
              nextP2.y !== wire.y2
            ) {
              if (nextP1.x === nextP2.x && nextP1.y === nextP2.y) {
                removedWires.push(wire);
              } else {
                wireChanges.push({
                  wireId: wire.wireId,
                  before: { x1: wire.x1, y1: wire.y1, x2: wire.x2, y2: wire.y2 },
                  after: { x1: nextP1.x, y1: nextP1.y, x2: nextP2.x, y2: nextP2.y },
                });
              }
            }
          }
        }
      }

      const hasEntityChange =
        symbolDeltas.some(
          (s) =>
            s.before.x !== s.after.x ||
            s.before.y !== s.after.y ||
            s.before.rotation !== s.after.rotation,
        ) ||
        noteDeltas.some(
          (n) =>
            n.before.x !== n.after.x ||
            n.before.y !== n.after.y ||
            n.before.rotation !== n.after.rotation,
        ) ||
        wireChanges.length > 0 ||
        removedWires.length > 0;

      if (!hasEntityChange) {
        return;
      }

      const delta: CircuitDelta = {
        type: "rotate",
        logicalCircuitId: targetCircuit.logicalCircuitId,
        direction:
          moveMeta.lastRotationDirection ??
          (netQuarterTurns === 3 ? "counterClockwise" : "clockwise"),
        symbols: symbolDeltas,
        textNotes: noteDeltas,
        wireChanges: wireChanges.length > 0 ? wireChanges : undefined,
        removedWires: removedWires.length > 0 ? removedWires : undefined,
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      recordDelta(delta);

      if (removedWires.length > 0) {
        const removedSet = new Set(removedWires.map((w) => w.wireId));
        setSelectedWireIds((prev) => prev.filter((id) => !removedSet.has(id)));
      }
    },
    [
      moveEntities,
      recordDelta,
      setProject,
    ],
  );

  const removeEntities = React.useCallback(
    (symbolIds: string[], textNoteIds: string[], wireIds: string[] = []) => {
      if (symbolIds.length === 0 && textNoteIds.length === 0 && wireIds.length === 0) {
        return;
      }
      const symSet = new Set(symbolIds);
      const noteSet = new Set(textNoteIds);
      const wireSet = new Set(wireIds);
      const currentProj = projectRef.current;

      const removedSymbols = currentProj.circuitSymbols
        .filter((s) => symSet.has(s.circuitSymbolId))
        .map((symbol) => ({
          symbol,
          circuit: symbol.circuit,
          pin: symbol.circuit.kind === "pin"
            ? currentProj.pins.find((p) => p.pinId === symbol.circuit.circuitId)
            : undefined,
        }));

      const removedNotes = currentProj.textNotes.filter((n) => noteSet.has(n.textNoteId));
      const removedWires = currentProj.wires.filter((w) => wireSet.has(w.wireId));

      if (removedSymbols.length === 0 && removedNotes.length === 0 && removedWires.length === 0) {
        return;
      }

      const logicalCircuitId =
        removedSymbols[0]?.symbol.logicalCircuitId ??
        removedNotes[0]?.logicalCircuitId ??
        removedWires[0]?.logicalCircuitId ??
        currentCircuitIdRef.current;

      const delta: CircuitDelta = {
        type: "remove",
        logicalCircuitId,
        symbols: removedSymbols,
        textNotes: removedNotes,
        wires: removedWires,
      };

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      recordDelta(delta);

      if (symbolIds.length > 0) {
        setSelectedSymbolIds((prev) => prev.filter((id) => !symSet.has(id)));
      }
      if (textNoteIds.length > 0) {
        setSelectedTextNoteIds((prev) => prev.filter((id) => !noteSet.has(id)));
      }
      if (wireIds.length > 0) {
        setSelectedWireIds((prev) => prev.filter((id) => !wireSet.has(id)));
      }
    },
    [recordDelta, setProject],
  );

  const removeSymbols = React.useCallback(
    (symbolIds: string[]) => {
      removeEntities(symbolIds, [], []);
    },
    [removeEntities],
  );

  const removeSymbol = React.useCallback(
    (symbolId: string) => {
      removeEntities([symbolId], [], []);
    },
    [removeEntities],
  );

  const removeTextNotes = React.useCallback(
    (textNoteIds: string[]) => {
      removeEntities([], textNoteIds, []);
    },
    [removeEntities],
  );

  const removeWires = React.useCallback(
    (wireIds: string[]) => {
      removeEntities([], [], wireIds);
    },
    [removeEntities],
  );

  const activeHistory = historiesByCircuit[currentCircuit.logicalCircuitId] ?? createEmptyHistoryState();
  const canUndo = activeHistory.pointer > 0;
  const canRedo = activeHistory.pointer < activeHistory.entries.length;

  const undo = React.useCallback(
    () => {
      const targetCircuitId = currentCircuitIdRef.current;
      const currentHist = historiesByCircuitRef.current[targetCircuitId] ?? createEmptyHistoryState();
      if (currentHist.pointer <= 0) {
        return;
      }
      const nextPointer = currentHist.pointer - 1;
      const delta = currentHist.entries[nextPointer];

      setProject((prevProject) => applyDeltaBackward(prevProject, delta));
      setHistoriesByCircuit((prev) => ({
        ...prev,
        [targetCircuitId]: {
          entries: currentHist.entries,
          pointer: nextPointer,
        },
      }));

      if (delta.type === "add") {
        const addedSymIds = new Set(delta.symbols.map((s) => s.symbol.circuitSymbolId));
        const addedNoteIds = new Set(delta.textNotes.map((n) => n.textNoteId));
        const addedWireIds = new Set((delta.wires ?? []).map((w) => w.wireId));
        setSelectedSymbolIds((prev) => prev.filter((id) => !addedSymIds.has(id)));
        setSelectedTextNoteIds((prev) => prev.filter((id) => !addedNoteIds.has(id)));
        setSelectedWireIds((prev) => prev.filter((id) => !addedWireIds.has(id)));
      } else if (delta.type === "wireBatch") {
        const addedWireIds = new Set(delta.addedWires.map((w) => w.wireId));
        setSelectedWireIds((prev) => prev.filter((id) => !addedWireIds.has(id)));
      }
    },
    [setHistoriesByCircuit, setProject],
  );

  const redo = React.useCallback(
    () => {
      const targetCircuitId = currentCircuitIdRef.current;
      const currentHist = historiesByCircuitRef.current[targetCircuitId] ?? createEmptyHistoryState();
      if (currentHist.pointer >= currentHist.entries.length) {
        return;
      }
      const delta = currentHist.entries[currentHist.pointer];
      const nextPointer = currentHist.pointer + 1;

      setProject((prevProject) => applyDeltaForward(prevProject, delta));
      setHistoriesByCircuit((prev) => ({
        ...prev,
        [targetCircuitId]: {
          entries: currentHist.entries,
          pointer: nextPointer,
        },
      }));

      if (delta.type === "remove") {
        const removedSymIds = new Set(delta.symbols.map((s) => s.symbol.circuitSymbolId));
        const removedNoteIds = new Set(delta.textNotes.map((n) => n.textNoteId));
        const removedWireIds = new Set((delta.wires ?? []).map((w) => w.wireId));
        setSelectedSymbolIds((prev) => prev.filter((id) => !removedSymIds.has(id)));
        setSelectedTextNoteIds((prev) => prev.filter((id) => !removedNoteIds.has(id)));
        setSelectedWireIds((prev) => prev.filter((id) => !removedWireIds.has(id)));
      } else if (delta.type === "wireBatch") {
        const removedWireIds = new Set(delta.removedWires.map((w) => w.wireId));
        setSelectedWireIds((prev) => prev.filter((id) => !removedWireIds.has(id)));
      }
    },
    [setHistoriesByCircuit, setProject],
  );

  const createCircuits = React.useCallback(
    (inputs: CreateCircuitInput[]): LogicalCircuit[] => {
      if (inputs.length === 0) {
        throw new Error("Mindestens eine zu erstellende Schaltung muss angegeben werden.");
      }

      const currentProj = projectRef.current;
      const existingIds = new Set(currentProj.logicalCircuits.map((lc) => lc.logicalCircuitId));
      const createdCircuits: LogicalCircuit[] = [];

      for (const input of inputs) {
        const trimmedName = input.name.trim();
        if (!trimmedName) {
          throw new Error("Der Name einer neuen Schaltung darf nicht leer sein.");
        }
        const slug = trimmedName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const baseId = slug ? `lc-${slug}` : "lc-circuit";
        let candidateId = baseId;
        let suffix = 2;
        while (existingIds.has(candidateId)) {
          candidateId = `${baseId}-${suffix}`;
          suffix += 1;
        }
        existingIds.add(candidateId);

        const created = createDefaultLogicalCircuit(
          candidateId,
          trimmedName,
          input.category?.trim() ?? "",
          input.note ?? "",
        );
        if (input.notation !== undefined && input.notation.trim() !== "") {
          created.notation = input.notation.trim();
        }
        if (input.circuitShape !== undefined && input.circuitShape !== "display") {
          created.circuitShape = input.circuitShape;
        }
        if (input.showLabelAbove !== undefined) {
          created.showLabelAbove = input.showLabelAbove;
        }
        if (input.displayMargin !== undefined) {
          created.displayMargin = input.displayMargin;
        }
        if (input.exportToHDL !== undefined) {
          created.exportToHDL = input.exportToHDL;
        }
        createdCircuits.push(created);
      }

      setProject((prevProject) => {
        const nextCircuits = new Map(prevProject.circuits);
        for (const lc of createdCircuits) {
          nextCircuits.set(lc.circuitId, lc);
        }
        return {
          ...prevProject,
          circuits: nextCircuits,
          logicalCircuits: [...prevProject.logicalCircuits, ...createdCircuits],
        };
      });

      return createdCircuits;
    },
    [setProject],
  );

  const deleteCircuits = React.useCallback(
    (circuitIds: string[]): DeleteCircuitsResult => {
      const targetIds = Array.from(new Set(circuitIds));
      if (targetIds.length === 0) {
        throw new Error("Mindestens eine Schaltungs-ID muss angegeben werden.");
      }

      const currentProj = projectRef.current;
      for (const id of targetIds) {
        if (!currentProj.logicalCircuits.some((lc) => lc.logicalCircuitId === id)) {
          const known = currentProj.logicalCircuits.map((lc) => lc.logicalCircuitId).join(", ");
          throw new Error(`Schaltung "${id}" nicht gefunden. Verfügbare IDs: ${known}`);
        }
      }

      const targetSet = new Set(targetIds);
      const remainingCircuits = currentProj.logicalCircuits.filter(
        (lc) => !targetSet.has(lc.logicalCircuitId),
      );
      if (remainingCircuits.length === 0) {
        throw new Error("Mindestens eine Schaltung muss im Projekt verbleiben.");
      }

      for (const surviving of remainingCircuits) {
        for (const sym of surviving.circuitSymbols) {
          if (sym.circuit.kind === "logicalCircuit" && targetSet.has(sym.circuit.circuitId)) {
            throw new Error(
              `Schaltung "${sym.circuit.circuitId}" wird noch als Sub-Schaltung in "${surviving.name}" verwendet. ` +
              `Bitte zuerst die Instanz "${sym.circuitSymbolId}" entfernen.`,
            );
          }
        }
      }

      const deletedLcs = currentProj.logicalCircuits.filter((lc) => targetSet.has(lc.logicalCircuitId));
      const deletedSymbols = deletedLcs.flatMap((lc) =>
        lc.circuitSymbols.map((symbol) => ({
          symbol,
          circuit: symbol.circuit,
          pin: symbol.circuit.kind === "pin"
            ? currentProj.pins.find((p) => p.pinId === symbol.circuit.circuitId)
            : undefined,
        })),
      );
      const deletedNotes = deletedLcs.flatMap((lc) => lc.textNotes);
      const deletedWires = deletedLcs.flatMap((lc) => lc.wires);

      const fallbackCircuitId = remainingCircuits[0].logicalCircuitId;
      const switchingNeeded = targetSet.has(currentCircuitIdRef.current);
      const nextCurrentCircuitId = switchingNeeded ? fallbackCircuitId : currentCircuitIdRef.current;

      setProject((prevProject) => {
        const cleaned = deleteEntities(prevProject, deletedSymbols, deletedNotes, deletedWires);
        const nextCircuits = new Map(cleaned.circuits);
        for (const deletedId of targetSet) {
          nextCircuits.delete(deletedId);
        }
        return {
          ...cleaned,
          project: {
            ...cleaned.project,
            logicalCircuitId: targetSet.has(cleaned.project.logicalCircuitId)
              ? fallbackCircuitId
              : cleaned.project.logicalCircuitId,
            startupCircuitId: cleaned.project.startupCircuitId && targetSet.has(cleaned.project.startupCircuitId)
              ? undefined
              : cleaned.project.startupCircuitId,
          },
          circuits: nextCircuits,
          logicalCircuits: cleaned.logicalCircuits.filter((lc) => !targetSet.has(lc.logicalCircuitId)),
        };
      });

      setHistoriesByCircuit((prev) => {
        const next = { ...prev };
        for (const deletedId of targetSet) {
          delete next[deletedId];
        }
        return next;
      });

      if (switchingNeeded) {
        setCurrentCircuitId(nextCurrentCircuitId);
      }

      return {
        deletedCircuitIds: targetIds,
        currentCircuitId: nextCurrentCircuitId,
      };
    },
    [
      setCurrentCircuitId,
      setHistoriesByCircuit,
      setProject,
    ],
  );

  const markProjectSaved = React.useCallback(
    () => {
      setHistoriesByCircuit({});
      setHasUnsavedChanges(false);
    },
    [setHasUnsavedChanges, setHistoriesByCircuit],
  );

  // Globale Projekteinstellungen (ohne schaltungsbezogenen Undo-Eintrag) aktualisieren
  const updateProjectProperties = React.useCallback(
    (updates: ProjectPropertiesUpdate) => {
      const currentMeta = projectRef.current.project;
      const nextName = updates.name !== undefined ? (updates.name.trim() || currentMeta.name) : currentMeta.name;
      const nextNote = updates.note !== undefined ? updates.note : currentMeta.note;
      const nextFrequency = updates.frequency !== undefined ? updates.frequency : currentMeta.frequency;
      const nextMaxSpeed = updates.isMaximumSpeed !== undefined
        ? updates.isMaximumSpeed
        : currentMeta.isMaximumSpeed;

      if (
        nextName === currentMeta.name &&
        nextNote === currentMeta.note &&
        nextFrequency === currentMeta.frequency &&
        nextMaxSpeed === currentMeta.isMaximumSpeed
      ) {
        return;
      }

      applyProjectChange(
        (prev) => ({
          ...prev,
          project: {
            ...prev.project,
            name: nextName,
            note: nextNote,
            frequency: nextFrequency,
            isMaximumSpeed: nextMaxSpeed,
          },
        }),
        true,
      );
    },
    [applyProjectChange],
  );

  const loadProject = React.useCallback(
    (
      nextProject: CircuitProject,
      fileMeta?: { handle?: FileSystemFileHandleLike | null; fileName?: string | null },
    ) => {
      hasUserProjectActionRef.current = true;
      applyProjectChange(nextProject, false);
      setHistoriesByCircuit({});
      const fallbackCircuitId = nextProject.logicalCircuits[0]?.logicalCircuitId ?? "";
      setCurrentCircuitId(nextProject.project.logicalCircuitId || fallbackCircuitId);
      setSelectedSymbolIds([]);
      setSelectedTextNoteIds([]);
      setSelectedWireIds([]);
      setActiveFileHandle(fileMeta?.handle ?? null, fileMeta?.fileName ?? null);
      setHasUnsavedChanges(false);
    },
    [
      applyProjectChange,
      setActiveFileHandle,
      setCurrentCircuitId,
      setHasUnsavedChanges,
      setHistoriesByCircuit,
      setSelectedSymbolIds,
      setSelectedTextNoteIds,
      setSelectedWireIds,
    ],
  );

  const importProjectFromText = React.useCallback(
    (
      rawText: string,
      fileMeta?: { handle?: FileSystemFileHandleLike | null; fileName?: string | null },
    ): CircuitProject => {
      const { project: imported, format } = parseProjectFileText(rawText);
      if (format === "native") {
        loadProject(imported, {
          handle: fileMeta?.handle ?? null,
          fileName: fileMeta?.fileName ?? null,
        });
      } else {
        // Alt-XML-Dateien nicht mit JSON überschreiben: Handle lösen und Zieldateinamen auf .lcweb setzen
        loadProject(imported, {
          handle: null,
          fileName: fileMeta?.fileName ? buildNativeProjectFileName(fileMeta.fileName) : null,
        });
      }
      return imported;
    },
    [loadProject],
  );

  const importProjectFromXml = React.useCallback(
    (
      xmlText: string,
      fileMeta?: { handle?: FileSystemFileHandleLike | null; fileName?: string | null },
    ): CircuitProject => importProjectFromText(xmlText, fileMeta),
    [importProjectFromText],
  );

  const resetToDemoProject = React.useCallback(
    () => {
      loadProject(createDemoCircuitProject());
    },
    [loadProject],
  );

  const resetToEmptyProject = React.useCallback(
    () => {
      const empty = applyDefaultFrequencyToProject(
        createEmptyCircuitProject(),
        appSettingsRef.current.defaultFrequency,
      );
      loadProject(empty);
    },
    [loadProject],
  );

  // Lädt beim Programmstart im Modus "last" das zuletzt verwendete Projekt (mit Fallback auf leeres Projekt)
  React.useEffect(
    () => {
      if (initialProject || appSettingsRef.current.startupProjectMode !== "last") {
        return;
      }

      let cancelled = false;
      void loadLastProjectFromStorage().then((result) => {
        if (cancelled || hasUserProjectActionRef.current || result.kind !== "loaded") {
          return;
        }
        try {
          const { project: imported, format } = parseProjectFileText(result.content);
          if (format === "native") {
            loadProject(imported, { handle: result.handle, fileName: result.fileName });
          } else {
            loadProject(imported, {
              handle: null,
              fileName: buildNativeProjectFileName(result.fileName),
            });
          }
        } catch {
          // Fehlerhafte letzte Datei belässt das leere Fallback-Projekt
        }
      });

      return () => {
        cancelled = true;
      };
    },
    [initialProject, loadProject],
  );

  return (
    <CircuitContext.Provider
      value={{
        get project() {
          return projectRef.current ?? project;
        },
        setProject,
        get currentCircuit() {
          const p = projectRef.current ?? project;
          const cid = currentCircuitIdRef.current ?? currentCircuitId;
          return p.logicalCircuits.find((lc) => lc.logicalCircuitId === cid) ?? p.logicalCircuits[0];
        },
        get currentCircuitId() {
          return currentCircuitIdRef.current ?? currentCircuitId;
        },
        get selectedSymbolIds() {
          return selectedSymbolIdsRef.current ?? selectedSymbolIds;
        },
        get selectedTextNoteIds() {
          return selectedTextNoteIdsRef.current ?? selectedTextNoteIds;
        },
        get selectedWireIds() {
          return selectedWireIdsRef.current ?? selectedWireIds;
        },
        selectSymbol,
        selectTextNote,
        selectWire,
        selectSymbols,
        selectTextNotes,
        selectWires,
        selectConductor,
        selectEntities,
        addSymbol,
        addTextNote,
        addWire,
        addEntities,
        commitPastePayload,
        splitWire,
        mergeWires,
        updateWiresLive,
        updateTextNote,
        updateCircuitSymbolProperties,
        commitSimulatedMemoryData,
        updateCircuitProperties,
        resizeCircuitSymbol,
        moveSymbol,
        moveSymbols,
        moveTextNotes,
        moveEntities,
        commitFloatingMove,
        rotateSymbols,
        rotateSelectedSymbols,
        removeSymbol,
        removeSymbols,
        removeTextNotes,
        removeWires,
        removeEntities,
        get history() {
          const p = projectRef.current ?? project;
          const cid = currentCircuitIdRef.current ?? currentCircuitId;
          const lc = p.logicalCircuits.find((c) => c.logicalCircuitId === cid) ?? p.logicalCircuits[0];
          const targetId = lc?.logicalCircuitId ?? cid;
          const map = historiesByCircuitRef.current ?? historiesByCircuit;
          return map[targetId] ?? createEmptyHistoryState();
        },
        get canUndo() {
          const p = projectRef.current ?? project;
          const cid = currentCircuitIdRef.current ?? currentCircuitId;
          const lc = p.logicalCircuits.find((c) => c.logicalCircuitId === cid) ?? p.logicalCircuits[0];
          const targetId = lc?.logicalCircuitId ?? cid;
          const map = historiesByCircuitRef.current ?? historiesByCircuit;
          const h = map[targetId] ?? createEmptyHistoryState();
          return h.pointer > 0 && canUndo !== undefined;
        },
        get canRedo() {
          const p = projectRef.current ?? project;
          const cid = currentCircuitIdRef.current ?? currentCircuitId;
          const lc = p.logicalCircuits.find((c) => c.logicalCircuitId === cid) ?? p.logicalCircuits[0];
          const targetId = lc?.logicalCircuitId ?? cid;
          const map = historiesByCircuitRef.current ?? historiesByCircuit;
          const h = map[targetId] ?? createEmptyHistoryState();
          return h.pointer < h.entries.length && canRedo !== undefined;
        },
        undo,
        redo,
        clearHistory,
        recordDelta,
        setCurrentCircuitId,
        createCircuits,
        deleteCircuits,
        activePaletteDrag,
        setActivePaletteDrag,
        loadProject,
        importProjectFromText,
        importProjectFromXml,
        resetToDemoProject,
        resetToEmptyProject,
        updateProjectProperties,
        get hasUnsavedChanges() {
          return hasUnsavedChangesRef.current;
        },
        markProjectSaved,
        get appSettings() {
          return appSettingsRef.current;
        },
        updateAppSettings,
        get isCleanUpVisualizationEnabled() {
          return isCleanUpVisualizationRef.current;
        },
        setCleanUpVisualizationEnabled,
        toggleCleanUpVisualization,
        get activeFileHandle() {
          return activeFileHandleRef.current;
        },
        get activeFileName() {
          return activeFileNameRef.current;
        },
        setActiveFileHandle,
      }}
    >
      {children}
    </CircuitContext.Provider>
  );
};

export default CircuitContextProvider;
