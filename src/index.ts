import { Hono, type Context, type Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { csrf } from 'hono/csrf';
import { createSession, destroySession, hashPassword, loadUser, verifyPassword } from './auth';
import { containsPoint, fetchBoundary, isAreaGeometry, parseGeometry } from './geo';
import type { AppEnv, User } from './types';
import { adminPage, loginPage, mapPage, registerPage, type AdminAreaRow, type AdminUserRow, type Flash } from './views';

const app = new Hono<AppEnv>();

app.use('*', csrf());
app.use('*', async (c, next) => {
  c.set('user', await loadUser(c));
  await next();
});

// ---------- Hilfsfunktionen ----------

const requireLogin = async (c: Context<AppEnv>, next: Next) => {
  if (c.get('user')) return next();
  if (c.req.path.startsWith('/api/')) return c.json({ status: 'error', message: 'Nicht angemeldet' }, 401);
  return c.redirect('/login');
};

const requireAdmin = async (c: Context<AppEnv>, next: Next) => {
  const user = c.get('user');
  if (user?.is_admin) return next();
  if (c.req.path.includes('/api/')) return c.json({ status: 'error', message: 'Keine Berechtigung' }, 403);
  return user ? c.text('Keine Berechtigung', 403) : c.redirect('/login');
};

function flashFromQuery(c: Context<AppEnv>): Flash | null {
  const ok = c.req.query('ok');
  const err = c.req.query('err');
  if (err) return { type: 'danger', text: err };
  if (ok) return { type: 'success', text: ok };
  return null;
}

const back = (c: Context<AppEnv>, path: string, kind: 'ok' | 'err', msg: string) =>
  c.redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);

const normKuerzel = (s: unknown) => String(s ?? '').trim().toUpperCase();

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  return Number(String(v ?? '').trim().replace(',', '.'));
}

const typPrefix = (typ: string) => (typ === 'Kasten' ? 'K_' : 'S_');

type AreaRow = { id: number; name: string; kuerzel: string; geojson_border: string | null };

async function allAreas(db: D1Database): Promise<AreaRow[]> {
  const { results } = await db.prepare('SELECT id, name, kuerzel, geojson_border FROM areas').all<AreaRow>();
  return results;
}

function findAreaForPoint(areas: AreaRow[], lng: number, lat: number): AreaRow | undefined {
  return areas.find((a) => containsPoint(parseGeometry(a.geojson_border), lng, lat));
}

async function userMayUseArea(db: D1Database, user: User, areaId: number): Promise<boolean> {
  if (user.is_admin) return true;
  const row = await db.prepare('SELECT 1 FROM user_areas WHERE user_id = ? AND area_id = ?').bind(user.id, areaId).first();
  return !!row;
}

/** Naechste freie Nummer, z.B. K_ADLW007. Beruecksichtigt die hoechste vorhandene Nummer, nicht die Anzahl. */
async function nextNumber(db: D1Database, prefix: string, kuerzel: string): Promise<string> {
  const base = prefix + kuerzel;
  const row = await db
    .prepare(
      `SELECT MAX(CAST(substr(nr, ?1) AS INTEGER)) AS maxnr FROM entries
        WHERE substr(nr, 1, ?2) = ?3 AND substr(nr, ?1) GLOB '[0-9]*' AND substr(nr, ?1) NOT GLOB '*[^0-9]*'`,
    )
    .bind(base.length + 1, base.length, base)
    .first<{ maxnr: number | null }>();
  return `${base}${String((row?.maxnr ?? 0) + 1).padStart(3, '0')}`;
}

/** Ermittelt das Gebiet zu einer importierten Nummer (z.B. 'K_ADLW001' -> ADLW). */
function areaFromNumber(areasByLength: AreaRow[], nr: string): AreaRow | undefined {
  const upper = nr.toUpperCase();
  const m = upper.match(/^[A-Z]+_(.+)$/);
  const rest = m ? m[1] : upper;
  return areasByLength.find((a) => rest.startsWith(a.kuerzel.toUpperCase())) ?? areasByLength.find((a) => upper.includes(a.kuerzel.toUpperCase()));
}

