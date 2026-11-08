// Teste de botões visual: um controle desenhado que acende cada botão
// apertado, move os sticks e enche os gatilhos. Lê pela Gamepad API.
//
// Usa o "mapeamento padrão" da Gamepad API (o mesmo do controle Xbox):
//   0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 8 View · 9 Menu
//   10 L3 · 11 R3 · 12 ↑ · 13 ↓ · 14 ← · 15 → · 16 Home
//   eixos 0/1 = stick esquerdo, 2/3 = stick direito
// Nos controles da Sony: 0 ✕ · 1 ○ · 2 □ · 3 △ · 4 L1 · 5 R1 · 6 L2 · 7 R2
//   8 Share · 9 Options · 16 PS · 17 touchpad
// No Pro Controller, pela posição: 0 B · 1 A · 2 Y · 3 X · 4 L · 5 R · 6 ZL · 7 ZR
//   8 − · 9 + · 16 Home · 17 Captura

import { h, clear } from '../core/dom.js';
import { controllerSvg, SONY_PAD_PATH, PRO_PAD_PATH, XBOX_PAD_PATH } from './controller-art.js';

const TICK_MS = 33;
const STICK_TRAVEL = 9;

const MID = 200;

// Desenho padrão: espelhado no eixo central do controle (x = 200), cada elemento
// da esquerda tem um par na mesma altura do lado direito.
const UPPER_Y = 138; // stick esquerdo  ↔ botões A/B/X/Y
const LOWER_Y = 198; // direcional      ↔ stick direito
const UPPER_DX = 85;
const LOWER_DX = 45;
const CENTER_Y = 112; // View · Home · Menu

const FACE_X = MID + UPPER_DX;
const FACE_GAP = 26;
const FACE = [
  { i: 0, label: 'A', x: FACE_X, y: UPPER_Y + FACE_GAP },
  { i: 1, label: 'B', x: FACE_X + FACE_GAP, y: UPPER_Y },
  { i: 2, label: 'X', x: FACE_X - FACE_GAP, y: UPPER_Y },
  { i: 3, label: 'Y', x: FACE_X, y: UPPER_Y - FACE_GAP },
];

const DPAD_X = MID - LOWER_DX;
const CELL = 16;
const cell = (dx, dy) => `M${DPAD_X + dx * CELL - CELL / 2} ${LOWER_Y + dy * CELL - CELL / 2} h${CELL} v${CELL} h-${CELL} Z`;
const DPAD = [
  { i: 12, d: cell(0, -1) },
  { i: 13, d: cell(0, 1) },
  { i: 14, d: cell(-1, 0) },
  { i: 15, d: cell(1, 0) },
];

const STICKS = [
  { press: 10, axes: [0, 1], x: MID - UPPER_DX, y: UPPER_Y },
  { press: 11, axes: [2, 3], x: MID + LOWER_DX, y: LOWER_Y },
];

const TRIGGER_W = 46;
const TRIGGER_H = 30;
const TRIGGERS = [
  { i: 6, label: 'LT', cx: MID - UPPER_DX, y: 30 },
  { i: 7, label: 'RT', cx: MID + UPPER_DX, y: 30 },
];
const BUMPERS = [
  { i: 4, label: 'LB', d: 'M88 86 Q110 70 150 72 L150 84 Q115 84 92 96 Z', lx: 122, ly: 81 },
  { i: 5, label: 'RB', d: 'M312 86 Q290 70 250 72 L250 84 Q285 84 308 96 Z', lx: 278, ly: 81 },
];
const SMALL = [
  { i: 8, x: MID - 30, y: CENTER_Y },
  { i: 9, x: MID + 30, y: CENTER_Y },
];
const HOME = 16;
const HOME_GLYPH = 'M-4 0.5 L0 -3.5 L4 0.5 M-2.8 -0.5 V3.5 H2.8 V-0.5';

