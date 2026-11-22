import type McpBridgeRequest from "./mcpBridgeRequest";
import type McpRemoteSharedState from "./mcpRemoteSharedState";

// Nachrichten vom SharedWorker an einen Browser-Tab
type McpWorkerEvent =
  | { type: "state"; state: McpRemoteSharedState }
  | { type: "execute-request"; request: McpBridgeRequest };

export default McpWorkerEvent;
