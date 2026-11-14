/* JIAS 2026 — súmulas: modelos por modalidade (futsal, handebol, vôlei, basquete), formulário e PDF.
   Sem rede e sem acesso ao banco: recebe/entrega só dados. A gravação fica em db.js e a tela em app.js.
   O PDF é desenhado a partir dos MESMOS dados do formulário (jsPDF carregado só quando alguém pede o PDF). */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------- modelos ----------
   periods: colunas do placar | cols: estatísticas por atleta (num = número, chk = marcado ou não, fouls = 5 faltas)
   refs: quem assina a arbitragem | extra: bloco específico da modalidade (faltas, tempos, saque) */
const REFS2 = [['r1', '1º Árbitro'], ['r2', '2º Árbitro']];
export const KINDS = {
  futsal: {
    name: 'Futsal', title: 'SÚMULA FUTSAL', scoreTitle: 'PLACAR DA PARTIDA', periods: [['p1', '1º Tempo'], ['p2', '2º Tempo']], totalLabel: 'TOTAL',
    cols: [{ k: 'g', l: 'G', t: 'Gols' }, { k: 'ca', l: 'CA', t: 'Cartão amarelo' }, { k: 'cv', l: 'CV', t: 'Cartão vermelho' }],
    refs: [...REFS2, ['scorer', 'Anotador'], ['timer', 'Cronometrista']],
  },
  handebol: {
    name: 'Handebol', title: 'SÚMULA SIMPLIFICADA DE HANDEBOL', scoreTitle: 'PLACAR DA PARTIDA', periods: [['p1', '1º Tempo'], ['p2', '2º Tempo']], totalLabel: 'TOTAL',
    cols: [{ k: 'g', l: 'G', t: 'Gols' }, { k: 'a', l: 'A', t: 'Advertência' }, { k: 's2', l: "2'", t: 'Suspensão de 2 minutos' }, { k: 'd', l: 'D', t: 'Desqualificação' }],
    refs: REFS2,
  },
  volei: {
    name: 'Voleibol', title: 'SÚMULA SIMPLIFICADA DE VOLEIBOL', scoreTitle: 'PLACAR POR SETS', totalLabel: 'TOTAL SETS', setsKind: true,
    periods: [['s1', '1º Set'], ['s2', '2º Set'], ['s3', '3º Set'], ['s4', '4º Set'], ['s5', '5º Set']],
    cols: [{ k: 'l', l: 'L', t: 'Líbero', chk: true }, { k: 'ca', l: 'CA', t: 'Cartão amarelo' }, { k: 'cv', l: 'CV', t: 'Cartão vermelho' }],
    refs: REFS2,
  },
  basquete: {
    name: 'Basquete', title: 'SÚMULA SIMPLIFICADA DE BASQUETE', scoreTitle: 'PLACAR POR PERÍODOS', totalLabel: 'TOTAL',
    periods: [['q1', '1º Q'], ['q2', '2º Q'], ['q3', '3º Q'], ['q4', '4º Q'], ['ot', 'Prorr.']],
    cols: [{ k: 'pts', l: 'PTS', t: 'Pontos' }, { k: 'f', l: 'Faltas', t: 'Faltas pessoais (marque cada uma)', fouls: true }],
    refs: REFS2,
  },
  // qualquer outra modalidade cadastrada em Ajustes: placar único, lista de atletas, arbitragem e observações
  generico: {
    name: 'Outra modalidade', title: 'SÚMULA', scoreTitle: 'PLACAR DA PARTIDA', periods: [['t', 'Placar']], totalLabel: 'TOTAL', noTotal: true,
    cols: [{ k: 'pts', l: 'PTS', t: 'Pontos' }, { k: 'ca', l: 'CA', t: 'Cartão amarelo' }, { k: 'cv', l: 'CV', t: 'Cartão vermelho' }],
    refs: [...REFS2, ['scorer', 'Anotador'], ['timer', 'Cronometrista']],
  },
};
export function kindOf(sportName) {
  const n = norm(sportName);
  if (/futsal|futebol|society/.test(n)) return 'futsal';
  if (/handebol/.test(n)) return 'handebol';
  if (/volei|volley/.test(n)) return 'volei';
  if (/basquete|basket/.test(n)) return 'basquete';
  return 'generico';
}
export const kindTitle = kind => (KINDS[kind] || KINDS.generico).title;

