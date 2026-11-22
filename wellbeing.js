/* Mi diario v2 — bienestar: check-in, ánimo, caja de calma, ideas, inicio. Todo local. */
'use strict';
const MOOD_SCORE = { 'Bien': 4, 'Tranquila': 4, 'Normal': 3, 'Triste': 2, 'Con ganas de llorar': 1, 'Enojada': 2, 'Ansiosa': 2, 'Cansada': 3, 'Fuerte': 5, 'Agradecida': 5 };
const W = {
  timers: [], ci: null, calMonth: null, range: 30,
  clearTimers() { this.timers.forEach(t => { clearTimeout(t); clearInterval(t); }); this.timers = []; },
  stopAll() { if (!$('#toolDlg').open) this.clearTimers(); },
  later(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; },
  every(fn, ms) { const t = setInterval(fn, ms); this.timers.push(t); return t; },

  wire() {
    $('#checkinCard').onclick = () => this.openCheckin();
    $('#checkinFromAnimo').onclick = () => this.openCheckin();
    $('#usePrompt').onclick = () => Editor.open(null, { prompt: $('#dailyPrompt').textContent });
    $('#morePrompts').onclick = () => this.openPrompts();
    $('#ciCancel').onclick = () => $('#checkin').close();
    $('#ciSave').onclick = () => this.saveCheckin();
    $('#ciIntensity').oninput = e => $('#ciIntVal').textContent = e.target.value;
    $('#calPrev').onclick = () => { this.calMonth = this.shiftMonth(this.calMonth, -1); this.renderCalendar(); };
    $('#calNext').onclick = () => { this.calMonth = this.shiftMonth(this.calMonth, 1); this.renderCalendar(); };
    $$('[data-range]').forEach(b => b.onclick = () => { this.range = +b.dataset.range; $$('[data-range]').forEach(c => c.classList.toggle('active', c === b)); this.renderAnimo(); });
    $('#dayClose').onclick = () => $('#dayDlg').close();
    $('#toolClose').onclick = () => $('#toolDlg').close();
    $('#toolDlg').addEventListener('close', () => this.clearTimers());
    $('#promptsClose').onclick = () => $('#promptsDlg').close();
    $$('[data-tool]').forEach(b => b.onclick = () => this.openTool(b.dataset.tool));
    this.buildCheckinStatic();
  },

  /* ----- datos ----- */
  async dayMap() { // iso -> {scores:[], entries:n}
    const m = new Map(); const get = d => { if (!m.has(d)) m.set(d, { scores: [], entries: 0, cis: 0 }); return m.get(d); };
    for (const c of await DB.all('checkins')) { const x = get(isoDay(c.createdAt)); x.scores.push(c.score); x.cis++; }
    for (const e of await Entries.all()) { const x = get(isoDay(e.createdAt)); x.entries++; if (e.mood && MOOD_SCORE[e.mood.label]) x.moodScores = [...(x.moodScores || []), MOOD_SCORE[e.mood.label]]; }
    for (const x of m.values()) { const s = x.scores.length ? x.scores : (x.moodScores || []); x.avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; }
    return m;
  },
  streak(map) {
    let d = todayISO(); if (!map.has(d)) d = addDays(d, -1);
    let n = 0; while (map.has(d)) { n++; d = addDays(d, -1); } return n;
  },
  scoreColor(avg) { return avg == null ? '' : C.SCORE_COLORS[Math.min(5, Math.max(1, Math.round(avg)))]; },

  /* ----- inicio ----- */
  async renderHome() {
    const map = await this.dayMap(), t = todayISO(), streak = this.streak(map);
    const todays = (await DB.all('checkins')).filter(c => isoDay(c.createdAt) === t).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const cc = $('#checkinCard');
    if (todays.length) { const c = todays[0], sc = C.SCORES[c.score - 1]; cc.innerHTML = `<p class="eyebrow">Hoy te sientes</p><p class="big-emo">${sc[1]}</p><p><b>${esc(sc[2])}</b>${c.emotions.length ? '<br><span class="small muted">' + esc(c.emotions.slice(0, 3).map(x => x.name).join(', ')) + '</span>' : ''}</p><p class="small muted">${streak ? `🔥 ${streak} día${streak > 1 ? 's' : ''} seguidos` : ''} · toca para otro check-in</p>`; }
    else cc.innerHTML = `<p class="eyebrow">Check-in</p><p class="big-emo">💜</p><p><b>¿Cómo te sientes hoy?</b></p><p class="small muted">${streak ? `🔥 Racha: ${streak} día${streak > 1 ? 's' : ''}` : 'Toma 30 segundos'}</p>`;
    // contador de cierre
    const nc = $('#ncCard');
    if (S.ncDate) {
      const days = Math.max(0, daysBetween(S.ncDate, t));
      const next = C.MILESTONES.find(m => m > days), prev = [...C.MILESTONES].reverse().find(m => m <= days) || 0;
      const pct = next ? Math.round(100 * (days - prev) / (next - prev)) : 100;
      nc.hidden = false;
      nc.innerHTML = `<p class="eyebrow">Días cuidándome</p><p class="big-num">${days}</p><p class="small">${days === 1 ? 'día' : 'días'} desde el cierre 🌱</p>${next ? `<div class="bar"><div style="width:${pct}%"></div></div><p class="small muted">Próximo logro: ${next} días</p>` : '<p class="small">¡Más de dos años! 🎉</p>'}`;
      if (C.MILESTONES.includes(days) && !S.celebrated.includes(days)) { S.celebrated.push(days); saveSettings(); this.celebrate(days); }
    } else nc.hidden = true;
    $('.home-grid').classList.toggle('single', !S.ncDate);
    // idea y afirmación del día
    $('#dailyPrompt').textContent = C.ALL_PROMPTS[hashStr(t) % C.ALL_PROMPTS.length];
    const aff = [...C.AFFIRMATIONS, ...(S.customAffirm || [])];
    $('#dailyAffirm').textContent = aff[hashStr(t + 'a') % aff.length];
    await this.renderMemories();
    await this.renderLowMood();
  },
  celebrate(days) {
    const msg = days === 1 ? '¡Tu primer día! Cada gran camino empieza así.' : days < 30 ? `¡${days} días cuidándote! Estás demostrando tu fuerza.` : days < 365 ? `¡${days} días! Mira todo lo que has avanzado, mi Cap.` : `¡${days} días! Eres inspiración pura.`;
    dialogAsk(`<div class="center"><p class="big-emo">🎉🌱</p><h3>${msg}</h3><p class="muted">Date un abrazo o un pequeño premio hoy. Te lo mereces.</p></div>`, { html: true, yes: 'Gracias 🤍', no: 'Cerrar' });
  },
  async renderMemories() {
    const box = $('#memories'); box.hidden = true;
    if (!S.showMemories) return;
    const t = todayISO(), d = isoToDate(t);
    const monthsAgo = n => { const x = new Date(d); x.setMonth(x.getMonth() - n); return isoDay(x); };
    const targets = [[addDays(t, -7), 'Hace una semana'], [monthsAgo(1), 'Hace un mes'], [monthsAgo(3), 'Hace 3 meses'], [monthsAgo(6), 'Hace 6 meses'], [monthsAgo(12), 'Hace un año']];
    const all = await Entries.all(); const found = [];
    for (const [iso, label] of targets) for (const e of all) if (isoDay(e.createdAt) === iso && e.kind !== 'carta') found.push([label, e]);
    if (!found.length) return;
    box.hidden = false;
    box.innerHTML = `<div class="row between"><p class="eyebrow">En este día</p><button class="link small" id="hideMem">Ocultar</button></div>` + found.slice(0, 3).map(([l, e], i) => `<button class="mem" data-i="${i}"><span class="small muted">${esc(l)} · ${esc(fmtShort(e.createdAt))}</span><br><b>${esc(e.title || (e.text || '').slice(0, 80) || 'Entrada con audio/fotos')}</b></button>`).join('') + '<p class="small muted">Mira cuánto has caminado desde entonces.</p>';
    box.querySelectorAll('.mem').forEach(b => b.onclick = () => Viewer.open(found[+b.dataset.i][1].id));
    $('#hideMem').onclick = () => box.hidden = true;
  },
  async renderLowMood() {
    const card = $('#lowMoodCard'); card.hidden = true;
    if (S.lowMoodDismissed === todayISO()) return;
    const since = addDays(todayISO(), -6);
    const cis = (await DB.all('checkins')).filter(c => isoDay(c.createdAt) >= since).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const lowCis = cis.filter(c => c.score <= 2).length;
    const lowEntries = (await Entries.all()).filter(e => isoDay(e.createdAt) >= since && e.mood && C.LOW_MOODS.includes(e.mood.label)).length;
    const lastThreeLow = cis.length >= 3 && cis.slice(0, 3).every(c => c.score <= 2);
    if (!(lastThreeLow || lowCis >= 3 || lowCis + lowEntries >= 4)) return;
    card.hidden = false;
    card.innerHTML = `<p><b>Mi Cap., he notado que estos días han sido pesados. 🤍</b></p><p class="small">No tienes que cargarlo sola. Hablar con alguien de confianza o con un profesional de psicología puede ayudarte mucho. Si en algún momento sientes que no puedes más, llama a la <b>Línea de la Vida: <a href="tel:8009112000">800 911 2000</a></b> (gratis, 24 h).</p><div class="row"><button class="btn small" id="lowCalma">Abrir Calma</button><button class="link small" id="lowHide">Ahora no</button></div>`;
    $('#lowCalma').onclick = () => showView('calma');
    $('#lowHide').onclick = () => { card.hidden = true; setSetting('lowMoodDismissed', todayISO()); };
  },

  /* ----- check-in ----- */
  buildCheckinStatic() {
    $('#ciScore').innerHTML = C.SCORES.map(([v, e, l]) => `<button type="button" class="score" data-v="${v}"><span>${e}</span><small>${l}</small></button>`).join('');
    $('#ciScore').onclick = e => { const b = e.target.closest('.score'); if (!b) return; this.ci.score = +b.dataset.v; $$('#ciScore .score').forEach(x => x.classList.toggle('on', x === b)); };
    // rueda de emociones (SVG)
    const svg = $('#wheel'), n = C.EMOTIONS.length, R = 104, r = 42;
    const pt = (rad, a) => [rad * Math.cos(a), rad * Math.sin(a)];
    svg.innerHTML = C.EMOTIONS.map((em, i) => {
      const a0 = -Math.PI / 2 + i * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n, am = (a0 + a1) / 2;
      const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0), [tx, ty] = pt((R + r) / 2, am);
      return `<g class="seg" data-i="${i}" tabindex="0" role="button" aria-label="${em.core}"><path d="M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 0 0 ${x3},${y3} Z" fill="${em.color}"/><text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle">${em.core}</text></g>`;
    }).join('') + `<circle r="${r - 3}" class="wheel-center"/><text class="wheel-center-t" text-anchor="middle" dominant-baseline="middle" y="0">¿Qué siento?</text>`;
    svg.onclick = e => { const g = e.target.closest('.seg'); if (!g) return; this.ci.core = +g.dataset.i; this.renderSub(); };
    svg.onkeydown = e => { if (e.key === 'Enter') { const g = e.target.closest('.seg'); if (g) { this.ci.core = +g.dataset.i; this.renderSub(); } } };
    $('#ciSub').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; const em = C.EMOTIONS[this.ci.core]; const name = b.dataset.n; const k = this.ci.emotions.findIndex(x => x.name === name); k >= 0 ? this.ci.emotions.splice(k, 1) : this.ci.emotions.push({ core: em.core, name }); this.renderSub(); };
    $('#ciChosen').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; this.ci.emotions = this.ci.emotions.filter(x => x.name !== b.dataset.n); this.renderSub(); };
    $('#ciTriggers').innerHTML = C.TRIGGERS.map(t => `<button type="button" class="chip small" data-t="${esc(t)}">${esc(t)}</button>`).join('');
    $('#ciTriggers').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; const t = b.dataset.t, k = this.ci.triggers.indexOf(t); k >= 0 ? this.ci.triggers.splice(k, 1) : this.ci.triggers.push(t); b.classList.toggle('active', k < 0); };
  },
  renderSub() {
    $$('#wheel .seg').forEach(g => g.classList.toggle('on', +g.dataset.i === this.ci.core));
    const em = this.ci.core != null ? C.EMOTIONS[this.ci.core] : null;
    $('#ciSub').innerHTML = em ? [em.core, ...em.subs].map(s => `<button type="button" class="chip small${this.ci.emotions.some(x => x.name === s) ? ' active' : ''}" data-n="${esc(s)}" style="--c:${em.color}">${esc(s)}</button>`).join('') : '<span class="muted small">Toca una parte de la rueda para ver emociones más específicas.</span>';
    $('#ciChosen').innerHTML = this.ci.emotions.length ? '<span class="muted small">Elegiste:</span>' + this.ci.emotions.map(x => `<button type="button" class="chip small chosen" data-n="${esc(x.name)}" style="--c:${C.EMOTIONS.find(e => e.core === x.core).color}">${esc(x.name)} ✕</button>`).join('') : '';
  },
  openCheckin() {
    this.ci = { score: null, core: null, emotions: [], triggers: [] };
    $('#ciDate').textContent = fmtFull(Date.now()) + ' (hora del centro de México)';
    $$('#ciScore .score').forEach(x => x.classList.remove('on'));
    $$('#ciTriggers .chip').forEach(x => x.classList.remove('active'));
    $('#ciIntensity').value = 5; $('#ciIntVal').textContent = '5'; $('#ciNote').value = ''; $('#ciTriggerOther').value = '';
    this.renderSub(); $('#checkin').showModal(); $('#checkin').scrollTop = 0;
  },
  async saveCheckin() {
    if (!this.ci.score) { toast('Elige primero cómo estás en general (1 a 5).'); return; }
    const other = $('#ciTriggerOther').value.trim();
    const c = { id: uid(), createdAt: new Date().toISOString(), score: this.ci.score, emotions: this.ci.emotions, intensity: +$('#ciIntensity').value, triggers: [...this.ci.triggers, ...(other ? [other] : [])], note: $('#ciNote').value.trim() };
    await DB.put('checkins', c); $('#checkin').close(); refreshBackupStatus(); $('#reminderBanner').hidden = true;
    refreshCurrent();
    if (c.score === 1 || (c.score === 2 && c.intensity >= 8)) {
      const go = await dialogAsk(`<p><b>Gracias por contármelo, mi Cap. 🤍</b></p><p>Lo que sientes es real y no tienes que cargarlo sola. ¿Quieres probar algo para calmarte un poco?</p><p class="small">Si sientes que no puedes más o piensas en hacerte daño: <b>Línea de la Vida <a href="tel:8009112000">800 911 2000</a></b> (gratis, 24 h) o <b><a href="tel:911">911</a></b>.</p>`, { html: true, yes: 'Ir a Calma', no: 'Ahora no' });
      if (go) showView('calma');
    } else toast(c.score >= 4 ? 'Check-in guardado. ¡Qué bueno, mi Cap.! 💜' : 'Check-in guardado. Gracias por escucharte 💜');
  },

  /* ----- ánimo ----- */
  shiftMonth(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; },
  async renderAnimo() {
    if (!this.calMonth) this.calMonth = todayISO().slice(0, 7);
    const map = await this.dayMap(), cis = await DB.all('checkins'), t = todayISO();
    const month = t.slice(0, 7), daysThisMonth = [...map.keys()].filter(k => k.startsWith(month)).length;
    $('#statsRow').innerHTML = [['🔥', this.streak(map), 'días seguidos'], ['📅', daysThisMonth, 'días este mes'], ['💜', cis.length, 'check-ins'], ['🌊', S.urges || 0, 'olas superadas']].map(([i, n, l]) => `<div class="stat"><span>${i}</span><b>${n}</b><small>${l}</small></div>`).join('');
    this.dayMapCache = map; this.renderCalendar();
    const from = addDays(t, -(this.range - 1));
    const inRange = cis.filter(c => isoDay(c.createdAt) >= from);
    this.renderMoodChart(map, from, t);
    // emociones
    const coreCount = new Map(), subCount = new Map();
    inRange.forEach(c => c.emotions.forEach(e => { coreCount.set(e.core, (coreCount.get(e.core) || 0) + 1); subCount.set(e.name, (subCount.get(e.name) || 0) + 1); }));
    const maxC = Math.max(1, ...coreCount.values());
    $('#emoChart').innerHTML = coreCount.size ? C.EMOTIONS.filter(e => coreCount.has(e.core)).sort((a, b) => coreCount.get(b.core) - coreCount.get(a.core)).map(e => `<div class="hbar"><span>${e.core}</span><div><i style="width:${100 * coreCount.get(e.core) / maxC}%;background:${e.color}"></i></div><b>${coreCount.get(e.core)}</b></div>`).join('') + `<p class="small muted">Más nombradas: ${[...subCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, k]) => `${esc(n)} (${k})`).join(', ')}</p>` : '<p class="muted small">Haz check-ins para ver tus emociones aquí.</p>';
    const tc = new Map(); inRange.forEach(c => c.triggers.forEach(x => tc.set(x, (tc.get(x) || 0) + 1)));
    const maxT = Math.max(1, ...tc.values());
    $('#trigChart').innerHTML = tc.size ? [...tc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, k]) => `<div class="hbar"><span>${esc(n)}</span><div><i style="width:${100 * k / maxT}%"></i></div><b>${k}</b></div>`).join('') + '<p class="small muted">Conocer lo que te mueve te ayuda a prepararte y cuidarte.</p>' : '<p class="muted small">Aún no hay detonantes registrados.</p>';
    const recent = [...cis].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
    $('#checkinList').innerHTML = recent.length ? recent.map(c => this.ciRow(c)).join('') : '<p class="muted small">Todavía no hay check-ins.</p>';
    this.wireCiRows($('#checkinList'), () => this.renderAnimo());
  },
  ciRow(c) { const sc = C.SCORES[c.score - 1]; return `<div class="ci-row"><span class="ci-emo" style="background:${C.SCORE_COLORS[c.score]}">${sc[1]}</span><div><b>${esc(sc[2])}</b> <span class="small muted">· ${esc(fmtShort(c.createdAt))} ${esc(fmtTime(c.createdAt))} · ${c.intensity}/10</span><br><span class="small">${esc(c.emotions.map(e => e.name).join(', '))}${c.triggers.length ? ' · ⚡ ' + esc(c.triggers.join(', ')) : ''}</span>${c.note ? `<br><span class="small muted">${esc(c.note)}</span>` : ''}</div><button class="link small" data-del="${c.id}" aria-label="Borrar check-in">🗑️</button></div>`; },
  wireCiRows(el, after) { el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!(await confirmBox('¿Borrar este check-in?', { yes: 'Borrar', danger: true }))) return; await DB.del('checkins', b.dataset.del); toast('Check-in borrado'); after(); }); },
  renderCalendar() {
    const map = this.dayMapCache || new Map(), [y, m] = this.calMonth.split('-').map(Number);
    $('#calTitle').textContent = fmt(new Date(y, m - 1, 15), { month: 'long', year: 'numeric' });
    const first = new Date(y, m - 1, 1), offset = (first.getDay() + 6) % 7, nDays = new Date(y, m, 0).getDate(), t = todayISO();
    let h = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="dow">${d}</span>`).join('') + '<span></span>'.repeat(offset);
    for (let d = 1; d <= nDays; d++) {
      const iso = `${this.calMonth}-${String(d).padStart(2, '0')}`, x = map.get(iso);
      h += `<button class="day${iso === t ? ' today' : ''}${x ? ' has' : ''}" data-d="${iso}" style="${x && x.avg != null ? `background:${this.scoreColor(x.avg)}` : ''}" ${iso > t ? 'disabled' : ''}>${d}${x && x.entries ? '<i></i>' : ''}</button>`;
    }
    $('#calendar').innerHTML = h;
    $('#calendar').onclick = e => { const b = e.target.closest('.day'); if (b && !b.disabled) this.openDay(b.dataset.d); };
    $('#calLegend').innerHTML = C.SCORES.map(([v, e, l]) => `<span><i style="background:${C.SCORE_COLORS[v]}"></i>${e}</span>`).join('') + '<span><i class="dot"></i>con entrada</span>';
    $('#calNext').disabled = this.calMonth >= t.slice(0, 7);
  },
  async openDay(iso) {
    $('#dayTitle').textContent = fmtDay(isoToDate(iso));
    const body = $('#dayBody'); body.innerHTML = '';
    const cis = (await DB.all('checkins')).filter(c => isoDay(c.createdAt) === iso).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const ents = (await Entries.all()).filter(e => isoDay(e.createdAt) === iso).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (cis.length) { const d = document.createElement('div'); d.className = 'card'; d.innerHTML = '<h4>Check-ins</h4>' + cis.map(c => this.ciRow(c)).join(''); body.appendChild(d); this.wireCiRows(d, () => { this.openDay(iso); this.renderAnimo(); }); }
    for (const e of ents) body.appendChild(await entryCard(e));
    if (!cis.length && !ents.length) body.innerHTML = '<p class="muted center">Este día no escribiste nada. Está bien. 🤍</p>';
    const add = document.createElement('p'); add.className = 'muted small center'; add.textContent = iso === todayISO() ? '' : 'Las entradas nuevas siempre se guardan con la fecha y hora reales.'; body.appendChild(add);
    if (!$('#dayDlg').open) $('#dayDlg').showModal();
  },
  renderMoodChart(map, from, to) {
    const W_ = 320, H = 150, pl = 26, pr = 8, pt = 10, pb = 22, n = daysBetween(from, to) + 1;
    const X = i => pl + (n === 1 ? 0 : i * (W_ - pl - pr) / (n - 1)), Y = v => pt + (5 - v) * (H - pt - pb) / 4;
    const pts = []; for (let i = 0; i < n; i++) { const d = addDays(from, i), x = map.get(d); if (x && x.avg != null) pts.push([X(i), Y(x.avg), x.avg, d]); }
    if (!pts.length) { $('#moodChart').innerHTML = '<p class="muted small">Cuando hagas check-ins (o elijas cómo te sientes en tus entradas), aquí verás tu ánimo a lo largo del tiempo.</p>'; return; }
    const grid = [1, 2, 3, 4, 5].map(v => `<line x1="${pl}" x2="${W_ - pr}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="2" y="${Y(v) + 4}" class="gt">${C.SCORES[v - 1][1]}</text>`).join('');
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const avg = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    $('#moodChart').innerHTML = `<svg viewBox="0 0 ${W_} ${H}" class="svgchart">${grid}<path d="${path}" class="ln"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${this.scoreColor(p[2])}" class="pt"><title>${p[3]}: ${p[2].toFixed(1)}</title></circle>`).join('')}<text x="${pl}" y="${H - 4}" class="gt">${esc(fmtShort(isoToDate(from)))}</text><text x="${W_ - pr}" y="${H - 4}" class="gt" text-anchor="end">hoy</text></svg><p class="small muted">Promedio: ${avg.toFixed(1)} de 5 ${C.SCORES[Math.round(avg) - 1][1]} · ${pts.length} día${pts.length > 1 ? 's' : ''} con registro. Los días difíciles también son parte del proceso.</p>`;
  },

  /* ----- caja de calma ----- */
  renderCalma() { $('#urgeCount').textContent = S.urges ? `🌊 Has dejado pasar ${S.urges} ola${S.urges > 1 ? 's' : ''} de ganas. Cada una cuenta, mi Cap.` : ''; },
  openTool(kind) {
    this.clearTimers();
    const titles = { urge: '🌊 Ganas de escribirle', breath: '🌬️ Respirar', ground: '🖐️ 5‑4‑3‑2‑1', affirm: '💜 Afirmaciones' };
    $('#toolTitle').textContent = titles[kind];
    this['tool_' + kind]();
    if (!$('#toolDlg').open) $('#toolDlg').showModal();
    $('#toolDlg').scrollTop = 0;
  },
  tool_breath(pattern = '478') {
    const b = $('#toolBody');
    b.innerHTML = `<div class="chips" id="brPat">${Object.entries(C.BREATHS).map(([k, v]) => `<button class="chip small${k === pattern ? ' active' : ''}" data-p="${k}">${esc(v.name)}</button>`).join('')}</div>
      <div class="breath-wrap"><div class="breath-circle" id="breathCircle"><span id="breathText">Toca «Empezar»</span><small id="breathCount"></small></div></div>
      <p class="center small muted" id="brCycle"></p>
      <div class="row center"><button class="btn" id="breathStart">Empezar</button><button class="btn ghost" id="breathStop" hidden>Detener</button></div>
      <p class="muted small">Respira sin forzar. Si te mareas, vuelve a respirar normal.</p>`;
    $('#brPat').onclick = e => { const c = e.target.closest('[data-p]'); if (c) { this.clearTimers(); this.tool_breath(c.dataset.p); } };
    $('#breathStart').onclick = () => this.runBreath(pattern);
    $('#breathStop').onclick = () => { this.clearTimers(); this.tool_breath(pattern); };
  },
  runBreath(pattern) {
    const P = C.BREATHS[pattern], c = $('#breathCircle'), txt = $('#breathText'), cnt = $('#breathCount');
    $('#breathStart').hidden = true; $('#breathStop').hidden = false;
    let cycle = 0;
    const run = pi => {
      if (pi === P.phases.length) { cycle++; if (cycle >= P.cycles) { txt.textContent = 'Muy bien, mi Cap. 🤍'; cnt.textContent = ''; $('#brCycle').textContent = ''; $('#breathStop').hidden = true; $('#breathStart').hidden = false; $('#breathStart').textContent = 'Otra vez'; c.style.transitionDuration = '1.5s'; c.style.width = c.style.height = '120px'; return; } pi = 0; }
      const [label, secs, size] = P.phases[pi];
      $('#brCycle').textContent = `Ciclo ${cycle + 1} de ${P.cycles}`;
      txt.textContent = label; c.style.transitionDuration = secs + 's'; c.style.width = c.style.height = (size === 'big' ? 230 : 110) + 'px'; vibrate(30);
      let left = secs; cnt.textContent = left;
      const iv = this.every(() => { left--; if (left > 0) cnt.textContent = left; }, 1000);
      this.later(() => { clearInterval(iv); run(pi + 1); }, secs * 1000);
    };
    run(0);
  },
  tool_ground() {
    const answers = []; let i = 0; const b = $('#toolBody');
    const step = () => {
      if (i >= C.GROUND.length) {
        b.innerHTML = `<div class="center"><p class="big-emo">🌿</p><h3>Muy bien, mi Cap.</h3><p>Estás aquí, en el presente. Respira una vez más, despacio.</p></div><div class="row center"><button class="btn ghost" id="grSave">Guardar como entrada</button><button class="btn" id="grDone">Terminar</button></div>`;
        $('#grDone').onclick = () => $('#toolDlg').close();
        $('#grSave').onclick = async () => {
          const text = C.GROUND.map((g, k) => `${g[1]}: ${(answers[k] || []).filter(Boolean).join(', ') || '—'}`).join('\n');
          await DB.put('entries', normEntry({ id: uid(), createdAt: new Date().toISOString(), title: 'Ejercicio 5‑4‑3‑2‑1', text, tags: ['calma'] }));
          toast('Guardado en tu diario 🤍'); $('#toolDlg').close();
        };
        return;
      }
      const [icon, title, desc, nInputs] = C.GROUND[i];
      b.innerHTML = `<div class="dots">${C.GROUND.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div><div class="center"><p class="big-emo">${icon}</p><h3>${title}</h3><p class="muted">${desc}</p></div>
        <div class="gr-inputs">${Array.from({ length: nInputs }, (_, k) => `<input class="title-input" placeholder="${k + 1}. (opcional)" maxlength="60">`).join('')}</div>
        <div class="row between"><button class="btn ghost" id="grBack" ${i === 0 ? 'disabled' : ''}>← Atrás</button><button class="btn" id="grNext">${i === C.GROUND.length - 1 ? 'Terminar' : 'Siguiente →'}</button></div>`;
      const ins = [...b.querySelectorAll('.gr-inputs input')]; (answers[i] || []).forEach((v, k) => ins[k] && (ins[k].value = v));
      const keep = () => answers[i] = ins.map(x => x.value.trim());
      $('#grNext').onclick = () => { keep(); i++; step(); };
      $('#grBack').onclick = () => { keep(); i--; step(); };
    };
    step();
  },
  tool_urge() {
    const b = $('#toolBody');
    b.innerHTML = `<div class="center"><p class="big-emo">🌊</p><h3>Está bien sentir ganas.</h3><p>Sentirlas no significa que tengas que actuar. Las ganas son como una ola: suben, llegan a su punto más alto y bajan. Vamos a dejarla pasar juntas.</p></div>
      <p class="small muted center">¿Cuánto tiempo esperamos antes de decidir nada?</p>
      <div class="row center" id="urgeMins"><button class="btn ghost" data-m="5">5 min</button><button class="btn" data-m="10">10 min</button><button class="btn ghost" data-m="20">20 min</button></div>
      <p class="small muted center">${S.urges ? `Ya has dejado pasar ${S.urges} ola${S.urges > 1 ? 's' : ''}. Puedes otra vez. 💪` : ''}</p>`;
    $('#urgeMins').onclick = e => { const x = e.target.closest('[data-m]'); if (x) this.runUrge(+x.dataset.m); };
  },
  runUrge(mins) {
    const b = $('#toolBody'), total = mins * 60, end = Date.now() + total * 1000; let ri = 0;
    const C_ = 2 * Math.PI * 54;
    b.innerHTML = `<div class="urge-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" class="rg-bg"/><circle cx="60" cy="60" r="54" class="rg-fg" id="urgeArc" stroke-dasharray="${C_}" stroke-dashoffset="0"/></svg><div><b id="urgeTime"></b><small>respira y espera</small></div></div>
      <div class="card reflect"><p class="eyebrow">Piensa en esto</p><p id="urgeQ"></p><div class="row between"><button class="link small" id="uqPrev">‹ anterior</button><button class="link small" id="uqNext">siguiente ›</button></div></div>
      <button class="btn ghost full" id="urgeCarta">✉️ Escribirlo aquí, en una carta que NUNCA se envía</button>
      <button class="btn ghost full" id="urgeBreath">🌬️ Respirar mientras espero (4‑7‑8)</button>
      <p class="small muted">También ayuda llamar o estar con alguien de tu confianza (no tienes que hablar de esa persona si no quieres), salir a caminar o tomar agua fría.</p>
      <button class="btn full" id="urgePassed">💪 La ola ya bajó</button>`;
    const showQ = () => $('#urgeQ').textContent = C.URGE_REFLECTIONS[(ri % C.URGE_REFLECTIONS.length + C.URGE_REFLECTIONS.length) % C.URGE_REFLECTIONS.length];
    showQ();
    $('#uqPrev').onclick = () => { ri--; showQ(); }; $('#uqNext').onclick = () => { ri++; showQ(); };
    this.every(() => { ri++; showQ(); }, 25000);
    $('#urgeCarta').onclick = () => Editor.open(null, { kind: 'carta' });
    $('#urgeBreath').onclick = () => { const st = $('#breathMini'); if (st) return; const d = document.createElement('div'); d.id = 'breathMini'; d.className = 'card center'; d.innerHTML = '<p id="bmTxt" class="big-emo" style="font-size:1.2rem"></p>'; $('#urgeBreath').after(d); let k = 0; const ph = [['Inhala… 4', 4], ['Sostén… 7', 7], ['Exhala… 8', 8]]; const go = () => { $('#bmTxt') && ($('#bmTxt').textContent = ph[k % 3][0]); this.later(() => { k++; go(); }, ph[k % 3][1] * 1000); }; go(); };
    $('#urgePassed').onclick = () => this.urgeDone(mins, Math.round((total - Math.max(0, (end - Date.now()) / 1000)) / 60), true);
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      $('#urgeTime').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      $('#urgeArc').setAttribute('stroke-dashoffset', (C_ * (1 - left / total)).toFixed(1));
      if (left <= 0) { this.clearTimers(); this.urgeEnd(mins); }
    };
    tick(); this.every(tick, 1000);
  },
  async urgeEnd(mins) {
    vibrate([60, 60, 60]);
    $('#toolBody').innerHTML = `<div class="center"><p class="big-emo">⏰</p><h3>Pasaron ${mins} minutos.</h3><p>Lo lograste: esperaste. ¿Cómo están las ganas ahora?</p></div>
      <button class="btn full" id="ueDown">💪 Bajaron</button><button class="btn ghost full" id="ueStill">😣 Siguen fuertes</button>`;
    $('#ueDown').onclick = () => this.urgeDone(mins, mins, true);
    $('#ueStill').onclick = () => {
      $('#toolBody').innerHTML = `<div class="center"><p class="big-emo">🤍</p><h3>Está bien, mi Cap.</h3><p>A veces la ola tarda más. No tienes que decidir nada ahora.</p></div>
        <button class="btn full" id="ueMore">Esperar 10 minutos más</button>
        <button class="btn ghost full" id="ueCarta">✉️ Escribir una carta que no se envía</button>
        <button class="btn ghost full" id="ueGround">🖐️ Hacer el 5‑4‑3‑2‑1</button>
        <div class="hotline small">Si sientes que no puedes con esto: <b>Línea de la Vida <a href="tel:8009112000">800 911 2000</a></b> (24 h). También puedes llamar a alguien de tu confianza.</div>`;
      $('#ueMore').onclick = () => this.runUrge(10);
      $('#ueCarta').onclick = () => Editor.open(null, { kind: 'carta' });
      $('#ueGround').onclick = () => this.openTool('ground');
    };
  },
  async urgeDone(mins, waited, passed) {
    this.clearTimers();
    S.urges = (S.urges || 0) + 1; S.urgeLog = [...(S.urgeLog || []), { at: new Date().toISOString(), waited, passed }].slice(-500); await saveSettings();
    $('#toolBody').innerHTML = `<div class="center"><p class="big-emo">🌊💪</p><h3>¡La dejaste pasar!</h3><p>Ya van <b>${S.urges}</b> ola${S.urges > 1 ? 's' : ''} que superas. Elegiste tu paz, mi Cap. Eso es amor propio.</p></div><button class="btn full" id="udClose">Gracias 🤍</button>`;
    $('#udClose').onclick = () => $('#toolDlg').close();
    this.renderCalma();
  },
  tool_affirm() {
    const list = () => [...C.AFFIRMATIONS, ...(S.customAffirm || [])];
    let i = Math.floor(Math.random() * list().length);
    const b = $('#toolBody');
    const render = () => {
      const custom = S.customAffirm || [];
      b.innerHTML = `<div class="affirm-big" id="afText">${esc(list()[i % list().length])}</div>
        <div class="row center"><button class="btn" id="afNext">Otra 💜</button></div>
        <p class="muted small center">Léela despacio, en voz alta si puedes. Repítela tres veces.</p>
        <div class="card"><h4>Mis propias afirmaciones</h4>
        <div class="row"><input class="title-input" id="afNew" placeholder="Escribe una frase para ti…" maxlength="140"><button class="btn small" id="afAdd">Agregar</button></div>
        ${custom.map((a, k) => `<div class="row between af-item"><span class="small">${esc(a)}</span><button class="link small" data-k="${k}">🗑️</button></div>`).join('') || '<p class="muted small">Aún no agregas ninguna.</p>'}</div>`;
      $('#afNext').onclick = () => { i++; $('#afText').classList.remove('fade'); void $('#afText').offsetWidth; $('#afText').classList.add('fade'); $('#afText').textContent = list()[i % list().length]; };
      $('#afAdd').onclick = async () => { const v = $('#afNew').value.trim(); if (!v) return; S.customAffirm = [...custom, v]; await saveSettings(); i = list().length - 1; render(); toast('Afirmación guardada 💜'); };
      b.querySelectorAll('[data-k]').forEach(x => x.onclick = async () => { S.customAffirm = custom.filter((_, k) => k !== +x.dataset.k); await saveSettings(); render(); });
    };
    render();
  },

  /* ----- ideas para escribir ----- */
  openPrompts(cb) {
    const body = $('#promptsBody');
    body.innerHTML = `<button class="btn full" id="prRandom">🎲 Dame una al azar</button>` + C.PROMPTS.map((c, ci) => `<div class="card"><h4>${c.icon} ${esc(c.cat)}</h4>${c.items.map((it, ii) => `<button class="prompt-item${typeof it === 'object' ? ' carta' : ''}" data-c="${ci}" data-i="${ii}">${esc(typeof it === 'object' ? '✉️ ' + it.t : it)}${typeof it === 'object' ? `<small>${esc(it.hint)}</small>` : ''}</button>`).join('')}</div>`).join('');
    const choose = it => {
      $('#promptsDlg').close();
      if (cb) return cb(typeof it === 'object' ? { carta: true } : it);
      if (typeof it === 'object') Editor.open(null, { kind: 'carta' }); else Editor.open(null, { prompt: it });
    };
    body.onclick = e => { const b = e.target.closest('.prompt-item'); if (b) choose(C.PROMPTS[+b.dataset.c].items[+b.dataset.i]); };
    $('#prRandom').onclick = () => choose(C.ALL_PROMPTS[Math.floor(Math.random() * C.ALL_PROMPTS.length)]);
    $('#promptsDlg').showModal(); $('#promptsDlg').scrollTop = 0;
  }
};
window.W = W;
