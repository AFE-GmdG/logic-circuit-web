import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CircuitContext from "../../contexts/circuitContext";
import CollabContext from "../../contexts/collabContext";
import LibraryContext from "../../contexts/libraryContext";
import SimulationContext from "../../contexts/simulationContext";

import type DisplayColor from "../../types/circuit/displayColor";
import type LedMatrixType from "../../types/circuit/ledMatrixType";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type PaletteGateType from "../../types/circuit/paletteGateType";
import type PaletteSelection from "../../types/circuit/paletteSelection";
import type PinSide from "../../types/circuit/pinSide";
import type SensorType from "../../types/circuit/sensorType";
import type SoundWaveform from "../../types/circuit/soundWaveform";
import type SynthesizerMode from "../../types/circuit/synthesizerMode";

import { isTestable } from "../../simulation/truthTable/circuitTestSocket";
import { SOUND_DEFAULT_FREQUENCY } from "../../utils/audioPitchTable";
import {
  createDefaultLogicalCircuit,
  generateUniquePinName,
  wouldCreateCircuitCycle,
} from "../../utils/circuitLayout";
import { getCircuitDeletionBlockReason } from "../../utils/circuitManagement";
import { pickAutoParticipantColor } from "../../utils/collabParticipantColors";
import {
  getPaletteGateItems,
  getTextNotePaletteLabelKey,
  type PaletteGateDescriptor,
} from "../../utils/componentCatalog";
import {
  type CollapsedCategoriesMap,
  getCustomPaletteCategoryKey,
  loadCollapsedCategories,
  saveCollapsedCategories,
  SYSTEM_PALETTE_CATEGORY_KEYS,
} from "../../utils/paletteStorage";

import LibraryView from "./libraryView";
import PaletteCategory from "./paletteCategory";
import PaletteItem from "./paletteItem";
import ConfirmDialog from "../app/confirmDialog";
import TruthTableDialog from "../app/truthTableDialog";
import UsageDialog from "../app/usageDialog";
import ContextMenuPopup, { type ContextMenuItem } from "../circuitCanvas/contextMenuPopup";
import PropertyDialog from "../propertyDialog";
import RunningCircuitTree from "../runningCircuitTree";

type ComponentPaletteProps = React.ComponentPropsWithoutRef<"aside"> & {
  subCircuits?: LogicalCircuit[];
  onSelectItem?: (selection: PaletteSelection) => void;
};

// Beispiel-Subschaltungen für das Standard-Projekt analog zum Original
const DEFAULT_SUB_CIRCUITS: LogicalCircuit[] = [
  createDefaultLogicalCircuit("main-circuit", "Haupt-Schaltung"),
  createDefaultLogicalCircuit("sub-power", "Power", "Helpers"),
  createDefaultLogicalCircuit("sub-7seg-4bit", "7 Segment 04 Bit", "LED"),
];

const IO_ITEMS: PaletteGateDescriptor[] = getPaletteGateItems("io");
const DISPLAY_ITEMS: PaletteGateDescriptor[] = getPaletteGateItems("displays");
const GATE_ITEMS: PaletteGateDescriptor[] = getPaletteGateItems("gates");
const TEXT_NOTE_LABEL_KEY = getTextNotePaletteLabelKey();