/* ---------- dados ---------- */
const ROWS = 12;   // linhas de atletas, como nos modelos em papel (dá para acrescentar)
const blankPlayer = cfg => {
  const p = { n: '', name: '' };
  cfg.cols.forEach(c => { p[c.k] = c.chk ? false : c.fouls ? [false, false, false, false, false] : ''; });
  return p;
};
export function newData(kind, meta, pre = {}) {
  const cfg = KINDS[kind] || KINDS.generico, per = () => Object.fromEntries(cfg.periods.map(([k]) => [k, '']));
  const team = () => ({ players: Array.from({ length: ROWS }, () => blankPlayer(cfg)) });
  const sc = { a: per(), b: per() };
  if (!cfg.setsKind) { const k = cfg.periods[0][0]; if (pre.sa != null) sc.a[k] = pre.sa; if (pre.sb != null) sc.b[k] = pre.sb; }   // placar que já existia entra no 1º período
  return {
    v: 1, kind, meta, period: cfg.periods[0][0],
    num: pre.num || '', place: pre.place || '', date: pre.date || '', time: pre.time || '',
    score: sc, a: team(), b: team(),
    refs: { r1: '', r2: '', scorer: '', timer: '' }, obs: '',
  };
}
export const curPeriod = d => { const cfg = KINDS[d.kind] || KINDS.generico; return cfg.periods.some(([k]) => k === d.period) ? d.period : cfg.periods[0][0]; };
// gols/pontos lançados por atleta (G ou PTS): é o que alimenta o placar
export const STAT_RE = /^([ab])\.players\.\d+\.(g|pts)$/;
// gols (ou pontos) distribuídos entre os atletas nunca passam do placar da equipe
export const statKey = d => { const c = KINDS[d.kind] || KINDS.generico; if (c.setsKind) return null; const col = c.cols.find(x => x.k === 'g' || x.k === 'pts'); return col ? col.k : null; };
export const sumStat = (d, side, skip = -1) => { const k = statKey(d); return k ? d[side].players.reduce((n, p, i) => (i === skip ? n : n + (num(p[k]) || 0)), 0) : 0; };
export const capText = (d, side) => { const k = statKey(d); if (!k) return ''; const t = totalsOf(d)[side], u = sumStat(d, side); return `${k === 'g' ? 'Gols' : 'Pontos'} dos atletas: ${u} de ${t}${u > t ? ' ⚠' : ''}`; };
// ajusta o placar da equipe para `target`, mexendo no período atual (e, se faltar, nos anteriores)
export function followTotal(d, side, target) {
  const cfg = KINDS[d.kind] || KINDS.generico; let diff = target - totalsOf(d)[side];
  if (!diff) return false;
  const keys = cfg.periods.map(([k]) => k), cur = keys.indexOf(curPeriod(d)), order = [cur, ...keys.map((_, i) => i).filter(i => i !== cur).sort((x, y) => y - x)];
  for (const i of order) {
    const k = keys[i], v = num(d.score[side][k]) || 0, nv = Math.max(0, v + diff);
    if (diff > 0) { d.score[side][k] = nv; return true; }
    d.score[side][k] = nv === 0 && v === 0 ? d.score[side][k] : nv; diff += v - nv;
    if (diff >= 0) break;
  }
  return true;
}
export const addPlayer = (data, side) => data[side].players.push(blankPlayer(KINDS[data.kind] || KINDS.generico));

// escreve em "a.players.3.name" criando o que faltar
export function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  ks.slice(0, -1).forEach((k, i) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; });
  o[ks[ks.length - 1]] = val;
}
export function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
// totais: soma dos períodos; no vôlei, quantidade de sets vencidos
export function totalsOf(data) {
  const cfg = KINDS[data.kind] || KINDS.generico, out = { a: 0, b: 0 };
  if (cfg.setsKind) {
    cfg.periods.forEach(([k]) => { const a = num(data.score.a[k]), b = num(data.score.b[k]); if (a != null && b != null) { if (a > b) out.a++; else if (b > a) out.b++; } });
  } else cfg.periods.forEach(([k]) => { out.a += num(data.score.a[k]) || 0; out.b += num(data.score.b[k]) || 0; });
  return out;
}
export const setsCount = data => (data.meta && data.meta.bestOf === 5 ? 5 : 3);

