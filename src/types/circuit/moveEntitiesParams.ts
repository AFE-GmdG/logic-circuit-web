// Eingabeparameter zum gebündelten Verschieben von Symbolen, Textnotizen und Leitungen
type MoveEntitiesParams = {
  symbolIds?: string[];
  textNoteIds?: string[];
  wireIds?: string[];
  dx: number;
  dy: number;
  withWires?: boolean;
  recordHistory?: boolean;
};

export default MoveEntitiesParams;
