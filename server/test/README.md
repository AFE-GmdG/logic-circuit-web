# Manuelle Tests:

Ich kann mit dem folgenden Befehl einen manuellen Test der Streamable-HTTP-MCP-Funktion gegen den laufenden Dev-Server (`yarn dev`) anstoßen:
```bash
curl -X POST http://localhost:5173/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_circuit_summary","arguments":{}}}'
```

Es ist sinnvoll, im [Vite Plugin](../vitePluginMcp.ts) einen Timeout von 10 Minuten zu setzen, da sonst nach 5 Sekunden ein Timeout registriert wird:
```ts
// Vite-Plugin: hängt die MCP-Bridge an den HMR-WebSocket und stellt /mcp sowie Status-/Datenschutzendpunkte bereit
const vitePluginMcp = (): Plugin => ({
  name: "logic-circuit-mcp",
  apply: "serve",
  configureServer(server) {
    const bridge = new McpBridge(600000); // For Debug: 10 Minuten Timeout
```
