import { describe, expect, it } from "vitest";

import type CircuitProject from "../types/circuit/circuitProject";
import type Gate from "../types/circuit/gate";
import type NativeProjectDocument from "../types/storage/nativeProjectFormat";
import type { NativeSnippetDocument } from "../types/storage/nativeProjectFormat";
import {
  NATIVE_PROJECT_FORMAT,
  NATIVE_PROJECT_SCHEMA_VERSION,
  NATIVE_SNIPPET_FORMAT,
} from "../types/storage/nativeProjectFormat";

import { CircuitMap } from "../simulation/compiler/circuitMap";
import CircuitRunner from "../simulation/worker/circuitRunner";
import {
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
  createTextNote,
  rebuildImportedProjectLayout,
} from "../utils/circuitLayout";
import {
  isNativeCircuitJson,
  isNativeProjectJson,
  isNativeSnippetJson,
  isSupportedNativeProjectFile,
  parseNativeProject,
  parseNativeSnippet,
} from "../utils/storage/nativeProjectReader";
import {
  buildNativeProjectDocument,
  buildNativeProjectFileName,
  serializeNativeProject,
  serializeNativeSelection,
} from "../utils/storage/nativeProjectWriter";
import { createWire } from "../utils/wireUtils";

function createComprehensiveProject(): CircuitProject {
  const project = createEmptyCircuitProject(
    "Web-Format Volltest",
    "Hauptplan",
    "lc-main",
    "proj-web-01",
  );
  project.project.note = "Vollständige Testschaltung mit Web-Erweiterungen";
  project.project.zoom = 1.75;
  project.project.frequency = 60;
  project.project.isMaximumSpeed = true;
  project.project.startupCircuitId = "lc-display";
  project.project.categoryTextNoteCollapsed = true;
  project.project.categoryInputOutputCollapsed = false;
  project.project.categoryPrimitivesCollapsed = true;
  project.collapsedCategories = [{ name: "Arithmetik" }, { name: "Anzeige" }];

  const mainLc = project.logicalCircuits[0];
  mainLc.notation = "MAIN";
  mainLc.note = "Haupt-Arbeitsblatt";
  mainLc.category = "Arithmetik";
  mainLc.circuitShape = "alu";
  mainLc.showLabelAbove = true;
  mainLc.displayMargin = "horizontal";
  mainLc.validators = "01=10";
  mainLc.exportToHDL = false;

  const displayLc = createDefaultLogicalCircuit(
    "lc-display",
    "AnzeigeModul",
    "Anzeige",
    "Display-Subschaltung",
  );
  displayLc.notation = "DISP";
  displayLc.circuitShape = "display";
  displayLc.isDisplay = true;
  displayLc.showLabelAbove = true;
  displayLc.displayMargin = "all";
  displayLc.exportToHDL = true;

  const muxLc = createDefaultLogicalCircuit("lc-mux", "Mux2", "Arithmetik");
  muxLc.circuitShape = "mux";

  const demuxLc = createDefaultLogicalCircuit("lc-demux", "Demux2", "Arithmetik");
  demuxLc.circuitShape = "demux";

  const ffLc = createDefaultLogicalCircuit("lc-ff", "DFF", "Arithmetik");
  ffLc.circuitShape = "flipFlop";

  project.logicalCircuits.push(displayLc, muxLc, demuxLc, ffLc);
  project.circuits.set(displayLc.circuitId, displayLc);
  project.circuits.set(muxLc.circuitId, muxLc);
  project.circuits.set(demuxLc.circuitId, demuxLc);
  project.circuits.set(ffLc.circuitId, ffLc);

  // Pins mit expliziter PinSide (inkl. PinSide="left" auf Output und PinSide="right" auf Input gegen XML-Default-Fallen)
  const { pin: pinIn, pinCircuit: pinInCircuit } = createPinCircuit(
    "pin-in-a",
    displayLc.logicalCircuitId,
    "input",
    "DataIn",
    4,
    "right",
    true,
    2,
    4,
    3,
    "DIN",
  );
  pinIn.note = "Eingang auf rechter Seite";
  pinInCircuit.note = pinIn.note;

  const { pin: pinOut, pinCircuit: pinOutCircuit } = createPinCircuit(
    "pin-out-q",
    displayLc.logicalCircuitId,
    "output",
    "OutQ",
    4,
    "left",
    false,
    1,
    3,
    2,
    "QOUT",
  );
  pinOut.note = "Ausgang auf linker Seite";
  pinOutCircuit.note = pinOut.note;

  const { pin: pinTop, pinCircuit: pinTopCircuit } = createPinCircuit(
    "pin-in-clk",
    displayLc.logicalCircuitId,
    "input",
    "Clk",
    1,
    "top",
    false,
    0,
    2,
    2,
    "CLK",
  );

  project.pins.push(pinIn, pinOut, pinTop);
  displayLc.logicalPins.push(pinIn, pinOut, pinTop);
  project.circuits.set(pinInCircuit.circuitId, pinInCircuit);
  project.circuits.set(pinOutCircuit.circuitId, pinOutCircuit);
  project.circuits.set(pinTopCircuit.circuitId, pinTopCircuit);

  const ledInDisplay = createGate("led", 1, false, "blue");
  const ledInDisplaySym = createCircuitSymbol(ledInDisplay, displayLc.logicalCircuitId, 8, 4, "up", "sym-disp-led");
  const pinInSym = createCircuitSymbol(pinInCircuit, displayLc.logicalCircuitId, 2, 2, "up", "sym-pin-in");
  const pinOutSym = createCircuitSymbol(pinOutCircuit, displayLc.logicalCircuitId, 14, 2, "right", "sym-pin-out");
  const pinTopSym = createCircuitSymbol(pinTopCircuit, displayLc.logicalCircuitId, 2, 6, "down", "sym-pin-top");

  project.gates.set(ledInDisplay.gateId, ledInDisplay);
  project.circuits.set(ledInDisplay.circuitId, ledInDisplay);
  displayLc.circuitSymbols.push(ledInDisplaySym, pinInSym, pinOutSym, pinTopSym);
  project.circuitSymbols.push(ledInDisplaySym, pinInSym, pinOutSym, pinTopSym);

  // Alle Gate-Typen (inkl. benutzerdefinierter Note nur an einer Instanz sowie allen LED-Farben)
  const nandGate = createGate("and", 4, true);
  const orGate = createGate("or", 3, false);
  const xnorGate = createGate("xor", 2, true);
  const notGate = createGate("not", 1, true);
  const clockGate = createGate("clock", 0, false);
  const tri1Gate = createGate("triState1", 2, false);
  const tri2Gate = createGate("triState2", 2, false);
  const ledRed = createGate("led", 1, false, "red");
  const ledYellow = createGate("led", 1, false, "yellow");
  const ledGreen7Seg = createGate("led", 8, false, "green");

  for (const g of [nandGate, orGate, xnorGate, notGate, clockGate, tri1Gate, tri2Gate, ledRed, ledYellow, ledGreen7Seg]) {
    project.gates.set(g.gateId, g);
    project.circuits.set(g.circuitId, g);
  }

  const nandSym = createCircuitSymbol({ ...nandGate, note: "4-fach NAND" }, mainLc.logicalCircuitId, 2, 2, "up", "sym-nand");
  const orSym = createCircuitSymbol(orGate, mainLc.logicalCircuitId, 8, 2, "right", "sym-or");
  const xnorSym = createCircuitSymbol(xnorGate, mainLc.logicalCircuitId, 14, 2, "down", "sym-xnor");
  const notSym = createCircuitSymbol(notGate, mainLc.logicalCircuitId, 20, 2, "left", "sym-not");
  const clockSym = createCircuitSymbol(clockGate, mainLc.logicalCircuitId, 26, 2, "up", "sym-clk");
  const tri1Sym = createCircuitSymbol(tri1Gate, mainLc.logicalCircuitId, 30, 2, "up", "sym-tri1");
  const tri2Sym = createCircuitSymbol(tri2Gate, mainLc.logicalCircuitId, 36, 2, "up", "sym-tri2");
  const ledRedSym = createCircuitSymbol(ledRed, mainLc.logicalCircuitId, 42, 2, "up", "sym-led-r");
  const ledYellowSym = createCircuitSymbol(ledYellow, mainLc.logicalCircuitId, 46, 2, "up", "sym-led-y");
  const led7Sym = createCircuitSymbol(ledGreen7Seg, mainLc.logicalCircuitId, 50, 2, "up", "sym-led-7");

  // 1:1 Bauteile mit sämtlichen Web- und Standardeigenschaften
  const btn = createCircuitButton("btn-start", "GO", true, "left", true, 4, 3, false);
  btn.name = "StartSchalter";
  btn.modifiers = 3;
  btn.keyCode = 32;
  btn.note = "Space mit Ctrl+Shift";
  project.circuitButtons.push(btn);
  project.circuits.set(btn.circuitId, btn);
  const btnSym = createCircuitSymbol(btn, mainLc.logicalCircuitId, 2, 10, "right", "sym-btn");

  const constant = createConstant("const-42", 8, 42, "left", false, 3, 2);
  constant.note = "Dezimal 42";
  project.constants.push(constant);
  project.circuits.set(constant.circuitId, constant);
  const constSym = createCircuitSymbol(constant, mainLc.logicalCircuitId, 8, 10, "up", "sym-const");

  const probeNamed = createCircuitProbe("probe-dec", "BusWert", "bottom", 4, 3, false);
  probeNamed.displayFormat = "dec";
  probeNamed.note = "Dezimale Sonde";

  const probeUnnamed = createCircuitProbe("probe-unnamed", "", "left", 2, 2, true);
  probeUnnamed.displayFormat = "hex";

  project.circuitProbes.push(probeNamed, probeUnnamed);
  project.circuits.set(probeNamed.circuitId, probeNamed);
  project.circuits.set(probeUnnamed.circuitId, probeUnnamed);
  const probeNamedSym = createCircuitSymbol(probeNamed, mainLc.logicalCircuitId, 14, 10, "up", "sym-probe-1");
  const probeUnnamedSym = createCircuitSymbol(probeUnnamed, mainLc.logicalCircuitId, 20, 10, "up", "sym-probe-2");

  const splitter = createSplitter("split-8", 8, 4, false);
  splitter.note = "8-Bit-Verteiler";
  project.splitters.push(splitter);
  project.circuits.set(splitter.circuitId, splitter);
  const splitterSym = createCircuitSymbol(splitter, mainLc.logicalCircuitId, 24, 10, "up", "sym-split");

  const rom = createMemory("mem-rom", false, 6, 16, {
    writeOn1: false,
    onStart: "data",
    dualPort: false,
    data: "AQIDBAUG",
    note: "Firmware ROM",
  });
  const ram = createMemory("mem-ram", true, 4, 8, {
    writeOn1: true,
    onStart: "zeros",
    dualPort: true,
    data: "////",
    note: "Dual-Port RAM",
  });
  project.memories.push(rom, ram);
  project.circuits.set(rom.circuitId, rom);
  project.circuits.set(ram.circuitId, ram);
  const romSym = createCircuitSymbol(rom, mainLc.logicalCircuitId, 28, 10, "up", "sym-rom");
  const ramSym = createCircuitSymbol(ram, mainLc.logicalCircuitId, 34, 10, "up", "sym-ram");

  const matrix = createLedMatrix("mat-rgb", 5, 7, "selector", "rect", 3, 2);
  matrix.name = "RGB Matrix";
  matrix.note = "2x Nachleuchten";
  project.ledMatrices.push(matrix);
  project.circuits.set(matrix.circuitId, matrix);
  const matrixSym = createCircuitSymbol(matrix, mainLc.logicalCircuitId, 40, 10, "up", "sym-matrix");

  const sensor = createSensor("sens-seq", "sequence", 8, "left", "SEQ", "01 0A FF", "Testsequenz");
  project.sensors.push(sensor);
  project.circuits.set(sensor.circuitId, sensor);
  const sensorSym = createCircuitSymbol(sensor, mainLc.logicalCircuitId, 50, 10, "up", "sym-sensor");

  const sound = createSound("snd-beep", "top", "BEEP", "880 Hz Rechteck", 880, "square");
  project.sounds.push(sound);
  project.circuits.set(sound.circuitId, sound);
  const soundSym = createCircuitSymbol(sound, mainLc.logicalCircuitId, 56, 10, "up", "sym-sound");

  const ga = createGraphicsArray("ga-vram", {
    writeOn1: true,
    onStart: "ones",
    dataBitWidth: 16,
    bitsPerPixel: 4,
    width: 64,
    height: 32,
    zoom: 2,
    note: "OLED VRAM",
  });
  project.graphicsArrays.push(ga);
  project.circuits.set(ga.circuitId, ga);
  const gaSym = createCircuitSymbol(ga, mainLc.logicalCircuitId, 2, 18, "up", "sym-ga");

  const subDisplaySym = createCircuitSymbol(displayLc, mainLc.logicalCircuitId, 20, 18, "up", "sym-sub-disp");
  const subMuxSym = createCircuitSymbol(muxLc, mainLc.logicalCircuitId, 32, 18, "up", "sym-sub-mux");
  const subDemuxSym = createCircuitSymbol(demuxLc, mainLc.logicalCircuitId, 38, 18, "up", "sym-sub-demux");
  const subFfSym = createCircuitSymbol(ffLc, mainLc.logicalCircuitId, 44, 18, "up", "sym-sub-ff");

  const mainSymbols = [
    nandSym,
    orSym,
    xnorSym,
    notSym,
    clockSym,
    tri1Sym,
    tri2Sym,
    ledRedSym,
    ledYellowSym,
    led7Sym,
    btnSym,
    constSym,
    probeNamedSym,
    probeUnnamedSym,
    splitterSym,
    romSym,
    ramSym,
    matrixSym,
    sensorSym,
    soundSym,
    gaSym,
    subDisplaySym,
    subMuxSym,
    subDemuxSym,
    subFfSym,
  ];
  mainLc.circuitSymbols.push(...mainSymbols);
  project.circuitSymbols.push(...mainSymbols);

  // Leitungen inklusive T-Kreuzung sowie Null-Längen-Segment zur Filterprüfung
  const w1 = createWire(mainLc.logicalCircuitId, { x: 4, y: 8 }, { x: 8, y: 8 }, "wire-1");
  const w2 = createWire(mainLc.logicalCircuitId, { x: 8, y: 8 }, { x: 12, y: 8 }, "wire-2");
  const w3 = createWire(mainLc.logicalCircuitId, { x: 8, y: 8 }, { x: 8, y: 12 }, "wire-3");
  const wZero = createWire(mainLc.logicalCircuitId, { x: 9, y: 9 }, { x: 9, y: 9 }, "wire-zero");
  mainLc.wires.push(w1, w2, w3, wZero);
  project.wires.push(w1, w2, w3, wZero);

  // Textnotizen mit Web-Schriftart und Zeilenhöhen
  const note1 = createTextNote(mainLc.logicalCircuitId, 1, 28, "Zeile 1\nZeile 2", {
    textNoteId: "note-1",
    width: 12,
    height: 4,
    rotation: "right",
    lineHeight: 12,
    fontFamily: "sans",
    lineHeights: [36, 12],
  });
  const note2 = createTextNote(mainLc.logicalCircuitId, 16, 28, "Mono Standard", {
    textNoteId: "note-2",
    width: 8,
    height: 2,
    rotation: "up",
    lineHeight: 18,
    fontFamily: "mono",
  });
  mainLc.textNotes.push(note1, note2);
  project.textNotes.push(note1, note2);

  return rebuildImportedProjectLayout(project);
}

