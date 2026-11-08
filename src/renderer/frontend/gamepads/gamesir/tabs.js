// Sub-abas específicas dos controles GameSir (além de Luzes e Vibração).

import { h, card, button } from '../../../core/dom.js';
import { toHex } from '../../../core/bytes.js';
import { PROFILE_SLOTS, REPORT_RATES } from '../../../plugins/gamepads/gamesir/protocol.js';
import { BUTTONS, EXTRA_KEYS, parseMapping, parsePaddle, buildMapping, buildPaddle, countRemapped, targetName } from '../../../plugins/gamepads/gamesir/mapping.js';
import { infoCard, vidPidRow } from '../../../shared/info-card.js';
import { iconCard } from '../../../shared/icon-card.js';

export function deviceTab(session, label, vidPid, model, ctx) {
  const firmware = h('strong', {}, '…');
  const dongle = h('strong', {}, '…');

  // Sem aviso de erro: se o controle desligar, a lista já some sozinha.
  // Sem fio, a resposta traz a versão do controle e a do dongle; com cabo, só a do controle.
  async function refreshInfo() {
    try {
      const fw = (await session.readFirmwareVersion()).value;
      firmware.textContent = fw?.controller || '—';
      dongle.textContent = fw?.dongle || 'Não usado';
      dongle.classList.toggle('muted', !fw?.dongle);
    } catch {
      firmware.textContent = dongle.textContent = '—';
    }
  }
  refreshInfo();

  return h('div', { class: 'device-cards' },
    infoCard({
      rows: [
        ['Firmware', firmware],
        ['Dongle', dongle],
        ['VID:PID', vidPidRow(vidPid)],
      ],
      note: 'Para atualizar consulte as normas do fabricante.',
      label,
    }),
    REPORT_RATES[model] ? reportRateCard(session, REPORT_RATES[model], ctx) : null);
}

/** Taxa de relatório: quantas vezes por segundo o controle manda o estado ao PC. */
function reportRateCard(session, rates, ctx) {
  let current = null; // marcha atual, ou 'mixed' se os perfis divergirem
  let busy = false;
  const buttons = h('div', { class: 'rate-options' });
  const status = h('p', { class: 'muted small' });

  function render() {
    buttons.replaceChildren(...rates.map((r) => h('button', {
      class: 'rate-btn' + (current === r.gear ? ' selected' : ''),
      disabled: busy || current === null,
      onclick: () => choose(r.gear),
    }, h('strong', {}, String(r.hz)), h('small', {}, 'Hz'))));
  }

  async function load() {
    try {
      const gears = Object.values(await session.readReportRates());
      current = gears.every((g) => g === gears[0]) ? gears[0] : 'mixed';
      status.textContent = current === 'mixed' ? 'Os perfis estão com taxas diferentes. Escolha uma para todos.' : '';
    } catch {
      status.textContent = 'Não foi possível ler a taxa de relatório.';
    }
    render();
  }

  async function choose(gear) {
    if (gear === current) return;
    busy = true;
    status.textContent = 'Gravando…';
    render();
    try {
      await session.writeReportRate(gear);
      await load();
      status.textContent = 'Salvo em todos os perfis.';
    } catch (err) {
      status.textContent = '';
      ctx?.toast(`Taxa de relatório: ${err.message}`, 'error');
    }
    busy = false;
    render();
  }

  render();
  load();
  return iconCard('gauge', 'Taxa de relatório', {},
    h('p', { class: 'muted small' }, 'Quantas vezes por segundo o controle envia o estado dos botões ao PC. Valores maiores respondem mais rápido; se um jogo travar ou falhar, tente um valor menor.'),
    buttons,
    status);
}

// Hora da última exportação de cada perfil, por controle; dura enquanto o app estiver aberto.
const lastExports = new Map();

