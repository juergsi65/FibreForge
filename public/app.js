/* FibreForge – Nummernverwaltung + Karte
   Logik übernommen aus "Neue_Nummern_Labels_sauber.html".
   Statt einer lokalen Excel-Datei werden alle Daten über die API in der Cloudflare-Datenbank gespeichert. */
(function () {
'use strict';

/* ===========================
   BASIC UI
=========================== */
let toastTimer = null;
function toast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.style.display = "none"; }, 2600);
}
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function parseCoord(v){
  if(v===null || v===undefined) return null;
  if(typeof v==="number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if(!s) return null;
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function safeUrl(u){ return /^https?:\/\//i.test(String(u||"")) ? String(u) : ""; }
const $ = (id)=>document.getElementById(id);

async function api(method, url, body){
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type":"application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if(res.status===401){ location.href="/login"; throw new Error("Nicht angemeldet"); }
  const json = await res.json().catch(()=>({}));
  if(!res.ok || json.status==="error") throw new Error(json.message || ("Fehler " + res.status));
  return json;
}
async function run(fn){
  try { return await fn(); }
  catch(e){ toast(e.message || "Fehler"); return undefined; }
}

/* ===========================
   STATE
=========================== */
let meta = null;
let activeSheetName = null;   // aktives Gebiets-Kürzel
let records = [];             // Kästen des aktiven Gebiets
let selectedId = null;
let selectedTr = null;
let detailId = null;
let editId = null;
let editMode = false;
let canEdit = false;

const gemeindenMap = new Map();
const linzKgMap = new Map();
const bauleiterMap = new Map();

function getRec(id){ return records.find(r=>r.id===id) || null; }
function findRecordByName(nr){ return records.find(r=>r.nr===nr) || null; }

function setStatus(msg){ $('status').textContent=msg||''; }
function setActiveInfo(){
  const el=$("activeInfo");
  el.textContent = activeSheetName ? `Aktives Gebiet: ${activeSheetName}` : "";
}

/* ===========================
   MAP
=========================== */
const map=L.map('map',{zoomControl:true}).setView([48.30,14.29],10);
const streetLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'&copy; OpenStreetMap'});
const satelliteLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19, attribution:'Tiles &copy; Esri'});
streetLayer.addTo(map);
L.control.layers({ "Straße": streetLayer, "Satellit": satelliteLayer }, {}, { position:'topright' }).addTo(map);

const markersLayer=L.layerGroup().addTo(map);
const highlightLayer=L.layerGroup().addTo(map);
let searchMarker=null;

function clearHighlights(){ highlightLayer.clearLayers(); }
$("clearHighlightBtn").addEventListener("click", clearHighlights);

/* ===========================
   STAMMDATEN
=========================== */
async function loadMeta(){
  meta = await api("GET", "/api/meta");
  canEdit = !!meta.user.canEdit;
  gemeindenMap.clear(); linzKgMap.clear(); bauleiterMap.clear();
  for(const g of meta.gemeinden) gemeindenMap.set(g.name, g.kuerzel);
  for(const k of meta.kgs) linzKgMap.set(k.name, k.kuerzel);
  for(const b of meta.bauleiter) bauleiterMap.set(b.name, b.email);
  refreshGebietDropdown();
  refreshKgDropdown();
  refreshBauleiterDropdown();
  if(!canEdit){
    $("editModeLabel").style.display="none";
    const pill=$("activeInfo");
    pill.insertAdjacentHTML("beforebegin", '<span class="pill ro">Nur lesen</span>');
  }
  if(!meta.gemeinden.length && !meta.kgs.length){
    setStatus(meta.user.isAdmin ? "Noch keine Stammdaten – bitte im Admin-Bereich die Excel-Mappe importieren." : "Noch keine Stammdaten vorhanden.");
  }
}
function refreshGebietDropdown(){
  const sel=$("gebietSelect");
  sel.innerHTML="";
  sel.appendChild(new Option("Bitte wählen…",""));
  const names=[...gemeindenMap.keys()].filter(n=>n!=="Linz").sort((a,b)=>a.localeCompare(b,"de"));
  if(linzKgMap.size || gemeindenMap.has("Linz")) names.push("Linz");
  names.sort((a,b)=>a.localeCompare(b,"de"));
  for(const n of names) sel.appendChild(new Option(n,n));
  sel.disabled=false;
}
function refreshKgDropdown(){
  const sel=$("kgSelect");
  sel.innerHTML="";
  sel.appendChild(new Option("Bitte wählen…",""));
  const kgs=[...linzKgMap.keys()].sort((a,b)=>a.localeCompare(b,"de"));
  for(const kg of kgs) sel.appendChild(new Option(kg,kg));
}
function refreshBauleiterDropdown(){
  const sel=$("bauleiterSelect");
  sel.innerHTML="";
  sel.appendChild(new Option("Bitte wählen…",""));
  const names=[...bauleiterMap.keys()].sort((a,b)=>a.localeCompare(b,"de"));
  for(const n of names) sel.appendChild(new Option(n,n));
  sel.disabled=false;
}

/* ===========================
   EDIT MODE
=========================== */
function applyEditModeUI(){
  const can = editMode && canEdit;
  $("genBtn").disabled = !can;
  $("nextMissingBtn").disabled = !can || !activeSheetName;
  $("deleteBtn").disabled = !can || !selectedId;
  $("exportOpenBtn").disabled = false;
  $("openDetailBtn").disabled = !selectedId;
  $("openEditBtn").disabled = !can || !selectedId;
  $("saveInfoBtn").disabled = !can || !selectedId;
  $("clearInfoBtn").disabled = !can || !selectedId;
}
$("editModeToggle").addEventListener("change",(e)=>{
  editMode=!!e.target.checked;
  applyEditModeUI();
  toast(editMode ? "Bearbeiten aktiviert." : "Nur ansehen aktiv.");
});

/* ===========================
   GEBIET WÄHLEN
=========================== */
async function photonSearch(q, limit=7){
  try{
    const url=`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=de`;
    const res=await fetch(url);
    if(!res.ok) return [];
    const json=await res.json();
    const feats=json?.features||[];
    return feats.map(f=>({
      name:f.properties?.name||"Treffer",
      city:f.properties?.city||f.properties?.town||f.properties?.village||"",
      state:f.properties?.state||"",
      country:f.properties?.country||"",
      lat:f.geometry.coordinates[1],
      lon:f.geometry.coordinates[0],
    }));
  } catch(e){ return []; }
}
function zoomTo(lat, lon, z=16){ map.setView([lat,lon], z); }

async function loadRecords(){
  if(!activeSheetName){ records=[]; return; }
  records = await api("GET", "/api/kaesten?kuerzel="+encodeURIComponent(activeSheetName));
}
async function reloadAndRender(keepSelection=true){
  const keep = keepSelection ? selectedId : null;
  await run(loadRecords);
  refreshTableAndMarkers();
  if(keep && getRec(keep)) selectRowById(keep, true);
  else clearSelection();
}

async function openAreaAndRender(kuerzel){
  if(!kuerzel) return;
  activeSheetName=kuerzel;
  clearSelection();
  await reloadAndRender(false);
  setActiveInfo();
  const withLoc = records.filter(r=>r.lat!=null && r.lng!=null).map(r=>[r.lat,r.lng]);
  map.invalidateSize();
  if(withLoc.length) map.fitBounds(withLoc,{padding:[40,40], maxZoom:16});
  return withLoc.length>0;
}

