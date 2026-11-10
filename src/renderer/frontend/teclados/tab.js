// Aba "Teclados": teclados de qualquer marca, com fio, pelo dongle, por
// Bluetooth e o do notebook.
//
// Os teclados vêm do WebHID; a lista de teclados do Windows (processo
// principal) diz quais são Bluetooth e traz os que o WebHID não mostra (o do
// notebook, PS/2 ou interno). Esses ganham só as informações e o teste de teclas.
//
// Cada teclado ganha as informações do aparelho e o teste de teclas. Opções
// próprias de cada marca (luzes, macros, perfis) dependem do protocolo do
// fabricante e ainda não existem.
//
// AULA série F (F75, F87, F99): reconhecido no cabo e pelo receptor 2.4G, como
// um teclado só. O modelo é escolhido pelo usuário (o USB não informa) e dá o
// nome e o desenho do teste de teclas (o F75 tem desenho próprio). Ganha
// também a aba Luzes (efeito, brilho, velocidade e cores) e, pelo dongle, a
// bateria (no cabo ele está carregando). A aba Luzes usa os
// comandos da AULA: só aparece para teclados AULA. Outra marca de teclado
// precisa do próprio plugin em plugins/teclados/<marca>/.

import { h, clear, subTabs } from '../../core/dom.js';
import { infoCard, vidPidRow } from '../../shared/info-card.js';
import { BatteryAlerts } from '../../shared/battery.js';
import { paintBattery, warnLowBattery } from '../../shared/battery-badge.js';
import { keyboardIcon, disconnectedKeyboard } from '../../shared/keyboard-art.js';
import { isKeyboardOrMouse, keyboardGroups, systemKeyboards, brandOf, KEYBOARD_FILTERS } from '../../plugins/teclados/detect.js';
import { keyTester } from './key-tester.js';
import { MODELS, savedModel, saveModel, aulaName, aulaTester, aulaMaxBrightness } from '../../plugins/teclados/aula/devices.js';
import { AulaSession, configInterface } from '../../plugins/teclados/aula/session.js';
import { aulaLightsTab } from './aula/lights-tab.js';

const BATTERY_POLL_MS = 60_000;
const SYSTEM_REFRESH_MS = 1500; // espera o Windows terminar de instalar o aparelho

// Última lista de teclados do Windows (usada também no Início).
let lastSystem = [];

const hex4 = (n) => n.toString(16).padStart(4, '0');

/**
 * Teclados com o nome final: AULA, o do modelo escolhido; Bluetooth, o nome do
 * aparelho no Windows. Mais os que só o Windows mostra (notebook, Bluetooth).
 */
function namedKeyboards(devices) {
  const model = savedModel();
  const hidVidPids = new Set(devices.map((d) => `${hex4(d.vendorId)}:${hex4(d.productId)}`));
  const { bluetooth, extra } = systemKeyboards(lastSystem, hidVidPids);
  const hid = keyboardGroups(devices).map((k) => {
    if (k.brand === 'aula') return { ...k, systemName: k.name, name: aulaName(model) };
    if (!bluetooth.has(k.vidPid)) return k;
    return { ...k, systemName: k.name, name: bluetooth.get(k.vidPid) || k.name, connection: 'via Bluetooth' };
  });
  return [...hid, ...extra];
}

