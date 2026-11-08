// Cartão com ícone e título, usado nas telas de configurações dos aparelhos
// (áudio dos headsets, luzes dos teclados). O ícone segue a cor da aba.

import { h } from '../core/dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Desenhos de traço (24×24), pintados com a cor do texto do ícone.
const ICONS = {
  speaker: ['M11 5 6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  equalizer: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  warning: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  vibration: ['M9 5h6v14H9z', 'M5 8v8', 'M19 8v8', 'M2 10v4', 'M22 10v4'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
  gauge: ['M12 14l4-4', 'M3.3 19a10 10 0 1 1 17.4 0'],
  mapping: ['M16 3h5v5', 'M21 3l-7 7', 'M8 21H3v-5', 'M3 21l7-7'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  keyboard: ['M3 6h18v12H3z', 'M7 10h.01', 'M11 10h.01', 'M15 10h.01', 'M7 14h10'],
  sparkles: ['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z', 'M5 3l.6 1.4L7 5l-1.4.6L5 7l-.6-1.4L3 5l1.4-.6z'],
};

export function strokeIcon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[kind] || []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/**
 * @param {keyof ICONS} kind  qual ícone
 * @param {string} title
 * @param {{ className?: string, aside?: Node | null }} [o]  classe extra do cartão; algo à direita do título
 */
export function iconCard(kind, title, { className = '', aside = null } = {}, ...children) {
  return h('section', { class: `card icon-card${className ? ` ${className}` : ''}` },
    h('div', { class: 'icon-card-head' },
      h('span', { class: 'icon-card-icon' }, strokeIcon(kind)),
      h('h3', {}, title),
      aside),
    ...children);
}
