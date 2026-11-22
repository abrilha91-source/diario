/* Mi diario v2 — app privada. Todo vive en IndexedDB de este dispositivo. Nada se envía a ningún lado. */
'use strict';
const APP_VERSION = '2.0';
const TZ = 'America/Mexico_City';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmt = (d, opts) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, ...opts }).format(new Date(d));
const fmtFull = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = d => fmt(d, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = d => fmt(d, { hour: '2-digit', minute: '2-digit' });
const isoDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const todayISO = () => isoDay(Date.now());
const isoToDate = iso => new Date(iso + 'T12:00:00-06:00');
const daysBetween = (a, b) => Math.round((isoToDate(b) - isoToDate(a)) / 86400000);
const addDays = (iso, n) => isoDay(isoToDate(iso).getTime() + n * 86400000);
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const hashStr = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/* ---------- IndexedDB (v1 → v2) ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('mi-diario', 2);
      r.onupgradeneeded = ev => {
        const db = r.result, old = ev.oldVersion;
        if (old < 1) {
          db.createObjectStore('entries', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
          const m = db.createObjectStore('media', { keyPath: 'id' }); m.createIndex('entryId', 'entryId'); m.createIndex('kind', 'kind');
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (old < 2) db.createObjectStore('checkins', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      };
      r.onsuccess = () => { this.db = r.result; this.db.onversionchange = () => { this.db.close(); location.reload(); }; res(); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => toast('Cierra otras pestañas del diario para actualizar.', 5000);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); let out;
      const s = Array.isArray(store) ? store.map(n => t.objectStore(n)) : t.objectStore(store);
      Promise.resolve(fn(s)).then(v => out = v);
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Operación cancelada (¿sin espacio?)'));
    });
  },
  req: r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  all(store) { return this.tx(store, 'readonly', s => this.req(s.getAll())); },
  get(store, key) { return this.tx(store, 'readonly', s => this.req(s.get(key))); },
  put(store, val) { return this.tx(store, 'readwrite', s => { s.put(val); }); },
  del(store, key) { return this.tx(store, 'readwrite', s => { s.delete(key); }); },
  count(store) { return this.tx(store, 'readonly', s => this.req(s.count())); },
  async meta(key, val) { if (val === undefined) { const r = await this.get('meta', key); return r ? r.value : undefined; } return this.put('meta', { key, value: val }); },
  clear() { return this.tx(['entries', 'media', 'meta', 'checkins'], 'readwrite', ss => ss.forEach(s => s.clear())); }
};
// Normaliza entradas de la v1 (sin etiquetas, favoritas, tipo ni historial).
const normEntry = e => Object.assign({ tags: [], pinned: false, kind: 'normal', prompt: null, history: [], audios: [], photos: [], transcripts: [], title: '', text: '', mood: null }, e);
const Entries = { async all() { return (await DB.all('entries')).map(normEntry); }, async get(id) { const e = await DB.get('entries', id); return e && normEntry(e); } };

/* ---------- ajustes ---------- */
const DEFAULTS = { theme: 'auto', textSize: 'm', ncDate: '', reminderTime: '', showMemories: true, autoLock: true, albums: [], urges: 0, urgeLog: [], celebrated: [], lowMoodDismissed: '', reminderDismissed: '' };
let S = { ...DEFAULTS };
async function loadSettings() {
  S = { ...DEFAULTS, ...((await DB.meta('settings')) || {}) };
  const oldAuto = await DB.meta('autoLock'); // v1
  if (oldAuto !== undefined) { S.autoLock = oldAuto !== false; await DB.del('meta', 'autoLock'); await saveSettings(); }
  applyLook();
}
const saveSettings = () => DB.meta('settings', S);
async function setSetting(k, v) { S[k] = v; await saveSettings(); }
function applyLook() {
  document.documentElement.dataset.theme = S.theme;
  document.documentElement.style.fontSize = { s: '15px', m: '16px', l: '18px', xl: '20px' }[S.textSize] || '16px';
  const dark = S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').content = dark ? '#1d1726' : '#7a5c9e';
}

/* ---------- utilidades UI ---------- */
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms); }
function dialogAsk(msg, { yes = 'Sí', no = 'Cancelar', danger = false, typeWord = null, input = null, input2 = null, html = false } = {}) {
  return new Promise(res => {
    const d = $('#confirmDlg'), i1 = $('#confirmInput'), i2 = $('#confirmInput2'), y = $('#confirmYes'), n = $('#confirmNo');
    $('#confirmMsg')[html ? 'innerHTML' : 'textContent'] = msg; y.textContent = yes; n.textContent = no; y.className = 'btn' + (danger ? ' danger' : '');
    const setup = (el, cfg) => { el.hidden = !cfg; el.value = ''; if (cfg) { el.type = cfg.type || 'text'; el.placeholder = cfg.placeholder || ''; el.value = cfg.value || ''; } };
    setup(i1, typeWord ? { placeholder: `Escribe ${typeWord}` } : input); setup(i2, input2);
    const done = v => { d.close(); y.onclick = n.onclick = null; res(v); };
    y.onclick = () => {
      if (typeWord) { if (i1.value.trim().toUpperCase() !== typeWord) { toast(`Escribe ${typeWord} para confirmar`); return; } return done(true); }
      if (input && input2) return done([i1.value, i2.value]);
      if (input) return done(i1.value);
      done(true);
    };
    n.onclick = () => done(input ? null : false);
    d.oncancel = e => { e.preventDefault(); done(input ? null : false); };
    d.showModal(); if (input || typeWord) setTimeout(() => i1.focus(), 50);
  });
}
const confirmBox = (msg, o) => dialogAsk(msg, o);
const urls = new Set();
function blobURL(b) { const u = URL.createObjectURL(b); urls.add(u); return u; }
function freeURLs() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
}
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

/* ---------- PIN ---------- */
const PIN = {
  async hash(pin, saltB64) {
    const salt = saltB64 ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
    const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
    return { salt: b64(salt), hash: b64(bits) };
  },
  async isSet() { return !!(await DB.meta('pin')); },
  async set(pin) { await DB.meta('pin', await this.hash(pin)); },
  async check(pin) { const p = await DB.meta('pin'); if (!p) return false; return (await this.hash(pin, p.salt)).hash === p.hash; }
};
const Lock = {
  mode: 'unlock', buf: '', first: '', fails: 0,
  show(mode) {
    this.mode = mode; this.buf = ''; this.first = ''; $('#pinError').textContent = '';
    $('#app').hidden = true; $('#lock').hidden = false; freeURLs();
    $$('dialog[open]').forEach(d => d.close());
    if (window.W) W.stopAll();
    const t = { unlock: ['Hola, mi Cap.', 'Escribe tu PIN para abrir tu diario.'], setup: ['Bienvenida, mi Cap. 🤍', 'Crea un PIN de 4 a 8 números. Protege tu diario en este teléfono. Si lo olvidas no se puede recuperar, así que elige uno que recuerdes.'], change: ['Cambiar PIN', 'Escribe tu PIN nuevo (4 a 8 números).'] }[mode];
    $('#lockTitle').textContent = t[0]; $('#lockMsg').textContent = t[1];
    $('#forgotPin').hidden = mode === 'setup'; $('#forgotPin').textContent = mode === 'change' ? 'Cancelar' : 'Olvidé mi PIN';
    this.render();
  },
  render() { $$('#pinDots span').forEach((s, i) => { s.classList.toggle('on', i < this.buf.length); s.hidden = i >= Math.max(4, this.buf.length); }); },
  press(k) {
    if (k === 'del') this.buf = this.buf.slice(0, -1);
    else if (k === 'ok') return this.submit();
    else if (this.buf.length < 8) this.buf += k;
    $('#pinError').textContent = ''; this.render();
  },
  async submit() {
    const pin = this.buf;
    if (this.mode === 'unlock') {
      if (await PIN.check(pin)) { this.fails = 0; unlocked(); }
      else { this.fails++; this.buf = ''; this.render(); vibrate(80); $('#pinError').textContent = 'PIN incorrecto. Inténtalo con calma.'; if (this.fails >= 5) { $('#pinError').textContent = 'Espera 30 segundos e inténtalo de nuevo.'; $('#keypad').style.pointerEvents = 'none'; setTimeout(() => { $('#keypad').style.pointerEvents = ''; $('#pinError').textContent = ''; this.fails = 3; }, 30000); } }
      return;
    }
    if (pin.length < 4) { $('#pinError').textContent = 'Usa al menos 4 números.'; return; }
    if (!this.first) { this.first = pin; this.buf = ''; this.render(); $('#lockMsg').textContent = 'Escríbelo otra vez para confirmar.'; return; }
    if (pin !== this.first) { this.first = ''; this.buf = ''; this.render(); $('#pinError').textContent = 'No coinciden. Empecemos de nuevo.'; $('#lockMsg').textContent = 'Escribe tu PIN (4 a 8 números).'; return; }
    await PIN.set(pin); const wasSetup = this.mode === 'setup';
    toast('PIN guardado 🤍'); unlocked();
    if (wasSetup) setTimeout(() => Guide.open('usar'), 400);
  }
};
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (swReg) swReg.update().catch(() => {});
  if (!$('#app').hidden && S.autoLock && hiddenAt && Date.now() - hiddenAt > 60000 && !Rec.active) Lock.show('unlock');
});

