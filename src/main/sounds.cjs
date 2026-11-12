// Sons (aba Sons).
//
// Os áudios que a pessoa adiciona são copiados para a pasta dos sons, então
// continuam tocando mesmo se o arquivo original mudar de lugar. A pasta padrão é
// Músicas\UnusHub (fácil de achar e fora de pastas de projeto); antes era dentro
// dos dados do app, e os sons de lá são movidos uma vez ao abrir. Com o nome
// antigo (Músicas\UniHub), a pasta é renomeada uma vez ao abrir. Pode ser outra
// pasta que a pessoa escolher; fica em settings.soundsFolder,
// que a página não muda por settings:set, só pela janela de escolher pasta.
// A página recebe o nome e os bytes de cada som e o caminho da pasta, só para mostrar.

const { app, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { state, saveSettings, activeLanguage } = require('./settings-store.cjs');
const hotkeys = require('./sound-hotkeys.cjs');

let getWindow = () => null;

const SOUND_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm'];
const SOUND_MAX_BYTES = 50 * 1024 * 1024;
const defaultSoundsDir = () => path.join(app.getPath('music'), 'UnusHub');
const legacySoundsDir = () => path.join(app.getPath('userData'), 'sons');
const soundsDir = () => state.settings.soundsFolder || defaultSoundsDir();

// O app se chamava UniHub: a pasta padrão Músicas\UniHub vira Músicas\UnusHub.
// Se não der para renomear (arquivo aberto), continua usando a antiga, escolhida.
function migrateSoundsFolderName() {
  if (state.settings.soundsFolder) return;
  const oldDir = path.join(app.getPath('music'), 'UniHub');
  const newDir = defaultSoundsDir();
  try {
    if (!fs.existsSync(oldDir)) return;
    if (fs.existsSync(newDir)) {
      if (fs.readdirSync(newDir).length) return; // as duas com arquivos: não mistura
      fs.rmdirSync(newDir);
    }
    fs.renameSync(oldDir, newDir);
  } catch {
    state.settings = { ...state.settings, soundsFolder: oldDir };
    saveSettings();
  }
}

function listSounds() {
  try {
    return fs.readdirSync(soundsDir(), { withFileTypes: true })
      .filter((e) => e.isFile() && SOUND_EXTENSIONS.includes(path.extname(e.name).slice(1).toLowerCase()))
      .map((e) => ({ id: e.name, name: path.parse(e.name).name }))
      .sort(soundOrderCompare());
  } catch {
    return [];
  }
}

// Ordem dos sons escolhida pela pessoa (arrastando os cartões): state.settings.soundOrder
// com os ids. Os que não estão na lista (novos) vêm depois, em ordem alfabética.
function soundOrderCompare() {
  const order = Array.isArray(state.settings.soundOrder) ? state.settings.soundOrder : [];
  const pos = new Map(order.map((id, i) => [id, i]));
  return (a, b) => {
    const pa = pos.has(a.id) ? pos.get(a.id) : Infinity;
    const pb = pos.has(b.id) ? pos.get(b.id) : Infinity;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  };
}

/** Copia arquivos de áudio para a pasta dos sons; devolve os nomes que ficaram de fora. */
function copySoundFiles(files) {
  const skipped = [];
  fs.mkdirSync(soundsDir(), { recursive: true });
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    let size = Infinity;
    try { if (fs.statSync(file).isFile()) size = fs.statSync(file).size; } catch { /* sumiu */ }
    if (!SOUND_EXTENSIONS.includes(ext.slice(1)) || size > SOUND_MAX_BYTES) {
      skipped.push(path.basename(file));
      continue;
    }
    fs.copyFileSync(file, path.join(soundsDir(), freeName(path.parse(file).name, ext)));
  }
  return skipped;
}

/** Caminho de um som da pasta, só pelo nome do arquivo (nada de ../). */
function soundPath(id) {
  if (typeof id !== 'string' || id !== path.basename(id)) return null;
  const file = path.join(soundsDir(), id);
  return listSounds().some((s) => s.id === id) ? file : null;
}

function freeName(base, ext, dir = soundsDir()) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
}

