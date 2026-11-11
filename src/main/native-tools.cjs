// Programas nativos do app (native/audio-mix): onde ficam e como chamar o de som.

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Dentro dos recursos do app instalado, ou na pasta do projeto rodando pelo código.
const AUDIO_MIX_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'audio-mix')
  : path.join(__dirname, '..', '..', 'native', 'audio-mix');

// saidas.exe (native/audio-mix/saidas): aparelhos de som do Windows e o estado do
// efeito em cada microfone. Responde em JSON (UTF-8).
const SOUND_TOOL = path.join(AUDIO_MIX_DIR, 'build', 'saidas.exe');

/** Roda o saidas.exe; devolve o JSON da resposta, ou null (sem o programa, fora do Windows, erro). */
function runSoundTool(args) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !fs.existsSync(SOUND_TOOL)) return resolve(null);
    execFile(SOUND_TOOL, args, { windowsHide: true, encoding: 'utf8', timeout: 10_000 }, (_err, stdout) => {
      try { resolve(JSON.parse(stdout.trim())); } catch { resolve(null); }
    });
  });
}

module.exports = { AUDIO_MIX_DIR, runSoundTool };
