/* JIAS 2026 — regras puras (sem rede, sem DOM).
   O estado `S` é preenchido por db.js a partir do Supabase.
   S = { teams:[{id,name,pos}], sports:[{id,name,category,minutes,pos,enrolled,format,third,double,bracket}], config }
   bracket = { format, third, double, teams:[ids em ordem de seed], defs:[jogos], finalId, rounds, hasThird,
               m:{ [matchId]: {date,time,place,status,sa,sb,pa,pb,tb,wo} } } */

// woPenalty: pontos que a atlética perde na classificação geral por cada WO | woGoals: placar do vencedor num WO (a atlética faltosa fica com 0)
export const defaultConfig = () => ({ pts: [8, 5, 3, 0, 0], win: 3, draw: 1, loss: 0, woPenalty: 2, woGoals: 1 });
export const S = { teams: [], sports: [], config: defaultConfig() };

export const CATS = { masculino: 'Masculino', feminino: 'Feminino' };
export const sportLabel = sp => `${sp.name} · ${CATS[sp.category] || ''}`;
export const catShort = c => (c === 'feminino' ? 'F' : 'M');

export const newId = p => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
export const getTeam = id => S.teams.find(t => t.id === id);
export const tn = id => (id == null ? null : (getTeam(id) ? getTeam(id).name : '?'));
export const getSport = id => S.sports.find(s => s.id === id);
export const fmt = n => Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',');
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- geração de chaveamentos ---------- */
export function seedOrder(P) {
  let o = [1];
  while (o.length < P) { const n = o.length * 2; o = o.flatMap(x => [x, n + 1 - x]); }
  return o;
}
const ROUND_PLURAL = ['Final', 'Semifinais', 'Quartas de final', 'Oitavas de final', '16 avos de final'];
const ROUND_SINGULAR = ['Final', 'Semifinal', 'Quartas de final', 'Oitavas de final', '16 avos de final'];