/* ---------- arranque ---------- */
let swReg = null;
async function boot() {
  await DB.open(); await loadSettings();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyLook);
  document.addEventListener('keydown', e => { if ($('#lock').hidden) return; if (/^[0-9]$/.test(e.key)) Lock.press(e.key); else if (e.key === 'Backspace') Lock.press('del'); else if (e.key === 'Enter') Lock.press('ok'); });
  $('#keypad').addEventListener('click', e => { const b = e.target.closest('button'); if (b) Lock.press(b.dataset.k || b.textContent); });
  $('#forgotPin').onclick = () => Lock.mode === 'change' ? unlocked() : forgotPin();
  Lock.show((await PIN.isSet()) ? 'unlock' : 'setup');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('#updateBanner').hidden = false; });
    navigator.serviceWorker.register('sw.js').then(reg => {
      swReg = reg;
      reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if ((w.state === 'installed' || w.state === 'activated') && hadController) $('#updateBanner').hidden = false; }); });
    }).catch(() => {});
  }
  wireUI();
}
async function unlocked() {
  $('#lock').hidden = true; $('#app').hidden = false;
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
  showView(currentView); refreshBackupStatus(); checkReminder();
}
async function forgotPin() {
  const ok = await confirmBox('Si olvidaste tu PIN, la única opción es borrar el diario de este teléfono y empezar de nuevo. Después podrás importar tu último respaldo. ¿Quieres borrar todo?', { yes: 'Borrar todo', danger: true, typeWord: 'BORRAR' });
  if (!ok) return; await DB.clear(); await loadSettings(); toast('Diario borrado. Crea un PIN nuevo.'); Lock.show('setup');
}

/* ---------- navegación ---------- */
let currentView = 'inicio';
function showView(v) {
  currentView = v; freeURLs();
  $$('.view').forEach(s => s.hidden = s.id !== 'view-' + v);
  $$('.tabbar [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (window.W) W.stopAll();
  if (v === 'inicio') { renderTimeline(); W.renderHome(); }
  if (v === 'galeria') renderGallery();
  if (v === 'mas') renderMas();
  if (v === 'animo') W.renderAnimo();
  if (v === 'calma') W.renderCalma();
  window.scrollTo(0, 0);
}
const refreshCurrent = () => showView(currentView);
function greet() {
  const h = +fmt(Date.now(), { hour: 'numeric', hour12: false });
  $('#greeting').textContent = h < 6 ? 'Es de madrugada, mi Cap. Si no puedes dormir, aquí estoy para escucharte.' : h < 12 ? 'Buenos días, mi Cap. ¿Cómo amaneciste?' : h < 19 ? 'Buenas tardes, mi Cap. ¿Cómo va tu día?' : 'Buenas noches, mi Cap. ¿Qué traes en el corazón hoy?';
  $('#todayLabel').textContent = fmtDay(Date.now());
}

let wired = false, deferredInstall = null;
function wireUI() {
  if (wired) return; wired = true;
  $$('.tabbar [data-view]').forEach(b => b.onclick = () => showView(b.dataset.view));
  $('#tabNew').onclick = () => $('#newMenu').showModal();
  $('#newMenuClose').onclick = () => $('#newMenu').close();
  $('#newMenu').onclick = e => { const b = e.target.closest('[data-act]'); if (!b) return; $('#newMenu').close(); newAction(b.dataset.act); };
  $('#openMas').onclick = () => showView('mas');
  $('#lockNow').onclick = () => Lock.show('unlock');
  $('#search').oninput = () => renderTimeline();
  $('#filters').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; $$('#filters .chip').forEach(c => c.classList.toggle('active', c === b)); renderTimeline(); };
  $('#tagFilters').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; activeTag = activeTag === b.dataset.tag ? null : b.dataset.tag; renderTimeline(); };
  $('#openGuide').onclick = () => Guide.open('usar'); $('#openGuideFromEmpty').onclick = () => Guide.open('usar');
  $('#exportBtn').onclick = exportBackup;
  $('#importBtn').onclick = () => pickBackup('import');
  $('#verifyBtn').onclick = () => pickBackup('verify');
  $('#fileBackup').onchange = e => { const f = e.target.files[0]; if (!f) return; backupMode === 'verify' ? verifyBackup(f) : importBackup(f); };
  $('#changePin').onclick = () => Lock.show('change');
  $('#autoLock').onchange = e => setSetting('autoLock', e.target.checked);
  $('#showMemories').onchange = e => setSetting('showMemories', e.target.checked);
  $('#ncDate').onchange = e => { if (e.target.value > todayISO()) { toast('La fecha no puede ser futura.'); e.target.value = S.ncDate; return; } setSetting('ncDate', e.target.value); toast(e.target.value ? 'Contador guardado 🌱' : 'Contador quitado'); };
  $('#reminderTime').onchange = e => { setSetting('reminderTime', e.target.value); toast(e.target.value ? 'Recordatorio guardado ⏰' : 'Recordatorio quitado'); };
  $('#icsBtn').onclick = downloadICS;
  $('#themeChips').onclick = async e => { const b = e.target.closest('.chip'); if (!b) return; await setSetting('theme', b.dataset.theme); applyLook(); renderMas(); };
  $('#sizeChips').onclick = async e => { const b = e.target.closest('.chip'); if (!b) return; await setSetting('textSize', b.dataset.size); applyLook(); renderMas(); };
  $('#printBtn').onclick = () => Printer.open();
  $('#wipeAll').onclick = async () => {
    if (!(await confirmBox('Esto borra TODAS tus entradas, check-ins, audios y fotos de este teléfono. No se puede deshacer. ¿Ya tienes un respaldo verificado?', { yes: 'Borrar todo', danger: true, typeWord: 'BORRAR' }))) return;
    await DB.clear(); await loadSettings(); toast('Diario borrado.'); Lock.show('setup');
  };
  $('#reloadApp').onclick = () => location.reload();
  Editor.wire(); Viewer.wire(); PhotoView.wire(); Guide.wire(); Gallery.wire(); Printer.wire();
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => { if (!deferredInstall) return Guide.open(isIOS ? 'iphone' : 'android'); deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#installBtn').hidden = true; };
  if (!isStandalone() && isIOS) $('#installBtn').hidden = false;
  W.wire();
  greet(); setInterval(greet, 60000);
}
function newAction(a) {
  if (a === 'checkin') return W.openCheckin();
  if (a === 'carta') return Editor.open(null, { kind: 'carta' });
  if (a === 'prompt') return W.openPrompts();
  Editor.open(null, { focus: a });
}

