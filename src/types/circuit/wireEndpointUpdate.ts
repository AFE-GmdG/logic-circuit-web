// Beschreibt die Vorher-/Nachher-Koordinaten eines Leitungssegments für Undo/Redo
type WireEndpointUpdate = {
  wireId: string;
  before: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  after: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
};

export default WireEndpointUpdate;
