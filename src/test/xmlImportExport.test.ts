import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import CircuitContext from "../contexts/circuitContext";
import CircuitContextProvider from "../contexts/circuitContext/provider";
import SimulationContextProvider from "../contexts/simulationContext/provider";

import type CircuitSymbol from "../types/circuit/circuitSymbol";
import type Gate from "../types/circuit/gate";

import CircuitMap from "../simulation/compiler/circuitMap";
import FunctionProbe from "../simulation/functions/io/functionProbe";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createConstant,
  createDefaultLogicalCircuit,
  createDemoCircuitProject,
  createEmptyCircuitProject,
  createGate,
  createLedMatrix,
  createPinCircuit,
  createSensor,
  createSound,
  getGateGuid,
  getGraphicsArrayAddressBitWidth,
} from "../utils/circuitLayout";
import { createWire } from "../utils/wireUtils";
import { analyzeDesktopExportCompatibility } from "../utils/xml/desktopExportCompatibility";
import {
  LOGIC_CIRCUIT_CURRENT_NAMESPACE,
  LOGIC_CIRCUIT_DESKTOP_NAMESPACE,
  SOUND_WEB_DEFAULTS,
} from "../utils/xml/logicCircuitXmlConstants";
import {
  importProjectFromXml,
  isSupportedLogicCircuitFile,
  parseLogicCircuitSnippetXml,
  parseLogicCircuitXml,
} from "../utils/xml/logicCircuitXmlReader";
import {
  buildDesktopProjectFileName,
  exportProjectToXml,
  serializeSelectionToXml,
} from "../utils/xml/logicCircuitXmlWriter";

import AppHeader from "../components/app/appHeader";

const ContextCapture: React.FC<{
  onContext: (context: React.ContextType<typeof CircuitContext>) => void;
}> = ({ onContext }) => {
  const context = React.useContext(CircuitContext);
  onContext(context);
  return null;
};

const MAIN_CIRCUIT_ID = "e5740eb6-ace6-4379-af8f-e0829efd76d7";
const SUB_CIRCUIT_ID = "abd89a50-0165-41a9-a47f-fadf22479b7d";
const PROJECT_ID = "4cb53e31-368c-456d-85d0-72129c198791";

