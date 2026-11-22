import i18n from "../i18n";

export const MCP_ACCESS_KEY_STORAGE_KEY = "logicCircuit.mcp.accessKey";

// Lädt den optionalen Remote-Access-Key ausschließlich lokal aus dem Browser-Storage
export function loadMcpAccessKey(storageKey = MCP_ACCESS_KEY_STORAGE_KEY): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

// Speichert den optionalen Remote-Access-Key lokal im Browser-Storage
export function saveMcpAccessKey(accessKey: string, storageKey = MCP_ACCESS_KEY_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const trimmed = accessKey.trim();
    if (trimmed.length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, trimmed);
    }
  } catch {
    // Speicherfehler (z. B. Private Mode) still ignorieren
  }
}

// Entfernt den gespeicherten Remote-Access-Key aus dem Browser-Storage
export function clearMcpAccessKey(storageKey = MCP_ACCESS_KEY_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Speicherfehler still ignorieren
  }
}

// Erzeugt den fertigen Chat-Prompt zur Übergabe der flüchtigen SessionID an den KI-Client
export function buildRemoteChatPrompt(sessionId: string): string {
  return i18n.t("mcpPopover.chatPromptTemplate", { sessionId });
}

// Erzeugt die statische mcp_config.json-Vorlage bewusst ohne feste SessionID
export function buildRemoteMcpConfigJson(origin: string, hasAccessKey = false): string {
  const env: Record<string, string> = {
    LOGIC_CIRCUIT_URL: origin,
  };
  if (hasAccessKey) {
    env.LOGIC_CIRCUIT_TOKEN = i18n.t("mcpPopover.accessKeyTokenPlaceholder");
  }
  return JSON.stringify(
    {
      mcpServers: {
        "logic-circuit-remote": {
          command: "node",
          args: ["server/bin/mcpCli.mjs"],
          env,
        },
      },
    },
    null,
    2,
  );
}
