import React from "react";

import styled from "@emotion/styled";

import AppHeader from "./appHeader";
import CircuitCanvas from "./circuitCanvas";
import ComponentPalette from "./componentPalette";

type AppProps = React.ComponentPropsWithoutRef<"div">;

const App = styled(({ ...other }: AppProps) => {
  const [isRunning, setIsRunning] = React.useState(false);
  const [zoom] = React.useState(1.0);

  const handleToggleRun = React.useCallback(
    () => {
      setIsRunning((prev) => !prev);
    },
    [],
  );

  const handleStep = React.useCallback(
    () => {
      // Manueller Simulationsschritt (wird in US-005 implementiert)
    },
    [],
  );

  const handleReset = React.useCallback(
    () => {
      setIsRunning(false);
    },
    [],
  );

  return (
    <div {...other} data-component="App">
      <AppHeader
        isRunning={isRunning}
        onToggleRun={handleToggleRun}
        onStep={handleStep}
        onReset={handleReset}
      />
      <div className="workspace-container">
        <ComponentPalette />
        <CircuitCanvas zoom={zoom} />
      </div>
    </div>
  );
})({
  display: "flex",
  flexDirection: "column",
  width: "100vw",
  height: "100vh",
  overflow: "hidden",
  backgroundColor: "var(--color-bg-base)",
  color: "var(--color-text-primary)",

  "& > .workspace-container": {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
});

export default App;