// Desenho dos controles GameSir: corpo e gatilhos do Xbox, com sticks em anéis, direcional em
// cruz e as faixas de luz nos punhos.
const GS_TOP_Y = 118;
const GS_LOW_Y = 177;
const GS_DPAD_X = 149;
const GS_DPAD_Y = 187;
const GS_FACE_X = 296;
const GS_FACE_Y = 120;
const GS_FACE_GAP = 25;
const GS_STICKS = [
  { press: 10, axes: [0, 1], x: 102, y: GS_TOP_Y },
  { press: 11, axes: [2, 3], x: 249, y: GS_LOW_Y },
];
const GS_FACE = [
  { i: 0, label: 'A', x: GS_FACE_X, y: GS_FACE_Y + GS_FACE_GAP },
  { i: 1, label: 'B', x: GS_FACE_X + GS_FACE_GAP, y: GS_FACE_Y },
  { i: 2, label: 'X', x: GS_FACE_X - GS_FACE_GAP, y: GS_FACE_Y },
  { i: 3, label: 'Y', x: GS_FACE_X, y: GS_FACE_Y - GS_FACE_GAP },
];
const GS_TRIGGERS = [
  { i: 6, label: 'LT', cx: 84, y: 8 },
  { i: 7, label: 'RT', cx: 316, y: 8 },
];
const GS_TRIGGER_H = 26;
const GS_LIGHT_STRIPS = [
  'M54 116 Q44 150 40 175 Q38 190 50 198 L96 227',
  'M346 116 Q356 150 360 175 Q362 190 350 198 L304 227',
];
// Índices no desenho do GameSir para os botões que a Gamepad API não informa.
export const GAMESIR_EXTRA_INDEX = { capture: 17, l4: 18, r4: 19, m: 20 };

// L4 e R4 do Cyclone 2: botões de trás, desenhados fora do corpo, abaixo do recorte.
const CYCLONE2_PADDLES = [
  { i: GAMESIR_EXTRA_INDEX.l4, label: 'L4', d: 'M139 282 V267 Q139 259 147 259 H168 Q176 259 176 267 V292 L160 317 Q158 320 155 317 L139 288 Z', lx: 158, ly: 283 },
  { i: GAMESIR_EXTRA_INDEX.r4, label: 'R4', d: 'M261 282 V267 Q261 259 253 259 H232 Q224 259 224 267 V292 L240 317 Q242 320 245 317 L261 288 Z', lx: 242, ly: 283 },
];

// Desenho dos controles Xbox: stick esquerdo e botões no alto, direcional e stick direito embaixo.
const XBOX_TOP_Y = 124;
const XBOX_LOW_Y = 185;
const XBOX_CENTER_GAP = 28; // View e Menu, a partir do centro
const XBOX_HOME_Y = 85;
const XBOX_DPAD_X = 148;
const XBOX_FACE_X = 301;
const XBOX_FACE_GAP = 27;
const XBOX_STICKS = [
  { press: 10, axes: [0, 1], x: 101, y: XBOX_TOP_Y },
  { press: 11, axes: [2, 3], x: 251, y: XBOX_LOW_Y },
];
const XBOX_FACE = [
  { i: 0, label: 'A', x: XBOX_FACE_X, y: XBOX_TOP_Y + XBOX_FACE_GAP },
  { i: 1, label: 'B', x: XBOX_FACE_X + XBOX_FACE_GAP, y: XBOX_TOP_Y },
  { i: 2, label: 'X', x: XBOX_FACE_X - XBOX_FACE_GAP, y: XBOX_TOP_Y },
  { i: 3, label: 'Y', x: XBOX_FACE_X, y: XBOX_TOP_Y - XBOX_FACE_GAP },
];
const XBOX_TRIGGER_H = 26;
const XBOX_TRIGGERS = [
  { i: 6, label: 'LT', cx: 84, y: 14 },
  { i: 7, label: 'RT', cx: 316, y: 14 },
];
const XBOX_BUMPERS = [
  { i: 4, label: 'LB', d: 'M66 79 Q78 58 98 52 Q122 46 146 57 L146 64 Q130 60 116 62 Q80 66 66 79 Z', lx: 112, ly: 56 },
  { i: 5, label: 'RB', d: 'M334 79 Q322 58 302 52 Q278 46 254 57 L254 64 Q270 60 284 62 Q320 66 334 79 Z', lx: 288, ly: 56 },
];
const XBOX_TOP_BAR = 'M146 57 H254 V64 H146 Z';
const XBOX_PANEL_LINES = [
  'M116 63 Q134 64 148 88 Q164 106 200 106 Q236 106 252 88 Q266 64 284 63',
  XBOX_TOP_BAR,
];