export function buildKO(order, third) {
  const N = order.length; let P = 1; while (P < N) P *= 2;
  const R = Math.log2(P), so = seedOrder(P), defs = [];
  const seedSpec = s => s <= N ? { t: order[s - 1] } : { bye: 1 };
  for (let r = 1; r <= R; r++) {
    const cnt = P / 2 ** r, k = R - r;
    for (let i = 0; i < cnt; i++) {
      const plural = ROUND_PLURAL[k] || `Fase ${r}`, single = ROUND_SINGULAR[k] || `Fase ${r}`;
      defs.push({
        id: `K${r}_${i}`, round: r, rname: plural, label: cnt > 1 ? `${single} ${i + 1}` : single,
        a: r === 1 ? seedSpec(so[2 * i]) : { w: `K${r - 1}_${2 * i}` },
        b: r === 1 ? seedSpec(so[2 * i + 1]) : { w: `K${r - 1}_${2 * i + 1}` },
      });
    }
  }
  const hasThird = !!third && N >= 4;
  if (hasThird) defs.push({ id: 'T', round: R, rname: 'Final', label: 'Disputa de 3º lugar', third: true, a: { l: `K${R - 1}_0` }, b: { l: `K${R - 1}_1` } });
  return { teams: order, defs, m: {}, finalId: `K${R}_0`, rounds: R, hasThird };
}
export function buildRR(order, double) {
  const t = [...order]; if (t.length % 2) t.push(null);
  const n = t.length, rounds = n - 1, defs = [];
  let arr = [...t];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a != null && b != null) defs.push({ id: `J${r + 1}_${i}`, round: r + 1, rname: `Rodada ${r + 1}`, label: `Rodada ${r + 1}`, a: { t: a }, b: { t: b } });
    }
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  if (double) {
    [...defs].forEach(d => {
      const rr = d.round + rounds;
      defs.push({ id: `J${rr}_${d.id.split('_')[1]}`, round: rr, rname: `Rodada ${rr}`, label: `Rodada ${rr}`, a: d.b, b: d.a });
    });
  }
  return { teams: order, defs, m: {} };
}
// devolve o novo chaveamento (ou null se faltar time). Não grava nada.
// assinatura dos confrontos da 1ª fase: serve para saber se dois sorteios são "o mesmo"
export const bracketSig = br => br.defs.filter(d => d.round === 1).map(d => [d.a.t ?? 'folga', d.b.t ?? 'folga'].sort().join('~')).sort().join('|');
export function makeBracket(sp, mode) {
  const ids = S.teams.map(t => t.id).filter(id => sp.enrolled.includes(id));
  if (ids.length < 2) return null;
  const build = order => Object.assign(sp.format === 'rr' ? buildRR(order, sp.double) : buildKO(order, sp.third),
    { format: sp.format, third: !!sp.third, double: !!sp.double });
  let br = build(mode === 'random' ? shuffle(ids) : ids);
  // sortear de novo tem que mudar alguma coisa (com poucas atléticas o acaso repete fácil)
  if (mode === 'random' && sp.bracket) {
    const old = bracketSig(sp.bracket);
    for (let i = 0; i < 60 && bracketSig(br) === old; i++) br = build(shuffle(ids));
  }
  return br;
}
// liga/desliga a disputa de 3º lugar NO LUGAR, sem sortear de novo (placares e horários dos outros jogos ficam).
// Devolve true se mexeu no chaveamento.
export function setThird(sp, on) {
  const br = sp.bracket; if (!br || br.format !== 'knockout') return false;
  br.third = !!on;
  const has = br.defs.some(d => d.id === 'T');
  if (on && !has && br.teams.length >= 4) {
    br.defs.push({ id: 'T', round: br.rounds, rname: 'Final', label: 'Disputa de 3º lugar', third: true, a: { l: `K${br.rounds - 1}_0` }, b: { l: `K${br.rounds - 1}_1` } });
    br.hasThird = true;
  } else if (!on && has) {
    br.defs = br.defs.filter(d => d.id !== 'T'); delete br.m.T; br.hasThird = false;
  } else return false;
  return true;
}
export function isStale(sp) {
  const br = sp.bracket; if (!br) return false;
  const a = [...sp.enrolled].sort().join(), b = [...br.teams].sort().join();
  return a !== b || br.format !== sp.format || (sp.format === 'knockout' && br.third !== !!sp.third) || (sp.format === 'rr' && br.double !== !!sp.double);
}

