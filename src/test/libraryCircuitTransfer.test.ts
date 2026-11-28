import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";

import type CircuitProject from "../types/circuit/circuitProject";
import type LogicalCircuit from "../types/circuit/logicalCircuit";
import type Memory from "../types/circuit/memory";

import CircuitRunner from "../simulation/worker/circuitRunner";
import {
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createMemory,
  createPinCircuit,
  createTextNote,
} from "../utils/circuitLayout";
import {
  computeNativeCircuitStructureHash,
  computeNativeCircuitStructureHashes,
  computeProjectCircuitStructureHash,
  computeProjectCircuitStructureHashes,
} from "../utils/libraryCircuitHash";
import {
  extractProjectCircuitsAsNative,
  resolveUniqueCircuitName,
  transferLibraryCircuitToProject,
  transferProjectCircuitToLibrary,
} from "../utils/libraryCircuitTransfer";
import { createWire } from "../utils/wireUtils";

function buildPowerAndLedProject(options?: {
  ledColor?: "red" | "green";
  reverseWires?: boolean;
  withMemory?: boolean;
  memoryData?: string;
}): {
  project: CircuitProject;
  mainId: string;
  powerId: string;
  ledId: string;
} {
  const project = createEmptyCircuitProject("Demo", "Main");
  const mainLc = project.logicalCircuits[0];

  const ledLc = createDefaultLogicalCircuit(
    crypto.randomUUID(),
    "Tri State LED (Right)",
    "Display",
    "LED indicator",
  );
  const { pin: ledIn, pinCircuit: ledInCircuit } = createPinCircuit(
    crypto.randomUUID(),
    ledLc.logicalCircuitId,
    "input",
    "X0",
    1,
    "left",
    false,
    0,
  );
  const ledGate = createGate("led", 1, false, options?.ledColor ?? "green");
  const ledPinSym = createCircuitSymbol(ledInCircuit, ledLc.logicalCircuitId, 4, 4, "up");
  const ledGateSym = createCircuitSymbol(ledGate, ledLc.logicalCircuitId, 10, 4, "up");
  const ledWire = options?.reverseWires
    ? createWire(ledLc.logicalCircuitId, { x: 10, y: 5 }, { x: 6, y: 5 })
    : createWire(ledLc.logicalCircuitId, { x: 6, y: 5 }, { x: 10, y: 5 });
  ledLc.logicalPins = [ledIn];
  ledLc.circuitSymbols = options?.reverseWires
    ? [ledGateSym, ledPinSym]
    : [ledPinSym, ledGateSym];
  ledLc.wires = [ledWire];

  const powerLc = createDefaultLogicalCircuit(
    crypto.randomUUID(),
    "Power",
    "Control",
    "Power module",
  );
  const { pin: powerIn, pinCircuit: powerInCircuit } = createPinCircuit(
    crypto.randomUUID(),
    powerLc.logicalCircuitId,
    "input",
    "En",
    1,
    "left",
    false,
    0,
  );
  const { pin: powerOut, pinCircuit: powerOutCircuit } = createPinCircuit(
    crypto.randomUUID(),
    powerLc.logicalCircuitId,
    "output",
    "Q",
    1,
    "right",
    false,
    1,
  );
  const notGate = createGate("not", 1, true);
  const powerPinSym = createCircuitSymbol(powerInCircuit, powerLc.logicalCircuitId, 4, 4, "up");
  const powerNotSym = createCircuitSymbol(notGate, powerLc.logicalCircuitId, 8, 3, "up");
  const powerOutSym = createCircuitSymbol(powerOutCircuit, powerLc.logicalCircuitId, 14, 4, "up");
  const subLedSym = createCircuitSymbol(ledLc, powerLc.logicalCircuitId, 12, 8, "up");
  const powerWire1 = createWire(powerLc.logicalCircuitId, { x: 6, y: 5 }, { x: 8, y: 5 });
  const powerWire2 = createWire(powerLc.logicalCircuitId, { x: 11, y: 5 }, { x: 14, y: 5 });
  const powerNote = createTextNote(powerLc.logicalCircuitId, 2, 12, "Power note");

  powerLc.logicalPins = [powerIn, powerOut];
  powerLc.circuitSymbols = [powerPinSym, powerNotSym, powerOutSym, subLedSym];
  powerLc.wires = [powerWire1, powerWire2];
  powerLc.textNotes = [powerNote];

  project.logicalCircuits.push(powerLc, ledLc);
  project.circuits.set(powerLc.circuitId, powerLc);
  project.circuits.set(ledLc.circuitId, ledLc);
  project.circuits.set(ledInCircuit.circuitId, ledInCircuit);
  project.circuits.set(powerInCircuit.circuitId, powerInCircuit);
  project.circuits.set(powerOutCircuit.circuitId, powerOutCircuit);
  project.circuits.set(ledGate.circuitId, ledGate);
  project.circuits.set(notGate.circuitId, notGate);
  project.gates.set(ledGate.gateId, ledGate);
  project.gates.set(notGate.gateId, notGate);
  project.pins.push(ledIn, powerIn, powerOut);
  project.circuitSymbols.push(
    ledPinSym,
    ledGateSym,
    powerPinSym,
    powerNotSym,
    powerOutSym,
    subLedSym,
  );
  project.wires.push(ledWire, powerWire1, powerWire2);
  project.textNotes.push(powerNote);

  if (options?.withMemory) {
    const rom = createMemory(crypto.randomUUID(), false, 4, 4, {
      onStart: "data",
      data: options.memoryData ?? "01 02 03 04",
    });
    const romSym = createCircuitSymbol(rom, powerLc.logicalCircuitId, 18, 12, "up");
    powerLc.circuitSymbols.push(romSym);
    project.circuits.set(rom.circuitId, rom);
    project.memories.push(rom);
    project.circuitSymbols.push(romSym);
  }

  return {
    project,
    mainId: mainLc.logicalCircuitId,
    powerId: powerLc.logicalCircuitId,
    ledId: ledLc.logicalCircuitId,
  };
}

