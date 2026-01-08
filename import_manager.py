import requests
import json
import pandas as pd
import os
from app import app, bcrypt
from models import db, Area, Entry, User

def run_setup():
    with app.app_context():
        db.create_all()

        # 1. Admin erstellen
        if not User.query.filter_by(username="admin").first():
            hashed_pw = bcrypt.generate_password_hash("admin123").decode('utf-8')
            db.session.add(User(username="admin", password=hashed_pw, is_admin=True, is_active=True))
            print("✅ Admin 'admin' erstellt.")

        # 2. GEBIETE aus der CSV laden
        gebiets_csv = 'gebietsliste.csv' # Name deiner Gebiets-CSV
        if os.path.exists(gebiets_csv):
            # Wir lesen die CSV (trennung meist durch Komma oder Semikolon)
            df_geo = pd.read_csv(gebiets_csv, sep=None, engine='python') 
            print(f"--- Lade Grenzen für {len(df_geo)} Gebiete ---")
            
            headers = {'User-Agent': 'FibreForge-App/1.0'}
            for _, row in df_geo.iterrows():
                name = row['Name'] # Spaltenname in deiner CSV anpassen!
                kuerzel = row['Kuerzel']
                
                if not Area.query.filter_by(kuerzel=kuerzel).first():
                    url = f"https://nominatim.openstreetmap.org/search?city={name}&country=Austria&format=json&polygon_geojson=1"
                    res = requests.get(url, headers=headers).json()
                    geojson_data = json.dumps(res[0].get('geojson')) if res else None
                    
                    new_area = Area(name=name, kuerzel=kuerzel, geojson_border=geojson_data)
                    db.session.add(new_area)
                    print(f"✅ Gebiet {name} ({kuerzel}) angelegt.")
            db.session.commit()
        else:
            print(f"❌ {gebiets_csv} nicht gefunden!")

        # 3. BESTANDSDATEN aus der Makro-Excel (.xlsm) laden
        excel_path = 'bestandsliste.xlsm' # Name deiner Makro-Excel
        if os.path.exists(excel_path):
            try:
                df_points = pd.read_excel(excel_path, engine='openpyxl')
                print(f"--- Importiere Bestandsdaten aus Excel ---")
                
                for _, row in df_points.iterrows():
                    nr = str(row['Nummer']) # Spaltenname in Excel anpassen!
                    if not Entry.query.filter_by(nr=nr).first():
                        # Wir suchen das passende Gebiet anhand des Kürzels in der Nummer
                        # Extrahiert z.B. 'ADLW' aus 'K_ADLW001'
                        for area in Area.query.all():
                            if area.kuerzel in nr:
                                new_entry = Entry(
                                    nr=nr,
                                    lat=float(row['Breitengrad']), 
                                    lng=float(row['Längengrad']),
                                    area_id=area.id
                                )
                                db.session.add(new_entry)
                                break
                db.session.commit()
                print("✅ Bestand erfolgreich importiert.")
            except Exception as e:
                print(f"⚠️ Fehler beim Excel-Bestand: {e}")

if __name__ == "__main__":
    run_setup()
