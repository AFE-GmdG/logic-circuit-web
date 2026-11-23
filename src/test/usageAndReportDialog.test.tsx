import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import i18n from "../i18n";
import {
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createDemoCircuitProject,
  createEmptyCircuitProject,
} from "../utils/circuitLayout";
import {
  buildCircuitReport,
  findCircuitUsages,
  formatCircuitReportMarkdown,
  navigateToCircuitUsage,
} from "../utils/circuitReportBuilder";

import MainMenu from "../components/app/mainMenu";
import ReportDialog from "../components/app/reportDialog";
import UsageDialog from "../components/app/usageDialog";

const noop = () => undefined;

function createHierarchicalTestProject() {
  const project = createEmptyCircuitProject();
  project.project.name = "Hierarchie-Projekt";
  project.project.note = "Testprojekt für Verwendungsnachweis und Bericht.";

  const mainCircuit = project.logicalCircuits[0]!;
  mainCircuit.name = "Hauptschaltung";
  mainCircuit.category = "System";

  const subCircuit = createDefaultLogicalCircuit("sub-adder", "Halbaddierer");
  subCircuit.category = "Arithmetik";

  const helperCircuit = createDefaultLogicalCircuit("helper-alu", "ALU-Stufe");
  helperCircuit.category = "Arithmetik";

  const unusedCircuit = createDefaultLogicalCircuit("unused-block", "Isolierter Block");
  unusedCircuit.category = "";

  const symInMainFirst = createCircuitSymbol(subCircuit, mainCircuit.logicalCircuitId, 4, 6);
  const symInMainSecond = createCircuitSymbol(subCircuit, mainCircuit.logicalCircuitId, 12, 6);
  const symInHelper = createCircuitSymbol(subCircuit, helperCircuit.logicalCircuitId, 8, 10);

  mainCircuit.circuitSymbols.push(symInMainFirst, symInMainSecond);
  helperCircuit.circuitSymbols.push(symInHelper);

  project.logicalCircuits.push(subCircuit, helperCircuit, unusedCircuit);
  project.circuits.set(subCircuit.logicalCircuitId, subCircuit);
  project.circuits.set(helperCircuit.logicalCircuitId, helperCircuit);
  project.circuits.set(unusedCircuit.logicalCircuitId, unusedCircuit);
  project.circuitSymbols.push(symInMainFirst, symInMainSecond, symInHelper);

  return {
    project,
    mainCircuit,
    subCircuit,
    helperCircuit,
    unusedCircuit,
    symInMainFirst,
    symInMainSecond,
    symInHelper,
  };
}