/* ---------- resolução dos jogos ---------- */
export const wonOf = sets => sets.reduce((acc, s) => { if (s.done) { if (s.a > s.b) acc.a++; else if (s.b > s.a) acc.b++; } return acc; }, { a: 0, b: 0 });
// status do registro: undefined (agendado) | 'live' (ao vivo, só exibe) | 'final' (encerrado, vale para avanço e pontos)
export function resolve(sp) {
  const br = sp.bracket; if (!br) return null;
  const ko = br.format === 'knockout', list = [], byId = {};
  const side = spec => {
    if (spec.t !== undefined) return { team: spec.t };
    if (spec.bye) return { bye: true };
    const src = byId[spec.w || spec.l];
    return { team: spec.w ? src.w : src.l };
  };
  br.defs.forEach(def => {
    const rec = br.m[def.id] || {};
    const A = side(def.a), B = side(def.b);
    const m = { ...def, sp: sp.id, rec, a: A.team ?? null, b: B.team ?? null, bye: !!(A.bye || B.bye), sa: null, sb: null, w: null, l: null, live: false, done: false, tie: false, wo: null };
    if (m.bye) {
      m.w = A.bye ? m.b : m.a; m.fin = m.w != null;
    } else {
      const ok = m.a != null && m.b != null && rec.pa === m.a && rec.pb === m.b;
      const bo = sp.best_of || 3;
      m.sets = null; m.cur = null; m.need = Math.ceil(bo / 2);
      if (sp.scoring === 'sets') {
        // vôlei etc.: o "placar" do jogo é o número de sets ganhos; os pontos de cada set ficam em m.sets
        const list = ok && Array.isArray(rec.sets) ? rec.sets : [];
        const won = wonOf(list);
        m.sets = list;
        if (ok && (rec.status === 'live' || rec.status === 'final')) { m.sa = won.a; m.sb = won.b; }
        const last = list[list.length - 1];
        m.cur = last && !last.done ? last : null;
        m.tot = { a: list.reduce((n, s) => n + s.a, 0), b: list.reduce((n, s) => n + s.b, 0) };
      } else {
        if (ok) { m.sa = rec.sa ?? null; m.sb = rec.sb ?? null; }
        m.tot = { a: m.sa, b: m.sb };
      }
      // WO: quem faltou fica com 0 e o adversário vence com o placar de WO (ou todos os sets, no vôlei)
      if (ok && rec.wo && (rec.wo === m.a || rec.wo === m.b)) {
        m.wo = rec.wo;
        const loserA = rec.wo === m.a, g = Math.max(1, Math.floor(S.config.woGoals ?? 1));
        if (sp.scoring === 'sets') {
          m.sets = Array.from({ length: m.need }, () => ({ a: loserA ? 0 : 25, b: loserA ? 25 : 0, done: true }));
          m.cur = null; m.sa = loserA ? 0 : m.need; m.sb = loserA ? m.need : 0;
          m.tot = { a: m.sets.reduce((n, s) => n + s.a, 0), b: m.sets.reduce((n, s) => n + s.b, 0) };
        } else { m.sa = loserA ? 0 : g; m.sb = loserA ? g : 0; m.tot = { a: m.sa, b: m.sb }; }
      }
      m.live = ok && rec.status === 'live';
      m.done = ok && rec.status === 'final' && m.sa != null && m.sb != null;
      if (m.done) {
        if (m.sa !== m.sb) m.w = m.sa > m.sb ? m.a : m.b;
        else if (ko && (rec.tb === m.a || rec.tb === m.b)) m.w = rec.tb;
        if (m.w != null) m.l = m.w === m.a ? m.b : m.a;
      }
      m.tie = m.done && m.sa === m.sb && m.sets === null;
      m.fin = ko ? m.w != null : m.done;
    }
    byId[m.id] = m; list.push(m);
  });
  return { list, byId };
}

export function standings(sp, R) {
  const c = S.config, T = {};
  sp.bracket.teams.forEach(id => T[id] = { id, P: 0, J: 0, V: 0, E: 0, D: 0, GP: 0, GC: 0 });
  R.list.forEach(m => {
    if (!m.done) return;
    const a = T[m.a], b = T[m.b];
    a.J++; b.J++; a.GP += m.sa; a.GC += m.sb; b.GP += m.sb; b.GC += m.sa;
    if (m.sa > m.sb) { a.V++; b.D++; a.P += c.win; b.P += c.loss; }
    else if (m.sa < m.sb) { b.V++; a.D++; b.P += c.win; a.P += c.loss; }
    else { a.E++; b.E++; a.P += c.draw; b.P += c.draw; }
  });
  return Object.values(T).map(r => ({ ...r, SG: r.GP - r.GC }))
    .sort((x, y) => y.P - x.P || y.V - x.V || y.SG - x.SG || y.GP - x.GP || String(tn(x.id)).localeCompare(String(tn(y.id))));
}

