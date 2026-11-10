(function () {
  'use strict';

  var map = L.map('map').setView([48.06, 14.18], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap-Mitwirkende',
  }).addTo(map);

  var statusEl = document.getElementById('status');
  var areaLayer = L.featureGroup().addTo(map);
  var entryLayer = L.featureGroup().addTo(map);
  var colors = { Kasten: '#0d6efd', Schacht: '#dc3545' };

  function setStatus(text, cls) {
    statusEl.textContent = text || '';
    statusEl.className = 'small ms-auto ' + (cls || 'text-muted');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function currentTyp() {
    var el = document.querySelector('input[name="typ"]:checked');
    return el ? el.value : 'Kasten';
  }

  function addMarker(e) {
    var marker = L.circleMarker([e.lat, e.lng], {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: colors[e.typ] || '#6c757d',
      fillOpacity: 0.9,
    });
    var canDelete = window.FF_USER.isAdmin || e.created_by === window.FF_USER.id;
    var popup =
      '<strong>' + escapeHtml(e.nr) + '</strong><br>' +
      escapeHtml(e.typ) + ' · ' + escapeHtml(e.area) + '<br>' +
      '<small>' + e.lat.toFixed(6) + ', ' + e.lng.toFixed(6) + '</small>' +
      (canDelete ? '<br><button class="btn btn-sm btn-outline-danger mt-1" data-del="' + e.id + '">Löschen</button>' : '');
    marker.bindPopup(popup);
    marker.entryId = e.id;
    marker.addTo(entryLayer);
    return marker;
  }

  function loadData() {
    setStatus('Lade Daten …');
    Promise.all([
      fetch('/api/areas').then(function (r) { return r.json(); }),
      fetch('/api/entries').then(function (r) { return r.json(); }),
    ])
      .then(function (res) {
        var areas = res[0];
        var entries = res[1];
        areaLayer.clearLayers();
        entryLayer.clearLayers();
        areas.forEach(function (a) {
          if (!a.geojson) return;
          L.geoJSON(a.geojson, {
            interactive: false,
            style: { color: '#198754', weight: 2, fillOpacity: 0.05 },
          }).addTo(areaLayer);
        });
        entries.forEach(addMarker);
        var bounds = areaLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
        if (!areas.length) setStatus('Dir sind noch keine Gebiete zugewiesen.', 'text-warning');
        else setStatus(entries.length + ' Punkte in ' + areas.length + ' Gebiet(en)');
      })
      .catch(function () { setStatus('Fehler beim Laden der Daten.', 'text-danger'); });
  }

  map.on('click', function (ev) {
    var typ = currentTyp();
    setStatus('Speichere …');
    fetch('/api/save_point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: ev.latlng.lat, lng: ev.latlng.lng, typ: typ }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'success') {
          addMarker({
            id: data.id, nr: data.nr, typ: data.typ, area: data.area,
            lat: ev.latlng.lat, lng: ev.latlng.lng, created_by: window.FF_USER.id,
          }).openPopup();
          setStatus(data.nr + ' gespeichert.', 'text-success');
        } else {
          setStatus(data.message || 'Fehler', 'text-danger');
        }
      })
      .catch(function () { setStatus('Netzwerkfehler.', 'text-danger'); });
  });

  // Loeschen-Button im Popup
  map.on('popupopen', function (ev) {
    var btn = ev.popup.getElement().querySelector('[data-del]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!confirm('Punkt wirklich löschen?')) return;
      var id = btn.getAttribute('data-del');
      fetch('/api/entries/' + id, { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.status !== 'success') return setStatus(data.message || 'Fehler', 'text-danger');
          entryLayer.eachLayer(function (l) { if (String(l.entryId) === id) entryLayer.removeLayer(l); });
          setStatus('Punkt gelöscht.', 'text-success');
        });
    });
  });

  loadData();
})();
