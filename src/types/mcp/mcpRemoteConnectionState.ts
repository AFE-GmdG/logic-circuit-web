// Verbindungszustand des zentralen Remote-WebSockets (unabhängig vom einzelnen Tab)
type McpRemoteConnectionState = "off" | "connecting" | "connected" | "error";

export default McpRemoteConnectionState;