// Braços do direcional, desenhados para cima e girados em volta do centro.
const DPAD_ARMS = [
  { i: 12, angle: 0 },
  { i: 13, angle: 180 },
  { i: 14, angle: 270 },
  { i: 15, angle: 90 },
];

// Desenho dos controles da Sony: direcional e símbolos no alto, sticks embaixo.
const SONY_TOP_Y = 121; // direcional ↔ botões de símbolo
const SONY_DPAD_X = 79;
const SONY_FACE_X = MID + (MID - SONY_DPAD_X);
const SONY_FACE_GAP = 28;
const SONY_RING_R = 46;
const SONY_STICK_Y = 178;
const SONY_STICKS = [
  { press: 10, axes: [0, 1], x: MID - 62, y: SONY_STICK_Y },
  { press: 11, axes: [2, 3], x: MID + 62, y: SONY_STICK_Y },
];
const SONY_FACE = [
  { i: 0, x: SONY_FACE_X, y: SONY_TOP_Y + SONY_FACE_GAP, symbol: 'cross' },
  { i: 1, x: SONY_FACE_X + SONY_FACE_GAP, y: SONY_TOP_Y, symbol: 'circle' },
  { i: 2, x: SONY_FACE_X - SONY_FACE_GAP, y: SONY_TOP_Y, symbol: 'square' },
  { i: 3, x: SONY_FACE_X, y: SONY_TOP_Y - SONY_FACE_GAP, symbol: 'triangle' },
];
const SONY_TRIGGERS = [
  { i: 6, label: 'L2', cx: 84, y: 4 },
  { i: 7, label: 'R2', cx: 316, y: 4 },
];
const SONY_TRIGGER_H = 26;
const SONY_BUMPERS = [
  { i: 4, label: 'L1', d: 'M58 56 Q58 40 72 37 Q88 33 102 37 Q110 40 110 56 Q85 50 58 56 Z', lx: 84, ly: 45 },
  { i: 5, label: 'R1', d: 'M342 56 Q342 40 328 37 Q312 33 298 37 Q290 40 290 56 Q315 50 342 56 Z', lx: 316, ly: 45 },
];
const SONY_SMALL = [
  { i: 8, x: 121 },
  { i: 9, x: 279 },
];
const SONY_TOUCHPAD = 17;
const SONY_SPEAKER = [[143, 5], [149, 4], [155, 3]]; // [y, furos]

// Desenho do Pro Controller: stick esquerdo e botões no alto, direcional e stick direito embaixo.
const PRO_TOP_Y = 124;
const PRO_LOW_Y = 177;
const PRO_FACE_X = 304;
const PRO_FACE_GAP = 26;
const PRO_DPAD_X = 142;
const PRO_STICKS = [
  { press: 10, axes: [0, 1], x: 94, y: PRO_TOP_Y },
  { press: 11, axes: [2, 3], x: 253, y: PRO_LOW_Y },
];
const PRO_FACE = [
  { i: 0, label: 'B', x: PRO_FACE_X, y: PRO_TOP_Y + PRO_FACE_GAP },
  { i: 1, label: 'A', x: PRO_FACE_X + PRO_FACE_GAP, y: PRO_TOP_Y },
  { i: 2, label: 'Y', x: PRO_FACE_X - PRO_FACE_GAP, y: PRO_TOP_Y },
  { i: 3, label: 'X', x: PRO_FACE_X, y: PRO_TOP_Y - PRO_FACE_GAP },
];
const PRO_TRIGGERS = [
  { i: 6, label: 'ZL', cx: 84, y: 6 },
  { i: 7, label: 'ZR', cx: 316, y: 6 },
];
const PRO_TRIGGER_H = 26;
const PRO_BUMPERS = [
  { i: 4, label: 'L', d: 'M46 72 Q52 52 72 46 Q100 40 126 52 Q85 56 46 72 Z', lx: 88, ly: 50 },
  { i: 5, label: 'R', d: 'M354 72 Q348 52 328 46 Q300 40 274 52 Q315 56 354 72 Z', lx: 312, ly: 50 },
];
const PRO_SEAMS = [
  'M44 78 Q120 60 200 58 Q280 60 356 78',
  'M28 130 Q60 180 105 234',
  'M372 130 Q340 180 295 234',
];
const PRO_CAPTURE = 17;

