/* Mi diario — app privada. Todo vive en IndexedDB de este dispositivo. Nada se envía a ningún lado. */
'use strict';
const TZ = 'America/Mexico_City';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const MOODS = [['😊', 'Bien'], ['😌', 'Tranquila'], ['😐', 'Normal'], ['😔', 'Triste'], ['😢', 'Con ganas de llorar'], ['😠', 'Enojada'], ['😰', 'Ansiosa'], ['😴', 'Cansada'], ['💪', 'Fuerte'], ['🙏', 'Agradecida']];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmt = (d, opts) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, ...opts }).format(new Date(d));
const fmtFull = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = d => fmt(d, { hour: '2-digit', minute: '2-digit' });
const dayKey = d => fmt(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('mi-diario', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        const m = db.createObjectStore('media', { keyPath: 'id' }); m.createIndex('entryId', 'entryId'); m.createIndex('kind', 'kind');
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
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
  async meta(key, val) { if (val === undefined) { const r = await this.get('meta', key); return r ? r.value : undefined; } return this.put('meta', { key, value: val }); },
  clear() { return this.tx(['entries', 'media', 'meta'], 'readwrite', ss => ss.forEach(s => s.clear())); }
};

/* ---------- utilidades UI ---------- */
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms); }
function confirmBox(msg, { yes = 'Sí', danger = false, typeWord = null } = {}) {
  return new Promise(res => {
    const d = $('#confirmDlg'), inp = $('#confirmInput'), y = $('#confirmYes');
    $('#confirmMsg').textContent = msg; y.textContent = yes; y.className = 'btn' + (danger ? ' danger' : '');
    inp.hidden = !typeWord; inp.value = ''; inp.placeholder = typeWord ? `Escribe ${typeWord}` : '';
    const done = v => { d.close(); y.onclick = $('#confirmNo').onclick = null; res(v); };
    y.onclick = () => { if (typeWord && inp.value.trim().toUpperCase() !== typeWord) { toast(`Escribe ${typeWord} para confirmar`); return; } done(true); };
    $('#confirmNo').onclick = () => done(false);
    d.oncancel = e => { e.preventDefault(); done(false); };
    d.showModal();
  });
}
const urls = new Set();
function blobURL(b) { const u = URL.createObjectURL(b); urls.add(u); return u; }
function freeURLs() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
}

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
    const t = { unlock: ['Hola, mi Cap.', 'Escribe tu PIN para abrir tu diario.'], setup: ['Bienvenida, mi Cap. 🤍', 'Crea un PIN de 4 a 8 números. Protege tu diario en este teléfono. Si lo olvidas no se puede recuperar, así que elige uno que recuerdes.'], change: ['Cambiar PIN', 'Escribe tu PIN nuevo (4 a 8 números).'] }[mode];
    $('#lockTitle').textContent = t[0]; $('#lockMsg').textContent = t[1];
    $('#forgotPin').hidden = mode === 'setup'; $('#forgotPin').textContent = mode === 'change' ? 'Cancelar' : 'Olvidé mi PIN';
    this.render();
  },
  render() { $$('#pinDots span').forEach((s, i) => { s.classList.toggle('on', i < this.buf.length); s.hidden = i >= Math.max(6, this.buf.length); }); },
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
      else { this.fails++; this.buf = ''; this.render(); $('#pinError').textContent = 'PIN incorrecto. Inténtalo con calma.'; if (this.fails >= 5) { $('#pinError').textContent = 'Espera 30 segundos e inténtalo de nuevo.'; $('#keypad').style.pointerEvents = 'none'; setTimeout(() => { $('#keypad').style.pointerEvents = ''; $('#pinError').textContent = ''; this.fails = 3; }, 30000); } }
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
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (!$('#app').hidden && (await DB.meta('autoLock')) !== false && hiddenAt && Date.now() - hiddenAt > 60000 && !Rec.active) Lock.show('unlock');
});

/* ---------- arranque ---------- */
async function boot() {
  await DB.open();
  document.addEventListener('keydown', e => { if ($('#lock').hidden) return; if (/^[0-9]$/.test(e.key)) Lock.press(e.key); else if (e.key === 'Backspace') Lock.press('del'); else if (e.key === 'Enter') Lock.press('ok'); });
  $('#keypad').addEventListener('click', e => { const b = e.target.closest('button'); if (b) Lock.press(b.dataset.k || b.textContent); });
  $('#forgotPin').onclick = () => Lock.mode === 'change' ? unlocked() : forgotPin();
  Lock.show((await PIN.isSet()) ? 'unlock' : 'setup');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) $('#updateBanner').hidden = false; }); });
    }).catch(() => {});
  }
  wireUI();
}
let wired = false;
async function unlocked() {
  $('#lock').hidden = true; $('#app').hidden = false;
  await askPersist();
  showView(currentView); refreshBackupStatus();
}
async function askPersist() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
}
async function forgotPin() {
  const ok = await confirmBox('Si olvidaste tu PIN, la única opción es borrar el diario de este teléfono y empezar de nuevo. Después podrás importar tu último respaldo (.zip). ¿Quieres borrar todo?', { yes: 'Borrar todo', danger: true, typeWord: 'BORRAR' });
  if (!ok) return; await DB.clear(); toast('Diario borrado. Crea un PIN nuevo.'); Lock.show('setup');
}

