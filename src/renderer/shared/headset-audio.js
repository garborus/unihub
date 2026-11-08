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

/** Nome para mostrar, sem o "(VID:PID)" ou "(Bluetooth)" que o Chromium põe no fim. */
function friendlyLabel(label) {
  return label.replace(/\s*\(([0-9a-f]{4}:[0-9a-f]{4}|bluetooth)\)\s*$/i, '');
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
        h('p', { class: 'muted small' }, 'O Windows só deixa o UniHub tocar no fone que é a saída de som padrão. Escolha este fone em Configurações › Som › Saída para usar o teste e o retorno de voz.'),
        openSettings()) : null,
      audioCard('speaker', 'Teste de som', '',
        h('p', { class: 'muted small' }, output
          ? `Toca duas notas no ${friendlyLabel(output.label)}. Confira se cada lado sai no ouvido certo.`
          : 'Saída de som deste fone não encontrada. Conecte o fone para testar.'),
        h('div', { class: 'audio-test' },
          testButton('Esquerdo', -1, 'left'),
          testButton('Os dois', 0, 'both'),
          testButton('Direito', 1, 'right'))),
      audioCard('mic', 'Ouvir o microfone', '',
        h('label', { class: 'setting-row' },
          h('span', { class: 'setting-text' },
            h('span', {}, 'Retorno de voz'),
            h('small', { class: 'muted' }, input && canPlay
              ? 'Você ouve a própria voz neste fone enquanto fala. Fica ligado só com esta aba aberta.'
              : blocked ? 'Disponível com este fone como saída padrão (veja acima).'
                : 'Microfone ou saída de som deste fone não encontrados.')),
          toggle),
        isBluetooth(input) && !blocked ? h('p', { class: 'muted small' },
          'Fone Bluetooth: com o retorno ligado, ele entra no modo de chamada e o som fica com qualidade menor até desligar.') : null,
        h('div', { class: 'audio-volume' },
          h('span', { class: 'small' }, 'Volume do retorno'),
          h('div', { class: 'slider-row' }, volume, volumeOut)),
        status),
      // Com o aviso de saída padrão no topo, o atalho já está lá: um só basta.
      blocked ? null : audioCard('monitor', 'Som do Windows', '',
        h('p', { class: 'muted small' }, 'Volume geral, saída padrão e volume do microfone ficam nas configurações do Windows.'),
        openSettings()),
      driverNote ? audioCard('equalizer', 'Equalizador e surround', 'audio-note', h('p', { class: 'muted small' }, driverNote)) : null,
    ].filter(Boolean));
  }

  listAudioDevices()
    .then(pick)
    .catch(() => { /* sem permissão: nada é tocado */ })
    .finally(render);

  // Ao sair da aba (ou o headset sumir), desliga o retorno e libera o som.
  const watcher = setInterval(() => {
    if (root.isConnected || !root.dataset.mounted) {
      if (root.isConnected) root.dataset.mounted = '1';
      return;
    }
    clearInterval(watcher);
    navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
    stopMonitor();
  }, 500);

  return root;
}
