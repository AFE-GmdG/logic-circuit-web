import { describe, expect, it } from "vitest";

import type { GateType, SignalState } from "../types/circuit";

// Einfache Simulation boolescher Basisfunktionen für Unit-Tests
function evaluateGate(type: GateType, inputs: SignalState[]): SignalState {
  if (inputs.some((state) => state === "undefined")) {
    return "undefined";
  }

  const boolInputs = inputs.map((state) => state === "high");

  switch (type) {
    case "not":
      return boolInputs[0] ? "low" : "high";
    case "and":
      return boolInputs.every(Boolean) ? "high" : "low";
    case "or":
      return boolInputs.some(Boolean) ? "high" : "low";
    case "xor": {
      const highCount = boolInputs.filter(Boolean).length;
      return highCount % 2 === 1 ? "high" : "low";
    }
    case "nand":
      return boolInputs.every(Boolean) ? "low" : "high";
    case "nor":
      return boolInputs.some(Boolean) ? "low" : "high";
    default:
      return "undefined";
  }
}

describe("Basic Gate Evaluation (Proof of Concept)", () => {
  it("evaluates NOT gate correctly", () => {
    expect(evaluateGate("not", ["low"])).toBe("high");
    expect(evaluateGate("not", ["high"])).toBe("low");
    expect(evaluateGate("not", ["undefined"])).toBe("undefined");
  });

  it("evaluates AND gate correctly", () => {
    expect(evaluateGate("and", ["low", "low"])).toBe("low");
    expect(evaluateGate("and", ["low", "high"])).toBe("low");
    expect(evaluateGate("and", ["high", "low"])).toBe("low");
    expect(evaluateGate("and", ["high", "high"])).toBe("high");
  });

  it("evaluates OR gate correctly", () => {
    expect(evaluateGate("or", ["low", "low"])).toBe("low");
    expect(evaluateGate("or", ["low", "high"])).toBe("high");
    expect(evaluateGate("or", ["high", "high"])).toBe("high");
  });

  it("evaluates XOR gate correctly", () => {
    expect(evaluateGate("xor", ["low", "low"])).toBe("low");
    expect(evaluateGate("xor", ["high", "low"])).toBe("high");
    expect(evaluateGate("xor", ["low", "high"])).toBe("high");
    expect(evaluateGate("xor", ["high", "high"])).toBe("low");
  });
});
