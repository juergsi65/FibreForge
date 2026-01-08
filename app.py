import os
from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_bcrypt import Bcrypt
from models import db, User, Area, Entry
from shapely.geometry import Point, shape
import json

app = Flask(__name__)
app.config['SECRET_KEY'] = 'lokal_geheim'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'

db.init_app(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- Logik: Welches Gebiet ist hier? ---
def find_area_at_pos(lat, lng):
    point = Point(lng, lat)
    for area in Area.query.all():
        if area.geojson_border:
            polygon = shape(json.loads(area.geojson_border))
            if polygon.contains(point):
                return area
    return None

# --- Route: Karte anzeigen ---
@app.route('/')
@login_required
def index():
    return render_template('index.html')

# --- API: Punkt speichern ---
@app.route('/api/save_point', methods=['POST'])
@login_required
def save_point():
    data = request.json
    lat, lng = data['lat'], data['lng']
    
    area = find_area_at_pos(lat, lng)
    if not area:
        return jsonify({"status": "error", "message": "Punkt liegt in keinem Gebiet!"})
    
    # Nächste Nummer finden (z.B. K_ADLW005)
    last_entry = Entry.query.filter(Entry.nr.like(f"K_{area.kuerzel}%")).order_by(Entry.id.desc()).first()
    next_num = 1 if not last_entry else int(last_entry.nr[-3:]) + 1
    new_nr = f"K_{area.kuerzel}{next_num:03d}"
    
    new_entry = Entry(nr=new_nr, typ="Kasten", lat=lat, lng=lng, area_id=area.id)
    db.session.add(new_entry)
    db.session.commit()
    
    return jsonify({"status": "success", "nr": new_nr})

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
