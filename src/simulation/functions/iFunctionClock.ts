// Schnittstellentyp für Taktfunktionen mit Flankenumschaltung analog zu IFunctionClock.cs
type IFunctionClock = {
  flip(): boolean;
};

export function isFunctionClock(fn: unknown): fn is IFunctionClock {
  return (
    typeof fn === "object"
    && fn !== null
    && "flip" in fn
    && typeof (fn as IFunctionClock).flip === "function"
  );
}

export default IFunctionClock;
