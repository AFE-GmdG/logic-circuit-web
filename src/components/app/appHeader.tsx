import React from "react";

import styled from "@emotion/styled";
import { useTranslation } from "react-i18next";

import CanvasContext from "../../contexts/canvasContext";
import CircuitContext from "../../contexts/circuitContext";
import SimulationContext from "../../contexts/simulationContext";

import { getCircuitDeletionBlockReason } from "../../utils/circuitManagement";
import {
  getDefaultDirectoryHandle,
  getSaveDesktopXmlPickerTypes,
  isFileSystemAccessSupported,
  openProjectFileWithPicker,
  saveProjectFileWithFileSystem,
} from "../../utils/fileSystemStorage";
import {
  buildNativeProjectFileName,
  downloadNativeProject,
  serializeNativeProject,
} from "../../utils/storage/nativeProjectWriter";
import {
  isSupportedProjectFile,
  readProjectFileText,
} from "../../utils/storage/projectFileUtils";
import {
  analyzeDesktopExportCompatibility,
  type DesktopExportWarning,
} from "../../utils/xml/desktopExportCompatibility";
import {
  buildDesktopProjectFileName,
  downloadDesktopProjectXml,
  serializeCircuitProjectToXml,
} from "../../utils/xml/logicCircuitXmlWriter";

import PropertyDialog from "../propertyDialog";
import ConfirmDialog from "./confirmDialog";
import ExportImageDialog from "./exportImageDialog";
import HelpDialog from "./helpDialog";
import MainMenu from "./mainMenu";
import OptionsDialog from "./optionsDialog";
import PrivacyDialog from "./privacyDialog";
import ProjectDialog from "./projectDialog";

type AppHeaderProps = React.ComponentPropsWithoutRef<"header">;

