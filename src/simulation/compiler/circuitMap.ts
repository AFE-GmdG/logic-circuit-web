import type GridPoint from "../../types/canvas/gridPoint";
import type Circuit from "../../types/circuit/circuit";
import type CircuitButton from "../../types/circuit/circuitButton";
import type CircuitProbe from "../../types/circuit/circuitProbe";
import type CircuitSymbol from "../../types/circuit/circuitSymbol";
import type Constant from "../../types/circuit/constant";
import type DevicePin from "../../types/circuit/devicePin";
import type Gate from "../../types/circuit/gate";
import type GraphicsArray from "../../types/circuit/graphicsArray";
import type Jam from "../../types/circuit/jam";
import type LedMatrix from "../../types/circuit/ledMatrix";
import type LogicalCircuit from "../../types/circuit/logicalCircuit";
import type Memory from "../../types/circuit/memory";
import type Sensor from "../../types/circuit/sensor";
import type Sound from "../../types/circuit/sound";
import type Synthesizer from "../../types/circuit/synthesizer";
import type Wire from "../../types/circuit/wire";
import type CircuitCleanUpReport from "../../types/simulation/circuitCleanUpReport";
import type SimulationErrorLocation from "../../types/simulation/simulationErrorLocation";
import type WireCleanUpInfo from "../../types/simulation/wireCleanUpInfo";

import i18n from "../../i18n";
import {
  buildConductorMap,
  comparePins,
  getGraphicsArrayAddressBitWidth,
  gridPointKey,
  passSplitterBit,
} from "../../utils/circuitLayout";
import { SOUND_WEB_DEFAULTS } from "../../utils/xml/logicCircuitXmlConstants";

import CircuitException from "./circuitException";
import ConnectionSet, { getJamKey } from "./connectionSet";
import SymbolMap, { type Result } from "./symbolMap";
import SymbolMapList from "./symbolMapList";
import FunctionTriState from "../functions/bus/functionTriState";
import FunctionTriStateGroup from "../functions/bus/functionTriStateGroup";
import type CircuitFunction from "../functions/circuitFunction";
import FunctionAnd from "../functions/gates/functionAnd";
import FunctionAndNot from "../functions/gates/functionAndNot";
import FunctionNot from "../functions/gates/functionNot";
import FunctionOr from "../functions/gates/functionOr";
import FunctionOrNot from "../functions/gates/functionOrNot";
import FunctionXor from "../functions/gates/functionXor";
import FunctionXorNot from "../functions/gates/functionXorNot";
import FunctionButton from "../functions/io/functionButton";
import FunctionClock from "../functions/io/functionClock";
import FunctionConstant from "../functions/io/functionConstant";
import FunctionGraphicsArray from "../functions/io/functionGraphicsArray";
import FunctionLed from "../functions/io/functionLed";
import {
  FunctionLedMatrixIndividual,
  FunctionLedMatrixSelector,
} from "../functions/io/functionLedMatrix";
import FunctionProbe from "../functions/io/functionProbe";
import FunctionSensor from "../functions/io/functionSensor";
import FunctionSound from "../functions/io/functionSound";
import FunctionSynthesizer from "../functions/io/functionSynthesizer";
import FunctionRam from "../functions/memory/functionRam";
import FunctionRom from "../functions/memory/functionRom";
import CircuitState from "../state/circuitState";

// Liefert die Kette aller Subschaltungs-Symbol-IDs vom Wurzelknoten bis zur angegebenen CircuitMap
export function getCircuitMapSymbolChain(map: CircuitMap | null | undefined): string[] {
  const chain: string[] = [];
  let curr: CircuitMap | null | undefined = map;
  while (curr && curr.symbol) {
    chain.unshift(curr.symbol.circuitSymbolId);
    curr = curr.parent;
  }
  return chain;
}

// Ermittelt eine im Instanzbaum eindeutige Button-ID (Wurzel: rawButtonId, Subschaltung: Pfad/rawButtonId)
export function getButtonInstanceId(
  map: CircuitMap | null | undefined,
  symbol: CircuitSymbol,
): string {
  const btn = symbol.circuit as Partial<CircuitButton>;
  const rawButtonId = btn.circuitButtonId ?? symbol.circuit.circuitId;
  const symbolChain = getCircuitMapSymbolChain(map);
  return symbolChain.length > 0 ? `${symbolChain.join("/")}/${rawButtonId}` : rawButtonId;
}

// Ermittelt eine im Instanzbaum eindeutige Speicher-ID (analog zu getButtonInstanceId)
export function getMemoryInstanceId(
  map: CircuitMap | null | undefined,
  symbol: CircuitSymbol,
): string {
  const symbolChain = getCircuitMapSymbolChain(map);
  return symbolChain.length > 0 ? `${symbolChain.join("/")}/${symbol.circuitSymbolId}` : symbol.circuitSymbolId;
}

// Ermittelt eine im Instanzbaum eindeutige Audio-Kanal-ID fuer Sound- und Synthesizer-Bausteine
export function getAudioInstanceId(
  map: CircuitMap | null | undefined,
  symbol: CircuitSymbol,
): string {
  const symbolChain = getCircuitMapSymbolChain(map);
  return symbolChain.length > 0 ? `${symbolChain.join("/")}/${symbol.circuitSymbolId}` : symbol.circuitSymbolId;
}

// Ermittelt eine im Instanzbaum eindeutige GraphicsArray-Instanz-ID
export function getGraphicsArrayInstanceId(
  map: CircuitMap | null | undefined,
  symbol: CircuitSymbol,
): string {
  const symbolChain = getCircuitMapSymbolChain(map);
  return symbolChain.length > 0 ? `${symbolChain.join("/")}/${symbol.circuitSymbolId}` : symbol.circuitSymbolId;
}

// Prüft, ob ein Bauteil ein primitives Funktionselement ist analog zu CircuitMap.IsPrimitive
export function isPrimitive(circuit: Circuit): boolean {
  return (
    circuit.kind === "gate" ||
    circuit.kind === "circuitProbe" ||
    circuit.kind === "circuitButton" ||
    circuit.kind === "constant" ||
    circuit.kind === "memory" ||
    circuit.kind === "ledMatrix" ||
    circuit.kind === "sensor" ||
    circuit.kind === "sound" ||
    circuit.kind === "synthesizer" ||
    circuit.kind === "graphicsArray"
  );
}

