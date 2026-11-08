// Casca do app: abas das extensões de hub instaladas, Início e roteamento de
// dispositivos.
//
// Cada plugin recebe só os dispositivos que `matches()` aceita e decide o que
// mostrar. Os plugins não se conhecem entre si. Só as extensões instaladas
// pelo usuário aparecem no menu.

import { h, clear, button } from './core/dom.js';
import { HidManager, describe, deviceId } from './core/hid-manager.js';
import { Extensions } from './core/extensions.js';
import { plugins } from './frontend/index.js';
import { batteryLevel } from './shared/battery.js';
import { LANGUAGES, DEFAULT_LANGUAGE, getLanguage, setLanguage, startTranslating, translate } from './core/i18n.js';
import { checkForUpdates, mountUpdateBanner, updateSettingsRows } from './shared/updates.js';

const STATUS_LABEL = { beta: 'beta', planned: 'em breve', tool: 'ferramenta' };

const hid = new HidManager();
const extensions = new Extensions();
const tabsEl = document.getElementById('tabs');
const viewEl = document.getElementById('view');
const toastEl = document.getElementById('toast');
const dialogEl = document.getElementById('hub-dialog');

// `changed`: um plugin avisa que o que ele mostra fora da aba (cartões do
// Início) mudou.
const ctx = {
  hid,
  toast,
  changed: () => {
    renderTabs();
    if (active === 'overview') renderOverview(overviewEl);
  },
};
const mounted = new Map(); // plugin.id -> { container, handle }
let active = 'overview';

function toast(message, kind = 'info') {
  const item = h('div', { class: `toast-item ${kind}` }, message);
  toastEl.append(item);
  setTimeout(() => item.remove(), 5000);
}

function devicesFor(plugin) {
  return hid.devices.filter((d) => plugin.matches(d));
}

/**
 * Nomes dos aparelhos do plugin. Com `summary`, o plugin já devolve um por
 * aparelho (dois controles iguais contam como dois); sem ele, tira repetidos
 * (várias interfaces HID do mesmo aparelho).
 */
function deviceNames(plugin) {
  const matched = devicesFor(plugin);
  return plugin.summary ? plugin.summary(matched) : [...new Set(matched.map((d) => describe(d).name))];
}

function installedPlugins() {
  return plugins.filter((p) => extensions.has(p.id));
}

function canInstall(plugin) {
  return plugin.status !== 'planned';
}

/** Recurso: aba do próprio app, que não depende de um aparelho conectado (ex.: Sons). As outras são de aparelhos. */
const isFeature = (plugin) => plugin.kind === 'feature';

/** Ícone do Início: 4 quadradinhos, como os cartões dos aparelhos. */
function overviewIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('class', 'grid-icon');
  for (const [x, y] of [[1, 1], [10, 1], [1, 10], [10, 10]]) {
    const r = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x, y, width: 7, height: 7, rx: 1.8 })) r.setAttribute(k, v);
    svg.append(r);
  }
  return svg;
}

// Menu da bandeja: a bateria de cada aparelho conectado que informa bateria,
// no idioma escolhido. O id junta o plugin e o aparelho, para abrir direto nele.
let trayBatteriesSent = '';
function syncTrayBatteries() {
  const items = installedPlugins().flatMap((plugin) => {
    const handle = mounted.get(plugin.id)?.handle || (devicesFor(plugin).length ? ensureMounted(plugin).handle : null);
    if (!handle?.cards) return [];
    return handle.cards()
      .filter((c) => c.battery && Number.isFinite(c.battery.percent))
      .map((c) => ({
        id: `${plugin.id}|${c.id ?? ''}`,
        label: `${c.name} · ${c.battery.percent}%` + (c.battery.charging ? ` (${translate('carregando')})` : ''),
      }));
  });
  const json = JSON.stringify(items);
  if (json === trayBatteriesSent) return;
  trayBatteriesSent = json;
  window.unihub?.setTrayBatteries?.(items);
}
window.unihub?.onOpenDevice?.((key) => {
  const cut = key.indexOf('|');
  const pluginId = key.slice(0, cut);
  const cardId = key.slice(cut + 1);
  show(pluginId);
  if (cardId) mounted.get(pluginId)?.handle.focus?.(cardId);
});

function renderTabs() {
  syncTrayBatteries();
  // Abas só com o nome: os aparelhos conectados aparecem no Início.
  // Com o menu na barra lateral, cada aba tem um ícone: o desenho do plugin
  // (`icon()`) ou, sem ele, a primeira letra do nome.
  const tab = (id, label, icon = null) =>
    h('button', {
      class: 'tab',
      dataset: { plugin: id },
      role: 'tab',
      'aria-selected': String(active === id),
      onclick: () => show(id),
    },
    h('span', { class: 'tab-icon' + (icon ? ' drawn' : ''), 'aria-hidden': 'true' }, icon ? icon() : label.charAt(0).toUpperCase()),
    h('span', { class: 'tab-label' }, label));

  clear(tabsEl,
    tab('overview', 'Início', overviewIcon),
    installedPlugins().map((p) => tab(p.id, p.name, p.icon)));
  fitMenuWidth();
}

