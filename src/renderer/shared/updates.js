// Aviso de versão nova e o grupo "Atualizações" das Configurações.
//
// Ao abrir, o app consulta as releases do GitHub uma vez; com versão nova, mostra
// uma janela no meio do app com as novidades. "Atualizar" baixa a versão nova (instalado: o instalador, pelo
// electron-updater; portátil: o exe) e "Reiniciar e atualizar" fecha o app e abre a
// versão nova. Rodando pelo código, só o link para a página da versão. Lado do
// processo principal: main.cjs (update:*) e src/main/updates.cjs.

import { h, clear, button } from '../core/dom.js';
import { strokeIcon, hasIcon } from './icon-card.js';

const state = {
  phase: 'idle', // idle | checking | ready | downloading | downloaded | error
  info: null, // resposta do update:check
  progress: 0,
  message: '',
};
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

export async function checkForUpdates() {
  const api = window.unihub;
  if (!api?.checkUpdate) return;
  state.phase = 'checking';
  state.message = '';
  changed();
  state.info = await api.checkUpdate();
  state.phase = state.info.error ? 'error' : state.info.downloaded ? 'downloaded' : 'ready';
  changed();
}

async function download() {
  state.phase = 'downloading';
  state.progress = 0;
  changed();
  const result = await window.unihub.downloadUpdate();
  state.phase = result.ok ? 'downloaded' : 'ready';
  state.message = result.ok ? '' : result.message;
  changed();
}

const openPage = () => window.unihub.openUpdatePage(state.info?.latest?.page);
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1).replace('.', ',');

/** Botões do momento: atualizar, baixar na página, reiniciar. */
function actions() {
  const info = state.info;
  if (state.phase === 'downloading') {
    return h('div', { class: 'update-progress', role: 'progressbar', 'aria-valuenow': Math.round(state.progress * 100) },
      h('span', { style: `width: ${Math.round(state.progress * 100)}%` }));
  }
  if (state.phase === 'downloaded') {
    return button('Reiniciar e atualizar', () => window.unihub.installUpdate(), { kind: 'primary' });
  }
  return info.canInstall
    ? button(info.size ? `Atualizar (${mb(info.size)} MB)` : 'Atualizar', download, { kind: 'primary' })
    : button('Baixar na página da versão', openPage, { kind: 'primary' });
}

