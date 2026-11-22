import { STATE_ON1 } from "../../../types/simulation/state";

import type CircuitState from "../../state/circuitState";
import CircuitFunction from "../circuitFunction";
import type IFunctionClock from "../iFunctionClock";

export type LedMatrixConfig = {
  matrixId: string;
  rows: number;
  columns: number;
  colors: number;
  persistenceMultiplier: 1 | 2 | 3;
};

// Abstrakte Basisklasse für LED-Matrix-Anzeigen analog zu FunctionLedMatrix.cs
export abstract class FunctionLedMatrix extends CircuitFunction {
  readonly matrixId: string;
  readonly rows: number;
  readonly columns: number;
  readonly colors: number;
  readonly persistenceMultiplier: 1 | 2 | 3;
  protected readonly cellValues: number[][];

  constructor(
    circuitState: CircuitState,
    parameter: number[],
    config: LedMatrixConfig,
  ) {
    super(circuitState, parameter, null);
    this.matrixId = config.matrixId;
    this.rows = config.rows;
    this.columns = config.columns;
    this.colors = config.colors;
    this.persistenceMultiplier = config.persistenceMultiplier;
    this.cellValues = Array.from(
      { length: this.rows },
      () => new Array<number>(this.columns).fill(0),
    );
  }

  getCell(row: number, column: number): number {
    return this.cellValues[row]?.[column] ?? 0;
  }

  // Erstellt eine isolierte Kopie der Zellwerte für Snapshots
  getCellValues(): number[][] {
    return this.cellValues.map((row) => row.slice());
  }
}

// Zeilenweise direkt adressierte LED-Matrix analog zu FunctionLedMatrixIndividual.cs
export class FunctionLedMatrixIndividual extends FunctionLedMatrix {
  get reportName(): string {
    return "LedMatrix (Individual)";
  }

  evaluate(): boolean {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        let value = 0;
        const baseOffset = (r * this.columns + c) * this.colors;
        for (let bit = 0; bit < this.colors; bit++) {
          const stateIdx = this.parameter[baseOffset + bit];
          if (stateIdx !== undefined && stateIdx >= 0 && this.circuitState.get(stateIdx) === STATE_ON1) {
            value |= 1 << bit;
          }
        }
        this.cellValues[r][c] = value;
      }
    }
    return false;
  }
}

// Gemultiplexte Zeilen-/Spalten-LED-Matrix mit Nachleucht-Faktor analog zu FunctionLedMatrixSelector.cs
export class FunctionLedMatrixSelector extends FunctionLedMatrix implements IFunctionClock {
  #flipCount = 0;
  readonly #offAtFlip: number[][];

  // Zustandsbehaftete Anzeige: als Prototyp-Getter (vor super() verfügbar), damit sie erst nach dem Einschwingen ausgewertet wird
  get evaluateAfterSettle(): boolean {
    return true;
  }

  constructor(
    circuitState: CircuitState,
    parameter: number[],
    config: LedMatrixConfig,
  ) {
    super(circuitState, parameter, config);
    this.#offAtFlip = Array.from(
      { length: this.rows },
      () => new Array<number>(this.columns).fill(0),
    );
  }

  get reportName(): string {
    return "LedMatrix (Selector)";
  }

  // Zählt Multiplex-Flanken hoch und lässt abgelaufene nachleuchtende Zellen erlöschen
  flip(): boolean {
    this.#flipCount += 1;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        const deadline = this.#offAtFlip[r][c];
        if (this.cellValues[r][c] !== 0 && deadline > 0 && this.#flipCount >= deadline) {
          this.cellValues[r][c] = 0;
          this.#offAtFlip[r][c] = 0;
        }
      }
    }
    return false;
  }

  evaluate(): boolean {
    const colValues = new Array<number>(this.columns).fill(0);
    for (let c = 0; c < this.columns; c++) {
      let value = 0;
      const baseOffset = c * this.colors;
      for (let bit = 0; bit < this.colors; bit++) {
        const stateIdx = this.parameter[baseOffset + bit];
        if (stateIdx !== undefined && stateIdx >= 0 && this.circuitState.get(stateIdx) === STATE_ON1) {
          value |= 1 << bit;
        }
      }
      colValues[c] = value;
    }

    const rowParamOffset = this.columns * this.colors;
    const persistFlips = this.rows * this.persistenceMultiplier;

    for (let r = 0; r < this.rows; r++) {
      const rowIdx = this.parameter[rowParamOffset + r];
      const rowActive = rowIdx !== undefined && rowIdx >= 0 && this.circuitState.get(rowIdx) === STATE_ON1;

      for (let c = 0; c < this.columns; c++) {
        if (rowActive && colValues[c] > 0) {
          this.cellValues[r][c] = colValues[c];
          this.#offAtFlip[r][c] = 0;
        } else if (this.cellValues[r][c] !== 0) {
          if (this.#offAtFlip[r][c] === 0) {
            this.#offAtFlip[r][c] = this.#flipCount + persistFlips;
          }
          if (this.#flipCount >= this.#offAtFlip[r][c]) {
            this.cellValues[r][c] = 0;
            this.#offAtFlip[r][c] = 0;
          }
        }
      }
    }
    return false;
  }
}

export default FunctionLedMatrix;
