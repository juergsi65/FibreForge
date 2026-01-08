import os
from flask import Flask, render_template, request, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_bcrypt import Bcrypt
from models import db, User, Area, Entry  # Importiert deine Struktur aus models.py

app = Flask(__name__)

# Konfiguration
app.config['SECRET_KEY'] = 'dein_geheimes_passwort_123' # Später ändern!
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialisierung der Erweiterungen
db.init_app(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- ROUTEN (Die Seiten deines Programms) ---

@app.route('/')
def index():
    # Startseite (Karte)
    return "Hier wird bald die Karte angezeigt!"

@app.route('/login', methods=['GET', 'POST'])
def login():
    # Login-Logik folgt hier
    return "Login Seite"

@app.route('/register', methods=['GET', 'POST'])
def register():
    # Registrierungs-Logik folgt hier
    return "Registrierungs Seite"

# --- SYSTEM-START ---

if __name__ == '__main__':
    with app.app_context():
        # Erstellt die lokale Datenbank-Datei, falls sie noch nicht existiert
        db.create_all()
        print("Lokale Datenbank wurde initialisiert.")
    
    # Startet den Server lokal
    app.run(debug=True)
