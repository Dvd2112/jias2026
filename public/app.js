import * as db from './db.js';
import {
  S, getTeam, getSport, tn, fmt, newId, makeBracket, buildKO, isStale, resolve, standings, placements,
  totals, patchMatch, clearScoreFields, clearScheduleFields, CATS, sportLabel, catShort, pickFeatured, schedTs,
  minutesOf, setThird, findConflicts, planSequence, span, fmtClock, fmtDay, normPlace,
} from './logic.js';
import { identityOf } from './teams.js';

const { auth, canScore, isAdmin } = db;
const BUILD = '2026-11-11.7';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);

let ui = { tab: 'agenda', sport: null, ag: { sport: '', cat: '', team: '', status: 'all' }, rcat: '', ready: false, openSched: new Set(),
  tb: { by: 'gym', date: '', sport: '', cat: '', edit: false, sel: new Set(), bk: { date: '', place: '', time: '', gap: 10, shift: '' } }, pl: { extra: new Set(), date: '', start: '08:00', end: '20:00', pick: null }, seq: { date: '', time: '08:00', place: '', gap: 10, over: false } };

/* ---------- avisos ---------- */
let toastT;
function toast(msg, bad, ms = 4000) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', ms);
}
db.hooks.onError = msg => { toast('Não foi possível salvar: ' + msg, true, 9000); refresh(); };
db.hooks.onLive = on => { $('conn').className = 'conn ' + (on ? 'on' : 'off'); $('conn').title = on ? 'Tempo real conectado' : 'Reconectando…'; };
db.hooks.onIdle = () => { if (again) refresh(); };

/* ---------- sincronização ---------- */
let again = false, pendingRender = false;
const typing = () => { const a = document.activeElement; return a && a.matches && a.matches('#view input:not([type=checkbox])') && a.value !== a.defaultValue; };
async function refresh() {
  if (db.busy()) { again = true; return; }       // não sobrescreve uma gravação em andamento
  again = false;
  try { await db.loadAll(); } catch (e) { toast('Falha ao carregar: ' + (e.message || e), true); return; }
  if (typing()) { pendingRender = true; return; } // não atropela quem está digitando
  render();
}
document.addEventListener('focusout', () => { if (pendingRender) { pendingRender = false; setTimeout(render, 0); } });

