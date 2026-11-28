import type McpRemoteConnectionState from "./mcpRemoteConnectionState";

// Geteilter Zustand des SharedWorkers (bzw. Single-Tab-Fallbacks), der an alle offenen Tabs gesendet wird
type McpRemoteSharedState = {
  connectionState: McpRemoteConnectionState;
  activeTabId: string | null;
  connectedTabCount: number;
  sessionId: string | null;
  error: string | null;
  sidecarBaseUrl?: string | null;
};

export default McpRemoteSharedState;
