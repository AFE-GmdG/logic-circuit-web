import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  circuitContainsDisplays,
  createCircuitButton,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createEmptyCircuitProject,
  createGate,
  createLedMatrix,
  createPinCircuit,
  getComponentLayout,
  getPinJamDisplayLabel,
  instantiateCircuitFromPalette,
  syncProjectLogicalCircuits,
} from "../utils/circuitLayout";
import { buildComponentCatalog } from "../utils/componentCatalog";
import { GRID_SIZE } from "../utils/coordinateSystem";

import CircuitSymbolView from "../components/circuitCanvas/circuitSymbolView";
import SubCircuitPreview from "../components/componentPalette/subCircuitPreview";
import LedDisplayShape from "../components/symbols/display/ledDisplayShape";
import LedMatrixShape from "../components/symbols/display/ledMatrixShape";
import SevenSegmentShape from "../components/symbols/display/sevenSegmentShape";
import ButtonShape from "../components/symbols/io/buttonShape";
import ConstantShape from "../components/symbols/io/constantShape";
import PinShape from "../components/symbols/io/pinShape";
import ProbeShape from "../components/symbols/io/probeShape";
import SplitterShape from "../components/symbols/io/splitterShape";
import SymbolRenderer, { getSubCircuitShapePath } from "../components/symbols/symbolRenderer";

