# FibreForge

Web-App zur Netzplanung: Kästen (`K_…`) und Schächte (`S_…`) per Klick auf der Karte anlegen. Jeder Punkt bekommt automatisch das Gebiet (Gemeinde), in dem er liegt, und eine fortlaufende Nummer wie `K_ADLW001`.

Läuft als **Cloudflare Worker** mit **D1**-Datenbank (SQLite).

## Funktionen

- Registrierung und Login. Der **erste** registrierte Benutzer wird automatisch Admin, alle weiteren müssen vom Admin freigeschaltet werden.
- Karte (Leaflet/OpenStreetMap) mit Gebietsgrenzen und allen Punkten. Benutzer sehen und bearbeiten nur ihre zugewiesenen Gebiete.
- Admin-Bereich:
  - Benutzer aktivieren, sperren, zu Admins machen, löschen, Gebiete per Kürzel zuweisen (`ADLW,LINZ`)
  - Gebiete anlegen. Die Gemeindegrenze wird automatisch von OpenStreetMap (Nominatim) geladen oder als GeoJSON eingefügt.
  - Import einer Gebietsliste (CSV/Excel mit Spalten `Name`, `Kuerzel`)
  - Import des Bestands (CSV/Excel inkl. `.xlsm`, Spalten `Nummer`, `Breitengrad`, `Längengrad`, optional `Typ`)
  - Export aller Punkte als CSV

Excel-Dateien werden im Browser gelesen. Nur die Daten werden hochgeladen, die Datei selbst nicht.

## Projektstruktur

```
src/index.ts         Routen (Login, Karte, API, Admin)
src/auth.ts          Passwort-Hashing (PBKDF2) und Sessions
src/geo.ts           Punkt-in-Polygon und Grenzen von OpenStreetMap
src/views.ts         HTML-Seiten
public/map.js        Karte im Browser
public/admin.js      Import im Browser
migrations/          Datenbankschema für D1
wrangler.jsonc       Cloudflare-Konfiguration
```

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

Dann http://localhost:8787 öffnen und als Erstes registrieren (wird Admin).

## Auf Cloudflare deployen

1. Bei Cloudflare anmelden:

   ```bash
   npx wrangler login
   ```

2. Die Datenbank `fibreforge-db` ist bereits angelegt und in `wrangler.jsonc` eingetragen.
   Nur bei einem neuen Cloudflare-Konto: `npx wrangler d1 create fibreforge-db` ausführen und die neue `database_id` eintragen.

3. Schema einspielen und deployen:

   ```bash
   npm run deploy
   ```

   Das führt die Migrationen auf der Cloudflare-Datenbank aus und veröffentlicht den Worker. Die URL (`https://fibreforge.<dein-account>.workers.dev`) steht am Ende der Ausgabe.

4. Seite öffnen und sofort den ersten Benutzer registrieren. Dieser wird Admin.

### Automatisch per GitHub deployen (optional)

Im Cloudflare-Dashboard unter *Workers & Pages → Create → Import a repository* dieses Repository verbinden.
Der Build läuft vom Branch `main`. Jeder Push auf `main` wird automatisch veröffentlicht.
Kommen später neue Dateien in `migrations/` dazu, als Deploy-Befehl `npm run deploy` eintragen (spielt die Migrationen vor dem Deploy ein).

## Einstellungen

In `wrangler.jsonc` unter `vars`:

| Variable            | Standard | Bedeutung                                         |
|---------------------|----------|---------------------------------------------------|
| `NOMINATIM_COUNTRY` | `at`     | Ländercode für die Suche nach Gemeindegrenzen     |