/** Markdown simples -> texto puro (tira ** e `). */
const plain = (s) => s.replace(/\*\*/g, '').replace(/`([^`]*)`/g, '$1').trim();

/**
 * Um item das notas -> { icon, title, text }. Formato: "**Título:** explicação".
 * O ícone é opcional, num comentário que o GitHub não mostra: "<!-- mic --> **Título:** …".
 */
function newsItem(line) {
  const icon = /^<!--\s*([\w-]+)\s*-->\s*/.exec(line);
  const rest = icon ? line.slice(icon[0].length) : line;
  const titled = /^\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(rest);
  const kind = icon && hasIcon(icon[1]) ? icon[1] : 'sparkles';
  return titled
    // "**Título:** agora funciona…" -> a explicação vira frase própria: "Agora funciona…".
    ? { icon: kind, title: plain(titled[1]), text: plain(titled[2]).replace(/^\p{Ll}/u, (c) => c.toUpperCase()) }
    : { icon: kind, title: '', text: plain(rest) };
}

/**
 * Itens da lista "Novidades" das notas da release (markdown do GitHub). Sem essa
 * seção, todos os itens de lista das notas.
 */
function newsItems(notes) {
  const lines = String(notes || '').split(/\r?\n/).map((l) => l.trim());
  const bullet = (l) => /^[-*] /.test(l);
  const start = lines.findIndex((l) => /^(\*\*|#+\s*)Novidades/i.test(l));
  if (start >= 0) {
    const items = [];
    for (const l of lines.slice(start + 1)) {
      if (bullet(l)) items.push(l.slice(2));
      else if (l && items.length) break;
    }
    if (items.length) return items;
  }
  return lines.filter(bullet).map((l) => l.slice(2));
}

/**
 * Janela no meio do app quando há versão nova, no estilo das Configurações.
 * "Agora não" (ou Esc) fecha até reabrir o app. Fechada durante o download, o
 * download continua e a janela volta quando a versão nova estiver baixada.
 */
export function mountUpdateBanner(parent) {
  const dialog = h('dialog', { class: 'hub-dialog update-dialog', 'aria-labelledby': 'update-dialog-title' });
  parent.append(dialog);
  let dismissed = false;
  let dismissedPhase = '';
  const close = () => {
    dismissed = true;
    dismissedPhase = state.phase;
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  const render = () => {
    const info = state.info;
    // Fechada no meio do download: volta quando terminar, para oferecer o reinício.
    if (dismissed && dismissedPhase === 'downloading' && state.phase === 'downloaded') dismissed = false;
    const show = !dismissed && info?.newer && ['ready', 'downloading', 'downloaded'].includes(state.phase);
    if (!show) { if (dialog.open) dialog.close(); return; }
    const items = newsItems(info.latest.notes).map(newsItem);
    clear(dialog,
      h('div', { class: 'update-dialog-body' },
        h('div', { class: 'icon-card-head' },
          h('span', { class: 'icon-card-icon' }, strokeIcon('download')),
          h('div', { class: 'update-dialog-title' },
            h('h3', { id: 'update-dialog-title' }, 'Versão nova do UnusHub'),
            h('p', { class: 'muted small' }, state.phase === 'downloaded'
              ? 'Baixada. Reinicie para usar a versão nova.'
              : `A ${info.latest.version} está pronta. Você está na ${info.current}.`)),
          h('span', { class: 'pill tool' }, info.latest.version)),
        state.message ? h('p', { class: 'small update-error' }, state.message) : null,
        items.length
          ? h('div', {},
            h('span', { class: 'update-news-label' }, 'O que mudou'),
            h('div', { class: 'update-news' }, ...items.map((item) => h('div', { class: 'update-news-item' },
              h('span', { class: 'icon-card-icon' }, strokeIcon(item.icon)),
              h('div', {},
                item.title ? h('strong', {}, item.title) : null,
                item.text ? h('span', {}, item.text) : null)))))
          : null),
      h('div', { class: 'update-dialog-foot' },
        button(state.phase === 'downloading' ? 'Continuar usando' : 'Agora não', close),
        actions()));
    if (!dialog.open) {
      dialog.showModal();
      // Sem foco inicial em "Agora não": evita o contorno de foco ao abrir.
      document.activeElement?.blur();
    }
  };
  listeners.add(render);
  window.unihub?.onUpdateProgress?.(({ received, total }) => {
    state.progress = total ? received / total : 0;
    changed();
  });
  render();
}

/** Linhas do grupo "Atualizações" nas Configurações (o mesmo elemento a cada abertura). */
let settingsRoot = null;
export function updateSettingsRows() {
  if (settingsRoot) return settingsRoot;
  const root = h('div', {});
  settingsRoot = root;
  const render = () => {
    const info = state.info;
    const status = state.phase === 'checking' ? 'Procurando…'
      : state.phase === 'error' ? `Não foi possível procurar: ${info.error}.`
        : info?.newer ? `Versão ${info.latest.version} disponível.`
          : info ? 'Você está na versão mais recente.' : '';
    clear(root,
      h('div', { class: 'setting-row' },
        h('span', { class: 'setting-text' },
          h('span', {}, info ? `Versão ${info.current}` : 'Versão instalada'),
          h('small', { class: 'muted' }, status || 'Novas versões chegam pelas releases do GitHub.')),
        info?.newer && state.phase !== 'checking'
          ? actions()
          : button('Procurar atualização', checkForUpdates, { disabled: state.phase === 'checking' })),
      state.message ? h('small', { class: 'settings-note update-error' }, state.message) : null);
  };
  listeners.add(render);
  render();
  return root;
}