/* ---------- helpers de tela ---------- */
/* identidade visual: logo + cores da atlética (teams.js), pelo nome */
function tlogo(id) {
  const t = getTeam(id); if (!t) return '';
  const i = identityOf(t.name);
  return i.logo
    ? `<img class="tlogo" src="${i.logo}" alt="" width="40" height="40" loading="lazy" decoding="async">`
    : `<span class="tlogo ini" style="background:${i.primary};color:${i.ink}">${esc(i.initials)}</span>`;
}
const teamTag = id => id == null ? '<span class="tn">A definir</span>' : `<span class="tn">${tlogo(id)}<span class="tname">${esc(tn(id))}</span></span>`;
const teamCell = teamTag;
const teamVars = id => {
  if (id == null) return '';
  const i = identityOf(tn(id));
  return `style="--tc:${i.primary};--ts:${i.secondary};--ta:${i.accent};--ink:${i.ink}"`;
};
function whenText(r) {
  const parts = [];
  if (r.date) { const [y, m, d] = r.date.split('-').map(Number); parts.push(new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })); }
  if (r.time) parts.push(r.time);
  if (r.place) parts.push(esc(r.place));
  return parts.join(' · ');
}
function fmtDate(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
/* caixa de confirmação própria: o confirm() do navegador é bloqueado em navegadores embutidos (WhatsApp, Instagram) e quando a pessoa marca "impedir diálogos" */
function askConfirm(message) {
  const dlg = $('confirmDlg');
  if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(message));
  return new Promise(res => {
    $('cfMsg').textContent = message;
    const ok = $('cfOk'), danger = /apagar|remover|limpar/i.test(message.split('\n')[0]);
    ok.className = 'btn' + (danger ? ' danger' : ''); ok.textContent = danger ? 'Sim, apagar' : 'Confirmar';
    dlg.returnValue = '';
    dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}
const ids = (sp, m) => `data-sp="${sp.id}" data-m="${m.id}"`;

function schedInputs(sp, m) {
  const r = m.rec || {};
  return `<label class="fld">Data<input type="date" ${ids(sp, m)} data-mf="date" value="${esc(r.date || '')}"></label>
    <label class="fld">Hora<input type="time" ${ids(sp, m)} data-mf="time" value="${esc(r.time || '')}"></label>
    <label class="fld wide">Local<input type="text" ${ids(sp, m)} data-mf="place" value="${esc(r.place || '')}" list="places" placeholder="Ginásio, quadra…"></label>`;
}
// quem está na frente: mais sets/pontos; no vôlei empatado em sets, desempata pelo set em andamento
function leadSide(m) {
  const A = m.sa, B = m.sb;
  if (!(m.live || m.done) || A == null || B == null) return null;
  if (A !== B) return A > B ? 'a' : 'b';
  if (m.cur && m.cur.a !== m.cur.b) return m.cur.a > m.cur.b ? 'a' : 'b';
  return null;
}
function scoreCell(sp, m, s) {
  const show = m.live || m.done, v = m['s' + s];
  // por sets, o número grande são os SETS ganhos; os pontos são lançados no painel do set (setCtl)
  if (m.sets !== null || !canScore() || m.a == null || m.b == null) return `<span class="sc ${show ? '' : 'dim'}">${show && v != null ? v : '–'}</span>`;
  return `<div class="step">
    <button class="bump" ${ids(sp, m)} data-bump="${s}" data-delta="-1" aria-label="Menos um">−</button>
    <input type="number" min="0" inputmode="numeric" ${ids(sp, m)} data-mf="s${s}" value="${show || v != null ? (v ?? '') : ''}" aria-label="Placar ${esc(tn(m[s]))}">
    <button class="bump" ${ids(sp, m)} data-bump="${s}" data-delta="1" aria-label="Mais um">+</button></div>`;
}
function setCells(m, s) {
  if (!m.sets || !m.sets.length) return '';
  const o = s === 'a' ? 'b' : 'a';
  return `<span class="setcells" aria-label="Pontos por set">${m.sets.map(st => `<i class="${st.done ? '' : 'cur'} ${st.done && st[s] > st[o] ? 'w' : ''}">${st[s]}</i>`).join('')}</span>`;
}
function setCtl(sp, m) {
  const best = sp.best_of || 3, cur = m.cur || { a: 0, b: 0 }, n = m.sets.length + (m.cur ? 0 : 1);
  const dec = n === best, target = dec ? 15 : 25;
  const ready = !!m.cur && (cur.a >= target || cur.b >= target) && Math.abs(cur.a - cur.b) >= 2;   // regra clássica: 25 (15 no decisivo), diferença de 2
  const col = s => `<div class="sp" ${teamVars(m[s])}><span class="spn"><i class="dot"></i>${esc(tn(m[s]))}</span><div class="step">
      <button class="bump" ${ids(sp, m)} data-pt="${s}" data-d="-1" aria-label="Menos um ponto">−</button><b class="pts">${cur[s]}</b>
      <button class="bump" ${ids(sp, m)} data-pt="${s}" data-d="1" aria-label="Mais um ponto">+</button></div></div>`;
  const canUndo = m.sets.some(x => x.done) && (!m.cur || m.cur.a + m.cur.b === 0);
  return `<div class="setctl"><div class="setlab">Set ${n}${dec ? ' (decisivo)' : ''} · até ${target} pontos, diferença de 2 <small>(melhor de ${best})</small></div>
    <div class="setpts">${col('a')}${col('b')}</div>
    <div class="setbtns"><button class="btn ${ready ? '' : 'alt'}" ${ids(sp, m)} data-closeset>✔ Fechar set ${n}</button>
      ${canUndo ? `<button class="btn alt sm" ${ids(sp, m)} data-undoset>↩ Reabrir set anterior</button>` : ''}
      ${m.sa !== m.sb ? `<button class="btn alt sm" ${ids(sp, m)} data-status="final">Encerrar jogo</button>` : ''}</div></div>`;
}
function statusBadge(m) {
  if (m.live) return '<span class="st live">● Ao vivo</span>';
  if (m.done) return `<span class="st fin">Encerrado${m.wo ? ' · WO' : ''}</span>`;
  if (m.a != null && m.b != null) return '<span class="st">Agendado</span>';
  return '<span class="st tbd">Aguardando</span>';
}
function gameCard(sp, m, { showSport = false, extra = '', compact = false, hero = '' } = {}) {
  if (m.bye) return `<div class="game bye"><span class="nm">${m.w != null ? esc(tn(m.w)) : 'A definir'}</span><span class="muted">folga — avança direto</span></div>`;
  const side = leadSide(m);
  const row = s => {
    const team = m[s], win = m.w != null && m.w === team, lead = side === s;   // quem está na frente fica com a cor da atlética
    return `<div class="gt ${win || lead ? 'hot' : ''} ${lead ? 'lead' : ''} ${win ? 'win' : ''} ${team == null ? 'tbd' : ''}" ${teamVars(team)} data-gk="${sp.id}|${m.id}|${s}"><span class="nm">${teamCell(team)}${m.wo && m.wo === team ? '<span class="wobadge" title="Não compareceu (WO)">WO</span>' : ''}</span>${setCells(m, s)}${scoreCell(sp, m, s)}</div>`;
  };
  const both = m.a != null && m.b != null;
  let ctl = '';
  if (canScore() && both) {
    ctl = m.live ? (m.sets !== null ? setCtl(sp, m) : `<button class="btn" ${ids(sp, m)} data-status="final">✔ Encerrar jogo</button>`)
      : m.done ? `<button class="btn alt sm" ${ids(sp, m)} data-status="live">Reabrir</button>`
        : `<button class="btn" ${ids(sp, m)} data-status="live">▶ Iniciar jogo</button>`;
  }
  let tie = '';
  if (m.tie && sp.bracket.format === 'knockout') {
    tie = canScore()
      ? `<div class="tie">Empate — quem venceu o desempate? ${[m.a, m.b].map(t => `<button class="btn sm ${m.w === t ? '' : 'alt'}" ${ids(sp, m)} data-tb="${t}">${esc(tn(t))}</button>`).join('')}</div>`
      : `<div class="tie">${m.w != null ? 'Decidido no desempate' : 'Empate — aguardando desempate'}</div>`;
  }
  const when = whenText(m.rec), sk = `${sp.id}|${m.id}`, hasDate = !!(m.rec && m.rec.date);
  // quem pode lançar vê sempre onde marcar data e hora (aberto enquanto o jogo não tem data)
  const hasSched = !!(m.rec && (m.rec.date || m.rec.time || m.rec.place));
  const sched = canScore()
    ? `<details class="sched ${hasDate ? '' : 'empty'}" data-sk="${sk}" ${hasDate && !ui.openSched.has(sk) ? '' : 'open'}><summary>🕒 ${when || 'Definir data e hora'}</summary><div class="schedin">${schedInputs(sp, m)}${hasSched ? `<button class="linkbtn wide" ${ids(sp, m)} data-clearsched>Limpar data, hora e local</button>` : ''}</div></details>`
    : (when ? `<div class="when">🕒 ${when}</div>` : '');
  const tag = `${showSport ? `<span class="tag">${esc(sp.name)}</span><span class="cat ${sp.category}">${CATS[sp.category]}</span>` : ''}<span>${esc(m.label)}</span>`;
  let head;
  if (hero) {
    const ts = schedTs(m.rec);
    const clock = hero === 'live'
      ? (m.rec.started_at ? `<span class="clock" data-since="${esc(m.rec.started_at)}"></span>` : '')
      : (ts != null ? `<span class="clock" data-until="${new Date(ts).toISOString()}"></span>` : '');
    head = `<div class="hhead ${hero}"><span class="hbadge">${hero === 'live' ? '● Ao vivo' : 'Próximo jogo'}</span>
      <span class="hwhat"><b>${esc(sp.name)}</b> <span class="cat ${sp.category}">${CATS[sp.category]}</span> · ${esc(m.label)}</span>${clock}</div>`;
  } else head = `<div class="gmeta">${tag}${statusBadge(m)}</div>`;
  const woCtl = canScore() && both && !m.done
    ? `<details class="wo"><summary>Registrar WO (não compareceu)</summary><div class="wobtns">${[m.a, m.b].map(t => `<button class="btn alt sm" ${ids(sp, m)} data-wo="${t}">${esc(tn(t))} faltou</button>`).join('')}</div></details>` : '';
  const hasScore = m.live || m.done || (m.rec && (m.rec.sa != null || m.rec.sb != null || (m.rec.sets && m.rec.sets.length)));
  const del = canScore() && both && hasScore ? `<div class="gdel"><button class="linkbtn" ${ids(sp, m)} data-resetm>🗑 Apagar placar deste jogo</button></div>` : '';
  return `<article class="game ${m.live ? 'live' : ''} ${m.done ? 'done' : ''} ${compact ? 'compact' : ''} ${hero ? 'hero ' + hero : ''} ${extra}">
    ${head}${row('a')}${row('b')}${tie}${ctl ? `<div class="gctl ${m.sets !== null && m.live ? 'sets' : ''}">${ctl}</div>` : ''}${woCtl}${del}${sched}</article>`;
}

/* ---------- render ---------- */
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  agenda: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="12" cy="15.5" r="1.6"/>'),
  sport: svg('<path d="M3 4h6v5H3zM3 15h6v5H3zM15 9.5h6v5h-6z"/><path d="M9 6.5h3v11H9m3-5.5h3"/>'),
  rank: svg('<path d="M3 21h18M5 21v-7h4v7M10 21V6h4v15M15 21v-10h4v10"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>'),
  plan: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11M14 9v11M5.5 14h0M11 14h0M17 14h0"/>'),
  cfg: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
};
const focusKey = el => el.tagName + '|' + el.getAttributeNames().filter(n => n.startsWith('data-')).map(n => n + '=' + el.getAttribute(n)).join('&');
function render() {
  if (!getSport(ui.sport)) ui.sport = S.sports[0] && S.sports[0].id;
  if (ui.tab === 'plan' && !canScore()) ui.tab = 'agenda';
  if (ui.tab === 'cfg' && !isAdmin()) ui.tab = 'agenda';
  const v = $('view');
  const ae = document.activeElement;
  const ak = ae && v.contains(ae) && /^(INPUT|SELECT)$/.test(ae.tagName) && ae.getAttributeNames().some(n => n.startsWith('data-')) ? focusKey(ae) : null;
  const scroll = window.scrollY;
  const tabs = [['agenda', 'Jogos'], ['table', 'Tabela'], ['sport', 'Chaves'], ['rank', 'Ranking']];
  if (canScore()) tabs.push(['plan', 'Horários']);
  if (isAdmin()) tabs.push(['cfg', 'Ajustes']);
  $('tabs').innerHTML = tabs.map(([id, l]) => `<button class="${ui.tab === id ? 'on' : ''}" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}><span class="ic">${ICONS[id]}</span><span class="lb">${l}</span></button>`).join('');
  $('who').innerHTML = auth.user
    ? `<span class="role">${isAdmin() ? 'Admin' : canScore() ? 'Mesário' : 'Sem permissão'}</span><button class="link" data-logout>Sair</button>`
    : `<button class="link" data-login>Entrar</button>`;
  if (!ui.ready) { v.innerHTML = '<div class="boot"><img src="assets/logo.webp" alt="JIAS 2026" width="140" height="140"><p class="muted">Carregando…</p></div>'; return; }
  const outdated = db.state.outdated && canScore()
    ? `<div class="warn sticky"><b>Banco de dados desatualizado.</b> O que você alterar <u>não será salvo</u>. Rode no terminal, dentro da pasta do projeto: <code>supabase db push --linked</code> (ou cole os arquivos de <code>supabase/migrations</code> no SQL Editor do Supabase) e recarregue.</div>` : '';
  v.innerHTML = outdated + { agenda: viewAgenda, table: viewTable, sport: viewSport, rank: viewRank, plan: viewPlan, cfg: viewCfg }[ui.tab]();
  if (ak) { const el = [...v.querySelectorAll('input,select')].find(x => focusKey(x) === ak); if (el) el.focus({ preventScroll: true }); }
  window.scrollTo(0, scroll);
  const places = [...new Set([...(S.config.gyms || []), ...S.sports.flatMap(s => s.bracket ? Object.values(s.bracket.m).map(r => (r.place || '').trim()).filter(Boolean) : [])])].sort();
  v.insertAdjacentHTML('beforeend', `<datalist id="places">${places.map(p => `<option value="${esc(p)}">`).join('')}</datalist><p class="muted center build">versão ${BUILD}</p>`);
  tickClocks();
  celebrate();
}

/* ---------- animações de pontuação ----------
   Compara o placar de cada time com o da renderização anterior. Vale para qualquer origem da mudança
   (tempo real de outro aparelho ou toque do próprio mesário). */
let prevSnap = null;
function snapshot() {
  const cur = {};
  S.sports.forEach(sp => {
    const R = resolve(sp); if (!R) return;
    R.list.forEach(m => {
      if (m.bye || m.a == null || m.b == null) return;
      const show = (m.live || m.done) && m.tot && m.tot.a != null && m.tot.b != null;
      const side = leadSide(m);
      ['a', 'b'].forEach(s => {
        // v = pontos acumulados (no vôlei soma todos os sets): cada ponto marcado dispara a animação
        cur[`${sp.id}|${m.id}|${s}`] = { team: m[s], v: show ? m.tot[s] : null, lead: side === s };
      });
    });
  });
  return cur;
}
function replay(el, cls, ms = 1600) {
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}
function burst(el, delta) {
  replay(el, 'scored');
  const plus = document.createElement('span'); plus.className = 'plus'; plus.textContent = '+' + delta;
  el.appendChild(plus); setTimeout(() => plus.remove(), 1300);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cs = getComputedStyle(el);
  const cols = ['--ts', '--ta', '--tc'].map(v => cs.getPropertyValue(v).trim() || '#C9A34B');   // as 3 cores da atlética
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('i'), ang = Math.random() * Math.PI * 2, d = 44 + Math.random() * 70;
    p.className = 'pt';
    p.style.cssText = `--dx:${Math.cos(ang) * d}px;--dy:${Math.sin(ang) * d - 16}px;background:${cols[i % 3]}`;
    el.appendChild(p); setTimeout(() => p.remove(), 1000);
  }
}
const fmtDur = ms => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return `${m} min`;
  if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return `${h} h${r ? ' ' + String(r).padStart(2, '0') + ' min' : ''}`; }
  const d = Math.floor(m / 1440); return `${d} dia${d > 1 ? 's' : ''}`;
};
function tickClocks() {
  const now = Date.now();
  document.querySelectorAll('[data-since]').forEach(el => { el.textContent = '⏱ ' + fmtDur(now - Date.parse(el.dataset.since)) + ' de jogo'; });
  document.querySelectorAll('[data-until]').forEach(el => {
    const d = Date.parse(el.dataset.until) - now;
    el.textContent = d >= 0 ? 'começa em ' + fmtDur(d) : 'marcado há ' + fmtDur(-d);
  });
}
setInterval(tickClocks, 20000);
function celebrate() {
  if (!ui.ready) return;
  const cur = snapshot(), prev = prevSnap; prevSnap = cur;
  if (!prev) return;                                   // primeira carga: não anima
  Object.entries(cur).forEach(([k, c]) => {
    const p = prev[k]; if (!p || p.team !== c.team) return;
    const el = $('view').querySelector(`[data-gk="${k}"]`); if (!el) return;
    if (c.v != null && p.v != null && c.v > p.v) burst(el, c.v - p.v);
    if (c.lead && !p.lead) replay(el, 'took-lead', 900);  // passou à frente: a cor da atlética varre a linha
  });
}