$("gebietSelect").addEventListener("change", async ()=>{
  clearSelection();
  const gebiet=$("gebietSelect").value;
  const kgRowEl=$("kgRow");
  const kuerzelEl=$("kuerzel");

  kuerzelEl.value="";
  activeSheetName=null;
  records=[];
  refreshTableAndMarkers();

  if(!gebiet){
    kgRowEl.style.display="none";
    setStatus("Gebiet wählen…");
    setActiveInfo();
    applyEditModeUI();
    return;
  }

  if(gebiet.toLowerCase()==="linz" && linzKgMap.size){
    kgRowEl.style.display="grid";
    $("kgSelect").value="";
    setStatus("Linz gewählt – bitte KG wählen…");
    const hits=await photonSearch("Linz Oberösterreich",1);
    if(hits[0]) zoomTo(hits[0].lat, hits[0].lon, 13);
    return;
  }

  kgRowEl.style.display="none";
  const kuerzel=gemeindenMap.get(gebiet)||"";
  kuerzelEl.value=kuerzel;

  const hasPoints = await openAreaAndRender(kuerzel);
  if(!hasPoints){
    const hits=await photonSearch(`${gebiet} Oberösterreich`,1);
    if(hits[0]) zoomTo(hits[0].lat, hits[0].lon, 13);
  }
  setStatus(`Gebiet: ${gebiet} | Kürzel: ${kuerzel || "(nicht gefunden)"} | ${records.length} Einträge`);
});

$("kgSelect").addEventListener("change", async ()=>{
  clearSelection();
  const kg=$("kgSelect").value;
  const kuerzelEl=$("kuerzel");

  kuerzelEl.value="";
  activeSheetName=null;
  records=[];
  refreshTableAndMarkers();

  if(!kg){
    setStatus("KG wählen…");
    setActiveInfo();
    applyEditModeUI();
    return;
  }

  const kuerzel=linzKgMap.get(kg)||"";
  kuerzelEl.value=kuerzel;

  const hasPoints = await openAreaAndRender(kuerzel);
  if(!hasPoints){
    const hits=await photonSearch(`${kg} Linz`,1);
    if(hits[0]) zoomTo(hits[0].lat, hits[0].lon, 14);
  }
  setStatus(`KG: ${kg} | Kürzel: ${kuerzel || "(nicht gefunden)"} | ${records.length} Einträge`);
});

$("bauleiterSelect").addEventListener("change", ()=>{
  const sel=$("bauleiterSelect").value;
  $("bauleiterEmail").value=sel ? (bauleiterMap.get(sel)||"") : "";
  applyEditModeUI();
});

/* ===========================
   SELECTION / DETAIL
=========================== */
function clearSelection(){
  selectedId=null;
  $("selectedRow").textContent="keine";
  if(selectedTr) selectedTr.classList.remove("selected");
  selectedTr=null;
  $("infoEdit").value="";
  applyEditModeUI();
}

function selectRowById(id, silent=false){
  clearSelection();
  const tbody=document.querySelector("#tbl tbody");
  const tr=[...tbody.querySelectorAll("tr")].find(x=>x.dataset.id===String(id));
  if(!tr){ if(!silent) toast("Zeile nicht sichtbar."); return; }
  const rec=getRec(id);
  if(!rec) return;

  selectedId=id;
  selectedTr=tr;
  tr.classList.add("selected");
  if(!silent) tr.scrollIntoView({block:"nearest"});

  $("selectedRow").textContent=`${activeSheetName} / ${rec.nr}`;
  $("infoEdit").value=rec.info||"";
  applyEditModeUI();
}

function renderDetailLists(rec){
  const incoming=(rec.verbaende||[]).filter(v=>v.direction==='ankommend');
  const outgoing=(rec.verbaende||[]).filter(v=>v.direction==='abgehend');

  $("detailTitle").textContent=`Kasten ${rec.nr}`;
  $("detailNr").textContent=rec.nr||"-";
  $("detailTO").textContent=rec.to||"-";
  $("detailBL").textContent=rec.bl||"-";
  $("detailLoc").textContent=rec.link ? "Google Maps vorhanden" : "nicht gesetzt";
  $("centerKasten").textContent=rec.nr||"-";
  $("countIncoming").textContent=String(incoming.length);
  $("countOutgoing").textContent=String(outgoing.length);

  const incomingRoot=$("incomingList");
  const outgoingRoot=$("outgoingList");
  incomingRoot.innerHTML="";
  outgoingRoot.innerHTML="";

  function createItem(v){
    const wrapper=document.createElement("div");
    wrapper.className="verbandItem";
    wrapper.innerHTML=`
      <div class="verbandName">${escapeHtml(v.fullName||v.suffix||"-")}</div>
      <div class="verbandMeta">Richtung: ${escapeHtml(v.direction)}${v.remoteKasten ? ` · Kasten: ${escapeHtml(v.remoteKasten)}` : " · offen"}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="soft actionBtn" type="button" data-link="${escapeHtml(v.linkId)}">Auf Karte</button>
        ${(editMode && canEdit) ? `<button class="ghostDanger actionBtn" type="button" data-del="${escapeHtml(v.linkId)}">Löschen</button>` : ""}
      </div>
    `;
    wrapper.querySelectorAll("[data-link]").forEach(btn=>btn.addEventListener("click", ()=>highlightConnectionByLinkId(btn.getAttribute("data-link"))));
    wrapper.querySelectorAll("[data-del]").forEach(btn=>btn.addEventListener("click", ()=>removeConnection(btn.getAttribute("data-del"))));
    return wrapper;
  }

  if(!incoming.length) incomingRoot.innerHTML='<div class="small">Keine ankommenden Verbände.</div>';
  else incoming.forEach(v=>incomingRoot.appendChild(createItem(v)));

  if(!outgoing.length) outgoingRoot.innerHTML='<div class="small">Keine abgehenden Verbände.</div>';
  else outgoing.forEach(v=>outgoingRoot.appendChild(createItem(v)));
}

function rebuildDetailDropdowns(rec){
  const choose=$("verbandChoose");
  const target=$("verbandTarget");
  const dir=$("verbandDirection").value;
  choose.innerHTML='<option value="">(optional wählen)</option>';
  target.innerHTML='<option value="">(optional / kein Endkasten)</option>';

  const all=records.filter(x=>x.nr!==rec.nr);
  all.forEach(k=>target.appendChild(new Option(k.nr,k.nr)));

  if(dir==='ankommend'){
    for(const k of all){
      for(const v of (k.verbaende||[])){
        if(v.direction==='abgehend' && !v.remoteKasten){
          const obj={ mode:'incoming', linkId:v.linkId, fullName:v.fullName, suffix:v.suffix, remoteKasten:k.nr };
          choose.appendChild(new Option(`${v.fullName} (von ${k.nr})`, JSON.stringify(obj)));
        }
      }
    }
  } else {
    for(let i=1;i<=50;i++){
      const prefix=String(i).padStart(2,'0');
      choose.appendChild(new Option(`${rec.nr}_${prefix}-…`, JSON.stringify({mode:'template',prefix})));
    }
  }
}

function openDetailForId(id){
  selectRowById(id, true);
  detailId=id;
  const rec=getRec(id);
  if(!rec) return;
  renderDetailLists(rec);
  rebuildDetailDropdowns(rec);
  $("detailOverlay").style.display="flex";
}
function closeDetailModal(){ $("detailOverlay").style.display="none"; }
$("openDetailBtn").addEventListener("click", ()=>{
  if(!selectedId) return toast("Bitte zuerst eine Zeile auswählen.");
  openDetailForId(selectedId);
});
$("closeDetailBtn").addEventListener("click", closeDetailModal);
$("detailOverlay").addEventListener("click", (e)=>{
  if(e.target===$("detailOverlay")) closeDetailModal();
});

$("verbandDirection").addEventListener("change", ()=>{
  const rec=getRec(detailId);
  if(rec) rebuildDetailDropdowns(rec);
});

