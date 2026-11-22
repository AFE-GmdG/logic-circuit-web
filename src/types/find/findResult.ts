import type FindItemKind from "./findItemKind";
import type FindMatchSource from "./findMatchSource";
import type GridPoint from "../canvas/gridPoint";

// Einzelner Treffer der Projekt- oder Schaltungssuche
type FindResult = {
  id: string;
  entityType: "circuit" | "symbol" | "textNote";
  itemKind: FindItemKind;
  circuitId: string;
  circuitName: string;
  symbolId?: string;
  textNoteId?: string;
  label: string;
  secondaryLabel?: string;
  matchedNoteSnippet?: string;
  matchSource: FindMatchSource;
  gridPoint?: GridPoint;
  focusPoint?: GridPoint;
  score: number;
};

export default FindResult;