/** O id da Gamepad API traz o vendor: "Wireless Controller (... Vendor: 054c Product: 09cc)". */
export function isSonyGamepad(pad) {
  return /vendor:\s*054c/i.test(pad.id);
}

/** No Windows, controles em XInput chegam sem vendor: "Xbox 360 Controller (XInput STANDARD GAMEPAD)". */
export function isXboxGamepad(pad) {
  return /xbox|xinput|vendor:\s*045e/i.test(pad.id);
}

export function isProController(pad) {
  return /vendor:\s*057e\s+product:\s*2009/i.test(pad.id);
}

const DEFAULT_HINT = 'Clique nesta janela e aperte qualquer botão do controle para ele aparecer aqui.';

/**
 * @param {object} [o]
 * @param {(pads: Gamepad[]) => Gamepad[]} [o.select]  quais gamepads mostrar (padrão: todos)
 * @param {(pads: Gamepad[]) => string} [o.hint]       texto quando nenhum é mostrado
 * @param {() => number[]} [o.extraPressed]            botões apertados que a Gamepad API não informa
 * @param {'gamesir'|'cyclone2'} [o.art]               desenho fixo, para quem já sabe o modelo
 *                                                     (em modo Xbox, o id não diz que é GameSir)
 */
export function gamepadVisualTester({ select = (pads) => pads, hint: hintText = () => DEFAULT_HINT, art = null, extraPressed = () => [] } = {}) {
  const root = h('div', { class: 'gp-tester' });
  const visuals = new Map(); // gamepad.index -> visual
  // Sem controle mostrado: desenho do controle "esperando", título e a dica.
  const hintText_ = h('p', { class: 'muted small' });
  const hint = h('div', { class: 'gp-waiting' },
    h('span', { class: 'gp-waiting-art', 'aria-hidden': 'true' }, controllerSvg('gp-waiting-svg', XBOX_PAD_PATH).svg),
    h('strong', {}, 'Aperte um botão do controle'),
    hintText_);

  const timer = setInterval(() => {
    if (!root.isConnected) {
      if (root.dataset.mounted) clearInterval(timer);
      return;
    }
    root.dataset.mounted = '1';
    const all = [...navigator.getGamepads()].filter(Boolean);
    const pads = select(all);
    for (const index of visuals.keys()) {
      if (!pads.some((p) => p.index === index)) {
        visuals.get(index).el.remove();
        visuals.delete(index);
      }
    }
    for (const pad of pads) {
      if (!visuals.has(pad.index)) {
        const standard = art ? (p) => buildGameSirVisual(p, art === 'cyclone2')
          : isSonyGamepad(pad) ? buildSonyVisual
          : isProController(pad) ? buildProVisual
            : isXboxGamepad(pad) ? buildXboxVisual : buildVisual;
        const v = pad.mapping === 'standard' ? standard(pad) : buildRawVisual(pad);
        visuals.set(pad.index, v);
        root.append(v.el);
      }
      visuals.get(pad.index).update(pad, extraPressed());
    }
    hint.hidden = pads.length > 0;
    if (!hint.hidden) {
      const text = all.length ? hintText(all) : DEFAULT_HINT;
      if (hintText_.textContent !== text) hintText_.textContent = text;
    }
  }, TICK_MS);

  root.append(hint);
  return root;
}

function buildVisual(pad) {
  const { svg, add } = controllerSvg('gp-art');
  // Recorte justo em volta do desenho (gatilhos em cima, punhos embaixo),
  // para o controle ficar centralizado no quadro.
  svg.setAttribute('viewBox', '20 22 360 277');
  const { parts, text, mark, trigger, bumper, stick } = artTools(add);

  for (const t of TRIGGERS) trigger(t, TRIGGER_H);
  for (const b of BUMPERS) bumper(b);
  const sticks = STICKS.map((s) => stick(s, 26, 17));
  add('path', { d: cell(0, 0), class: 'gp-dpad-center' });
  for (const d of DPAD) mark(d.i, add('path', { d: d.d, class: 'gp-btn' }));
  for (const f of FACE) {
    mark(f.i, add('circle', { cx: f.x, cy: f.y, r: 13, class: `gp-btn gp-face gp-face-${f.label}` }));
    text(f.x, f.y, f.label);
  }
  for (const s of SMALL) {
    mark(s.i, add('rect', { x: s.x - 9, y: s.y - 5, width: 18, height: 10, rx: 5, class: 'gp-btn' }));
  }
  mark(HOME, add('circle', { cx: MID, cy: CENTER_Y, r: 12, class: 'gp-btn gp-home' }));

  return finishVisual(pad, svg, parts, sticks, NAMES);
}

