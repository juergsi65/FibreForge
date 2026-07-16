"""
CLI zum Laden aller Gemeinde- und Katastralgemeindegrenzen Österreichs aus der
amtlichen BEV-Quelle "Verwaltungsgrenzen (VGD)" (https://www.data.gv.at,
Organisation BEV) in die Tabellen Gemeindegrenze / Katastralgemeinde.

Schritt 1 - Feldnamen bestimmen (einmalig, nach jedem BEV-Datenformat-Wechsel):
    python setup_geography.py fields --source <pfad_oder_zip_url> --name-contains gemeinde

Schritt 2 - Import:
    python setup_geography.py import-gemeinden \\
        --source <url_oder_pfad_zum_zip> \\
        --name-field NAME --code-field GKZ

    python setup_geography.py import-kg \\
        --source <url_oder_pfad_zum_zip> \\
        --name-field NAME --code-field KG_NR --gemeinde-code-field GKZ

Die Quelle wird lokal unter cache/boundaries/ gecacht (Standard: 90 Tage,
passend zum quartalsweisen BEV-Update-Rhythmus) - erneuter Aufruf lädt also
nicht bei jedem Lauf neu herunter. Mit --force-refresh wird der Cache
ignoriert und neu geladen.
"""
import argparse
import json

from app import app, db
from models import Gemeindegrenze, Katastralgemeinde
from boundaries import (
    DEFAULT_CACHE_DIR,
    fetch_boundary_source,
    list_layer_fields,
    load_boundaries_as_geojson,
)


def cmd_fields(args):
    resolved = fetch_boundary_source(args.source, "inspect", args.cache_dir, args.max_age_days, args.force_refresh)
    list_layer_fields(resolved, name_contains=args.name_contains)


def cmd_import_gemeinden(args):
    resolved = fetch_boundary_source(args.source, "gemeinden", args.cache_dir, args.max_age_days, args.force_refresh)
    features = load_boundaries_as_geojson(
        resolved, args.name_field, args.code_field, name_contains=args.name_contains
    )

    created, updated = 0, 0
    with app.app_context():
        for feature in features:
            gemeinde = Gemeindegrenze.query.filter_by(gkz=feature["code"]).first()
            if gemeinde is None:
                gemeinde = Gemeindegrenze(name=feature["name"], gkz=feature["code"])
                db.session.add(gemeinde)
                created += 1
            else:
                gemeinde.name = feature["name"]
                updated += 1
            gemeinde.geojson_border = json.dumps(feature["geojson"])
        db.session.commit()
    print(f"Gemeindegrenzen: {created} neu, {updated} aktualisiert (insgesamt {len(features)}).")


def cmd_import_kg(args):
    resolved = fetch_boundary_source(args.source, "katastralgemeinden", args.cache_dir, args.max_age_days, args.force_refresh)
    extra_fields = [args.gemeinde_code_field] if args.gemeinde_code_field else []
    features = load_boundaries_as_geojson(
        resolved, args.name_field, args.code_field, name_contains=args.name_contains, extra_fields=extra_fields
    )

    created, updated, linked = 0, 0, 0
    with app.app_context():
        for feature in features:
            kg = Katastralgemeinde.query.filter_by(kg_nummer=feature["code"]).first()
            if kg is None:
                kg = Katastralgemeinde(name=feature["name"], kg_nummer=feature["code"])
                db.session.add(kg)
                created += 1
            else:
                kg.name = feature["name"]
                updated += 1
            kg.geojson_border = json.dumps(feature["geojson"])

            if args.gemeinde_code_field:
                gkz = feature.get(args.gemeinde_code_field)
                gemeinde = Gemeindegrenze.query.filter_by(gkz=gkz).first() if gkz else None
                if gemeinde:
                    kg.gemeinde_id = gemeinde.id
                    linked += 1
        db.session.commit()
    print(f"Katastralgemeinden: {created} neu, {updated} aktualisiert, {linked} mit Gemeinde verknüpft (insgesamt {len(features)}).")


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--source", required=True, help="URL oder lokaler Pfad zum BEV-Shapefile-ZIP")
    common.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR, help="Cache-Verzeichnis für Downloads")
    common.add_argument("--max-age-days", type=int, default=90, help="Cache-Gültigkeit in Tagen (Standard: 90)")
    common.add_argument("--force-refresh", action="store_true", help="Cache ignorieren und neu laden")
    common.add_argument("--name-contains", default=None, help="Substring zur Auswahl der .shp-Datei, falls die Quelle mehrere enthält")

    sub = parser.add_subparsers(dest="command", required=True)

    p_fields = sub.add_parser("fields", parents=[common], help="Spaltennamen einer Quelle anzeigen")
    p_fields.set_defaults(func=cmd_fields)

    p_gem = sub.add_parser("import-gemeinden", parents=[common], help="Gemeindegrenzen importieren")
    p_gem.add_argument("--name-field", required=True, help="Spaltenname für den Gemeindenamen")
    p_gem.add_argument("--code-field", required=True, help="Spaltenname für die Gemeindekennzahl (GKZ)")
    p_gem.set_defaults(func=cmd_import_gemeinden)

    p_kg = sub.add_parser("import-kg", parents=[common], help="Katastralgemeindegrenzen importieren")
    p_kg.add_argument("--name-field", required=True, help="Spaltenname für den Katastralgemeinde-Namen")
    p_kg.add_argument("--code-field", required=True, help="Spaltenname für die KG-Nummer")
    p_kg.add_argument("--gemeinde-code-field", default=None, help="Spaltenname der zugehörigen GKZ, um KG mit Gemeindegrenze zu verknüpfen (optional)")
    p_kg.set_defaults(func=cmd_import_kg)

    return parser


if __name__ == "__main__":
    args = build_parser().parse_args()
    with app.app_context():
        db.create_all()
    args.func(args)
