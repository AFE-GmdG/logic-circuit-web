// Beschreibung eines MCP-Werkzeugs gemäß MCP-Spezifikation (tools/list)
type McpToolDefinition = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export default McpToolDefinition;
