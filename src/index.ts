import { Hono, type Context, type Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { csrf } from 'hono/csrf';
import { createSession, destroySession, hashPassword, loadUser, verifyPassword } from './auth';
import type { AppEnv, User } from './types';
import { adminPage, appPage, loginPage, registerPage, type AdminData, type Flash } from './views';

const app = new Hono<AppEnv>();

app.use('*', csrf());
app.use('*', async (c, next) => {
  c.set('user', await loadUser(c));
  await next();
});

// ---------- Hilfsfunktionen ----------

const isApi = (c: Context<AppEnv>) => c.req.path.startsWith('/api/') || c.req.path.startsWith('/admin/api/');
const fail = (c: Context<AppEnv>, message: string, status: 400 | 401 | 403 | 404 | 409 = 400) =>
  c.json({ status: 'error', message }, status);

const requireLogin = async (c: Context<AppEnv>, next: Next) => {
  if (c.get('user')) return next();
  return isApi(c) ? fail(c, 'Nicht angemeldet', 401) : c.redirect('/login');
};

const requireEditor = async (c: Context<AppEnv>, next: Next) => {
  const user = c.get('user');
  if (!user) return fail(c, 'Nicht angemeldet', 401);
  if (!user.can_edit && !user.is_admin) return fail(c, 'Du hast nur Leserechte.', 403);
  return next();
};

const requireAdmin = async (c: Context<AppEnv>, next: Next) => {
  const user = c.get('user');
  if (user?.is_admin) return next();
  if (isApi(c)) return fail(c, 'Keine Berechtigung', 403);
  return user ? c.text('Keine Berechtigung', 403) : c.redirect('/login');
};

function flashFromQuery(c: Context<AppEnv>): Flash | null {
  const ok = c.req.query('ok');
  const err = c.req.query('err');
  if (err) return { type: 'danger', text: err };
  if (ok) return { type: 'success', text: ok };
  return null;
}

const back = (c: Context<AppEnv>, kind: 'ok' | 'err', msg: string) => c.redirect(`/admin?${kind}=${encodeURIComponent(msg)}`);

const str = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);

