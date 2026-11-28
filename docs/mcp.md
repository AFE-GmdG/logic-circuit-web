# Model Context Protocol (MCP) Integration

[← Zurück zur Übersicht](intro.md) • [📋 Zum Scrum-Board](scrum-board.md)

Dieses Dokument spezifiziert das architektonische Konzept zur Integration des **Streamable-HTTP-MCP-Servers** in **Logic Circuit Web**. Ziel ist es, KI-Assistenten (z. B. Antigravity oder Claude Desktop) ohne zusätzlichen Stdio-CLI-Adapter direkt über HTTP(S) in die Lage zu versetzen, Schaltungen in Echtzeit zu analysieren, Fehler zu diagnostizieren, Bauteile und Leitungen zu modifizieren sowie Simulationen interaktiv zu testen.

---

## Kernarchitektur: Frontend als Source of Truth

Die Schaltungsdefinitionen (`CircuitProject`), das Platzierungsmodell (`CircuitSymbol`, `Wire`), der Render-Canvas und die logische Simulations-Engine laufen vollständig im Browser.

Der MCP-Server arbeitet deshalb als **zustandslose bidirektionale Bridge** mit **Streamable HTTP (`/mcp`)** als einheitlichem Transport für lokales Development und Remote-Betrieb:
- Der KI-Client sendet standardisierte **MCP Streamable-HTTP**-Anfragen (`POST /mcp`, optional `GET /mcp` SSE-Stream sowie `DELETE /mcp`) direkt an den Vite-Dev-Server oder das Standalone-Sidecar-Relay.
- Das Node.js-Backend korreliert eingehende `tools/call`-Aufrufe und leitet sie über die WebSocket-Verbindung (`/ws-mcp` bzw. Vite-HMR) an die aktive Frontend-Instanz im Browser weiter.
- Das Frontend führt die Aktionen direkt im `CircuitContext` und `SimulationContext` aus und liefert das Ergebnis über die Bridge an den KI-Client zurück.

```mermaid
sequenceDiagram
  autonumber
  actor AI as KI-Assistent (z. B. Antigravity)
  participant MCP as Streamable-HTTP MCP (/mcp)
  participant WS as Browser-WebSocket (/ws-mcp / HMR)
  participant FE as Frontend (React / Canvas)

  AI->>MCP: POST /mcp (initialize / Mcp-Session-Id)
  MCP-->>AI: MCP-Handshake & Session-Header
  AI->>MCP: POST /mcp (tools/call: add_elements)
  MCP->>WS: Bridge Request (id, method, params)
  WS->>FE: Action im CircuitContext ausführen
  Note over FE: Canvas rendert live;<br/>Undo-History wird gepflegt
  FE-->>WS: Bridge Response (id, result)
  WS-->>MCP: Response zuordnen (Correlation-ID)
  MCP-->>AI: JSON-RPC Result (Text + optional PNG)
```

### Wesentliche Vorteile dieses Ansatzes
- **Kein Stdio-Wrapper nötig:** KI-Clients verbinden sich direkt über `url` gegen `/mcp` – ein separater Node-Subprozess (`mcpCli.mjs` wurde entfernt) entfällt vollständig.
- **Keine Redundanz:** Schaltungsmodell, Validierungsregeln und Simulations-Engine bleiben ausschließlich im Frontend.
- **Mensch-in-the-Loop & Undo:** Änderungen durch die KI nutzen dieselben Frontend-Aktionen, sodass die Undo/Redo-Historie (`Strg+Z`) erhalten bleibt.
- **Aktiver Simulationszustand:** Dynamische Signalwerte, Taktschritte und Probes können direkt aus dem laufenden Browser-Speicher abgefragt werden.

---

## Dual-Hosting: Lokales Development (Vorrang) & Sidecar-Relay

Um sowohl lokal während der Entwicklung als auch hinter Reverse-Proxys oder via **Bring Your Own SideCar (BYO SideCar)** sauber zu funktionieren, teilt sich die Architektur in folgende Bausteine auf:

