// Aba "Gamepads": todos os controles de jogo conectados.
//
// - Controles GameSir conhecidos ganham as opções da GameSir (luzes,
//   vibração, perfis, informações), pela interface de configuração HID.
// - Gamepads de outras marcas aparecem com as opções padrão (teste de
//   botões e informações).

import { h, clear, subTabs, card } from '../../core/dom.js';
import { describe, deviceId } from '../../core/hid-manager.js';
import { gamepadVisualTester, GAMESIR_EXTRA_INDEX } from '../../shared/gamepad-visual.js';
import { disconnectedController, controllerSvg, sonyControllerIcon, proControllerIcon, xboxControllerIcon } from '../../shared/controller-art.js';
import { infoCard, vidPidRow } from '../../shared/info-card.js';
import { VENDOR_ID as GAMESIR_VID, CONFIG_USAGE_PAGE, extraButtonsPressed } from '../../plugins/gamepads/gamesir/protocol.js';
import { GameSirSession } from '../../plugins/gamepads/gamesir/session.js';
import { resolveNames, splitDongles, modelFor, isDongle } from '../../plugins/gamepads/gamesir/names.js';
import { lightsTab } from './gamesir/lights-tab.js';
import { vibrationTab } from './gamesir/vibration-tab.js';
import { deviceTab, profilesTab } from './gamesir/tabs.js';
import { isGamepadInterface, GAMEPAD_FILTERS, brandOf, genericName, isProControllerDevice, isXboxDevice } from '../../plugins/gamepads/brands.js';
import { PadBinder, padMatchesDevice } from '../../plugins/gamepads/pad-binding.js';
import { BatteryAlerts } from '../../shared/battery.js';
import { paintBattery as paintSharedBattery, warnLowBattery as warn } from '../../shared/battery-badge.js';

const BLINK_MS = 1500;
const PROBE_MS = 3000; // de quanto em quanto tempo checa se o controle GameSir ligou/desligou
const VENDOR_PAGE_START = 0xff00;
const PAD_POLL_MS = 33;

// Resultado da última checagem de cada interface GameSir, usado também no Início.
const lastProbe = new WeakMap(); // HIDDevice -> boolean
// Última bateria lida de cada controle GameSir, usada também no Início.
const lastBattery = new WeakMap(); // HIDDevice -> { percent, charging }

const AGE_REFRESH_MS = 30_000; // atualiza o "há X min"
const BACKGROUND_BATTERY_MS = 120_000; // fora de foco, lê a bateria a cada 2 min

function hasPage(device, page) {
  return device.collections.some((c) => c.usagePage === page);
}

/**
 * Interfaces com página do fabricante podem ser um modelo com outro protocolo.
 * As de páginas padrão (jogo 0x01, mídia 0x0C…) são do Windows e não se configuram.
 */
function hasVendorPage(device) {
  return device.collections.some((c) => c.usagePage >= VENDOR_PAGE_START);
}

const isGameSir = (d) => d.vendorId === GAMESIR_VID;

/**
 * Está carregando? O controle avisa no relatório de estado; via cabo e abaixo
 * de 100% também conta como carregando. Com 100% não há o que carregar.
 */
function isCharging(battery, connection) {
  if (!battery || battery.percent >= 100) return false;
  return battery.charging || connection === 'via cabo';
}

/** Bateria no cabeçalho, com a regra de carga dos controles. */
function paintBattery(el, battery, connection, readAt) {
  paintSharedBattery(el, battery, isCharging(battery, connection), readAt);
}

/** Ícone de controle usado nos botões da lista. */
function controllerIcon() {
  const { svg } = controllerSvg('pad-icon');
  svg.setAttribute('viewBox', '20 60 360 240');
  return svg;
}

/** Ícone de um controle: o da marca, quando houver desenho próprio. */
function iconFor(device) {
  if (brandOf(device) === 'Sony') return sonyControllerIcon('pad-icon');
  if (isProControllerDevice(device)) return proControllerIcon('pad-icon');
  if (isGameSir(device) || isXboxDevice(device)) return xboxControllerIcon('pad-icon');
  return controllerIcon();
}

/** Gamepads de outras marcas: interface de jogo padrão, fora da GameSir. */
function otherGamepads(devices) {
  return devices.filter((d) => !isGameSir(d) && isGamepadInterface(d));
}

function gameSirCandidates(devices) {
  return splitDongles(devices.filter((d) => isGameSir(d) && hasPage(d, CONFIG_USAGE_PAGE)));
}

