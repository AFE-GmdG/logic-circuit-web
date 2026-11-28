# 💻 Logic Circuit Web Scrum- & Kanban-Board

**Workflow:** Kontinuierlicher Flow (Feature-by-Feature ohne Sprint-Zeitdruck)  
**Fokus:** Portierung und Weiterentwicklung von Logic Circuit als performante, browserbasierte Webanwendung mit TypeScript, React, Vite und Emotion.

---

## 🚀 Aktive User Story

*(Aktuell keine User Story in Bearbeitung — zuletzt abgeschlossen: **[Release 1.2.0](history.md)**.)*

```mermaid
kanban
  Todo[To Do]
  Progress[Progress]
  Review[Review]
  Rejected[Rejected]
  Done[Done]
```

---

## ✅ Abgeschlossene User Stories & Releases

Sämtliche für **Version 1.0.0**, **Version 1.1.0** und **Version 1.2.0** abgeschlossenen User Stories (`US-001` bis `US-026`, `US-028` bis `US-032` sowie `US-034`), Tasks (`T-001` bis `T-108`) und behobenen Bugs (`B-001` bis `B-008`) sind in der Release-Chronik (`docs/history.md`) erfasst:

👉 **[📜 Was bisher geschah – Release-Chronik (`docs/history.md`)](history.md)**

---

## 📖 Backlog

### Post 1.2.0

| Story | Titel | Priorität | Geplante Tasks | Kurzbeschreibung |
| :--- | :--- | :--- | :--- | :--- |
| **[US-033](user_stories/US-033-host-autoritative-live-simulation-fuer-gaeste.md)** | Host-autoritative Live-Simulation für Gäste | Niedrig | *(offen)* | Gemeinsame Live-Simulation auf dem Host mit Backpressure-gesteuertem Snapshot-/Delta-Streaming an Gäste, freier Sub-Schaltungs-Inspektion und Weiterleitung autorisierter Button-/Sensor-Eingaben. |
| **[US-027](user_stories/US-027-integrierte-dokumentation-und-interaktive-hilfe.md)** | Umfassendes Benutzerhandbuch & interaktive Online-Hilfe (`F1`) | Mittel | *(offen)* | Eigener Vite-Entry-Point (`help.html`) mit `F1`-Kontext-Shortcut, Menüeintrag, Editor-/Bauteil-Handbuch, Schaltungs-Tutorials, interaktivem Wahrheitstabellen-Filter-Playground und MCP-Setup-/Prompt-Beispielen. |

---

## 🐛 Gemeldete Bugs & Fehlertracking

*(Aktuell keine offenen Bugs.)*

> 📚 Alle bis Version 1.2.0 behobenen Bugs (`B-001` bis `B-008`) sind in **[`docs/history.md`](history.md)** dokumentiert.

---

> 💡 **Hinweis zur Pflege:**
> - **Coding Rules (verbindlich):** Bei jeder Implementierung und Review sind die **[Coding Rules (`docs/coding-rules.md`)](coding-rules.md)** automatisch einzuhalten (inkl. abschließender Prüfung mit `yarn errorcheck`, `yarn lint`, `yarn lint-docs`, `yarn test` und `yarn build`).
> - **Tasks:** Werden nach dem Schema `[T-XXX: Titel]` gepflegt (Vorlagen in [`docs/tasks/`](tasks/)).
> - **Bugs:** Größere Bugs werden dokumentiert (Vorlagen in [`docs/bugs/`](bugs/)); direkte Review-Fixes werden ohne Task-Overhead direkt behoben.
> - **Status-Spalten & Task-Icons:**
>   - 📋 `To Do` (Offen / Geplant)
>   - 🟡 `Progress` (In aktiver Bearbeitung)
>   - 🔍 `Review` (Implementiert, wartet auf Abnahme)
>   - ❌ `Rejected` (Abgelehnt / Nacharbeit erforderlich)
>   - ✅ `Done` (Erfolgreich abgenommen & abgeschlossen)