$("verbandChoose").addEventListener("change", ()=>{
  const val=$("verbandChoose").value;
  const dir=$("verbandDirection").value;
  clearHighlights();
  if(!val) return;
  try{
    const obj=JSON.parse(val);
    if(dir==='ankommend' && obj.mode==='incoming'){
      $("verbandTarget").value=obj.remoteKasten||"";
      highlightConnectionByLinkId(obj.linkId||"");
    }
    if(dir==='abgehend' && obj.mode==='template'){
      $("verbandSuffixInput").value=obj.prefix+'-';
    }
  } catch(e){}
});

async function refreshDetailAfterChange(linkIdToHighlight){
  await reloadAndRender(true);
  const fresh=getRec(detailId);
  if(fresh){
    renderDetailLists(fresh);
    rebuildDetailDropdowns(fresh);
  }
  if(linkIdToHighlight) highlightConnectionByLinkId(linkIdToHighlight);
}

async function removeConnection(linkId){
  if(!editMode || !canEdit) return toast("Bearbeiten ist deaktiviert.");
  if(!confirm("Verbindung löschen?")) return;
  const ok = await run(()=>api("DELETE", "/api/verbaende/"+encodeURIComponent(linkId)));
  if(!ok) return;
  clearHighlights();
  await refreshDetailAfterChange();
  toast("Verbindung gelöscht.");
}

$("addVerbandBtn").addEventListener("click", async ()=>{
  if(!editMode || !canEdit) return toast("Bearbeiten ist deaktiviert.");
  const rec=getRec(detailId);
  if(!rec) return;

  const direction=$("verbandDirection").value;
  const chooseVal=$("verbandChoose").value;
  const targetKasten=$("verbandTarget").value.trim();
  const suffixInput=($("verbandSuffixInput").value||"").trim();

  if(direction==='abgehend'){
    let templatePrefix='';
    if(chooseVal){
      try{
        const obj=JSON.parse(chooseVal);
        if(obj.mode==='template') templatePrefix=obj.prefix||'';
      }catch(e){}
    }

    let suffix='';
    if(templatePrefix){
      if(!suffixInput) return toast("Bitte den letzten Suffix-Teil ergänzen oder den vollständigen Suffix eingeben.");
      suffix = suffixInput.startsWith(templatePrefix+'-')
        ? suffixInput
        : (templatePrefix + '-' + suffixInput.replace(/^[-_\s]+/,''));
    } else {
      if(!suffixInput) return toast("Bitte neues Rohr-Suffix eingeben.");
      suffix=suffixInput;
    }

    if((rec.verbaende||[]).some(v=>v.direction==='abgehend' && v.suffix===suffix)) return toast("Dieser Verband existiert bereits.");

    let toId=null;
    if(targetKasten){
      const target=findRecordByName(targetKasten);
      if(!target) return toast("Zielkasten nicht gefunden.");
      toId=target.id;
    }
    const res = await run(()=>api("POST", "/api/verbaende", { fromId: rec.id, suffix, toId }));
    if(!res) return;
    $("verbandSuffixInput").value="";
    await refreshDetailAfterChange(toId ? res.linkId : null);
    toast(toId ? "Verbindung angelegt." : "Offenes Rohr ohne Endkasten angelegt.");
  } else {
    if(!chooseVal) return toast("Bitte ein offenes abgehendes Rohr aus dem Dropdown wählen.");
    let obj;
    try{ obj=JSON.parse(chooseVal); } catch(e){ return toast("Auswahl konnte nicht gelesen werden."); }
    if((rec.verbaende||[]).some(v=>v.linkId===obj.linkId)) return toast("Diese Verbindung ist hier bereits vorhanden.");
    const res = await run(()=>api("POST", "/api/verbaende/"+encodeURIComponent(obj.linkId)+"/assign", { toId: rec.id }));
    if(!res) return;
    $("verbandSuffixInput").value="";
    await refreshDetailAfterChange(obj.linkId);
    toast("Ankommende Verbindung zugewiesen.");
  }
});