function coord(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Zeitstempel wie in der Excel-Vorlage: "YYYY-MM-DD HH:MM:SS" (österreichische Zeit). */
function nowString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

function newLinkId(): string {
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('');
  return 'L' + rnd + Date.now().toString(36);
}

// ---------- Kästen laden (Format wie die "Records" der HTML-Vorlage) ----------

type KastenRow = {
  id: number; nr: string; kuerzel: string; to_nr: string; bauleiter: string; datum: string;
  lat: number | null; lng: number | null; link: string; info: string;
};
type VerbandRow = { link_id: string; suffix: string; from_id: number; from_nr: string; to_id: number | null; to_nr: string | null };

export type Verband = { direction: 'abgehend' | 'ankommend'; suffix: string; fullName: string; linkId: string; remoteKasten: string };

async function loadKaesten(db: D1Database, filter: { kuerzel?: string; bl?: string; to?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.kuerzel) { where.push('kuerzel = ?'); args.push(filter.kuerzel); }
  if (filter.bl) { where.push('bauleiter = ?'); args.push(filter.bl); }
  if (filter.to) { where.push('to_nr = ?'); args.push(filter.to); }
  const sql = `SELECT id, nr, kuerzel, to_nr, bauleiter, datum, lat, lng, link, info FROM kaesten
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY kuerzel, nr`;
  const kaesten = (await db.prepare(sql).bind(...args).all<KastenRow>()).results;

  const vsql = `SELECT v.link_id, v.suffix, v.from_id, f.nr AS from_nr, v.to_id, t.nr AS to_nr
                  FROM verbaende v JOIN kaesten f ON f.id = v.from_id LEFT JOIN kaesten t ON t.id = v.to_id
                  ${filter.kuerzel ? 'WHERE f.kuerzel = ?1 OR t.kuerzel = ?1' : ''} ORDER BY v.rowid`;
  const vstmt = db.prepare(vsql);
  const verbaende = (await (filter.kuerzel ? vstmt.bind(filter.kuerzel) : vstmt).all<VerbandRow>()).results;

  const byId = new Map<number, Verband[]>();
  const push = (id: number, v: Verband) => {
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push(v);
  };
  for (const v of verbaende) {
    const fullName = `${v.from_nr}_${v.suffix}`;
    push(v.from_id, { direction: 'abgehend', suffix: v.suffix, fullName, linkId: v.link_id, remoteKasten: v.to_nr ?? '' });
    if (v.to_id) push(v.to_id, { direction: 'ankommend', suffix: v.suffix, fullName, linkId: v.link_id, remoteKasten: v.from_nr });
  }

  return kaesten.map((k) => ({
    id: k.id, nr: k.nr, sheet: k.kuerzel, to: k.to_nr, bl: k.bauleiter, dt: k.datum,
    lat: k.lat, lng: k.lng, link: k.link || (k.lat != null && k.lng != null ? `https://www.google.com/maps?q=${k.lat},${k.lng}` : ''),
    info: k.info, verbaende: byId.get(k.id) ?? [],
  }));
}

// ---------- Auth ----------

app.get('/login', (c) => (c.get('user') ? c.redirect('/') : c.html(loginPage(flashFromQuery(c)))));

app.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const username = str(form.username, 150);
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
  const username = str(form.username, 151);
  const password = String(form.password ?? '');
  if (!username || username.length > 150) return c.html(registerPage({ type: 'danger', text: 'Ungültiger Benutzername.' }), 400);
  if (password.length < 8) return c.html(registerPage({ type: 'danger', text: 'Passwort muss mindestens 8 Zeichen haben.' }), 400);

  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) return c.html(registerPage({ type: 'danger', text: 'Benutzername ist bereits vergeben.' }), 409);

  // Der allererste Benutzer wird automatisch Admin und ist sofort aktiv.
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const first = (count?.n ?? 0) === 0;
  const hash = await hashPassword(password);
  const res = await c.env.DB.prepare('INSERT INTO users (username, password_hash, is_admin, is_active, can_edit) VALUES (?, ?, ?, ?, 1)')
    .bind(username, hash, first ? 1 : 0, first ? 1 : 0)
    .run();

  if (first) {
    await createSession(c, Number(res.meta.last_row_id));
    return back(c, 'ok', 'Willkommen! Du bist der erste Benutzer und damit Admin. Importiere jetzt deine Excel.');
  }
  return c.redirect('/login?ok=' + encodeURIComponent('Registrierung erfolgreich. Ein Admin muss dein Konto noch freischalten.'));
});

app.post('/logout', async (c) => {
  await destroySession(c);
  return c.redirect('/login');
});

// ---------- Hauptanwendung ----------

app.get('/', requireLogin, (c) => c.html(appPage(c.get('user')!)));

app.use('/api/*', requireLogin);

app.get('/api/meta', async (c) => {
  const user = c.get('user')!;
  const [gebiete, bauleiter] = await Promise.all([
    c.env.DB.prepare('SELECT typ, name, kuerzel FROM gebiete ORDER BY name').all<{ typ: string; name: string; kuerzel: string }>(),
    c.env.DB.prepare('SELECT nachname, vorname, email FROM bauleiter ORDER BY nachname, vorname').all<{ nachname: string; vorname: string; email: string }>(),
  ]);
  const kuerzelMitDaten = (await c.env.DB.prepare('SELECT DISTINCT kuerzel FROM kaesten ORDER BY kuerzel').all<{ kuerzel: string }>()).results.map((r) => r.kuerzel);
  return c.json({
    user: { username: user.username, isAdmin: !!user.is_admin, canEdit: !!(user.can_edit || user.is_admin) },
    gemeinden: gebiete.results.filter((g) => g.typ === 'gemeinde').map(({ name, kuerzel }) => ({ name, kuerzel })),
    kgs: gebiete.results.filter((g) => g.typ === 'kg').map(({ name, kuerzel }) => ({ name, kuerzel })),
    bauleiter: bauleiter.results.map((b) => ({ name: b.vorname ? `${b.nachname} ${b.vorname}` : b.nachname, email: b.email })),
    kuerzelMitDaten,
  });
});

