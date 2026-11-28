import type McpBridgeResponse from "./mcpBridgeResponse";

// Nachrichten von einem Browser-Tab an den SharedWorker
type McpWorkerCommand =
  | { type: "register-tab"; tabId: string }
  | { type: "unregister-tab"; tabId: string }
  | { type: "connect"; tabId: string; accessKey?: string; sidecarBaseUrl?: string }
  | { type: "disconnect" }
  | { type: "claim-active-tab"; tabId: string }
  | { type: "tool-response"; response: McpBridgeResponse };

export default McpWorkerCommand;