async function upsertArea(
  c: Context<AppEnv>,
  name: string,
  kuerzel: string,
  geojson: string | null,
): Promise<{ ok: boolean; message: string }> {
  if (!name || !kuerzel) return { ok: false, message: 'Name und Kürzel sind Pflicht.' };
  if (kuerzel.length > 10) return { ok: false, message: `Kürzel "${kuerzel}" ist länger als 10 Zeichen.` };

  let border = geojson;
  if (border) {
    try {
      const parsed = JSON.parse(border);
      if (!isAreaGeometry(parsed)) return { ok: false, message: 'GeoJSON muss ein Polygon/MultiPolygon sein.' };
      border = JSON.stringify(parsed);
    } catch {
      return { ok: false, message: 'GeoJSON ist ungültig.' };
    }
  }

  const existing = await c.env.DB.prepare('SELECT id, geojson_border FROM areas WHERE kuerzel = ?')
    .bind(kuerzel)
    .first<{ id: number; geojson_border: string | null }>();
  if (existing?.geojson_border && !border) return { ok: true, message: `${name} (${kuerzel}) existiert bereits.` };

  if (!border) border = await fetchBoundary(name, c.env.NOMINATIM_COUNTRY || 'at');

  if (existing) {
    await c.env.DB.prepare('UPDATE areas SET name = ?, geojson_border = ? WHERE id = ?').bind(name, border, existing.id).run();
  } else {
    await c.env.DB.prepare('INSERT INTO areas (name, kuerzel, geojson_border) VALUES (?, ?, ?)').bind(name, kuerzel, border).run();
  }
  return border
    ? { ok: true, message: `${name} (${kuerzel}) gespeichert.` }
    : { ok: false, message: `${name} (${kuerzel}) angelegt, aber keine Grenze gefunden.` };
}

// ---------- Auth ----------

app.get('/login', (c) => (c.get('user') ? c.redirect('/') : c.html(loginPage(flashFromQuery(c)))));

app.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const username = String(form.username ?? '').trim();
  const password = String(form.password ?? '');
  const row = await c.env.DB.prepare('SELECT id, password_hash, is_active FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: number; password_hash: string; is_active: number }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return c.html(loginPage({ type: 'danger', text: 'Benutzername oder Passwort falsch.' }), 401);
  }
  if (!row.is_active) {
    return c.html(loginPage({ type: 'warning', text: 'Dein Konto wurde noch nicht vom Admin freigeschaltet.' }), 403);
  }
  await createSession(c, row.id);
  return c.redirect('/');
});

app.get('/register', (c) => (c.get('user') ? c.redirect('/') : c.html(registerPage())));

app.post('/register', async (c) => {
  const form = await c.req.parseBody();
  const username = String(form.username ?? '').trim();
  const password = String(form.password ?? '');
  if (!username || username.length > 150) return c.html(registerPage({ type: 'danger', text: 'Ungültiger Benutzername.' }), 400);
  if (password.length < 8) return c.html(registerPage({ type: 'danger', text: 'Passwort muss mindestens 8 Zeichen haben.' }), 400);

  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) return c.html(registerPage({ type: 'danger', text: 'Benutzername ist bereits vergeben.' }), 409);

  // Der allererste Benutzer wird automatisch Admin und ist sofort aktiv.
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const first = (count?.n ?? 0) === 0;
  const hash = await hashPassword(password);
  const res = await c.env.DB.prepare('INSERT INTO users (username, password_hash, is_admin, is_active) VALUES (?, ?, ?, ?)')
    .bind(username, hash, first ? 1 : 0, first ? 1 : 0)
    .run();

  if (first) {
    await createSession(c, Number(res.meta.last_row_id));
    return c.redirect('/admin?ok=' + encodeURIComponent('Willkommen! Du bist der erste Benutzer und damit Admin.'));
  }
  return back(c, '/login', 'ok', 'Registrierung erfolgreich. Ein Admin muss dein Konto noch freischalten.');
});

