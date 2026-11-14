/* JIAS 2026 — MODO DEMO (só localhost, abre com ?demo).
   Banco falso em memória que imita a parte do supabase-js que o site usa. Nada sai do navegador:
   não existe rede, não existe produção. Recarregar a página volta aos dados de exemplo.
   Logins: admin@demo (Admin) e mesario@demo (Mesário), com qualquer senha. Sem login = visitante. */
import { S, makeBracket, resolve, fmtDay } from './logic.js';

const TEAMS = ['Corsários', 'Macaco', 'Urso', 'Marreco', 'Índio', 'Sanguinária', 'Predadores', 'Devora'];
const PK = { teams: ['id'], sports: ['id'], brackets: ['sport_id'], match_results: ['sport_id', 'match_id'], config: ['id'], profiles: ['user_id'], team_likes: ['team_id'], sumulas: ['id'], sumula_log: ['id'] };
const RESULT_DEFAULTS = { date: null, time: null, place: null, status: null, sa: null, sb: null, pa: null, pb: null, tb: null, sets: null, started_at: null, wo: null, dur: null };

function seed() {
  const teams = TEAMS.map((name, pos) => ({ id: 't_' + pos, name, pos }));
  const ids = teams.map(t => t.id);
  const mk = (id, name, category, pos, extra) => ({ id, name, category, scoring: 'simple', best_of: 3, avg_minutes: 40, pos, enrolled: ids, format: 'knockout', third: true, double: false, ...extra });
  const sports = [
    mk('s_futsal_m', 'Futsal', 'masculino', 0, {}),
    mk('s_volei_f', 'Vôlei', 'feminino', 1, { scoring: 'sets', avg_minutes: 50 }),
    mk('s_basquete_m', 'Basquete', 'masculino', 2, { format: 'rr', enrolled: ids.slice(0, 4), third: false }),
  ];
  S.teams = teams.map(t => ({ ...t }));
  const brackets = [], results = [];
  const today = fmtDay(Date.now());
  sports.forEach(sp => {
    const br = makeBracket(sp, 'seed'); br.m = {};
    sp.bracket = br;
    const R = resolve(sp), by = id => R.byId[id];
    const put = (mid, patch) => { const m = by(mid); if (!m) return; results.push({ sport_id: sp.id, match_id: mid, ...RESULT_DEFAULTS, pa: m.a, pb: m.b, ...patch }); };
    if (sp.id === 's_futsal_m') {
      put('K1_0', { status: 'final', sa: 4, sb: 1, date: today, time: '08:00', place: 'Ginásio A' });
      put('K1_1', { status: 'final', sa: 2, sb: 3, date: today, time: '08:50', place: 'Ginásio A' });
      put('K1_2', { status: 'live', sa: 1, sb: 0, date: today, time: '09:40', place: 'Ginásio A', started_at: new Date(Date.now() - 12 * 60000).toISOString() });
      put('K1_3', { date: today, time: '10:30', place: 'Ginásio A' });
    } else if (sp.id === 's_volei_f') {
      const set = (a, b) => ({ a, b, done: true });
      put('K1_0', { status: 'final', sets: [set(25, 20), set(25, 22)], sa: 2, sb: 0, date: today, time: '08:00', place: 'Ginásio B' });
      put('K1_1', { status: 'live', sets: [set(25, 23), { a: 11, b: 14, done: false }], sa: 1, sb: 0, date: today, time: '09:00', place: 'Ginásio B', started_at: new Date(Date.now() - 25 * 60000).toISOString() });
      put('K1_2', { date: today, time: '10:00', place: 'Ginásio B' });
    } else {
      // pontos corridos completo: já gera classificação no ranking
      R.list.forEach((m, i) => put(m.id, { status: 'final', sa: 60 + (i * 7) % 25, sb: 55 + (i * 11) % 30, date: today, time: `${13 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`, place: 'Ginásio A' }));
    }
    const { m, ...data } = br;
    brackets.push({ sport_id: sp.id, data, updated_at: new Date().toISOString() });
  });
  return {
    teams, sports, brackets, match_results: results,
    config: [{ id: 1, data: { gyms: ['Ginásio A', 'Ginásio B'], days: [today] } }],
    team_likes: teams.map((t, i) => ({ team_id: t.id, likes: [128, 342, 87, 511, 63, 214, 45, 190][i] })),
    profiles: [{ user_id: 'u_admin', role: 'admin' }, { user_id: 'u_mesario', role: 'scorer' }],
    sumulas: [], sumula_log: [],
  };
}

