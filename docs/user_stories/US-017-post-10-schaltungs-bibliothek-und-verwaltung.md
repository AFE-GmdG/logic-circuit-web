# US-017: Schaltungs-Bibliothek & Bibliotheksverwaltung

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Geplant  
**Ziel-Release:** 1.2.0  
**Priorität:** Niedrig  

## Beschreibung
Als Schaltungsentwickler möchte ich auf eine zentrale Bibliothek wiederverwendbarer Schaltungen (z. B. Standard-Flipflops, Register, Addierer, Multiplexer, Dekoder sowie selbst erstellte Bausteine) zugreifen, Bausteine daraus direkt in mein aktuelles Projekt übernehmen und meine eigene Schaltungs-Bibliothek verwalten können, um komplexe Projekte schneller und modularer aufzubauen. (Hinweis: Erfordert voraussichtlich eine Erweiterung des nativen `.lcweb`- bzw. Bibliotheks-Schemas und ist daher für Release **1.2.0** vorgesehen.)

## Akzeptanzkriterien
- **Bibliotheks-Katalog & Übernahme ins Projekt:**
  - Durchsuchbare und nach Kategorien gegliederte Bibliothek mit integrierten Standard-Bausteinen sowie nutzereigenen Schaltungen (inkl. Symbolvorschau, Beschreibung und Pin-Übersicht).
  - Übernahme einer ausgewählten Schaltung (samt abhängiger Sub-Schaltungen und automatischer ID-/Namenskonflikt-Auflösung) in das aktuell geöffnete `CircuitProject`.
- **Verwaltung eigener Bibliotheks-Schaltungen:**
  - Speichern beliebiger `LogicalCircuit`s (inkl. ihrer Sub-Hierarchie) aus dem aktuellen Projekt in die persistente Benutzer-Bibliothek (`IndexedDB` / `localStorage`).
  - Bearbeiten von Metadaten (Name, Kategorie, Beschreibung/Tags), Umbenennen und Löschen von Einträgen aus der Bibliothek.
  - Import und Export einzelner Bibliotheken bzw. Pakete im nativen `.lcweb`-Format sowie im `.CircuitProject`-XML-Format zum Austausch mit anderen Nutzern.

## Zugeordnete Tasks
- *(Werden bei Aufnahme in die aktive Bearbeitung für 1.2.0 detailliert geschnitten)*
