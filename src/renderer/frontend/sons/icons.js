// Ícones da aba Sons e o botão só com ícone.

import { h } from '../../core/dom.js';

// Ícones de traço, no tamanho do texto, na cor do texto.
const SVG = 'http://www.w3.org/2000/svg';
function icon(...paths) {
  return () => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'sons-icon');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  };
}
export const icons = {
  play: icon('M8 5.5v13l10.5-6.5z'),
  stop: icon('M7 7h10v10H7z'),
  stopAll: icon('M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M9.5 9.5h5v5h-5z'),
  plus: icon('M12 5v14M5 12h14'),
  external: icon('M14 4h6v6M20 4l-8.5 8.5', 'M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5'),
  folder: icon('M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'),
  headphones: icon('M4 15v-3a8 8 0 0 1 16 0v3', 'M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z'),
  mic: icon('M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3z', 'M6 11.5a6 6 0 0 0 12 0M12 17.5v3'),
  trash: icon('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'),
  refresh: icon('M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4'),
  volume: icon('M4 9.5h3.5L12 6v12l-4.5-3.5H4z', 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'),
  keyboard: icon('M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z', 'M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17.5 10.5h.01M8 14h8'),
  note: icon('M9 17.5V6l10-2v11.5', 'M9 17.5a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 17.5zM19 15.5a2.5 2.5 0 1 1-2.5-2.5 2.5 2.5 0 0 1 2.5 2.5z'),
};

export function iconButton(draw, label, onclick, disabled = false) {
  return h('button', { class: 'btn icon-btn sons-icon-btn', title: label, 'aria-label': label, onclick, disabled }, draw());
}