app.get('/api/kaesten', async (c) => {
  const kuerzel = str(c.req.query('kuerzel'), 20);
  const all = c.req.query('all') === '1';
  if (!kuerzel && !all) return fail(c, 'Gebiet fehlt.');
  return c.json(await loadKaesten(c.env.DB, { kuerzel, bl: str(c.req.query('bl')), to: str(c.req.query('to')) }));
});

/** "Nummern erzeugen": vergibt die niedrigsten freien Nummern KÜRZEL001, KÜRZEL002, … */
app.post('/api/kaesten/generate', requireEditor, async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const kuerzel = str(b.kuerzel, 20);
  const to = str(b.to, 100);
  const bl = str(b.bl, 150);
  const anzahl = Math.floor(Number(b.anzahl));
  if (!kuerzel) return fail(c, 'Kürzel fehlt.');
  if (!to) return fail(c, 'TO Nummer fehlt.');
  if (!bl) return fail(c, 'Bauleiter fehlt.');
  if (!anzahl || anzahl < 1 || anzahl > 500) return fail(c, 'Anzahl muss zwischen 1 und 500 liegen.');
  const known = await c.env.DB.prepare('SELECT 1 FROM gebiete WHERE kuerzel = ?').bind(kuerzel).first();
  if (!known) return fail(c, `Kürzel ${kuerzel} ist in den Stammdaten nicht bekannt.`);

  const user = c.get('user')!;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = new Set(
      (await c.env.DB.prepare('SELECT nr FROM kaesten WHERE nr LIKE ?').bind(kuerzel + '%').all<{ nr: string }>()).results.map((r) => r.nr),
    );
    const nrs: string[] = [];
    for (let i = 1; nrs.length < anzahl && i < 10000; i++) {
      const cand = kuerzel + String(i).padStart(3, '0');
      if (!existing.has(cand)) nrs.push(cand);
    }
    if (nrs.length < anzahl) return fail(c, 'Keine freie Nummer gefunden (Limit erreicht).', 409);
    const dt = nowString();
    try {
      await c.env.DB.batch(
        nrs.map((nr) =>
          c.env.DB.prepare('INSERT INTO kaesten (nr, kuerzel, to_nr, bauleiter, datum, created_by) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(nr, kuerzel, to, bl, dt, user.id),
        ),
      );
      return c.json({ status: 'success', nrs });
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e; // gleichzeitig vergeben -> neu versuchen
    }
  }
  return fail(c, 'Nummern wurden gleichzeitig vergeben, bitte erneut versuchen.', 409);
});