// Barra lateral aberta: só a largura do que ela mostra, a linha de botões de baixo
// (3 de 38 px e 2 espaços, mais as margens) ou a aba de nome mais longo.
const MENU_BUTTONS_WIDTH = 150;
const MENU_SIDE_PADDING = 8;
const measureCanvas = document.createElement('canvas').getContext('2d');

// A fonte do app carrega depois do primeiro desenho: mede de novo com ela.
document.fonts.ready.then(() => fitMenuWidth());

function fitMenuWidth() {
  const sample = tabsEl.querySelector('.tab');
  if (!document.body.classList.contains('menu-left') || !sample) return;
  const style = getComputedStyle(sample);
  const icon = sample.querySelector('.tab-icon').offsetWidth;
  // Sem medir a tela: com a barra recolhida, os nomes das abas estão escondidos.
  measureCanvas.font = style.font;
  const longest = Math.max(...[...tabsEl.querySelectorAll('.tab-label')].map((l) => measureCanvas.measureText(l.textContent).width));
  const tabWidth = parseFloat(style.paddingLeft) + icon + parseFloat(style.columnGap) + longest + parseFloat(style.paddingRight);
  const width = Math.ceil(Math.max(MENU_BUTTONS_WIDTH, tabWidth + 2 * MENU_SIDE_PADDING));
  document.body.style.setProperty('--menu-open-w', `${width}px`);
}

// Procura: "procurando" fica pelo menos um instante na tela, e depois diz o que
// mudou. O estado fica fora da tela porque o Início é redesenhado ao achar algo.
const SCAN_MIN_MS = 900;
const SCAN_RESULT_MS = 8000;
let scan = { phase: 'idle', text: '' };
let scanTimer = 0;

function redrawOverview() {
  if (active === 'overview') renderOverview(overviewEl);
}

async function runScan() {
  if (scan.phase === 'scanning') return;
  clearTimeout(scanTimer);
  scan = { phase: 'scanning', text: '' };
  redrawOverview();
  const before = new Set(hid.devices.map(deviceId));
  const filters = plugins.flatMap((p) => p.filters || []);
  const started = Date.now();
  try {
    await hid.request(filters);
    await hid.refresh();
    await new Promise((r) => setTimeout(r, Math.max(0, SCAN_MIN_MS - (Date.now() - started))));
    const names = [...new Set(hid.devices.filter((d) => !before.has(deviceId(d))).map((d) => d.productName || 'Aparelho sem nome'))];
    scan = names.length
      ? { phase: 'found', text: names.length === 1 ? `Encontrado: ${names[0]}.` : `Encontrados: ${names.join(', ')}.` }
      : { phase: 'none', text: 'Nenhum aparelho novo. Confira o cabo, o dongle ou o Bluetooth e tente de novo.' };
  } catch (err) {
    scan = { phase: 'error', text: `Não foi possível procurar: ${err.message}` };
  }
  redrawOverview();
  scanTimer = setTimeout(() => { scan = { phase: 'idle', text: '' }; redrawOverview(); }, SCAN_RESULT_MS);
}

function scanButton(label = 'Procurar dispositivos') {
  return h('button', { class: 'link-btn', onclick: runScan }, label);
}

/** Linha de procurar no fim do Início: convite, "procurando…" ou o resultado. */
function scanLine(nothingFound) {
  if (scan.phase === 'scanning') {
    return h('p', { class: 'muted small scan-hint scanning', role: 'status' },
      h('span', { class: 'scan-spinner', 'aria-hidden': 'true' }), 'Procurando aparelhos…');
  }
  if (scan.phase !== 'idle') {
    return h('p', { class: `small scan-hint scan-${scan.phase}`, role: 'status' },
      h('span', { class: 'scan-icon', 'aria-hidden': 'true' }, scan.phase === 'found' ? '✓' : scan.phase === 'none' ? '○' : '!'),
      h('span', {}, scan.text),
      scan.phase === 'found' ? null : scanButton('Procurar de novo'));
  }
  return h('p', { class: 'muted small scan-hint' },
    nothingFound ? 'Nenhum aparelho encontrado. Conecte um periférico ou ' : 'Algum aparelho não apareceu? ',
    scanButton(), '.');
}

/**
 * Um passo do "como funciona" das boas-vindas. `state`: 'done' (feito, com ✓),
 * 'current' (o que fazer agora, em destaque) ou 'todo' (o que vem depois).
 */
function welcomeStep(n, state, title, text) {
  return h('li', { class: `welcome-step ${state}`, 'aria-current': state === 'current' ? 'step' : null },
    h('span', { class: 'welcome-step-n', 'aria-hidden': 'true' }, state === 'done' ? '✓' : String(n)),
    h('div', {}, h('strong', {}, title), h('p', { class: 'muted small' }, text)));
}

