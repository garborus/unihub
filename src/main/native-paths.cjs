// Onde ficam os programas nativos (native/audio-mix): dentro dos recursos do app
// instalado, ou na pasta do projeto rodando pelo código.

const { app } = require('electron');
const path = require('node:path');

const AUDIO_MIX_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'audio-mix')
  : path.join(__dirname, '..', '..', 'native', 'audio-mix');

module.exports = { AUDIO_MIX_DIR };
