// Card "Informações" em largura total: cada dado num quadro (rótulo em cima,
// valor embaixo). Nome e conexão do aparelho já ficam no cabeçalho da aba.

import { h } from '../core/dom.js';
import { iconCard } from './icon-card.js';

/** VID:PID com uma explicação curta, útil para relatar problemas. */
export function vidPidRow(vidPid) {
  return h('span', { class: 'vidpid' },
    h('strong', {}, vidPid),
    h('small', { class: 'muted' }, 'fabricante : modelo/modo. Informe este código ao relatar um problema.'));
}

/**
 * @param {object} o
 * @param {[string, Node|string][]} o.rows  pares rótulo/valor
 * @param {string} [o.note]                 texto pequeno abaixo dos dados
 * @param {{name: string, connection?: string|null}} [o.label]  (não usado: o cabeçalho da aba já mostra)
 */
export function infoCard({ rows, note }) {
  return iconCard('info', 'Informações', { className: 'info-card' },
    h('dl', { class: 'fact-tiles' }, rows.map(([dt, dd]) => h('div', { class: 'fact-tile' },
      h('dt', {}, dt),
      h('dd', {}, dd)))),
    note ? h('p', { class: 'muted small' }, note) : null);
}
