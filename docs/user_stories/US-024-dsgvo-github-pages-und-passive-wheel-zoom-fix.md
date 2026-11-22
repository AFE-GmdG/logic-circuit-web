# US-024: DSGVO-Dialog ohne Betreiberangaben (GitHub Pages) & Non-Passive Wheel-Zoom-Fix

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Abgeschlossen  
**Priorität:** Hoch  

## Beschreibung
Als Betreiber und Nutzer von Logic Circuit Web (insbesondere der statischen Live-Demo auf GitHub Pages) möchte ich, dass der Datenschutz-/DSGVO-Dialog bei nicht hinterlegten Betreiber-Umgebungsvariablen (`PRIVACY_*`) sauber ohne unvollständige Platzhalter dargestellt wird und das Zoom-Scrollen mit dem Mausrad auf dem Canvas keine Browser-Konsolenwarnung (`Unable to preventDefault inside passive event listener invocation.`) erzeugt, damit die Anwendung auf GitHub Pages rechtlich/optisch stimmig ist und fehlerfrei scrollt/zoomt. (Hinweis: Nach Umsetzung für einen gezielten Cherry-Pick auf `stable` / `1.0` vorgesehen).

## Akzeptanzkriterien
- **DSGVO-Dialog auf GitHub Pages / ohne gesetzte Verantwortlichen-Daten (`PRIVACY_*`):**
  - Prüfen und Anpassen der Darstellung im `PrivacyDialog`, wenn zur Build- bzw. Laufzeit keine verantwortliche Person (`PRIVACY_RESPONSIBLE_NAME`, `PRIVACY_RESPONSIBLE_ADDRESS`, `PRIVACY_CONTACT_EMAIL`) eingetragen ist (z. B. beim statischen GitHub-Pages-Build) – bzw. Bereitstellung passender Angaben/Darstellung für das GitHub-Pages-Deployment.
- **Mausrad-Zoom ohne `preventDefault`-Warnung in passiven Event-Listenern:**
  - Behebung der Browser-Warnung `Unable to preventDefault inside passive event listener invocation.` beim Zoomen per Mausrad (`wheel`-Event auf dem Canvas), indem der `wheel`-Listener explizit mit `{ passive: false }` am nativen DOM-Element registriert wird (statt über Reacts standardmäßig passiven `onWheel`-Synthetic-Handler).

## Zugeordnete Tasks
- [T-068: DSGVO-Dialog ohne Betreiberangaben (GitHub Pages) bereinigen](../tasks/T-068-dsgvo-dialog-ohne-betreiberangaben.md)
- [T-069: Non-Passive Wheel-Zoom-Listener auf dem Canvas](../tasks/T-069-non-passive-wheel-zoom-listener.md)
