@app.route('/admin')
@login_required
def admin_panel():
    if not current_user.is_admin:
        return "Zugriff verweigert", 403
    users = User.query.all()
    return render_template('admin.html', users=users)

@app.route('/activate_user/<int:user_id>')
@login_required
def activate_user(user_id):
    if current_user.is_admin:
        user = User.query.get(user_id)
        user.is_active = True
        db.session.commit()
    return redirect(url_for('admin_panel'))

@app.route('/update_user/<int:user_id>', methods=['POST'])
@login_required
def update_user(user_id):
    if current_user.is_admin:
        user = User.query.get(user_id)
        # Kürzel aus dem Formular (getrennt durch Komma)
        area_codes = request.form.get('areas').split(',')
        user.assigned_areas = [] # Reset
        for code in area_codes:
            area = Area.query.filter_by(kuerzel=code.strip().upper()).first()
            if area:
                user.assigned_areas.append(area)
        db.session.commit()
    return redirect(url_for('admin_panel'))
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