```text
server/
├── mcpHttpHandler.ts           # Einheitlicher MCP Streamable-HTTP-Handler (/mcp)
├── mcpBridge.ts                # Request-/Response-Korrelationsmanager für vitePluginMcp
├── vitePluginMcp.ts            # Vite Dev-Server Plugin (HMR + /mcp + /__mcp/status, Vorrang)
├── vitePluginSidecarPackage.ts # Bereitstellung von /downloads/logic-circuit-sidecar.zip
├── rateLimiter.ts              # Flüchtiges In-Memory-Sliding-Window Rate-Limiting
├── webSocketConnection.ts      # Abhängigkeitsfreier RFC-6455 WebSocket-Parser & -Server
├── mcpRelay.ts                 # Zustandsloses RAM-Relay für Remote-Browser-Sessions
└── standaloneServer.ts         # Node-22 Standalone HTTP- & WebSocket-Sidecar (/mcp, /ws-mcp, /ws-collab)

scripts/
└── buildSidecarPackage.mjs     # Generator für das herunterladbare Sidecar-ZIP (Single Source: Dockerfile.mcp)

src/mcp/
├── mcpEvents.ts                # Endpunkt-Pfade (/mcp, /ws-mcp, /__mcp) & Protokollkonstanten
├── mcpTools.ts                 # MCP Tool-Handler im Frontend
├── toolDefinitions.json        # MCP Tool-Definitionen und JSON-Schemata
├── mcpRemoteRouter.ts          # Multi-Tab-Routing & Tab-Registry (reine Logik)
├── mcpSharedWorker.ts          # SharedWorker-Entrypoint (eine WebSocket-Verbindung pro Origin)
└── mcpRemoteClient.ts          # Frontend-Transport inkl. Custom-Sidecar-URL & Single-Tab-Fallback

src/utils/
├── mcpStorage.ts               # Access-Key-Speicherung, Prompt- & Streamable-HTTP-Config-Builder
├── sidecarStorage.ts           # Validierung/Speicherung der BYO-SideCar-URL & Mixed-Content-Schutz
└── sidecarVersion.ts           # SemVer-Abgleich zwischen App-Version und serverVersion

Dockerfile.mcp                  # Schlankes Node-22-Alpine-Sidecar-Image (Port 3001)
deploy/Caddyfile.example        # Caddy-Reverse-Proxy für /mcp, /__mcp/*, /ws-mcp, /__collab/*, /ws-collab
```

### Lokales Development (`yarn dev`, absoluter Vorrang)
- Sobald `import.meta.hot` im Browser verfügbar ist, greift ausschließlich der lokale Vite-Dev-Modus (`MCP (Lokal)` in der Statusleiste).
- `vitePluginMcp.ts` stellt direkt in Vite die Endpunkte `GET|POST|DELETE /mcp` (Streamable HTTP) und `GET /__mcp/status` bereit und kommuniziert intern über den bestehenden Vite-HMR-WebSocket (`server.ws`).
- **Localhost- & DNS-Rebinding-Schutz:** Das Dev-Plugin prüft `Host`- und `Origin`-Header auf Loopback-Adressen (`localhost`, `127.0.0.1`, `[::1]`) und benötigt lokal keinen `MCP_ACCESS_KEY` und keine `sessionId`.

### Remote MCP & BYO SideCar (GDPR-konform)
- **Keine Persistenz auf Disk:** Der Standalone-Server speichert weder Benutzerkonten noch Schaltungsprojekte oder Access-Logs auf Festplatte. Sessions, `Mcp-Session-Id`-Handles, `reconnectToken` und Rate-Limit-Zähler existieren ausschließlich temporär im Arbeitsspeicher (RAM).
- **Explizites Opt-in:** Normale Besucher einer gehosteten Instanz bauen keine Sidecar-Verbindung auf. Erst bei Aktivierung durch den Nutzer wird `/ws-mcp` verbunden.
- **Multi-Tab-Koordination per `SharedWorker`:** Ein `SharedWorker` bündelt alle offenen Tabs derselben Origin auf **eine** WebSocket-Verbindung; über **Diesen Tab aktivieren** wählt der Nutzer explizit den Ziel-Tab.
- **Dynamic Session Pairing (`set_remote_session`):** Im Remote-Modus erzeugt der Browser eine flüchtige `sessionId` samt kopierbarem Chat-Prompt (*„Nutze für Logic Circuit Anfragen folgende SessionID: ...“*). Der KI-Client übergibt die ID einmalig über das MCP-Tool `set_remote_session`.
- **Zusammenspiel mit WebRTC-Kollaboration:** Während einer aktiven Kollaborations-Session ist MCP ausschließlich dem **Host** vorbehalten (bei Nicht-Hosts wird die Verbindung automatisch gesperrt). Mutierende KI-Aufrufe respektieren aktive Fremd-Soft-Locks und werden auf allen verbundenen Peers mit eigenem KI-Highlight (`origin: "mcp"`) synchronisiert.

