// Processo principal do Electron.
//
// Ele só cria a janela e libera o acesso WebHID (e o microfone, para o
// retorno de voz). Toda a conversa com os dispositivos acontece no renderer,
// com APIs padrão da web (WebHID, Gamepad API e Web Audio), sem módulos
// nativos. DLL própria só para o que a web não alcança; ver "Código nativo" no README.

const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, nativeImage, nativeTheme, screen, session, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const updates = require('./updates.cjs');

// Controles: o Chromium lê pelo Windows.Gaming.Input, que às vezes não entrega
// o controle (visto com um GameSir Cyclone 2 no modo Xbox e o Steam aberto),
// enquanto o XInput do Windows lê normalmente. Desligando esse leitor, o
// Chromium volta a usar o XInput e o teste de botões funciona.
app.commandLine.appendSwitch('disable-features', 'EnableWindowsGamingInputDataFetcher');

// A página do app é carregada do disco; nenhuma origem remota recebe HID.
function isAppOrigin(origin) {
  return typeof origin === 'string' && origin.startsWith('file:');
}

function isAppFrame(details) {
  return !!details && (isAppOrigin(details.origin) || isAppOrigin(details.requestingUrl));
}

function setupHidPermissions() {
  const ses = session.defaultSession;

  // Permite que navigator.hid.getDevices() devolva os dispositivos sem a
  // janela de seleção do Chromium. Só a página local do app recebe acesso.
  // HID para falar com os aparelhos; notificações para o aviso de bateria baixa;
  // microfone e escolha de saída de som para o teste e o retorno de voz do headset.
  const ALLOWED = new Set(['hid', 'notifications', 'media', 'speaker-selection']);
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    return ALLOWED.has(permission) && (isAppOrigin(requestingOrigin) || isAppFrame(details));
  });
  // Pedido de mídia: só áudio (nunca câmera), só da página do app.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const appPage = isAppOrigin(details?.requestingUrl) || isAppOrigin(wc.getURL());
    if (permission === 'media') {
      const types = details?.mediaTypes || [];
      return callback(appPage && types.length > 0 && types.every((t) => t === 'audio'));
    }
    callback(appPage && ALLOWED.has(permission));
  });
  ses.setDevicePermissionHandler((details) => {
    return details.deviceType === 'hid' && isAppFrame(details);
  });

  // requestDevice() (botão "Procurar dispositivos") escolhe o primeiro
  // dispositivo da lista filtrada. Os demais já chegam via permissão acima.
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const first = details.deviceList[0];
    callback(first ? first.deviceId : '');
  });
}

// --- Configurações do app (gravadas na pasta de dados do usuário) ----------

// menuPosition: cabeçalho em cima ('top') ou menu à esquerda ('left');
// menuPinned: com o menu à esquerda, fica aberto (true) ou recolhido (false);
// theme: cores do app (botão Temas).
const DEFAULT_SETTINGS = { autoStart: false, tray: false, menuPosition: 'top', menuPinned: true, theme: 'graphite', language: 'pt' };
const ALLOWED_VALUES = { menuPosition: ['top', 'left'], theme: ['light', 'dark', 'graphite', 'purple', 'lilac'], language: ['auto', 'pt', 'en', 'es'] };

// Cores da janela em cada tema (as mesmas do styles.css): fundo ao abrir e a
// faixa dos botões minimizar/maximizar/fechar, que o Windows desenha.
const THEME_COLORS = {
  graphite: { bg: '#14161a', bar: '#1c1f25', symbol: '#e7e9ee' },
  dark: { bg: '#050506', bar: '#0c0d0f', symbol: '#ececef' },
  light: { bg: '#dcdad4', bar: '#e7e5e0', symbol: '#1b1f27' },
  purple: { bg: '#1a1124', bar: '#23172f', symbol: '#f4ecff' },
  lilac: { bg: '#bc96ec', bar: '#c9aaf0', symbol: '#23103a' },
};
// Faixa dos botões da janela: 1 px menor que o cabeçalho (52 px), para não
// cobrir a linha de baixo dele, que assim vai até a borda direita.
const TITLE_BAR_HEIGHT = 51;
const themeColors = () => THEME_COLORS[settings.theme] || THEME_COLORS.graphite;