/* ----- Jogos (tela principal pública) ----- */
function viewAgenda() {
  const f = ui.ag, all = [];
  S.sports.forEach(sp => { const R = resolve(sp); if (R) R.list.filter(m => !m.bye).forEach(m => all.push({ sp, m })); });
  const conf = canScore() ? findConflicts(all) : {};   // sobreposição de horários (considera a duração média) no mesmo ginásio ou com a mesma atlética
  // destaque: jogo ao vivo (o mais antigo no ar) ou o próximo agendado; respeita o filtro de modalidade/categoria
  if (f.team && !getTeam(f.team)) f.team = '';
  const mine = ({ sp, m }) => (!f.sport || sp.name === f.sport) && (!f.cat || sp.category === f.cat) && (!f.team || m.a === f.team || m.b === f.team);
  const feat = pickFeatured(all.filter(mine));
  const hero = feat ? `<section class="hero-wrap">${gameCard(feat.item.sp, feat.item.m, { hero: feat.kind })}</section>` : '';
  const items = all.filter(it => (!feat || it.m !== feat.item.m) && mine(it) && (({ m }) => ({
    all: true, live: m.live, pend: !m.fin && !m.done, fin: m.fin || m.done,
  }[f.status]))(it));
  const key = ({ m }) => (m.rec.date || '9999-99-99') + (m.rec.time || '99:99');
  items.sort((x, y) => key(x).localeCompare(key(y)) || x.sp.name.localeCompare(y.sp.name) || x.sp.category.localeCompare(y.sp.category) || x.m.round - y.m.round);

  const card = ({ sp, m }) => {
    const c = conf[sp.id + m.id];
    return gameCard(sp, m, { showSport: true }) + (c ? `<div class="conf">⚠ Conflito de horário: ${[...c].map(esc).join(', ')}</div>` : '');
  };
  let html = '';
  const live = items.filter(({ m }) => m.live);
  if (live.length) html += `<h2 class="sec live">● Ao vivo agora</h2><div class="cards">${live.map(card).join('')}</div>`;
  let last = null, open = false;
  items.filter(({ m }) => !m.live).forEach(it => {
    const d = it.m.rec.date || '';
    if (d !== last) { if (open) html += '</div>'; html += `<h2 class="sec">${d ? esc(fmtDate(d)) : 'Sem data definida'}</h2><div class="cards">`; last = d; open = true; }
    html += card(it);
  });
  if (open) html += '</div>';
  if (!items.length) html = hero ? '' : `<p class="empty">${all.length ? 'Nenhum jogo com esse filtro.' : 'O chaveamento ainda não foi sorteado.'}</p>`;
  const sel = (k, opts) => `<select data-agf="${k}">${opts.map(([v, l]) => `<option value="${v}" ${f[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `${hero}<div class="filters">
    ${sel('sport', [['', 'Todas as modalidades'], ...[...new Set(S.sports.map(s => s.name))].map(n => [esc(n), esc(n)])])}
    ${sel('cat', [['', 'Masc. e fem.'], ['masculino', 'Masculino'], ['feminino', 'Feminino']])}
    ${sel('team', [['', 'Todas as atléticas'], ...S.teams.map(t => [t.id, esc(t.name)])])}
    ${sel('status', [['all', 'Todos'], ['live', 'Ao vivo'], ['pend', 'Pendentes'], ['fin', 'Encerrados']])}</div>${html}`;
}

/* ----- Chaves ----- */
function viewSport() {
  if (!S.sports.length) return '<p class="empty">Nenhuma modalidade cadastrada.</p>';
  const sp = getSport(ui.sport);
  const names = [...new Set(S.sports.map(s => s.name))];
  const subs = names.map(n => `<button class="${n === sp.name ? 'on' : ''}" data-sname="${esc(n)}">${esc(n)}</button>`).join('');
  const seg = `<div class="seg" role="group" aria-label="Categoria">${S.sports.filter(s => s.name === sp.name).map(s =>
    `<button class="${s.category} ${s.id === sp.id ? 'on' : ''}" data-sport="${s.id}">${CATS[s.category]}</button>`).join('')}</div>`;
  let body;
  if (sp.bracket) {
    const stale = isAdmin() && isStale(sp)
      ? '<div class="warn">⚠ Inscrições ou formato mudaram depois do sorteio. Sorteie de novo para atualizar (placares e horários desta modalidade são apagados).</div>' : '';
    body = stale + (sp.bracket.format === 'rr' ? viewRR(sp) : viewKO(sp));
  } else {
    const names = S.teams.filter(t => sp.enrolled.includes(t.id)).map(t => esc(t.name)).join(', ');
    body = `<p class="empty">Chaveamento ainda não sorteado.${names ? `<br><small>Inscritas: ${names}</small>` : ''}</p>`;
  }
  return `<div class="chips">${subs}</div>${seg}${isAdmin() ? adminPanel(sp) : ''}${body}`;
}

function adminPanel(sp) {
  const n = sp.enrolled.length, can = n >= 2;
  const sq = ui.seq, plan = sp.bracket ? planSequence(sp, { date: sq.date, time: sq.time, place: sq.place, gap: sq.gap, overwrite: sq.over }) : [];
  const seqKey = 'seq|' + sp.id;
  const checks = S.teams.map(t => `<label class="chk"><input type="checkbox" data-enroll="${t.id}" ${sp.enrolled.includes(t.id) ? 'checked' : ''}> ${teamTag(t.id)}</label>`).join('');
  const opt = sp.format === 'rr'
    ? `<label class="chk"><input type="checkbox" data-double ${sp.double ? 'checked' : ''}> Turno e returno</label>`
    : `<label class="chk"><input type="checkbox" data-third ${sp.third ? 'checked' : ''}> Disputa de 3º lugar</label>`;
  return `<details class="card admin" ${sp.bracket ? '' : 'open'}><summary>⚙ Inscrições e formato — ${esc(sportLabel(sp))} <small>(${n} inscrita${n === 1 ? '' : 's'})</small></summary>
    <div class="row"><button class="btn sm alt" data-enroll-all="1">Todas</button><button class="btn sm alt" data-enroll-all="0">Nenhuma</button></div>
    <div class="checks">${checks || '<span class="muted">Cadastre atléticas em Ajustes.</span>'}</div>
    <label class="fld">Formato<select data-fmt>
      <option value="knockout" ${sp.format === 'knockout' ? 'selected' : ''}>Eliminatória (mata-mata)</option>
      <option value="rr" ${sp.format === 'rr' ? 'selected' : ''}>Todos contra todos (pontos corridos)</option></select></label>
    ${opt}
    <div class="row"><label class="fld">Placar dos jogos<select data-scoring>
      <option value="simple" ${sp.scoring !== 'sets' ? 'selected' : ''}>Simples (gols / pontos)</option>
      <option value="sets" ${sp.scoring === 'sets' ? 'selected' : ''}>Por sets (vôlei)</option></select></label>
      ${sp.scoring === 'sets' ? `<label class="fld">Melhor de<select data-bestof><option value="3" ${sp.best_of !== 5 ? 'selected' : ''}>3 sets</option><option value="5" ${sp.best_of === 5 ? 'selected' : ''}>5 sets</option></select></label>` : ''}</div>
    ${sp.scoring === 'sets' && sp.bracket ? '<p class="muted">Defina o tipo de placar antes de começar os jogos: trocar depois não converte os placares já lançados.</p>' : ''}
    <label class="fld">Duração média de um jogo de ${esc(sp.name)} (minutos)<input type="number" min="5" max="480" step="5" data-minutes="${esc(sp.name)}" value="${minutesOf(sp)}"></label>
    <p class="muted">Vale para o masculino e o feminino. Usada no horário final dos jogos, na tabela e na detecção de conflitos.</p>
  </details>
  <div class="adminbar">
    <div class="row"><button class="btn" data-gen="random" ${can ? '' : 'disabled'}>🎲 ${sp.bracket ? 'Sortear de novo' : 'Sortear'}</button>
      <button class="btn alt" data-gen="order" ${can ? '' : 'disabled'} title="Usa a ordem da lista de atléticas como cabeças de chave">${sp.bracket ? 'Refazer na ordem da lista' : 'Gerar na ordem da lista'}</button></div>
    ${sp.bracket ? `<div class="row dz"><span class="muted">Apagar:</span>
      <button class="btn alt sm" data-clear>Placares</button><button class="btn alt sm" data-clearsched-all>Datas e horários</button>
      <button class="btn danger sm" data-drop>Chaveamento inteiro</button></div>
      <p class="muted">Sortear de novo zera os placares e mantém as datas e horários dos jogos.</p>` : ''}
  </div>
  ${sp.bracket ? `<details class="card seq" data-sk="${seqKey}" ${ui.openSched.has(seqKey) ? 'open' : ''}><summary>🗓 Agendar em sequência</summary>
    <p class="muted">Distribui os jogos desta chave um depois do outro: duração média (${minutesOf(sp)} min) + intervalo.</p>
    <div class="grid2">
      <label class="fld">Data<input type="date" data-seq="date" value="${esc(sq.date)}"></label>
      <label class="fld">Primeiro jogo às<input type="time" data-seq="time" value="${esc(sq.time)}"></label>
      <label class="fld">Ginásio<input type="text" data-seq="place" list="places" value="${esc(sq.place)}" placeholder="Ginásio 1"></label>
      <label class="fld">Intervalo entre jogos (min)<input type="number" min="0" max="120" data-seq="gap" value="${sq.gap}"></label></div>
    <label class="chk"><input type="checkbox" data-seq="over" ${sq.over ? 'checked' : ''}> Refazer também os jogos que já têm horário</label>
    <p class="muted">${plan.length ? `${plan.length} jogo(s), do primeiro às ${esc(plan[0].time)} até ${fmtClock(plan[plan.length - 1].end)}.` : 'Informe data e hora para ver a prévia (jogos que já têm horário são mantidos).'}</p>
    <button class="btn" data-seqgo ${plan.length ? '' : 'disabled'}>Agendar ${plan.length || ''} jogo(s)</button></details>` : ''}`;
}

function podium(sp) {
  const { p } = placements(sp), names = ['🏆 Campeão', 'Vice', '3º lugar', '4º lugar'];
  const items = [0, 1, 2, 3].map(pos => {
    const ts = Object.keys(p).filter(k => p[k] === pos);
    return ts.length ? `<div ${teamVars(ts[0])}><b>${names[pos]}</b> ${ts.map(teamTag).join(' ')}</div>` : '';
  }).join('');
  return items ? `<div class="podium">${items}</div>` : '';
}
function viewKO(sp) {
  const R = resolve(sp), br = sp.bracket, cols = [];
  for (let r = 1; r <= br.rounds; r++) {
    const ms = R.list.filter(m => m.round === r && !m.third), isFinal = r === br.rounds;
    cols.push(`<section class="round ${isFinal ? 'last' : ''}"><h3>${esc(ms[0].rname)}</h3><div class="rbody">
      ${ms.map((m, i) => `<div class="bm ${i % 2 ? 'dn' : 'up'}">${gameCard(sp, m, { extra: isFinal ? 'final' : '', compact: true })}</div>`).join('')}</div></section>`);
  }
  const F = R.byId[br.finalId];
  const champ = F.w != null
    ? `<div class="champbox" ${teamVars(F.w)}>${tlogo(F.w)}<span class="cname">${esc(tn(F.w))}</span><span class="ctag">Campeão</span></div>`
    : '<div class="champbox empty"><span class="trophy">🏆</span><span class="cname">A definir</span></div>';
  cols.push(`<section class="round champ"><h3>Campeão</h3><div class="rbody"><div class="bm">${champ}</div></div></section>`);
  const third = R.byId.T ? `<div class="third-row"><h3>Disputa de 3º lugar</h3>${gameCard(sp, R.byId.T, { compact: true })}</div>` : '';
  const seeds = isAdmin() ? `<details class="card"><summary class="muted">Definir cabeças de chave manualmente (zera placares, mantém horários)</summary>
    <div class="seeds">${br.teams.map((t, i) => `<label class="fld">${i + 1}º<select data-seed="${i}">${br.teams.map(k => `<option value="${k}" ${k === t ? 'selected' : ''}>${esc(tn(k))}</option>`).join('')}</select></label>`).join('')}</div></details>` : '';
  return `${podium(sp)}${seeds}<div class="bracket-wrap"><div class="bracket">${cols.join('')}</div></div>${third}`;
}
function viewRR(sp) {
  const R = resolve(sp), { rows, complete } = placements(sp);
  const rounds = [...new Set(R.list.map(m => m.round))];
  return `<div class="card"><h2>Classificação</h2><div class="scroll"><table><thead><tr><th>#</th><th>Atlética</th><th class="n">Pts</th><th class="n">J</th><th class="n">V</th><th class="n">E</th><th class="n">D</th><th class="n">SG</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${i === 0 && r.J > 0 ? 'first' : ''}"><td class="pos">${i + 1}</td><td>${teamTag(r.id)}</td><td class="n"><b>${r.P}</b></td><td class="n">${r.J}</td><td class="n">${r.V}</td><td class="n">${r.E}</td><td class="n">${r.D}</td><td class="n">${r.SG}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted">Vitória ${S.config.win} · empate ${S.config.draw} · derrota ${S.config.loss}. Desempate: vitórias, saldo, gols pró.${complete ? '' : ' Os pontos da classificação geral entram quando todos os jogos terminarem.'}</p>${podium(sp)}</div>
    ${rounds.map(r => `<h2 class="sec">Rodada ${r}</h2><div class="cards">${R.list.filter(m => m.round === r).map(m => gameCard(sp, m)).join('')}</div>`).join('')}`;
}

/* ----- Tabela: ordem dos jogos por ginásio ou por modalidade; edição em lote e impressão filtrada ----- */
const rowKey = (sp, m) => sp.id + '|' + m.id;
function tableRows() {
  const T = ui.tb, all = [];
  S.sports.forEach(sp => { const R = resolve(sp); if (R) R.list.filter(m => !m.bye).forEach(m => all.push({ sp, m })); });
  const startOf = ({ sp, m }) => { const t = span(sp, m); return t ? t.start : (m.rec.date ? schedTs(m.rec) : null); };
  const rows = all.filter(({ sp, m }) => (!T.sport || sp.name === T.sport) && (!T.cat || sp.category === T.cat)
    && (!T.date || (T.date === '-' ? !m.rec.date : m.rec.date === T.date)));
  rows.sort((x, y) => (startOf(x) ?? 9e15) - (startOf(y) ?? 9e15) || S.sports.indexOf(x.sp) - S.sports.indexOf(y.sp) || x.m.round - y.m.round);
  return { all, rows };
}
function viewTable() {
  const T = ui.tb, { all, rows } = tableRows();
  if (!all.length) return '<p class="empty">O chaveamento ainda não foi sorteado.</p>';
  const edit = T.edit && canScore();
  const dates = [...new Set(all.map(({ m }) => m.rec.date).filter(Boolean))].sort();
  const conf = canScore() ? findConflicts(all) : {};   // conflitos só aparecem para quem organiza
  const gym = T.by === 'gym';

  const groups = new Map();
  rows.forEach(r => {
    const k = gym ? (normPlace(r.m.rec.place) || '~') : r.sp.id;
    if (!groups.has(k)) groups.set(k, { k, title: gym ? (r.m.rec.place || '').trim() || 'Sem ginásio definido' : sportLabel(r.sp), sp: r.sp, rows: [] });
    groups.get(k).rows.push(r);
  });
  const list = [...groups.values()].sort((a, b) => gym
    ? (a.k === '~') - (b.k === '~') || a.title.localeCompare(b.title)
    : S.sports.indexOf(a.sp) - S.sports.indexOf(b.sp));

  const body = g => {
    let html = '', last = null, n = 0;
    g.rows.forEach(({ sp, m }) => {
      const d = m.rec.date || '', k = rowKey(sp, m);
      if (d !== last) { html += `<tr class="dayrow"><td colspan="${edit ? 8 : 7}">${d ? esc(fmtDate(d)) : 'Sem data definida'}</td></tr>`; last = d; n = 0; }
      n++;
      const t = span(sp, m), c = conf[sp.id + m.id];
      let time, where;
      if (edit) {
        time = `<input type="date" class="ti" ${ids(sp, m)} data-mf="date" value="${esc(m.rec.date || '')}" aria-label="Data"><input type="time" class="ti" ${ids(sp, m)} data-mf="time" value="${esc(m.rec.time || '')}" aria-label="Hora">${t ? `<span class="end"> – ${fmtClock(t.end)}</span>` : ''}`;
        where = `<input type="text" class="ti pl" list="places" ${ids(sp, m)} data-mf="place" value="${esc(m.rec.place || '')}" placeholder="Ginásio" aria-label="Ginásio"><div class="small">${esc(sp.name)} <span class="cat ${sp.category}">${CATS[sp.category]}</span></div>`;
      } else {
        time = t ? `<b>${esc(m.rec.time)}</b><span class="end"> – ${fmtClock(t.end)}</span>` : (m.rec.time ? `<b>${esc(m.rec.time)}</b>` : '<span class="muted">—</span>');
        where = gym ? `${esc(sp.name)} <span class="cat ${sp.category}">${CATS[sp.category]}</span>` : (esc(m.rec.place) || '<span class="muted">—</span>');
      }
      const score = (m.live || m.done) && m.sa != null && m.sb != null ? `<b>${m.sa} × ${m.sb}</b>${m.wo ? ' <span class="wobadge">WO</span>' : ''}` : '<span class="muted">—</span>';
      html += `<tr class="${m.live ? 'live' : ''} ${m.done ? 'done' : ''}">${edit ? `<td class="c-sel noprint"><input type="checkbox" data-tbsel="${k}" ${T.sel.has(k) ? 'checked' : ''} aria-label="Selecionar jogo"></td>` : ''}<td class="pos c-pos">${n}</td><td class="tm c-tm">${time}</td><td class="c-wh">${where}</td><td class="c-fa">${esc(m.label)}</td>
        <td class="vs c-vs"><span class="vsw">${teamTag(m.a)}<i>×</i>${teamTag(m.b)}</span></td><td class="n c-sc">${score}</td>
        <td class="c-st">${statusBadge(m)}${c ? ` <span class="conf-ic" title="Conflito: ${esc([...c].join(', '))}">⚠ conflito</span>` : ''}</td></tr>`;
    });
    return html;
  };
  const chip = (attr, cur, opts) => `<div class="chips tbchips">${opts.map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" ${attr}="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const names = [...new Set(S.sports.map(s => s.name))];
  const seg = [['gym', 'Por ginásio'], ['sport', 'Por modalidade']].map(([v, l]) => `<button class="${T.by === v ? 'on' : ''}" data-tby="${v}">${l}</button>`).join('');
  const dateSel = `<select data-tbdate aria-label="Dia"><option value="">Todos os dias</option>${dates.map(d => `<option value="${d}" ${T.date === d ? 'selected' : ''}>${esc(fmtDate(d))}</option>`).join('')}<option value="-" ${T.date === '-' ? 'selected' : ''}>Sem data</option></select>`;
  const cards = list.map(g => `<section class="card tbl"><h2>${esc(g.title)}${!gym ? ` <small>· duração média ${minutesOf(g.sp)} min</small>` : ''}</h2>
    <div class="scroll"><table class="sched"><thead><tr>${edit ? `<th class="noprint"><input type="checkbox" data-tbselgrp="${esc(g.k)}" ${g.rows.every(({ sp, m }) => T.sel.has(rowKey(sp, m))) ? 'checked' : ''} aria-label="Selecionar todos deste grupo"></th>` : ''}<th>#</th><th>Horário</th><th>${gym ? 'Modalidade' : 'Ginásio'}</th><th>Fase</th><th>Jogo</th><th class="n">Placar</th><th>Situação</th></tr></thead><tbody>${body(g)}</tbody></table></div></section>`).join('');

  // título que aparece só na impressão, dizendo exatamente o que foi filtrado
  const what = [T.sport || 'Todas as modalidades', T.cat ? CATS[T.cat] : 'Masculino e feminino', T.date ? (T.date === '-' ? 'Sem data' : fmtDate(T.date)) : 'Todos os dias'].join(' · ');
  const selN = [...T.sel].filter(k => rows.some(({ sp, m }) => rowKey(sp, m) === k)).length;
  const bulk = edit ? `<details class="card seq noprint" data-sk="tbbulk" ${ui.openSched.has('tbbulk') ? 'open' : ''}><summary>⚙ Ajustar horários em lote (${selN} selecionado${selN === 1 ? '' : 's'})</summary>
    <p class="muted">Marque os jogos na tabela (ou use ${rows.length} filtrados abaixo) e aplique. Só os campos preenchidos são alterados.</p>
    <div class="grid2">
      <label class="fld">Data<input type="date" data-bk="date" value="${esc(T.bk.date)}"></label>
      <label class="fld">Ginásio<input type="text" list="places" data-bk="place" value="${esc(T.bk.place)}" placeholder="Ginásio 1"></label>
      <label class="fld">Primeiro jogo às<input type="time" data-bk="time" value="${esc(T.bk.time)}"></label>
      <label class="fld">Intervalo entre jogos (min)<input type="number" min="0" max="120" data-bk="gap" value="${T.bk.gap}"></label>
      <label class="fld">Adiantar / atrasar (min)<input type="number" step="5" data-bk="shift" value="${T.bk.shift}" placeholder="ex.: 30 ou -15"></label></div>
    <div class="row"><button class="btn" data-tbbk="apply" ${selN ? '' : 'disabled'}>Aplicar a ${selN} selecionado(s)</button>
      <button class="btn alt" data-tbbk="all">Selecionar os ${rows.length} filtrados</button><button class="btn alt" data-tbbk="none">Desmarcar</button>
      <button class="btn alt" data-clr="sel" ${selN ? '' : 'disabled'}>🧹 Limpar horário e local dos selecionados</button></div>
    <p class="muted">"Primeiro jogo às" encadeia os selecionados na ordem da tabela (duração média + intervalo). "Adiantar/atrasar" soma minutos ao horário atual de cada um.</p></details>` : '';
  return `<div class="tbhead noprint"><div class="seg" role="group" aria-label="Agrupar">${seg}</div>${dateSel}
      ${canScore() ? `<button class="btn alt sm ${T.edit ? 'on' : ''}" data-tbedit>${T.edit ? '✔ Editando horários' : '✎ Editar horários'}</button>` : ''}
      <button class="btn sm" data-tbprint>🖨 Imprimir${T.sport || T.cat || T.date ? ' (filtrado)' : ''}</button></div>
    <div class="noprint">${chip('data-tbsport', T.sport, [['', 'Todas as modalidades'], ...names.map(n => [n, n])])}${chip('data-tbcat', T.cat, [['', 'Masc. + Fem.'], ['masculino', 'Masculino'], ['feminino', 'Feminino']])}</div>
    ${bulk}
    <h1 class="printonly">JIAS 2026 — Tabela de jogos<small>${esc(what)}</small></h1>
    ${cards || '<p class="empty">Nenhum jogo com esses filtros.</p>'}
    <p class="muted noprint">Ordem por data e horário. O horário final é o início mais a duração média da modalidade${canScore() ? '; conflitos = jogos que se sobrepõem no mesmo ginásio ou com a mesma atlética' : ''}.</p>`;
}
// aplica o ajuste em lote aos jogos selecionados (na ordem da tabela)
function applyBulk() {
  const T = ui.tb, b = T.bk, { rows } = tableRows();
  const sel = rows.filter(({ sp, m }) => T.sel.has(rowKey(sp, m)));
  if (!sel.length) return toast('Selecione ao menos um jogo.', true);
  const shift = Math.round(Number(b.shift) || 0), seq = !!b.time;
  if (!b.date && !b.place && !seq && !shift) return toast('Preencha algum campo para aplicar.', true);
  if (seq && !(b.date || sel.every(({ m }) => m.rec.date))) return toast('Para encadear horários, informe a data.', true);
  const bySport = new Map();
  let t = seq ? new Date(`${b.date || sel[0].m.rec.date}T${b.time}`).getTime() : null;
  if (seq && isNaN(t)) return toast('Horário inválido.', true);
  sel.forEach(({ sp, m }) => {
    const patch = {}, put = (f, v) => Object.assign(patch, patchMatch(sp, m.id, f, v));
    if (b.place) put('place', b.place);
    if (seq) { put('date', fmtDay(t)); put('time', fmtClock(t)); t += (minutesOf(sp) + Math.max(0, Number(b.gap) || 0)) * 60000; }
    else {
      if (b.date) put('date', b.date);
      if (shift) {
        const r = m.rec; if (!(b.date || r.date) || !r.time) return;   // sem horário não há o que deslocar
        const ts = new Date(`${b.date || r.date}T${r.time}`).getTime() + shift * 60000;
        put('date', fmtDay(ts)); put('time', fmtClock(ts));
      }
    }
    if (!bySport.has(sp.id)) bySport.set(sp.id, []);
    bySport.get(sp.id).push({ id: m.id, ...patch });
  });
  render(); toast(`${sel.length} jogo(s) ajustado(s).`);
  bySport.forEach((list, id) => db.saveMatches(id, list));
}

/* ----- Horários: grade vazia (horário × ginásio) em que se escolhe modalidade → categoria → jogo ----- */
const gymList = () => (S.config.gyms || []);
// limpa data, hora e local de uma lista de jogos [{sp,m}] (placares ficam)
async function clearSchedFor(items, what) {
  const list = items.filter(({ m }) => m.rec && (m.rec.date || m.rec.time || m.rec.place));
  if (!list.length) return toast('Nenhum jogo com horário ou local para limpar.', true);
  if (!(await askConfirm(`Limpar data, hora e local de ${list.length} jogo(s) ${what}?\n\nOs placares são mantidos.`))) return;
  const by = new Map();
  list.forEach(({ sp, m }) => { const p = patchMatch(sp, m.id, 'clearsched'); if (!by.has(sp.id)) by.set(sp.id, []); by.get(sp.id).push({ id: m.id, ...p }); });
  ui.pl.pick = null; render(); toast(`${list.length} jogo(s) limpo(s).`);
  by.forEach((l, id) => db.saveMatches(id, l));
}
const allItems = () => S.sports.flatMap(sp => { const R = resolve(sp); return R ? R.list.filter(m => !m.bye).map(m => ({ sp, m })) : []; });
const PX10 = 20;                        // altura de 10 minutos na grade
const pad2 = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
const clockOf = n => `${pad2(Math.floor(n / 60) % 24)}:${pad2(n % 60)}`;
function viewPlan() {
  const P = ui.pl, all = allItems();
  const days = [...new Set([...(S.config.days || []), ...P.extra, ...all.map(({ m }) => m.rec.date).filter(Boolean)])].sort();
  if (!days.includes(P.date)) P.date = days[0] || '';
  const day = all.filter(({ m }) => m.rec.date === P.date);
  const regs = gymList(), known = new Set(regs.map(normPlace));
  const dayAdd = `<div class="row"><input type="date" id="newDay" aria-label="Novo dia"><button class="btn sm" data-dayadd>+ Adicionar dia</button></div>`;
  const extra = [...new Set(day.map(({ m }) => (m.rec.place || '').trim()).filter(p => p && !known.has(normPlace(p))))];
  const cols = [...regs, ...extra];
  const gyms = isAdmin() ? `<div class="card noprint"><h2>Ginásios cadastrados</h2>
    <div class="row">${regs.map(g => `<span class="pill">${esc(g)} <button class="link" data-gymdel="${esc(g)}" title="Remover" aria-label="Remover ${esc(g)}">✕</button></span>`).join('') || '<span class="muted">Nenhum ainda.</span>'}</div>
    <div class="row"><input id="newGym" placeholder="Ex.: Ginásio 1" aria-label="Novo ginásio"><button class="btn sm" data-gymadd>Adicionar</button></div></div>` : '';
  if (!P.date) return `${gyms}<div class="card"><h2>Dias do evento</h2><p class="muted">Adicione o primeiro dia para montar a grade.</p>${dayAdd}</div>`;

  const spans = day.map(it => { const t = span(it.sp, it.m); return t ? { ...it, s: toMin(it.m.rec.time), e: toMin(it.m.rec.time) + Math.round((t.end - t.start) / 60000) } : null; }).filter(Boolean);
  const h0 = Math.floor(Math.min(toMin(P.start), ...spans.map(x => x.s)) / 60), h1 = Math.ceil(Math.max(toMin(P.end), ...spans.map(x => x.e)) / 60);
  const base = h0 * 60, H = (h1 - h0) * 6 * PX10, conf = findConflicts(all);
  const chips = `<div class="card noprint"><h2>Dias</h2><div class="chips daychips">${days.map(d => `<button class="${P.date === d ? 'on' : ''}" data-plday="${d}">${esc(new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }))}</button>`).join('')}</div>
    ${dayAdd}${(S.config.days || []).includes(P.date) && !day.length && isAdmin() ? `<div class="row"><button class="btn sm alt" data-daydel="${P.date}">Remover este dia (vazio)</button></div>` : ''}
    <div class="grid2"><label class="fld">Grade começa às<input type="time" data-pl="start" value="${esc(P.start)}"></label><label class="fld">Grade termina às<input type="time" data-pl="end" value="${esc(P.end)}"></label></div>
    <div class="row"><button class="btn sm" data-tbprint-pl>🖨 Imprimir esta grade</button>
      <button class="btn sm alt" data-clr="day">🧹 Limpar horários e local deste dia</button><button class="btn sm alt" data-clr="all">🧹 Limpar de todos os jogos</button></div></div>`;
  if (!cols.length) return `${gyms}${chips}<p class="empty">${isAdmin() ? 'Cadastre ao menos um ginásio acima para montar a grade.' : 'Peça ao administrador para cadastrar os ginásios.'}</p>`;

  const pickUI = k => {
    const names = [...new Set(S.sports.map(x => x.name))], cats = S.sports.filter(x => x.name === k.sport).map(x => x.category);
    const sp = S.sports.find(x => x.name === k.sport && x.category === k.cat), R = sp && resolve(sp);
    const games = R ? R.list.filter(m => !m.bye && !(m.rec.date && m.rec.time)).sort((a, b) => a.round - b.round || a.id.localeCompare(b.id, undefined, { numeric: true })) : [];
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
    return `<div class="pick"><b>${k.time}</b><select data-plp="sport" aria-label="Modalidade">${opt('', '1. Modalidade…', k.sport)}${names.map(n => opt(n, n, k.sport)).join('')}</select>
      ${k.sport ? `<select data-plp="cat" aria-label="Categoria">${opt('', '2. Masc. ou Fem.…', k.cat)}${cats.map(c => opt(c, CATS[c], k.cat)).join('')}</select>` : ''}
      ${sp ? (games.length ? `<select data-plp="game" aria-label="Jogo">${opt('', '3. Jogo…', '')}${games.map(m => opt(m.id, `${m.label}: ${tn(m.a) || 'A definir'} × ${tn(m.b) || 'A definir'}`, '')).join('')}</select>` : '<span class="muted">Sem jogos livres aqui.</span>') : ''}
      <button class="link" data-plx>cancelar</button></div>`;
  };
  // cartões: jogos que se sobrepõem no mesmo ginásio dividem a largura
  const colHtml = g => {
    const its = spans.filter(x => normPlace(x.m.rec.place) === normPlace(g)).sort((x, y) => x.s - y.s || x.e - y.e);
    const lanes = []; its.forEach(x => { let i = lanes.findIndex(end => end <= x.s); if (i < 0) i = lanes.length; lanes[i] = x.e; x.lane = i; });
    its.forEach(x => { x.n = its.filter(y => y.s < x.e && x.s < y.e).reduce((n, y) => Math.max(n, y.lane + 1), x.lane + 1); });
    const cards = its.map(x => { const { sp, m } = x, c = conf[sp.id + m.id], top = (x.s - base) / 10 * PX10, ht = (x.e - x.s) / 10 * PX10;
      return `<div class="gcard ${sp.category} ${c ? 'bad' : ''} ${m.live ? 'live' : ''}" data-gc ${ids(sp, m)} data-s="${x.s}" data-e="${x.e}" style="top:${top}px;height:${ht}px;left:${x.lane / x.n * 100}%;width:${100 / x.n}%">
        <i class="rz t" data-rz="t"></i><div class="gb"><b>${esc(sp.name)}</b> <span class="cat ${sp.category}">${catShort(sp.category)}</span> <small>${esc(m.label)}</small>
        <div class="gt">${esc(tn(m.a) || 'A definir')} × ${esc(tn(m.b) || 'A definir')}</div><small class="gh">${clockOf(x.s)}–${clockOf(x.e)} · ${x.e - x.s} min${c ? ' · ⚠ conflito' : ''}</small></div>
        <button class="link noprint" ${ids(sp, m)} data-plrm title="Tirar da grade" aria-label="Tirar da grade">✕</button><i class="rz b" data-rz="b"></i></div>`; }).join('');
    const k = P.pick, open = k && normPlace(k.gym) === normPlace(g);
    return `<div class="gcol" data-gcol="${esc(g)}" style="height:${H}px">${cards}${open ? `<div class="pickbox" style="top:${Math.min((toMin(k.time) - base) / 10 * PX10, H - 150)}px">${pickUI(k)}</div>` : ''}</div>`;
  };
  const hours = Array.from({ length: h1 - h0 }, (_, i) => `<div class="hr" style="height:${6 * PX10}px"><span>${pad2(h0 + i)}:00</span></div>`).join('');
  return `${gyms}${chips}
  <h1 class="printonly">JIAS 2026 — Horários<small>${esc(fmtDate(P.date))}</small></h1>
  <section class="card tbl"><h2>${esc(fmtDate(P.date))}</h2><div class="scroll"><div class="tgrid" style="--ncol:${cols.length};--h10:${PX10}px">
    <div class="tg-head"><div class="tg-corner"></div>${cols.map(g => `<div class="tg-gym">${esc(g)}</div>`).join('')}</div>
    <div class="tg-body"><div class="tg-axis">${hours}</div>${cols.map(colHtml).join('')}</div></div></div></section>
  <p class="muted noprint">Toque num espaço vazio para colocar um jogo (modalidade → Masc./Fem. → jogo). <b>Arraste a borda de baixo</b> do cartão para mudar a duração e a <b>borda de cima</b> para mudar o começo, de 10 em 10 minutos. Arraste o cartão para mover de horário ou de ginásio.</p>`;
}
/* arrastar cartões da grade: pointer events (mouse e toque), encaixe de 10 em 10 min */
(() => {
  let g = null;
  const snap = v => Math.round(v / PX10) * 10;
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('button,select,input,.pickbox')) return;
    const card = e.target.closest('.gcard'), col = e.target.closest('.gcol');
    if (card && canScore()) {
      const rz = e.target.closest('[data-rz]');
      g = { card, mode: rz ? rz.dataset.rz : 'm', y0: e.clientY, x0: e.clientX, s: +card.dataset.s, e: +card.dataset.e, moved: false, gcol: card.closest('.gcol'), id: card.dataset.m, sp: card.dataset.sp };
      g.ns = g.s; g.ne = g.e; g.gym = g.gcol.dataset.gcol;
      card.setPointerCapture(e.pointerId); e.preventDefault();
    } else if (col && canScore() && !card) {
      const r = col.getBoundingClientRect(), t = baseOf() + snap(e.clientY - r.top);
      ui.pl.pick = { time: clockOf(Math.max(0, t)), gym: col.dataset.gcol, sport: '', cat: '' }; render();
    }
  });
  const baseOf = () => document.querySelector('.tg-axis .hr span') ? toMin(document.querySelector('.tg-axis .hr span').textContent) : 0;
  document.addEventListener('pointermove', e => {
    if (!g) return;
    const dy = e.clientY - g.y0; if (Math.abs(dy) > 3 || Math.abs(e.clientX - g.x0) > 3) g.moved = true;
    if (!g.moved) return;
    const d = snap(dy);
    if (g.mode === 'b') { g.ns = g.s; g.ne = Math.max(g.s + 10, g.e + d); }
    else if (g.mode === 't') { g.ns = Math.min(g.e - 10, g.s + d); g.ne = g.e; }
    else {
      g.ns = Math.max(0, g.s + d); g.ne = g.ns + (g.e - g.s);
      const el = document.elementFromPoint(e.clientX, e.clientY), col = el && el.closest && el.closest('.gcol');
      if (col) g.gym = col.dataset.gcol;
    }
    const base = baseOf();
    g.card.style.top = (g.ns - base) / 10 * PX10 + 'px'; g.card.style.height = (g.ne - g.ns) / 10 * PX10 + 'px';
    g.card.classList.add('drag');
    const gh = g.card.querySelector('.gh'); if (gh) gh.textContent = `${clockOf(g.ns)}–${clockOf(g.ne)} · ${g.ne - g.ns} min`;
  });
  const end = () => {
    if (!g) return; const x = g; g = null; x.card.classList.remove('drag');
    if (!x.moved) return;
    const sp = getSport(x.sp); if (!sp) return render();
    const patch = {}, put = (f, v) => Object.assign(patch, patchMatch(sp, x.id, f, v));
    if (x.ns !== x.s) put('time', clockOf(x.ns));
    put('dur', x.ne - x.ns === minutesOf(sp) ? null : x.ne - x.ns);
    if (normPlace(x.gym) !== normPlace(x.gcol.dataset.gcol) || x.mode === 'm') put('place', x.gym);
    render(); db.saveMatches(x.sp, [{ id: x.id, ...patch }]);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => { if (g) { g = null; render(); } });
})();
function placeGame(spName, cat, mid, date, time, gym) {
  const sp = S.sports.find(x => x.name === spName && x.category === cat); if (!sp) return;
  const patch = {}; [['date', date], ['time', time], ['place', gym]].forEach(([f, v]) => Object.assign(patch, patchMatch(sp, mid, f, v)));
  ui.pl.pick = null; render(); db.saveMatches(sp.id, [{ id: mid, ...patch }]);
  const c = findConflicts(S.sports.flatMap(x => { const R = resolve(x); return R ? R.list.filter(m => !m.bye).map(m => ({ sp: x, m })) : []; }))[sp.id + mid];
  toast(c ? `Atenção: conflito (${[...c].join(', ')})` : 'Jogo colocado na grade.', !!c);
}

