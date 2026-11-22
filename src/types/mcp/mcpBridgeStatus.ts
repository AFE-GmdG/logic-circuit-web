// Verbindungs- und Modus-Zustand der Browser-Seite der MCP-Bridge
// "local-connecting": Anmeldung beim lokalen Vite-Dev-Server (HMR) läuft
// "local-connected": Lokaler Vite-Dev-Server hat die Sitzung bestätigt
// "remote-off": Production-Modus ohne aktive Remote-Verbindung (Opt-in)
// "remote-connecting": Verbindung zum Remote-Relay wird aufgebaut bzw. neu verbunden
// "remote-active-self": Verbunden, dieser Tab beantwortet eingehende MCP-Anfragen
// "remote-active-other": Verbunden, ein anderer (oder noch kein) Tab ist im SharedWorker aktiv
// "remote-error": Remote-Verbindung oder Autorisierung fehlgeschlagen
type McpBridgeStatus =
  | "local-connecting"
  | "local-connected"
  | "remote-off"
  | "remote-connecting"
  | "remote-active-self"
  | "remote-active-other"
  | "remote-error";

export default McpBridgeStatus;