const sameFolder = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Textos das janelas do Windows da pasta dos sons, que ficam fora da página.
const FOLDER_TEXT = {
  pt: { title: 'Escolher a pasta dos áudios', ask: (n) => (n === 1 ? 'Mover o áudio para a nova pasta?' : `Mover os ${n} áudios para a nova pasta?`), detail: 'Se deixar, eles ficam na pasta antiga e só voltam a aparecer na aba quando você escolher essa pasta de novo.', move: 'Mover', keep: 'Deixar onde estão', cancel: 'Cancelar' },
  en: { title: 'Choose the sounds folder', ask: (n) => (n === 1 ? 'Move the sound to the new folder?' : `Move the ${n} sounds to the new folder?`), detail: 'If you leave them, they stay in the old folder and only show in the tab again when you pick that folder again.', move: 'Move', keep: 'Leave them', cancel: 'Cancel' },
  es: { title: 'Elegir la carpeta de sonidos', ask: (n) => (n === 1 ? '¿Mover el sonido a la nueva carpeta?' : `¿Mover los ${n} sonidos a la nueva carpeta?`), detail: 'Si los dejas, se quedan en la carpeta anterior y solo vuelven a aparecer en la pestaña cuando elijas esa carpeta otra vez.', move: 'Mover', keep: 'Dejarlos', cancel: 'Cancelar' },
};

/**
 * Pasta para a página. `music`: o caminho dentro de Músicas (ex.: "UnusHub"),
 * para mostrar curto ("Músicas › UnusHub"); null se a pasta for fora de Músicas.
 */
function soundsFolderInfo() {
  const dir = soundsDir();
  const rel = path.relative(app.getPath('music'), dir);
  const inMusic = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  return { path: dir, custom: !!state.settings.soundsFolder, music: inMusic ? rel.split(path.sep).join(' › ') : null };
}

/**
 * Mudança única: sons da pasta antiga (dentro dos dados do app) vão para a
 * padrão nova. Copia todos primeiro e só apaga os originais se todos deram certo;
 * se algum falhar, desfaz as cópias e continua usando a pasta antiga (como
 * escolhida), para nenhum som sumir da aba. Os atalhos seguem o som renomeado.
 */