/** Cartão de aba para ativar nas boas-vindas: ícone, nome, aparelhos achados (ou o que a aba faz) e o botão. */
function welcomePick(p, i) {
  const names = deviceNames(p);
  return h('div', { class: 'card welcome-pick', dataset: { plugin: p.id }, style: `--i:${i}` },
    h('div', { class: 'welcome-pick-head' },
      h('span', { class: 'welcome-pick-art', 'aria-hidden': 'true' }, p.icon ? p.icon() : p.name.charAt(0)),
      h('div', {},
        h('h3', {}, p.name),
        h('span', { class: 'pill' + (names.length ? ' found' : '') }, names.length ? 'Conectado' : 'Recurso'))),
    names.length
      ? h('ul', { class: 'welcome-pick-devices' }, names.map((n) => h('li', {}, n)))
      : h('p', { class: 'muted small' }, p.tagline),
    canInstall(p)
      ? button(`Ativar aba ${p.name}`, () => extensions.install(p.id))
      : h('p', { class: 'muted small' }, 'Aba em breve.'));
}

/**
 * Cartões de abas para ativar: aparelhos e recursos. Com os dois, cada grupo tem
 * o seu título; com um só, vai a grade direto.
 */
function pickGrid(devices, features) {
  const grid = (list, start) => h('div', { class: 'welcome-pick-grid' }, list.map((p, i) => welcomePick(p, start + i)));
  if (!devices.length || !features.length) return grid([...devices, ...features], 0);
  return [
    h('h4', { class: 'pick-group' }, 'Aparelhos'), grid(devices, 0),
    h('h4', { class: 'pick-group' }, 'Recursos'), grid(features, devices.length),
  ];
}

// A entrada animada das boas-vindas acontece uma vez só: o Início é redesenhado
// sempre que um aparelho conecta ou desconecta, e não deve piscar a cada vez.
let welcomeAnimated = false;
let overviewAnimated = false;

/** Ativa várias abas de uma vez e volta para o Início, que vira o resumo dos aparelhos. */
function installAll(list) {
  for (const p of list) extensions.install(p.id);
  show('overview');
}

function renderOverview(container) {
  const installed = installedPlugins().filter((p) => p.status !== 'tool');
  // Marcas detectadas que ainda não têm suporte adicionado.
  const suggestions = plugins.filter((p) => !extensions.has(p.id) && p.status !== 'tool' && deviceNames(p).length);
  const firstRun = installed.length === 0;
  const nothingFound = suggestions.length === 0 && installed.every((p) => deviceNames(p).length === 0);

  // Algum aparelho não apareceu sozinho? Só então o botão de procurar ganha destaque.
  const scanHint = scanLine(nothingFound);

  if (firstRun) {
    // Abas que não dependem de um aparelho conectado (como a Sons) entram junto
    // com as dos aparelhos achados, depois deles.
    const extras = plugins.filter((p) => !extensions.has(p.id) && isFeature(p) && canInstall(p));
    const picks = [...suggestions, ...extras];
    const found = suggestions.filter(canInstall);
    const deviceCount = suggestions.reduce((n, p) => n + deviceNames(p).length, 0);
    const animate = !welcomeAnimated;
    welcomeAnimated = true;
    clear(container,
      h('div', { class: 'welcome-page' + (animate ? ' animate' : '') },
        h('section', { class: 'welcome' },
          h('h2', {}, 'Bem-vindo ao UniHub'),
          h('p', { class: 'muted' }, 'Controles, fones e teclados de várias marcas num lugar só, sem instalar o programa de cada fabricante.'),
          h('div', { class: 'welcome-actions' },
            found.length > 1
              ? button(`Ativar as ${found.length} abas dos aparelhos encontrados`, () => installAll(found), { kind: 'primary' })
              : null,
            button(picks.length ? 'Ver todas as abas' : 'Adicionar aba', openDialog, { kind: found.length > 1 || picks.length ? 'secondary' : 'primary' }))),
        // Os passos acompanham o que já aconteceu: com aparelhos achados, o 1 fica
        // feito e o 2 é o que fazer agora.
        h('ol', { class: 'welcome-steps' },
          deviceCount
            ? welcomeStep(1, 'done', 'Aparelhos conectados', deviceCount === 1 ? '1 aparelho encontrado, por cabo, dongle ou Bluetooth.' : `${deviceCount} aparelhos encontrados, por cabo, dongle ou Bluetooth.`)
            : welcomeStep(1, 'current', 'Conecte seus aparelhos', 'Por cabo, dongle ou Bluetooth. O UniHub reconhece sozinho e eles aparecem aqui.'),
          welcomeStep(2, deviceCount ? 'current' : 'todo', 'Ative as abas que quiser', 'Cada tipo de aparelho tem a sua aba. Só aparecem no menu as que você ativar, e dá para mudar depois.'),
          welcomeStep(3, 'todo', 'Veja e ajuste tudo aqui', 'Bateria, testes e opções de cada aparelho. O Início vira o resumo dos seus periféricos.')),
        !hid.available ? h('div', { class: 'error' }, 'WebHID indisponível neste ambiente.') : null,
        picks.length ? h('section', { class: 'welcome-picks' },
          h('h3', {}, 'Escolha suas abas'),
          pickGrid(suggestions, extras)) : null,
        scanHint),
    );
    return;
  }

  const cards = installed.flatMap(deviceCards);
  // Abas que ainda dá para ativar: as dos aparelhos achados e as que não
  // dependem de aparelho (como a Sons), no mesmo formato das boas-vindas.
  const extras = plugins.filter((p) => !extensions.has(p.id) && isFeature(p) && canInstall(p));
  const picks = [...suggestions, ...extras];
  const found = suggestions.filter(canInstall);
  const animate = !overviewAnimated;
  overviewAnimated = true;
  clear(container,
    h('div', { class: 'overview-head' },
      h('div', {},
        h('h2', {}, 'Seus periféricos'),
        h('p', { class: 'muted small overview-sub' }, cards.length === 0
          ? 'Nenhum aparelho conectado agora.'
          : `${cards.length === 1 ? '1 aparelho conectado' : `${cards.length} aparelhos conectados`}. Clique num cartão para abrir a aba dele.`)),
      button('Gerenciar abas', openDialog)),
    !hid.available ? h('div', { class: 'error' }, 'WebHID indisponível neste ambiente.') : null,
    cards.length
      ? h('div', { class: 'home-grid' + (animate ? ' animate' : '') }, cards.map((c, i) => { c.style.setProperty('--i', i); return c; }))
      : h('div', { class: 'empty' }, 'Nenhum aparelho conectado. Ligue um controle, fone ou teclado e ele aparece aqui.'),
    picks.length ? h('section', { class: 'welcome-picks more-tabs' + (animate ? ' animate' : '') },
      h('div', { class: 'more-tabs-head' },
        h('div', {},
          h('h3', {}, 'Adicionar mais abas'),
          h('p', { class: 'muted small' }, found.length
            ? 'Encontramos aparelhos que ainda não têm a aba ativada.'
            : 'Outras abas que você pode usar.')),
        found.length > 1 ? button(`Ativar as ${found.length} abas dos aparelhos encontrados`, () => installAll(found), { kind: 'primary' }) : null),
      pickGrid(suggestions, extras)) : null,
    scanHint,
  );
}