function buildGameSirVisual(pad, paddles) {
  const { svg, add } = controllerSvg('gp-art gp-lineart', XBOX_PAD_PATH);
  svg.setAttribute('viewBox', '0 2 400 322');
  const { parts, text, mark, trigger, bumper, ringStick, glyph } = artTools(add);
  // Botão em pílula inclinada, para View e Menu.
  const pill = (i, x, y, angle) => mark(i, add('rect', {
    x: x - 5, y: y - 11, width: 10, height: 22, rx: 5, transform: `rotate(${angle} ${x} ${y})`, class: 'gp-btn',
  }));

  for (const t of GS_TRIGGERS) trigger(t, GS_TRIGGER_H);
  for (const b of XBOX_BUMPERS) bumper(b);
  add('path', { d: XBOX_TOP_BAR, class: 'gp-line-ring' });
  for (const d of GS_LIGHT_STRIPS) add('path', { d, class: 'gp-line-ring gp-line-strip' });

  const sticks = GS_STICKS.map((s) => ringStick(s, 27, 24, 18, 12));
  add('circle', { cx: GS_DPAD_X, cy: GS_DPAD_Y, r: 33, class: 'gp-line-ring' });
  for (const d of DPAD_ARMS) {
    const transform = `translate(${GS_DPAD_X} ${GS_DPAD_Y}) rotate(${d.angle})`;
    mark(d.i, add('path', { d: 'M-10 -10 V-26 Q-10 -30 -6 -30 H6 Q10 -30 10 -26 V-10 Z', transform, class: 'gp-btn' }));
  }
  for (const f of GS_FACE) {
    mark(f.i, add('circle', { cx: f.x, cy: f.y, r: 13, class: 'gp-btn' }));
    text(f.x, f.y, f.label);
  }
  pill(8, 149, 87, 30);
  pill(9, 251, 87, -30);
  mark(HOME, add('circle', { cx: MID, cy: 85, r: 13, class: 'gp-btn' }));
  glyph(MID, 85, HOME_GLYPH);
  mark(GAMESIR_EXTRA_INDEX.capture, add('rect', { x: MID - 11, y: 110, width: 22, height: 10, rx: 5, class: 'gp-btn' }));
  mark(GAMESIR_EXTRA_INDEX.m, add('rect', { x: MID - 12, y: 203, width: 24, height: 13, rx: 4, class: 'gp-btn' }));
  text(MID, 209.5, 'M', 'gp-label small');
  if (paddles) {
    for (const p of CYCLONE2_PADDLES) {
      mark(p.i, add('path', { d: p.d, class: 'gp-btn' }));
      text(p.lx, p.ly, p.label, 'gp-label small');
    }
  }

  return finishVisual(pad, svg, parts, sticks, GS_NAMES);
}