const ComponentPalette = styled(({
  subCircuits,
  onSelectItem,
  ...other
}: ComponentPaletteProps) => {
  const { t } = useTranslation();
  const circuitContext = React.useContext(CircuitContext);
  const collabContext = React.useContext(CollabContext);
  const libraryContext = React.useContext(LibraryContext);
  const simulationContext = React.useContext(SimulationContext);
  const isSimulating = simulationContext?.isSimulating ?? false;
  const isEditingLibrary = libraryContext?.isEditingLibrary ?? false;
  const isCollabReadOnly = Boolean(
    collabContext?.isInSession &&
    (collabContext.modelSyncState?.isReadOnlyForGuest || collabContext.modelSyncState?.isQuiesced) &&
    !isEditingLibrary,
  );
  const guestReadOnlyTooltip = isCollabReadOnly ? t("collabSync.guestReadOnlyTooltip") : undefined;

  const [isCreatingCircuit, setIsCreatingCircuit] = React.useState(false);
  const [editingCircuit, setEditingCircuit] = React.useState<LogicalCircuit | null>(null);
  const [addingToLibraryCircuit, setAddingToLibraryCircuit] = React.useState<LogicalCircuit | null>(null);
  const [usageTargetCircuit, setUsageTargetCircuit] = React.useState<LogicalCircuit | null>(null);
  const [truthTableTargetCircuit, setTruthTableTargetCircuit] = React.useState<LogicalCircuit | null>(null);
  const [pendingDeleteCircuit, setPendingDeleteCircuit] = React.useState<LogicalCircuit | null>(null);
  const [circuitActionError, setCircuitActionError] = React.useState<string | null>(null);
  const [libraryActionNotice, setLibraryActionNotice] = React.useState<string | null>(null);
  const [circuitMenuState, setCircuitMenuState] = React.useState<{
    circuit: LogicalCircuit;
    deleteDisabledReason: string | null;
    x: number;
    y: number;
  } | null>(null);

  // Schließt Schaltungs-Dialoge beim Wechsel in die Simulation
  React.useEffect(
    () => {
      if (isSimulating) {
        setIsCreatingCircuit(false);
        setEditingCircuit(null);
        setPendingDeleteCircuit(null);
        setCircuitMenuState(null);
      }
    },
    [isSimulating],
  );

  const effectiveSubCircuits = subCircuits ?? circuitContext?.project?.logicalCircuits ?? DEFAULT_SUB_CIRCUITS;
  const [collapsedCategories, setCollapsedCategories] = React.useState<CollapsedCategoriesMap>(() =>
    loadCollapsedCategories(),
  );

  // Verwaltet die eingestellte Eingangsanzahl für mehrfacheingängige Gatter
  const [inputCounts, setInputCounts] = React.useState<Record<string, number>>({
    and: 2,
    nand: 2,
    or: 2,
    nor: 2,
    xor: 2,
    xnor: 2,
  });

  // Verwaltet Bit- / Busbreiten für Pins und Konstanten
  const [bitWidths, setBitWidths] = React.useState<Record<string, number>>({
    pinIn: 1,
    pinOut: 1,
    constant: 1,
    sensor: 1,
  });

  // Verwaltet Pin-Seiten für konfigurierbare Bauteile
  const [pinSides, setPinSides] = React.useState<Record<string, PinSide>>({
    button: "right",
    constant: "right",
    sensor: "right",
    probe: "left",
    sound: "left",
    pinIn: "left",
    pinOut: "right",
  });

  // Verwaltet Wellenform und Frequenz für den Standard-Summer sowie Modus für den Synthesizer
  const [soundWaveform, setSoundWaveform] = React.useState<SoundWaveform>("sine");
  const [soundFrequency, setSoundFrequency] = React.useState<number>(SOUND_DEFAULT_FREQUENCY);
  const [synthesizerMode, setSynthesizerMode] = React.useState<SynthesizerMode>("square");

  // Verwaltet Hexadezimal- / Dezimal-Zahlenformat für Konstanten und Signal-Sonden
  const [hexFormats, setHexFormats] = React.useState<Record<string, boolean>>({
    constant: true,
    probe: false,
  });

  // Verwaltet Sensortyp-Vorauswahl für den Sensor-Baustein
  const [sensorType, setSensorType] = React.useState<SensorType>("random");

  // Verwaltet Adress- und Datenbitbreite für ROM und RAM
  const [memoryConfigs, setMemoryConfigs] = React.useState<
    Record<"rom" | "ram", { addressBitWidth: number; dataBitWidth: number }>
  >({
    rom: { addressBitWidth: 8, dataBitWidth: 8 },
    ram: { addressBitWidth: 8, dataBitWidth: 8 },
  });

  // Verwaltet Vorauswahl von Datenbusbreite und Farbtiefe für das Grafische Display
  const [graphicsArrayConfig, setGraphicsArrayConfig] = React.useState<{
    dataBitWidth: number;
    bitsPerPixel: number;
  }>({
    dataBitWidth: 8,
    bitsPerPixel: 1,
  });

  // Verwaltet Signalfarbe für LEDs und 7-Segment-Anzeigen
  const [displayColors, setDisplayColors] = React.useState<Record<string, DisplayColor>>({
    led: "red",
    sevenSegment: "red",
  });

  // Verwaltet LED-Matrix-Konfiguration (Typ, Zeilen, Spalten)
  const [matrixConfig, setMatrixConfig] = React.useState<{
    matrixType: LedMatrixType;
    rows: number;
    columns: number;
  }>({
    matrixType: "individual",
    rows: 4,
    columns: 4,
  });

  // Verwaltet Bus-Splitter-Konfiguration (Pin-Anzahl, Bitbreite pro Pin, Richtung)
  const [splitterConfig, setSplitterConfig] = React.useState<{
    pinCount: number;
    pinBitWidth: number;
    clockwise: boolean;
  }>({
    pinCount: 3,
    pinBitWidth: 1,
    clockwise: true,
  });

  // Verwaltet Notation / Beschriftung für Buttons (Standard: Leerstring)
  const [buttonNotation, setButtonNotation] = React.useState<string>("");

  // Verwaltet Notation / Beschriftung für Pins (Standard: X für Eingang, Q für Ausgang)
  const [pinNotations, setPinNotations] = React.useState<Record<string, string>>({
    pinIn: "X",
    pinOut: "Q",
  });

  const currentCircuitPins = React.useMemo(
    () => {
      if (!circuitContext?.currentCircuit) {
        return [];
      }
      const currentId = circuitContext.currentCircuit.logicalCircuitId;
      const projectPins = circuitContext.project?.pins?.filter((p) => p.circuitId === currentId) ?? [];
      const logicalPins = circuitContext.currentCircuit.logicalPins ?? [];
      return [...projectPins, ...logicalPins];
    },
    [circuitContext?.currentCircuit, circuitContext?.project?.pins],
  );

  const currentCircuitId = circuitContext?.currentCircuitId ?? circuitContext?.currentCircuit?.logicalCircuitId;

  // Wenn Pins auf der aktuellen Schaltung platziert werden, automatisch die nächste freie Notation vorschlagen
  React.useEffect(
    () => {
      setPinNotations((prev) => {
        const isTaken = (name: string) =>
          currentCircuitPins.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());

        const nextIn = isTaken(prev.pinIn)
          ? generateUniquePinName(prev.pinIn, currentCircuitPins)
          : prev.pinIn;
        const nextOut = isTaken(prev.pinOut)
          ? generateUniquePinName(prev.pinOut, currentCircuitPins)
          : prev.pinOut;

        if (nextIn === prev.pinIn && nextOut === prev.pinOut) {
          return prev;
        }
        return { pinIn: nextIn, pinOut: nextOut };
      });
    },
    [currentCircuitPins],
  );

  // Beim Schaltungswechsel: Notationen an den Pin-Bestand der neuen Schaltung anpassen
  const prevCircuitIdRef = React.useRef(currentCircuitId);
  React.useEffect(
    () => {
      if (prevCircuitIdRef.current !== currentCircuitId) {
        prevCircuitIdRef.current = currentCircuitId;
        setPinNotations((prev) => {
          const baseIn = prev.pinIn.match(/^[Xx]\d*$/) ? "X" : prev.pinIn;
          const baseOut = prev.pinOut.match(/^[Qq]\d*$/) ? "Q" : prev.pinOut;
          return {
            pinIn: generateUniquePinName(baseIn, currentCircuitPins),
            pinOut: generateUniquePinName(baseOut, currentCircuitPins),
          };
        });
      }
    },
    [currentCircuitId, currentCircuitPins],
  );

  // Verwaltet Taster / Schalter Modus (false = Taster, true = Schalter)
  const [buttonIsToggle, setButtonIsToggle] = React.useState<boolean>(false);

  const isCategoryCollapsed = React.useCallback(
    (categoryKey: string): boolean => Boolean(collapsedCategories[categoryKey]),
    [collapsedCategories],
  );

  const toggleCategory = React.useCallback(
    (categoryKey: string) => {
      setCollapsedCategories((prev) => {
        const next: CollapsedCategoriesMap = {
          ...prev,
          [categoryKey]: !prev[categoryKey],
        };
        saveCollapsedCategories(next);
        return next;
      });
    },
    [],
  );

  const handleInputCountChange = React.useCallback(
    (type: PaletteGateType, count: number) => {
      setInputCounts((prev) => ({
        ...prev,
        [type]: count,
      }));
    },
    [],
  );

  // Gruppiert die Subschaltungen dynamisch nach ihrer Kategorie
  const subCircuitsByCategory = React.useMemo(
    () => {
      const projectCircuits: LogicalCircuit[] = [];
      const customCategories = new Map<string, LogicalCircuit[]>();

      for (const circuit of effectiveSubCircuits) {
        const categoryName = circuit.category?.trim();
        if (!categoryName) {
          projectCircuits.push(circuit);
        } else {
          const existing = customCategories.get(categoryName) ?? [];
          existing.push(circuit);
          customCategories.set(categoryName, existing);
        }
      }

      return { projectCircuits, customCategories };
    },
    [effectiveSubCircuits],
  );

  const circuitPresenceMap = React.useMemo(
    () => {
      const map = new Map<string, Array<{ peerId: string; displayName: string; color: string }>>();
      if (!collabContext?.isInSession || isEditingLibrary || !collabContext.presenceState) {
        return map;
      }
      for (const peer of Object.values(collabContext.presenceState.peers)) {
        if (peer.peerId === collabContext.selfPeerId || peer.inLibraryMode || !peer.logicalCircuitId) {
          continue;
        }
        const participant = collabContext.participants.find((p) => p.peerId === peer.peerId);
        const displayName = participant?.displayName ?? peer.peerId;
        const color = collabContext.getParticipantColor?.(peer.peerId, displayName)
          ?? pickAutoParticipantColor(new Set(), displayName);
        const list = map.get(peer.logicalCircuitId) ?? [];
        list.push({
          peerId: peer.peerId,
          displayName,
          color,
        });
        map.set(peer.logicalCircuitId, list);
      }
      return map;
    },
    [
      collabContext?.getParticipantColor,
      collabContext?.isInSession,
      collabContext?.participantColors,
      collabContext?.participants,
      collabContext?.presenceState,
      collabContext?.selfPeerId,
      isEditingLibrary,
    ],
  );

  const renderSubCircuitItem = React.useCallback(
    (circuit: LogicalCircuit) => {
      const isActive = circuit.logicalCircuitId === circuitContext?.currentCircuit?.logicalCircuitId;
      const isCycle = circuitContext?.currentCircuit && circuitContext.project
        ? wouldCreateCircuitCycle(
          circuitContext.currentCircuit.logicalCircuitId,
          circuit.logicalCircuitId,
          circuitContext.project,
        )
        : false;
      const baseDeleteDisabledReason = circuitContext?.project
        ? (getCircuitDeletionBlockReason(circuitContext.project, circuit.logicalCircuitId) ?? undefined)
        : undefined;
      const deleteDisabledReason = guestReadOnlyTooltip ?? baseDeleteDisabledReason;

      return (
        <PaletteItem
          key={circuit.logicalCircuitId}
          type="subCircuit"
          label={circuit.name}
          subCircuitId={circuit.logicalCircuitId}
          subCircuit={circuit}
          isActive={isActive}
          isCycle={isCycle}
          isReadOnly={isCollabReadOnly}
          readOnlyTooltip={guestReadOnlyTooltip}
          presenceParticipants={circuitPresenceMap.get(circuit.logicalCircuitId)}
          onActivate={() => circuitContext?.setCurrentCircuitId(circuit.logicalCircuitId)}
          onDelete={circuitContext && !isCollabReadOnly ? () => setPendingDeleteCircuit(circuit) : undefined}
          deleteDisabledReason={deleteDisabledReason}
          onSelect={() => onSelectItem?.({
            type: "subCircuit",
            subCircuitId: circuit.logicalCircuitId,
            name: circuit.name,
          })}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isSimulating) {
              return;
            }
            setCircuitMenuState({
              circuit,
              deleteDisabledReason: deleteDisabledReason ?? null,
              x: event.clientX,
              y: event.clientY,
            });
          }}
        />
      );
    },
    [
      circuitContext,
      circuitPresenceMap,
      guestReadOnlyTooltip,
      isCollabReadOnly,
      isSimulating,
      onSelectItem,
    ],
  );

  if (isSimulating) {
    return <RunningCircuitTree {...other} />;
  }

  const textNoteLabel = t(TEXT_NOTE_LABEL_KEY);

  const activeTab = libraryContext?.activeSidebarTab ?? "project";
  const showLibraryView = Boolean(libraryContext && activeTab === "library");

  return (
    <aside {...other} data-component="ComponentPalette">
      <div className="palette-header">
        <h2 className="palette-title">{t("palette.title")}</h2>
        {!showLibraryView && (
          <button
            type="button"
            className="new-circuit-button"
            title={
              !circuitContext
                ? t("palette.addCircuitNoContextTitle")
                : isSimulating
                  ? t("menu.disabledWhileSimulating")
                  : guestReadOnlyTooltip ?? t("palette.addCircuitTitle")
            }
            aria-label={t("palette.addCircuitTitle")}
            disabled={!circuitContext || isSimulating || isCollabReadOnly}
            onClick={() => {
              if (isCollabReadOnly) {
                return;
              }
              setCircuitActionError(null);
              setIsCreatingCircuit(true);
            }}
          >
            {t("palette.addCircuitButton")}
          </button>
        )}
      </div>

      {libraryContext && (
        <div
          className="palette-tabs"
          role="tablist"
          aria-label={t("palette.tabs.ariaLabel")}
          data-testid="palette-sidebar-tabs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "project"}
            data-testid="palette-tab-project"
            className={`palette-tab-btn${activeTab === "project" ? " active" : ""}`}
            onClick={() => libraryContext.setActiveSidebarTab("project")}
          >
            {t("palette.tabs.project")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "library"}
            data-testid="palette-tab-library"
            className={`palette-tab-btn library-tab${activeTab === "library" ? " active" : ""}`}
            onClick={() => libraryContext.setActiveSidebarTab("library")}
          >
            {t("palette.tabs.library")}
          </button>
        </div>
      )}

      {libraryActionNotice && (
        <div className="library-notice-banner" role="status">
          <span>{libraryActionNotice}</span>
          <button
            type="button"
            className="circuit-error-close"
            aria-label={t("palette.errorCloseAriaLabel")}
            onClick={() => setLibraryActionNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      {circuitActionError && (
        <div className="circuit-error-banner" role="alert">
          <span>{circuitActionError}</span>
          <button
            type="button"
            className="circuit-error-close"
            aria-label={t("palette.errorCloseAriaLabel")}
            onClick={() => setCircuitActionError(null)}
          >
            ×
          </button>
        </div>
      )}

      {showLibraryView ? (
        <LibraryView />
      ) : (
        <div className="palette-content">
          {/* Haupt-Schaltungen des Projekts */}
          {subCircuitsByCategory.projectCircuits.length > 0 && (
            <PaletteCategory
              data-category-kind="system"
              title={t(SYSTEM_PALETTE_CATEGORY_KEYS.projectCircuits)}
              isExpanded={!isCategoryCollapsed(SYSTEM_PALETTE_CATEGORY_KEYS.projectCircuits)}
              onToggle={() => toggleCategory(SYSTEM_PALETTE_CATEGORY_KEYS.projectCircuits)}
            >
              {subCircuitsByCategory.projectCircuits.map(renderSubCircuitItem)}
            </PaletteCategory>
          )}

          {/* Dynamische Kategorien für Subschaltungen (z. B. Helpers, LED) */}
          {Array.from(subCircuitsByCategory.customCategories.entries()).map(([categoryName, circuits]) => {
            const categoryKey = getCustomPaletteCategoryKey(categoryName);
            return (
              <PaletteCategory
                key={categoryKey}
                data-category-kind="custom"
                title={categoryName}
                isExpanded={!isCategoryCollapsed(categoryKey)}
                onToggle={() => toggleCategory(categoryKey)}
              >
                {circuits.map(renderSubCircuitItem)}
              </PaletteCategory>
            );
          })}

          {/* Feste Kategorie: Ein- & Ausgänge */}
          <PaletteCategory
            data-category-kind="system"
            title={t(SYSTEM_PALETTE_CATEGORY_KEYS.io)}
            isExpanded={!isCategoryCollapsed(SYSTEM_PALETTE_CATEGORY_KEYS.io)}
            onToggle={() => toggleCategory(SYSTEM_PALETTE_CATEGORY_KEYS.io)}
          >
            {IO_ITEMS.map((item) => {
              const itemLabel = t(item.labelKey);
              const hasBitWidth =
                item.type === "pinIn" || item.type === "pinOut" || item.type === "constant" || item.type === "sensor";
              const bitWidth = hasBitWidth ? (bitWidths[item.type] ?? 1) : undefined;

              const hasPinSide =
                item.type === "button" ||
                item.type === "constant" ||
                item.type === "pinIn" ||
                item.type === "pinOut" ||
                item.type === "sensor";
              const pinSide = hasPinSide
                ? (pinSides[item.type] ?? (item.type === "pinIn" ? "left" : "right"))
                : undefined;

              const hasHexFormat = item.type === "constant";
              const isHex = hasHexFormat ? (hexFormats[item.type] ?? true) : undefined;

              const hasSplitterConfig = item.type === "splitter";
              const hasSensorConfig = item.type === "sensor";
              const isButton = item.type === "button";
              const isPin = item.type === "pinIn" || item.type === "pinOut";
              const hasNotation = isButton || isPin;
              const itemNotation = isButton
                ? buttonNotation
                : isPin
                  ? (pinNotations[item.type] ?? (item.type === "pinOut" ? "Q" : "X"))
                  : undefined;
              const handleNotationChange = isButton
                ? setButtonNotation
                : isPin
                  ? (val: string) => setPinNotations((prev) => ({ ...prev, [item.type]: val }))
                  : undefined;

              return (
                <PaletteItem
                  key={item.type}
                  type={item.type}
                  label={itemLabel}
                  isReadOnly={isCollabReadOnly}
                  readOnlyTooltip={guestReadOnlyTooltip}
                  hasBitWidth={hasBitWidth}
                  bitWidth={bitWidth}
                  onBitWidthChange={hasBitWidth ? (w) => setBitWidths((prev) => ({ ...prev, [item.type]: w })) : undefined}
                  hasPinSide={hasPinSide}
                  pinSide={pinSide}
                  onPinSideChange={hasPinSide ? (side) => setPinSides((prev) => ({ ...prev, [item.type]: side })) : undefined}
                  hasHexFormat={hasHexFormat}
                  isHex={isHex}
                  onHexFormatChange={hasHexFormat ? (h) => setHexFormats((prev) => ({ ...prev, [item.type]: h })) : undefined}
                  hasSplitterConfig={hasSplitterConfig}
                  pinCount={hasSplitterConfig ? splitterConfig.pinCount : undefined}
                  onPinCountChange={hasSplitterConfig ? (count) => setSplitterConfig((prev) => ({ ...prev, pinCount: count })) : undefined}
                  pinBitWidth={hasSplitterConfig ? splitterConfig.pinBitWidth : undefined}
                  onPinBitWidthChange={hasSplitterConfig ? (w) => setSplitterConfig((prev) => ({ ...prev, pinBitWidth: w })) : undefined}
                  clockwise={hasSplitterConfig ? splitterConfig.clockwise : undefined}
                  onClockwiseChange={hasSplitterConfig ? (cw) => setSplitterConfig((prev) => ({ ...prev, clockwise: cw })) : undefined}
                  hasNotation={hasNotation}
                  notation={itemNotation}
                  onNotationChange={handleNotationChange}
                  hasButtonConfig={isButton}
                  isToggle={isButton ? buttonIsToggle : undefined}
                  onToggleChange={isButton ? setButtonIsToggle : undefined}
                  hasSensorConfig={hasSensorConfig}
                  sensorType={hasSensorConfig ? sensorType : undefined}
                  onSensorTypeChange={hasSensorConfig ? setSensorType : undefined}
                  onSelect={() => onSelectItem?.({
                    type: item.type,
                    name: isButton
                      ? (buttonNotation || (buttonIsToggle ? t("palette.defaults.toggleSwitch") : t("palette.defaults.pushButton")))
                      : isPin
                        ? (itemNotation || (item.type === "pinOut" ? "Q" : "X"))
                        : itemLabel,
                    notation: itemNotation,
                    isToggle: isButton ? buttonIsToggle : undefined,
                    bitWidth: hasSplitterConfig ? splitterConfig.pinCount * splitterConfig.pinBitWidth : bitWidth,
                    pinSide,
                    isHex,
                    pinCount: hasSplitterConfig ? splitterConfig.pinCount : undefined,
                    pinBitWidth: hasSplitterConfig ? splitterConfig.pinBitWidth : undefined,
                    clockwise: hasSplitterConfig ? splitterConfig.clockwise : undefined,
                    sensorType: hasSensorConfig ? sensorType : undefined,
                  })}
                />
              );
            })}
          </PaletteCategory>

          {/* Feste Kategorie: Ausgabe & Anzeige */}
          <PaletteCategory
            data-category-kind="system"
            title={t(SYSTEM_PALETTE_CATEGORY_KEYS.displays)}
            isExpanded={!isCategoryCollapsed(SYSTEM_PALETTE_CATEGORY_KEYS.displays)}
            onToggle={() => toggleCategory(SYSTEM_PALETTE_CATEGORY_KEYS.displays)}
          >
            {DISPLAY_ITEMS.map((item) => {
              const itemLabel = t(item.labelKey);
              const hasColor = item.type === "led" || item.type === "sevenSegment";
              const color = hasColor ? (displayColors[item.type] ?? "red") : undefined;

              const hasMatrixConfig = item.type === "ledMatrix";
              const hasPinSide = item.type === "probe" || item.type === "sound";
              const pinSide = hasPinSide ? (pinSides[item.type] ?? "left") : undefined;
              const hasHexFormat = item.type === "probe";
              const isHex = hasHexFormat ? (hexFormats[item.type] ?? false) : undefined;
              const hasSoundConfig = item.type === "sound";
              const hasSynthesizerConfig = item.type === "synthesizer";
              const hasGraphicsArrayConfig = item.type === "graphicsArray";

              return (
                <PaletteItem
                  key={item.type}
                  type={item.type}
                  label={itemLabel}
                  isReadOnly={isCollabReadOnly}
                  readOnlyTooltip={guestReadOnlyTooltip}
                  hasPinSide={hasPinSide}
                  pinSide={pinSide}
                  onPinSideChange={
                    hasPinSide
                      ? (side) => setPinSides((prev) => ({ ...prev, [item.type]: side }))
                      : undefined
                  }
                  hasHexFormat={hasHexFormat}
                  isHex={isHex}
                  onHexFormatChange={
                    hasHexFormat
                      ? (hex) => setHexFormats((prev) => ({ ...prev, [item.type]: hex }))
                      : undefined
                  }
                  hasColor={hasColor}
                  color={color}
                  onColorChange={
                    hasColor
                      ? (c) => setDisplayColors((prev) => ({ ...prev, [item.type]: c }))
                      : undefined
                  }
                  hasMatrixConfig={hasMatrixConfig}
                  matrixType={hasMatrixConfig ? matrixConfig.matrixType : undefined}
                  rows={hasMatrixConfig ? matrixConfig.rows : undefined}
                  columns={hasMatrixConfig ? matrixConfig.columns : undefined}
                  onMatrixTypeChange={
                    hasMatrixConfig
                      ? (mType) => setMatrixConfig((prev) => ({ ...prev, matrixType: mType }))
                      : undefined
                  }
                  onRowsChange={
                    hasMatrixConfig
                      ? (r) => setMatrixConfig((prev) => ({ ...prev, rows: r }))
                      : undefined
                  }
                  onColumnsChange={
                    hasMatrixConfig
                      ? (c) => setMatrixConfig((prev) => ({ ...prev, columns: c }))
                      : undefined
                  }
                  hasSoundConfig={hasSoundConfig}
                  waveform={hasSoundConfig ? soundWaveform : undefined}
                  onWaveformChange={hasSoundConfig ? setSoundWaveform : undefined}
                  frequency={hasSoundConfig ? soundFrequency : undefined}
                  onFrequencyChange={hasSoundConfig ? setSoundFrequency : undefined}
                  hasSynthesizerConfig={hasSynthesizerConfig}
                  synthesizerMode={hasSynthesizerConfig ? synthesizerMode : undefined}
                  onSynthesizerModeChange={hasSynthesizerConfig ? setSynthesizerMode : undefined}
                  hasGraphicsArrayConfig={hasGraphicsArrayConfig}
                  dataBitWidth={hasGraphicsArrayConfig ? graphicsArrayConfig.dataBitWidth : undefined}
                  bitsPerPixel={hasGraphicsArrayConfig ? graphicsArrayConfig.bitsPerPixel : undefined}
                  onDataBitWidthChange={
                    hasGraphicsArrayConfig
                      ? (w) =>
                        setGraphicsArrayConfig((prev) => ({
                          ...prev,
                          dataBitWidth: w,
                        }))
                      : undefined
                  }
                  onBitsPerPixelChange={
                    hasGraphicsArrayConfig
                      ? (bpp) =>
                        setGraphicsArrayConfig((prev) => ({
                          ...prev,
                          bitsPerPixel: bpp,
                        }))
                      : undefined
                  }
                  onSelect={() => onSelectItem?.({
                    type: item.type,
                    name: itemLabel,
                    pinSide,
                    isHex,
                    color,
                    matrixType: hasMatrixConfig ? matrixConfig.matrixType : undefined,
                    rows: hasMatrixConfig ? matrixConfig.rows : undefined,
                    columns: hasMatrixConfig ? matrixConfig.columns : undefined,
                    frequency: hasSoundConfig ? soundFrequency : undefined,
                    waveform: hasSoundConfig ? soundWaveform : undefined,
                    synthesizerMode: hasSynthesizerConfig ? synthesizerMode : undefined,
                    dataBitWidth: hasGraphicsArrayConfig ? graphicsArrayConfig.dataBitWidth : undefined,
                    bitsPerPixel: hasGraphicsArrayConfig ? graphicsArrayConfig.bitsPerPixel : undefined,
                  })}
                />
              );
            })}
          </PaletteCategory>

          {/* Feste Kategorie: Grundformen */}
          <PaletteCategory
            data-category-kind="system"
            title={t(SYSTEM_PALETTE_CATEGORY_KEYS.gates)}
            isExpanded={!isCategoryCollapsed(SYSTEM_PALETTE_CATEGORY_KEYS.gates)}
            onToggle={() => toggleCategory(SYSTEM_PALETTE_CATEGORY_KEYS.gates)}
          >
            {GATE_ITEMS.map((item) => {
              const itemLabel = t(item.labelKey);
              const count = inputCounts[item.type] ?? 2;
              const isMemory = item.type === "rom" || item.type === "ram";
              const memoryKey = item.type === "ram" ? "ram" : "rom";
              const memoryConfig = isMemory ? memoryConfigs[memoryKey] : undefined;
              return (
                <PaletteItem
                  key={item.type}
                  type={item.type}
                  label={itemLabel}
                  inputCount={count}
                  isReadOnly={isCollabReadOnly}
                  readOnlyTooltip={guestReadOnlyTooltip}
                  hasVariableInputs={item.hasVariableInputs}
                  onInputCountChange={(newCount) => handleInputCountChange(item.type, newCount)}
                  hasMemoryConfig={isMemory}
                  addressBitWidth={memoryConfig?.addressBitWidth}
                  dataBitWidth={memoryConfig?.dataBitWidth}
                  onAddressBitWidthChange={
                    isMemory
                      ? (w) =>
                        setMemoryConfigs((prev) => ({
                          ...prev,
                          [memoryKey]: { ...prev[memoryKey], addressBitWidth: w },
                        }))
                      : undefined
                  }
                  onDataBitWidthChange={
                    isMemory
                      ? (w) =>
                        setMemoryConfigs((prev) => ({
                          ...prev,
                          [memoryKey]: { ...prev[memoryKey], dataBitWidth: w },
                        }))
                      : undefined
                  }
                  onSelect={() => onSelectItem?.({
                    type: item.type,
                    inputCount: item.hasVariableInputs ? count : undefined,
                    name: itemLabel,
                    addressBitWidth: memoryConfig?.addressBitWidth,
                    dataBitWidth: memoryConfig?.dataBitWidth,
                  })}
                />
              );
            })}
          </PaletteCategory>

          {/* Feste Kategorie: Dekoration */}
          <PaletteCategory
            data-category-kind="system"
            title={t(SYSTEM_PALETTE_CATEGORY_KEYS.decoration)}
            isExpanded={!isCategoryCollapsed(SYSTEM_PALETTE_CATEGORY_KEYS.decoration)}
            onToggle={() => toggleCategory(SYSTEM_PALETTE_CATEGORY_KEYS.decoration)}
          >
            <PaletteItem
              type="textNote"
              label={textNoteLabel}
              isReadOnly={isCollabReadOnly}
              readOnlyTooltip={guestReadOnlyTooltip}
              onSelect={() => onSelectItem?.({
                type: "textNote",
                name: textNoteLabel,
              })}
            />
          </PaletteCategory>
        </div>
      )}

      {/* Eigenschaften-Dialog zum direkten Anlegen oder Bearbeiten einer Schaltung */}
      <PropertyDialog
        isOpen={isCreatingCircuit || editingCircuit !== null}
        isCreatingCircuit={isCreatingCircuit}
        circuit={isCreatingCircuit ? null : editingCircuit}
        onSaveCircuit={(circuitId, updates) => {
          circuitContext?.updateCircuitProperties(circuitId, updates);
          setCircuitActionError(null);
        }}
        onCreateCircuit={(input) => {
          const created = circuitContext?.createCircuits([input]);
          if (created && created[0]) {
            circuitContext?.setCurrentCircuitId(created[0].logicalCircuitId);
          }
          setCircuitActionError(null);
        }}
        onClose={() => {
          setIsCreatingCircuit(false);
          setEditingCircuit(null);
        }}
      />

      {/* Kontextmenü für Schaltungseinträge in der Palette */}
      <ContextMenuPopup
        isOpen={circuitMenuState !== null}
        x={circuitMenuState?.x ?? 0}
        y={circuitMenuState?.y ?? 0}
        ariaLabel={t("palette.contextMenuAriaLabel")}
        items={((): ContextMenuItem[] => {
          if (!circuitMenuState) {
            return [];
          }
          const targetCircuit = circuitMenuState.circuit;
          return [
            {
              id: "palette-circuit-open",
              label: t("palette.contextMenu.open"),
              onSelect: () => {
                circuitContext?.setCurrentCircuitId(targetCircuit.logicalCircuitId);
              },
            },
            {
              id: "palette-circuit-properties",
              label: t("palette.contextMenu.properties"),
              separatorBefore: true,
              onSelect: () => {
                setIsCreatingCircuit(false);
                setEditingCircuit(targetCircuit);
              },
            },
            {
              id: "palette-circuit-truth-table",
              label: t("palette.contextMenu.truthTable"),
              disabled: !isTestable(targetCircuit, circuitContext?.project),
              tooltip: !isTestable(targetCircuit, circuitContext?.project)
                ? t("menu.items.circuitTruthTableDisabledTooltip")
                : t("menu.items.circuitTruthTableTooltip"),
              onSelect: () => {
                setTruthTableTargetCircuit(targetCircuit);
              },
            },
            {
              id: "palette-circuit-usage",
              label: t("palette.contextMenu.usage"),
              onSelect: () => {
                setUsageTargetCircuit(targetCircuit);
              },
            },
            {
              id: "palette-circuit-add-to-library",
              label: t("palette.contextMenu.addToLibrary"),
              separatorBefore: true,
              disabled: !libraryContext?.isWritable,
              tooltip: !libraryContext?.isWritable
                ? t("palette.contextMenu.addToLibraryReadOnlyTooltip")
                : undefined,
              onSelect: () => {
                setAddingToLibraryCircuit(targetCircuit);
              },
            },
            {
              id: "palette-circuit-delete",
              label: t("palette.contextMenu.delete"),
              danger: true,
              separatorBefore: true,
              disabled: Boolean(circuitMenuState.deleteDisabledReason),
              tooltip: circuitMenuState.deleteDisabledReason ?? undefined,
              onSelect: () => {
                setPendingDeleteCircuit(targetCircuit);
              },
            },
          ];
        })()}
        onClose={() => setCircuitMenuState(null)}
      />

      {/* Bestätigungsdialog vor dem Löschen einer ungenutzten Schaltung */}
      <ConfirmDialog
        isOpen={pendingDeleteCircuit !== null}
        title={t("palette.confirmDeleteTitle")}
        message={t("palette.confirmDeleteMessage", { name: pendingDeleteCircuit?.name ?? "" })}
        confirmLabel={t("common.delete")}
        isDanger={true}
        onConfirm={() => {
          const target = pendingDeleteCircuit;
          setPendingDeleteCircuit(null);
          if (!target || !circuitContext) {
            return;
          }
          try {
            circuitContext.deleteCircuits([target.logicalCircuitId]);
            setCircuitActionError(null);
          } catch (err) {
            setCircuitActionError(
              err instanceof Error ? err.message : t("palette.deleteCircuitFailed"),
            );
          }
        }}
        onCancel={() => setPendingDeleteCircuit(null)}
      />

      {/* Verwendungsnachweis für rechtsgeklickte Schaltung in der Palette */}
      <UsageDialog
        isOpen={usageTargetCircuit !== null}
        targetCircuit={usageTargetCircuit}
        onClose={() => setUsageTargetCircuit(null)}
      />

      {/* Wahrheitstabellen-Dialog für rechtsgeklickte testbare Schaltung in der Palette */}
      <TruthTableDialog
        isOpen={truthTableTargetCircuit !== null}
        targetCircuit={truthTableTargetCircuit}
        onClose={() => setTruthTableTargetCircuit(null)}
      />

      {/* Eigenschaften-Dialog beim Übernehmen einer Projekt-Subschaltung in die Bibliothek */}
      <PropertyDialog
        isOpen={addingToLibraryCircuit !== null}
        circuit={addingToLibraryCircuit}
        accentVariant="library"
        customTitle={
          addingToLibraryCircuit
            ? t("dialog.property.titleLibraryAdd", { name: addingToLibraryCircuit.name })
            : undefined
        }
        customSaveLabel={t("dialog.property.saveLibraryAddButton")}
        onSaveCircuit={(circuitId, updates) => {
          if (!libraryContext || !circuitContext?.project) {
            return;
          }
          void libraryContext.addProjectCircuitToLibrary(circuitContext.project, circuitId, {
            name: updates.name,
            notation: updates.notation,
            category: updates.category,
            note: updates.note,
          }).then((res) => {
            if (res) {
              setLibraryActionNotice(
                t("library.addedFeedback", {
                  name: updates.name?.trim() || addingToLibraryCircuit?.name || "",
                }),
              );
            }
          });
        }}
        onClose={() => setAddingToLibraryCircuit(null)}
      />
    </aside>
  );
})({
  display: "flex",
  flexDirection: "column",
  width: "21.5rem",
  minWidth: "20.5rem",
  backgroundColor: "var(--color-bg-surface)",
  borderRight: "1px solid var(--color-border-subtle)",
  overflowY: "auto",
  userSelect: "none",

  "& > .palette-header": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    padding: "0.75rem 1rem",
    borderBottom: "1px solid var(--color-border-subtle)",

    "& > .palette-title": {
      margin: 0,
      fontSize: "0.95rem",
      fontWeight: 600,
      color: "var(--color-text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.05rem",
    },

    "& > .new-circuit-button": {
      padding: "0.25rem 0.55rem",
      borderRadius: "0.3rem",
      border: "1px solid var(--color-border-strong)",
      backgroundColor: "var(--color-bg-elevated)",
      color: "var(--color-text-primary)",
      fontSize: "0.75rem",
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.12s ease",

      "&:hover:not(:disabled)": {
        backgroundColor: "var(--color-accent-primary-bg)",
        borderColor: "var(--color-accent-primary)",
      },

      "&:disabled": {
        opacity: 0.4,
        cursor: "not-allowed",
      },
    },
  },

  "& > .palette-tabs": {
    display: "flex",
    borderBottom: "1px solid var(--color-border-subtle)",
    backgroundColor: "var(--color-bg-base)",
    padding: "0.25rem 0.5rem 0",
    gap: "0.25rem",

    "& > .palette-tab-btn": {
      flex: 1,
      padding: "0.35rem 0.5rem",
      border: "1px solid transparent",
      borderBottom: "none",
      borderTopLeftRadius: "0.3rem",
      borderTopRightRadius: "0.3rem",
      backgroundColor: "transparent",
      color: "var(--color-text-secondary)",
      fontSize: "0.76rem",
      fontWeight: 600,
      cursor: "pointer",

      "&.active": {
        backgroundColor: "var(--color-bg-surface)",
        borderColor: "var(--color-border-subtle)",
        color: "var(--color-accent-primary)",
      },

      "&.library-tab.active": {
        color: "var(--color-library-accent)",
        borderColor: "var(--color-library-border)",
      },
    },
  },

  "& > .library-notice-banner": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.4rem",
    margin: "0.5rem 0.5rem 0",
    padding: "0.4rem 0.6rem",
    borderRadius: "0.3rem",
    backgroundColor: "var(--color-library-bg)",
    border: "1px solid var(--color-library-border)",
    color: "var(--color-library-accent)",
    fontSize: "0.76rem",

    "& > .circuit-error-close": {
      background: "transparent",
      border: "none",
      color: "inherit",
      cursor: "pointer",
      fontSize: "0.95rem",
      padding: 0,
    },
  },

  "& > .circuit-error-banner": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.4rem",
    margin: "0.5rem 0.5rem 0",
    padding: "0.4rem 0.6rem",
    borderRadius: "0.3rem",
    backgroundColor: "var(--color-error-bg)",
    border: "1px solid var(--color-status-stopped)",
    color: "var(--color-error-text-soft)",
    fontSize: "0.78rem",

    "& > .circuit-error-close": {
      background: "transparent",
      border: "none",
      color: "inherit",
      cursor: "pointer",
      fontSize: "0.95rem",
      padding: 0,
    },
  },

  "& > .palette-content": {
    display: "flex",
    flexDirection: "column",
    padding: "0.5rem 0.5rem 1.5rem 0.5rem",
    gap: "0.3rem",
  },
});

export default ComponentPalette;