/**
 * Uma aba na janela Abas: ícone na cor da aba, nome, o que ela faz, os aparelhos
 * conectados agora e uma chave para pôr ou tirar do menu. A linha inteira liga e
 * desliga (é um <label>), não só a chave.
 */
function extensionItem(p) {
  const names = deviceNames(p);
  const installed = extensions.has(p.id);
  const available = canInstall(p);
  const info = [
    h('span', { class: 'ext-art', 'aria-hidden': 'true' }, p.icon ? p.icon() : p.name.charAt(0)),
    h('span', { class: 'ext-info' },
      h('span', { class: 'ext-title' },
        h('strong', {}, p.name),
        STATUS_LABEL[p.status] ? h('span', { class: `pill ${p.status}` }, STATUS_LABEL[p.status]) : null),
      h('span', { class: 'muted small' }, p.tagline),
      p.status !== 'tool' && names.length
        ? h('span', { class: 'small detected' }, h('span', { class: 'ext-dot', 'aria-hidden': 'true' }), `Conectado agora: ${names.join(', ')}`) : null),
  ];
  if (!available) return h('div', { class: 'ext-item soon', dataset: { plugin: p.id } }, ...info);
  return h('label', { class: 'ext-item' + (installed ? ' installed' : ''), dataset: { plugin: p.id } },
    ...info,
    h('input', {
      type: 'checkbox', class: 'switch', checked: installed,
      'aria-label': `Mostrar a aba ${p.name} no menu`,
      onchange: (e) => (e.target.checked ? extensions.install(p.id) : extensions.uninstall(p.id)),
    }));
}

