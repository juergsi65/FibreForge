from flask_login import login_user, logout_user, login_required, current_user

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        hashed_pw = bcrypt.generate_password_hash(request.form['password']).decode('utf-8')
        new_user = User(
            username=request.form['username'], 
            password=hashed_pw,
            is_active=False # Muss vom Admin freigeschaltet werden
        )
        db.session.add(new_user)
        db.session.commit()
        flash('Registrierung erfolgreich! Ein Admin muss dich noch freischalten.', 'info')
        return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and bcrypt.check_password_hash(user.password, request.form['password']):
            if not user.is_active:
                flash('Dein Account ist noch nicht freigeschaltet.', 'danger')
                return redirect(url_for('login'))
            login_user(user)
            return redirect(url_for('index'))
        flash('Login fehlgeschlagen. Prüfe Name und Passwort.', 'danger')
    return render_template('login.html')

@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))