/* ---------- formulário ---------- */
const val = (d, p) => { const v = getPath(d, p); return v == null ? '' : v; };
const txt = (d, p, ph = '', extra = '') => `<input type="text" data-sf="${p}" value="${esc(val(d, p))}" placeholder="${esc(ph)}" autocomplete="off" ${extra}>`;
const numIn = (d, p, label, ro = false) => `<input type="number" min="0" inputmode="numeric" data-sf="${p}" value="${esc(val(d, p))}" aria-label="${esc(label)}" ${ro ? 'readonly tabindex="-1"' : ''}>`;
const chk = (d, p, label) => `<label class="sf-ck"><input type="checkbox" data-sf="${p}" ${getPath(d, p) ? 'checked' : ''}><i>${esc(label)}</i></label>`;
const chkRow = (d, p, n) => `<span class="sf-chks">${Array.from({ length: n }, (_, i) => chk(d, `${p}.${i}`, i + 1)).join('')}</span>`;
const teamName = (d, s) => (d.meta && d.meta[s] && d.meta[s].name) || (s === 'a' ? 'Equipe A' : 'Equipe B');
const SIDES = [['a', 'Equipe A'], ['b', 'Equipe B']];

function extrasForm(d, cfg) {
  const k = d.kind;
  const line = (title, body) => `<div class="sf-line"><b>${title}</b><div>${body}</div></div>`;
  if (k === 'futsal') {
    return cfg.periods.map(([p, pl]) => SIDES.map(([s, sl]) => line(`${pl} · ${esc(teamName(d, s))}`,
      `<span class="sf-lab">Faltas acumuladas <small>(6ª = tiro livre 10 m)</small></span>${chkRow(d, `fouls.${s}.${p}`, 5)}
       <label class="sf-in"><span>Pedido de tempo (min)</span>${txt(d, `tout.${s}.${p}`, 'ex.: 12:30')}</label>`)).join('')).join('');
  }
  if (k === 'handebol') {
    return cfg.periods.map(([p, pl]) => SIDES.map(([s]) => line(`${pl} · ${esc(teamName(d, s))}`,
      `<label class="sf-in"><span>Tempo 1 (min)</span>${txt(d, `tout.${s}.${p}.0`, 'ex.: 08:15')}</label>
       <label class="sf-in"><span>Tempo 2 (min)</span>${txt(d, `tout.${s}.${p}.1`, 'ex.: 22:40')}</label>`)).join('')).join('');
  }
  if (k === 'volei') {
    return Array.from({ length: setsCount(d) }, (_, i) => {
      const p = 's' + (i + 1);
      return `<div class="sf-line"><b>${i + 1}º Set</b><div>
        ${SIDES.map(([s]) => `<span class="sf-lab">Pedidos de tempo · ${esc(teamName(d, s))} <small>(placar no pedido)</small></span>
          <label class="sf-in"><span>T1</span>${txt(d, `tout.${s}.${p}.0`, '12 x 8')}</label><label class="sf-in"><span>T2</span>${txt(d, `tout.${s}.${p}.1`, '20 x 17')}</label>`).join('')}
        <span class="sf-lab">Saque inicial</span><span class="sf-chks">${SIDES.map(([s, sl]) => `<label class="sf-ck wide"><input type="radio" name="serve-${p}" data-sf="serve.${p}" value="${s}" ${getPath(d, 'serve.' + p) === s ? 'checked' : ''}><i>${esc(teamName(d, s))}</i></label>`).join('')}
          <button type="button" class="linkbtn" data-sf-clear="serve.${p}">limpar</button></span></div></div>`;
    }).join('');
  }
  if (k === 'basquete') {
    return SIDES.map(([s]) => line(esc(teamName(d, s)),
      `<span class="sf-lab">Faltas coletivas por quarto <small>(5ª = 2 lances livres)</small></span>
       ${['q1', 'q2', 'q3', 'q4'].map((q, i) => `<span class="sf-q"><small>${i + 1}º Q</small>${chkRow(d, `tfouls.${s}.${q}`, 4)}</span>`).join('')}
       <span class="sf-lab">Pedidos de tempo</span>
       <span class="sf-q"><small>1º tempo</small>${chkRow(d, `tout.${s}.h1`, 2)}</span><span class="sf-q"><small>2º tempo</small>${chkRow(d, `tout.${s}.h2`, 3)}</span>`)).join('');
  }
  return '';
}