function renderDialog() {
  // Dois grupos: aparelhos (os com aparelho conectado primeiro, os que ainda não
  // existem no fim) e recursos do app. A chave de cada linha já mostra se está no
  // menu. Ferramentas de desenvolvedor ficam em "Avançado".
  const brands = plugins.filter((p) => p.status !== 'tool');
  const rank = (p) => (!canInstall(p) ? 2 : deviceNames(p).length ? 0 : 1);
  const devices = brands.filter((p) => !isFeature(p)).sort((a, b) => rank(a) - rank(b));
  const features = brands.filter(isFeature);
  const tools = plugins.filter((p) => p.status === 'tool');
  const group = (title, hint, list) => (list.length
    ? h('section', { class: 'ext-group' },
      h('h3', {}, title), h('p', { class: 'muted small' }, hint),
      h('div', { class: 'ext-list' }, list.map(extensionItem)))
    : null);
  const inMenu = brands.filter((p) => extensions.has(p.id));
  const total = brands.filter(canInstall).length;
  clear(dialogEl,
    h('div', { class: 'dialog-head' },
      h('div', {},
        h('h2', {}, 'Abas'),
        h('p', { class: 'muted small ext-count' }, inMenu.length === 1 ? `1 de ${total} no menu` : `${inMenu.length} de ${total} no menu`)),
      h('div', { class: 'dialog-actions' },
        // Aberta pelas Configurações: "Voltar" fecha e reabre as Configurações.
        dialogFromSettings ? h('button', {
          class: 'btn secondary dialog-icon-btn', title: 'Voltar', 'aria-label': 'Voltar',
          // Abre as Configurações por cima e só então fecha esta: fechando antes,
          // a tela ficava sem janela enquanto as Configurações carregavam (piscava).
          onclick: async () => { await openSettings(); dialogEl.close(); },
        }, '←') : null,
        h('button', { class: 'btn secondary dialog-icon-btn', title: 'Fechar', 'aria-label': 'Fechar', onclick: () => dialogEl.close() }, '✕'))),
    h('p', { class: 'muted ext-intro' }, 'Ligue só as abas que você usa; elas aparecem no menu e dá para mudar quando quiser.'),
    group('Aparelhos', 'Para configurar controles, fones, teclados e outros periféricos.', devices),
    group('Recursos', 'Funções do próprio UniHub, que não precisam de um aparelho conectado.', features),
    tools.length ? h('details', { class: 'advanced' },
      h('summary', {}, 'Avançado (para desenvolvedores)'),
      h('div', { class: 'ext-list' }, tools.map(extensionItem))) : null,
  );
}

// A janela Abas foi aberta pelas Configurações (mostra "Voltar" para elas).
let dialogFromSettings = false;

function openDialog() {
  renderDialog();
  dialogEl.showModal();
}

function openDialogFromSettings() {
  dialogFromSettings = true;
  openDialog();
}

dialogEl.addEventListener('close', () => { dialogFromSettings = false; });

function unmount(id) {
  const entry = mounted.get(id);
  if (!entry) return;
  entry.handle.unmount();
  entry.container.remove();
  mounted.delete(id);
}

/**
 * Padrão para todos os plugins: no cabo, integrado (teclado do notebook) ou sem
 * conexão conhecida (ex.: teclado comum) e sem bateria lida, o cartão não fala
 * de bateria. Bateria lida aparece sempre, com a barra.
 */
const wiredOrUnknown = (connection) => !connection || /cabo|usb|integrado/i.test(connection);

/**
 * Cartões do Início: um por aparelho conectado, de todos os plugins. O plugin
 * informa os aparelhos em `cards()` (cada um pode ter um `icon` próprio) e abre
 * um deles em `focus(id)`; sem isso, vale o nome de cada aparelho e o clique abre
 * a aba do plugin.
 */
function deviceCards(plugin) {
  const handle = ensureMounted(plugin).handle;
  const list = handle.cards ? handle.cards() : deviceNames(plugin).map((name) => ({ id: null, name }));
  // Três faixas: plugin e conexão em cima; desenho e nome no meio; bateria
  // (com barra) embaixo.
  return list.map((c) => {
    const known = c.battery && Number.isFinite(c.battery.percent);
    // Só a porcentagem e a barra: o ícone de pilha fica nas abas dos plugins.
    const percent = known ? h('span', { class: 'home-card-pct' }, `${c.battery.percent}%`) : null;
    const bar = known ? h('span', {
      class: 'home-card-bar ' + (c.battery.charging ? 'charging' : batteryLevel(c.battery.percent)),
      style: `--level:${Math.max(0, Math.min(100, c.battery.percent))}%`,
    }) : null;
    return h('button', {
      class: 'card home-card',
      dataset: { plugin: plugin.id },
      onclick: () => {
        show(plugin.id);
        if (c.id !== null) handle.focus?.(c.id);
      },
    },
    h('span', { class: 'home-card-top' },
      h('span', { class: 'home-card-plugin' }, plugin.name),
      c.connection ? h('span', { class: 'pill' }, c.connection) : null),
    h('span', { class: 'home-card-main' },
      h('span', { class: 'home-card-art', 'aria-hidden': 'true' }, c.icon ? c.icon() : plugin.icon ? plugin.icon() : plugin.name.charAt(0)),
      h('strong', { class: 'home-card-name' }, c.name)),
    h('span', { class: 'home-card-bottom' },
      percent,
      bar,
      c.status ? h('span', { class: 'pill' }, c.status) : null,
      !known && !c.status && !wiredOrUnknown(c.connection) ? h('span', { class: 'muted small' }, 'Bateria não informada') : null));
  });
}