function applyTheme() {
  // Menus do Windows (o do ícone da bandeja) claros ou escuros, como o tema.
  nativeTheme.themeSource = settings.theme === 'light' || settings.theme === 'lilac' ? 'light' : 'dark';
  if (!mainWindow) return;
  const c = themeColors();
  mainWindow.setBackgroundColor(c.bg);
  mainWindow.setTitleBarOverlay({ color: c.bar, symbolColor: c.symbol, height: TITLE_BAR_HEIGHT });
}
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    // O tema Ameixa saiu; quem usava passa para o Roxo, o mais parecido.
    if (saved.theme === 'plum') saved.theme = 'purple';
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = DEFAULT_SETTINGS;

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch { /* sem gravar: vale só até fechar o app */ }
}
let mainWindow = null;

// --- Bandeja do sistema -------------------------------------------------------
// Com a bandeja ligada, fechar a janela só a esconde: o app continua rodando
// (e os avisos de bateria continuam chegando). Para sair, "Sair" no ícone.

let tray = null;
let quitting = false;
// Baterias dos aparelhos conectados ([{ id, label }], texto já no idioma do app),
// mostradas no menu da bandeja; clicar abre o aparelho na janela.
let trayBatteries = [];

function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Idioma do Windows, para a opção "Automático": o primeiro da lista de preferências
// que o app tem; sem nenhum deles, inglês.
const APP_LANGUAGES = ['pt', 'en', 'es'];
function systemLanguage() {
  const tags = app.getPreferredSystemLanguages?.() || [];
  for (const tag of [...tags, app.getLocale()]) {
    const id = String(tag).slice(0, 2).toLowerCase();
    if (APP_LANGUAGES.includes(id)) return id;
  }
  return 'en';
}

/** Idioma em uso: o escolhido ou, no automático, o do Windows. */
const activeLanguage = () => (settings.language === 'auto' ? systemLanguage() : settings.language);

/** O que a página recebe: as configurações e o idioma que o Windows indica. */
const settingsForPage = () => ({ ...settings, systemLanguage: systemLanguage() });

// Textos do menu da bandeja, que fica fora da página.
const TRAY_TEXT = {
  pt: { open: 'Abrir o UniHub', quit: 'Sair' },
  en: { open: 'Open UniHub', quit: 'Quit' },
  es: { open: 'Abrir UniHub', quit: 'Salir' },
};

/** Mostra a janela já no aparelho escolhido (esperando a página carregar, se preciso). */
function openDevice(id) {
  showWindow();
  const page = mainWindow?.webContents;
  if (!page) return;
  const send = () => page.send('open-device', id);
  if (page.isLoading()) page.once('did-finish-load', send);
  else send();
}