const AppHeader = styled(({ ...other }: AppHeaderProps) => {
  const { t } = useTranslation();
  const appVersion = `v${process.env.VERSION}`;

  const simulationContext = React.useContext(SimulationContext);
  const { isSimulating, isPaused, isRunning } = simulationContext;
  const canvasContext = React.useContext(CanvasContext);
  const circuitContext = React.useContext(CircuitContext);
  const currentCircuit = circuitContext?.currentCircuit;
  const canUndo = circuitContext?.canUndo ?? false;
  const canRedo = circuitContext?.canRedo ?? false;
  const historyCount = circuitContext?.history?.entries.length ?? 0;

  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [isEditingCircuit, setIsEditingCircuit] = React.useState(false);
  const [isCreatingCircuit, setIsCreatingCircuit] = React.useState(false);
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = React.useState(false);
  const [isExportImageOpen, setIsExportImageOpen] = React.useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = React.useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = React.useState(false);
  const [isHelpOpen, setIsHelpOpen] = React.useState(false);
  const [confirmKind, setConfirmKind] = React.useState<
    "new-project" | "demo-project" | "import-project" | "delete-circuit" | null
  >(null);
  const [desktopExportWarnings, setDesktopExportWarnings] = React.useState<DesktopExportWarning[] | null>(null);
  const [importError, setImportError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const hamburgerButtonRef = React.useRef<HTMLButtonElement | null>(null);

  // Schließt Bearbeitungsdialoge und offenes Menü beim Start der Simulation (Bildexport bleibt verfügbar)
  React.useEffect(
    () => {
      if (isSimulating) {
        setIsEditingCircuit(false);
        setIsCreatingCircuit(false);
        setIsProjectSettingsOpen(false);
        setIsMenuOpen(false);
      }
    },
    [isSimulating],
  );

  const hasUnsavedChanges = circuitContext?.hasUnsavedChanges ?? false;

  const deleteCircuitDisabledReason = React.useMemo(
    () => getCircuitDeletionBlockReason(circuitContext?.project, currentCircuit?.logicalCircuitId),
    [circuitContext?.project, currentCircuit?.logicalCircuitId],
  );

  const canDeleteCurrentCircuit = deleteCircuitDisabledReason === null;

  const handleOpenProjectFromSystem = React.useCallback(
    async () => {
      if (isSimulating || !circuitContext?.importProjectFromText) {
        return;
      }

      if (!isFileSystemAccessSupported()) {
        fileInputRef.current?.click();
        return;
      }

      try {
        const defaultDir = await getDefaultDirectoryHandle();
        const result = await openProjectFileWithPicker(defaultDir?.handle ?? null);
        if (result.kind === "opened") {
          circuitContext.importProjectFromText(result.content, {
            handle: result.handle,
            fileName: result.fileName,
          });
          setImportError(null);
          return;
        }
        if (result.kind === "unsupported") {
          fileInputRef.current?.click();
        }
      } catch (err) {
        setImportError(
          err instanceof Error
            ? err.message
            : t("header.errors.loadFailed"),
        );
      }
    },
    [
      circuitContext,
      isSimulating,
      t,
    ],
  );

  const handleRequestImportProject = React.useCallback(
    () => {
      if (isSimulating) {
        return;
      }
      if (hasUnsavedChanges) {
        setConfirmKind("import-project");
      } else {
        void handleOpenProjectFromSystem();
      }
    },
    [
      handleOpenProjectFromSystem,
      hasUnsavedChanges,
      isSimulating,
    ],
  );

  const handleRequestNewProject = React.useCallback(
    () => {
      if (isSimulating) {
        return;
      }
      if (hasUnsavedChanges) {
        setConfirmKind("new-project");
      } else {
        circuitContext?.resetToEmptyProject();
        setImportError(null);
      }
    },
    [
      circuitContext,
      hasUnsavedChanges,
      isSimulating,
    ],
  );

  const handleRequestLoadDemo = React.useCallback(
    () => {
      if (isSimulating) {
        return;
      }
      if (hasUnsavedChanges) {
        setConfirmKind("demo-project");
      } else {
        circuitContext?.resetToDemoProject();
        setImportError(null);
      }
    },
    [
      circuitContext,
      hasUnsavedChanges,
      isSimulating,
    ],
  );

  const handleRequestDeleteCurrentCircuit = React.useCallback(
    () => {
      if (isSimulating || !canDeleteCurrentCircuit || !currentCircuit) {
        return;
      }
      setConfirmKind("delete-circuit");
    },
    [
      canDeleteCurrentCircuit,
      currentCircuit,
      isSimulating,
    ],
  );

  const handleConfirmAction = React.useCallback(
    () => {
      const kind = confirmKind;
      setConfirmKind(null);
      if (!kind) {
        return;
      }

      if (kind === "new-project") {
        circuitContext?.resetToEmptyProject();
        setImportError(null);
      } else if (kind === "demo-project") {
        circuitContext?.resetToDemoProject();
        setImportError(null);
      } else if (kind === "import-project") {
        void handleOpenProjectFromSystem();
      } else if (kind === "delete-circuit" && currentCircuit) {
        try {
          circuitContext?.deleteCircuits([currentCircuit.logicalCircuitId]);
          setImportError(null);
        } catch (err) {
          setImportError(
            err instanceof Error ? err.message : t("header.errors.deleteCircuitFailed"),
          );
        }
      }
    },
    [
      circuitContext,
      confirmKind,
      currentCircuit,
      handleOpenProjectFromSystem,
      t,
    ],
  );

  const handleImportFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !circuitContext?.importProjectFromText) {
        return;
      }

      if (!isSupportedProjectFile(file.name)) {
        setImportError(t("header.errors.invalidProjectFileType"));
        return;
      }

      try {
        const content = await readProjectFileText(file);
        circuitContext.importProjectFromText(content, { fileName: file.name });
        setImportError(null);
      } catch (err) {
        setImportError(
          err instanceof Error
            ? err.message
            : t("header.errors.loadFailed"),
        );
      }
    },
    [circuitContext, t],
  );

  const getProjectForExport = React.useCallback(
    () => {
      if (!circuitContext?.project) {
        return null;
      }
      const activeCircuitId = circuitContext.currentCircuitId;
      const baseProject = circuitContext.project;
      if (activeCircuitId && baseProject.project.logicalCircuitId !== activeCircuitId) {
        return {
          ...baseProject,
          project: {
            ...baseProject.project,
            logicalCircuitId: activeCircuitId,
          },
        };
      }
      return baseProject;
    },
    [circuitContext],
  );

  const handleSaveProjectWithMode = React.useCallback(
    async (forceSaveAs: boolean) => {
      // Laufende persistente RAMs (onStart === "data") vor dem Export aus dem Worker zurückschreiben
      if (simulationContext.isSimulating) {
        await simulationContext.flushPersistentMemories();
      }

      const projectToSave = getProjectForExport();
      if (!circuitContext || !projectToSave) {
        return;
      }

      if (!isFileSystemAccessSupported()) {
        downloadNativeProject(projectToSave);
        circuitContext.markProjectSaved();
        setImportError(null);
        return;
      }

      try {
        const jsonText = serializeNativeProject(projectToSave);
        const activeName = circuitContext.activeFileName;
        const suggestedName = activeName && activeName.trim().toLowerCase().endsWith(".json")
          ? activeName
          : buildNativeProjectFileName(activeName || projectToSave.project.name);
        const defaultDir = await getDefaultDirectoryHandle();
        const saveResult = await saveProjectFileWithFileSystem(jsonText, suggestedName, {
          existingHandle: circuitContext.activeFileHandle,
          forceSaveAs,
          startInHandle: defaultDir?.handle ?? null,
        });

        if (saveResult.kind === "saved") {
          circuitContext.setActiveFileHandle(saveResult.handle, saveResult.fileName);
          circuitContext.markProjectSaved();
          setImportError(null);
        } else if (saveResult.kind === "fallback-required") {
          downloadNativeProject(projectToSave);
          circuitContext.markProjectSaved();
          setImportError(null);
        }
      } catch (err) {
        setImportError(
          err instanceof Error ? err.message : t("header.errors.saveFailed"),
        );
      }
    },
    [
      circuitContext,
      getProjectForExport,
      simulationContext,
      t,
    ],
  );

  const performExportDesktopXml = React.useCallback(
    async () => {
      if (simulationContext.isSimulating) {
        await simulationContext.flushPersistentMemories();
      }

      const projectToSave = getProjectForExport();
      if (!projectToSave) {
        return;
      }

      if (!isFileSystemAccessSupported()) {
        downloadDesktopProjectXml(projectToSave);
        setImportError(null);
        return;
      }

      try {
        const xmlText = serializeCircuitProjectToXml(projectToSave);
        const suggestedName = buildDesktopProjectFileName(projectToSave.project.name);
        const defaultDir = await getDefaultDirectoryHandle();
        const saveResult = await saveProjectFileWithFileSystem(xmlText, suggestedName, {
          existingHandle: null,
          forceSaveAs: true,
          startInHandle: defaultDir?.handle ?? null,
          types: getSaveDesktopXmlPickerTypes(),
          persistLastProject: false,
        });

        if (saveResult.kind === "saved") {
          setImportError(null);
        } else if (saveResult.kind === "fallback-required") {
          downloadDesktopProjectXml(projectToSave);
          setImportError(null);
        }
      } catch (err) {
        setImportError(
          err instanceof Error ? err.message : t("header.errors.desktopExportFailed"),
        );
      }
    },
    [
      getProjectForExport,
      simulationContext,
      t,
    ],
  );

  const handleRequestExportDesktopXml = React.useCallback(
    () => {
      const projectToSave = getProjectForExport();
      if (!projectToSave) {
        return;
      }
      const report = analyzeDesktopExportCompatibility(projectToSave);
      if (report.hasWarnings) {
        setDesktopExportWarnings(report.warnings);
        return;
      }
      void performExportDesktopXml();
    },
    [getProjectForExport, performExportDesktopXml],
  );

  const handleExportProject = React.useCallback(
    () => {
      void handleSaveProjectWithMode(false);
    },
    [handleSaveProjectWithMode],
  );

  const handleSaveProjectAs = React.useCallback(
    () => {
      void handleSaveProjectWithMode(true);
    },
    [handleSaveProjectWithMode],
  );

  // Globales Tastenkürzel Strg+S für sofortiges Speichern (auch während aktiver Simulation)
  React.useEffect(
    () => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
          event.preventDefault();
          handleExportProject();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    },
    [handleExportProject],
  );

  const handleCircuitDoubleClick = React.useCallback(
    () => {
      if (!isSimulating && currentCircuit) {
        setIsEditingCircuit(true);
      }
    },
    [currentCircuit, isSimulating],
  );

  const handleCircuitKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!isSimulating && currentCircuit && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setIsEditingCircuit(true);
      }
    },
    [currentCircuit, isSimulating],
  );

  const clearHistoryLabel = t("header.clearHistoryTooltip", { count: historyCount });

  return (
    <header {...other} data-component="AppHeader">
      <div className="left-section">
        <button
          ref={hamburgerButtonRef}
          type="button"
          className="hamburger-button"
          title={t("header.menuAriaLabel")}
          aria-label={t("header.menuAriaLabel")}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={() => {
            setIsMenuOpen((prev) => {
              const nextOpen = !prev;
              if (nextOpen) {
                void canvasContext?.refreshClipboardAvailability();
              }
              return nextOpen;
            });
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="hamburger-icon"
            aria-hidden="true"
          >
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor" />
          </svg>
        </button>

        <h1 className="app-title">Logic Circuit Web</h1>
        <span className="app-version">{appVersion}</span>
      </div>

      <div className="center-section">
        {currentCircuit && (
          <div
            className={`active-circuit-display${!isSimulating ? " editable" : ""}`}
            aria-label={t("header.activeCircuitAriaLabel")}
            data-testid="active-circuit-display"
            onDoubleClick={handleCircuitDoubleClick}
            onKeyDown={handleCircuitKeyDown}
            role={!isSimulating ? "button" : undefined}
            tabIndex={!isSimulating ? 0 : undefined}
          >
            <span
              className={`circuit-badge ${isSimulating ? "running simulating" : ""}`}
              title={
                isSimulating
                  ? t("header.activeCircuitSimTooltip", { name: currentCircuit.name })
                  : t("header.activeCircuitEditTooltip", { name: currentCircuit.name })
              }
            >
              <span className="circuit-icon">{isSimulating ? "▶" : "⚡"}</span>
              {currentCircuit.category && (
                <span className="circuit-category">{currentCircuit.category} /</span>
              )}
              <span className="circuit-name">{currentCircuit.name}</span>
            </span>
          </div>
        )}
      </div>

      <div className="right-section">
        <input
          ref={fileInputRef}
          type="file"
          accept=".lcweb,.CircuitProject,.xml,.json"
          className="file-import-input"
          data-testid="import-project-input"
          onChange={handleImportFileChange}
        />

        <div className="history-controls" role="group" aria-label={t("header.fileControlsAriaLabel")}>
          <button
            type="button"
            className="history-button"
            title={t("header.openProjectTooltip")}
            aria-label={t("header.openProjectTooltip")}
            disabled={isSimulating}
            onClick={handleRequestImportProject}
          >
            <svg viewBox="0 0 24 24" className="history-icon" aria-hidden="true">
              <path
                d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            type="button"
            className="history-button"
            title={
              circuitContext?.activeFileName
                ? t("header.saveProjectTooltipNamed", { fileName: circuitContext.activeFileName })
                : t("header.saveProjectTooltipDefault")
            }
            aria-label={t("header.saveProjectAriaLabel")}
            disabled={!circuitContext?.project}
            onClick={handleExportProject}
          >
            <svg viewBox="0 0 24 24" className="history-icon" aria-hidden="true">
              <path
                // eslint-disable-next-line max-len
                d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <div className="history-controls" role="group" aria-label={t("header.historyControlsAriaLabel")}>
          <button
            type="button"
            className="history-button"
            title={t("header.undoTooltip")}
            aria-label={t("header.undoAriaLabel")}
            disabled={!canUndo || isSimulating}
            onClick={() => circuitContext?.undo()}
          >
            <svg viewBox="0 0 24 24" className="history-icon" aria-hidden="true">
              <path
                // eslint-disable-next-line max-len
                d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            type="button"
            className="history-button"
            title={t("header.redoTooltip")}
            aria-label={t("header.redoAriaLabel")}
            disabled={!canRedo || isSimulating}
            onClick={() => circuitContext?.redo()}
          >
            <svg viewBox="0 0 24 24" className="history-icon" aria-hidden="true">
              <path
                // eslint-disable-next-line max-len
                d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            type="button"
            className="history-button clear-history-button"
            title={clearHistoryLabel}
            aria-label={clearHistoryLabel}
            disabled={historyCount === 0 || isSimulating}
            onClick={() => circuitContext?.clearHistory()}
          >
            <svg viewBox="0 0 24 24" className="history-icon" aria-hidden="true">
              <path
                d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>

      {importError && (
        <div className="import-error-banner" role="alert">
          <span className="import-error-text">{importError}</span>
          <button
            type="button"
            className="import-error-close"
            aria-label={t("header.importErrorCloseAriaLabel")}
            onClick={() => setImportError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Strukturiertes Hamburger-Hauptmenü */}
      <MainMenu
        isOpen={isMenuOpen}
        anchorRef={hamburgerButtonRef}
        isSimulating={isSimulating}
        isPaused={isPaused}
        isRunning={isRunning}
        canUndo={canUndo}
        canRedo={canRedo}
        hasSelection={
          (circuitContext?.selectedSymbolIds.length ?? 0) > 0 ||
          (circuitContext?.selectedTextNoteIds.length ?? 0) > 0 ||
          (circuitContext?.selectedWireIds.length ?? 0) > 0
        }
        hasSymbolSelection={(circuitContext?.selectedSymbolIds.length ?? 0) > 0}
        hasCircuitElements={
          (currentCircuit?.circuitSymbols.length ?? 0) > 0 ||
          (currentCircuit?.wires.length ?? 0) > 0 ||
          (currentCircuit?.textNotes.length ?? 0) > 0
        }
        canPaste={canvasContext?.hasClipboardContent ?? false}
        canDeleteCurrentCircuit={canDeleteCurrentCircuit}
        deleteCircuitDisabledReason={deleteCircuitDisabledReason ?? undefined}
        onClose={() => setIsMenuOpen(false)}
        onNewProject={handleRequestNewProject}
        onLoadDemo={handleRequestLoadDemo}
        onImportProject={handleRequestImportProject}
        onSaveProject={handleExportProject}
        onSaveProjectAs={handleSaveProjectAs}
        onExportDesktopXml={handleRequestExportDesktopXml}
        onExportImage={() => setIsExportImageOpen(true)}
        onOpenProjectSettings={() => {
          if (!isSimulating) {
            setIsProjectSettingsOpen(true);
          }
        }}
        onUndo={() => circuitContext?.undo()}
        onRedo={() => circuitContext?.redo()}
        onCut={() => {
          void canvasContext?.cutSelection();
        }}
        onCopy={() => {
          void canvasContext?.copySelection();
        }}
        onCopyForDesktop={() => {
          void canvasContext?.copySelectionForDesktop?.();
        }}
        onPaste={() => {
          void canvasContext?.pasteFromClipboard();
        }}
        onSelectAll={() => {
          canvasContext?.selectAll?.();
        }}
        onDeleteSelected={() => {
          if (!circuitContext) {
            return;
          }
          circuitContext.removeEntities(
            circuitContext.selectedSymbolIds,
            circuitContext.selectedTextNoteIds,
            circuitContext.selectedWireIds,
          );
        }}
        onRotateRight={() => circuitContext?.rotateSelectedSymbols("clockwise")}
        onRotateLeft={() => circuitContext?.rotateSelectedSymbols("counterClockwise")}
        onEditCurrentCircuit={() => {
          if (!isSimulating && currentCircuit) {
            setIsCreatingCircuit(false);
            setIsEditingCircuit(true);
          }
        }}
        onCreateCircuit={() => {
          if (!isSimulating) {
            setIsEditingCircuit(false);
            setIsCreatingCircuit(true);
          }
        }}
        onDeleteCurrentCircuit={handleRequestDeleteCurrentCircuit}
        onToggleSimulation={() => simulationContext.toggleRunning()}
        onStepSimulation={() => {
          void simulationContext.step();
        }}
        onStopSimulation={() => {
          void simulationContext.stopSimulation();
        }}
        isCleanUpVisualizationEnabled={circuitContext?.isCleanUpVisualizationEnabled ?? false}
        onToggleCleanUpVisualization={() => circuitContext?.toggleCleanUpVisualization?.()}
        onOpenSearch={() => canvasContext?.openFindBar?.()}
        onOpenOptions={() => setIsOptionsOpen(true)}
        onOpenPrivacy={() => setIsPrivacyOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      {/* Eigenschaften-Dialog zum Bearbeiten oder Neuanlegen einer Schaltung */}
      <PropertyDialog
        isOpen={isEditingCircuit || isCreatingCircuit}
        circuit={isCreatingCircuit ? null : currentCircuit}
        isCreatingCircuit={isCreatingCircuit}
        onSaveCircuit={(circuitId, updates) => {
          circuitContext?.updateCircuitProperties(circuitId, updates);
        }}
        onCreateCircuit={(input) => {
          const created = circuitContext?.createCircuits([input]);
          if (created && created[0]) {
            circuitContext?.setCurrentCircuitId(created[0].logicalCircuitId);
          }
        }}
        onClose={() => {
          setIsEditingCircuit(false);
          setIsCreatingCircuit(false);
        }}
      />

      {/* Sicherheitsabfrage für destruktive Projekt- und Schaltungsaktionen */}
      <ConfirmDialog
        isOpen={confirmKind !== null}
        title={
          confirmKind === "delete-circuit"
            ? t("header.confirmDeleteCircuitTitle")
            : confirmKind === "new-project"
              ? t("header.confirmNewProjectTitle")
              : confirmKind === "demo-project"
                ? t("header.confirmDemoProjectTitle")
                : t("header.confirmOpenProjectTitle")
        }
        message={
          confirmKind === "delete-circuit"
            ? t("header.confirmDeleteCircuitMessage", { name: currentCircuit?.name ?? "" })
            : t("header.confirmUnsavedMessage")
        }
        confirmLabel={
          confirmKind === "delete-circuit"
            ? t("common.delete")
            : t("header.confirmDiscardAndContinue")
        }
        isDanger={confirmKind === "delete-circuit"}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmKind(null)}
      />

      {/* Kompatibilitätswarnung beim Desktop-XML-Export (.CircuitProject) */}
      <ConfirmDialog
        isOpen={desktopExportWarnings !== null}
        title={t("header.desktopExportWarningTitle")}
        message={t("header.desktopExportWarningMessage")}
        details={desktopExportWarnings?.map((warning) => warning.message)}
        confirmLabel={t("header.desktopExportConfirm")}
        cancelLabel={t("common.cancel")}
        isDanger={false}
        onConfirm={() => {
          setDesktopExportWarnings(null);
          void performExportDesktopXml();
        }}
        onCancel={() => setDesktopExportWarnings(null)}
      />

      {/* Datenschutz- / GDPR-Dialog */}
      <PrivacyDialog
        isOpen={isPrivacyOpen}
        onClose={() => setIsPrivacyOpen(false)}
      />

      {/* Hilfe- und Tastaturkürzel-Dialog */}
      <HelpDialog
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />

      {/* Projekt-Einstellungen Dialog (ohne Undo-Historien-Eintrag) */}
      <ProjectDialog
        isOpen={isProjectSettingsOpen}
        onClose={() => setIsProjectSettingsOpen(false)}
      />

      {/* Bildexport-Dialog (PNG 1:1 / SVG, auch während Simulation verfügbar) */}
      <ExportImageDialog
        isOpen={isExportImageOpen}
        onClose={() => setIsExportImageOpen(false)}
      />

      {/* Systemeinstellungen-Dialog (DialogOptions) */}
      <OptionsDialog
        isOpen={isOptionsOpen}
        onClose={() => setIsOptionsOpen(false)}
      />
    </header>
  );
})({
  position: "relative",
  flex: "0 0 3rem",
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0 1rem",
  backgroundColor: "var(--color-bg-surface)",
  borderBottom: "1px solid var(--color-border-subtle)",

  "& > .left-section": {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    justifyContent: "flex-start",

    "& > .hamburger-button": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "2rem",
      height: "2rem",
      padding: 0,
      backgroundColor: "transparent",
      border: "1px solid transparent",
      borderRadius: "0.375rem",
      color: "var(--color-text-secondary)",
      cursor: "pointer",
      transition: "all 0.15s ease-in-out",

      "&:hover": {
        backgroundColor: "var(--color-bg-elevated)",
        borderColor: "var(--color-border-subtle)",
        color: "var(--color-text-primary)",
      },

      "& > .hamburger-icon": {
        width: "1.25rem",
        height: "1.25rem",
      },
    },

    "& > .app-title": {
      margin: 0,
      fontSize: "1.5rem",
      fontWeight: 600,
      lineHeight: "2rem",
      whiteSpace: "nowrap",
      color: "var(--color-text-primary)",
    },

    "& > .app-version": {
      margin: "0.2rem 0 0",
      padding: "0.15rem 0.45rem",
      borderRadius: "0.25rem",
      color: "var(--color-text-muted)",
      backgroundColor: "var(--color-bg-base)",
      border: "0.0625rem solid var(--color-border-subtle)",
      fontFamily: "monospace",
      fontSize: "0.75rem",
      lineHeight: "1rem",

      // backgroundColor: "var(--color-accent-primary-bg)",
      // color: "var(--color-accent-primary)",
      // fontWeight: 500,
    },
  },

  "& > .center-section": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    "& > .active-circuit-display": {
      display: "flex",
      alignItems: "center",
      fontSize: "0.85rem",

      "&.editable": {
        cursor: "pointer",
        userSelect: "none",

        "&:focus-visible": {
          outline: "none",

          "& > .circuit-badge": {
            borderColor: "var(--color-accent-primary)",
            boxShadow: "0 0 0 2px var(--color-accent-primary-hover)",
          },
        },

        "&:hover > .circuit-badge": {
          borderColor: "var(--color-border-strong)",
          backgroundColor: "var(--color-bg-elevated)",
        },
      },

      "& > .circuit-badge": {
        display: "inline-flex",
        alignItems: "center",
        gap: "0.2rem",
        fontWeight: 600,
        color: "var(--color-text-primary)",
        backgroundColor: "var(--color-bg-base)",
        padding: "0.4rem 0.5rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-border-subtle)",
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
        transition: "all 0.15s ease",

        "& > .circuit-category": {
          color: "var(--color-text-secondary)",
          fontWeight: 400,
        },

        "&.simulating, &.running": {
          borderColor: "var(--color-status-running)",
          backgroundColor: "var(--color-success-bg)",

          "& > .circuit-icon": {
            color: "var(--color-status-running)",
          },
        },
      },
    },
  },

  "& > .right-section": {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "0.75rem",

    "& > .file-import-input": {
      display: "none",
    },

    "& > .history-controls": {
      display: "flex",
      alignItems: "center",
      gap: "0.375rem",

      "& > .history-button": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "2rem",
        height: "2rem",
        padding: 0,
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "0.375rem",
        color: "var(--color-text-secondary)",
        cursor: "pointer",
        transition: "all 0.15s ease-in-out",

        "&:hover:not(:disabled)": {
          backgroundColor: "var(--color-bg-base)",
          borderColor: "var(--color-border-strong)",
          color: "var(--color-text-primary)",
        },

        "&:disabled": {
          opacity: 0.35,
          cursor: "not-allowed",
        },

        "& > .history-icon": {
          width: "1.125rem",
          height: "1.125rem",
        },
      },
    },
  },

  "& > .import-error-banner": {
    position: "absolute",
    top: "calc(100% + 0.5rem)",
    right: "1rem",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    maxWidth: "28rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "0.375rem",
    backgroundColor: "var(--color-bg-elevated)",
    border: "1px solid var(--color-logic-error)",
    color: "var(--color-error-text)",
    fontSize: "0.8125rem",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",

    "& > .import-error-text": {
      flex: 1,
      lineHeight: 1.4,
    },

    "& > .import-error-close": {
      background: "transparent",
      border: "none",
      color: "inherit",
      fontSize: "1rem",
      lineHeight: 1,
      cursor: "pointer",
      padding: "0 0.25rem",
    },
  },
});

export default AppHeader;
