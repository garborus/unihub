// Efeito no microfone (aba Sons).
//
// Única parte com código nativo, pela regra "Código nativo" do README: o Windows
// só deixa somar som ao microfone por dentro do serviço de áudio. A DLL e a ponte
// ficam em native/audio-mix (compiladas por compilar.cmd); quem instala é a
// pessoa, pelo pedido de administrador do Windows. Sem elas, a aba usa o cabo virtual.

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { POWERSHELL, runPowerShell, jsonList } = require('./powershell.cjs');
const { AUDIO_MIX_DIR, runSoundTool } = require('./native-tools.cjs');

const AUDIO_MIX_DLL = path.join(AUDIO_MIX_DIR, 'build', 'UniHubAudioMix.dll');
// Onde o instalar.ps1 põe a DLL. O versao.txt (um número) diz a versão do efeito:
// o que veio no app e o que está instalado; sem o arquivo, é a versão 1.
// Pasta de programas do Windows, como no instalar.ps1 (o Windows pode não estar no C:).
const AUDIO_MIX_INSTALLED_DIR = path.join(process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files', 'UniHub', 'audio-mix');
function effectVersion(dir) {
  try {
    return parseInt(fs.readFileSync(path.join(dir, 'versao.txt'), 'utf8'), 10) || 1;
  } catch {
    return 1;
  }
}
const AUDIO_MIX_BRIDGE = path.join(AUDIO_MIX_DIR, 'build', 'ponte.exe');
const AUDIO_MIX_CLSID = '{6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}';
const MIC_ID = /^\{[0-9a-fA-F-]{36}\}$/;
const MIC_EFFECT_MAX_SAMPLES = 48000 * 60 * 5; // 5 minutos

// Microfones ativos e se o efeito está na lista de efeitos de cada um. Só leitura.
// Reserva para quando o programa nativo (saidas.exe --microfones) não existe: é
// bem mais lento, porque abre o PowerShell.
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
  "    calls = ($e -contains '" + AUDIO_MIX_CLSID + "');",
  // Quem criou o aparelho (BTHHFENUM, USB…): no Bluetooth o Windows não roda efeitos.
  "    bus = $p.'{a45c254e-df1c-4efd-8020-67d146a850e0},24';",
  // "Melhorias de áudio" desligadas neste microfone: aí o Windows não roda nenhum efeito.
  "    sysfxOff = ($fx -and $fx.GetValue('{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5') -eq 1) }",
  '}',
  'ConvertTo-Json @($r) -Compress',
].join('\n');

/**
 * Microfones ativos do Windows e o estado do efeito em cada um.
 * @returns {Promise<{ list: object[], arm64: boolean, failed: boolean }>}
 *   failed: a lista não pôde ser lida (diferente de "nenhum microfone")
 */
async function readMics() {
  // Programa nativo: responde em décimos de segundo e não depende do PowerShell.
  const native = await runSoundTool(['--microfones']);
  if (native && Array.isArray(native.microfones)) return { list: native.microfones, arm64: !!native.arm64, failed: false };
  // 30 s: no notebook, o PowerShell abrindo junto com o app pode passar de 15 s.
  const { err, stdout } = await runPowerShell(MIC_EFFECT_SCRIPT, 30_000);
  try {
    return { list: jsonList(stdout), arm64: false, failed: !!err };
  } catch {
    return { list: [], arm64: false, failed: true };
  }
}

// input: som a tocar. Com som, a entrada da ponte fica aberta até ela terminar,
// para o volume novo chegar com o som tocando (runBridge.current é quem toca agora).
function runBridge(args, input = null) {
  return new Promise((resolve) => {
    const child = execFile(AUDIO_MIX_BRIDGE, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 16 }, (err, stdout) => {
      if (runBridge.current === child) runBridge.current = null;
      let result = {};
      try { result = JSON.parse(stdout.trim() || '{}'); } catch { /* sem resposta */ }
      resolve({ code: err ? err.code ?? 1 : 0, ...result });
    });
    // A ponte pode sair antes de ler tudo (ex.: fechada no "Parar"): sem isto,
    // o erro de escrita derruba o processo principal.
    child.stdin.on('error', () => {});
    if (input) {
      child.stdin.write(input);
      runBridge.current = child;
    } else {
      child.stdin.end();
    }
  });
}

// Volume como a ponte recebe: de 0 a 1 (fora disso ou inválido, volume cheio).
const bridgeVolume = (volume) => (Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1);