function migrateLegacySounds() {
  if (state.settings.soundsFolder) return;
  const legacy = legacySoundsDir();
  const target = defaultSoundsDir();
  let files;
  try {
    files = fs.readdirSync(legacy, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return; // sem pasta antiga: nada a mover
  }
  const copied = [];
  try {
    fs.mkdirSync(target, { recursive: true });
    for (const name of files) {
      const to = freeName(path.parse(name).name, path.extname(name), target);
      fs.copyFileSync(path.join(legacy, name), path.join(target, to));
      copied.push([name, to]);
    }
  } catch (err) {
    for (const [, to] of copied) fs.rmSync(path.join(target, to), { force: true });
    state.settings.soundsFolder = legacy;
    saveSettings();
    console.warn('Sons: não foi possível mover para Músicas; fica a pasta antiga.', err.message);
    return;
  }
  for (const [name] of copied) fs.rmSync(path.join(legacy, name), { force: true });
  // O Windows pode demorar um instante para soltar os arquivos apagados: tenta de
  // novo. Só remove a pasta se estiver vazia (algo que não é nosso fica).
  try {
    if (fs.readdirSync(legacy).length === 0) fs.rmSync(legacy, { recursive: true, maxRetries: 5, retryDelay: 100 });
  } catch { /* fica para a próxima vez que o app abrir */ }
  const renamed = copied.filter(([a, b]) => a !== b);
  if (renamed.length && state.settings.soundHotkeys) {
    const map = { ...state.settings.soundHotkeys };
    for (const [a, b] of renamed) if (map[a]) { map[b] = map[a]; delete map[a]; }
    state.settings.soundHotkeys = map;
    saveSettings();
  }
}

/**
 * Troca a pasta dos sons. Se a pasta atual tem sons, pergunta se move para a nova.
 * Devolve { folder, sounds, failed }, { folder, sounds, error } ou null se cancelar.
 */
async function changeSoundsFolder(target) {
  const done = (extra = {}) => ({ folder: soundsFolderInfo(), sounds: listSounds(), ...extra });
  const old = soundsDir();
  if (sameFolder(old, target)) return done();
  // A pasta precisa existir e aceitar arquivos.
  try {
    fs.mkdirSync(target, { recursive: true });
    const probe = path.join(target, `.unihub-${process.pid}.tmp`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
  } catch (err) {
    return done({ error: err.message });
  }
  const current = listSounds();
  let move = false;
  if (current.length) {
    const text = FOLDER_TEXT[activeLanguage()] || FOLDER_TEXT.pt;
    const { response } = await dialog.showMessageBox(getWindow(), {
      type: 'question',
      message: text.ask(current.length),
      detail: text.detail,
      buttons: [text.move, text.keep, text.cancel],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 2) return null;
    move = response === 0;
  }
  const failed = [];
  if (move) {
    for (const { id } of current) {
      const from = path.join(old, id);
      const to = path.join(target, freeName(path.parse(id).name, path.extname(id), target));
      try {
        try {
          fs.renameSync(from, to);
        } catch {
          // Outro disco: copia e só então apaga o original.
          fs.copyFileSync(from, to);
          fs.rmSync(from, { force: true });
        }
      } catch {
        failed.push(id);
      }
    }
  }
  if (sameFolder(target, defaultSoundsDir())) delete state.settings.soundsFolder;
  else state.settings.soundsFolder = path.resolve(target);
  saveSettings();
  return done({ failed });
}

/** ctx.getWindow(): a janela do app, dona das janelas de escolher arquivo e pasta. */
function register(ctx) {
  getWindow = ctx.getWindow;

  // Ao listar, atalhos de sons que sumiram da pasta saem também (só se a pasta
  // abriu: uma pasta fora do ar, como um pendrive tirado, não apaga atalhos).
  ipcMain.handle('sounds:list', () => {
    const sounds = listSounds();
    if (fs.existsSync(soundsDir())) hotkeys.keepHotkeysOf(sounds.map((s) => s.id));
    return sounds;
  });

  ipcMain.handle('sounds:add', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Adicionar áudios',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Áudio', extensions: SOUND_EXTENSIONS }],
    });
    const skipped = result.canceled ? [] : copySoundFiles(result.filePaths);
    return { sounds: listSounds(), skipped };
  });

  // Arquivos soltos na aba (arrastar e soltar): mesmos limites da janela de escolher.
  ipcMain.handle('sounds:add-files', (_event, files) => {
    if (!Array.isArray(files)) return { sounds: listSounds(), skipped: [] };
    const valid = files.filter((f) => typeof f === 'string' && path.isAbsolute(f)).slice(0, 100);
    const skipped = copySoundFiles(valid); // copia antes de listar
    return { sounds: listSounds(), skipped };
  });

  // Nova ordem dos sons (ids na ordem dos cartões).
  ipcMain.handle('sounds:set-order', (_event, ids) => {
    if (!Array.isArray(ids)) return listSounds();
    state.settings = { ...state.settings, soundOrder: ids.filter((id) => typeof id === 'string' && id === path.basename(id)).slice(0, 2000) };
    saveSettings();
    return listSounds();
  });

  ipcMain.handle('sounds:read', (_event, id) => {
    const file = soundPath(id);
    return file ? fs.promises.readFile(file) : null;
  });

  // Apaga só a cópia guardada pelo app; o arquivo original da pessoa fica onde estava.
  // O atalho do som, se tinha, sai junto.
  ipcMain.handle('sounds:remove', (_event, id) => {
    const file = soundPath(id);
    if (file) fs.rmSync(file, { force: true });
    if (file) hotkeys.removeHotkey(id);
    return listSounds();
  });

  ipcMain.handle('sounds:folder', () => soundsFolderInfo());

  ipcMain.handle('sounds:choose-folder', async () => {
    const text = FOLDER_TEXT[activeLanguage()] || FOLDER_TEXT.pt;
    const result = await dialog.showOpenDialog(getWindow(), {
      title: text.title,
      defaultPath: soundsDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return changeSoundsFolder(result.filePaths[0]);
  });

  ipcMain.handle('sounds:reset-folder', () => changeSoundsFolder(defaultSoundsDir()));

  // Devolve '' quando abre, ou o motivo de não ter aberto.
  ipcMain.handle('sounds:open-folder', async () => {
    try {
      fs.mkdirSync(soundsDir(), { recursive: true });
      return await shell.openPath(soundsDir());
    } catch (err) {
      return err.message;
    }
  });
}

module.exports = { register, migrateSoundsFolderName, migrateLegacySounds };
