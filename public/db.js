/* JIAS 2026 — Supabase: carga, tempo real, login e gravações.
   Quem pode gravar o quê é decidido pelo banco (RLS em supabase/schema.sql), não pela tela. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { S, defaultConfig } from './logic.js';

export const configured = !SUPABASE_URL.includes('SEU-PROJETO');
/* Teste local: em localhost o site NUNCA grava na produção.
   ?demo  -> banco falso em memória (demo.js), com login de admin/mesário de mentira.
   sem ?demo em localhost -> só leitura (gravar é bloqueado). Em produção nada disso se aplica. */
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
export const DEMO = LOCAL && /[?&]demo\b/.test(location.search);
export const sb = DEMO ? (await import('./demo.js')).createDemoClient()
  : configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 10 } } }) : null;
export const auth = { user: null, role: null };           // role: 'admin' | 'scorer' | null (público)
export const canScore = () => auth.role === 'admin' || auth.role === 'scorer';
export const isAdmin = () => auth.role === 'admin';
// outdated = o banco ainda não recebeu as migrations que o site espera (colunas novas ausentes)
export const state = { outdated: false, noDur: false, noLikes: false };
export const hooks = { onError: () => {}, onIdle: () => {}, onLive: () => {} };

let inflight = 0;
export const busy = () => inflight > 0;
async function run(query) {
  if (LOCAL && !DEMO) { hooks.onError('Bloqueado: em localhost sem ?demo o site não grava na produção. Abra http://localhost:8000/?demo para testar.'); return false; }
  inflight++;
  try { const { error } = await query; if (error) throw error; return true; }
  catch (e) { hooks.onError(e.message || String(e)); return false; }
  finally { if (--inflight === 0) hooks.onIdle(); }
}

/* ---------- curtidas da torcida ----------
   Tabela criada pela migration 20261112000000_team_likes. Se ela ainda não existe no banco, o site esconde o botão (state.noLikes). */
function setLikes(r) {
  state.noLikes = !!r.error;
  S.likes = r.error ? {} : Object.fromEntries(r.data.map(x => [x.team_id, Number(x.likes) || 0]));
}
export async function loadLikes() { setLikes(await sb.from('team_likes').select('*')); }
export const sendLike = teamId => run(sb.rpc('add_like', { p_team: teamId }));

/* ---------- leitura ---------- */
export async function loadAll() {
  const q = t => sb.from(t).select('*');
  const [teams, sports, brackets, results, config, likes] = await Promise.all(['teams', 'sports', 'brackets', 'match_results', 'config', 'team_likes'].map(q));
  setLikes(likes);
  const err = [teams, sports, brackets, results, config].find(r => r.error);
  if (err) throw err.error;
  const s0 = sports.data[0], r0 = results.data[0];
  state.outdated = !!((s0 && !('category' in s0 && 'scoring' in s0 && 'best_of' in s0)) || (s0 && !('avg_minutes' in s0)) || (r0 && !('sets' in r0 && 'started_at' in r0 && 'wo' in r0)));
  state.noDur = !!(r0 && !('dur' in r0));
  S.teams = teams.data.sort((a, b) => a.pos - b.pos).map(t => ({ id: t.id, name: t.name, pos: t.pos }));
  const recs = {};
  results.data.forEach(r => {
    (recs[r.sport_id] = recs[r.sport_id] || {})[r.match_id] =
      { date: r.date || '', time: r.time || '', place: r.place || '', status: r.status, sa: r.sa, sb: r.sb, pa: r.pa, pb: r.pb, tb: r.tb, sets: r.sets, started_at: r.started_at, wo: r.wo, dur: r.dur ?? null };
  });
  S.sports = sports.data.sort((a, b) => a.pos - b.pos).map(s => {
    const b = brackets.data.find(x => x.sport_id === s.id);
    return {
      id: s.id, name: s.name, category: s.category || 'masculino', scoring: s.scoring || 'simple', best_of: s.best_of || 3, minutes: s.avg_minutes || 40, pos: s.pos, enrolled: s.enrolled || [], format: s.format, third: s.third, double: s.double,
      bracket: b ? { ...b.data, m: recs[s.id] || {} } : null,
    };
  });
  S.config = { ...defaultConfig(), ...((config.data[0] || {}).data || {}) };
}

