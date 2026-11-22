import type Circuit from "./circuit";
import type LedMatrixCellShape from "./ledMatrixCellShape";
import type LedMatrixType from "./ledMatrixType";

// LED-Matrix-Anzeigebaustein analog zu LedMatrix.cs
type LedMatrix = Circuit & {
  kind: "ledMatrix";
  ledMatrixId: string;
  matrixType: LedMatrixType;
  cellShape: LedMatrixCellShape;
  rows: number;
  columns: number;
  colors: number;
  persistenceMultiplier?: 1 | 2 | 3;
};

export default LedMatrix;
