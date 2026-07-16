# FibreForge

## Gemeinde- und Katastralgemeindegrenzen (Österreich)

Amtliche Grenzdaten stammen aus der BEV-Quelle **"Verwaltungsgrenzen (VGD)"**
(Bundesamt für Eich- und Vermessungswesen), veröffentlicht quartalsweise auf
[data.gv.at](https://www.data.gv.at/katalog/dataset?tags=Verwaltungsgrenzen)
bzw. [data.bev.gv.at](https://data.bev.gv.at/), Lizenz CC BY 4.0. Enthalten
sind u.a. die Shapefile-Layer für Gemeindegrenzen und
Katastralgemeindegrenzen (parzellenscharf aus der Digitalen Katastralmappe).

Die genaue Download-URL wechselt mit jedem Stichtag und muss daher jeweils
aktuell auf data.gv.at nachgeschlagen werden - sie ist bewusst nicht im Code
hinterlegt.

### 1. Spaltennamen prüfen

Das BEV-Attributschema (Name-/Code-Felder je Layer) kann sich ändern. Vor dem
ersten Import bzw. nach jedem Formatwechsel:

```bash
python setup_geography.py fields --source <url_oder_pfad_zum_zip> --name-contains gemeinde
python setup_geography.py fields --source <url_oder_pfad_zum_zip> --name-contains kg
```

Das zeigt CRS, Anzahl Objekte und alle Spaltennamen der jeweiligen
Shapefile-Schicht.

### 2. Import

```bash
python setup_geography.py import-gemeinden \
    --source <url_oder_pfad_zum_zip> \
    --name-contains gemeinde \
    --name-field NAME --code-field GKZ

python setup_geography.py import-kg \
    --source <url_oder_pfad_zum_zip> \
    --name-contains kg \
    --name-field NAME --code-field KG_NR --gemeinde-code-field GKZ
```

Die Grenzen landen in den Tabellen `Gemeindegrenze` bzw. `Katastralgemeinde`
(Modelle in `models.py`), unabhängig von den manuell angelegten
Service-Gebieten in `Area`. Koordinaten werden automatisch nach WGS84
(EPSG:4326) umgerechnet, unabhängig vom Quell-Koordinatensystem des BEV-Pakets.

### Caching

Downloads werden unter `cache/boundaries/` gecacht (Standard: 90 Tage,
passend zum quartalsweisen BEV-Update-Rhythmus) - wiederholte Aufrufe laden
nicht bei jedem Lauf neu. Optionen:

- `--cache-dir <pfad>` - anderer Cache-Ort
- `--max-age-days <n>` - Cache-Gültigkeit anpassen
- `--force-refresh` - Cache ignorieren und neu laden

Ein lokaler Pfad statt einer URL (z.B. eine bereits heruntergeladene .zip)
wird ohne Netzwerkzugriff direkt verwendet.