app.post('/logout', async (c) => {
  await destroySession(c);
  return c.redirect('/login');
});

// ---------- Karte ----------

app.get('/', requireLogin, (c) => c.html(mapPage(c.get('user')!)));

app.get('/api/areas', requireLogin, async (c) => {
  const user = c.get('user')!;
  const stmt = user.is_admin
    ? c.env.DB.prepare('SELECT id, name, kuerzel, geojson_border FROM areas ORDER BY name')
    : c.env.DB.prepare(
        `SELECT a.id, a.name, a.kuerzel, a.geojson_border FROM areas a
           JOIN user_areas ua ON ua.area_id = a.id WHERE ua.user_id = ? ORDER BY a.name`,
      ).bind(user.id);
  const { results } = await stmt.all<AreaRow>();
  return c.json(results.map((a) => ({ id: a.id, name: a.name, kuerzel: a.kuerzel, geojson: parseGeometry(a.geojson_border) })));
});

type EntryRow = { id: number; nr: string; typ: string; lat: number; lng: number; area_id: number; area: string; created_by: number | null; timestamp: string };

async function visibleEntries(db: D1Database, user: User): Promise<EntryRow[]> {
  const base = `SELECT e.id, e.nr, e.typ, e.lat, e.lng, e.area_id, a.name AS area, e.created_by, e.timestamp
                  FROM entries e JOIN areas a ON a.id = e.area_id`;
  const stmt = user.is_admin
    ? db.prepare(`${base} ORDER BY e.nr`)
    : db.prepare(`${base} JOIN user_areas ua ON ua.area_id = e.area_id WHERE ua.user_id = ? ORDER BY e.nr`).bind(user.id);
  return (await stmt.all<EntryRow>()).results;
}

app.get('/api/entries', requireLogin, async (c) => c.json(await visibleEntries(c.env.DB, c.get('user')!)));

app.get('/api/entries.csv', requireLogin, async (c) => {
  const rows = await visibleEntries(c.env.DB, c.get('user')!);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Nummer;Typ;Breitengrad;Längengrad;Gebiet;Zeitstempel'];
  for (const r of rows) lines.push([r.nr, r.typ, r.lat, r.lng, r.area, r.timestamp].map(esc).join(';'));
  return c.body('﻿' + lines.join('\r\n'), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="fibreforge-punkte.csv"',
  });
});

app.post('/api/save_point', requireLogin, async (c) => {
  const user = c.get('user')!;
  const data = await c.req.json<{ lat: unknown; lng: unknown; typ?: string }>().catch(() => null);
  const lat = toNumber(data?.lat);
  const lng = toNumber(data?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ status: 'error', message: 'Ungültige Koordinaten.' }, 400);
  const typ = data?.typ === 'Schacht' ? 'Schacht' : 'Kasten';

  const area = findAreaForPoint(await allAreas(c.env.DB), lng, lat);
  if (!area) return c.json({ status: 'error', message: 'Punkt außerhalb der Gebiete!' }, 400);
  if (!(await userMayUseArea(c.env.DB, user, area.id))) {
    return c.json({ status: 'error', message: `Du bist für das Gebiet ${area.name} nicht freigeschaltet.` }, 403);
  }

  // Bei gleichzeitigen Klicks kann eine Nummer doppelt vergeben werden -> erneut versuchen.
  for (let attempt = 0; attempt < 5; attempt++) {
    const nr = await nextNumber(c.env.DB, typPrefix(typ), area.kuerzel);
    try {
      const res = await c.env.DB.prepare('INSERT INTO entries (nr, typ, lat, lng, area_id, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(nr, typ, lat, lng, area.id, user.id)
        .run();
      return c.json({ status: 'success', id: Number(res.meta.last_row_id), nr, typ, area: area.name });
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e;
    }
  }
  return c.json({ status: 'error', message: 'Nummer konnte nicht vergeben werden, bitte erneut versuchen.' }, 409);
});

