import { describe, expect, it } from "vitest";

import type GridPoint from "../../types/canvas/gridPoint";
import type Wire from "../../types/circuit/wire";

import CircuitRunner from "../../simulation/worker/circuitRunner";
import {
  createCircuitButton,
  createCircuitProbe,
  createCircuitSymbol,
  createDefaultLogicalCircuit,
  createGate,
} from "../../utils/circuitLayout";

function makeWire(wireId: string, logicalCircuitId: string, point1: GridPoint, point2: GridPoint): Wire {
  return {
    wireId,
    logicalCircuitId,
    x1: point1.x,
    y1: point1.y,
    x2: point2.x,
    y2: point2.y,
    point1,
    point2,
  };
}

describe("CircuitRunner (Simulations-Laufzeit)", () => {
  it("führt deterministische Einzelschritte aus und reagiert auf Tastendruck", () => {
    const circuit = createDefaultLogicalCircuit("main", "SingleStepTest");

    // Button (Höhe 2, Pin bei y=1) platziert bei (0, 1) -> Output bei (2, 2)
    const btn = createCircuitButton("btn-1", "btn-1", false, "right");
    const btnSym = createCircuitSymbol(btn, "main", 0, 1, "up", "sym-btn");

    // NOT-Gate (Höhe 4, Pins bei y=2) platziert bei (10, 0) -> In bei (10, 2), Out bei (13, 2)
    const notGate = createGate("not", 1, false);
    const notSym = createCircuitSymbol(notGate, "main", 10, 0, "up", "sym-not");

    // Probe (Höhe 2, Pin bei y=1) platziert bei (20, 1) -> In bei (20, 2)
    const probe = createCircuitProbe("probe-1", "OutProbe");
    const probeSym = createCircuitSymbol(probe, "main", 20, 1, "up", "sym-probe");

    circuit.circuitSymbols = [btnSym, notSym, probeSym];

    const btnOutJam = btnSym.jams.find((j) => j.pin.pinType === "output")!;
    const notInJam = notSym.jams.find((j) => j.pin.pinType === "input")!;
    const notOutJam = notSym.jams.find((j) => j.pin.pinType === "output")!;
    const probeInJam = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("w1", "main", btnOutJam.absolutePoint, notInJam.absolutePoint),
      makeWire("w2", "main", notOutJam.absolutePoint, probeInJam.absolutePoint),
    ];

    const runner = new CircuitRunner(circuit);
    expect(runner.probeCount).toBe(1);
    expect(runner.buttonCount).toBe(1);

    // Initialer Schritt: NOT(0) = 1
    const res1 = runner.step(1);
    expect(res1.stepsCompleted).toBe(1);
    expect(res1.oscillating).toBe(false);
    expect(res1.snapshot.probes["probe-1"].value).toBe(1);

    // Taster drücken (Eingang = 1) -> NOT(1) = 0
    runner.setButtonState("btn-1", true);
    const res2 = runner.step(1);
    expect(res2.snapshot.probes["probe-1"].value).toBe(0);

    // Taster loslassen -> NOT(0) = 1
    runner.setButtonState("btn-1", false);
    const res3 = runner.step(1);
    expect(res3.snapshot.probes["probe-1"].value).toBe(1);

    expect(runner.totalSteps).toBe(3);
    runner.dispose();
  });

  it("unterstützt deterministisches Batch-Stepping mit exakter Schrittanzahl", () => {
    const circuit = createDefaultLogicalCircuit("main", "BatchStepTest");

    const btn = createCircuitButton("btn-batch", "btn-batch", false, "right");
    const btnSym = createCircuitSymbol(btn, "main", 0, 1, "up", "sym-btn");

    const probe = createCircuitProbe("probe-batch", "DirectProbe");
    const probeSym = createCircuitSymbol(probe, "main", 10, 1, "up", "sym-probe");

    circuit.circuitSymbols = [btnSym, probeSym];

    const btnOutJam = btnSym.jams.find((j) => j.pin.pinType === "output")!;
    const probeInJam = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("w1", "main", btnOutJam.absolutePoint, probeInJam.absolutePoint),
    ];

    const runner = new CircuitRunner(circuit);

    const result = runner.step(100);
    expect(result.stepsCompleted).toBe(100);
    expect(runner.totalSteps).toBe(100);
    expect(result.oscillating).toBe(false);

    runner.dispose();
  });

  it("erkennt unlösbare Oszillationen und bricht das Stepping sauber ab", () => {
    const circuit = createDefaultLogicalCircuit("main", "OscillationTest");

    // Enable-Button (inverted = true -> liefert initial 1)
    const btn = createCircuitButton("btn-osc", "btn-osc", false, "right", true);
    const btnSym = createCircuitSymbol(btn, "main", 0, 0, "up", "sym-btn");

    // NAND-Gatter: 2 Eingänge, invertierter Ausgang
    const nandGate = createGate("and", 2, true);
    const nandSym = createCircuitSymbol(nandGate, "main", 10, 0, "up", "sym-nand");

    circuit.circuitSymbols = [btnSym, nandSym];

    const btnOutJam = btnSym.jams.find((j) => j.pin.pinType === "output")!;
    const nandInJams = nandSym.jams.filter((j) => j.pin.pinType === "input");
    const nandIn1 = nandInJams[0];
    const nandIn2 = nandInJams[1];
    const nandOutJam = nandSym.jams.find((j) => j.pin.pinType === "output")!;

    // Button auf Eingang 1, Ausgang auf Eingang 2 rückgekoppelt: NAND(1, Q) -> NOT(Q)
    circuit.wires = [
      makeWire("w-in", "main", btnOutJam.absolutePoint, nandIn1.absolutePoint),
      makeWire("w-loop-1", "main", nandOutJam.absolutePoint, { x: 15, y: nandOutJam.absolutePoint.y }),
      makeWire("w-loop-2", "main", { x: 15, y: nandOutJam.absolutePoint.y }, { x: 15, y: nandIn2.absolutePoint.y }),
      makeWire("w-loop-3", "main", { x: 15, y: nandIn2.absolutePoint.y }, nandIn2.absolutePoint),
    ];

    const runner = new CircuitRunner(circuit);
    const res = runner.step(1);

    expect(res.oscillating).toBe(true);
    expect(runner.isOscillating).toBe(true);
    runner.dispose();
  });

  it("behandelt Wechselschalter (ToggleSwitch) korrekt", () => {
    const circuit = createDefaultLogicalCircuit("main", "ToggleTest");

    const toggle = createCircuitButton("toggle-1", "toggle-1", true, "right");
    const toggleSym = createCircuitSymbol(toggle, "main", 0, 1, "up", "sym-toggle");

    const probe = createCircuitProbe("probe-toggle", "ToggleProbe");
    const probeSym = createCircuitSymbol(probe, "main", 10, 1, "up", "sym-probe");

    circuit.circuitSymbols = [toggleSym, probeSym];

    const outJam = toggleSym.jams.find((j) => j.pin.pinType === "output")!;
    const inJam = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("w1", "main", outJam.absolutePoint, inJam.absolutePoint),
    ];

    const runner = new CircuitRunner(circuit);
    runner.step(1);
    expect(runner.getSnapshot().probes["probe-toggle"].value).toBe(0);

    runner.toggleButton("toggle-1");
    runner.step(1);
    expect(runner.getSnapshot().probes["probe-toggle"].value).toBe(1);

    runner.toggleButton("toggle-1");
    runner.step(1);
    expect(runner.getSnapshot().probes["probe-toggle"].value).toBe(0);

    runner.dispose();
  });

  it("schaltet Simulations-Frequenzen und Max-Speed-Modus dynamisch um", () => {
    const circuit = createDefaultLogicalCircuit("main", "SpeedTest");
    const runner = new CircuitRunner(circuit, { frameRateLimit: 10 });
    expect(runner.frameRateLimit).toBe(10);

    runner.setSpeed(60);
    expect(runner.frameRateLimit).toBe(60);

    runner.setSpeed("max");
    expect(runner.frameRateLimit).toBe("max");

    runner.dispose();
  });

  it("schont die CPU bei Schaltungen ohne Taktgeber und reagiert im laufenden Betrieb sofort auf Eingaben", () => {
    const circuit = createDefaultLogicalCircuit("main", "ClocklessTest");

    const btn = createCircuitButton("btn-c", "btn-c", false, "right");
    const btnSym = createCircuitSymbol(btn, "main", 0, 1, "up", "sym-btn");

    const notGate = createGate("not", 1, false);
    const notSym = createCircuitSymbol(notGate, "main", 10, 0, "up", "sym-not");

    const probe = createCircuitProbe("probe-c", "ProbeC");
    const probeSym = createCircuitSymbol(probe, "main", 20, 1, "up", "sym-probe");

    circuit.circuitSymbols = [btnSym, notSym, probeSym];

    const btnOutJam = btnSym.jams.find((j) => j.pin.pinType === "output")!;
    const notInJam = notSym.jams.find((j) => j.pin.pinType === "input")!;
    const notOutJam = notSym.jams.find((j) => j.pin.pinType === "output")!;
    const probeInJam = probeSym.jams.find((j) => j.pin.pinType === "input")!;

    circuit.wires = [
      makeWire("w1", "main", btnOutJam.absolutePoint, notInJam.absolutePoint),
      makeWire("w2", "main", notOutJam.absolutePoint, probeInJam.absolutePoint),
    ];

    const runner = new CircuitRunner(circuit);
    expect(runner.hasClocks).toBe(false);

    // Simulation starten
    runner.start();
    expect(runner.isRunning).toBe(true);

    // Initialer Zustand ist sofort stabil (NOT(0) = 1)
    expect(runner.getSnapshot().probes["probe-c"].value).toBe(1);

    // Tastendruck im laufenden Betrieb aktualisiert den Schaltungszustand sofort ohne extra Stepping
    runner.setButtonState("btn-c", true);
    expect(runner.getSnapshot().probes["probe-c"].value).toBe(0);

    // Taste loslassen
    runner.setButtonState("btn-c", false);
    expect(runner.getSnapshot().probes["probe-c"].value).toBe(1);

    runner.dispose();
  });

  it("führt ohne Taktgeber freie Step-Sequenzen und zeitgesteuerte Eingabe-Events (atStep) deterministisch aus", () => {
    const circuit = createDefaultLogicalCircuit("main", "ScheduledEventsTest");

    const toggleA = createCircuitButton("btn-a", "A", true, "right");
    const symA = createCircuitSymbol(toggleA, "main", 0, 0, "up", "sym-a");

    const pushB = createCircuitButton("btn-b", "B", false, "right");
    const symB = createCircuitSymbol(pushB, "main", 0, 4, "up", "sym-b");

    const pushC = createCircuitButton("btn-c", "C", false, "right");
    const symC = createCircuitSymbol(pushC, "main", 0, 8, "up", "sym-c");

    // AND(B, C) prüft das gleichzeitige Halten zweier Taster
    const andBC = createGate("and", 2, false);
    const symAndBC = createCircuitSymbol(andBC, "main", 8, 4, "up", "sym-and-bc");

    // AND(A, AND(B, C)) prüft Schalter A && beide Taster gleichzeitig
    const andAll = createGate("and", 2, false);
    const symAndAll = createCircuitSymbol(andAll, "main", 16, 2, "up", "sym-and-all");

    const probeA = createCircuitProbe("probe-a", "ProbeA");
    const symProbeA = createCircuitSymbol(probeA, "main", 8, 0, "up", "sym-pa");

    const probeAll = createCircuitProbe("probe-all", "ProbeAll");
    const symProbeAll = createCircuitSymbol(probeAll, "main", 22, 2, "up", "sym-pall");

    circuit.circuitSymbols = [symA, symB, symC, symAndBC, symAndAll, symProbeA, symProbeAll];

    const outA = symA.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const outB = symB.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const outC = symC.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const inBC = symAndBC.jams.filter((j) => j.pin.pinType === "input");
    const outBC = symAndBC.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const inAll = symAndAll.jams.filter((j) => j.pin.pinType === "input");
    const outAll = symAndAll.jams.find((j) => j.pin.pinType === "output")!.absolutePoint;
    const inProbeA = symProbeA.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;
    const inProbeAll = symProbeAll.jams.find((j) => j.pin.pinType === "input")!.absolutePoint;

    circuit.wires = [
      makeWire("w-a", "main", outA, inProbeA),
      makeWire("w-a2", "main", outA, inAll[0].absolutePoint),
      makeWire("w-b", "main", outB, inBC[0].absolutePoint),
      makeWire("w-c", "main", outC, inBC[1].absolutePoint),
      makeWire("w-bc", "main", outBC, inAll[1].absolutePoint),
      makeWire("w-all", "main", outAll, inProbeAll),
    ];

    const runner = new CircuitRunner(circuit);
    expect(runner.hasClocks).toBe(false);

    // Pause-/Vorlauf-Propagation bei setButtonState ohne laufende Execution-Loop
    runner.step(0);
    runner.setButtonState("btn-b", true);
    runner.setButtonState("btn-c", true);
    expect(runner.getSnapshot().probes["probe-a"].value).toBe(0);
    runner.toggleButton("btn-a");
    expect(runner.getSnapshot().probes["probe-all"].value).toBe(1);

    // Alles zurücksetzen für sauberen 35-Takte-Lauf
    runner.setButtonState("btn-b", false);
    runner.setButtonState("btn-c", false);
    runner.toggleButton("btn-a");

    // Erste Phase bis Takt 8: Toggle A bei 3, B & C gleichzeitig drücken bei 7
    const upTo8 = runner.step(8, [
      { atStep: 3, buttonId: "btn-a", toggle: true },
      { atStep: 7, buttonId: "btn-b", on: true },
      { atStep: 7, buttonId: "btn-c", on: true },
    ]);
    expect(upTo8.stepsCompleted).toBe(8);
    expect(upTo8.snapshot.probes["probe-a"].value).toBe(1);
    expect(upTo8.snapshot.probes["probe-all"].value).toBe(1);
    expect(upTo8.snapshot.telemetry.hasClocks).toBe(false);

    // Restphase Takt 9..35 (27 Schritte): B bei erstem Schritt (= Takt 9) loslassen, C bleibt gedrückt
    const rest27 = runner.step(27, [
      { atStep: 1, buttonId: "btn-b", on: false },
    ]);
    expect(rest27.stepsCompleted).toBe(27);
    expect(rest27.snapshot.telemetry.totalSteps).toBe(35);
    expect(rest27.snapshot.buttons["btn-a"].isOn).toBe(true);
    expect(rest27.snapshot.buttons["btn-b"].isOn).toBe(false);
    expect(rest27.snapshot.buttons["btn-c"].isOn).toBe(true);
    expect(rest27.snapshot.probes["probe-all"].value).toBe(0);

    runner.dispose();
  });
});
