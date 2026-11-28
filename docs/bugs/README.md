# Bug-Tracking & Problemverfolgung (Logic Circuit Web)

[← Zurück zum Scrum-Board](../scrum-board.md)

In diesem Verzeichnis werden Fehlerberichte und Incident-Analysen nach folgendem Namensschema abgelegt:

`B-XXX-<kurzbeschreibung>.md`

## Erfasste Bugs

- ✅ [B-008: Leere Beschriftung bei Schaltungen und Pins erzwingt Namens-Fallback statt Ausblenden](B-008-leere-beschriftung-fuer-schaltungen-und-pins-ausblenden.md) *(Geschlossen – Niedrig)*
- ✅ [B-007: Bibliothek „Metadaten bearbeiten“ lädt und speichert Schaltungseigenschaften unvollständig](B-007-bibliothek-metadaten-dialog-laedt-und-speichert-unvollstaendig.md) *(Geschlossen – Mittel)*
- ✅ [B-006: Subschaltungs-Vorschau in Seitenleiste & Drag-Vorschau sowie störendes Browser-DragImage](B-006-schaltungs-vorschau-seitenleiste-drag-und-browser-dragimage.md) *(Geschlossen – Niedrig)*
- ✅ [B-005: Paletten-Kategorien kollidieren bei Namensgleichheit mit festen Kategorien](B-005-paletten-kategorien-kollision-bei-namensgleichheit.md) *(Geschlossen – Niedrig)*

> 📚 Alle bis Version 1.1.0 behobenen Fehlerberichte (`B-001` bis `B-004`) sind in der Chronik **[Was bisher geschah – Release-Chronik](../history.md)** dokumentiert.

## Vorlage für Bug-Reports

```markdown
# B-XXX: [Kurztitel des Fehlers]

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Offen | In Bearbeitung | Behoben | Geschlossen  
**Schweregrad:** Kritisch | Hoch | Mittel | Niedrig  
**Betroffene Komponenten:** z. B. SimulationEngine, CircuitCanvas, WireRouter  

## Fehlerbeschreibung
Präzise Beschreibung des Fehlverhaltens oder der unerwarteten Fehlermeldung.

## Schritte zur Reproduktion
- Schritt A
- Schritt B
- Beobachtetes Verhalten vs. erwartetes Verhalten

## Fehleranalyse & Ursache
Technische Ursachenforschung (z. B. Gatter-Timing, Oszillationserkennung, SVG-Rendern).

## Behebung & Verifikation
- [ ] Durchgeführte Code-Änderungen
- [ ] Verifikation mit `yarn errorcheck` & `yarn lint`
- [ ] Test im Browser
```