/* ---------- línea de tiempo ---------- */
let activeTag = null;
function entryTypes(e) { const t = []; if ((e.text || '').trim() || (e.title || '').trim()) t.push('texto'); if (e.audios.length) t.push('audio'); if (e.photos.length) t.push('foto'); if (e.kind === 'carta') t.push('carta'); if (e.pinned) t.push('fav'); return t; }
async function allTags() { const m = new Map(); for (const e of await Entries.all()) for (const t of e.tags) m.set(t, (m.get(t) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]); }
async function entryCard(e) {
  const b = document.createElement('button'); b.className = 'entry' + (e.kind === 'carta' ? ' carta' : '');
  const types = entryTypes(e);
  b.innerHTML = `<div class="meta"><span>${e.pinned ? '⭐ ' : ''}${e.kind === 'carta' ? '✉️ Carta · ' : ''}${esc(fmtTime(e.createdAt))}${e.updatedAt ? ' · editada' : ''}</span><span>${e.mood ? esc(e.mood.emoji + ' ' + e.mood.label) : ''}</span></div>
    ${e.title ? `<h3>${esc(e.title)}</h3>` : ''}${e.prompt && !e.title ? `<h3 class="muted">💡 ${esc(e.prompt)}</h3>` : ''}${e.text ? `<p>${esc(e.text)}</p>` : ''}
    <div class="thumbs"></div>
    <div class="badges">${types.includes('audio') ? `<span>🎙️ ${e.audios.length}</span>` : ''}${types.includes('foto') ? `<span>📷 ${e.photos.length}</span>` : ''}${e.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>`;
  b.onclick = () => Viewer.open(e.id);
  if (e.photos.length) {
    const th = b.querySelector('.thumbs');
    for (const id of e.photos.slice(0, 4)) { const m = await DB.get('media', id); if (m) { const i = document.createElement('img'); i.src = blobURL(m.blob); i.alt = ''; i.loading = 'lazy'; th.appendChild(i); } }
  }
  return b;
}
let tlSeq = 0;
async function renderTimeline() {
  const seq = ++tlSeq; const tl = $('#timeline');
  const q = $('#search').value.trim().toLowerCase();
  const f = ($('#filters .active') || {}).dataset?.f || 'todo';
  const all = (await Entries.all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tags = await allTags();
  if (seq !== tlSeq) return;
  if (activeTag && !tags.includes(activeTag)) activeTag = null;
  $('#tagFilters').innerHTML = tags.map(t => `<button class="chip small${t === activeTag ? ' active' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
  const list = all.filter(e => (f === 'todo' || entryTypes(e).includes(f)) && (!activeTag || e.tags.includes(activeTag)) &&
    (!q || [e.title, e.text, e.prompt, e.mood && e.mood.label, ...e.tags, ...(e.transcripts || []), fmtDay(e.createdAt)].join(' ').toLowerCase().includes(q)));
  $('#emptyState').hidden = all.length > 0;
  const frag = document.createDocumentFragment();
  if (all.length && !list.length) { tl.innerHTML = '<p class="muted center">No encontré nada con ese filtro, mi Cap.</p>'; return; }
  const pinned = list.filter(e => e.pinned), rest = f === 'fav' ? [] : list.filter(e => !e.pinned);
  const label = t => { const h = document.createElement('p'); h.className = 'day-label'; h.textContent = t; frag.appendChild(h); };
  if (pinned.length) { label('⭐ Favoritas'); for (const e of pinned) frag.appendChild(await entryCard(e)); }
  let lastDay = '';
  for (const e of rest) {
    const dk = isoDay(e.createdAt);
    if (dk !== lastDay) { lastDay = dk; label(fmtDay(e.createdAt)); }
    frag.appendChild(await entryCard(e));
  }
  if (seq !== tlSeq) return;
  tl.innerHTML = ''; tl.appendChild(frag);
}

/* ---------- fotos ---------- */
let photoCb = null;
function pickPhotos(cb) { photoCb = cb; const i = $('#filePhotos'); i.value = ''; i.click(); }
async function compressImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const max = 2048, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return out && out.size < file.size ? out : file;
  } catch (e) { return file; }
}
async function savePhotos(files, entryId, compress, album = null) {
  const ids = []; let n = 0;
  for (const f of files) {
    const blob = compress ? await compressImage(f) : f;
    const id = uid();
    try { await DB.put('media', { id, kind: 'photo', entryId, album, caption: '', blob, mime: blob.type || f.type || 'image/jpeg', name: f.name || 'foto.jpg', size: blob.size, createdAt: new Date().toISOString(), originalDate: f.lastModified ? new Date(f.lastModified).toISOString() : null, compressed: blob !== f }); }
    catch (err) { toast(`No se pudo guardar la foto ${n + 1}: ¿sin espacio?`, 5000); break; }
    ids.push(id); n++; progress(true, n, files.length, `Guardando fotos… ${n}/${files.length}`, '#galProgress');
  }
  progress(false, 0, 1, '', '#galProgress');
  toast(`${n} foto${n !== 1 ? 's' : ''} guardada${n !== 1 ? 's' : ''} 🤍. Haz y verifica un respaldo antes de borrarlas del teléfono.`, 4500);
  refreshBackupStatus();
  return ids;
}
const allPhotos = () => DB.tx('media', 'readonly', s => DB.req(s.index('kind').getAll('photo')));
async function albumList() { const set = new Set(S.albums); (await allPhotos()).forEach(p => p.album && set.add(p.album)); return [...set].sort((a, b) => a.localeCompare(b, 'es')); }
async function fillAlbumSelect(sel, current) {
  const albums = await albumList();
  sel.innerHTML = `<option value="">Sin álbum</option>` + albums.map(a => `<option value="${esc(a)}">📁 ${esc(a)}</option>`).join('') + '<option value="__new">＋ Nuevo álbum…</option>';
  sel.value = current || '';
}
async function askNewAlbum() {
  const name = ((await dialogAsk('Nombre del álbum nuevo:', { yes: 'Crear', input: { placeholder: 'ej. Momentos bonitos' } })) || '').trim().slice(0, 40);
  if (!name) return null; if (!S.albums.includes(name)) { S.albums.push(name); await saveSettings(); } return name;
}
const Gallery = {
  filter: 'all', selecting: false, sel: new Set(),
  wire() {
    $('#albumSel').onchange = async e => { if (e.target.value === '__new') { const n = await askNewAlbum(); await fillAlbumSelect(e.target, n); } };
    $('#addGalleryPhotos').onclick = () => pickPhotos(async files => { await savePhotos(files, null, $('#galleryCompress').checked, $('#albumSel').value || null); renderGallery(); });
    $('#albumFilters').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; this.filter = b.dataset.al; renderGallery(); };
    $('#selectMode').onclick = () => { this.selecting = !this.selecting; this.sel.clear(); renderGallery(); };
    $('#selDelete').onclick = async () => {
      if (!this.sel.size || !(await confirmBox(`¿Borrar ${this.sel.size} foto(s) del diario? No se puede deshacer.`, { yes: 'Borrar', danger: true }))) return;
      for (const id of this.sel) await deletePhoto(id);
      toast('Fotos borradas.'); this.sel.clear(); this.selecting = false; renderGallery();
    };
    $('#selMove').onclick = async () => {
      if (!this.sel.size) return;
      const albums = await albumList();
      const html = `Mover ${this.sel.size} foto(s) a:<br><select id="moveSel" class="full-select">${['<option value="">Sin álbum</option>', ...albums.map(a => `<option value="${esc(a)}">${esc(a)}</option>`), '<option value="__new">＋ Nuevo álbum…</option>'].join('')}</select>`;
      const p = dialogAsk(html, { yes: 'Mover', html: true }); const msel = $('#moveSel');
      if (!(await p)) return;
      let target = msel.value;
      if (target === '__new') { target = await askNewAlbum(); if (!target) return; }
      for (const id of this.sel) { const m = await DB.get('media', id); if (m) { m.album = target || null; await DB.put('media', m); } }
      toast('Fotos movidas 📁'); this.sel.clear(); this.selecting = false; renderGallery();
    };
  }
};
async function deletePhoto(id) {
  const m = await DB.get('media', id);
  if (m && m.entryId) { const e = await DB.get('entries', m.entryId); if (e) { e.photos = (e.photos || []).filter(x => x !== m.id); await DB.put('entries', e); } }
  await DB.del('media', id);
}
async function renderGallery() {
  const g = $('#gallery'); freeURLs(); g.innerHTML = '';
  const cur = $('#albumSel').value; await fillAlbumSelect($('#albumSel'), cur && cur !== '__new' ? cur : '');
  const all = (await allPhotos()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const albums = await albumList();
  if (Gallery.filter.startsWith('al:') && !albums.includes(Gallery.filter.slice(3))) Gallery.filter = 'all';
  $('#albumFilters').innerHTML = [['all', 'Todas'], ['none', 'Sueltas'], ['entry', '📝 De entradas'], ...albums.map(a => ['al:' + a, '📁 ' + a])].map(([k, l]) => `<button class="chip small${Gallery.filter === k ? ' active' : ''}" data-al="${esc(k)}">${esc(l)}</button>`).join('');
  const photos = all.filter(p => Gallery.filter === 'all' || (Gallery.filter === 'none' && !p.album && !p.entryId) || (Gallery.filter === 'entry' && p.entryId) || (Gallery.filter === 'al:' + p.album));
  const total = all.reduce((s, p) => s + p.size, 0);
  $('#galleryCount').textContent = all.length ? `${photos.length} de ${all.length} foto${all.length > 1 ? 's' : ''} · total ${fmtSize(total)}` : 'Todavía no hay fotos.';
  $('#selectMode').textContent = Gallery.selecting ? 'Cancelar' : 'Seleccionar';
  $('#selectBar').hidden = !Gallery.selecting;
  const updCount = () => $('#selCount').textContent = `${Gallery.sel.size} seleccionada${Gallery.sel.size === 1 ? '' : 's'}`; updCount();
  for (const p of photos) {
    const b = document.createElement('button'); b.className = 'ph' + (Gallery.sel.has(p.id) ? ' selected' : '');
    b.innerHTML = `<img alt="${esc(p.caption || '')}" loading="lazy" src="${blobURL(p.blob)}">${p.entryId ? '<span class="tag">entrada</span>' : ''}${p.caption ? '<span class="tag r">💬</span>' : ''}${Gallery.selecting ? `<span class="check">${Gallery.sel.has(p.id) ? '✓' : ''}</span>` : ''}`;
    b.onclick = () => {
      if (Gallery.selecting) { Gallery.sel.has(p.id) ? Gallery.sel.delete(p.id) : Gallery.sel.add(p.id); b.classList.toggle('selected'); b.querySelector('.check').textContent = Gallery.sel.has(p.id) ? '✓' : ''; updCount(); }
      else PhotoView.open(p.id, renderGallery);
    };
    g.appendChild(b);
  }
}
const PhotoView = {
  id: null, after: null,
  wire() {
    $('#photoClose').onclick = () => this.close();
    $('#photoViewer').oncancel = e => { e.preventDefault(); this.close(); };
    $('#photoAlbum').onchange = async e => { if (e.target.value === '__new') { const n = await askNewAlbum(); await fillAlbumSelect(e.target, n); } };
    $('#photoDownload').onclick = async () => { const m = await DB.get('media', this.id); if (m) downloadBlob(m.blob, m.name || 'foto.jpg'); };
    $('#photoDelete').onclick = async () => {
      if (!(await confirmBox('¿Borrar esta foto del diario?', { yes: 'Borrar', danger: true }))) return;
      await deletePhoto(this.id); $('#photoViewer').close(); toast('Foto borrada.'); this.after && this.after();
    };
  },
  async close() {
    const m = await DB.get('media', this.id);
    if (m) { const cap = $('#photoCaption').value.trim(), v = $('#photoAlbum').value, al = v === '__new' ? (m.album || null) : (v || null); if (cap !== (m.caption || '') || al !== (m.album || null)) { m.caption = cap; m.album = al; await DB.put('media', m); toast('Foto actualizada'); } }
    $('#photoViewer').close(); this.after && this.after();
  },
  async open(id, after) {
    const m = await DB.get('media', id); if (!m) return; this.id = id; this.after = after;
    $('#photoBig').src = blobURL(m.blob);
    $('#photoCaption').value = m.caption || '';
    await fillAlbumSelect($('#photoAlbum'), m.album);
    $('#photoInfo').textContent = `${fmtSize(m.size)}${m.compressed ? ' · comprimida' : ' · original'} · ${fmtShort(m.createdAt)}`;
    $('#photoViewer').showModal();
  }
};

/* ---------- grabación ---------- */
const Rec = {
  active: false, mr: null, chunks: [], t0: 0, timer: null, stream: null,
  supported: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder),
  mime() { for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t; return ''; },
  async start(onDone) {
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast('No pude usar el micrófono. Revisa el permiso en Ajustes, o usa «Subir audio».', 5000); return false; }
    const mt = this.mime(); this.mr = new MediaRecorder(this.stream, mt ? { mimeType: mt } : undefined); this.chunks = [];
    this.mr.ondataavailable = e => e.data && e.data.size && this.chunks.push(e.data);
    this.mr.onstop = () => { const type = this.mr.mimeType || mt || 'audio/webm'; const blob = new Blob(this.chunks, { type }); this.stream.getTracks().forEach(t => t.stop()); this.active = false; onDone(blob, (Date.now() - this.t0) / 1000); };
    this.mr.start(1000); this.active = true; this.t0 = Date.now();
    return true;
  },
  stop() { if (this.mr && this.mr.state !== 'inactive') this.mr.stop(); }
};
const extFor = t => /mp4|m4a|aac/.test(t) ? 'm4a' : /ogg/.test(t) ? 'ogg' : /mpeg|mp3/.test(t) ? 'mp3' : /wav/.test(t) ? 'wav' : 'webm';
function speedControls(audio) {
  const d = document.createElement('div'); d.className = 'chips speed';
  d.innerHTML = '<span class="muted small">Velocidad:</span>' + [0.75, 1, 1.25, 1.5, 2].map(s => `<button type="button" class="chip small${s === 1 ? ' active' : ''}" data-s="${s}">${s}×</button>`).join('');
  d.onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; audio.playbackRate = +b.dataset.s; audio.preservesPitch = true; d.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === b)); };
  return d;
}

/* ---------- dictado (opcional) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const Dictado = {
  rec: null, on: false,
  start(onText, onEnd) {
    this.rec = new SR(); this.rec.lang = 'es-MX'; this.rec.continuous = true; this.rec.interimResults = false;
    this.rec.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim()); };
    this.rec.onerror = e => { toast(e.error === 'not-allowed' ? 'El dictado no tiene permiso en este navegador.' : 'El dictado se detuvo. Puedes seguir escribiendo o grabar un audio.', 4000); };
    this.rec.onend = () => { this.on = false; onEnd(); };
    try { this.rec.start(); this.on = true; } catch (e) { this.on = false; onEnd(); }
  },
  stop() { try { this.rec && this.rec.stop(); } catch (e) {} }
};

/* ---------- editor ---------- */
const parseTags = s => [...new Set(s.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '').slice(0, 30)).filter(Boolean))];
const Editor = {
  entry: null, draftAudios: [], draftPhotos: [], removed: [], mood: null, kind: 'normal', prompt: null,
  wire() {
    $('#filePhotos').onchange = e => { const fs = Array.from(e.target.files || []); if (fs.length && photoCb) photoCb(fs); };
    const mr = $('#moods .mood-row');
    C.MOODS.forEach(([e, l]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mood'; b.dataset.l = l; b.textContent = e + ' ' + l; b.onclick = () => { this.mood = this.mood && this.mood.label === l ? null : { emoji: e, label: l }; this.renderMoods(); }; mr.appendChild(b); });
    $('#editorCancel').onclick = () => this.cancel();
    $('#editor').oncancel = e => { e.preventDefault(); this.cancel(); };
    $('#editorSave').onclick = () => this.save();
    $('#recBtn').onclick = () => this.toggleRec();
    $('#uploadAudioBtn').onclick = () => { const i = $('#fileAudio'); i.value = ''; i.click(); };
    $('#fileAudio').onchange = e => { for (const f of e.target.files) this.draftAudios.push({ id: uid(), blob: f, mime: f.type || 'audio/mpeg', name: f.name, isNew: true, source: 'archivo' }); this.renderAudios(); };
    $('#addPhotosBtn').onclick = () => pickPhotos(async files => { for (const f of files) { const blob = $('#entryCompress').checked ? await compressImage(f) : f; this.draftPhotos.push({ id: uid(), blob, name: f.name, isNew: true, compressed: blob !== f, originalDate: f.lastModified ? new Date(f.lastModified).toISOString() : null }); } this.renderPhotos(); });
    $('#promptPickBtn').onclick = () => W.openPrompts(p => this.applyPrompt(p));
    $('#tagSuggest').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; const cur = parseTags($('#entryTags').value); if (!cur.includes(b.dataset.tag)) cur.push(b.dataset.tag); $('#entryTags').value = cur.join(', '); };
    if (SR) { $('#dictateBtn').hidden = false; $('#dictateBtn').onclick = () => this.toggleDictado(); }
    $('#recNote').textContent = Rec.supported() ? 'Tus audios siempre se guardan completos, aunque no los transcribas.' : 'Este navegador no permite grabar aquí. Usa «Subir audio» con una nota de voz de tu teléfono.';
    if (!Rec.supported()) $('#recBtn').disabled = true;
  },
  renderMoods() { $$('#moods .mood').forEach(b => b.classList.toggle('on', !!this.mood && b.dataset.l === this.mood.label)); },
  applyPrompt(p) {
    if (p && p.carta) { this.kind = 'carta'; this.prompt = null; }
    else if (p) { this.prompt = p; if (this.kind === 'carta') this.kind = 'normal'; }
    this.renderBanners();
  },
  renderBanners() {
    $('#cartaBanner').hidden = this.kind !== 'carta';
    $('#promptBanner').hidden = !this.prompt;
    $('#promptBanner').innerHTML = this.prompt ? `💡 <b>${esc(this.prompt)}</b> <button type="button" class="link small" id="clearPrompt">quitar</button>` : '';
    if (this.prompt) $('#clearPrompt').onclick = () => { this.prompt = null; this.renderBanners(); };
    $('#editorTitle').textContent = this.kind === 'carta' ? 'Carta que no se envía' : this.entry ? 'Editar entrada' : 'Nueva entrada';
    $('#entryText').placeholder = this.kind === 'carta' ? 'Escribe sin filtro todo lo que necesitas decir; nadie más la leerá…' : this.prompt ? 'Escribe con calma, no hay respuestas correctas…' : 'Escribe lo que traigas en el corazón…';
  },
  async open(id = null, { focus = 'texto', kind = 'normal', prompt = null } = {}) {
    this.entry = id ? await Entries.get(id) : null; this.removed = [];
    this.draftAudios = []; this.draftPhotos = [];
    const e = this.entry;
    this.kind = e ? e.kind : kind; this.prompt = e ? e.prompt : prompt;
    $('#editorDate').textContent = e ? 'Escrita el ' + fmtFull(e.createdAt) : fmtFull(Date.now()) + ' (hora del centro de México)';
    $('#entryTitle').value = e ? e.title : ''; $('#entryText').value = e ? e.text : '';
    $('#entryTags').value = e ? e.tags.join(', ') : ''; $('#entryPinned').checked = e ? e.pinned : false;
    this.mood = e ? e.mood : null; this.renderMoods(); this.renderBanners();
    const tags = await allTags(); $('#tagSuggest').innerHTML = tags.slice(0, 12).map(t => `<button type="button" class="chip small" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
    if (e) {
      for (const mid of e.audios) { const m = await DB.get('media', mid); if (m) this.draftAudios.push({ ...m, transcript: m.transcript || '' }); }
      for (const mid of e.photos) { const m = await DB.get('media', mid); if (m) this.draftPhotos.push(m); }
    }
    this.renderAudios(); this.renderPhotos();
    $('#editor').showModal(); $('#editor').scrollTop = 0;
    if (focus === 'audio') $('#recBtn').scrollIntoView({ block: 'center' });
    if (focus === 'foto') setTimeout(() => $('#addPhotosBtn').click(), 50);
  },
  renderAudios() {
    const box = $('#draftAudios'); box.innerHTML = '';
    this.draftAudios.forEach((a, i) => {
      const d = document.createElement('div'); d.className = 'audio-item';
      d.innerHTML = `<audio controls preload="metadata" src="${blobURL(a.blob)}"></audio>
        <div class="row"><span class="small muted">${esc(a.source === 'grabado' ? 'Grabado' : a.name || 'Audio')} · ${fmtSize(a.blob.size)}${a.duration ? ' · ' + Math.round(a.duration) + ' s' : ''}</span>
        <button type="button" class="link small">Quitar</button></div>
        <textarea class="small mini-ta" rows="2" placeholder="Notas o transcripción (opcional)">${esc(a.transcript || '')}</textarea>`;
      d.querySelector('button').onclick = async () => { if (!(await confirmBox('¿Quitar este audio de la entrada?', { yes: 'Quitar', danger: true }))) return; if (!a.isNew) this.removed.push(a.id); this.draftAudios.splice(i, 1); this.renderAudios(); };
      d.querySelector('textarea').oninput = ev => a.transcript = ev.target.value;
      box.appendChild(d);
    });
  },
  renderPhotos() {
    const g = $('#draftPhotos'); g.innerHTML = '';
    this.draftPhotos.forEach((p, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ph';
      b.innerHTML = `<img alt="" src="${blobURL(p.blob)}"><span class="x">✕</span>`;
      b.onclick = async () => { if (!(await confirmBox('¿Quitar esta foto de la entrada?', { yes: 'Quitar', danger: true }))) return; if (!p.isNew) this.removed.push(p.id); this.draftPhotos.splice(i, 1); this.renderPhotos(); };
      g.appendChild(b);
    });
  },
  async toggleRec() {
    if (Rec.active) { Rec.stop(); return; }
    if (Dictado.on) Dictado.stop();
    const ok = await Rec.start((blob, dur) => {
      clearInterval(Rec.timer); $('#recTimer').hidden = true; $('#recBtn').textContent = '⏺ Grabar'; $('#recBtn').classList.remove('danger');
      if (blob.size) { this.draftAudios.push({ id: uid(), blob, mime: blob.type, name: `nota-de-voz.${extFor(blob.type)}`, duration: dur, isNew: true, source: 'grabado' }); this.renderAudios(); toast('Audio listo. No olvides «Guardar».'); }
    });
    if (!ok) return;
    $('#recBtn').textContent = '⏹ Detener'; $('#recBtn').classList.add('danger'); $('#recTimer').hidden = false;
    const tick = () => { const s = Math.floor((Date.now() - Rec.t0) / 1000); $('#recTimer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    tick(); Rec.timer = setInterval(tick, 500);
  },
  toggleDictado() {
    if (Dictado.on) { Dictado.stop(); return; }
    if (Rec.active) { toast('Primero detén la grabación.'); return; }
    $('#dictateBtn').textContent = '⏹ Detener dictado'; $('#dictateStatus').textContent = 'Escuchando… (opcional, puede fallar sin internet)';
    Dictado.start(t => { const ta = $('#entryText'); ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + t; },
      () => { $('#dictateBtn').textContent = '🗣️ Dictar (opcional)'; $('#dictateStatus').textContent = ''; });
  },
  async cancel() {
    const dirty = this.draftAudios.some(a => a.isNew) || this.draftPhotos.some(p => p.isNew) || $('#entryText').value !== (this.entry ? this.entry.text : '');
    if (dirty && !(await confirmBox('¿Salir sin guardar? Lo que no guardaste se perderá.', { yes: 'Salir', danger: true }))) return;
    if (Rec.active) Rec.stop(); if (Dictado.on) Dictado.stop();
    $('#editor').close();
  },
  async save() {
    if (Rec.active) { toast('Detén la grabación antes de guardar.'); return; }
    if (Dictado.on) Dictado.stop();
    const title = $('#entryTitle').value.trim(), text = $('#entryText').value, tags = parseTags($('#entryTags').value), pinned = $('#entryPinned').checked;
    if (!title && !text.trim() && !this.draftAudios.length && !this.draftPhotos.length) { toast('La entrada está vacía, mi Cap.'); return; }
    const now = new Date().toISOString();
    const e = this.entry || normEntry({ id: uid(), createdAt: now });
    try {
      for (const a of this.draftAudios) {
        if (a.isNew) await DB.put('media', { id: a.id, kind: 'audio', entryId: e.id, blob: a.blob, mime: a.mime || a.blob.type, name: a.name, size: a.blob.size, duration: a.duration || null, transcript: a.transcript || '', source: a.source, createdAt: now });
        else { const m = await DB.get('media', a.id); if (m && m.transcript !== a.transcript) { m.transcript = a.transcript; await DB.put('media', m); } }
      }
      for (const p of this.draftPhotos) if (p.isNew) await DB.put('media', { id: p.id, kind: 'photo', entryId: e.id, album: null, caption: '', blob: p.blob, mime: p.blob.type || 'image/jpeg', name: p.name || 'foto.jpg', size: p.blob.size, compressed: !!p.compressed, originalDate: p.originalDate || null, createdAt: now });
      for (const id of this.removed) await DB.del('media', id);
      // Historial seguro: guarda la versión anterior si cambió el contenido.
      if (this.entry && (e.title !== title || e.text !== text || JSON.stringify(e.mood) !== JSON.stringify(this.mood) || e.tags.join() !== tags.join())) {
        e.history = [{ at: e.updatedAt || e.createdAt, title: e.title, text: e.text, mood: e.mood, tags: e.tags }, ...e.history].slice(0, 30);
        e.updatedAt = now;
      }
      Object.assign(e, { title, text, tags, pinned, mood: this.mood, kind: this.kind, prompt: this.prompt, audios: this.draftAudios.map(a => a.id), photos: this.draftPhotos.map(p => p.id), transcripts: this.draftAudios.map(a => a.transcript || '').filter(Boolean) });
      await DB.put('entries', e);
    } catch (err) { toast('No se pudo guardar: ' + (err && err.message || err) + '. Puede que el teléfono no tenga espacio.', 6000); return; }
    const wasEdit = !!this.entry;
    $('#editor').close(); toast(this.kind === 'carta' ? 'Tu carta quedó guardada solo aquí 🤍' : 'Guardado en tu diario 🤍'); refreshBackupStatus();
    if (wasEdit && $('#viewer').open) Viewer.open(e.id);
    if (currentView === 'inicio') { renderTimeline(); W.renderHome(); } else refreshCurrent();
  }
};

/* ---------- ver entrada ---------- */
const Viewer = {
  id: null,
  wire() {
    $('#viewerClose').onclick = () => $('#viewer').close();
    $('#viewerEdit').onclick = () => { $('#viewer').close(); Editor.open(this.id); };
    $('#viewerPin').onclick = async () => { const e = await Entries.get(this.id); e.pinned = !e.pinned; await DB.put('entries', e); toast(e.pinned ? '⭐ Marcada como favorita' : 'Ya no es favorita'); this.open(this.id); renderTimeline(); };
    $('#viewerDelete').onclick = async () => { if (!(await confirmBox('¿Borrar esta entrada con sus audios y fotos? No se puede deshacer.', { yes: 'Borrar', danger: true }))) return; await this.remove(); toast('Entrada borrada.'); };
    $('#viewerRelease').onclick = async () => {
      if (!(await confirmBox('Soltar esta carta la borrará para siempre de tu diario. Es un pequeño ritual para dejar ir. ¿Estás lista?', { yes: '🕊️ Soltar', danger: true }))) return;
      $('#viewerBody').classList.add('release'); await new Promise(r => setTimeout(r, 1600)); $('#viewerBody').classList.remove('release');
      await this.remove(); toast('La soltaste. Eso también es valentía, mi Cap. 🕊️', 4000);
    };
  },
  async remove() {
    const e = await Entries.get(this.id);
    for (const mid of [...e.audios, ...e.photos]) await DB.del('media', mid);
    await DB.del('entries', this.id); $('#viewer').close(); refreshCurrent();
  },
  async open(id) {
    const e = await Entries.get(id); if (!e) return; this.id = id;
    $('#viewerHead').textContent = e.kind === 'carta' ? 'Carta que no se envía' : 'Entrada';
    let h = '';
    if (e.kind === 'carta') h += '<div class="carta-banner">✉️ Esta carta <b>nunca se envía</b>. Solo vive aquí.</div>';
    h += `<p class="muted small">${esc(fmtFull(e.createdAt))}${e.updatedAt ? ' · editada ' + esc(fmtFull(e.updatedAt)) : ''}</p>`;
    if (e.mood) h += `<p>${esc(e.mood.emoji + ' ' + e.mood.label)}</p>`;
    if (e.prompt) h += `<p class="prompt-banner">💡 ${esc(e.prompt)}</p>`;
    if (e.title) h += `<h3>${esc(e.title)}</h3>`;
    if (e.text) h += `<div class="viewer-text">${esc(e.text)}</div>`;
    if (e.tags.length) h += `<div class="badges">${e.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>`;
    $('#viewerBody').innerHTML = h;
    for (const mid of e.audios) {
      const m = await DB.get('media', mid); if (!m) continue;
      const d = document.createElement('div'); d.className = 'audio-item'; d.style.margin = '.6rem 0';
      d.innerHTML = `<audio controls preload="metadata" src="${blobURL(m.blob)}"></audio><div class="row"><span class="small muted">${esc(m.source === 'grabado' ? 'Nota de voz' : m.name)} · ${fmtSize(m.size)}</span><button class="link small">⬇️ Descargar</button></div>${m.transcript ? `<div class="transcript">${esc(m.transcript)}</div>` : ''}`;
      d.querySelector('button').onclick = () => downloadBlob(m.blob, m.name || 'audio.' + extFor(m.mime));
      d.insertBefore(speedControls(d.querySelector('audio')), d.children[1]);
      $('#viewerBody').appendChild(d);
    }
    if (e.photos.length) {
      const g = document.createElement('div'); g.className = 'grid'; g.style.marginTop = '.6rem';
      for (const mid of e.photos) { const m = await DB.get('media', mid); if (!m) continue; const b = document.createElement('button'); b.className = 'ph'; b.innerHTML = `<img alt="" src="${blobURL(m.blob)}">${m.caption ? '<span class="tag r">💬</span>' : ''}`; b.onclick = () => PhotoView.open(m.id, () => this.open(id)); g.appendChild(b); }
      $('#viewerBody').appendChild(g);
    }
    const hist = $('#viewerHistory'); hist.innerHTML = '';
    if (e.history.length) {
      const det = document.createElement('details'); det.className = 'card history';
      det.innerHTML = `<summary>🕘 Versiones anteriores (${e.history.length})</summary>` + e.history.map((v, i) => `<div class="hist-item"><p class="muted small">${esc(fmtFull(v.at))}${v.mood ? ' · ' + esc(v.mood.emoji + ' ' + v.mood.label) : ''}</p>${v.title ? `<b>${esc(v.title)}</b>` : ''}<div class="viewer-text small">${esc(v.text || '')}</div><button class="link small" data-restore="${i}">↩️ Restaurar esta versión</button></div>`).join('');
      det.onclick = async ev => {
        const b = ev.target.closest('[data-restore]'); if (!b) return;
        if (!(await confirmBox('¿Restaurar esta versión? La versión actual se guardará en el historial.', { yes: 'Restaurar' }))) return;
        const k = +b.dataset.restore, cur = await Entries.get(id), v = cur.history[k];
        cur.history = [{ at: cur.updatedAt || cur.createdAt, title: cur.title, text: cur.text, mood: cur.mood, tags: cur.tags }, ...cur.history.filter((_, j) => j !== k)].slice(0, 30);
        Object.assign(cur, { title: v.title, text: v.text, mood: v.mood, tags: v.tags || [], updatedAt: new Date().toISOString() });
        await DB.put('entries', cur); toast('Versión restaurada'); this.open(id); renderTimeline();
      };
      hist.appendChild(det);
    }
    $('#viewerPin').textContent = e.pinned ? '☆ Quitar de favoritas' : '⭐ Favorita';
    $('#viewerRelease').hidden = e.kind !== 'carta';
    if (!$('#viewer').open) $('#viewer').showModal();
  }
};

/* ---------- cifrado de respaldo (AES-GCM 256, por bloques, clave PBKDF2) ---------- */
const ENC_MAGIC = 'MDENC001', ENC_CHUNK = 4 * 1024 * 1024, ENC_ITER = 250000, ENC_HDR = 52;
async function deriveKey(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function ivFor(base, i) { const iv = base.slice(); const v = new DataView(iv.buffer); v.setUint32(8, v.getUint32(8) ^ i); return iv; }
async function encryptBlob(blob, password, onProg) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const hdr = new Uint8Array(ENC_HDR); hdr.set(new TextEncoder().encode(ENC_MAGIC), 0); hdr.set(salt, 8); hdr.set(iv, 24);
  const dv = new DataView(hdr.buffer); dv.setUint32(36, ENC_CHUNK, true); dv.setUint32(40, ENC_ITER, true); dv.setUint32(44, blob.size % 2 ** 32, true); dv.setUint32(48, Math.floor(blob.size / 2 ** 32), true);
  const key = await deriveKey(password, salt, ENC_ITER); const parts = [hdr];
  const n = Math.ceil(blob.size / ENC_CHUNK);
  for (let i = 0; i < n; i++) {
    const plain = await blob.slice(i * ENC_CHUNK, (i + 1) * ENC_CHUNK).arrayBuffer();
    parts.push(new Blob([await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivFor(iv, i), additionalData: hdr }, key, plain)]));
    onProg && onProg(i + 1, n);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}
async function isEncrypted(file) { return new TextDecoder().decode(await file.slice(0, 8).arrayBuffer()) === ENC_MAGIC; }
async function decryptBlob(file, password, onProg) {
  const hdr = new Uint8Array(await file.slice(0, ENC_HDR).arrayBuffer()); const dv = new DataView(hdr.buffer);
  const salt = hdr.slice(8, 24), iv = hdr.slice(24, 36), chunk = dv.getUint32(36, true), iter = dv.getUint32(40, true), size = dv.getUint32(44, true) + dv.getUint32(48, true) * 2 ** 32;
  const key = await deriveKey(password, salt, iter); const parts = []; const n = Math.ceil(size / chunk); let off = ENC_HDR, total = 0;
  for (let i = 0; i < n; i++) {
    const len = Math.min(chunk, size - i * chunk) + 16;
    let plain; try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFor(iv, i), additionalData: hdr }, key, await file.slice(off, off + len).arrayBuffer()); }
    catch (e) { throw new Error(i === 0 ? 'Contraseña incorrecta (o archivo dañado).' : 'El archivo cifrado está dañado o incompleto.'); }
    parts.push(new Blob([plain])); off += len; total += plain.byteLength; onProg && onProg(i + 1, n);
  }
  if (total !== size) throw new Error('El archivo cifrado está incompleto.');
  return new Blob(parts, { type: 'application/zip' });
}