app.delete('/api/entries/:id', requireLogin, async (c) => {
  const user = c.get('user')!;
  const id = Number(c.req.param('id'));
  const entry = await c.env.DB.prepare('SELECT id, created_by FROM entries WHERE id = ?').bind(id).first<{ id: number; created_by: number | null }>();
  if (!entry) return c.json({ status: 'error', message: 'Nicht gefunden.' }, 404);
  if (!user.is_admin && entry.created_by !== user.id) return c.json({ status: 'error', message: 'Keine Berechtigung.' }, 403);
  await c.env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  return c.json({ status: 'success' });
});

// ---------- Admin ----------

app.use('/admin', requireAdmin);
app.use('/admin/*', requireAdmin);

app.get('/admin', async (c) => {
  const users = (
    await c.env.DB.prepare(
      `SELECT u.id, u.username, u.is_admin, u.is_active, GROUP_CONCAT(a.kuerzel, ',') AS kuerzel
         FROM users u
         LEFT JOIN user_areas ua ON ua.user_id = u.id
         LEFT JOIN areas a ON a.id = ua.area_id
        GROUP BY u.id ORDER BY u.is_active, u.username`,
    ).all<AdminUserRow>()
  ).results;
  const areas = (
    await c.env.DB.prepare(
      `SELECT a.id, a.name, a.kuerzel, a.geojson_border IS NOT NULL AS has_border,
              (SELECT COUNT(*) FROM entries e WHERE e.area_id = a.id) AS entry_count
         FROM areas a ORDER BY a.name`,
    ).all<AdminAreaRow>()
  ).results;
  return c.html(adminPage(c.get('user')!, users, areas, flashFromQuery(c)));
});

app.post('/admin/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const wanted = [...new Set(String(form.areas ?? '').split(/[,;\s]+/).map(normKuerzel).filter(Boolean))];
  const found = wanted.length
    ? (
        await c.env.DB.prepare(`SELECT id, kuerzel FROM areas WHERE kuerzel IN (${wanted.map(() => '?').join(',')})`)
          .bind(...wanted)
          .all<{ id: number; kuerzel: string }>()
      ).results
    : [];
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM user_areas WHERE user_id = ?').bind(id),
    ...found.map((a) => c.env.DB.prepare('INSERT INTO user_areas (user_id, area_id) VALUES (?, ?)').bind(id, a.id)),
  ]);
  const missing = wanted.filter((k) => !found.some((a) => a.kuerzel === k));
  return missing.length
    ? back(c, '/admin', 'err', `Gespeichert, aber unbekannte Kürzel ignoriert: ${missing.join(', ')}`)
    : back(c, '/admin', 'ok', 'Gebiete gespeichert.');
});

app.post('/admin/users/:id/:action{activate|deactivate|toggle-admin|delete}', async (c) => {
  const id = Number(c.req.param('id'));
  const action = c.req.param('action');
  if (id === c.get('user')!.id) return back(c, '/admin', 'err', 'Das eigene Konto kann hier nicht geändert werden.');
  const db = c.env.DB;
  if (action === 'activate') await db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').bind(id).run();
  if (action === 'deactivate')
    await db.batch([db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(id), db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]);
  if (action === 'toggle-admin') await db.prepare('UPDATE users SET is_admin = 1 - is_admin WHERE id = ?').bind(id).run();
  if (action === 'delete')
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM user_areas WHERE user_id = ?').bind(id),
      db.prepare('UPDATE entries SET created_by = NULL WHERE created_by = ?').bind(id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ]);
  return back(c, '/admin', 'ok', 'Benutzer aktualisiert.');
});