/* ===========================
   TABLE / HIGHLIGHTS
=========================== */
function highlightConnectionByLinkId(linkId){
  clearHighlights();
  if(!linkId || !activeSheetName) return;
  const recs=records.filter(r=>(r.verbaende||[]).some(v=>v.linkId===linkId));
  const bounds=[];

  for(const r of recs){
    if(r.lat!=null && r.lng!=null){
      bounds.push([r.lat,r.lng]);
      L.circleMarker([r.lat,r.lng],{
        radius:12, color:varColor('--hl','#f59e0b'), weight:4, fillColor:'#fff3cd', fillOpacity:.95
      }).addTo(highlightLayer).bindPopup(`<b>${escapeHtml(r.nr)}</b>`);
    }
  }

  const pts=recs.filter(r=>r.lat!=null&&r.lng!=null).map(r=>[r.lat,r.lng]);
  if(pts.length>=2){
    L.polyline(pts,{color:'#f59e0b',weight:5,opacity:.85,dashArray:'8 8'}).addTo(highlightLayer);
  }
  if(bounds.length) map.fitBounds(bounds,{padding:[50,50], maxZoom:18});
}
function varColor(name,fallback){
  const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function rebuildQuickVerbandDropdown(){
  const sel=$("verbandQuickSelect");
  sel.innerHTML='<option value="">Verband auswählen / anzeigen…</option>';
  if(!activeSheetName) return;
  const seen=new Set();
  for(const rec of records){
    for(const v of (rec.verbaende||[])){
      if(!v.linkId || seen.has(v.linkId)) continue;
      seen.add(v.linkId);
      sel.appendChild(new Option(`${v.fullName||v.suffix} (${rec.nr}${v.remoteKasten?` ↔ ${v.remoteKasten}`:''})`, v.linkId));
    }
  }
}

function refreshTableAndMarkers(){
  const tbody=document.querySelector("#tbl tbody");
  if(!activeSheetName){
    tbody.innerHTML="";
    markersLayer.clearLayers();
    setActiveInfo();
    $("copyMailBtn").disabled=true;
    rebuildQuickVerbandDropdown();
    applyEditModeUI();
    return;
  }

  const onlyMissing=$("onlyMissing").checked;
  const onlyWith=$("onlyWith").checked;
  const q=$("searchNr").value.trim().toLowerCase();

  tbody.innerHTML="";
  markersLayer.clearLayers();
  selectedTr=null;

  const frag=document.createDocumentFragment();
  let shown=0, withLoc=0, missingCount=0;

  for(const rec of records){
    const hasLocNow = (rec.lat!==null && rec.lng!==null);
    if(hasLocNow) withLoc++; else missingCount++;

    if(onlyMissing && hasLocNow) continue;
    if(onlyWith && !hasLocNow) continue;

    if(q){
      const verText=(rec.verbaende||[]).map(v=>`${v.fullName} ${v.remoteKasten} ${v.direction}`).join(" ");
      const hay=`${rec.nr} ${rec.to} ${rec.bl} ${rec.info} ${verText}`.toLowerCase();
      if(!hay.includes(q)) continue;
    }

    const tr=document.createElement("tr");
    tr.className="clickable" + (rec.id===selectedId ? " selected" : "");
    if(rec.id===selectedId) selectedTr=tr;
    tr.dataset.id=String(rec.id);
    tr.addEventListener("click", ()=>selectRowById(rec.id));
    tr.addEventListener("dblclick", ()=>openDetailForId(rec.id));

    const verHtml=(rec.verbaende||[]).length
      ? `<div style="display:grid; gap:6px;">${rec.verbaende.map(v=>`
          <div>
            <span class="tagDir ${v.direction==='ankommend'?'tagIncoming':'tagOutgoing'}">${escapeHtml(v.direction)}</span>
            <button class="soft actionBtn" type="button" data-link="${escapeHtml(v.linkId)}">${escapeHtml(v.fullName||v.suffix||'-')}</button>
            ${v.remoteKasten?`<span class="small">↔ ${escapeHtml(v.remoteKasten)}</span>`:''}
          </div>
        `).join('')}</div>`
      : `<span class="small">keine Verbände</span>`;

    const link=safeUrl(rec.link);
    tr.innerHTML=`
      <td class="col-nr">${escapeHtml(rec.nr)}</td>
      <td class="col-to">${escapeHtml(rec.to)}</td>
      <td class="col-bl">${escapeHtml(rec.bl)}</td>
      <td class="col-date">${escapeHtml(rec.dt)}</td>
      <td class="col-info">${escapeHtml(rec.info)}</td>
      <td class="col-ver">${verHtml}</td>
      <td class="col-link">${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">Google Maps öffnen</a>` : ""}</td>
      <td class="col-actions">
        <button class="secondary actionBtn" data-act="copyNr" type="button">Nr</button>
        <button class="secondary actionBtn" data-act="copyTO" type="button">TO</button>
        <button class="soft actionBtn" data-act="detail" type="button">Detail</button>
        <button class="secondary actionBtn" data-act="edit" type="button">Bearb.</button>
        <button class="secondary actionBtn" data-act="labelOne" type="button">Label</button>
      </td>
    `;

    tr.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", async (ev)=>{
        ev.stopPropagation();
        const act=btn.getAttribute("data-act");
        if(act==="copyNr"){
          if(!rec.nr) return toast("Keine Nummer.");
          await navigator.clipboard.writeText(rec.nr);
          toast("Nummer kopiert.");
        } else if(act==="copyTO"){
          if(!rec.to) return toast("Keine TO.");
          await navigator.clipboard.writeText(rec.to);
          toast("TO kopiert.");
        } else if(act==="detail"){
          openDetailForId(rec.id);
        } else if(act==="edit"){
          openEditForId(rec.id);
        } else if(act==="labelOne"){
          await exportLabelsAsPDF([rec], { size:"62x29", onlyWithLocation:false, onePerPage:true });
        }
      });
    });

    tr.querySelectorAll("button[data-link]").forEach(btn=>{
      btn.addEventListener("click",(ev)=>{
        ev.stopPropagation();
        highlightConnectionByLinkId(btn.getAttribute("data-link"));
      });
    });

    frag.appendChild(tr);
    shown++;

    if(hasLocNow){
      const m=L.marker([rec.lat,rec.lng]).addTo(markersLayer);
      m.bindPopup(`<b>${escapeHtml(rec.nr)}</b><br>${escapeHtml(rec.to)}<br>${escapeHtml(rec.info||"")}`);
      m.on("click", ()=>selectRowById(rec.id, true));
    }
  }

  tbody.appendChild(frag);
  $("copyMailBtn").disabled=false;
  rebuildQuickVerbandDropdown();

  setStatus(`Gebiet: ${activeSheetName} | angezeigt: ${shown} | mit Standort: ${withLoc} | ohne Standort: ${missingCount}`);
  setActiveInfo();
  applyEditModeUI();
}

/* ===========================
   MAP CLICK / LOCATION
=========================== */
function buildMapsLink(lat,lng){
  const la=parseCoord(lat), lo=parseCoord(lng);
  if(la===null || lo===null) return "";
  return `https://www.google.com/maps?q=${la},${lo}`;
}

map.on("click", async (e)=>{
  if(!activeSheetName) return;
  if(!canEdit){ toast("Du hast nur Leserechte."); return; }
  if(!editMode){ toast("Nur ansehen aktiv."); return; }
  if(!selectedId){ toast("Bitte zuerst eine Zeile auswählen."); return; }

  const rec=getRec(selectedId);
  if(!rec) return;
  if(rec.lat!=null && rec.lng!=null){
    if(!confirm("Standort ist bereits gesetzt. Überschreiben?")) return;
  }

  const lat=Number(e.latlng.lat.toFixed(6));
  const lng=Number(e.latlng.lng.toFixed(6));
  const ok = await run(()=>api("PATCH", "/api/kaesten/"+rec.id, { lat, lng, link: buildMapsLink(lat,lng) }));
  if(!ok) return;

  await run(loadRecords);
  refreshTableAndMarkers();

  clearSelection();
  if($("autoNextMissing").checked) selectNextMissing();
  else toast("Standort gespeichert.");
});

function selectNextMissing(){
  if(!activeSheetName) return false;

  $("onlyMissing").checked=true;
  $("onlyWith").checked=false;
  $("searchNr").value="";
  refreshTableAndMarkers();

  const next=records.find(r=>r.lat==null || r.lng==null);
  if(next){
    selectRowById(next.id);
    toast("Nächster ohne Standort ausgewählt.");
    return true;
  }
  toast("Keine Einträge ohne Standort mehr.");
  return false;
}
$("nextMissingBtn").addEventListener("click", ()=>{
  if(!editMode){ toast("Bearbeiten ist deaktiviert."); return; }
  clearSelection();
  selectNextMissing();
});

/* ===========================
   FULL ENTRY EDIT
=========================== */
const editOverlay=$("editOverlay");

function parseCoordsFromMapsLink(link){
  const s=String(link||"");
  let m=s.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if(!m) m=s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if(!m) m=s.match(/(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/);
  if(!m) return null;
  const lat=parseFloat(m[1]), lng=parseFloat(m[2]);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) return null;
  return {lat,lng};
}
function openEditForId(id){
  if(!canEdit) return toast("Du hast nur Leserechte.");
  if(!editMode) return toast("Bearbeiten ist deaktiviert.");
  selectRowById(id, true);
  editId=id;
  const rec=getRec(id);
  if(!rec) return;
  $("editTitle").textContent=`Eintrag bearbeiten: ${rec.nr}`;
  $("editNr").value=rec.nr||"";
  $("editTO").value=rec.to||"";
  $("editBL").value=rec.bl||"";
  $("editDate").value=rec.dt||"";
  $("editLat").value=rec.lat??"";
  $("editLng").value=rec.lng??"";
  $("editLink").value=rec.link||"";
  $("editInfo").value=rec.info||"";
  const dl=$("editBLList");
  dl.innerHTML="";
  for(const name of [...bauleiterMap.keys()].sort((a,b)=>a.localeCompare(b,"de"))){
    const opt=document.createElement("option"); opt.value=name; dl.appendChild(opt);
  }
  editOverlay.style.display="flex";
}
function closeEditModal(){ editOverlay.style.display="none"; }
$("openEditBtn").addEventListener("click", ()=>{
  if(!selectedId) return toast("Bitte zuerst eine Zeile auswählen.");
  openEditForId(selectedId);
});
$("editCancelBtn").addEventListener("click", closeEditModal);
editOverlay.addEventListener("click", (e)=>{ if(e.target===editOverlay) closeEditModal(); });
$("editBuildLinkBtn").addEventListener("click", ()=>{
  const link=buildMapsLink($("editLat").value, $("editLng").value);
  if(!link) return toast("Lat/Lng fehlen oder sind ungültig.");
  $("editLink").value=link;
});
$("editParseLinkBtn").addEventListener("click", ()=>{
  const coords=parseCoordsFromMapsLink($("editLink").value);
  if(!coords) return toast("Aus diesem Link konnten keine Koordinaten gelesen werden.");
  $("editLat").value=coords.lat.toFixed(6);
  $("editLng").value=coords.lng.toFixed(6);
});
$("editClearLocationBtn").addEventListener("click", ()=>{
  $("editLat").value="";
  $("editLng").value="";
  $("editLink").value="";
});
$("editSaveBtn").addEventListener("click", async ()=>{
  if(!editMode || !canEdit) return toast("Bearbeiten ist deaktiviert.");
  const oldRec=getRec(editId);
  if(!oldRec) return toast("Eintrag nicht gefunden.");
  const nr=$("editNr").value.trim();
  if(!nr) return toast("Nummer darf nicht leer sein.");
  if(records.some(r=>r.id!==editId && r.nr===nr)) return toast("Diese Nummer existiert bereits.");

  let lat=parseCoord($("editLat").value);
  let lng=parseCoord($("editLng").value);
  let link=$("editLink").value.trim();
  if((lat===null || lng===null) && link){
    const coords=parseCoordsFromMapsLink(link);
    if(coords){ lat=Number(coords.lat.toFixed(6)); lng=Number(coords.lng.toFixed(6)); }
  }
  if(lat===null || lng===null){ lat=null; lng=null; }
  if(lat!==null && lng!==null && !link) link=buildMapsLink(lat,lng);

  const ok = await run(()=>api("PATCH", "/api/kaesten/"+editId, {
    nr,
    to:$("editTO").value.trim(),
    bl:$("editBL").value.trim(),
    dt:$("editDate").value.trim(),
    lat, lng, link,
    info:$("editInfo").value||""
  }));
  if(!ok) return;
  await reloadAndRender(true);
  closeEditModal();
  toast("Eintrag gespeichert.");
});

/* ===========================
   DELETE
=========================== */
$("deleteBtn").addEventListener("click", async ()=>{
  if(!editMode || !canEdit){ toast("Bearbeiten ist deaktiviert."); return; }
  const rec=getRec(selectedId);
  if(!activeSheetName || !rec){ toast("Bitte Eintrag wählen."); return; }

  const ok=confirm(`Eintrag wirklich löschen?\n\nGebiet: ${activeSheetName}\nNummer: ${rec.nr}\n\nZugehörige Verbände werden ebenfalls entfernt.`);
  if(!ok) return;

  const res = await run(()=>api("DELETE", "/api/kaesten/"+rec.id));
  if(!res) return;
  clearSelection();
  clearHighlights();
  await reloadAndRender(false);
  toast("Eintrag gelöscht.");
});

/* ===========================
   GENERATE NUMBERS
=========================== */
$("genBtn").addEventListener("click", async ()=>{
  if(!editMode || !canEdit){ toast("Bearbeiten ist deaktiviert."); return; }

  const gebiet=$("gebietSelect").value.trim();
  const kg=$("kgSelect").value.trim();
  const toNummer=$("toNummer").value.trim();
  const anzahl=Number($("anzahl").value);
  const bauleiter=$("bauleiterSelect").value.trim();
  const kuerzel=$("kuerzel").value.trim();
  const email=$("bauleiterEmail").value.trim();

  if(!gebiet) return toast("Gebiet fehlt.");
  if(gebiet.toLowerCase()==="linz" && linzKgMap.size && !kg) return toast("KG fehlt.");
  if(!kuerzel) return toast("Kürzel fehlt.");
  if(!toNummer) return toast("TO Nummer fehlt.");
  if(!bauleiter) return toast("Bauleiter fehlt.");
  if(!email) return toast("Bauleiter E-Mail fehlt.");
  if(!anzahl || anzahl<1) return toast("Anzahl muss >= 1 sein.");

  const res = await run(()=>api("POST", "/api/kaesten/generate", { kuerzel, to: toNummer, bl: bauleiter, anzahl }));
  if(!res) return;

  activeSheetName=kuerzel;
  await reloadAndRender(false);
  setActiveInfo();
  toast(`${res.nrs.length} Nummer(n) erstellt: ${res.nrs[0]}${res.nrs.length>1 ? " … "+res.nrs[res.nrs.length-1] : ""}`);
});

/* ===========================
   MAIL COPY
=========================== */
$("copyMailBtn").addEventListener("click", async ()=>{
  if(!activeSheetName) return toast("Kein Gebiet aktiv.");
  const toNummer=$("toNummer").value.trim();
  const bauleiter=$("bauleiterSelect").value.trim();
  const email=$("bauleiterEmail").value.trim();
  if(!toNummer || !bauleiter || !email) return toast("TO + Bauleiter wählen.");

  const nums=records.filter(r=>r.to===toNummer && r.bl===bauleiter).map(r=>r.nr);

  const subject=`Neue Nummern für TO-Nummer ${toNummer}`;
  const body=`An: ${email}\nBetreff: ${subject}\n\nDie folgenden neuen Nummern wurden erstellt:\n${nums.join("\n")}`;
  await navigator.clipboard.writeText(body);
  toast("Mailtext kopiert.");
});

/* ===========================
   ADDRESS SEARCH
=========================== */
const addrResultsEl=$("addrResults");
function showResults(items){
  addrResultsEl.innerHTML="";
  addrResultsEl.style.display="block";
  if(!items.length){
    addrResultsEl.innerHTML=`<div style="padding:10px" class="small">Keine Treffer.</div>`;
    return;
  }
  for(const it of items){
    const b=document.createElement("button");
    const line=[it.name,it.city,it.state,it.country].filter(Boolean).join(", ");
    b.innerHTML=`<div class="t">${escapeHtml(line||"Treffer")}</div><div class="s">lat ${escapeHtml(it.lat)}, lon ${escapeHtml(it.lon)}</div>`;
    b.addEventListener("click", ()=>{
      zoomTo(it.lat,it.lon,17);
      if(searchMarker) map.removeLayer(searchMarker);
      searchMarker=L.marker([it.lat,it.lon]).addTo(map).bindPopup(escapeHtml(line)).openPopup();
      addrResultsEl.style.display="none";
      addrResultsEl.innerHTML="";
    });
    addrResultsEl.appendChild(b);
  }
}
$("addrBtn").addEventListener("click", async ()=>{
  const q=$("addrInput").value.trim();
  if(!q) return;
  showResults(await photonSearch(q,7));
});
$("addrInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") $("addrBtn").click(); });
$("clearSearchBtn").addEventListener("click", ()=>{
  addrResultsEl.style.display="none";
  addrResultsEl.innerHTML="";
  if(searchMarker){ map.removeLayer(searchMarker); searchMarker=null; }
});

