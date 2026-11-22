// Positionsangabe des auslösenden Bauteils bei Simulationsfehlern oder Oszillation
type SimulationErrorLocation = {
  circuitId: string;
  circuitName?: string;
  symbolId?: string;
  symbolName?: string;
  x?: number;
  y?: number;
};

export default SimulationErrorLocation;