// colocação (0 = campeão ... 3 = 4º, 4 = demais) — só o que já está decidido
export function placements(sp) {
  const R = resolve(sp), p = {};
  if (!R) return { p, complete: false };
  const br = sp.bracket;
  if (br.format === 'rr') {
    const rows = standings(sp, R), complete = R.list.length > 0 && R.list.every(m => m.done);
    if (complete) rows.forEach((r, i) => p[r.id] = Math.min(i, 4));
    return { p, complete, rows };
  }
  const F = R.byId[br.finalId], T = R.byId.T;
  if (F.w != null) { p[F.w] = 0; p[F.l] = 1; }
  if (T) { if (T.w != null) { p[T.w] = 2; p[T.l] = 3; } }
  else if (br.rounds >= 2) R.list.filter(m => m.round === br.rounds - 1 && !m.bye && m.l != null).forEach(m => p[m.l] = 2);
  const complete = F.w != null && (!T || T.w != null);
  if (complete) br.teams.forEach(id => { if (p[id] == null) p[id] = 4; });
  return { p, complete };
}
export function sportPoints(sp) {
  const out = {};
  Object.entries(placements(sp).p).forEach(([t, pos]) => out[t] = S.config.pts[pos] || 0);
  return out;
}
// cat: '' = geral (soma masculino + feminino) | 'masculino' | 'feminino'
export function totals(cat = '') {
  const chosen = S.sports.filter(sp => !cat || sp.category === cat);
  const per = chosen.map(sp => ({ sp, pts: sportPoints(sp) }));
  const wos = {};   // WOs dados por atlética (só jogos já encerrados)
  chosen.forEach(sp => { const R = resolve(sp); if (R) R.list.forEach(m => { if (m.wo && m.done) wos[m.wo] = (wos[m.wo] || 0) + 1; }); });
  return S.teams.map(t => {
    const sports = per.map(({ sp, pts }) => sp.enrolled.includes(t.id) ? (pts[t.id] || 0) : null);
    const wo = wos[t.id] || 0, woPts = wo * (S.config.woPenalty || 0);
    const total = sports.reduce((a, b) => a + (b || 0), 0) - woPts;
    return { id: t.id, name: t.name, sports, wo, woPts, total };
  }).sort((a, b) => b.total - a.total);
}

/* ---------- edição de um jogo ----------
   Aplica a mudança no estado local e devolve só os campos alterados (patch) para gravar no banco,
   ou null se o jogo ainda não tem os dois times, ou { _error } se a ação não é válida.
   Campos: date | time | place | sa | sb | status | tb   (placar simples)
           pt {side,delta} | closeset | undoset | status   (placar por sets)
           reset (zera o placar do jogo) | clearsched (apaga data, hora e local) */