describe("Gate Symbols & Pin Layouts", () => {
  it("generates correct dimensions and pin positions for NOT gate", () => {
    const layout = getComponentLayout("not");
    expect(layout.gridWidth).toBe(3);
    expect(layout.gridHeight).toBe(4);
    expect(layout.pins).toHaveLength(2);

    const [inPin, outPin] = layout.pins;
    expect(inPin.gridPoint).toEqual({ x: 0, y: 2 });
    expect(outPin.gridPoint).toEqual({ x: 3, y: 2 });
  });

  it("generates symmetrical pin alignment for standard 2-input AND gate", () => {
    const layout = getComponentLayout("and", 2);
    expect(layout.gridWidth).toBe(3);
    expect(layout.gridHeight).toBe(4);
    expect(layout.pins).toHaveLength(3);

    const [in1, in2, out] = layout.pins;
    expect(in1.gridPoint).toEqual({ x: 0, y: 1 });
    expect(in2.gridPoint).toEqual({ x: 0, y: 3 });
    expect(out.gridPoint).toEqual({ x: 3, y: 2 });
  });

  it("scales height and spaces pins for 4-input gates", () => {
    const layout = getComponentLayout("or", 4);
    expect(layout.gridWidth).toBe(3);
    expect(layout.gridHeight).toBe(5);
    expect(layout.pins).toHaveLength(5);

    const inputPins = layout.pins.filter((p) => p.pinType === "input");
    expect(inputPins).toHaveLength(4);
    expect(inputPins.map((p) => p.gridPoint)).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 0, y: 4 },
    ]);
  });

  it("supports all AND input counts from 2 to 8", () => {
    for (let count = 2; count <= 8; count++) {
      const layout = getComponentLayout("and", count);
      expect(layout.gridWidth).toBe(3);
      expect(layout.gridHeight).toBe(Math.max(4, count + 1));

      const inputPins = layout.pins.filter((p) => p.pinType === "input");
      expect(inputPins).toHaveLength(count);

      const outPin = layout.pins.find((p) => p.pinType === "output");
      expect(outPin?.gridPoint).toEqual({ x: 3, y: Math.floor(layout.gridHeight / 2) });
    }
  });

  it("positions enable pin on top or bottom for Tri-State buffers", () => {
    const bottomEnable = getComponentLayout("triState1");
    const enableBottomPin = bottomEnable.pins.find((p) => p.name === "Enable");
    expect(enableBottomPin?.gridPoint).toEqual({ x: 1, y: 4 });

    const topEnable = getComponentLayout("triState2");
    const enableTopPin = topEnable.pins.find((p) => p.name === "Enable");
    expect(enableTopPin?.gridPoint).toEqual({ x: 1, y: 0 });
  });

  it("provides 2x2 grid dimensions for Clock and Sensors", () => {
    const clock = getComponentLayout("clock");
    expect(clock.gridWidth).toBe(2);
    expect(clock.gridHeight).toBe(2);
    expect(clock.pins[0].gridPoint).toEqual({ x: 2, y: 1 });

    const button = getComponentLayout("button");
    expect(button.gridWidth).toBe(2);
    expect(button.gridHeight).toBe(2);
  });

  it("provides 2x2 grid dimensions for Pin In and Pin Out with correct terminal sides", () => {
    const pinIn = getComponentLayout("pinIn");
    expect(pinIn.gridWidth).toBe(2);
    expect(pinIn.gridHeight).toBe(2);
    expect(pinIn.pins[0].gridPoint).toEqual({ x: 2, y: 1 });
    expect(pinIn.pins[0].pinType).toBe("output");

    const pinOut = getComponentLayout("pinOut");
    expect(pinOut.gridWidth).toBe(2);
    expect(pinOut.gridHeight).toBe(2);
    expect(pinOut.pins[0].gridPoint).toEqual({ x: 0, y: 1 });
    expect(pinOut.pins[0].pinType).toBe("input");
  });

  it("renders ConstantShape with dynamic value and clipPath", () => {
    const html = renderToStaticMarkup(
      <svg>
        <ConstantShape width={40} height={40} value="43" symbolId="const-test-1" />
      </svg>,
    );

    expect(html).toContain("43");
    expect(html).toContain("<clipPath id=\"const-clip-const-test-1\">");
    expect(html).toContain("clip-path=\"url(#const-clip-const-test-1)\"");
  });

  it("renders ButtonShape, ProbeShape and PinShape with clipping", () => {
    const btnHtml = renderToStaticMarkup(
      <svg>
        <ButtonShape width={60} height={60} notation="BTN" symbolId="btn-1" />
      </svg>,
    );
    expect(btnHtml).toContain("<clipPath id=\"btn-clip-btn-1\">");
    expect(btnHtml).toContain("BTN");

    const probeHtml = renderToStaticMarkup(
      <svg>
        <ProbeShape width={40} height={40} value="High" symbolId="probe-1" />
      </svg>,
    );
    expect(probeHtml).toContain("<clipPath id=\"probe-clip-probe-1\">");
    expect(probeHtml).toContain("High");

    const pinHtml = renderToStaticMarkup(
      <svg>
        <PinShape width={40} height={40} name="DataBus" pinType="in" symbolId="pin-1" />
      </svg>,
    );
    expect(pinHtml).toContain("<clipPath id=\"pin-clip-pin-1\">");
    expect(pinHtml).toContain("DataBus");
  });

  it("renders constant through SymbolRenderer with custom size and value", () => {
    const html = renderToStaticMarkup(
      <svg>
        <SymbolRenderer
          type="constant"
          width={60}
          height={40}
          value="0x43"
          symbolId="sym-const-1"
        />
      </svg>,
    );

    expect(html).toContain("0x43");
    expect(html).toContain("width=\"56\"");
    expect(html).toContain("<clipPath id=\"const-clip-sym-const-1\">");
  });

  it("renders toggle button with on and off indicator pill states", () => {
    const offHtml = renderToStaticMarkup(
      <svg>
        <ButtonShape width={36} height={36} isToggle={true} isOn={false} symbolId="btn-toggle-off" />
      </svg>,
    );
    expect(offHtml).toContain("toggle-indicator");
    expect(offHtml).toContain("toggle-off");

    const onHtml = renderToStaticMarkup(
      <svg>
        <ButtonShape width={36} height={36} isToggle={true} isOn={true} symbolId="btn-toggle-on" />
      </svg>,
    );
    expect(onHtml).toContain("toggle-indicator");
    expect(onHtml).toContain("toggle-on");
  });

  it("calculates dynamically resized pin positions for button, constant, probe and pin in SymbolRenderer", () => {
    // 8x2 button (width 144px, height 36px): gridWidth = 8, gridHeight = 2 -> pin should be at (8, 1)
    const btnHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer
          type="button"
          width={144}
          height={36}
          showPins={true}
          symbolId="btn-8x2"
        />
      </svg>,
    );
    // Pin at cx = 8 * 18 = 144, cy = 1 * 18 = 18
    expect(btnHtml).toContain("cx=\"144\"");
    expect(btnHtml).toContain("cy=\"18\"");

    // 4x4 button (width 72px, height 72px): gridWidth = 4, gridHeight = 4 -> pin should be at (4, 2)
    const btn4x4Html = renderToStaticMarkup(
      <svg>
        <SymbolRenderer
          type="button"
          width={72}
          height={72}
          showPins={true}
          symbolId="btn-4x4"
        />
      </svg>,
    );
    // Pin at cx = 4 * 18 = 72, cy = 2 * 18 = 36
    expect(btn4x4Html).toContain("cx=\"72\"");
    expect(btn4x4Html).toContain("cy=\"36\"");

    // 6x4 probe: pin on left -> cx = 0, cy = 2 * 18 = 36
    const probeHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer
          type="probe"
          width={108}
          height={72}
          showPins={true}
          symbolId="probe-6x4"
        />
      </svg>,
    );
    expect(probeHtml).toContain("cx=\"0\"");
    expect(probeHtml).toContain("cy=\"36\"");
  });

  it("renders normal pins before gate body and inverted pins after gate body in SymbolRenderer", () => {
    // AND: 2 input pins (normal, before body), 1 output pin (normal, before body)
    const andHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="and" showPins={true} />
      </svg>,
    );
    expect(andHtml).not.toContain("class=\"pin-point pin-inverted");
    expect(andHtml).toContain("class=\"pin-point pin-input\"");
    expect(andHtml).toContain("class=\"pin-point pin-output\"");

    const andShapeIndex = andHtml.indexOf("data-component=\"AndGateShape\"");
    const andOutPinIndex = andHtml.indexOf("class=\"pin-point pin-output\"");
    // Normal output pin is rendered BEFORE the gate body (underneath in Z-order)
    expect(andOutPinIndex).toBeLessThan(andShapeIndex);

    // NAND: 2 input pins (normal, before body), 1 output pin (inverted, after body)
    const nandHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="nand" showPins={true} />
      </svg>,
    );
    expect(nandHtml).toContain("class=\"pin-point pin-inverted pin-output\"");

    const nandShapeIndex = nandHtml.indexOf("data-component=\"AndGateShape\"");
    const nandInPinIndex = nandHtml.indexOf("class=\"pin-point pin-input\"");
    const nandOutPinIndex = nandHtml.indexOf("class=\"pin-point pin-inverted pin-output\"");
    // Normal input pins are rendered BEFORE the gate body
    expect(nandInPinIndex).toBeLessThan(nandShapeIndex);
    // Inverted output pin is rendered AFTER the gate body (on top in Z-order)
    expect(nandOutPinIndex).toBeGreaterThan(nandShapeIndex);

    // NOT: 1 input pin (normal, before body), 1 output pin (inverted, after body)
    const notHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="not" showPins={true} />
      </svg>,
    );
    const notShapeIndex = notHtml.indexOf("data-component=\"NotGateShape\"");
    const notInPinIndex = notHtml.indexOf("class=\"pin-point pin-input\"");
    const notOutPinIndex = notHtml.indexOf("class=\"pin-point pin-inverted pin-output\"");
    expect(notInPinIndex).toBeLessThan(notShapeIndex);
    expect(notOutPinIndex).toBeGreaterThan(notShapeIndex);
  });

  it("renders NAND, NOR, XNOR and NOT gate shapes extending to full width without separate inversion bubbles", () => {
    const andHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="and" showPins={false} />
      </svg>,
    );
    const nandHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="nand" showPins={false} />
      </svg>,
    );
    // AND and NAND share identical full-width body geometry when pins are not shown
    expect(andHtml).toBe(nandHtml);
    expect(nandHtml).not.toContain("InversionBubble");
    expect(nandHtml).not.toContain("gate-bubble");

    const orHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="or" showPins={false} />
      </svg>,
    );
    const norHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="nor" showPins={false} />
      </svg>,
    );
    expect(orHtml).toBe(norHtml);

    const xorHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="xor" showPins={false} />
      </svg>,
    );
    const xnorHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer type="xnor" showPins={false} />
      </svg>,
    );
    expect(xorHtml).toBe(xnorHtml);
  });

  it("renders LedDisplayShape with 3 states (disconnected, off, on) and 4 colors", () => {
    // Disconnected (High-Z)
    const disconnHtml = renderToStaticMarkup(
      <svg>
        <LedDisplayShape isDisconnected={true} color="red" />
      </svg>,
    );
    expect(disconnHtml).toContain("data-component=\"LedDisplayShape\"");
    expect(disconnHtml).toContain("is-disconnected");
    expect(disconnHtml).toContain("class=\"led-bezel\"");

    // Off
    const offHtml = renderToStaticMarkup(
      <svg>
        <LedDisplayShape isOn={false} isDisconnected={false} color="green" />
      </svg>,
    );
    expect(offHtml).toContain("is-off");
    expect(offHtml).toContain("#102d18");

    // On with glow
    const onHtml = renderToStaticMarkup(
      <svg>
        <LedDisplayShape isOn={true} isDisconnected={false} color="blue" />
      </svg>,
    );
    expect(onHtml).toContain("is-on");
    expect(onHtml).toContain("#1677ff");
    expect(onHtml).toContain("drop-shadow");

    // Yellow color check
    const yellowHtml = renderToStaticMarkup(
      <svg>
        <LedDisplayShape isOn={true} color="yellow" />
      </svg>,
    );
    expect(yellowHtml).toContain("#faad14");
  });

  it("renders SevenSegmentShape with 8 segments, authentic -8deg skew and 4 colors", () => {
    const segments = [true, true, true, true, false, false, true, false]; // digit '3' or similar
    const html = renderToStaticMarkup(
      <svg>
        <SevenSegmentShape
          segments={segments}
          color="red"
          width={54}
          height={90}
        />
      </svg>,
    );

    expect(html).toContain("data-component=\"SevenSegmentShape\"");
    expect(html).toContain("skewX(-8)");
    expect(html).toContain("segment-a segment-on");
    expect(html).toContain("segment-e segment-off");
    expect(html).toContain("segment-dp segment-off");
    expect(html).toContain("#ff4d4f");
  });

  it("renders LedMatrixShape with round vs rect cells and multicolor modes", () => {
    // 4x4 round matrix
    const roundHtml = renderToStaticMarkup(
      <svg>
        <LedMatrixShape
          rows={4}
          columns={4}
          cellShape="round"
          matrixType="individual"
          colors={1}
        />
      </svg>,
    );
    expect(roundHtml).toContain("data-component=\"LedMatrixShape\"");
    expect(roundHtml).toContain("<circle");
    expect(roundHtml).toContain("data-cell=\"0-0\"");
    expect(roundHtml).toContain("data-cell=\"3-3\"");
    expect(roundHtml).toContain("matrix-cell-round color-0");
    expect(roundHtml).not.toContain("style=\"fill:");

    // 3x3 rect matrix with 3-bit RGB colors
    const rectHtml = renderToStaticMarkup(
      <svg>
        <LedMatrixShape
          rows={3}
          columns={3}
          cellShape="rect"
          matrixType="selector"
          colors={3}
          cellValues={[
            [1, 2, 4], // Blue, Green, Red
            [3, 5, 7], // Cyan, Magenta, White
            [0, 6, 0], // Off, Yellow, Off
          ]}
        />
      </svg>,
    );
    expect(rectHtml).toContain("<rect");
    expect(rectHtml).toContain("matrix-cell-rect color-4"); // Red (4)
    expect(rectHtml).toContain("matrix-cell-rect color-2"); // Green (2)
    expect(rectHtml).toContain("matrix-cell-rect color-1"); // Blue (1)
    expect(rectHtml).toContain("matrix-cell-rect color-6"); // Yellow (6)
    expect(rectHtml).toContain("matrix-cell-rect color-7"); // White (7)
    expect(rectHtml).toContain("matrix-cell-rect color-0"); // Off (0)
    expect(rectHtml).not.toContain("style=\"fill:");
    expect(rectHtml).toContain("#ff4d4f"); // Red (4) in CSS
    expect(rectHtml).toContain("#52c41a"); // Green (2) in CSS
    expect(rectHtml).toContain("#1677ff"); // Blue (1) in CSS
    expect(rectHtml).toContain("#faad14"); // Yellow (6) in CSS
    expect(rectHtml).toContain("#f0f0f0"); // White (7) in CSS
  });

  it("calculates correct dimensions and pin terminals for Single LED, 7-Segment and LED-Matrix", () => {
    // Single LED: 2x2 grid, 1 pin on left
    const ledGate = createGate("led", 1);
    expect(ledGate.symbolWidth).toBe(2);
    expect(ledGate.symbolHeight).toBe(2);
    expect(ledGate.pins).toHaveLength(1);
    expect(ledGate.pins[0].gridPoint).toEqual({ x: 0, y: 1 });

    // Siebensegment: 3x5 grid, 8 pins (4 left at y=1..4, 4 right at y=1..4)
    const sevenSegGate = createGate("led", 8);
    expect(sevenSegGate.symbolWidth).toBe(3);
    expect(sevenSegGate.symbolHeight).toBe(5);
    expect(sevenSegGate.pins).toHaveLength(8);

    const leftPins = sevenSegGate.pins.filter((p) => p.gridPoint.x === 0);
    const rightPins = sevenSegGate.pins.filter((p) => p.gridPoint.x === 3);
    expect(leftPins).toHaveLength(4);
    expect(rightPins).toHaveLength(4);
    expect(leftPins.map((p) => p.gridPoint.y)).toEqual([1, 2, 3, 4]);
    expect(rightPins.map((p) => p.gridPoint.y)).toEqual([1, 2, 3, 4]);

    // LED Matrix - Individual: (columns+1) x (rows+1), pins on left (1 per row)
    const indMatrix = createLedMatrix("mat-ind", 4, 6, "individual", "round", 1, 1);
    expect(indMatrix.symbolWidth).toBe(7); // 6 + 1
    expect(indMatrix.symbolHeight).toBe(5); // 4 + 1
    expect(indMatrix.pins).toHaveLength(4); // 4 rows
    expect(indMatrix.pins.every((p) => p.pinSide === "left")).toBe(true);

    // LED Matrix - Selector: (columns+1) x (rows+1), pins on top (columns) and left (rows)
    const selMatrix = createLedMatrix("mat-sel", 4, 4, "selector", "round", 1, 2);
    expect(selMatrix.symbolWidth).toBe(5);
    expect(selMatrix.symbolHeight).toBe(5);
    expect(selMatrix.pins).toHaveLength(8); // 4 cols on top + 4 rows on left
    const topPins = selMatrix.pins.filter((p) => p.pinSide === "top");
    const matrixLeftPins = selMatrix.pins.filter((p) => p.pinSide === "left");
    expect(topPins).toHaveLength(4);
    expect(matrixLeftPins).toHaveLength(4);
    expect(topPins.map((p) => p.gridPoint.x)).toEqual([1, 2, 3, 4]);
    expect(matrixLeftPins.map((p) => p.gridPoint.y)).toEqual([1, 2, 3, 4]);
  });

  it("calculates correct dimensions and pin terminals for Bus-Splitter", () => {
    // Splitter mit 4 Pins im Uhrzeigersinn: Breite 1, Höhe 5 (PinCount + 1)
    const cwLayout = getComponentLayout("splitter", { pinCount: 4, pinBitWidth: 2, clockwise: true });
    expect(cwLayout.gridWidth).toBe(1);
    expect(cwLayout.gridHeight).toBe(5);
    expect(cwLayout.pins).toHaveLength(5); // 1 Bus-Pin + 4 Abzweige

    const busPin = cwLayout.pins[0];
    expect(busPin.bitWidth).toBe(8); // 4 * 2
    expect(busPin.pinSide).toBe("left");
    expect(busPin.gridPoint.x).toBe(0);
    expect(busPin.gridPoint.y).toBe(2); // zentriert

    const thinPins = cwLayout.pins.slice(1);
    expect(thinPins).toHaveLength(4);
    expect(thinPins.every((p) => p.pinSide === "right")).toBe(true);
    expect(thinPins.map((p) => p.gridPoint.y)).toEqual([1, 2, 3, 4]);
    expect(thinPins.every((p) => p.gridPoint.x === 1)).toBe(true);

    // Splitter gegen den Uhrzeigersinn: Bus-Pin rechts, Abzweige links
    const ccwLayout = getComponentLayout("splitter", { pinCount: 3, pinBitWidth: 1, clockwise: false });
    expect(ccwLayout.gridWidth).toBe(1);
    expect(ccwLayout.gridHeight).toBe(4);
    expect(ccwLayout.pins[0].pinSide).toBe("right");
    expect(ccwLayout.pins[0].gridPoint.x).toBe(1);
    expect(ccwLayout.pins.slice(1).every((p) => p.pinSide === "left")).toBe(true);
    expect(ccwLayout.pins.slice(1).every((p) => p.gridPoint.x === 0)).toBe(true);
  });

  it("renders SplitterShape and SymbolRenderer for Splitter accurately", () => {
    const shapeHtml = renderToStaticMarkup(
      <svg>
        <SplitterShape width={18} height={72} clockwise={true} pinCount={3} />
      </svg>,
    );
    expect(shapeHtml).toContain("data-component=\"SplitterShape\"");
    expect(shapeHtml).toContain("<rect");
    expect(shapeHtml).toContain("class=\"splitter-body\"");
    expect(shapeHtml).toContain("<polygon");
    expect(shapeHtml).toContain("class=\"splitter-arrow\"");

    const rendererHtml = renderToStaticMarkup(
      <svg>
        <SymbolRenderer
          type="splitter"
          pinCount={3}
          clockwise={true}
          showPins={true}
        />
      </svg>,
    );
    expect(rendererHtml).toContain("data-component=\"SymbolRenderer\"");
    expect(rendererHtml).toContain("data-component=\"SplitterShape\"");
    expect(rendererHtml).toContain("class=\"pin-point pin-none\"");
  });

  it("resolves jamNotation labels via getPinJamDisplayLabel without falling back to pin name when empty", () => {
    const { pin: leftExplicit } = createPinCircuit("p1", "sub", "input", "ClockInput", 1, "left", false, 0, 2, 2, "CLK");
    const { pin: topExplicit } = createPinCircuit("p2", "sub", "input", "AddressBus", 4, "top", false, 0, 2, 2, "ADDR");
    const { pin: rightEmpty } = createPinCircuit("p3", "sub", "output", "DataOut", 1, "right");
    const { pin: bottomEmpty } = createPinCircuit("p4", "sub", "input", "Address", 1, "bottom", false, 0, 2, 2, "");

    expect(getPinJamDisplayLabel(leftExplicit)).toBe("CLK");
    expect(getPinJamDisplayLabel(topExplicit)).toBe("ADDR");
    expect(getPinJamDisplayLabel(rightEmpty)).toBe("");
    expect(getPinJamDisplayLabel(bottomEmpty)).toBe("");
  });

  it("renders jamNotation pin labels at configured edges and omits empty jamNotation labels", () => {
    const baseProject = createEmptyCircuitProject("SubChip Jam Test", "Main", "main");
    const subLc = createDefaultLogicalCircuit("sub-alu", "TestChip");
    const pLeft = createPinCircuit("pin-l", subLc.logicalCircuitId, "input", "Clock", 1, "left", false, 0, 2, 2, "CLK");
    const pRight = createPinCircuit("pin-r", subLc.logicalCircuitId, "output", "OutQ", 1, "right", false, 0, 2, 2, "Q");
    const pTop = createPinCircuit("pin-t", subLc.logicalCircuitId, "input", "Enable", 1, "top", false, 0, 2, 2, "EN");
    const pBottom = createPinCircuit("pin-b", subLc.logicalCircuitId, "input", "Reset", 1, "bottom", false, 0, 2, 2, "");

    subLc.logicalPins.push(pLeft.pin, pRight.pin, pTop.pin, pBottom.pin);
    baseProject.pins.push(pLeft.pin, pRight.pin, pTop.pin, pBottom.pin);
    baseProject.logicalCircuits.push(subLc);
    baseProject.circuits.set(subLc.circuitId, subLc);

    const subSymInitial = createCircuitSymbol(subLc, "main", 4, 4, "up", "sym-sub-1");
    baseProject.logicalCircuits[0].circuitSymbols.push(subSymInitial);
    baseProject.circuitSymbols.push(subSymInitial);

    const synced = syncProjectLogicalCircuits(baseProject);
    const subSym = synced.circuitSymbols.find((s) => s.circuitSymbolId === "sym-sub-1")!;

    const html = renderToStaticMarkup(
      <svg>
        <CircuitSymbolView symbol={subSym} />
      </svg>,
    );

    expect(html).toContain("class=\"sub-circuit-chip\"");
    expect(html).toContain("data-pin-side=\"left\"");
    expect(html).toContain("text-anchor=\"start\"");
    expect(html).toContain(">CLK</text>");

    expect(html).toContain("data-pin-side=\"right\"");
    expect(html).toContain("text-anchor=\"end\"");
    expect(html).toContain(">Q</text>");

    expect(html).toContain("data-pin-side=\"top\"");
    expect(html).toContain("text-anchor=\"middle\"");
    expect(html).toContain(">EN</text>");

    expect(html).not.toContain("data-pin-side=\"bottom\"");
    expect(html).not.toContain(">Rese</text>");
  });

  it("omits chip-name text in CircuitSymbolView and SubCircuitPreview when notation is empty (B-008)", () => {
    const proj = createEmptyCircuitProject("Empty Notation Test", "Main", "main");
    const subLc = createDefaultLogicalCircuit("sub-blank", "HiddenCircuitName");
    subLc.notation = "";
    const pIn = createPinCircuit("pin-blank-in", subLc.logicalCircuitId, "input", "X0", 1, "left", false, 0, 2, 2, "");
    const ledGate = createGate("led", 1, false, "green");
    subLc.logicalPins.push(pIn.pin);
    subLc.circuitSymbols.push(
      createCircuitSymbol(pIn.pinCircuit, subLc.logicalCircuitId, 2, 2, "up", "sym-blank-pin"),
      createCircuitSymbol(ledGate, subLc.logicalCircuitId, 6, 2, "up", "sym-blank-led"),
    );
    proj.pins.push(pIn.pin);
    proj.logicalCircuits.push(subLc);
    proj.circuits.set(subLc.circuitId, subLc);

    const syncedRect = syncProjectLogicalCircuits(proj);
    const rectLc = syncedRect.logicalCircuits.find((c) => c.logicalCircuitId === "sub-blank")!;
    const rectSym = createCircuitSymbol(rectLc, "main", 4, 4, "up", "sym-sub-rect");
    const rectHtml = renderToStaticMarkup(
      <svg>
        <CircuitSymbolView symbol={rectSym} />
      </svg>,
    );
    expect(rectHtml).not.toContain("<text");
    expect(rectHtml).not.toContain(">HiddenCircuitName</text>");
    expect(rectHtml).not.toContain("class=\"pin-jam-label\"");
    expect(rectHtml).toContain("<title>HiddenCircuitName</title>");

    rectLc.circuitShape = "display";
    rectLc.isDisplay = true;
    rectLc.showLabelAbove = true;
    const syncedDisp = syncProjectLogicalCircuits(syncedRect);
    const dispLc = syncedDisp.logicalCircuits.find((c) => c.logicalCircuitId === "sub-blank")!;
    const dispSym = createCircuitSymbol(dispLc, "main", 4, 4, "up", "sym-sub-disp");
    const dispHtml = renderToStaticMarkup(
      <svg>
        <CircuitSymbolView symbol={dispSym} />
      </svg>,
    );
    expect(dispHtml).not.toContain("<text");
    expect(dispHtml).not.toContain(">HiddenCircuitName</text>");

    const previewHtml = renderToStaticMarkup(<SubCircuitPreview circuit={dispLc} />);
    expect(previewHtml).not.toContain("<text");
    expect(previewHtml).not.toContain("HiddenCircuitName");
  });

  it("renders all six sub-circuit shapes (rectangular, flipFlop, mux, demux, alu, display) accurately", () => {
    const buildShapedSubSymbol = (shape: "rectangular" | "flipFlop" | "mux" | "demux" | "alu") => {
      const proj = createEmptyCircuitProject("Shape Test", "Main", "main");
      const subLc = createDefaultLogicalCircuit(`sub-${shape}`, shape.toUpperCase());
      subLc.circuitShape = shape;
      const pTop = createPinCircuit("pt", subLc.logicalCircuitId, "input", "Sel", 1, "top", false, 0, 2, 2, "SEL");
      const pBot = createPinCircuit("pb", subLc.logicalCircuitId, "input", "En", 1, "bottom", false, 0, 2, 2, "EN");
      const pLeft = createPinCircuit("pl", subLc.logicalCircuitId, "input", "A", 1, "left", false, 0, 2, 2, "A");
      const pRight = createPinCircuit("pr", subLc.logicalCircuitId, "output", "Y", 1, "right", false, 0, 2, 2, "Y");
      subLc.logicalPins.push(pTop.pin, pBot.pin, pLeft.pin, pRight.pin);
      proj.pins.push(pTop.pin, pBot.pin, pLeft.pin, pRight.pin);
      proj.logicalCircuits.push(subLc);
      const sym = createCircuitSymbol(subLc, "main", 2, 2, "up", `sym-${shape}`);
      proj.logicalCircuits[0].circuitSymbols.push(sym);
      proj.circuitSymbols.push(sym);
      const synced = syncProjectLogicalCircuits(proj);
      return synced.circuitSymbols.find((s) => s.circuitSymbolId === `sym-${shape}`)!;
    };

    // Rectangular
    const rectSym = buildShapedSubSymbol("rectangular");
    const rectHtml = renderToStaticMarkup(<svg><CircuitSymbolView symbol={rectSym} /></svg>);
    expect(rectHtml).toContain("data-circuit-shape=\"rectangular\"");
    expect(rectHtml).toContain("class=\"chip-body shape-rectangular\"");
    expect(rectHtml).toContain("class=\"chip-name\"");

    // FlipFlop (Trennlinie bei x = 11)
    const ffSym = buildShapedSubSymbol("flipFlop");
    const ffHtml = renderToStaticMarkup(<svg><CircuitSymbolView symbol={ffSym} /></svg>);
    expect(ffHtml).toContain("data-circuit-shape=\"flipFlop\"");
    expect(ffHtml).toContain("class=\"chip-divider-line\"");
    expect(ffHtml).toContain("x1=\"11\"");

    // Mux, Demux & ALU (Trapez-/Kerbenpfad + Pin-Stem-Hilfslinien)
    for (const shape of ["mux", "demux", "alu"] as const) {
      const shapedSym = buildShapedSubSymbol(shape);
      const wPx = shapedSym.circuit.symbolWidth * GRID_SIZE;
      const hPx = shapedSym.circuit.symbolHeight * GRID_SIZE;
      const expectedPath = getSubCircuitShapePath(shape, wPx, hPx);
      expect(expectedPath).not.toBeNull();

      const shapedHtml = renderToStaticMarkup(<svg><CircuitSymbolView symbol={shapedSym} /></svg>);
      expect(shapedHtml).toContain(`data-circuit-shape="${shape}"`);
      expect(shapedHtml).toContain(`class="chip-body shape-${shape}"`);
      expect(shapedHtml).toContain(`d="${expectedPath}"`);
      expect(shapedHtml).toContain("class=\"pin-stem-line\"");
    }

    // Display: ohne Display-Elemente -> Fallback auf rectangular
    const emptyDisplayProj = createEmptyCircuitProject("Empty Display", "Main", "main");
    const emptyDispLc = createDefaultLogicalCircuit("sub-empty-disp", "EmptyDisp");
    emptyDispLc.circuitShape = "display";
    emptyDispLc.isDisplay = true;
    expect(circuitContainsDisplays(emptyDispLc)).toBe(false);
    emptyDisplayProj.logicalCircuits.push(emptyDispLc);
    const emptyDispSym = createCircuitSymbol(emptyDispLc, "main", 2, 2, "up", "sym-empty-disp");
    emptyDisplayProj.circuitSymbols.push(emptyDispSym);
    const syncedEmpty = syncProjectLogicalCircuits(emptyDisplayProj);
    const emptyDispHtml = renderToStaticMarkup(
      <svg><CircuitSymbolView symbol={syncedEmpty.circuitSymbols[0]} /></svg>,
    );
    expect(emptyDispHtml).toContain("data-circuit-shape=\"rectangular\"");
    expect(emptyDispHtml).not.toContain("display-chip-content");

    // Display: mit Button, LED, 7-Segment & LED-Matrix -> zentriert und ohne interne Pins
    const dispProj = createEmptyCircuitProject("Display Test", "Main", "main");
    const dispLc = createDefaultLogicalCircuit("sub-disp", "Panel");
    dispLc.circuitShape = "display";
    dispLc.isDisplay = true;

    const btn = createCircuitSymbol(createCircuitButton("b1", "GO", true), dispLc.logicalCircuitId, 2, 2, "up", "d-btn");
    const led = createCircuitSymbol(createGate("led", 1, false, "green"), dispLc.logicalCircuitId, 5, 2, "up", "d-led");
    const seg = createCircuitSymbol(createGate("led", 8, false, "red"), dispLc.logicalCircuitId, 8, 2, "up", "d-seg");
    const mat = createCircuitSymbol(createLedMatrix("m1", 2, 2), dispLc.logicalCircuitId, 12, 2, "up", "d-mat");
    dispLc.circuitSymbols.push(btn, led, seg, mat);

    const outPin = createPinCircuit("p-disp", dispLc.logicalCircuitId, "input", "In", 1, "left", false, 0, 2, 2, "IN");
    dispLc.logicalPins.push(outPin.pin);
    dispProj.pins.push(outPin.pin);
    dispProj.logicalCircuits.push(dispLc);

    const dispSymInit = createCircuitSymbol(dispLc, "main", 4, 4, "up", "sym-disp");
    dispProj.logicalCircuits[0].circuitSymbols.push(dispSymInit);
    dispProj.circuitSymbols.push(dispSymInit);

    const syncedDisp = syncProjectLogicalCircuits(dispProj);
    const dispSym = syncedDisp.circuitSymbols.find((s) => s.circuitSymbolId === "sym-disp")!;
    expect(circuitContainsDisplays(dispLc)).toBe(true);

    const dispHtml = renderToStaticMarkup(<svg><CircuitSymbolView symbol={dispSym} /></svg>);
    expect(dispHtml).toContain("data-circuit-shape=\"display\"");
    expect(dispHtml).toContain("class=\"display-chip-content\"");
    expect(dispHtml).toContain("data-component=\"ButtonShape\"");
    expect(dispHtml).toContain("data-component=\"LedDisplayShape\"");
    expect(dispHtml).toContain("data-component=\"SevenSegmentShape\"");
    expect(dispHtml).toContain("data-component=\"LedMatrixShape\"");

    // Nur der äußere Sub-Circuit-Pin darf als pin-point gerendert werden (keine internen Pin-Punkte in display-chip-content)
    const displayContentStart = dispHtml.indexOf("class=\"display-chip-content\"");
    const displayContentEnd = dispHtml.indexOf("</g>", dispHtml.lastIndexOf("data-embedded-symbol-id"));
    const displayContentFragment = dispHtml.slice(displayContentStart, displayContentEnd);
    expect(displayContentFragment).not.toContain("class=\"pin-point");
  });

  it("applies displayMargin (none, horizontal, vertical, all) and centers embedded displays", () => {
    const buildWithMargin = (displayMargin: "none" | "horizontal" | "vertical" | "all") => {
      const proj = createEmptyCircuitProject("Margin Test", "Main", "main");
      const dispLc = createDefaultLogicalCircuit("sub-margin", "MatrixPanel");
      dispLc.circuitShape = "display";
      dispLc.isDisplay = true;
      dispLc.displayMargin = displayMargin;

      // 4x4 LED-Matrix belegt 5x5 Rastereinheiten -> größer als Minimum 3x4
      const mat = createCircuitSymbol(createLedMatrix("m-margin", 4, 4), dispLc.logicalCircuitId, 4, 4, "up", "sym-mat");
      dispLc.circuitSymbols.push(mat);
      proj.logicalCircuits.push(dispLc);

      const subSym = createCircuitSymbol(dispLc, "main", 2, 2, "up", "sym-panel");
      proj.logicalCircuits[0].circuitSymbols.push(subSym);
      proj.circuitSymbols.push(subSym);
      return syncProjectLogicalCircuits(proj).circuitSymbols.find((s) => s.circuitSymbolId === "sym-panel")!;
    };

    const noneSym = buildWithMargin("none");
    expect(noneSym.circuit.symbolWidth).toBe(5);
    expect(noneSym.circuit.symbolHeight).toBe(5);

    const horizSym = buildWithMargin("horizontal");
    expect(horizSym.circuit.symbolWidth).toBe(7);
    expect(horizSym.circuit.symbolHeight).toBe(5);

    const vertSym = buildWithMargin("vertical");
    expect(vertSym.circuit.symbolWidth).toBe(5);
    expect(vertSym.circuit.symbolHeight).toBe(7);

    const allSym = buildWithMargin("all");
    expect(allSym.circuit.symbolWidth).toBe(7);
    expect(allSym.circuit.symbolHeight).toBe(7);

    const allHtml = renderToStaticMarkup(<svg><CircuitSymbolView symbol={allSym} /></svg>);
    // Zentrierung um je +1 Rastereinheit (18px) je Seite
    expect(allHtml).toContain(`transform="translate(${GRID_SIZE}, ${GRID_SIZE})"`);
  });

  it("renders chip label above symbol when showLabelAbove is enabled and omits inside label on display shapes", () => {
    const proj = createEmptyCircuitProject("Label Test", "Main", "main");
    const dispLc = createDefaultLogicalCircuit("sub-lbl", "MyPanel");
    dispLc.notation = "Control Panel";
    dispLc.circuitShape = "display";
    dispLc.isDisplay = true;
    dispLc.showLabelAbove = false;

    const btn = createCircuitSymbol(createCircuitButton("b-lbl", "S1", false), dispLc.logicalCircuitId, 1, 1, "up", "d-b");
    dispLc.circuitSymbols.push(btn);
    proj.logicalCircuits.push(dispLc);

    const subSymInit = createCircuitSymbol(dispLc, "main", 5, 5, "up", "sym-lbl");
    proj.circuitSymbols.push(subSymInit);
    const syncedHidden = syncProjectLogicalCircuits(proj).circuitSymbols[0];

    const hiddenHtml = renderToStaticMarkup(<svg><CircuitSymbolView symbol={syncedHidden} /></svg>);
    expect(hiddenHtml).not.toContain("class=\"chip-name");

    dispLc.showLabelAbove = true;
    const syncedAbove = syncProjectLogicalCircuits(proj).circuitSymbols[0];
    const aboveHtml = renderToStaticMarkup(<svg><CircuitSymbolView symbol={syncedAbove} /></svg>);
    expect(aboveHtml).toContain("class=\"chip-name chip-name-above\"");
    expect(aboveHtml).toContain("y=\"-6\"");
    expect(aboveHtml).toContain(">Control Panel</text>");
  });

  it("B-004: sizes compact 2x2 display subcircuits without 3x4 inflation across sync, placement, and catalog", () => {
    const proj = createEmptyCircuitProject("B-004 Compact Display", "Main", "main");
    const dispLc = createDefaultLogicalCircuit("sub-tri-led", "Tri State LED (Right)", "LED");
    dispLc.notation = "";
    dispLc.circuitShape = "display";
    dispLc.isDisplay = true;
    dispLc.displayMargin = "none";

    const x0Pin = createPinCircuit("pin-x0", dispLc.logicalCircuitId, "input", "X0", 1, "right", false, 0, 2, 2, "X0");
    dispLc.logicalPins.push(x0Pin.pin);
    proj.pins.push(x0Pin.pin);

    // 1x1 LED-Matrix (2x2 Rastereinheiten) + nicht-darzustellende Logikgatter
    const matrix = createLedMatrix("mat-1x1", 1, 1, "individual", "rect", 2, 1);
    const matrixSym = createCircuitSymbol(matrix, dispLc.logicalCircuitId, 21, 12, "up", "sym-mat-1x1");
    const gateSym = createCircuitSymbol(createGate("or", 2), dispLc.logicalCircuitId, 14, 7, "up", "sym-or");
    dispLc.circuitSymbols.push(matrixSym, gateSym);
    proj.logicalCircuits.push(dispLc);
    proj.circuits.set(dispLc.circuitId, dispLc);

    const placedSub = createCircuitSymbol(dispLc, "main", 14, 3, "up", "sym-tri-led");
    proj.logicalCircuits[0].circuitSymbols.push(placedSub);
    proj.circuitSymbols.push(placedSub);

    const synced = syncProjectLogicalCircuits(proj);
    const syncedSubSym = synced.circuitSymbols.find((s) => s.circuitSymbolId === "sym-tri-led")!;
    expect(syncedSubSym.circuit.symbolWidth).toBe(2);
    expect(syncedSubSym.circuit.symbolHeight).toBe(2);
    expect(syncedSubSym.jams).toHaveLength(1);
    expect(syncedSubSym.jams[0].x).toBe(2);
    expect(syncedSubSym.jams[0].y).toBe(1);
    expect(syncedSubSym.jams[0].absolutePoint).toEqual({ x: 16, y: 4 });

    const html = renderToStaticMarkup(<svg><CircuitSymbolView symbol={syncedSubSym} /></svg>);
    expect(html).toContain("data-circuit-shape=\"display\"");
    expect(html).toContain("width=\"36\" height=\"36\"");
    expect(html).toContain("transform=\"translate(0, 0)\"");
    expect(html).toContain("data-component=\"LedMatrixShape\"");

    // Zweitplatzierung per Palette und Inspektion über ComponentCatalog behalten 2x2 exakt bei
    const rePlaced = instantiateCircuitFromPalette(
      synced,
      "main",
      { type: "subCircuit", subCircuitId: dispLc.logicalCircuitId, name: dispLc.name },
      { x: 4, y: 4 },
    );
    expect(rePlaced.circuitSymbol.circuit.symbolWidth).toBe(2);
    expect(rePlaced.circuitSymbol.circuit.symbolHeight).toBe(2);
    expect(rePlaced.circuitSymbol.jams[0].absolutePoint).toEqual({ x: 6, y: 5 });

    const catalog = buildComponentCatalog({
      type: "subCircuit",
      preview: { subCircuitId: dispLc.logicalCircuitId },
      project: synced,
    });
    expect(catalog.components[0]?.defaultSize).toEqual({ width: 2, height: 2 });
    const catalogSub = catalog.subCircuits?.find((s) => s.logicalCircuitId === dispLc.logicalCircuitId);
    expect(catalogSub?.symbolWidth).toBe(2);
    expect(catalogSub?.symbolHeight).toBe(2);
  });

  it("B-004: applies displayMargin, pin expansion, nested compact display, and empty fallback correctly on 2x2 displays", () => {
    const buildCompactWithMargin = (displayMargin: "none" | "horizontal" | "vertical" | "all") => {
      const proj = createEmptyCircuitProject("Compact Margin Test", "Main", "main");
      const dispLc = createDefaultLogicalCircuit("sub-led", "CompactLED");
      dispLc.circuitShape = "display";
      dispLc.isDisplay = true;
      dispLc.displayMargin = displayMargin;
      dispLc.circuitSymbols.push(
        createCircuitSymbol(createGate("led", 1, false, "red"), dispLc.logicalCircuitId, 4, 4, "up", "sym-led"),
      );
      proj.logicalCircuits.push(dispLc);
      const subSym = createCircuitSymbol(dispLc, "main", 2, 2, "up", "sym-compact");
      proj.logicalCircuits[0].circuitSymbols.push(subSym);
      proj.circuitSymbols.push(subSym);
      return syncProjectLogicalCircuits(proj).circuitSymbols.find((s) => s.circuitSymbolId === "sym-compact")!;
    };

    const noneSym = buildCompactWithMargin("none");
    expect(noneSym.circuit.symbolWidth).toBe(2);
    expect(noneSym.circuit.symbolHeight).toBe(2);
    expect(renderToStaticMarkup(<svg><CircuitSymbolView symbol={noneSym} /></svg>)).toContain("transform=\"translate(0, 0)\"");

    const horizSym = buildCompactWithMargin("horizontal");
    expect(horizSym.circuit.symbolWidth).toBe(4);
    expect(horizSym.circuit.symbolHeight).toBe(2);
    expect(renderToStaticMarkup(<svg><CircuitSymbolView symbol={horizSym} /></svg>)).toContain(`transform="translate(${GRID_SIZE}, 0)"`);

    const vertSym = buildCompactWithMargin("vertical");
    expect(vertSym.circuit.symbolWidth).toBe(2);
    expect(vertSym.circuit.symbolHeight).toBe(4);
    expect(renderToStaticMarkup(<svg><CircuitSymbolView symbol={vertSym} /></svg>)).toContain(`transform="translate(0, ${GRID_SIZE})"`);

    const allSym = buildCompactWithMargin("all");
    expect(allSym.circuit.symbolWidth).toBe(4);
    expect(allSym.circuit.symbolHeight).toBe(4);
    expect(renderToStaticMarkup(<svg><CircuitSymbolView symbol={allSym} /></svg>)).toContain(`transform="translate(${GRID_SIZE}, ${GRID_SIZE})"`);

    // 2x2-Display mit 3 Eingangs-Pins links wächst nur in der Höhe auf 2x4 (Pin-Anzahl + 1), Breite bleibt 2
    const pinProj = createEmptyCircuitProject("Compact Pin Growth", "Main", "main");
    const pinDisp = createDefaultLogicalCircuit("sub-pins", "PinPanel");
    pinDisp.circuitShape = "display";
    pinDisp.isDisplay = true;
    pinDisp.displayMargin = "none";
    pinDisp.circuitSymbols.push(
      createCircuitSymbol(createGate("led", 1), pinDisp.logicalCircuitId, 2, 2, "up", "sym-pin-led"),
    );
    for (let i = 0; i < 3; i++) {
      const p = createPinCircuit(`p-${i}`, pinDisp.logicalCircuitId, "input", `X${i}`, 1, "left", false, i);
      pinDisp.logicalPins.push(p.pin);
      pinProj.pins.push(p.pin);
    }
    pinProj.logicalCircuits.push(pinDisp);
    const pinSub = createCircuitSymbol(pinDisp, "main", 2, 2, "up", "sym-pin-sub");
    pinProj.logicalCircuits[0].circuitSymbols.push(pinSub);
    pinProj.circuitSymbols.push(pinSub);
    const syncedPinSub = syncProjectLogicalCircuits(pinProj).circuitSymbols[0];
    expect(syncedPinSub.circuit.symbolWidth).toBe(2);
    expect(syncedPinSub.circuit.symbolHeight).toBe(4);

    // Verschachtelte 2x2-Display-Subschaltung in einer äußeren Display-Subschaltung konvergiert ebenfalls auf 2x2
    const nestedProj = createEmptyCircuitProject("Nested Compact", "Main", "main");
    const innerDisp = createDefaultLogicalCircuit("inner-disp", "InnerLED");
    innerDisp.circuitShape = "display";
    innerDisp.isDisplay = true;
    innerDisp.displayMargin = "none";
    innerDisp.circuitSymbols.push(
      createCircuitSymbol(createGate("led", 1), innerDisp.logicalCircuitId, 3, 3, "up", "sym-inner-led"),
    );
    const outerDisp = createDefaultLogicalCircuit("outer-disp", "OuterLED");
    outerDisp.circuitShape = "display";
    outerDisp.isDisplay = true;
    outerDisp.displayMargin = "none";
    outerDisp.circuitSymbols.push(
      createCircuitSymbol(innerDisp, outerDisp.logicalCircuitId, 1, 1, "up", "sym-nested-inner"),
    );
    nestedProj.logicalCircuits.push(innerDisp, outerDisp);
    const placedOuter = createCircuitSymbol(outerDisp, "main", 2, 2, "up", "sym-nested-outer");
    nestedProj.logicalCircuits[0].circuitSymbols.push(placedOuter);
    nestedProj.circuitSymbols.push(placedOuter);
    const syncedNested = syncProjectLogicalCircuits(nestedProj);
    const finalOuter = syncedNested.circuitSymbols.find((s) => s.circuitSymbolId === "sym-nested-outer")!;
    expect(finalOuter.circuit.symbolWidth).toBe(2);
    expect(finalOuter.circuit.symbolHeight).toBe(2);

    // Display-Subschaltung ohne gültige Display-Kinder behält Standardgröße 3x4
    const emptyProj = createEmptyCircuitProject("Empty Display Size", "Main", "main");
    const emptyDisp = createDefaultLogicalCircuit("empty-disp", "EmptyPanel");
    emptyDisp.circuitShape = "display";
    emptyDisp.isDisplay = true;
    emptyProj.logicalCircuits.push(emptyDisp);
    const placedEmpty = createCircuitSymbol(emptyDisp, "main", 2, 2, "up", "sym-empty");
    emptyProj.circuitSymbols.push(placedEmpty);
    const syncedEmpty = syncProjectLogicalCircuits(emptyProj).circuitSymbols[0];
    expect(syncedEmpty.circuit.symbolWidth).toBe(3);
    expect(syncedEmpty.circuit.symbolHeight).toBe(4);
  });
});
