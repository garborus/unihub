// Atalhos dos sons.
//
// Cada som pode ter um atalho global (ex.: "Ctrl+Shift+1", "F9", "num5"), que
// funciona com o UnusHub em segundo plano, inclusive dentro de jogos. Ficam em
// settings.soundHotkeys ({ id do som: atalho }). Quando o atalho é apertado, a
// página recebe 'sounds:hotkey' com o id e toca o som.

const { app, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');
const { state, saveSettings } = require('./settings-store.cjs');

let getWindow = () => null;

const registeredHotkeys = new Set();

function soundHotkeys() {
  const map = state.settings.soundHotkeys;
  return map && typeof map === 'object' ? map : {};
}

/** Registra de novo todos os atalhos; devolve os que o Windows recusou (outro app já usa). */
function applySoundHotkeys() {
  for (const acc of registeredHotkeys) globalShortcut.unregister(acc);
  registeredHotkeys.clear();
  const failed = [];
  for (const [id, acc] of Object.entries(soundHotkeys())) {
    try {
      if (globalShortcut.register(acc, () => getWindow()?.webContents.send('sounds:hotkey', id))) registeredHotkeys.add(acc);
      else failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return failed;
}

const hotkeysForPage = (extra = {}) => ({ hotkeys: soundHotkeys(), ...extra });

/** Tira o atalho de um som (ex.: o som foi apagado). */
function removeHotkey(id) {
  if (!soundHotkeys()[id]) return;
  const map = { ...soundHotkeys() };
  delete map[id];
  state.settings = { ...state.settings, soundHotkeys: map };
  applySoundHotkeys();
  saveSettings();
}

/** ctx.getWindow(): a janela do app, que recebe o aviso do atalho apertado. */
function register(ctx) {
  getWindow = ctx.getWindow;

  ipcMain.handle('sounds:hotkeys', () => hotkeysForPage({ failed: applySoundHotkeys() }));

  // Enquanto a página grava um atalho novo, os atuais ficam desligados.
  ipcMain.handle('sounds:hotkeys-pause', (_event, paused) => {
    if (paused) {
      for (const acc of registeredHotkeys) globalShortcut.unregister(acc);
      registeredHotkeys.clear();
    } else {
      applySoundHotkeys();
    }
  });

  // Liga (ou tira, com null) o atalho de um som. Um atalho só vale para um som:
  // se já era de outro, passa para este.
  ipcMain.handle('sounds:set-hotkey', (_event, id, accelerator) => {
    if (typeof id !== 'string' || id !== path.basename(id)) return hotkeysForPage({ error: 'som inválido' });
    const map = { ...soundHotkeys() };
    if (accelerator === null) {
      delete map[id];
    } else {
      // De 1 a 3 teclas (a principal e até dois modificadores), como a página permite.
      if (typeof accelerator !== 'string' || accelerator.length > 60 || !/^[A-Za-z0-9+=\-[\];',./\\`]+$/.test(accelerator)
        || accelerator.split('+').length > 3) {
        return hotkeysForPage({ error: 'atalho inválido' });
      }
      for (const [other, acc] of Object.entries(map)) if (acc.toLowerCase() === accelerator.toLowerCase()) delete map[other];
      map[id] = accelerator;
    }
    state.settings = { ...state.settings, soundHotkeys: map };
    const failed = applySoundHotkeys();
    if (accelerator !== null && failed.includes(id)) {
      // O Windows não deixou (outro app já usa esse atalho): não guarda.
      delete map[id];
      state.settings = { ...state.settings, soundHotkeys: map };
      applySoundHotkeys();
      saveSettings();
      return hotkeysForPage({ error: 'em uso' });
    }
    saveSettings();
    return hotkeysForPage();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}

module.exports = { register, soundHotkeys, applySoundHotkeys, removeHotkey };