/* ---------- respaldo ---------- */
async function backupEstimate() { const media = await DB.all('media'); return { bytes: media.reduce((s, m) => s + (m.blob ? m.blob.size : 0), 0), n: media.length }; }
async function refreshBackupStatus() {
  const last = await DB.meta('lastBackup');
  const [ne, nm, nc] = await Promise.all([DB.count('entries'), DB.count('media'), DB.count('checkins')]);
  const hasData = ne + nm + nc > 0;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  const sum = await DB.meta('lastBackupSummary');
  $('#backupStatus').innerHTML = last ? `Último respaldo: <strong>${esc(fmtFull(last))}</strong> (hace ${days} día${days === 1 ? '' : 's'})${sum ? `<br><span class="muted small">${esc(sum)}</span>` : ''}` : '<strong>Todavía no has hecho ningún respaldo.</strong>';
  const ban = $('#backupBanner');
  if (hasData && (!last || days >= 7)) {
    ban.hidden = false;
    ban.innerHTML = `${last ? `Tu último respaldo fue hace ${days} días.` : 'Aún no tienes respaldo.'} Si se borran los datos del navegador o pierdes el teléfono, se perdería tu diario. <br><button class="btn small" id="bannerBackup">Hacer respaldo ahora</button>`;
    $('#bannerBackup').onclick = () => { showView('mas'); exportBackup(); };
  } else ban.hidden = true;
  if (currentView === 'mas') {
    const est = await backupEstimate();
    $('#backupEstimate').textContent = `Tu próximo respaldo pesará aprox. ${fmtSize(est.bytes + 50000)} (${ne} entradas, ${nc} check-ins, ${est.n} fotos/audios).`;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate(); const p = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        $('#storageInfo').textContent = `Ocupado en el teléfono: ${fmtSize(e.usage || 0)}${e.quota ? ' de ~' + fmtSize(e.quota) + ' disponibles' : ''} · Almacenamiento ${p ? 'protegido (persistente) ✅' : 'no garantizado: instala la app en tu pantalla de inicio y haz respaldos'}.`;
      }
    } catch (e) {}
  }
}
function progress(on, done = 0, total = 1, label = '', sel = '#progress') {
  const p = $(sel); if (!p) return; p.hidden = !on; if (!on) return;
  p.querySelector('div').style.width = Math.round(100 * done / Math.max(1, total)) + '%'; p.querySelector('span').textContent = label;
}
const photoExt = m => /png/.test(m) ? 'png' : /heic/.test(m) ? 'heic' : /heif/.test(m) ? 'heif' : /webp/.test(m) ? 'webp' : /gif/.test(m) ? 'gif' : 'jpg';
async function buildBackup() {
  const entries = await DB.all('entries'), media = await DB.all('media'), checkins = await DB.all('checkins');
  const files = [];
  const mediaMeta = media.map(m => { const path = `media/${m.kind === 'photo' ? 'fotos' : 'audios'}/${m.id}.${m.kind === 'photo' ? photoExt(m.mime || '') : extFor(m.mime || '')}`; files.push({ name: path, data: m.blob }); const { blob, ...rest } = m; return { ...rest, size: blob.size, file: path }; });
  const { celebrated, lowMoodDismissed, reminderDismissed, ...ajustes } = S;
  const data = { app: 'mi-diario', formato: 2, version: APP_VERSION, exportadoEn: new Date().toISOString(), zonaHoraria: TZ, entradas: entries, checkins, archivos: mediaMeta, ajustes };
  files.unshift({ name: 'diario.json', data: JSON.stringify(data, null, 1) });
  files.unshift({ name: 'LEEME.txt', data: 'Respaldo de "Mi diario".\nPara restaurarlo: abre la app > ⚙️ > Importar respaldo y elige este archivo.\nNo lo descomprimas ni le cambies nada. Guárdalo en un lugar privado (iCloud Drive / Google Drive / Archivos).\n' });
  const zip = await MiniZip.createZip(files, (d, t) => progress(true, d, t, `Preparando respaldo… ${d}/${t}`));
  return { zip, count: { entries: entries.length, checkins: checkins.length, photos: media.filter(m => m.kind === 'photo').length, audios: media.filter(m => m.kind === 'audio').length } };
}
let exporting = false;
async function exportBackup() {
  if (exporting) return; exporting = true; const btn = $('#exportBtn'); btn.disabled = true;
  try {
    let password = null;
    if ($('#encryptBackup').checked) {
      const r = await dialogAsk('Elige una contraseña para tu respaldo. <b>Si la olvidas, el respaldo no se podrá abrir</b> (nadie puede recuperarla).', { yes: 'Continuar', html: true, input: { type: 'password', placeholder: 'Contraseña (mínimo 6 caracteres)' }, input2: { type: 'password', placeholder: 'Repite la contraseña' } });
      if (!r) throw 'cancel';
      if (r[0].length < 6) { toast('La contraseña debe tener al menos 6 caracteres.'); throw 'cancel'; }
      if (r[0] !== r[1]) { toast('Las contraseñas no coinciden.'); throw 'cancel'; }
      password = r[0];
    }
    progress(true, 0, 1, 'Preparando respaldo…');
    const { zip, count } = await buildBackup();
    let out = zip;
    if (password) out = await encryptBlob(zip, password, (d, t) => progress(true, d, t, `Cifrando… ${d}/${t}`));
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(/[^0-9]+/g, '-');
    const name = `respaldo-mi-diario-${stamp}${password ? '-cifrado.enc' : '.zip'}`;
    const file = new File([out], name, { type: password ? 'application/octet-stream' : 'application/zip' });
    progress(false);
    const summary = `${count.entries} entradas, ${count.checkins} check-ins, ${count.audios} audios, ${count.photos} fotos · ${fmtSize(out.size)}${password ? ' · cifrado' : ''}`;
    // En iPhone, la hoja del sistema permite «Guardar en Archivos» (iCloud Drive). La app no envía nada a nadie.
    const canFiles = isIOS && navigator.canShare && navigator.canShare({ files: [file] });
    const how = await dialogAsk(`Tu respaldo está listo: <strong>${esc(summary)}</strong>.<br><br>${canFiles ? 'Toca <strong>«Guardar en Archivos»</strong> en el menú que aparece y elige <strong>iCloud Drive</strong> (o Google Drive). Ahí NO se borra aunque borres fotos de tu galería.' : 'Se descargará el archivo. Luego muévelo a iCloud Drive o Google Drive.'}`, { html: true, yes: canFiles ? 'Guardar en Archivos' : 'Descargar', no: canFiles ? 'Solo descargar' : 'Cancelar' });
    if (!how && !canFiles) throw 'cancel';
    if (how && canFiles) {
      try { await navigator.share({ files: [file] }); }
      catch (e) { if (e.name === 'AbortError') { toast('No se guardó el respaldo.'); throw 'cancel'; } downloadBlob(file, name); }
    } else downloadBlob(file, name);
    await DB.meta('lastBackup', new Date().toISOString()); await DB.meta('lastBackupSize', out.size); await DB.meta('lastBackupSummary', summary);
    toast(`Respaldo listo (${fmtSize(out.size)}). Usa «Verificar un respaldo» antes de borrar fotos.`, 6000);
  } catch (e) { progress(false); if (e !== 'cancel') toast('No se pudo crear el respaldo: ' + (e.message || e), 6000); }
  exporting = false; btn.disabled = false; refreshBackupStatus();
}
let backupMode = 'import';
function pickBackup(mode) { backupMode = mode; $('#fileBackup').value = ''; $('#fileBackup').click(); }
async function openBackup(file) {
  let blob = file;
  if (await isEncrypted(file)) {
    const pw = await dialogAsk('Este respaldo está protegido. Escribe su contraseña:', { yes: 'Abrir', input: { type: 'password', placeholder: 'Contraseña del respaldo' } });
    if (pw === null) throw 'cancel';
    progress(true, 0, 1, 'Descifrando…');
    blob = await decryptBlob(file, pw, (d, t) => progress(true, d, t, `Descifrando… ${d}/${t}`));
  }
  progress(true, 0, 1, 'Leyendo respaldo…');
  const files = await MiniZip.readZip(blob);
  const j = files.get('diario.json'); if (!j) throw new Error('Este archivo no es un respaldo de Mi diario.');
  const data = JSON.parse(await j.text()); if (data.app !== 'mi-diario') throw new Error('Este archivo no es un respaldo de Mi diario.');
  data.checkins = data.checkins || []; // respaldos de la v1 no traen check-ins
  return { files, data };
}
async function verifyBackup(file) {
  try {
    const { files, data } = await openBackup(file);
    let ok = 0, bad = 0, i = 0;
    for (const m of data.archivos) {
      i++; progress(true, i, data.archivos.length, `Revisando ${i}/${data.archivos.length}…`);
      const b = files.get(m.file), info = files.info.get(m.file);
      if (!b) { bad++; continue; }
      const u8 = new Uint8Array(await b.arrayBuffer());
      if ((m.size == null || u8.length === m.size) && MiniZip.crc32(u8) === info.crc) ok++; else bad++;
    }
    progress(false);
    const msg = `Respaldo del ${esc(fmtFull(data.exportadoEn))}:<br>• ${data.entradas.length} entradas<br>• ${data.checkins.length} check-ins<br>• ${ok} de ${data.archivos.length} fotos/audios completos<br>• Tamaño del archivo: ${fmtSize(file.size)}<br><br>` + (bad ? `<b class="bad">⚠️ ${bad} archivo(s) dañados o faltantes. No borres tus fotos; haz un respaldo nuevo.</b>` : '<b class="good">✅ Todo está completo. Este respaldo se puede restaurar.</b>');
    await dialogAsk(msg, { html: true, yes: 'Entendido', no: 'Cerrar' });
  } catch (e) { progress(false); if (e !== 'cancel') toast('No se pudo verificar: ' + (e.message || e), 6000); }
}
async function importBackup(file) {
  try {
    const { files, data } = await openBackup(file);
    const existing = new Set((await DB.all('entries')).map(e => e.id));
    const nuevas = data.entradas.filter(e => !existing.has(e.id)).length;
    progress(false);
    const ok = await confirmBox(`Respaldo del ${fmtFull(data.exportadoEn)}: ${data.entradas.length} entradas, ${data.checkins.length} check-ins y ${data.archivos.length} fotos/audios. Se agregarán ${nuevas} entradas nuevas; lo que ya tienes no se borra. ¿Importar?`, { yes: 'Importar' });
    if (!ok) return;
    let i = 0, missing = 0;
    for (const m of data.archivos) {
      const blob = files.get(m.file); i++;
      if (!blob) { missing++; continue; }
      const { file: _f, ...rest } = m;
      await DB.put('media', { album: null, caption: '', ...rest, blob: new Blob([blob], { type: m.mime || '' }) });
      progress(true, i, data.archivos.length, `Restaurando archivos… ${i}/${data.archivos.length}`);
    }
    for (const e of data.entradas) await DB.put('entries', normEntry(e));
    for (const c of data.checkins) await DB.put('checkins', c);
    if (data.ajustes) { // solo completa lo que no tienes configurado
      const a = data.ajustes;
      if (!S.ncDate && a.ncDate) S.ncDate = a.ncDate;
      if (!S.reminderTime && a.reminderTime) S.reminderTime = a.reminderTime;
      S.albums = [...new Set([...(S.albums || []), ...(a.albums || [])])];
      S.urges = Math.max(S.urges || 0, a.urges || 0);
      if (a.urgeLog && a.urgeLog.length > (S.urgeLog || []).length) S.urgeLog = a.urgeLog;
      if (a.customAffirm) S.customAffirm = [...new Set([...(S.customAffirm || []), ...a.customAffirm])];
      await saveSettings();
    }
    progress(false);
    toast(`Respaldo importado 🤍 ${data.entradas.length} entradas${missing ? ` (faltaron ${missing} archivos)` : ''}.`, 5000);
    refreshCurrent(); refreshBackupStatus();
  } catch (e) { progress(false); if (e !== 'cancel') toast('No se pudo importar: ' + (e.message || e), 6000); }
}

