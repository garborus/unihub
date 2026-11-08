// Aba "Luzes" dos teclados AULA série F (pelo cabo ou pelo receptor).
// Só para AULA: efeitos, posições dos bytes e comandos são desta marca.
//
// Lê o bloco de luz e a tabela de cores do teclado e mostra o efeito atual.
// Cada mudança vai para o teclado na hora, a partir do que foi lido: o resto
// da configuração (teclas, macros) não muda.

import { h, clear, card, button } from '../../../core/dom.js';
import { openColorPicker } from '../../../shared/color-picker.js';
import { iconCard } from '../../../shared/icon-card.js';
import {
  EFFECTS, MAX_BRIGHTNESS, MAX_SPEED, COLORFUL, COLORS_PER_EFFECT, FACTORY_COLORS,
  readLedState, withEffect, effectColors, withColor, withFactoryColors,
} from '../../../plugins/teclados/aula/protocol.js';

const SPEED_TEXT = ['Muito lenta', 'Lenta', 'Média', 'Rápida', 'Muito rápida'];

/**
 * @param {import('../../../plugins/teclados/aula/session.js').AulaSession} session
 * @param {{ maxBrightness?: number }} [o]  brilho máximo do modelo (F75: 9; F87/F99: 4)
 */
export function aulaLightsTab(session, { maxBrightness = MAX_BRIGHTNESS } = {}) {
  const root = h('div', { class: 'aula-lights' });
  // Estado da gravação, como etiqueta no topo do cartão de efeitos.
  const status = h('span', { class: 'aula-status', role: 'status' });
  let block = null; // bloco de luz (128 bytes)
  let table = null; // tabela de cores
  let busy = Promise.resolve();

  const say = (text, kind = '') => {
    status.textContent = text;
    status.className = 'aula-status ' + (kind || 'ok');
  };

  async function load() {
    clear(root, card('Luzes', h('p', { class: 'muted' }, 'Lendo as luzes do teclado…')));
    try {
      block = await session.readLed();
      table = await session.readColors();
      render();
      say('Mudanças são salvas no teclado na hora.');
      // Efeito só colorido que ficou com uma cor (ex.: escolhido no app oficial): corrige.
      const { effect, colorMode } = readLedState(block);
      if (EFFECTS.find((e) => e.code === effect)?.colors === false && colorMode !== COLORFUL) change({ colorMode: COLORFUL });
    } catch (err) {
      clear(root, card('Não foi possível ler as luzes',
        h('p', {}, String(err.message || err)),
        h('p', { class: 'muted' }, 'Feche o app oficial da AULA (inclusive perto do relógio) e, no sem fio, deixe o teclado perto do dongle.'),
        button('Tentar de novo', load)));
    }
  }

  /** Grava em fila: uma mudança por vez, na ordem em que foram feitas. */
  function save(task) {
    say('Salvando no teclado…', 'saving');
    busy = busy.then(task).then(
      () => say('Salvo no teclado.'),
      (err) => say(`Não foi salvo: ${err.message || err}. Aproxime o teclado do dongle e tente de novo.`, 'error'),
    );
    return busy;
  }

  function change(settings) {
    if (settings.brightness !== undefined) settings = { ...settings, brightness: Math.min(settings.brightness, maxBrightness) };
    block = withEffect(block, readLedState(block).effect, settings);
    render();
    const snapshot = block;
    save(() => session.writeLed(snapshot));
  }

  function selectEffect(code) {
    // Efeito só com as próprias cores: grava já no modo colorido.
    const onlyColorful = EFFECTS.find((e) => e.code === code)?.colors === false;
    block = withEffect(block, code, onlyColorful ? { colorMode: COLORFUL } : {});
    render();
    const snapshot = block;
    save(() => session.writeLed(snapshot));
  }

  function editColor(index, anchor, dot) {
    const { effect } = readLedState(block);
    openColorPicker({
      anchor,
      value: effectColors(table, effect)[index],
      onPreview: (hex) => dot.style.setProperty('background', hex),
      onConfirm: (hex) => {
        table = withColor(table, effect, index, hex);
        block = withEffect(block, effect, { colorMode: index });
        render();
        const [t, b] = [table, block];
        // O teclado aplica a cor nova quando o bloco de luz é gravado depois da tabela.
        save(async () => {
          await session.writeColors(t);
          await session.writeLed(b);
        });
      },
      onCancel: () => render(),
    });
  }

  function restoreColors() {
    table = withFactoryColors(table, readLedState(block).effect);
    render();
    const [t, b] = [table, block];
    save(async () => {
      await session.writeColors(t);
      await session.writeLed(b);
    });
  }

  function render() {
    const { effect, brightness, speed, colorMode } = readLedState(block);
    const known = EFFECTS.find((e) => e.code === effect);
    const colors = effectColors(table, effect);

    const effects = iconCard('sparkles', 'Efeito', { className: 'aula-card', aside: status },
      h('div', { class: 'preset-grid aula-effects' }, EFFECTS.map((e) => h('button', {
        class: 'btn' + (e.code === effect ? ' selected' : ''),
        'aria-pressed': String(e.code === effect),
        onclick: () => selectEffect(e.code),
      }, e.name))),
      known ? null : h('p', { class: 'muted small' }, `O teclado está num efeito que o UniHub ainda não conhece (código ${effect}).`));

    const shown = Math.min(brightness, maxBrightness);
    const brightnessValue = h('span', { class: 'aula-value' }, shown === 0 ? 'Apagado' : `${shown}`);
    const speedValue = h('span', { class: 'aula-value' }, SPEED_TEXT[speed] ?? speed);

    const swatches = colors.map((hex, i) => {
      const dot = h('span', { class: 'swatch-dot', style: `background:${hex}` });
      const sw = h('button', {
        class: 'swatch' + (colorMode === i ? ' selected' : ''),
        'aria-label': `Cor ${i + 1}`,
        'aria-pressed': String(colorMode === i),
        onclick: () => (colorMode === i ? editColor(i, sw, dot) : change({ colorMode: i })),
      }, dot, h('small', {}, colorMode === i ? 'Trocar' : `${i + 1}`));
      return sw;
    });
    const colorful = h('button', {
      class: 'swatch' + (colorMode === COLORFUL ? ' selected' : ''),
      'aria-pressed': String(colorMode === COLORFUL),
      onclick: () => change({ colorMode: COLORFUL }),
    }, h('span', { class: 'swatch-dot colorful' }), h('small', {}, 'Colorido'));

    const showColors = known?.colors !== false;
    const showSpeed = known?.speed !== false;
    // Controle deslizante com o nome e o valor em cima e as pontas embaixo.
    const slider = (label, value, ends, input) => h('label', { class: 'aula-field' },
      h('span', { class: 'aula-field-head' }, h('span', {}, label), value),
      input,
      h('span', { class: 'aula-ends muted small', 'aria-hidden': 'true' }, h('span', {}, ends[0]), h('span', {}, ends[1])));

    const settings = iconCard('equalizer', `Ajustes de ${known ? known.name : 'efeito'}`, { className: 'aula-card' },
      h('p', { class: 'muted small' }, 'Cada efeito guarda o próprio brilho, velocidade e cores.'),
      slider('Brilho', brightnessValue, ['Apagado', 'Máximo'], h('input', {
        type: 'range', min: 0, max: maxBrightness, step: 1, value: Math.min(brightness, maxBrightness),
        oninput: (e) => { brightnessValue.textContent = e.target.value === '0' ? 'Apagado' : e.target.value; },
        onchange: (e) => change({ brightness: Number(e.target.value) }),
      })),
      !showSpeed ? null : slider('Velocidade', speedValue, [SPEED_TEXT[0], SPEED_TEXT[MAX_SPEED]], h('input', {
        type: 'range', min: 0, max: MAX_SPEED, step: 1, value: speed,
        oninput: (e) => { speedValue.textContent = SPEED_TEXT[e.target.value]; },
        onchange: (e) => change({ speed: Number(e.target.value) }),
      })),
      // Efeito só colorido: sem escolha de cor (o colorido é gravado ao escolher o efeito).
      !showColors ? null : h('div', { class: 'aula-field aula-colors' },
        h('span', {}, 'Cor'),
        h('div', { class: 'light-swatches aula-swatches' }, swatches, colorful),
        h('small', { class: 'muted' }, `Clique numa cor para usar; clique de novo para trocá-la. São ${COLORS_PER_EFFECT} cores guardadas por efeito.`),
        h('div', { class: 'row' }, button('Restaurar cores', restoreColors, {
          disabled: colors.every((hex, i) => hex === FACTORY_COLORS[i]),
        }))),
      showColors ? null : h('p', { class: 'muted small aula-field aula-colors' }, 'Este efeito usa as próprias cores (colorido).'));

    clear(root, h('div', { class: 'aula-lights-grid' }, effects, settings));
  }

  load();
  return root;
}