function buildXboxVisual(pad) {
  const { svg, add } = controllerSvg('gp-art gp-lineart', XBOX_PAD_PATH);
  svg.setAttribute('viewBox', '0 8 400 316');
  const { parts, text, mark, trigger, bumper, ringStick, glyph } = artTools(add);

  for (const t of XBOX_TRIGGERS) trigger(t, XBOX_TRIGGER_H);
  for (const b of XBOX_BUMPERS) bumper(b);
  for (const d of XBOX_PANEL_LINES) add('path', { d, class: 'gp-line-ring' });

  const sticks = XBOX_STICKS.map((s) => ringStick(s, 29, 26, 20, 13));
  add('circle', { cx: XBOX_DPAD_X, cy: XBOX_LOW_Y, r: 32, class: 'gp-line-ring' });
  for (const d of DPAD_ARMS) {
    const transform = `translate(${XBOX_DPAD_X} ${XBOX_LOW_Y}) rotate(${d.angle})`;
    mark(d.i, add('path', { d: 'M-9 -9 V-25 Q-9 -28 -6 -28 H6 Q9 -28 9 -25 V-9 Z', transform, class: 'gp-btn' }));
  }
  for (const f of XBOX_FACE) {
    mark(f.i, add('circle', { cx: f.x, cy: f.y, r: 14, class: 'gp-btn' }));
    text(f.x, f.y, f.label);
  }
  mark(8, add('circle', { cx: MID - XBOX_CENTER_GAP, cy: XBOX_TOP_Y, r: 9, class: 'gp-btn' }));
  glyph(MID - XBOX_CENTER_GAP, XBOX_TOP_Y, 'M-4.5 -4.5 H1.5 V1.5 H-4.5 Z M-1.5 1.5 V4.5 H4.5 V-1.5 H1.5');
  mark(9, add('circle', { cx: MID + XBOX_CENTER_GAP, cy: XBOX_TOP_Y, r: 9, class: 'gp-btn' }));
  glyph(MID + XBOX_CENTER_GAP, XBOX_TOP_Y, 'M-4.5 -3 H4.5 M-4.5 0 H4.5 M-4.5 3 H4.5');
  mark(HOME, add('circle', { cx: MID, cy: XBOX_HOME_Y, r: 12, class: 'gp-btn' }));
  glyph(MID, XBOX_HOME_Y, HOME_GLYPH);

  return finishVisual(pad, svg, parts, sticks, NAMES);
}

function buildSonyVisual(pad) {
  const { svg, add } = controllerSvg('gp-art gp-lineart', SONY_PAD_PATH);
  svg.setAttribute('viewBox', '0 -2 400 298');
  const { parts, text, mark, trigger, bumper, ringStick } = artTools(add);

  for (const t of SONY_TRIGGERS) trigger(t, SONY_TRIGGER_H);
  for (const b of SONY_BUMPERS) bumper(b);
  mark(SONY_TOUCHPAD, add('rect', { x: 136, y: 60, width: 128, height: 74, rx: 7, class: 'gp-btn' }));
  for (const s of SONY_SMALL) {
    mark(s.i, add('rect', { x: s.x - 6, y: 70, width: 12, height: 23, rx: 6, class: 'gp-btn' }));
  }

  for (const x of [SONY_DPAD_X, SONY_FACE_X]) {
    add('circle', { cx: x, cy: SONY_TOP_Y, r: SONY_RING_R, class: 'gp-line-ring' });
  }
  for (const d of DPAD_ARMS) {
    const transform = `translate(${SONY_DPAD_X} ${SONY_TOP_Y}) rotate(${d.angle})`;
    mark(d.i, add('path', { d: 'M-11 -30 Q-11 -34 -7 -34 H7 Q11 -34 11 -30 V-14 L0 -3 L-11 -14 Z', transform, class: 'gp-btn' }));
    add('path', { d: 'M-5 -37 H5 L0 -43 Z', transform, class: 'gp-line-arrow' });
  }
  for (const f of SONY_FACE) {
    mark(f.i, add('circle', { cx: f.x, cy: f.y, r: 12.5, class: 'gp-btn' }));
    faceSymbol(add, f);
  }

  for (const [y, holes] of SONY_SPEAKER) {
    for (let n = 0; n < holes; n++) {
      add('circle', { cx: MID + (n - (holes - 1) / 2) * 7, cy: y, r: 1.6, class: 'gp-sony-speaker' });
    }
  }
  const sticks = SONY_STICKS.map((s) => ringStick(s, 37, 31, 24, 15));
  mark(HOME, add('circle', { cx: MID, cy: SONY_STICK_Y, r: 11, class: 'gp-btn' }));
  text(MID, SONY_STICK_Y, 'PS', 'gp-label small');

  return finishVisual(pad, svg, parts, sticks, SONY_NAMES);
}

