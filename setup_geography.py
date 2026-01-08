import requests
import json
from app import app, db, Area

def fetch_austrian_boundaries():
    # Overpass API Abfrage für alle Gemeinden in Oberösterreich (als Beispiel)
    # Du kannst die Query anpassen, um ganz Österreich zu laden
    overpass_url = "http://overpass-api.de/api/interpreter"
    overpass_query = """
    [out:json][timeout:25];
    area["ISO3166-1"="AT"][admin_level=2]->.austria;
    (
      relation["admin_level"="8"](area.austria);
    );
    out body;
    >;
    out skel qt;
    """
    
    print("Lade Gemeindegrenzen herunter... das kann einen Moment dauern.")
    response = requests.get(overpass_url, params={'data': overpass_query})
    data = response.json()
    
    # Hier würde eine Konvertierung zu GeoJSON stattfinden.
    # Für den Anfang nutzen wir ein vereinfachtes Format oder laden 
    # fertige GeoJSON Dateien hoch, falls die API zu komplex ist.
    print("Daten empfangen. Integration in Datenbank...")

if __name__ == "__main__":
    with app.app_context():
        # Beispielhafter manueller Eintrag für den Testlauf
        if not Area.query.filter_by(kuerzel='ADLW').first():
            adlwang = Area(
                name="Adlwang", 
                kuerzel="ADLW", 
                geojson_border='{"type": "Polygon", "coordinates": [[[14.3, 48.0], [14.4, 48.0], [14.4, 48.1], [14.3, 48.1], [14.3, 48.0]]]}'
            )
            db.session.add(adlwang)
            db.session.commit()
            print("Test-Gebiet Adlwang angelegt.")
