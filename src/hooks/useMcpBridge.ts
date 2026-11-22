/// <reference types="vite/client" />
import React from "react";

import CanvasContext from "../contexts/canvasContext";
import CircuitContext from "../contexts/circuitContext";
import SimulationContext from "../contexts/simulationContext";

import type McpBridgeRequest from "../types/mcp/mcpBridgeRequest";
import type McpBridgeResponse from "../types/mcp/mcpBridgeResponse";
import type McpBridgeStatus from "../types/mcp/mcpBridgeStatus";
import type McpCircuitSnapshot from "../types/mcp/mcpCircuitSnapshot";
import type McpRemoteSharedState from "../types/mcp/mcpRemoteSharedState";

import {
  MCP_EVENT_ACK,
  MCP_EVENT_BYE,
  MCP_EVENT_HELLO,
  MCP_EVENT_REQUEST,
  MCP_EVENT_RESPONSE,
} from "../mcp/mcpEvents";
import McpRemoteClient, { mapRemoteStateToBridgeStatus } from "../mcp/mcpRemoteClient";
import { executeMcpTool } from "../mcp/mcpTools";

export type McpHotChannel = {
  send: (event: string, payload?: unknown) => void;
  on: (event: string, cb: (data: never) => void) => void;
  off: (event: string, cb: (data: never) => void) => void;
};

export type UseMcpBridgeOptions = {
  hotOverride?: McpHotChannel | null;
  remoteClientFactory?: () => McpRemoteClient;
  disabledOverride?: boolean;
};

export type McpBridgeController = {
  status: McpBridgeStatus;
  mode: "local" | "remote" | "disabled";
  sessionId: string | null;
  tabId: string | null;
  connectedTabCount: number;
  error: string | null;
  isSharedWorkerSupported: boolean;
  connect: (accessKey?: string) => void;
  disconnect: () => void;
  activateThisTab: () => void;
};

// Prüft, ob die MCP-Integration zur Build-Zeit (z. B. für GitHub Pages) deaktiviert wurde
export function isMcpDisabledByEnv(): boolean {
  if (typeof process !== "undefined" && process.env?.DISABLE_MCP === "true") {
    return true;
  }
  const metaEnv = (import.meta as { env?: Record<string, unknown> }).env;
  const rawFlag = metaEnv?.VITE_DISABLE_MCP;
  return rawFlag === "true" || rawFlag === "1" || rawFlag === true;
}

const INITIAL_REMOTE_STATE: McpRemoteSharedState = {
  connectionState: "off",
  activeTabId: null,
  connectedTabCount: 1,
  sessionId: null,
  error: null,
};

