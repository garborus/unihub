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
  received: 0, // bytes já baixados da versão nova
  total: 0, // tamanho do download (0 = ainda não se sabe)
  message: '',
  target: null, // versão escolhida nas Configurações (ex.: uma mais antiga); null = a mais nova
  auto: false, // download começado sozinho ("Baixar e instalar sozinho")
};
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

// Preferências das Configurações (guardadas no settings.json pelo processo principal).
const prefs = { updateAutoDownload: false, updateNotify: true };
export function setUpdatePrefs(settings) {
  for (const key of Object.keys(prefs)) if (settings && key in settings) prefs[key] = settings[key];
  changed();
}

/** Ao abrir o app: procura sempre (uma vez). */
export async function checkOnStartup() {
  await checkForUpdates();
  // "Baixar e instalar sozinho": já baixa; instala quando o app fechar.
  if (prefs.updateAutoDownload && state.phase === 'ready' && state.info?.newer && state.info.canInstall) {
    download(null, { auto: true });
  }
}

export async function checkForUpdates() {
  const api = window.unihub;
  if (!api?.checkUpdate || state.phase === 'downloading') return;
  state.phase = 'checking';
  state.message = '';
  changed();
  state.info = await api.checkUpdate();
  state.phase = state.info.error ? 'error' : state.info.downloaded ? 'downloaded' : 'ready';
  changed();
}

async function download(version = null, { auto = false } = {}) {
  state.phase = 'downloading';
  state.target = version;
  state.auto = auto;
  state.received = 0;
  state.total = version ? 0 : state.info?.size || 0;
  state.message = '';
  changed();
  const result = await window.unihub.downloadUpdate(version);
  state.phase = result.ok ? 'downloaded' : 'ready';
  state.message = result.ok ? '' : result.message;
  if (!result.ok) state.target = null;
  changed();
}

const openPage = () => window.unihub.openUpdatePage(state.info?.latest?.page);
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1).replace('.', ',');

/*
 * Andamento do download: texto ("Baixando", "62% · 67,7 / 109,6 MB")
 * e a barra. Cada aviso de andamento só repinta as barras na tela, sem montar a
 * janela de novo, para a barra deslizar suave em vez de pular.
 */
const progressViews = new Set();

function paintProgress(view) {
  const { received, total } = state;
  const pct = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const started = received > 0 && total > 0;
  view.bar.classList.toggle('indeterminate', !started);
  view.bar.setAttribute('aria-valuenow', String(pct));
  view.fill.style.width = started ? `${pct}%` : '';
  view.label.textContent = started ? 'Baixando' : 'Preparando o download';
  view.detail.textContent = started ? `${pct}% · ${mb(received)} / ${mb(total)} MB` : '';
}

function progressView() {
  const view = {
    label: h('span', {}),
    detail: h('span', { class: 'muted', translate: 'no' }),
    fill: h('span', {}),
  };
  view.bar = h('div', { class: 'update-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Andamento do download' }, view.fill);
  view.root = h('div', { class: 'update-progress-block' },
    h('div', { class: 'update-progress-text' }, view.label, view.detail), view.bar);
  progressViews.add(view);
  paintProgress(view);
  return view.root;
}

function repaintProgress() {
  for (const view of progressViews) {
    if (view.root.isConnected) paintProgress(view);
    else progressViews.delete(view);
  }
}