function applyTrayMenu() {
  const text = TRAY_TEXT[activeLanguage()] || TRAY_TEXT.pt;
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: text.open, click: showWindow },
    ...(trayBatteries.length ? [{ type: 'separator' }] : []),
    ...trayBatteries.map((item) => ({ label: item.label, click: () => openDevice(item.id) })),
    { type: 'separator' },
    { label: text.quit, click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyTray(enabled) {
  if (enabled && !tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
    tray.setToolTip('UniHub');
    applyTrayMenu();
    tray.on('click', showWindow);
  } else if (!enabled && tray) {
    tray.destroy();
    tray = null;
  }
}

// --- Iniciar com o Windows -----------------------------------------------------
// Entrada de inicialização do Windows. Rodando pelo código-fonte (npm start), o
// Windows precisa abrir o Electron apontando para a pasta do app.
const STARTED_HIDDEN = '--hidden';
const loginItem = () => ({
  path: process.execPath,
  args: app.isPackaged ? [STARTED_HIDDEN] : [app.getAppPath(), STARTED_HIDDEN],
});

function applyAutoStart(enabled) {
  app.setLoginItemSettings({ ...loginItem(), openAtLogin: enabled });
}

ipcMain.handle('settings:get', () => settingsForPage());
ipcMain.handle('settings:set', (_event, key, value) => {
  // Só chaves conhecidas, com o tipo certo.
  if (!(key in DEFAULT_SETTINGS) || typeof value !== typeof DEFAULT_SETTINGS[key]) return settingsForPage();
  if (ALLOWED_VALUES[key] && !ALLOWED_VALUES[key].includes(value)) return settingsForPage();
  settings = { ...settings, [key]: value };
  if (key === 'autoStart') {
    applyAutoStart(value);
    // A bandeja é uma opção de quem inicia com o Windows: desligando um, desliga o outro.
    if (!value && settings.tray) {
      settings = { ...settings, tray: false };
      applyTray(false);
    }
  }
  if (key === 'tray') applyTray(value);
  if (key === 'language') applyTrayMenu();
  if (key === 'theme') applyTheme();
  saveSettings();
  return settingsForPage();
});

// Tamanho inicial: cabem duas linhas de cartões quadrados no Início, sem rolar.
const WINDOW_WIDTH = 1100;
const WINDOW_HEIGHT = 920;
const MIN_WINDOW_WIDTH = 960;

/** Tamanho inicial, com a mesma proporção em telas que não comportam a altura toda. */
function initialWindowSize() {
  const height = Math.min(WINDOW_HEIGHT, screen.getPrimaryDisplay().workAreaSize.height);
  return { width: Math.max(MIN_WINDOW_WIDTH, Math.round(height * WINDOW_WIDTH / WINDOW_HEIGHT)), height };
}

function createWindow({ hidden = false } = {}) {
  const win = new BrowserWindow({
    show: !hidden,
    ...initialWindowSize(),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: 600,
    title: 'UniHub',
    backgroundColor: themeColors().bg,
    // Sem a barra de título do Windows: os botões minimizar/maximizar/fechar
    // ficam sobre o cabeçalho do app, à direita (mesma cor e altura dele).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: themeColors().bar, symbolColor: themeColors().symbol, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow = win;
  win.on('closed', () => { mainWindow = null; });

  // Com a bandeja ligada, o X da janela só esconde o app.
  win.on('close', (event) => {
    if (tray && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // Links externos nunca abrem dentro do app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.argv.includes('--devtools')) win.webContents.openDevTools();
}

// Atalho para as configurações de som do Windows (aba de áudio dos headsets).
// A página avisa as baterias lidas; o menu e a dica do ícone da bandeja acompanham.
ipcMain.on('tray-batteries', (_event, items) => {
  if (!Array.isArray(items)) return;
  trayBatteries = items
    .filter((t) => t && typeof t.id === 'string' && typeof t.label === 'string')
    .slice(0, 20)
    .map((t) => ({ id: t.id.slice(0, 120), label: t.label.slice(0, 80) }));
  applyTrayMenu();
  tray?.setToolTip(['UniHub', ...trayBatteries.map((t) => t.label)].join('\n').slice(0, 127));
});

ipcMain.handle('open-sound-settings', () => shell.openExternal('ms-settings:sound'));

// --- Sons (aba Sons) ------------------------------------------------------------
// Os áudios que a pessoa adiciona são copiados para a pasta dos sons, então
// continuam tocando mesmo se o arquivo original mudar de lugar. A pasta padrão é
// MúsicasUniHub (fácil de achar e fora de pastas de projeto); antes era dentro
// dos dados do app, e os sons de lá são movidos uma vez ao abrir. Pode ser outra
// pasta que a pessoa escolher; fica em settings.soundsFolder,
// que a página não muda por settings:set, só pela janela de escolher pasta.
// A página recebe o nome e os bytes de cada som e o caminho da pasta, só para mostrar.

const SOUND_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm'];
const SOUND_MAX_BYTES = 50 * 1024 * 1024;
const defaultSoundsDir = () => path.join(app.getPath('music'), 'UniHub');
const legacySoundsDir = () => path.join(app.getPath('userData'), 'sons');
const soundsDir = () => settings.soundsFolder || defaultSoundsDir();

function listSounds() {
  try {
    return fs.readdirSync(soundsDir(), { withFileTypes: true })
      .filter((e) => e.isFile() && SOUND_EXTENSIONS.includes(path.extname(e.name).slice(1).toLowerCase()))
      .map((e) => ({ id: e.name, name: path.parse(e.name).name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
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
  pt: { title: 'Escolher a pasta dos sons', ask: (n) => (n === 1 ? 'Mover o som para a nova pasta?' : `Mover os ${n} sons para a nova pasta?`), detail: 'Se deixar, eles ficam na pasta antiga e só voltam a aparecer na aba quando você escolher essa pasta de novo.', move: 'Mover', keep: 'Deixar onde estão', cancel: 'Cancelar' },
  en: { title: 'Choose the sounds folder', ask: (n) => (n === 1 ? 'Move the sound to the new folder?' : `Move the ${n} sounds to the new folder?`), detail: 'If you leave them, they stay in the old folder and only show in the tab again when you pick that folder again.', move: 'Move', keep: 'Leave them', cancel: 'Cancel' },
  es: { title: 'Elegir la carpeta de sonidos', ask: (n) => (n === 1 ? '¿Mover el sonido a la nueva carpeta?' : `¿Mover los ${n} sonidos a la nueva carpeta?`), detail: 'Si los dejas, se quedan en la carpeta anterior y solo vuelven a aparecer en la pestaña cuando elijas esa carpeta otra vez.', move: 'Mover', keep: 'Dejarlos', cancel: 'Cancelar' },
};

/**
 * Pasta para a página. `music`: o caminho dentro de Músicas (ex.: "UniHub"),
 * para mostrar curto ("Músicas › UniHub"); null se a pasta for fora de Músicas.
 */
function soundsFolderInfo() {
  const dir = soundsDir();
  const rel = path.relative(app.getPath('music'), dir);
  const inMusic = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  return { path: dir, custom: !!settings.soundsFolder, music: inMusic ? rel.split(path.sep).join(' › ') : null };
}

/**
 * Mudança única: sons da pasta antiga (dentro dos dados do app) vão para a
 * padrão nova. Copia todos primeiro e só apaga os originais se todos deram certo;
 * se algum falhar, desfaz as cópias e continua usando a pasta antiga (como
 * escolhida), para nenhum som sumir da aba. Os atalhos seguem o som renomeado.
 */
function migrateLegacySounds() {
  if (settings.soundsFolder) return;
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
    settings.soundsFolder = legacy;
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
  if (renamed.length && settings.soundHotkeys) {
    const map = { ...settings.soundHotkeys };
    for (const [a, b] of renamed) if (map[a]) { map[b] = map[a]; delete map[a]; }
    settings.soundHotkeys = map;
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
    const { response } = await dialog.showMessageBox(mainWindow, {
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
  if (sameFolder(target, defaultSoundsDir())) delete settings.soundsFolder;
  else settings.soundsFolder = path.resolve(target);
  saveSettings();
  return done({ failed });
}

ipcMain.handle('sounds:list', () => listSounds());

ipcMain.handle('sounds:add', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Adicionar sons',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Áudio', extensions: SOUND_EXTENSIONS }],
  });
  const skipped = [];
  if (!result.canceled) {
    fs.mkdirSync(soundsDir(), { recursive: true });
    for (const file of result.filePaths) {
      const ext = path.extname(file).toLowerCase();
      const size = fs.statSync(file).size;
      if (!SOUND_EXTENSIONS.includes(ext.slice(1)) || size > SOUND_MAX_BYTES) {
        skipped.push(path.basename(file));
        continue;
      }
      fs.copyFileSync(file, path.join(soundsDir(), freeName(path.parse(file).name, ext)));
    }
  }
  return { sounds: listSounds(), skipped };
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
  if (file && soundHotkeys()[id]) {
    const map = { ...soundHotkeys() };
    delete map[id];
    settings = { ...settings, soundHotkeys: map };
    applySoundHotkeys();
    saveSettings();
  }
  return listSounds();
});

// --- Efeito no microfone (aba Sons) -----------------------------------------------
// Única parte com código nativo, pela regra "Código nativo" do README: o Windows
// só deixa somar som ao microfone por dentro do serviço de áudio. A DLL e a ponte
// ficam em native/audio-mix (compiladas por compilar.cmd); quem instala é a
// pessoa, pelo pedido de administrador do Windows. Sem elas, a aba usa o cabo virtual.

const AUDIO_MIX_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'audio-mix')
  : path.join(__dirname, '..', '..', 'native', 'audio-mix');
const AUDIO_MIX_DLL = path.join(AUDIO_MIX_DIR, 'build', 'UniHubAudioMix.dll');
const AUDIO_MIX_BRIDGE = path.join(AUDIO_MIX_DIR, 'build', 'ponte.exe');
const AUDIO_MIX_CLSID = '{6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}';
const MIC_ID = /^\{[0-9a-fA-F-]{36}\}$/;
const MIC_EFFECT_MAX_SAMPLES = 48000 * 60 * 5; // 5 minutos

// Microfones ativos e se o efeito está na lista de efeitos de cada um. Só leitura.
const MIC_EFFECT_SCRIPT = [
  "$base = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture'",
  '$r = Get-ChildItem $base | Where-Object { (Get-ItemProperty $_.PSPath).DeviceState -eq 1 } | ForEach-Object {',
  '  $p = Get-ItemProperty "$($_.PSPath)\\Properties" -ErrorAction SilentlyContinue',
  '  $fx = Get-Item "$($_.PSPath)\\FxProperties" -ErrorAction SilentlyContinue',
  // Efeito de fluxo (,13: versões antigas) ou de ponta (,15: vale também nas chamadas).
  "  $l = if ($fx) { @($fx.GetValue('{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13')) -join '' } else { '' }",
  "  $e = if ($fx) { @($fx.GetValue('{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},15')) } else { @() }",
  "  [pscustomobject]@{ id = $_.PSChildName; name = $p.'{a45c254e-df1c-4efd-8020-67d146a850e0},2';",
  "    device = $p.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'; installed = ($l -like '*" + AUDIO_MIX_CLSID + "*') -or ($e -contains '" + AUDIO_MIX_CLSID + "');",
  "    calls = ($e -contains '" + AUDIO_MIX_CLSID + "') }",
  '}',
  'ConvertTo-Json @($r) -Compress',
].join('\n');

function runBridge(args, input = null) {
  return new Promise((resolve) => {
    const child = execFile(AUDIO_MIX_BRIDGE, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 16 }, (err, stdout) => {
      let result = {};
      try { result = JSON.parse(stdout.trim() || '{}'); } catch { /* sem resposta */ }
      resolve({ code: err ? err.code ?? 1 : 0, ...result });
    });
    // A ponte pode sair antes de ler tudo (ex.: fechada no "Parar"): sem isto,
    // o erro de escrita derruba o processo principal.
    child.stdin.on('error', () => {});
    if (input) child.stdin.end(input); else child.stdin.end();
    runBridge.current = input ? child : runBridge.current;
  });
}

ipcMain.handle('mic-effect:status', () => new Promise((resolve) => {
  const built = fs.existsSync(AUDIO_MIX_DLL) && fs.existsSync(AUDIO_MIX_BRIDGE);
  if (process.platform !== 'win32') return resolve({ built: false, mics: [], active: false });
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', MIC_EFFECT_SCRIPT],
    { timeout: 15_000, windowsHide: true }, async (err, stdout) => {
      let mics = [];
      try {
        const list = JSON.parse(stdout.trim() || '[]');
        mics = (Array.isArray(list) ? list : [list])
          .filter((m) => m && MIC_ID.test(m.id))
          .map((m) => ({ id: m.id, name: String(m.name || ''), device: String(m.device || ''), installed: !!m.installed, calls: !!m.calls }));
      } catch { /* sem lista */ }
      const active = built ? (await runBridge(['--estado'])).code === 0 : false;
      resolve({ built, mics, active });
    });
}));

// Só se algum app está usando o microfone com o efeito (canal aberto): rápido,
// sem a lista de microfones, para a aba conferir de tempos em tempos.
ipcMain.handle('mic-effect:active', async () => {
  if (process.platform !== 'win32' || !fs.existsSync(AUDIO_MIX_BRIDGE)) return false;
  return (await runBridge(['--estado'])).code === 0;
});

// Roda instalar.ps1 ou remover.ps1 como administrador (o Windows pede a permissão).
// Devolve { ok, message }: 1223 = a pessoa recusou o pedido de administrador.
// params: { Nome: valor } vira -Nome 'valor' (o nome sem aspas, senão vira posicional).
function runElevated(script, params) {
  const log = path.join(app.getPath('temp'), `unihub-audio-mix-${Date.now()}.log`);
  const q = (s) => String(s).replaceAll("'", "''");
  const args = Object.entries(params).map(([name, value]) => `-${name} '${q(value)}'`).join(' ');
  const inner = `try { & '${q(script)}' ${args} *> '${q(log)}' } `
    + `catch { $_ | Out-File -Encoding utf8 '${q(log)}'; exit 1 }; exit 0`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const outer = 'try { $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden '
    + `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'); exit $p.ExitCode } catch { exit 1223 }`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { windowsHide: true }, (err) => {
      const code = err ? err.code ?? 1 : 0;
      let message = '';
      try {
        // O *> do PowerShell 5 grava em UTF-16; o Out-File do catch, em UTF-8.
        const bytes = fs.readFileSync(log);
        const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
        message = bytes.toString(utf16 ? 'utf16le' : 'utf8').replace(/^﻿/, '').trim();
        fs.rmSync(log, { force: true });
      } catch { /* sem log */ }
      resolve({ ok: code === 0, cancelled: code === 1223, message: message.slice(0, 600) });
    });
  });
}

ipcMain.handle('mic-effect:install', (_event, micId) => {
  if (!MIC_ID.test(micId || '')) return { ok: false, message: 'Microfone inválido.' };
  if (!fs.existsSync(AUDIO_MIX_DLL)) return { ok: false, message: 'Efeito não compilado (native/audio-mix/compilar.cmd).' };
  return runElevated(path.join(AUDIO_MIX_DIR, 'instalar.ps1'), { Microfone: micId, Dll: AUDIO_MIX_DLL });
});

ipcMain.handle('mic-effect:remove', () => runElevated(path.join(AUDIO_MIX_DIR, 'remover.ps1'), {}));

// Som já pronto pela página: mono, float 32, 48000 Hz, no volume escolhido.
ipcMain.handle('mic-effect:play', async (_event, samples) => {
  if (!(samples instanceof Float32Array) || !samples.length || samples.length > MIC_EFFECT_MAX_SAMPLES) return { code: 2 };
  if (!fs.existsSync(AUDIO_MIX_BRIDGE)) return { code: 2 };
  runBridge.current?.kill();
  return runBridge([], Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
});

ipcMain.handle('mic-effect:stop', () => {
  runBridge.current?.kill();
  runBridge.current = null;
});

// --- Atualizações (versões 0.x portáteis) ------------------------------------------
// Ver updates.cjs. O exe portátil do electron-builder informa o próprio caminho em
// PORTABLE_EXECUTABLE_FILE; sem ele (rodando pelo código), só abre a página da release.

const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || '';
let downloadedUpdate = null; // { version, file }

ipcMain.handle('update:check', async () => {
  const current = app.getVersion();
  try {
    const res = await fetch(`https://api.github.com/repos/${updates.REPO}/releases?per_page=20`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'UniHub-updater' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { current, error: `GitHub respondeu ${res.status}` };
    const latest = updates.pickLatest(await res.json());
    const newer = !!latest && updates.compareVersions(latest.version, current) > 0;
    return {
      current, latest, newer,
      canInstall: newer && !!latest.asset && !!portableExe(),
      downloaded: downloadedUpdate?.version === latest?.version,
    };
  } catch (err) {
    return { current, error: err.name === 'TimeoutError' ? 'sem resposta do GitHub' : 'sem conexão com o GitHub' };
  }
});

// Baixa o exe novo para a pasta do exe atual, conferindo tamanho e SHA-256.
ipcMain.handle('update:download', async (event) => {
  const exe = portableExe();
  if (!exe) return { ok: false, message: 'Só a versão portátil se atualiza sozinha.' };
  const res = await fetch(`https://api.github.com/repos/${updates.REPO}/releases?per_page=20`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'UniHub-updater' },
  }).catch(() => null);
  const latest = res?.ok ? updates.pickLatest(await res.json()) : null;
  if (!latest?.asset || updates.compareVersions(latest.version, app.getVersion()) <= 0) {
    return { ok: false, message: 'Nenhuma versão nova para baixar.' };
  }
  const target = path.join(path.dirname(exe), latest.asset.name);
  if (path.resolve(target).toLowerCase() === path.resolve(exe).toLowerCase()) {
    return { ok: false, message: 'O arquivo novo tem o mesmo nome do atual.' };
  }
  const part = `${target}.download`;
  try {
    const file = await fetch(latest.asset.url, { headers: { 'User-Agent': 'UniHub-updater' } });
    if (!file.ok || !file.body) throw new Error(`download respondeu ${file.status}`);
    const total = Number(file.headers.get('content-length')) || latest.asset.size || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let received = 0;
    let lastSent = 0;
    for await (const chunk of file.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - lastSent > 150) {
        lastSent = Date.now();
        event.sender.send('update:progress', { received, total });
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (latest.asset.size && received !== latest.asset.size) throw new Error('arquivo incompleto');
    const digest = hash.digest('hex');
    if (latest.asset.sha256 && digest !== latest.asset.sha256) throw new Error('o arquivo baixado não confere (SHA-256)');
    fs.renameSync(part, target);
    downloadedUpdate = { version: latest.version, file: target };
    return { ok: true, version: latest.version, verified: !!latest.asset.sha256 };
  } catch (err) {
    fs.rmSync(part, { force: true });
    return { ok: false, message: `Não foi possível baixar: ${err.message}.` };
  }
});

// Fecha o app; um script espera ele sair, apaga o exe antigo e abre o novo.
ipcMain.handle('update:install', () => {
  const exe = portableExe();
  if (!exe || !downloadedUpdate || !fs.existsSync(downloadedUpdate.file)) return { ok: false };
  const script = path.join(app.getPath('temp'), `unihub-atualizar-${Date.now()}.cmd`);
  fs.writeFileSync(script, updates.swapScript(exe, downloadedUpdate.file), 'utf8'); // o script troca o console para UTF-8
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  quitting = true;
  app.quit();
  return { ok: true };
});

ipcMain.handle('update:open-page', (_event, url) => {
  // Só páginas de release deste repositório.
  if (typeof url === 'string' && url.startsWith(`https://github.com/${updates.REPO}/releases`)) shell.openExternal(url);
});

// --- Atalhos dos sons ----------------------------------------------------------
// Cada som pode ter um atalho global (ex.: "Ctrl+Shift+1", "F9", "num5"), que
// funciona com o UniHub em segundo plano, inclusive dentro de jogos. Ficam em
// settings.soundHotkeys ({ id do som: atalho }). Quando o atalho é apertado, a
// página recebe 'sounds:hotkey' com o id e toca o som.

const registeredHotkeys = new Set();

function soundHotkeys() {
  const map = settings.soundHotkeys;
  return map && typeof map === 'object' ? map : {};
}

/** Registra de novo todos os atalhos; devolve os que o Windows recusou (outro app já usa). */
function applySoundHotkeys() {
  for (const acc of registeredHotkeys) globalShortcut.unregister(acc);
  registeredHotkeys.clear();
  const failed = [];
  for (const [id, acc] of Object.entries(soundHotkeys())) {
    try {
      if (globalShortcut.register(acc, () => mainWindow?.webContents.send('sounds:hotkey', id))) registeredHotkeys.add(acc);
      else failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return failed;
}

const hotkeysForPage = (extra = {}) => ({ hotkeys: soundHotkeys(), ...extra });

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
  settings = { ...settings, soundHotkeys: map };
  const failed = applySoundHotkeys();
  if (accelerator !== null && failed.includes(id)) {
    // O Windows não deixou (outro app já usa esse atalho): não guarda.
    delete map[id];
    settings = { ...settings, soundHotkeys: map };
    applySoundHotkeys();
    saveSettings();
    return hotkeysForPage({ error: 'em uso' });
  }
  saveSettings();
  return hotkeysForPage();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

ipcMain.handle('sounds:folder', () => soundsFolderInfo());

ipcMain.handle('sounds:choose-folder', async () => {
  const text = FOLDER_TEXT[activeLanguage()] || FOLDER_TEXT.pt;
  const result = await dialog.showOpenDialog(mainWindow, {
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

// Bateria de fones Bluetooth: o Windows guarda o valor que o fone manda pelo
// perfil de chamada (Hands-Free) numa propriedade do aparelho, mas não a passa
// para páginas web. Uma consulta CIM pelo PowerShell (que já vem no Windows)
// lê essa propriedade; sem módulo nativo. Aparelhos só pareados (desligados)
// também aparecem, com o último valor: quem chama decide quais estão conectados.
const BT_BATTERY_KEY = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2';
const BT_BATTERY_SCRIPT = [
  "$k = '" + BT_BATTERY_KEY + "'",
  // 0000111E = perfil Hands-Free; no WQL a barra invertida vai dobrada.
  "$r = Get-CimInstance Win32_PnPEntity -Filter \"PNPDeviceID LIKE 'BTHENUM\\\\{0000111E%'\" | ForEach-Object {",
  '  $p = (Invoke-CimMethod -InputObject $_ -MethodName GetDeviceProperties -Arguments @{ devicePropertyKeys = @($k) }).deviceProperties',
  '  $b = ($p | Where-Object KeyName -eq $k).Data',
  '  if ($null -ne $b) { [pscustomobject]@{ name = $_.Name; percent = [int]$b } }',
  '}',
  'ConvertTo-Json @($r) -Compress',
].join('\n');

// Versão de um aparelho USB (ex.: dongle de headset): o Windows guarda o
// bcdDevice no ID do aparelho, como "USB\VID_291D&PID_385D&REV_0012".
// VID e PID chegam como números e são validados antes de entrar no comando.
ipcMain.handle('usb-revision', (_event, vendorId, productId) => new Promise((resolve) => {
  const valid = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffff;
  if (process.platform !== 'win32' || !valid(vendorId) || !valid(productId)) return resolve(null);
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  const id = `VID_${hex(vendorId)}&PID_${hex(productId)}`;
  const script = `(Get-CimInstance Win32_PnPEntity -Filter "PNPDeviceID LIKE 'USB\\\\${id}%'").HardwareID -join ';'`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      const rev = !err && new RegExp(`${id}&REV_([0-9A-F]{4})`, 'i').exec(stdout);
      resolve(rev ? rev[1].toUpperCase() : null);
    });
}));

// Teclados que o Windows conhece. O WebHID não mostra teclado de notebook
// (PS/2 ou interno) e não diz se um teclado é Bluetooth; o ID do Windows diz
// (ACPI\…, HID\{00001124…} ou {00001812…} = Bluetooth, HID\VID_… = USB). Só dos
// Bluetooth sobe o caminho (pai, avô…), onde está o nome do aparelho: subir o
// de todos levava segundos. Quem chama decide o que fazer com cada um.
const KEYBOARDS_SCRIPT = [
  "$r = Get-CimInstance Win32_PnPEntity -Filter \"PNPClass='Keyboard'\" | ForEach-Object {",
  '  $chain = @()',
  "  if ($_.PNPDeviceID -match '\\{0000(1124|1812)-') {",
  '    $id = $_.PNPDeviceID',
  '    for ($i = 0; $i -lt 3; $i++) {',
  '      $p = (Get-PnpDeviceProperty -InstanceId $id -KeyName DEVPKEY_Device_Parent -ErrorAction SilentlyContinue).Data',
  '      if (-not $p) { break }',
  '      $d = Get-PnpDevice -InstanceId $p -ErrorAction SilentlyContinue',
  '      $chain += [pscustomobject]@{ id = $p; name = $d.FriendlyName }',
  '      $id = $p',
  '    }',
  '  }',
  '  [pscustomobject]@{ id = $_.PNPDeviceID; name = $_.Name; chain = $chain }',
  '}',
  'ConvertTo-Json @($r) -Depth 4 -Compress',
].join('\n');

ipcMain.handle('system-keyboards', () => new Promise((resolve) => {
  if (process.platform !== 'win32') return resolve([]);
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', KEYBOARDS_SCRIPT],
    { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const list = JSON.parse(stdout.trim() || '[]');
        resolve((Array.isArray(list) ? list : [list]).filter((d) => d && typeof d.id === 'string')
          .map((d) => ({ id: d.id, name: d.name || '', chain: (Array.isArray(d.chain) ? d.chain : d.chain ? [d.chain] : []).map((c) => ({ id: String(c.id || ''), name: c.name || '' })) })));
      } catch {
        resolve([]);
      }
    });
}));

ipcMain.handle('bluetooth-batteries', () => new Promise((resolve) => {
  if (process.platform !== 'win32') return resolve([]);
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', BT_BATTERY_SCRIPT],
    { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const list = JSON.parse(stdout.trim() || '[]');
        resolve((Array.isArray(list) ? list : [list]).filter((d) => d && typeof d.name === 'string'));
      } catch {
        resolve([]);
      }
    });
}));

app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  settings = loadSettings();
  applyTheme(); // menus do Windows já na cor do tema
  for (const [key, values] of Object.entries(ALLOWED_VALUES)) {
    if (!values.includes(settings[key])) settings[key] = DEFAULT_SETTINGS[key];
  }
  // O Windows é a fonte da verdade: a entrada pode ter sido removida por fora.
  settings.autoStart = app.getLoginItemSettings(loginItem()).openAtLogin;
  if (!settings.autoStart) settings.tray = false;
  setupHidPermissions();
  migrateLegacySounds(); // antes da janela: a aba já lê a pasta nova
  // Aberto pelo Windows ao ligar o PC, com a bandeja ligada: começa só na bandeja.
  createWindow({ hidden: process.argv.includes(STARTED_HIDDEN) && settings.tray });
  applyTray(settings.tray);
  applySoundHotkeys();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Com a bandeja ligada o app continua rodando sem janela.
  if (process.platform !== 'darwin' && !tray) app.quit();
});
