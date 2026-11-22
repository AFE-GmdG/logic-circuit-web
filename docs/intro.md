# Logic Circuit Web

## Vision

**Logic Circuit Web** bringt den bewährten, freien Windows-Schaltungssimulator [Logic Circuit](https://www.logiccircuit.org/) als moderne, plattformunabhängige Webanwendung in den Browser. Ziel ist es, ein reaktionsschnelles CAD- und Simulationswerkzeug für digitale Schaltungen bereitzustellen – von einfachen Logikgattern bis hin zu komplexen hierarchischen CPU-Designs mit Takterzeugung, Multi-Bit-Bussen und Speicherbausteinen.

### Kernaspekte
- **Interaktiver Schematics-Editor:**
  Zeichnen, Platzieren, Verbinden und Verschieben von Komponenten auf einem zoom- und panbaren Schaltungsgitter mit intuitiver Leitungsführung.
- **Hierarchische Schaltungen (Sub-Circuits):**
  Eigene Schaltungen können als wiederverwendbare Bausteine mit Pins in übergeordnete Schaltungen eingebettet werden.
- **Echtzeit-Logiksimulation:**
  Deterministische oder eventbasierte Simulation digitaler Signale (Low, High, Undefined/Tri-State) mit Visualisierung von Signalzuständen entlang der Leitungen.
- **Kompatibilität zur C#-Desktop-Version:**
  Das Original-Projekt von Eugene Lepekhin dient als Referenz (`reference/LogicCircuit`). Es wird angestrebt, das XML-Projektformat von Logic Circuit lesen und schreiben zu können.

---

## Projekt- und Dokumentationsstruktur

Logic Circuit Web folgt einer strikt User-Story- und Task-getriebenen Dokumentationsmethodik:

```text
docs/
├── coding-rules.md               # Verbindliche Entwicklungs- und Formatierungsrichtlinien
├── data-model.md                 # Tiefgehende Spezifikation des Referenz-Datenmodells (C#-Vorlage -> TS)
├── history-1.0.md                # Chronik „Was bisher geschah“ (alle Stories, Tasks & Fixes bis Release 1.0)
├── intro.md                      # Dieses Dokument (Vision, Systemkonzept, Roadmap)
├── mcp.md                        # Spezifikation & Architektur der Model Context Protocol (MCP) Integration
├── scrum-board.md                # Kanban-Board
├── user_stories/                 # Fachliche Anforderungen und Akzeptanzkriterien (US-xxx)
│   └── README.md
├── tasks/                        # Technische Arbeitspakete zur Implementierung (T-xxx)
│   └── README.md
└── bugs/                         # Fehlerberichte und Incident-Tracking (B-XXX)
    └── README.md
```

### Namens- und Referenzkonventionen
- **User Stories:** `US-XXX-<titel>.md` (fachlicher Mehrwert, Akzeptanzkriterien).
- **Tasks:** `T-XXX-<titel>.md` (konkrete technische Aufgaben, betroffene Dateien, Testkriterien, verlinkte User Story).
- **Bugs:** `B-XXX-<titel>.md` (Fehlerbeschreibung, Reproduktionsschritte, Ursache, Fix-Kriterien).

---

## Scrum- & Kanban-Workflow

Die Steuerung des Entwicklungsfortschritts erfolgt über das zentrale Kanban-Board:
**[💻 Entwickler-Board](scrum-board.md)**

### Lebenszyklus eines Tasks
- **`To Do`:**
  Der Task ist definiert, aber die Arbeit daran wurde noch nicht aufgenommen.
- **`Progress`:**
  Der Task ist aktuell in aktiver Bearbeitung durch den Entwickler bzw. die KI.
- **`Review` (Wichtig – Pflicht-Zwischenschritt):**
  Sobald die technische Implementierung abgeschlossen ist und alle automatisierten Checks (`yarn errorcheck`, `yarn lint`, `yarn test`, `yarn build`) erfolgreich durchlaufen wurden, wechselt der Task **immer zuerst in den Status `Review` (niemals direkt in `Done`)**.
  Die KI meldet die Fertigstellung und übergibt die Kontrolle zur Abnahme.
- **`Done` / `Rejected`:**
  **Ausschließlich der leitende Entwickler (Nutzer)** entscheidet nach Prüfung, ob ein Task als fertig (`Done`) abgenommen wird oder Nacharbeiten (`Rejected`) erforderlich sind.

### Abschluss von User Stories
Eine User Story wechselt erst dann in den Status **Abgeschlossen**, wenn alle ihr zugeordneten Tasks auf `Done` stehen und der Nutzer explizit bestätigt, dass die Akzeptanzkriterien vollständig erfüllt sind.
