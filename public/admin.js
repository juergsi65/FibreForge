(function () {
  'use strict';

  var logEl = document.getElementById('import-log');

  function log(line) {
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // Liest CSV/XLSX/XLSM im Browser und liefert Zeilen als Objekte (Spaltenname -> Wert).
  function readRows(input) {
    var file = input.files && input.files[0];
    if (!file) return Promise.reject(new Error('Bitte zuerst eine Datei auswählen.'));
    return file.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      var sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { defval: '' });
    });
  }

  // Spalte case-insensitiv und tolerant gegenueber Umlauten/Leerzeichen finden.
  function norm(s) {
    return String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  }
  function pick(row, names) {
    var keys = Object.keys(row);
    for (var i = 0; i < names.length; i++) {
      for (var k = 0; k < keys.length; k++) {
        if (norm(keys[k]) === norm(names[i])) return row[keys[k]];
      }
    }
    return '';
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function withButton(btn, fn) {
    btn.disabled = true;
    logEl.textContent = '';
    return fn()
      .catch(function (e) { log('Fehler: ' + e.message); })
      .finally(function () { btn.disabled = false; });
  }

  var areasBtn = document.getElementById('areas-import');
  areasBtn.addEventListener('click', function () {
    withButton(areasBtn, async function () {
      var rows = await readRows(document.getElementById('areas-file'));
      log('Lade Grenzen für ' + rows.length + ' Gebiete …');
      for (var i = 0; i < rows.length; i++) {
        var name = String(pick(rows[i], ['Name', 'Gemeinde', 'Gebiet'])).trim();
        var kuerzel = String(pick(rows[i], ['Kuerzel', 'Kürzel', 'Kurz'])).trim();
        if (!name || !kuerzel) { log('Zeile ' + (i + 2) + ': Name oder Kürzel fehlt, übersprungen.'); continue; }
        var geojson = pick(rows[i], ['GeoJSON', 'Grenze']) || undefined;
        var res = await postJson('/admin/api/areas', { name: name, kuerzel: kuerzel, geojson: geojson });
        log((res.status === 'success' ? '✅ ' : '⚠️ ') + res.message);
        // OpenStreetMap/Nominatim erlaubt max. 1 Anfrage pro Sekunde.
        if (!geojson && !/existiert bereits/.test(res.message)) await sleep(1100);
      }
      log('Fertig. Seite neu laden, um die Gebietsliste zu aktualisieren.');
    });
  });

  var entriesBtn = document.getElementById('entries-import');
  entriesBtn.addEventListener('click', function () {
    withButton(entriesBtn, async function () {
      var rows = await readRows(document.getElementById('entries-file'));
      var mapped = rows.map(function (r) {
        return {
          nr: String(pick(r, ['Nummer', 'Nr', 'Number'])).trim(),
          typ: String(pick(r, ['Typ', 'Type'])).trim(),
          lat: pick(r, ['Breitengrad', 'Lat', 'Latitude', 'Breite']),
          lng: pick(r, ['Längengrad', 'Laengengrad', 'Lng', 'Lon', 'Longitude', 'Länge']),
        };
      }).filter(function (r) { return r.nr; });
      log('Importiere ' + mapped.length + ' Zeilen …');
      var total = { inserted: 0, skipped: 0, errors: [] };
      for (var i = 0; i < mapped.length; i += 500) {
        var res = await postJson('/admin/api/entries', { rows: mapped.slice(i, i + 500) });
        if (res.status !== 'success') throw new Error(res.message || 'Import fehlgeschlagen');
        total.inserted += res.inserted;
        total.skipped += res.skipped;
        total.errors = total.errors.concat(res.errors);
        log('… ' + Math.min(i + 500, mapped.length) + ' / ' + mapped.length);
      }
      log('✅ ' + total.inserted + ' neu, ' + total.skipped + ' bereits vorhanden, ' + total.errors.length + ' Fehler.');
      total.errors.slice(0, 50).forEach(function (e) { log('⚠️ ' + e); });
      if (total.errors.length > 50) log('… und ' + (total.errors.length - 50) + ' weitere Fehler.');
    });
  });
})();
