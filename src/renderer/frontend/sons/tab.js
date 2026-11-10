// Aba "Sons": guarda áudios e toca cada um no fone, no microfone ou nos dois.
//
// No fone: Web Audio na saída escolhida (ou na padrão do Windows).
// No microfone, de dois jeitos:
// - cabo de áudio virtual: toca na saída do cabo; a entrada dele vira o
//   microfone no app de chamada. Com "Misturar minha voz", o microfone real
//   também vai para o cabo.
// - efeito no microfone (beta): o efeito de áudio do UnusHub (native/audio-mix)
//   soma o som ao microfone de verdade; o app manda o som pela ponte.

import { h, clear, card, button } from '../../core/dom.js';
// Estilos da aba em styles.css, na seção "Aba Sons" (classes sons-*).
import { realDevices, physicalDevices, pickMicOutput, isVirtualOutput, isVirtualDevice } from './devices.js';
import { EFFECT_RATE, mixToMono, channelsOf } from './mix.js';
import { acceleratorFromEvent, acceleratorLabel, isTypingKey, hotkeyKeyCount, MAX_HOTKEY_KEYS, STOP_HOTKEY_ID } from './hotkeys.js';

const STORAGE_KEY = 'unihub.sounds';
const MODES = {
  both: { ear: true, mic: true },
  ear: { ear: true, mic: false },
  mic: { ear: false, mic: true },
};

// micMode: como o som chega à chamada. 'effect' (padrão) = efeito de áudio do
// UnusHub no microfone (native/audio-mix); 'cable' = cabo de áudio virtual, para
// quem não pode instalar o efeito ou usa um app que pega o microfone direto.
// volumeEar / volumeMic: volume dos sons no fone e no microfone (0 a 100).
const DEFAULT_PREFS = { listen: '', micOut: '', micIn: '', mixVoice: false, volumeEar: 80, volumeMic: 80, micMode: 'effect', effectMic: '' };

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // Antes havia um volume só: vale para os dois.
    if (typeof saved.volume === 'number') {
      saved.volumeEar ??= saved.volume;
      saved.volumeMic ??= saved.volume;
      delete saved.volume;
    }
    return { ...DEFAULT_PREFS, ...saved };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const volumeKey = (kind) => (kind === 'ear' ? 'volumeEar' : 'volumeMic');

function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* sem armazenamento */ }
}

