// Werkzeugaufruf, den der Dev-Server über den HMR-Kanal an den Browser sendet
type McpBridgeRequest = {
  id: string;
  method: string;
  params?: unknown;
};

export default McpBridgeRequest;
