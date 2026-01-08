from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime

db = SQLAlchemy()

# Verknüpfungstabelle
user_areas = db.Table('user_areas',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id')),
    db.Column('area_id', db.Integer, db.ForeignKey('area.id'))
)

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True)
    assigned_areas = db.relationship('Area', secondary=user_areas, backref='users')

class Area(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    kuerzel = db.Column(db.String(10), unique=True, nullable=False)
    geojson_border = db.Column(db.Text, nullable=True)
    entries = db.relationship('Entry', backref='area', lazy=True)

class Entry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nr = db.Column(db.String(50), unique=True, nullable=False)
    typ = db.Column(db.String(20), default='Kasten')
    lat = db.Column(db.Float, nullable=False)
    lng = db.Column(db.Float, nullable=False)
    area_id = db.Column(db.Integer, db.ForeignKey('area.id'), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