app.post('/admin/areas', async (c) => {
  const form = await c.req.parseBody();
  const geojson = String(form.geojson ?? '').trim() || null;
  const r = await upsertArea(c, String(form.name ?? '').trim(), normKuerzel(form.kuerzel), geojson);
  return back(c, '/admin', r.ok ? 'ok' : 'err', r.message);
});

app.post('/admin/areas/:id/refresh', async (c) => {
  const area = await c.env.DB.prepare('SELECT name, kuerzel FROM areas WHERE id = ?').bind(Number(c.req.param('id'))).first<AreaRow>();
  if (!area) return back(c, '/admin', 'err', 'Gebiet nicht gefunden.');
  const border = await fetchBoundary(area.name, c.env.NOMINATIM_COUNTRY || 'at');
  if (!border) return back(c, '/admin', 'err', `Keine Grenze für ${area.name} gefunden.`);
  await c.env.DB.prepare('UPDATE areas SET geojson_border = ? WHERE kuerzel = ?').bind(border, area.kuerzel).run();
  return back(c, '/admin', 'ok', `Grenze für ${area.name} aktualisiert.`);
});

app.post('/admin/areas/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM entries WHERE area_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM user_areas WHERE area_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM areas WHERE id = ?').bind(id),
  ]);
  return back(c, '/admin', 'ok', 'Gebiet gelöscht.');
});

// JSON-Endpunkte fuer den Import im Admin-Bereich (Dateien werden im Browser gelesen)

app.post('/admin/api/areas', async (c) => {
  const body = await c.req.json<{ name?: string; kuerzel?: string; geojson?: unknown }>().catch(() => null);
  const geojson = body?.geojson ? (typeof body.geojson === 'string' ? body.geojson : JSON.stringify(body.geojson)) : null;
  const r = await upsertArea(c, String(body?.name ?? '').trim(), normKuerzel(body?.kuerzel), geojson);
  return c.json({ status: r.ok ? 'success' : 'error', message: r.message });
});

app.post('/admin/api/entries', async (c) => {
  const body = await c.req.json<{ rows?: { nr?: unknown; typ?: unknown; lat?: unknown; lng?: unknown }[] }>().catch(() => null);
  const rows = body?.rows ?? [];
  if (rows.length > 1000) return c.json({ status: 'error', message: 'Maximal 1000 Zeilen pro Anfrage.' }, 400);

  const areas = (await allAreas(c.env.DB)).sort((a, b) => b.kuerzel.length - a.kuerzel.length);
  const errors: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const nr = String(r.nr ?? '').trim();
    const lat = toNumber(r.lat);
    const lng = toNumber(r.lng);
    if (!nr) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push(`${nr}: ungültige Koordinaten`);
      continue;
    }
    const area = areaFromNumber(areas, nr) ?? findAreaForPoint(areas, lng, lat);
    if (!area) {
      errors.push(`${nr}: kein passendes Gebiet`);
      continue;
    }
    const rawTyp = String(r.typ ?? '').trim();
    const typ = rawTyp || (nr.toUpperCase().startsWith('S_') ? 'Schacht' : 'Kasten');
    stmts.push(
      c.env.DB.prepare('INSERT OR IGNORE INTO entries (nr, typ, lat, lng, area_id) VALUES (?, ?, ?, ?, ?)').bind(nr, typ, lat, lng, area.id),
    );
  }
  const results = stmts.length ? await c.env.DB.batch(stmts) : [];
  const inserted = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return c.json({ status: 'success', inserted, skipped: stmts.length - inserted, errors });
});

app.notFound((c) => c.text('Seite nicht gefunden', 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  if (c.req.path.includes('/api/')) return c.json({ status: 'error', message: 'Serverfehler' }, 500);
  return c.text('Serverfehler', 500);
});

export default app;
