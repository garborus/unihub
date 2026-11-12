// Configurações do app, gravadas na pasta de dados do usuário (settings.json), e o
// idioma em uso. Os outros módulos leem e mudam por `state.settings` e gravam com
// saveSettings().

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// menuPosition: cabeçalho em cima ('top') ou menu à esquerda ('left');
// menuPinned: com o menu à esquerda, fica aberto (true) ou recolhido (false);
// theme: cores do app (botão Temas).
const DEFAULT_SETTINGS = { autoStart: false, tray: false, menuPosition: 'top', menuPinned: true, theme: 'graphite', language: 'auto' };
const ALLOWED_VALUES = { menuPosition: ['top', 'left'], theme: ['light', 'dark', 'graphite', 'purple', 'lilac'], language: ['auto', 'pt', 'en', 'es'] };

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

/** Configurações em uso. Trocadas por inteiro ou campo a campo; saveSettings() grava. */
const state = { settings: DEFAULT_SETTINGS };

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(state.settings, null, 2));
  } catch { /* sem gravar: vale só até fechar o app */ }
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
const activeLanguage = () => (state.settings.language === 'auto' ? systemLanguage() : state.settings.language);

/** O que a página recebe: as configurações e o idioma que o Windows indica. */
const settingsForPage = () => ({ ...state.settings, systemLanguage: systemLanguage() });

module.exports = {
  DEFAULT_SETTINGS, ALLOWED_VALUES, state, loadSettings, saveSettings,
  systemLanguage, activeLanguage, settingsForPage,
};
