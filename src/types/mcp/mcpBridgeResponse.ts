// Antwort des Browsers auf einen Werkzeugaufruf (entweder result oder error)
type McpBridgeResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

export default McpBridgeResponse;
