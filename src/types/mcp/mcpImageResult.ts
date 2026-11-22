// Rückgabe eines Bild-Werkzeugs (z. B. get_circuit_image) zur Übertragung an MCP-Clients
type McpImageResult = {
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
  description?: string;
};

export default McpImageResult;