/* ===========================
   FILTERS
=========================== */
let searchDebounce=null;
function rerenderDebounced(){
  if(searchDebounce) clearTimeout(searchDebounce);
  searchDebounce=setTimeout(()=>{
    refreshTableAndMarkers();
    clearSelection();
  }, 120);
}
$("onlyMissing").addEventListener("change", ()=>{
  if($("onlyMissing").checked) $("onlyWith").checked=false;
  rerenderDebounced();
});
$("onlyWith").addEventListener("change", ()=>{
  if($("onlyWith").checked) $("onlyMissing").checked=false;
  rerenderDebounced();
});
$("searchNr").addEventListener("input", rerenderDebounced);
$("clearSearchTbl").addEventListener("click", ()=>{
  $("searchNr").value="";
  $("onlyMissing").checked=false;
  $("onlyWith").checked=false;
  $("verbandQuickSelect").value="";
  refreshTableAndMarkers();
  clearSelection();
  clearHighlights();
});
$("verbandQuickSelect").addEventListener("change", ()=>{
  const linkId=$("verbandQuickSelect").value;
  if(!linkId){ clearHighlights(); return; }
  highlightConnectionByLinkId(linkId);
});

/* ===========================
   INFO SAVE/CLEAR
=========================== */
async function saveInfo(info){
  if(!editMode || !canEdit) return toast("Bearbeiten ist deaktiviert.");
  if(!selectedId) return toast("Bitte zuerst eine Zeile auswählen.");
  const ok = await run(()=>api("PATCH", "/api/kaesten/"+selectedId, { info }));
  if(!ok) return;
  await reloadAndRender(true);
  toast(info ? "Info gespeichert." : "Info geleert.");
}
$("saveInfoBtn").addEventListener("click", ()=>saveInfo($("infoEdit").value || ""));
$("clearInfoBtn").addEventListener("click", ()=>{ $("infoEdit").value=""; saveInfo(""); });

