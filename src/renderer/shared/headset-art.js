// Desenho de headset (próprio do UnusHub), usado na lista da aba e na tela
// "Conecte seu headset".

const NS = 'http://www.w3.org/2000/svg';

// Arco da cabeça e as duas conchas, num quadro 200×200.
const BAND_PATH = 'M38 120 V100 A62 62 0 0 1 162 100 V120';

function headsetSvg(className, viewBox = '0 0 200 200') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', className);
  const add = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  add('path', { d: BAND_PATH, class: 'hs-band' });
  add('rect', { x: 22, y: 110, width: 36, height: 58, rx: 14, class: 'hs-cup' });
  add('rect', { x: 142, y: 110, width: 36, height: 58, rx: 14, class: 'hs-cup' });
  return { svg, add };
}

/** Ícone pequeno para os botões da lista. */
export function headsetIcon() {
  return headsetSvg('hs-icon', '14 30 172 146').svg;
}

/** Headset "desconectado": sinal sem fio piscando acima do arco. */
export function disconnectedHeadset() {
  const { svg, add } = headsetSvg('connect-art hs-art', '0 -20 200 200');
  // Microfone na concha esquerda.
  add('path', { d: 'M40 160 Q46 182 78 184', class: 'hs-mic' });
  for (const [i, r] of [10, 20, 30].entries()) {
    add('path', {
      d: `M${100 - r} ${18 - r * 0.2} A${r} ${r} 0 0 1 ${100 + r} ${18 - r * 0.2}`,
      class: `pad-signal pad-signal-${i}`,
    });
  }
  return svg;
}