function buildProVisual(pad) {
  const { svg, add } = controllerSvg('gp-art gp-lineart', PRO_PAD_PATH);
  svg.setAttribute('viewBox', '0 0 400 322');
  const { parts, text, mark, trigger, bumper, ringStick, glyph } = artTools(add);

  for (const t of PRO_TRIGGERS) trigger(t, PRO_TRIGGER_H);
  for (const b of PRO_BUMPERS) bumper(b);
  for (const d of PRO_SEAMS) add('path', { d, class: 'gp-line-ring' });

  const sticks = PRO_STICKS.map((s) => ringStick(s, 31, 27, 21, 14));
  for (const d of DPAD_ARMS) {
    const transform = `translate(${PRO_DPAD_X} ${PRO_LOW_Y}) rotate(${d.angle})`;
    mark(d.i, add('path', { d: 'M-8 -24 Q-8 -28 -4 -28 H4 Q8 -28 8 -24 V-9 L0 -1 L-8 -9 Z', transform, class: 'gp-btn' }));
    add('path', { d: 'M-3 -16 H3 L0 -21 Z', transform, class: 'gp-line-arrow' });
  }
  for (const f of PRO_FACE) {
    mark(f.i, add('circle', { cx: f.x, cy: f.y, r: 14, class: 'gp-btn' }));
    text(f.x, f.y, f.label);
  }
  mark(8, add('circle', { cx: 154, cy: 95, r: 9, class: 'gp-btn' }));
  glyph(154, 95, 'M-4.5 0 H4.5');
  mark(9, add('circle', { cx: 246, cy: 95, r: 9, class: 'gp-btn' }));
  glyph(246, 95, 'M-4.5 0 H4.5 M0 -4.5 V4.5');
  mark(PRO_CAPTURE, add('rect', { x: 167, y: 117, width: 14, height: 14, rx: 3, class: 'gp-btn' }));
  glyph(174, 124, 'M-3.5 0 A3.5 3.5 0 1 1 3.5 0 A3.5 3.5 0 1 1 -3.5 0 Z');
  mark(HOME, add('circle', { cx: 226, cy: 124, r: 9, class: 'gp-btn' }));
  glyph(226, 124, HOME_GLYPH);

  return finishVisual(pad, svg, parts, sticks, PRO_NAMES);
}

function faceSymbol(add, { x, y, symbol }) {
  const cls = `gp-sony-symbol gp-sony-${symbol}`;
  if (symbol === 'circle') add('circle', { cx: x, cy: y, r: 6, class: cls });
  if (symbol === 'square') add('rect', { x: x - 5, y: y - 5, width: 10, height: 10, class: cls });
  if (symbol === 'triangle') add('path', { d: `M${x} ${y - 7} L${x + 6.5} ${y + 4} H${x - 6.5} Z`, class: cls });
  if (symbol === 'cross') add('path', { d: `M${x - 5} ${y - 5} L${x + 5} ${y + 5} M${x + 5} ${y - 5} L${x - 5} ${y + 5}`, class: cls });
}

/** Peças comuns aos desenhos; `parts` guarda índice do botão -> elemento(s) que acendem. */
function artTools(add) {
  const parts = new Map();
  // Texto centralizado no ponto (x, y), na horizontal e na vertical.
  const text = (x, y, label, cls = 'gp-label') => {
    const t = add('text', { x, y, class: cls, 'dominant-baseline': 'central' });
    t.textContent = label;
    return t;
  };
  const mark = (i, el) => parts.set(i, [...(parts.get(i) || []), el]);
  const trigger = (t, height) => {
    const x = t.cx - TRIGGER_W / 2;
    add('rect', { x, y: t.y, width: TRIGGER_W, height, rx: 8, class: 'gp-trigger' });
    const fill = add('rect', { x, y: t.y + height, width: TRIGGER_W, height: 0, rx: 8, class: 'gp-trigger-fill' });
    fill.dataset.base = String(t.y + height);
    fill.dataset.full = String(height);
    mark(t.i, fill);
    text(t.cx, t.y + height / 2, t.label);
  };
  const bumper = (b) => {
    mark(b.i, add('path', { d: b.d, class: 'gp-btn' }));
    text(b.lx, b.ly, b.label, 'gp-label small');
  };
  const stick = (s, wellR, capR) => {
    add('circle', { cx: s.x, cy: s.y, r: wellR, class: 'gp-stick-well' });
    // Ondas que se espalham enquanto o stick está apertado (L3/R3).
    const ripples = [0, 1, 2].map((n) => add('circle', { cx: s.x, cy: s.y, r: capR + 5, class: `gp-ripple gp-ripple-${n}` }));
    const cap = add('circle', { cx: s.x, cy: s.y, r: capR, class: 'gp-btn gp-stick' });
    mark(s.press, cap);
    return { ...s, cap, moving: [cap], ripples };
  };
  // Stick em anéis, para os desenhos só de linhas.
  const ringStick = (s, ringR, wellR, capR, topR) => {
    add('circle', { cx: s.x, cy: s.y, r: ringR, class: 'gp-line-ring' });
    const built = stick(s, wellR, capR);
    const top = add('circle', { cx: s.x, cy: s.y, r: topR, class: 'gp-line-stick-top' });
    return { ...built, moving: [built.cap, top] };
  };
  // Desenho dentro de um botão, centrado em (x, y); acende junto com ele.
  const glyph = (x, y, d) => add('path', { d, transform: `translate(${x} ${y})`, class: 'gp-line-mark' });
  return { parts, text, mark, trigger, bumper, stick, ringStick, glyph };
}