function collectAllUuidsOfCircuit(lc: LogicalCircuit): Set<string> {
  const ids = new Set<string>([lc.logicalCircuitId]);
  for (const p of lc.logicalPins) {
    ids.add(p.pinId);
  }
  for (const s of lc.circuitSymbols) {
    ids.add(s.circuitSymbolId);
    if (s.circuit.kind !== "gate" && s.circuit.kind !== "logicalCircuit") {
      ids.add(s.circuit.circuitId);
    }
  }
  for (const w of lc.wires) {
    ids.add(w.wireId);
  }
  for (const n of lc.textNotes) {
    ids.add(n.textNoteId);
  }
  return ids;
}

describe("T-081: Sub-Schaltungs-Extraktion, Struktur-Hash & Kopie-Übernahme", () => {
  it("berechnet deterministische, UUID- und reihenfolgeunabhängige Struktur-Hashes (Bottom-up)", () => {
    const p1 = buildPowerAndLedProject({ ledColor: "green", reverseWires: false });
    const p2 = buildPowerAndLedProject({ ledColor: "green", reverseWires: true });
    const p3 = buildPowerAndLedProject({ ledColor: "red", reverseWires: false });

    const h1 = computeProjectCircuitStructureHashes(p1.project);
    const h2 = computeProjectCircuitStructureHashes(p2.project);
    const h3 = computeProjectCircuitStructureHashes(p3.project);

    // Unterschiedliche UUIDs, gespiegelte Wire-Richtung und andere Symbol-Reihenfolge -> gleicher Hash
    expect(h1.get(p1.ledId)).toBe(h2.get(p2.ledId));
    expect(h1.get(p1.powerId)).toBe(h2.get(p2.powerId));

    // Abweichende Sub-Schaltung ("red" statt "green") ändert Sub-Hash UND Power-Hash
    expect(h1.get(p1.ledId)).not.toBe(h3.get(p3.ledId));
    expect(h1.get(p1.powerId)).not.toBe(h3.get(p3.powerId));

    // Name-Unabhängigkeit für Konflikt-Umbenennungen
    p2.project.logicalCircuits.find((lc) => lc.logicalCircuitId === p2.ledId)!.name =
      "Tri State LED (Right) (2)";
    const renamedHash = computeProjectCircuitStructureHash(p2.project, p2.powerId);
    expect(renamedHash).toBe(h1.get(p1.powerId));
  });

  it("löst Namenskonflikte deterministisch über nummerierte Suffixe auf", () => {
    expect(resolveUniqueCircuitName("Power", ["Main", "Adder"])).toBe("Power");
    expect(resolveUniqueCircuitName("Power", ["Main", "power"])).toBe("Power (2)");
    expect(resolveUniqueCircuitName("Power", ["Power", "Power (2)"])).toBe("Power (3)");
    expect(
      resolveUniqueCircuitName("Tri State LED (Right)", ["Tri State LED (Right)"]),
    ).toBe("Tri State LED (Right) (2)");
  });

  it("übernimmt Projekt -> Bibliothek mit Hash-Deduplizierung und Memory-Erhalt", () => {
    const p1 = buildPowerAndLedProject({
      ledColor: "green",
      withMemory: true,
      memoryData: "AA BB CC DD",
    });

    // Erstübernahme von Power in leere Bibliothek -> Power + Tri State LED (Right)
    const firstTransfer = transferProjectCircuitToLibrary(p1.project, p1.powerId, [], {
      rootMetadataOverrides: {
        name: "Power Supply",
        category: "Custom",
        note: "Angepasste Beschreibung",
      },
    });

    expect(firstTransfer.addedCircuits).toHaveLength(2);
    expect(firstTransfer.reusedCircuitIds).toHaveLength(0);
    expect(firstTransfer.logicalCircuits.map((c) => c.name)).toEqual([
      "Tri State LED (Right)",
      "Power Supply",
    ]);

    const libPower = firstTransfer.logicalCircuits.find(
      (c) => c.logicalCircuitId === firstTransfer.rootCircuitId,
    )!;
    const libLed = firstTransfer.logicalCircuits.find((c) => c.name === "Tri State LED (Right)")!;
    expect(libPower.category).toBe("Custom");
    expect(libPower.note).toBe("Angepasste Beschreibung");
    expect(libPower.logicalCircuitId).not.toBe(p1.powerId);
    expect(libLed.logicalCircuitId).not.toBe(p1.ledId);

    // Memory-Daten wurden verlustfrei mit neuer componentId geklont
    const memElem = libPower.elements.find((e) => e.kind === "memory");
    expect(memElem?.kind).toBe("memory");
    if (memElem?.kind === "memory") {
      expect(memElem.data).toBe("AA BB CC DD");
    }

    // Zweitübernahme aus anderem Projekt mit identischer Tri State LED (Right), aber anderem Power-Aufbau
    const p2 = buildPowerAndLedProject({ ledColor: "green", withMemory: false });
    const secondTransfer = transferProjectCircuitToLibrary(
      p2.project,
      p2.powerId,
      firstTransfer.logicalCircuits,
    );

    // Tri State LED (Right) wird per Struktur-Hash wiederverwendet; nur Power wird neu angelegt
    expect(secondTransfer.addedCircuits).toHaveLength(1);
    expect(secondTransfer.reusedCircuitIds).toEqual([libLed.logicalCircuitId]);
    expect(secondTransfer.addedCircuits[0].name).toBe("Power");
    const subRef = secondTransfer.addedCircuits[0].elements.find((e) => e.kind === "subCircuit");
    expect(subRef?.kind === "subCircuit" ? subRef.logicalCircuitId : "").toBe(libLed.logicalCircuitId);

    // Drittübernahme mit geänderter Tri State LED (Right) ("red") -> neue Kopie mit Konfliktauflösung
    const p3 = buildPowerAndLedProject({ ledColor: "red", withMemory: false });
    const thirdTransfer = transferProjectCircuitToLibrary(
      p3.project,
      p3.powerId,
      secondTransfer.logicalCircuits,
    );
    expect(thirdTransfer.addedCircuits).toHaveLength(2);
    expect(thirdTransfer.addedCircuits.map((c) => c.name)).toEqual([
      "Tri State LED (Right) (2)",
      "Power (2)",
    ]);

    const libHashes = computeNativeCircuitStructureHashes(thirdTransfer.logicalCircuits);
    expect(libHashes.get(libLed.logicalCircuitId)).toBe(
      computeNativeCircuitStructureHash(libLed.logicalCircuitId, thirdTransfer.logicalCircuits),
    );
  });

  it("übernimmt Bibliothek -> Projekt als isolierte Kopie mit Sub-Schaltungs-Deduplizierung und UUID-Isolation", () => {
    const source = buildPowerAndLedProject({
      ledColor: "green",
      withMemory: true,
      memoryData: "10 20 30 40",
    });
    const libraryCircuits = extractProjectCircuitsAsNative(source.project, source.powerId);

    // Fall A: Zielprojekt besitzt noch keine der Schaltungen -> beide mit frischen UUIDs anlegen
    const emptyTarget = createEmptyCircuitProject("Target", "Main");
    const importFull = transferLibraryCircuitToProject(emptyTarget, libraryCircuits, source.powerId);

    expect(importFull.addedCircuits).toHaveLength(2);
    expect(importFull.reusedCircuitIds).toHaveLength(0);
    expect(importFull.project.logicalCircuits.map((lc) => lc.name)).toEqual([
      "Main",
      "Tri State LED (Right)",
      "Power",
    ]);

    const importedPower = importFull.project.logicalCircuits.find(
      (lc) => lc.logicalCircuitId === importFull.rootCircuitId,
    )!;
    const importedLed = importFull.project.logicalCircuits.find(
      (lc) => lc.name === "Tri State LED (Right)",
    )!;
    const sourcePowerIds = collectAllUuidsOfCircuit(
      source.project.logicalCircuits.find((lc) => lc.logicalCircuitId === source.powerId)!,
    );
    const importedPowerIds = collectAllUuidsOfCircuit(importedPower);
    for (const id of importedPowerIds) {
      expect(sourcePowerIds.has(id)).toBe(false);
    }

    const importedMem = importFull.project.memories.find((m) =>
      importedPower.circuitSymbols.some((s) => s.circuitId === m.memoryId),
    ) as Memory | undefined;
    expect(importedMem?.data).toBe("10 20 30 40");

    // Fall B: Zielprojekt hat bereits identische Tri State LED (Right) und eine andere Schaltung namens "Power"
    const targetWithLed = buildPowerAndLedProject({ ledColor: "green", withMemory: false });
    const importWithExistingLed = transferLibraryCircuitToProject(
      targetWithLed.project,
      libraryCircuits,
      source.powerId,
    );

    // Tri State LED (Right) wird im Projekt wiederverwendet; Power bekommt Konflikt-Namen "Power (2)"
    expect(importWithExistingLed.reusedCircuitIds).toEqual([targetWithLed.ledId]);
    expect(importWithExistingLed.addedCircuits).toHaveLength(1);
    expect(importWithExistingLed.addedCircuits[0].name).toBe("Power (2)");
    const reusedSubSym = importWithExistingLed.addedCircuits[0].circuitSymbols.find(
      (s) => s.circuit.kind === "logicalCircuit",
    );
    expect(reusedSubSym?.circuitId).toBe(targetWithLed.ledId);

    // Nachträgliche Änderung in Bibliothek wirkt sich niemals rückwirkend auf das Projekt aus
    libraryCircuits[0].pins[0].name = "MUTATED_IN_LIBRARY";
    expect(importedLed.logicalPins[0].name).toBe("X0");
  });

  it("integriert importLibraryCircuit in CircuitContext inkl. Canvas-Platzierung, Undo/Redo und Simulation", () => {
    // Einfachen Inverter als Bibliotheksschaltung aufbauen
    const srcProj = createEmptyCircuitProject("LibSrc", "Inverter");
    const invLc = srcProj.logicalCircuits[0];
    const { pin: inPin, pinCircuit: inPinCirc } = createPinCircuit(
      crypto.randomUUID(),
      invLc.logicalCircuitId,
      "input",
      "A",
      1,
      "left",
      false,
      0,
    );
    const { pin: outPin, pinCircuit: outPinCirc } = createPinCircuit(
      crypto.randomUUID(),
      invLc.logicalCircuitId,
      "output",
      "Y",
      1,
      "right",
      false,
      1,
    );
    const notGate = createGate("not", 1, true);
    const symIn = createCircuitSymbol(inPinCirc, invLc.logicalCircuitId, 2, 4, "up");
    const symNot = createCircuitSymbol(notGate, invLc.logicalCircuitId, 6, 3, "up");
    const symOut = createCircuitSymbol(outPinCirc, invLc.logicalCircuitId, 11, 4, "up");
    const w1 = createWire(invLc.logicalCircuitId, { x: 4, y: 5 }, { x: 6, y: 5 });
    const w2 = createWire(invLc.logicalCircuitId, { x: 9, y: 5 }, { x: 11, y: 5 });
    invLc.logicalPins = [inPin, outPin];
    invLc.circuitSymbols = [symIn, symNot, symOut];
    invLc.wires = [w1, w2];
    srcProj.circuits.set(inPinCirc.circuitId, inPinCirc);
    srcProj.circuits.set(outPinCirc.circuitId, outPinCirc);
    srcProj.circuits.set(notGate.circuitId, notGate);
    srcProj.gates.set(notGate.gateId, notGate);
    srcProj.pins.push(inPin, outPin);
    srcProj.circuitSymbols.push(symIn, symNot, symOut);
    srcProj.wires.push(w1, w2);

    const libraryCircuits = extractProjectCircuitsAsNative(srcProj, invLc.logicalCircuitId);

    // Zielprojekt mit Konstante 1 -> Subschaltung -> LED auf Main
    const targetProj = createEmptyCircuitProject("Work", "Main");
    const mainLc = targetProj.logicalCircuits[0];
    const const1 = createConstant(crypto.randomUUID(), 1, 1, "right");
    const constSym = createCircuitSymbol(const1, mainLc.logicalCircuitId, 2, 4, "up");
    targetProj.circuits.set(const1.circuitId, const1);
    targetProj.constants.push(const1);
    mainLc.circuitSymbols.push(constSym);
    targetProj.circuitSymbols.push(constSym);

    let ctx!: React.ContextType<typeof CircuitContext>;
    const Consumer: React.FC = () => {
      ctx = React.useContext(CircuitContext);
      return null;
    };

    renderToStaticMarkup(
      React.createElement(
        CircuitContextProvider,
        {
          initialProject: targetProj,
          children: React.createElement(Consumer),
        },
      ),
    );

    let importRes!: ReturnType<NonNullable<typeof ctx.importLibraryCircuit>>;
    React.act(() => {
      importRes = ctx.importLibraryCircuit!(libraryCircuits, invLc.logicalCircuitId, {
        gridPoint: { x: 6, y: 4 },
      });
    });

    expect(importRes.addedCircuitIds).toHaveLength(1);
    expect(importRes.placedSymbol).toBeDefined();
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(2);
    expect(ctx.canUndo).toBe(true);

    // Platzierung rückgängig machen und wiederherstellen
    React.act(() => {
      ctx.undo();
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(1);
    expect(ctx.canRedo).toBe(true);

    React.act(() => {
      ctx.redo();
    });
    expect(ctx.currentCircuit.circuitSymbols).toHaveLength(2);

    // Verdrahten und mit CircuitRunner simulieren (Const 1 -> Inverter -> Probe = 0)
    const placed = ctx.currentCircuit.circuitSymbols.find((s) => s.circuit.kind === "logicalCircuit")!;
    let probeSym!: ReturnType<typeof ctx.addSymbol>;
    React.act(() => {
      probeSym = ctx.addSymbol({ type: "probe", name: "OutProbe", pinSide: "left" }, { x: 14, y: 4 });
    });
    const placedUpdated = ctx.currentCircuit.circuitSymbols.find(
      (s) => s.circuitSymbolId === placed.circuitSymbolId,
    )!;
    React.act(() => {
      ctx.addWire(constSym.jams[0].absolutePoint, placedUpdated.jams[0].absolutePoint);
      ctx.addWire(placedUpdated.jams[1].absolutePoint, probeSym.jams[0].absolutePoint);
    });

    const runner = new CircuitRunner(ctx.currentCircuit);
    runner.start();
    runner.step();
    const snapshot = runner.getSnapshot();
    expect(snapshot.probes[probeSym.circuitId]?.value).toBe(0);
    runner.dispose();
  });
});