// Zentraler Schaltungs-Compiler und Hierarchie-Baum analog zu CircuitMap.cs
export class CircuitMap {
  readonly circuit: LogicalCircuit;
  readonly parent: CircuitMap | null;
  readonly symbol: CircuitSymbol | null;
  readonly children = new Map<string, CircuitMap>();
  readonly #wireToJamMap = new Map<string, Jam[]>();
  readonly #jamStateMap = new Map<string, number[]>();
  readonly #treatRootPinsAsBoundary: boolean;
  #symbolMapList: SymbolMapList | null = null;

  constructor(
    circuit: LogicalCircuit,
    parent: CircuitMap | null = null,
    symbol: CircuitSymbol | null = null,
    options?: { treatRootPinsAsBoundary?: boolean },
  ) {
    this.circuit = circuit;
    this.parent = parent;
    this.symbol = symbol;
    this.#treatRootPinsAsBoundary = Boolean(options?.treatRootPinsAsBoundary);
    this.#expand();
  }

  get isRoot(): boolean {
    return this.parent === null;
  }

  get root(): CircuitMap {
    let curr: CircuitMap = this;
    while (curr.parent) {
      curr = curr.parent;
    }
    return curr;
  }

  get symbolMapList(): SymbolMapList | null {
    return this.root.#symbolMapList;
  }

  findSymbol(circuitSymbolId: string): CircuitSymbol | undefined {
    return this.circuit.circuitSymbols.find((s) => s.circuitSymbolId === circuitSymbolId);
  }

  getSymbolLocation(symbol: CircuitSymbol): SimulationErrorLocation {
    return {
      circuitId: this.circuit.logicalCircuitId,
      circuitName: this.circuit.name,
      symbolId: symbol.circuitSymbolId,
      symbolName: symbol.circuit.name,
      x: symbol.x,
      y: symbol.y,
    };
  }

  child(symbol: CircuitSymbol): CircuitMap | undefined {
    return this.children.get(symbol.circuitSymbolId);
  }

  // Prüft, ob der angegebene Schaltplan in der aktuellen Elternhierarchie zyklisch vorkommt
  hasLoop(circuit: LogicalCircuit): boolean {
    for (let p: CircuitMap | null = this; p !== null; p = p.parent) {
      if (p.circuit.logicalCircuitId === circuit.logicalCircuitId) {
        return true;
      }
    }
    return false;
  }

  // Erzeugt den hierarchischen Pfadstring für Debugging und Fehlermeldungen analog zu CircuitMap.Path
  path(symbol?: CircuitSymbol): string {
    let text = "";
    if (this.parent) {
      text = this.parent.path();
    }
    if (text.length > 0) {
      text += "/";
    }
    text += this.circuit.name;
    if (this.symbol) {
      text += `[${this.symbol.x},${this.symbol.y}]`;
    }
    if (symbol) {
      text += `/${symbol.circuit.name}[${symbol.x},${symbol.y}]`;
    }
    return text;
  }

