import { describe, expect, it } from "vitest";

import CircuitRunner from "../../simulation/worker/circuitRunner";
import { syncProjectLogicalCircuits } from "../../utils/circuitLayout";
import { LOGIC_CIRCUIT_CURRENT_NAMESPACE } from "../../utils/xml/logicCircuitXmlConstants";
import { parseLogicCircuitXml } from "../../utils/xml/logicCircuitXmlReader";

const PC_BIT_CIRCUIT_ID = "5590c8bd-8c98-4cba-89de-3741ff26e36e";
const COUNTER_CIRCUIT_ID = "50326859-66f3-4e54-aa24-8a585556c393";
const MAIN_CIRCUIT_ID = "00000000-0000-4000-8000-000000000002";
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

function testGuid(group: string, index: number): string {
  return `${group.padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// Hilfsfunktion für kompakte CircuitSymbol-Tags unter 160 Zeichen
function symTag(
  symbolId: string,
  circuitId: string,
  logicalId: string,
  x: number,
  y: number,
  rotation?: string,
): string {
  const rotAttr = rotation ? ` Rotation="${rotation}"` : "";
  return `<lc:CircuitSymbol CircuitSymbolId="${symbolId}" CircuitId="${circuitId}" `
    + `LogicalCircuitId="${logicalId}" X="${x}" Y="${y}"${rotAttr} />`;
}

// Exakte Gatter- und Leitungsdefinition von Program Counter Bit (Res 0) + 04 Bit Counter aus Desktop LogicCircuit
function buildCounterXmlProject(): string {
  const pcBitPins = [
    // Linke Seite: CLKA, ResA, RA (Input) und CC (Output mit ausgelassenem PinSide-Default="Left")
    `<lc:Pin PinId="1c697933-64de-4d52-930f-ecc26dde9305" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="CLKA" PinType="Input" />`,
    `<lc:Pin PinId="722a279a-30e5-4ff7-bb6a-13e3ffa662f5" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="ResA" PinType="Input" />`,
    `<lc:Pin PinId="90ea8c88-8791-43d1-b47b-d88a448e54be" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="RA" PinType="Input" />`,
    `<lc:Pin PinId="5277f5b1-2333-479b-8783-491852b2fe05" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="CC" PinType="Output" />`,
    // Oben: X, Q
    `<lc:Pin PinId="fe70cbec-ca0e-439f-ac57-cebbd565f738" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="X" PinType="Input" PinSide="Top" />`,
    `<lc:Pin PinId="1d2c73ed-9ac7-4212-8204-76397eb8b154" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="Q" PinType="Output" PinSide="Top" />`,
    // Rechte Seite: CLKB, ResB, RB, CC in, CU
    `<lc:Pin PinId="2869ac54-aa19-4f14-9ef5-0596e7713de7" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="CLKB" PinType="Output" PinSide="Right" />`,
    `<lc:Pin PinId="c955b66e-024b-46e8-8d1f-b1c7f8dac9b0" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="ResB" PinType="Output" PinSide="Right" />`,
    `<lc:Pin PinId="120f9843-e349-4b46-9341-87f925634088" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="RB" PinType="Output" PinSide="Right" />`,
    `<lc:Pin PinId="fca88735-9212-4fe4-9771-b93531591f16" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="CC in" PinType="Input" PinSide="Right" />`,
    `<lc:Pin PinId="a27b3551-8b90-4666-8e50-afb7efd6e716" CircuitId="${PC_BIT_CIRCUIT_ID}" Name="CU" PinType="Input" PinSide="Right" />`,
  ];

  const pcBitSymbols = [
    symTag(testGuid("a1", 1), "00000000-0000-0000-0000-000000040201", PC_BIT_CIRCUIT_ID, 44, 56, "Right"),
    symTag(testGuid("a1", 2), "00000000-0000-0000-0000-000000040301", PC_BIT_CIRCUIT_ID, 50, 45, "Right"),
    symTag(testGuid("a1", 3), "722a279a-30e5-4ff7-bb6a-13e3ffa662f5", PC_BIT_CIRCUIT_ID, 31, 15),
    symTag(testGuid("a1", 4), "fe70cbec-ca0e-439f-ac57-cebbd565f738", PC_BIT_CIRCUIT_ID, 50, 8),
    symTag(testGuid("a1", 5), "120f9843-e349-4b46-9341-87f925634088", PC_BIT_CIRCUIT_ID, 58, 18),
    symTag(testGuid("a1", 6), "00000000-0000-0000-0000-000000020101", PC_BIT_CIRCUIT_ID, 39, 34, "Right"),
    symTag(testGuid("a1", 7), "00000000-0000-0000-0000-000000040200", PC_BIT_CIRCUIT_ID, 48, 24, "Down"),
    symTag(testGuid("a1", 8), "00000000-0000-0000-0000-000000040200", PC_BIT_CIRCUIT_ID, 34, 23, "Down"),
    symTag(testGuid("a1", 9), "a27b3551-8b90-4666-8e50-afb7efd6e716", PC_BIT_CIRCUIT_ID, 58, 28),
    symTag(testGuid("a1", 10), "fca88735-9212-4fe4-9771-b93531591f16", PC_BIT_CIRCUIT_ID, 58, 22),
    symTag(testGuid("a1", 11), "5277f5b1-2333-479b-8783-491852b2fe05", PC_BIT_CIRCUIT_ID, 31, 26),
    symTag(testGuid("a1", 12), "1d2c73ed-9ac7-4212-8204-76397eb8b154", PC_BIT_CIRCUIT_ID, 55, 8),
    symTag(testGuid("a1", 13), "90ea8c88-8791-43d1-b47b-d88a448e54be", PC_BIT_CIRCUIT_ID, 31, 18),
    symTag(testGuid("a1", 14), "2869ac54-aa19-4f14-9ef5-0596e7713de7", PC_BIT_CIRCUIT_ID, 58, 12),
    symTag(testGuid("a1", 15), "c955b66e-024b-46e8-8d1f-b1c7f8dac9b0", PC_BIT_CIRCUIT_ID, 58, 15),
    symTag(testGuid("a1", 16), "00000000-0000-0000-0000-000000030200", PC_BIT_CIRCUIT_ID, 50, 39, "Right"),
    symTag(testGuid("a1", 17), "1c697933-64de-4d52-930f-ecc26dde9305", PC_BIT_CIRCUIT_ID, 31, 12),
    symTag(testGuid("a1", 18), "00000000-0000-0000-0000-000000040201", PC_BIT_CIRCUIT_ID, 49, 50, "Right"),
    symTag(testGuid("a1", 19), "00000000-0000-0000-0000-000000030200", PC_BIT_CIRCUIT_ID, 43, 39, "Right"),
    symTag(testGuid("a1", 20), "00000000-0000-0000-0000-000000020101", PC_BIT_CIRCUIT_ID, 36, 51, "Right"),
    symTag(testGuid("a1", 21), "00000000-0000-0000-0000-000000040200", PC_BIT_CIRCUIT_ID, 44, 34, "Right"),
    symTag(testGuid("a1", 22), "00000000-0000-0000-0000-000000040201", PC_BIT_CIRCUIT_ID, 48, 56, "Right"),
    symTag(testGuid("a1", 23), "00000000-0000-0000-0000-000000040301", PC_BIT_CIRCUIT_ID, 43, 50, "Right"),
    symTag(testGuid("a1", 24), "00000000-0000-0000-0000-000000040201", PC_BIT_CIRCUIT_ID, 49, 61, "Right"),
    symTag(testGuid("a1", 25), "00000000-0000-0000-0000-000000040201", PC_BIT_CIRCUIT_ID, 43, 61, "Right"),
    symTag(testGuid("a1", 26), "00000000-0000-0000-0000-000000020101", PC_BIT_CIRCUIT_ID, 48, 30, "Down"),
    symTag(testGuid("a1", 27), "00000000-0000-0000-0000-000000040200", PC_BIT_CIRCUIT_ID, 51, 34, "Right"),
    symTag(testGuid("a1", 28), "00000000-0000-0000-0000-000000040301", PC_BIT_CIRCUIT_ID, 43, 45, "Right"),
  ];

  const pcBitWireCoords: [number, number, number, number][] = [
    [46, 56, 48, 56], [54, 24, 36, 24], [33, 25, 30, 25], [61, 27, 61, 29],
    [61, 29, 60, 29], [54, 24, 54, 66], [43, 26, 36, 26], [51, 49, 51, 51],
    [44, 35, 44, 34], [50, 32, 53, 32], [53, 9, 52, 9], [30, 27, 31, 27],
    [40, 16, 40, 35], [40, 38, 40, 50], [54, 9, 54, 24], [61, 25, 61, 23],
    [61, 23, 60, 23], [44, 19, 33, 19], [30, 25, 30, 27], [37, 44, 37, 13],
    [61, 27, 50, 27], [53, 32, 53, 9], [54, 9, 55, 9], [44, 54, 44, 55],
    [47, 26, 43, 26], [52, 38, 52, 40], [53, 32, 53, 35], [50, 55, 50, 57],
    [44, 34, 44, 19], [47, 32, 46, 32], [46, 32, 46, 35], [44, 34, 51, 34],
    [43, 39, 43, 26], [45, 38, 45, 40], [45, 50, 45, 51], [49, 50, 49, 51],
    [44, 55, 44, 57], [37, 44, 37, 52], [51, 43, 51, 46], [43, 40, 43, 39],
    [43, 39, 50, 39], [43, 50, 40, 50], [44, 43, 44, 46], [50, 39, 50, 40],
    [37, 56, 37, 55], [43, 51, 43, 50], [45, 44, 50, 44], [44, 49, 44, 51],
    [45, 44, 37, 44], [48, 50, 49, 50], [50, 55, 48, 55], [50, 44, 50, 46],
    [45, 46, 45, 44], [50, 54, 50, 55], [44, 55, 46, 55], [46, 55, 48, 50],
    [46, 50, 45, 50], [51, 61, 53, 61], [50, 66, 54, 66], [48, 56, 48, 57],
    [46, 56, 37, 56], [37, 13, 33, 13], [51, 62, 51, 61], [46, 61, 48, 66],
    [43, 61, 46, 61], [42, 61, 42, 45], [42, 45, 43, 45], [43, 61, 42, 61],
    [46, 57, 46, 56], [43, 62, 43, 61], [44, 66, 46, 66], [52, 46, 52, 45],
    [45, 62, 45, 60], [52, 45, 53, 45], [49, 60, 49, 62], [53, 45, 53, 61],
    [48, 61, 46, 66], [61, 25, 50, 25], [50, 66, 48, 66], [50, 65, 50, 66],
    [58, 13, 37, 13], [40, 16, 58, 16], [40, 16, 33, 16], [44, 65, 44, 66],
    [58, 19, 44, 19], [43, 45, 43, 46], [48, 61, 51, 61], [51, 34, 51, 35],
    [48, 55, 46, 50],
  ];

  const pcBitWires = pcBitWireCoords.map(
    ([x1, y1, x2, y2], idx) =>
      `<lc:Wire WireId="${testGuid("b1", idx + 1)}" LogicalCircuitId="${PC_BIT_CIRCUIT_ID}" X1="${x1}" Y1="${y1}" X2="${x2}" Y2="${y2}" />`,
  );

  const counterPinIds = {
    clk: testGuid("c0", 1),
    r: testGuid("c0", 2),
    re: testGuid("c0", 3),
    x3: testGuid("c0", 4),
    x2: testGuid("c0", 5),
    x1: testGuid("c0", 6),
    x0: testGuid("c0", 7),
    q3: testGuid("c0", 8),
    q2: testGuid("c0", 9),
    q1: testGuid("c0", 10),
    q0: testGuid("c0", 11),
    q: testGuid("c0", 12),
  };

  const counterPins = [
    `<lc:Pin PinId="${counterPinIds.clk}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="CLK" PinType="Input" />`,
    `<lc:Pin PinId="${counterPinIds.r}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="R" PinType="Input" />`,
    `<lc:Pin PinId="${counterPinIds.re}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="RE" PinType="Input" />`,
    `<lc:Pin PinId="${counterPinIds.x3}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="X3" PinType="Input" PinSide="Top" />`,
    `<lc:Pin PinId="${counterPinIds.x2}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="X2" PinType="Input" PinSide="Top" />`,
    `<lc:Pin PinId="${counterPinIds.x1}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="X1" PinType="Input" PinSide="Top" />`,
    `<lc:Pin PinId="${counterPinIds.x0}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="X0" PinType="Input" PinSide="Top" />`,
    `<lc:Pin PinId="${counterPinIds.q3}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="Q3" PinType="Output" PinSide="Bottom" />`,
    `<lc:Pin PinId="${counterPinIds.q2}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="Q2" PinType="Output" PinSide="Bottom" />`,
    `<lc:Pin PinId="${counterPinIds.q1}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="Q1" PinType="Output" PinSide="Bottom" />`,
    `<lc:Pin PinId="${counterPinIds.q0}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="Q0" PinType="Output" PinSide="Bottom" />`,
    `<lc:Pin PinId="${counterPinIds.q}" CircuitId="${COUNTER_CIRCUIT_ID}" Name="Q" PinType="Output" PinSide="Right" BitWidth="4" />`,
  ];

  const cConstId = testGuid("c1", 1);
  const cSplitId = testGuid("c1", 2);

  const counterSymbols = [
    `<lc:Constant ConstantId="${cConstId}" BitWidth="1" Value="1" PinSide="Left" />`,
    `<lc:Splitter SplitterId="${cSplitId}" BitWidth="4" PinCount="4" Clockwise="True" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 1)}" CircuitId="${PC_BIT_CIRCUIT_ID}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="56" Y="32" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 2)}" CircuitId="${PC_BIT_CIRCUIT_ID}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="46" Y="32" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 3)}" CircuitId="${PC_BIT_CIRCUIT_ID}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="36" Y="32" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 4)}" CircuitId="${PC_BIT_CIRCUIT_ID}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="26" Y="32" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 5)}" CircuitId="${counterPinIds.clk}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="17" Y="32" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 6)}" CircuitId="${counterPinIds.r}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="17" Y="35" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 7)}" CircuitId="${counterPinIds.re}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="17" Y="38" />`,
    symTag(testGuid("c2", 8), "00000000-0000-0000-0000-000000020101", COUNTER_CIRCUIT_ID, 22, 37),
    symTag(testGuid("c2", 9), cConstId, COUNTER_CIRCUIT_ID, 61, 35),
    symTag(testGuid("c2", 10), cSplitId, COUNTER_CIRCUIT_ID, 59, 26, "Down"),
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 11)}" CircuitId="${counterPinIds.q}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="61" Y="28" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 12)}" CircuitId="${counterPinIds.x3}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="24" Y="23" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 13)}" CircuitId="${counterPinIds.q3}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="29" Y="23" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 14)}" CircuitId="${counterPinIds.x2}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="34" Y="23" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 15)}" CircuitId="${counterPinIds.q2}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="39" Y="23" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 16)}" CircuitId="${counterPinIds.x1}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="44" Y="23" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 17)}" CircuitId="${counterPinIds.q1}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="49" Y="23" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 18)}" CircuitId="${counterPinIds.x0}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="54" Y="23" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("c2", 19)}" CircuitId="${counterPinIds.q0}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X="59" Y="23" />`,
  ];

  const counterWireCoords: [number, number, number, number][] = [
    [50, 39, 50, 37], [58, 24, 59, 24], [26, 24, 27, 24], [19, 39, 21, 39],
    [21, 39, 22, 39], [59, 29, 48, 29], [38, 28, 38, 32], [59, 27, 28, 27],
    [28, 27, 28, 32], [60, 29, 61, 29], [48, 29, 48, 32], [59, 28, 38, 28],
    [58, 30, 59, 30], [58, 30, 58, 32], [21, 39, 21, 35], [21, 35, 26, 35],
    [37, 24, 37, 32], [56, 24, 57, 24], [57, 24, 57, 32], [25, 39, 30, 39],
    [46, 24, 47, 24], [47, 24, 47, 32], [27, 24, 27, 32], [36, 24, 37, 24],
    [38, 28, 38, 24], [28, 24, 29, 24], [20, 34, 20, 36], [20, 36, 19, 36],
    [38, 24, 39, 24], [28, 27, 28, 24], [48, 29, 48, 24], [48, 24, 49, 24],
    [40, 39, 40, 37], [30, 39, 30, 37], [30, 37, 29, 37], [58, 30, 58, 24],
    [40, 37, 39, 37], [40, 39, 30, 39], [50, 37, 49, 37], [50, 39, 40, 39],
    [29, 33, 36, 33], [49, 33, 56, 33], [49, 35, 56, 35], [60, 37, 59, 37],
    [60, 37, 60, 39], [60, 39, 50, 39], [20, 34, 26, 34], [61, 36, 59, 36],
    [49, 34, 56, 34], [49, 36, 56, 36], [29, 36, 36, 36], [39, 35, 46, 35],
    [39, 36, 46, 36], [19, 33, 26, 33], [39, 33, 46, 33], [39, 34, 46, 34],
    [29, 34, 36, 34], [29, 35, 36, 35],
  ];

  const counterWires = counterWireCoords.map(
    ([x1, y1, x2, y2], idx) =>
      `<lc:Wire WireId="${testGuid("d1", idx + 1)}" LogicalCircuitId="${COUNTER_CIRCUIT_ID}" X1="${x1}" Y1="${y1}" X2="${x2}" Y2="${y2}" />`,
  );

  const btnResetId = testGuid("e0", 1);
  const constZeroId = testGuid("e0", 2);
  const probeId = testGuid("e0", 3);
  const matrixId = testGuid("e0", 4);
  const probeSymId = testGuid("e1", 5);
  const matrixSymId = testGuid("e1", 6);

  // Main-Testbench: 04 Bit Counter an Takt, Reset-Button, RE=0, Probe (4-bit) und LED-Matrix (Individual 1x4)
  const mainElements = [
    `<lc:CircuitButton CircuitButtonId="${btnResetId}" Notation="Reset" PinSide="Right" />`,
    `<lc:Constant ConstantId="${constZeroId}" BitWidth="1" Value="0" PinSide="Right" />`,
    `<lc:CircuitProbe CircuitProbeId="${probeId}" Name="Value" PinSide="Left" />`,
    `<lc:LedMatrix LedMatrixId="${matrixId}" MatrixType="Individual" CellShape="Round" Rows="1" Columns="4" Colors="1" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("e1", 1)}" CircuitId="${COUNTER_CIRCUIT_ID}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="14" Y="9" />`,
    symTag(testGuid("e1", 2), "00000000-0000-0000-0000-000000010000", MAIN_CIRCUIT_ID, 8, 9),
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("e1", 3)}" CircuitId="${btnResetId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="8" Y="10" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${testGuid("e1", 4)}" CircuitId="${constZeroId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="8" Y="11" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${probeSymId}" CircuitId="${probeId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="22" Y="10" />`,
    `<lc:CircuitSymbol CircuitSymbolId="${matrixSymId}" CircuitId="${matrixId}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X="22" Y="13" />`,
    `<lc:Wire WireId="${testGuid("e2", 1)}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="10" Y1="10" X2="14" Y2="10" />`,
    `<lc:Wire WireId="${testGuid("e2", 2)}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="10" Y1="11" X2="14" Y2="11" />`,
    `<lc:Wire WireId="${testGuid("e2", 3)}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="10" Y1="12" X2="14" Y2="12" />`,
    `<lc:Wire WireId="${testGuid("e2", 4)}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="19" Y1="11" X2="22" Y2="11" />`,
    `<lc:Wire WireId="${testGuid("e2", 5)}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="20" Y1="11" X2="20" Y2="14" />`,
    `<lc:Wire WireId="${testGuid("e2", 6)}" LogicalCircuitId="${MAIN_CIRCUIT_ID}" X1="20" Y1="14" X2="22" Y2="14" />`,
  ];

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<lc:CircuitProject xmlns:lc="${LOGIC_CIRCUIT_CURRENT_NAMESPACE}">
  <lc:Project ProjectId="${PROJECT_ID}" Name="CounterTest" LogicalCircuitId="${MAIN_CIRCUIT_ID}" />
  <lc:LogicalCircuit LogicalCircuitId="${MAIN_CIRCUIT_ID}" Name="Main" Notation="Main" />
  <lc:LogicalCircuit LogicalCircuitId="${COUNTER_CIRCUIT_ID}" Name="04 Bit Counter" Notation="Count 4 Bit" />
  <lc:LogicalCircuit LogicalCircuitId="${PC_BIT_CIRCUIT_ID}" Name="Program Counter Bit (Res 0)" Notation="PC Bit (R 0)" />
  ${pcBitPins.join("\n  ")}
  ${counterPins.join("\n  ")}
  ${pcBitSymbols.join("\n  ")}
  ${pcBitWires.join("\n  ")}
  ${counterSymbols.join("\n  ")}
  ${counterWires.join("\n  ")}
  ${mainElements.join("\n  ")}