/* ---------- navegación ---------- */
let currentView = 'inicio';
function showView(v) {
  currentView = v; freeURLs();
  $$('.view').forEach(s => s.hidden = s.id !== 'view-' + v);
  $$('.tabbar [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'inicio') renderTimeline(); if (v === 'galeria') renderGallery(); if (v === 'mas') refreshBackupStatus(); if (v !== 'respira') Breath.stop();
  window.scrollTo(0, 0);
}
function greet() {
  const h = +fmt(Date.now(), { hour: 'numeric', hour12: false });
  const g = h < 6 ? 'Es de madrugada, mi Cap. Si no puedes dormir, aquí estoy para escucharte.' : h < 12 ? 'Buenos días, mi Cap. ¿Cómo amaneciste?' : h < 19 ? 'Buenas tardes, mi Cap. ¿Cómo va tu día?' : 'Buenas noches, mi Cap. ¿Qué traes en el corazón hoy?';
  $('#greeting').textContent = g;
  $('#todayLabel').textContent = fmtDay(Date.now());
}

function wireUI() {
  if (wired) return; wired = true;
  $$('.tabbar [data-view]').forEach(b => b.onclick = () => showView(b.dataset.view));
  $('#tabNew').onclick = () => Editor.open();
  $$('[data-new]').forEach(b => b.onclick = () => Editor.open(null, b.dataset.new));
  $('#lockNow').onclick = () => Lock.show('unlock');
  $('#search').oninput = () => renderTimeline();
  $('#filters').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; $$('#filters .chip').forEach(c => c.classList.toggle('active', c === b)); renderTimeline(); };
  $('#openGuide').onclick = () => Guide.open('usar'); $('#openGuideFromEmpty').onclick = () => Guide.open('usar');
  $('#addGalleryPhotos').onclick = () => pickPhotos(async files => { await savePhotos(files, null, $('#galleryCompress').checked); renderGallery(); });
  $('#exportBtn').onclick = exportBackup;
  $('#importBtn').onclick = () => { $('#fileBackup').value = ''; $('#fileBackup').click(); };
  $('#fileBackup').onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
  $('#changePin').onclick = async () => { Lock.show('change'); };
  $('#autoLock').onchange = e => DB.meta('autoLock', e.target.checked);
  DB.meta('autoLock').then(v => $('#autoLock').checked = v !== false);
  $('#wipeAll').onclick = async () => {
    if (!(await confirmBox('Esto borra TODAS tus entradas, audios y fotos de este teléfono. No se puede deshacer. ¿Ya tienes un respaldo guardado?', { yes: 'Borrar todo', danger: true, typeWord: 'BORRAR' }))) return;
    await DB.clear(); toast('Diario borrado.'); Lock.show('setup');
  };
  $('#reloadApp').onclick = () => location.reload();
  $('#breathStart').onclick = () => Breath.start(); $('#breathStop').onclick = () => Breath.stop();
  Editor.wire(); Viewer.wire(); PhotoView.wire(); Guide.wire();
  let deferred = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => { if (!deferred) return Guide.open(isIOS ? 'iphone' : 'android'); deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; };
  if (!isStandalone() && isIOS) $('#installBtn').hidden = false;
  greet(); setInterval(greet, 60000);
}

