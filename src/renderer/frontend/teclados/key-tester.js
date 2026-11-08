// Teste de teclas: desenho do teclado em que cada tecla acende enquanto está
// apertada e fica marcada depois de testada.
//
// Usa os eventos de teclado da página: o Chromium não deixa ler a interface
// de teclado pelo WebHID. Por isso o teste não sabe de qual teclado veio a
// tecla: vale para qualquer teclado conectado.
//
// Um desenho só, sem escolha: teclado genérico = completo, no padrão do idioma
// do sistema (ABNT2 em português); marca conhecida = o desenho do modelo.

import { h, clear, button } from '../../core/dom.js';
import { keyboardLayout, defaultLayout, keyLabel } from '../../plugins/teclados/layouts.js';
import { iconCard } from '../../shared/icon-card.js';

// O progresso continua ao trocar de aba; "Limpar teste" zera.
const tested = new Set();
let maxTogether = 0;
let layoutMap = null;
let stopPrevious = null;

/**
 * @param {object} [o]
 * @param {'full'|'f75'} [o.shape]    formato do desenho (ex.: 'f75' para o AULA F75)
 * @param {'abnt2'|'ansi'} [o.kind]   variante; sem ela, a do idioma do sistema
 */
export function keyTester({ shape = 'full', kind = defaultLayout(navigator.language) } = {}) {
  stopPrevious?.(); // só um teste escutando o teclado por vez
  const pressed = new Set();
  const keyEls = new Map(); // code da tecla desenhada -> elemento
  const codeToKey = new Map(); // code recebido -> code da tecla desenhada (ex.: volume -> botão)

  const board = h('div', { class: 'kt-board' });
  const progress = h('span', { class: 'kt-count' });
  const progressFill = h('span', { class: 'kt-progress-fill' });
  const together = h('span', { class: 'pill kt-together' });
  const otherList = h('div', { class: 'kt-others' });

  const clearButton = button('Limpar teste', () => {
    tested.clear();
    maxTogether = 0;
    paint();
  });
  const root = iconCard('keyboard', 'Teste de teclas', { className: 'kt-card', aside: clearButton },
    h('p', { class: 'muted small' }, 'Aperte as teclas: cada uma acende enquanto está apertada e fica marcada depois de testada. O Windows não informa de qual teclado veio a tecla, então o teste vale para qualquer teclado conectado.'),
    // Progresso: barra que enche conforme as teclas são testadas, e quantas estão apertadas juntas.
    h('div', { class: 'kt-toolbar' },
      h('div', { class: 'kt-progress-wrap' },
        progress,
        h('span', { class: 'kt-progress', 'aria-hidden': 'true' }, progressFill)),
      together),
    board,
    otherList,
    h('p', { class: 'muted small' }, 'Fn e algumas teclas especiais do teclado não chegam ao Windows e não aparecem aqui. Win e Print Screen podem abrir atalhos do Windows.'));

  function renderBoard() {
    keyEls.clear();
    codeToKey.clear();
    const { width, height, keys } = keyboardLayout(kind, shape);
    board.style.aspectRatio = `${width} / ${height}`;
    const pct = (v, total) => `${(v / total) * 100}%`;
    clear(board, keys.map((k) => {
      const el = h('span', {
        class: 'kt-key' + (k.round ? ' round' : '') + (k.fixed ? ' fixed' : ''),
        style: `left:${pct(k.x, width)};top:${pct(k.y, height)};width:${pct(k.w, width)};height:${pct(k.h, height)}`,
      }, h('span', {}, keyLabel(k.code, layoutMap)));
      // Teclas só desenhadas (Fn) não contam no teste.
      if (!k.fixed) {
        keyEls.set(k.code, el);
        for (const c of k.codes || [k.code]) codeToKey.set(c, k.code);
      }
      return el;
    }));
    paint();
  }

  function paint() {
    const down = new Set([...pressed].map((c) => codeToKey.get(c) || c));
    const done = new Set([...tested].map((c) => codeToKey.get(c) || c));
    for (const [code, el] of keyEls) {
      el.classList.toggle('down', down.has(code));
      el.classList.toggle('tested', done.has(code));
    }
    const onBoard = [...done].filter((c) => keyEls.has(c)).length;
    progress.textContent = `${onBoard} de ${keyEls.size} teclas testadas`;
    progressFill.style.width = `${keyEls.size ? (onBoard / keyEls.size) * 100 : 0}%`;
    together.textContent = `Juntas agora: ${pressed.size} (máximo: ${maxTogether})`;
    const others = [...tested].filter((c) => !codeToKey.has(c));
    clear(otherList, others.length
      ? [h('small', { class: 'muted' }, 'Outras teclas: '), ...others.map((c) => h('span', { class: 'pill' }, c))]
      : null);
  }

  // Só escuta com o teste na tela e sem nenhuma janela (diálogo) aberta.
  const active = () => root.isConnected && root.offsetParent !== null && !document.querySelector('dialog[open]');

  function onDown(e) {
    if (!root.isConnected) return stop();
    if (!active()) return;
    e.preventDefault(); // Tab, espaço, setas, F5... não mexem no app durante o teste
    if (e.repeat) return;
    const code = e.code || e.key;
    pressed.add(code);
    tested.add(code);
    maxTogether = Math.max(maxTogether, pressed.size);
    paint();
  }

  function onUp(e) {
    if (!root.isConnected) return stop();
    if (!active()) return;
    e.preventDefault();
    const code = e.code || e.key;
    pressed.delete(code);
    // Print Screen só avisa ao soltar.
    tested.add(code);
    paint();
  }

  // Trocar de janela com uma tecla apertada não pode deixá-la "presa".
  function onBlur() {
    pressed.clear();
    if (root.isConnected) paint();
  }

  function stop() {
    window.removeEventListener('keydown', onDown, true);
    window.removeEventListener('keyup', onUp, true);
    window.removeEventListener('blur', onBlur);
    if (stopPrevious === stop) stopPrevious = null;
  }

  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup', onUp, true);
  window.addEventListener('blur', onBlur);
  stopPrevious = stop;

  renderBoard();

  // Letras do layout em uso no Windows (ex.: Ç no ABNT2).
  if (!layoutMap && navigator.keyboard?.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then((map) => {
      layoutMap = map;
      if (root.isConnected) renderBoard();
    }).catch(() => {});
  }

  return root;
}
