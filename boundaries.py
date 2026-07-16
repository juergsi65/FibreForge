"""
Laden, Cachen und Konvertieren amtlicher österreichischer Grenzdatensätze
(Gemeinden, Katastralgemeinden) aus der BEV-Quelle "Verwaltungsgrenzen (VGD)"
bzw. dem Kataster - Datensatz-Portal: https://www.data.gv.at (Organisation BEV).

Die BEV-Downloads sind Shapefile-ZIPs, die pro Quartal ("Stichtag") unter
wechselnden URLs veröffentlicht werden. Die aktuelle URL muss daher manuell
auf data.gv.at nachgeschlagen und hier übergeben werden - sie ist bewusst
nicht hartcodiert, weil sie sich regelmäßig ändert.

Nutzung:
    python setup_geography.py fields <pfad_oder_url>
        -> zeigt die Spaltennamen (Attribute) einer Quelle, um NAME/CODE-Felder
           zu bestimmen.
    python setup_geography.py import-gemeinden --source <url_oder_pfad> ...
    python setup_geography.py import-kg --source <url_oder_pfad> ...
"""
import os
import glob
import json
import shutil
import time
import zipfile

import geopandas as gpd
import requests

DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "boundaries")


def _cache_paths(cache_dir, key):
    zip_path = os.path.join(cache_dir, f"{key}.zip")
    meta_path = os.path.join(cache_dir, f"{key}.meta.json")
    extract_dir = os.path.join(cache_dir, key)
    return zip_path, meta_path, extract_dir


def _is_cache_fresh(meta_path, max_age_days):
    if not os.path.exists(meta_path):
        return False
    with open(meta_path) as f:
        meta = json.load(f)
    age_days = (time.time() - meta["downloaded_at"]) / 86400
    return age_days < max_age_days


def fetch_boundary_source(url_or_path, key, cache_dir=DEFAULT_CACHE_DIR, max_age_days=90, force_refresh=False):
    """
    Liefert einen lokalen Pfad zur Quelle. Bei einer http(s)-URL wird das ZIP
    heruntergeladen, entpackt und für `max_age_days` Tage gecacht (BEV
    veröffentlicht die Stichtagsdaten nur quartalsweise, tägliches Neuladen
    ist unnötig). Bei einem bereits lokalen Pfad (Ordner/.zip/.shp) wird
    direkt dieser zurückgegeben, ohne Netzwerkzugriff.
    """
    if not url_or_path.startswith(("http://", "https://")):
        return url_or_path

    os.makedirs(cache_dir, exist_ok=True)
    zip_path, meta_path, extract_dir = _cache_paths(cache_dir, key)

    if force_refresh or not _is_cache_fresh(meta_path, max_age_days):
        print(f"[{key}] Lade Quelle herunter: {url_or_path}")
        response = requests.get(url_or_path, timeout=180)
        response.raise_for_status()
        with open(zip_path, "wb") as f:
            f.write(response.content)

        if os.path.isdir(extract_dir):
            shutil.rmtree(extract_dir)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)

        with open(meta_path, "w") as f:
            json.dump({"source": url_or_path, "downloaded_at": time.time()}, f)
        print(f"[{key}] Cache aktualisiert unter {extract_dir}")
    else:
        print(f"[{key}] Verwende Cache ({extract_dir}), noch keine {max_age_days} Tage alt.")

    return extract_dir


def _ensure_extracted(path):
    """Entpackt ein lokales .zip einmalig in ein Geschwisterverzeichnis, damit
    einzelne Layer per Dateiname (statt über GDALs zip://-Layerauswahl,
    die bei mehreren Layern nicht zuverlässig filterbar ist) gefunden werden."""
    if not path.lower().endswith(".zip"):
        return path

    extract_dir = path[:-4] + "_extracted"
    if not os.path.isdir(extract_dir):
        with zipfile.ZipFile(path) as zf:
            zf.extractall(extract_dir)
    return extract_dir


def find_shapefile(path, name_contains=None):
    """
    Findet die passende .shp-Datei. `path` kann direkt eine .shp-Datei, ein
    Ordner mit mehreren Shapefiles (z.B. entpacktes BEV-VGD-Paket mit
    Gemeinde-, Bezirks- und KG-Grenzen nebeneinander) oder ein .zip sein.
    """
    if path.lower().endswith(".shp"):
        return path

    path = _ensure_extracted(path)

    candidates = sorted(glob.glob(os.path.join(path, "**", "*.shp"), recursive=True))
    if not candidates:
        raise FileNotFoundError(f"Keine .shp-Datei gefunden unter {path}")

    if name_contains:
        matches = [c for c in candidates if name_contains.lower() in os.path.basename(c).lower()]
        if matches:
            return matches[0]
        raise FileNotFoundError(
            f"Kein Shapefile mit '{name_contains}' im Dateinamen gefunden unter {path}. "
            f"Gefundene .shp-Dateien: {[os.path.basename(c) for c in candidates]}"
        )

    if len(candidates) > 1:
        raise ValueError(
            f"Mehrere Shapefiles gefunden, bitte name_contains angeben: "
            f"{[os.path.basename(c) for c in candidates]}"
        )
    return candidates[0]


def list_layer_fields(path, name_contains=None):
    """Hilfsfunktion für den Programmierer: zeigt CRS, Anzahl Objekte und Spaltennamen einer Quelle."""
    shp_path = find_shapefile(path, name_contains) if os.path.isdir(path) or path.lower().endswith((".zip",)) else path
    gdf = gpd.read_file(shp_path)
    print(f"Datei: {shp_path}")
    print(f"CRS: {gdf.crs}")
    print(f"Anzahl Objekte: {len(gdf)}")
    print(f"Felder: {list(gdf.columns)}")
    if len(gdf) > 0:
        print("Beispielzeile:")
        print(gdf.iloc[0])
    return list(gdf.columns)


def load_boundaries_as_geojson(path, name_field, code_field, name_contains=None, extra_fields=None):
    """
    Liest ein Shapefile ein, projiziert nach WGS84 (EPSG:4326, das von
    Leaflet erwartete Format) und liefert eine Liste von Dicts:
    {"name": ..., "code": ..., "geojson": <GeoJSON-Geometry>, **extra_fields}
    """
    shp_path = find_shapefile(path, name_contains) if os.path.isdir(path) or path.lower().endswith((".zip",)) else path
    gdf = gpd.read_file(shp_path)

    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    extra_fields = extra_fields or []
    results = []
    for _, row in gdf.iterrows():
        if row.geometry is None:
            continue
        entry = {
            "name": str(row[name_field]),
            "code": str(row[code_field]),
            "geojson": json.loads(json.dumps(row.geometry.__geo_interface__)),
        }
        for field in extra_fields:
            entry[field] = str(row[field]) if field in row else None
        results.append(entry)
    return results
