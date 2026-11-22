// Ergebnis nach dem Entfernen einer oder mehrerer logischer Schaltungen
type DeleteCircuitsResult = {
  deletedCircuitIds: string[];
  currentCircuitId: string;
};

export default DeleteCircuitsResult;
