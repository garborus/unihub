// Seletor de cores do UnusHub, com confirmação.
//
// O seletor nativo do navegador não aceita botões extras, então este faz o
// mesmo papel: área saturação/brilho, barra de matiz, campos R/G/B e hex, e
// os botões Cancelar e Confirmar. A cor só é aplicada ao confirmar; enquanto
// isso, `onPreview` permite mostrar a cor provisória (ex.: no desenho).

import { h } from '../core/dom.js';

let openPicker = null; // só um seletor aberto por vez

/**
 * @param {object} o
 * @param {Element} o.anchor          elemento clicado (o seletor abre embaixo dele)
 * @param {string} o.value            cor inicial "#rrggbb"
 * @param {(hex: string) => void} [o.onPreview]
 * @param {(hex: string) => void} o.onConfirm
 * @param {() => void} [o.onCancel]
 */
export function openColorPicker({ anchor, value, onPreview = () => {}, onConfirm, onCancel = () => {} }) {
  openPicker?.cancel();

  const original = normalize(value);
  let { h: hue, s, v } = rgbToHsv(hexToRgb(original));

  const svArea = h('div', { class: 'cp-sv' });
  const svKnob = h('div', { class: 'cp-sv-knob' });
  svArea.append(svKnob);
  const hueInput = h('input', { type: 'range', min: 0, max: 360, class: 'cp-hue' });
  const before = h('span', { class: 'cp-swatch' });
  const after = h('span', { class: 'cp-swatch' });
  const hexInput = h('input', { class: 'cp-hex', maxlength: 7, spellcheck: 'false' });
  const rgbInputs = ['R', 'G', 'B'].map(() => h('input', { type: 'number', min: 0, max: 255, class: 'cp-num' }));

  const panel = h('div', { class: 'color-picker', role: 'dialog', 'aria-label': 'Escolher cor' },
    svArea,
    h('div', { class: 'cp-row' }, h('div', { class: 'cp-compare', title: 'Antes / depois' }, before, after), hueInput),
    h('div', { class: 'cp-fields' },
      h('label', {}, hexInput, h('span', {}, 'Hex')),
      rgbInputs.map((input, i) => h('label', {}, input, h('span', {}, 'RGB'[i])))),
    h('div', { class: 'cp-actions' },
      h('button', { class: 'btn secondary', onclick: () => close(false) }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: () => close(true) }, 'Confirmar')));

  before.style.background = original;

  function current() {
    return rgbToHex(hsvToRgb({ h: hue, s, v }));
  }

  function render({ skipHex = false, skipRgb = false } = {}) {
    const hex = current();
    svArea.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue} 100% 50%))`;
    svKnob.style.left = `${s * 100}%`;
    svKnob.style.top = `${(1 - v) * 100}%`;
    svKnob.style.background = hex;
    hueInput.value = String(Math.round(hue));
    after.style.background = hex;
    if (!skipHex) hexInput.value = hex;
    if (!skipRgb) hexToRgb(hex).forEach((c, i) => { rgbInputs[i].value = String(c); });
    onPreview(hex);
  }

  function setFromRgb(rgb, opts) {
    ({ h: hue, s, v } = rgbToHsv(rgb));
    render(opts);
  }

  // Arrastar na área de saturação/brilho.
  function pickSv(e) {
    const r = svArea.getBoundingClientRect();
    s = clamp01((e.clientX - r.left) / r.width);
    v = 1 - clamp01((e.clientY - r.top) / r.height);
    render();
  }
  svArea.addEventListener('pointerdown', (e) => {
    svArea.setPointerCapture(e.pointerId);
    pickSv(e);
    svArea.onpointermove = pickSv;
  });
  svArea.addEventListener('pointerup', () => { svArea.onpointermove = null; });

  hueInput.addEventListener('input', () => { hue = Number(hueInput.value); render(); });
  hexInput.addEventListener('input', () => {
    const hex = normalize(hexInput.value, null);
    if (hex) setFromRgb(hexToRgb(hex), { skipHex: true });
  });
  rgbInputs.forEach((input) => input.addEventListener('input', () => {
    const rgb = rgbInputs.map((x) => Math.max(0, Math.min(255, Math.round(Number(x.value) || 0))));
    setFromRgb(rgb, { skipRgb: true });
  }));

  const onKey = (e) => {
    if (e.key === 'Escape') close(false);
    if (e.key === 'Enter') close(true);
  };
  const onOutside = (e) => {
    if (!panel.contains(e.target) && !anchor.contains(e.target)) close(false);
  };

  function close(confirm) {
    if (openPicker !== api) return;
    openPicker = null;
    panel.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
    if (confirm) onConfirm(current());
    else {
      onPreview(original);
      onCancel();
    }
  }

  const api = { cancel: () => close(false) };
  openPicker = api;

  document.body.append(panel);
  render();
  position(panel, anchor);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true));
  return api;
}

/** Abre embaixo do elemento, sem sair da janela. */
function position(panel, anchor) {
  const a = anchor.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const margin = 8;
  let left = a.left;
  let top = a.bottom + margin;
  if (left + p.width > innerWidth - margin) left = innerWidth - p.width - margin;
  if (top + p.height > innerHeight - margin) top = Math.max(margin, a.top - p.height - margin);
  panel.style.left = `${Math.max(margin, left)}px`;
  panel.style.top = `${top}px`;
}

// --- Conversões de cor ------------------------------------------------------

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export function normalize(value, fallback = '#000000') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60; // sem arredondar: arredondar a matiz muda a cor em 1 unidade
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h: hue, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round);
}
