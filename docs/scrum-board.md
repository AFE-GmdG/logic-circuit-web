# 💻 Logic Circuit Web Scrum- & Kanban-Board

**Workflow:** Kontinuierlicher Flow (Feature-by-Feature ohne Sprint-Zeitdruck)  
**Fokus:** Portierung und Weiterentwicklung von Logic Circuit als performante, browserbasierte Webanwendung mit TypeScript, React, Vite und Emotion.

---

## 🚀 Aktive User Story

*Aktuell ist keine User Story aktiv — Version 1.0.0 ist abgeschlossen. Nächste Story bei Bedarf aus der Post-1.0 Roadmap wählen.*

```mermaid
kanban
  Todo[To Do]
  Progress[Progress]
  Review[Review]
  Rejected[Rejected]
  Done[Done]
```

---

## ✅ Abgeschlossene User Stories (Release 1.0)

Sämtliche für **Version 1.0.0** abgeschlossenen User Stories (`US-001` bis `US-015` sowie `US-018` bis `US-023`), Tasks (`T-001` bis `T-067`) und behobenen Bugs (`B-001`, `B-003`, `B-004`) sind in der ausgelagerten Chronik zusammengefasst:

👉 **[📜 Was bisher geschah – Chronik zu Release 1.0 (`docs/history-1.0.md`)](history-1.0.md)**

---

## 📖 Backlog

*Für Version 1.0 sind alle geplanten User Stories abgeschlossen.*

---

## 🔭 Post-1.0 Roadmap (Zurückgestellt)

| Story | Titel | Priorität | Kurzbeschreibung |
| :--- | :--- | :--- | :--- |
| **[US-016](user_stories/US-016-post-10-analyse-und-export-werkzeuge.md)** | Post-1.0 Analyse- & Export-Werkzeuge | Niedrig | Wahrheitstabelle (`DialogTruthTable` inkl. `validators`), Oszilloskop (`DialogOscilloscope`), Verwendungsnachweis (`DialogUsage`), Schaltungsbericht (`DialogReport`) und HDL-Export (Verilog/VHDL). |
| **[US-017](user_stories/US-017-post-10-schaltungs-bibliothek-und-verwaltung.md)** | Post-1.0 Schaltungs-Bibliothek & Bibliotheksverwaltung | Niedrig | Aufbau und Verwaltung einer persistenten Bibliothek wiederverwendbarer Schaltungen (Standard-ICs & eigene Bausteine) zur direkten Übernahme in laufende Projekte inkl. `.lcweb`- und `.CircuitProject`-Austausch. |

---

## 🐛 Gemeldete Bugs & Fehlertracking

> 📚 Alle in Version 1.0 behobenen Bugs (`B-001`, `B-003`, `B-004`) sind in **[`docs/history-1.0.md`](history-1.0.md)** dokumentiert.

| Bug | Titel | Priorität | Status | Kurzbeschreibung |
| :--- | :--- | :--- | :--- | :--- |
| **[B-002](bugs/B-002-copy-web-paste-desktop-ignoriert.md)** | Copy (Web) → Paste (Desktop) wird ignoriert | Mittel | 📋 Offen | Auswahl per `Strg+C` / Menü (*Für Desktop kopieren (XML)*) aus der WebApp wird beim Einfügen (`Strg+V`) in LogicCircuit Desktop (`2.26.9.1`) weiterhin ignoriert, während Desktop → Web (`utf-16` / Default-Namespace ohne Präfix) und Web ↔ Web funktionieren. |

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