// Ícones de traço, no tamanho do texto, na cor do texto.
const SVG = 'http://www.w3.org/2000/svg';
function icon(...paths) {
  return () => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'sons-icon');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  };
}
const icons = {
  play: icon('M8 5.5v13l10.5-6.5z'),
  stop: icon('M7 7h10v10H7z'),
  stopAll: icon('M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M9.5 9.5h5v5h-5z'),
  plus: icon('M12 5v14M5 12h14'),
  external: icon('M14 4h6v6M20 4l-8.5 8.5', 'M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5'),
  folder: icon('M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'),
  headphones: icon('M4 15v-3a8 8 0 0 1 16 0v3', 'M4 15a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z'),
  mic: icon('M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3z', 'M6 11.5a6 6 0 0 0 12 0M12 17.5v3'),
  trash: icon('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'),
  refresh: icon('M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4'),
  volume: icon('M4 9.5h3.5L12 6v12l-4.5-3.5H4z', 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'),
  keyboard: icon('M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z', 'M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17.5 10.5h.01M8 14h8'),
  note: icon('M9 17.5V6l10-2v11.5', 'M9 17.5a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 17.5zM19 15.5a2.5 2.5 0 1 1-2.5-2.5 2.5 2.5 0 0 1 2.5 2.5z'),
};

function iconButton(draw, label, onclick, disabled = false) {
  return h('button', { class: 'btn icon-btn sons-icon-btn', title: label, 'aria-label': label, onclick, disabled }, draw());
}

const friendly = (label) => label.replace(/\s*\(([0-9a-f]{4}:[0-9a-f]{4}|bluetooth)\)\s*$/i, '');

/**
 * Abre um AudioContext preso numa saída ('' = padrão do Windows). Se o
 * Chromium não conseguir usar a saída pedida, fecha e falha, em vez de tocar
 * em outro aparelho sem avisar.
 */
async function openSink(sinkId) {
  const ac = new AudioContext({ sinkId, latencyHint: 'interactive' });
  if (ac.state === 'suspended') await ac.resume();
  if (ac.sinkId !== sinkId) {
    await ac.close().catch(() => {});
    throw new Error('saída indisponível');
  }
  return ac;
}

// Atalhos: o processo principal avisa qual som tocar. Se a aba está aberta, toca
// nela; senão, numa cópia da aba montada fora da tela, para o atalho funcionar
// em qualquer aba e com a janela escondida.
let activeTab = null;
let backgroundTab = null;

// Ao adicionar a aba, o efeito no microfone já é instalado (sem ele os sons não
// chegam a ninguém): a aba, assim que lê os microfones, pede a instalação.
let autoInstallEffect = false;

// Atalho que para todos os sons (gravado e guardado como os atalhos dos sons).
const STOP_ENTRY = { id: STOP_HOTKEY_ID, name: 'Parar todos os sons' };

// Duração de um som em m:ss (ex.: 0:01, 3:18).
const durationText = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

window.unihub?.onSoundHotkey?.((id) => {
  if (!activeTab && !backgroundTab) backgroundTab = plugin.mount(document.createElement('div'));
  (activeTab || backgroundTab).playById(id);
});

const plugin = {
  id: 'sounds',
  name: 'Sons',
  tagline: 'Guarde áudios e toque no fone ou no microfone, para quem está na chamada ouvir',
  status: 'beta',
  kind: 'feature', // recurso do app: não depende de um aparelho conectado

  /** Chamado quando a pessoa adiciona a aba: instala o efeito no microfone. */
  onInstall() {
    autoInstallEffect = true;
    activeTab?.tryAutoInstall?.();
  },
  icon: () => icons.note(), // ícone na barra lateral

  matches() {
    return false;
  },

  mount(container) {
    const api = window.unihub;
    const isBackground = !container.isConnected;
    if (!isBackground && backgroundTab) {
      backgroundTab.unmount();
      backgroundTab = null;
    }
    const prefs = loadPrefs();
    let sounds = [];
    let devices = [];
    let message = '';
    let query = ''; // busca por nome na lista de sons
    let folder = null; // { path, custom }
    let hotkeys = {}; // id do som -> atalho
    let recording = null; // id do som esperando as teclas do atalho
    let folderBusy = false;
    let playingId = null;
    // Tempo do som tocando: quando começou (performance.now) e quanto dura, em segundos.
    let playStart = 0;
    let playDuration = 0;
    let clock = null; // setInterval que atualiza só o texto do tempo, sem redesenhar a aba
    const buffers = new Map(); // id -> AudioBuffer
    const sinks = { ear: null, mic: null }; // { id, ctx, gain }
    let playing = []; // AudioBufferSourceNode
    let voice = null; // { stream, node }
    // loaded: a primeira leitura dos microfones já voltou; failed: não deu para ler.
    let effect = { built: false, loaded: false, failed: false, mics: [], active: false, busy: '' };
    let effectPlaying = false;
    const useEffect = () => prefs.micMode === 'effect';
    const effectMic = () => effect.mics.find((m) => m.installed) || null;
    // Microfone escolhido para instalar: o salvo, se ainda estiver ligado; senão o
    // primeiro que não é Bluetooth (no Bluetooth o Windows não roda efeitos).
    // Microfones que dá para escolher: sem os virtuais (ex.: Steam Streaming Microphone).
    const micChoices = () => effect.mics.filter((m) => !isVirtualDevice(m.device) && !isVirtualDevice(m.name));
    const chosenMic = () => micChoices().find((m) => m.id === prefs.effectMic)
      || micChoices().find((m) => !m.bluetooth) || micChoices()[0] || null;

    function setMessage(text) {
      message = text;
      render();
    }

    // Saída escolhida para ouvir, se ainda estiver ligada. Um aparelho que saiu (ex.:
    // fone Bluetooth desligado) abriria uma saída muda que nunca termina de tocar:
    // nesse caso usa a saída padrão do Windows, que é o que a lista mostra.
    function listenId() {
      if (!prefs.listen) return '';
      return physicalDevices(devices, 'audiooutput').some((d) => d.deviceId === prefs.listen) ? prefs.listen : '';
    }

    async function sink(kind) {
      const id = kind === 'ear' ? listenId() : (pickMicOutput(devices, prefs.micOut)?.deviceId || '');
      if (kind === 'mic' && !id) throw new Error('escolha a saída do microfone virtual');
      if (sinks[kind]?.id === id) return sinks[kind];
      await closeSink(kind);
      const ctx = await openSink(id);
      const gain = new GainNode(ctx, { gain: prefs[volumeKey(kind)] / 100 });
      gain.connect(ctx.destination);
      sinks[kind] = { id, ctx, gain };
      return sinks[kind];
    }

    async function closeSink(kind) {
      const s = sinks[kind];
      sinks[kind] = null;
      if (kind === 'mic') stopVoice();
      await s?.ctx.close().catch(() => {});
    }

    // Decodifica já em 48000 Hz: é a taxa do efeito, e o fone toca qualquer taxa.
    async function bufferFor(id) {
      if (buffers.has(id)) return buffers.get(id);
      const bytes = await api.readSound(id);
      if (!bytes) throw new Error('arquivo não encontrado');
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buffer = await new OfflineAudioContext(1, 1, EFFECT_RATE).decodeAudioData(copy);
      buffers.set(id, buffer);
      return buffer;
    }

    function stopAll() {
      for (const src of playing) { try { src.stop(); } catch { /* já parou */ } }
      playing = [];
      if (effectPlaying) api.micEffectStop?.();
      effectPlaying = false;
      playingId = null;
      render();
    }

    // O estado muda quando um app (jogo, Discord, gravador) começa ou para de usar o
    // microfone. Enquanto a aba está à vista e o efeito instalado, confere a cada 3 s.
    // Sem microfone na lista (ou leitura que falhou), lê a lista de novo a cada 10 s.
    const EFFECT_POLL_MS = 2000;
    const MICS_RETRY_MS = 10_000;
    let lastMicsRetry = 0;
    const effectPoll = setInterval(async () => {
      if (isBackground || !useEffect() || effect.busy || !api.micEffectActive) return;
      if (document.hidden || !container.offsetParent) return;
      if (!effectMic()) {
        if (effect.loaded && !effect.checking && micChoices().length === 0 && Date.now() - lastMicsRetry > MICS_RETRY_MS) {
          lastMicsRetry = Date.now();
          refreshEffect().catch(() => {});
        }
        return;
      }
      const active = await api.micEffectActive().catch(() => effect.active);
      if (active !== effect.active) {
        effect = { ...effect, active };
        render();
      }
    }, EFFECT_POLL_MS);

    async function refreshEffect() {
      if (!api?.micEffectStatus) return;
      effect.checking = true;
      if (effect.loaded) render();
      const status = await api.micEffectStatus().catch(() => ({ failed: true }));
      effect = { ...effect, ...status, loaded: true, checking: false };
      render();
      tryAutoInstall();
    }

    // Aba recém-adicionada: instala o efeito no microfone escolhido (o Windows pede
    // administrador). Só se o modo for o efeito, não houver efeito instalado e
    // houver um microfone que aceite (não Bluetooth, não virtual).
    function tryAutoInstall() {
      if (!autoInstallEffect || isBackground || !effect.loaded || effect.busy) return;
      autoInstallEffect = false;
      if (!useEffect() || !effect.built || effectMic()) return;
      const mic = chosenMic();
      if (!mic || mic.bluetooth) return;
      effectAction('install', mic.id);
    }

    // Microfone ligado ou desligado (ex.: fone Bluetooth conectou): lê a lista de novo.
    let effectRefreshTimer = 0;
    function scheduleEffectRefresh() {
      if (!useEffect() || effect.busy) return;
      clearTimeout(effectRefreshTimer);
      effectRefreshTimer = setTimeout(() => refreshEffect().catch(() => {}), 1500);
    }

    async function effectAction(kind, micId = null) {
      effect.busy = kind;
      message = kind === 'install'
        ? 'Instalando: confirme o pedido de administrador do Windows. O som de todos os apps para por alguns segundos.'
        : 'Removendo: confirme o pedido de administrador do Windows.';
      render();
      const mic = micId || chosenMic()?.id;
      const result = kind === 'install' ? await api.micEffectInstall(mic) : await api.micEffectRemove();
      effect.busy = '';
      message = result.cancelled ? 'Pedido de administrador recusado; nada mudou.'
        : result.ok ? (kind === 'install' ? 'Efeito instalado.' : 'Efeito removido.')
          : `Não deu certo: ${result.message || 'erro desconhecido'}`;
      await refreshEffect();
    }

    // No microfone pelo efeito: o som vai pronto (mono, 48 kHz, no volume) para a ponte.
    async function playOnEffect(sound, buffer) {
      effectPlaying = true;
      const result = await api.micEffectPlay(mixToMono(channelsOf(buffer), prefs.volumeMic / 100));
      if (!effectPlaying) return; // parado no meio
      effectPlaying = false;
      // O resultado do envio também diz o estado: 0 = tinha app usando, 3 = não tinha
      // (sem aviso: a etiqueta "Esperando um app usar o microfone" já mostra isso).
      if (result.code === 0 || result.code === 3) effect = { ...effect, active: result.code === 0 };
      else {
        message = `Não foi possível tocar ${sound.name} no microfone (código ${result.code}).`;
      }
      if (playingId === sound.id && playing.length === 0) playingId = null;
      render();
    }

    async function play(sound, mode) {
      stopAll();
      message = '';
      const targets = [];
      try {
        const buffer = await bufferFor(sound.id);
        if (MODES[mode].ear) targets.push(await sink('ear'));
        if (MODES[mode].mic && useEffect()) {
          playingId = sound.id;
          playOnEffect(sound, buffer);
        } else if (MODES[mode].mic) {
          targets.push(await sink('mic'));
          if (prefs.mixVoice) await startVoice();
        }
        let left = targets.length;
        for (const t of targets) {
          const src = new AudioBufferSourceNode(t.ctx, { buffer });
          src.connect(t.gain);
          src.onended = () => {
            playing = playing.filter((p) => p !== src);
            if (--left === 0 && playingId === sound.id) { playingId = null; render(); }
          };
          src.start();
          playing.push(src);
        }
        playingId = sound.id;
        playStart = performance.now();
        playDuration = buffer.duration;
        // Garantia: se a saída travar e o fim não chegar, para e reabre a saída na
        // próxima vez, em vez de ficar "tocando" para sempre.
        const started = playStart;
        setTimeout(() => {
          if (playingId !== sound.id || playStart !== started || !playing.length) return;
          stopAll();
          closeSink('ear');
          closeSink('mic');
        }, (buffer.duration + 1.5) * 1000);
      } catch (err) {
        message = `Não foi possível tocar ${sound.name}: ${err.message}.`;
      }
      render();
    }

    // Voz no microfone virtual: o microfone real entra no mesmo cabo que os sons.
    async function startVoice() {
      if (voice || !sinks.mic) return;
      const input = realDevices(devices, 'audioinput').find((d) => d.deviceId === prefs.micIn);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: input ? { exact: input.deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const node = new MediaStreamAudioSourceNode(sinks.mic.ctx, { mediaStream: stream });
      node.connect(sinks.mic.ctx.destination);
      voice = { stream, node };
    }

    function stopVoice() {
      if (!voice) return;
      voice.node.disconnect();
      voice.stream.getTracks().forEach((t) => t.stop());
      voice = null;
    }

    async function setPref(key, value) {
      prefs[key] = value;
      savePrefs(prefs);
      if (key === 'listen') await closeSink('ear');
      if (key === 'micOut') await closeSink('mic');
      if (key === 'micIn') stopVoice();
      if (key === 'mixVoice') {
        if (!value) stopVoice();
        else if (sinks.mic) await startVoice().catch((err) => { message = `Não foi possível ouvir o microfone: ${err.message}.`; });
      }
      // Muda na hora o som que já está tocando (no efeito, vale a partir do próximo som).
      if (key === 'volumeEar' && sinks.ear) sinks.ear.gain.gain.value = value / 100;
      if (key === 'volumeMic' && sinks.mic) sinks.mic.gain.gain.value = value / 100;
      render();
    }

    async function refreshDevices(event) {
      // Aparelho entrou ou saiu (ex.: fone Bluetooth trocou de modo): a saída aberta
      // pode ter parado sem avisar e o som ficaria "tocando" para sempre. Fecha as
      // saídas paradas; a próxima vez que tocar abre de novo no aparelho certo.
      if (event) {
        for (const kind of ['ear', 'mic']) {
          if (sinks[kind] && !(playingId && playing.some((src) => src.context === sinks[kind].ctx))) closeSink(kind);
        }
      }
      let list = await navigator.mediaDevices.enumerateDevices();
      // Os nomes dos aparelhos só aparecem depois de liberar o microfone uma vez.
      if (list.some((d) => !d.label)) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          list = await navigator.mediaDevices.enumerateDevices();
        } catch { /* sem nomes: a lista mostra o que der */ }
      }
      devices = list;
      render();
    }

    async function refreshHotkeys() {
      const result = await api.soundHotkeys();
      hotkeys = result.hotkeys;
      const nameOf = (id) => (id === STOP_HOTKEY_ID ? STOP_ENTRY.name : sounds.find((s) => s.id === id)?.name);
      const failed = result.failed?.filter((id) => nameOf(id)) || [];
      if (failed.length && !isBackground) {
        message = `Outro app já usa o atalho de: ${failed.map(nameOf).join(', ')}. Escolha outro.`;
      }
      render();
    }

    // Gravar atalho: o próximo conjunto de teclas vira o atalho do som. Esc cancela,
    // Backspace tira o atalho. Os atalhos ficam pausados enquanto grava, para a
    // tecla chegar aqui mesmo se já for de outro som.
    function startRecording(sound) {
      stopRecording();
      recording = sound.id;
      api.pauseSoundHotkeys?.(true);
      window.addEventListener('keydown', onRecordKey, true);
      render();
    }

    function stopRecording() {
      if (!recording) return;
      recording = null;
      window.removeEventListener('keydown', onRecordKey, true);
      api.pauseSoundHotkeys?.(false);
    }

    async function onRecordKey(e) {
      e.preventDefault();
      e.stopPropagation();
      const id = recording;
      const sound = id === STOP_HOTKEY_ID ? STOP_ENTRY : sounds.find((s) => s.id === id);
      // Esc sozinho cancela; com Ctrl, Alt ou Shift vira atalho (ex.: Shift + Esc).
      const withModifier = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
      if (e.code === 'Escape' && !withModifier) { stopRecording(); render(); return; }
      if (e.code === 'Backspace') {
        stopRecording();
        hotkeys = (await api.setSoundHotkey(id, null)).hotkeys;
        message = '';
        render();
        return;
      }
      const accelerator = acceleratorFromEvent(e);
      if (!accelerator) return; // só modificadores até agora
      // Mais de 3 teclas: avisa e continua gravando, para tentar de novo na hora.
      if (hotkeyKeyCount(accelerator) > MAX_HOTKEY_KEYS) {
        message = `Use no máximo ${MAX_HOTKEY_KEYS} teclas no atalho (por exemplo, Shift + F1). Tente de novo.`;
        render();
        return;
      }
      stopRecording();
      const result = await api.setSoundHotkey(id, accelerator);
      hotkeys = result.hotkeys;
      const label = acceleratorLabel(accelerator);
      if (result.error === 'em uso') message = `O atalho ${label} já é usado por outro app. Escolha outro.`;
      else if (result.error) message = `Não foi possível usar o atalho ${label}.`;
      else if (isTypingKey(accelerator)) message = `Atenção: enquanto o UnusHub estiver aberto, a tecla ${label} ${id === STOP_HOTKEY_ID ? 'para os sons' : `toca ${sound?.name}`} em qualquer app e deixa de digitar. Para evitar isso, use com Ctrl, Alt ou Shift.`;
      else message = '';
      render();
    }

    async function playById(id) {
      if (id === STOP_HOTKEY_ID) { stopAll(); return; }
      if (!sounds.some((s) => s.id === id)) await refreshSounds();
      const sound = sounds.find((s) => s.id === id);
      if (!sound) return;
      if (playingId === id) { stopAll(); return; }
      const canMic = useEffect() ? !!effectMic() : !!pickMicOutput(devices, prefs.micOut);
      play(sound, canMic ? 'both' : 'ear');
    }

    async function refreshFolder() {
      folder = await api.soundsFolder();
      render();
    }

    // Trocar ou voltar a pasta: o app pergunta (janela do Windows) se move os sons.
    async function changeFolder(action) {
      folderBusy = true;
      render();
      try {
        const result = await action();
        if (!result) return;
        folder = result.folder;
        stopAll();
        buffers.clear(); // a pasta nova pode ter outro arquivo com o mesmo nome
        sounds = result.sounds;
        if (result.error) message = `Não foi possível usar essa pasta: ${result.error}`;
        else if (result.failed?.length) message = `Não foi possível mover: ${result.failed.join(', ')}. Eles continuam na pasta antiga.`;
        else message = '';
      } catch (err) {
        message = `Não foi possível trocar a pasta: ${err.message}`;
      } finally {
        folderBusy = false;
        render();
      }
    }

    async function refreshSounds(promise = api.listSounds()) {
      const result = await promise;
      sounds = Array.isArray(result) ? result : result.sounds;
      if (result.skipped?.length) message = `Ficaram de fora (formato não aceito ou acima de 50 MB): ${result.skipped.join(', ')}.`;
      for (const id of buffers.keys()) if (!sounds.some((s) => s.id === id)) buffers.delete(id);
      render();
      if (!isBackground) loadDurations().catch(() => {});
    }

    // Duração de cada som, para mostrar no cartão. Lê só o cabeçalho do áudio
    // (elemento de áudio), sem decodificar o som inteiro; um por vez.
    const durations = new Map(); // id -> segundos
    let loadingDurations = false;
    async function loadDurations() {
      if (loadingDurations) return;
      loadingDurations = true;
      try {
        for (const s of sounds) {
          if (durations.has(s.id)) continue;
          const cached = buffers.get(s.id);
          let seconds = cached?.duration;
          if (!seconds) {
            const bytes = await api.readSound(s.id);
            if (!bytes) continue;
            const url = URL.createObjectURL(new Blob([bytes]));
            seconds = await new Promise((resolve) => {
              const a = new Audio();
              a.preload = 'metadata';
              a.onloadedmetadata = () => resolve(a.duration);
              a.onerror = () => resolve(NaN);
              a.src = url;
            });
            URL.revokeObjectURL(url);
          }
          if (Number.isFinite(seconds)) {
            durations.set(s.id, seconds);
            render();
          }
        }
      } finally {
        loadingDurations = false;
      }
    }

    const select = (value, options, onchange) => h('select', { class: 'map-select', onchange: (e) => onchange(e.target.value) },
      options.map(([id, label]) => h('option', { value: id, selected: id === value }, label)));

    // "0:01/0:13": quanto já tocou e quanto o som dura.
    const clockText = () => {
      const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
      const elapsed = Math.min((performance.now() - playStart) / 1000, playDuration);
      return `${fmt(elapsed)}/${fmt(playDuration)}`;
    };

    function syncClock() {
      if (playingId && !clock) {
        clock = setInterval(() => {
          const el = container.querySelector('.sons-time');
          if (el) el.textContent = clockText();
        }, 250);
      } else if (!playingId && clock) {
        clearInterval(clock);
        clock = null;
      }
    }

    function render() {
      // Arrastando um cartão: não redesenha (sumiria com o cartão na mão); redesenha ao soltar.
      if (reorder?.started) return;
      syncClock();
      if (!api?.listSounds) {
        clear(container, h('div', { class: 'empty' }, 'Esta aba precisa do app instalado.'));
        return;
      }
      const outputs = realDevices(devices, 'audiooutput');
      const inputs = physicalDevices(devices, 'audioinput'); // microfone de verdade, para misturar a voz
      const listenOutputs = physicalDevices(devices, 'audiooutput'); // onde a pessoa ouve: sem cabos virtuais
      const micOut = pickMicOutput(devices, prefs.micOut);
      const virtualFound = outputs.some((d) => isVirtualOutput(d.label));
      const canMic = useEffect() ? !!effectMic() : !!micOut;

      clear(container, h('div', { class: 'sons-layout' },
        h('section', {
          class: 'card sons-library',
          // Arquivos de áudio soltos aqui viram sons (como "Adicionar sons").
          ondragover: (e) => { if (isFileDrag(e)) { e.preventDefault(); e.currentTarget.classList.add('dropping'); } },
          ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('dropping'); },
          ondrop: (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.currentTarget.classList.remove('dropping');
            // Um File por vez pela ponte (uma FileList inteira não atravessa).
            const paths = [...e.dataTransfer.files].map((f) => api.pathForFile?.(f)).filter(Boolean);
            if (paths.length && api.addSoundPaths) refreshSounds(api.addSoundPaths(paths));
            else setMessage('Não foi possível ler os arquivos soltos. Use "Adicionar sons".');
          },
        },
          h('div', { class: 'sons-drop-hint', 'aria-hidden': 'true' }, icons.plus(), 'Solte para adicionar os sons'),
          h('div', { class: 'sons-head' },
            h('div', {},
              h('h3', {}, 'Seus sons'),
              h('span', { class: 'muted small' }, sounds.length === 1 ? '1 som' : `${sounds.length} sons`),
              // O que cada botão do cartão faz (os de baixo são só ícones).
              sounds.length
                ? h('p', { class: 'muted small sons-howto' }, 'O ▶ toca no fone e no microfone ao mesmo tempo. Embaixo de cada som: tocar só no fone, só no microfone, definir um atalho de teclado e apagar.')
                : null,
              sounds.length
                ? h('p', { class: 'muted small sons-howto' }, 'Arraste arquivos de áudio para cá para adicionar, ou arraste um som para mudar a ordem.')
                : null),
            h('div', { class: 'sons-head-actions' },
              sounds.length >= 2 ? searchBox() : null,
              playingId ? h('button', { class: 'btn sons-stop-top', hidden: true, onclick: stopAll }, 'Parar') : null)),
          message ? h('p', { class: 'sons-message small', role: 'status' }, message) : null,
          h('p', { class: 'muted small sons-no-match', hidden: true }, 'Nenhum som com esse nome.'),
          sounds.length === 0
            ? h('div', { class: 'empty sons-empty' },
              h('span', { class: 'sons-empty-icon', 'aria-hidden': 'true' }, icons.note()),
              h('p', {}, 'Nenhum som ainda'),
              h('p', { class: 'small' }, 'Adicione arquivos MP3, WAV, OGG, M4A ou FLAC, ou arraste os arquivos para cá.'),
              button('Adicionar sons', () => refreshSounds(api.addSounds()), { kind: 'primary' }))
            : h('div', { class: 'sons-grid' }, sounds.map((s) => soundTile(s, canMic)),
              h('button', { class: 'sons-tile sons-tile-add', onclick: () => refreshSounds(api.addSounds()) },
                h('span', { class: 'sons-tile-add-icon', 'aria-hidden': 'true' }, icons.plus()), 'Adicionar sons')),
          h('div', { class: 'sons-footer' }, volumeRow(), stopHotkeyRow())),
        h('div', { class: 'sons-side' },
          card('Onde você escuta',
            h('p', { class: 'muted small' }, 'Os sons tocam aqui para você.'),
            select(listenId(), [['', 'Saída padrão do Windows'], ...listenOutputs.map((d) => [d.deviceId, friendly(d.label)])], (v) => setPref('listen', v))),
          card('Para quem está na chamada',
            useEffect() ? effectSection() : cableSection(outputs, inputs, micOut, virtualFound),
            modeSwitch()),
          folderRow()),
      ));
      applyFilter();
      watchPlayingTile();
    }

    // --- Busca, ordem e arrastar arquivos ---------------------------------------

    const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const normalize = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

    // A busca só esconde cartões (sem redesenhar a aba, para o campo não perder o foco).
    function searchBox() {
      return h('input', {
        type: 'search', class: 'sons-search', placeholder: 'Buscar', value: query, 'aria-label': 'Buscar sons',
        oninput: (e) => { query = e.target.value; applyFilter(); },
      });
    }

    function applyFilter() {
      const q = normalize(query.trim());
      let shown = 0;
      for (const tile of container.querySelectorAll('.sons-tile[data-id]')) {
        const sound = sounds.find((s) => s.id === tile.dataset.id);
        const match = !q || (sound && normalize(sound.name).includes(q));
        tile.hidden = !match;
        tile.classList.toggle('can-reorder', !q); // reordenar só com a lista inteira à vista
        if (match) shown++;
      }
      const none = container.querySelector('.sons-no-match');
      if (none) none.hidden = !(q && shown === 0);
    }

    // Arrastar um cartão muda a ordem (guardada no app). Arrastar próprio, com o
    // mouse: o cartão "levanta" e segue o ponteiro, o lugar dele vira um espaço
    // tracejado e os outros cartões deslizam para abrir espaço. Só começa depois de
    // mover uns pixels, para os cliques nos botões continuarem funcionando.
    const DRAG_START_PX = 6;
    const SLIDE_MS = 200;
    const EASE = 'cubic-bezier(.2, .8, .2, 1)';
    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let reorder = null; // { tile, pointerId, startX, startY, started, ghost, grid, library, baseX, baseY, original }

    function onTilePointerDown(e) {
      const tile = e.currentTarget;
      if (e.button !== 0 || reorder || !tile.classList.contains('can-reorder')) return;
      reorder = { tile, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, started: false };
      window.addEventListener('pointermove', onReorderMove);
      window.addEventListener('pointerup', onReorderEnd);
      window.addEventListener('pointercancel', onReorderEnd);
    }

    function beginReorder() {
      const { tile } = reorder;
      const library = tile.closest('.sons-library');
      const lib = library.getBoundingClientRect();
      const r = tile.getBoundingClientRect();
      // A cópia fica dentro do cartão "Seus sons" (mesmos estilos), por cima de tudo.
      const ghost = tile.cloneNode(true);
      ghost.classList.add('sons-tile-ghost');
      ghost.removeAttribute('data-id');
      ghost.setAttribute('aria-hidden', 'true');
      reorder.baseX = r.left - lib.left - library.clientLeft;
      reorder.baseY = r.top - lib.top - library.clientTop;
      ghost.style.left = `${reorder.baseX}px`;
      ghost.style.top = `${reorder.baseY}px`;
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;
      library.append(ghost);
      tile.classList.add('reorder-placeholder');
      document.body.classList.add('sons-reordering');
      Object.assign(reorder, { started: true, ghost, library, grid: tile.parentElement, original: tileIds(tile.parentElement) });
    }

    const tileIds = (grid) => [...grid.querySelectorAll('.sons-tile[data-id]')].map((t) => t.dataset.id);

    // Cartão sob o ponteiro, pela posição de layout (sem as animações em curso,
    // para não ficar trocando de lugar enquanto os cartões deslizam).
    function tileAt(x, y) {
      const { grid } = reorder;
      const g = grid.getBoundingClientRect();
      const px = x - g.left - grid.clientLeft + grid.scrollLeft;
      const py = y - g.top - grid.clientTop + grid.scrollTop;
      return [...grid.querySelectorAll('.sons-tile[data-id]')].find((t) => !t.hidden
        && px >= t.offsetLeft && px <= t.offsetLeft + t.offsetWidth && py >= t.offsetTop && py <= t.offsetTop + t.offsetHeight);
    }

    // Move o espaço vazio para o lugar do alvo e faz os cartões deslizarem (FLIP).
    function moveTo(target) {
      const { grid, tile } = reorder;
      const tiles = [...grid.querySelectorAll('.sons-tile[data-id]')];
      const before = new Map(tiles.map((t) => [t, t.getBoundingClientRect()]));
      if (tiles.indexOf(tile) < tiles.indexOf(target)) target.after(tile); else target.before(tile);
      if (reducedMotion()) return;
      for (const t of tiles) {
        const a = before.get(t);
        const b = t.getBoundingClientRect();
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (dx || dy) t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: EASE });
      }
    }

    function onReorderMove(e) {
      if (!reorder || e.pointerId !== reorder.pointerId) return;
      const dx = e.clientX - reorder.startX;
      const dy = e.clientY - reorder.startY;
      if (!reorder.started) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        beginReorder();
      }
      e.preventDefault();
      reorder.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.04) rotate(1deg)`;
      // Perto da borda de cima ou de baixo da lista, rola a lista.
      const g = reorder.grid.getBoundingClientRect();
      if (e.clientY < g.top + 40) reorder.grid.scrollTop -= 14;
      else if (e.clientY > g.bottom - 40) reorder.grid.scrollTop += 14;
      const target = tileAt(e.clientX, e.clientY);
      if (target && target !== reorder.tile) moveTo(target);
    }

    function onReorderEnd(e) {
      if (!reorder || e.pointerId !== reorder.pointerId) return;
      window.removeEventListener('pointermove', onReorderMove);
      window.removeEventListener('pointerup', onReorderEnd);
      window.removeEventListener('pointercancel', onReorderEnd);
      const r = reorder;
      if (!r.started) { reorder = null; return; } // foi só um clique
      // O clique que vem depois de soltar não pode tocar o som.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      const finish = () => {
        r.ghost.remove();
        r.tile.classList.remove('reorder-placeholder');
        document.body.classList.remove('sons-reordering');
        const ids = tileIds(r.grid);
        reorder = null;
        if (ids.join('\n') !== r.original.join('\n')) {
          sounds = ids.map((id) => sounds.find((x) => x.id === id)).filter(Boolean);
          api.setSoundOrder?.(ids).catch(() => {});
        }
        render();
      };
      if (reducedMotion()) { finish(); return; }
      // A cópia "pousa" no espaço vazio antes de sumir.
      const lib = r.library.getBoundingClientRect();
      const dest = r.tile.getBoundingClientRect();
      const toX = dest.left - lib.left - r.library.clientLeft - r.baseX;
      const toY = dest.top - lib.top - r.library.clientTop - r.baseY;
      const landing = r.ghost.animate(
        [{ transform: r.ghost.style.transform }, { transform: `translate(${toX}px, ${toY}px) scale(1) rotate(0deg)` }],
        { duration: 180, easing: EASE, fill: 'forwards' });
      landing.onfinish = finish;
      landing.oncancel = finish;
    }

    // O "Parar" do topo só aparece quando o cartão do som que está tocando saiu de
    // vista (rolado para fora da lista); com o cartão à vista, o quadrado nele basta.
    let tileObserver = null;
    function watchPlayingTile() {
      tileObserver?.disconnect();
      tileObserver = null;
      const stop = container.querySelector('.sons-stop-top');
      const tile = container.querySelector('.sons-tile.playing');
      const grid = container.querySelector('.sons-grid');
      if (!stop || !tile || !grid) return;
      tileObserver = new IntersectionObserver(([entry]) => {
        stop.hidden = entry.intersectionRatio >= 0.5;
      }, { root: grid, threshold: [0, 0.5, 1] });
      tileObserver.observe(tile);
    }

    // Rodapé de "Seus sons": onde os arquivos ficam. O caminho abre a pasta no
    // Explorador; "Trocar pasta…" escolhe outra; "Voltar para a pasta padrão" desfaz.
    function folderRow() {
      const openFolder = async () => {
        // openPath devolve '' quando abre, ou o motivo de não ter aberto.
        const error = await api.openSoundsFolder();
        if (error) setMessage(`Não foi possível abrir a pasta dos sons: ${error}`);
      };
      // Cartão na coluna da direita, embaixo de "Para quem está na chamada".
      return h('section', { class: 'card sons-folder' },
        h('div', { class: 'sons-folder-head' },
          h('h3', {}, 'Onde os sons ficam salvos'),
          h('span', { class: 'sons-folder-tag' + (folder?.custom ? ' custom' : '') }, folder?.custom ? 'Escolhida por você' : 'Padrão')),
        h('div', { class: 'sons-folder-row' },
          h('button', {
            class: 'sons-folder-path',
            // Dentro de Músicas mostra curto ("Músicas › UnusHub"); o caminho inteiro fica na dica.
            title: folder?.music ? folder.path : 'Abrir no Explorador de Arquivos',
            'aria-label': `Abrir a pasta ${folder?.path || ''} no Explorador de Arquivos`,
            onclick: openFolder,
          },
          h('span', { class: 'sons-folder-icon', 'aria-hidden': 'true' }, icons.folder()),
          h('span', { class: 'sons-folder-value' }, folder?.music ? `Músicas › ${folder.music}` : folder?.path || '…'),
          h('span', { class: 'sons-folder-open', 'aria-hidden': 'true' }, icons.external())),
          button(folderBusy ? 'Trocando…' : 'Trocar pasta…', () => changeFolder(api.chooseSoundsFolder), { kind: 'secondary', disabled: folderBusy })),
        h('p', { class: 'muted small sons-folder-hint' },
          'Clique no caminho para abrir a pasta. Os sons que você adiciona são copiados para lá.',
          folder?.custom
            ? h('button', { class: 'link-btn', disabled: folderBusy, onclick: () => changeFolder(api.resetSoundsFolder) }, 'Voltar para a pasta padrão')
            : null));
    }

    // Botão do atalho: mostra o atalho (ou o ícone de teclado) e grava um novo ao clicar.
    function hotkeyButton(s) {
      const acc = hotkeys[s.id];
      if (recording === s.id) {
        return h('button', { class: 'btn sons-hotkey recording', title: 'De 1 a 3 teclas (ex.: Shift + F1). Esc cancela, Backspace tira o atalho', onclick: () => { stopRecording(); render(); } }, 'Aperte as teclas…');
      }
      return acc
        ? h('button', { class: 'btn sons-hotkey', title: 'Atalho: clique para trocar', onclick: () => startRecording(s) },
          h('kbd', { translate: 'no' }, acceleratorLabel(acc)))
        : iconButton(icons.keyboard, 'Definir atalho de teclado', () => startRecording(s));
    }

    // Um cartão por som: tocar (fone e microfone, ou só fone se o microfone não
    // estiver pronto), só fone, só microfone e remover.
    function soundTile(s, canMic) {
      const isPlaying = playingId === s.id;
      const main = canMic ? 'both' : 'ear';
      return h('div', { class: 'sons-tile can-reorder' + (isPlaying ? ' playing' : ''), 'data-id': s.id, onpointerdown: onTilePointerDown },
        h('button', {
          class: 'sons-play',
          title: isPlaying ? 'Parar' : (canMic ? 'Tocar no fone e no microfone' : 'Tocar no fone'),
          'aria-label': isPlaying ? `Parar ${s.name}` : `Tocar ${s.name}`,
          onclick: () => (isPlaying ? stopAll() : play(s, main)),
        }, isPlaying ? icons.stop() : icons.play()),
        h('div', { class: 'sons-tile-body' },
          h('span', { class: 'sons-name', title: s.name }, s.name),
          isPlaying
            ? h('span', { class: 'sons-state' }, h('span', { class: 'sons-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), 'tocando',
              h('span', { class: 'sons-time', translate: 'no' }, clockText()))
            : h('span', { class: 'muted small sons-duration', translate: 'no', title: canMic ? 'Toca no fone e no microfone' : 'Toca só no fone' },
              durations.has(s.id) ? durationText(durations.get(s.id)) : '–:––')),
        h('div', { class: 'sons-tile-actions' },
          iconButton(icons.headphones, 'Só no fone', () => play(s, 'ear')),
          iconButton(icons.mic, canMic ? 'Só no microfone' : 'Microfone não configurado', () => play(s, 'mic'), !canMic),
          hotkeyButton(s),
          iconButton(icons.trash, 'Remover', async () => { if (isPlaying) stopAll(); refreshSounds(api.removeSound(s.id)); })));
    }

    // Dois volumes: o que você ouve no fone e o que vai para o microfone.
    function volumeRow() {
      const slider = (kind, draw, label) => {
        const key = volumeKey(kind);
        const out = h('span', { class: 'sons-volume-value' }, `${prefs[key]}%`);
        return h('div', { class: 'sons-volume-row' },
          h('span', { class: 'sons-volume-icon', 'aria-hidden': 'true' }, draw()),
          h('span', { class: 'small' }, label),
          h('input', {
            type: 'range', min: 0, max: 100, value: prefs[key], 'aria-label': `Volume ${label.toLowerCase()}`,
            oninput: (e) => {
              out.textContent = `${e.target.value}%`;
              const s = sinks[kind];
              if (s) s.gain.gain.value = Number(e.target.value) / 100; // ouve a mudança enquanto arrasta
            },
            onchange: (e) => setPref(key, Number(e.target.value)),
          }),
          out);
      };
      return h('div', { class: 'sons-volume' },
        slider('ear', icons.headphones, 'No fone'),
        slider('mic', icons.mic, 'No microfone'),
        h('p', { class: 'muted small sons-volume-hint' }, 'Volume só dos sons: no fone é o que você ouve, no microfone é o que chega para quem está na chamada. Sua voz não muda.'));
    }

    // Atalho global que para qualquer som tocando, mesmo com o UnusHub minimizado.
    function stopHotkeyRow() {
      return h('div', { class: 'sons-stop-hotkey' },
        h('span', { class: 'sons-volume-icon', 'aria-hidden': 'true' }, icons.stopAll()),
        h('span', { class: 'setting-text' },
          h('span', { class: 'small' }, 'Parar todos os sons'),
          h('small', { class: 'muted' }, 'Atalho que corta qualquer som tocando, mesmo com o UnusHub minimizado.')),
        hotkeyButton(STOP_ENTRY));
    }

    // O efeito é o caminho principal; o cabo virtual fica num link discreto, para
    // quem não pode instalar o efeito. Com o efeito instalado o link some.
    function modeSwitch() {
      if (useEffect()) {
        if (effectMic()) return null;
        return h('p', { class: 'muted small sons-mode-switch' },
          h('button', { class: 'link-btn', onclick: () => setPref('micMode', 'cable') }, 'Prefere usar um cabo virtual?'));
      }
      return h('p', { class: 'muted small sons-mode-switch' },
        h('button', {
          class: 'link-btn',
          onclick: async () => {
            await setPref('micMode', 'effect');
            refreshEffect().catch(() => {});
          },
        }, 'Usar o efeito no microfone'));
    }

    function cableSection(outputs, inputs, micOut, virtualFound) {
      return [
        h('p', { class: 'muted small' }, 'Para quem está na chamada ouvir os sons, o UnusHub toca na saída de um cabo de áudio virtual. No Discord, no jogo ou no app de chamada, escolha a entrada desse cabo como microfone.'),
        virtualFound ? null : h('p', { class: 'small' }, 'Nenhum cabo de áudio virtual encontrado. Instale um (por exemplo, VB-CABLE) e ele aparece aqui.'),
        select(micOut?.deviceId || '', [['', 'Escolha a saída do cabo virtual'], ...outputs.map((d) => [d.deviceId, friendly(d.label)])], (v) => setPref('micOut', v)),
        h('label', { class: 'setting-row' },
          h('span', { class: 'setting-text' },
            h('span', {}, 'Misturar minha voz'),
            h('small', { class: 'muted' }, 'Manda também o seu microfone para o cabo, para falar e tocar sons pelo mesmo microfone.')),
          h('input', { type: 'checkbox', class: 'switch', checked: prefs.mixVoice, onchange: (e) => setPref('mixVoice', e.target.checked) })),
        prefs.mixVoice
          ? select(prefs.micIn, [['', 'Microfone padrão do Windows'], ...inputs.map((d) => [d.deviceId, friendly(d.label)])], (v) => setPref('micIn', v))
          : null,
      ];
    }

    // Etiqueta de estado do efeito: verde ativo, amarelo esperando, cinza parado.
    const statusBadge = (kind, text) => h('span', { class: `sons-status ${kind}` }, h('span', { class: 'sons-dot', 'aria-hidden': 'true' }), text);

    function effectSection() {
      const intro = h('p', { class: 'muted small' }, 'Soma os sons ao seu microfone de verdade, sem cabo virtual: em jogos, gravadores e chamadas (Discord, Teams, WhatsApp). Não funciona em apps que usam o microfone em modo exclusivo.');
      if (!effect.loaded) {
        return [statusBadge('wait', 'Procurando microfones…'), intro];
      }
      if (!effect.built) {
        return [statusBadge('off', 'Não compilado'), intro,
          h('p', { class: 'small' }, 'Rode native\\audio-mix\\compilar.cmd (precisa do Visual Studio Build Tools com C++).')];
      }
      const installed = effectMic();
      const busy = !!effect.busy;
      if (installed) {
        return [
          // O estado se atualiza sozinho (a aba confere a cada poucos segundos).
          h('div', { class: 'sons-status-row' },
            effect.active ? statusBadge('on', 'Ativo') : statusBadge('wait', 'Esperando um app usar o microfone')),
          h('div', { class: 'sons-mic' },
            h('span', { class: 'sons-mic-icon', 'aria-hidden': 'true' }, icons.mic()),
            h('span', {}, h('strong', {}, installed.name), h('span', { class: 'muted small' }, installed.device))),
          intro,
          installed.bluetooth ? bluetoothWarning('Este microfone é de um fone Bluetooth, e nele o Windows não roda efeitos: o som não chega na chamada. Remova o efeito e use o fone pelo cabo ou pelo dongle, ou um cabo virtual.') : null,
          installed.calls || installed.bluetooth ? null : h('p', { class: 'small' }, 'Esta instalação ainda não funciona em chamadas. Atualize para ligar (pede administrador e reinicia o som do Windows).'),
          // Efeito de uma versão anterior do app: instalar de novo troca a DLL pela nova.
          effect.outdated && installed.calls && !installed.bluetooth
            ? h('p', { class: 'small' }, 'Há uma versão nova do efeito. Atualize para usar (pede administrador e reinicia o som do Windows).')
            : null,
          h('div', { class: 'sons-foot' },
            installed.calls || installed.bluetooth ? null : button(effect.busy === 'install' ? 'Atualizando…' : 'Atualizar para chamadas', () => effectAction('install', installed.id), { kind: 'primary', disabled: busy }),
            effect.outdated && installed.calls && !installed.bluetooth
              ? button(effect.busy === 'install' ? 'Atualizando…' : 'Atualizar efeito', () => effectAction('install', installed.id), { kind: 'primary', disabled: busy })
              : null,
            button('Remover efeito', () => effectAction('remove'), { disabled: busy })),
        ];
      }
      const mics = micChoices();
      const chosen = chosenMic();
      return [
        statusBadge('off', 'Não instalado'),
        intro,
        mics.length === 0
          ? h('p', { class: 'small' }, effect.checking ? 'Procurando microfones…'
            : effect.failed ? 'Não deu para ler os microfones do Windows. O UnusHub tenta de novo sozinho.'
              : 'Nenhum microfone ativo encontrado. Ligue ou conecte um microfone: ele aparece aqui sozinho.')
          : select(chosen.id, mics.map((m) => [m.id, `${m.name} (${m.device})${m.bluetooth ? ' · Bluetooth' : ''}`]), (v) => setPref('effectMic', v)),
        chosen?.bluetooth
          ? bluetoothWarning('Este microfone é de um fone Bluetooth, e nele o Windows não roda efeitos: o som não chegaria na chamada. Ligue o fone pelo cabo ou pelo dongle e escolha esse microfone, ou use um cabo virtual.')
          : h('p', { class: 'muted small' }, 'A instalação pede permissão de administrador, guarda os efeitos atuais do microfone e reinicia o som do Windows. "Remover efeito" volta tudo como estava.'),
        h('div', { class: 'sons-foot' },
          button(busy ? 'Instalando…' : 'Instalar efeito', () => effectAction('install'), { kind: 'primary', disabled: busy || !chosen || chosen.bluetooth })),
      ];
    }

    // Aviso de fone Bluetooth, com o atalho para o cabo virtual.
    function bluetoothWarning(text) {
      return h('div', { class: 'sons-bt-warning' },
        h('p', { class: 'small' }, text),
        h('button', { class: 'link-btn small', onclick: () => setPref('micMode', 'cable') }, 'Usar um cabo virtual'));
    }

    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    navigator.mediaDevices?.addEventListener('devicechange', scheduleEffectRefresh);
    render();
    refreshSounds().catch(() => {});
    if (api?.soundsFolder) refreshFolder().catch(() => {});
    if (api?.soundHotkeys) refreshHotkeys().catch(() => {});
    refreshDevices().catch(() => {});
    if (useEffect()) refreshEffect().catch(() => {});

    const tab = {
      playById,
      tryAutoInstall,
      update() {},
      unmount() {
        if (activeTab === tab) activeTab = null;
        clearInterval(effectPoll);
        tileObserver?.disconnect();
        stopRecording();
        navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
        navigator.mediaDevices?.removeEventListener('devicechange', scheduleEffectRefresh);
        clearTimeout(effectRefreshTimer);
        stopAll();
        clearInterval(clock);
        clock = null;
        closeSink('ear');
        closeSink('mic');
      },
    };
    if (!isBackground) activeTab = tab;
    return tab;
  },
};

export default plugin;
