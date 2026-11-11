// Processo principal do Electron.
//
// Ele só cria a janela e libera o acesso WebHID (e o microfone, para o
// retorno de voz). Toda a conversa com os dispositivos acontece no renderer,
// com APIs padrão da web (WebHID, Gamepad API e Web Audio), sem módulos
// nativos. DLL própria só para o que a web não alcança; ver "Código nativo" no README.

const { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, screen, ipcMain } = require('electron');
const path = require('node:path');
const { setupHidPermissions } = require('./permissions.cjs');
const { DEFAULT_SETTINGS, ALLOWED_VALUES, state, loadSettings, saveSettings, activeLanguage, settingsForPage } = require('./settings-store.cjs');
const sounds = require('./sounds.cjs');
const soundHotkeys = require('./sound-hotkeys.cjs');
const micEffect = require('./mic-effect.cjs');
const audioDevices = require('./audio-devices.cjs');
const appUpdates = require('./app-updates.cjs');
const systemInfo = require('./system-info.cjs');

// Controles: o Chromium lê pelo Windows.Gaming.Input, que às vezes não entrega
// o controle (visto com um GameSir Cyclone 2 no modo Xbox e o Steam aberto),
// enquanto o XInput do Windows lê normalmente. Desligando esse leitor, o
// Chromium volta a usar o XInput e o teste de botões funciona.
app.commandLine.appendSwitch('disable-features', 'EnableWindowsGamingInputDataFetcher');

// O app se chamava UniHub. As configurações continuam na mesma pasta do AppData
// (%APPDATA%\UniHub), para ninguém perder tema, abas, atalhos e sons ao atualizar.
app.setPath('userData', path.join(app.getPath('appData'), 'UniHub'));
// --- Tema da janela -----------------------------------------------------------

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
const themeColors = () => THEME_COLORS[state.settings.theme] || THEME_COLORS.graphite;

function applyTheme() {
  // Menus do Windows (o do ícone da bandeja) claros ou escuros, como o tema.
  nativeTheme.themeSource = state.settings.theme === 'light' || state.settings.theme === 'lilac' ? 'light' : 'dark';
  if (!mainWindow) return;
  const c = themeColors();
  mainWindow.setBackgroundColor(c.bg);
  mainWindow.setTitleBarOverlay({ color: c.bar, symbolColor: c.symbol, height: TITLE_BAR_HEIGHT });
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

// Textos do menu da bandeja, que fica fora da página.
const TRAY_TEXT = {
  pt: { open: 'Abrir o UnusHub', quit: 'Sair' },
  en: { open: 'Open UnusHub', quit: 'Quit' },
  es: { open: 'Abrir UnusHub', quit: 'Salir' },
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
    tray.setToolTip('UnusHub');
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
  state.settings = { ...state.settings, [key]: value };
  if (key === 'autoStart') {
    applyAutoStart(value);
    // A bandeja é uma opção de quem inicia com o Windows: desligando um, desliga o outro.
    if (!value && state.settings.tray) {
      state.settings = { ...state.settings, tray: false };
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
    title: 'UnusHub',
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

// A página avisa as baterias lidas; o menu e a dica do ícone da bandeja acompanham.
ipcMain.on('tray-batteries', (_event, items) => {
  if (!Array.isArray(items)) return;
  trayBatteries = items
    .filter((t) => t && typeof t.id === 'string' && typeof t.label === 'string')
    .slice(0, 20)
    .map((t) => ({ id: t.id.slice(0, 120), label: t.label.slice(0, 80) }));
  applyTrayMenu();
  tray?.setToolTip(['UnusHub', ...trayBatteries.map((t) => t.label)].join('\n').slice(0, 127));
});

// --- Módulos (cada um registra os próprios pedidos da página) -----------------

const getWindow = () => mainWindow;
sounds.register({ getWindow });
soundHotkeys.register({ getWindow });
micEffect.register();
audioDevices.register();
systemInfo.register();
appUpdates.register({ markQuitting: () => { quitting = true; } });

app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  state.settings = loadSettings();
  applyTheme(); // menus do Windows já na cor do tema
  for (const [key, values] of Object.entries(ALLOWED_VALUES)) {
    if (!values.includes(state.settings[key])) state.settings[key] = DEFAULT_SETTINGS[key];
  }
  // O Windows é a fonte da verdade: a entrada pode ter sido removida por fora.
  state.settings.autoStart = app.getLoginItemSettings(loginItem()).openAtLogin;
  if (!state.settings.autoStart) state.settings.tray = false;
  setupHidPermissions();
  sounds.migrateSoundsFolderName();
  sounds.migrateLegacySounds(); // antes da janela: a aba já lê a pasta nova
  // Aberto pelo Windows ao ligar o PC, com a bandeja ligada: começa só na bandeja.
  createWindow({ hidden: process.argv.includes(STARTED_HIDDEN) && state.settings.tray });
  applyTray(state.settings.tray);
  soundHotkeys.applySoundHotkeys();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Com a bandeja ligada o app continua rodando sem janela.
  if (process.platform !== 'darwin' && !tray) app.quit();
});