/** Moldura e atualização, iguais para todos os desenhos. */
function finishVisual(pad, svg, parts, sticks, names) {
  const pressedList = h('p', { class: 'muted small gp-pressed' });
  const el = h('div', { class: 'gp-pad' },
    h('div', { class: 'pad-head' }, h('strong', {}, `#${pad.index + 1}`), ' ', pad.id),
    h('div', { class: 'gp-stage' }, svg),
    pressedList);

  return {
    el,
    update(p, extra = []) {
      const buttons = p.buttons.map((b, i) => (extra.includes(i) ? { pressed: true, value: 1 } : b));
      for (const i of extra) buttons[i] = buttons[i] || { pressed: true, value: 1 };
      // Percorre as peças, não os botões: um botão extra solto some da lista e precisa apagar.
      for (const [i, nodes] of parts) {
        const b = buttons[i] || { pressed: false, value: 0 };
        for (const node of nodes) {
          node.classList.toggle('on', b.pressed);
          if (node.dataset.base) {
            const height = Math.round(Number(node.dataset.full) * b.value);
            node.setAttribute('y', String(Number(node.dataset.base) - height));
            node.setAttribute('height', String(height));
          }
        }
      }
      for (const s of sticks) {
        const ax = p.axes[s.axes[0]] || 0;
        const ay = p.axes[s.axes[1]] || 0;
        const cx = String(s.x + ax * STICK_TRAVEL);
        const cy = String(s.y + ay * STICK_TRAVEL);
        for (const node of s.moving) {
          node.setAttribute('cx', cx);
          node.setAttribute('cy', cy);
        }
        // Só mexe nos anéis quando algo muda: regravar a posição reinicia a animação.
        const pressed = !!p.buttons[s.press]?.pressed;
        for (const r of s.ripples) {
          if (r.getAttribute('cx') !== cx) r.setAttribute('cx', cx);
          if (r.getAttribute('cy') !== cy) r.setAttribute('cy', cy);
          if (r.classList.contains('on') !== pressed) r.classList.toggle('on', pressed);
        }
      }
      const pressed = buttons.map((b, i) => (b?.pressed ? names[i] || `B${i}` : null)).filter(Boolean);
      pressedList.textContent = pressed.length ? `Apertado: ${pressed.join(' + ')}` : 'Nenhum botão apertado';
    },
  };
}

const NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→', 'Home'];
const PRO_NAMES = ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L3', 'R3', '↑', '↓', '←', '→', 'Home', 'Captura'];
const GS_NAMES = [...NAMES, 'Captura', 'L4', 'R4', 'M'];
const SONY_NAMES = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→', 'PS', 'Touchpad'];

/** Controle sem mapeamento padrão: mostra só a lista de botões e eixos. */
function buildRawVisual(pad) {
  const buttons = h('div', { class: 'pad-buttons' });
  const el = h('div', { class: 'gp-pad' },
    h('div', { class: 'pad-head' }, h('strong', {}, `#${pad.index + 1}`), ' ', pad.id, h('span', { class: 'pill' }, 'não padrão')),
    buttons);
  return {
    el,
    update(p) {
      clear(buttons, p.buttons.map((b, i) => h('span', { class: 'pad-btn' + (b.pressed ? ' on' : '') }, `B${i}`)));
    },
  };
}