describe("T-070: Verwendungsnachweis (UsageDialog) & Schaltungsbericht (ReportDialog)", () => {
  it("ermittelt alle übergeordneten Schaltungen inklusive Instanzanzahl sortiert nach Schaltungsname", () => {
    const {
      project,
      mainCircuit,
      subCircuit,
      helperCircuit,
      unusedCircuit,
      symInMainFirst,
      symInMainSecond,
      symInHelper,
    } = createHierarchicalTestProject();

    const usages = findCircuitUsages(project, subCircuit.logicalCircuitId);
    expect(usages).toHaveLength(2);

    expect(usages[0]?.parentCircuit.logicalCircuitId).toBe(helperCircuit.logicalCircuitId);
    expect(usages[0]?.count).toBe(1);
    expect(usages[0]?.symbolIds).toEqual([symInHelper.circuitSymbolId]);
    expect(usages[0]?.firstPoint).toEqual({ x: 8, y: 10 });

    expect(usages[1]?.parentCircuit.logicalCircuitId).toBe(mainCircuit.logicalCircuitId);
    expect(usages[1]?.count).toBe(2);
    expect(usages[1]?.symbolIds).toEqual([
      symInMainFirst.circuitSymbolId,
      symInMainSecond.circuitSymbolId,
    ]);
    expect(usages[1]?.firstPoint).toEqual({ x: 4, y: 6 });

    expect(findCircuitUsages(project, mainCircuit.logicalCircuitId)).toEqual([]);
    expect(findCircuitUsages(project, unusedCircuit.logicalCircuitId)).toEqual([]);
  });

  it("navigiert beim Sprung aus dem Verwendungsnachweis zur Zielschaltung, selektiert Instanzen und stoppt Simulation", () => {
    const {
      project,
      mainCircuit,
      subCircuit,
      symInMainFirst,
      symInMainSecond,
    } = createHierarchicalTestProject();
    const usages = findCircuitUsages(project, subCircuit.logicalCircuitId);
    const mainUsage = usages.find(
      (entry) => entry.parentCircuit.logicalCircuitId === mainCircuit.logicalCircuitId,
    )!;

    const stopSimulation = vi.fn();
    const setCurrentCircuitId = vi.fn();
    const selectEntities = vi.fn();
    const highlightAiElements = vi.fn();
    const focusGridPoint = vi.fn();

    navigateToCircuitUsage({
      entry: mainUsage,
      isSimulating: true,
      currentCircuitId: subCircuit.logicalCircuitId,
      stopSimulation,
      setCurrentCircuitId,
      selectEntities,
      highlightAiElements,
      focusGridPoint,
    });

    expect(stopSimulation).toHaveBeenCalledTimes(1);
    expect(setCurrentCircuitId).toHaveBeenCalledWith(mainCircuit.logicalCircuitId);
    expect(selectEntities).toHaveBeenCalledWith(
      [symInMainFirst.circuitSymbolId, symInMainSecond.circuitSymbolId],
      [],
      false,
      [],
    );
    expect(highlightAiElements).toHaveBeenCalledWith({
      symbolIds: [symInMainFirst.circuitSymbolId, symInMainSecond.circuitSymbolId],
    });
    expect(focusGridPoint).toHaveBeenCalledWith({ x: 4, y: 6 }, mainCircuit.logicalCircuitId);
  });

  it("erstellt den Schaltungsbericht mit Projektstatistik, alphabetisch sortierten Funktionen und Markdown-Ausgabe", () => {
    const demo = createDemoCircuitProject();
    const report = buildCircuitReport(demo);

    expect(report.compileError).toBeNull();
    expect(report.circuitCount).toBe(demo.logicalCircuits.length);
    expect(report.symbolCount).toBeGreaterThan(0);
    expect(report.wireCount).toBeGreaterThan(0);
    expect(report.functions.length).toBeGreaterThan(0);

    const reportNames = report.functions.map((item) => item.reportName);
    const sortedNames = [...reportNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(reportNames).toEqual(sortedNames);

    const countedSum = report.functions.reduce((sum, item) => sum + item.count, 0);
    expect(report.totalFunctions).toBe(countedSum);

    const markdown = formatCircuitReportMarkdown(report);
    expect(markdown).toContain(`# ${report.projectName}`);
    expect(markdown).toContain(`## ${i18n.t("dialog.report.statisticsTitle")}`);
    expect(markdown).toContain(`| **${i18n.t("dialog.report.totalRow")}** | **${report.totalFunctions}** |`);
    for (const item of report.functions) {
      expect(markdown).toContain(`| ${item.reportName} | ${item.count} |`);
    }
  });

  it("zählt distinkte nicht-leere Kategorien und meldet Kompilierungsfehler bei fehlerhafter Schaltung", () => {
    const { project, mainCircuit } = createHierarchicalTestProject();
    const recursiveSymbol = createCircuitSymbol(mainCircuit, mainCircuit.logicalCircuitId, 6, 6);
    mainCircuit.circuitSymbols.push(recursiveSymbol);
    project.circuitSymbols.push(recursiveSymbol);

    const report = buildCircuitReport(project, mainCircuit);
    expect(report.circuitCount).toBe(4);
    expect(report.categoryCount).toBe(2);
    expect(report.compileError).not.toBeNull();
    expect(report.compileError!.length).toBeGreaterThan(0);
    expect(report.functions).toEqual([]);
    expect(report.totalFunctions).toBe(0);

    const markdown = formatCircuitReportMarkdown(report);
    expect(markdown).toContain(i18n.t("dialog.report.compileErrorTitle"));
    expect(markdown).toContain(report.compileError!);
  });

  it("rendert UsageDialog und ReportDialog korrekt in geöffnetem und geschlossenem Zustand", () => {
    const { project, subCircuit, unusedCircuit } = createHierarchicalTestProject();

    const closedUsageHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <UsageDialog isOpen={false} targetCircuit={subCircuit} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(closedUsageHtml).not.toContain("data-component=\"UsageDialog\"");

    const closedReportHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <ReportDialog isOpen={false} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(closedReportHtml).not.toContain("data-component=\"ReportDialog\"");

    const emptyUsageHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <UsageDialog isOpen={true} targetCircuit={unusedCircuit} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(emptyUsageHtml).toContain("data-component=\"UsageDialog\"");
    expect(emptyUsageHtml).toContain("wird derzeit in keiner anderen Schaltung als Subschaltung verwendet");

    const populatedUsageHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <UsageDialog isOpen={true} targetCircuit={subCircuit} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(populatedUsageHtml).toContain("ALU-Stufe");
    expect(populatedUsageHtml).toContain("1 Instanz");
    expect(populatedUsageHtml).toContain("Hauptschaltung");
    expect(populatedUsageHtml).toContain("2 Instanzen");

    const demo = createDemoCircuitProject();
    const reportHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={demo}>
        <SimulationContextProvider>
          <ReportDialog isOpen={true} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(reportHtml).toContain("data-component=\"ReportDialog\"");
    expect(reportHtml).toContain("Projektstatistik");
    expect(reportHtml).toContain("Als Markdown kopieren");
    expect(reportHtml).toContain("Gesamtsumme");

    const emptyReportHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={project}>
        <SimulationContextProvider>
          <ReportDialog isOpen={true} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(emptyReportHtml).toContain("keine aktiven Funktionen");

    const { project: invalidProject, mainCircuit: invalidMain } = createHierarchicalTestProject();
    const invalidSelfSymbol = createCircuitSymbol(invalidMain, invalidMain.logicalCircuitId, 6, 6);
    invalidMain.circuitSymbols.push(invalidSelfSymbol);
    invalidProject.circuitSymbols.push(invalidSelfSymbol);
    const compileErrorHtml = renderToStaticMarkup(
      <CircuitContextProvider initialProject={invalidProject}>
        <SimulationContextProvider>
          <ReportDialog isOpen={true} targetCircuit={invalidMain} onClose={noop} />
        </SimulationContextProvider>
      </CircuitContextProvider>,
    );
    expect(compileErrorHtml).toContain("role=\"alert\"");
    expect(compileErrorHtml).toContain("Schaltung konnte nicht kompiliert werden");
  });

  it("zeigt Verwendungsnachweis und Schaltungsbericht im MainMenu unter Schaltung auch während Simulation an", () => {
    const html = renderToStaticMarkup(
      <MainMenu
        isOpen={true}
        initialCategory="circuit"
        isSimulating={true}
        isPaused={false}
        isRunning={true}
        canUndo={false}
        canRedo={false}
        hasSelection={false}
        hasSymbolSelection={false}
        canDeleteCurrentCircuit={false}
        onClose={noop}
        onNewProject={noop}
        onLoadDemo={noop}
        onImportProject={noop}
        onSaveProject={noop}
        onSaveProjectAs={noop}
        onExportImage={noop}
        onOpenProjectSettings={noop}
        onUndo={noop}
        onRedo={noop}
        onDeleteSelected={noop}
        onRotateRight={noop}
        onRotateLeft={noop}
        onEditCurrentCircuit={noop}
        onCreateCircuit={noop}
        onDeleteCurrentCircuit={noop}
        onOpenUsage={noop}
        onOpenReport={noop}
        onToggleSimulation={noop}
        onStepSimulation={noop}
        onStopSimulation={noop}
        onOpenOptions={noop}
        onOpenHelp={noop}
      />,
    );

    expect(html).toContain("Verwendungsnachweis...");
    expect(html).toContain("Schaltungsbericht...");
  });
});
