# T-068: DSGVO-Dialog ohne Betreiberangaben (GitHub Pages) bereinigen

[← Zurück zum Scrum-Board](../scrum-board.md)

**Status:** Done  
**Typ:** UI  
**Zugehörige User Story:** [US-024](../user_stories/US-024-dsgvo-github-pages-und-passive-wheel-zoom-fix.md)  

## Ziel
Der `PrivacyDialog` soll bei nicht gesetzten Betreiber-Umgebungsvariablen (`PRIVACY_*`, z. B. im statischen GitHub-Pages-Build) keine technischen Variablennamen als Platzhalter anzeigen und im MCP-freien Modus weder `/__mcp/privacy` abfragen noch den Remote-MCP-Hinweis darstellen.

## Betroffene Dateien
- `.github/workflows/deploy-pages.yml` (Betreiberangaben `PRIVACY_RESPONSIBLE_NAME` und `PRIVACY_CONTACT_EMAIL` für den GitHub-Pages-Build hinterlegen)
- `src/components/app/privacyDialog.tsx` (Neutraler Fallback ohne `PRIVACY_*`-Codes, Skip von `/__mcp/privacy` und Remote-MCP-Punkt bei `isMcpDisabledByEnv()`)
- `src/locales/de.json` (Bereinigte deutsche Texte `noOperatorBody` und `hostingStaticDefault`)
- `src/locales/en.json` (Bereinigte englische Texte `noOperatorBody` und `hostingStaticDefault`)
- `src/test/mainMenu.test.tsx` (Unit-Tests für neutralen Fallback und statischen `DISABLE_MCP`-Modus)

## Aufgaben
- Neutralen Endnutzer-Text (`dialog.privacy.noOperatorBody`) im `PrivacyDialog` anzeigen, wenn keine Betreiberangaben gesetzt sind.
- Im MCP-freien Modus (`isMcpDisabledByEnv()`) den Runtime-Fetch auf `/__mcp/privacy` überspringen, den Punkt *Remote-MCP (Opt-in)* ausblenden und `dialog.privacy.hostingStaticDefault` als Standard-Hosting-Hinweis verwenden.
- Unit-Tests in `src/test/mainMenu.test.tsx` anpassen und erweitern.

## Testkriterien
- Typecheck (`yarn errorcheck`), Linter (`yarn lint`) und Docs-Linter (`yarn lint-docs`) laufen fehlerfrei durch.
- Automatisierte Unit-Tests (`yarn test`) und Production Build (`yarn build` / `yarn build:pages`) laufen fehlerfrei durch.