const sm_cap = (d, s) => (statKey(d) ? `<p class="sf-cap ${sumStat(d, s) > totalsOf(d)[s] ? 'over' : ''}" data-sf-cap="${s}">${capText(d, s)} <small>(não pode passar do placar)</small></p>` : '');
export function formHtml(d) {
  const cfg = KINDS[d.kind] || KINDS.generico, tot = totalsOf(d);
  const stat = (s, i, c) => c.fouls
    ? `<span class="sf-s fouls" title="${esc(c.t)}"><span>${c.l}</span>${chkRow(d, `${s}.players.${i}.${c.k}`, 5)}</span>`
    : c.chk
      ? `<span class="sf-s" title="${esc(c.t)}"><span>${c.l}</span>${chk(d, `${s}.players.${i}.${c.k}`, '✔')}</span>`
      : (c.k === 'g' || c.k === 'pts') && !cfg.setsKind
        ? `<span class="sf-s goalc"><label title="${esc(c.t)}"><span>${c.l}</span>${numIn(d, `${s}.players.${i}.${c.k}`, c.t)}</label>${(d.kind === 'basquete' ? [1, 2, 3] : [1]).map(n => `<button type="button" class="goal" data-sf-goal="${s}.players.${i}.${c.k}" data-n="${n}">${d.kind === 'basquete' ? '+' + n : '⚽ +1'}</button>`).join('')}</span>`
        : `<label class="sf-s" title="${esc(c.t)}"><span>${c.l}</span>${numIn(d, `${s}.players.${i}.${c.k}`, c.t)}</label>`;
  const roster = ([s, sl]) => `<section class="sf-card"><h3>${sl} — ${esc(teamName(d, s))}</h3>${sm_cap(d, s)}
    ${d[s].players.map((p, i) => `<div class="sf-pl"><label class="sf-n"><span>Nº</span><input type="text" inputmode="numeric" maxlength="3" data-sf="${s}.players.${i}.n" value="${esc(p.n)}" aria-label="Número"></label>
      <label class="sf-nm"><span>Nome do atleta</span><input type="text" data-sf="${s}.players.${i}.name" value="${esc(p.name)}" autocomplete="off" aria-label="Nome do atleta"></label>
      <div class="sf-sts">${cfg.cols.map(c => stat(s, i, c)).join('')}</div></div>`).join('')}
    <button type="button" class="btn alt sm" data-sf-addp="${s}">+ Atleta</button></section>`;
  const scoreRow = ([s, sl]) => `<div class="sf-sr"><b>${sl}<small>${esc(teamName(d, s))}</small></b>
    ${cfg.periods.map(([p, pl]) => `<label><span>${pl}</span>${numIn(d, `score.${s}.${p}`, `${pl} — ${teamName(d, s)}`, !!cfg.setsKind)}</label>`).join('')}
    ${cfg.noTotal ? '' : `<span class="sf-tot"><span>${cfg.totalLabel}</span><b data-sf-total="${s}">${tot[s]}</b></span>`}</div>`;
  return `<section class="sf-card"><h3>Dados do jogo</h3><div class="sf-grid">
      <label class="fld">Jogo Nº${txt(d, 'num', '', 'maxlength="12"')}</label>
      <label class="fld">Local / Ginásio${txt(d, 'place', 'Ginásio…')}</label>
      <label class="fld">Data<input type="date" data-sf="date" value="${esc(d.date)}"></label>
      <label class="fld">Horário<input type="time" data-sf="time" value="${esc(d.time)}"></label></div></section>
    <section class="sf-card"><h3>${cfg.scoreTitle}</h3>
      ${cfg.setsKind ? '<p class="muted">Os pontos de cada set vêm do placar, nos controles acima.</p>' : `<div class="sf-per"><b>Período atual</b>${cfg.periods.map(([k, l]) => `<label class="sf-ck wide"><input type="radio" name="period" data-sf="period" value="${k}" ${curPeriod(d) === k ? 'checked' : ''}><i>${l}</i></label>`).join('')}<small>O placar do jogo entra neste período.</small></div>`}
      ${SIDES.map(scoreRow).join('')}</section>
    ${SIDES.map(roster).join('')}
    ${extrasForm(d, cfg) ? `<section class="sf-card"><h3>${d.kind === 'volei' ? 'Tempos e saque' : d.kind === 'basquete' ? 'Faltas coletivas e pedidos de tempo' : d.kind === 'futsal' ? 'Faltas e pedidos de tempo' : 'Pedidos de tempo'}</h3>${extrasForm(d, cfg)}</section>` : ''}
    <section class="sf-card"><h3>Arbitragem e ocorrências</h3><div class="sf-grid">
      ${cfg.refs.map(([k, l]) => `<label class="fld">${l}${txt(d, 'refs.' + k)}</label>`).join('')}</div>
      <label class="fld">Observações / Relatório disciplinar<textarea data-sf="obs" rows="5">${esc(d.obs)}</textarea></label></section>`;
}

