import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { User } from './types';

type Body = HtmlEscapedString | Promise<HtmlEscapedString>;

export type Flash = { type: 'success' | 'danger' | 'warning' | 'info'; text: string };

export function layout(opts: { title?: string; user: User | null; body: Body; scripts?: Body; flash?: Flash | null }) {
  const { user, body, scripts, flash } = opts;
  return html`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.title ? `${opts.title} – ` : ''}FibreForge</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    body { background-color: #f8f9fa; }
    #map { height: calc(100vh - 180px); min-height: 400px; width: 100%; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
  </style>
</head>
<body>
<nav class="navbar navbar-expand-lg navbar-dark bg-dark mb-4">
  <div class="container-fluid">
    <a class="navbar-brand" href="/">FibreForge</a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="nav">
      <ul class="navbar-nav ms-auto align-items-lg-center">
        ${user
          ? html`<li class="nav-item"><span class="nav-link">Hallo, ${user.username}</span></li>
            ${user.is_admin ? html`<li class="nav-item"><a class="nav-link text-warning" href="/admin">Admin-Bereich</a></li>` : ''}
            <li class="nav-item"><form method="POST" action="/logout" class="d-inline"><button class="btn btn-link nav-link">Abmelden</button></form></li>`
          : html`<li class="nav-item"><a class="nav-link" href="/login">Login</a></li>
            <li class="nav-item"><a class="nav-link" href="/register">Registrieren</a></li>`}
      </ul>
    </div>
  </div>
</nav>
<div class="container-fluid">
  ${flash ? html`<div class="alert alert-${flash.type}">${flash.text}</div>` : ''}
  ${body}
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
${scripts ?? ''}
</body>
</html>`;
}

function authForm(kind: 'login' | 'register') {
  const isLogin = kind === 'login';
  return html`<div class="row justify-content-center">
  <div class="col-md-4">
    <div class="card shadow-sm mt-4">
      <div class="card-body">
        <h3 class="card-title text-center mb-4">${isLogin ? 'Login' : 'Registrierung'}</h3>
        <form method="POST">
          <div class="mb-3">
            <label class="form-label">Benutzername</label>
            <input type="text" name="username" class="form-control" required maxlength="150" autocomplete="username">
          </div>
          <div class="mb-3">
            <label class="form-label">Passwort</label>
            <input type="password" name="password" class="form-control" required ${isLogin ? '' : raw('minlength="8"')}
              autocomplete="${isLogin ? 'current-password' : 'new-password'}">
          </div>
          <div class="d-grid">
            <button type="submit" class="btn ${isLogin ? 'btn-primary' : 'btn-success'}">${isLogin ? 'Einloggen' : 'Konto erstellen'}</button>
          </div>
        </form>
        <hr>
        <div class="text-center">
          ${isLogin
            ? html`<a href="/register">Noch kein Konto? Hier registrieren</a>`
            : html`Bereits ein Konto? <a href="/login">Hier einloggen</a>`}
        </div>
      </div>
    </div>
  </div>
</div>`;
}

export const loginPage = (flash?: Flash | null) =>
  layout({ title: 'Login', user: null, body: authForm('login'), flash });

export const registerPage = (flash?: Flash | null) =>
  layout({ title: 'Registrierung', user: null, body: authForm('register'), flash });

export const mapPage = (user: User) =>
  layout({
    user,
    body: html`<div class="d-flex flex-wrap gap-2 align-items-center mb-2">
  <label class="form-label mb-0 me-1">Neuer Punkt:</label>
  <div class="btn-group" role="group">
    <input type="radio" class="btn-check" name="typ" id="typ-kasten" value="Kasten" checked>
    <label class="btn btn-outline-primary btn-sm" for="typ-kasten">Kasten (K_)</label>
    <input type="radio" class="btn-check" name="typ" id="typ-schacht" value="Schacht">
    <label class="btn btn-outline-primary btn-sm" for="typ-schacht">Schacht (S_)</label>
  </div>
  <span class="text-muted small ms-2">Klick in die Karte legt einen Punkt im passenden Gebiet an.</span>
  <span id="status" class="small ms-auto"></span>
</div>
<div id="map"></div>`,
    scripts: html`<script>window.FF_USER = ${raw(JSON.stringify({ id: user.id, isAdmin: !!user.is_admin }).replace(/</g, '\\u003c'))};</script>
<script src="/map.js"></script>`,
  });

export type AdminUserRow = User & { kuerzel: string | null };
export type AdminAreaRow = { id: number; name: string; kuerzel: string; has_border: number; entry_count: number };