app.patch('/api/kaesten/:id', requireEditor, async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b) return fail(c, 'Ungültige Daten.');
  const sets: string[] = [];
  const args: unknown[] = [];
  const text: [string, string, number][] = [['nr', 'nr', 50], ['to', 'to_nr', 100], ['bl', 'bauleiter', 150], ['dt', 'datum', 50], ['link', 'link', 1000], ['info', 'info', 5000]];
  for (const [key, col, max] of text) {
    if (key in b) { sets.push(`${col} = ?`); args.push(str(b[key], max)); }
  }
  if ('nr' in b && !str(b.nr)) return fail(c, 'Nummer darf nicht leer sein.');
  if ('lat' in b || 'lng' in b) {
    const lat = coord(b.lat);
    const lng = coord(b.lng);
    if ((lat === null) !== (lng === null)) return fail(c, 'Lat und Lng müssen beide gesetzt oder beide leer sein.');
    sets.push('lat = ?', 'lng = ?');
    args.push(lat, lng);
  }
  if (!sets.length) return fail(c, 'Nichts zu ändern.');
  sets.push("updated_at = datetime('now')");
  try {
    const res = await c.env.DB.prepare(`UPDATE kaesten SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
    if (!res.meta.changes) return fail(c, 'Eintrag nicht gefunden.', 404);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(c, 'Diese Nummer existiert bereits.', 409);
    throw e;
  }
  return c.json({ status: 'success' });
});

app.delete('/api/kaesten/:id', requireEditor, async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM verbaende WHERE from_id = ?1 OR to_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM kaesten WHERE id = ?').bind(id),
  ]);
  return c.json({ status: 'success' });
});

// ---------- Verbände ----------

/** Abgehenden Verband anlegen, optional gleich mit Zielkasten. */
app.post('/api/verbaende', requireEditor, async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const fromId = Number(b.fromId);
  const toId = b.toId ? Number(b.toId) : null;
  const suffix = str(b.suffix, 200);
  if (!fromId || !suffix) return fail(c, 'Kasten und Suffix sind Pflicht.');
  if (toId === fromId) return fail(c, 'Ziel darf nicht der gleiche Kasten sein.');
  const linkId = newLinkId();
  try {
    await c.env.DB.prepare('INSERT INTO verbaende (link_id, from_id, to_id, suffix) VALUES (?, ?, ?, ?)').bind(linkId, fromId, toId, suffix).run();
  } catch (e) {
    const s = String(e);
    if (s.includes('UNIQUE')) return fail(c, 'Dieser Verband existiert bereits.', 409);
    if (s.includes('FOREIGN KEY')) return fail(c, 'Kasten nicht gefunden.', 404);
    throw e;
  }
  return c.json({ status: 'success', linkId });
});

/** Offenes Rohr einem ankommenden Kasten zuweisen. */
app.post('/api/verbaende/:linkId/assign', requireEditor, async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const toId = Number(b.toId);
  if (!toId) return fail(c, 'Kasten fehlt.');
  const res = await c.env.DB.prepare('UPDATE verbaende SET to_id = ? WHERE link_id = ? AND to_id IS NULL AND from_id != ?')
    .bind(toId, c.req.param('linkId'), toId)
    .run();
  if (!res.meta.changes) return fail(c, 'Rohr ist nicht mehr offen oder nicht gefunden.', 409);
  return c.json({ status: 'success' });
});

app.delete('/api/verbaende/:linkId', requireEditor, async (c) => {
  await c.env.DB.prepare('DELETE FROM verbaende WHERE link_id = ?').bind(c.req.param('linkId')).run();
  return c.json({ status: 'success' });
});

// ---------- Admin ----------

app.use('/admin', requireAdmin);
app.use('/admin/*', requireAdmin);

app.get('/admin', async (c) => {
  const db = c.env.DB;
  const [users, gebiete, bauleiter, stats] = await Promise.all([
    db.prepare('SELECT id, username, is_admin, is_active, can_edit FROM users ORDER BY is_active, username').all<User>(),
    db.prepare(
      `SELECT g.id, g.typ, g.name, g.kuerzel, (SELECT COUNT(*) FROM kaesten k WHERE k.kuerzel = g.kuerzel) AS anzahl
         FROM gebiete g ORDER BY anzahl DESC, g.name`,
    ).all<AdminData['gebiete'][number]>(),
    db.prepare('SELECT id, nachname, vorname, email FROM bauleiter ORDER BY nachname, vorname').all<AdminData['bauleiter'][number]>(),
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM kaesten) AS kaesten, (SELECT COUNT(*) FROM kaesten WHERE lat IS NOT NULL) AS mitStandort,
              (SELECT COUNT(*) FROM verbaende) AS verbaende, (SELECT COUNT(*) FROM gebiete) AS gebiete`,
    ).first<AdminData['stats']>(),
  ]);
  return c.html(
    adminPage(c.get('user')!, { users: users.results, gebiete: gebiete.results, bauleiter: bauleiter.results, stats: stats! }, flashFromQuery(c)),
  );
});