describe("LogicCircuit XML Deserializer (T-038)", () => {
  it("importiert ein vollständiges 2.0.0.15-Projekt inklusive langer Child-Elemente und aller Entitäten", () => {
    let rawBinary = "";
    for (let i = 0; i < 3200; i++) {
      rawBinary += String.fromCharCode(0xab);
    }
    const longMemoryData = btoa(rawBinary);
    const longText = `${"Z".repeat(4250)}Ende`;
    const flowDocXml = [
      "<FlowDocument xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\">",
      "<Paragraph><Run>Erste Zeile</Run><LineBreak /><Run>Zweite Zeile</Run></Paragraph>",
      "<Paragraph><Run>Dritte Zeile</Run></Paragraph>",
      "</FlowDocument>",
    ]
      .join("")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const pinInId = "10000000-0000-0000-0000-000000000001";
    const pinOutId = "10000000-0000-0000-0000-000000000002";
    const probeNamedId = "20000000-0000-0000-0000-000000000001";
    const probeUnnamedId = "20000000-0000-0000-0000-000000000002";
    const constId = "30000000-0000-0000-0000-000000000001";
    const buttonId = "40000000-0000-0000-0000-000000000001";
    const romId = "50000000-0000-0000-0000-000000000001";
    const ramId = "50000000-0000-0000-0000-000000000002";
    const matrixId = "60000000-0000-0000-0000-000000000001";
    const splitterId = "70000000-0000-0000-0000-000000000001";
    const sensorId = "80000000-0000-0000-0000-000000000001";
    const soundId = "90000000-0000-0000-0000-000000000001";
    const graphicsArrayId = "a0000000-0000-0000-0000-000000000001";

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:Project
    ProjectId="${PROJECT_ID.toUpperCase()}"
    Name="Volltest-Projekt"
    Note="Projektnotiz"
    LogicalCircuitId="${MAIN_CIRCUIT_ID.toUpperCase()}"
    StartupCircuitId="${SUB_CIRCUIT_ID}"
    Zoom="1.5"
    Frequency="25"
    IsMaximumSpeed="True" />
  <lc:CollapsedCategory Name="Gatter" />
  <lc:CollapsedCategory Name="UnbenutzteKategorie" />
  <lc:LogicalCircuit
    LogicalCircuitId="${MAIN_CIRCUIT_ID}"
    Name="Haupt"
    Notation="H"
    Note="Hauptschaltung"
    Category="Gatter"
    IsDisplay="False"
    Validators="01=10" />
  <lc:LogicalCircuit
    LogicalCircuitId="${SUB_CIRCUIT_ID}"
    Name="SubDisplay"
    Notation="SD"
    Note=""
    Category=""
    IsDisplay="True" />
  <lc:Pin
    PinId="${pinInId}"
    CircuitId="${SUB_CIRCUIT_ID}"
    Name="A"
    Note="Eingang A"
    BitWidth="4"
    PinType="Input"
    PinSide="Left"
    Inverted="True"
    JamNotation="JA"
    Index="0" />
  <lc:Pin
    PinId="${pinOutId}"
    CircuitId="${SUB_CIRCUIT_ID}"
    Name="Y"
    Note="Ausgang Y"
    BitWidth="4"
    PinType="Output"
    PinSide="Right"
    Inverted="False"
    JamNotation="JY"
    Index="1" />
  <lc:CircuitProbe CircuitProbeId="${probeNamedId}" Name="Messpunkt" Note="Sonde 1" PinSide="Bottom" />
  <lc:CircuitProbe CircuitProbeId="${probeUnnamedId}" Name="${probeUnnamedId.toUpperCase()}" Note="" PinSide="Left" />
  <lc:Constant ConstantId="${constId}" BitWidth="8" Value="42" PinSide="Right" Note="Konstante 42" />
  <lc:CircuitButton CircuitButtonId="${buttonId}" Notation="BTN" IsToggle="True" PinSide="Right" Inverted="False" Width="3" Height="3" Note="Taster" />
  <lc:Memory MemoryId="${romId}" Writable="False" WriteOn1="False" OnStart="Zeros" AddressBitWidth="8" DataBitWidth="16" DualPort="False" Note="ROM">
    <lc:Data>${longMemoryData}</lc:Data>
  </lc:Memory>
  <lc:Memory MemoryId="${ramId}" Writable="True" WriteOn1="True" OnStart="Random" AddressBitWidth="4" DataBitWidth="8" DualPort="True" Data="AQID" Note="RAM" />
  <lc:LedMatrix LedMatrixId="${matrixId}" MatrixType="Selector" CellShape="Rect" Rows="6" Columns="8" Colors="3" Note="Matrix" />
  <lc:Splitter SplitterId="${splitterId}" BitWidth="8" PinCount="2" Clockwise="False" Note="8-zu-4 Splitter" />
  <lc:Sensor SensorId="${sensorId}" SensorType="Sequence" BitWidth="8" PinSide="Right" Notation="SEQ" Data="01 02 03" Note="Sensor" />
  <lc:Sound SoundId="${soundId}" Notation="SND" PinSide="Left" Note="Piezo" />
  <lc:GraphicsArray
    GraphicsArrayId="${graphicsArrayId}"
    WriteOn1="True"
    OnStart="Ones"
    DataBitWidth="4"
    Width="16"
    Height="8"
    BitsPerPixel="2"
    Note="VRAM" />
  <lc:CircuitSymbol
    CircuitSymbolId="c1000000-0000-0000-0000-000000000001"
    CircuitId="${probeNamedId}"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}"
    X="2"
    Y="2"
    Rotation="Right" />
  <lc:CircuitSymbol
    CircuitSymbolId="c1000000-0000-0000-0000-000000000002"
    CircuitId="${probeUnnamedId}"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}"
    X="6"
    Y="2"
    Rotation="Up" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000003" CircuitId="${constId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="10" Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000004" CircuitId="${buttonId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="14" Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000005" CircuitId="${romId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="18" Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000006" CircuitId="${ramId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="24" Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000007" CircuitId="${matrixId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="30" Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000008" CircuitId="${splitterId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="40" Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000009" CircuitId="${sensorId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="46" Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000010" CircuitId="${soundId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="50" Y="2" />
  <lc:CircuitSymbol
    CircuitSymbolId="c1000000-0000-0000-0000-000000000011"
    CircuitId="${graphicsArrayId}"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}"
    X="56"
    Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000012" CircuitId="${pinInId}" LogicalCircuitId="${SUB_CIRCUIT_ID}" X="4" Y="4" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000013" CircuitId="${pinOutId}" LogicalCircuitId="${SUB_CIRCUIT_ID}" X="12" Y="4" />
  <lc:CircuitSymbol CircuitSymbolId="c1000000-0000-0000-0000-000000000014" CircuitId="${SUB_CIRCUIT_ID}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="64" Y="2" />
  <lc:Wire WireId="d1000000-0000-0000-0000-000000000001" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="2" Y1="8" X2="6" Y2="8" />
  <lc:Wire WireId="d1000000-0000-0000-0000-000000000003" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="6" Y1="8" X2="10" Y2="8" />
  <lc:Wire WireId="d1000000-0000-0000-0000-000000000002" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="6" Y1="8" X2="6" Y2="12" />
  <lc:TextNote
    TextNoteId="e1000000-0000-0000-0000-000000000001"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}"
    X="2"
    Y="14"
    Width="12"
    Height="6"
    Note="Einfacher Text"
    Rotation="Down" />
  <lc:TextNote
    TextNoteId="e1000000-0000-0000-0000-000000000002"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}"
    X="16"
    Y="14"
    Width="20"
    Height="8"
    Note="${flowDocXml}" />
  <lc:TextNote TextNoteId="e1000000-0000-0000-0000-000000000003" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="40" Y="14" Width="10" Height="5">
    <lc:Note>${longText}</lc:Note>
  </lc:TextNote>
</lc:CircuitProject>`;

    const imported = parseLogicCircuitXml(xml);

    expect(imported.project.projectId).toBe(PROJECT_ID);
    expect(imported.project.name).toBe("Volltest-Projekt");
    expect(imported.project.note).toBe("Projektnotiz");
    expect(imported.project.logicalCircuitId).toBe(MAIN_CIRCUIT_ID);
    expect(imported.project.startupCircuitId).toBe(SUB_CIRCUIT_ID);
    expect(imported.project.zoom).toBe(1.5);
    expect(imported.project.frequency).toBe(25);
    expect(imported.project.isMaximumSpeed).toBe(true);

    // Nur genutzte CollapsedCategories dürfen erhalten bleiben
    expect(imported.collapsedCategories.map((c) => c.name)).toEqual(["Gatter"]);

    const mainLc = imported.logicalCircuits.find((c) => c.logicalCircuitId === MAIN_CIRCUIT_ID);
    const subLc = imported.logicalCircuits.find((c) => c.logicalCircuitId === SUB_CIRCUIT_ID);
    expect(mainLc?.validators).toBe("01=10");
    expect(mainLc?.conductorMap?.junctionPoints).toEqual([{ x: 6, y: 8 }]);
    expect(subLc?.circuitShape).toBe("display");
    expect(subLc?.isDisplay).toBe(true);
    expect(subLc?.pins.map((p) => p.name)).toEqual(["A", "Y"]);
    expect(subLc?.symbolWidth).toBeGreaterThanOrEqual(3);
    expect(subLc?.symbolHeight).toBeGreaterThanOrEqual(2);

    const namedProbe = imported.circuitProbes.find((p) => p.circuitProbeId === probeNamedId);
    const unnamedProbe = imported.circuitProbes.find((p) => p.circuitProbeId === probeUnnamedId);
    expect(namedProbe?.name).toBe("Messpunkt");
    expect(namedProbe?.pinSide).toBe("bottom");
    expect(unnamedProbe?.name).toBe(probeUnnamedId);
    expect(unnamedProbe?.notation).toBe("?");

    expect(imported.constants[0]?.value).toBe(42);
    expect(imported.constants[0]?.bitWidth).toBe(8);

    expect(imported.circuitButtons[0]?.notation).toBe("BTN");
    expect(imported.circuitButtons[0]?.isToggle).toBe(true);
    expect(imported.circuitButtons[0]?.symbolWidth).toBe(3);

    const rom = imported.memories.find((m) => m.memoryId === romId);
    const ram = imported.memories.find((m) => m.memoryId === ramId);
    expect(rom?.writable).toBe(false);
    expect(rom?.onStart).toBe("zeros");
    expect(rom?.data).toBe(longMemoryData);
    expect(ram?.writable).toBe(true);
    expect(ram?.dualPort).toBe(true);
    expect(ram?.writeOn1).toBe(true);

    expect(imported.ledMatrices[0]?.matrixType).toBe("selector");
    expect(imported.ledMatrices[0]?.cellShape).toBe("rect");
    expect(imported.ledMatrices[0]?.rows).toBe(6);
    expect(imported.ledMatrices[0]?.columns).toBe(8);
    expect(imported.ledMatrices[0]?.colors).toBe(3);

    expect(imported.splitters[0]?.bitWidth).toBe(8);
    expect(imported.splitters[0]?.pinCount).toBe(2);
    expect(imported.splitters[0]?.clockwise).toBe(false);
    expect(imported.splitters[0]?.pins).toHaveLength(3);

    expect(imported.sensors[0]?.sensorType).toBe("sequence");
    expect(imported.sensors[0]?.data).toBe("01 02 03");

    expect(imported.sounds[0]?.notation).toBe("SND");
    expect(imported.sounds[0]?.frequency).toBe(SOUND_WEB_DEFAULTS.frequency);
    expect(imported.sounds[0]?.waveform).toBe(SOUND_WEB_DEFAULTS.waveform);

    expect(imported.graphicsArrays[0]?.width).toBe(16);
    expect(imported.graphicsArrays[0]?.height).toBe(8);
    expect(imported.graphicsArrays[0]?.bitsPerPixel).toBe(2);
    expect(
      imported.graphicsArrays[0]?.pins.some(
        (p) => p.bitWidth === getGraphicsArrayAddressBitWidth(4, 2, 16, 8),
      ),
    ).toBe(true);

    const subSymInMain = imported.circuitSymbols.find((s) => s.circuitSymbolId === "c1000000-0000-0000-0000-000000000014");
    expect(subSymInMain?.jams).toHaveLength(2);
    expect(subSymInMain?.jams.every((jam) => Boolean(jam.innerJam))).toBe(true);

    expect(imported.textNotes).toHaveLength(3);
    expect(imported.textNotes[0]?.note).toBe("Einfacher Text");
    expect(imported.textNotes[0]?.rotation).toBe("down");
    expect(imported.textNotes[1]?.note).toBe("Erste Zeile\nZweite Zeile\nDritte Zeile");
    expect(imported.textNotes[2]?.note).toBe(longText);
  });

  it("löst deterministische Gate-GUIDs inklusive LED-Farben und 7-Segment-Anzeigen korrekt auf", () => {
    const andGuid = getGateGuid("and", 3, false);
    const nandGuid = getGateGuid("and", 2, true);
    const orGuid = getGateGuid("or", 2, false);
    const norGuid = getGateGuid("or", 2, true);
    const xorGuid = getGateGuid("xor", 2, false);
    const xnorGuid = getGateGuid("xor", 2, true);
    const notGuid = getGateGuid("not", 1, true);
    const clockGuid = getGateGuid("clock", 0, false);
    const ledDefaultGuid = getGateGuid("led", 1, false);
    const ledGreenGuid = `${getGateGuid("led", 1, false)}-green`;
    const sevenSegGuid = getGateGuid("led", 8, false);
    const tri1Guid = getGateGuid("triState1", 2, false);
    const tri2Guid = getGateGuid("triState2", 2, false);

    const guids = [
      andGuid,
      nandGuid,
      orGuid,
      norGuid,
      xorGuid,
      xnorGuid,
      notGuid,
      clockGuid,
      ledDefaultGuid,
      ledGreenGuid,
      sevenSegGuid,
      tri1Guid,
      tri2Guid,
    ];

    const symbolLines = guids
      .map(
        (id, index) =>
          `<lc:CircuitSymbol CircuitSymbolId="b0000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}" ` +
          `CircuitId="${id}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="${index * 4}" Y="2" />`,
      )
      .join("\n  ");

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:Project ProjectId="${PROJECT_ID}" Name="Gates" LogicalCircuitId="${MAIN_CIRCUIT_ID}" />
  <lc:LogicalCircuit LogicalCircuitId="${MAIN_CIRCUIT_ID}" Name="Main" />
  ${symbolLines}
</lc:CircuitProject>`;

    const imported = parseLogicCircuitXml(xml);
    expect(imported.circuitSymbols).toHaveLength(guids.length);

    const andGate = imported.gates.get(andGuid) as Gate | undefined;
    expect(andGate?.gateType).toBe("and");
    expect(andGate?.inputCount).toBe(3);
    expect(andGate?.invertedOutput).toBe(false);

    const nandGate = imported.gates.get(nandGuid) as Gate | undefined;
    expect(nandGate?.gateType).toBe("and");
    expect(nandGate?.invertedOutput).toBe(true);

    const xnorGate = imported.gates.get(xnorGuid) as Gate | undefined;
    expect(xnorGate?.gateType).toBe("xor");
    expect(xnorGate?.invertedOutput).toBe(true);

    const redLed = imported.gates.get(ledDefaultGuid) as Gate | undefined;
    expect(redLed?.gateType).toBe("led");
    expect(redLed?.color).toBe("red");

    const greenLed = imported.gates.get(ledGreenGuid) as Gate | undefined;
    expect(greenLed?.gateType).toBe("led");
    expect(greenLed?.color).toBe("green");

    const sevenSeg = imported.gates.get(sevenSegGuid) as Gate | undefined;
    expect(sevenSeg?.gateType).toBe("led");
    expect(sevenSeg?.inputCount).toBe(8);

    const tri1 = imported.gates.get(tri1Guid) as Gate | undefined;
    const tri2 = imported.gates.get(tri2Guid) as Gate | undefined;
    expect(tri1?.gateType).toBe("triState1");
    expect(tri2?.gateType).toBe("triState2");
  });

  it("kompiliert und simuliert eine importierte Schaltungshierarchie mit SubCircuit und Gatter", () => {
    const notGuid = getGateGuid("not", 1, true);
    const constOneId = "31000000-0000-0000-0000-000000000001";
    const probeMainId = "21000000-0000-0000-0000-000000000001";
    const subInPinId = "11000000-0000-0000-0000-000000000001";
    const subOutPinId = "11000000-0000-0000-0000-000000000002";

    // SubCircuit: Input-Pin (4,5)->Ausgang(6,6) -> NOT (8,4) mit In(8,6)/Out(11,6) -> Output-Pin (13,5)->Eingang(13,6)
    // MainCircuit: Constant=1 (4,5)->Ausgang(6,6) -> SubCircuit (10,4) mit In(10,6)/Out(13,6) -> Probe (16,5)->Eingang(16,6)
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:Project ProjectId="${PROJECT_ID}" Name="SimTest" LogicalCircuitId="${MAIN_CIRCUIT_ID}" />
  <lc:LogicalCircuit LogicalCircuitId="${MAIN_CIRCUIT_ID}" Name="Main" />
  <lc:LogicalCircuit LogicalCircuitId="${SUB_CIRCUIT_ID}" Name="InverterSub" />
  <lc:Pin PinId="${subInPinId}" CircuitId="${SUB_CIRCUIT_ID}" Name="In" BitWidth="1" PinType="Input" PinSide="Left" Index="0" />
  <lc:Pin PinId="${subOutPinId}" CircuitId="${SUB_CIRCUIT_ID}" Name="Out" BitWidth="1" PinType="Output" PinSide="Right" Index="1" />
  <lc:Constant ConstantId="${constOneId}" BitWidth="1" Value="1" PinSide="Right" />
  <lc:CircuitProbe CircuitProbeId="${probeMainId}" Name="Ergebnis" PinSide="Left" />
  <lc:CircuitSymbol CircuitSymbolId="c2000000-0000-0000-0000-000000000001" CircuitId="${subInPinId}" LogicalCircuitId="${SUB_CIRCUIT_ID}" X="4" Y="5" />
  <lc:CircuitSymbol CircuitSymbolId="c2000000-0000-0000-0000-000000000002" CircuitId="${notGuid}" LogicalCircuitId="${SUB_CIRCUIT_ID}" X="8" Y="4" />
  <lc:CircuitSymbol CircuitSymbolId="c2000000-0000-0000-0000-000000000003" CircuitId="${subOutPinId}" LogicalCircuitId="${SUB_CIRCUIT_ID}" X="13" Y="5" />
  <lc:Wire WireId="d2000000-0000-0000-0000-000000000001" LogicalCircuitId="${SUB_CIRCUIT_ID}" X1="6" Y1="6" X2="8" Y2="6" />
  <lc:Wire WireId="d2000000-0000-0000-0000-000000000002" LogicalCircuitId="${SUB_CIRCUIT_ID}" X1="11" Y1="6" X2="13" Y2="6" />
  <lc:CircuitSymbol CircuitSymbolId="c2000000-0000-0000-0000-000000000004" CircuitId="${constOneId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="4" Y="5" />
  <lc:CircuitSymbol CircuitSymbolId="c2000000-0000-0000-0000-000000000005" CircuitId="${SUB_CIRCUIT_ID}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="10" Y="4" />
  <lc:CircuitSymbol CircuitSymbolId="c2000000-0000-0000-0000-000000000006" CircuitId="${probeMainId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="16" Y="5" />
  <lc:Wire WireId="d2000000-0000-0000-0000-000000000003" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="6" Y1="6" X2="10" Y2="6" />
  <lc:Wire WireId="d2000000-0000-0000-0000-000000000004" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="13" Y1="6" X2="16" Y2="6" />
</lc:CircuitProject>`;

    const imported = parseLogicCircuitXml(xml);
    const rootCircuit = imported.logicalCircuits.find((c) => c.logicalCircuitId === MAIN_CIRCUIT_ID);
    expect(rootCircuit).toBeDefined();

    const circuitMap = new CircuitMap(rootCircuit!);
    const state = circuitMap.apply();
    expect(state.evaluate(false)).toBe(true);

    const probes = state.probes.filter((p): p is FunctionProbe => p instanceof FunctionProbe);
    expect(probes).toHaveLength(1);
    expect(probes[0]?.label).toBe("Ergebnis");
    expect(probes[0]?.toNumeric()).toBe(0);
  });

  it("migriert Legacy-2.0.0.x-Elementformate, Description/IsDisplay und Legacy-Gate-GUIDs", () => {
    const legacyNs = "http://LogicCircuit.net/2.0.0.6/CircuitProject.xsd";
    const legacyOddGuid = "00000000-0000-0000-0000-000000060200";
    const legacyEvenGuid = "00000000-0000-0000-0000-000000070200";
    const legacyProbeGuid = "00000000-0000-0000-0000-000000090100";

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${legacyNs}">
  <lc:Project>
    <lc:ProjectId>${PROJECT_ID}</lc:ProjectId>
    <lc:Name>Legacy2x</lc:Name>
    <lc:Description>Legacy Beschreibung</lc:Description>
    <lc:LogicalCircuitId>${MAIN_CIRCUIT_ID}</lc:LogicalCircuitId>
  </lc:Project>
  <lc:LogicalCircuit>
    <lc:LogicalCircuitId>${MAIN_CIRCUIT_ID}</lc:LogicalCircuitId>
    <lc:Name>LegacyCircuit</lc:Name>
    <lc:Description>Alter Text</lc:Description>
    <lc:IsDisplay>True</lc:IsDisplay>
  </lc:LogicalCircuit>
  <lc:CircuitSymbol>
    <lc:CircuitSymbolId>c3000000-0000-0000-0000-000000000001</lc:CircuitSymbolId>
    <lc:CircuitId>${legacyOddGuid}</lc:CircuitId>
    <lc:LogicalCircuitId>${MAIN_CIRCUIT_ID}</lc:LogicalCircuitId>
    <lc:X>2</lc:X>
    <lc:Y>2</lc:Y>
  </lc:CircuitSymbol>
  <lc:CircuitSymbol>
    <lc:CircuitSymbolId>c3000000-0000-0000-0000-000000000002</lc:CircuitSymbolId>
    <lc:CircuitId>${legacyEvenGuid}</lc:CircuitId>
    <lc:LogicalCircuitId>${MAIN_CIRCUIT_ID}</lc:LogicalCircuitId>
    <lc:X>8</lc:X>
    <lc:Y>2</lc:Y>
  </lc:CircuitSymbol>
  <lc:CircuitSymbol>
    <lc:CircuitSymbolId>c3000000-0000-0000-0000-000000000003</lc:CircuitSymbolId>
    <lc:CircuitId>${legacyProbeGuid}</lc:CircuitId>
    <lc:LogicalCircuitId>${MAIN_CIRCUIT_ID}</lc:LogicalCircuitId>
    <lc:X>14</lc:X>
    <lc:Y>2</lc:Y>
  </lc:CircuitSymbol>
</lc:CircuitProject>`;

    const imported = parseLogicCircuitXml(xml);
    expect(imported.project.note).toBe("Legacy Beschreibung");
    expect(imported.logicalCircuits[0]?.note).toBe("Alter Text");
    expect(imported.logicalCircuits[0]?.circuitShape).toBe("display");

    const oddGate = imported.gates.get(getGateGuid("xor", 2, false));
    const evenGate = imported.gates.get(getGateGuid("xor", 2, true));
    expect(oddGate?.gateType).toBe("xor");
    expect(evenGate?.gateType).toBe("xor");
    expect(evenGate?.invertedOutput).toBe(true);

    // Legacy-Probe (Gate-Typ 09) wird in ein eigenständiges CircuitProbe migriert
    expect(imported.circuitProbes).toHaveLength(1);
    expect(imported.circuitProbes[0]?.circuitProbeId).toBe("c3000000-0000-0000-0000-000000000003");
  });

  it("bereinigt Nulllängen-Wires, verwaiste Circuits, doppelte Einzel-Symbole und ungültige StartupCircuitId", () => {
    const usedConstId = "32000000-0000-0000-0000-000000000001";
    const orphanConstId = "32000000-0000-0000-0000-000000000002";
    const emptyFlowDoc = "<FlowDocument xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"></FlowDocument>"
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:Project
    ProjectId="${PROJECT_ID}"
    Name="CleanupTest"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}"
    StartupCircuitId="00000000-0000-0000-0000-000000000000" />
  <lc:LogicalCircuit LogicalCircuitId="${MAIN_CIRCUIT_ID}" Name="Main" />
  <lc:Constant ConstantId="${usedConstId}" BitWidth="1" Value="1" />
  <lc:Constant ConstantId="${orphanConstId}" BitWidth="1" Value="0" />
  <lc:CircuitSymbol CircuitSymbolId="c4000000-0000-0000-0000-000000000001" CircuitId="${usedConstId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="2" Y="2" />
  <lc:CircuitSymbol CircuitSymbolId="c4000000-0000-0000-0000-000000000002" CircuitId="${usedConstId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="8" Y="2" />
  <lc:Wire WireId="d4000000-0000-0000-0000-000000000001" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="5" Y1="5" X2="5" Y2="5" />
  <lc:Wire WireId="d4000000-0000-0000-0000-000000000002" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="5" Y1="5" X2="10" Y2="5" />
  <lc:TextNote
    TextNoteId="e4000000-0000-0000-0000-000000000001"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}"
    X="2"
    Y="8"
    Width="10"
    Height="4"
    Note="${emptyFlowDoc}" />
</lc:CircuitProject>`;

    const imported = parseLogicCircuitXml(xml);

    expect(imported.project.startupCircuitId).toBeUndefined();
    expect(imported.constants.map((c) => c.constantId)).toEqual([usedConstId]);
    expect(imported.circuitSymbols.map((s) => s.circuitSymbolId)).toEqual(["c4000000-0000-0000-0000-000000000001"]);
    expect(imported.wires.map((w) => w.wireId)).toEqual(["d4000000-0000-0000-0000-000000000002"]);
    expect(imported.textNotes).toHaveLength(0);
  });

  it("unterstützt Clipboard-Snippets ohne Project-Datensatz und lehnt ungültige Formate sauber ab", () => {
    const constId = "33000000-0000-0000-0000-000000000001";
    const snippetXml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:LogicalCircuit LogicalCircuitId="${MAIN_CIRCUIT_ID}" Name="SnippetCircuit" />
  <lc:Constant ConstantId="${constId}" BitWidth="4" Value="9" />
  <lc:CircuitSymbol CircuitSymbolId="c5000000-0000-0000-0000-000000000001" CircuitId="${constId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="4" Y="6" />
</lc:CircuitProject>`;

    const snippetProject = parseLogicCircuitSnippetXml(snippetXml);
    expect(snippetProject.logicalCircuits[0]?.logicalCircuitId).toBe(MAIN_CIRCUIT_ID);
    expect(snippetProject.constants[0]?.value).toBe(9);
    expect(snippetProject.circuitSymbols).toHaveLength(1);

    expect(() => parseLogicCircuitXml("")).toThrow();
    expect(() => parseLogicCircuitXml("<OtherRoot />")).toThrow();
    expect(() =>
      parseLogicCircuitXml(
        "<lc:CircuitProject xmlns:lc=\"http://LogicCircuit.net/1.0.0.3/CircuitProject.xsd\" />",
      ),
    ).toThrow(/1\.0\.0\.x/);
    expect(() =>
      parseLogicCircuitXml(
        "<lc:CircuitProject xmlns:lc=\"http://example.com/unknown.xsd\" />",
      ),
    ).toThrow(/Schema-Version/);
  });
});

describe("LogicCircuit XML Serializer & UI (T-039)", () => {
  it("erhält beim vollständigen Roundtrip (exportProjectToXml -> importProjectFromXml) alle Daten und Simulationseigenschaften", () => {
    const project = createEmptyCircuitProject("RoundtripTest <A&B>", "Main");
    project.project.note = "Zeile 1\nZeile 2 mit \"Anführungszeichen\" & <Tags>";
    project.project.zoom = 1.75;
    project.project.frequency = 40;
    project.project.isMaximumSpeed = true;
    project.project.categoryInputOutputCollapsed = true;

    const mainCircuit = project.logicalCircuits[0];
    mainCircuit.category = "Testkategorie";
    mainCircuit.notation = "MAIN";
    mainCircuit.validators = "0=1";
    mainCircuit.exportToHDL = false;
    project.collapsedCategories = [
      { name: "Testkategorie" },
      { name: "Unbenutzt" },
    ];

    const subId = "f1000000-0000-0000-0000-000000000001";
    const subCircuit = createDefaultLogicalCircuit(subId, "SubAlu", "ALU", "Sub-Beschreibung");
    subCircuit.circuitShape = "alu";
    const { pin: subInPin, pinCircuit: subInPinCircuit } = createPinCircuit(
      "f1000000-0000-0000-0000-000000000002",
      subId,
      "input",
      "A",
      4,
      "left",
      true,
      0,
    );
    subInPin.jamNotation = "jA";
    const { pin: subOutPin, pinCircuit: subOutPinCircuit } = createPinCircuit(
      "f1000000-0000-0000-0000-000000000003",
      subId,
      "output",
      "Y",
      4,
      "left",
      false,
      1,
    );
    const subPinInSym = createCircuitSymbol(subInPinCircuit, subId, 4, 4, "up", "f1000000-0000-0000-0000-000000000004");
    const subPinOutSym = createCircuitSymbol(subOutPinCircuit, subId, 16, 4, "up", "f1000000-0000-0000-0000-000000000005");
    subCircuit.logicalPins = [subInPin, subOutPin];
    subCircuit.circuitSymbols = [subPinInSym, subPinOutSym];
    project.logicalCircuits.push(subCircuit);
    project.pins.push(subInPin, subOutPin);
    project.circuits.set(subId, subCircuit);
    project.circuits.set(subInPinCircuit.circuitId, subInPinCircuit);
    project.circuits.set(subOutPinCircuit.circuitId, subOutPinCircuit);
    project.project.startupCircuitId = subId;

    // Farbige LED (Web-Erweiterung) + langer ROM-Inhalt (> 4096 Zeichen) + FlowDocument-TextNote
    const greenLed = createGate("led", 1, false, "green");
    project.gates.set(greenLed.gateId, greenLed);
    project.circuits.set(greenLed.circuitId, greenLed);
    const greenLedSym = createCircuitSymbol(
      greenLed,
      mainCircuit.logicalCircuitId,
      12,
      8,
      "down",
      "f2000000-0000-0000-0000-000000000001",
    );

    const longRomData = "A".repeat(4300);
    const legacyWebXml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="http://LogicCircuit.net/2.0.0.15/CircuitProject.xsd">
  <lc:Project ProjectId="${PROJECT_ID}" Name="Basis" LogicalCircuitId="${MAIN_CIRCUIT_ID}" />
  <lc:LogicalCircuit LogicalCircuitId="${MAIN_CIRCUIT_ID}" Name="Main" ShowLabelAbove="True" ExportToHDL="False" />
  <lc:Memory MemoryId="51000000-0000-0000-0000-000000000001" Writable="False" AddressBitWidth="4" DataBitWidth="8" Data="${longRomData}" />
  <lc:Sound SoundId="91000000-0000-0000-0000-000000000001" Notation="Piep" Frequency="880" Waveform="square" />
  <lc:Constant ConstantId="31000000-0000-0000-0000-000000000001" BitWidth="8" Value="15" IsHex="False" />
  <lc:CircuitProbe CircuitProbeId="21000000-0000-0000-0000-000000000001" Name="HexOut" IsHex="True" PinSide="Top" />
  <lc:LedMatrix
    LedMatrixId="61000000-0000-0000-0000-000000000001"
    MatrixType="Selector"
    CellShape="Rect"
    Rows="5"
    Columns="6"
    Colors="2"
    PersistenceMultiplier="3" />
  <lc:CircuitSymbol
    CircuitSymbolId="c6000000-0000-0000-0000-000000000001"
    CircuitId="51000000-0000-0000-0000-000000000001"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="2" Y="2" />
  <lc:CircuitSymbol
    CircuitSymbolId="c6000000-0000-0000-0000-000000000002"
    CircuitId="91000000-0000-0000-0000-000000000001"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="10" Y="2" />
  <lc:CircuitSymbol
    CircuitSymbolId="c6000000-0000-0000-0000-000000000003"
    CircuitId="31000000-0000-0000-0000-000000000001"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="16" Y="2" />
  <lc:CircuitSymbol
    CircuitSymbolId="c6000000-0000-0000-0000-000000000004"
    CircuitId="21000000-0000-0000-0000-000000000001"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="22" Y="2" />
  <lc:CircuitSymbol
    CircuitSymbolId="c6000000-0000-0000-0000-000000000005"
    CircuitId="61000000-0000-0000-0000-000000000001"
    LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="28" Y="2" />
</lc:CircuitProject>`;
    const enriched = importProjectFromXml(legacyWebXml);
    expect(enriched.sounds[0]?.frequency).toBe(880);
    expect(enriched.sounds[0]?.waveform).toBe("square");
    expect(enriched.constants[0]?.isHex).toBe(false);
    expect(enriched.circuitProbes[0]?.isHex).toBe(true);
    expect(enriched.ledMatrices[0]?.persistenceMultiplier).toBe(3);
    expect(enriched.logicalCircuits[0]?.showLabelAbove).toBe(true);
    expect(enriched.logicalCircuits[0]?.exportToHDL).toBe(false);

    enriched.project = {
      ...project.project,
      projectId: enriched.project.projectId,
      logicalCircuitId: enriched.logicalCircuits[0].logicalCircuitId,
      startupCircuitId: subId,
    };
    enriched.collapsedCategories = project.collapsedCategories;
    enriched.logicalCircuits[0] = {
      ...enriched.logicalCircuits[0],
      category: "Testkategorie",
      notation: "MAIN",
      validators: "0=1",
      exportToHDL: false,
      circuitSymbols: [...enriched.logicalCircuits[0].circuitSymbols, {
        ...greenLedSym,
        logicalCircuitId: enriched.logicalCircuits[0].logicalCircuitId,
      }],
      textNotes: [{
        textNoteId: "e6000000-0000-0000-0000-000000000001",
        logicalCircuitId: enriched.logicalCircuits[0].logicalCircuitId,
        x: 4,
        y: 16,
        width: 18,
        height: 6,
        note: "Notiz Zeile 1\nNotiz Zeile 2 <Test & \"Quotes\">",
        rotation: "right",
        lineHeight: 18,
        fontFamily: "mono",
        lineHeights: [18, 12],
      }],
    };
    enriched.logicalCircuits.push({
      ...subCircuit,
      logicalCircuitId: subId,
    });
    enriched.pins.push(subInPin, subOutPin);
    enriched.circuits.set(greenLed.circuitId, greenLed);
    enriched.gates.set(greenLed.gateId, greenLed);

    const exportedXml = exportProjectToXml(enriched);

    // Desktop-Kompatibilität (2.0.0.14): Default-Namespace ohne lc:-Präfix, kein <Gate>, keine Web-only-Attribute, 36-Zeichen-GUID + FlowDocument
    expect(exportedXml).toContain(`xmlns="${LOGIC_CIRCUIT_DESKTOP_NAMESPACE}"`);
    expect(exportedXml).not.toContain("xmlns:lc=");
    expect(exportedXml).not.toContain("<lc:");
    expect(exportedXml).not.toContain("2.0.0.15");
    expect(exportedXml).not.toContain("<Gate");
    expect(exportedXml).toContain("CircuitId=\"00000000-0000-0000-0000-000000080100\"");
    expect(exportedXml).not.toContain("Color=");
    expect(exportedXml).not.toContain("IsHex=");
    expect(exportedXml).not.toContain("PersistenceMultiplier=");
    expect(exportedXml).not.toContain("Waveform=");
    expect(exportedXml).not.toContain("ShowLabelAbove=");
    expect(exportedXml).not.toContain("DisplayMargin=");
    expect(exportedXml).not.toContain("ExportToHDL=");
    expect(exportedXml).not.toContain("FontFamily=");
    expect(exportedXml).not.toContain("LineHeight=");
    expect(exportedXml).not.toContain("LineHeights=");
    expect(exportedXml).toContain("<Data>");
    expect(exportedXml).toContain("&lt;FlowDocument");

    const reimported = importProjectFromXml(exportedXml);

    expect(reimported.project.name).toBe("RoundtripTest <A&B>");
    expect(reimported.project.note).toBe("Zeile 1\nZeile 2 mit \"Anführungszeichen\" & <Tags>");
    expect(reimported.project.zoom).toBe(1.75);
    expect(reimported.project.frequency).toBe(40);
    expect(reimported.project.isMaximumSpeed).toBe(true);
    expect(reimported.project.startupCircuitId).toBe(subId);
    expect(reimported.collapsedCategories.map((c) => c.name)).toEqual(["Testkategorie"]);

    const reSub = reimported.logicalCircuits.find((c) => c.logicalCircuitId === subId);
    expect(reSub?.circuitShape).toBe("alu");
    const reSubOut = reimported.pins.find((p) => p.pinId === subOutPin.pinId);
    expect(reSubOut?.pinType).toBe("output");
    expect(reSubOut?.pinSide).toBe("left");

    expect(reimported.memories[0]?.data).toBe(longRomData);
    expect(reimported.circuitProbes[0]?.pinSide).toBe("top");

    const reNote = reimported.textNotes[0];
    expect(reNote?.note).toBe("Notiz Zeile 1\nNotiz Zeile 2 <Test & \"Quotes\">");
    expect(reNote?.rotation).toBe("right");
  });

  it("serialisiert über serializeSelectionToXml ausschließlich gewählte Elemente und transitive Subschaltungen", () => {
    const subId = "a7000000-0000-0000-0000-000000000001";
    const unusedSubId = "a7000000-0000-0000-0000-000000000002";
    const subConstId = "37000000-0000-0000-0000-000000000001";
    const mainBtnSelId = "47000000-0000-0000-0000-000000000001";
    const mainBtnOtherId = "47000000-0000-0000-0000-000000000002";

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:Project ProjectId="${PROJECT_ID}" Name="SelectionTest" LogicalCircuitId="${MAIN_CIRCUIT_ID}" />
  <lc:LogicalCircuit LogicalCircuitId="${MAIN_CIRCUIT_ID}" Name="Main" />
  <lc:LogicalCircuit LogicalCircuitId="${subId}" Name="UsedSub" />
  <lc:LogicalCircuit LogicalCircuitId="${unusedSubId}" Name="UnusedSub" />
  <lc:Pin PinId="17000000-0000-0000-0000-000000000001" CircuitId="${subId}" PinType="Output" PinSide="Right" Name="Out" />
  <lc:Constant ConstantId="${subConstId}" BitWidth="1" Value="1" />
  <lc:CircuitButton CircuitButtonId="${mainBtnSelId}" Notation="SEL" />
  <lc:CircuitButton CircuitButtonId="${mainBtnOtherId}" Notation="UNSEL" />
  <lc:CircuitSymbol
    CircuitSymbolId="c7000000-0000-0000-0000-000000000001"
    CircuitId="17000000-0000-0000-0000-000000000001"
    LogicalCircuitId="${subId}" X="10" Y="4" />
  <lc:CircuitSymbol CircuitSymbolId="c7000000-0000-0000-0000-000000000002" CircuitId="${subConstId}" LogicalCircuitId="${subId}" X="2" Y="4" />
  <lc:CircuitSymbol CircuitSymbolId="c7000000-0000-0000-0000-000000000003" CircuitId="${subId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="12" Y="6" />
  <lc:CircuitSymbol CircuitSymbolId="c7000000-0000-0000-0000-000000000004" CircuitId="${mainBtnSelId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="4" Y="6" />
  <lc:CircuitSymbol CircuitSymbolId="c7000000-0000-0000-0000-000000000005" CircuitId="${mainBtnOtherId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="4" Y="14" />
  <lc:Wire WireId="d7000000-0000-0000-0000-000000000001" LogicalCircuitId="${subId}" X1="4" Y1="5" X2="10" Y2="5" />
  <lc:Wire WireId="d7000000-0000-0000-0000-000000000002" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="6" Y1="7" X2="12" Y2="7" />
  <lc:Wire WireId="d7000000-0000-0000-0000-000000000003" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="6" Y1="15" X2="16" Y2="15" />
  <lc:TextNote TextNoteId="e7000000-0000-0000-0000-000000000001" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="2" Y="2" Note="Ausgewählt" />
  <lc:TextNote TextNoteId="e7000000-0000-0000-0000-000000000002" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="20" Y="2" Note="Nicht ausgewählt" />
</lc:CircuitProject>`;

    const project = importProjectFromXml(xml);
    const mainCircuit = project.logicalCircuits.find((c) => c.logicalCircuitId === MAIN_CIRCUIT_ID)!;

    const snippetXml = serializeSelectionToXml(
      project,
      mainCircuit,
      ["c7000000-0000-0000-0000-000000000003", "c7000000-0000-0000-0000-000000000004"],
      ["d7000000-0000-0000-0000-000000000002"],
      ["e7000000-0000-0000-0000-000000000001"],
    );

    expect(snippetXml).toContain("UsedSub");
    expect(snippetXml).toContain("SEL");
    expect(snippetXml).toContain("Ausgewählt");
    expect(snippetXml).not.toContain("UnusedSub");
    expect(snippetXml).not.toContain("UNSEL");
    expect(snippetXml).not.toContain("Nicht ausgewählt");
    expect(snippetXml).not.toContain("d7000000-0000-0000-0000-000000000003");

    const parsedSnippet = parseLogicCircuitSnippetXml(snippetXml);
    expect(parsedSnippet.logicalCircuits.map((c) => c.logicalCircuitId)).toEqual([MAIN_CIRCUIT_ID, subId]);
    expect(parsedSnippet.circuitButtons.map((b) => b.circuitButtonId)).toEqual([mainBtnSelId]);
    expect(parsedSnippet.constants.map((c) => c.constantId)).toEqual([subConstId]);
    expect(parsedSnippet.textNotes.map((n) => n.note)).toEqual(["Ausgewählt"]);
  });

  it("lädt XML-Projekte in CircuitContextProvider (mit History-Reset) und rendert Datei-Controls in AppHeader", () => {
    expect(buildDesktopProjectFileName("Mein: Test/Projekt")).toBe("Mein_ Test_Projekt.CircuitProject");
    expect(buildDesktopProjectFileName("clock.lcweb")).toBe("clock.CircuitProject");
    expect(buildDesktopProjectFileName("   ")).toBe("CircuitProject.CircuitProject");
    expect(isSupportedLogicCircuitFile("Digital Clock.CircuitProject")).toBe(true);
    expect(isSupportedLogicCircuitFile("sample.xml")).toBe(true);
    expect(isSupportedLogicCircuitFile("notes.txt")).toBe(false);

    let ctx!: React.ContextType<typeof CircuitContext>;
    const headerHtml = renderToStaticMarkup(
      React.createElement(
        CircuitContextProvider,
        null,
        React.createElement(
          SimulationContextProvider,
          null,
          React.createElement(AppHeader),
          React.createElement(ContextCapture, {
            onContext: (c) => { ctx = c; },
          }),
        ),
      ),
    );

    expect(headerHtml).toContain("Projekt öffnen (.lcweb / .CircuitProject)");
    expect(headerHtml).toContain("Projekt speichern (.lcweb)");
    expect(headerHtml).toContain("accept=\".lcweb,.CircuitProject,.xml,.json\"");

    // Vorherige Änderung + Auswahl in bestehendem Projekt erzeugen
    let addedSym: CircuitSymbol | undefined;
    React.act(() => {
      addedSym = ctx.addSymbol({ type: "and", inputCount: 2, name: "AND" }, { x: 4, y: 4 });
      ctx.selectSymbol(addedSym.circuitSymbolId);
    });
    expect(ctx.canUndo).toBe(true);
    expect(ctx.selectedSymbolIds).toHaveLength(1);

    const exportable = createEmptyCircuitProject("Importierter Plan", "Startseite");
    const exportedXml = exportProjectToXml(exportable);

    React.act(() => {
      ctx.importProjectFromXml(exportedXml);
    });

    expect(ctx.project.project.name).toBe("Importierter Plan");
    expect(ctx.currentCircuit.name).toBe("Startseite");
    expect(ctx.canUndo).toBe(false);
    expect(ctx.canRedo).toBe(false);
    expect(ctx.selectedSymbolIds).toEqual([]);
  });

  it("importiert Desktop CellShape=\"Rectangle\" korrekt als \"rect\" und serialisiert Rectangle + anonyme Probes Desktop-kompatibel", () => {
    const desktopLedXml = `<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
      <lc:Project>
        <lc:ProjectId>f1000000-0000-0000-0000-000000000001</lc:ProjectId>
        <lc:Name>LedProbeTest</lc:Name>
      </lc:Project>
      <lc:LogicalCircuit>
        <lc:LogicalCircuitId>f1000000-0000-0000-0000-000000000002</lc:LogicalCircuitId>
        <lc:Name>Main</lc:Name>
      </lc:LogicalCircuit>
      <lc:LedMatrix>
        <lc:LedMatrixId>f1000000-0000-0000-0000-000000000003</lc:LedMatrixId>
        <lc:MatrixType>Individual</lc:MatrixType>
        <lc:CellShape>Rectangle</lc:CellShape>
        <lc:Rows>1</lc:Rows>
        <lc:Columns>1</lc:Columns>
      </lc:LedMatrix>
      <lc:CircuitProbe>
        <lc:CircuitProbeId>f1000000-0000-0000-0000-000000000004</lc:CircuitProbeId>
        <lc:Name>f1000000-0000-0000-0000-000000000004</lc:Name>
      </lc:CircuitProbe>
      <lc:CircuitSymbol>
        <lc:CircuitSymbolId>f1000000-0000-0000-0000-000000000005</lc:CircuitSymbolId>
        <lc:CircuitId>f1000000-0000-0000-0000-000000000003</lc:CircuitId>
        <lc:LogicalCircuitId>f1000000-0000-0000-0000-000000000002</lc:LogicalCircuitId>
        <lc:X>5</lc:X>
        <lc:Y>5</lc:Y>
      </lc:CircuitSymbol>
      <lc:CircuitSymbol>
        <lc:CircuitSymbolId>f1000000-0000-0000-0000-000000000006</lc:CircuitSymbolId>
        <lc:CircuitId>f1000000-0000-0000-0000-000000000004</lc:CircuitId>
        <lc:LogicalCircuitId>f1000000-0000-0000-0000-000000000002</lc:LogicalCircuitId>
        <lc:X>10</lc:X>
        <lc:Y>5</lc:Y>
      </lc:CircuitSymbol>
    </lc:CircuitProject>`;

    const imported = importProjectFromXml(desktopLedXml);
    expect(imported.ledMatrices).toHaveLength(1);
    expect(imported.ledMatrices[0]?.cellShape).toBe("rect");
    expect(imported.circuitProbes).toHaveLength(1);

    // Leerer Probe-Name darf im Export nicht leer bleiben (Desktop AK_CircuitProbe_Name)
    imported.circuitProbes[0] = {
      ...imported.circuitProbes[0]!,
      name: "",
    };

    const reExported = exportProjectToXml(imported);
    expect(reExported).toContain("CellShape=\"Rectangle\"");
    expect(reExported).not.toContain("CellShape=\"Rect\"");
    expect(reExported).toContain("Name=\"f1000000-0000-0000-0000-000000000004\"");
  });

  it("erhält unterschiedliche LED-Farben auch nach vorheriger roter LED beim Projekt-Import", () => {
    const coloredLedsXml = `<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
      <lc:Project ProjectId="a1000000-0000-0000-0000-000000000001"
        Name="FarbigeLEDs" LogicalCircuitId="a1000000-0000-0000-0000-000000000002" />
      <lc:LogicalCircuit LogicalCircuitId="a1000000-0000-0000-0000-000000000002" Name="Main" Notation="Main" />
      <lc:CircuitSymbol CircuitSymbolId="a1000000-0000-0000-0000-000000000010"
        CircuitId="00000000-0000-0000-0000-000000080100"
        LogicalCircuitId="a1000000-0000-0000-0000-000000000002" X="11" Y="4" />
      <lc:CircuitSymbol CircuitSymbolId="a1000000-0000-0000-0000-000000000011"
        CircuitId="00000000-0000-0000-0000-000000080100"
        LogicalCircuitId="a1000000-0000-0000-0000-000000000002" X="11" Y="9" Color="yellow" />
      <lc:CircuitSymbol CircuitSymbolId="a1000000-0000-0000-0000-000000000012"
        CircuitId="00000000-0000-0000-0000-000000080100"
        LogicalCircuitId="a1000000-0000-0000-0000-000000000002" X="11" Y="14" Color="green" />
      <lc:CircuitSymbol CircuitSymbolId="a1000000-0000-0000-0000-000000000013"
        CircuitId="00000000-0000-0000-0000-000000080100"
        LogicalCircuitId="a1000000-0000-0000-0000-000000000002" X="11" Y="20" Color="blue" />
    </lc:CircuitProject>`;

    const imported = importProjectFromXml(coloredLedsXml);
    const bySymId = new Map(imported.circuitSymbols.map((s) => [s.circuitSymbolId, s]));

    expect((bySymId.get("a1000000-0000-0000-0000-000000000010")?.circuit as { color?: string }).color).toBe("red");
    expect((bySymId.get("a1000000-0000-0000-0000-000000000011")?.circuit as { color?: string }).color).toBe("yellow");
    expect((bySymId.get("a1000000-0000-0000-0000-000000000012")?.circuit as { color?: string }).color).toBe("green");
    expect((bySymId.get("a1000000-0000-0000-0000-000000000013")?.circuit as { color?: string }).color).toBe("blue");

    const reExported = exportProjectToXml(imported);
    expect(reExported).toContain(`xmlns="${LOGIC_CIRCUIT_DESKTOP_NAMESPACE}"`);
    expect(reExported).not.toContain("Color=");
    expect(reExported).toContain("CircuitId=\"00000000-0000-0000-0000-000000080100\"");
  });

  it("importiert Output-Pin ohne PinSide-Attribut gemaess Schema-Default als left", () => {
    const pinDefaultXml = `<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
      <lc:Project ProjectId="b1000000-0000-0000-0000-000000000001"
        Name="PinDefaultTest" LogicalCircuitId="b1000000-0000-0000-0000-000000000002" />
      <lc:LogicalCircuit LogicalCircuitId="b1000000-0000-0000-0000-000000000002" Name="Main" Notation="Main" />
      <lc:LogicalCircuit LogicalCircuitId="b1000000-0000-0000-0000-000000000003" Name="Sub" Notation="Sub" />
      <lc:Pin PinId="b1000000-0000-0000-0000-000000000010"
        CircuitId="b1000000-0000-0000-0000-000000000003" Name="CC" PinType="Output" />
      <lc:Pin PinId="b1000000-0000-0000-0000-000000000011"
        CircuitId="b1000000-0000-0000-0000-000000000003" Name="OUT_R" PinType="Output" PinSide="Right" />
      <lc:CircuitSymbol CircuitSymbolId="b1000000-0000-0000-0000-000000000020"
        CircuitId="b1000000-0000-0000-0000-000000000010"
        LogicalCircuitId="b1000000-0000-0000-0000-000000000003" X="10" Y="10" />
      <lc:CircuitSymbol CircuitSymbolId="b1000000-0000-0000-0000-000000000021"
        CircuitId="b1000000-0000-0000-0000-000000000011"
        LogicalCircuitId="b1000000-0000-0000-0000-000000000003" X="20" Y="10" />
    </lc:CircuitProject>`;

    const imported = importProjectFromXml(pinDefaultXml);
    const ccPin = imported.pins.find((p) => p.pinId === "b1000000-0000-0000-0000-000000000010");
    const rightPin = imported.pins.find((p) => p.pinId === "b1000000-0000-0000-0000-000000000011");

    expect(ccPin?.pinType).toBe("output");
    expect(ccPin?.pinSide).toBe("left");
    expect(rightPin?.pinSide).toBe("right");
  });

  it("warnt beim Desktop-Export vor Pin-Layout-Shifts und unbekannten Komponenten, ignoriert aber kosmetische Unterschiede", () => {
    expect(analyzeDesktopExportCompatibility(createDemoCircuitProject())).toEqual({
      hasWarnings: false,
      warnings: [],
    });

    // Kosmetische Web-Features (LED-Farben, showLabelAbove, Probe-Format, Constant-Hex, Persistence, Audio-Parameter, TextNote-Stil) lösen keine Warnung aus
    const cosmeticProject = createEmptyCircuitProject("Kosmetik-Test", "Main");
    const mainLc = cosmeticProject.logicalCircuits[0]!;
    mainLc.showLabelAbove = true;
    mainLc.circuitShape = "rectangular";
    const greenLed = createGate("led", 1, false, "green");
    const blueLed = createGate("led", 1, false, "blue");
    const yellowLed = createGate("led", 1, false, "yellow");
    const probeDec = createCircuitProbe("probe-dec", "P", "left", 2, 2, false);
    probeDec.displayFormat = "dec";
    const constDec = createConstant("const-dec", 4, 9, "right", false, 2, 2);
    const btnResized = createCircuitButton("btn-4x3", "BTN", true, "right", false, 4, 3);
    const matrixPersist = createLedMatrix("matrix-1", 4, 4, "individual", "round", 1, 3);
    const soundCustom = createSound("sound-1", "left", "Beep", "", 880, "square");
    mainLc.circuitSymbols.push(
      createCircuitSymbol(greenLed, mainLc.logicalCircuitId, 2, 2, "up", "sym-g"),
      createCircuitSymbol(blueLed, mainLc.logicalCircuitId, 6, 2, "up", "sym-b"),
      createCircuitSymbol(yellowLed, mainLc.logicalCircuitId, 10, 2, "up", "sym-y"),
      createCircuitSymbol(probeDec, mainLc.logicalCircuitId, 14, 2, "up", "sym-p"),
      createCircuitSymbol(constDec, mainLc.logicalCircuitId, 18, 2, "up", "sym-c"),
      createCircuitSymbol(btnResized, mainLc.logicalCircuitId, 22, 2, "up", "sym-btn"),
      createCircuitSymbol(matrixPersist, mainLc.logicalCircuitId, 28, 2, "up", "sym-m"),
      createCircuitSymbol(soundCustom, mainLc.logicalCircuitId, 36, 2, "up", "sym-s"),
    );
    mainLc.textNotes.push({
      textNoteId: "note-1",
      logicalCircuitId: mainLc.logicalCircuitId,
      x: 2,
      y: 12,
      width: 10,
      height: 4,
      note: "Notiz",
      rotation: "up",
      fontFamily: "mono",
      lineHeight: 18,
    });
    expect(analyzeDesktopExportCompatibility(cosmeticProject)).toEqual({
      hasWarnings: false,
      warnings: [],
    });

    // Display-Margin auf aktiver Display-Subschaltung, skalierte Probe/Constant/Pin sowie unbekannte Komponente müssen warnen
    const problematicProject = createEmptyCircuitProject("Margin-und-Komp-Test", "Hauptschaltung");
    const parentLc = problematicProject.logicalCircuits[0]!;
    const subDisplay = createDefaultLogicalCircuit("sub-display", "AnzeigePanel");
    subDisplay.circuitShape = "display";
    subDisplay.isDisplay = true;
    subDisplay.displayMargin = "horizontal";
    subDisplay.circuitSymbols.push(
      createCircuitSymbol(createGate("led", 1, false, "green"), subDisplay.logicalCircuitId, 4, 4, "up", "sym-sub-led"),
    );
    const subVerticalNoDisplay = createDefaultLogicalCircuit("sub-rect", "OhneDisplayBauteil");
    subVerticalNoDisplay.circuitShape = "rectangular";
    subVerticalNoDisplay.displayMargin = "vertical";
    const subNoMargin = createDefaultLogicalCircuit("sub-nomargin", "AnzeigeOhneMargin");
    subNoMargin.circuitShape = "display";
    subNoMargin.isDisplay = true;
    subNoMargin.displayMargin = "none";
    subNoMargin.circuitSymbols.push(
      createCircuitSymbol(createGate("led", 1, false, "red"), subNoMargin.logicalCircuitId, 4, 4, "up", "sym-sub-led-2"),
    );
    problematicProject.logicalCircuits.push(subDisplay, subVerticalNoDisplay, subNoMargin);

    const wideProbe = createCircuitProbe("probe-wide", "Wide", "left", 4, 2, true);
    const wideConst = createConstant("const-wide", 4, 15, "right", true, 3, 2);
    const { pinCircuit: widePinCircuit } = createPinCircuit(
      "pin-wide",
      parentLc.logicalCircuitId,
      "input",
      "A",
      1,
      "left",
      false,
      0,
      3,
      2,
    );
    const unknownElementSymbol = createCircuitSymbol(
      {
        kind: "synthesizer",
        circuitId: "synth-1",
        name: "Synthesizer",
        notation: "Synth",
        note: "",
        category: "Audio",
        isDisplay: false,
        symbolWidth: 4,
        symbolHeight: 4,
        pins: [],
      },
      parentLc.logicalCircuitId,
      30,
      2,
      "up",
      "sym-synth",
    );
    parentLc.circuitSymbols.push(
      createCircuitSymbol(subDisplay, parentLc.logicalCircuitId, 4, 4, "up", "sym-sub-inst"),
      createCircuitSymbol(wideProbe, parentLc.logicalCircuitId, 12, 4, "up", "sym-probe-wide"),
      createCircuitSymbol(wideConst, parentLc.logicalCircuitId, 18, 4, "up", "sym-const-wide"),
      createCircuitSymbol(widePinCircuit, parentLc.logicalCircuitId, 24, 4, "up", "sym-pin-wide"),
      unknownElementSymbol,
    );

    const report = analyzeDesktopExportCompatibility(problematicProject);
    expect(report.hasWarnings).toBe(true);
    expect(report.warnings.map((w) => w.code)).toEqual([
      "resized-probe-pin-shift",
      "resized-constant-pin-shift",
      "resized-pin-pin-shift",
      "unsupported-component-kind",
      "display-margin-pin-shift",
    ]);
    const marginWarning = report.warnings.find((w) => w.code === "display-margin-pin-shift");
    expect(marginWarning?.message).toContain("AnzeigePanel");
    expect(marginWarning?.message).toContain("Hauptschaltung");
    expect(marginWarning?.message).toContain("Horizontal");

    // Vertikal / Alle Seiten sowie unbekannter Gatter-Typ werden ebenfalls erkannt
    subDisplay.displayMargin = "vertical";
    expect(
      analyzeDesktopExportCompatibility(problematicProject).warnings.find(
        (w) => w.code === "display-margin-pin-shift",
      )?.message,
    ).toContain("Vertikal");

    subDisplay.displayMargin = "all";
    expect(
      analyzeDesktopExportCompatibility(problematicProject).warnings.find(
        (w) => w.code === "display-margin-pin-shift",
      )?.message,
    ).toContain("Alle Seiten");

    const badGate: Gate = {
      ...createGate("and", 2, false),
      gateType: "customGate" as unknown as Gate["gateType"],
    };
    const unsupportedGateSymbol = createCircuitSymbol(
      badGate,
      parentLc.logicalCircuitId,
      36,
      4,
      "up",
      "sym-bad-gate",
    );
    parentLc.circuitSymbols.push(unsupportedGateSymbol);
    expect(
      analyzeDesktopExportCompatibility(problematicProject).warnings.some(
        (w) => w.code === "unsupported-gate-type",
      ),
    ).toBe(true);
  });

  it("normalisiert sprechende Web-IDs, Namen, ASCII-Sensor, Grenzen und negative Koordinaten strikt für Desktop 2.0.0.14", () => {
    const project = createEmptyCircuitProject("Desktop-Norm", "Main", "default-project", "main-circuit");
    project.project.zoom = 5;
    project.project.frequency = 60;
    const mainLc = project.logicalCircuits[0]!;

    const subA = createDefaultLogicalCircuit("lc-sub-a", "DupeName");
    const subB = createDefaultLogicalCircuit("lc-sub-b", "dupename");
    project.logicalCircuits.push(subA, subB);
    project.circuits.set(subA.circuitId, subA);
    project.circuits.set(subB.circuitId, subB);

    const p1 = createPinCircuit("pin-1", subA.logicalCircuitId, "input", "DATA", 1, "left");
    const p2 = createPinCircuit("pin-2", subA.logicalCircuitId, "input", "data", 1, "left");
    subA.logicalPins.push(p1.pin, p2.pin);
    project.pins.push(p1.pin, p2.pin);
    subA.circuitSymbols.push(
      createCircuitSymbol(p1.pinCircuit, subA.logicalCircuitId, 2, 2, "up", "sym-pin-1"),
      createCircuitSymbol(p2.pinCircuit, subA.logicalCircuitId, 2, 6, "up", "sym-pin-2"),
    );

    const btn = createCircuitButton("btn-web-1", "Reset", true, "right", false, 4, 2);
    const asciiSensor = createSensor("sensor-ascii-1", "ascii", 8, "right", "KBD");
    const ledGreen = createGate("led", 1, false, "green");
    const probe1 = createCircuitProbe("probe-1", "SameName", "left", 5, 2, false);
    const probe2 = createCircuitProbe("probe-2", "samename", "left", 2, 2, false);
    const unnamedProbe = createCircuitProbe("probe-anon", "", "left", 2, 2, false);
    project.circuitButtons.push(btn);
    project.sensors.push(asciiSensor);
    project.circuitProbes.push(probe1, probe2, unnamedProbe);

    // Platzierung bei negativen Koordinaten (-4, -3) inklusive Leitung zum Prüfen der Koordinatenverschiebung
    const symBtn = createCircuitSymbol(btn, mainLc.logicalCircuitId, -4, -3, "up", "sym-btn-neg");
    const symLed = createCircuitSymbol(ledGreen, mainLc.logicalCircuitId, 0, -3, "up", "sym-led-neg");
    const symSensor = createCircuitSymbol(asciiSensor, mainLc.logicalCircuitId, 4, 2, "up", "sym-sens");
    const symP1 = createCircuitSymbol(probe1, mainLc.logicalCircuitId, 10, 2, "up", "sym-p1");
    const symP2 = createCircuitSymbol(probe2, mainLc.logicalCircuitId, 14, 2, "up", "sym-p2");
    const symPAnon = createCircuitSymbol(unnamedProbe, mainLc.logicalCircuitId, 18, 2, "up", "sym-panon");
    const wireNeg = createWire(mainLc.logicalCircuitId, { x: -4, y: -2 }, { x: 0, y: -2 }, "wire-neg-1");
    mainLc.circuitSymbols.push(symBtn, symLed, symSensor, symP1, symP2, symPAnon);
    mainLc.wires.push(wireNeg);

    const xml = exportProjectToXml(project);
    expect(xml).toContain(`xmlns="${LOGIC_CIRCUIT_DESKTOP_NAMESPACE}"`);
    expect(xml).toContain("SensorType=\"ASCII\"");
    expect(xml).toContain("Zoom=\"3\"");
    expect(xml).toContain("Frequency=\"50\"");

    // Alle *Id-Attribute müssen gültige 36-Zeichen-GUIDs sein
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const idMatches = Array.from(xml.matchAll(/\b\w*Id="([^"]+)"/g));
    expect(idMatches.length).toBeGreaterThan(5);
    for (const match of idMatches) {
      expect(match[1]).toMatch(guidPattern);
    }

    // Re-Import prüft deterministische Eindeutigkeit und verschobene >= 0 Koordinaten
    const reimported = importProjectFromXml(xml);
    expect(reimported.logicalCircuits.map((c) => c.name.toLowerCase())).not.toEqual(
      ["main", "dupename", "dupename"],
    );
    expect(new Set(reimported.logicalCircuits.map((c) => c.name.toLowerCase())).size).toBe(3);

    const reSubA = reimported.logicalCircuits.find((c) => c.name === "DupeName")!;
    expect(new Set(reSubA.logicalPins.map((p) => p.name.toLowerCase())).size).toBe(2);
    expect(new Set(reimported.circuitProbes.map((p) => p.name.toLowerCase())).size).toBe(3);

    const reMain = reimported.logicalCircuits.find((c) => c.name === "Main")!;
    for (const s of reMain.circuitSymbols) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
    }
    expect(reMain.wires[0]?.x1).toBe(0);
    expect(reMain.wires[0]?.y1).toBe(1);
    expect(reMain.wires[0]?.x2).toBe(4);
    expect(reMain.wires[0]?.y2).toBe(1);
    expect(reimported.sensors[0]?.sensorType).toBe("ascii");
  });
});
