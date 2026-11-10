// Aba "Headsets": fones e headsets de qualquer marca, pelo dongle, pelo cabo
// ou por Bluetooth.
//
// - Headsets MCHOSE conhecidos ganham as opções da MCHOSE (bateria, firmware
//   e, pelo dongle, Configurações de áudio). Fone desligado conta como não
//   conectado.
// - Headsets Logitech (o HID++ diz que o aparelho é do tipo "Headset") ganham
//   nome, bateria e versão do protocolo, pelo plugin da Logitech.
// - Fones de outras marcas (e MCHOSE por Bluetooth) ganham as Configurações de
//   áudio, que só usam o som do sistema, as informações do aparelho e, por
//   Bluetooth, a bateria que o Windows conhece.

import { h, clear, card, subTabs } from '../../core/dom.js';
import { describe, deviceId } from '../../core/hid-manager.js';
import { infoCard, vidPidRow } from '../../shared/info-card.js';
import { BatteryAlerts } from '../../shared/battery.js';
import { paintBattery, warnLowBattery } from '../../shared/battery-badge.js';
import { headsetIcon, disconnectedHeadset } from '../../shared/headset-art.js';
import { headsetAudioTab } from '../../shared/headset-audio.js';
import { VENDOR_ID as MCHOSE_VID, WIRED_VENDOR_ID as MCHOSE_WIRED_VID, isMchoseDevice, isWired, modelName } from '../../plugins/headsets/mchose/protocol.js';
import { groupHeadsets, soundDeviceMatcher, connectionOf, isMchoseSound } from '../../plugins/headsets/mchose/devices.js';
import { MchoseSession } from '../../plugins/headsets/mchose/session.js';
import { VENDOR_ID as LOGITECH_VID } from '../../plugins/headsets/logitech/hidpp.js';
import { LogitechSession } from '../../plugins/headsets/logitech/session.js';
import { isLogitechHidpp, logitechHeadsets, batteryView } from '../../plugins/headsets/logitech/headsets.js';
import {
  isHeadsetInterface, soundHeadsets, genericHeadsets, bluetoothBatteryFor, soundMatcherFor, CONNECTION_TEXT, TELEPHONY_USAGE_PAGE,
} from '../../plugins/headsets/detect.js';

const BATTERY_POLL_MS = 60_000; // o fone avisa mudanças sozinho; isto é só garantia
const AGE_REFRESH_MS = 30_000;

const STATE_TEXT = {
  discharging: '', // na bateria, sem carregar: é o normal, sem etiqueta
  charging: 'Carregando',
  full: 'Carregada',
  asleep: 'Fone desligado',
  unknown: '', // sem estado (ex.: no cabo com 100%): só a porcentagem
};

// Usados também no Início (que só recebe a lista HID).
const lastBattery = new WeakMap(); // HIDDevice MCHOSE -> { percent, asleep }
let lastSoundOnly = []; // fones vistos só pela lista de som (ex.: Bluetooth): "Nome" ou "Nome · 80%"

let lastLogitech = []; // headsets Logitech achados pelo HID++: "Nome" ou "Nome · 80%"

const otherBrandHid = (devices) => devices.filter((d) => !isMchoseDevice(d) && isHeadsetInterface(d));
const hex4 = (n) => n.toString(16).padStart(4, '0');