/* ===========================
   QR / LABEL PDF
=========================== */
async function makeQRDataUrl(text, px){
  return new Promise((resolve, reject)=>{
    try{
      const box=$("qrOffscreen");
      box.innerHTML="";
      const div=document.createElement("div");
      box.appendChild(div);
      new QRCode(div, { text: String(text || ""), width:px, height:px, correctLevel: QRCode.CorrectLevel.M });
      setTimeout(()=>{
        const canvas = div.querySelector("canvas");
        if(canvas) return resolve(canvas.toDataURL("image/png"));
        const img = div.querySelector("img");
        if(img && img.src) return resolve(img.src);
        reject(new Error("QR nicht erzeugt"));
      }, 20);
    } catch(e){ reject(e); }
  });
}
function mmToPt(mm){ return mm * 72 / 25.4; }
function getLabelPageFormat(sizeKey){
  if(sizeKey==="29x90") return [mmToPt(90), mmToPt(29)];
  if(sizeKey==="38x90") return [mmToPt(90), mmToPt(38)];
  return [mmToPt(62), mmToPt(29)];
}
function fitText(doc, text, maxW, maxFont, minFont){
  let fs=maxFont;
  doc.setFontSize(fs);
  while(fs>minFont && doc.getTextWidth(String(text || "")) > maxW){
    fs -= 0.5;
    doc.setFontSize(fs);
  }
  return fs;
}
function getMapsLinkForRecord(rec){
  if(rec?.link) return rec.link;
  if(rec?.lat != null && rec?.lng != null) return `https://www.google.com/maps?q=${rec.lat},${rec.lng}`;
  return "";
}
function buildQrLabelItems(recs, opts={}){
  const type = opts.type || "all";
  const onlyWithLocation = !!opts.onlyWithLocation;
  const byNr = new Map(recs.map(r => [r.nr, r]));
  const items=[];
  const seen = new Set();

  function addItem(item){
    // Kasten-Beschriftungslabels haben bewusst keinen QR-Code. Der Standortfilter gilt nur für Verband/Kabel.
    if(item.layout !== "kasten" && !item.qrText && onlyWithLocation) return;
    const key = `${item.layout}|${item.title}|${item.qrText}|${item.subtitle}`;
    if(seen.has(key)) return;
    seen.add(key);
    items.push(item);
  }

  function shortVerbandList(rec){
    const lines=[];
    const incoming=(rec.verbaende || []).filter(v => v.direction === "ankommend");
    const outgoing=(rec.verbaende || []).filter(v => v.direction === "abgehend");
    incoming.forEach(v => lines.push(`AN: ${v.fullName || v.suffix || "-"}${v.remoteKasten ? `  ← ${v.remoteKasten}` : ""}`));
    outgoing.forEach(v => lines.push(`AB: ${v.fullName || v.suffix || "-"}${v.remoteKasten ? `  → ${v.remoteKasten}` : "  → offen"}`));
    return lines;
  }

  if(type === "all" || type === "kasten"){
    for(const rec of recs){
      addItem({
        layout:"kasten",
        kind:"KASTEN",
        title:`Kasten ${rec.nr || "-"}`,
        subtitle: rec.to || rec.sheet || "",
        detail: rec.info || rec.bl || "",
        lines: shortVerbandList(rec),
        qrText:""
      });
    }
  }

  if(type === "all" || type === "verband" || type === "kabel"){
    for(const rec of recs){
      for(const v of (rec.verbaende || [])){
        // Für Kabel-/Verband-Labels nur einmal je Verbindung drucken: bevorzugt die abgehende Seite.
        if(v.direction !== "abgehend") continue;
        const target = v.remoteKasten ? byNr.get(v.remoteKasten) : null;
        const sourceLink = getMapsLinkForRecord(rec);
        const targetLink = getMapsLinkForRecord(target);
        const qrText = targetLink || sourceLink;
        const ziel = v.remoteKasten || "offenes Rohr";
        addItem({
          layout:"verband",
          kind: type === "kabel" ? "KABEL / ROHR" : "VERBAND / ROHR",
          title: v.fullName || `${rec.nr}_${v.suffix || ""}`,
          subtitle: `${rec.nr} → ${ziel}`,
          from: rec.nr || "-",
          to: ziel,
          targetHasGps: !!targetLink,
          qrText
        });
      }
    }
  }
  return items;
}
async function createQrLabelsPDF(recs, opts){
  const { jsPDF } = window.jspdf;

  const sizeKey = opts?.size || "62x29";
  const [wPt,hPt] = getLabelPageFormat(sizeKey);
  const items = buildQrLabelItems(recs, opts);
  if(!items.length){ toast("Keine passenden Labels gefunden."); return null; }

  const doc = new jsPDF({ orientation:"landscape", unit:"pt", format:[wPt, hPt] });
  const pad=6;

  function drawKastenLabel(item){
    const maxW = wPt - pad*2;
    doc.setFillColor(255,255,255);
    doc.rect(0,0,wPt,hPt,'F');
    doc.setTextColor(0,0,0);

    doc.setFont("helvetica","bold");
    fitText(doc, item.title || "Kasten -", maxW, (sizeKey==="62x29") ? 15 : 19, 9);
    doc.text(item.title || "Kasten -", pad, pad + 12, { maxWidth:maxW });

    let y = pad + 24;
    if(item.subtitle){
      doc.setFont("helvetica","bold");
      doc.setFontSize(7.2);
      doc.text(String(item.subtitle), pad, y, { maxWidth:maxW });
      y += 8;
    }

    doc.setDrawColor(0,0,0);
    doc.line(pad, y-2, wPt-pad, y-2);

    const lines = (item.lines && item.lines.length) ? item.lines : ["Keine Verbände hinterlegt"];
    doc.setFont("helvetica","normal");
    doc.setFontSize((sizeKey==="62x29") ? 6.2 : 8);
    const maxLines = (sizeKey==="62x29") ? 4 : 7;
    const visible = lines.slice(0,maxLines);
    visible.forEach((line,idx)=>{
      doc.text(String(line), pad, y + idx*7, { maxWidth:maxW });
    });
    if(lines.length > maxLines){
      doc.setFont("helvetica","bold");
      doc.setFontSize(6);
      doc.text(`+ ${lines.length-maxLines} weitere`, pad, hPt - pad - 2, { maxWidth:maxW });
    }
  }

  async function drawVerbandLabel(item){
    const qrSize = Math.min(hPt - pad*2, (sizeKey==="62x29") ? 66 : 80);
    const qrX = wPt - pad - qrSize;
    const textX = pad;
    const maxTextW = qrX - pad - 6;
    const qr = item.qrText ? await makeQRDataUrl(item.qrText, Math.max(160, Math.round(qrSize*2.2))) : "";

    doc.setFillColor(255,255,255);
    doc.rect(0,0,wPt,hPt,'F');
    doc.setTextColor(0,0,0);

    if(qr){
      doc.addImage(qr, "PNG", qrX, pad, qrSize, qrSize);
    } else {
      doc.setDrawColor(0,0,0);
      doc.rect(qrX, pad, qrSize, qrSize);
      doc.setFont("helvetica","bold");
      doc.setFontSize(7);
      doc.text("KEIN", qrX+qrSize/2, pad+qrSize/2-4, {align:"center"});
      doc.text("ZIEL", qrX+qrSize/2, pad+qrSize/2+7, {align:"center"});
    }

    doc.setFont("helvetica","bold");
    fitText(doc, item.title || "-", maxTextW, (sizeKey==="62x29") ? 13 : 17, 8);
    doc.text(item.title || "-", textX, pad + 12, { maxWidth:maxTextW });

    doc.setFont("helvetica","bold");
    doc.setFontSize(7.2);
    doc.text(item.kind || "VERBAND", textX, pad + 24, { maxWidth:maxTextW });

    doc.setFont("helvetica","normal");
    doc.setFontSize((sizeKey==="62x29") ? 7.5 : 9);
    doc.text(`Von: ${item.from || "-"}`, textX, pad + 38, { maxWidth:maxTextW });
    doc.text(`Bis: ${item.to || "-"}`, textX, pad + 50, { maxWidth:maxTextW });

    doc.setFont("helvetica","bold");
    doc.setFontSize(6.3);
    doc.text(item.targetHasGps ? "QR = Zielkasten" : "QR = bekannter Standort", textX, hPt - pad - 2, { maxWidth:maxTextW });
  }

  for(let i=0;i<items.length;i++){
    const item = items[i];
    if(item.layout === "kasten") drawKastenLabel(item);
    else await drawVerbandLabel(item);
    if(i < items.length-1) doc.addPage([wPt,hPt], "landscape");
  }

  return doc;
}
async function exportLabelsAsPDF(recs, opts){
  const doc = await createQrLabelsPDF(recs, opts);
  if(!doc) return;
  doc.save(opts.fileName || "QR_Labels.pdf");
  toast("QR-Label-PDF erstellt.");
}

