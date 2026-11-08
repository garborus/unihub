// Ponte mínima entre a página e o processo principal: só o que a web não faz
// sozinha. Nada de Node.js fica exposto para a página.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unihub', {
  /** Abre Configurações > Sistema > Som do Windows. */
  openSoundSettings: () => ipcRenderer.invoke('open-sound-settings'),
  /** Bateria que o Windows conhece de fones Bluetooth: [{ name, percent }]. */
  bluetoothBatteries: () => ipcRenderer.invoke('bluetooth-batteries'),
  /** Teclados que o Windows conhece (inclusive notebook e Bluetooth): [{ id, name, chain }]. */
  systemKeyboards: () => ipcRenderer.invoke('system-keyboards'),
  /** Versão (bcdDevice) de um aparelho USB, ex.: "0012", ou null. */
  usbRevision: (vendorId, productId) => ipcRenderer.invoke('usb-revision', vendorId, productId),
  /** Configurações do app guardadas no computador (bandeja, menu, tema...). */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  /** Baterias para o menu do ícone da bandeja: [{ id, label }]. */
  setTrayBatteries: (items) => ipcRenderer.send('tray-batteries', items),
  /** Sons guardados pelo app (aba Sons): [{ id, name }]. */
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  /** Abre a janela de escolher arquivos e guarda cópias: { sounds, skipped }. */
  addSounds: () => ipcRenderer.invoke('sounds:add'),
  /** Bytes de um som guardado (Uint8Array) ou null. */
  readSound: (id) => ipcRenderer.invoke('sounds:read', id),
  removeSound: (id) => ipcRenderer.invoke('sounds:remove', id),
  openSoundsFolder: () => ipcRenderer.invoke('sounds:open-folder'),
  /** Atalhos dos sons: { hotkeys: { id: atalho }, failed: [ids que o Windows recusou] }. */
  soundHotkeys: () => ipcRenderer.invoke('sounds:hotkeys'),
  /** Liga o atalho de um som (null tira): { hotkeys, error? } (error 'em uso' se outro app já usa). */
  setSoundHotkey: (id, accelerator) => ipcRenderer.invoke('sounds:set-hotkey', id, accelerator),
  /** Desliga (true) ou religa (false) os atalhos enquanto a página grava um novo. */
  pauseSoundHotkeys: (paused) => ipcRenderer.invoke('sounds:hotkeys-pause', paused),
  /** Chamado com o id do som quando o atalho dele é apertado, mesmo com o UniHub em segundo plano. */
  onSoundHotkey: (callback) => ipcRenderer.on('sounds:hotkey', (_event, id) => callback(id)),
  /** Pasta dos sons: { path, custom }. */
  soundsFolder: () => ipcRenderer.invoke('sounds:folder'),
  /** Escolhe outra pasta; null se cancelar, senão { folder, sounds, failed } ou { folder, sounds, error }. */
  chooseSoundsFolder: () => ipcRenderer.invoke('sounds:choose-folder'),
  /** Volta para a pasta do app, com o mesmo retorno de chooseSoundsFolder. */
  resetSoundsFolder: () => ipcRenderer.invoke('sounds:reset-folder'),
  /** Efeito no microfone: { built, mics: [{ id, name, device, installed }], active }. */
  micEffectStatus: () => ipcRenderer.invoke('mic-effect:status'),
  /** true enquanto algum app usa o microfone com o efeito. */
  micEffectActive: () => ipcRenderer.invoke('mic-effect:active'),
  /** Instala/remove o efeito (o Windows pede administrador): { ok, cancelled, message }. */
  micEffectInstall: (micId) => ipcRenderer.invoke('mic-effect:install', micId),
  micEffectRemove: () => ipcRenderer.invoke('mic-effect:remove'),
  /** Toca no microfone pelo efeito: Float32Array mono 48 kHz. { code } (0 ok, 3 efeito inativo). */
  micEffectPlay: (samples) => ipcRenderer.invoke('mic-effect:play', samples),
  micEffectStop: () => ipcRenderer.invoke('mic-effect:stop'),
  /** Atualizações (0.x portátil): { current, latest, newer, canInstall, downloaded, error }. */
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openUpdatePage: (url) => ipcRenderer.invoke('update:open-page', url),
  onUpdateProgress: (callback) => ipcRenderer.on('update:progress', (_event, p) => callback(p)),
  /** A bandeja pediu para abrir um aparelho. */
  onOpenDevice: (callback) => ipcRenderer.on('open-device', (_event, id) => callback(id)),
});