const SVG_NS_EXPORT = 'http://www.w3.org/2000/svg';
/** Ícone simples de traço (baixar ou confirmado). */
function strokeIcon(d) {
  const svg = document.createElementNS(SVG_NS_EXPORT, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', class: 'export-icon', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS_EXPORT, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}
const ICON_DOWNLOAD = 'M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10';
const ICON_DONE = 'M3.5 8.5 6.5 11.5 12.5 4.5';

const timeText = (date) => date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Card com uma linha por perfil: estado, progresso da leitura e "em uso". */
function exportProfilesCard(session, ctx) {
  const deviceKey = `${session.device?.vendorId}:${session.device?.productId}`;
  const state = new Map(PROFILE_SLOTS.map((n) => [n, { phase: 'idle', progress: 0, error: '' }]));
  let active = null;
  let running = false;
  const list = h('div', { class: 'export-list' });
  const allBtn = button('Exportar todos', () => exportAll(), { kind: 'primary' });

  function render() {
    list.replaceChildren(...PROFILE_SLOTS.map((n) => {
      const s = state.get(n);
      const last = lastExports.get(`${deviceKey}:${n}`);
      const sub = s.phase === 'reading' ? `Lendo… ${Math.round(s.progress * 100)}%`
        : s.phase === 'error' ? `Falhou: ${s.error}`
          : last ? `Exportado às ${timeText(last)}` : 'Ainda não exportado';
      return h('button', {
        class: `export-row ${s.phase}` + (last && s.phase === 'idle' ? ' saved' : '') + (active === n ? ' in-use' : ''),
        style: `--progress: ${s.progress}`,
        disabled: running,
        title: `Exportar o perfil ${n}`,
        onclick: () => exportOne(n),
      },
      h('span', { class: 'export-num' }, String(n)),
      h('span', { class: 'export-text' },
        h('span', { class: 'export-name' }, `Perfil ${n}`, active === n ? h('span', { class: 'export-badge' }, 'em uso') : null),
        h('span', { class: 'export-sub' }, sub)),
      strokeIcon(s.phase === 'done' ? ICON_DONE : ICON_DOWNLOAD));
    }));
    allBtn.disabled = running;
  }

  function set(n, patch) {
    Object.assign(state.get(n), patch);
    render();
  }

  async function backup(n) {
    set(n, { phase: 'reading', progress: 0, error: '' });
    try {
      const data = await session.backupProfile(n, undefined, (progress) => set(n, { progress }));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `gamesir-perfil-${n}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
      lastExports.set(`${deviceKey}:${n}`, new Date());
      set(n, { phase: 'done', progress: 1 });
      // O ícone de confirmado fica um instante e volta ao normal.
      setTimeout(() => { if (state.get(n).phase === 'done') set(n, { phase: 'idle', progress: 0 }); }, 1800);
      return true;
    } catch (err) {
      set(n, { phase: 'error', progress: 0, error: err.message });
      ctx.toast(`Exportar perfil ${n}: ${err.message}`, 'error');
      return false;
    }
  }

  async function exportOne(n) {
    if (running) return;
    running = true;
    render();
    try { await backup(n); } finally { running = false; render(); }
  }

  async function exportAll() {
    if (running) return;
    running = true;
    render();
    let ok = 0;
    try {
      for (const n of PROFILE_SLOTS) if (await backup(n)) ok += 1;
    } finally { running = false; render(); }
    if (ok === PROFILE_SLOTS.length) ctx.toast('Os 4 perfis foram exportados.');
  }

  render();
  const el = iconCard('download', 'Exportar perfis', {},
    h('p', { class: 'muted small' }, 'Guarda uma cópia de cada perfil num arquivo no computador. Isto não muda nada no controle: o mapeamento já é salvo sozinho.'),
    list,
    allBtn);
  el.classList.add('export-card');
  return { element: el, setActive(n) { if (n !== active) { active = n; render(); } } };
}

export function profilesTab(session, ctx, model) {
  const exporter = exportProfilesCard(session, ctx);
  return h('div', { class: 'device-cards mapping-page' },
    MAPPING_MODELS.includes(model)
      ? mappingEditor(session, ctx, { onActiveChange: (n) => exporter.setActive(n) })
      : iconCard('mapping', 'Mapeamento de botões', {}, h('p', { class: 'muted' }, 'Ainda não disponível para este modelo.')),
    exporter.element,
  );
}

/** Modelos com o mapeamento confirmado com hardware. */
const MAPPING_MODELS = ['cyclone2'];

// Destinos da lista de cada botão, agrupados como no controle (códigos de mapping.js).
// Dos analógicos, só o clique: as direções ficam fora da lista.
// L4 e R4 (selfOnly) só aparecem na lista deles mesmos, como o padrão: não foram
// testados como destino de outro botão.
const TARGET_GROUPS = [
  { title: 'Gatilhos', codes: [5, 6, 19, 20] },
  { title: 'Botões de ação', codes: [9, 10, 11, 12] },
  { title: 'Direcional', codes: [1, 2, 3, 4] },
  { title: 'Analógicos e paddles', codes: [7, 8, 17, 18], selfOnly: [17, 18] },
  { title: 'Botões centrais', codes: [13, 14, 15, 16] },
  { title: 'Outros', codes: [255], keepsCurrent: true },
];
const LISTED_TARGETS = TARGET_GROUPS.flatMap((g) => g.codes);

// Nomes mais claros na lista: o clique dos analógicos e as direções do direcional.
const TARGET_LABELS = {
  1: 'Cima',
  2: 'Baixo',
  3: 'Esquerda',
  4: 'Direita',
  7: 'L3 · clique esquerdo',
  8: 'R3 · clique direito',
};
const targetLabel = (code) => TARGET_LABELS[code] || targetName(code);

// Direção de cada código do direcional, para o desenho da cruz.
const DPAD_DIRECTIONS = { 1: 'up', 2: 'down', 3: 'left', 4: 'right' };
const SVG_NS = 'http://www.w3.org/2000/svg';
// Braço de cada direção: [x, y, largura, altura].
const DPAD_ARMS = { up: [5.5, 0.5, 5, 5], down: [5.5, 10.5, 5, 5], left: [0.5, 5.5, 5, 5], right: [10.5, 5.5, 5, 5] };

/** Cruz do direcional com o braço da direção aceso. */
function dpadIcon(dir) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'dpad-icon');
  svg.setAttribute('aria-hidden', 'true');
  // A cruz inteira, apagada, e por cima o braço da direção.
  const cross = document.createElementNS(SVG_NS, 'path');
  cross.setAttribute('d', 'M6.5 .5h3a1 1 0 0 1 1 1v4h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-4v4a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h4v-4a1 1 0 0 1 1-1z');
  cross.setAttribute('class', 'dpad-off');
  const [x, y, width, height] = DPAD_ARMS[dir];
  const arm = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ x, y, width, height, rx: 1, class: 'dpad-on' })) arm.setAttribute(k, v);
  svg.append(cross, arm);
  return svg;
}

// Desenhos de traço dos botões centrais (Home, View, Menu, Captura), pelo código.
const CENTER_ICONS = {
  13: 'M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5', // Home: casinha
  14: 'M5.5 2.5h8v6h-8zM2.5 6.5v7h8v-3', // View: duas janelas sobrepostas
  15: 'M3 4.5h10M3 8h10M3 11.5h10', // Menu: três linhas
  16: 'M3 3h10v10H3zM8 5.75a2.25 2.25 0 1 0 0 4.5a2.25 2.25 0 1 0 0-4.5', // Captura: quadrado com o círculo da câmera
};

/** Ícone de traço de um botão central. */
function centerIcon(code) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', class: 'center-icon', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', CENTER_ICONS[code]);
  svg.append(path);
  return svg;
}

// Clique dos analógicos (L3, R3): o analógico visto de lado, com a seta de apertar.
const STICK_CODES = [7, 8];
const STICK_ICON = {
  press: 'M8 .9v3.4M6.2 2.6 8 4.4l1.8-1.8', // seta para baixo
  cap: 'M2 9.6C2 7.4 4.7 6 8 6s6 1.4 6 3.6z', // topo do analógico (cheio)
  body: 'M6.9 9.6h2.2v2.6H6.9zM2.5 15c.8-1.7 3-2.8 5.5-2.8s4.7 1.1 5.5 2.8z', // haste e base (cheias)
};

/** Ícone do analógico sendo clicado. */
function stickIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', class: 'center-icon stick-icon', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const [part, d] of Object.entries(STICK_ICON)) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'stick-' + part);
    svg.append(path);
  }
  return svg;
}

/** Desenho de um código, quando ele tem: a cruz do direcional, o ícone central ou o analógico. */
const codeIcon = (code) => (DPAD_DIRECTIONS[code] ? dpadIcon(DPAD_DIRECTIONS[code])
  : CENTER_ICONS[code] ? centerIcon(code) : STICK_CODES.includes(code) ? stickIcon() : null);

/** Conteúdo de uma opção: o desenho (se houver) e o nome. */
const optionContent = (code, label) => [
  codeIcon(code),
  h('span', { class: 'map-label', title: label }, label),
];

/** Opção "faz a própria função", com a etiqueta de padrão. */
const defaultOption = (b) => h('option', { value: 'self', class: 'map-default-option' },
  ...optionContent(b.code, TARGET_LABELS[b.code] || b.name),
  h('span', { class: 'map-default' }, 'padrão'));

// Grupos da tela de mapeamento, por onde o botão fica no controle.
const MAPPING_GROUPS = [
  { title: 'Gatilhos', ids: ['lb', 'rb', 'lt', 'rt'] },
  { title: 'Botões de ação', ids: ['a', 'b', 'x', 'y'] },
  { title: 'Direcional', ids: ['up', 'down', 'left', 'right'] },
  { title: 'Analógicos e paddles', ids: ['l3', 'r3', 'l4', 'r4'] },
  { title: 'Botões centrais', ids: ['home', 'view', 'menu', 'capture'] },
];

/** Editor: escolhe o perfil e, para cada botão, o que ele faz. Grava na hora. */
function mappingEditor(session, ctx, { onActiveChange } = {}) {
  let slot = null; // perfil em edição
  let active = null; // perfil que o controle está usando
  let bytes = null; // trecho atual no controle
  let paddleBytes = null; // 7 bytes de cada paddle no controle
  let entries = null; // os 16 botões e, depois deles, os paddles
  let busy = false;
  const body = h('div', { class: 'mapping' }, h('p', { class: 'muted' }, 'Lendo o perfil…'));
  const status = h('span', { class: 'muted small' });
  const profileRow = h('div', { class: 'row profile-pick' });
  const activeNote = h('div', { class: 'active-note' });

  function renderProfiles() {
    onActiveChange?.(active);
    profileRow.replaceChildren(
      h('span', { class: 'muted small' }, 'Editando o perfil:'),
      ...PROFILE_SLOTS.map((n) => h('button', {
        class: 'round-btn' + (slot === n ? ' selected' : '') + (active === n ? ' in-use' : ''),
        disabled: busy,
        onclick: () => load(n),
      }, String(n))),
      h('span', { class: 'in-use-legend muted small' }, h('i'), 'em uso no controle'),
      h('span', { class: 'spacer' }),
      button('Restaurar padrão', () => save(entries.map((e) => ({ ...e, target: null })), 'Perfil restaurado.'),
        { disabled: busy || !entries || countRemapped(entries) === 0 }));

    // Deixa claro se o perfil editado é o que vale no controle.
    if (slot === null || active === null) {
      activeNote.replaceChildren();
    } else if (slot === active) {
      activeNote.className = 'active-note ok';
      activeNote.replaceChildren(`✓ O controle está usando este perfil (${slot}). As mudanças valem na hora.`);
    } else {
      activeNote.className = 'active-note warn';
      activeNote.replaceChildren(
        h('span', {}, `Você está editando o perfil ${slot}, mas o controle está usando o perfil ${active}.`),
        button('Usar este perfil', useThisProfile, { kind: 'primary', disabled: busy }));
    }
  }

  async function refreshActive() {
    try {
      const value = (await session.readCurrentProfile()).value;
      if (PROFILE_SLOTS.includes(value) && value !== active) {
        active = value;
        renderProfiles();
      }
    } catch { /* controle ocupado ou desligado: tenta de novo depois */ }
  }

  async function useThisProfile() {
    busy = true;
    renderProfiles();
    try {
      await session.switchProfile(slot);
      await refreshActive();
      status.textContent = `Perfil ${slot} em uso no controle.`;
    } catch (err) {
      ctx.toast(`Trocar perfil: ${err.message}`, 'error');
    }
    busy = false;
    render();
  }

  function render() {
    renderProfiles();
    if (!entries) return;
    const keys = [...BUTTONS, ...EXTRA_KEYS];
    const row = (id) => {
      const i = keys.findIndex((k) => k.id === id);
      const b = keys[i];
      const entry = entries[i];
      const select = h('select', {
        class: 'map-select' + (entry.target !== null ? ' changed' : ''),
        disabled: busy,
        onchange: (e) => {
          const value = e.target.value === 'self' ? null : Number(e.target.value);
          const next = entries.map((x, j) => (j === i ? { ...x, target: value } : x));
          save(next, `${b.name} → ${value === null ? b.name : targetLabel(value)}`);
        },
      },
      // A caixa fechada mostra a opção escolhida inteira, com a etiqueta "padrão".
      h('button', {}, h('selectedcontent')),
      // A lista rola dentro deste bloco, que recebe a barra de rolagem do resto do app
      // (a lista aberta em si não recebe).
      h('div', { class: 'map-list' },
        // O próprio botão fica no seu grupo, marcado como padrão; sem grupo (L4, R4), vem primeiro.
        LISTED_TARGETS.includes(b.code) ? null : defaultOption(b),
        ...TARGET_GROUPS.map((g) => {
          // Um destino fora da lista (gravado por outro app) continua visível, para não sumir da caixa.
          const codes = (g.keepsCurrent && entry.target !== null && !LISTED_TARGETS.includes(entry.target)
            ? [...g.codes, entry.target] : g.codes).filter((code) => !g.selfOnly?.includes(code) || code === b.code || code === entry.target);
          return h('optgroup', { label: g.title },
            codes.map((code) => (code === b.code ? defaultOption(b) : h('option', { value: String(code) }, ...optionContent(code, targetLabel(code))))));
        })));
      select.value = entry.target === null ? 'self' : String(entry.target);
      return h('label', { class: 'map-row' },
        h('span', { class: 'map-key' + (CENTER_ICONS[b.code] ? ' with-icon' : STICK_CODES.includes(b.code) ? ' with-stick' : ''), title: b.name },
          DPAD_DIRECTIONS[b.code] ? dpadIcon(DPAD_DIRECTIONS[b.code])
            : CENTER_ICONS[b.code] ? centerIcon(b.code)
              : STICK_CODES.includes(b.code) ? [stickIcon(), h('span', {}, b.label)] : b.label),
        h('span', { class: 'map-arrow' }, '→'),
        select);
    };
    body.replaceChildren(...MAPPING_GROUPS.map((g) => h('section', { class: 'map-group' },
      h('h4', {}, g.title),
      g.ids.map(row))));
  }

  async function readEntries(n) {
    bytes = await session.readMapping(n);
    paddleBytes = await session.readPaddles(n);
    entries = [...parseMapping(bytes), ...EXTRA_KEYS.map((p, i) => parsePaddle(p, paddleBytes[i]))];
  }

  async function load(n) {
    busy = true;
    slot = n;
    status.textContent = '';
    render();
    try {
      await readEntries(n);
    } catch (err) {
      entries = null;
      body.replaceChildren(h('p', { class: 'error' }, `Não foi possível ler o perfil ${n}: ${err.message}`));
    }
    busy = false;
    render();
  }

  async function save(next, message) {
    busy = true;
    status.textContent = 'Gravando…';
    render();
    try {
      await session.writeMapping(slot, bytes, buildMapping(next.slice(0, BUTTONS.length)));
      for (const [i, paddle] of EXTRA_KEYS.entries()) {
        await session.writePaddle(slot, paddle, paddleBytes[i], buildPaddle(paddle, next[BUTTONS.length + i]));
      }
      await readEntries(slot); // confirma lendo de volta
      status.textContent = `${message} · salvo no perfil ${slot}`;
    } catch (err) {
      status.textContent = '';
      ctx.toast(`Mapeamento: ${err.message}`, 'error');
    }
    busy = false;
    render();
  }

  // Começa no perfil em uso no controle.
  session.readCurrentProfile()
    .then((r) => {
      active = PROFILE_SLOTS.includes(r.value) ? r.value : null;
      return load(active || 1);
    })
    .catch(() => load(1));
  renderProfiles();

  // O perfil também pode ser trocado pelo próprio controle: confere de tempos em tempos.
  const root = iconCard('mapping', 'Mapeamento de botões', {},
    h('p', { class: 'muted small' }, 'Escolha o que cada botão faz. A mudança é gravada no controle na hora, no perfil que você está editando.'),
    profileRow, activeNote, body, h('div', { class: 'row' }, status));
  const timer = setInterval(() => {
    if (!root.isConnected) {
      if (root.dataset.mounted) clearInterval(timer);
      return;
    }
    root.dataset.mounted = '1';
    if (!busy) refreshActive();
  }, ACTIVE_POLL_MS);
  return root;
}

const ACTIVE_POLL_MS = 3000;

export function firmwareTab() {
  return card('Atualização de firmware',
    h('p', {}, 'Ainda não disponível no UniHub.'),
    h('ul', {},
      h('li', {}, 'Os arquivos de firmware são da GameSir e não podem ser redistribuídos por um projeto open source.'),
      h('li', {}, 'O processo de gravação precisa ser documentado e implementado com validação de modelo e CRC antes de ir para usuários.')),
    h('p', { class: 'muted' }, 'Por enquanto, consulte as normas do fabricante para atualizar.'));
}

export function logTab(session) {
  const pre = h('pre', { class: 'output log' });
  const stats = h('p', { class: 'muted small' });
  function render() {
    if (!pre.isConnected && pre.dataset.mounted) {
      session.removeEventListener('log', render);
      return;
    }
    pre.dataset.mounted = '1';
    pre.textContent = session.log.slice(-120).map((e) =>
      `${new Date(e.time).toLocaleTimeString()} ${e.direction === 'out' ? '→' : '←'} ${toHex(e.bytes)}`).join('\n') || '(vazio)';
    stats.textContent = `Relatórios de estado recebidos: ${session.stateReports} (ocultos no log)`;
  }
  session.addEventListener('log', render);
  queueMicrotask(render);
  return h('div', {}, stats, pre);
}
