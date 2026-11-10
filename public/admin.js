(function () {
  'use strict';

  var logEl = document.getElementById('import-log');
  function log(line) {
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.status !== 'success') throw new Error(j.message || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function cell(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  // Excel-Datum (Seriennummer) in Text wie "20.11.2024 10:47:39" umwandeln
  function dateText(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = XLSX.SSF.parse_date_code(v);
      var p = function (n) { return String(n).padStart(2, '0'); };
      if (d) return p(d.d) + '.' + p(d.m) + '.' + d.y + ' ' + p(d.H) + ':' + p(d.M) + ':' + p(Math.floor(d.S));
    }
    return cell(v);
  }

  function aoa(wb, name) {
    var ws = wb.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) : [];
  }

  function chunks(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  // ---------- Import ----------
  var importBtn = document.getElementById('wb-import');
  importBtn.addEventListener('click', async function () {
    var file = document.getElementById('wb-file').files[0];
    if (!file) return alert('Bitte zuerst die Excel-Datei auswählen.');
    var overwrite = document.getElementById('wb-overwrite').checked;
    importBtn.disabled = true;
    logEl.textContent = '';
    try {
      log('Lese ' + file.name + ' …');
      var wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });

      // 1. Stammdaten (gleiche Spalten wie in der HTML-Vorlage)
      var gemeinden = aoa(wb, 'Gemeinden OÖ').slice(1)
        .map(function (r) { return { name: cell(r[1]), kuerzel: cell(r[7]), bezirk: cell(r[4]) }; })
        .filter(function (g) { return g.name && g.kuerzel; });
      var kgs = aoa(wb, 'Linz KGs').slice(1)
        .map(function (r) { return { name: cell(r[1]), kuerzel: cell(r[2]) }; })
        .filter(function (g) { return g.name && g.kuerzel; });
      var bauleiter = aoa(wb, 'Projektleiter').slice(1)
        .map(function (r) { return { nachname: cell(r[0]), vorname: cell(r[1]), email: cell(r[2]) }; })
        .filter(function (b) { return b.nachname; });
      await postJson('/admin/api/import/stammdaten', { gemeinden: gemeinden, kgs: kgs, bauleiter: bauleiter });
      log('✅ Stammdaten: ' + gemeinden.length + ' Gemeinden, ' + kgs.length + ' KGs, ' + bauleiter.length + ' Bauleiter');

      // 2. Kürzel-Blätter (A1 = "Nummer")
      var rows = [];
      var verbaende = new Map();
      var incomingOnly = [];
      wb.SheetNames.forEach(function (name) {
        var ws = wb.Sheets[name];
        if (!ws || !ws.A1 || ws.A1.v !== 'Nummer') return;
        aoa(wb, name).slice(1).forEach(function (r) {
          var nr = cell(r[0]);
          if (!nr) return;
          // Text statt Koordinate in Lat/Lng (z.B. "Planung") nicht verlieren -> ins Info-Feld
          var info = cell(r[7]);
          [r[4], r[5]].forEach(function (v) {
            var t = cell(v);
            if (t && !isFinite(Number(t.replace(',', '.')))) info = info ? info + ' | ' + t : t;
          });
          rows.push({
            kuerzel: name, nr: nr, to: cell(r[1]), bl: cell(r[2]), dt: dateText(r[3]),
            lat: r[4], lng: r[5], link: cell(r[6]), info: info,
          });
          var list = [];
          try { list = JSON.parse(cell(r[8]) || '[]'); } catch (e) { list = []; }
          (Array.isArray(list) ? list : []).forEach(function (v) {
            if (!v || !v.linkId || !v.suffix) return;
            if (v.direction === 'ankommend') incomingOnly.push({ linkId: v.linkId, fromNr: v.remoteKasten, toNr: nr, suffix: v.suffix });
            else verbaende.set(v.linkId, { linkId: v.linkId, fromNr: nr, toNr: v.remoteKasten || '', suffix: v.suffix });
          });
        });
      });
      // Ankommende Einträge ohne passende abgehende Seite trotzdem übernehmen
      incomingOnly.forEach(function (v) { if (!verbaende.has(v.linkId) && v.fromNr) verbaende.set(v.linkId, v); });

      log('Importiere ' + rows.length + ' Nummern …');
      var written = 0, skipped = 0;
      for (var part of chunks(rows, 400)) {
        var res = await postJson('/admin/api/import/kaesten', { rows: part, overwrite: overwrite });
        written += res.written; skipped += res.skipped;
      }
      log('✅ Nummern: ' + written + (overwrite ? ' geschrieben' : ' neu') + ', ' + skipped + ' übersprungen (bereits vorhanden)');

      var vlist = Array.from(verbaende.values());
      var vw = 0, vs = 0;
      for (var vpart of chunks(vlist, 400)) {
        var vres = await postJson('/admin/api/import/verbaende', { items: vpart });
        vw += vres.written; vs += vres.skipped;
      }
      log('✅ Verbände: ' + vw + ' neu, ' + vs + ' übersprungen');
      log('Fertig. Seite neu laden, um die Übersicht zu aktualisieren.');
    } catch (e) {
      log('❌ Fehler: ' + ((e && e.message) || e));
    } finally {
      importBtn.disabled = false;
    }
  });

  // ---------- Sicherung im alten Excel-Format ----------
  var backupBtn = document.getElementById('wb-backup');
  backupBtn.addEventListener('click', async function () {
    backupBtn.disabled = true;
    try {
      var meta = await fetch('/api/meta').then(function (r) { return r.json(); });
      var recs = await fetch('/api/kaesten?all=1').then(function (r) { return r.json(); });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Neuanlage']]), 'Neuanlage');
      var g = [['Gemeinde kennziffer', 'Gemeindename', 'PLZ des Gem.Amtes', 'weitere Postleitzahlen', 'Bezirk', 'Viertel', 'Bundesland', 'Kürzel']];
      meta.gemeinden.forEach(function (x) { g.push(['', x.name, '', '', '', '', 'Oberösterreich', x.kuerzel]); });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g), 'Gemeinden OÖ');
      var k = [['KG-Nr.', 'KG-Name', 'Kürzel 1']];
      meta.kgs.forEach(function (x) { k.push(['', x.name, x.kuerzel]); });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(k), 'Linz KGs');
      var p = [['Nachname', 'Vorname', 'Email']];
      meta.bauleiter.forEach(function (x) {
        var parts = x.name.split(' ');
        p.push([parts[0], parts.slice(1).join(' '), x.email]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(p), 'Projektleiter');

      var bySheet = new Map();
      recs.forEach(function (r) {
        if (!bySheet.has(r.sheet)) bySheet.set(r.sheet, []);
        bySheet.get(r.sheet).push(r);
      });
      bySheet.forEach(function (list, sheet) {
        var rows = [['Nummer', 'TO-Nummer', 'Bauleiter', 'Datum/Uhrzeit', 'Lat', 'Lng', 'GoogleMapsLink', 'Info', 'Verbaende']];
        list.forEach(function (r) {
          var ver = r.verbaende.map(function (v) {
            return { direction: v.direction, suffix: v.suffix, fullName: v.fullName, linkId: v.linkId, remoteKasten: v.remoteKasten };
          });
          rows.push([r.nr, r.to, r.bl, r.dt, r.lat == null ? '' : r.lat, r.lng == null ? '' : r.lng, r.link, r.info, JSON.stringify(ver)]);
        });
        var ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 38 }, { wch: 52 }, { wch: 80 }];
        XLSX.utils.book_append_sheet(wb, ws, String(sheet).slice(0, 31));
      });
      var d = new Date();
      var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      XLSX.writeFile(wb, 'FibreForge_Sicherung_' + stamp + '.xlsx');
    } catch (e) {
      alert('Sicherung fehlgeschlagen: ' + e.message);
    } finally {
      backupBtn.disabled = false;
    }
  });
})();
