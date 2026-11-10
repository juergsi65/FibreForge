// Markup der Hauptansicht (übernommen aus "Neue_Nummern_Labels_sauber.html", ohne Excel-Datei-Buttons)
export const APP_MARKUP = String.raw`<div id="qrOffscreen"></div>

 <!-- Export modal -->
<div id="exportModalOverlay">
  <div class="modal">
    <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">
      <h3>Export</h3>
      <span id="exportModalInfo" class="badge"></span>
    </div>

    <div class="modalGrid">
      <div class="card" style="padding:12px;">
        <strong>Export-Art</strong>
        <div style="margin-top:10px;">
          <label class="small" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="radio" name="exportMode" value="classic" checked />
            Haupt-Export (Excel, bzw. PDF bei Bauleiter-Filter)
          </label>
          <label class="small" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="radio" name="exportMode" value="connections" />
            Verband-Export / Beschriftungsauftrag PDF
          </label>
          <label class="small" style="display:flex; gap:8px; align-items:center;">
            <input type="radio" name="exportMode" value="qr" />
            Beschriftungs-Labels für Kästen + QR-Labels für Verbände/Kabel
          </label>
        </div>

        <div class="divider"></div>

        <strong>Bereich</strong>
        <div style="margin-top:10px;">
          <label class="small" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="radio" name="exportScope" value="active" checked />
            Nur aktuelles Gebiet
          </label>
          <label class="small" style="display:flex; gap:8px; align-items:center;">
            <input type="radio" name="exportScope" value="workbook" />
            Alle Gebiete
          </label>
        </div>

        <div class="divider"></div>

        <strong>Filter</strong>
        <div style="margin-top:10px;">
          <label class="small" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="checkbox" id="exportFilterBauleiter" checked />
            Bauleiter filtern (Spezial-Export = PDF)
          </label>
          <label class="small" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="checkbox" id="exportFilterGebiet" checked />
            Gebiet/Kürzel filtern (nur für „Alle Gebiete“)
          </label>
          <label class="small" style="display:flex; gap:8px; align-items:center;">
            <input type="checkbox" id="exportFilterTO" />
            TO/Projekt-Nummer filtern
          </label>
        </div>

        <div class="divider"></div>

        <strong>Label PDF (P-touch / druckbar)</strong>
        <div style="margin-top:10px;">
          <label class="small" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="checkbox" id="exportAsLabels" checked style="display:none;" />
            Labels erzeugen
          </label>

          <div class="row" style="margin-bottom:8px;">
            <label>Label-Art</label>
            <select id="qrLabelType">
              <option value="all">Kästen + Kabel/Verbände</option>
              <option value="kasten">Nur Kästen/Schächte</option>
              <option value="verband">Nur Verbände/Rohre</option>
              <option value="kabel">Nur Kabel/Rohre</option>
            </select>
          </div>

          <div class="row" style="margin-bottom:0;">
            <label>Label-Größe</label>
            <select id="labelSize">
              <option value="62x29">62×29 mm (DK-11209)</option>
              <option value="29x90">29×90 mm (DK-11201)</option>
              <option value="38x90">38×90 mm (DK-11203)</option>
            </select>
          </div>

          <label class="small" style="display:flex; gap:8px; align-items:center; margin-top:10px;">
            <input type="checkbox" id="labelsOnlyWithLocation" checked />
            Bei Verband/Kabel nur Labels mit Ziel-/Standortlink
          </label>

          <label class="small" style="display:flex; gap:8px; align-items:center; margin-top:6px;">
            <input type="checkbox" id="labelsOnePerPage" checked />
            1 Label pro Seite / einzeln druckbar
          </label>

          <div class="hint" style="margin-top:8px;">
            Kasten-Labels zeigen oben den Kasten und darunter die ankommenden/abgehenden Verbände – ohne QR. Verband-/Kabel-Labels zeigen Name, von/bis und einen QR-Code zum Zielkasten, falls vorhanden.
          </div>
        </div>
      </div>

      <div class="card" style="padding:12px;">
        <strong>Auswahl</strong>

        <div class="row" style="margin-top:10px;">
          <label>Bauleiter</label>
          <select id="exportBauleiterSelect">
            <option value="">(alle)</option>
          </select>
        </div>

        <div class="row">
          <label>Gebiet/Kürzel</label>
          <select id="exportGebietSelect">
            <option value="">(alle)</option>
          </select>
        </div>

        <div class="row">
          <label>TO/Projekt</label>
          <input id="exportTO" placeholder="z.B. TO-12345" />
        </div>

        <div class="row">
          <label>Dateiname</label>
          <input id="exportName" placeholder="leer = automatisch" />
        </div>
      </div>
    </div>

    <div class="modalActions">
      <button class="secondary" id="exportCancelBtn" type="button">Abbrechen</button>
      <button class="primary" id="exportDownloadBtn" type="button">Export (Download)</button>
    </div>
  </div>
</div>

<!-- Detail modal -->
<div id="detailOverlay">
  <div class="modal">
    <div class="detailTop">
      <h3 id="detailTitle">Kasten-Detail</h3>
      <div>
        <span class="badge incoming">Ankommend: <span id="countIncoming">0</span></span>
        <span class="badge outgoing">Abgehend: <span id="countOutgoing">0</span></span>
      </div>
    </div>

    <div class="detailMeta">
      <div class="box"><div class="k">Nummer</div><div class="v" id="detailNr">-</div></div>
      <div class="box"><div class="k">TO</div><div class="v" id="detailTO">-</div></div>
      <div class="box"><div class="k">Bauleiter</div><div class="v" id="detailBL">-</div></div>
      <div class="box"><div class="k">Standort</div><div class="v" id="detailLoc">-</div></div>
    </div>

    <div class="detailCenter">
      <div class="sideBox">
        <h4>Ankommend</h4>
        <div id="incomingList"></div>
      </div>

      <div class="centerKasten" id="centerKasten">-</div>

      <div class="sideBox">
        <h4>Abgehend</h4>
        <div id="outgoingList"></div>
      </div>
    </div>

    <div class="formBox">
      <div class="formGrid">
        <div class="f">
          <label>Richtung</label>
          <select id="verbandDirection">
            <option value="abgehend">abgehend</option>
            <option value="ankommend">ankommend</option>
          </select>
        </div>

        <div class="f">
          <label>Vorlage / offenes Rohr</label>
          <select id="verbandChoose">
            <option value="">(optional wählen)</option>
          </select>
        </div>

        <div class="f">
          <label>Suffix-Ende</label>
          <input id="verbandSuffixInput" placeholder="z.B. 7x14 oder 01-7x14" />
        </div>

        <div class="f">
          <label>Ziel/Quelle Kasten</label>
          <select id="verbandTarget">
            <option value="">(optional / kein Endkasten)</option>
          </select>
        </div>

        <div class="f">
          <button class="primary" id="addVerbandBtn" type="button">Verbindung anlegen</button>
        </div>
      </div>

      <div class="hint" style="margin-top:10px;">
        Abgehend kann ohne Endkasten angelegt werden. Das ergibt ein offenes Rohr. Bei ankommend wählst du ein offenes Rohr aus einem anderen Kasten.
      </div>
    </div>

    <div class="modalActions">
      <button class="secondary" id="closeDetailBtn" type="button">Schließen</button>
    </div>
  </div>
</div>

<!-- Edit modal -->
<div id="editOverlay">
  <div class="modal">
    <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">
      <h3 id="editTitle">Eintrag bearbeiten</h3>
      <span class="badge">Einzelbearbeitung</span>
    </div>

    <div class="modalGrid" style="margin-top:10px;">
      <div class="card" style="padding:12px;">
        <strong>Stammdaten</strong>
        <div class="row" style="margin-top:10px;"><label>Nummer</label><input id="editNr" /></div>
        <div class="row"><label>TO/Projekt</label><input id="editTO" /></div>
        <div class="row"><label>Bauleiter</label><input id="editBL" list="editBLList" /></div>
        <datalist id="editBLList"></datalist>
        <div class="row"><label>Datum/Uhrzeit</label><input id="editDate" /></div>
        <div class="row" style="margin-bottom:0;"><label>Info</label><textarea id="editInfo" placeholder="Info / Besonderheiten / Beschriftungshinweis"></textarea></div>
      </div>

      <div class="card" style="padding:12px;">
        <strong>Position / GPS</strong>
        <div class="row" style="margin-top:10px;"><label>Latitude</label><input id="editLat" placeholder="z.B. 48.306123" /></div>
        <div class="row"><label>Longitude</label><input id="editLng" placeholder="z.B. 14.286456" /></div>
        <div class="row"><label>Google Maps Link</label><input id="editLink" placeholder="wird aus Lat/Lng erzeugt oder Link einfügen" /></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="secondary" id="editBuildLinkBtn" type="button">Link aus Lat/Lng erzeugen</button>
          <button class="secondary" id="editParseLinkBtn" type="button">Koordinaten aus Link lesen</button>
          <button class="ghostDanger" id="editClearLocationBtn" type="button">Standort löschen</button>
        </div>
        <div class="hint">Position kann auch wie bisher durch Klick auf die Karte geändert werden. Hier kannst du sie zusätzlich manuell korrigieren oder einen Google-Maps-Link einfügen.</div>
      </div>
    </div>

    <div class="modalActions">
      <button class="secondary" id="editCancelBtn" type="button">Abbrechen</button>
      <button class="primary" id="editSaveBtn" type="button">Änderungen speichern</button>
    </div>
  </div>
</div>

<header>
  <div class="wrap">
    <span class="title">FibreForge · Nummernverwaltung + Karte</span>

    <label class="small" style="display:flex; gap:8px; align-items:center;" id="editModeLabel">
      <input type="checkbox" id="editModeToggle" />
      Bearbeiten aktivieren
    </label>

    <span class="spacer"></span>
    <span id="activeInfo" class="pill"></span>
    <span class="small">Hallo, __USERNAME__</span>
    __ADMINLINK__
    <form method="POST" action="/logout"><button class="linkBtn" type="submit">Abmelden</button></form>
  </div>
</header>

<div class="grid" id="appRoot">
  <div class="stack">
    <div class="card">
      <div class="row">
        <label>Gebiet</label>
        <select id="gebietSelect" disabled>
          <option value="">Lade…</option>
        </select>
      </div>

      <div class="row" id="kgRow" style="display:none;">
        <label>KG (nur Linz)</label>
        <select id="kgSelect">
          <option value="">Bitte wählen…</option>
        </select>
      </div>

      <div class="row">
        <label>Bauleiter</label>
        <select id="bauleiterSelect" disabled>
          <option value="">Lade…</option>
        </select>
      </div>

      <div class="row">
        <label>TO Nummer</label>
        <input id="toNummer" placeholder="z.B. TO-12345" />
      </div>

      <div class="row">
        <label>Anzahl Kästen</label>
        <input id="anzahl" type="number" min="1" value="1" />
      </div>

      <div class="row">
        <label>Gebiets-Kürzel</label>
        <input id="kuerzel" placeholder="wird automatisch gesetzt" readonly />
      </div>

      <div class="row">
        <label>Bauleiter E-Mail</label>
        <input id="bauleiterEmail" placeholder="wird automatisch gesetzt" readonly />
      </div>

      <div class="row">
        <label>Nach Standort setzen</label>
        <label class="small" style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="autoNextMissing" checked />
          automatisch nächste Zeile ohne Standort auswählen
        </label>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button class="primary" id="genBtn" type="button" disabled>Nummern erzeugen</button>
        <button class="secondary" id="exportOpenBtn" type="button" disabled>Export…</button>
        <button class="secondary" id="copyMailBtn" type="button" disabled>Mailtext kopieren</button>
        <button class="secondary" id="nextMissingBtn" type="button" disabled>Nächster ohne Standort</button>
        <button class="danger" id="deleteBtn" type="button" disabled>Eintrag löschen</button>
      </div>

      <div class="hint">
        Default ist „Nur ansehen“. Für Änderungen zuerst „Bearbeiten aktivieren“ anhaken.
      </div>
    </div>

    <div class="card">
      <div class="tableTop">
        <strong>Einträge im Gebiet</strong>
        <span id="status" class="small"></span>
      </div>

      <div class="filters">
        <label class="small"><input type="checkbox" id="onlyMissing" /> Nur ohne Standort</label>
        <label class="small"><input type="checkbox" id="onlyWith" /> Nur mit Standort</label>
        <input id="searchNr" placeholder="Suche Nummer / TO / Bauleiter / Info / Verband…" style="flex:1; min-width:200px;" />
        <select id="verbandQuickSelect" style="min-width:260px;">
          <option value="">Verband auswählen / anzeigen…</option>
        </select>
        <button id="clearSearchTbl" type="button">Reset</button>
      </div>

      <div class="tableWrap">
        <table id="tbl">
          <thead>
            <tr>
              <th class="col-nr">Nr</th>
              <th class="col-to">TO</th>
              <th class="col-bl">Bauleiter</th>
              <th class="col-date">Datum</th>
              <th class="col-info">Info</th>
              <th class="col-ver">Verbände</th>
              <th class="col-link">Google Maps</th>
              <th class="col-actions">Aktionen</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <div class="small" style="margin-top:10px;">
        Ausgewählte Zeile: <strong id="selectedRow">keine</strong>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button class="secondary" id="openDetailBtn" type="button" disabled>Detail öffnen</button>
        <button class="soft" id="openEditBtn" type="button" disabled>Eintrag bearbeiten</button>
      </div>

      <div class="editorGrid">
        <div class="row" style="margin-bottom:0;">
          <label>Info</label>
          <textarea id="infoEdit" placeholder="z.B. Name, Schacht-Info, Besonderheiten…"></textarea>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="primary" id="saveInfoBtn" type="button" disabled>Info speichern</button>
          <button class="secondary" id="clearInfoBtn" type="button" disabled>Info leeren</button>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="searchBox">
      <input id="addrInput" placeholder="Adresse / Ort suchen (z.B. Hauptplatz Linz)" />
      <button id="addrBtn" type="button">Suchen</button>
      <button id="clearSearchBtn" type="button" title="Suchmarker entfernen">Marker löschen</button>
      <button id="clearHighlightBtn" type="button">Highlight löschen</button>
    </div>

    <div id="addrResults" class="results"></div>
    <div id="map"></div>
  </div>
</div>

<div id="toast"></div>`;
