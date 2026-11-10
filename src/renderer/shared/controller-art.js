// Desenho de controle (próprio do UnusHub), usado no editor de luzes e na tela
// "Conecte seu controle".

const NS = 'http://www.w3.org/2000/svg';

export const PAD_PATH =
  'M120 85 Q200 70 280 85 Q330 92 345 140 L370 250 Q378 283 345 287 Q318 289 300 263 L282 237 ' +
  'Q200 225 118 237 L100 263 Q82 289 55 287 Q22 283 30 250 L55 140 Q70 92 120 85 Z';

/** Corpo no formato dos controles Xbox (ombros marcados e punhos largos), o mesmo dos GameSir. */
export const XBOX_PAD_PATH =
  'M146 64 L254 64 Q270 60 284 62 Q320 66 334 79 Q346 86 351 101 Q368 140 380 185 Q390 220 392 249 ' +
  'Q394 275 390 294 Q386 306 374 310 Q360 318 345 318 Q338 316 332 310 Q318 295 306 271 Q296 254 284 245 ' +
  'Q275 242 261 242 L139 242 Q125 242 116 245 Q104 254 94 271 Q82 295 68 310 Q62 316 55 318 Q40 318 26 310 ' +
  'Q14 306 10 294 Q6 275 8 249 Q10 220 20 185 Q32 140 49 101 Q54 86 66 79 Q80 66 116 62 Q130 60 146 64 Z';

/** Corpo no formato dos controles da Sony (punhos mais longos e touchpad no topo). */
export const SONY_PAD_PATH =
  'M114 60 L286 60 Q292 57 296 56 Q325 52 344 58 Q354 62 361 81 Q372 105 378 133 Q392 190 393 224 ' +
  'Q395 245 393 258 Q390 280 378 284 Q366 291 356 289 Q338 287 327 275 Q319 262 313 247 L290 204 ' +
  'Q276 218 264 216 Q245 216 230 204 L170 204 Q155 216 136 216 Q124 218 110 204 L87 247 ' +
  'Q81 262 73 275 Q62 287 44 289 Q34 291 22 284 Q10 280 7 258 Q5 245 7 224 Q8 190 22 133 ' +
  'Q28 105 39 81 Q46 62 56 58 Q75 52 104 56 Q108 57 114 60 Z';

/** Corpo no formato do Pro Controller (topo arredondado e punhos separados). */
export const PRO_PAD_PATH =
  'M200 50 Q270 50 330 62 Q352 68 360 83 Q368 100 372 129 Q384 190 388 220 Q394 250 393 269 ' +
  'Q392 295 380 302 Q365 318 351 315 Q338 314 331 306 Q322 292 314 269 Q302 248 293 236 ' +
  'Q290 233 285 234 L115 234 Q110 233 107 236 Q98 248 86 269 Q78 292 69 306 Q62 314 49 315 ' +
  'Q35 318 20 302 Q8 295 7 269 Q6 250 12 220 Q16 190 28 129 Q32 100 40 83 Q48 68 70 62 Q130 50 200 50 Z';

/** Cria um <svg> 400×325 com o corpo do controle. Devolve { svg, add }. */
export function controllerSvg(className, body = PAD_PATH) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 325');
  svg.setAttribute('class', className);
  const add = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  add('path', { d: body, class: 'pad-body' });
  if (body === PAD_PATH) {
    add('circle', { cx: 150, cy: 135, r: 20, class: 'pad-part' });
    add('circle', { cx: 245, cy: 185, r: 20, class: 'pad-part' });
    add('circle', { cx: 200, cy: 112, r: 10, class: 'pad-part' });
  }
  if (body === XBOX_PAD_PATH) {
    for (const [cx, cy] of [[101, 124], [251, 185]]) add('circle', { cx, cy, r: 22, class: 'pad-part' });
    add('path', { d: 'M140 157 h16 v20 h20 v16 h-20 v20 h-16 v-20 h-20 v-16 h20 Z', class: 'pad-part' });
    for (const [dx, dy] of [[0, -24], [24, 0], [0, 24], [-24, 0]]) {
      add('circle', { cx: 301 + dx, cy: 124 + dy, r: 9, class: 'pad-part' });
    }
  }
  return { svg, add };
}

/** Versão simplificada do controle Xbox e GameSir, para botões e cartões. */
export function xboxControllerIcon(className) {
  const { svg } = controllerSvg(className, XBOX_PAD_PATH);
  svg.setAttribute('viewBox', '0 48 400 274');
  return svg;
}

/** Versão simplificada do controle da Sony, para botões e cartões. */
export function sonyControllerIcon(className) {
  const { svg, add } = controllerSvg(className, SONY_PAD_PATH);
  svg.setAttribute('viewBox', '0 44 400 254');
  add('rect', { x: 140, y: 68, width: 120, height: 56, rx: 8, class: 'pad-part' });
  add('path', { d: 'M71 91 h16 v22 h22 v16 h-22 v22 h-16 v-22 h-22 v-16 h22 Z', class: 'pad-part' });
  for (const [dx, dy] of [[0, -24], [24, 0], [0, 24], [-24, 0]]) {
    add('circle', { cx: 321 + dx, cy: 121 + dy, r: 9, class: 'pad-part' });
  }
  for (const cx of [138, 262]) add('circle', { cx, cy: 178, r: 24, class: 'pad-part' });
  return svg;
}

/** Versão simplificada do Pro Controller, para botões e cartões. */
export function proControllerIcon(className) {
  const { svg, add } = controllerSvg(className, PRO_PAD_PATH);
  svg.setAttribute('viewBox', '0 44 400 278');
  for (const [cx, cy] of [[94, 124], [253, 177]]) add('circle', { cx, cy, r: 24, class: 'pad-part' });
  add('path', { d: 'M134 149 h16 v20 h20 v16 h-20 v20 h-16 v-20 h-20 v-16 h20 Z', class: 'pad-part' });
  for (const [dx, dy] of [[0, -24], [24, 0], [0, 24], [-24, 0]]) {
    add('circle', { cx: 304 + dx, cy: 124 + dy, r: 9, class: 'pad-part' });
  }
  return svg;
}

/** Controle "desconectado": cabo solto e um sinal sem fio piscando. */
export function disconnectedController() {
  const { svg, add } = controllerSvg('connect-art');
  svg.setAttribute('viewBox', '0 -60 400 355');
  add('path', { d: 'M200 78 C200 40 230 30 250 10 L262 -2', class: 'pad-cable' });
  add('rect', { x: 255, y: -22, width: 22, height: 26, rx: 4, class: 'pad-plug', transform: 'rotate(40 266 -9)' });
  for (const [i, r] of [14, 26, 38].entries()) {
    add('path', {
      d: `M${110 - r} ${40 - r * 0.2} A${r} ${r} 0 0 1 ${110 + r} ${40 - r * 0.2}`,
      class: `pad-signal pad-signal-${i}`,
    });
  }
  return svg;
}