export function createDemoClient() {
  const T = seed(), changeCbs = new Set(), authCbs = new Set();
  const USERS = { admin: { id: 'u_admin', email: 'admin@demo' }, mesario: { id: 'u_mesario', email: 'mesario@demo' } };
  let session = null;
  const notify = () => setTimeout(() => changeCbs.forEach(f => f()), 30);
  const same = (pk, a, b) => pk.every(k => a[k] === b[k]);

  function from(table) {
    const q = { op: 'select', f: [], rows: [], patch: null, single: false };
    const fail = message => ({ data: null, error: { message } });
    // imita o que o banco faz nas súmulas: só mesário/admin enxergam; gatilho carimba autor e trava súmula fechada
    const writeSumula = hit => {
      const me = session && session.user; if (!me) return fail('new row violates row-level security policy for table "sumulas"');
      const now = new Date().toISOString(), mail = me.email, admin = me.id === 'u_admin';
      const log = (id, action) => T.sumula_log.push({ id: T.sumula_log.length + 1, sumula_id: id, action, user_id: me.id, user_email: mail, at: now });
      if (q.op === 'insert') {
        for (const row of q.rows) {
          if (T.sumulas.some(r => r.sport_id === row.sport_id && r.match_id === row.match_id)) return fail('duplicate key value violates unique constraint "sumulas_sport_id_match_id_key"');
          const id = 'sm_' + Math.random().toString(36).slice(2, 10);
          T.sumulas.push({ id, sport_id: row.sport_id, match_id: row.match_id, data: structuredClone(row.data), status: 'open',
            created_by: me.id, created_by_email: mail, created_at: now, updated_by: me.id, updated_by_email: mail, updated_at: now,
            closed_by: null, closed_by_email: null, closed_at: null, reopened_by: null, reopened_by_email: null, reopened_at: null });
          log(id, 'create');
        }
      } else {
        for (const r of T.sumulas.filter(hit)) {
          const p = structuredClone(q.patch), next = p.status || r.status;
          if (r.status === 'closed') {
            if (next !== 'open') return fail('Súmula fechada: só um administrador pode reabrir para editar.');
            if (!admin) return fail('Só um administrador pode reabrir uma súmula fechada.');
            Object.assign(r, { status: 'open', closed_by: null, closed_by_email: null, closed_at: null, reopened_by: me.id, reopened_by_email: mail, reopened_at: now });
            log(r.id, 'reopen');
          } else {
            const edited = p.data && JSON.stringify(p.data) !== JSON.stringify(r.data) && r.updated_by !== me.id;
            if (p.data) r.data = p.data;
            if (next === 'closed') { Object.assign(r, { status: 'closed', closed_by: me.id, closed_by_email: mail, closed_at: now }); log(r.id, 'close'); }
            else if (edited) log(r.id, 'edit');
          }
          Object.assign(r, { updated_by: me.id, updated_by_email: mail, updated_at: now });
        }
      }
      notify(); return { data: null, error: null };
    };
    const exec = () => {
      const rows = T[table], pk = PK[table];
      const hit = r => q.f.every(fn => fn(r));
      if ((table === 'sumulas' || table === 'sumula_log') && q.op === 'select' && !(session && session.user)) return { data: [], error: null };
      if (table === 'sumulas' && q.op !== 'select') return writeSumula(hit);
      if (q.op === 'select') {
        const out = structuredClone(rows.filter(hit));
        return { data: q.single ? (out[0] || null) : out, error: null };
      }
      if (q.op === 'upsert') {
        q.rows.forEach(row => {
          const cur = rows.find(r => same(pk, r, row));
          const next = structuredClone(row);
          if (cur) Object.assign(cur, next);
          else rows.push(table === 'match_results' ? { ...RESULT_DEFAULTS, ...next } : next);
        });
      } else if (q.op === 'update') {
        rows.filter(hit).forEach(r => Object.assign(r, structuredClone(q.patch)));
      } else if (q.op === 'delete') {
        const gone = rows.filter(hit);
        T[table] = rows.filter(r => !gone.includes(r));
        if (table === 'sports') gone.forEach(s => { T.brackets = T.brackets.filter(b => b.sport_id !== s.id); T.match_results = T.match_results.filter(r => r.sport_id !== s.id); });
      }
      notify();
      return { data: null, error: null };
    };
    const b = {
      select() { return b; },
      upsert(rows) { q.op = 'upsert'; q.rows = [].concat(rows); return b; },
      insert(rows) { q.op = 'insert'; q.rows = [].concat(rows); return b; },
      delete() { q.op = 'delete'; return b; },
      update(p) { q.op = 'update'; q.patch = p; return b; },
      eq(c, v) { q.f.push(r => r[c] === v); return b; },
      in(c, a) { q.f.push(r => a.includes(r[c])); return b; },
      not(c, _op, v) { const a = String(v).replace(/^\(|\)$/g, '').split(','); q.f.push(r => !a.includes(r[c])); return b; },
      maybeSingle() { q.single = true; return b; },
      then(ok, bad) { return Promise.resolve().then(exec).then(ok, bad); },
    };
    return b;
  }

  const setSession = (user, event) => { session = user ? { user } : null; authCbs.forEach(f => f(event, session)); };
  return {
    from,
    // curtir: soma 1, como no banco de verdade, e NÃO dispara o tempo real
    rpc(name, a) {
      const r = (() => {
        if (name !== 'add_like') return { data: null, error: new Error('função desconhecida') };
        let row = T.team_likes.find(x => x.team_id === a.p_team);
        if (!row) T.team_likes.push(row = { team_id: a.p_team, likes: 0 });
        row.likes += 1; return { data: row.likes, error: null };
      })();
      return { then: (ok, bad) => Promise.resolve(r).then(ok, bad) };
    },
    channel() {
      const ch = { on(_e, _f, cb) { changeCbs.add(cb); return ch; }, subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 0); return ch; } };
      return ch;
    },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(cb) { authCbs.add(cb); return { data: { subscription: { unsubscribe: () => authCbs.delete(cb) } } }; },
      async signInWithPassword({ email }) {
        const user = /^admin/i.test(email) ? USERS.admin : /^(mesario|scorer)/i.test(email) ? USERS.mesario : null;
        if (!user) return { error: new Error('Use admin@demo ou mesario@demo') };
        setSession(user, 'SIGNED_IN'); return { error: null };
      },
      async signOut() { setSession(null, 'SIGNED_OUT'); return { error: null }; },
    },
  };
}