app.post('/admin/users/:id/:action{activate|deactivate|toggle-admin|toggle-edit|delete}', async (c) => {
  const id = Number(c.req.param('id'));
  const action = c.req.param('action');
  if (id === c.get('user')!.id) return back(c, 'err', 'Das eigene Konto kann hier nicht geändert werden.');
  const db = c.env.DB;
  if (action === 'activate') await db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').bind(id).run();
  if (action === 'deactivate')
    await db.batch([db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(id), db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]);
  if (action === 'toggle-admin') await db.prepare('UPDATE users SET is_admin = 1 - is_admin WHERE id = ?').bind(id).run();
  if (action === 'toggle-edit') await db.prepare('UPDATE users SET can_edit = 1 - can_edit WHERE id = ?').bind(id).run();
  if (action === 'delete')
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      db.prepare('UPDATE kaesten SET created_by = NULL WHERE created_by = ?').bind(id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ]);
  return back(c, 'ok', 'Benutzer aktualisiert.');
});

app.post('/admin/gebiete', async (c) => {
  const f = await c.req.parseBody();
  const typ = f.typ === 'kg' ? 'kg' : 'gemeinde';
  const name = str(f.name, 150);
  const kuerzel = str(f.kuerzel, 20).toUpperCase();
  if (!name || !kuerzel) return back(c, 'err', 'Name und Kürzel sind Pflicht.');
  await c.env.DB.prepare('INSERT INTO gebiete (typ, name, kuerzel) VALUES (?, ?, ?) ON CONFLICT (typ, name) DO UPDATE SET kuerzel = excluded.kuerzel')
    .bind(typ, name, kuerzel)
    .run();
  return back(c, 'ok', `${name} (${kuerzel}) gespeichert.`);
});

app.post('/admin/gebiete/:id/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM gebiete WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return back(c, 'ok', 'Gebiet aus den Stammdaten entfernt (Kästen bleiben erhalten).');
});

app.post('/admin/bauleiter', async (c) => {
  const f = await c.req.parseBody();
  const nachname = str(f.nachname, 100);
  if (!nachname) return back(c, 'err', 'Nachname ist Pflicht.');
  await c.env.DB.prepare(
    'INSERT INTO bauleiter (nachname, vorname, email) VALUES (?, ?, ?) ON CONFLICT (nachname, vorname) DO UPDATE SET email = excluded.email',
  )
    .bind(nachname, str(f.vorname, 100), str(f.email, 200))
    .run();
  return back(c, 'ok', 'Bauleiter gespeichert.');
});

app.post('/admin/bauleiter/:id/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM bauleiter WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return back(c, 'ok', 'Bauleiter entfernt.');
});

// ----- Excel-Import (die Mappe wird im Browser gelesen und in Teilen geschickt) -----

