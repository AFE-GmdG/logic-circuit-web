# Tasks & Arbeitspakete (Logic Circuit Web)

[← Zurück zum Scrum-Board](../scrum-board.md)

In diesem Verzeichnis werden technische Arbeitspakete zur Implementierung nach folgendem Namensschema abgelegt:

`T-XXX-<titel>.md`

## Vorlage für Tasks

```markdown
# T-XXX: [Titel des Tasks]

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** To Do | Progress | Review | Rejected | Done  
**Typ:** Setup | Architektur | UI | Engine | Logik  
**Zugehörige User Story:** [US-XXX](../user_stories/US-XXX-titel.md)  

## Ziel
Prägnante Beschreibung des technischen Ziels dieses Arbeitspakets.

## Betroffene Dateien
- `src/components/...` (Neue oder geänderte Datei: Kurzbeschreibung)
- `src/types/...` (Neue oder geänderte Datei: Kurzbeschreibung)

## Aufgaben
- Konkrete technische Teilaufgabe A (unter Beachtung der [Coding Rules](../coding-rules.md))
- Konkrete technische Teilaufgabe B

## Testkriterien
- Typecheck (`yarn errorcheck`) und Linter (`yarn lint`) laufen fehlerfrei durch.
- Automatisierte Unit-Tests (`yarn test`) und Production Build (`yarn build`) laufen fehlerfrei durch.
```

