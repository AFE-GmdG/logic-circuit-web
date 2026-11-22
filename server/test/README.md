# Manuelle Tests:

Ich kann mit dem folgendem Befehl einen manuellen Test der MCP-Funktion anstoßen:
```bash
tr -d '\r\n' < get_circuit_summary.json | \node ../bin/mcpCli.mjs | \node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf-8")).result.content[0].text)' > payload.json
```

Es ist Sinnvoll, im [Vite Plugin](../vitePluginMcp.ts) auf Zeile 80 einen Timeout von 10 Minuten zu setzen, da sonst nach 5 Sekunden ein Timeout registriert wird:
```ts
// Vite-Plugin: hängt die MCP-Bridge an den HMR-WebSocket und stellt HTTP-Endpunkte für die Stdio-CLI bereit
const vitePluginMcp = (): Plugin => ({
  name: "logic-circuit-mcp",
  apply: "serve",
  configureServer(server) {
    const bridge = new McpBridge(600000); // For Debug: 10 Minuten Timeout
```
