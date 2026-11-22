// Analyse-Ergebnis der aktiven Bit-Nutzung für eine einzelne Leitung
type WireCleanUpInfo = {
  wireId: string;
  bitWidth: number;
  usedBits: number;
  isUsed: boolean;
  isPartiallyUsed: boolean;
};

export default WireCleanUpInfo;
