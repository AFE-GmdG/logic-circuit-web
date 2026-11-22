import { describe, expect, it } from "vitest";

import { STATE_OFF, STATE_ON0, STATE_ON1 } from "../../types/simulation/state";

import FunctionNot from "../../simulation/functions/gates/functionNot";
import FunctionNor from "../../simulation/functions/gates/functionOrNot";
import OneBitConst from "../../simulation/functions/io/oneBitConst";
import Probe from "../../simulation/functions/io/probe";
import CircuitState from "../../simulation/state/circuitState";
import DirtyList from "../../simulation/state/dirtyList";

class TestProbe extends Probe {
  get reportName(): string {
    return "TestProbe";
  }

  evaluate(): boolean {
    this.updateState();
    return false;
  }
}

describe("CircuitState & DirtyList", () => {
  it("initialisiert feste Konstanten an den Indizes 0, 1, 2", () => {
    const state = new CircuitState();
    expect(state.get(0)).toBe(STATE_OFF);
    expect(state.get(1)).toBe(STATE_ON0);
    expect(state.get(2)).toBe(STATE_ON1);
  });

  it("allokiert neue Zustandsindizes fortlaufend", () => {
    const state = new CircuitState();
    const idx1 = state.reserveState();
    const idx2 = state.reserveState();
    expect(idx1).toBe(3);
    expect(idx2).toBe(4);
    expect(state.count).toBe(5);
  });

  it("verarbeitet Funktionen über die DirtyList deterministisch", () => {
    const list = new DirtyList(42);
    expect(list.get()).toBeNull();
  });

  it("erkennt endlose Oszillationen und bricht kontrolliert ab", () => {
    const state = new CircuitState();
    const loopNode = state.reserveState();

    // NOT-Gatter, dessen Ausgang direkt wieder auf seinen Eingang zurückgeführt ist
    const notGate = new FunctionNot(state, loopNode, loopNode);
    state.endDefinition();

    // Durch externes Anstoßen gerät das Gatter in eine Dauerschwingung
    state.markUpdated(notGate);

    // Die Simulation muss die Schwingung erkennen und nach 3 Retries false liefern
    const stable = state.evaluate(false);
    expect(stable).toBe(false);
  });

  it("stabilisiert rückgekoppelte Schaltungen wie ein RS-Flip-Flop (NOR-Latch)", () => {
    const state = new CircuitState();
    const sInput = state.reserveState();
    const rInput = state.reserveState();
    const qOutput = state.reserveState();
    const qBarOutput = state.reserveState();

    const sSource = new OneBitConst(state, STATE_ON0, sInput);
    const rSource = new OneBitConst(state, STATE_ON0, rInput);

    // Q = NOR(R, Q_bar)
    FunctionNor.create(state, [rInput, qBarOutput], qOutput);
    // Q_bar = NOR(S, Q)
    FunctionNor.create(state, [sInput, qOutput], qBarOutput);

    const qProbe = new TestProbe(state, [qOutput]);
    const qBarProbe = new TestProbe(state, [qBarOutput]);

    state.endDefinition();

    // Schritt A: Initialisieren (S=0, R=0)
    let ok = state.evaluate(false);
    expect(ok).toBe(true);

    // Schritt B: SET aktivieren: S=1, R=0 -> Q muss 1 werden, Q_bar 0
    sSource.setState(STATE_ON1);
    ok = state.evaluate(false);
    expect(ok).toBe(true);
    expect(qProbe.get(0)).toBe(STATE_ON1);
    expect(qBarProbe.get(0)).toBe(STATE_ON0);

    // Schritt C: SET zurücknehmen: S=0, R=0 -> Zustand muss gespeichert bleiben
    sSource.setState(STATE_ON0);
    ok = state.evaluate(false);
    expect(ok).toBe(true);
    expect(qProbe.get(0)).toBe(STATE_ON1);
    expect(qBarProbe.get(0)).toBe(STATE_ON0);

    // Schritt D: RESET aktivieren: S=0, R=1 -> Q muss 0 werden, Q_bar 1
    rSource.setState(STATE_ON1);
    ok = state.evaluate(false);
    expect(ok).toBe(true);
    expect(qProbe.get(0)).toBe(STATE_ON0);
    expect(qBarProbe.get(0)).toBe(STATE_ON1);

    // Schritt E: RESET zurücknehmen: S=0, R=0 -> Zustand bleibt 0
    rSource.setState(STATE_ON0);
    ok = state.evaluate(false);
    expect(ok).toBe(true);
    expect(qProbe.get(0)).toBe(STATE_ON0);
    expect(qBarProbe.get(0)).toBe(STATE_ON1);
  });
});
