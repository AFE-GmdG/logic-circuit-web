import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import { isCollabDisabledByEnv } from "../../utils/collabIceConfig";

export type MainMenuCategoryId = "file" | "edit" | "circuit" | "view" | "help";

export type MainMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  tooltip?: string;
  separatorBefore?: boolean;
  onSelect?: () => void;
};

export type MainMenuCategory = {
  id: MainMenuCategoryId;
  label: string;
  items: MainMenuItem[];
};

export type MainMenuProps = React.ComponentPropsWithoutRef<"div"> & {
  isOpen: boolean;
  initialCategory?: MainMenuCategoryId;
  anchorRef?: React.RefObject<HTMLButtonElement | null>;
  isSimulating: boolean;
  isPaused: boolean;
  isRunning: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasSymbolSelection: boolean;
  hasCircuitElements?: boolean;
  canPaste?: boolean;
  canDeleteCurrentCircuit: boolean;
  canOpenTruthTable?: boolean;
  canOpenOscilloscope?: boolean;
  canExportHdl?: boolean;
  deleteCircuitDisabledReason?: string;
  onClose: () => void;
  onNewProject: () => void;
  onLoadDemo: () => void;
  onImportProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onExportDesktopXml?: () => void;
  onExportHdl?: () => void;
  onExportImage: () => void;
  onOpenProjectSettings: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut?: () => void;
  onCopy?: () => void;
  onCopyForDesktop?: () => void;
  onPaste?: () => void;
  onSelectAll?: () => void;
  onDeleteSelected: () => void;
  onRotateRight: () => void;
  onRotateLeft: () => void;
  onEditCurrentCircuit: () => void;
  onCreateCircuit: () => void;
  onDeleteCurrentCircuit: () => void;
  onOpenTruthTable?: () => void;
  onOpenOscilloscope?: () => void;
  onOpenUsage?: () => void;
  onOpenReport?: () => void;
  onToggleSimulation: () => void;
  onStepSimulation: () => void;
  onStopSimulation: () => void;
  isCleanUpVisualizationEnabled?: boolean;
  onToggleCleanUpVisualization?: () => void;
  onOpenSearch?: () => void;
  onOpenOptions: () => void;
  onOpenPrivacy?: () => void;
  onOpenHelp: () => void;
  onOpenByoSidecar?: () => void;
  onOpenSidecarDownload?: () => void;
  isCollabDisabled?: boolean;
  isCollabInSession?: boolean;
  isCollabHost?: boolean;
  isCollabReadOnly?: boolean;
  isCollabNonHost?: boolean;
  isCollabParticipantsPanelOpen?: boolean;
  onStartCollabSession?: () => void;
  onJoinCollabSession?: () => void;
  onToggleCollabParticipantsPanel?: () => void;
  onEndOrLeaveCollabSession?: () => void;
};

