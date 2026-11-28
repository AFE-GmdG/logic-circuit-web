/// <reference types="vite/client" />
import React from "react";

import CanvasContext from "../contexts/canvasContext";
import CircuitContext from "../contexts/circuitContext";
import CollabContext from "../contexts/collabContext";
import SimulationContext from "../contexts/simulationContext";

import type { CollabSoftLockEntry } from "../types/collab/modelSyncMessage";
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
import {
  isCustomSidecarRequired,
  loadSidecarBaseUrl,
  resolveEffectiveSidecarBaseUrl,
  validateSidecarBaseUrl,
} from "../utils/sidecarStorage";

export type McpHotChannel = {
  send: (event: string, payload?: unknown) => void;
  on: (event: string, cb: (data: never) => void) => void;
  off: (event: string, cb: (data: never) => void) => void;
};

export type UseMcpBridgeOptions = {
  hotOverride?: McpHotChannel | null;
  remoteClientFactory?: () => McpRemoteClient;
  disabledOverride?: boolean;
  collabBlockedOverride?: boolean;
};

export type McpBridgeController = {
  status: McpBridgeStatus;
  mode: "local" | "remote" | "disabled";
  sessionId: string | null;
  tabId: string | null;
  connectedTabCount: number;
  error: string | null;
  isSharedWorkerSupported: boolean;
  isBlockedByCollab?: boolean;
  sidecarBaseUrl?: string | null;
  customSidecarRequired?: boolean;
  connect: (accessKey?: string, sidecarBaseUrl?: string) => void;
  disconnect: () => void;
  activateThisTab: () => void;
};

export const MCP_COLLAB_HOST_ONLY_ERROR =
  "MCP ist während einer aktiven Kollaborations-Session ausschließlich dem Host vorbehalten.";

// Prüft, ob ein Tab seinen lokalen Vite-HMR-MCP-Slot aktiv anmelden darf (nicht bei aktiver Gast-/Kollaborateur-Sperre)
export function shouldRegisterLocalMcpChannel(
  hotChannel: McpHotChannel | undefined,
  isBlockedByCollab: boolean,
): boolean {
  return Boolean(hotChannel) && !isBlockedByCollab;
}

// Blockiert eingehende lokale/entfernte MCP-Aufrufe, solange der Nutzer in einer Session kein Host ist
export function guardMcpRequestForCollab(
  isBlockedByCollab: boolean,
  request: McpBridgeRequest,
): McpBridgeResponse | null {
  if (!isBlockedByCollab) {
    return null;
  }
  return {
    id: request.id,
    error: MCP_COLLAB_HOST_ONLY_ERROR,
  };
}

// Blockiert mutierende Host-MCP-Aufrufe gegen Elemente oder Schaltpläne mit aktivem Fremd-Soft-Lock
export function guardMcpRequestForSoftLocks(
  request: McpBridgeRequest,
  activeForeignLocks: ReadonlyArray<CollabSoftLockEntry>,
  currentCircuitId?: string,
): McpBridgeResponse | null {
  if (activeForeignLocks.length === 0) {
    return null;
  }

  const rawParams =
    request.params && typeof request.params === "object" && !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : {};

  const readIds = (key: string): string[] => {
    const raw = rawParams[key];
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  };

  let blocking: CollabSoftLockEntry[] = [];
  switch (request.method) {
    case "move_elements":
    case "rotate_symbols":
    case "delete_elements": {
      const symIds = new Set(readIds("symbolIds"));
      const noteIds = new Set(readIds("textNoteIds"));
      blocking = activeForeignLocks.filter(
        (lock) =>
          (lock.targetType === "symbol" && symIds.has(lock.targetId)) ||
          (lock.targetType === "textNote" && noteIds.has(lock.targetId)),
      );
      break;
    }

    case "update_element_properties": {
      const symId = typeof rawParams.symbolId === "string" ? rawParams.symbolId : null;
      const noteId = typeof rawParams.textNoteId === "string" ? rawParams.textNoteId : null;
      blocking = activeForeignLocks.filter(
        (lock) =>
          (symId !== null && lock.targetType === "symbol" && lock.targetId === symId) ||
          (noteId !== null && lock.targetType === "textNote" && lock.targetId === noteId),
      );
      break;
    }

    case "update_circuit_properties": {
      const rawCircuitId = typeof rawParams.circuitId === "string" ? rawParams.circuitId.trim() : "";
      const targetCircuitId = rawCircuitId || currentCircuitId;
      if (targetCircuitId) {
        blocking = activeForeignLocks.filter(
          (lock) => lock.targetType === "logicalCircuit" && lock.targetId === targetCircuitId,
        );
      }
      break;
    }

    case "delete_circuits": {
      const circuitIds = new Set(readIds("circuitIds"));
      blocking = activeForeignLocks.filter(
        (lock) =>
          circuitIds.has(lock.logicalCircuitId) ||
          (lock.targetType === "logicalCircuit" && circuitIds.has(lock.targetId)),
      );
      break;
    }

    default:
      return null;
  }

  if (blocking.length === 0) {
    return null;
  }

  const blocker = blocking[0];
  return {
    id: request.id,
    error: `MCP-Änderung abgelehnt: Ziel-Element (${blocker.targetId}) wird aktuell von "${blocker.ownerDisplayName}" bearbeitet (Soft-Lock aktiv).`,
  };
}

