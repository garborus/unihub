// Sub-aba "Configurações de áudio" de um headset, só com APIs padrão da web:
// teste de som esquerdo/direito e retorno do microfone (ouvir a própria voz),
// ambos tocando no próprio headset. Equalizador e surround dependem do
// driver de cada fabricante e não ficam aqui.
//
// Regra principal: o som só toca na saída do próprio fone, nunca em outro.
// Se a saída do fone não for achada, ou sumir no meio (fone desligado), o
// teste fica indisponível e o retorno de voz desliga.
//
// Nem sempre o Chromium consegue abrir a saída de um fone que não é a saída
// padrão do Windows; nesse caso ele toca na padrão sem avisar (visto pela
// lista de sessões de áudio do Windows com um JBL TUNE520BT por Bluetooth e
// um MCHOSE V9 PRO pelo dongle). Por isso teste e retorno de voz só
// funcionam no fone que é a saída padrão do Windows.

import { h, button } from '../core/dom.js';
import { iconCard } from './icon-card.js';
import { friendlyLabel, isVirtualDevice } from './audio-labels.js';

const TONE_S = 0.35; // duração de cada nota do teste
const DEFAULT_MONITOR_VOLUME = 60; // %
// Fone Bluetooth: ao abrir o microfone o Windows passa o fone para o modo de
// chamada e recria a saída de som. Espera isso antes de tocar nela.
const BLUETOOTH_SWITCH_MS = 800;

/** Saídas e entradas de som cujo nome bate com o headset (ignora "Padrão" e "Comunicação"). */
export function pickHeadsetDevices(devices, matches) {
  const real = devices.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && matches(d.label));
  // Fone Bluetooth pode ter duas saídas: a de música (estéreo) e a de chamada
  // ("Headset", "Hands-Free"). O teste usa a de música; o retorno de voz, que
  // abre o microfone (modo de chamada), usa a de chamada quando ela existe.
  const isCall = (d) => /^headset\b|hands-free/i.test(d.label);
  const outputs = real.filter((d) => d.kind === 'audiooutput');
  const output = outputs.find((d) => !isCall(d)) || outputs[0] || null;
  return {
    output,
    callOutput: outputs.find(isCall) || output,
    input: real.find((d) => d.kind === 'audioinput') || null,
  };
}

const isBluetooth = (device) => /\(bluetooth\)\s*$/i.test(device?.label || '');

// Prefixo da entrada "Padrão" na lista de som (o idioma segue o do sistema).
const DEFAULT_PREFIX = /^(default|padrão)\s+-\s+/i;

/** A saída é a saída padrão do Windows? (a entrada "Padrão - …" tem o mesmo nome) */
export function isDefaultOutput(list, output) {
  const def = list.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default');
  return !!def && !!output && def.label.replace(DEFAULT_PREFIX, '') === output.label;
}

/** Os nomes dos aparelhos de som só aparecem depois de liberar o microfone uma vez. */
async function listAudioDevices() {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.some((d) => d.kind === 'audioinput' && !d.label)) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  return devices;
}

/**
 * Abre um AudioContext tocando só na saída pedida. Se o navegador não
 * conseguir prender o som nela, fecha e falha, em vez de tocar na padrão.
 */
async function openSink(device, onLost) {
  const ac = new AudioContext({ sinkId: device.deviceId, latencyHint: 'interactive' });
  if (ac.state === 'suspended') await ac.resume();
  if (ac.sinkId !== device.deviceId) {
    await ac.close().catch(() => {});
    throw new Error('saída do fone indisponível');
  }
  ac.addEventListener('sinkchange', onLost);
  ac.addEventListener('error', onLost);
  return ac;
}

/** Cartão com ícone e título: o formato de todos os cartões desta tela. */
const audioCard = (kind, title, className, ...children) => iconCard(kind, title, { className }, ...children);

// Um retorno de voz por vez, em qualquer fone: ligar um desliga o outro.
let stopActiveMonitor = null;

