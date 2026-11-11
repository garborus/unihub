// Arrastar um cartão muda a ordem Arrastar próprio, com o
// mouse: o cartão "levanta" e segue o ponteiro, o lugar dele vira um espaço
// tracejado e os outros cartões deslizam para abrir espaço. Só começa depois de
// mover uns pixels, para os cliques nos botões continuarem funcionando.
//
// Vale para os cartões .sons-tile[data-id] com a classe can-reorder, dentro de uma
// lista .sons-grid que fica num .sons-library. Estilos em styles.css (reorder-*).

const DRAG_START_PX = 6;
const SLIDE_MS = 200;
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} o
 * @param {(ids: string[], changed: boolean) => void} o.onFinish  chamado ao soltar, com os
 *   ids na ordem nova e se a ordem mudou
 * @returns {{ onTilePointerDown: (e: PointerEvent) => void, dragging: () => boolean }}
 */
export function createTileReorder({ onFinish }) {
  let reorder = null; // { tile, pointerId, startX, startY, started, ghost, grid, library, baseX, baseY, original }

  function onTilePointerDown(e) {
    const tile = e.currentTarget;
    if (e.button !== 0 || reorder || !tile.classList.contains('can-reorder')) return;
    reorder = { tile, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, started: false };
    window.addEventListener('pointermove', onReorderMove);
    window.addEventListener('pointerup', onReorderEnd);
    window.addEventListener('pointercancel', onReorderEnd);
  }

  function beginReorder() {
    const { tile } = reorder;
    const library = tile.closest('.sons-library');
    const lib = library.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    // A cópia fica dentro do cartão "Seus sons" (mesmos estilos), por cima de tudo.
    const ghost = tile.cloneNode(true);
    ghost.classList.add('sons-tile-ghost');
    ghost.removeAttribute('data-id');
    ghost.setAttribute('aria-hidden', 'true');
    reorder.baseX = r.left - lib.left - library.clientLeft;
    reorder.baseY = r.top - lib.top - library.clientTop;
    ghost.style.left = `${reorder.baseX}px`;
    ghost.style.top = `${reorder.baseY}px`;
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    library.append(ghost);
    tile.classList.add('reorder-placeholder');
    document.body.classList.add('sons-reordering');
    Object.assign(reorder, { started: true, ghost, library, grid: tile.parentElement, original: tileIds(tile.parentElement) });
  }

  const tileIds = (grid) => [...grid.querySelectorAll('.sons-tile[data-id]')].map((t) => t.dataset.id);

  // Cartão sob o ponteiro, pela posição de layout (sem as animações em curso,
  // para não ficar trocando de lugar enquanto os cartões deslizam).
  function tileAt(x, y) {
    const { grid } = reorder;
    const g = grid.getBoundingClientRect();
    const px = x - g.left - grid.clientLeft + grid.scrollLeft;
    const py = y - g.top - grid.clientTop + grid.scrollTop;
    return [...grid.querySelectorAll('.sons-tile[data-id]')].find((t) => !t.hidden
      && px >= t.offsetLeft && px <= t.offsetLeft + t.offsetWidth && py >= t.offsetTop && py <= t.offsetTop + t.offsetHeight);
  }

  // Move o espaço vazio para o lugar do alvo e faz os cartões deslizarem (FLIP).
  function moveTo(target) {
    const { grid, tile } = reorder;
    const tiles = [...grid.querySelectorAll('.sons-tile[data-id]')];
    const before = new Map(tiles.map((t) => [t, t.getBoundingClientRect()]));
    if (tiles.indexOf(tile) < tiles.indexOf(target)) target.after(tile); else target.before(tile);
    if (reducedMotion()) return;
    for (const t of tiles) {
      const a = before.get(t);
      const b = t.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (dx || dy) t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: EASE });
    }
  }

  function onReorderMove(e) {
    if (!reorder || e.pointerId !== reorder.pointerId) return;
    const dx = e.clientX - reorder.startX;
    const dy = e.clientY - reorder.startY;
    if (!reorder.started) {
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      beginReorder();
    }
    e.preventDefault();
    reorder.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.04) rotate(1deg)`;
    // Perto da borda de cima ou de baixo da lista, rola a lista.
    const g = reorder.grid.getBoundingClientRect();
    if (e.clientY < g.top + 40) reorder.grid.scrollTop -= 14;
    else if (e.clientY > g.bottom - 40) reorder.grid.scrollTop += 14;
    const target = tileAt(e.clientX, e.clientY);
    if (target && target !== reorder.tile) moveTo(target);
  }

  function onReorderEnd(e) {
    if (!reorder || e.pointerId !== reorder.pointerId) return;
    window.removeEventListener('pointermove', onReorderMove);
    window.removeEventListener('pointerup', onReorderEnd);
    window.removeEventListener('pointercancel', onReorderEnd);
    const r = reorder;
    if (!r.started) { reorder = null; return; } // foi só um clique
    // O clique que vem depois de soltar não pode tocar o som.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    const finish = () => {
      r.ghost.remove();
      r.tile.classList.remove('reorder-placeholder');
      document.body.classList.remove('sons-reordering');
      const ids = tileIds(r.grid);
      reorder = null;
      onFinish(ids, ids.join('\n') !== r.original.join('\n'));
    };
    if (reducedMotion()) { finish(); return; }
    // A cópia "pousa" no espaço vazio antes de sumir.
    const lib = r.library.getBoundingClientRect();
    const dest = r.tile.getBoundingClientRect();
    const toX = dest.left - lib.left - r.library.clientLeft - r.baseX;
    const toY = dest.top - lib.top - r.library.clientTop - r.baseY;
    const landing = r.ghost.animate(
      [{ transform: r.ghost.style.transform }, { transform: `translate(${toX}px, ${toY}px) scale(1) rotate(0deg)` }],
      { duration: 180, easing: EASE, fill: 'forwards' });
    landing.onfinish = finish;
    landing.oncancel = finish;
  }

  return { onTilePointerDown, dragging: () => !!reorder?.started };
}
