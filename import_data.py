import pandas as pd
import json
from app import app
from models import db, Area, Entry

def import_from_excel(file_path):
    with app.app_context():
        # 1. Gebiete anlegen (Beispiel Adlwang)
        # Hier müsstest du später die echten GeoJSON-Grenzen einfügen
        adlw = Area.query.filter_by(kuerzel="ADLW").first()
        if not adlw:
            adlw = Area(name="Adlwang", kuerzel="ADLW", geojson_border='{"type": "Polygon", "coordinates": [[[14.1, 48.0], [14.2, 48.0], [14.2, 48.1], [14.1, 48.1], [14.1, 48.0]]]}')
            db.session.add(adlw)
            db.session.commit()
            print("Gebiet Adlwang erstellt.")

        # 2. Excel einlesen
        df = pd.read_excel(file_path)
        for index, row in df.iterrows():
            # Prüfen, ob Eintrag schon existiert
            if not Entry.query.filter_by(nr=row['Nummer']).first():
                new_entry = Entry(
                    nr=row['Nummer'],
                    typ=row.get('Typ', 'Kasten'),
                    lat=row['Breitengrad'],
                    lng=row['Längengrad'],
                    area_id=adlw.id
                )
                db.session.add(new_entry)
        
        db.session.commit()
        print(f"Import von {len(df)} Einträgen erfolgreich!")

if __name__ == "__main__":
    # Pfad zu deiner Excel-Datei anpassen
    import_from_excel('bestandsliste.xlsx')