app.post('/admin/api/import/stammdaten', async (c) => {
  const b = await c.req.json<{
    gemeinden?: { name: string; kuerzel: string; bezirk?: string }[];
    kgs?: { name: string; kuerzel: string }[];
    bauleiter?: { nachname: string; vorname?: string; email?: string }[];
  }>();
  const db = c.env.DB;
  const stmts: D1PreparedStatement[] = [];
  const geb = db.prepare(
    'INSERT INTO gebiete (typ, name, kuerzel, bezirk) VALUES (?, ?, ?, ?) ON CONFLICT (typ, name) DO UPDATE SET kuerzel = excluded.kuerzel, bezirk = excluded.bezirk',
  );
  for (const g of b.gemeinden ?? []) if (str(g.name) && str(g.kuerzel)) stmts.push(geb.bind('gemeinde', str(g.name, 150), str(g.kuerzel, 20), str(g.bezirk, 100)));
  for (const g of b.kgs ?? []) if (str(g.name) && str(g.kuerzel)) stmts.push(geb.bind('kg', str(g.name, 150), str(g.kuerzel, 20), ''));
  const bl = db.prepare(
    'INSERT INTO bauleiter (nachname, vorname, email) VALUES (?, ?, ?) ON CONFLICT (nachname, vorname) DO UPDATE SET email = excluded.email',
  );
  for (const p of b.bauleiter ?? []) if (str(p.nachname)) stmts.push(bl.bind(str(p.nachname, 100), str(p.vorname, 100), str(p.email, 200)));
  if (stmts.length > 2000) return fail(c, 'Zu viele Zeilen.');
  if (stmts.length) await db.batch(stmts);
  return c.json({ status: 'success', count: stmts.length });
});

type ImportRow = { kuerzel: string; nr: string; to?: string; bl?: string; dt?: string; lat?: unknown; lng?: unknown; link?: string; info?: string };

app.post('/admin/api/import/kaesten', async (c) => {
  const b = await c.req.json<{ rows?: ImportRow[]; overwrite?: boolean }>();
  const rows = b.rows ?? [];
  if (rows.length > 500) return fail(c, 'Maximal 500 Zeilen pro Anfrage.');
  const sql = b.overwrite
    ? `INSERT INTO kaesten (nr, kuerzel, to_nr, bauleiter, datum, lat, lng, link, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (nr) DO UPDATE SET kuerzel = excluded.kuerzel, to_nr = excluded.to_nr, bauleiter = excluded.bauleiter,
         datum = excluded.datum, lat = excluded.lat, lng = excluded.lng, link = excluded.link, info = excluded.info, updated_at = datetime('now')`
    : 'INSERT OR IGNORE INTO kaesten (nr, kuerzel, to_nr, bauleiter, datum, lat, lng, link, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const stmt = c.env.DB.prepare(sql);
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const nr = str(r.nr, 50);
    const kuerzel = str(r.kuerzel, 20);
    if (!nr || !kuerzel) continue;
    let lat = coord(r.lat);
    let lng = coord(r.lng);
    if (lat === null || lng === null) lat = lng = null;
    stmts.push(stmt.bind(nr, kuerzel, str(r.to, 100), str(r.bl, 150), str(r.dt, 50), lat, lng, str(r.link, 1000), str(r.info, 5000)));
  }
  const res = stmts.length ? await c.env.DB.batch(stmts) : [];
  const written = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return c.json({ status: 'success', written, skipped: stmts.length - written });
});

app.post('/admin/api/import/verbaende', async (c) => {
  const b = await c.req.json<{ items?: { linkId: string; fromNr: string; toNr?: string; suffix: string }[] }>();
  const items = b.items ?? [];
  if (items.length > 500) return fail(c, 'Maximal 500 Verbände pro Anfrage.');
  const stmt = c.env.DB.prepare(
    `INSERT OR IGNORE INTO verbaende (link_id, from_id, to_id, suffix)
     SELECT ?1, f.id, (SELECT t.id FROM kaesten t WHERE t.nr = ?3), ?4 FROM kaesten f WHERE f.nr = ?2`,
  );
  const stmts = items
    .filter((v) => str(v.linkId) && str(v.fromNr) && str(v.suffix))
    .map((v) => stmt.bind(str(v.linkId, 100), str(v.fromNr, 50), str(v.toNr, 50) || null, str(v.suffix, 200)));
  const res = stmts.length ? await c.env.DB.batch(stmts) : [];
  const written = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  return c.json({ status: 'success', written, skipped: stmts.length - written });
});

app.notFound((c) => c.text('Seite nicht gefunden', 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  if (isApi(c)) return c.json({ status: 'error', message: 'Serverfehler' }, 500);
  return c.text('Serverfehler', 500);
});

export default app;