// Strukturiertes Hamburger-Hauptmenü mit Untermenüs für Datei, Bearbeiten, Schaltung, Ansicht und Hilfe
const MainMenu = styled(({
  isOpen,
  initialCategory = "file",
  anchorRef,
  isSimulating,
  isPaused,
  isRunning,
  canUndo,
  canRedo,
  hasSelection,
  hasSymbolSelection,
  hasCircuitElements = false,
  canPaste = false,
  canDeleteCurrentCircuit,
  canOpenTruthTable = false,
  canOpenOscilloscope = false,
  canExportHdl = false,
  deleteCircuitDisabledReason,
  onClose,
  onNewProject,
  onLoadDemo,
  onImportProject,
  onSaveProject,
  onSaveProjectAs,
  onExportDesktopXml,
  onExportHdl,
  onExportImage,
  onOpenProjectSettings,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onCopyForDesktop,
  onPaste,
  onSelectAll,
  onDeleteSelected,
  onRotateRight,
  onRotateLeft,
  onEditCurrentCircuit,
  onCreateCircuit,
  onDeleteCurrentCircuit,
  onOpenTruthTable,
  onOpenOscilloscope,
  onOpenUsage,
  onOpenReport,
  onToggleSimulation,
  onStepSimulation,
  onStopSimulation,
  isCleanUpVisualizationEnabled = false,
  onToggleCleanUpVisualization,
  onOpenSearch,
  onOpenOptions,
  onOpenPrivacy,
  onOpenHelp,
  onOpenByoSidecar,
  onOpenSidecarDownload,
  isCollabDisabled,
  isCollabInSession = false,
  isCollabHost = false,
  isCollabReadOnly = false,
  isCollabNonHost = false,
  isCollabParticipantsPanelOpen = false,
  onStartCollabSession,
  onJoinCollabSession,
  onToggleCollabParticipantsPanel,
  onEndOrLeaveCollabSession,
  ...other
}: MainMenuProps) => {
  const { t } = useTranslation();
  const effectiveCollabDisabled = isCollabDisabled ?? isCollabDisabledByEnv();
  const [activeCategory, setActiveCategory] = React.useState<MainMenuCategoryId>(initialCategory);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const categoryButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const itemButtonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  // Setzt die aktive Kategorie beim erneuten Öffnen auf die Startkategorie zurück
  React.useEffect(
    () => {
      if (isOpen) {
        setActiveCategory(initialCategory);
      }
    },
    [initialCategory, isOpen],
  );

  // Schließt das Menü bei Escape oder Klick außerhalb von Menü und Hamburger-Button
  React.useEffect(
    () => {
      if (!isOpen) {
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          anchorRef?.current?.focus();
        }
      };

      const handleMouseDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (!target) {
          return;
        }
        if (menuRef.current?.contains(target) || anchorRef?.current?.contains(target)) {
          return;
        }
        onClose();
      };

      window.addEventListener("keydown", handleKeyDown, { capture: true });
      document.addEventListener("mousedown", handleMouseDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown, { capture: true });
        document.removeEventListener("mousedown", handleMouseDown);
      };
    },
    [
      anchorRef,
      isOpen,
      onClose,
    ],
  );

  const categories = React.useMemo<MainMenuCategory[]>(
    () => {
      const simToggleLabel = isRunning
        ? t("menu.simToggle.pause")
        : isPaused
          ? t("menu.simToggle.resume")
          : t("menu.simToggle.start");

      const deleteCircuitTooltip = !canDeleteCurrentCircuit
        ? (deleteCircuitDisabledReason ?? t("menu.deleteCircuitFallbackDisabled"))
        : isSimulating
          ? t("menu.disabledWhileSimulating")
          : isCollabReadOnly
            ? t("collabSync.guestReadOnlyTooltip")
            : t("menu.deleteCircuitTooltip");

      const replaceProjectDisabled = isSimulating || isCollabNonHost;
      const replaceProjectTooltip = (defaultKey: string) =>
        isSimulating
          ? t("menu.disabledWhileSimulating")
          : isCollabNonHost
            ? t("collabSync.hostOnlyProjectActionTooltip")
            : t(defaultKey);

      return [
        {
          id: "file",
          label: t("menu.categories.file"),
          items: [
            {
              id: "file-new",
              label: t("menu.items.fileNew"),
              disabled: replaceProjectDisabled,
              tooltip: replaceProjectTooltip("menu.items.fileNewTooltip"),
              onSelect: onNewProject,
            },
            {
              id: "file-demo",
              label: t("menu.items.fileDemo"),
              disabled: replaceProjectDisabled,
              tooltip: replaceProjectTooltip("menu.items.fileDemoTooltip"),
              onSelect: onLoadDemo,
            },
            {
              id: "file-import",
              label: t("menu.items.fileImport"),
              disabled: replaceProjectDisabled,
              tooltip: replaceProjectTooltip("menu.items.fileImportTooltip"),
              onSelect: onImportProject,
            },
            {
              id: "file-save",
              label: t("menu.items.fileSave"),
              shortcut: t("menu.shortcuts.save"),
              separatorBefore: true,
              tooltip: t("menu.items.fileSaveTooltip"),
              onSelect: onSaveProject,
            },
            {
              id: "file-save-as",
              label: t("menu.items.fileSaveAs"),
              tooltip: t("menu.items.fileSaveAsTooltip"),
              onSelect: onSaveProjectAs,
            },
            {
              id: "file-export-desktop",
              label: t("menu.items.fileExportDesktop"),
              separatorBefore: true,
              disabled: !onExportDesktopXml,
              tooltip: t("menu.items.fileExportDesktopTooltip"),
              onSelect: onExportDesktopXml,
            },
            {
              id: "file-export-hdl",
              label: t("menu.items.fileExportHdl"),
              disabled: !canExportHdl || !onExportHdl,
              tooltip: !canExportHdl
                ? t("menu.items.fileExportHdlDisabledTooltip")
                : t("menu.items.fileExportHdlTooltip"),
              onSelect: onExportHdl,
            },
            {
              id: "file-export-image",
              label: t("menu.items.fileExportImage"),
              separatorBefore: false,
              tooltip: t("menu.items.fileExportImageTooltip"),
              onSelect: onExportImage,
            },
            {
              id: "file-project-settings",
              label: t("menu.items.fileProjectSettings"),
              disabled: isSimulating || isCollabReadOnly,
              tooltip: isSimulating
                ? t("menu.disabledWhileSimulating")
                : isCollabReadOnly
                  ? t("collabSync.guestReadOnlyTooltip")
                  : t("menu.items.fileProjectSettingsTooltip"),
              onSelect: onOpenProjectSettings,
            },
            ...(!effectiveCollabDisabled
              ? isCollabInSession
                ? [
                  {
                    id: "file-collab-panel",
                    label: t("menu.items.fileCollabPanel"),
                    checked: isCollabParticipantsPanelOpen,
                    separatorBefore: true,
                    tooltip: t("menu.items.fileCollabPanelTooltip"),
                    onSelect: onToggleCollabParticipantsPanel,
                  },
                  {
                    id: "file-collab-end-leave",
                    label: isCollabHost
                      ? t("menu.items.fileCollabEndHost")
                      : t("menu.items.fileCollabLeavePeer"),
                    tooltip: isCollabHost
                      ? t("menu.items.fileCollabEndHostTooltip")
                      : t("menu.items.fileCollabLeavePeerTooltip"),
                    onSelect: onEndOrLeaveCollabSession,
                  },
                ]
                : [
                  {
                    id: "file-collab-start",
                    label: t("menu.items.fileCollabStart"),
                    separatorBefore: true,
                    disabled: !onStartCollabSession,
                    tooltip: t("menu.items.fileCollabStartTooltip"),
                    onSelect: onStartCollabSession,
                  },
                  {
                    id: "file-collab-join",
                    label: t("menu.items.fileCollabJoin"),
                    disabled: !onJoinCollabSession,
                    tooltip: t("menu.items.fileCollabJoinTooltip"),
                    onSelect: onJoinCollabSession,
                  },
                ]
              : []),
          ],
        },
        {
          id: "edit",
          label: t("menu.categories.edit"),
          items: [
            {
              id: "edit-undo",
              label: t("menu.items.editUndo"),
              shortcut: t("menu.shortcuts.undo"),
              disabled: isSimulating || isCollabReadOnly || !canUndo,
              tooltip: isCollabReadOnly
                ? t("collabSync.guestReadOnlyTooltip")
                : !canUndo
                  ? t("menu.items.editUndoDisabledTooltip")
                  : undefined,
              onSelect: onUndo,
            },
            {
              id: "edit-redo",
              label: t("menu.items.editRedo"),
              shortcut: t("menu.shortcuts.redo"),
              disabled: isSimulating || isCollabReadOnly || !canRedo,
              tooltip: isCollabReadOnly
                ? t("collabSync.guestReadOnlyTooltip")
                : !canRedo
                  ? t("menu.items.editRedoDisabledTooltip")
                  : undefined,
              onSelect: onRedo,
            },
            {
              id: "edit-cut",
              label: t("menu.items.editCut"),
              shortcut: t("menu.shortcuts.cut"),
              separatorBefore: true,
              disabled: isSimulating || isCollabReadOnly || !hasSelection || !onCut,
              tooltip: isCollabReadOnly
                ? t("collabSync.guestReadOnlyTooltip")
                : !hasSelection
                  ? t("menu.items.editDisabledNoSelection")
                  : undefined,
              onSelect: onCut,
            },
            {
              id: "edit-copy",
              label: t("menu.items.editCopy"),
              shortcut: t("menu.shortcuts.copy"),
              disabled: isSimulating || !hasSelection || !onCopy,
              tooltip: !hasSelection ? t("menu.items.editDisabledNoSelection") : undefined,
              onSelect: onCopy,
            },
            {
              id: "edit-copy-desktop",
              label: t("menu.items.editCopyDesktop"),
              disabled: isSimulating || !hasSelection || !onCopyForDesktop,
              tooltip: !hasSelection
                ? t("menu.items.editDisabledNoSelection")
                : t("menu.items.editCopyDesktopTooltip"),
              onSelect: onCopyForDesktop,
            },
            {
              id: "edit-paste",
              label: t("menu.items.editPaste"),
              shortcut: t("menu.shortcuts.paste"),
              disabled: isSimulating || isCollabReadOnly || !canPaste || !onPaste,
              tooltip: isCollabReadOnly
                ? t("collabSync.guestReadOnlyTooltip")
                : !canPaste
                  ? t("menu.items.editDisabledEmptyClipboard")
                  : undefined,
              onSelect: onPaste,
            },
            {
              id: "edit-delete",
              label: t("menu.items.editDelete"),
              shortcut: t("menu.shortcuts.delete"),
              separatorBefore: true,
              disabled: isSimulating || isCollabReadOnly || !hasSelection,
              tooltip: isCollabReadOnly
                ? t("collabSync.guestReadOnlyTooltip")
                : !hasSelection
                  ? t("menu.items.editDisabledNoSelection")
                  : undefined,
              onSelect: onDeleteSelected,
            },
            {
              id: "edit-select-all",
              label: t("menu.items.editSelectAll"),
              shortcut: t("menu.shortcuts.selectAll"),
              disabled: !hasCircuitElements || !onSelectAll,
              tooltip: !hasCircuitElements ? t("menu.items.editDisabledNoElements") : undefined,
              onSelect: onSelectAll,
            },
            {
              id: "edit-rotate-right",
              label: t("menu.items.editRotateRight"),
              shortcut: t("menu.shortcuts.rotateRight"),
              separatorBefore: true,
              disabled: isSimulating || isCollabReadOnly || !hasSymbolSelection,
              tooltip: isCollabReadOnly
                ? t("collabSync.guestReadOnlyTooltip")
                : !hasSymbolSelection
                  ? t("menu.items.editDisabledNoSymbolSelection")
                  : undefined,
              onSelect: onRotateRight,
            },
            {
              id: "edit-rotate-left",
              label: t("menu.items.editRotateLeft"),
              shortcut: t("menu.shortcuts.rotateLeft"),
              disabled: isSimulating || isCollabReadOnly || !hasSymbolSelection,
              tooltip: isCollabReadOnly
                ? t("collabSync.guestReadOnlyTooltip")
                : !hasSymbolSelection
                  ? t("menu.items.editDisabledNoSymbolSelection")
                  : undefined,
              onSelect: onRotateLeft,
            },
          ],
        },
        {
          id: "circuit",
          label: t("menu.categories.circuit"),
          items: [
            {
              id: "circuit-edit",
              label: t("menu.items.circuitEdit"),
              shortcut: t("menu.shortcuts.properties"),
              disabled: isSimulating,
              onSelect: onEditCurrentCircuit,
            },
            {
              id: "circuit-new",
              label: t("menu.items.circuitNew"),
              disabled: isSimulating || isCollabReadOnly,
              tooltip: isCollabReadOnly ? t("collabSync.guestReadOnlyTooltip") : undefined,
              onSelect: onCreateCircuit,
            },
            {
              id: "circuit-delete",
              label: t("menu.items.circuitDelete"),
              disabled: isSimulating || isCollabReadOnly || !canDeleteCurrentCircuit,
              tooltip: deleteCircuitTooltip,
              onSelect: onDeleteCurrentCircuit,
            },
            {
              id: "circuit-truth-table",
              label: t("menu.items.circuitTruthTable"),
              shortcut: t("menu.shortcuts.truthTable"),
              separatorBefore: true,
              disabled: !canOpenTruthTable || !onOpenTruthTable,
              tooltip: !canOpenTruthTable
                ? t("menu.items.circuitTruthTableDisabledTooltip")
                : t("menu.items.circuitTruthTableTooltip"),
              onSelect: onOpenTruthTable,
            },
            {
              id: "circuit-oscilloscope",
              label: t("menu.items.circuitOscilloscope"),
              shortcut: t("menu.shortcuts.oscilloscope"),
              disabled: !canOpenOscilloscope || !onOpenOscilloscope,
              tooltip: !canOpenOscilloscope
                ? t("menu.items.circuitOscilloscopeDisabledTooltip")
                : t("menu.items.circuitOscilloscopeTooltip"),
              onSelect: onOpenOscilloscope,
            },
            {
              id: "circuit-usage",
              label: t("menu.items.circuitUsage"),
              tooltip: t("menu.items.circuitUsageTooltip"),
              onSelect: onOpenUsage,
            },
            {
              id: "circuit-report",
              label: t("menu.items.circuitReport"),
              tooltip: t("menu.items.circuitReportTooltip"),
              onSelect: onOpenReport,
            },
            {
              id: "circuit-sim-toggle",
              label: simToggleLabel,
              shortcut: t("menu.shortcuts.simToggle"),
              separatorBefore: true,
              onSelect: onToggleSimulation,
            },
            {
              id: "circuit-sim-step",
              label: t("menu.items.circuitSimStep"),
              shortcut: t("menu.shortcuts.simStep"),
              onSelect: onStepSimulation,
            },
            {
              id: "circuit-sim-stop",
              label: t("menu.items.circuitSimStop"),
              shortcut: t("menu.shortcuts.simStop"),
              disabled: !isSimulating,
              onSelect: onStopSimulation,
            },
          ],
        },
        {
          id: "view",
          label: t("menu.categories.view"),
          items: [
            {
              id: "view-cleanup",
              label: t("menu.items.viewCleanUp"),
              checked: isCleanUpVisualizationEnabled,
              disabled: !onToggleCleanUpVisualization,
              tooltip: isSimulating
                ? t("menu.items.viewCleanUpSimTooltip")
                : t("menu.items.viewCleanUpEditTooltip"),
              onSelect: onToggleCleanUpVisualization,
            },
            {
              id: "view-search",
              label: t("menu.items.viewSearch"),
              shortcut: t("menu.shortcuts.search"),
              disabled: isSimulating || !onOpenSearch,
              tooltip: isSimulating
                ? t("menu.disabledWhileSimulating")
                : t("menu.items.viewSearchTooltip"),
              onSelect: onOpenSearch,
            },
            {
              id: "view-options",
              label: t("menu.items.viewOptions"),
              separatorBefore: true,
              tooltip: t("menu.items.viewOptionsTooltip"),
              onSelect: onOpenOptions,
            },
          ],
        },
        {
          id: "help",
          label: t("menu.categories.help"),
          items: [
            {
              id: "help-privacy",
              label: t("menu.items.helpPrivacy"),
              tooltip: t("menu.items.helpPrivacyTooltip"),
              onSelect: onOpenPrivacy,
            },
            {
              id: "help-shortcuts",
              label: t("menu.items.helpShortcuts"),
              onSelect: onOpenHelp,
            },
            {
              id: "help-byo-sidecar",
              label: t("menu.items.helpByoSidecar"),
              separatorBefore: true,
              disabled: !onOpenByoSidecar,
              tooltip: t("menu.items.helpByoSidecarTooltip"),
              onSelect: onOpenByoSidecar,
            },
            {
              id: "help-download-sidecar",
              label: t("menu.items.helpDownloadSidecar"),
              disabled: !onOpenSidecarDownload,
              tooltip: t("menu.items.helpDownloadSidecarTooltip"),
              onSelect: onOpenSidecarDownload,
            },
          ],
        },
      ];
    },
    [
      canDeleteCurrentCircuit,
      canExportHdl,
      canOpenOscilloscope,
      canOpenTruthTable,
      canPaste,
      canRedo,
      canUndo,
      deleteCircuitDisabledReason,
      effectiveCollabDisabled,
      hasCircuitElements,
      hasSelection,
      hasSymbolSelection,
      isCleanUpVisualizationEnabled,
      isCollabHost,
      isCollabInSession,
      isCollabNonHost,
      isCollabParticipantsPanelOpen,
      isCollabReadOnly,
      isPaused,
      isRunning,
      isSimulating,
      onCopy,
      onCopyForDesktop,
      onCreateCircuit,
      onCut,
      onDeleteCurrentCircuit,
      onDeleteSelected,
      onEditCurrentCircuit,
      onEndOrLeaveCollabSession,
      onExportDesktopXml,
      onExportHdl,
      onExportImage,
      onImportProject,
      onJoinCollabSession,
      onLoadDemo,
      onNewProject,
      onOpenByoSidecar,
      onOpenHelp,
      onOpenOptions,
      onOpenOscilloscope,
      onOpenPrivacy,
      onOpenProjectSettings,
      onOpenReport,
      onOpenSearch,
      onOpenSidecarDownload,
      onOpenTruthTable,
      onOpenUsage,
      onPaste,
      onRedo,
      onRotateLeft,
      onRotateRight,
      onSaveProject,
      onSaveProjectAs,
      onSelectAll,
      onStartCollabSession,
      onStepSimulation,
      onStopSimulation,
      onToggleCleanUpVisualization,
      onToggleCollabParticipantsPanel,
      onToggleSimulation,
      onUndo,
      t,
    ],
  );

  const selectedCategory = categories.find((cat) => cat.id === activeCategory) ?? categories[0];

  const handleCategoryKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, catIndex: number, category: MainMenuCategory) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextCategory = categories[(catIndex + 1) % categories.length];
        setActiveCategory(nextCategory.id);
        categoryButtonRefs.current[nextCategory.id]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevCategory = categories[(catIndex - 1 + categories.length) % categories.length];
        setActiveCategory(prevCategory.id);
        categoryButtonRefs.current[prevCategory.id]?.focus();
      } else if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActiveCategory(category.id);
        const firstEnabled = category.items.find((item) => !item.disabled);
        const targetId = firstEnabled?.id ?? category.items[0]?.id;
        if (targetId) {
          requestAnimationFrame(() => itemButtonRefs.current[targetId]?.focus());
        }
      }
    },
    [categories],
  );

  const handleItemKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, itemIndex: number, items: MainMenuItem[]) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextItem = items[(itemIndex + 1) % items.length];
        itemButtonRefs.current[nextItem.id]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevItem = items[(itemIndex - 1 + items.length) % items.length];
        itemButtonRefs.current[prevItem.id]?.focus();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        categoryButtonRefs.current[activeCategory]?.focus();
      }
    },
    [activeCategory],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      {...other}
      ref={menuRef}
      data-component="MainMenu"
      role="menu"
      aria-label={t("menu.ariaLabel")}
    >
      <div className="category-column" role="presentation">
        {categories.map((cat, idx) => {
          const isCatActive = cat.id === selectedCategory.id;
          return (
            <button
              key={cat.id}
              ref={(el) => {
                categoryButtonRefs.current[cat.id] = el;
              }}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isCatActive}
              className={`category-button${isCatActive ? " active" : ""}`}
              onMouseEnter={() => setActiveCategory(cat.id)}
              onClick={() => setActiveCategory(cat.id)}
              onKeyDown={(e) => handleCategoryKeyDown(e, idx, cat)}
            >
              <span className="category-label">{cat.label}</span>
              <span className="category-arrow" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>

      <div
        className="submenu-column"
        role="menu"
        aria-label={selectedCategory.label}
      >
        <div className="submenu-header">{selectedCategory.label}</div>
        {selectedCategory.items.map((item, idx) => (
          <React.Fragment key={item.id}>
            {item.separatorBefore && <div className="menu-separator" role="separator" />}
            <button
              ref={(el) => {
                itemButtonRefs.current[item.id] = el;
              }}
              type="button"
              role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
              aria-checked={item.checked !== undefined ? item.checked : undefined}
              aria-disabled={item.disabled ? "true" : undefined}
              disabled={item.disabled}
              title={item.tooltip}
              className={`submenu-item${item.disabled ? " disabled" : ""}${item.checked ? " checked" : ""}`}
              onClick={() => {
                if (item.disabled) {
                  return;
                }
                onClose();
                item.onSelect?.();
              }}
              onKeyDown={(e) => handleItemKeyDown(e, idx, selectedCategory.items)}
            >
              <span className="item-label">
                {item.checked !== undefined && (
                  <span className="item-check" aria-hidden="true">
                    {item.checked ? "✓" : ""}
                  </span>
                )}
                <span>{item.label}</span>
              </span>
              {item.shortcut && <span className="item-shortcut">{item.shortcut}</span>}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
})({
  position: "absolute",
  top: "calc(100% + 0.35rem)",
  left: "0.5rem",
  zIndex: 900,
  display: "flex",
  flexDirection: "row",
  alignItems: "stretch",
  backgroundColor: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.45rem",
  boxShadow: "0 0.75rem 2rem rgba(0, 0, 0, 0.55)",
  overflow: "hidden",
  minWidth: "28rem",

  "& > .category-column": {
    display: "flex",
    flexDirection: "column",
    padding: "0.35rem",
    gap: "0.15rem",
    minWidth: "11.5rem",
    backgroundColor: "var(--color-bg-elevated)",
    borderRight: "1px solid var(--color-border-subtle)",

    "& > .category-button": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "0.5rem",
      width: "100%",
      padding: "0.45rem 0.65rem",
      background: "transparent",
      border: "none",
      borderRadius: "0.3rem",
      color: "var(--color-text-secondary)",
      fontSize: "0.84rem",
      fontWeight: 500,
      textAlign: "left",
      cursor: "pointer",
      transition: "background-color 0.12s ease, color 0.12s ease",

      "&:hover, &:focus-visible": {
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
        outline: "none",
      },

      "&.active": {
        backgroundColor: "var(--color-accent-primary-bg)",
        color: "var(--color-text-primary)",
        fontWeight: 600,
      },

      "& > .category-arrow": {
        fontSize: "0.95rem",
        opacity: 0.75,
      },
    },
  },

  "& > .submenu-column": {
    display: "flex",
    flexDirection: "column",
    padding: "0.35rem",
    gap: "0.1rem",
    minWidth: "17.5rem",
    flex: 1,

    "& > .submenu-header": {
      padding: "0.25rem 0.6rem 0.35rem",
      fontSize: "0.72rem",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      color: "var(--color-text-muted)",
    },

    "& > .menu-separator": {
      height: "1px",
      margin: "0.25rem 0.4rem",
      backgroundColor: "var(--color-border-subtle)",
    },

    "& > .submenu-item": {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "1rem",
      width: "100%",
      padding: "0.42rem 0.65rem",
      background: "transparent",
      border: "none",
      borderRadius: "0.3rem",
      color: "var(--color-text-primary)",
      fontSize: "0.84rem",
      textAlign: "left",
      cursor: "pointer",
      transition: "background-color 0.12s ease, color 0.12s ease",

      "&:hover:not(:disabled), &:focus-visible:not(:disabled)": {
        backgroundColor: "var(--color-bg-elevated)",
        outline: "none",
      },

      "&.disabled, &:disabled": {
        color: "var(--color-text-muted)",
        opacity: 0.5,
        cursor: "not-allowed",
      },

      "& > .item-label": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",

        "& > .item-check": {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "0.9rem",
          color: "var(--color-accent-primary)",
          fontWeight: 700,
        },
      },

      "& > .item-shortcut": {
        fontFamily: "var(--font-family-mono)",
        fontSize: "0.74rem",
        color: "var(--color-text-muted)",
        flexShrink: 0,
      },
    },
  },
});

export default MainMenu;
