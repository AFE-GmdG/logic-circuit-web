import React from "react";

import styled from "@emotion/styled";

import CanvasContextProvider from "../../contexts/canvasContext/provider";
import CircuitContextProvider from "../../contexts/circuitContext/provider";
import CollabContextProvider from "../../contexts/collabContext/provider";
import LibraryContextProvider from "../../contexts/libraryContext/provider";
import SimulationContextProvider from "../../contexts/simulationContext/provider";

import CollabWorkspaceOverlay from "../collab/collabWorkspaceOverlay";
import SessionEndedDialog from "../collab/sessionEndedDialog";

import AppHeader from "./appHeader";
import SimulationErrorDialog from "./simulationErrorDialog";
import CircuitCanvas from "../circuitCanvas";
import ComponentPalette from "../componentPalette";
import StatusBar from "../statusBar";

type AppProps = React.ComponentPropsWithoutRef<"div">;

function isNativeContextMenuTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") {
    return false;
  }
  const el = target as HTMLElement;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

const App = styled(({ ...other }: AppProps) => (
  <CircuitContextProvider>
    <SimulationContextProvider>
      <LibraryContextProvider>
        <CanvasContextProvider>
          <CollabContextProvider>
            <div
              {...other}
              data-component="App"
              onContextMenu={(event) => {
                if (!isNativeContextMenuTarget(event.target)) {
                  event.preventDefault();
                }
              }}
            >
              <AppHeader />
              <div className="workspace-container">
                <ComponentPalette />
                <CircuitCanvas />
                <CollabWorkspaceOverlay />
              </div>
              <StatusBar />
              <SimulationErrorDialog />
              <SessionEndedDialog />
            </div>
          </CollabContextProvider>
        </CanvasContextProvider>
      </LibraryContextProvider>
    </SimulationContextProvider>
  </CircuitContextProvider>
))({
  display: "flex",
  flexDirection: "column",
  width: "100vw",
  height: "100vh",
  overflow: "hidden",
  backgroundColor: "var(--color-bg-base)",
  color: "var(--color-text-primary)",

  "& > .workspace-container": {
    position: "relative",
    display: "flex",
    flex: "1 0 0",
    overflow: "hidden",
  },
});

export default App;
