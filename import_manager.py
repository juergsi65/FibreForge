import requests
import json
import pandas as pd
import os
from app import app, bcrypt
from models import db, Area, Entry, User

def run_setup():
    with app.app_context():
        # 1. Datenbank Tabellen erstellen
        print("--- Schritt 1: Datenbank initialisieren ---")
        db.create_all()

        # 2. Test-Admin erstellen (falls nicht vorhanden)
        if not User.query.filter_by(username="admin").first():
            hashed_pw = bcrypt.generate_password_hash("admin123").decode('utf-8')
            admin_user = User(username="admin", password=hashed_pw, is_admin=True, is_active=True)
            db.session.add(admin_user)
            print("✅ Admin-User erstellt (Login: admin / PW: admin123)")

        # 3. Gebiete und Grenzen automatisch laden
        print("\n--- Schritt 2: Grenzen laden (OSM) ---")
        gebiets_liste = [
            {"name": "Adlwang", "kuerzel": "ADLW"},
            {"name": "Steyr", "kuerzel": "STYR"},
            {"name": "Bad Hall", "kuerzel": "BHALL"}
        ]
        
        headers = {'User-Agent': 'FibreForge-App/1.0'}
        for g in gebiets_liste:
            area = Area.query.filter_by(kuerzel=g['kuerzel']).first()
            if not area or not area.geojson_border:
                url = f"https://nominatim.openstreetmap.org/search?city={g['name']}&country=Austria&format=json&polygon_geojson=1"
                try:
                    res = requests.get(url, headers=headers).json()
                    if res:
                        geojson_data = json.dumps(res[0].get('geojson'))
                        if not area:
                            area = Area(name=g['name'], kuerzel=g['kuerzel'], geojson_border=geojson_data)
                            db.session.add(area)
                        else:
                            area.geojson_border = geojson_data
                        print(f"✅ Grenzen für {g['name']} geladen.")
                except Exception as e:
                    print(f"❌ Fehler bei {g['name']}: {e}")
        
        db.session.commit()

        # 4. Excel-Daten importieren (.xlsm)
        print("\n--- Schritt 3: Excel-Import ---")
        excel_path = 'daten.xlsm' # Deine Datei muss so heißen!
        if os.path.exists(excel_path):
            try:
                # Liest das erste Tabellenblatt der Makro-Datei
                df = pd.read_excel(excel_path, engine='openpyxl')
                
                # Wir suchen die Spalten (Groß/Kleinschreibung egal)
                df.columns = [c.lower() for c in df.columns]
                
                # Mapping der Spalten - Hier eventuell Namen anpassen!
                lat_col = 'breitengrad' if 'breitengrad' in df.columns else 'lat'
                lng_col = 'längengrad' if 'längengrad' in df.columns else 'lng'
                nr_col = 'nummer' if 'nummer' in df.columns else 'id'

                for _, row in df.iterrows():
                    if not Entry.query.filter_by(nr=str(row[nr_col])).first():
                        # Wir ordnen den Punkt dem richtigen Gebiet zu
                        # (Logik wird beim ersten Klick in der App deutlicher)
                        new_entry = Entry(
                            nr=str(row[nr_col]),
                            lat=float(row[lat_col]),
                            lng=float(row[lng_col]),
                            area_id=1 # Standardzuordnung zum ersten Gebiet
                        )
                        db.session.add(new_entry)
                
                db.session.commit()
                print(f"✅ Excel-Daten erfolgreich importiert.")
            except Exception as e:
                print(f"⚠️ Excel-Fehler: {e}. (Stimmen die Spaltennamen?)")
        else:
            print(f"ℹ️ Keine '{excel_path}' gefunden. Überspringe Import.")

        print("\n--- Setup abgeschlossen! Starte jetzt 'python app.py' ---")

if __name__ == "__main__":
    run_setup()