describe("Natives Web-Projektformat (*.lcweb) – T-058", () => {
  it("serialisiert alle Felder explizit ohne Desktop-Hex-GUIDs und führt einen 100 % verlustfreien Roundtrip durch", () => {
    const source = createComprehensiveProject();
    const jsonText = serializeNativeProject(source, { appVersion: "0.9.0-test" });

    // Keine Desktop-Hex-Gate-GUID im JSON und explizite Felder auch bei Default-Werten
    expect(jsonText).not.toContain("00000000-0000-0000-0000-");
    const doc = JSON.parse(jsonText) as NativeProjectDocument;
    expect(doc.format).toBe(NATIVE_PROJECT_FORMAT);
    expect(doc.schemaVersion).toBe(NATIVE_PROJECT_SCHEMA_VERSION);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.appVersion).toBe("0.9.0-test");
    expect(doc.project.frequency).toBe(60);
    expect(doc.project.startupCircuitId).toBe("lc-display");
    expect(doc.collapsedCategories).toEqual(["Arithmetik", "Anzeige"]);

    // Explizite Default-Eigenschaften müssen ebenfalls vollständig im JSON vorhanden sein
    const rawDisplayLc = doc.logicalCircuits.find((c) => c.logicalCircuitId === "lc-display")!;
    expect(rawDisplayLc.exportToHDL).toBe(true);
    const rawOutPin = rawDisplayLc.pins.find((p) => p.pinId === "pin-out-q")!;
    expect(rawOutPin.pinSide).toBe("left");
    expect(rawOutPin.inverted).toBe(false);
    const rawMainLc = doc.logicalCircuits.find((c) => c.logicalCircuitId === "lc-main")!;
    const rawRedLed = rawMainLc.elements.find((e) => e.symbolId === "sym-led-r")!;
    expect(rawRedLed).toMatchObject({ kind: "gate", gateType: "led", color: "red" });
    const rawUnnamedProbe = rawMainLc.elements.find((e) => e.symbolId === "sym-probe-2")!;
    expect(rawUnnamedProbe).toMatchObject({
      kind: "circuitProbe",
      name: "",
      pinSide: "left",
      displayFormat: "hex",
      isHex: true,
    });

    const parsed = parseNativeProject(jsonText);

    // Projekt-Metadaten inklusive 60 Hz (ohne XML-50-Hz-Kappung) und sprechende IDs
    expect(parsed.project.projectId).toBe("proj-web-01");
    expect(parsed.project.name).toBe("Web-Format Volltest");
    expect(parsed.project.note).toBe("Vollständige Testschaltung mit Web-Erweiterungen");
    expect(parsed.project.zoom).toBe(1.75);
    expect(parsed.project.frequency).toBe(60);
    expect(parsed.project.isMaximumSpeed).toBe(true);
    expect(parsed.project.logicalCircuitId).toBe("lc-main");
    expect(parsed.project.startupCircuitId).toBe("lc-display");
    expect(parsed.project.categoryTextNoteCollapsed).toBe(true);
    expect(parsed.project.categoryInputOutputCollapsed).toBe(false);
    expect(parsed.project.categoryPrimitivesCollapsed).toBe(true);
    expect(parsed.collapsedCategories.map((c) => c.name)).toEqual(["Arithmetik", "Anzeige"]);

    // Schaltpläne & Web-Erweiterungen
    const main = parsed.logicalCircuits.find((c) => c.logicalCircuitId === "lc-main")!;
    const disp = parsed.logicalCircuits.find((c) => c.logicalCircuitId === "lc-display")!;
    const mux = parsed.logicalCircuits.find((c) => c.logicalCircuitId === "lc-mux")!;
    const demux = parsed.logicalCircuits.find((c) => c.logicalCircuitId === "lc-demux")!;
    const ff = parsed.logicalCircuits.find((c) => c.logicalCircuitId === "lc-ff")!;

    expect(main.circuitShape).toBe("alu");
    expect(main.showLabelAbove).toBe(true);
    expect(main.displayMargin).toBe("horizontal");
    expect(main.validators).toBe("01=10");
    expect(main.exportToHDL).toBe(false);

    expect(disp.circuitShape).toBe("display");
    expect(disp.isDisplay).toBe(true);
    expect(disp.showLabelAbove).toBe(true);
    expect(disp.displayMargin).toBe("all");
    expect(disp.exportToHDL).toBe(true);
    expect(mux.circuitShape).toBe("mux");
    expect(demux.circuitShape).toBe("demux");
    expect(ff.circuitShape).toBe("flipFlop");

    // Pins inklusive expliziter PinSide, jamNotation, index und Custom-Größe
    const pIn = disp.logicalPins.find((p) => p.pinId === "pin-in-a")!;
    const pOut = disp.logicalPins.find((p) => p.pinId === "pin-out-q")!;
    const pClk = disp.logicalPins.find((p) => p.pinId === "pin-in-clk")!;
    expect(pIn.pinType).toBe("input");
    expect(pIn.pinSide).toBe("right");
    expect(pIn.inverted).toBe(true);
    expect(pIn.bitWidth).toBe(4);
    expect(pIn.index).toBe(2);
    expect(pIn.jamNotation).toBe("DIN");
    expect(pIn.note).toBe("Eingang auf rechter Seite");

    expect(pOut.pinType).toBe("output");
    expect(pOut.pinSide).toBe("left");
    expect(pOut.index).toBe(1);
    expect(pOut.jamNotation).toBe("QOUT");
    expect(pClk.pinSide).toBe("top");

    const pInSym = disp.circuitSymbols.find((s) => s.circuitSymbolId === "sym-pin-in")!;
    expect(pInSym.circuit.symbolWidth).toBe(4);
    expect(pInSym.circuit.symbolHeight).toBe(3);

    // Gates & LED-Farben & instanzbezogene Gate-Notiz
    const parsedNandSym = main.circuitSymbols.find((s) => s.circuitSymbolId === "sym-nand")!;
    const parsedNand = parsedNandSym.circuit as Gate;
    expect(parsedNand.gateType).toBe("and");
    expect(parsedNand.inputCount).toBe(4);
    expect(parsedNand.invertedOutput).toBe(true);
    expect(parsedNand.note).toBe("4-fach NAND");

    const parsedOr = main.circuitSymbols.find((s) => s.circuitSymbolId === "sym-or")!.circuit as Gate;
    expect(parsedOr.note).toBe("");
    const parsedYellowLed = main.circuitSymbols.find((s) => s.circuitSymbolId === "sym-led-y")!.circuit as Gate;
    expect(parsedYellowLed.color).toBe("yellow");
    const parsed7Seg = main.circuitSymbols.find((s) => s.circuitSymbolId === "sym-led-7")!.circuit as Gate;
    expect(parsed7Seg.inputCount).toBe(8);
    expect(parsed7Seg.color).toBe("green");

    // 1:1 Bauteile
    const parsedBtn = parsed.circuitButtons.find((b) => b.circuitButtonId === "btn-start")!;
    expect(parsedBtn.name).toBe("StartSchalter");
    expect(parsedBtn.notation).toBe("GO");
    expect(parsedBtn.isToggle).toBe(true);
    expect(parsedBtn.pinSide).toBe("left");
    expect(parsedBtn.inverted).toBe(true);
    expect(parsedBtn.width).toBe(4);
    expect(parsedBtn.height).toBe(3);
    expect(parsedBtn.modifiers).toBe(3);
    expect(parsedBtn.keyCode).toBe(32);
    expect(parsedBtn.note).toBe("Space mit Ctrl+Shift");

    const parsedConst = parsed.constants.find((c) => c.constantId === "const-42")!;
    expect(parsedConst.bitWidth).toBe(8);
    expect(parsedConst.value).toBe(42);
    expect(parsedConst.isHex).toBe(false);
    expect(parsedConst.pinSide).toBe("left");
    expect(parsedConst.symbolWidth).toBe(3);
    expect(parsedConst.symbolHeight).toBe(2);
    expect(parsedConst.note).toBe("Dezimal 42");

    const parsedNamedProbe = parsed.circuitProbes.find((p) => p.circuitProbeId === "probe-dec")!;
    const parsedUnnamedProbe = parsed.circuitProbes.find((p) => p.circuitProbeId === "probe-unnamed")!;
    expect(parsedNamedProbe.name).toBe("BusWert");
    expect(parsedNamedProbe.displayFormat).toBe("dec");
    expect(parsedNamedProbe.isHex).toBe(false);
    expect(parsedNamedProbe.pinSide).toBe("bottom");
    expect(parsedNamedProbe.symbolWidth).toBe(4);
    expect(parsedNamedProbe.symbolHeight).toBe(3);
    expect(parsedNamedProbe.note).toBe("Dezimale Sonde");
    expect(parsedUnnamedProbe.name).toBe("probe-unnamed");
    expect(parsedUnnamedProbe.notation).toBe("?");
    expect(parsedUnnamedProbe.displayFormat).toBe("hex");
    expect(parsedUnnamedProbe.isHex).toBe(true);

    const parsedSplit = parsed.splitters.find((s) => s.splitterId === "split-8")!;
    expect(parsedSplit.bitWidth).toBe(8);
    expect(parsedSplit.pinCount).toBe(4);
    expect(parsedSplit.clockwise).toBe(false);
    expect(parsedSplit.note).toBe("8-Bit-Verteiler");

    const parsedRom = parsed.memories.find((m) => m.memoryId === "mem-rom")!;
    const parsedRam = parsed.memories.find((m) => m.memoryId === "mem-ram")!;
    expect(parsedRom.writable).toBe(false);
    expect(parsedRom.onStart).toBe("data");
    expect(parsedRom.addressBitWidth).toBe(6);
    expect(parsedRom.dataBitWidth).toBe(16);
    expect(parsedRom.data).toBe("AQIDBAUG");
    expect(parsedRam.writable).toBe(true);
    expect(parsedRam.writeOn1).toBe(true);
    expect(parsedRam.dualPort).toBe(true);
    expect(parsedRam.note).toBe("Dual-Port RAM");

    const parsedMatrix = parsed.ledMatrices.find((m) => m.ledMatrixId === "mat-rgb")!;
    expect(parsedMatrix.name).toBe("RGB Matrix");
    expect(parsedMatrix.matrixType).toBe("selector");
    expect(parsedMatrix.cellShape).toBe("rect");
    expect(parsedMatrix.rows).toBe(5);
    expect(parsedMatrix.columns).toBe(7);
    expect(parsedMatrix.colors).toBe(3);
    expect(parsedMatrix.persistenceMultiplier).toBe(2);
    expect(parsedMatrix.note).toBe("2x Nachleuchten");

    const parsedSensor = parsed.sensors.find((s) => s.sensorId === "sens-seq")!;
    expect(parsedSensor.sensorType).toBe("sequence");
    expect(parsedSensor.bitWidth).toBe(8);
    expect(parsedSensor.pinSide).toBe("left");
    expect(parsedSensor.notation).toBe("SEQ");
    expect(parsedSensor.data).toBe("01 0A FF");
    expect(parsedSensor.note).toBe("Testsequenz");

    const parsedSound = parsed.sounds.find((s) => s.soundId === "snd-beep")!;
    expect(parsedSound.pinSide).toBe("top");
    expect(parsedSound.notation).toBe("BEEP");
    expect(parsedSound.frequency).toBe(880);
    expect(parsedSound.waveform).toBe("square");
    expect(parsedSound.note).toBe("880 Hz Rechteck");

    const parsedGa = parsed.graphicsArrays.find((g) => g.graphicsArrayId === "ga-vram")!;
    expect(parsedGa.writeOn1).toBe(true);
    expect(parsedGa.onStart).toBe("ones");
    expect(parsedGa.dataBitWidth).toBe(16);
    expect(parsedGa.bitsPerPixel).toBe(4);
    expect(parsedGa.width).toBe(64);
    expect(parsedGa.height).toBe(32);
    expect(parsedGa.zoom).toBe(2);
    expect(parsedGa.note).toBe("OLED VRAM");

    // Wires & ConductorMap-T-Kreuzung (Null-Längen-Draht wurde gefiltert)
    expect(main.wires).toHaveLength(3);
    expect(main.conductorMap?.junctionPoints).toEqual([{ x: 8, y: 8 }]);

    // Textnotizen
    const parsedNote1 = main.textNotes.find((n) => n.textNoteId === "note-1")!;
    expect(parsedNote1.note).toBe("Zeile 1\nZeile 2");
    expect(parsedNote1.rotation).toBe("right");
    expect(parsedNote1.lineHeight).toBe(12);
    expect(parsedNote1.fontFamily).toBe("sans");
    expect(parsedNote1.lineHeights).toEqual([36, 12]);

    const parsedNote2 = main.textNotes.find((n) => n.textNoteId === "note-2")!;
    expect(parsedNote2.lineHeights).toBeUndefined();
    expect(parsedNote2.fontFamily).toBe("mono");

    // Zweiter Roundtrip bleibt strukturell identisch
    const jsonSecond = serializeNativeProject(parsed, { appVersion: "0.9.0-test" });
    expect(JSON.parse(jsonSecond)).toEqual(doc);

    // Ohne appVersion-Override greift process.env.VERSION aus package.json (entkoppelt von schemaVersion)
    const defaultHeaderDoc = JSON.parse(serializeNativeProject(parsed)) as NativeProjectDocument;
    expect(defaultHeaderDoc.appVersion).toBe(process.env.VERSION);
    expect(defaultHeaderDoc.schemaVersion).toBe(NATIVE_PROJECT_SCHEMA_VERSION);
    expect(defaultHeaderDoc.schemaVersion).toBe(1);
  });

  it("behält im Demo-Projekt sprechende IDs und führt einen vollständigen Roundtrip durch", () => {
    const demo = createDemoCircuitProject();
    const json = serializeNativeProject(demo);
    const parsed = parseNativeProject(json);

    expect(parsed.logicalCircuits.map((lc) => lc.logicalCircuitId)).toEqual(
      demo.logicalCircuits.map((lc) => lc.logicalCircuitId),
    );
    expect(parsed.logicalCircuits.some((lc) => lc.logicalCircuitId === "sub-power")).toBe(true);
    expect(parsed.logicalCircuits.some((lc) => lc.logicalCircuitId === "sub-7seg-4bit")).toBe(true);
    expect(parsed.textNotes.some((n) => n.textNoteId === "note-power-1")).toBe(true);
  });

  it("rekonstruiert hierarchische Jams, innerJam und Simulationsfähigkeit nach dem Roundtrip", () => {
    const project = createEmptyCircuitProject("SimRoundtrip", "Main", "lc-root", "proj-sim");

    // Subschaltung (Inverter via NOT) definieren (absichtlich vor Main geprüft, hier erst angehängt)
    const subLc = createDefaultLogicalCircuit("lc-inv", "Inverter", "Gates");
    const { pin: subIn, pinCircuit: subInC } = createPinCircuit("pin-sub-in", "lc-inv", "input", "A", 1, "left");
    const { pin: subOut, pinCircuit: subOutC } = createPinCircuit("pin-sub-out", "lc-inv", "output", "Y", 1, "right");
    const notGate = createGate("not", 1, true);
    const subInSym = createCircuitSymbol(subInC, "lc-inv", 2, 4, "up", "sym-sub-in");
    const notSym = createCircuitSymbol(notGate, "lc-inv", 6, 3, "up", "sym-sub-not");
    const subOutSym = createCircuitSymbol(subOutC, "lc-inv", 12, 4, "up", "sym-sub-out");

    subLc.logicalPins = [subIn, subOut];
    subLc.circuitSymbols = [subInSym, notSym, subOutSym];
    subLc.wires = [
      createWire("lc-inv", subInSym.jams[0].absolutePoint, notSym.jams[0].absolutePoint, "w-sub-1"),
      createWire("lc-inv", notSym.jams[1].absolutePoint, subOutSym.jams[0].absolutePoint, "w-sub-2"),
    ];
    project.pins.push(subIn, subOut);
    project.gates.set(notGate.gateId, notGate);
    project.circuits.set(subInC.circuitId, subInC);
    project.circuits.set(subOutC.circuitId, subOutC);
    project.circuits.set(notGate.circuitId, notGate);
    project.logicalCircuits.push(subLc);
    project.circuits.set(subLc.circuitId, subLc);

    // Root-Schaltung: Button -> SubCircuit -> Probe
    const prepared = rebuildImportedProjectLayout(project);
    const syncedSub = prepared.logicalCircuits.find((c) => c.logicalCircuitId === "lc-inv")!;
    const syncedRoot = prepared.logicalCircuits[0];

    const btn = createCircuitButton("btn-root", "IN", true, "right");
    const probe = createCircuitProbe("probe-root", "Y", "left");
    const btnSym = createCircuitSymbol(btn, "lc-root", 2, 4, "up", "sym-btn-root");
    const subSym = createCircuitSymbol(syncedSub, "lc-root", 8, 3, "up", "sym-sub-inst");
    const probeSym = createCircuitSymbol(probe, "lc-root", 14, 4, "up", "sym-probe-root");

    syncedRoot.circuitSymbols = [btnSym, subSym, probeSym];
    syncedRoot.wires = [
      createWire("lc-root", btnSym.jams[0].absolutePoint, subSym.jams[0].absolutePoint, "w-r-1"),
      createWire("lc-root", subSym.jams[1].absolutePoint, probeSym.jams[0].absolutePoint, "w-r-2"),
    ];
    prepared.circuitButtons.push(btn);
    prepared.circuitProbes.push(probe);
    prepared.circuits.set(btn.circuitId, btn);
    prepared.circuits.set(probe.circuitId, probe);
    prepared.circuitSymbols.push(
      subInSym,
      notSym,
      subOutSym,
      btnSym,
      subSym,
      probeSym,
    );
    prepared.wires.push(...subLc.wires, ...syncedRoot.wires);

    const parsed = parseNativeProject(serializeNativeProject(prepared));
    const parsedRoot = parsed.logicalCircuits.find((c) => c.logicalCircuitId === "lc-root")!;
    const parsedSubSym = parsedRoot.circuitSymbols.find((s) => s.circuitSymbolId === "sym-sub-inst")!;

    expect(parsedSubSym.jams).toHaveLength(2);
    expect(parsedSubSym.jams.every((j) => j.innerJam !== undefined)).toBe(true);

    const compiledMap = new CircuitMap(parsedRoot);
    expect(compiledMap.children.size).toBe(1);

    const runner = new CircuitRunner(parsedRoot);
    const stepLow = runner.step(1);
    expect(stepLow.snapshot.probes["probe-root"].value).toBe(1);

    runner.setButtonState("btn-root", true);
    const stepHigh = runner.step(1);
    expect(stepHigh.snapshot.probes["probe-root"].value).toBe(0);
    runner.dispose();
  });

  it("serialisiert und deserialisiert Teilauswahlen inkl. transitiver Subschaltungen verlustfrei", () => {
    const project = createEmptyCircuitProject("SnippetTest", "Main", "lc-main", "proj-snip");
    const main = project.logicalCircuits[0];

    const subB = createDefaultLogicalCircuit("lc-sub-b", "SubB");
    const { pin: pinB, pinCircuit: pinBC } = createPinCircuit("pin-b", "lc-sub-b", "output", "OutB", 1, "right");
    const constB = createConstant("const-b", 1, 1, "right");
    const constBSym = createCircuitSymbol(constB, "lc-sub-b", 2, 2, "up", "sym-const-b");
    const pinBSym = createCircuitSymbol(pinBC, "lc-sub-b", 6, 2, "up", "sym-pin-b");
    subB.logicalPins = [pinB];
    subB.circuitSymbols = [constBSym, pinBSym];

    const subA = createDefaultLogicalCircuit("lc-sub-a", "SubA");
    const { pin: pinA, pinCircuit: pinAC } = createPinCircuit("pin-a", "lc-sub-a", "output", "OutA", 1, "right");
    const subBSymInA = createCircuitSymbol(subB, "lc-sub-a", 4, 2, "up", "sym-sub-b-in-a");
    const pinASym = createCircuitSymbol(pinAC, "lc-sub-a", 12, 2, "up", "sym-pin-a");
    subA.logicalPins = [pinA];
    subA.circuitSymbols = [subBSymInA, pinASym];

    const unusedSub = createDefaultLogicalCircuit("lc-unused", "Unused");

    const subASymInMain = createCircuitSymbol(subA, "lc-main", 4, 4, "up", "sym-sub-a");
    const unselectedGate = createGate("and", 2, false);
    const unselectedSym = createCircuitSymbol(unselectedGate, "lc-main", 20, 4, "up", "sym-unselected");
    const selectedWire = createWire("lc-main", { x: 1, y: 1 }, { x: 4, y: 1 }, "wire-sel");
    const unselectedWire = createWire("lc-main", { x: 10, y: 10 }, { x: 12, y: 10 }, "wire-other");
    const selectedNote = createTextNote("lc-main", 2, 12, "Gewählt", { textNoteId: "note-sel" });
    const unselectedNote = createTextNote("lc-main", 18, 12, "Ignoriert", { textNoteId: "note-other" });

    main.circuitSymbols = [subASymInMain, unselectedSym];
    main.wires = [selectedWire, unselectedWire];
    main.textNotes = [selectedNote, unselectedNote];

    project.logicalCircuits.push(subA, subB, unusedSub);
    project.pins.push(pinA, pinB);
    project.constants.push(constB);
    project.gates.set(unselectedGate.gateId, unselectedGate);
    project.circuits.set(subA.circuitId, subA);
    project.circuits.set(subB.circuitId, subB);
    project.circuits.set(unusedSub.circuitId, unusedSub);
    project.circuits.set(pinAC.circuitId, pinAC);
    project.circuits.set(pinBC.circuitId, pinBC);
    project.circuits.set(constB.circuitId, constB);
    project.circuits.set(unselectedGate.circuitId, unselectedGate);

    const snippetJson = serializeNativeSelection(
      project,
      main,
      ["sym-sub-a"],
      ["wire-sel"],
      ["note-sel"],
    );

    expect(isNativeSnippetJson(snippetJson)).toBe(true);
    expect((JSON.parse(snippetJson) as NativeSnippetDocument).format).toBe(NATIVE_SNIPPET_FORMAT);
    expect(isNativeProjectJson(snippetJson)).toBe(false);
    expect(isNativeCircuitJson(snippetJson)).toBe(true);

    const parsedSnippet = parseNativeSnippet(snippetJson);
    expect(parsedSnippet.logicalCircuits.map((c) => c.logicalCircuitId)).toEqual([
      "lc-main",
      "lc-sub-a",
      "lc-sub-b",
    ]);

    const parsedRoot = parsedSnippet.logicalCircuits[0];
    expect(parsedRoot.circuitSymbols.map((s) => s.circuitSymbolId)).toEqual(["sym-sub-a"]);
    expect(parsedRoot.wires.map((w) => w.wireId)).toEqual(["wire-sel"]);
    expect(parsedRoot.textNotes.map((n) => n.textNoteId)).toEqual(["note-sel"]);

    const parsedSubB = parsedSnippet.logicalCircuits.find((c) => c.logicalCircuitId === "lc-sub-b")!;
    expect(parsedSubB.circuitSymbols.map((s) => s.circuitSymbolId).sort()).toEqual([
      "sym-const-b",
      "sym-pin-b",
    ]);
    expect(parsedSnippet.constants).toHaveLength(1);
  });

  it("erkennt Format-Detektoren und erzeugt sichere .lcweb-Dateinamen", () => {
    const project = createEmptyCircuitProject("Mein Test");
    const json = serializeNativeProject(project);

    expect(isNativeProjectJson(json)).toBe(true);
    expect(isNativeSnippetJson(json)).toBe(false);
    expect(isNativeCircuitJson(json)).toBe(true);
    expect(isNativeProjectJson("<lc:CircuitProject />")).toBe(false);
    expect(isNativeCircuitJson("{ invalid json")).toBe(false);

    expect(isSupportedNativeProjectFile("schaltung.lcweb")).toBe(true);
    expect(isSupportedNativeProjectFile("SCHALTUNG.JSON")).toBe(true);
    expect(isSupportedNativeProjectFile("schaltung.CircuitProject")).toBe(false);

    expect(buildNativeProjectFileName("Meine:Schaltung?")).toBe("Meine_Schaltung_.lcweb");
    expect(buildNativeProjectFileName("demo.lcweb")).toBe("demo.lcweb");
    expect(buildNativeProjectFileName("Digital Clock.CircuitProject")).toBe("Digital Clock.lcweb");
    expect(buildNativeProjectFileName("   ")).toBe("CircuitProject.lcweb");
  });

  it("weist ungültige Header, unbekannte Schema-Versionen, fehlerhafte Enums und fehlende Referenzen ab", () => {
    const validDoc = buildNativeProjectDocument(createEmptyCircuitProject("Valid"));

    expect(() => parseNativeProject("")).toThrow("leer");
    expect(() => parseNativeProject("{ broken")).toThrow("Ungültiges JSON-Projektformat");
    expect(() => parseNativeProject("[]")).toThrow("JSON-Objekt");

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, format: "other-format" })),
    ).toThrow("Nicht unterstütztes Dateiformat");

    const snippetJson = serializeNativeSelection(
      createEmptyCircuitProject(),
      createEmptyCircuitProject().logicalCircuits[0],
      [],
      [],
      [],
    );
    expect(() => parseNativeProject(snippetJson)).toThrow("Snippet-Format");

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, schemaVersion: 2 })),
    ).toThrow("Nicht unterstützte Schema-Version 2");

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, schemaVersion: 900 })),
    ).toThrow("Nicht unterstützte Schema-Version 900");

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, schemaVersion: 901 })),
    ).toThrow("Nicht unterstützte Schema-Version 901");

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, schemaVersion: 1, appVersion: "1.0.0" })),
    ).not.toThrow();

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, schemaVersion: 1, appVersion: "2.5.0" })),
    ).not.toThrow();

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, schemaVersion: 0 })),
    ).toThrow("Ungültige Schema-Version 0");

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, schemaVersion: -1 })),
    ).toThrow("Ungültige Schema-Version -1");

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, schemaVersion: 1.5 })),
    ).toThrow("Fehlende oder ungültige Schema-Version");

    expect(() =>
      parseNativeProject(JSON.stringify({ ...validDoc, logicalCircuits: [] })),
    ).toThrow("Mindestens ein Schaltplan");

    const brokenRefDoc = structuredClone(validDoc);
    brokenRefDoc.project.logicalCircuitId = "non-existent";
    expect(() => parseNativeProject(JSON.stringify(brokenRefDoc))).toThrow("Fehlende Schaltplan-Referenz");

    const badGateDoc = structuredClone(validDoc);
    badGateDoc.logicalCircuits[0].elements.push({
      symbolId: "s-bad-gate",
      x: 1,
      y: 1,
      rotation: "up",
      kind: "gate",
      gateType: "and",
      inputCount: 2,
      invertedOutput: false,
      color: "red",
      note: "",
    });
    expect(() => parseNativeProject(JSON.stringify(badGateDoc))).toThrow("Nicht-LED-Gatter");

    const badEnumDoc = structuredClone(validDoc);
    (badEnumDoc.logicalCircuits[0] as unknown as Record<string, unknown>).circuitShape = "hexagon";
    expect(() => parseNativeProject(JSON.stringify(badEnumDoc))).toThrow("circuitShape");

    const dupCircuitDoc = structuredClone(validDoc);
    dupCircuitDoc.logicalCircuits.push(structuredClone(dupCircuitDoc.logicalCircuits[0]));
    expect(() => parseNativeProject(JSON.stringify(dupCircuitDoc))).toThrow("Doppelte Schaltplan-ID");

    const dupSymbolDoc = structuredClone(validDoc);
    const gateElem = {
      symbolId: "dup-sym",
      x: 1,
      y: 1,
      rotation: "up" as const,
      kind: "gate" as const,
      gateType: "not" as const,
      inputCount: 1,
      invertedOutput: true,
      color: null,
      note: "",
    };
    dupSymbolDoc.logicalCircuits[0].elements.push(gateElem, { ...gateElem });
    expect(() => parseNativeProject(JSON.stringify(dupSymbolDoc))).toThrow("Doppelte Symbol-ID");
  });

  it("erkennt direkte und indirekte zyklische Subschaltungs-Referenzen", () => {
    const baseDoc = buildNativeProjectDocument(createEmptyCircuitProject("CycleTest", "A", "lc-a"));

    // Direkte Selbstreferenz: A -> A
    const selfCycleDoc = structuredClone(baseDoc);
    selfCycleDoc.logicalCircuits[0].elements.push({
      symbolId: "sym-self",
      x: 2,
      y: 2,
      rotation: "up",
      kind: "subCircuit",
      logicalCircuitId: "lc-a",
    });
    expect(() => parseNativeProject(JSON.stringify(selfCycleDoc))).toThrow("Zyklische Subschaltungs-Referenz");

    // Indirekter Zyklus: A -> B -> C -> A
    const indirectCycleDoc = structuredClone(baseDoc);
    const emptyCircuitBase = {
      notation: "",
      note: "",
      category: "",
      circuitShape: "rectangular" as const,
      showLabelAbove: false,
      displayMargin: "none" as const,
      validators: "",
      exportToHDL: true,
      pins: [],
      wires: [],
      textNotes: [],
    };
    indirectCycleDoc.logicalCircuits[0].elements.push({
      symbolId: "sym-ab",
      x: 2,
      y: 2,
      rotation: "up",
      kind: "subCircuit",
      logicalCircuitId: "lc-b",
    });
    indirectCycleDoc.logicalCircuits.push(
      {
        ...emptyCircuitBase,
        logicalCircuitId: "lc-b",
        name: "B",
        elements: [
          {
            symbolId: "sym-bc",
            x: 2,
            y: 2,
            rotation: "up",
            kind: "subCircuit",
            logicalCircuitId: "lc-c",
          },
        ],
      },
      {
        ...emptyCircuitBase,
        logicalCircuitId: "lc-c",
        name: "C",
        elements: [
          {
            symbolId: "sym-ca",
            x: 2,
            y: 2,
            rotation: "up",
            kind: "subCircuit",
            logicalCircuitId: "lc-a",
          },
        ],
      },
    );

    expect(() => parseNativeProject(JSON.stringify(indirectCycleDoc))).toThrow("Zyklische Subschaltungs-Referenz");
  });
});