/* ===========================
   EXPORT MODAL
=========================== */
const exportOverlay=$("exportModalOverlay");

function getExportScope(){
  return [...document.querySelectorAll('input[name="exportScope"]')].find(r=>r.checked)?.value || "active";
}
function getExportMode(){
  return [...document.querySelectorAll('input[name="exportMode"]')].find(r=>r.checked)?.value || "classic";
}
function updateExportControlStates(){
  const filterBLOn=$("exportFilterBauleiter").checked;
  const filterGebOn=$("exportFilterGebiet").checked;
  const filterTOOn=$("exportFilterTO").checked;
  const mode=getExportMode();

  $("exportBauleiterSelect").disabled=!filterBLOn;
  $("exportGebietSelect").disabled=!filterGebOn;
  $("exportTO").disabled=!filterTOOn;

  const scope=getExportScope();
  if(scope==="active"){
    $("exportFilterGebiet").checked=false;
    $("exportGebietSelect").disabled=true;
  }

  const labelsAllowed = mode === "qr";
  $("exportAsLabels").disabled = !labelsAllowed;
  $("qrLabelType").disabled = !labelsAllowed;
  $("labelSize").disabled = !labelsAllowed;
  $("labelsOnlyWithLocation").disabled = !labelsAllowed;
  $("labelsOnePerPage").disabled = !labelsAllowed;
  $("exportAsLabels").checked = labelsAllowed;
}
document.querySelectorAll('input[name="exportScope"]').forEach(r=>r.addEventListener("change", updateExportControlStates));
document.querySelectorAll('input[name="exportMode"]').forEach(r=>r.addEventListener("change", updateExportControlStates));
$("exportFilterBauleiter").addEventListener("change", updateExportControlStates);
$("exportFilterGebiet").addEventListener("change", updateExportControlStates);
$("exportFilterTO").addEventListener("change", updateExportControlStates);

function getExportFileName(base, ext){
  const custom=($("exportName").value||"").trim();
  if(custom){
    const lower=custom.toLowerCase();
    if(lower.endsWith(".xlsx")||lower.endsWith(".xlsm")||lower.endsWith(".pdf")) return custom;
    return custom + "." + ext;
  }
  return base + "." + ext;
}

async function collectRecordsFromFilters(){
  const scope=getExportScope();
  const filterBLOn=$("exportFilterBauleiter").checked;
  const filterGebOn=$("exportFilterGebiet").checked;
  const filterTOOn=$("exportFilterTO").checked;

  const blVal=$("exportBauleiterSelect").value.trim();
  const gebVal=$("exportGebietSelect").value.trim();
  const toVal=$("exportTO").value.trim();

  if(filterTOOn && !toVal){ toast("Bitte TO/Projekt eingeben (oder Filter aus)."); return null; }
  if(scope==="active" && !activeSheetName){ toast("Kein aktives Gebiet."); return null; }

  let source;
  if(scope==="active"){
    source=records;
  } else {
    const params=new URLSearchParams({ all:"1" });
    if(filterGebOn && gebVal) params.set("kuerzel", gebVal);
    source=await run(()=>api("GET", "/api/kaesten?"+params.toString()));
    if(!source) return null;
  }

  const out=source.filter(rec=>{
    if(filterBLOn && blVal && rec.bl !== blVal) return false;
    if(filterTOOn && rec.to !== toVal) return false;
    return true;
  });
  if(!out.length){ toast("Keine Daten gefunden."); return null; }
  return out;
}

$("exportOpenBtn").addEventListener("click", ()=>{
  const blSel=$("exportBauleiterSelect");
  const gebSel=$("exportGebietSelect");

  blSel.innerHTML='<option value="">(alle)</option>';
  // Bauleiter aus Stammdaten + aus den vorhandenen Einträgen (dort stehen oft Kurzformen)
  const blNames=new Set([...bauleiterMap.keys(), ...records.map(r=>r.bl).filter(Boolean)]);
  for(const name of [...blNames].sort((a,b)=>a.localeCompare(b,"de"))) blSel.appendChild(new Option(name,name));
  const curBL=$("bauleiterSelect").value.trim();
  if(curBL) blSel.value=curBL;

  gebSel.innerHTML='<option value="">(alle)</option>';
  const sheets=new Set([...(meta?.kuerzelMitDaten||[]), ...(activeSheetName?[activeSheetName]:[])]);
  for(const s of [...sheets].sort((a,b)=>a.localeCompare(b,"de"))) gebSel.appendChild(new Option(s,s));
  if(activeSheetName) gebSel.value=activeSheetName;

  $("exportModalInfo").textContent = activeSheetName ? `Aktiv: ${activeSheetName}` : "Kein Gebiet aktiv";
  exportOverlay.style.display="flex";
  updateExportControlStates();
});
$("exportCancelBtn").addEventListener("click", ()=>exportOverlay.style.display="none");
exportOverlay.addEventListener("click",(e)=>{ if(e.target===exportOverlay) exportOverlay.style.display="none"; });