  // Baut rekursiv die Schaltungshierarchie auf
  #expand(): void {
    for (const sym of this.circuit.circuitSymbols) {
      if (!isPrimitive(sym.circuit) && sym.circuit.kind === "logicalCircuit") {
        const sub = sym.circuit as LogicalCircuit;
        if (this.hasLoop(sub)) {
          throw new CircuitException(
            i18n.t("errors.compiler.recursiveLoop", {
              subName: sub.name,
              path: this.path(sym),
            }),
            "userError",
            this.getSymbolLocation(sym),
          );
        }

        // Falls innere Jams noch nicht im Editor verknüpft wurden, hier deterministisch auflösen
        for (const jam of sym.jams) {
          if (!jam.innerJam) {
            const innerPinSym = sub.circuitSymbols.find(
              (s) =>
                s.circuitId === jam.pin.pinId ||
                (s.circuit.kind === "pin" && s.circuit.name === jam.pin.name),
            );
            if (innerPinSym && innerPinSym.jams.length > 0) {
              jam.innerJam = innerPinSym.jams[0];
            }
          }
        }

        const childMap = new CircuitMap(sub, this, sym);
        this.children.set(sym.circuitSymbolId, childMap);
      }
    }
  }

  // Analysiert alle topologischen Leitungsverbindungen der Schaltungshierarchie analog zu CircuitMap.Connect
  connectAll(connectionSet: ConnectionSet): void {
    const conductorMap = buildConductorMap(this.circuit.wires);

    // Mappe Leitungssegmente auf die Jams an ihren Endpunkten (für jede Instanz separat)
    this.#wireToJamMap.clear();
    for (const wire of this.circuit.wires) {
      const p1Key = gridPointKey(wire.point1);
      const p2Key = gridPointKey(wire.point2);
      const c1 = conductorMap.byPointKey.get(p1Key);
      const c2 = conductorMap.byPointKey.get(p2Key);
      const cond = c1 || c2;
      if (cond) {
        const jams: Jam[] = [];
        for (const pt of cond.points) {
          const ptKey = gridPointKey(pt);
          for (const s of this.circuit.circuitSymbols) {
            for (const j of s.jams) {
              if (gridPointKey(j.absolutePoint) === ptKey) {
                jams.push(j);
              }
            }
          }
        }
        this.#wireToJamMap.set(wire.wireId, jams);
      }
    }

    if (!connectionSet.isConnected(this.circuit.logicalCircuitId)) {
      connectionSet.markConnected(this.circuit.logicalCircuitId);

      const inJamMap = new Map<string, Jam[]>();
      for (const sym of this.circuit.circuitSymbols) {
        for (const jam of sym.jams) {
          if (jam.effectivePinType !== "output") {
            const ptKey = gridPointKey(jam.absolutePoint);
            let list = inJamMap.get(ptKey);
            if (!list) {
              list = [];
              inJamMap.set(ptKey, list);
            }
            list.push(jam);
          }
        }
      }

      // Verbinde alle Jams auf denselben elektrischen Leitern analog zu C#
      for (const sym of this.circuit.circuitSymbols) {
        for (const outJam of sym.jams) {
          if (outJam.effectivePinType !== "input") {
            const outPtKey = gridPointKey(outJam.absolutePoint);
            const conductor = conductorMap.byPointKey.get(outPtKey);
            if (conductor) {
              for (const pt of conductor.points) {
                const ptKey = gridPointKey(pt);
                const inList = inJamMap.get(ptKey);
                if (inList) {
                  for (const inJam of inList) {
                    if (inJam !== outJam) {
                      if (inJam.pin.bitWidth !== outJam.pin.bitWidth) {
                        const inSym = this.findSymbol(inJam.circuitSymbolId);
                        if (inSym?.circuit.kind !== "circuitProbe") {
                          const outName = sym.circuit.name;
                          const inName = inJam.pin.name;
                          throw new CircuitException(
                            i18n.t("errors.compiler.bitWidthConflict", {
                              outName,
                              outBits: outJam.pin.bitWidth,
                              inName,
                              inBits: inJam.pin.bitWidth,
                              circuitName: this.circuit.name,
                            }),
                            "userError",
                            this.getSymbolLocation(inSym ?? sym),
                          );
                        }
                      }
                      connectionSet.connect(inJam, outJam);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    for (const child of this.children.values()) {
      child.connectAll(connectionSet);
    }
  }

  // Leitet ein einzelnes Bit durch Schaltungshierarchien, Splitter und Pins analog zu CircuitMap.Connect
  #connectSignal(
    connectionSet: ConnectionSet,
    list: SymbolMapList,
    result: Result,
    jam: Jam,
    bitNumber: number,
    visited: Set<string>,
  ): void {
    const visitKey = `${this.path()}:${jam.circuitSymbolId}:${jam.pin.pinId}:${bitNumber}`;
    if (visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);

    const connections = connectionSet.selectByOutput(jam);
    for (const con of connections) {
      const sym = this.findSymbol(con.inJam.circuitSymbolId);
      if (!sym) {
        continue;
      }

      const circuit = sym.circuit;
      if (isPrimitive(circuit)) {
        list.addParameter(result, this, con.inJam, bitNumber);
      } else if (circuit.kind === "pin") {
        if (this.parent && this.symbol) {
          const outerJam = this.symbol.jams.find(
            (j) => j.pin.pinId === circuit.circuitId || j.pin.name === circuit.name,
          );
          if (outerJam) {
            this.parent.#connectSignal(connectionSet, list, result, outerJam, bitNumber, visited);
          }
        } else if (this.isRoot && this.#treatRootPinsAsBoundary && con.inJam.pin.pinType === "input") {
          list.addParameter(result, this, con.inJam, bitNumber);
        }
      } else if (circuit.kind === "logicalCircuit") {
        const child = this.children.get(con.inJam.circuitSymbolId);
        if (child && con.inJam.innerJam) {
          child.#connectSignal(connectionSet, list, result, con.inJam.innerJam, bitNumber, visited);
        }
      } else if (circuit.kind === "splitter") {
        try {
          const { exitJam, exitBit } = passSplitterBit(sym.jams, con.inJam, bitNumber);
          this.#connectSignal(connectionSet, list, result, exitJam, exitBit, visited);
        } catch {
          // ungültiges Bit ignorieren
        }
      }
    }
  }

  // Sammelt alle primitiven Bauteile analog zu CircuitMap.Collect
  collect(symbolMapList: SymbolMapList): void {
    for (const sym of this.circuit.circuitSymbols) {
      if (isPrimitive(sym.circuit) || (this.isRoot && this.#treatRootPinsAsBoundary && sym.circuit.kind === "pin")) {
        symbolMapList.addSymbol(this, sym);
        for (const jam of sym.jams) {
          if (jam.pin.pinType === "output") {
            for (let i = 0; i < jam.pin.bitWidth; i++) {
              symbolMapList.addResult(this, jam, i);
            }
          }
        }
      } else if (sym.circuit.kind === "logicalCircuit") {
        const child = this.children.get(sym.circuitSymbolId);
        if (child) {
          child.collect(symbolMapList);
        }
      }
    }
  }

  // Verknüpft alle Resultate mit Konsumenten analog zu CircuitMap.Connect(ConnectionSet, SymbolMapList)
  connectResults(connectionSet: ConnectionSet, symbolMapList: SymbolMapList): void {
    const visited = new Set<string>();
    for (const symbolMap of symbolMapList.symbolMaps) {
      for (const result of symbolMap.results) {
        visited.clear();
        result.circuitMap.#connectSignal(
          connectionSet,
          symbolMapList,
          result,
          result.jam,
          result.bitNumber,
          visited,
        );
      }
    }
  }

  // Bereinigt nicht benötigte Resultate ohne Abnehmer analog zu CircuitMap.CleanUp
  cleanUp(symbolMapList: SymbolMapList): void {
    let removedAny: boolean;
    do {
      removedAny = false;
      const unconnected: SymbolMap[] = [];
      for (const map of symbolMapList.symbolMaps) {
        if (map.hasResults && map.circuitSymbol.circuit.kind !== "graphicsArray") {
          const isConnected = map.results.some((r) => r.parameters.length > 0);
          if (!isConnected) {
            for (const param of map.parameters) {
              const idx = param.result.parameters.indexOf(param);
              if (idx >= 0) {
                param.result.parameters.splice(idx, 1);
              }
            }
            unconnected.push(map);
          }
        }
      }
      for (const map of unconnected) {
        symbolMapList.remove(map);
        removedAny = true;
      }
    } while (removedAny);
  }

  // Analysiert Topologie, CleanUp und Zustandsindizes ohne Funktionsinstanziierung (z. B. für Live-Editiermodus)
  #compileTopology(): { symbolMapList: SymbolMapList; circuitState: CircuitState } {
    const connectionSet = new ConnectionSet();
    this.connectAll(connectionSet);

    const symbolMapList = new SymbolMapList();
    this.root.#symbolMapList = symbolMapList;
    this.#symbolMapList = symbolMapList;
    this.collect(symbolMapList);
    this.connectResults(connectionSet, symbolMapList);
    this.cleanUp(symbolMapList);

    const circuitState = new CircuitState();

    // Allokiere flache Zustandsindizes für alle Result-Objekte pro CircuitMap-Instanz
    this.#clearJamStateMaps();
    for (const map of symbolMapList.symbolMaps) {
      for (const res of map.results) {
        res.allocate(circuitState);
        res.circuitMap.#recordJamStateIndex(res.jam, res.bitNumber, res.stateIndex);

        for (const p of res.parameters) {
          p.circuitMap.#recordJamStateIndex(p.jam, p.bitNumber, res.stateIndex);
        }
      }
    }

    return { symbolMapList, circuitState };
  }

  // Führt ausschließlich die Topologie- und CleanUp-Analyse für den Editiermodus durch
  prepareCleanUpAnalysis(): void {
    this.#compileTopology();
  }

  // Kompiliert das Schaltungsmodell und erzeugt betriebsbereite CircuitState- und Funktions-Instanzen
  apply(_probeCapacity = 100): CircuitState {
    const { symbolMapList, circuitState } = this.#compileTopology();

    // Verbot mehrfach instanziierter persistenter RAMs (onStart === "data") analog zu CircuitMap.Validate
    const persistedMemoryIds = new Set<string>();
    for (const map of symbolMapList.symbolMaps) {
      const sym = map.circuitSymbol;
      if (sym.circuit.kind === "memory") {
        const memory = sym.circuit as Memory;
        if (memory.writable && memory.onStart === "data") {
          if (persistedMemoryIds.has(memory.memoryId)) {
            throw new CircuitException(
              i18n.t("errors.compiler.manyMemoryData", {
                circuitName: map.circuitMap.circuit.name,
                memoryName: `${memory.notation || memory.name}[${sym.x},${sym.y}]`,
              }),
              "userError",
              map.circuitMap.getSymbolLocation(sym),
            );
          }
          persistedMemoryIds.add(memory.memoryId);
        }
      }
    }

    // Erzeuge konkrete primitive CircuitFunction-Instanzen
    for (const map of symbolMapList.symbolMaps) {
      const sym = map.circuitSymbol;
      const circuit = sym.circuit;
      const registerFn = <T extends CircuitFunction>(fn: T): T => {
        circuitState.setFunctionLocation(fn, map.circuitMap.getSymbolLocation(sym));
        return fn;
      };

      if (circuit.kind === "gate") {
        const gate = circuit as Gate;
        const outResults = map.results;
        const outIndices = outResults.map((r) => (r.isTriState ? r.privateIndex : r.stateIndex));

        const inJams = sym.jams.filter((j) => j.pin.pinType === "input");
        const inParams = inJams.flatMap((j) => map.allParameters(j));
        const inIndices = inParams.map((p) => p.result.stateIndex);

        switch (gate.gateType) {
          case "and":
            if (gate.invertedOutput) {
              registerFn(FunctionAndNot.create(circuitState, inIndices, outIndices[0]));
            } else {
              registerFn(FunctionAnd.create(circuitState, inIndices, outIndices[0]));
            }
            break;
          case "or":
            if (gate.invertedOutput) {
              registerFn(FunctionOrNot.create(circuitState, inIndices, outIndices[0]));
            } else {
              registerFn(FunctionOr.create(circuitState, inIndices, outIndices[0]));
            }
            break;
          case "xor":
            if (gate.invertedOutput) {
              registerFn(FunctionXorNot.create(circuitState, inIndices, outIndices[0]));
            } else {
              registerFn(FunctionXor.create(circuitState, inIndices, outIndices[0]));
            }
            break;
          case "not":
            registerFn(new FunctionNot(circuitState, inIndices[0], outIndices[0]));
            break;
          case "triState1":
          case "triState2":
            registerFn(new FunctionTriState(circuitState, inIndices[0], inIndices[1], outIndices[0]));
            break;
          case "clock":
            if (outIndices.length > 0) {
              registerFn(new FunctionClock(circuitState, outIndices[0]));
            }
            break;
          case "led": {
            if (gate.inputCount === 8) {
              const sortedJams = sym.jams
                .filter((j) => j.pin.pinType === "input")
                .sort((a, b) => {
                  const oA = (a.pin as Partial<DevicePin>).order ?? 0;
                  const oB = (b.pin as Partial<DevicePin>).order ?? 0;
                  return oA - oB;
                });
              const segIndices: number[] = [];
              for (const j of sortedJams) {
                const params = map.allParameters(j);
                if (params.length > 0) {
                  segIndices.push(params[0].result.stateIndex);
                } else {
                  segIndices.push(0);
                }
              }
              registerFn(new FunctionLed(circuitState, segIndices, "sevenSegment"));
            } else {
              registerFn(new FunctionLed(circuitState, inIndices, "single"));
            }
            break;
          }
        }
      } else if (circuit.kind === "circuitButton") {
        const btn = circuit as CircuitButton;
        const outRes = map.results;
        const outIndices = outRes.map((r) => r.stateIndex);
        registerFn(
          new FunctionButton(circuitState, outIndices[0], {
            buttonId: getButtonInstanceId(map.circuitMap, sym),
            rawButtonId: btn.circuitButtonId ?? btn.circuitId,
            isToggle: btn.isToggle ?? false,
            inverted: btn.inverted ?? false,
          }),
        );
      } else if (circuit.kind === "constant") {
        const c = circuit as Constant;
        const outRes = map.results;
        const outIndices = outRes.map((r) => r.stateIndex);
        registerFn(new FunctionConstant(circuitState, outIndices, c.value));
      } else if (circuit.kind === "circuitProbe") {
        const probeCircuit = circuit as CircuitProbe;
        const inJams = sym.jams.filter((j) => j.pin.pinType === "input");
        const inParams = inJams.flatMap((j) => map.allParameters(j));
        const inIndices = inParams.map((p) => p.result.stateIndex);
        const probeFormat = probeCircuit.displayFormat ?? (probeCircuit.isHex ? "hex" : "bin");
        registerFn(new FunctionProbe(circuitState, inIndices, circuit.name, circuit.circuitId, probeFormat));
      } else if (circuit.kind === "clock") {
        const outRes = map.results;
        const outIndices = outRes.map((r) => r.stateIndex);
        registerFn(new FunctionClock(circuitState, outIndices[0]));
      } else if (circuit.kind === "led") {
        const inJams = sym.jams.filter((j) => j.pin.pinType === "input");
        const inParams = inJams.flatMap((j) => map.allParameters(j));
        const inIndices = inParams.map((p) => p.result.stateIndex);
        registerFn(new FunctionLed(circuitState, inIndices));
      } else if (circuit.kind === "ledMatrix") {
        const matrixCircuit = circuit as LedMatrix;
        const rows = Math.max(1, matrixCircuit.rows);
        const columns = Math.max(1, matrixCircuit.columns);
        const colors = Math.max(1, Math.min(3, matrixCircuit.colors));
        const persistenceMultiplier = matrixCircuit.persistenceMultiplier ?? 1;
        const matrixId = matrixCircuit.ledMatrixId ?? matrixCircuit.circuitId;
        const rowJams = sym.jams
          .filter((j) => j.pin.pinType === "input" && j.pin.pinSide === "left")
          .sort((a, b) => a.pin.gridPoint.y - b.pin.gridPoint.y);

        if (matrixCircuit.matrixType === "selector") {
          const colJams = sym.jams
            .filter((j) => j.pin.pinType === "input" && j.pin.pinSide === "top")
            .sort((a, b) => a.pin.gridPoint.x - b.pin.gridPoint.x);
          const colIndices: number[] = [];
          for (const colJam of colJams) {
            for (let bit = 0; bit < colors; bit++) {
              const param = map.getParameter(colJam, bit);
              colIndices.push(param ? param.result.stateIndex : -1);
            }
          }
          const rowIndices: number[] = [];
          for (const rowJam of rowJams) {
            const param = map.getParameter(rowJam, 0);
            rowIndices.push(param ? param.result.stateIndex : -1);
          }
          registerFn(
            new FunctionLedMatrixSelector(circuitState, [...colIndices, ...rowIndices], {
              matrixId,
              rows,
              columns,
              colors,
              persistenceMultiplier,
            }),
          );
        } else {
          const indIndices: number[] = [];
          const bitsPerRow = columns * colors;
          for (const rowJam of rowJams) {
            for (let bit = 0; bit < bitsPerRow; bit++) {
              const param = map.getParameter(rowJam, bit);
              indIndices.push(param ? param.result.stateIndex : -1);
            }
          }
          registerFn(
            new FunctionLedMatrixIndividual(circuitState, indIndices, {
              matrixId,
              rows,
              columns,
              colors,
              persistenceMultiplier,
            }),
          );
        }
      } else if (circuit.kind === "sensor") {
        const sensor = circuit as Sensor;
        const outIndices = map.results.map((r) => (r.isTriState ? r.privateIndex : r.stateIndex));
        registerFn(
          new FunctionSensor(circuitState, outIndices, {
            sensorId: sensor.sensorId ?? sensor.circuitId,
            sensorType: sensor.sensorType,
            bitWidth: sensor.bitWidth,
            data: sensor.data,
          }),
        );
      } else if (circuit.kind === "memory") {
        const memory = circuit as Memory;
        const addressJam = sym.jams.find(
          (j) => j.pin.pinId === `${memory.memoryId}-addr` || j.pin.name === "Address",
        );
        const dataOutJam = sym.jams.find(
          (j) => j.pin.pinId === `${memory.memoryId}-data-out` || j.pin.name === "Data",
        );
        const address2Jam = memory.dualPort
          ? sym.jams.find(
            (j) => j.pin.pinId === `${memory.memoryId}-addr2` || j.pin.name === "Address2",
          )
          : undefined;
        const dataOut2Jam = memory.dualPort
          ? sym.jams.find(
            (j) => j.pin.pinId === `${memory.memoryId}-data-out2` || j.pin.name === "Data2",
          )
          : undefined;
        const dataInJam = memory.writable
          ? sym.jams.find(
            (j) => j.pin.pinId === `${memory.memoryId}-data-in` || j.pin.name === "DataIn",
          )
          : undefined;
        const writeJam = memory.writable
          ? sym.jams.find(
            (j) => j.pin.pinId === `${memory.memoryId}-write` || j.pin.name.startsWith("Write"),
          )
          : undefined;

        const addressParams = addressJam ? map.allParameters(addressJam) : [];
        const address2Params = address2Jam ? map.allParameters(address2Jam) : [];
        if (
          addressParams.length !== memory.addressBitWidth ||
          (memory.dualPort && address2Params.length !== memory.addressBitWidth)
        ) {
          throw new CircuitException(
            i18n.t("errors.compiler.addressNotConnected", {
              path: map.circuitMap.path(sym),
            }),
            "userError",
            map.circuitMap.getSymbolLocation(sym),
          );
        }

        const dataOutResults = dataOutJam ? map.allResults(dataOutJam) : [];
        const dataOut2Results = memory.dualPort && dataOut2Jam ? map.allResults(dataOut2Jam) : null;
        const addressIndices = addressParams.map((p) => p.result.stateIndex);
        const address2Indices = memory.dualPort ? address2Params.map((p) => p.result.stateIndex) : null;
        const dataOutIndices = dataOutResults.map((r) => (r.isTriState ? r.privateIndex : r.stateIndex));
        const dataOut2Indices = dataOut2Results
          ? dataOut2Results.map((r) => (r.isTriState ? r.privateIndex : r.stateIndex))
          : null;
        const instanceId = getMemoryInstanceId(map.circuitMap, sym);

        if (memory.writable) {
          const dataInParams = dataInJam ? map.allParameters(dataInJam) : [];
          if (dataInParams.length !== memory.dataBitWidth) {
            throw new CircuitException(
              i18n.t("errors.compiler.dataInNotConnected", {
                path: map.circuitMap.path(sym),
              }),
              "userError",
              map.circuitMap.getSymbolLocation(sym),
            );
          }
          const dataInIndices = dataInParams.map((p) => p.result.stateIndex);
          const writeParam = writeJam ? map.getParameter(writeJam, 0) : undefined;
          const writeIndex = writeParam ? writeParam.result.stateIndex : 0;
          registerFn(
            new FunctionRam(
              circuitState,
              addressIndices,
              dataInIndices,
              dataOutIndices,
              address2Indices,
              dataOut2Indices,
              writeIndex,
              memory,
              instanceId,
            ),
          );
        } else {
          registerFn(
            new FunctionRom(
              circuitState,
              addressIndices,
              dataOutIndices,
              address2Indices,
              dataOut2Indices,
              memory,
              instanceId,
            ),
          );
        }
      } else if (circuit.kind === "sound") {
        const sound = circuit as Sound;
        const inJam = sym.jams.find((j) => j.pin.pinType === "input") ?? sym.jams[0];
        const inParams = inJam ? map.allParameters(inJam) : [];
        const inIndices = inParams.length > 0 ? [inParams[0].result.stateIndex] : [];
        registerFn(
          new FunctionSound(circuitState, inIndices, {
            channelId: getAudioInstanceId(map.circuitMap, sym),
            frequency: sound.frequency ?? SOUND_WEB_DEFAULTS.frequency,
            waveform: sound.waveform ?? SOUND_WEB_DEFAULTS.waveform,
          }),
        );
      } else if (circuit.kind === "synthesizer") {
        const synth = circuit as Synthesizer;
        const freqJam = sym.jams.find(
          (j) => j.pin.pinId === `${synth.synthesizerId}-freq` || j.pin.jamNotation === "F",
        );
        const volJam = sym.jams.find(
          (j) => j.pin.pinId === `${synth.synthesizerId}-vol` || j.pin.jamNotation === "V",
        );
        const enableJam = sym.jams.find(
          (j) => j.pin.pinId === `${synth.synthesizerId}-en` || j.pin.jamNotation === "E",
        );

        const freqParams = freqJam ? map.allParameters(freqJam) : [];
        if (freqParams.length !== 8) {
          throw new CircuitException(
            i18n.t("errors.compiler.synthesizerFrequencyNotConnected", {
              path: map.circuitMap.path(sym),
            }),
            "userError",
            map.circuitMap.getSymbolLocation(sym),
          );
        }

        const volParams = volJam ? map.allParameters(volJam) : [];
        if (volParams.length !== 8) {
          throw new CircuitException(
            i18n.t("errors.compiler.synthesizerVolumeNotConnected", {
              path: map.circuitMap.path(sym),
            }),
            "userError",
            map.circuitMap.getSymbolLocation(sym),
          );
        }

        const enableParams = enableJam ? map.allParameters(enableJam) : [];
        if (enableParams.length !== 1) {
          throw new CircuitException(
            i18n.t("errors.compiler.synthesizerEnableNotConnected", {
              path: map.circuitMap.path(sym),
            }),
            "userError",
            map.circuitMap.getSymbolLocation(sym),
          );
        }

        const paramIndices = [
          ...freqParams.map((p) => p.result.stateIndex),
          ...volParams.map((p) => p.result.stateIndex),
          enableParams[0].result.stateIndex,
        ];
        registerFn(
          new FunctionSynthesizer(circuitState, paramIndices, {
            channelId: getAudioInstanceId(map.circuitMap, sym),
            mode: synth.mode,
          }),
        );
      } else if (circuit.kind === "graphicsArray") {
        const ga = circuit as GraphicsArray;
        const expectedAddressBits = getGraphicsArrayAddressBitWidth(
          ga.dataBitWidth,
          ga.bitsPerPixel,
          ga.width,
          ga.height,
        );
        const addressJam = sym.jams.find(
          (j) => j.pin.pinId === `${ga.graphicsArrayId}-addr` || j.pin.name === "Address",
        );
        const dataInJam = sym.jams.find(
          (j) => j.pin.pinId === `${ga.graphicsArrayId}-data-in` || j.pin.name === "DataIn",
        );
        const dataOutJam = sym.jams.find(
          (j) => j.pin.pinId === `${ga.graphicsArrayId}-data-out` || j.pin.name === "Data",
        );
        const writeJam = sym.jams.find(
          (j) => j.pin.pinId === `${ga.graphicsArrayId}-write` || j.pin.name.startsWith("Write"),
        );

        const addressParams = addressJam ? map.allParameters(addressJam) : [];
        if (addressParams.length !== expectedAddressBits) {
          throw new CircuitException(
            i18n.t("errors.compiler.addressNotConnected", {
              path: map.circuitMap.path(sym),
            }),
            "userError",
            map.circuitMap.getSymbolLocation(sym),
          );
        }

        const dataInParams = dataInJam ? map.allParameters(dataInJam) : [];
        if (dataInParams.length !== ga.dataBitWidth) {
          throw new CircuitException(
            i18n.t("errors.compiler.dataInNotConnected", {
              path: map.circuitMap.path(sym),
            }),
            "userError",
            map.circuitMap.getSymbolLocation(sym),
          );
        }

        const writeParam = writeJam ? map.getParameter(writeJam, 0) : undefined;
        if (!writeParam) {
          throw new CircuitException(
            i18n.t("errors.compiler.writeNotConnected", {
              path: map.circuitMap.path(sym),
            }),
            "userError",
            map.circuitMap.getSymbolLocation(sym),
          );
        }

        const dataOutResults = dataOutJam ? map.allResults(dataOutJam) : [];
        const addressIndices = addressParams.map((p) => p.result.stateIndex);
        const dataInIndices = dataInParams.map((p) => p.result.stateIndex);
        const dataOutIndices = dataOutResults.map((r) => (r.isTriState ? r.privateIndex : r.stateIndex));

        registerFn(
          new FunctionGraphicsArray(
            circuitState,
            addressIndices,
            dataInIndices,
            dataOutIndices,
            writeParam.result.stateIndex,
            ga,
            getGraphicsArrayInstanceId(map.circuitMap, sym),
          ),
        );
      }
    }

    // Fasse Tri-State-Gruppen zu FunctionTriStateGroup zusammen
    const processedGroups = new Set<Set<Result>>();
    for (const map of symbolMapList.symbolMaps) {
      for (const res of map.results) {
        if (res.triStateGroup && !processedGroups.has(res.triStateGroup)) {
          processedGroups.add(res.triStateGroup);
          const members = Array.from(res.triStateGroup);
          const sharedIndex = members[0].stateIndex;
          const privateIndices = members.map((m) => m.privateIndex);
          new FunctionTriStateGroup(circuitState, privateIndices, sharedIndex);
        }
      }
    }

    circuitState.endDefinition();
    return circuitState;
  }

  #clearJamStateMaps(): void {
    this.#jamStateMap.clear();
    for (const child of this.children.values()) {
      child.#clearJamStateMaps();
    }
  }

  #recordJamStateIndex(jam: Jam, bitNumber: number, stateIndex: number): void {
    const key = getJamKey(jam);
    let list = this.#jamStateMap.get(key);
    if (!list) {
      list = [];
      this.#jamStateMap.set(key, list);
    }
    list[bitNumber] = stateIndex;
  }

  // Sammelt alle Bauteil-Jams an einem konkreten Rasterpunkt
  #getJamsAt(point: GridPoint): Jam[] {
    const ptKey = gridPointKey(point);
    const result: Jam[] = [];
    for (const s of this.circuit.circuitSymbols) {
      for (const j of s.jams) {
        if (gridPointKey(j.absolutePoint) === ptKey) {
          result.push(j);
        }
      }
    }
    return result;
  }

  // Rekursive Ermittlung der Zustandsindizes über Hierarchien und Splitter analog zu CircuitMap.StateIndexes in C#
  #findStateIndexesAtPoint(
    list: (number | null)[],
    point: GridPoint,
    ignore: boolean,
    start: number,
    count: number,
    visited: Set<string>,
  ): boolean {
    const conductorMap = buildConductorMap(this.circuit.wires);
    const conductor = conductorMap.byPointKey.get(gridPointKey(point));
    const jams: Jam[] = [];
    if (conductor) {
      for (const pt of conductor.points) {
        jams.push(...this.#getJamsAt(pt));
      }
    } else {
      jams.push(...this.#getJamsAt(point));
    }

    const rootResults = this.symbolMapList;
    if (rootResults) {
      for (const jam of jams) {
        const sym = this.findSymbol(jam.circuitSymbolId);
        const isBoundaryPin = this.isRoot && this.#treatRootPinsAsBoundary && sym?.circuit.kind === "pin";
        if (sym && (isPrimitive(sym.circuit) || isBoundaryPin)) {
          const symbolMap = rootResults.getSymbolMap(this, sym);
          if (symbolMap) {
            if (jam.pin.pinType === "output") {
              const results = symbolMap.allResults(jam).slice(start, start + count);
              if (results.length > 0) {
                for (const r of results) {
                  list.push(r.stateIndex);
                }
                return true;
              }
            } else {
              const params = symbolMap.allParameters(jam).slice(start, start + count);
              if (params.length > 0) {
                for (const p of params) {
                  list.push(p.result.stateIndex);
                }
                return true;
              }
            }
          }
        }
      }
    }

    for (const jam of jams) {
      const sym = this.findSymbol(jam.circuitSymbolId);
      if (!sym || isPrimitive(sym.circuit)) {
        continue;
      }
      if (ignore && jam.absolutePoint.x === point.x && jam.absolutePoint.y === point.y) {
        continue;
      }

      if (sym.circuit.kind === "logicalCircuit") {
        const visitKey = `${this.path(sym)}:${jam.pin.pinId}:${start}`;
        if (!visited.has(visitKey)) {
          visited.add(visitKey);
          const child = this.children.get(sym.circuitSymbolId);
          if (child) {
            const childPinSymbol = child.circuit.circuitSymbols.find(
              (s) => s.circuit.circuitId === jam.pin.pinId || s.circuit.name === jam.pin.name,
            );
            if (childPinSymbol && childPinSymbol.jams.length > 0) {
              if (
                child.#findStateIndexesAtPoint(
                  list,
                  childPinSymbol.jams[0].absolutePoint,
                  true,
                  start,
                  count,
                  visited,
                )
              ) {
                return true;
              }
            }
          }
        }
      } else if (sym.circuit.kind === "pin") {
        if (this.parent && this.symbol) {
          const outerJam = this.symbol.jams.find(
            (j) => j.pin.pinId === sym.circuit.circuitId || j.pin.name === sym.circuit.name,
          );
          if (outerJam) {
            if (
              this.parent.#findStateIndexesAtPoint(
                list,
                outerJam.absolutePoint,
                true,
                start,
                count,
                visited,
              )
            ) {
              return true;
            }
          }
        }
      } else if (sym.circuit.kind === "splitter") {
        const splitterJams = [...sym.jams].sort((a, b) => comparePins(a.pin, b.pin));
        const wideJam = splitterJams[0];

        if (jam === wideJam) {
          const savedLen = list.length;
          let anyDone = false;
          let jamStart = 0;
          for (let i = 1; i < splitterJams.length && jamStart < start + count; i++) {
            const bitWidth = splitterJams[i].pin.bitWidth;
            if (start < jamStart + bitWidth) {
              const localStart = Math.max(0, start - jamStart);
              const localCount = Math.min(start + count, jamStart + bitWidth) - (jamStart + localStart);
              const beforePinLen = list.length;
              const subDone = this.#findStateIndexesAtPoint(
                list,
                splitterJams[i].absolutePoint,
                true,
                localStart,
                localCount,
                visited,
              );
              if (subDone) {
                anyDone = true;
                while (list.length < beforePinLen + localCount) {
                  list.push(null);
                }
              } else {
                for (let b = 0; b < localCount; b++) {
                  list.push(null);
                }
              }
            }
            jamStart += bitWidth;
          }
          if (anyDone) {
            return true;
          }
          list.length = savedLen;
        } else {
          let jamStart = 0;
          for (let i = 1; i < splitterJams.length; i++) {
            const bitWidth = splitterJams[i].pin.bitWidth;
            if (splitterJams[i] === jam) {
              if (
                this.#findStateIndexesAtPoint(
                  list,
                  wideJam.absolutePoint,
                  true,
                  jamStart + start,
                  Math.min(bitWidth - start, count),
                  visited,
                )
              ) {
                return true;
              }
              break;
            }
            jamStart += bitWidth;
          }
        }
      }
    }

    return false;
  }

  // Liefert die Zustandsindizes der Signale an einem Anschlusspunkt (Jam)
  jamStateIndexes(jam: Jam): (number | null)[] {
    const direct = this.#jamStateMap.get(getJamKey(jam));
    if (direct && direct.length > 0 && direct.some((x) => x !== null && x !== undefined)) {
      return direct;
    }

    const list: (number | null)[] = [];
    const visited = new Set<string>();
    const found = this.#findStateIndexesAtPoint(
      list,
      jam.absolutePoint,
      false,
      0,
      jam.pin.bitWidth,
      visited,
    );
    if (found && list.length > 0) {
      return list;
    }

    return new Array(jam.pin.bitWidth).fill(null);
  }

  // Liefert die Zustandsindizes der Signale auf einer Leitung für die grafische Einfärbung
  stateIndexes(wire: Wire): (number | null)[] {
    const jams = this.#wireToJamMap.get(wire.wireId) ?? [];

    for (const j of jams) {
      const idxs = this.#jamStateMap.get(getJamKey(j));
      if (idxs && idxs.length > 0 && idxs.some((x) => x !== null && x !== undefined)) {
        return idxs;
      }
    }

    const nonPrimitiveJam = jams.find((j) => {
      const s = this.findSymbol(j.circuitSymbolId);
      return s && !isPrimitive(s.circuit);
    });

    if (nonPrimitiveJam) {
      const list: (number | null)[] = [];
      const visited = new Set<string>();
      const found = this.#findStateIndexesAtPoint(
        list,
        nonPrimitiveJam.absolutePoint,
        false,
        0,
        nonPrimitiveJam.pin.bitWidth,
        visited,
      );
      if (found && list.length > 0) {
        return list;
      }
    }

    const bitWidth = jams.length > 0 ? jams[0].pin.bitWidth : 1;
    return new Array(bitWidth).fill(null);
  }

  // Prüft rekursiv, ob innerhalb dieser Subschaltungsinstanz mindestens ein aktives primitives Bauteil existiert
  #hasAnyActivePrimitive(symbolMapList: SymbolMapList): boolean {
    for (const sym of this.circuit.circuitSymbols) {
      if (isPrimitive(sym.circuit)) {
        const map = symbolMapList.getSymbolMap(this, sym);
        const hasGraphicsActivity =
          sym.circuit.kind === "graphicsArray"
            ? Boolean(
              map && (
                map.parameters.length > 0 ||
                map.results.some((r) => r.parameters.length > 0)
              ),
            )
            : Boolean(map && (map.hasResults || map.parameters.length > 0));
        if (hasGraphicsActivity) {
          return true;
        }
      } else if (sym.circuit.kind === "logicalCircuit") {
        const child = this.children.get(sym.circuitSymbolId);
        if (child && child.#hasAnyActivePrimitive(symbolMapList)) {
          return true;
        }
      }
    }
    return false;
  }

  // Analysiert alle Symbole und Leitungen (inkl. Bit-genauer Bus-Auswertung) anhand der CleanUp-Topologie
  analyzeCleanUp(): CircuitCleanUpReport {
    const symbolMapList = this.symbolMapList;
    const unusedSymbolIds = new Set<string>();
    const wireInfoById = new Map<string, WireCleanUpInfo>();

    if (!symbolMapList) {
      for (const sym of this.circuit.circuitSymbols) {
        unusedSymbolIds.add(sym.circuitSymbolId);
      }
      for (const wire of this.circuit.wires) {
        wireInfoById.set(wire.wireId, {
          wireId: wire.wireId,
          bitWidth: 1,
          usedBits: 0,
          isUsed: false,
          isPartiallyUsed: false,
        });
      }
      return {
        circuitId: this.circuit.logicalCircuitId,
        unusedSymbolIds,
        wireInfoById,
        unusedCount: unusedSymbolIds.size + wireInfoById.size,
      };
    }

    // Aktive Zustandsindizes besitzen mindestens einen abnehmenden Parameter (inkl. Tri-State-Gruppe)
    const activeStateIndexes = new Set<number>();
    for (const map of symbolMapList.symbolMaps) {
      for (const res of map.results) {
        const hasConsumer = res.triStateGroup
          ? Array.from(res.triStateGroup).some((member) => member.parameters.length > 0)
          : res.parameters.length > 0;
        if (hasConsumer && res.stateIndex > 0) {
          activeStateIndexes.add(res.stateIndex);
        }
      }
    }

    for (const sym of this.circuit.circuitSymbols) {
      const isBoundaryPin = this.isRoot && this.#treatRootPinsAsBoundary && sym.circuit.kind === "pin";
      if (isPrimitive(sym.circuit) || isBoundaryPin) {
        const map = symbolMapList.getSymbolMap(this, sym);
        const isActive =
          sym.circuit.kind === "graphicsArray"
            ? Boolean(
              map && (
                map.parameters.length > 0 ||
                map.results.some((r) => r.parameters.length > 0)
              ),
            )
            : Boolean(map && (map.hasResults || map.parameters.length > 0));
        if (!isActive) {
          unusedSymbolIds.add(sym.circuitSymbolId);
        }
      } else if (sym.circuit.kind === "logicalCircuit") {
        const hasActiveJam = sym.jams.some((jam) =>
          this.jamStateIndexes(jam).some((idx) => idx !== null && activeStateIndexes.has(idx)),
        );
        const childMap = this.children.get(sym.circuitSymbolId);
        const isActive = hasActiveJam || Boolean(childMap && childMap.#hasAnyActivePrimitive(symbolMapList));
        if (!isActive) {
          unusedSymbolIds.add(sym.circuitSymbolId);
        }
      } else {
        const hasActiveJam = sym.jams.some((jam) =>
          this.jamStateIndexes(jam).some((idx) => idx !== null && activeStateIndexes.has(idx)),
        );
        if (!hasActiveJam) {
          unusedSymbolIds.add(sym.circuitSymbolId);
        }
      }
    }

    let unusedWireCount = 0;
    for (const wire of this.circuit.wires) {
      const indices = this.stateIndexes(wire);
      const jams = this.#wireToJamMap.get(wire.wireId) ?? [];
      const fallbackBitWidth = jams.length > 0 ? Math.max(...jams.map((j) => j.pin.bitWidth)) : 1;
      const bitWidth = Math.max(1, indices.length > 0 ? indices.length : fallbackBitWidth);
      let usedBits = 0;
      for (const idx of indices) {
        if (idx !== null && idx !== undefined && activeStateIndexes.has(idx)) {
          usedBits++;
        }
      }
      const isUsed = usedBits > 0;
      const isPartiallyUsed = isUsed && usedBits < bitWidth;
      if (!isUsed) {
        unusedWireCount++;
      }
      wireInfoById.set(wire.wireId, {
        wireId: wire.wireId,
        bitWidth,
        usedBits,
        isUsed,
        isPartiallyUsed,
      });
    }

    return {
      circuitId: this.circuit.logicalCircuitId,
      unusedSymbolIds,
      wireInfoById,
      unusedCount: unusedSymbolIds.size + unusedWireCount,
    };
  }
}

export default CircuitMap;
