import pandas as pd
from app import app, db, Entry, Area

def import_from_excel(file_path):
    with app.app_context():
        # Lädt alle Blätter
        excel_data = pd.read_excel(file_path, sheet_name=None)
        
        for sheet_name, df in excel_data.items():
            # Blattname ist oft das Kürzel (z.B. ADLW)
            kuerzel = str(sheet_name).upper()
            
            # Gebiet in DB anlegen falls nicht vorhanden
            area = Area.query.filter_by(kuerzel=kuerzel).first()
            if not area:
                area = Area(name=kuerzel, kuerzel=kuerzel)
                db.session.add(area)
                db.session.commit()

            for _, row in df.iterrows():
                # Check ob Nummer (K_ADLW001) existiert
                if not Entry.query.filter_by(nummer=row['Nummer']).first():
                    new_entry = Entry(
                        nummer=row['Nummer'],
                        to_nummer=row['TO-Nummer'],
                        bauleiter=row['Bauleiter'],
                        datum_uhrzeit=pd.to_datetime(row['Datum/Uhrzeit']),
                        typ='Kasten' if 'K_' in str(row['Nummer']) else 'Schacht',
                        area_id=area.id
                    )
                    db.session.add(new_entry)
        
        db.session.commit()
        print("Import abgeschlossen!")

# Dieses Skript kannst du lokal ausführen: python import_data.py