/**
 * Os plugins ativados carregam ao abrir o app, escondidos: o Início mostra
 * todos os aparelhos e os avisos de bateria valem sem abrir cada aba.
 */
function ensureMounted(plugin) {
  let entry = mounted.get(plugin.id);
  if (!entry) {
    const container = h('div', { class: 'plugin-view', dataset: { plugin: plugin.id }, hidden: true });
    viewEl.append(container);
    entry = { container, handle: plugin.mount(container, ctx) };
    mounted.set(plugin.id, entry);
    entry.handle.update(devicesFor(plugin));
  }
  return entry;
}

function show(id) {
  if (id !== 'overview' && !extensions.has(id)) id = 'overview';
  active = id;
  for (const { container } of mounted.values()) container.hidden = true;
  overviewEl.hidden = id !== 'overview';
  if (id === 'overview') {
    renderOverview(overviewEl);
  } else {
    const entry = ensureMounted(plugins.find((p) => p.id === id));
    entry.container.hidden = false;
  }
  renderTabs();
}

const overviewEl = h('div', { class: 'plugin-view home-view' });
viewEl.append(overviewEl);

// Início: em janela, cartões deitados; em tela cheia (a partir de 1501 px),
// quadrados. Ao trocar, cada parte do cartão desliza até o lugar novo.
const HOME_CARD_PARTS = ['.home-card-art', '.home-card-name', '.home-card-top', '.home-card-bottom'];
const wideScreen = window.matchMedia('(min-width: 1501px)');
const applyHomeWidth = () => document.body.classList.toggle('home-wide', wideScreen.matches);
applyHomeWidth();
wideScreen.addEventListener('change', () => {
  const cards = overviewEl.hidden ? [] : [...overviewEl.querySelectorAll('.home-card')];
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!cards.length || calm || !document.startViewTransition) return applyHomeWidth();
  const named = [];
  cards.forEach((card, i) => {
    for (const [part, el] of [['card', card], ...HOME_CARD_PARTS.map((sel) => [sel.slice(11), card.querySelector(sel)])]) {
      if (!el) continue;
      el.style.viewTransitionName = `home-${part}-${i}`;
      named.push(el);
    }
  });
  document.startViewTransition(applyHomeWidth).finished.finally(() => {
    for (const el of named) el.style.viewTransitionName = '';
  });
});

extensions.addEventListener('change', ({ detail }) => {
  if (!detail.installed) unmount(detail.id);
  if (dialogEl.open) renderDialog();
  if (detail.installed) toast(`Aba ${plugins.find((p) => p.id === detail.id).name} ativada.`);
  show(detail.installed && !dialogEl.open ? detail.id : active);
});

hid.addEventListener('change', () => {
  for (const [id, entry] of mounted) {
    const plugin = plugins.find((p) => p.id === id);
    entry.handle.update(devicesFor(plugin));
  }
  if (active === 'overview') renderOverview(overviewEl);
  if (dialogEl.open) renderDialog();
  renderTabs();
});

// --- Configurações do app (botão de engrenagem no cabeçalho) -----------------

const settingsDialog = document.getElementById('settings-dialog');

function settingToggle(key, settings, onSaved) {
  const api = window.unihub;
  return h('input', {
    type: 'checkbox', class: 'switch', checked: !!settings[key], disabled: !api?.setSetting,
    onchange: async (e) => {
      e.target.disabled = true;
      const saved = await api.setSetting(key, e.target.checked).catch(() => null);
      onSaved(saved || settings);
    },
  });
}

// Layout: cabeçalho, grupos em duas colunas e rodapé com o botão de fechar.
function settingsGroup(title, ...rows) {
  return h('section', { class: 'settings-group' }, h('small', { class: 'settings-group-title muted' }, title), ...rows);
}

