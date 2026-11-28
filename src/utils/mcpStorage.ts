import i18n from "../i18n";
import { MCP_STREAMABLE_HTTP_PATH } from "../mcp/mcpEvents";

import { notifySidecarSettingsChanged } from "./sidecarStorage";

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
    notifySidecarSettingsChanged();
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
    notifySidecarSettingsChanged();
  } catch {
    // Speicherfehler still ignorieren
  }
}

// Erzeugt den fertigen Chat-Prompt zur Übergabe der flüchtigen SessionID an den KI-Client
export function buildRemoteChatPrompt(sessionId: string): string {
  return i18n.t("mcpPopover.chatPromptTemplate", { sessionId });
}

// Erzeugt die Streamable-HTTP-Konfiguration für lokale Dev-Instanzen
export function buildLocalMcpConfigJson(port = 5173): string {
  return JSON.stringify(
    {
      mcpServers: {
        "logic-circuit": {
          url: `http://localhost:${port}${MCP_STREAMABLE_HTTP_PATH}`,
        },
      },
    },
    null,
    2,
  );
}

// Erzeugt die statische Streamable-HTTP-mcp_config.json-Vorlage ohne feste SessionID
export function buildRemoteMcpConfigJson(baseUrl: string, hasAccessKey = false): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const serverEntry: { url: string; headers?: Record<string, string> } = {
    url: `${normalizedBase}${MCP_STREAMABLE_HTTP_PATH}`,
  };
  if (hasAccessKey) {
    serverEntry.headers = {
      Authorization: `Bearer ${i18n.t("mcpPopover.accessKeyTokenPlaceholder")}`,
    };
  }
  return JSON.stringify(
    {
      mcpServers: {
        "logic-circuit": serverEntry,
      },
    },
    null,
    2,
  );
}
