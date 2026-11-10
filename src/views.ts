import { html, raw } from 'hono/html';
import { APP_MARKUP } from './app-markup';
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


/** Hauptansicht: Nummernverwaltung + Karte (Logik aus der bisherigen HTML-/Excel-Lösung). */
export const appPage = (user: User) => {
  const markup = APP_MARKUP.replace('__USERNAME__', escapeHtml(user.username)).replace(
    '__ADMINLINK__',
    user.is_admin ? '<a href="/admin">Admin-Bereich</a>' : '',
  );
  return html`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>FibreForge – Kästen/Schächte, Nummern &amp; Karte</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="/app.css">
</head>
<body>
${raw(markup)}
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="/app.js"></script>
</body>
</html>`;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export type AdminData = {
  users: User[];
  gebiete: { id: number; typ: string; name: string; kuerzel: string; anzahl: number }[];
  bauleiter: { id: number; nachname: string; vorname: string; email: string }[];
  stats: { kaesten: number; mitStandort: number; verbaende: number; gebiete: number };
};

const postBtn = (action: string, label: string, cls: string, confirmText?: string) =>
  html`<form action="${action}" method="POST" class="d-inline" ${confirmText ? raw(`onsubmit="return confirm('${confirmText}')"`) : ''}>
    <button class="btn btn-sm ${cls}">${label}</button>
  </form>`;

export const adminPage = (user: User, d: AdminData, flash?: Flash | null) =>
  layout({
    title: 'Admin',
    user,
    flash,
    body: html`<div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
  <h2 class="mb-0">Admin-Verwaltung</h2>
  <a href="/" class="btn btn-primary">Zur Nummernverwaltung</a>
</div>
<p class="text-muted mt-2">
  ${d.stats.kaesten} Kästen/Schächte · ${d.stats.mitStandort} mit Standort · ${d.stats.verbaende} Verbände · ${d.stats.gebiete} Gebiete in den Stammdaten
</p>
<div class="row">
  <div class="col-lg-7">
    <div class="card shadow-sm mb-4">
      <div class="card-header bg-primary text-white">Benutzer</div>
      <div class="card-body table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead><tr><th>Name</th><th>Status</th><th>Rechte</th><th class="text-end">Aktion</th></tr></thead>
          <tbody>
          ${d.users.map(
            (u) => html`<tr>
              <td>${u.username}</td>
              <td>${u.is_active ? html`<span class="badge bg-success">Aktiv</span>` : html`<span class="badge bg-warning text-dark">Wartet auf Freischaltung</span>`}</td>
              <td>${u.is_admin ? html`<span class="badge bg-dark">Admin</span>` : u.can_edit ? html`<span class="badge bg-info text-dark">Bearbeiten</span>` : html`<span class="badge bg-secondary">Nur lesen</span>`}</td>
              <td class="text-end text-nowrap">
                ${u.id === user.id
                  ? html`<span class="text-muted small">(du)</span>`
                  : html`${u.is_active
                      ? postBtn(`/admin/users/${u.id}/deactivate`, 'Sperren', 'btn-outline-warning')
                      : postBtn(`/admin/users/${u.id}/activate`, 'Freischalten', 'btn-success')}
                    ${u.is_admin ? '' : postBtn(`/admin/users/${u.id}/toggle-edit`, u.can_edit ? 'Nur lesen' : 'Bearbeiten erlauben', 'btn-outline-secondary')}
                    ${postBtn(`/admin/users/${u.id}/toggle-admin`, u.is_admin ? 'Admin entziehen' : 'Zum Admin', 'btn-outline-dark')}
                    ${postBtn(`/admin/users/${u.id}/delete`, 'Löschen', 'btn-outline-danger', 'Benutzer wirklich löschen?')}`}
              </td>
            </tr>`,
          )}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card shadow-sm mb-4">
      <div class="card-header bg-secondary text-white">Gebiete (Gemeinden OÖ + Linzer KGs)</div>
      <div class="card-body">
        <form action="/admin/gebiete" method="POST" class="row g-2 mb-3">
          <div class="col-md-3"><select name="typ" class="form-select form-select-sm"><option value="gemeinde">Gemeinde</option><option value="kg">KG (Linz)</option></select></div>
          <div class="col-md-4"><input name="name" class="form-control form-control-sm" placeholder="Name" required></div>
          <div class="col-md-3"><input name="kuerzel" class="form-control form-control-sm" placeholder="Kürzel, z.B. ADLW" required maxlength="20"></div>
          <div class="col-md-2"><button class="btn btn-sm btn-dark w-100">Speichern</button></div>
        </form>
        <div class="table-responsive" style="max-height: 420px; overflow:auto;">
          <table class="table table-sm align-middle mb-0">
            <thead class="sticky-top bg-white"><tr><th>Name</th><th>Typ</th><th>Kürzel</th><th>Kästen</th><th></th></tr></thead>
            <tbody>
            ${d.gebiete.length
              ? d.gebiete.map(
                  (g) => html`<tr>
                    <td>${g.name}</td><td>${g.typ === 'kg' ? 'KG Linz' : 'Gemeinde'}</td><td><code>${g.kuerzel}</code></td><td>${g.anzahl}</td>
                    <td class="text-end">${postBtn(`/admin/gebiete/${g.id}/delete`, 'Entfernen', 'btn-outline-danger', 'Gebiet aus den Stammdaten entfernen?')}</td>
                  </tr>`,
                )
              : html`<tr><td colspan="5" class="text-muted">Noch keine Gebiete. Importiere rechts deine Excel-Mappe.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card shadow-sm mb-4">
      <div class="card-header bg-secondary text-white">Bauleiter / Projektleiter</div>
      <div class="card-body">
        <form action="/admin/bauleiter" method="POST" class="row g-2 mb-3">
          <div class="col-md-3"><input name="nachname" class="form-control form-control-sm" placeholder="Nachname" required></div>
          <div class="col-md-3"><input name="vorname" class="form-control form-control-sm" placeholder="Vorname"></div>
          <div class="col-md-4"><input name="email" type="email" class="form-control form-control-sm" placeholder="E-Mail"></div>
          <div class="col-md-2"><button class="btn btn-sm btn-dark w-100">Speichern</button></div>
        </form>
        <table class="table table-sm align-middle mb-0">
          <thead><tr><th>Name</th><th>E-Mail</th><th></th></tr></thead>
          <tbody>
          ${d.bauleiter.map(
            (b) => html`<tr><td>${b.nachname} ${b.vorname}</td><td>${b.email}</td>
              <td class="text-end">${postBtn(`/admin/bauleiter/${b.id}/delete`, 'Entfernen', 'btn-outline-danger', 'Bauleiter entfernen?')}</td></tr>`,
          )}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="col-lg-5">
    <div class="card shadow-sm mb-4">
      <div class="card-header bg-dark text-white">Excel-Mappe importieren</div>
      <div class="card-body">
        <p class="small">
          Die bisherige Mappe (z.B. <code>Neuanlage_Nummern.xlsx</code>) auswählen. Übernommen werden die Blätter
          <code>Gemeinden OÖ</code>, <code>Linz KGs</code>, <code>Projektleiter</code> und alle Kürzel-Blätter
          (Spalte A1 = <code>Nummer</code>) inklusive Standorten, Info und Verbänden.
        </p>
        <input type="file" id="wb-file" accept=".xlsx,.xlsm,.xls" class="form-control form-control-sm mb-2">
        <div class="form-check mb-2">
          <input class="form-check-input" type="checkbox" id="wb-overwrite">
          <label class="form-check-label small" for="wb-overwrite">Vorhandene Nummern mit den Werten aus der Excel überschreiben</label>
        </div>
        <button id="wb-import" class="btn btn-warning btn-sm w-100">Import starten</button>
        <pre id="import-log" class="small bg-light p-2 mt-2 mb-0" style="max-height: 300px; overflow:auto; white-space: pre-wrap;"></pre>
        <p class="small text-muted mt-2 mb-0">Die Datei wird im Browser gelesen, nur die Daten werden übertragen. Der Import kann gefahrlos wiederholt werden.</p>
      </div>
    </div>

    <div class="card shadow-sm mb-4">
      <div class="card-header bg-dark text-white">Sicherung</div>
      <div class="card-body">
        <p class="small">Lädt alle Daten als Excel-Mappe im bisherigen Format herunter (gleiche Blätter und Spalten wie die alte Datei).</p>
        <button id="wb-backup" class="btn btn-outline-dark btn-sm w-100">Komplette Mappe als Excel herunterladen</button>
      </div>
    </div>
  </div>
</div>`,
    scripts: html`<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="/admin.js"></script>`,
  });