/* ===========================
   PDF: KÄSTEN MIT VERBÄNDEN
=========================== */
async function exportKaestenMitVerbaendenPDF(recs){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;

  const projectNumber = recs[0]?.to || $("exportTO")?.value?.trim() || "-";

  let y = 42;
  function next(h = 14){ y += h; }
  function ensureSpace(h = 120){
    if(y + h > pageHeight - 40){
      doc.addPage();
      y = 40;
    }
  }

  function drawMetaLine(label, value, linkUrl = null){
    const labelX = margin;
    const valueX = margin + 92;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(55, 65, 81);
    doc.text(label, labelX, y);

    if(linkUrl){
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(11, 87, 208);
      const linkText = value || "Google Maps öffnen";
      doc.text(linkText, valueX, y);
      const w = doc.getTextWidth(linkText);
      doc.link(valueX, y - 8, w, 12, { url: linkUrl });
      next(15);
      return;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    const lines = doc.splitTextToSize(String(value || "-"), contentWidth - 92);
    doc.text(lines, valueX, y);
    next(Math.max(15, lines.length * 12));
  }

  function drawVerbandLine(category, from, verband, to){
    ensureSpace(28);
    const boxX = margin + 8;
    const boxY = y - 11;
    const boxW = contentWidth - 16;
    const boxH = 22;

    doc.setDrawColor(232, 234, 237);
    doc.setFillColor(250, 250, 252);
    doc.roundedRect(boxX, boxY, boxW, boxH, 6, 6, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text(`${category}:`, boxX + 10, y + 4);

    doc.setFont("helvetica", "normal");
    const categoryWidth = doc.getTextWidth(`${category}:`);
    const lineText = ` ${from} -> ${to}   (${verband})`;
    doc.text(lineText, boxX + 10 + categoryWidth + 4, y + 4);
    next(28);
  }

  function uniqueConnections(arr){
    return [...new Set((arr || []).map(v => JSON.stringify(v)))].map(v => JSON.parse(v));
  }

  const groupedMap = new Map();
  for(const rec of recs){
    if(!rec?.nr) continue;
    if(!groupedMap.has(rec.nr)){
      groupedMap.set(rec.nr, { nr: rec.nr, to: rec.to || "", bl: rec.bl || "", link: rec.link || "", outgoing: [], incoming: [] });
    }
    const bucket = groupedMap.get(rec.nr);
    for(const v of (rec.verbaende || [])){
      if(!v?.fullName && !v?.suffix) continue;
      const verbandName = v.fullName || `${rec.nr}_${v.suffix || ""}`;
      if(v.direction === "abgehend"){
        bucket.outgoing.push({ from: rec.nr, to: v.remoteKasten || "offen", verband: verbandName });
      } else {
        bucket.incoming.push({ from: v.remoteKasten || "unbekannt", to: rec.nr, verband: verbandName });
      }
    }
  }

  const grouped = [...groupedMap.values()].map(k => ({
    ...k,
    outgoing: uniqueConnections(k.outgoing),
    incoming: uniqueConnections(k.incoming)
  }));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(17, 24, 39);
  doc.text("Kästen / Schächte und Verbände", margin, y);
  next(22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(55, 65, 81);
  doc.text(`Projektnummer: ${projectNumber}`, margin, y);
  next(16);

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(`Erstellt: ${new Date().toLocaleString("de-AT")}`, margin, y);
  next(18);

  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageWidth - margin, y);
  next(20);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(17, 24, 39);
  doc.text(`Anzahl Kästen / Schächte: ${grouped.length}`, margin, y);
  next(14);

  const totalVerbaende = grouped.reduce((sum, k) => sum + (k.outgoing?.length || 0) + (k.incoming?.length || 0), 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(55, 65, 81);
  doc.text(`Gesamtanzahl Verbände: ${totalVerbaende}`, margin, y);
  next(22);

  grouped.forEach((k, index) => {
    ensureSpace(180);

    doc.setDrawColor(225, 228, 232);
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(margin, y, contentWidth, 26, 8, 8, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text(`${index + 1}. ${k.nr}`, margin + 12, y + 17);
    next(38);

    drawMetaLine("Projekt:", k.to || "-");
    drawMetaLine("Bauleiter:", k.bl || "-");
    drawMetaLine("Standort:", k.link ? "Google Maps öffnen" : "-", safeUrl(k.link) || null);

    next(4);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(17, 24, 39);
    doc.text("Verbände", margin, y);
    next(16);

    if(!k.outgoing.length && !k.incoming.length){
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(107, 114, 128);
      doc.text("Keine", margin + 10, y);
      next(20);
    } else {
      k.outgoing.forEach(v => drawVerbandLine("Abgehend", v.from, v.verband, v.to));
      k.incoming.forEach(v => drawVerbandLine("Ankommend", v.from, v.verband, v.to));
    }

    next(8);
    doc.setDrawColor(235, 235, 235);
    doc.line(margin, y, pageWidth - margin, y);
    next(20);
  });

  return doc;
}

/* ===========================
   PDF: BAULEITER-LISTE
   (in der HTML-Vorlage aufgerufen, aber nicht vorhanden – hier ergänzt)
=========================== */
async function exportBauleiterAsPDF(recs){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:"landscape", unit:"pt", format:"a4" });
  const bl = recs[0]?.bl || "-";
  const mail = bauleiterMap.get(bl) || "";
  doc.setFont("helvetica","bold");
  doc.setFontSize(16);
  doc.text(`Nummern – Bauleiter ${bl}`, 40, 42);
  doc.setFont("helvetica","normal");
  doc.setFontSize(10);
  doc.setTextColor(90,90,90);
  doc.text(`${mail ? mail + " · " : ""}${recs.length} Einträge · erstellt ${new Date().toLocaleString("de-AT")}`, 40, 60);
  doc.setTextColor(0,0,0);

  doc.autoTable({
    startY: 74,
    head: [["Nummer","TO-Nummer","Gebiet","Datum/Uhrzeit","Standort","Info","Verbände"]],
    body: recs.map(r=>[
      r.nr, r.to, r.sheet, r.dt,
      (r.lat!=null && r.lng!=null) ? "Google Maps" : "fehlt",
      r.info || "",
      (r.verbaende||[]).map(v=>`${v.direction==="abgehend"?"AB":"AN"}: ${v.fullName}${v.remoteKasten?` (${v.remoteKasten})`:""}`).join("\n")
    ]),
    styles: { fontSize: 8, cellPadding: 4, overflow:"linebreak" },
    headStyles: { fillColor: [17,17,17] },
    columnStyles: { 0:{cellWidth:70}, 1:{cellWidth:70}, 2:{cellWidth:45}, 3:{cellWidth:95}, 4:{cellWidth:60}, 5:{cellWidth:160} },
    didDrawCell: (data)=>{
      if(data.section==="body" && data.column.index===4){
        const link=safeUrl(getMapsLinkForRecord(recs[data.row.index]));
        if(link) doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: link });
      }
    }
  });
  return doc;
}

/* ===========================
   EXPORT ACTIONS
=========================== */
$("exportDownloadBtn").addEventListener("click", async ()=>{
  const recs=await collectRecordsFromFilters();
  if(!recs) return;

  const mode=getExportMode();

  if(mode === "connections"){
    const doc=await exportKaestenMitVerbaendenPDF(recs);
    doc.save(getExportFileName("Kaesten_Schaechte_Verbaende","pdf"));
    toast("Verband-PDF erstellt.");
    exportOverlay.style.display="none";
    return;
  }

  if(mode === "qr"){
    await exportLabelsAsPDF(recs, {
      size: $("labelSize").value,
      type: $("qrLabelType").value,
      onlyWithLocation: $("labelsOnlyWithLocation").checked,
      onePerPage: $("labelsOnePerPage").checked,
      fileName: getExportFileName("QR_Labels","pdf")
    });
    exportOverlay.style.display="none";
    return;
  }

  const filterBLOn=$("exportFilterBauleiter").checked;
  const blVal=$("exportBauleiterSelect").value.trim();
  if(filterBLOn && blVal){
    const doc=await exportBauleiterAsPDF(recs);
    doc.save(getExportFileName("BauleiterExport","pdf"));
    toast("Bauleiter-PDF erstellt.");
    exportOverlay.style.display="none";
    return;
  }

  // Haupt-Export: Excel, ein Blatt je Gebiets-Kürzel
  const out=XLSX.utils.book_new();
  const bySheet=new Map();
  for(const r of recs){
    if(!bySheet.has(r.sheet)) bySheet.set(r.sheet, []);
    bySheet.get(r.sheet).push(r);
  }
  for(const [sn, list] of bySheet.entries()){
    const header=["Nummer","TO-Nummer","Bauleiter","Datum/Uhrzeit","Lat","Lng","GoogleMapsLink","Info"];
    const rows=[header];
    for(const rec of list){
      rows.push([rec.nr,rec.to,rec.bl,rec.dt,rec.lat??"",rec.lng??"",rec.link??"",rec.info??""]);
    }
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"]=[{wch:16},{wch:18},{wch:24},{wch:20},{wch:14},{wch:14},{wch:38},{wch:52}];
    XLSX.utils.book_append_sheet(out, ws, String(sn).slice(0,31));
  }
  XLSX.writeFile(out, getExportFileName("Export","xlsx"));
  toast("Excel Export-Download gestartet.");
  exportOverlay.style.display="none";
});

/* ===========================
   INIT
=========================== */
(async function init(){
  await run(loadMeta);
  applyEditModeUI();
})();

})();