/* ---------- línea de tiempo ---------- */
function entryTypes(e) { const t = []; if ((e.text || '').trim() || (e.title || '').trim()) t.push('texto'); if (e.audios && e.audios.length) t.push('audio'); if (e.photos && e.photos.length) t.push('foto'); return t; }
async function renderTimeline() {
  const tl = $('#timeline'); freeURLs();
  const q = $('#search').value.trim().toLowerCase();
  const f = ($('#filters .active') || {}).dataset?.f || 'todo';
  const all = (await DB.all('entries')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const list = all.filter(e => (f === 'todo' || entryTypes(e).includes(f)) &&
    (!q || [e.title, e.text, e.mood && e.mood.label, ...(e.transcripts || []), fmtDay(e.createdAt)].join(' ').toLowerCase().includes(q)));
  $('#emptyState').hidden = all.length > 0;
  tl.innerHTML = '';
  if (all.length && !list.length) { tl.innerHTML = '<p class="muted center">No encontré nada con ese filtro, mi Cap.</p>'; return; }
  let lastDay = '';
  for (const e of list) {
    const dk = dayKey(e.createdAt);
    if (dk !== lastDay) { lastDay = dk; const h = document.createElement('p'); h.className = 'day-label'; h.textContent = fmtDay(e.createdAt); tl.appendChild(h); }
    const b = document.createElement('button'); b.className = 'entry';
    const types = entryTypes(e);
    b.innerHTML = `<div class="meta"><span>${esc(fmtTime(e.createdAt))}${e.updatedAt && e.updatedAt !== e.createdAt ? ' · editada' : ''}</span><span>${e.mood ? esc(e.mood.emoji + ' ' + e.mood.label) : ''}</span></div>
      ${e.title ? `<h3>${esc(e.title)}</h3>` : ''}${e.text ? `<p>${esc(e.text)}</p>` : ''}
      <div class="thumbs"></div>
      <div class="badges">${types.includes('audio') ? `<span>🎙️ ${e.audios.length} audio${e.audios.length > 1 ? 's' : ''}</span>` : ''}${types.includes('foto') ? `<span>📷 ${e.photos.length} foto${e.photos.length > 1 ? 's' : ''}</span>` : ''}</div>`;
    b.onclick = () => Viewer.open(e.id);
    tl.appendChild(b);
    if (e.photos && e.photos.length) {
      const th = b.querySelector('.thumbs');
      for (const id of e.photos.slice(0, 4)) { const m = await DB.get('media', id); if (m) { const i = document.createElement('img'); i.src = blobURL(m.blob); i.alt = ''; i.loading = 'lazy'; th.appendChild(i); } }
    }
  }
}

/* ---------- fotos ---------- */
let photoCb = null;
function pickPhotos(cb) { photoCb = cb; const i = $('#filePhotos'); i.value = ''; i.click(); }
$('#filePhotos').onchange = e => { const fs = Array.from(e.target.files || []); if (fs.length && photoCb) photoCb(fs); };
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
async function savePhotos(files, entryId, compress) {
  const ids = []; let n = 0;
  for (const f of files) {
    const blob = compress ? await compressImage(f) : f;
    const id = uid();
    await DB.put('media', { id, kind: 'photo', entryId, blob, mime: blob.type || f.type || 'image/jpeg', name: f.name || 'foto.jpg', size: blob.size, createdAt: new Date().toISOString(), originalDate: f.lastModified ? new Date(f.lastModified).toISOString() : null, compressed: blob !== f });
    ids.push(id); n++; toast(`Guardando fotos… ${n}/${files.length}`, 1500);
  }
  toast(`${n} foto${n > 1 ? 's' : ''} guardada${n > 1 ? 's' : ''} 🤍. Haz un respaldo antes de borrarlas del teléfono.`, 4000);
  refreshBackupStatus();
  return ids;
}
async function renderGallery() {
  const g = $('#gallery'); freeURLs(); g.innerHTML = '';
  const photos = (await DB.tx('media', 'readonly', s => DB.req(s.index('kind').getAll('photo')))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = photos.reduce((s, p) => s + p.size, 0);
  $('#galleryCount').textContent = photos.length ? `${photos.length} foto${photos.length > 1 ? 's' : ''} · ${fmtSize(total)} (incluye las fotos de tus entradas)` : 'Todavía no hay fotos.';
  for (const p of photos) {
    const b = document.createElement('button'); b.className = 'ph';
    b.innerHTML = `<img alt="" loading="lazy" src="${blobURL(p.blob)}">${p.entryId ? '<span class="tag">en entrada</span>' : ''}`;
    b.onclick = () => PhotoView.open(p.id, renderGallery);
    g.appendChild(b);
  }
}
const PhotoView = {
  id: null, after: null,
  wire() {
    $('#photoClose').onclick = () => $('#photoViewer').close();
    $('#photoDownload').onclick = async () => { const m = await DB.get('media', this.id); if (m) downloadBlob(m.blob, m.name || 'foto.jpg'); };
    $('#photoDelete').onclick = async () => {
      if (!(await confirmBox('¿Borrar esta foto del diario?', { yes: 'Borrar', danger: true }))) return;
      const m = await DB.get('media', this.id);
      if (m && m.entryId) { const e = await DB.get('entries', m.entryId); if (e) { e.photos = (e.photos || []).filter(x => x !== m.id); await DB.put('entries', e); } }
      await DB.del('media', this.id); $('#photoViewer').close(); toast('Foto borrada.'); this.after && this.after();
    };
  },
  async open(id, after) {
    const m = await DB.get('media', id); if (!m) return; this.id = id; this.after = after;
    $('#photoBig').src = blobURL(m.blob);
    $('#photoInfo').textContent = `${m.name || 'foto'} · ${fmtSize(m.size)}${m.compressed ? ' · comprimida' : ' · calidad original'} · guardada ${fmtFull(m.createdAt)}`;
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
const Editor = {
  entry: null, draftAudios: [], draftPhotos: [], removed: [], mood: null,
  wire() {
    const mr = $('#moods .mood-row');
    MOODS.forEach(([e, l]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mood'; b.textContent = e + ' ' + l; b.onclick = () => { this.mood = this.mood && this.mood.label === l ? null : { emoji: e, label: l }; this.renderMoods(); }; mr.appendChild(b); });
    $('#editorCancel').onclick = () => this.cancel();
    $('#editor').oncancel = e => { e.preventDefault(); this.cancel(); };
    $('#editorSave').onclick = () => this.save();
    $('#recBtn').onclick = () => this.toggleRec();
    $('#uploadAudioBtn').onclick = () => { const i = $('#fileAudio'); i.value = ''; i.click(); };
    $('#fileAudio').onchange = e => { for (const f of e.target.files) this.draftAudios.push({ id: uid(), blob: f, mime: f.type || 'audio/mpeg', name: f.name, isNew: true, source: 'archivo' }); this.renderAudios(); };
    $('#addPhotosBtn').onclick = () => pickPhotos(async files => { for (const f of files) { const blob = $('#entryCompress').checked ? await compressImage(f) : f; this.draftPhotos.push({ id: uid(), blob, name: f.name, isNew: true, compressed: blob !== f, originalDate: f.lastModified ? new Date(f.lastModified).toISOString() : null }); } this.renderPhotos(); });
    if (SR) { $('#dictateBtn').hidden = false; $('#dictateBtn').onclick = () => this.toggleDictado(); }
    $('#recNote').textContent = Rec.supported() ? 'Tus audios siempre se guardan completos, aunque no los transcribas.' : 'Este navegador no permite grabar aquí. Usa «Subir audio» con una nota de voz de tu teléfono.';
    if (!Rec.supported()) $('#recBtn').disabled = true;
  },
  renderMoods() { $$('#moods .mood').forEach(b => b.classList.toggle('on', !!this.mood && b.textContent.endsWith(this.mood.label))); },
  async open(id = null, focus = 'texto') {
    this.entry = id ? await DB.get('entries', id) : null; this.removed = [];
    this.draftAudios = []; this.draftPhotos = [];
    const e = this.entry;
    $('#editorTitle').textContent = e ? 'Editar entrada' : 'Nueva entrada';
    $('#editorDate').textContent = e ? 'Escrita el ' + fmtFull(e.createdAt) : fmtFull(Date.now()) + ' (hora del centro de México)';
    $('#entryTitle').value = e ? e.title || '' : ''; $('#entryText').value = e ? e.text || '' : '';
    this.mood = e ? e.mood || null : null; this.renderMoods();
    if (e) {
      for (const [i, mid] of (e.audios || []).entries()) { const m = await DB.get('media', mid); if (m) this.draftAudios.push({ ...m, transcript: m.transcript || '' }); }
      for (const mid of e.photos || []) { const m = await DB.get('media', mid); if (m) this.draftPhotos.push(m); }
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
        <textarea class="small" rows="2" placeholder="Notas o transcripción (opcional)">${esc(a.transcript || '')}</textarea>`;
      d.querySelector('button').onclick = async () => { if (!(await confirmBox('¿Quitar este audio de la entrada?', { yes: 'Quitar', danger: true }))) return; if (!a.isNew) this.removed.push(a.id); this.draftAudios.splice(i, 1); this.renderAudios(); };
      d.querySelector('textarea').oninput = ev => a.transcript = ev.target.value;
      d.querySelector('textarea').style.minHeight = '60px';
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
    const dirty = this.draftAudios.some(a => a.isNew) || this.draftPhotos.some(p => p.isNew) || $('#entryText').value !== (this.entry ? this.entry.text || '' : '');
    if (dirty && !(await confirmBox('¿Salir sin guardar? Lo que no guardaste se perderá.', { yes: 'Salir', danger: true }))) return;
    if (Rec.active) Rec.stop(); if (Dictado.on) Dictado.stop();
    $('#editor').close();
  },
  async save() {
    if (Rec.active) { toast('Detén la grabación antes de guardar.'); return; }
    if (Dictado.on) Dictado.stop();
    const title = $('#entryTitle').value.trim(), text = $('#entryText').value;
    if (!title && !text.trim() && !this.draftAudios.length && !this.draftPhotos.length) { toast('La entrada está vacía, mi Cap.'); return; }
    const now = new Date().toISOString();
    const e = this.entry || { id: uid(), createdAt: now };
    try {
      for (const a of this.draftAudios) {
        if (a.isNew) await DB.put('media', { id: a.id, kind: 'audio', entryId: e.id, blob: a.blob, mime: a.mime || a.blob.type, name: a.name, size: a.blob.size, duration: a.duration || null, transcript: a.transcript || '', source: a.source, createdAt: now });
        else { const m = await DB.get('media', a.id); if (m && m.transcript !== a.transcript) { m.transcript = a.transcript; await DB.put('media', m); } }
      }
      for (const p of this.draftPhotos) if (p.isNew) await DB.put('media', { id: p.id, kind: 'photo', entryId: e.id, blob: p.blob, mime: p.blob.type || 'image/jpeg', name: p.name || 'foto.jpg', size: p.blob.size, compressed: !!p.compressed, originalDate: p.originalDate || null, createdAt: now });
      for (const id of this.removed) await DB.del('media', id);
      Object.assign(e, { title, text, mood: this.mood, audios: this.draftAudios.map(a => a.id), photos: this.draftPhotos.map(p => p.id), transcripts: this.draftAudios.map(a => a.transcript || '').filter(Boolean) });
      if (this.entry) e.updatedAt = now;
      await DB.put('entries', e);
    } catch (err) { toast('No se pudo guardar: ' + (err && err.message || err) + '. Puede que el teléfono no tenga espacio.', 6000); return; }
    $('#editor').close(); toast('Guardado en tu diario 🤍'); refreshBackupStatus();
    if (currentView === 'inicio') renderTimeline(); else showView('inicio');
  }
};

/* ---------- ver entrada ---------- */
const Viewer = {
  id: null,
  wire() {
    $('#viewerClose').onclick = () => $('#viewer').close();
    $('#viewerEdit').onclick = () => { $('#viewer').close(); Editor.open(this.id); };
    $('#viewerDelete').onclick = async () => {
      if (!(await confirmBox('¿Borrar esta entrada con sus audios y fotos? No se puede deshacer.', { yes: 'Borrar', danger: true }))) return;
      const e = await DB.get('entries', this.id);
      for (const mid of [...(e.audios || []), ...(e.photos || [])]) await DB.del('media', mid);
      await DB.del('entries', this.id); $('#viewer').close(); toast('Entrada borrada.'); renderTimeline();
    };
  },
  async open(id) {
    const e = await DB.get('entries', id); if (!e) return; this.id = id;
    let h = `<p class="muted small">${esc(fmtFull(e.createdAt))}${e.updatedAt ? ' · editada ' + esc(fmtFull(e.updatedAt)) : ''}</p>`;
    if (e.mood) h += `<p>${esc(e.mood.emoji + ' ' + e.mood.label)}</p>`;
    if (e.title) h += `<h3>${esc(e.title)}</h3>`;
    if (e.text) h += `<div class="viewer-text">${esc(e.text)}</div>`;
    $('#viewerBody').innerHTML = h;
    for (const mid of e.audios || []) {
      const m = await DB.get('media', mid); if (!m) continue;
      const d = document.createElement('div'); d.className = 'audio-item'; d.style.margin = '.6rem 0';
      d.innerHTML = `<audio controls preload="metadata" src="${blobURL(m.blob)}"></audio><div class="row"><span class="small muted">${esc(m.source === 'grabado' ? 'Nota de voz' : m.name)} · ${fmtSize(m.size)}</span><button class="link small">⬇️ Descargar</button></div>${m.transcript ? `<div class="transcript">${esc(m.transcript)}</div>` : ''}`;
      d.querySelector('button').onclick = () => downloadBlob(m.blob, m.name || 'audio.' + extFor(m.mime));
      $('#viewerBody').appendChild(d);
    }
    if (e.photos && e.photos.length) {
      const g = document.createElement('div'); g.className = 'grid'; g.style.marginTop = '.6rem';
      for (const mid of e.photos) { const m = await DB.get('media', mid); if (!m) continue; const b = document.createElement('button'); b.className = 'ph'; b.innerHTML = `<img alt="" src="${blobURL(m.blob)}">`; b.onclick = () => PhotoView.open(m.id, () => this.open(id)); g.appendChild(b); }
      $('#viewerBody').appendChild(g);
    }
    if (!$('#viewer').open) $('#viewer').showModal();
  }
};

/* ---------- respaldo ---------- */
async function refreshBackupStatus() {
  const last = await DB.meta('lastBackup');
  const entries = await DB.all('entries');
  const mediaCount = await DB.tx('media', 'readonly', s => DB.req(s.count()));
  const hasData = entries.length + mediaCount > 0;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  $('#backupStatus').innerHTML = last ? `Último respaldo: <strong>${esc(fmtFull(last))}</strong> (hace ${days} día${days === 1 ? '' : 's'}).` : '<strong>Todavía no has hecho ningún respaldo.</strong>';
  const ban = $('#backupBanner');
  const changedSince = (await DB.meta('lastChange')) || null;
  if (hasData && (!last || days >= 7)) {
    ban.hidden = false;
    ban.innerHTML = `${last ? `Tu último respaldo fue hace ${days} días.` : 'Aún no tienes respaldo.'} Si se borran los datos del navegador o pierdes el teléfono, se perdería tu diario. <br><button class="btn small" id="bannerBackup">Hacer respaldo ahora</button>`;
    $('#bannerBackup').onclick = exportBackup;
  } else ban.hidden = true;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate(); const p = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      $('#storageInfo').textContent = `Ocupado: ${fmtSize(est.usage || 0)}${est.quota ? ' de ~' + fmtSize(est.quota) + ' disponibles' : ''} · Almacenamiento ${p ? 'protegido (persistente) ✅' : 'no garantizado: instala la app en tu pantalla de inicio y haz respaldos'}.`;
    }
  } catch (e) {}
}
function progress(on, done = 0, total = 1, label = '') {
  const p = $('#progress'); p.hidden = !on; if (!on) return;
  p.querySelector('div').style.width = Math.round(100 * done / Math.max(1, total)) + '%'; p.querySelector('span').textContent = label;
}
async function buildBackup() {
  const entries = await DB.all('entries'), media = await DB.all('media');
  const files = [];
  const mediaMeta = media.map(m => { const path = `media/${m.kind === 'photo' ? 'fotos' : 'audios'}/${m.id}.${m.kind === 'photo' ? (/png/.test(m.mime) ? 'png' : /heic/.test(m.mime) ? 'heic' : /webp/.test(m.mime) ? 'webp' : /gif/.test(m.mime) ? 'gif' : 'jpg') : extFor(m.mime || '')}`; files.push({ name: path, data: m.blob }); const { blob, ...rest } = m; return { ...rest, file: path }; });
  const data = { app: 'mi-diario', formato: 1, exportadoEn: new Date().toISOString(), zonaHoraria: TZ, entradas: entries, archivos: mediaMeta };
  files.unshift({ name: 'diario.json', data: JSON.stringify(data, null, 1) });
  files.unshift({ name: 'LEEME.txt', data: 'Respaldo de "Mi diario".\nPara restaurarlo: abre la app > Más > Importar respaldo y elige este archivo .zip.\nNo lo descomprimas ni le cambies nada. Guárdalo en un lugar privado (iCloud Drive / Google Drive / Archivos).\n' });
  const zip = await MiniZip.createZip(files, (d, t) => progress(true, d, t, `Preparando respaldo… ${d}/${t}`));
  return { zip, count: { entries: entries.length, photos: media.filter(m => m.kind === 'photo').length, audios: media.filter(m => m.kind === 'audio').length } };
}
async function exportBackup() {
  const btn = $('#exportBtn'); btn.disabled = true;
  if (currentView !== 'mas') showView('mas');
  try {
    progress(true, 0, 1, 'Preparando respaldo…');
    const { zip, count } = await buildBackup();
    const stamp = fmt(Date.now(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/[\/:, ]+/g, '-');
    const name = `respaldo-mi-diario-${stamp}.zip`;
    const file = new File([zip], name, { type: 'application/zip' });
    progress(false);
    const summary = `${count.entries} entradas, ${count.audios} audios, ${count.photos} fotos · ${fmtSize(zip.size)}`;
    // En iPhone, la hoja del sistema permite «Guardar en Archivos» (iCloud Drive). La app no envía nada a nadie.
    const canFiles = isIOS && navigator.canShare && navigator.canShare({ files: [file] });
    const how = await chooseSaveMethod(summary, canFiles);
    if (!how) { btn.disabled = false; return; }
    if (how === 'files') {
      try { await navigator.share({ files: [file] }); }
      catch (e) { if (e.name === 'AbortError') { toast('No se guardó el respaldo.'); btn.disabled = false; return; } downloadBlob(file, name); }
    } else downloadBlob(file, name);
    await DB.meta('lastBackup', new Date().toISOString()); await DB.meta('lastBackupSize', zip.size); await DB.meta('lastBackupSummary', summary);
    toast(`Respaldo listo (${fmtSize(zip.size)}). Verifica que aparezca en Archivos con ese tamaño antes de borrar fotos.`, 6000);
  } catch (e) { progress(false); toast('No se pudo crear el respaldo: ' + (e.message || e), 6000); }
  btn.disabled = false; refreshBackupStatus();
}
function chooseSaveMethod(summary, canFiles) {
  return new Promise(res => {
    const d = $('#confirmDlg'); const y = $('#confirmYes'), n = $('#confirmNo');
    $('#confirmMsg').innerHTML = `Tu respaldo está listo: <strong>${esc(summary)}</strong>.<br><br>${canFiles ? 'Toca <strong>«Guardar en Archivos»</strong> y elige <strong>iCloud Drive</strong> (o Google Drive). Ahí NO se borra aunque borres fotos de tu galería.' : 'Se descargará el archivo .zip. Luego muévelo a iCloud Drive o Google Drive.'}`;
    $('#confirmInput').hidden = true;
    y.className = 'btn'; y.textContent = canFiles ? 'Guardar en Archivos' : 'Descargar';
    n.textContent = canFiles ? 'Solo descargar' : 'Cancelar';
    const done = v => { d.close(); y.onclick = n.onclick = null; n.textContent = 'Cancelar'; res(v); };
    y.onclick = () => done(canFiles ? 'files' : 'download');
    n.onclick = () => done(canFiles ? 'download' : null);
    d.oncancel = e => { e.preventDefault(); done(null); };
    d.showModal();
  });
}
async function importBackup(file) {
  try {
    progress(true, 0, 1, 'Leyendo respaldo…');
    const files = await MiniZip.readZip(file);
    const j = files.get('diario.json'); if (!j) throw new Error('Este .zip no es un respaldo de Mi diario.');
    const data = JSON.parse(await j.text()); if (data.app !== 'mi-diario') throw new Error('Este .zip no es un respaldo de Mi diario.');
    const existing = new Set((await DB.all('entries')).map(e => e.id));
    const nuevas = data.entradas.filter(e => !existing.has(e.id)).length;
    const ok = await confirmBox(`Respaldo del ${fmtFull(data.exportadoEn)}: ${data.entradas.length} entradas y ${data.archivos.length} archivos (audios/fotos). Se agregarán ${nuevas} entradas nuevas; lo que ya tienes no se borra. ¿Importar?`, { yes: 'Importar' });
    if (!ok) { progress(false); return; }
    let i = 0, missing = 0;
    for (const m of data.archivos) {
      const blob = files.get(m.file); i++;
      if (!blob) { missing++; continue; }
      const { file: _f, ...rest } = m;
      await DB.put('media', { ...rest, blob: new Blob([blob], { type: m.mime || '' }) });
      progress(true, i, data.archivos.length, `Restaurando archivos… ${i}/${data.archivos.length}`);
    }
    for (const e of data.entradas) await DB.put('entries', e);
    progress(false);
    toast(`Respaldo importado 🤍 ${data.entradas.length} entradas${missing ? ` (faltaron ${missing} archivos)` : ''}.`, 5000);
    renderTimeline(); refreshBackupStatus();
  } catch (e) { progress(false); toast('No se pudo importar: ' + (e.message || e), 6000); }
}

/* ---------- respira 4-7-8 ---------- */
const Breath = {
  running: false, timers: [],
  start() {
    this.stop(); this.running = true; $('#breathStart').hidden = true; $('#breathStop').hidden = false;
    const c = $('#breathCircle'), txt = $('#breathText'), cnt = $('#breathCount');
    const phases = [['Inhala por la nariz', 4, 240], ['Sostén el aire', 7, 240], ['Exhala por la boca', 8, 120]];
    let cycle = 0;
    const runPhase = (pi) => {
      if (!this.running) return;
      if (pi === 3) { cycle++; if (cycle >= 4) { txt.textContent = 'Muy bien, mi Cap. 🤍'; cnt.textContent = ''; this.stop(true); return; } pi = 0; }
      const [label, secs, size] = phases[pi];
      txt.textContent = label; c.style.transitionDuration = secs + 's'; c.style.width = c.style.height = size + 'px';
      let left = secs; cnt.textContent = left;
      const iv = setInterval(() => { left--; if (left > 0) cnt.textContent = left; }, 1000); this.timers.push(iv);
      this.timers.push(setTimeout(() => { clearInterval(iv); runPhase(pi + 1); }, secs * 1000));
    };
    runPhase(0);
  },
  stop(keepText) {
    this.running = false; this.timers.forEach(t => { clearTimeout(t); clearInterval(t); }); this.timers = [];
    const c = $('#breathCircle'); if (c) { c.style.transitionDuration = '1s'; c.style.width = c.style.height = '120px'; }
    if (!keepText && $('#breathText')) { $('#breathText').textContent = 'Toca «Empezar»'; $('#breathCount').textContent = ''; }
    if ($('#breathStart')) { $('#breathStart').hidden = false; $('#breathStop').hidden = true; }
  }
};

/* ---------- guía interactiva ---------- */
const GUIDE = {
  usar: [
    ['🤍', 'Tu diario privado', '<p>Todo lo que guardes aquí se queda <strong>solo en este teléfono</strong>: no hay cuentas, ni servidores, ni nadie más lo ve. La app no envía nada a nadie.</p><p>Se protege con tu PIN y se bloquea sola al salir.</p>'],
    ['✍️', 'Escribir', '<ol><li>Toca <span class="kbd">＋</span> o «Escribir».</li><li>La fecha y la hora se ponen solas (hora del centro de México).</li><li>Si quieres, elige cómo te sientes.</li><li>Escribe y toca <strong>Guardar</strong>.</li></ol>'],
    ['🎙️', 'Audios cuando no puedas escribir', '<ol><li>En una entrada, toca <strong>⏺ Grabar</strong>, habla, y luego <strong>⏹ Detener</strong>.</li><li>O toca <strong>📁 Subir audio</strong> para elegir una nota de voz que ya tengas.</li><li>Toca <strong>Guardar</strong>.</li></ol><p class="muted">El audio siempre se guarda completo. «Dictar» (convertir voz a texto) es opcional y depende del navegador.</p>'],
    ['📷', 'Fotos', '<p>Agrega fotos a una entrada o guárdalas en <strong>Galería</strong>. Se guardan en <strong>calidad original</strong>; si quieres ahorrar espacio, marca «Comprimir».</p><p>Antes de borrarlas de tu teléfono, mira la sección <strong>Respaldo</strong> de esta guía.</p>'],
    ['🔎', 'Buscar y borrar', '<p>En Inicio puedes buscar palabras y filtrar por <strong>Texto, Audio o Foto</strong>. Toca una entrada para verla, escuchar sus audios, editarla o borrarla.</p>'],
    ['🌬️', 'Respira', '<p>En «Respira» hay un ejercicio 4‑7‑8 para calmarte, y el teléfono de la <strong>Línea de la Vida: 800 911 2000</strong> (gratis, 24 h). No estás sola.</p>']
  ],
  iphone: [
    ['🧭', 'Abre en Safari', '<p>En iPhone la instalación funciona desde <strong>Safari</strong> (en iOS 16.4 o más reciente también desde Chrome con el botón compartir).</p>'],
    ['⬆️', 'Botón Compartir', '<p>Toca el botón <strong>Compartir</strong> (cuadrito con flecha hacia arriba) en la barra de Safari.</p>'],
    ['➕', 'Añadir a pantalla de inicio', '<p>Desliza y toca <strong>«Añadir a pantalla de inicio»</strong>. Deja el nombre «Mi diario» y toca <strong>Añadir</strong>.</p>'],
    ['📲', 'Ábrela desde el ícono', '<p>Desde ahora abre tu diario con el ícono 💜 de tu pantalla de inicio. Así funciona <strong>sin internet</strong> y iOS cuida mejor tus datos.</p><p class="muted">Importante: lo que guardes en Safari y lo que guardes en el ícono son espacios separados en iPhone. Usa siempre el ícono.</p>']
  ],
  android: [
    ['🌐', 'Abre en Chrome', '<p>Abre el enlace del diario en <strong>Chrome</strong>.</p>'],
    ['⋮', 'Menú', '<p>Toca el menú <strong>⋮</strong> (arriba a la derecha) y elige <strong>«Instalar app»</strong> o <strong>«Añadir a pantalla de inicio»</strong>. También puedes usar el botón «Instalar» en «Más».</p>'],
    ['📲', 'Listo', '<p>Abre «Mi diario» desde su ícono. Funciona sin internet.</p>']
  ],
  respaldo: [
    ['⚠️', '¿Por qué respaldar?', '<p>Tu diario vive dentro del navegador de este teléfono. Si borras los datos de Safari/Chrome, desinstalas la app o pierdes el teléfono, <strong>se pierde todo</strong>. El respaldo es tu copia segura.</p>'],
    ['☁️', 'Ojo con Fotos de iCloud', '<p>Si usas <strong>Fotos de iCloud</strong>, al borrar una foto del teléfono también se borra de iCloud (queda 30 días en «Eliminado»).</p><p>Por eso el respaldo del diario debe guardarse en <strong>iCloud Drive (app Archivos)</strong> o <strong>Google Drive</strong>, que son independientes de tu galería: <strong>no se borran</strong> cuando borras fotos.</p>'],
    ['⬇️', 'Exportar respaldo', '<ol><li>Ve a <strong>Más → Exportar respaldo</strong>.</li><li>En iPhone toca <strong>«Guardar en Archivos»</strong>.</li><li>Elige <strong>iCloud Drive</strong> (por ejemplo, una carpeta «Respaldos diario») y toca <strong>Guardar</strong>.</li></ol><p class="muted">Si eliges «Solo descargar», el archivo queda en Archivos → Descargas. Con Google Drive: guárdalo en Archivos y súbelo desde la app de Drive, o elige Drive si aparece como ubicación.</p>'],
    ['✅', 'Verifica antes de borrar fotos', '<ol><li>Abre la app <strong>Archivos</strong> y busca <span class="kbd">respaldo-mi-diario-….zip</span>.</li><li>Mantén presionado → <strong>Información</strong>: el tamaño debe parecerse al que te mostró la app (y espera a que termine de subir a iCloud, sin la nubecita con flecha).</li><li>Para estar 100% segura: en «Más → Importar respaldo» elige ese archivo; si lo lee bien, el respaldo sirve (no duplica nada).</li><li>Solo entonces borra las fotos de tu galería.</li></ol>'],
    ['🔁', 'Cada semana', '<p>Haz un respaldo nuevo al menos <strong>cada 7 días</strong> o después de guardar fotos importantes. La app te avisará con un recordatorio.</p><p>Para restaurar en un teléfono nuevo: instala la app, crea tu PIN y usa <strong>Importar respaldo</strong>.</p>']
  ]
};
const Guide = {
  tab: 'usar', i: 0,
  wire() {
    $('#guideClose').onclick = () => $('#guide').close();
    $('#guideTabs').onclick = e => { const b = e.target.closest('.chip'); if (b) { this.tab = b.dataset.g; this.i = 0; this.render(); } };
    $('#guidePrev').onclick = () => { if (this.i > 0) { this.i--; this.render(); } };
    $('#guideNext').onclick = () => { const n = GUIDE[this.tab].length; if (this.i < n - 1) { this.i++; this.render(); } else { const tabs = Object.keys(GUIDE); const k = tabs.indexOf(this.tab); if (k < tabs.length - 1) { this.tab = tabs[k + 1]; this.i = 0; this.render(); } else $('#guide').close(); } };
  },
  open(tab = 'usar') { this.tab = tab; this.i = 0; this.render(); if (!$('#guide').open) $('#guide').showModal(); },
  render() {
    const steps = GUIDE[this.tab], [icon, title, html] = steps[this.i];
    $$('#guideTabs .chip').forEach(c => c.classList.toggle('active', c.dataset.g === this.tab));
    $('#guideSteps').innerHTML = `<div class="step-icon">${icon}</div><h3>${esc(title)}</h3>${html}`;
    $('#guidePos').textContent = `${this.i + 1} / ${steps.length}`;
    $('#guidePrev').disabled = this.i === 0;
    const last = this.i === steps.length - 1 && this.tab === 'respaldo';
    $('#guideNext').textContent = last ? 'Terminar' : 'Siguiente →';
  }
};

boot().catch(e => { document.body.innerHTML = '<p style="padding:2rem;font-family:Noto Sans,sans-serif">No se pudo abrir el diario en este navegador: ' + esc(e.message || e) + '</p>'; });