export default {
  id: 'keyboards',
  name: 'Teclados',
  icon: keyboardIcon, // ícone na barra lateral
  tagline: 'Teclados de qualquer marca, com teste de teclas e opções extras para AULA',
  status: 'beta',
  filters: KEYBOARD_FILTERS,

  matches: isKeyboardOrMouse,

  summary(devices) {
    return namedKeyboards(devices).map((k) => k.name);
  },

  mount(container, ctx) {
    let keyboards = [];
    let devices = [];
    let selectedId = null;
    let renderedId = null;
    const sessions = new Map(); // HIDDevice de configuração AULA -> AulaSession
    const batteries = new Map(); // id do teclado -> { percent, charging, at }
    const alerts = new BatteryAlerts();
    let headerBattery = null; // { id, el } da bateria no cabeçalho

    const list = h('aside', { class: 'device-list' });
    const detail = h('div', { class: 'device-detail' });
    const workspace = h('div', { class: 'split split-icons' }, list, detail);
    const waiting = h('div', { class: 'connect-screen' },
      disconnectedKeyboard(),
      h('h2', {}, 'Conecte seu teclado para configurar'),
      h('p', { class: 'muted' }, 'Ligue o teclado pelo cabo USB, pelo dongle ou por Bluetooth. Ele aparece aqui sozinho.'));
    clear(container, workspace, waiting);

    function renderList() {
      workspace.hidden = keyboards.length === 0;
      waiting.hidden = keyboards.length > 0;
      clear(list, keyboards.map((k) => h('button', {
        class: 'device-item icon-only' + (k.id === selectedId ? ' active' : ''),
        'aria-label': k.name,
        onclick: () => select(k.id),
      }, keyboardIcon())));
    }

    function select(id) {
      selectedId = id;
      renderList();
      const k = keyboards.find((e) => e.id === id);
      if (!k) {
        renderedId = null;
        return clear(detail, h('div', { class: 'empty' }, 'Selecione um teclado.'));
      }
      renderedId = id;
      const aula = k.brand === 'aula';
      const vendorId = k.vidPid ? parseInt(k.vidPid.slice(0, 4), 16) : null;
      const brand = aula ? 'AULA' : vendorId !== null ? brandOf(vendorId) : null;
      const connection = {
        'via cabo': 'Cabo USB', 'via dongle': 'Dongle sem fio', 'via Bluetooth': 'Bluetooth', integrado: 'Integrado ao notebook',
      }[k.connection];
      // Dispositivo primeiro (padrão de todas as abas).
      const tabs = subTabs([
        { id: 'device', label: 'Dispositivo', render: () => infoCard({
          rows: [
            ['Nome no sistema', k.systemName || k.name],
            ...(aula ? [['Modelo', modelPicker()]] : []),
            ['Fabricante', brand || 'Não identificado'],
            ...(connection ? [['Conexão', connection]] : []),
            ...(k.vidPid ? [['VID:PID', vidPidRow(k.vidPid.toUpperCase())]] : []),
          ],
          note: aula
            ? 'Troca de teclas e macros ainda não estão disponíveis no UnusHub.'
            : 'Luzes, macros e perfis desta marca ainda não estão disponíveis no UnusHub.',
          label: { name: k.name, connection: k.connection },
        }) },
        aula && configInterface(k.devices)
          ? { id: 'lights', label: 'Luzes', render: () => aulaLightsTab(sessionFor(configInterface(k.devices)), { maxBrightness: aulaMaxBrightness(savedModel()) }) }
          : null,
        { id: 'keys', label: 'Teste de teclas', render: () => keyTester(aula ? aulaTester(savedModel()) : {}) },
      ].filter(Boolean));
      const battery = h('span', { class: 'battery' });
      headerBattery = { id, el: battery };
      paintHeaderBattery();
      clear(detail,
        h('div', { class: 'detail-head' }, h('h2', {}, k.name, battery, k.connection ? h('span', { class: 'pill' }, k.connection) : null)),
        tabs.element);
    }

    function paintHeaderBattery() {
      if (!headerBattery) return;
      const b = batteries.get(headerBattery.id);
      paintBattery(headerBattery.el, b ? { percent: b.percent } : null, !!b?.charging, b?.at);
    }

    // --- Bateria (AULA pelo dongle) ---------------------------------------------

    const wireless = () => keyboards.filter((k) => k.brand === 'aula' && k.connection === 'via dongle' && configInterface(k.devices));

    function refreshBatteries() {
      for (const k of wireless()) {
        sessionFor(configInterface(k.devices)).readBattery().then((b) => {
          if (!b) return; // teclado dormindo: fica a última leitura
          batteries.set(k.id, { ...b, at: Date.now() });
          const threshold = alerts.check(k.id, b);
          if (threshold !== null) warnLowBattery(ctx, `${k.name} com ${b.percent}% de bateria. Coloque para carregar.`);
          if (headerBattery?.id === k.id) paintHeaderBattery();
          ctx?.changed?.();
        }).catch(() => {});
      }
    }
    const pollTimer = setInterval(refreshBatteries, BATTERY_POLL_MS);

    // --- Teclados do Windows (Bluetooth e notebook) --------------------------------

    let systemTimer = 0;
    function refreshSystem() {
      if (!window.unihub?.systemKeyboards) return;
      window.unihub.systemKeyboards().then((list) => {
        lastSystem = Array.isArray(list) ? list : [];
        applyKeyboards();
        ctx?.changed?.();
      }).catch(() => {});
    }
    const scheduleSystem = () => {
      clearTimeout(systemTimer);
      systemTimer = setTimeout(refreshSystem, SYSTEM_REFRESH_MS);
    };
    refreshSystem();

    /** Lista e painel conforme os teclados atuais. */
    function applyKeyboards() {
      const before = new Set(keyboards.map((k) => k.id));
      keyboards = namedKeyboards(devices);
      // Bateria só de quem está no dongle agora; teclado novo é lido na hora.
      const onDongle = new Set(wireless().map((k) => k.id));
      for (const id of batteries.keys()) if (!onDongle.has(id)) batteries.delete(id);
      if ([...onDongle].some((id) => !before.has(id))) refreshBatteries();
      if (!keyboards.some((k) => k.id === selectedId)) selectedId = keyboards[0]?.id ?? null;
      renderList();
      if (!selectedId) {
        renderedId = null;
        headerBattery = null;
        clear(detail);
      } else if (selectedId !== renderedId) {
        select(selectedId);
      }
    }

    /** Uma sessão por interface de configuração, aberta na primeira vez que a aba Luzes abre. */
    function sessionFor(device) {
      if (!sessions.has(device)) {
        const session = new AulaSession(device);
        session.ready = session.open();
        sessions.set(device, session);
      }
      const session = sessions.get(device);
      return {
        readLed: () => session.ready.then(() => session.readLed()),
        writeLed: (b) => session.ready.then(() => session.writeLed(b)),
        readColors: () => session.ready.then(() => session.readColors()),
        writeColors: (t) => session.ready.then(() => session.writeColors(t)),
        readBattery: () => session.ready.then(() => session.readBattery()),
      };
    }

    /** Fecha as sessões de teclados que saíram. */
    function closeGone() {
      const present = new Set(devices);
      for (const [device, session] of sessions) {
        if (!present.has(device)) {
          session.close();
          sessions.delete(device);
        }
      }
    }

    /**
     * Escolha do modelo AULA: o USB não informa. Trocar redesenha o teclado
     * (nome, cartão do Início e desenho do teste).
     */
    function modelPicker() {
      const current = savedModel();
      return h('span', { class: 'model-pick' },
        h('span', { class: 'segmented', role: 'group', 'aria-label': 'Modelo do teclado' },
          Object.entries(MODELS).map(([id, name]) => h('button', {
            class: 'btn' + (id === current ? ' primary' : ' secondary'),
            'aria-pressed': String(id === current),
            onclick: () => {
              saveModel(id);
              renderedId = null;
              keyboards = namedKeyboards(devices);
              select(selectedId);
              ctx?.changed?.();
            },
          }, name.replace(/^AULA /, '')))),
        h('small', { class: 'muted' }, current ? 'O modelo não aparece pelo USB: confira se é o seu.' : 'O modelo não aparece pelo USB: escolha o seu.'));
    }

    return {
      update(next) {
        devices = next;
        closeGone();
        applyKeyboards();
        // Um teclado Bluetooth entrou ou saiu: a lista do Windows muda junto.
        scheduleSystem();
      },
      /** Teclados para os cartões do Início. */
      cards() {
        return keyboards.map((k) => {
          const b = batteries.get(k.id);
          return { id: k.id, name: k.name, connection: k.connection, battery: b ? { percent: b.percent, charging: b.charging } : null };
        });
      },
      /** Abre o teclado escolhido (ex.: clique no cartão do Início). */
      focus(id) {
        select(id);
      },
      unmount() {
        clearInterval(pollTimer);
        clearTimeout(systemTimer);
        for (const session of sessions.values()) session.close();
        sessions.clear();
      },
    };
  },
};