/* ---------- Más / ajustes ---------- */
function renderMas() {
  $('#ncDate').value = S.ncDate || ''; $('#ncDate').max = todayISO();
  $('#reminderTime').value = S.reminderTime || '';
  $('#autoLock').checked = S.autoLock; $('#showMemories').checked = S.showMemories;
  $$('#themeChips .chip').forEach(c => c.classList.toggle('active', c.dataset.theme === S.theme));
  $$('#sizeChips .chip').forEach(c => c.classList.toggle('active', c.dataset.size === S.textSize));
  $('#versionLabel').textContent = `Mi diario v${APP_VERSION} · todo se guarda solo en tu teléfono, sin cuentas ni servidores.`;
  refreshBackupStatus();
}
async function wroteToday() { const t = todayISO(); return (await DB.all('entries')).some(e => isoDay(e.createdAt) === t) || (await DB.all('checkins')).some(c => isoDay(c.createdAt) === t); }
async function checkReminder() {
  const ban = $('#reminderBanner'); ban.hidden = true;
  if (!S.reminderTime || S.reminderDismissed === todayISO()) return;
  if (fmt(Date.now(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) < S.reminderTime) return;
  if (await wroteToday()) return;
  ban.hidden = false;
  ban.innerHTML = `⏰ Mi Cap., hoy todavía no te has dado un momento para ti. ¿Unos minutos? <div class="row"><button class="btn small" id="remWrite">Escribir</button><button class="btn ghost small" id="remCheck">Check-in</button><button class="link small" id="remLater">Hoy no</button></div>`;
  $('#remWrite').onclick = () => { ban.hidden = true; Editor.open(); };
  $('#remCheck').onclick = () => { ban.hidden = true; W.openCheckin(); };
  $('#remLater').onclick = () => { ban.hidden = true; setSetting('reminderDismissed', todayISO()); };
}
setInterval(() => { if (!$('#app').hidden) checkReminder(); }, 5 * 60000);
function downloadICS() {
  const time = (S.reminderTime || '21:00').replace(':', '');
  const start = todayISO().replace(/-/g, '') + 'T' + time + '00';
  const url = location.href.split('#')[0].split('?')[0];
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mi diario//ES', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:America/Mexico_City', 'BEGIN:STANDARD', 'DTSTART:20221030T020000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0600', 'TZNAME:CST', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:${uid()}@mi-diario`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`, `DTSTART;TZID=America/Mexico_City:${start}`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
    'SUMMARY:Un momento para mí', `DESCRIPTION:Escribir en mi diario: ${url}`, `URL:${url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Un momento para mí', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  downloadBlob(new Blob([ics], { type: 'text/calendar' }), 'recordatorio-mi-diario.ics');
  toast(`Abre el archivo y toca «Agregar» para tener el recordatorio diario a las ${S.reminderTime || '21:00'} en tu calendario.`, 5000);
}

/* ---------- PDF / imprimir ---------- */
const Printer = {
  wire() {
    $('#prCancel').onclick = () => $('#printDlg').close();
    $('#prGo').onclick = () => this.go();
    addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; document.body.classList.remove('printing'); });
  },
  async open() {
    const all = await Entries.all(); const first = all.length ? all.map(e => isoDay(e.createdAt)).sort()[0] : todayISO();
    $('#prFrom').value = first; $('#prTo').value = todayISO(); $('#printDlg').showModal();
  },
  async build() {
    const from = $('#prFrom').value || '0000', to = $('#prTo').value || '9999', withPh = $('#prPhotos').checked, withCartas = $('#prCartas').checked, withCi = $('#prCheckins').checked;
    const entries = (await Entries.all()).filter(e => { const d = isoDay(e.createdAt); return d >= from && d <= to && (withCartas || e.kind !== 'carta'); });
    const cis = withCi ? (await DB.all('checkins')).filter(c => { const d = isoDay(c.createdAt); return d >= from && d <= to; }) : [];
    if (!entries.length && !cis.length) return null;
    const last = to > todayISO() ? todayISO() : to;
    let h = `<h1>Mi diario</h1><p class="muted">Del ${esc(fmtDay(isoToDate(from === '0000' ? todayISO() : from)))} al ${esc(fmtDay(isoToDate(last)))}</p>`;
    const items = [...entries.map(e => ({ t: e.createdAt, e })), ...cis.map(c => ({ t: c.createdAt, c }))].sort((a, b) => a.t.localeCompare(b.t));
    for (const it of items) {
      if (it.c) { const c = it.c; const sc = C.SCORES.find(s => s[0] === c.score) || C.SCORES[2]; h += `<div class="pr-entry pr-ci"><p class="muted">${esc(fmtFull(c.createdAt))} · Check-in</p><p>${sc[1]} ${esc(sc[2])} · intensidad ${c.intensity}/10${c.emotions.length ? ' · ' + esc(c.emotions.map(x => x.name).join(', ')) : ''}${c.triggers.length ? ' · detonantes: ' + esc(c.triggers.join(', ')) : ''}</p>${c.note ? `<p>${esc(c.note)}</p>` : ''}</div>`; continue; }
      const e = it.e;
      h += `<div class="pr-entry"><p class="muted">${esc(fmtFull(e.createdAt))}${e.mood ? ' · ' + esc(e.mood.emoji + ' ' + e.mood.label) : ''}${e.kind === 'carta' ? ' · ✉️ Carta que no se envía' : ''}</p>${e.prompt ? `<p><i>💡 ${esc(e.prompt)}</i></p>` : ''}${e.title ? `<h2>${esc(e.title)}</h2>` : ''}<div class="pr-text">${esc(e.text)}</div>${e.tags.length ? `<p class="muted">${e.tags.map(t => '#' + esc(t)).join(' ')}</p>` : ''}`;
      for (const mid of e.audios) { const m = await DB.get('media', mid); if (m) h += `<p class="muted">🎙️ Audio${m.transcript ? ': ' + esc(m.transcript) : ' (se escucha en la app)'}</p>`; }
      if (withPh) for (const mid of e.photos) { const m = await DB.get('media', mid); if (m) h += `<figure><img src="${blobURL(m.blob)}">${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ''}</figure>`; }
      h += '</div>';
    }
    return h;
  },
  async go() {
    const h = await this.build();
    if (!h) { toast('No hay nada en esas fechas.'); return; }
    $('#printDlg').close();
    const area = $('#printArea'); area.innerHTML = h; document.body.classList.add('printing');
    await Promise.all([...area.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    setTimeout(() => window.print(), 100);
  }
};

/* ---------- guía interactiva ---------- */
const Guide = {
  tab: 'usar', i: 0,
  wire() {
    $('#guideTabs').innerHTML = Object.entries(C.GUIDE).map(([k, v]) => `<button class="chip small" data-g="${k}">${esc(v.label)}</button>`).join('');
    $('#guideClose').onclick = () => $('#guide').close();
    $('#guideTabs').onclick = e => { const b = e.target.closest('.chip'); if (b) { this.tab = b.dataset.g; this.i = 0; this.render(); } };
    $('#guidePrev').onclick = () => { if (this.i > 0) { this.i--; this.render(); } };
    $('#guideNext').onclick = () => { const n = C.GUIDE[this.tab].steps.length; if (this.i < n - 1) { this.i++; this.render(); } else { const tabs = Object.keys(C.GUIDE); const k = tabs.indexOf(this.tab); if (k < tabs.length - 1) { this.tab = tabs[k + 1]; this.i = 0; this.render(); } else $('#guide').close(); } };
  },
  open(tab = 'usar') { this.tab = tab; this.i = 0; this.render(); if (!$('#guide').open) $('#guide').showModal(); },
  render() {
    const steps = C.GUIDE[this.tab].steps, [icon, title, html] = steps[this.i];
    $$('#guideTabs .chip').forEach(c => c.classList.toggle('active', c.dataset.g === this.tab));
    $('#guideSteps').innerHTML = `<div class="step-icon">${icon}</div><h3>${esc(title)}</h3>${html}`;
    $('#guidePos').textContent = `${this.i + 1} / ${steps.length}`;
    $('#guidePrev').disabled = this.i === 0;
    const tabs = Object.keys(C.GUIDE);
    $('#guideNext').textContent = this.i === steps.length - 1 && this.tab === tabs[tabs.length - 1] ? 'Terminar' : 'Siguiente →';
  }
};

document.addEventListener('DOMContentLoaded', () => boot().catch(e => { document.body.innerHTML = '<p style="padding:2rem;font-family:Noto Sans,sans-serif">No se pudo abrir el diario en este navegador: ' + esc(e.message || e) + '</p>'; }));