/** Botões do momento: atualizar, baixar na página, reiniciar. */
function actions() {
  const info = state.info;
  if (state.phase === 'downloading') return progressView();
  if (state.phase === 'downloaded') {
    return button(state.target ? `Reiniciar e instalar a ${state.target}` : 'Reiniciar e atualizar',
      () => window.unihub.installUpdate(), { kind: 'primary' });
  }
  return info.canInstall
    ? button(info.size ? `Atualizar (${mb(info.size)} MB)` : 'Atualizar', () => download(), { kind: 'primary' })
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
let openNewsDialog = null;

/** Se há novidades para mostrar (o app já consultou as releases). */
export const hasNews = () => !!state.info?.latest && newsItems(state.info.latest.notes).length > 0;

/** "O que mudou" das Configurações: abre a mesma janela, com ou sem versão nova. */
export const showNews = () => openNewsDialog?.();

export function mountUpdateBanner(parent) {
  const dialog = h('dialog', { class: 'hub-dialog update-dialog', 'aria-labelledby': 'update-dialog-title' });
  parent.append(dialog);
  let dismissed = false;
  let dismissedPhase = '';
  let asked = false; // aberta pelo "O que mudou", mesmo sem versão nova
  const close = () => {
    dismissed = true;
    asked = false;
    dismissedPhase = state.phase;
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  const render = () => {
    const info = state.info;
    // Fechada no meio do download: volta quando terminar, para oferecer o reinício.
    if (dismissed && dismissedPhase === 'downloading' && state.phase === 'downloaded') dismissed = false;
    const update = info?.newer && ['ready', 'downloading', 'downloaded'].includes(state.phase);
    // Sem janela sozinha quando: a pessoa desligou o aviso, o download começou
    // sozinho (aparece só quando terminar), ou é uma versão escolhida nas Configurações.
    const quiet = !prefs.updateNotify || (state.auto && state.phase === 'downloading') || !!state.target;
    const show = asked ? !!info?.latest : !dismissed && update && !quiet;
    if (!show) { if (dialog.open) dialog.close(); return; }
    const items = newsItems(info.latest.notes).map(newsItem);
    clear(dialog,
      h('div', { class: 'update-dialog-body' },
        h('div', { class: 'icon-card-head' },
          h('span', { class: 'icon-card-icon' }, strokeIcon(update ? 'download' : 'sparkles')),
          h('div', { class: 'update-dialog-title' },
            h('h3', { id: 'update-dialog-title' }, update ? 'Versão nova do UnusHub' : 'Novidades do UnusHub'),
            h('p', { class: 'muted small' }, !update
              ? `O que mudou na versão ${info.latest.version}.`
              : state.phase === 'downloaded'
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
      // Baixando: o andamento à esquerda, ocupando a faixa, e "Continuar usando" à direita.
      h('div', { class: 'update-dialog-foot' }, !update
        ? button('Fechar', close)
        : state.phase === 'downloading'
          ? [actions(), button('Continuar usando', close)]
          : [button('Agora não', close), actions()]));
    if (!dialog.open) {
      dialog.showModal();
      // Sem foco inicial em "Agora não": evita o contorno de foco ao abrir.
      document.activeElement?.blur();
    }
  };
  openNewsDialog = () => { asked = true; render(); };
  listeners.add(render);
  window.unihub?.onUpdateProgress?.(({ received, total }) => {
    state.received = received || 0;
    state.total = total || state.info?.size || 0;
    repaintProgress();
  });
  render();
}

/** Grava uma preferência de atualização e aplica na hora. */
async function savePref(key, value) {
  const saved = await window.unihub?.setSetting?.(key, value).catch(() => null);
  setUpdatePrefs(saved || { [key]: value });
}

const prefSwitch = (key, title, hint) => h('label', { class: 'setting-row' },
  h('span', { class: 'setting-text' }, h('span', {}, title), h('small', { class: 'muted' }, hint)),
  h('input', {
    type: 'checkbox', class: 'switch', checked: !!prefs[key], disabled: !window.unihub?.setSetting,
    onchange: (e) => savePref(key, e.target.checked),
  }));

/** Escolher a versão: a mais nova, a em uso ou uma mais antiga (só no app instalado). */
let chosenVersion = null;
function versionRow(info) {
  const versions = info?.versions || [];
  if (!versions.length) return null;
  const pick = chosenVersion || info.current;
  const label = (v) => v.version + (v.version === versions[0].version ? ' (mais recente)' : '')
    + (v.version === info.current ? ' · em uso' : '');
  const busy = state.phase === 'downloading' || state.phase === 'checking';
  return h('div', { class: 'update-version-row' },
    h('div', { class: 'setting-row' },
      h('span', { class: 'setting-text' },
        h('span', {}, 'Versão'),
        h('small', { class: 'muted' }, 'Para voltar a uma versão anterior, se a nova der problema.')),
      h('select', {
        class: 'map-select settings-select update-version-select', 'aria-label': 'Versão', disabled: busy,
        onchange: (e) => { chosenVersion = e.target.value; changed(); },
      }, versions.map((v) => h('option', { value: v.version, selected: v.version === pick }, label(v))))),
    pick !== info.current && !busy && state.phase !== 'downloaded'
      ? h('div', { class: 'update-settings-actions' },
        button(`Instalar a ${pick}`, () => download(pick), { kind: 'primary' }))
      : null);
}

/** Linhas do grupo "Atualizações" nas Configurações (o mesmo elemento a cada abertura). */
let settingsRoot = null;
export function updateSettingsRows() {
  if (settingsRoot) return settingsRoot;
  const root = h('div', {});
  settingsRoot = root;
  const render = () => {
    const info = state.info;
    const busy = state.phase === 'downloading' || state.phase === 'downloaded';
    const status = state.phase === 'checking' ? 'Procurando…'
      : state.phase === 'error' ? `Não foi possível procurar: ${info.error}.`
        : state.target ? `Versão ${state.target} escolhida.`
          : info?.newer ? `Versão ${info.latest.version} disponível.`
            : info ? 'Você está na versão mais recente.' : '';
    // Texto em cima e botões embaixo: lado a lado, o texto ficava espremido.
    clear(root,
      h('div', { class: 'setting-text update-settings-text' },
        h('span', {}, info ? `Versão ${info.current}` : 'Versão instalada'),
        h('small', { class: 'muted' }, status || 'Novas versões chegam pelas releases do GitHub.')),
      h('div', { class: 'update-settings-actions' },
        (busy || info?.newer) && state.phase !== 'checking'
          ? actions()
          : button('Procurar atualização', checkForUpdates, { disabled: state.phase === 'checking' }),
        hasNews() && state.phase !== 'checking' ? button('O que mudou', showNews) : null),
      state.message ? h('small', { class: 'settings-note update-error' }, state.message) : null,
      // Opções: baixar sozinho, avisar e escolher a versão (procurar é sempre ao abrir).
      h('div', { class: 'update-options' },
        prefSwitch('updateAutoDownload', 'Baixar e instalar sozinho',
          'A versão nova é baixada em segundo plano e instalada quando você fechar o app.'),
        prefSwitch('updateNotify', 'Avisar quando houver versão nova',
          'Mostra a janela com as novidades ao abrir o app.'),
        versionRow(info)));
  };
  listeners.add(render);
  render();
  return root;
}