// Roda instalar.ps1 ou remover.ps1 como administrador (o Windows pede a permissão).
// Devolve { ok, cancelled, message }: 1223 = a pessoa recusou o pedido de administrador.
// params: { Nome: valor } vira -Nome 'valor' (o nome sem aspas, senão vira posicional).
async function runElevated(script, params) {
  const log = path.join(app.getPath('temp'), `unihub-audio-mix-${Date.now()}.log`);
  const q = (text) => String(text).replaceAll("'", "''");
  const args = Object.entries(params).map(([name, value]) => `-${name} '${q(value)}'`).join(' ');
  const inner = `try { & '${q(script)}' ${args} *> '${q(log)}' } `
    + `catch { $_ | Out-File -Encoding utf8 '${q(log)}'; exit 1 }; exit 0`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  // Caminho completo do PowerShell: quem ganha administrador é o do Windows, sempre.
  const outer = `try { $p = Start-Process '${q(POWERSHELL)}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden `
    + `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'); exit $p.ExitCode } catch { exit 1223 }`;
  const { err } = await runPowerShell(outer);
  const code = err ? err.code ?? 1 : 0;
  let message = '';
  try {
    // O *> do PowerShell 5 grava em UTF-16; o Out-File do catch, em UTF-8.
    const bytes = fs.readFileSync(log);
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
    message = bytes.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '').trim();
    fs.rmSync(log, { force: true });
  } catch { /* sem log */ }
  return { ok: code === 0, cancelled: code === 1223, message: message.slice(0, 600) };
}

function register() {
  ipcMain.handle('mic-effect:status', async () => {
    const built = fs.existsSync(AUDIO_MIX_DLL) && fs.existsSync(AUDIO_MIX_BRIDGE);
    if (process.platform !== 'win32') return { built: false, mics: [], active: false };
    const { list, arm64, failed } = await readMics();
    const mics = list
      .filter((m) => m && MIC_ID.test(m.id))
      .map((m) => ({
        id: m.id, name: String(m.name || ''), device: String(m.device || ''),
        installed: !!m.installed, calls: !!m.calls, bluetooth: /^BTH/i.test(String(m.bus || '')),
        // As "melhorias de áudio" do Windows estão desligadas: o efeito não roda.
        enhancementsOff: !!m.sysfxOff,
      }));
    const active = built ? (await runBridge(['--estado'])).code === 0 : false;
    // outdated: o efeito instalado é de uma versão mais antiga que a deste app.
    const outdated = mics.some((m) => m.installed) && effectVersion(AUDIO_MIX_DIR) > effectVersion(AUDIO_MIX_INSTALLED_DIR);
    // arm64: Windows em ARM64, onde o serviço de áudio não carrega a DLL x64 do efeito.
    return { built, mics, active, outdated, arm64, failed: failed && mics.length === 0 };
  });

  // Só se algum app está usando o microfone com o efeito (canal aberto): rápido,
  // sem a lista de microfones, para a aba conferir de tempos em tempos.
  ipcMain.handle('mic-effect:active', async () => {
    if (process.platform !== 'win32' || !fs.existsSync(AUDIO_MIX_BRIDGE)) return false;
    return (await runBridge(['--estado'])).code === 0;
  });

  ipcMain.handle('mic-effect:install', (_event, micId) => {
    if (!MIC_ID.test(micId || '')) return { ok: false, message: 'Microfone inválido.' };
    if (!fs.existsSync(AUDIO_MIX_DLL)) return { ok: false, message: 'Efeito não compilado (native/audio-mix/compilar.cmd).' };
    return runElevated(path.join(AUDIO_MIX_DIR, 'instalar.ps1'), { Microfone: micId, Dll: AUDIO_MIX_DLL });
  });

  ipcMain.handle('mic-effect:remove', () => runElevated(path.join(AUDIO_MIX_DIR, 'remover.ps1'), {}));

  // Som já pronto pela página: mono, float 32, 48000 Hz, no volume cheio. Quem aplica
  // o volume (0 a 1) é a ponte, para ele poder mudar com o som tocando.
  // Entrada da ponte no modo ao vivo: número de amostras (uint32) e as amostras.
  ipcMain.handle('mic-effect:play', async (_event, samples, volume) => {
    if (!(samples instanceof Float32Array) || !samples.length || samples.length > MIC_EFFECT_MAX_SAMPLES) return { code: 2 };
    if (!fs.existsSync(AUDIO_MIX_BRIDGE)) return { code: 2 };
    runBridge.current?.kill();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(samples.length);
    const input = Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
    return runBridge(['--ao-vivo', String(bridgeVolume(volume))], input);
  });

  // Volume novo para o som que está tocando no microfone (um float de 32 bits).
  ipcMain.handle('mic-effect:volume', (_event, volume) => {
    const stdin = runBridge.current?.stdin;
    if (!stdin?.writable) return;
    const data = Buffer.alloc(4);
    data.writeFloatLE(bridgeVolume(volume));
    stdin.write(data);
  });

  ipcMain.handle('mic-effect:stop', () => {
    runBridge.current?.kill();
    runBridge.current = null;
  });
}

module.exports = { register };