/**
 * @param {object} o
 * @param {(label: string) => boolean} o.matches  reconhece o headset pelo nome do aparelho de som
 * @param {string} [o.driverNote]                 o que fica por conta do driver do fabricante
 */
export function headsetAudioTab({ matches, driverNote }) {
  const root = h('div', { class: 'audio-grid' }, h('div', { class: 'empty' }, 'Procurando o som do headset…'));
  let devices = { output: null, callOutput: null, input: null };
  let outputIsDefault = false;

  function pick(list) {
    devices = pickHeadsetDevices(list, matches);
    outputIsDefault = isDefaultOutput(list, devices.output);
  }

  /** Fone fora da saída padrão: o som iria para outro aparelho. */
  const blockedNotDefault = () => !!devices.output && !outputIsDefault;
  let monitor = null; // { stream, gain, ctx, sink }
  let monitorVolume = DEFAULT_MONITOR_VOLUME;
  let message = '';

  // Duas notas curtas, só no lado escolhido (-1 esquerdo, 1 direito, 0 os dois).
  // Com o retorno de voz ligado, toca pela mesma saída dele (o fone Bluetooth
  // está no modo de chamada); senão abre a saída de música e fecha no fim.
  async function playTest(pan) {
    let ac = monitor?.ctx;
    const own = !ac;
    try {
      if (own) ac = await openSink(devices.output, () => ac.close().catch(() => {}));
    } catch (err) {
      return showMessage(`Não foi possível tocar no fone: ${err.message}.`);
    }
    const panner = new StereoPannerNode(ac, { pan });
    panner.connect(ac.destination);
    [523.25, 783.99].forEach((freq, i) => {
      const start = ac.currentTime + i * TONE_S;
      const osc = new OscillatorNode(ac, { type: 'sine', frequency: freq });
      const env = new GainNode(ac, { gain: 0 });
      env.gain.linearRampToValueAtTime(0.25, start + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, start + TONE_S);
      osc.connect(env).connect(panner);
      osc.start(start);
      osc.stop(start + TONE_S);
    });
    if (own) setTimeout(() => ac.close().catch(() => {}), (TONE_S * 2 + 0.3) * 1000);
  }

  async function startMonitor() {
    stopActiveMonitor?.();
    // Microfone primeiro: num fone Bluetooth isso muda o fone para o modo de
    // chamada, e a saída certa só existe depois da troca.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: devices.input.deviceId },
        // Sem processamento: a voz volta como sai do microfone, com menos atraso.
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      },
    });
    let sink = devices.callOutput || devices.output;
    if (isBluetooth(devices.input)) {
      await new Promise((r) => setTimeout(r, BLUETOOTH_SWITCH_MS));
      pick(await navigator.mediaDevices.enumerateDevices());
      sink = devices.callOutput || devices.output;
      if (blockedNotDefault()) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('defina este fone como saída padrão do Windows');
      }
    }
    if (!sink) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('saída do fone não encontrada');
    }
    let ctx;
    try {
      ctx = await openSink(sink, () => stopMonitor('A saída do fone mudou; o retorno de voz foi desligado.'));
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
    const gain = new GainNode(ctx, { gain: monitorVolume / 100 });
    new MediaStreamAudioSourceNode(ctx, { mediaStream: stream }).connect(gain).connect(ctx.destination);
    // Microfone desconectado (fone desligado): desliga junto.
    stream.getAudioTracks()[0]?.addEventListener('ended', () => stopMonitor('O microfone do fone desconectou.'));
    monitor = { stream, gain, ctx, sink };
    stopActiveMonitor = () => stopMonitor();
  }

  function stopMonitor(reason = '') {
    if (!monitor) return;
    const { stream, ctx } = monitor;
    monitor = null;
    if (stopActiveMonitor) stopActiveMonitor = null;
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    if (reason) showMessage(reason);
    else if (root.isConnected) render();
  }

  function showMessage(text) {
    message = text;
    if (root.isConnected || !root.dataset.mounted) render();
  }

  // Aparelhos de som mudaram: se a saída ou o microfone do retorno sumiram,
  // desliga; e atualiza o que a aba encontra.
  async function onDeviceChange() {
    let list;
    try {
      list = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return;
    }
    if (monitor) {
      const ids = new Set(list.map((d) => d.deviceId));
      if (!ids.has(monitor.sink.deviceId) || !ids.has(devices.input?.deviceId)) {
        stopMonitor('O fone mudou de modo ou desconectou; o retorno de voz foi desligado.');
      } else if (!isDefaultOutput(list, monitor.sink) && !isDefaultOutput(list, devices.output)) {
        stopMonitor('Este fone deixou de ser a saída padrão do Windows; o retorno de voz foi desligado.');
      }
      if (monitor) return; // durante o retorno, a escolha de aparelhos fica como está
    }
    pick(list);
    render();
  }
  navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
  navigator.mediaDevices?.addEventListener('devicechange', refreshOutputs);

  // --- Som do Windows: saída, microfone, chamadas, volume e mudo -------------------
  // Pelo saidas.exe (processo principal). Trocar aqui vale para o computador inteiro,
  // como em Configurações › Som. As listas são iguais às da aba Sons: sem cabos
  // virtuais e os da Steam (a não ser o que já é padrão, para mostrar a verdade).
  const api = window.unihub;
  const hasWinAudio = !!(api?.audioDevices && api.setDefaultAudio);
  let win = null; // { outputs, inputs } do Windows; null enquanto lê
  let winBusy = false;

  async function refreshOutputs() {
    if (!hasWinAudio) return;
    const result = await api.audioDevices().catch(() => null);
    win = result || { outputs: [], inputs: [] };
    if (root.isConnected || !root.dataset.mounted) render();
  }

  async function winAction(promise, error) {
    winBusy = true;
    message = '';
    render();
    const result = await promise.catch(() => ({ ok: false }));
    winBusy = false;
    if (!result.ok) message = error;
    await refreshOutputs();
  }

  // Escolher na lista deixa o aparelho como padrão e também como o das chamadas
  // (Discord, WhatsApp e Teams usam o "de chamadas", que o Windows guarda à parte).
  const setDefault = (id, roles = 'todos') => winAction(api.setDefaultAudio(id, roles), 'Não foi possível trocar o aparelho padrão do Windows.');

  // Saída do Windows com o mesmo nome deste fone (o Chromium põe "(VID:PID)" no fim).
  const headsetWinOutput = () => (devices.output && win
    ? win.outputs.find((o) => o.name === friendlyLabel(devices.output.label)) : null);

  // Volume: muda enquanto arrasta (no máximo ~6 vezes por segundo) e no fim.
  function volumeSlider(device, label) {
    let timer = 0;
    let last = device.volume;
    const out = h('code', {}, `${device.volume}%`);
    const send = (v) => { if (v !== last) { last = v; api.setAudioVolume(device.id, v).catch(() => {}); } };
    const input = h('input', {
      type: 'range', min: 0, max: 100, value: device.volume, 'aria-label': label, disabled: device.mute,
      oninput: (e) => {
        const v = Number(e.target.value);
        out.textContent = `${v}%`;
        device.volume = v;
        clearTimeout(timer);
        timer = setTimeout(() => send(v), 150);
      },
      onchange: (e) => { clearTimeout(timer); send(Number(e.target.value)); },
    });
    return h('div', { class: 'slider-row' }, input, out);
  }

  // Um bloco por tipo: lista do aparelho padrão, aviso se as chamadas usam outro,
  // volume e (no microfone) mudo.
  function winDeviceBlock(kind) {
    const list = kind === 'output' ? win.outputs : win.inputs;
    const title = kind === 'output' ? 'Saída padrão' : 'Microfone padrão';
    const options = list.filter((d) => d.default || !isVirtualDevice(d.name));
    if (!options.length) {
      return h('div', { class: 'audio-win-block' }, h('span', { class: 'small' }, title),
        h('p', { class: 'muted small' }, kind === 'output' ? 'Nenhuma saída de som ativa encontrada.' : 'Nenhum microfone ativo encontrado.'));
    }
    const current = list.find((d) => d.default) || options[0];
    const comm = list.find((d) => d.comm);
    const muteButton = kind === 'input' && current.volume !== null
      ? h('button', {
        class: 'btn secondary audio-mute' + (current.mute ? ' on' : ''), disabled: winBusy, 'aria-pressed': String(current.mute),
        onclick: () => winAction(api.setAudioMute(current.id, !current.mute), 'Não foi possível mudar o mudo do microfone.'),
      }, current.mute ? 'Microfone mudo' : 'Mudo')
      : null;
    return h('div', { class: 'audio-win-block' },
      h('label', { class: 'audio-output-pick' },
        h('span', { class: 'small' }, title),
        h('select', { class: 'map-select', disabled: winBusy, onchange: (e) => setDefault(e.target.value) },
          options.map((d) => h('option', { value: d.id, selected: d.id === current.id }, d.name)))),
      comm && comm.id !== current.id
        ? h('p', { class: 'muted small audio-comm' },
          `Nas chamadas (Discord, WhatsApp, Teams) o Windows usa ${comm.name}. `,
          h('button', { class: 'link-btn', disabled: winBusy, onclick: () => setDefault(current.id, 'chamadas') }, 'Usar o mesmo nas chamadas'))
        : null,
      current.volume !== null
        ? h('div', { class: 'audio-volume' },
          h('div', { class: 'audio-volume-head' },
            h('span', { class: 'small' }, kind === 'output' ? 'Volume da saída' : 'Volume do microfone'),
            muteButton),
          volumeSlider(current, kind === 'output' ? 'Volume da saída' : 'Volume do microfone'))
        : null);
  }

  function winAudioCard(openSettings) {
    if (!hasWinAudio) {
      return audioCard('monitor', 'Som do Windows', '',
        h('p', { class: 'muted small' }, 'Volume geral, saída padrão e volume do microfone ficam nas configurações do Windows.'),
        openSettings());
    }
    return audioCard('monitor', 'Som do Windows', 'audio-win',
      win ? h('div', { class: 'audio-win-grid' }, winDeviceBlock('output'), winDeviceBlock('input'))
        : h('p', { class: 'muted small' }, 'Lendo os aparelhos de som…'),
      h('p', { class: 'muted small' }, 'Trocar aqui vale para o computador inteiro, como nas configurações de som do Windows. Escolher um aparelho também o deixa como o das chamadas.'),
      openSettings());
  }

  // --- Medidor e gravação de 5 s do microfone ---------------------------------------
  // Só abrem o microfone quando a pessoa pede (num fone Bluetooth isso troca o fone
  // para o modo de chamada).
  const RECORD_S = 5;
  let meter = null; // { stream, ctx, raf }
  let meterFill = null; // barra atual (render recria o elemento)
  let meterLevel = 0;
  let recording = null; // { left } enquanto grava; 'tocando' enquanto toca

  async function startMeter() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: devices.input.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new AudioContext();
    const analyser = new AnalyserNode(ctx, { fftSize: 1024 });
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    meter = { stream, ctx, raf: 0 };
    const tick = () => {
      if (!meter) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6);
      // -60 dB (silêncio) a 0 dB (máximo); cai devagar para a barra não tremer.
      const level = Math.max(0, Math.min(1, (db + 60) / 60));
      meterLevel = Math.max(level, meterLevel * 0.9);
      if (meterFill) meterFill.style.transform = `scaleX(${meterLevel})`;
      meter.raf = requestAnimationFrame(tick);
    };
    tick();
    stream.getAudioTracks()[0]?.addEventListener('ended', () => stopMeter());
  }

  function stopMeter() {
    if (!meter) return;
    cancelAnimationFrame(meter.raf);
    meter.stream.getTracks().forEach((t) => t.stop());
    meter.ctx.close().catch(() => {});
    meter = null;
    meterLevel = 0;
    if (meterFill) meterFill.style.transform = 'scaleX(0)';
  }

  // Grava 5 s do microfone deste fone e toca de volta no próprio fone.
  async function recordAndPlay() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: devices.input.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      return showMessage(`Não foi possível abrir o microfone: ${err.message}.`);
    }
    const chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start();
    recording = { left: RECORD_S };
    render();
    for (let s = RECORD_S; s > 0; s--) {
      await new Promise((r) => setTimeout(r, 1000));
      if (recording) recording.left = s - 1;
      const el = root.querySelector('.audio-record-left');
      if (el) el.textContent = `${Math.max(0, s - 1)} s`;
    }
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    recording = 'tocando';
    render();
    let ac;
    try {
      // Fone Bluetooth: espera o fone sair do modo de chamada antes de tocar.
      if (isBluetooth(devices.input)) await new Promise((r) => setTimeout(r, BLUETOOTH_SWITCH_MS));
      const target = monitor?.sink || devices.output;
      ac = await openSink(target, () => ac?.close().catch(() => {}));
      const audio = await ac.decodeAudioData(await new Blob(chunks).arrayBuffer());
      const src = new AudioBufferSourceNode(ac, { buffer: audio });
      src.connect(ac.destination);
      await new Promise((r) => { src.onended = r; src.start(); });
    } catch (err) {
      message = `Não foi possível tocar a gravação: ${err.message}.`;
    } finally {
      ac?.close().catch(() => {});
      recording = null;
      render();
    }
  }

  function micTestBlock(canPlay) {
    const { input } = devices;
    meterFill = h('span', { class: 'audio-meter-fill' });
    meterFill.style.transform = `scaleX(${meter ? meterLevel : 0})`;
    const meterToggle = h('input', {
      type: 'checkbox', class: 'switch', checked: !!meter, disabled: !input,
      onchange: async (e) => {
        if (!e.target.checked) return stopMeter();
        e.target.disabled = true;
        try {
          await startMeter();
        } catch (err) {
          e.target.checked = false;
          showMessage(`Não foi possível abrir o microfone: ${err.message}.`);
        }
        e.target.disabled = false;
      },
    });
    const recordLabel = recording === 'tocando' ? 'Tocando a gravação…'
      : recording ? h('span', {}, 'Gravando… fale agora ', h('span', { class: 'audio-record-left' }, `${recording.left} s`))
        : `Gravar ${RECORD_S} s e ouvir`;
    return h('div', { class: 'audio-mic-test' },
      h('label', { class: 'setting-row' },
        h('span', { class: 'setting-text' },
          h('span', {}, 'Medir o microfone'),
          h('small', { class: 'muted' }, input ? 'A barra mexe com a sua voz: confira se o microfone está captando, sem precisar se ouvir.'
            : 'Microfone deste fone não encontrado.')),
        meterToggle),
      h('div', { class: 'audio-meter', 'aria-hidden': 'true' }, meterFill),
      h('div', { class: 'audio-record' },
        button(recordLabel, () => recordAndPlay(), { kind: 'secondary', disabled: !input || !canPlay || !!recording }),
        canPlay ? null : h('small', { class: 'muted' }, 'Para ouvir a gravação, este fone precisa ser a saída padrão.')));
  }

  function render() {
    const { output, input } = devices;
    const blocked = blockedNotDefault();
    const canPlay = !!output && !blocked;
    const status = h('p', { class: 'muted small' }, message);
    const volumeOut = h('code', {}, `${monitorVolume}%`);
    const volume = h('input', {
      type: 'range', min: 0, max: 100, value: monitorVolume,
      oninput: (e) => {
        monitorVolume = Number(e.target.value);
        volumeOut.textContent = `${monitorVolume}%`;
        if (monitor) monitor.gain.gain.value = monitorVolume / 100;
      },
    });
    const toggle = h('input', {
      type: 'checkbox', class: 'switch', checked: !!monitor, disabled: !input || !canPlay,
      onchange: async (e) => {
        message = '';
        status.textContent = '';
        if (!e.target.checked) return stopMonitor();
        e.target.disabled = true;
        try {
          await startMonitor();
        } catch (err) {
          e.target.checked = false;
          status.textContent = `Não foi possível ligar o retorno de voz: ${err.message}.`;
        }
        e.target.disabled = false;
      },
    });
    // Teste: três botões largos, na ordem dos ouvidos (esquerdo, os dois, direito).
    const testButton = (label, pan, side) => h('button', {
      class: `btn secondary audio-test-btn ${side}`, disabled: !canPlay, onclick: () => playTest(pan),
    }, h('span', { class: 'audio-test-side', 'aria-hidden': 'true' }, side === 'left' ? '◀' : side === 'right' ? '▶' : '◀ ▶'), label);
    const openSettings = () => (window.unihub?.openSoundSettings
      ? button('Abrir configurações de som', () => window.unihub.openSoundSettings())
      : null);

    // Cartões opcionais vêm como null: fora da lista, senão viram o texto "null".
    // Em tela larga ficam em duas colunas; o aviso de saída padrão ocupa as duas.
    root.replaceChildren(...[
      blocked ? audioCard('warning', 'Este fone não é a saída padrão', 'audio-warning',
        h('p', { class: 'muted small' }, 'O Windows só deixa o UnusHub tocar no fone que é a saída de som padrão. Escolha este fone como saída padrão para usar o teste e o retorno de voz.'),
        headsetWinOutput()
          ? h('div', { class: 'audio-warning-actions' },
            button(winBusy ? 'Trocando…' : 'Usar este fone como saída padrão', () => setDefault(headsetWinOutput().id), { kind: 'primary', disabled: winBusy }))
          : openSettings()) : null,
      audioCard('speaker', 'Teste de som', '',
        h('p', { class: 'muted small' }, output
          ? `Toca duas notas no ${friendlyLabel(output.label)}. Confira se cada lado sai no ouvido certo.`
          : 'Saída de som deste fone não encontrada. Conecte o fone para testar.'),
        h('div', { class: 'audio-test' },
          testButton('Esquerdo', -1, 'left'),
          testButton('Os dois', 0, 'both'),
          testButton('Direito', 1, 'right'))),
      audioCard('mic', 'Microfone', '',
        micTestBlock(canPlay),
        h('label', { class: 'setting-row audio-monitor-row' },
          h('span', { class: 'setting-text' },
            h('span', {}, 'Retorno de voz'),
            h('small', { class: 'muted' }, input && canPlay
              ? 'Você ouve a própria voz neste fone enquanto fala. Fica ligado só com esta aba aberta.'
              : blocked ? 'Disponível com este fone como saída padrão (veja acima).'
                : 'Microfone ou saída de som deste fone não encontrados.')),
          toggle),
        isBluetooth(input) && !blocked ? h('p', { class: 'muted small' },
          'Fone Bluetooth: com o microfone aberto (medidor, gravação ou retorno), ele entra no modo de chamada e o som fica com qualidade menor até fechar.') : null,
        h('div', { class: 'audio-volume' },
          h('span', { class: 'small' }, 'Volume do retorno'),
          h('div', { class: 'slider-row' }, volume, volumeOut)),
        status),
      winAudioCard(openSettings),
      driverNote ? audioCard('equalizer', 'Equalizador e surround', 'audio-note', h('p', { class: 'muted small' }, driverNote)) : null,
    ].filter(Boolean));
  }

  listAudioDevices()
    .then(pick)
    .catch(() => { /* sem permissão: nada é tocado */ })
    .finally(render);
  refreshOutputs();

  // Ao sair da aba (ou o headset sumir), desliga o retorno e libera o som.
  const watcher = setInterval(() => {
    if (root.isConnected || !root.dataset.mounted) {
      if (root.isConnected) root.dataset.mounted = '1';
      return;
    }
    clearInterval(watcher);
    navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
    navigator.mediaDevices?.removeEventListener('devicechange', refreshOutputs);
    stopMonitor();
    stopMeter();
  }, 500);

  return root;
}
