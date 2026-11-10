-- Umstellung auf die Logik der Nummernverwaltung (Gebiets-Kürzel + laufende Nummer, Verbände)

DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS user_areas;
DROP TABLE IF EXISTS areas;

-- Benutzer: Lesen oder Bearbeiten
ALTER TABLE users ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 1;

-- Gemeinden OÖ und Linzer Katastralgemeinden (KG)
CREATE TABLE IF NOT EXISTS gebiete (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  typ     TEXT NOT NULL CHECK (typ IN ('gemeinde', 'kg')),
  name    TEXT NOT NULL,
  kuerzel TEXT NOT NULL,
  bezirk  TEXT NOT NULL DEFAULT '',
  UNIQUE (typ, name)
);

-- Projektleiter / Bauleiter
CREATE TABLE IF NOT EXISTS bauleiter (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nachname TEXT NOT NULL,
  vorname  TEXT NOT NULL DEFAULT '',
  email    TEXT NOT NULL DEFAULT '',
  UNIQUE (nachname, vorname)
);

-- Kästen / Schächte (entspricht einer Zeile in einem Kürzel-Blatt der Excel)
CREATE TABLE IF NOT EXISTS kaesten (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nr         TEXT NOT NULL UNIQUE,
  kuerzel    TEXT NOT NULL,
  to_nr      TEXT NOT NULL DEFAULT '',
  bauleiter  TEXT NOT NULL DEFAULT '',
  datum      TEXT NOT NULL DEFAULT '',
  lat        REAL,
  lng        REAL,
  link       TEXT NOT NULL DEFAULT '',
  info       TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kaesten_kuerzel ON kaesten(kuerzel);

-- Verbände / Rohre: abgehend von from_id, ankommend bei to_id (NULL = offenes Rohr)
CREATE TABLE IF NOT EXISTS verbaende (
  link_id    TEXT PRIMARY KEY,
  from_id    INTEGER NOT NULL REFERENCES kaesten(id) ON DELETE CASCADE,
  to_id      INTEGER REFERENCES kaesten(id) ON DELETE CASCADE,
  suffix     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_id, suffix)
);
CREATE INDEX IF NOT EXISTS idx_verbaende_to ON verbaende(to_id);
