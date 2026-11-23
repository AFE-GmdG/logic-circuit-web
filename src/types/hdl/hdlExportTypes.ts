import type State from "../simulation/state";

export type HdlExportLanguage = "verilog" | "vhdl" | "n2t";

export type HdlExportScope = "current" | "currentWithSubcircuits" | "flaggedExportToHdl";

export type HdlExportOptions = {
  language: HdlExportLanguage;
  scope: HdlExportScope;
  exportTests: boolean;
  commentPoints?: boolean;
  fixNames?: boolean;
  commentHeader?: string;
};

// Inklusiver Bit-Bereich [first..last] einer Signalverbindung analog zu HdlConnection.BitRange
export type HdlBitRange = {
  first: number;
  last: number;
};

export type HdlLogLevel = "info" | "warning" | "error";

export type HdlLogCode =
  | "circuitUnsupported"
  | "loopInSplitter"
  | "jamsColocated"
  | "jamUnconnected"
  | "inputNotFull"
  | "invalidName"
  | "multipleDrivers"
  | "floatingPort"
  | "noCircuitsSelected"
  | "pinDirectConnect"
  | "memoryUnsupported"
  | "unconnectedGate"
  | "ramTestWarning"
  | "testNotTestable"
  | "testInputTooBig"
  | "testTruncated"
  | "testOscillation"
  | "exportSuccess";

export type HdlLogEntry = {
  level: HdlLogLevel;
  code: HdlLogCode;
  circuitName: string;
  message: string;
  params?: Record<string, string | number>;
};

export type HdlGeneratedFileKind = "module" | "testbench" | "compare";

export type HdlGeneratedFile = {
  fileName: string;
  circuitId: string;
  circuitName: string;
  language: HdlExportLanguage;
  kind: HdlGeneratedFileKind;
  content: string;
};

export type HdlTruthTablePinInfo = {
  symbolId: string;
  pinId: string;
  name: string;
  bitWidth: number;
};

export type HdlTruthTableRow = {
  inputs: number[];
  outputs: number[] | null;
  rawStates: State[][];
};

export type HdlTruthTableStatus =
  | "ok"
  | "notTestable"
  | "inputTooBig"
  | "truncated"
  | "oscillation"
  | "error";

export type HdlTruthTableVectors = {
  status: HdlTruthTableStatus;
  inputs: HdlTruthTablePinInfo[];
  outputs: HdlTruthTablePinInfo[];
  rows: HdlTruthTableRow[];
  totalInputBits: number;
  errorMessage?: string;
};

export type HdlExportResult = {
  files: HdlGeneratedFile[];
  logs: HdlLogEntry[];
  hasErrors: boolean;
  targetCircuits: string[];
};

export default HdlExportResult;