// Verbindet den Browser bevorzugt über den Vite-HMR-WebSocket (Dev-Vorrang) oder im Production-Build
// auf Opt-in über den Multi-Tab-SharedWorker mit dem Remote-MCP-Relay.
const useMcpBridge = (options?: UseMcpBridgeOptions): McpBridgeController => {
  const circuitContext = React.useContext(CircuitContext);
  const simulationContext = React.useContext(SimulationContext);
  const canvasContext = React.useContext(CanvasContext);

  const isDisabled = options?.disabledOverride !== undefined
    ? options.disabledOverride
    : isMcpDisabledByEnv();

  const hotChannel: McpHotChannel | undefined = isDisabled
    ? undefined
    : options?.hotOverride !== undefined
      ? (options.hotOverride ?? undefined)
      : (import.meta.hot as McpHotChannel | undefined);
  const isLocalMode = !isDisabled && Boolean(hotChannel);

  const [localStatus, setLocalStatus] = React.useState<"local-connecting" | "local-connected">(
    "local-connecting",
  );
  const [remoteState, setRemoteState] = React.useState<McpRemoteSharedState>(INITIAL_REMOTE_STATE);
  const [remoteMeta, setRemoteMeta] = React.useState<{
    tabId: string | null;
    isSharedWorkerSupported: boolean;
  }>({
    tabId: null,
    isSharedWorkerSupported: typeof SharedWorker !== "undefined",
  });

  const remoteClientRef = React.useRef<McpRemoteClient | null>(null);
  const remoteClientFactoryRef = React.useRef(options?.remoteClientFactory);
  remoteClientFactoryRef.current = options?.remoteClientFactory;

  // Werkzeugaufrufe greifen stets auf die aktuellsten Context-Referenzen und Aktionen zu
  const contextRef = React.useRef({
    circuitContext,
    simulationContext,
    canvasContext,
  });
  contextRef.current = {
    circuitContext,
    simulationContext,
    canvasContext,
  };

  const executeRequest = React.useCallback(
    async (request: McpBridgeRequest): Promise<McpBridgeResponse> => {
      try {
        const {
          circuitContext: currentCircuitCtx,
          simulationContext: currentSimCtx,
          canvasContext: currentCanvasCtx,
        } = contextRef.current;

        const waitForRender = (): Promise<void> =>
          new Promise((resolve) => {
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => resolve());
              });
            } else {
              setTimeout(resolve, 0);
            }
          });

        const snapshot: McpCircuitSnapshot = {
          project: currentCircuitCtx.project,
          currentCircuit: currentCircuitCtx.currentCircuit,
          selectedSymbolIds: currentCircuitCtx.selectedSymbolIds,
          selectedTextNoteIds: currentCircuitCtx.selectedTextNoteIds,
          selectedWireIds: currentCircuitCtx.selectedWireIds,
          isSimulating: currentSimCtx?.isSimulating ?? false,
          actions: {
            addEntities: currentCircuitCtx.addEntities,
            moveEntities: currentCircuitCtx.moveEntities,
            rotateSymbols: currentCircuitCtx.rotateSymbols,
            removeEntities: currentCircuitCtx.removeEntities,
            setCurrentCircuitId: currentCircuitCtx.setCurrentCircuitId,
            updateCircuitProperties: currentCircuitCtx.updateCircuitProperties,
            updateCircuitSymbolProperties: currentCircuitCtx.updateCircuitSymbolProperties,
            resizeCircuitSymbol: currentCircuitCtx.resizeCircuitSymbol,
            updateTextNote: currentCircuitCtx.updateTextNote,
            createCircuits: currentCircuitCtx.createCircuits,
            deleteCircuits: currentCircuitCtx.deleteCircuits,
            getCurrentCircuit: () => contextRef.current.circuitContext.currentCircuit,
            getProject: () => contextRef.current.circuitContext.project,
            highlightAiElements: currentCanvasCtx?.highlightAiElements,
          },
          simulation: currentSimCtx
            ? {
              getState: () => {
                const sim = contextRef.current.simulationContext;
                return {
                  isSimulating: sim.isSimulating,
                  isPaused: sim.isPaused,
                  isRunning: sim.isRunning,
                  isOscillating: sim.isOscillating,
                  simulationError: sim.simulationError,
                  actualFrequency: sim.actualFrequency,
                  frameRateLimit: sim.frameRateLimit,
                  snapshot: sim.snapshot,
                  rootCircuitMap: sim.rootCircuitMap ?? sim.circuitMap,
                  selectedCircuitMap: sim.selectedCircuitMap,
                };
              },
              startSimulation: currentSimCtx.startSimulation,
              pauseSimulation: currentSimCtx.pauseSimulation,
              stopSimulation: currentSimCtx.stopSimulation,
              reset: currentSimCtx.reset,
              flushPersistentMemories: currentSimCtx.flushPersistentMemories,
              readMemorySlice: currentSimCtx.readMemorySlice,
              writeMemoryCell: currentSimCtx.writeMemoryCell,
              step: currentSimCtx.step,
              ensurePausedSimulation: currentSimCtx.ensurePausedSimulation,
              setFrameRateLimit: currentSimCtx.setFrameRateLimit,
              selectCircuitMap: currentSimCtx.selectCircuitMap,
              setButtonState: currentSimCtx.setButtonState,
              toggleButton: currentSimCtx.toggleButton,
              pullSnapshot: currentSimCtx.pullSnapshot,
              waitForRender,
            }
            : undefined,
        };

        const result = await executeMcpTool(request.method, request.params, snapshot);
        return {
          id: request.id,
          result,
        };
      } catch (error) {
        return {
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [],
  );

  // Lokales Development (Vite HMR) hat absoluten Vorrang gegenüber Remote MCP
  React.useEffect(
    () => {
      if (!hotChannel) {
        return undefined;
      }

      const announce = () => {
        hotChannel.send(MCP_EVENT_HELLO, {});
      };

      const handleAck = () => {
        setLocalStatus("local-connected");
      };

      const handleDisconnect = () => {
        setLocalStatus("local-connecting");
      };

      const handleRequest = async (request: McpBridgeRequest) => {
        const response = await executeRequest(request);
        hotChannel.send(MCP_EVENT_RESPONSE, response);
      };

      hotChannel.on(MCP_EVENT_ACK, handleAck as (data: never) => void);
      hotChannel.on(MCP_EVENT_REQUEST, handleRequest as (data: never) => void);
      hotChannel.on("vite:ws:connect", announce as (data: never) => void);
      hotChannel.on("vite:ws:disconnect", handleDisconnect as (data: never) => void);
      announce();

      return () => {
        hotChannel.off(MCP_EVENT_ACK, handleAck as (data: never) => void);
        hotChannel.off(MCP_EVENT_REQUEST, handleRequest as (data: never) => void);
        hotChannel.off("vite:ws:connect", announce as (data: never) => void);
        hotChannel.off("vite:ws:disconnect", handleDisconnect as (data: never) => void);
        hotChannel.send(MCP_EVENT_BYE, {});
      };
    },
    [executeRequest, hotChannel],
  );

  // Remote-Modus über SharedWorker (bzw. Single-Tab-Fallback) nur wenn kein HMR-Kanal existiert und MCP aktiv ist
  React.useEffect(
    () => {
      if (isDisabled || hotChannel) {
        return undefined;
      }

      const client = remoteClientFactoryRef.current ? remoteClientFactoryRef.current() : new McpRemoteClient();
      remoteClientRef.current = client;
      setRemoteMeta({
        tabId: client.tabId,
        isSharedWorkerSupported: client.isSharedWorkerSupported,
      });
      setRemoteState(client.state);

      const unsubscribeState = client.onStateChange((nextState) => {
        setRemoteState(nextState);
      });

      const unsubscribeRequest = client.onRequest((request) => {
        void executeRequest(request).then((response) => {
          client.sendResponse(response);
        });
      });

      const handleUnload = () => {
        client.dispose();
      };

      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", handleUnload);
        window.addEventListener("beforeunload", handleUnload);
      }

      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("pagehide", handleUnload);
          window.removeEventListener("beforeunload", handleUnload);
        }
        unsubscribeState();
        unsubscribeRequest();
        client.dispose();
        if (remoteClientRef.current === client) {
          remoteClientRef.current = null;
        }
      };
    },
    [
      executeRequest,
      hotChannel,
      isDisabled,
    ],
  );

  const connect = React.useCallback(
    (accessKey?: string) => {
      if (isDisabled || isLocalMode) {
        return;
      }
      remoteClientRef.current?.connect(accessKey);
    },
    [isDisabled, isLocalMode],
  );

  const disconnect = React.useCallback(
    () => {
      if (isDisabled || isLocalMode) {
        return;
      }
      remoteClientRef.current?.disconnect();
    },
    [isDisabled, isLocalMode],
  );

  const activateThisTab = React.useCallback(
    () => {
      if (isDisabled || isLocalMode) {
        return;
      }
      remoteClientRef.current?.claimActiveTab();
    },
    [isDisabled, isLocalMode],
  );

  const status: McpBridgeStatus = isDisabled
    ? "remote-off"
    : isLocalMode
      ? localStatus
      : remoteMeta.tabId
        ? mapRemoteStateToBridgeStatus(remoteState, remoteMeta.tabId)
        : "remote-off";

  return {
    status,
    mode: isDisabled ? "disabled" : isLocalMode ? "local" : "remote",
    sessionId: isDisabled || isLocalMode ? null : remoteState.sessionId,
    tabId: isDisabled || isLocalMode ? null : remoteMeta.tabId,
    connectedTabCount: isDisabled || isLocalMode ? 1 : remoteState.connectedTabCount,
    error: isDisabled || isLocalMode ? null : remoteState.error,
    isSharedWorkerSupported: isDisabled || isLocalMode ? false : remoteMeta.isSharedWorkerSupported,
    connect,
    disconnect,
    activateThisTab,
  };
};

export default useMcpBridge;