---

## Bring Your Own SideCar (BYO SideCar) & GitHub Pages

Auf rein statischen Deployments (z. B. **GitHub Pages**, Build über `yarn build:pages` bzw. `SIDECAR_CUSTOM_ONLY=true`) existiert kein mitgelieferter Backend-Server auf derselben Origin:
- **Standardmäßig null Backend-Traffic:** Solange im Browser keine eigene Sidecar-URL eingetragen ist, baut die App weder MCP- noch Collab-WebSockets auf und fragt auch keine Konfigurations-Endpunkte ab.
- **Konfiguration im UI:** Nutzer hinterlegen Sidecar-Basis-URL, lokale Zugangsschlüssel (`MCP_ACCESS_KEY`, `COLLAB_ACCESS_KEY`) sowie die Streamable-HTTP-`mcp_config.json` (**IDE-Config anzeigen**) zentral im Einstellungsdialog unter **Hilfe → BYO SideCar...** (bzw. direkt über **Einstellungen…** im **MCP**-Popover der Statusleiste). Das **MCP**-Popover der Statusleiste bleibt auf Verbinden/Trennen und den KI-Chat-Prompt fokussiert.
- **HTTPS & Localhost (Mixed-Content-Regel):**
  - Auf einer HTTPS-Seite ist `http://localhost:3001` bzw. `http://127.0.0.1:3001` explizit zulässig; der Sidecar liefert die dafür nötigen CORS- sowie Private-Network-Access-Header (`Access-Control-Allow-Private-Network: true`).
  - Entfernte Sidecars auf anderen Domains unter HTTPS müssen über `https://...` erreichbar sein – unsichere entfernte `http://`-URLs werden im UI bereits bei der Eingabe abgewiesen.
- **Versionsabgleich (`serverVersion`):** `/__mcp/status` und `/__collab/config` melden die laufende Server-SemVer als `serverVersion`. Weicht diese nach unten ab, zeigt das UI einen Update-Hinweis mit direktem Sprung zum **Download SideCar**-Dialog.

---

## Traffic- & Missbrauchsschutz

Alle schreibenden und authentifizierten Pfade des Standalone-Sidecars sind durch mehrere leichtgewichtige In-Memory-Schutzschichten abgesichert:
- **Auth-First vor Session-Allokation:** Ist `MCP_ACCESS_KEY` bzw. `COLLAB_ACCESS_KEY` gesetzt, prüft der Server das `Authorization: Bearer <key>`- bzw. WebSocket-`HELLO`-Secret **bevor** Session-Zustand allokiert oder geschäftliche Payloads verarbeitet werden.
- **Fehlgeschlagene Auth-Drosselung:** Wiederholte `401 Unauthorized`-Antworten werden pro Client-IP gezählt und ab Erreichen des Schwellwerts temporär mit `429 Too Many Requests` (`Retry-After`) beantwortet.
- **Sliding-Window Rate-Limiting:** Konfigurierbare Limits pro Minute für `/mcp`, Status-/Config-Endpunkte (`/__mcp/status`, `/__collab/config`, `/__mcp/privacy`) sowie WebSocket-Handshakes – vollständig ohne Festplatten-Logs.
- **Session-, Concurrency- & Payload-Limits:** Begrenzung gleichzeitiger aktiver MCP-WebSocket-Sessions (`MCP_MAX_SESSIONS`), Streamable-HTTP-Clients (`MCP_MAX_HTTP_SESSIONS` mit TTL-Bereinigung), paralleler Tool-Calls je Session (`MCP_MAX_CONCURRENT_CALLS_PER_SESSION`) sowie maximaler JSON-RPC-Bodygröße (`2 MiB` Default im HTTP-Handler).

---

## Sidecar-Download-Paket (Self-Hosting ohne Repo-Checkout)

