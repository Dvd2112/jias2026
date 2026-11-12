/* Identidade visual das atléticas: logo + paleta, indexados pelo NOME da atlética.
   Qualquer lugar do site que mostra uma atlética chama identityOf(nome) e já recebe logo e cores.
   Nome desconhecido (atlética nova) recebe uma identidade neutra com as iniciais. */

const T = (key, name, sigla, aliases, [primary, secondary, accent]) => ({
  key, name, sigla, aliases, primary, secondary, accent, logo: `assets/teams/${key}.webp`,
});

export const IDENTITIES = [
  T('corsarios', 'Corsários', 'AAACSAUFB', [], ['#C41E1E', '#1A1A1A', '#D9C8A0']),
  T('macaco', 'Macaco', 'AAACSUFB', [], ['#3B3B8F', '#7A7A7A', '#1A1A4A']),
  T('urso', 'Urso', 'AAAD CESUL', [], ['#8B5A2B', '#1C4A7C', '#C9A24B']),
  T('marreco', 'Marreco', 'AAAFB X de Maio', [], ['#1F6B3B', '#E8A317', '#FFFFFF']),
  T('indio', 'Índio', 'AADUP', [], ['#8B2020', '#FFFFFF', '#B0B0B0']),
  T('lobo', 'Sanguinária', 'AAAMEDFB', ['lobo', 'medicina'], ['#17213B', '#9BA3AC', '#FFFFFF']),
  T('predadores', 'Predadores', 'AAACHUFB', [], ['#1FB6C9', '#1A3A6B', '#5C1F6B']),
  T('devora', 'Devora', 'AAANUFB', ['nutricao'], ['#34205C', '#E8A91E', '#FFFFFF']),
];

// emojis do mascote de cada atlética (usados na comemoração ao abrir a página dela)
const MASCOTS = {
  corsarios: ['🏴‍☠️', '☠️', '⚓'],
  macaco: ['🐒', '🍌', '🙈'],
  urso: ['🐻', '🍯', '🐾'],
  marreco: ['🦆', '💚', '🖤'],
  indio: ['🪶', '🏹', '🔥'],
  lobo: ['🐺', '🌕', '🩸'],
  predadores: ['🦈', '🌊', '💪'],
  devora: ['🐰', '🍎', '🏋️'],
};

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// cor de texto legível (preto ou branco) sobre um fundo, pela maior razão de contraste WCAG
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function inkOn(hex) {
  const L = luminance(hex);
  return (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 ? '#FFFFFF' : '#111111';
}

const BY_NAME = new Map();
IDENTITIES.forEach(id => {
  id.ink = inkOn(id.primary);
  id.mascots = MASCOTS[id.key] || ['🏆'];
  [id.key, id.name, id.sigla, ...id.aliases].forEach(n => BY_NAME.set(norm(n), id));
});

const NEUTRAL = { key: null, mascots: ['🏆', '🎉'], primary: '#0F2744', secondary: '#C9A34B', accent: '#F4EFE6', ink: '#FFFFFF', logo: null };

export function identityOf(name) {
  const id = BY_NAME.get(norm(name));
  if (id) return id;
  // atlética nova: iniciais + cor derivada do nome (estável), sem logo
  const n = norm(name), hue = [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const primary = hslHex(hue, 55, 32);
  return { ...NEUTRAL, primary, ink: inkOn(primary), initials: (String(name).match(/\p{L}/gu) || ['?']).slice(0, 2).join('').toUpperCase() };
}
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}

/* ---------- tema do site inteiro (atlética seguida) ----------
   Troca as variáveis base do CSS (--navy, --cream, --gold, --hd) garantindo contraste legível. */
export const mixHex = (a, b, t) => {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
export const contrast = (a, b) => { const x = luminance(a) + .05, y = luminance(b) + .05; return Math.max(x, y) / Math.min(x, y); };
export function themeOf(id) {
  let navy = id.primary;                                           // base escura: precisa de texto branco legível
  for (let i = 0; i < 8 && contrast(navy, '#ffffff') < 4.5; i++) navy = mixHex(navy, '#000000', .18);
  const cream = mixHex(id.primary, '#ffffff', .93);               // fundo da página
  const gold = [id.secondary, id.accent, mixHex(id.primary, '#ffffff', .6), '#ffffff'].find(c => contrast(c, navy) >= 3) || '#ffffff';
  const hd = [id.secondary, id.primary, navy].find(c => contrast(c, cream) >= 4.5) || navy;   // títulos sobre o fundo claro
  return { navy, navy2: mixHex(navy, '#ffffff', .14), cream, gold, hd };
}
