import React from "react";

type GateShapeProps = React.ComponentPropsWithoutRef<"g"> & {
  width: number;
  height: number;
  inputCount?: number;
  isInverted?: boolean;
};

export default GateShapeProps;
