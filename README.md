# FibreForge

Nummernverwaltung für Kästen und Schächte mit Karte, Verbänden (Rohre/Kabel), Labels und Exporten.
Die Logik stammt aus der bisherigen HTML-/Excel-Lösung (`Neue_Nummern_Labels_sauber.html` + `Neuanlage_Nummern.xlsx`).
Statt in einer lokalen Excel-Datei liegen die Daten jetzt zentral in einer Datenbank, und mehrere Personen können gleichzeitig arbeiten.

Läuft als **Cloudflare Worker** mit **D1**-Datenbank: https://fibreforge.juergsi65.workers.dev

## Funktionen

- **Nummern erzeugen:** Gebiet (Gemeinde OÖ bzw. bei Linz die KG), Bauleiter, TO-Nummer und Anzahl wählen. Vergeben wird die niedrigste freie Nummer im Format `KÜRZEL001` (z. B. `RAIN026`).
- **Standort setzen:** Zeile wählen, dann in die Karte klicken. Optional springt die Auswahl automatisch zur nächsten Nummer ohne Standort.
- **Bearbeiten:** Nummer, TO, Bauleiter, Datum, Info, Koordinaten und Google-Maps-Link ändern.
- **Verbände:** Abgehende Rohre (mit Ziel oder offen) und ankommende Rohre im Detailfenster anlegen, mit Hervorhebung auf der Karte.
- **Exporte:**
  - Excel, ein Blatt je Gebiet
  - Bauleiter-PDF
  - Verband-PDF (Beschriftungsauftrag)
  - Labels für Brother P-touch (62×29, 29×90, 38×90 mm), für Kästen und mit QR-Code für Verbände
- **Mailtext kopieren:** Alle Nummern zu TO und Bauleiter.
- **Adresssuche** (Photon/OpenStreetMap) und Satellitenansicht.
- **Benutzer:** Login statt gemeinsamem Passwort. Der erste registrierte Benutzer wird Admin, weitere schaltet der Admin frei, mit Recht „Bearbeiten“ oder „Nur lesen“.

## Admin-Bereich

- Benutzer freischalten, sperren, auf „Nur lesen“ setzen, zu Admins machen
- Gebiete und Bauleiter pflegen
- **Excel-Mappe importieren:** Die bisherige `Neuanlage_Nummern.xlsx` auswählen. Übernommen werden:
  - die Blätter `Gemeinden OÖ`, `Linz KGs` und `Projektleiter`
  - alle Kürzel-Blätter (Zelle A1 = `Nummer`), inklusive Standorten, Info und Verbänden

  Den Import kann man gefahrlos wiederholen.
- **Sicherung:** Alle Daten als Excel-Mappe im bisherigen Format herunterladen

## Projektstruktur

```
src/index.ts         Server: Login, API (Nummern, Verbände), Admin, Import
src/auth.ts          Passwort-Hashing (PBKDF2) und Sessions
src/views.ts         HTML-Seiten (Login, Admin, Hauptansicht)
src/app-markup.ts    Markup der Hauptansicht (aus der HTML-Vorlage)
public/app.js        Hauptansicht im Browser (Logik aus der HTML-Vorlage)
public/app.css       Styles der Hauptansicht
public/admin.js      Excel-Import und Sicherung
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

Dann http://localhost:8787 öffnen, registrieren (wird Admin) und im Admin-Bereich die Excel-Mappe importieren.

## Deployment

Cloudflare baut jeden Push auf `main` automatisch (Workers Builds). Die Datenbank `fibreforge-db` ist in `wrangler.jsonc` eingetragen.

Bei neuen Dateien in `migrations/` müssen die Migrationen auf der Cloudflare-Datenbank laufen:

```bash
npm run db:migrate:remote
```

Manuell deployen inklusive Migrationen:

```bash
npm run deploy
```
