import type State from "./state";
import type ProbeFormat from "../circuit/probeFormat";

export type ProbeHistoryValueEntry = {
  kind: "value";
  packed: string;
  states: State[];
  numericValue: number | null;
  textHex: string;
  textDec: string;
  textBin: string;
};

export type ProbeHistoryMarkEntry = {
  kind: "mark";
};

export type ProbeHistoryEntry = ProbeHistoryValueEntry | ProbeHistoryMarkEntry;

export type ProbeHistorySnapshot = {
  probeId: string;
  rawProbeId: string;
  label: string;
  path: string;
  bitWidth: number;
  displayFormat: ProbeFormat;
  markAllowed: boolean;
  entries: ProbeHistoryEntry[];
};

export type OscilloscopeBusSample = {
  states: State[];
  numericValue: number | null;
  hasTriState: boolean;
  textHex: string;
  textDec: string;
  textBin: string;
};

export type OscilloscopeChannelSnapshot = {
  probeId: string;
  rawProbeId: string;
  label: string;
  path: string;
  bitWidth: number;
  displayFormat: ProbeFormat;
  sampleCount: number;
  bitTraces: State[][];
  busSamples: OscilloscopeBusSample[];
};

export type OscilloscopeSnapshot = {
  isOscilloscoping: boolean;
  historySize: number;
  totalSteps: number;
  sampleCount: number;
  channels: OscilloscopeChannelSnapshot[];
};

export default OscilloscopeSnapshot;