function renderSettings(settings) {
  const redraw = (saved) => renderSettings(saved);
  clear(settingsDialog,
    h('div', { class: 'settings-head' },
      h('h2', {}, 'Configurações'),
      h('small', { class: 'muted' }, 'UniHub')),
    h('div', { class: 'settings-body' },
      h('div', { class: 'settings-col' },
        settingsGroup('Inicialização',
          h('label', { class: 'setting-row' },
            h('span', { class: 'setting-text' },
              h('span', {}, 'Iniciar com o Windows'),
              h('small', { class: 'muted' }, 'O UniHub abre sozinho quando você liga o computador.')),
            settingToggle('autoStart', settings, redraw)),
          // A bandeja é uma opção de quem inicia com o Windows.
          settings.autoStart ? h('label', { class: 'setting-row sub-setting' },
            h('span', { class: 'setting-text' },
              h('span', {}, 'Mostrar na bandeja do sistema'),
              h('small', { class: 'muted' }, 'O UniHub fica só como ícone perto do relógio, inclusive ao fechar a janela. Para sair, clique com o botão direito no ícone.')),
            settingToggle('tray', settings, redraw)) : null),
        settingsGroup('Posição do menu',
          h('div', { class: 'segmented', role: 'group', 'aria-label': 'Posição do menu' },
            [['top', 'Cabeçalho'], ['left', 'Barra lateral']].map(([value, text]) => h('button', {
              class: 'btn' + (settings.menuPosition === value ? ' primary' : ' secondary'),
              'aria-pressed': String(settings.menuPosition === value),
              onclick: async () => redraw(applyMenuLayout(await saveSetting('menuPosition', value) || settings)),
            }, text))))),
      h('div', { class: 'settings-col' },
        // Abre a janela Abas.
        settingsGroup('Abas',
          h('div', { class: 'setting-row' },
            h('span', { class: 'setting-text' },
              h('span', {}, 'Abas do menu'),
              h('small', { class: 'muted' }, 'Escolha os tipos de aparelho que aparecem no menu, como Gamepads, Headsets e Teclados.')),
            button('Gerenciar abas', () => {
              settingsDialog.close();
              openDialogFromSettings();
            }))),
        settingsGroup('Idiomas',
          h('div', { class: 'segmented', role: 'group', 'aria-label': 'Idiomas' },
            // "Automático" segue o idioma do Windows; os outros fixam um idioma.
            [{ id: 'auto', name: 'Automático' }, ...LANGUAGES].map(({ id, name }) => {
              const chosen = (settings.language || DEFAULT_LANGUAGE) === id;
              return h('button', {
                class: 'btn' + (chosen ? ' primary' : ' secondary'),
                'aria-pressed': String(chosen),
                onclick: async () => {
                  applyLanguage(await saveSetting('language', id) || { ...settings, language: id });
                  redraw(await window.unihub?.getSettings?.() || settings);
                },
              }, name);
            })),
          settings.language === 'auto'
            ? h('small', { class: 'muted settings-note' }, `Seguindo o idioma do Windows: ${languageName(settings.systemLanguage)}.`)
            : null),
        settingsGroup('Atualizações', updateSettingsRows()))),
    h('div', { class: 'settings-foot' },
      button('Fechar', () => settingsDialog.close())));
}

// --- Posição do menu: em cima ou à esquerda (fixo ou recolhido) ---------------

const pinBtn = document.getElementById('pin-btn');
let layout = { menuPosition: 'top', menuPinned: true };

const languageName = (id) => LANGUAGES.find((l) => l.id === id)?.name || 'English';

function applyLanguage(settings) {
  // No automático, usa o idioma que o Windows indica (sem ele, inglês).
  const language = settings.language === 'auto' ? (settings.systemLanguage || 'en') : settings.language;
  setLanguage(language || DEFAULT_LANGUAGE);
  syncTrayBatteries();
  fitMenuWidth(); // os nomes das abas mudam de tamanho
  return settings;
}

async function saveSetting(key, value) {
  return window.unihub?.setSetting?.(key, value).catch(() => null);
}

function applyMenuLayout(settings) {
  layout = { menuPosition: settings.menuPosition || 'top', menuPinned: settings.menuPinned !== false };
  const left = layout.menuPosition === 'left';
  document.body.classList.toggle('menu-left', left);
  document.body.classList.toggle('menu-collapsed', left && !layout.menuPinned);
  pinBtn.hidden = !left;
  pinBtn.setAttribute('aria-pressed', String(layout.menuPinned));
  pinBtn.setAttribute('aria-label', layout.menuPinned ? 'Recolher o menu' : 'Fixar o menu aberto');
  fitMenuWidth();
  return settings;
}

// Menu recolhido: abre ao passar o mouse e só fecha um pouco depois de o mouse
// sair, para escorregões rápidos (ex.: a caminho do alfinete) não fecharem.
const MENU_CLOSE_DELAY_MS = 300;
const menuEl = document.querySelector('.topbar');
let menuCloseTimer = 0;
menuEl.addEventListener('mouseenter', () => {
  clearTimeout(menuCloseTimer);
  const { classList } = document.body;
  // Entrou direto em Temas: o botão espera o mouse sair dele para mudar de lugar.
  const first = !classList.contains('menu-peek') || classList.contains('theme-held');
  classList.toggle('theme-held', first && classList.contains('menu-collapsed') && themeBtn.matches(':hover'));
  classList.add('menu-peek');
});
menuEl.addEventListener('mouseleave', () => {
  clearTimeout(menuCloseTimer);
  menuCloseTimer = setTimeout(() => document.body.classList.remove('menu-peek'), MENU_CLOSE_DELAY_MS);
});

// Saiu de Temas e continuou na barra: agora o botão pode ir para o lugar dele.
document.getElementById('theme-btn').addEventListener('mouseleave', (e) => {
  if (menuEl.contains(e.relatedTarget)) document.body.classList.remove('theme-held');
});

