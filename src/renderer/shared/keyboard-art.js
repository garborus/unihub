// Desenho de teclado (próprio do UnusHub), usado na lista da aba, no menu e na
// tela "Conecte seu teclado". Usa as classes do desenho do controle
// (pad-body/pad-part), que já têm as cores de cada lugar do app.

const NS = 'http://www.w3.org/2000/svg';

function keyboardSvg(className, viewBox) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', className);
  const add = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  // Corpo 200×84; três fileiras de 10 teclas e a barra de espaço.
  add('rect', { x: 10, y: 14, width: 200, height: 84, rx: 10, class: 'pad-body' });
  for (const y of [25, 42, 59]) {
    for (let i = 0; i < 10; i++) add('rect', { x: 22 + i * 18, y, width: 14, height: 13, rx: 2.5, class: 'pad-part' });
  }
  add('rect', { x: 58, y: 76, width: 104, height: 12, rx: 2.5, class: 'pad-part' });
  return { svg, add };
}

/** Ícone pequeno para os botões da lista e o menu. */
export function keyboardIcon() {
  return keyboardSvg('pad-icon kb-icon', '6 10 208 92').svg;
}

/** Teclado "desconectado": cabo solto e um sinal sem fio piscando. */
export function disconnectedKeyboard() {
  const { svg, add } = keyboardSvg('connect-art kb-art', '0 -58 220 160');
  add('path', { d: 'M110 14 C110 -6 128 -14 140 -30 L146 -38', class: 'pad-cable' });
  add('rect', { x: 140, y: -52, width: 13, height: 16, rx: 3, class: 'pad-plug', transform: 'rotate(40 146 -44)' });
  for (const [i, r] of [8, 15, 22].entries()) {
    add('path', {
      d: `M${60 - r} ${4 - r * 0.2} A${r} ${r} 0 0 1 ${60 + r} ${4 - r * 0.2}`,
      class: `pad-signal pad-signal-${i}`,
    });
  }
  return svg;
}
