from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin

db = SQLAlchemy()

# Verknüpfungstabelle User <-> Gebiete
user_areas = db.Table('user_areas',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id')),
    db.Column('area_id', db.Integer, db.ForeignKey('area.id'))
)

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True) # Lokal direkt aktiv
    assigned_areas = db.relationship('Area', secondary=user_areas, backref='users')

class Area(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    kuerzel = db.Column(db.String(10), unique=True) # z.B. ADLW
    geojson_border = db.Column(db.Text) # Hier speichern wir die Grenzen

class Entry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nr = db.Column(db.String(50), unique=True) # z.B. K_ADLW001
    typ = db.Column(db.String(20)) # Kasten oder Schacht
    lat = db.Column(db.Float)
    lng = db.Column(db.Float)
    area_id = db.Column(db.Integer, db.ForeignKey('area.id'))
    timestamp = db.Column(db.DateTime, default=db.func.current_timestamp())