/* ---------- PDF ---------- */
let pdfLib = null;
export function loadPdf() {
  if (typeof window !== 'undefined' && window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return pdfLib || (pdfLib = new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => ok(window.jspdf.jsPDF);
    s.onerror = () => { pdfLib = null; bad(new Error('Não foi possível carregar o gerador de PDF (sem internet?). Tente de novo.')); };
    document.head.appendChild(s);
  }));
}
const dmy = d => (d ? d.split('-').reverse().join('/') : '');
const stamp = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const pdfName = row => {
  const d = row.data || {}, m = d.meta || {};
  return ('Sumula ' + [m.sport, m.category, m.label].filter(Boolean).join(' ')).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
};

// desenha a súmula. `JsPDF` = classe do jsPDF; row = linha da tabela sumulas (status, data, created_by_email…)
export function drawPdf(JsPDF, row) {
  const d = row.data, cfg = KINDS[d.kind] || KINDS.generico, tot = totalsOf(d);
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const M = 12, CW = 186, BOTTOM = 280, HEAD = [221, 230, 241], closed = row.status === 'closed';
  let y = M;
  doc.setLineWidth(0.25); doc.setDrawColor(40, 40, 40);

  const mark = () => {   // marca d'água enquanto a súmula não está fechada
    if (closed) return;
    doc.setTextColor(232, 232, 232); doc.setFont('helvetica', 'bold'); doc.setFontSize(64);
    doc.text('RASCUNHO', 105, 160, { angle: 40, align: 'center' });
    doc.setTextColor(0);
  };
  mark();
  const need = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; mark(); } };
  // célula: retângulo + texto (cortado para caber)
  const cell = (x, yy, w, h, t, o = {}) => {
    const { bold = false, size = 8, align = 'left', fill, pad = 1.8 } = o;
    if (fill) { doc.setFillColor(...fill); doc.rect(x, yy, w, h, 'FD'); } else doc.rect(x, yy, w, h);
    if (t == null || t === '') return;
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(0);
    const s = doc.splitTextToSize(String(t), w - pad * 2)[0] || '';
    doc.text(s, align === 'center' ? x + w / 2 : align === 'right' ? x + w - pad : x + pad, yy + h / 2, { baseline: 'middle', align });
  };
  // caixinhas numeradas, preenchidas quando marcadas; devolve a largura usada
  const boxes = (x, cy, marks, n, labelFn = i => i + 1, s = 4) => {
    for (let i = 0; i < n; i++) {
      const bx = x + i * (s + 1.2), on = !!(marks && marks[i]);
      if (on) { doc.setFillColor(30, 30, 30); doc.rect(bx, cy - s / 2, s, s, 'FD'); } else doc.rect(bx, cy - s / 2, s, s);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(on ? 255 : 60);
      doc.text(String(labelFn(i)), bx + s / 2, cy, { baseline: 'middle', align: 'center' });
    }
    doc.setTextColor(0);
    return n * (s + 1.2);
  };
  const label = (t, x, cy, o = {}) => { doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 7.5); doc.setTextColor(0); doc.text(String(t), x, cy, { baseline: 'middle', align: o.align || 'left' }); };

  /* título e cabeçalho */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(cfg.title, 105, y + 5, { align: 'center' }); y += 9;
  const m = d.meta || {};
  cell(M, y, CW * .78, 6.5, 'JOGOS INTERATLÉTICAS SOLIDÁRIOS', { bold: true }); cell(M + CW * .78, y, CW * .22, 6.5, 'Jogo Nº: ' + (d.num || ''), { bold: true }); y += 6.5;
  cell(M, y, CW * .5, 6.5, 'Local / Ginásio: ' + (d.place || ''), { bold: true });
  cell(M + CW * .5, y, CW * .27, 6.5, 'Data: ' + dmy(d.date), { bold: true }); cell(M + CW * .77, y, CW * .23, 6.5, 'Horário: ' + (d.time || ''), { bold: true }); y += 6.5;
  cell(M, y, CW * .5, 6.5, 'Categoria: ' + ({ masculino: 'Masculino', feminino: 'Feminino' }[m.category] || ''), { bold: true });
  cell(M + CW * .5, y, CW * .5, 6.5, 'Fase: ' + (m.label || ''), { bold: true }); y += 9;

  /* placar */
  const np = cfg.periods.length, labW = CW * .34, colW = (CW - labW) / (np + (cfg.noTotal ? 0 : 1));
  cell(M, y, labW, 6.5, cfg.scoreTitle, { bold: true, fill: HEAD });
  cfg.periods.forEach(([, pl], i) => cell(M + labW + i * colW, y, colW, 6.5, pl, { bold: true, align: 'center', fill: HEAD }));
  if (!cfg.noTotal) cell(M + labW + np * colW, y, colW, 6.5, cfg.totalLabel, { bold: true, align: 'center', fill: HEAD });
  y += 6.5;
  SIDES.forEach(([s, sl]) => {
    cell(M, y, labW, 7.5, `${sl}: ${teamName(d, s)}`, { bold: true });
    cfg.periods.forEach(([p], i) => cell(M + labW + i * colW, y, colW, 7.5, d.score[s][p], { align: 'center', size: 10, bold: true }));
    if (!cfg.noTotal) cell(M + labW + np * colW, y, colW, 7.5, String(tot[s]), { align: 'center', size: 11, bold: true });
    y += 7.5;
  });
  y += 4;

  /* atletas: duas equipes lado a lado */
  const HW = CW / 2, RH = 6.2, nRows = Math.max(ROWS, d.a.players.length, d.b.players.length);
  const colsW = cfg.cols.map(c => (c.fouls ? 27 : c.l.length > 2 ? 10 : 8)), nameW = HW - 8 - colsW.reduce((a, b) => a + b, 0);
  need(14 + 6.2 * 4);
  SIDES.forEach(([s, sl], si) => cell(M + si * HW, y, HW, 6, `${sl.toUpperCase()}: ${teamName(d, s)}`, { bold: true, fill: HEAD }));
  y += 6;
  SIDES.forEach((_, si) => {
    let x = M + si * HW;
    cell(x, y, 8, 6, 'Nº', { bold: true, size: 7, align: 'center' }); x += 8;
    cell(x, y, nameW, 6, 'Nome do Atleta', { bold: true, size: 7 }); x += nameW;
    cfg.cols.forEach((c, i) => { cell(x, y, colsW[i], 6, c.l, { bold: true, size: 7, align: 'center' }); x += colsW[i]; });
  });
  y += 6;
  for (let r = 0; r < nRows; r++) {
    need(RH);
    SIDES.forEach(([s], si) => {
      const p = d[s].players[r] || {}; let x = M + si * HW;
      cell(x, y, 8, RH, p.n, { align: 'center' }); x += 8;
      cell(x, y, nameW, RH, p.name); x += nameW;
      cfg.cols.forEach((c, i) => {
        cell(x, y, colsW[i], RH, c.fouls || c.chk ? '' : p[c.k], { align: 'center' });
        if (c.fouls) boxes(x + 1.3, y + RH / 2, p[c.k], 5, i2 => i2 + 1, 4);
        else if (c.chk && p[c.k]) label('X', x + colsW[i] / 2, y + RH / 2, { bold: true, size: 9, align: 'center' });
        x += colsW[i];
      });
    });
    y += RH;
  }
  y += 4;

  /* blocos da modalidade */
  const hdr = (cols, h = 6) => { let x = M; cols.forEach(([t, w]) => { cell(x, y, w, h, t, { bold: true, size: 7, align: 'center', fill: HEAD }); x += w; }); y += h; };
  const blank = (v, fb) => (v ? String(v) : fb);
  if (d.kind === 'futsal') {
    need(6 + 8 * 4 + 4);
    const W = [24, 24, 90, 48]; hdr([['Período', W[0]], ['Equipe', W[1]], ['Faltas Acumuladas (6ª = Tiro Livre 10m)', W[2]], ['Pedido de Tempo', W[3]]]);
    cfg.periods.forEach(([p, pl]) => SIDES.forEach(([s, sl]) => {
      cell(M, y, W[0], 7.5, pl, { bold: true, size: 7.5, align: 'center' }); cell(M + W[0], y, W[1], 7.5, sl, { size: 7.5, align: 'center' });
      cell(M + W[0] + W[1], y, W[2], 7.5, ''); boxes(M + W[0] + W[1] + 24, y + 3.75, getPath(d, `fouls.${s}.${p}`), 5, i => i + 1, 4.6);
      cell(M + W[0] + W[1] + W[2], y, W[3], 7.5, 'Min: ' + blank(getPath(d, `tout.${s}.${p}`), '____ : ____'), { size: 7.5, align: 'center' }); y += 7.5;
    }));
    y += 4;
  } else if (d.kind === 'handebol') {
    need(6 + 8 * 2 + 4);
    const W = [30, 78, 78]; hdr([['PEDIDOS DE TEMPO', W[0]], ['1º Tempo (Minuto)', W[1]], ['2º Tempo (Minuto)', W[2]]]);
    SIDES.forEach(([s, sl]) => {
      cell(M, y, W[0], 8, `${sl}`, { bold: true, size: 7.5 });
      cfg.periods.forEach(([p], i) => cell(M + W[0] + i * W[1], y, W[1], 8, `T1: ${blank(getPath(d, `tout.${s}.${p}.0`), '____:____')}  |  T2: ${blank(getPath(d, `tout.${s}.${p}.1`), '____:____')}`, { size: 7.5, align: 'center' }));
      y += 8;
    });
    y += 4;
  } else if (d.kind === 'volei') {
    const n = setsCount(d); need(6 + 8 * n + 4);
    const W = [18, 62, 62, 44]; hdr([['Set', W[0]], ['Pedidos de Tempo — ' + teamName(d, 'a'), W[1]], ['Pedidos de Tempo — ' + teamName(d, 'b'), W[2]], ['Saque Inicial', W[3]]]);
    for (let i = 0; i < n; i++) {
      const p = 's' + (i + 1), to = s => `T1: ${blank(getPath(d, `tout.${s}.${p}.0`), '___ x ___')}  |  T2: ${blank(getPath(d, `tout.${s}.${p}.1`), '___ x ___')}`, sv = getPath(d, 'serve.' + p);
      cell(M, y, W[0], 8, `${i + 1}º Set`, { bold: true, size: 7.5, align: 'center' });
      cell(M + W[0], y, W[1], 8, to('a'), { size: 7.5, align: 'center' }); cell(M + W[0] + W[1], y, W[2], 8, to('b'), { size: 7.5, align: 'center' });
      cell(M + W[0] + W[1] + W[2], y, W[3], 8, ''); const sx = M + W[0] + W[1] + W[2] + 5;
      [['a', 'Eq. A'], ['b', 'Eq. B']].forEach(([s, l], j) => { boxes(sx + j * 20, y + 4, [sv === s], 1, () => (sv === s ? 'X' : ''), 4); label(l, sx + j * 20 + 6, y + 4); });
      y += 8;
    }
    y += 4;
  } else if (d.kind === 'basquete') {
    need(6 + 9 * 2 + 4);
    const W = [20, 98, 68]; hdr([['Equipe', W[0]], ['Faltas Coletivas por Quarto (5ª = 2 Lances Livres)', W[1]], ['Pedidos de Tempo', W[2]]]);
    SIDES.forEach(([s, sl]) => {
      cell(M, y, W[0], 9, sl, { bold: true, size: 7.5 }); cell(M + W[0], y, W[1], 9, ''); cell(M + W[0] + W[1], y, W[2], 9, '');
      ['q1', 'q2', 'q3', 'q4'].forEach((q, i) => { const qx = M + W[0] + 2 + i * 24; label(`${i + 1}ºQ`, qx, y + 4.5, { bold: true, size: 6.5 }); boxes(qx + 5.5, y + 4.5, getPath(d, `tfouls.${s}.${q}`), 4, j => j + 1, 3.2); });
      const tx = M + W[0] + W[1] + 2; label('1ºT', tx, y + 4.5, { bold: true, size: 6.5 }); boxes(tx + 5.5, y + 4.5, getPath(d, `tout.${s}.h1`), 2, j => j + 1, 3.6);
      label('2ºT', tx + 24, y + 4.5, { bold: true, size: 6.5 }); boxes(tx + 30, y + 4.5, getPath(d, `tout.${s}.h2`), 3, j => j + 1, 3.6);
      y += 9;
    });
    y += 4;
  }

  /* arbitragem, observações e assinaturas */
  need(6 + 7 * 2 + 4);
  cell(M, y, CW, 6, 'ARBITRAGEM E OCORRÊNCIAS', { bold: true, fill: HEAD }); y += 6;
  for (let i = 0; i < cfg.refs.length; i += 2) {
    const pair = cfg.refs.slice(i, i + 2);
    pair.forEach(([k, l], j) => cell(M + j * HW, y, pair.length === 1 ? CW : HW, 7, `${l}: ${d.refs[k] || ''}`, { bold: true, size: 8 }));
    y += 7;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const lines = doc.splitTextToSize(d.obs || '', CW - 5), oh = Math.min(230, Math.max(58, lines.length * 4.1 + 8));
  need(6 + oh + 26);
  cell(M, y, CW, 6, 'Observações / Relatório Disciplinar:', { bold: true, fill: HEAD }); y += 6;
  doc.rect(M, y, CW, oh); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(0);
  doc.text(lines.slice(0, 55), M + 2.5, y + 5, { baseline: 'middle', lineHeightFactor: 1.35 });
  y += oh + 8;
  const sw = CW / 3;
  [['Capitão ' + teamName(d, 'a')], ['Capitão ' + teamName(d, 'b')], ['1º Árbitro' + (d.refs.r1 ? ' — ' + d.refs.r1 : '')]].forEach(([t], i) => {
    cell(M + i * sw, y, sw, 22, '');
    doc.line(M + i * sw + 8, y + 12, M + (i + 1) * sw - 8, y + 12);
    label(doc.splitTextToSize(t, sw - 6)[0], M + i * sw + sw / 2, y + 17, { bold: true, size: 7.5, align: 'center' });
  });

  /* rodapé de cada página: quem criou, quem fechou, quando */
  const who = (e, at) => `${e || 'usuário desconhecido'} em ${stamp(at)}`;
  const l1 = `Criada por ${who(row.created_by_email, row.created_at)}` + (row.updated_by_email ? ` · última edição: ${who(row.updated_by_email, row.updated_at)}` : '');
  const l2 = (closed ? `FECHADA por ${who(row.closed_by_email, row.closed_at)}` : 'RASCUNHO — súmula ainda não fechada')
    + (row.reopened_by_email ? ` · reaberta por ${who(row.reopened_by_email, row.reopened_at)}` : '');
  const N = doc.getNumberOfPages();
  for (let i = 1; i <= N; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(110);
    doc.setDrawColor(190); doc.line(M, 285, M + CW, 285); doc.setDrawColor(40, 40, 40);
    doc.text(l1, M, 288.5); doc.text(l2, M, 292);
    doc.text(`JIAS 2026 · pág. ${i}/${N}`, M + CW, 288.5, { align: 'right' });
  }
  doc.setTextColor(0);
  return doc;
}

export async function downloadPdf(row) {
  const JsPDF = await loadPdf();
  drawPdf(JsPDF, row).save(pdfName(row));
}