export default {
  id: 'gamepads',
  name: 'Gamepads',
  icon: controllerIcon, // ícone na barra lateral
  tagline: 'Controles de jogo de qualquer marca, com opções extras para GameSir',
  status: 'beta',
  filters: [{ vendorId: GAMESIR_VID }, ...GAMEPAD_FILTERS],

  matches(device) {
    return isGameSir(device) || isGamepadInterface(device);
  },

  /** Nomes mostrados no Início (com a bateria, quando conhecida). Um por controle. */
  summary(devices) {
    const names = resolveNames(devices.filter(isGameSir));
    const gamesir = gameSirCandidates(devices).visible
      .filter((d) => lastProbe.get(d) !== false)
      .map((d) => {
        const battery = lastBattery.get(d);
        return battery ? `${names.get(d).name} · ${battery.percent}%` : names.get(d).name;
      });
    return [...gamesir, ...otherGamepads(devices).map(genericName)];
  },

  mount(container, ctx) {
    const sessions = new Map(); // deviceId -> GameSirSession (uma por controle GameSir)
    const opening = new Map(); // deviceId -> Promise<GameSirSession|null>
    const openErrors = new Map(); // deviceId -> mensagem
    const itemEls = new Map(); // deviceId -> botão na lista
    let headerBattery = null; // { id, el, connection } da bateria no cabeçalho aberto
    const blinking = new Set(); // deviceIds piscando agora
    const online = new Map(); // deviceId -> true se um controle GameSir respondeu
    let devices = [];
    let names = new Map(); // HIDDevice GameSir -> nome amigável
    let selectedId = null;
    let probing = false;

    // Liga cada controle GameSir ao seu gamepad da Gamepad API (ver pad-binding.js).
    const binder = new PadBinder();
    const padTimer = setInterval(() => binder.observe([...navigator.getGamepads()].filter(Boolean)), PAD_POLL_MS);

    const list = h('aside', { class: 'device-list' });
    const detail = h('div', { class: 'device-detail' });
    const workspace = h('div', { class: 'split split-icons' }, list, detail);
    const waiting = h('div', { class: 'connect-screen' },
      disconnectedController(),
      h('h2', {}, 'Conecte seu controle para configurar'),
      h('p', { class: 'muted' }, 'Ligue o controle ou conecte o cabo ou o dongle. Ele aparece aqui sozinho.'));
    clear(container, workspace, waiting);

    const candidates = () => gameSirCandidates(devices);

    /** Controles GameSir em que um controle respondeu. */
    function gameSirControllers() {
      return candidates().visible.filter((d) => online.get(deviceId(d)));
    }

    /** Tudo o que aparece na lista: GameSir primeiro, depois outras marcas. */
    function entries() {
      return [
        ...gameSirControllers().map((device) => ({ kind: 'gamesir', device })),
        ...otherGamepads(devices).map((device) => ({ kind: 'generic', device })),
      ];
    }

    // Pergunta a versão do firmware a cada interface GameSir. Um dongle com o
    // controle desligado continua no sistema, mas não responde, e fica fora.
    async function probeAll() {
      if (probing) return;
      probing = true;
      let changed = false;
      for (const d of candidates().visible) {
        const session = await ensureSession(d);
        const ok = session ? await session.probe() : false;
        const id = deviceId(d);
        lastProbe.set(d, ok);
        if (online.get(id) !== ok) {
          online.set(id, ok);
          changed = true;
        }
      }
      probing = false;
      if (changed) {
        refresh();
        ctx.changed?.();
      }
    }
    const probeTimer = setInterval(probeAll, PROBE_MS);

    function refresh() {
      const all = entries();
      workspace.hidden = all.length === 0;
      waiting.hidden = all.length > 0;
      if (selectedId && !all.some((e) => deviceId(e.device) === selectedId)) {
        selectedId = null;
        clear(detail, h('div', { class: 'empty' }, 'Selecione um controle na lista.'));
      }
      if (!selectedId && all.length) select(deviceId(all[0].device));
      else renderList();
    }

    /**
     * Pisca a entrada por 1,5 s quando o controle GameSir é tocado fisicamente.
     * Serve para diferenciar controles GameSir; só eles mandam o aviso de toque.
     */
    function blink(id) {
      if (gameSirControllers().length < 2) return;
      if (blinking.has(id)) return;
      blinking.add(id);
      itemEls.get(id)?.classList.add('blink');
      setTimeout(() => {
        blinking.delete(id);
        itemEls.get(id)?.classList.remove('blink');
      }, BLINK_MS);
    }

    // --- Bateria -------------------------------------------------------------

    const alerts = new BatteryAlerts();

    function connectionOf(device) {
      return names.get(device)?.connection || resolveNames(devices.filter(isGameSir)).get(device)?.connection;
    }

    /** A bateria de um controle mudou: atualiza cabeçalho, lista, Início e avisos. */
    function onBattery(id, device, session, battery) {
      const connection = connectionOf(device);
      lastBattery.set(device, battery);
      if (headerBattery?.id === id) paintBattery(headerBattery.el, battery, connection, session.batteryAt);
      ctx.changed?.();
      const threshold = alerts.check(id, { percent: battery.percent, charging: isCharging(battery, connection) });
      if (threshold !== null) warnLowBattery(device, battery.percent);
    }

    function warnLowBattery(device, percent) {
      const name = names.get(device)?.name || 'Controle';
      warn(ctx, `${name} com ${percent}% de bateria. Conecte o cabo para carregar.`);
    }

    // O "há X min" do cabeçalho envelhece mesmo sem leituras novas.
    const ageTimer = setInterval(() => {
      const session = headerBattery && sessions.get(headerBattery.id);
      if (session?.battery) paintBattery(headerBattery.el, session.battery, headerBattery.connection, session.batteryAt);
    }, AGE_REFRESH_MS);

    // Fora de foco o controle não recebe o heartbeat e para de mandar o estado;
    // de tempos em tempos, uma leitura rápida mantém a bateria (e os avisos) em dia.
    const backgroundTimer = setInterval(async () => {
      if (document.hasFocus()) return;
      for (const d of gameSirControllers()) {
        const session = sessions.get(deviceId(d));
        if (session) await session.pulse();
      }
    }, BACKGROUND_BATTERY_MS);

    // Cada controle GameSir fica com a sessão aberta: o heartbeat faz o
    // controle mandar o relatório de estado, que é o que detecta o toque.
    function ensureSession(device) {
      const id = deviceId(device);
      if (!opening.has(id)) {
        const session = new GameSirSession(device);
        session.addEventListener('activity', () => {
          binder.observe([...navigator.getGamepads()].filter(Boolean));
          binder.touched(id);
          blink(id);
        });
        session.addEventListener('battery', (e) => onBattery(id, device, session, e.detail));
        sessions.set(id, session);
        opening.set(id, session.open().then(() => {
          openErrors.delete(id);
          return session;
        }, (err) => {
          sessions.delete(id);
          opening.delete(id);
          openErrors.set(id, String(err.message || err));
          return null;
        }));
      }
      return opening.get(id);
    }

    function labelFor(entry) {
      if (entry.kind === 'gamesir') return names.get(entry.device);
      return { name: genericName(entry.device), connection: brandOf(entry.device), systemName: entry.device.productName };
    }

    function renderList() {
      const all = entries();
      // GameSir com outro protocolo: interface com página do fabricante, fora de dongles.
      const others = devices.filter((d) => isGameSir(d) && !hasPage(d, CONFIG_USAGE_PAGE) && hasVendorPage(d) && !isDongle(d));
      names = resolveNames(devices.filter(isGameSir));
      itemEls.clear();
      // Na lista, só o ícone: nome e conexão aparecem no cabeçalho do controle aberto.
      clear(list,
        all.map((entry) => {
          const info = describe(entry.device);
          const label = labelFor(entry);
          const text = [label.name, label.connection].filter(Boolean).join(' · ');
          const el = h('button', {
            class: 'device-item icon-only' + (info.id === selectedId ? ' active' : '') + (blinking.has(info.id) ? ' blink' : ''),
            'aria-label': text,
            onclick: () => select(info.id),
          }, iconFor(entry.device));
          itemEls.set(info.id, el);
          return el;
        }),
        others.length ? h('details', { class: 'others' },
          h('summary', {}, `${others.length} outra(s) interface(s) GameSir`),
          others.map((d) => {
            const info = describe(d);
            return h('div', { class: 'muted small' }, `${names.get(d).name} · ${info.vidPid} · páginas ${info.usagePages.map((p) => '0x' + p.toString(16)).join(', ')}`);
          }),
          h('p', { class: 'muted small' }, 'Modelos com outro protocolo. Ainda não configuráveis aqui.')) : null,
      );
    }

    async function select(id) {
      selectedId = id;
      renderList();
      const entry = entries().find((e) => deviceId(e.device) === id);
      if (!entry) return clear(detail, h('div', { class: 'empty' }, 'Selecione um controle.'));
      if (entry.kind === 'generic') return renderGenericDetail(entry);
      const session = await ensureSession(entry.device);
      if (!session) {
        return clear(detail, card('Não foi possível abrir o controle', h('p', {}, openErrors.get(id)),
          h('p', { class: 'muted' }, 'Feche outros apps que estejam usando o controle e tente de novo.')));
      }
      renderGameSirDetail(session, labelFor(entry));
    }

    // Nome · bateria · conexão. A bateria se atualiza sozinha (evento 'battery' da sessão).
    function header(label, session = null) {
      const battery = h('span', { class: 'battery' });
      if (session) {
        const id = deviceId(session.device);
        headerBattery = { id, el: battery, connection: label.connection };
        paintBattery(battery, session.battery, label.connection, session.batteryAt);
      } else {
        headerBattery = null;
        battery.hidden = true;
      }
      return h('div', { class: 'detail-head' },
        h('h2', {}, label.name, battery, label.connection ? h('span', { class: 'pill' }, label.connection) : null),
        gameSirControllers().length > 1
          ? h('p', { class: 'muted small' }, 'Aperte um botão no controle: o ícone dele pisca na lista.') : null);
    }

    // Teste de botões só com o gamepad deste controle.
    function testerFor(id, kind, device, session = null) {
      return gamepadVisualTester({
        art: kind === 'gamesir' ? (modelFor(device) === 'cyclone2' ? 'cyclone2' : 'gamesir') : null,
        extraPressed: () => (modelFor(device) === 'cyclone2'
          ? extraButtonsPressed(session?.lastState).map((id) => GAMESIR_EXTRA_INDEX[id]) : []),
        select: (pads) => {
          const free = pads.filter((p) => binder.unboundIndexes([p.index]).length);
          if (kind === 'generic') return free.filter((p) => padMatchesDevice(p, device));
          const bound = binder.padFor(id);
          if (bound !== undefined) return pads.filter((p) => p.index === bound);
          // Sem ambiguidade: um só controle na lista e um só gamepad livre.
          return entries().length === 1 && free.length === 1 ? free : [];
        },
        hint: () => 'Aperte um botão neste controle para ele aparecer aqui.',
      });
    }

    function renderGameSirDetail(session, label) {
      const id = deviceId(session.device);
      const tabs = subTabs([
        { id: 'device', label: 'Dispositivo', render: () => deviceTab(session, label, describe(session.device).vidPid, modelFor(session.device), ctx) },
        { id: 'lights', label: 'Luzes', render: () => lightsTab(session, ctx, modelFor(session.device)) },
        { id: 'vibration', label: 'Vibração', render: () => vibrationTab(session, ctx) },
        { id: 'test', label: 'Teste de botões', render: () => testerFor(id, 'gamesir', session.device, session) },
        { id: 'mapping', label: 'Mapeamento', render: () => profilesTab(session, ctx, modelFor(session.device)) },
      ]);
      clear(detail, header(label, session), tabs.element);
    }

    function renderGenericDetail(entry) {
      const label = labelFor(entry);
      const info = describe(entry.device);
      // Padrão de todas as abas: Dispositivo primeiro, depois as opções.
      const tabs = subTabs([
        { id: 'device', label: 'Dispositivo', render: () => infoCard({
          rows: [['Fabricante', label.connection || 'Desconhecido'], ['Nome no sistema', label.systemName || '—'], ['VID:PID', vidPidRow(info.vidPid)]],
          note: 'Opções avançadas desta marca ainda não estão disponíveis no UnusHub.',
          label,
        }) },
        { id: 'test', label: 'Teste de botões', render: () => testerFor(deviceId(entry.device), 'generic', entry.device) },
      ]);
      clear(detail, header(label), tabs.element);
    }

    clear(detail, h('div', { class: 'empty' }, 'Selecione um controle na lista.'));
    refresh();

    return {
      update(next) {
        devices = next;
        const present = new Set(candidates().visible.map(deviceId));
        for (const [id, session] of sessions) {
          if (!present.has(id)) {
            session.close();
            sessions.delete(id);
            opening.delete(id);
            online.delete(id);
          }
        }
        refresh();
        probeAll();
      },
      /** Controles para os cartões do Início: um por controle conectado. */
      cards() {
        const gamesirNames = resolveNames(devices.filter(isGameSir));
        return entries().map((entry) => {
          const id = deviceId(entry.device);
          const label = entry.kind === 'gamesir' ? gamesirNames.get(entry.device) : labelFor(entry);
          const battery = sessions.get(id)?.battery || null;
          return {
            id,
            name: label.name,
            connection: label.connection,
            icon: () => iconFor(entry.device),
            battery: battery ? { percent: battery.percent, charging: isCharging(battery, label.connection) } : null,
          };
        });
      },
      /** Abre o controle escolhido (ex.: clique no cartão do Início). */
      focus(id) {
        select(id);
      },
      unmount() {
        clearInterval(probeTimer);
        clearInterval(padTimer);
        clearInterval(ageTimer);
        clearInterval(backgroundTimer);
        for (const s of sessions.values()) s.close();
        sessions.clear();
        opening.clear();
      },
    };
  },
};