export function patchMatch(sp, mid, field, val) {
  const br = sp.bracket; if (!br) return null;
  const m = resolve(sp).byId[mid]; if (!m) return null;
  const rec = br.m[mid] || (br.m[mid] = {}), patch = {};
  const set = (k, v) => { rec[k] = v; patch[k] = v; };
  if (field === 'date' || field === 'time' || field === 'place') { set(field, String(val).trim()); return patch; }
  if (field === 'dur') { set('dur', val == null || val === '' ? null : Math.min(480, Math.max(5, Math.round(Number(val) || 0)))); return patch; }
  if (field === 'clearsched') { ['date', 'time', 'place'].forEach(k => set(k, '')); if (rec.dur != null) set('dur', null); return patch; }
  if (field === 'reset') { ['sa', 'sb', 'pa', 'pb', 'tb', 'status', 'sets', 'started_at', 'wo'].forEach(k => set(k, null)); return patch; }   // zera o jogo, mantém data/hora/local
  if (m.bye || m.a == null || m.b == null) return null;
  if (!(rec.pa === m.a && rec.pb === m.b)) ['sa', 'sb', 'tb', 'status', 'sets', 'started_at', 'wo'].forEach(k => set(k, null)); // times mudaram: descarta o que era de outra partida
  set('pa', m.a); set('pb', m.b);
  // entra "ao vivo" e guarda a hora real de início (a primeira vez), usada para eleger o jogo em destaque
  const goLive = () => { if (rec.status !== 'live') set('status', 'live'); if (!rec.started_at) set('started_at', new Date().toISOString()); };

  if (field === 'wo') {   // val = id da atlética que NÃO compareceu; o adversário vence
    if (val !== m.a && val !== m.b) return { _error: 'Atlética inválida para o WO.' };
    const loserA = val === m.a, g = Math.max(1, Math.floor(S.config.woGoals ?? 1));
    set('wo', val); set('tb', null); set('sets', null); set('status', 'final');
    set('sa', loserA ? 0 : (sp.scoring === 'sets' ? m.need : g)); set('sb', loserA ? (sp.scoring === 'sets' ? m.need : g) : 0);
    return patch;
  }
  if (rec.wo) {   // jogo decidido por WO: a única edição possível é reabrir (volta a 0 x 0, ao vivo)
    if (!(field === 'status' && val === 'live')) return null;
    set('wo', null); set('tb', null); set('sa', 0); set('sb', 0); set('sets', sp.scoring === 'sets' ? [] : null); set('status', null);
    goLive(); return patch;
  }

  if (sp.scoring !== 'sets') {
    const zeroFill = () => { if (rec.sa == null) set('sa', 0); if (rec.sb == null) set('sb', 0); };
    if (field === 'sa' || field === 'sb') {
      set(field, val === '' || val == null ? null : Math.max(0, Math.floor(Number(val))));
      set('tb', null);
      if (val !== '' && val != null) { zeroFill(); if (!rec.status) goLive(); }
    } else if (field === 'status') {
      zeroFill();
      if (val === 'live') goLive(); else set('status', val);
    } else if (field === 'tb') set('tb', val);
    return patch;
  }

  // ----- por sets -----
  const sets = Array.isArray(rec.sets) ? rec.sets.map(s => ({ ...s })) : [];
  const last = () => sets[sets.length - 1];
  if (field === 'pt') {
    let cur = last();
    if (!cur || cur.done) { cur = { a: 0, b: 0, done: false }; sets.push(cur); }
    cur[val.side] = Math.max(0, cur[val.side] + val.delta);
    if (rec.status !== 'live') goLive();
  } else if (field === 'closeset') {
    const cur = last();
    if (!cur || cur.done) return { _error: 'Não há set em andamento.' };
    if (cur.a === cur.b) return { _error: 'Set empatado: ajuste os pontos antes de fechar.' };
    cur.done = true; goLive();
    const w = wonOf(sets);
    if (w.a >= m.need || w.b >= m.need) set('status', 'final');   // alguém fechou os sets necessários: jogo encerrado
  } else if (field === 'undoset') {
    let l = last();
    if (l && !l.done && l.a + l.b === 0) { sets.pop(); l = last(); }
    if (!(l && l.done)) return { _error: 'Nenhum set fechado para reabrir.' };
    l.done = false;
    if (rec.status === 'final') set('status', 'live');
  } else if (field === 'status') {
    if (val === 'live') { const l = last(); if (rec.status === 'final' && l && l.done) l.done = false; goLive(); }
    else if (val === 'final') {
      const l = last();
      if (l && !l.done) { if (l.a + l.b === 0) sets.pop(); else if (l.a !== l.b) l.done = true; else return { _error: 'Set empatado: ajuste os pontos antes de encerrar.' }; }
      const w = wonOf(sets);
      if (w.a === w.b) return { _error: 'Os sets estão empatados: não há vencedor.' };
      set('status', 'final');
    }
  } else return patch;
  set('sets', sets);
  const w = wonOf(sets); set('sa', w.a); set('sb', w.b);
  return patch;
}
export function clearScheduleFields(br) {
  Object.values(br.m).forEach(r => { r.date = r.time = r.place = ''; });
}
export function clearScoreFields(br) {
  Object.values(br.m).forEach(r => { r.sa = r.sb = r.pa = r.pb = r.tb = r.status = r.sets = r.started_at = r.wo = null; });
}

/* ---------- jogo em destaque da página principal ----------
   Ao vivo: se houver mais de um, o que entrou no ar primeiro (mais tempo de jogo).
   Sem jogo ao vivo: o próximo agendado (data/hora mais próxima ainda por vir; se estiver só atrasado, o mais cedo pendente). */