export function subscribe(onChange) {
  let t;
  const bump = () => { clearTimeout(t); t = setTimeout(onChange, 120); };
  sb.channel('jias-live')
    .on('postgres_changes', { event: '*', schema: 'public' }, bump)
    .subscribe(status => hooks.onLive(status === 'SUBSCRIBED'));
  // rede móvel é instável: ao voltar para a aba, sincroniza de novo
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bump(); });
  window.addEventListener('online', bump);
}

/* ---------- login ---------- */
async function loadRole() {
  auth.role = null;
  if (auth.user) {
    const { data } = await sb.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle();
    auth.role = data ? data.role : null;
  }
}
export async function initAuth(onChange) {
  const { data } = await sb.auth.getSession();
  auth.user = data.session ? data.session.user : null;
  await loadRole();
  sb.auth.onAuthStateChange(async (_e, session) => {
    const uid = session ? session.user.id : null;
    if (uid === (auth.user && auth.user.id)) return;
    auth.user = session ? session.user : null; await loadRole(); onChange();
  });
}
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export const signOut = () => sb.auth.signOut();

/* ---------- gravação: mesário e admin ---------- */
// vários jogos de uma vez (agendamento em sequência): uma única gravação
// banco sem a coluna "dur" (migration pendente): tira o campo para não derrubar o resto da gravação
const noDur = o => { if (!state.noDur || !('dur' in o)) return o; if (o.dur != null) hooks.onError('Rode a migration nova (supabase db push) para salvar a duração dos jogos.'); const { dur, ...rest } = o; return rest; };
export const saveMatches = (sportId, list) =>
  run(sb.from('match_results').upsert(list.map(({ id, ...patch }) => ({ sport_id: sportId, match_id: id, ...noDur(patch) })), { onConflict: 'sport_id,match_id' }));
export const saveMatch = (sportId, matchId, patch) =>
  run(sb.from('match_results').upsert({ sport_id: sportId, match_id: matchId, ...noDur(patch) }, { onConflict: 'sport_id,match_id' }));

/* ---------- gravação: só admin ---------- */
export const saveTeam = t => run(sb.from('teams').upsert({ id: t.id, name: t.name, pos: t.pos }));
export const saveSport = s => run(sb.from('sports').upsert({
  id: s.id, name: s.name, category: s.category, scoring: s.scoring || 'simple', best_of: s.best_of || 3, avg_minutes: s.minutes || 40, pos: s.pos, enrolled: s.enrolled, format: s.format, third: !!s.third, double: !!s.double,
}));
export const deleteSport = id => run(sb.from('sports').delete().eq('id', id));
export const deleteTeam = id => run(sb.from('teams').delete().eq('id', id));
export const saveConfig = () => run(sb.from('config').upsert({ id: 1, data: S.config }));

// grava o resultado de um sorteio. keepSchedule: mantém data/hora/local e zera só os placares.
export async function saveBracket(sp, { keepSchedule = false } = {}) {
  const { m, ...data } = sp.bracket;
  const ok = await run(sb.from('brackets').upsert({ sport_id: sp.id, data, updated_at: new Date().toISOString() }));
  if (!ok) return false;
  if (!keepSchedule) return run(sb.from('match_results').delete().eq('sport_id', sp.id));
  // mantém a grade de datas/horários: só some o que não existe mais na nova estrutura, e os placares são zerados
  const ids = sp.bracket.defs.map(d => d.id).join(',');
  await run(sb.from('match_results').delete().eq('sport_id', sp.id).not('match_id', 'in', `(${ids})`));
  return clearScores(sp.id);
}
export const dropBracket = async spId => {
  await run(sb.from('match_results').delete().eq('sport_id', spId));
  return run(sb.from('brackets').delete().eq('sport_id', spId));
};
export const clearSchedule = spId =>
  run(sb.from('match_results').update(state.noDur ? { date: null, time: null, place: null } : { date: null, time: null, place: null, dur: null }).eq('sport_id', spId));
export const clearScores = spId =>
  run(sb.from('match_results').update({ sa: null, sb: null, pa: null, pb: null, tb: null, status: null, sets: null, started_at: null, wo: null }).eq('sport_id', spId));

// grava só a estrutura do chaveamento (sem mexer em placares/horários); removed = jogos que deixaram de existir
export async function saveBracketStructure(sp, removed = []) {
  const { m, ...data } = sp.bracket;
  const ok = await run(sb.from('brackets').upsert({ sport_id: sp.id, data, updated_at: new Date().toISOString() }));
  if (ok && removed.length) await run(sb.from('match_results').delete().eq('sport_id', sp.id).in('match_id', removed));
  return ok;
}
