// Aparelhos de som do Windows: saídas e microfones, padrão, volume e mudo
// (saidas.exe, ver native/audio-mix/saidas). Só muda algo quando a pessoa escolhe
// na aba Headsets.

const { ipcMain, shell } = require('electron');
const { runSoundTool } = require('./native-tools.cjs');

const DEVICE_ID = /^\{0\.0\.[01]\.[0-9a-f]{8}\}\.\{[0-9a-f-]{36}\}$/i; // 0 = saída, 1 = microfone

const cleanDevices = (list) => (Array.isArray(list) ? list : [])
  .filter((d) => d && DEVICE_ID.test(d.id))
  .map((d) => ({
    id: d.id, name: String(d.name || ''), default: !!d.default, comm: !!d.comm,
    volume: Number.isInteger(d.volume) && d.volume >= 0 ? d.volume : null, mute: !!d.mute,
  }));

const toolResult = (result) => (result?.ok ? { ok: true } : { ok: false, error: result?.erro || 'sem resposta' });

function register() {
  // { outputs: [{ id, name, default, comm, volume, mute }], inputs: [...] } ou null.
  ipcMain.handle('audio:devices', async () => {
    const result = await runSoundTool(['--listar']);
    return result ? { outputs: cleanDevices(result.saidas), inputs: cleanDevices(result.microfones) } : null;
  });

  // roles: 'todos' (padrão e chamadas), 'normal' ou 'chamadas'.
  ipcMain.handle('audio:set-default', async (_event, id, roles = 'todos') => {
    if (typeof id !== 'string' || !DEVICE_ID.test(id) || !['todos', 'normal', 'chamadas'].includes(roles)) return { ok: false, error: 'pedido inválido' };
    return toolResult(await runSoundTool(['--padrao', id, roles]));
  });

  ipcMain.handle('audio:set-volume', async (_event, id, volume) => {
    if (typeof id !== 'string' || !DEVICE_ID.test(id) || !Number.isFinite(volume)) return { ok: false, error: 'pedido inválido' };
    return toolResult(await runSoundTool(['--volume', id, String(Math.round(Math.min(100, Math.max(0, volume))))]));
  });

  ipcMain.handle('audio:set-mute', async (_event, id, mute) => {
    if (typeof id !== 'string' || !DEVICE_ID.test(id)) return { ok: false, error: 'pedido inválido' };
    return toolResult(await runSoundTool(['--mudo', id, mute ? '1' : '0']));
  });

  // Atalho para as configurações de som do Windows (aba de áudio dos headsets).
  ipcMain.handle('open-sound-settings', () => shell.openExternal('ms-settings:sound'));
}

module.exports = { register };
