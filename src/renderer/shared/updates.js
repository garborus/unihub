// Aviso de versão nova e o grupo "Atualizações" das Configurações.
//
// Ao abrir, o app consulta as releases do GitHub uma vez; com versão nova, mostra
// um aviso no canto. "Atualizar" baixa a versão nova (instalado: o instalador, pelo
// electron-updater; portátil: o exe) e "Reiniciar e atualizar" fecha o app e abre a
// versão nova. Rodando pelo código, só o link para a página da versão. Lado do
// processo principal: main.cjs (update:*) e src/main/updates.cjs.

import { h, clear, button } from '../core/dom.js';

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

/** Aviso no canto da janela quando há versão nova ("Agora não" esconde até reabrir o app). */
export function mountUpdateBanner(parent) {
  const banner = h('div', { class: 'update-banner', role: 'status', hidden: true });
  parent.append(banner);
  let dismissed = false;
  const render = () => {
    const info = state.info;
    const show = !dismissed && info?.newer && ['ready', 'downloading', 'downloaded'].includes(state.phase);
    banner.hidden = !show;
    if (!show) return;
    clear(banner,
      h('div', { class: 'update-banner-text' },
        h('strong', {}, `UnusHub ${info.latest.version} disponível`),
        h('span', { class: 'muted small' }, state.phase === 'downloaded'
          ? 'Baixada. Reinicie para usar a versão nova.'
          : `Você está na ${info.current}.`),
        state.message ? h('span', { class: 'small update-error' }, state.message) : null),
      h('div', { class: 'update-banner-actions' },
        actions(),
        state.phase === 'downloading' ? null : button('Novidades', openPage),
        state.phase === 'downloading' ? null : button('Agora não', () => { dismissed = true; render(); })));
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