// Marca o instante em que a barra abre ou fecha. As letras animam só nesse
// instante: as abas são recriadas quando um aparelho muda, e não podem piscar.
const MENU_MOTION_MS = 400;
let menuWasOpen = null;
let menuMotionTimer = 0;
new MutationObserver(() => {
  const { classList } = document.body;
  const open = classList.contains('menu-left') && (!classList.contains('menu-collapsed') || classList.contains('menu-peek'));
  if (open === menuWasOpen) return;
  const moved = menuWasOpen !== null && classList.contains('menu-ready');
  menuWasOpen = open;
  if (!moved) return;
  clearTimeout(menuMotionTimer);
  classList.remove('menu-opening', 'menu-closing');
  classList.add(open ? 'menu-opening' : 'menu-closing');
  menuMotionTimer = setTimeout(() => classList.remove('menu-opening', 'menu-closing'), MENU_MOTION_MS);
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

pinBtn.addEventListener('click', async () => {
  const saved = await saveSetting('menuPinned', !layout.menuPinned);
  applyMenuLayout(saved || { ...layout, menuPinned: !layout.menuPinned });
});

// --- Temas: botão ao lado das configurações, com um menu de opções ------------
// As cores ficam no styles.css (:root[data-theme]); o Grafite é o padrão.
// `swatch`: a parte mais clara e a mais escura do tema (--panel/--panel-2 e --well).
const THEMES = [
  { id: 'light', label: 'Claro', swatch: ['#e7e5e0', '#d0cdc6'] },
  { id: 'dark', label: 'Escuro', swatch: ['#141518', '#020203'] },
  { id: 'graphite', label: 'Grafite', swatch: ['#242830', '#0f1114'] },
  { id: 'purple', label: 'Roxo', swatch: ['#2d1f3c', '#130c1b'] },
  { id: 'lilac', label: 'Lilás', swatch: ['#d5bcf4', '#ad85e4'] },
];
const themeBtn = document.getElementById('theme-btn');
const themeMenu = document.getElementById('theme-menu');
let currentTheme = 'graphite';

function applyTheme(settings) {
  currentTheme = THEMES.some((t) => t.id === settings.theme) ? settings.theme : 'graphite';
  if (currentTheme === 'graphite') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = currentTheme;
  return settings;
}

function closeThemeMenu() {
  themeMenu.hidden = true;
  themeBtn.setAttribute('aria-expanded', 'false');
}

function openThemeMenu() {
  clear(themeMenu, THEMES.map((t) => h('button', {
    class: 'theme-option',
    role: 'menuitemradio',
    'aria-checked': String(t.id === currentTheme),
    style: `--sw-a:${t.swatch[0]};--sw-b:${t.swatch[1]}`,
    onclick: async () => {
      closeThemeMenu();
      applyTheme((await saveSetting('theme', t.id)) || { theme: t.id });
    },
  }, h('span', { class: 'theme-swatch', 'aria-hidden': 'true' }), t.label,
  h('span', { class: 'theme-check', 'aria-hidden': 'true' }, '✓'))));
  themeMenu.hidden = false;
  themeBtn.setAttribute('aria-expanded', 'true');
  // Abaixo do botão (menu em cima) ou à direita dele (menu à esquerda).
  const r = themeBtn.getBoundingClientRect();
  const w = themeMenu.offsetWidth;
  const left = document.body.classList.contains('menu-left');
  themeMenu.style.left = `${left ? r.right + 8 : Math.max(8, r.right - w)}px`;
  themeMenu.style.top = `${left ? Math.min(r.top, innerHeight - themeMenu.offsetHeight - 8) : r.bottom + 6}px`;
  themeMenu.querySelector('[aria-checked="true"]')?.focus();
}

themeBtn.addEventListener('click', () => (themeMenu.hidden ? openThemeMenu() : closeThemeMenu()));
document.addEventListener('pointerdown', (e) => {
  if (!themeMenu.hidden && !themeMenu.contains(e.target) && !themeBtn.contains(e.target)) closeThemeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !themeMenu.hidden) { closeThemeMenu(); themeBtn.focus(); }
});
window.addEventListener('resize', closeThemeMenu);

startTranslating();
window.unihub?.getSettings?.().then(applyLanguage).then(applyTheme).then(applyMenuLayout).catch(() => {})
  // A queda do botão Temas só anima depois de abrir o app, não ao carregar.
  .finally(() => setTimeout(() => document.body.classList.add('menu-ready'), 200));

async function openSettings() {
  renderSettings((await window.unihub?.getSettings?.()) || {});
  settingsDialog.showModal();
}

document.getElementById('settings-btn').addEventListener('click', openSettings);

show('overview');
hid.start().catch((err) => toast(`Erro ao listar dispositivos: ${err.message}`, 'error'));

// Versão nova (0.x portátil): procura uma vez, depois que o app abriu.
mountUpdateBanner(document.body);
setTimeout(() => checkForUpdates().catch(() => {}), 3000);