Über **Hilfe → Download SideCar...** im Hauptmenü (bzw. direkt aus den BYO-SideCar-Hinweisen) lässt sich ein eigenständiges ZIP-Archiv (`logic-circuit-sidecar.zip`) herunterladen:
- **Automatisierte Paket-Erzeugung:** `scripts/buildSidecarPackage.mjs` liest `Dockerfile.mcp` als Single Source of Truth ein und bündelt alle Server- und Schema-Dateien zusammen mit `Dockerfile`, `docker-compose.yml`, `.env.example` (mit sicheren Platzhaltern ohne echte Secrets), `start.sh`, `start.bat`, `README.md` und `sidecar-manifest.json`.
- **Verfügbarkeit in Dev & Production:** Das Vite-Plugin `vitePluginSidecarPackage.ts` liefert das Archiv unter `./downloads/logic-circuit-sidecar.zip` sowohl während `yarn dev` als auch in `yarn build` und `yarn build:pages` aus.
- **Voraussetzungen zum Starten:** **Node.js 22+** (`node --experimental-strip-types server/standaloneServer.ts` über `start.sh` / `start.bat`) oder **Docker / Docker Compose** (`docker compose up -d`).

---

## Konfiguration für KI-Clients (Streamable HTTP)

KI-Clients verbinden sich direkt per HTTP(S)-URL gegen `/mcp` (ohne `command`/`node`/`mcpCli.mjs`).

### Lokales Development (`yarn dev`)

```json
{
  "mcpServers": {
    "logic-circuit": {
      "url": "http://localhost:5173/mcp"
    }
  }
}
```

Voraussetzung im lokalen Betrieb: `yarn dev` läuft und die Webanwendung ist in einem Browser-Tab geöffnet (`MCP (Lokal)` aktiv).

### Remote- oder Standalone-Sidecar-Betrieb

```json
{
  "mcpServers": {
    "logic-circuit-remote": {
      "url": "https://circuit.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <optionaler-MCP_ACCESS_KEY>"
      }
    }
  }
}
```

Bei einem lokalen Standalone-Sidecar lautet die URL analog `http://localhost:3001/mcp` (optional mit `headers.Authorization`, falls `MCP_ACCESS_KEY` gesetzt ist).

Im Remote-Modus wird die flüchtige `sessionId` **nicht** statisch in `mcp_config.json` hinterlegt, sondern nach Aktivierung im **MCP**-Popover als Chat-Prompt kopiert und einmalig per `set_remote_session` an die KI übergeben.

---

## Werkzeugkatalog (MCP Tools)

Die Schnittstelle stellt der KI Werkzeuge in vier Bereichen bereit:

### Session-Zuordnung (Remote-Modus)
- `set_remote_session`: Bindet die aktuelle Streamable-HTTP-Verbindung an die vom Browser erzeugte flüchtige `sessionId` (im lokalen Vite-Dev-Modus optional bzw. nicht nötig).

### Analyse & Inspektion
- `get_component_catalog`: Liefert den Katalog aller verfügbaren Standard-Bausteine, Gatter, I/O-, Speicher-, Audio- und Display-Komponenten inklusive unterstützter Parameter.
- `get_circuit_summary`: Liefert Metadaten der aktuellen Schaltung (ID, Name, Anzahl von Symbolen, Leitungen, Pins und Probes).
- `get_circuit_details`: Gibt den detaillierten Netzplan aus (platzierte Gatter, Koordinaten, Pin-Jams, Leitungsführungen).
- `get_circuit_image`: Erzeugt einen PNG-Screenshot des aktuellen Viewports (`viewport`), der gesamten Schaltung (`circuit`) oder eines gezielten Ausschnitts per **Raster-Rechteck** (`gridRect: { x, y, width, height }`) bzw. **Bauteileliste** (`symbolIds`) inklusive optionalem `margin` und Filter für nicht genannte Bauteile (`unrelatedSymbols: "show" | "dim" | "hide"`).
- `validate_circuit`: Prüft die Schaltung (inkl. eingebundener Subschaltungen) auf Konstruktionsfehler wie unbeschaltete Eingänge, Rekursionsschleifen, Bitbreiten-Konflikte oder Kurzschlüsse durch mehrere Treiber auf einem Netz.