export const adminPage = (user: User, users: AdminUserRow[], areas: AdminAreaRow[], flash?: Flash | null) =>
  layout({
    title: 'Admin',
    user,
    flash,
    body: html`<h2>Admin-Verwaltung</h2>
<hr>
<div class="row">
  <div class="col-lg-8">
    <div class="card shadow mb-4">
      <div class="card-header bg-primary text-white">Benutzer freischalten &amp; Gebiete zuweisen</div>
      <div class="card-body table-responsive">
        <table class="table table-hover align-middle">
          <thead><tr><th>Name</th><th>Status</th><th>Gebiete (Kürzel)</th><th>Aktion</th></tr></thead>
          <tbody>
          ${users.map(
            (u) => html`<tr>
              <td>${u.username}${u.is_admin ? html` <span class="badge bg-dark">Admin</span>` : ''}</td>
              <td>${u.is_active ? html`<span class="badge bg-success">Aktiv</span>` : html`<span class="badge bg-warning text-dark">Inaktiv</span>`}</td>
              <td>
                <form id="f-${u.id}" action="/admin/users/${u.id}" method="POST">
                  <input type="text" name="areas" value="${u.kuerzel ?? ''}" class="form-control form-control-sm" placeholder="z.B. ADLW,LINZ">
                </form>
              </td>
              <td class="text-nowrap">
                <button form="f-${u.id}" type="submit" class="btn btn-sm btn-outline-primary">Speichern</button>
                ${u.id === user.id
                  ? ''
                  : html`<form action="/admin/users/${u.id}/${u.is_active ? 'deactivate' : 'activate'}" method="POST" class="d-inline">
                      <button class="btn btn-sm ${u.is_active ? 'btn-outline-warning' : 'btn-success'}">${u.is_active ? 'Sperren' : 'Aktivieren'}</button>
                    </form>
                    <form action="/admin/users/${u.id}/toggle-admin" method="POST" class="d-inline">
                      <button class="btn btn-sm btn-outline-dark">${u.is_admin ? 'Admin entziehen' : 'Zum Admin'}</button>
                    </form>
                    <form action="/admin/users/${u.id}/delete" method="POST" class="d-inline" onsubmit="return confirm('Benutzer wirklich löschen?')">
                      <button class="btn btn-sm btn-outline-danger">Löschen</button>
                    </form>`}
              </td>
            </tr>`,
          )}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card shadow mb-4">
      <div class="card-header bg-secondary text-white">Gebiete</div>
      <div class="card-body table-responsive">
        <table class="table table-sm align-middle">
          <thead><tr><th>Name</th><th>Kürzel</th><th>Grenze</th><th>Punkte</th><th></th></tr></thead>
          <tbody>
          ${areas.length
            ? areas.map(
                (a) => html`<tr>
                  <td>${a.name}</td><td><code>${a.kuerzel}</code></td>
                  <td>${a.has_border ? html`<span class="badge bg-success">ok</span>` : html`<span class="badge bg-danger">fehlt</span>`}</td>
                  <td>${a.entry_count}</td>
                  <td class="text-end text-nowrap">
                    <form action="/admin/areas/${a.id}/refresh" method="POST" class="d-inline">
                      <button class="btn btn-sm btn-outline-secondary">Grenze neu laden</button>
                    </form>
                    <form action="/admin/areas/${a.id}/delete" method="POST" class="d-inline" onsubmit="return confirm('Gebiet inkl. aller ${a.entry_count} Punkte löschen?')">
                      <button class="btn btn-sm btn-outline-danger">Löschen</button>
                    </form>
                  </td>
                </tr>`,
              )
            : html`<tr><td colspan="5" class="text-muted">Noch keine Gebiete angelegt.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="col-lg-4">
    <div class="card shadow mb-4">
      <div class="card-header bg-dark text-white">Gebiet anlegen</div>
      <div class="card-body">
        <form action="/admin/areas" method="POST">
          <div class="mb-2"><input name="name" class="form-control form-control-sm" placeholder="Gemeindename, z.B. Adlwang" required></div>
          <div class="mb-2"><input name="kuerzel" class="form-control form-control-sm" placeholder="Kürzel, z.B. ADLW" required maxlength="10"></div>
          <div class="mb-2"><textarea name="geojson" class="form-control form-control-sm" rows="2" placeholder="Optional: GeoJSON-Grenze. Leer = automatisch von OpenStreetMap laden"></textarea></div>
          <button class="btn btn-dark btn-sm w-100">Gebiet speichern</button>
        </form>
      </div>
    </div>

    <div class="card shadow mb-4">
      <div class="card-header bg-dark text-white">Daten-Import</div>
      <div class="card-body">
        <p class="small mb-1"><strong>1. Gebietsliste</strong> (CSV/Excel, Spalten <code>Name</code>, <code>Kuerzel</code>). Grenzen werden von OpenStreetMap geladen (ca. 1 Gebiet/Sekunde).</p>
        <input type="file" id="areas-file" accept=".csv,.xlsx,.xlsm,.xls" class="form-control form-control-sm mb-2">
        <button id="areas-import" class="btn btn-info btn-sm w-100 mb-3">Gemeindegrenzen laden</button>

        <p class="small mb-1"><strong>2. Bestandsliste</strong> (CSV/Excel inkl. .xlsm, Spalten <code>Nummer</code>, <code>Breitengrad</code>, <code>Längengrad</code>, optional <code>Typ</code>).</p>
        <input type="file" id="entries-file" accept=".csv,.xlsx,.xlsm,.xls" class="form-control form-control-sm mb-2">
        <button id="entries-import" class="btn btn-warning btn-sm w-100 mb-2">Excel-Bestand einlesen</button>

        <pre id="import-log" class="small bg-light p-2 mt-2 mb-0" style="max-height: 300px; overflow:auto; white-space: pre-wrap;"></pre>
        <p class="small text-muted mt-2 mb-0">Die Dateien werden im Browser gelesen, nur die Daten werden hochgeladen.</p>
      </div>
    </div>

    <div class="card shadow mb-4">
      <div class="card-header bg-dark text-white">Export</div>
      <div class="card-body">
        <a href="/api/entries.csv" class="btn btn-outline-dark btn-sm w-100">Alle Punkte als CSV</a>
      </div>
    </div>
  </div>
</div>`,
    scripts: html`<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
<script src="/admin.js"></script>`,
  });