</lc:CircuitProject>`;

  return xml;
}

describe("04 Bit Counter & Program Counter Bit Submodul-Verdrahtung", () => {
  it("importiert Output-Pin ohne PinSide als Left (XML-Default) und zaehlt im 04-Bit-Counter sauber hoch", () => {
    const project = parseLogicCircuitXml(buildCounterXmlProject());

    const ccPin = project.pins.find((p) => p.circuitId === PC_BIT_CIRCUIT_ID && p.name === "CC");
    expect(ccPin?.pinType).toBe("output");
    expect(ccPin?.pinSide).toBe("left");

    const pcBit = project.logicalCircuits.find((c) => c.logicalCircuitId === PC_BIT_CIRCUIT_ID)!;
    expect(pcBit.symbolWidth).toBe(3);
    expect(pcBit.symbolHeight).toBe(6);

    const mainCircuit = project.logicalCircuits.find((c) => c.logicalCircuitId === MAIN_CIRCUIT_ID)!;
    const runner = new CircuitRunner(mainCircuit, { frameRateLimit: 10 });
    expect(runner.isOscillating).toBe(false);

    const btnResetId = testGuid("e0", 1);

    // Ueber Reset + Taktflanke definiert auf 0 zuruecksetzen und danach ohne Reset-Taster weiterzaehlen
    runner.step(0);
    expect(runner.setButtonState(btnResetId, true)).toBe(true);
    runner.step(0);
    const resetSnap = runner.getSnapshot();
    const resetVal = Object.values(resetSnap.probes)[0]?.value;
    expect(resetVal).not.toBeNull();

    expect(runner.setButtonState(btnResetId, false)).toBe(true);
    runner.step(0);
    // Pruefe ob asynchroner Reset bereits auf 0 setzt:
    const afterRelease = Object.values(runner.getSnapshot().probes)[0]?.value;

    // 10 einzelne Taktflanken (Halbwellen) ausfuehren: jede volle Taktperiode zaehlt sauber hoch (0 -> 1 -> 2 -> 3 -> 4 -> 5)
    const halfCycleValues: (number | null)[] = [];
    const matrixSnapshots: (number[] | undefined)[] = [];
    for (let i = 0; i < 10; i++) {
      runner.step(1);
      const snap = runner.getSnapshot();
      halfCycleValues.push(Object.values(snap.probes)[0]?.value ?? null);
      matrixSnapshots.push(Object.values(snap.ledMatrices ?? {})[0]?.[0]);
    }
    expect({ afterRelease, halfCycleValues }).toEqual({
      afterRelease: 0,
      halfCycleValues: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5],
    });
    // LED-Matrix im Individual-Modus spiegelt denselben 4-Bit-Zaehlerstand (bei halben Flanken: ..., Wert 5 am Ende)
    expect(matrixSnapshots[1]).toHaveLength(4);
    expect(matrixSnapshots[9]).toHaveLength(4);
  });

  it("schrumpft Subcircuit-Hoehe nach Verschieben eines Pins von right auf left zurueck auf 6", () => {
    const project = parseLogicCircuitXml(buildCounterXmlProject());
    const ccPin = project.pins.find((p) => p.circuitId === PC_BIT_CIRCUIT_ID && p.name === "CC")!;

    // Simuliere zuerst einen auf die rechte Seite verschobenen Pin -> Hoehe waechst auf 7
    ccPin.pinSide = "right";
    const grownProject = syncProjectLogicalCircuits(project);
    const grown = grownProject.logicalCircuits.find((c) => c.logicalCircuitId === PC_BIT_CIRCUIT_ID)!;
    expect(grown.symbolHeight).toBe(7);

    // Nach Rueckverschiebung auf links muss das Nicht-Display-Symbol wieder auf 6 schrumpfen
    ccPin.pinSide = "left";
    const shrunkProject = syncProjectLogicalCircuits(grownProject);
    const shrunk = shrunkProject.logicalCircuits.find((c) => c.logicalCircuitId === PC_BIT_CIRCUIT_ID)!;
    expect(shrunk.symbolHeight).toBe(6);
  });
});
