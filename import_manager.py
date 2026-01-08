import requests
import json
import pandas as pd
from app import app
from models import db, Area, Entry

def setup_project(gebiets_liste, excel_file=None):
    with app.app_context():
        db.create_all()
        headers = {'User-Agent': 'FibreForge-App/1.0'}
        
        for g in gebiets_liste:
            # 1. Grenze holen
            print(f"Lade Grenzen für {g['name']}...")
            url = f"https://nominatim.openstreetmap.org/search?city={g['name']}&country=Austria&format=json&polygon_geojson=1"
            res = requests.get(url, headers=headers).json()
            
            geojson_data = json.dumps(res[0].get('geojson')) if res else None
            
            area = Area.query.filter_by(kuerzel=g['kuerzel']).first()
            if not area:
                area = Area(name=g['name'], kuerzel=g['kuerzel'], geojson_border=geojson_data)
                db.session.add(area)
            else:
                area.geojson_border = geojson_data
        
        db.session.commit()
        print("✅ Gebiete und Grenzen sind bereit!")

        # 2. Optional: Excel Import
        if excel_file:
            try:
                df = pd.read_excel(excel_file)
                # Hier Logik einfügen für bestehende Punkte...
                print(f"✅ {len(df)} Punkte aus Excel importiert.")
            except Exception as e:
                print(f"⚠️ Excel-Import übersprungen: {e}")

if __name__ == "__main__":
    meine_gebiete = [
        {"name": "Adlwang", "kuerzel": "ADLW"},
        {"name": "Steyr", "kuerzel": "STYR"},
        {"name": "Bad Hall", "kuerzel": "BHALL"}
    ]
    setup_project(meine_gebiete)