### Modifikation & Konstruktion (Mutations)
- `add_elements`: Platziert ein oder viele Bauteile, Textnotizen und Leitungen (inkl. `ref`-Referenzen auf neu erzeugte Symbole) atomar in einem einzigen Aufruf und Undo-Schritt.
- `connect_wire`: Zieht eine Leitungsverbindung zwischen zwei Koordinaten oder Bauteil-Jams.
- `delete_elements`: Entfernt gezielt Symbole, Textnotizen oder Leitungen über deren IDs.
- `move_elements`: Verschiebt Symbole, Textnotizen und Leitungen gemeinsam um `(dx, dy)` in einem Undo-Schritt.
- `rotate_symbols`: Rotiert Symbole, Textnotizen und optional Leitungen (`wireIds`) um 90 Grad im oder gegen den Uhrzeigersinn.
- `update_element_properties`: Aktualisiert Eigenschaften bestehender Bauteile (z. B. Bitbreite, Beschriftung, Speicherdaten, Sensor- oder Display-Parameter) sowie von Textnotizen.
- `set_current_circuit`: Wechselt die aktive Schaltung im Editor per `circuitId`.
- `update_circuit_properties`: Passt Name, Kategorie und Notiz/Beschreibung einer Schaltung an.
- `create_circuits`: Erzeugt eine oder mehrere neue (Sub-)Schaltungen im Projekt in einem Aufruf.
- `delete_circuits`: Entfernt eine oder mehrere unreferenzierte Schaltungen aus dem Projekt.

### Simulation & Frame-genaue Auswertung (`X` Frames)
- `set_input_signal`: Setzt oder schaltet einen oder mehrere Eingangs-Taster/Schalter (`CircuitButton`) deterministisch um.
- `step_simulation`: Zentrales Simulationswerkzeug zum Starten, Pausieren, Stoppen, Zurücksetzen (`action`), deterministischen Fortschreiten um exakt `X` Takte/Frames (`steps`), zeitgesteuerten Eingabe-Events innerhalb desselben Aufrufs (`events` mit `atStep`) auf einer wählbaren Root-Schaltung (`circuitId`) inklusive optionaler Statusauswertung (`includeState`, `symbolIds`), Subschaltungs-Instanzpfad (`instancePath`) und direktem Screenshot (`includeScreenshot`).

---

## Docker-Sidecar- & Reverse-Proxy-Deployment

Die statische Auslieferung der Webanwendung kann über einen beliebigen HTTP-Server-Container oder GitHub Pages erfolgen. Der Sidecar läuft daneben als schlanker Node-22-Container ohne externe npm-Abhängigkeiten.

### Sidecar-Image bauen und starten

- **Image bauen (im Repo-Root oder direkt im entpackten Sidecar-ZIP mit `-f Dockerfile`):**

```bash
docker build -f Dockerfile.mcp -t logiccircuit-mcp .
```

- **Sidecar-Container starten:**

```bash
docker run -d --rm \
  --name logiccircuit-mcp \
  --read-only \
  --cap-drop=ALL \
  -p 3001:3001 \
  -e MCP_ACCESS_KEY="<optionaler-access-key>" \
  -e MCP_ALLOWED_ORIGINS="https://circuit.example.com,https://afe-gmdg.github.io" \
  logiccircuit-mcp
```

Der Container läuft als Non-Root-Benutzer (`node`), lauscht standardmäßig auf Port `3001` (`HOST=0.0.0.0`) und prüft seine Gesundheit über `GET /healthz`.

### Umgebungsvariablen des Standalone-Servers (`server/standaloneServer.ts`)

