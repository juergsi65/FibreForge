from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime

db = SQLAlchemy()

# Verbindungstabelle für User <-> Gebiete (N:M Beziehung)
user_areas = db.Table('user_areas',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id')),
    db.Column('area_id', db.Integer, db.ForeignKey('area.id'))
)

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=False) # Admin muss User erst freischalten
    # Gebiete, die dem User zugewiesen sind
    assigned_areas = db.relationship('Area', secondary=user_areas, backref='users')

class Area(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)   # Name der Gemeinde (z.B. Adlwang)
    kuerzel = db.Column(db.String(10), unique=True)    # Das Kürzel (z.B. ADLW)
    geojson_border = db.Column(db.Text, nullable=True) # Die lokalen Geodaten für den "Pro-Modus"

class Entry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nummer = db.Column(db.String(50), unique=True)     # Generiert: K_ADLW001
    to_nummer = db.Column(db.String(100))              # Deine Projektnummer (aus Excel)
    bauleiter = db.Column(db.String(100))              # Aus Excel
    datum_uhrzeit = db.Column(db.DateTime, default=datetime.now)
    typ = db.Column(db.String(20))                     # 'Kasten' oder 'Schacht'
    lat = db.Column(db.Float, nullable=True)           # Koordinaten für Karte
    lon = db.Column(db.Float, nullable=True)
    
    # Verknüpfung zum Gebiet
    area_id = db.Column(db.Integer, db.ForeignKey('area.id'))
    area = db.relationship('Area', backref='entries')
