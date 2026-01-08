import os
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_bcrypt import Bcrypt

# Zuerst die Modelle importieren (db wird dort definiert)
from models import db, User, Area, Entry

# 1. App Definition und Konfiguration
app = Flask(__name__)
app.config['SECRET_KEY'] = 'entwicklung_geheim_123'  # Später für Produktion ändern
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# 2. Erweiterungen initialisieren
db.init_app(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- ROUTEN ---

@app.route('/')
@login_required
def index():
    # Nur Gebiete anzeigen, die dem User zugewiesen sind
    user_areas = current_user.assigned_areas
    return render_template('index.html', areas=user_areas)

@app.route('/init-db')
def init_db():
    with app.app_context():
        db.create_all()
    return "Datenbank-Tabellen wurden erfolgreich erstellt! Du kannst dich jetzt registrieren."

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and bcrypt.check_password_hash(user.password, request.form['password']):
            if not user.is_active:
                flash('Dein Account wurde noch nicht vom Admin aktiviert.', 'warning')
                return redirect(url_for('login'))
            login_user(user)
            return redirect(url_for('index'))
        flash('Login fehlgeschlagen. Name oder Passwort falsch.', 'danger')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        hashed_pw = bcrypt.generate_password_hash(request.form['password']).decode('utf-8')
        new_user = User(
            username=request.form['username'],
            password=hashed_pw,
            is_active=False  # Standardmäßig inaktiv
        )
        db.session.add(new_user)
        db.session.commit()
        flash('Registriert! Bitte warte auf die Aktivierung durch den Admin.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

# --- ADMIN ROUTEN ---

@app.route('/admin')
@login_required
def admin_panel():
    if not current_user.is_admin:
        flash('Keine Berechtigung!', 'danger')
        return redirect(url_for('index'))
    users = User.query.all()
    return render_template('admin.html', users=users)

@app.route('/activate_user/<int:user_id>')
@login_required
def activate_user(user_id):
    if current_user.is_admin:
        user = User.query.get(user_id)
        user.is_active = True
        db.session.commit()
        flash(f'User {user.username} aktiviert.', 'success')
    return redirect(url_for('admin_panel'))

@app.route('/update_user/<int:user_id>', methods=['POST'])
@login_required
def update_user(user_id):
    if current_user.is_admin:
        user = User.query.get(user_id)
        area_codes = request.form.get('areas', '').split(',')
        user.assigned_areas = []
        for code in area_codes:
            code = code.strip().upper()
            if code:
                area = Area.query.filter_by(kuerzel=code).first()
                if not area: # Falls Gebiet noch nicht existiert, neu anlegen
                    area = Area(name=code, kuerzel=code)
                    db.session.add(area)
                    db.session.flush()
                user.assigned_areas.append(area)
        db.session.commit()
        flash(f'Gebiete für {user.username} aktualisiert.', 'success')
    return redirect(url_for('admin_panel'))

# Hilfsroute um den ersten Admin zu erstellen (nach Registrierung aufrufen!)
@app.route('/make-me-admin/<username>')
def make_me_admin(username):
    user = User.query.filter_by(username=username).first()
    if user:
        user.is_admin = True
        user.is_active = True
        db.session.commit()
        return f"{username} ist jetzt Admin und aktiv!"
    return "User nicht gefunden."

# --- SYSTEM START ---

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    # Port-Handling für Render und Lokal
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