/* ----- Ranking / Ajustes ----- */
function viewRank() {
  const T = totals(ui.rcat), SP = S.sports.filter(s => !ui.rcat || s.category === ui.rcat);
  const chips = [['', 'Geral'], ['masculino', 'Masculino'], ['feminino', 'Feminino']]
    .map(([v, l]) => `<button class="${ui.rcat === v ? 'on' : ''}" data-rcat="${v}">${l}</button>`).join('');
  return `<div class="chips">${chips}</div><div class="card"><h2>Classificação ${ui.rcat ? CATS[ui.rcat].toLowerCase() : 'geral'}</h2><div class="scroll"><table class="rank"><thead><tr><th>#</th><th>Atlética</th>${SP.map(s => `<th class="n">${esc(s.name)}${ui.rcat ? '' : ` <small>${catShort(s.category)}</small>`}</th>`).join('')}
    ${T.some(t => t.wo) ? '<th class="n">WO</th>' : ''}<th class="n">Total</th></tr></thead><tbody>
    ${T.map((t, k) => `<tr class="${k === 0 && t.total > 0 ? 'first' : ''}"><td class="pos">${k + 1}</td><td>${teamTag(t.id)}</td>
      ${t.sports.map(p => `<td class="n">${p == null ? '<span class="muted">–</span>' : p}</td>`).join('')}
      ${T.some(x => x.wo) ? `<td class="n">${t.wo ? `<span class="neg">−${fmt(t.woPts)}</span> <small>(${t.wo} WO)</small>` : '<span class="muted">–</span>'}</td>` : ''}
      <td class="n"><b>${fmt(t.total)}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="muted">Total = pontos por colocação nas chaves inscritas (M = masculino, F = feminino), menos ${S.config.woPenalty} ponto(s) por cada WO dado. "–" = não inscrita.</p></div>`;
}
function sportsCfg() {
  const names = [...new Set(S.sports.map(s => s.name))];
  const cb = (n, c, on, label) => `<label class="chk"><input type="checkbox" data-cat="${c}" data-sname="${esc(n)}" ${on ? 'checked' : ''}> ${label}</label>`;
  const rows = names.map(n => `<div class="li sportrow"><input data-sportname="${esc(n)}" value="${esc(n)}" aria-label="Nome da modalidade">
    ${['masculino', 'feminino'].map(c => cb(n, c, S.sports.some(s => s.name === n && s.category === c), CATS[c])).join('')}
    <label class="mini">Duração média <input type="number" min="5" max="480" step="5" data-minutes="${esc(n)}" value="${minutesOf(S.sports.find(s => s.name === n))}"> min</label>
    <button class="btn sm danger" data-del-sport="${esc(n)}">Remover</button></div>`).join('');
  return `<div class="list">${rows}</div>
    <div class="li sportrow" style="margin-top:14px"><input id="newSport" placeholder="Nova modalidade">
      <label class="chk"><input type="checkbox" id="newM" checked> Masculino</label><label class="chk"><input type="checkbox" id="newF" checked> Feminino</label>
      <button class="btn" data-add-sport>Adicionar</button></div>`;
}
function viewCfg() {
  const lab = ['1º lugar', '2º lugar', '3º lugar', '4º lugar', 'Demais participantes'], c = S.config;
  const list = (items, attr, del, add, ph) => `<div class="list">${items.map(i => `<div class="li"><input data-${attr}="${i.id}" value="${esc(i.name)}"><button class="btn sm danger" data-${del}="${i.id}">Remover</button></div>`).join('')}</div>
    <div class="li" style="margin-top:12px"><input id="${add}" placeholder="${ph}"><button class="btn" data-${add === 'newTeam' ? 'add-team' : 'add-sport'}>Adicionar</button></div>`;
  return `<div class="card"><h2>Atléticas</h2>${list(S.teams, 'team', 'del-team', 'newTeam', 'Nova atlética')}</div>
  <div class="card"><h2>Modalidades</h2><p class="muted" style="margin-top:-4px">Cada categoria marcada tem o seu próprio chaveamento, inscrições e placares.</p>${sportsCfg()}</div>
  <div class="card"><h2>Pontuação por colocação</h2><div class="grid2">
    ${lab.map((l, i) => `<label class="fld">${l}<input type="number" min="0" data-pts="${i}" value="${c.pts[i]}"></label>`).join('')}
</div>
    <p class="muted">Sem disputa de 3º lugar, os dois semifinalistas derrotados recebem a pontuação de 3º.</p>
    <h2 style="margin-top:14px">Pontos corridos</h2><div class="grid2">
    <label class="fld">Vitória<input type="number" min="0" data-rr="win" value="${c.win}"></label>
    <label class="fld">Empate<input type="number" min="0" data-rr="draw" value="${c.draw}"></label>
    <label class="fld">Derrota<input type="number" min="0" data-rr="loss" value="${c.loss}"></label></div></div>
  <div class="card"><h2>WO (não comparecimento)</h2><div class="grid2">
    <label class="fld">Pontos perdidos por WO<input type="number" min="0" data-wocfg="woPenalty" value="${c.woPenalty}"></label>
    <label class="fld">Placar do WO (do vencedor)<input type="number" min="1" data-wocfg="woGoals" value="${c.woGoals}"></label></div>
    <p class="muted">Quem falta perde o jogo (0 x ${c.woGoals}; no vôlei o adversário leva todos os sets) e perde esses pontos na classificação geral, a cada WO.</p></div>
  <div class="card"><h2>Backup</h2><button class="btn alt" data-export>Exportar JSON</button></div>`;
}

/* ---------- ações ---------- */
function setMatch(spId, mid, field, val) {
  const sp = getSport(spId); if (!sp) return;
  const patch = patchMatch(sp, mid, field, val);
  if (patch && patch._error) { toast(patch._error, true); return; }
  if (patch) db.saveMatch(spId, mid, patch);
}
const mkSport = (name, category) => ({
  id: newId('s'), name, category, pos: S.sports.length ? Math.max(...S.sports.map(x => x.pos)) + 1 : 0,
  enrolled: [], format: 'knockout', third: true, double: false, bracket: null,
});
function removeTeam(id) {
  const touched = [];
  S.teams = S.teams.filter(t => t.id !== id);
  S.sports.forEach(sp => {
    const inBr = sp.bracket && sp.bracket.teams.includes(id), inEn = sp.enrolled.includes(id);
    if (!inBr && !inEn) return;
    sp.enrolled = sp.enrolled.filter(x => x !== id);
    if (inBr) sp.bracket = null;
    touched.push([sp, inBr]);
  });
  return (async () => {
    for (const [sp, inBr] of touched) { if (inBr) await db.dropBracket(sp.id); await db.saveSport(sp); }
    await db.deleteTeam(id);
  })();
}

document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset, sp = getSport(ui.sport);
  if (d.tab) ui.tab = d.tab;
  else if (d.sport) ui.sport = d.sport;
  else if (d.sname !== undefined) { const nx = S.sports.find(s => s.name === d.sname && s.category === sp.category) || S.sports.find(s => s.name === d.sname); if (nx) ui.sport = nx.id; }
  else if (d.rcat !== undefined) ui.rcat = d.rcat;
  else if (d.tby !== undefined) ui.tb.by = d.tby;
  else if (d.tbsport !== undefined) ui.tb.sport = d.tbsport;
  else if (d.tbcat !== undefined) ui.tb.cat = d.tbcat;
  else if (d.clr !== undefined) {
    const all = allItems();
    if (d.clr === 'day') await clearSchedFor(all.filter(({ m }) => m.rec.date === ui.pl.date), 'de ' + fmtDate(ui.pl.date));
    else if (d.clr === 'all') await clearSchedFor(all, 'de todas as modalidades');
    else await clearSchedFor(tableRows().rows.filter(({ sp, m }) => ui.tb.sel.has(rowKey(sp, m))), 'selecionados');
    return;
  }
  else if (d.plday !== undefined) { ui.pl.date = d.plday; ui.pl.pick = null; }
  else if (d.dayadd !== undefined) {
    const v = $('newDay').value; if (!v) return toast('Escolha a data.', true);
    if (isAdmin()) { S.config.days = [...new Set([...(S.config.days || []), v])]; db.saveConfig(); } else ui.pl.extra.add(v);
    ui.pl.date = v; ui.pl.pick = null;
  }
  else if (d.daydel !== undefined) { S.config.days = (S.config.days || []).filter(x => x !== d.daydel); ui.pl.date = ''; db.saveConfig(); }
  else if (d.plgo !== undefined) ui.pl.pick = { time: d.pt, gym: d.pg, sport: '', cat: '' };
  else if (d.plx !== undefined) ui.pl.pick = null;
  else if (d.plrm !== undefined) setMatch(d.sp, d.m, 'clearsched');
  else if (d.tbprintPl !== undefined) { ui.pl.pick = null; render(); setTimeout(() => print(), 50); return; }
  else if (d.gymadd !== undefined) {
    const n = $('newGym').value.trim().replace(/\s+/g, ' '); if (!n) return;
    if (gymList().some(g => normPlace(g) === normPlace(n))) return toast('Esse ginásio já existe.', true);
    S.config.gyms = [...gymList(), n]; db.saveConfig();
  }
  else if (d.gymdel !== undefined) {
    if (!(await askConfirm(`Remover o ginásio "${d.gymdel}" da lista? Jogos já marcados nele continuam com esse local.`))) return;
    S.config.gyms = gymList().filter(g => g !== d.gymdel); db.saveConfig();
  }
  else if (d.tbedit !== undefined) ui.tb.edit = !ui.tb.edit;
  else if (d.tbprint !== undefined) { ui.tb.edit = false; render(); setTimeout(() => print(), 50); return; }
  else if (d.tbbk !== undefined) {
    if (d.tbbk === 'apply') { applyBulk(); return; }
    if (d.tbbk === 'none') ui.tb.sel.clear();
    else tableRows().rows.forEach(({ sp, m }) => ui.tb.sel.add(rowKey(sp, m)));
  }
  else if (d.login !== undefined) { $('login').showModal(); return; }
  else if (d.logout !== undefined) { await db.signOut(); return; }
  else if (d.bump) {
    const R = resolve(getSport(d.sp)), m = R.byId[d.m];
    setMatch(d.sp, d.m, 's' + d.bump, Math.max(0, (m['s' + d.bump] ?? 0) + Number(d.delta)));
  }
  else if (d.pt) setMatch(d.sp, d.m, 'pt', { side: d.pt, delta: Number(d.d) });
  else if (d.closeset !== undefined) setMatch(d.sp, d.m, 'closeset');
  else if (d.undoset !== undefined) setMatch(d.sp, d.m, 'undoset');
  else if (d.status) setMatch(d.sp, d.m, 'status', d.status);
  else if (d.tb) setMatch(d.sp, d.m, 'tb', d.tb);
  else if (d.gen) {
    const had = !!sp.bracket;
    if (had && !(await askConfirm('Sortear de novo?\n\n• Os placares desta chave serão apagados.\n• Datas, horários e locais dos jogos são mantidos.'))) return;
    const br = makeBracket(sp, d.gen); if (!br) return toast('Inscreva pelo menos 2 atléticas.', true);
    if (had) {   // a grade de horários pertence ao jogo (Semifinal 1, Final…), não às atléticas: continua valendo
      const ids = new Set(br.defs.map(x => x.id));
      Object.entries(sp.bracket.m).forEach(([id, r]) => { if (ids.has(id)) br.m[id] = { date: r.date || '', time: r.time || '', place: r.place || '' }; });
    }
    sp.bracket = br; render(); toast(had ? 'Sorteio refeito.' : 'Sorteio realizado.'); db.saveBracket(sp, { keepSchedule: had }); return;
  }
  else if (d.clear !== undefined) {
    if (!(await askConfirm('Limpar todos os placares desta modalidade? (os horários são mantidos)'))) return;
    clearScoreFields(sp.bracket); render(); db.clearScores(sp.id); return;
  }
  else if (d.clearschedAll !== undefined) {
    if (!(await askConfirm('Apagar data, hora e local de todos os jogos desta chave? (os placares são mantidos)'))) return;
    clearScheduleFields(sp.bracket); render(); db.clearSchedule(sp.id); return;
  }
  else if (d.drop !== undefined) {
    if (!(await askConfirm(`Apagar o chaveamento de ${sportLabel(sp)}?\n\nTodos os jogos, placares e horários desta chave serão apagados. As atléticas inscritas continuam; é só sortear de novo.`))) return;
    sp.bracket = null; render(); db.dropBracket(sp.id); return;
  }
  else if (d.wo !== undefined) {
    const other = (() => { const R = resolve(getSport(d.sp)); const m = R && R.byId[d.m]; return m ? (m.a === d.wo ? m.b : m.a) : null; })();
    if (!(await askConfirm(`Registrar WO de ${tn(d.wo)}?\n\n${tn(other)} vence por WO e ${tn(d.wo)} perde ${S.config.woPenalty} ponto(s) na classificação geral.`))) return;
    setMatch(d.sp, d.m, 'wo', d.wo);
  }
  else if (d.seqgo !== undefined) {
    const q = ui.seq, plan = planSequence(sp, { date: q.date, time: q.time, place: q.place, gap: q.gap, overwrite: q.over });
    if (!plan.length) return toast('Informe data e hora do primeiro jogo.', true);
    if (!(await askConfirm(`Agendar ${plan.length} jogo(s) de ${sportLabel(sp)}, do primeiro às ${plan[0].time} até ${fmtClock(plan[plan.length - 1].end)}?`))) return;
    const bulk = plan.map(p => { const patch = {}; ['date', 'time', 'place'].forEach(f => Object.assign(patch, patchMatch(sp, p.id, f, p[f]))); return { id: p.id, ...patch }; });
    render(); toast(`${plan.length} jogo(s) agendado(s).`); db.saveMatches(sp.id, bulk); return;
  }
  else if (d.resetm !== undefined) {
    if (!(await askConfirm('Apagar o placar deste jogo? (data, hora e local são mantidos)'))) return;
    setMatch(d.sp, d.m, 'reset');
  }
  else if (d.clearsched !== undefined) setMatch(d.sp, d.m, 'clearsched');
  else if (d.enrollAll !== undefined) { sp.enrolled = d.enrollAll === '1' ? S.teams.map(x => x.id) : []; db.saveSport(sp); }
  else if (d.addTeam !== undefined) {
    const n = $('newTeam').value.trim(); if (!n) return;
    const tm = { id: newId('t'), name: n, pos: S.teams.length ? Math.max(...S.teams.map(x => x.pos)) + 1 : 0 };
    S.teams.push(tm); db.saveTeam(tm);
  }
  else if (d.delTeam) {
    if (!(await askConfirm(`Remover "${tn(d.delTeam)}"? Ela sai das inscrições e os chaveamentos em que participa serão apagados.`))) return;
    const p = removeTeam(d.delTeam); render(); await p; return;
  }
  else if (d.addSport !== undefined) {
    const n = $('newSport').value.trim(), cats = [['newM', 'masculino'], ['newF', 'feminino']].filter(([id]) => $(id).checked).map(x => x[1]);
    if (!n) return;
    if (!cats.length) return toast('Marque ao menos uma categoria.', true);
    if (S.sports.some(s => s.name.toLowerCase() === n.toLowerCase())) return toast('Essa modalidade já existe.', true);
    cats.forEach(c => { const s = mkSport(n, c); S.sports.push(s); ui.sport = s.id; db.saveSport(s); });
  }
  else if (d.delSport) {
    const rows = S.sports.filter(x => x.name === d.delSport);
    if (!(await askConfirm(`Remover "${d.delSport}" (${rows.length} categoria${rows.length > 1 ? 's' : ''}) com inscrições, chaveamentos e placares?`))) return;
    S.sports = S.sports.filter(x => x.name !== d.delSport); rows.forEach(r => db.deleteSport(r.id));
  }
  else if (d.export !== undefined) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = 'jias2026-dados.json'; a.click(); return;
  }
  else return;
  render();
});

document.addEventListener('change', async e => {
  const el = e.target, d = el.dataset, sp = getSport(ui.sport);
  if (d.mf) { if (/^(date|time|place)$/.test(d.mf)) ui.openSched.add(`${d.sp}|${d.m}`); setMatch(d.sp, d.m, d.mf, el.value); }
  else if (d.enroll) {
    sp.enrolled = el.checked ? [...new Set([...sp.enrolled, d.enroll])] : sp.enrolled.filter(x => x !== d.enroll);
    db.saveSport(sp);
  }
  else if (d.fmt !== undefined) { sp.format = el.value; db.saveSport(sp); }
  else if (d.minutes !== undefined) {   // duração média: vale para todas as categorias da modalidade
    const v = Math.min(480, Math.max(5, Math.round(Number(el.value) || 40)));
    S.sports.filter(s => s.name === d.minutes).forEach(s => { s.minutes = v; db.saveSport(s); });
  }
  else if (d.wocfg !== undefined) { S.config[d.wocfg] = Math.max(d.wocfg === 'woGoals' ? 1 : 0, Math.floor(Number(el.value) || 0)); db.saveConfig(); }
  else if (d.seq !== undefined) ui.seq[d.seq] = d.seq === 'over' ? el.checked : d.seq === 'gap' ? Math.max(0, Number(el.value) || 0) : el.value;
  else if (d.tbdate !== undefined) ui.tb.date = el.value;
  else if (d.pl !== undefined) { ui.pl[d.pl] = el.value; ui.pl.pick = null; }
  else if (d.plp !== undefined) {
    const k = ui.pl.pick; if (!k) return;
    if (d.plp === 'sport') { k.sport = el.value; k.cat = (S.sports.filter(x => x.name === k.sport).length === 1) ? S.sports.find(x => x.name === k.sport).category : ''; }
    else if (d.plp === 'cat') k.cat = el.value;
    else if (d.plp === 'game') { if (el.value) { placeGame(k.sport, k.cat, el.value, ui.pl.date, k.time, k.gym); return; } }
  }
  else if (d.bk !== undefined) { ui.tb.bk[d.bk] = el.value; return; }
  else if (d.tbsel !== undefined) { el.checked ? ui.tb.sel.add(d.tbsel) : ui.tb.sel.delete(d.tbsel); }
  else if (d.tbselgrp !== undefined) {
    const grp = tableRows().rows.filter(({ sp, m }) => (ui.tb.by === 'gym' ? (normPlace(m.rec.place) || '~') : sp.id) === d.tbselgrp);
    grp.forEach(({ sp, m }) => el.checked ? ui.tb.sel.add(rowKey(sp, m)) : ui.tb.sel.delete(rowKey(sp, m)));
  }
  else if (d.scoring !== undefined) { sp.scoring = el.value; db.saveSport(sp); }
  else if (d.bestof !== undefined) { sp.best_of = Number(el.value) === 5 ? 5 : 3; db.saveSport(sp); }
  else if (d.third !== undefined) {
    sp.third = el.checked; db.saveSport(sp);
    if (sp.bracket && setThird(sp, sp.third)) {
      db.saveBracketStructure(sp, sp.third ? [] : ['T']);
      toast(sp.third ? 'Disputa de 3º lugar adicionada (sem sortear de novo).' : 'Disputa de 3º lugar removida (sem sortear de novo).');
    }
  }
  else if (d.double !== undefined) { sp.double = el.checked; db.saveSport(sp); }
  else if (d.seed !== undefined) {
    const br = sp.bracket, i = Number(d.seed), v = el.value, j = br.teams.indexOf(v);
    if (j >= 0) br.teams[j] = br.teams[i];
    br.teams[i] = v;
    const nb = buildKO(br.teams, br.third); nb.m = br.m; clearScoreFields(nb);
    Object.assign(nb, { format: br.format, third: br.third, double: br.double }); sp.bracket = nb;
    db.saveBracket(sp, { keepSchedule: true });
  }
  else if (d.agf) ui.ag[d.agf] = el.value;
  else if (d.team !== undefined) { const t = getTeam(d.team); t.name = el.value.trim() || t.name; db.saveTeam(t); }
  else if (d.sportname !== undefined) {
    const nn = el.value.trim(), old = d.sportname;
    if (nn && nn !== old) {
      if (S.sports.some(s => s.name.toLowerCase() === nn.toLowerCase() && s.name !== old)) toast('Já existe uma modalidade com esse nome.', true);
      else S.sports.filter(s => s.name === old).forEach(s => { s.name = nn; db.saveSport(s); });
    }
  }
  else if (d.cat) {
    const n = d.sname, has = S.sports.find(s => s.name === n && s.category === d.cat), same = S.sports.filter(s => s.name === n);
    if (el.checked && !has) { const s = mkSport(n, d.cat); S.sports.push(s); db.saveSport(s); }
    else if (!el.checked && has) {
      if (same.length < 2) toast('Mantenha ao menos uma categoria (ou use Remover para apagar a modalidade).', true);
      else if (!(has.bracket || has.enrolled.length) || (await askConfirm(`Remover a categoria ${CATS[d.cat].toLowerCase()} de ${n}? Inscrições, chaveamento e placares dela serão apagados.`))) {
        S.sports = S.sports.filter(s => s.id !== has.id); db.deleteSport(has.id);
        if (ui.sport === has.id) ui.sport = same.find(s => s.id !== has.id).id;
      }
    }
  }
  else if (d.pts !== undefined) { S.config.pts[d.pts] = Number(el.value) || 0; db.saveConfig(); }
  else if (d.rr !== undefined) { S.config[d.rr] = Number(el.value) || 0; db.saveConfig(); }
  else return;
  setTimeout(render, 0); // espera o foco mudar (Tab) para restaurá-lo no campo certo
});

document.addEventListener('toggle', e => {
  const sk = e.target.dataset && e.target.dataset.sk; if (!sk) return;
  if (e.target.open) ui.openSched.add(sk); else ui.openSched.delete(sk);
}, true);

/* ---------- login ---------- */
$('login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target), msg = $('loginMsg');
  msg.textContent = 'Entrando…';
  try { await db.signIn(f.get('email'), f.get('password')); msg.textContent = ''; $('login').close(); e.target.reset(); }
  catch (err) { msg.textContent = 'E-mail ou senha inválidos.'; }
});
$('loginCancel').addEventListener('click', () => $('login').close());

/* ---------- início ---------- */
(async function start() {
  render();
  if (!db.configured) {
    $('view').innerHTML = '<div class="warn"><b>Falta configurar o Supabase.</b> Preencha a URL e a anon key em <code>public/config.js</code> e rode <code>scripts/setup.sh</code>.</div>';
    return;
  }
  await db.initAuth(() => render());
  try { await db.loadAll(); } catch (e) { toast('Falha ao carregar: ' + (e.message || e), true); }
  ui.ready = true; render();
  db.subscribe(refresh);
})();
