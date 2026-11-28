// Gemeinsame Kanal-Bezeichner der MCP-Bridge zwischen Server und Browser

// Browser meldet sich als aktive LogicCircuit-Sitzung an
export const MCP_EVENT_HELLO = "logic-circuit:mcp-hello";

// Browser meldet sich ab (z. B. beim Schließen oder Unmount)
export const MCP_EVENT_BYE = "logic-circuit:mcp-bye";

// Server bestätigt die Anmeldung einer Browsersitzung
export const MCP_EVENT_ACK = "logic-circuit:mcp-ack";

// Server leitet einen Werkzeugaufruf an den Browser weiter
export const MCP_EVENT_REQUEST = "logic-circuit:mcp-request";

// Browser liefert das Ergebnis eines Werkzeugaufrufs zurück
export const MCP_EVENT_RESPONSE = "logic-circuit:mcp-response";

// Server meldet einen Verbindungs- oder Autorisierungsfehler an den Browser
export const MCP_EVENT_ERROR = "logic-circuit:mcp-error";

// Anwendungsseitiges Keepalive zwischen Browser/SharedWorker und Remote-Relay
export const MCP_EVENT_PING = "logic-circuit:mcp-ping";
export const MCP_EVENT_PONG = "logic-circuit:mcp-pong";

// HTTP-Basispfad der Bridge-Endpunkte
export const MCP_HTTP_BASE_PATH = "/__mcp";

// Standardisierter MCP-Streamable-HTTP-Endpunkt
export const MCP_STREAMABLE_HTTP_PATH = "/mcp";

// Öffentlicher JSON-Endpunkt für DSGVO-/Betreiberangaben aus Server-Umgebungsvariablen
export const MCP_PRIVACY_PATH = `${MCP_HTTP_BASE_PATH}/privacy`;

// WebSocket-Pfad des Remote-MCP-Relays
export const MCP_WS_PATH = "/ws-mcp";