| Variable | Default | Beschreibung |
| :--- | :--- | :--- |
| `PORT` / `MCP_PORT` | `3001` | HTTP- & WebSocket-Port des Sidecar-Servers |
| `HOST` | `0.0.0.0` | Bind-Adresse |
| `MCP_ACCESS_KEY` | *(leer)* | Optionales Shared-Secret für `Authorization: Bearer ...` auf `/mcp` und WebSocket-Handshake auf `/ws-mcp` |
| `MCP_ALLOWED_ORIGINS` | *(leer)* | Komma-separierte Origin-Whitelist für CORS & WebSocket-Upgrades (z. B. `https://circuit.example.com,https://afe-gmdg.github.io`) |
| `MCP_REQUEST_TIMEOUT_MS` | `600000` | Timeout pro Tool-Ausführung in Millisekunden (Standard: 10 Minuten) |
| `MCP_SESSION_GRACE_MS` | `120000` | Kulanzzeit für kurzzeitigen Reconnect derselben `sessionId` mit `reconnectToken` |
| `MCP_HEARTBEAT_INTERVAL_MS` | `25000` | Intervall für serverseitige WebSocket-Pings |
| `MCP_MAX_SESSIONS` | `20` | Maximale Anzahl gleichzeitiger aktiver MCP-Browser-Sessions |
| `MCP_MAX_HTTP_SESSIONS` | `50` | Maximale Anzahl gleichzeitiger Streamable-HTTP-Client-Sessions (`/mcp`) |
| `MCP_HTTP_SESSION_TTL_MS` | `1800000` | Verfallszeit inaktiver Streamable-HTTP-Sessions (Standard: 30 Minuten) |
| `MCP_MAX_CONCURRENT_CALLS_PER_SESSION` | `4` | Maximale parallele Tool-Aufrufe pro MCP-Session |
| `MCP_TRUST_PROXY` | `true` | Berücksichtigt `X-Forwarded-For` / `Forwarded` bei Rate-Limiting hinter Reverse-Proxys |
| `RATE_LIMIT_HTTP_PER_MIN` | `60` | Maximale HTTP-Anfragen pro Minute je Client auf `/mcp` (`0` = aus) |
| `RATE_LIMIT_STATUS_PER_MIN` | `30` | Maximale Anfragen pro Minute auf `/__mcp/*` & `/__collab/*` (`0` = aus) |
| `RATE_LIMIT_AUTH_FAIL_PER_MIN` | `5` | Maximale fehlgeschlagene Auth-Versuche pro Minute vor `429`-Blockade (`0` = aus) |
| `RATE_LIMIT_WS_PER_MIN` | `10` | Maximale WebSocket-Upgrade-Versuche pro Minute je Client (`0` = aus) |
| `MCP_STATIC_DIR` | *(leer)* | Optionaler Pfad für ein All-in-One-Container-Setup ohne separaten Webserver |
| `COLLAB_ACCESS_KEY` | *(leer)* | Optionales Shared-Secret für das Erstellen geschützter Collab-Host-Sessions (`/ws-collab`) |
| `COLLAB_ALLOWED_ORIGINS` | *(leer)* | Optionale Origin-Whitelist speziell für WebRTC-Signaling (Fallback auf `MCP_ALLOWED_ORIGINS`) |
| `PRIVACY_RESPONSIBLE_NAME` | *(leer)* | Name des Verantwortlichen für den DSGVO-Dialog (`GET /__mcp/privacy`, Build-Zeit: `PRIVACY_*`) |
| `PRIVACY_RESPONSIBLE_ADDRESS` | *(leer)* | Anschrift des Verantwortlichen für den DSGVO-Dialog |
| `PRIVACY_CONTACT_EMAIL` | *(leer)* | Kontakt-E-Mail-Adresse für Datenschutzanfragen (`mailto:`-Link im Dialog) |
| `PRIVACY_HOSTING_LOCATION` | *(leer)* | Hosting-Hinweis im DSGVO-Dialog (z. B. `Deutschland, Frankfurt`) |

### Reverse-Proxy-Routing (Caddy)

- Eine Beispiel-Konfiguration liegt unter `deploy/Caddyfile.example`.
- Caddy terminiert HTTPS und leitet alle Sidecar-Pfade (`/mcp`, `/__mcp/*`, `/ws-mcp`, `/__collab/*`, `/ws-collab`) an `logiccircuit-mcp:3001` weiter; alle übrigen Pfade beantwortet der statische Webserver (`logiccircuit-web:8080`).
- Für längere Simulationen und ruhige WebSockets setzt das Beispiel `read_timeout 10m` und `write_timeout 10m`. Optional verhindert `# log_skip @sidecar` (ab Caddy 2.7+) serverseitige Access-Logs für Sidecar-Pfade.
- **Kurze Funktionsprüfung nach dem Ausrollen:**
  - `docker ps` prüfen (`logiccircuit-mcp` im Status `(healthy)` auf Port `3001/tcp`).
  - `curl -fsS https://circuit.example.com/__mcp/status` → liefert JSON mit `activeSessions`, `pendingRequests`, `authRequired` und `serverVersion`.
  - `curl -fsS https://circuit.example.com/__collab/config` → liefert STUN-/Signaling-Konfiguration inkl. `serverVersion`.
  - `curl -fsS https://circuit.example.com/__mcp/privacy` → liefert die gesetzten `PRIVACY_*`-Felder als JSON.