export default {
  id: 'headsets',
  name: 'Headsets',
  icon: headsetIcon, // ícone na barra lateral
  tagline: 'Fones e headsets de qualquer marca, com opções extras para MCHOSE e Logitech',
  status: 'beta',
  filters: [{ vendorId: MCHOSE_VID }, { vendorId: MCHOSE_WIRED_VID }, { vendorId: LOGITECH_VID }, { usagePage: TELEPHONY_USAGE_PAGE }],

  matches(device) {
    return isMchoseDevice(device) || isHeadsetInterface(device) || isLogitechHidpp(device);
  },

  summary(devices) {
    // Fone MCHOSE desligado (só o dongle no PC) conta como não conectado, como os controles.
    const mchose = groupHeadsets(devices).filter(([d]) => !lastBattery.get(d)?.asleep).map(([d]) => {
      if (isWired(d)) return `${modelName(d)} · carregando`;
      const battery = lastBattery.get(d);
      return battery ? `${modelName(d)} · ${battery.percent}%` : modelName(d);
    });
    // Interfaces Logitech que são headsets já entram em lastLogitech.
    const generic = otherBrandHid(devices).filter((d) => d.vendorId !== LOGITECH_VID).map((d) => d.productName || 'Headset');
    return [...mchose, ...lastLogitech, ...generic, ...lastSoundOnly];
  },

  mount(container, ctx) {
    const sessions = new Map(); // deviceId -> MchoseSession
    const alerts = new BatteryAlerts();
    let devices = [];
    let sound = []; // fones na lista de som do sistema
    let selectedId = null;
    let headerBattery = null; // { id, el, stateEl }
    let renderedId = null; // fone desenhado no painel (evita redesenhar a cada mudança de USB)
    let btBatteries = []; // [{ name, percent }] que o Windows conhece (fones Bluetooth)
    let genericBattery = null; // { id, el } da bateria no cabeçalho de um fone comum
    // Interfaces HID++ da Logitech: deviceId -> { device, session, headsets }
    const logi = new Map();

    const list = h('aside', { class: 'device-list' });
    const detail = h('div', { class: 'device-detail' });
    const workspace = h('div', { class: 'split split-icons' }, list, detail);
    const waiting = h('div', { class: 'connect-screen' },
      disconnectedHeadset(),
      h('h2', {}, 'Conecte seu headset para configurar'),
      h('p', { class: 'muted' }, 'Ligue o fone pelo dongle, pelo cabo USB ou por Bluetooth. Ele aparece aqui sozinho.'));
    clear(container, workspace, waiting);

    // --- Quem aparece na lista ------------------------------------------------

    const mchoseGroups = () => groupHeadsets(devices);

    /**
     * MCHOSE na lista: no cabo, ou pelo dongle com o fone ligado. Dongle sem
     * fone fica fora, mas a sessão continua aberta para perceber quando o fone
     * ligar (aviso 0x11 do dongle).
     */
    function visibleMchose() {
      return mchoseGroups().filter((g) => {
        if (isWired(g[0])) return true;
        const battery = sessions.get(deviceId(g[0]))?.battery;
        return !!battery && !battery.asleep;
      });
    }

    function logitechEntries() {
      return [...logi.values()].flatMap(({ device, headsets }) => headsets.map((hs) => ({
        id: `logi:${deviceId(device)}:${hs.index}`, kind: 'logitech', device, headset: hs, name: hs.name,
      })));
    }

    function entries() {
      const mchose = visibleMchose();
      const models = mchose.map((g) => modelName(g[0]));
      const logitech = logitechEntries();
      // O som e o HID de um headset Logitech já mostrado não viram fone comum.
      const logiDevices = new Set(logitech.map((e) => e.device));
      const logiCodes = new Set(logitech.map((e) => `${hex4(e.device.vendorId)}:${hex4(e.device.productId)}`));
      const generic = genericHeadsets({
        hid: otherBrandHid(devices).filter((d) => !logiDevices.has(d)),
        sound,
        claimed: (s) => isMchoseSound(s, models) || (!!s.vidPid && logiCodes.has(s.vidPid)),
      });
      lastLogitech = logitech.map((e) => {
        const b = batteryView(e.headset.battery);
        return b.percent !== null ? `${e.name} · ${b.percent}%` : e.name;
      });
      // Bateria de fone Bluetooth: só para os que estão na lista de som, ou
      // seja, conectados (o Windows guarda o último valor dos só pareados).
      for (const g of generic) g.battery = g.transport === 'bluetooth' ? bluetoothBatteryFor(btBatteries, g.name) : null;
      lastSoundOnly = generic.filter((e) => !e.device).map((e) => (e.battery !== null ? `${e.name} · ${e.battery}%` : e.name));
      return [
        ...mchose.map((group) => ({ id: deviceId(group[0]), kind: 'mchose', group, name: modelName(group[0]) })),
        ...logitech,
        ...generic.map((g) => ({ id: g.device ? deviceId(g.device) : g.key, kind: 'generic', generic: g, name: g.name })),
      ];
    }

    async function refreshSound() {
      try {
        sound = soundHeadsets(await navigator.mediaDevices.enumerateDevices());
      } catch {
        sound = [];
      }
      refreshView();
      ctx.changed?.();
      // Fone que acabou de conectar: pergunta a bateria ao Windows na hora.
      if (sound.some((s) => s.transport === 'bluetooth')) refreshBluetooth();
    }
    navigator.mediaDevices?.addEventListener('devicechange', refreshSound);

    async function refreshBluetooth() {
      if (!window.unihub?.bluetoothBatteries) return;
      try {
        btBatteries = await window.unihub.bluetoothBatteries();
      } catch {
        btBatteries = [];
      }
      const all = entries();
      for (const e of all) {
        if (e.kind !== 'generic' || e.generic.battery === null) continue;
        const threshold = alerts.check(e.id, { percent: e.generic.battery, charging: false });
        if (threshold !== null) warnLowBattery(ctx, `${e.name} com ${e.generic.battery}% de bateria. Coloque para carregar.`);
        if (genericBattery?.id === e.id) paintBattery(genericBattery.el, { percent: e.generic.battery }, false);
      }
      ctx.changed?.();
    }

    // --- MCHOSE: sessão e bateria ---------------------------------------------

    function sessionFor(group) {
      const id = deviceId(group[0]);
      if (!sessions.has(id)) {
        const session = new MchoseSession(group);
        session.addEventListener('battery', (e) => onBattery(id, group[0], session, e.detail));
        session.ready = session.open().then(() => session.readBattery()).catch((err) => {
          session.error = String(err.message || err);
        });
        sessions.set(id, session);
      }
      return sessions.get(id);
    }

    function onBattery(id, device, session, battery) {
      lastBattery.set(device, battery);
      ctx.changed?.();
      if (headerBattery?.id === id) paintHeader(session);
      // Ligou ou desligou: entra ou sai da lista.
      refreshView();
      if (battery.asleep || isWired(device)) return;
      const threshold = alerts.check(id, { percent: battery.percent, charging: battery.charging });
      if (threshold !== null) warnLowBattery(ctx, `${modelName(device)} com ${battery.percent}% de bateria. Coloque para carregar.`);
    }

    // No cabo o fone só carrega: a bateria aparece só pelo dongle, que é
    // também o único modo em que as opções do fone valem.
    function paintHeader(session) {
      if (isWired(session.statusDevice)) {
        paintBattery(headerBattery.el, null);
        headerBattery.stateEl.textContent = STATE_TEXT.charging;
        headerBattery.stateEl.hidden = false;
        return;
      }
      const b = session.battery;
      paintBattery(headerBattery.el, b && !b.asleep ? b : null, !!b?.charging, session.batteryAt);
      headerBattery.stateEl.textContent = b ? STATE_TEXT[b.state] : '…';
      headerBattery.stateEl.hidden = !headerBattery.stateEl.textContent;
    }

    // --- Lista e painel ---------------------------------------------------------

    function renderList(all) {
      workspace.hidden = all.length === 0;
      waiting.hidden = all.length > 0;
      clear(list, all.map((entry) => h('button', {
        class: 'device-item icon-only' + (entry.id === selectedId ? ' active' : ''),
        'aria-label': entry.name,
        onclick: () => select(entry.id),
      }, headsetIcon())));
    }

    async function select(id) {
      selectedId = id;
      const all = entries();
      renderList(all);
      const entry = all.find((e) => e.id === id);
      if (!entry) return clear(detail, h('div', { class: 'empty' }, 'Selecione um headset.'));
      renderedId = id;
      genericBattery = null;
      if (entry.kind === 'generic') return renderGeneric(entry.generic, id);
      if (entry.kind === 'logitech') return renderLogitech(entry);
      const session = sessionFor(entry.group);
      await session.ready;
      if (selectedId !== id) return;
      if (session.error) {
        return clear(detail, card('Não foi possível abrir o headset', h('p', {}, session.error),
          h('p', { class: 'muted' }, 'Feche outros apps que estejam usando o headset e tente de novo.')));
      }
      renderMchose(session, entry.group[0]);
    }

    function renderMchose(session, device) {
      const battery = h('span', { class: 'battery' });
      const state = h('span', { class: 'pill' });
      headerBattery = { id: deviceId(device), el: battery, stateEl: state };
      paintHeader(session);
      // Dispositivo primeiro (padrão de todas as abas). As opções de áudio só
      // valem pelo dongle; no cabo o fone só carrega.
      const tabs = subTabs([
        { id: 'device', label: 'Dispositivo', render: () => mchoseDeviceTab(session, device) },
        !isWired(device) ? { id: 'audio', label: 'Configurações de áudio', render: () => mchoseAudioTab(device) } : null,
      ].filter(Boolean));
      clear(detail,
        h('div', { class: 'detail-head' }, h('h2', {}, modelName(device), battery, state, h('span', { class: 'pill' }, connectionOf(device)))),
        tabs.element);
    }

    function mchoseDeviceTab(session, device) {
      const firmware = h('strong', {}, '…');
      session.readVersion()
        .then((v) => { firmware.textContent = v || '—'; })
        .catch(() => { firmware.textContent = '—'; });
      // Versão do dongle: o Windows guarda no ID do aparelho USB (REV_xxxx).
      // No cabo o dongle não está em uso, como nos controles.
      const dongle = h('strong', { class: isWired(device) ? 'muted' : '' }, isWired(device) ? 'Não usado' : '…');
      if (!isWired(device)) {
        Promise.resolve(window.unihub?.usbRevision?.(device.vendorId, device.productId))
          .then((v) => { dongle.textContent = v || '—'; })
          .catch(() => { dongle.textContent = '—'; });
      }
      return h('div', { class: 'device-cards' },
        infoCard({
          rows: [
            ['Firmware do fone', firmware],
            ['Dongle', dongle],
            ['VID:PID', vidPidRow(describe(device).vidPid)],
          ],
          note: 'Para atualizar consulte as normas do fabricante.',
          label: { name: modelName(device), connection: connectionOf(device) },
        }));
    }

    function mchoseAudioTab(device) {
      return headsetAudioTab({
        matches: soundDeviceMatcher(device),
        driverNote: 'Equalizador, surround virtual e efeitos de microfone funcionam no driver de áudio da MCHOSE, instalado no PC, e não no próprio fone. Por enquanto, ajuste pelo app oficial.',
      });
    }

    function renderGeneric(g, id) {
      headerBattery = null;
      const battery = h('span', { class: 'battery' });
      genericBattery = { id, el: battery };
      paintBattery(battery, g.battery !== null ? { percent: g.battery } : null, false);
      const connection = CONNECTION_TEXT[g.transport];
      // Dispositivo primeiro (padrão de todas as abas). Configurações de áudio
      // usam só o som do sistema: valem para qualquer fone.
      const tabs = subTabs([
        { id: 'device', label: 'Dispositivo', render: () => infoCard({
          rows: [
            ['Nome no sistema', g.device?.productName || g.name],
            ['Conexão', connection ? connection.replace(/^via /, '') : 'Desconhecida'],
            ...(g.vidPid ? [['VID:PID', vidPidRow(g.vidPid.toUpperCase())]] : []),
          ],
          // MCHOSE por Bluetooth: bateria vem do Windows; firmware, só pelo dongle.
          note: /^mchose\b/i.test(g.name)
            ? 'O firmware aparece com o fone conectado pelo dongle.'
            : 'Opções avançadas desta marca ainda não estão disponíveis no UnusHub.',
          label: { name: g.name, connection },
        }) },
        { id: 'audio', label: 'Configurações de áudio', render: () => headsetAudioTab({ matches: soundMatcherFor(g) }) },
      ]);
      clear(detail,
        h('div', { class: 'detail-head' }, h('h2', {}, g.name, battery, connection ? h('span', { class: 'pill' }, connection) : null)),
        tabs.element);
    }

    // --- Logitech (HID++) -------------------------------------------------------

    /** Procura headsets nas interfaces HID++ e lê nome e bateria de novo. */
    async function scanLogitech(entry) {
      if (entry.scanning) return;
      entry.scanning = true;
      try {
        await entry.session.open();
        entry.headsets = logitechHeadsets(await entry.session.discover());
      } catch {
        entry.headsets = [];
      }
      entry.scanning = false;
      for (const hs of entry.headsets) {
        const b = batteryView(hs.battery);
        if (b.percent === null) continue;
        const id = `logi:${deviceId(entry.device)}:${hs.index}`;
        const threshold = alerts.check(id, { percent: b.percent, charging: b.charging });
        if (threshold !== null) warnLowBattery(ctx, `${hs.name} com ${b.percent}% de bateria. Coloque para carregar.`);
      }
      // Bateria nova no painel aberto: redesenha o cabeçalho.
      if (selectedId?.startsWith(`logi:${deviceId(entry.device)}:`)) renderedId = null;
      refreshView();
      ctx.changed?.();
    }

    function syncLogitech() {
      const present = new Set();
      for (const device of devices.filter(isLogitechHidpp)) {
        const id = deviceId(device);
        present.add(id);
        if (!logi.has(id)) {
          const entry = { device, session: new LogitechSession(device), headsets: [], scanning: false };
          logi.set(id, entry);
          scanLogitech(entry);
        }
      }
      for (const [id, entry] of logi) {
        if (!present.has(id)) {
          entry.session.close();
          logi.delete(id);
        }
      }
    }

    function renderLogitech(entry) {
      headerBattery = null;
      const { device, headset } = entry;
      const b = batteryView(headset.battery);
      const battery = h('span', { class: 'battery' });
      paintBattery(battery, b.percent !== null ? { percent: b.percent } : null, b.charging);
      const vidPid = `${hex4(device.vendorId)}:${hex4(device.productId)}`;
      const batteryText = headset.battery
        ? [b.percent !== null ? `${b.percent}%` : headset.battery.level, headset.battery.status].filter(Boolean).join(' · ')
        : '—';
      const tabs = subTabs([
        { id: 'device', label: 'Dispositivo', render: () => infoCard({
          rows: [
            ['Nome', headset.name],
            ['Bateria', batteryText],
            ['Protocolo', `HID++ ${headset.protocol}`],
            ['VID:PID', vidPidRow(vidPid.toUpperCase())],
          ],
          note: 'Lido pelo protocolo HID++ da Logitech. Ainda não testado com headsets Logitech: se algo aparecer errado, informe o VID:PID.',
          label: { name: headset.name, connection: headset.connection },
        }) },
        { id: 'audio', label: 'Configurações de áudio', render: () => headsetAudioTab({ matches: soundMatcherFor({ name: headset.name, transport: 'usb', vidPid }) }) },
      ]);
      clear(detail,
        h('div', { class: 'detail-head' }, h('h2', {}, headset.name, battery,
          b.text ? h('span', { class: 'pill' }, b.text) : null,
          h('span', { class: 'pill' }, headset.connection))),
        tabs.element);
    }

    /** Lista e painel conforme os fones visíveis. */
    function refreshView() {
      const all = entries();
      if (!all.some((e) => e.id === selectedId)) selectedId = all[0]?.id ?? null;
      renderList(all);
      if (!selectedId) {
        renderedId = null;
        headerBattery = null;
        genericBattery = null;
        clear(detail);
      } else if (selectedId !== renderedId) {
        select(selectedId);
      }
    }

    // Leitura de garantia: o fone avisa sozinho quando começa a carregar ou desliga.
    const pollTimer = setInterval(() => {
      for (const s of sessions.values()) s.ready.then(() => s.readBattery()).catch(() => {});
      if (sound.some((s) => s.transport === 'bluetooth')) refreshBluetooth();
      for (const entry of logi.values()) scanLogitech(entry);
    }, BATTERY_POLL_MS);

    // O "há X min" ao lado da bateria envelhece mesmo sem leituras novas.
    const ageTimer = setInterval(() => {
      const s = headerBattery && sessions.get(headerBattery.id);
      if (s) paintHeader(s);
    }, AGE_REFRESH_MS);

    function sync() {
      const groups = mchoseGroups();
      const present = new Set(groups.map((g) => deviceId(g[0])));
      for (const [id, session] of sessions) {
        if (!present.has(id)) {
          session.close();
          sessions.delete(id);
        }
      }
      // Abre todos: a bateria vale para o Início e para os avisos, mesmo sem abrir a aba.
      for (const g of groups) sessionFor(g);
      syncLogitech();
      refreshView();
    }

    refreshSound();

    return {
      update(next) {
        devices = next;
        sync();
      },
      /** Fones para os cartões do Início: um por fone conectado. */
      cards() {
        return entries().map((e) => {
          if (e.kind === 'mchose') {
            const device = e.group[0];
            const b = sessions.get(e.id)?.battery;
            if (isWired(device)) return { id: e.id, name: e.name, connection: connectionOf(device), battery: null, status: 'Carregando' };
            return {
              id: e.id, name: e.name, connection: connectionOf(device),
              battery: b && !b.asleep ? { percent: b.percent, charging: b.charging } : null,
            };
          }
          if (e.kind === 'logitech') {
            const b = batteryView(e.headset.battery);
            return {
              id: e.id, name: e.name, connection: e.headset.connection,
              battery: b.percent !== null ? { percent: b.percent, charging: b.charging } : null, status: b.text,
            };
          }
          const g = e.generic;
          return {
            id: e.id, name: e.name, connection: CONNECTION_TEXT[g.transport],
            battery: g.battery !== null ? { percent: g.battery, charging: false } : null,
          };
        });
      },
      /** Abre o fone escolhido (ex.: clique no cartão do Início). */
      focus(id) {
        select(id);
      },
      unmount() {
        clearInterval(pollTimer);
        clearInterval(ageTimer);
        navigator.mediaDevices?.removeEventListener('devicechange', refreshSound);
        for (const s of sessions.values()) s.close();
        sessions.clear();
        for (const entry of logi.values()) entry.session.close();
        logi.clear();
      },
    };
  },
};
