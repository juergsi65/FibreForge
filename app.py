import os
import json
from flask import Flask, render_template, request, jsonify
from flask_login import LoginManager, login_required, current_user
from flask_bcrypt import Bcrypt
from shapely.geometry import Point, shape
from models import db, User, Area, Entry

app = Flask(__name__)
app.config['SECRET_KEY'] = 'lokal-geheim'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///instance/database.db'

db.init_app(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/api/save_point', methods=['POST'])
@login_required
def save_point():
    data = request.json
    point = Point(data['lng'], data['lat'])
    
    # Automatisches Finden des Gebiets
    target_area = None
    for area in Area.query.all():
        if area.geojson_border and shape(json.loads(area.geojson_border)).contains(point):
            target_area = area
            break
            
    if not target_area:
        return jsonify({"status": "error", "message": "Punkt außerhalb der Gebiete!"}), 400

    # Nummerierung logik
    prefix = "K_" if data.get('typ') == 'Kasten' else "S_"
    count = Entry.query.filter(Entry.nr.like(f"{prefix}{target_area.kuerzel}%")).count()
    new_nr = f"{prefix}{target_area.kuerzel}{count + 1:03d}"
    
    entry = Entry(nr=new_nr, lat=data['lat'], lng=data['lng'], area_id=target_area.id)
    db.session.add(entry)
    db.session.commit()
    
    return jsonify({"status": "success", "nr": new_nr, "area": target_area.name})

if __name__ == '__main__':
    if not os.path.exists('instance'): os.makedirs('instance')
    with app.app_context(): db.create_all()
    app.run(debug=True)
