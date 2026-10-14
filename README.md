# Solitaire

Eine minimalistische Solitaire-PWA auf Deutsch. TypeScript, SCSS und Vite – ohne UI-Framework, externe Schriften, Sounds, Werbung oder Backend.

**App:** [paranerd.github.io/solitaire](https://paranerd.github.io/solitaire/)

## Spielen

- Classic/Klondike mit 1 oder 3 gezogenen Karten und unbegrenzten Talon-Durchgängen
- FreeCell mit vier freien Zellen und regelkonformen Sequenzbewegungen
- Spider mit 1, 2 oder 4 Farben
- Ziehen, Antippen zum Auswählen/Ablegen, Tastatur und Doppelklick auf passende Ablagen
- Rückgängig, Zughinweise und automatisches Fertigspielen von nachweislich gewonnenen Positionen
- Automatische Speicherung jeder Variante, lokale Statistik und optionale Zeit-, Zug- und Punkteanzeige
- Automatisches helles/dunkles Farbschema, Kartenbewegungs- und Wendeanimationen, Berücksichtigung von reduzierter Bewegung
- Anpassung an Hoch- und Querformat; das Spielfeld scrollt nicht

Der Hamburger-Button links oben klappt die Aktionsbuttons nach unten aus. Sie bleiben bis zum erneuten Klick geöffnet. Das Plus öffnet die Spielauswahl, das Zahnrad die Einstellungen und das Balkensymbol die Statistik. `H` zeigt einen Hinweis, `N` die Spielauswahl, `Strg/⌘ Z` macht einen Zug rückgängig. `Tab`, Pfeiltasten und `Enter` bedienen das Spielfeld. `Escape` hebt die Auswahl auf.

## Lösbare Austeilungen

Jede neue Partie besitzt einen vollständigen legalen Lösungsweg. Die Generatoren erzeugen Austeilungen konstruktiv statt ungeprüft zu mischen:

- **Classic:** Kartenränge werden entlang einer zufällig verwobenen Reihenfolge aus Tableau-Aufdeckungen und Talon-Paketen vergeben. Auch die Reihenfolge innerhalb von 3er-Paketen wird berücksichtigt.
- **FreeCell:** Rückwärts aus den vier fertigen Ablagen, mit zusätzlichen rückwärts ausgeführten Tableau-Zügen. Jeder Schritt lässt sich nach den normalen Regeln umkehren.
- **Spider:** Acht vollständige Sequenzen werden rückwärts zerlegt. Fünf offene Reihen werden zum Vorrat. Der Lösungsweg berücksichtigt verdeckte Karten, Aufdecken und automatische Sequenzablage.

Diese Austeilungen sind nicht gleichverteilt zufällig und können leichter als frei gemischte Spiele sein. Die Garantie gilt für die Ausgangsposition; eigene Züge können Sackgassen erzeugen. Rückgängig erlaubt die Rückkehr. Solange man dem gespeicherten Weg folgt, zeigt der Hinweis den nächsten Lösungsschritt. Nach einer Abweichung zeigt er einen legalen Zug ohne Lösbarkeitsgarantie. Automatisches Fertigspielen prüft die gesamte verbleibende Partie vor dem Anzeigen des Buttons. Spider legt vollständige Sequenzen automatisch ab.

`src/game.ts` enthält Regeln, Generatoren und die unabhängige Nachspielprüfung `verifyDeal`. Die Tests spielen 256 Seeds je Variante vollständig nach und prüfen zusätzlich die Kartenverteilung und relevante Regeln. Bei Änderungen am Generator muss die Speicher-Version erhöht oder eine Migration bereitgestellt werden, da gespeicherte Partien auf dem Seed und ihrer Zugfolge beruhen.

## Lokal entwickeln

Voraussetzung: Node.js 22 oder neuer.

```sh
npm ci
npm run dev
```

Öffne die ausgegebene Adresse unter `/solitaire/`. Der Service Worker ist in der Entwicklungsumgebung bewusst deaktiviert, damit Änderungen sofort sichtbar sind.

```sh
npm test
npm run build
npx playwright install chromium webkit firefox
npm run test:browser
npm run preview
```

Die Browserprüfungen laufen gegen den Produktionsbuild in Chromium, WebKit und Firefox. Sie prüfen alle Varianten bei vier Bildschirmgrößen, Antippen und Ziehen, Hinweise, Rückgängig, Speicherung, Einstellungen, Gewinnstatistik und echtes Neuladen ohne Netzwerk.

Die PNG-App-Icons sind eingecheckt. Nach einer Änderung an `public/icon.svg` lassen sie sich mit `node scripts/build-icons.mjs` neu erzeugen (benötigt Playwright Chromium).

## Offline und Installation

Die App einmal online öffnen, bis in den Einstellungen **Offline bereit** erscheint. Danach sind alle Spielarten, neue Partien, Hinweise und Speicherung vollständig offline verfügbar. Der Build erzeugt einen Service Worker, der sämtliche App-Dateien vorab speichert. Es werden keine Inhalte oder Spielstände von einem Server nachgeladen.

In unterstützten Browsern erscheint in den Einstellungen **App installieren**. Auf iPhone/iPad in Safari **Teilen → Zum Home-Bildschirm** verwenden. Installation ist für Offline-Nutzung nicht zwingend erforderlich. Updates werden ohne Unterbrechung einer offenen Partie aktiviert, sobald die alten App-Fenster geschlossen wurden. Der Offline-Modus benötigt HTTPS oder localhost.

Spielstände und Statistik liegen im lokalen Browserspeicher dieses Geräts. Browserdaten löschen entfernt auch diese Daten. Es gibt keine Synchronisierung zwischen Geräten. Zeit läuft ab dem ersten Zug und pausiert bei geöffneten Dialogen und im Hintergrund. Neustarts gestarteter, ungewonnener Partien unterbrechen die Siegesserie.

## GitHub Pages

Vite-Basispfad, Manifest und Service-Worker-Scope sind auf `/solitaire/` eingerichtet. In den Repository-Einstellungen unter **Pages → Build and deployment → Source** muss **GitHub Actions** gewählt sein.

`.github/workflows/deploy.yml` prüft bei einem Push auf `main` die Regeln, baut die PWA, prüft sie in drei Browser-Engines und veröffentlicht `dist/` auf GitHub Pages. Ein fehlgeschlagener Test verhindert das Deployment.

Referenzen: [Vite: GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages), [MDN: Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
