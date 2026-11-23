# 💻 Logic Circuit Web Scrum- & Kanban-Board

**Workflow:** Kontinuierlicher Flow (Feature-by-Feature ohne Sprint-Zeitdruck)  
**Fokus:** Portierung und Weiterentwicklung von Logic Circuit als performante, browserbasierte Webanwendung mit TypeScript, React, Vite und Emotion.

---

## 🚀 Aktive User Story

*(Aktuell keine aktive User Story in Umsetzung – die Features bis **Release 1.1.0** wurden vollständig abgeschlossen. Als nächste Story ist `US-017` im Backlog geplant.)*

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

Sämtliche für **Version 1.0.0** und **Version 1.1.0** abgeschlossenen User Stories (`US-001` bis `US-016` sowie `US-018` bis `US-026`), Tasks (`T-001` bis `T-079`) und behobenen Bugs (`B-001` bis `B-004`) sind in der Release-Chronik (`docs/history.md`) erfasst:

👉 **[📜 Was bisher geschah – Release-Chronik (`docs/history.md`)](history.md)**

---

## 📖 Backlog

### Ziel-Release 1.2.0

| Story | Titel | Priorität | Geplante Tasks | Kurzbeschreibung |
| :--- | :--- | :--- | :--- | :--- |
| **[US-017](user_stories/US-017-post-10-schaltungs-bibliothek-und-verwaltung.md)** | Schaltungs-Bibliothek & Bibliotheksverwaltung | Niedrig | *(offen)* | Persistente Bibliothek wiederverwendbarer Schaltungen (Standard-ICs & eigene Bausteine) inkl. Metadaten, `.lcweb`- und `.CircuitProject`-Austausch (erfordert voraussichtlich Schemaerweiterung). |

### Post 1.2.0

| Story | Titel | Priorität | Geplante Tasks | Kurzbeschreibung |
| :--- | :--- | :--- | :--- | :--- |
| **[US-027](user_stories/US-027-integrierte-dokumentation-und-interaktive-hilfe.md)** | Umfassendes Benutzerhandbuch & interaktive Online-Hilfe (`F1`) | Mittel | *(offen)* | Eigener Vite-Entry-Point (`help.html`) mit `F1`-Kontext-Shortcut, Menüeintrag, Editor-/Bauteil-Handbuch, Schaltungs-Tutorials, interaktivem Wahrheitstabellen-Filter-Playground und MCP-Setup-/Prompt-Beispielen. |

---

## 🐛 Gemeldete Bugs & Fehlertracking

> 📚 Alle bis Version 1.1.0 behobenen Bugs (`B-001` bis `B-004`) sind in **[`docs/history.md`](history.md)** dokumentiert. Aktuell liegen keine offenen Fehlerberichte vor.

---

> 💡 **Hinweis zur Pflege:**
> - **Tasks:** Werden nach dem Schema `[T-XXX: Titel]` gepflegt (Vorlagen in [`docs/tasks/`](tasks/)).
> - **Bugs:** Größere Bugs werden dokumentiert (Vorlagen in [`docs/bugs/`](bugs/)); direkte Review-Fixes werden ohne Task-Overhead direkt behoben.
> - **Status-Spalten & Task-Icons:**
>   - 📋 `To Do` (Offen / Geplant)
>   - 🟡 `Progress` (In aktiver Bearbeitung)
>   - 🔍 `Review` (Implementiert, wartet auf Abnahme)
>   - ❌ `Rejected` (Abgelehnt / Nacharbeit erforderlich)
>   - ✅ `Done` (Erfolgreich abgenommen & abgeschlossen)
