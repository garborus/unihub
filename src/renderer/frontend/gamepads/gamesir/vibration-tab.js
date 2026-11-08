// Sub-aba "Vibração" do GameSir: testa os motores e mostra, no desenho do
// controle, qual lado está vibrando.

import { h } from '../../../core/dom.js';
import { controllerSvg, XBOX_PAD_PATH } from '../../../shared/controller-art.js';
import { iconCard } from '../../../shared/icon-card.js';

const STRENGTH = 200; // 0–255
const DURATION_MS = 700;

// Na ordem dos punhos do controle: esquerdo, os dois, direito.
const MODES = [
  { id: 'left', label: 'Motor esquerdo', side: '◀', motors: [STRENGTH, 0] },
  { id: 'both', label: 'Ambos', side: '◀ ▶', motors: [STRENGTH, STRENGTH] },
  { id: 'right', label: 'Motor direito', side: '▶', motors: [0, STRENGTH] },
];

export function vibrationTab(session, ctx) {
  const art = vibrationArt();
  let timer = 0;

  async function vibrate(mode) {
    clearTimeout(timer);
    art.classList.remove('vib-left', 'vib-right', 'vib-both');
    void art.getBoundingClientRect(); // reinicia a animação se clicar de novo
    art.classList.add(`vib-${mode.id}`);
    timer = setTimeout(() => art.classList.remove(`vib-${mode.id}`), DURATION_MS);
    try {
      await session.vibrate(mode.motors[0], mode.motors[1], DURATION_MS);
    } catch (err) {
      ctx.toast(`Vibração: ${err.message}`, 'error');
    }
  }

  // Mouse em cima de um botão: o lado do controle que vai vibrar fica marcado
  // (só no desenho; o controle só vibra ao clicar).
  const preview = (mode) => {
    art.classList.remove('vib-hover-left', 'vib-hover-right', 'vib-hover-both');
    if (mode) art.classList.add(`vib-hover-${mode.id}`);
  };

  return h('div', { class: 'vibration' },
    iconCard('vibration', 'Testar vibração', { className: 'vib-card' },
      h('p', { class: 'muted small' }, 'Cada botão liga o motor por menos de 1 segundo. O desenho mostra qual lado está vibrando.'),
      h('div', { class: 'vibration-stage' }, art),
      h('div', { class: 'vib-buttons' }, MODES.map((m) => h('button', {
        class: `btn secondary vib-btn ${m.id}`,
        onclick: () => vibrate(m),
        onmouseenter: () => preview(m), onmouseleave: () => preview(null),
        onfocus: () => preview(m), onblur: () => preview(null),
      }, h('span', { class: 'vib-btn-side', 'aria-hidden': 'true' }, m.side), m.label)))));
}

/** Controle com as duas metades destacáveis e ondas de vibração nos punhos. */
function vibrationArt() {
  const { svg, add } = controllerSvg('vib-art', XBOX_PAD_PATH);
  const defs = add('defs', {});
  for (const [id, x] of [['vib-clip-left', 0], ['vib-clip-right', 200]]) {
    const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clip.setAttribute('id', id);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [k, v] of Object.entries({ x, y: 0, width: 200, height: 325 })) rect.setAttribute(k, v);
    clip.append(rect);
    defs.append(clip);
  }
  add('path', { d: XBOX_PAD_PATH, class: 'vib-half vib-half-left', 'clip-path': 'url(#vib-clip-left)' });
  add('path', { d: XBOX_PAD_PATH, class: 'vib-half vib-half-right', 'clip-path': 'url(#vib-clip-right)' });
  // Ondas ao lado de cada punho.
  const waveY = 265;
  for (const [side, x, dir] of [['left', 6, -1], ['right', 394, 1]]) {
    for (const [i, r] of [10, 20, 30].entries()) {
      add('path', {
        d: `M${x + dir * r * 0.2} ${waveY - r} Q${x + dir * r} ${waveY} ${x + dir * r * 0.2} ${waveY + r}`,
        class: `vib-wave vib-wave-${side} vib-wave-${i}`,
      });
    }
  }
  return svg;
}
