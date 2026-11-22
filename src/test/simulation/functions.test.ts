import { describe, expect, it } from "vitest";

import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import FunctionTriState from "../../simulation/functions/bus/functionTriState";
import FunctionTriStateGroup from "../../simulation/functions/bus/functionTriStateGroup";
import FunctionAnd from "../../simulation/functions/gates/functionAnd";
import FunctionAndNot from "../../simulation/functions/gates/functionAndNot";
import FunctionOr from "../../simulation/functions/gates/functionOr";
import FunctionOrNot from "../../simulation/functions/gates/functionOrNot";
import FunctionXor from "../../simulation/functions/gates/functionXor";
import FunctionXorNot from "../../simulation/functions/gates/functionXorNot";
import FunctionButton from "../../simulation/functions/io/functionButton";
import FunctionClock from "../../simulation/functions/io/functionClock";
import FunctionConstant from "../../simulation/functions/io/functionConstant";
import FunctionLed from "../../simulation/functions/io/functionLed";
import FunctionProbe from "../../simulation/functions/io/functionProbe";
import OneBitConst from "../../simulation/functions/io/oneBitConst";
import CircuitState from "../../simulation/state/circuitState";

describe("Simulation Functions", () => {
  it("berechnet die AND- und NAND-Wahrheitstabellen korrekt", () => {
    const state = new CircuitState();
    const inA = state.reserveState();
    const inB = state.reserveState();
    const outAnd = state.reserveState();
    const outNand = state.reserveState();

    const srcA = new OneBitConst(state, STATE_ON0, inA);
    const srcB = new OneBitConst(state, STATE_ON0, inB);

    FunctionAnd.create(state, [inA, inB], outAnd);
    FunctionAndNot.create(state, [inA, inB], outNand);
    state.endDefinition();

    const testCases: [number, number, number, number][] = [
      // inA, inB, expectedAnd, expectedNand
      [STATE_ON0, STATE_ON0, STATE_ON0, STATE_ON1],
      [STATE_ON0, STATE_ON1, STATE_ON0, STATE_ON1],
      [STATE_ON1, STATE_ON0, STATE_ON0, STATE_ON1],
      [STATE_ON1, STATE_ON1, STATE_ON1, STATE_ON0],
    ];

    for (const [a, b, expAnd, expNand] of testCases) {
      srcA.setState(a as any);
      srcB.setState(b as any);
      expect(state.evaluate(false)).toBe(true);
      expect(state.get(outAnd)).toBe(expAnd);
      expect(state.get(outNand)).toBe(expNand);
    }
  });

  it("berechnet die OR- und NOR-Wahrheitstabellen korrekt", () => {
    const state = new CircuitState();
    const inA = state.reserveState();
    const inB = state.reserveState();
    const outOr = state.reserveState();
    const outNor = state.reserveState();

    const srcA = new OneBitConst(state, STATE_ON0, inA);
    const srcB = new OneBitConst(state, STATE_ON0, inB);

    FunctionOr.create(state, [inA, inB], outOr);
    FunctionOrNot.create(state, [inA, inB], outNor);
    state.endDefinition();

    const testCases: [number, number, number, number][] = [
      [STATE_ON0, STATE_ON0, STATE_ON0, STATE_ON1],
      [STATE_ON0, STATE_ON1, STATE_ON1, STATE_ON0],
      [STATE_ON1, STATE_ON0, STATE_ON1, STATE_ON0],
      [STATE_ON1, STATE_ON1, STATE_ON1, STATE_ON0],
    ];

    for (const [a, b, expOr, expNor] of testCases) {
      srcA.setState(a as any);
      srcB.setState(b as any);
      expect(state.evaluate(false)).toBe(true);
      expect(state.get(outOr)).toBe(expOr);
      expect(state.get(outNor)).toBe(expNor);
    }
  });

  it("berechnet XOR und XNOR (Paritätsfunktion) korrekt", () => {
    const state = new CircuitState();
    const inA = state.reserveState();
    const inB = state.reserveState();
    const outXor = state.reserveState();
    const outXnor = state.reserveState();

    const srcA = new OneBitConst(state, STATE_ON0, inA);
    const srcB = new OneBitConst(state, STATE_ON0, inB);

    FunctionXor.create(state, [inA, inB], outXor);
    FunctionXorNot.create(state, [inA, inB], outXnor);
    state.endDefinition();

    const testCases: [number, number, number, number][] = [
      [STATE_ON0, STATE_ON0, STATE_ON0, STATE_ON1],
      [STATE_ON0, STATE_ON1, STATE_ON1, STATE_ON0],
      [STATE_ON1, STATE_ON0, STATE_ON1, STATE_ON0],
      [STATE_ON1, STATE_ON1, STATE_ON0, STATE_ON1],
    ];

    for (const [a, b, expXor, expXnor] of testCases) {
      srcA.setState(a as any);
      srcB.setState(b as any);
      expect(state.evaluate(false)).toBe(true);
      expect(state.get(outXor)).toBe(expXor);
      expect(state.get(outXnor)).toBe(expXnor);
    }
  });

  it("schaltet Taktsignale mit FunctionClock bei Flanken-Flip um", () => {
    const state = new CircuitState();
    const clkOut = state.reserveState();
    const clock = new FunctionClock(state, clkOut);
    state.endDefinition();

    expect(state.evaluate(false)).toBe(true);
    expect(state.get(clkOut)).toBe(STATE_ON0);

    // Flanke auslösen
    expect(state.evaluate(true)).toBe(true);
    expect(state.get(clkOut)).toBe(STATE_ON1);
    expect(clock.state).toBe(true);

    // Nächste Flanke
    expect(state.evaluate(true)).toBe(true);
    expect(state.get(clkOut)).toBe(STATE_ON0);
    expect(clock.state).toBe(false);
  });

  it("erzeugt Multi-Bit-Konstanten mit FunctionConstant", () => {
    const state = new CircuitState();
    const outBits = [
      state.reserveState(),
      state.reserveState(),
      state.reserveState(),
      state.reserveState(),
    ];

    const constant = new FunctionConstant(state, outBits, 0b1010);
    const probe = new FunctionProbe(state, outBits, "NibbleProbe");
    state.endDefinition();

    expect(state.evaluate(false)).toBe(true);
    expect(probe.toNumeric()).toBe(10);
    expect(probe.toText()).toBe("0xA");

    // Wert zur Laufzeit anpassen
    constant.value = 0b0101;
    expect(state.evaluate(false)).toBe(true);
    expect(probe.toNumeric()).toBe(5);
    expect(probe.toText()).toBe("0x5");
  });

  it("steuert interaktive Buttons und Schalter mit FunctionButton", () => {
    const state = new CircuitState();
    const btnOut = state.reserveState();
    const toggleOut = state.reserveState();

    const pushBtn = new FunctionButton(state, btnOut, { isToggle: false });
    const toggleBtn = new FunctionButton(state, toggleOut, { isToggle: true });
    state.endDefinition();

    expect(state.evaluate(false)).toBe(true);
    expect(state.get(btnOut)).toBe(STATE_ON0);
    expect(state.get(toggleOut)).toBe(STATE_ON0);

    // Push Button drücken
    pushBtn.press(true);
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(btnOut)).toBe(STATE_ON1);

    // Push Button loslassen
    pushBtn.press(false);
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(btnOut)).toBe(STATE_ON0);

    // Toggle Button schalten
    toggleBtn.toggle();
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(toggleOut)).toBe(STATE_ON1);

    toggleBtn.toggle();
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(toggleOut)).toBe(STATE_ON0);
  });

  it("löst Tri-State-Treiber und Tri-State-Gruppen kollisionsfrei auf", () => {
    const state = new CircuitState();
    const busLine = state.reserveState();

    const dataA = state.reserveState();
    const enA = state.reserveState();
    const drvAOut = state.reserveState();

    const dataB = state.reserveState();
    const enB = state.reserveState();
    const drvBOut = state.reserveState();

    const srcDataA = new OneBitConst(state, STATE_ON1, dataA);
    const srcEnA = new OneBitConst(state, STATE_ON0, enA);

    const srcDataB = new OneBitConst(state, STATE_ON0, dataB);
    const srcEnB = new OneBitConst(state, STATE_ON0, enB);

    new FunctionTriState(state, dataA, enA, drvAOut);
    new FunctionTriState(state, dataB, enB, drvBOut);

    // Beide Treiber speisen auf die gemeinsame Busleitung
    new FunctionTriStateGroup(state, [drvAOut, drvBOut], busLine);
    state.endDefinition();

    // Zustand A: Beide Enable aus -> Bus ist hochohmig (Off)
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(busLine)).toBe(STATE_OFF);

    // Zustand B: Treiber A aktiv (Data = 1) -> Bus ist On1
    srcEnA.setState(STATE_ON1);
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(busLine)).toBe(STATE_ON1);

    // Zustand C: Treiber A aus, Treiber B aktiv (Data = 0) -> Bus ist On0
    srcEnA.setState(STATE_ON0);
    srcEnB.setState(STATE_ON1);
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(busLine)).toBe(STATE_ON0);

    // Zustand D: Daten an Treiber A ändern
    srcDataA.setState(STATE_ON0);
    srcEnA.setState(STATE_ON1);
    srcEnB.setState(STATE_ON0);
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(busLine)).toBe(STATE_ON0);

    // Zustand E: Daten an Treiber B ändern
    srcDataB.setState(STATE_ON1);
    srcEnA.setState(STATE_ON0);
    srcEnB.setState(STATE_ON1);
    expect(state.evaluate(false)).toBe(true);
    expect(state.get(busLine)).toBe(STATE_ON1);
  });

  it("aktualisiert LED- und Display-Anzeigen", () => {
    const state = new CircuitState();
    const ledInput = state.reserveState();
    const src = new OneBitConst(state, STATE_ON1, ledInput);
    const led = new FunctionLed(state, [ledInput], "single");
    state.endDefinition();

    expect(state.evaluate(false)).toBe(true);
    expect(led.isOn).toBe(true);

    src.setState(STATE_ON0);
    expect(state.evaluate(false)).toBe(true);
    expect(led.isOn).toBe(false);
  });
});