export const schedTs = r => (r && r.date ? new Date(`${r.date}T${r.time || '00:00'}`).getTime() : null);
export const startedTs = m => (m.rec && m.rec.started_at ? Date.parse(m.rec.started_at) : null);
const BIG = 9e15;
export function pickFeatured(items, now = Date.now()) {
  const ok = items.filter(({ m }) => !m.bye && m.a != null && m.b != null);
  const live = ok.filter(({ m }) => m.live)
    .sort((x, y) => (startedTs(x.m) ?? schedTs(x.m.rec) ?? BIG) - (startedTs(y.m) ?? schedTs(y.m.rec) ?? BIG));
  if (live.length) return { kind: 'live', item: live[0] };
  const pend = ok.filter(({ m }) => !m.live && !m.done && schedTs(m.rec) != null).sort((x, y) => schedTs(x.m.rec) - schedTs(y.m.rec));
  const nxt = pend.find(({ m }) => schedTs(m.rec) >= now - 60 * 60 * 1000) || pend[0];
  return nxt ? { kind: 'next', item: nxt } : null;
}

/* ---------- duração dos jogos, ordem e conflitos ---------- */
export const DEFAULT_MINUTES = 40;
export const minutesOf = sp => Math.max(5, Number(sp && sp.minutes) || DEFAULT_MINUTES);
const pad2 = n => String(n).padStart(2, '0');
export const fmtClock = ms => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
export const fmtDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const normPlace = p => String(p || '').trim().replace(/\s+/g, ' ').toLowerCase();
// início e fim previstos (fim = início + duração média da modalidade); null se o jogo não tem data e hora
export function span(sp, m) {
  const r = m.rec || {};
  if (!r.date || !r.time) return null;
  const start = schedTs(r);
  return { start, end: start + (Number(r.dur) || minutesOf(sp)) * 60000 };
}
// jogos que se sobrepõem no mesmo ginásio OU com a mesma atlética. Devolve { [sp.id + m.id]: Set(motivos) }
export function findConflicts(items) {
  const rows = items.filter(({ m }) => !m.bye).map(it => ({ ...it, t: span(it.sp, it.m), pl: normPlace(it.m.rec.place) })).filter(r => r.t);
  const out = {}, add = (r, why) => (out[r.sp.id + r.m.id] = out[r.sp.id + r.m.id] || new Set()).add(why);
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (!(a.t.start < b.t.end && b.t.start < a.t.end)) continue;
    if (a.pl && a.pl === b.pl) { add(a, 'ginásio ' + a.m.rec.place); add(b, 'ginásio ' + b.m.rec.place); }
    [a.m.a, a.m.b].filter(t => t != null && (t === b.m.a || t === b.m.b)).forEach(t => { add(a, 'atlética ' + tn(t)); add(b, 'atlética ' + tn(t)); });
  }
  return out;
}
const orderCmp = (a, b) => a.round - b.round || (a.third ? 0 : 1) - (b.third ? 0 : 1) || a.id.localeCompare(b.id, undefined, { numeric: true });
// Agenda os jogos de uma chave um depois do outro (duração média + intervalo). Não altera nada: devolve o plano.
export function planSequence(sp, { date, time, place = '', gap = 10, overwrite = false }) {
  const R = resolve(sp);
  const t0 = new Date(`${date}T${time}`).getTime();
  if (!R || !date || !time || isNaN(t0)) return [];
  const dur = minutesOf(sp) * 60000, step = dur + Math.max(0, Number(gap) || 0) * 60000, out = [];
  let t = t0;
  R.list.filter(m => !m.bye).sort(orderCmp).forEach(m => {
    const r = m.rec || {};
    if (!overwrite && r.date && r.time) return;   // já tem horário: não mexe e não ocupa vaga
    out.push({ id: m.id, label: m.label, date: fmtDay(t), time: fmtClock(t), place: place || r.place || '', end: t + dur });
    t += step;
  });
  return out;
}