// Trennt eine laufende Remote-MCP-Verbindung automatisch bei Eintritt in eine Nicht-Host-Kollaborationsrolle
export function syncMcpCollabLock(
  isBlockedByCollab: boolean,
  remoteClient: Pick<McpRemoteClient, "disconnect"> | null,
  connectionState: string,
): boolean {
  if (!isBlockedByCollab || !remoteClient) {
    return false;
  }
  if (connectionState !== "off") {
    remoteClient.disconnect();
    return true;
  }
  return false;
}

// Prüft, ob die MCP-Integration zur Build-Zeit (z. B. für GitHub Pages) deaktiviert wurde
export function isMcpDisabledByEnv(): boolean {
  const envFlag: unknown = process.env.DISABLE_MCP;
  if (envFlag === true || envFlag === "true" || envFlag === "1") {
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
  const collabContext = React.useContext(CollabContext);

  const isDisabled = options?.disabledOverride !== undefined
    ? options.disabledOverride
    : isMcpDisabledByEnv();
  const isBlockedByCollab = Boolean(options?.collabBlockedOverride ?? collabContext?.isMcpBlockedByCollab);
  const isCollabHost = Boolean(collabContext?.isInSession && collabContext.isHost);

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
  const [localValidationError, setLocalValidationError] = React.useState<string | null>(null);
  const [configuredSidecarUrl, setConfiguredSidecarUrl] = React.useState<string | null>(
    () => resolveEffectiveSidecarBaseUrl(),
  );
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
    collabContext,
    isBlockedByCollab,
  });
  contextRef.current = {
    circuitContext,
    simulationContext,
    canvasContext,
    collabContext,
    isBlockedByCollab,
  };

  const executeRequest = React.useCallback(
    async (request: McpBridgeRequest): Promise<McpBridgeResponse> => {
      const blockedResponse = guardMcpRequestForCollab(contextRef.current.isBlockedByCollab, request);
      if (blockedResponse) {
        return blockedResponse;
      }
      const {
        circuitContext: currentCircuitCtx,
        simulationContext: currentSimCtx,
        canvasContext: currentCanvasCtx,
        collabContext: currentCollabCtx,
      } = contextRef.current;

      const softLockBlockedResponse = guardMcpRequestForSoftLocks(
        request,
        currentCollabCtx?.getForeignSoftLocks?.() ?? [],
        currentCircuitCtx.currentCircuit.logicalCircuitId,
      );
      if (softLockBlockedResponse) {
        return softLockBlockedResponse;
      }

      const withMcpOrigin = <T, >(fn: () => T): T =>
        currentCollabCtx?.runWithMutationOrigin
          ? currentCollabCtx.runWithMutationOrigin("mcp", fn)
          : fn();

      try {
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
            addEntities: (params) => withMcpOrigin(() => currentCircuitCtx.addEntities(params)),
            moveEntities: (params) => withMcpOrigin(() => currentCircuitCtx.moveEntities(params)),
            rotateSymbols: (symbolIds, direction, textNoteIds, rotateOptions) =>
              withMcpOrigin(() => currentCircuitCtx.rotateSymbols(symbolIds, direction, textNoteIds, rotateOptions)),
            removeEntities: (symbolIds, textNoteIds, wireIds) =>
              withMcpOrigin(() => currentCircuitCtx.removeEntities(symbolIds, textNoteIds, wireIds)),
            setCurrentCircuitId: currentCircuitCtx.setCurrentCircuitId,
            updateCircuitProperties: (circuitId, updates) =>
              withMcpOrigin(() => currentCircuitCtx.updateCircuitProperties(circuitId, updates)),
            updateCircuitSymbolProperties: (symbolId, updates, updateOptions) =>
              withMcpOrigin(() => currentCircuitCtx.updateCircuitSymbolProperties(symbolId, updates, updateOptions)),
            resizeCircuitSymbol: (symbolId, params, resizeOptions) =>
              withMcpOrigin(() => currentCircuitCtx.resizeCircuitSymbol(symbolId, params, resizeOptions)),
            updateTextNote: (textNoteId, updates, noteOptions) =>
              withMcpOrigin(() => currentCircuitCtx.updateTextNote(textNoteId, updates, noteOptions)),
            createCircuits: (circuits) => withMcpOrigin(() => currentCircuitCtx.createCircuits(circuits)),
            deleteCircuits: (circuitIds) => withMcpOrigin(() => currentCircuitCtx.deleteCircuits(circuitIds)),
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

  // Lokales Development (Vite HMR) hat absoluten Vorrang gegenüber Remote MCP;
  // Nicht-Hosts melden sich bei aktiver Session per MCP_EVENT_BYE ab, damit Anfragen beim Host bleiben.
  React.useEffect(
    () => {
      if (!hotChannel || !shouldRegisterLocalMcpChannel(hotChannel, isBlockedByCollab)) {
        setLocalStatus("local-connecting");
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
    [
      executeRequest,
      hotChannel,
      isBlockedByCollab,
    ],
  );

  // Stellt sicher, dass ein aktiver Kollaborations-Host im lokalen Dev-Betrieb den aktiven Bridge-Slot übernimmt
  React.useEffect(
    () => {
      if (hotChannel && isCollabHost && !isBlockedByCollab) {
        hotChannel.send(MCP_EVENT_HELLO, {});
      }
    },
    [
      hotChannel,
      isBlockedByCollab,
      isCollabHost,
    ],
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

  React.useEffect(
    () => {
      if (isDisabled || isLocalMode) {
        return;
      }
      if (isBlockedByCollab) {
        syncMcpCollabLock(true, remoteClientRef.current, remoteState.connectionState);
        return;
      }
      setLocalValidationError((prev) => (prev === MCP_COLLAB_HOST_ONLY_ERROR ? null : prev));
    },
    [
      isBlockedByCollab,
      isDisabled,
      isLocalMode,
      remoteState.connectionState,
    ],
  );

  const connect = React.useCallback(
    (accessKey?: string, sidecarBaseUrl?: string) => {
      if (isDisabled || isLocalMode) {
        return;
      }
      if (isBlockedByCollab) {
        setLocalValidationError(MCP_COLLAB_HOST_ONLY_ERROR);
        return;
      }

      const rawTargetUrl = sidecarBaseUrl !== undefined ? sidecarBaseUrl : loadSidecarBaseUrl();
      if (rawTargetUrl.trim().length > 0) {
        const validation = validateSidecarBaseUrl(rawTargetUrl);
        if (!validation.ok) {
          setLocalValidationError(validation.error);
          return;
        }
        setLocalValidationError(null);
        setConfiguredSidecarUrl(validation.normalizedUrl);
        remoteClientRef.current?.connect(accessKey, validation.normalizedUrl);
        return;
      }

      if (isCustomSidecarRequired()) {
        setLocalValidationError(
          "Im GitHub-Pages-Modus ist eine Sidecar-URL (z. B. http://localhost:3001) erforderlich.",
        );
        return;
      }

      setLocalValidationError(null);
      setConfiguredSidecarUrl(resolveEffectiveSidecarBaseUrl());
      remoteClientRef.current?.connect(accessKey);
    },
    [
      isBlockedByCollab,
      isDisabled,
      isLocalMode,
    ],
  );

  const disconnect = React.useCallback(
    () => {
      if (isDisabled || isLocalMode) {
        return;
      }
      setLocalValidationError(null);
      remoteClientRef.current?.disconnect();
    },
    [isDisabled, isLocalMode],
  );

  const activateThisTab = React.useCallback(
    () => {
      if (isDisabled || isLocalMode) {
        return;
      }
      if (isBlockedByCollab) {
        setLocalValidationError(MCP_COLLAB_HOST_ONLY_ERROR);
        return;
      }
      remoteClientRef.current?.claimActiveTab();
    },
    [
      isBlockedByCollab,
      isDisabled,
      isLocalMode,
    ],
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
    error: isDisabled
      ? null
      : isBlockedByCollab
        ? MCP_COLLAB_HOST_ONLY_ERROR
        : isLocalMode
          ? null
          : (localValidationError ?? remoteState.error),
    isSharedWorkerSupported: isDisabled || isLocalMode ? false : remoteMeta.isSharedWorkerSupported,
    isBlockedByCollab: isDisabled ? false : isBlockedByCollab,
    sidecarBaseUrl: isDisabled || isLocalMode ? null : (remoteState.sidecarBaseUrl ?? configuredSidecarUrl),
    customSidecarRequired: isDisabled || isLocalMode ? false : isCustomSidecarRequired(),
    connect,
    disconnect,
    activateThisTab,
  };
};

export default useMcpBridge;
