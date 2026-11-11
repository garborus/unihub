// O que só o Windows sabe dos aparelhos, lido pelo PowerShell (que já vem no
// Windows), sem módulo nativo: bateria de fones Bluetooth, versão de aparelhos USB e
// a lista de teclados.

const { ipcMain } = require('electron');
const { runPowerShell, jsonList } = require('./powershell.cjs');

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

function register() {
  // Versão de um aparelho USB (ex.: dongle de headset): o Windows guarda o
  // bcdDevice no ID do aparelho, como "USB\VID_291D&PID_385D&REV_0012".
  // VID e PID chegam como números e são validados antes de entrar no comando.
  ipcMain.handle('usb-revision', async (_event, vendorId, productId) => {
    const valid = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffff;
    if (process.platform !== 'win32' || !valid(vendorId) || !valid(productId)) return null;
    const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
    const id = `VID_${hex(vendorId)}&PID_${hex(productId)}`;
    const script = `(Get-CimInstance Win32_PnPEntity -Filter "PNPDeviceID LIKE 'USB\\\\${id}%'").HardwareID -join ';'`;
    const { err, stdout } = await runPowerShell(script, 10_000);
    const rev = !err && new RegExp(`${id}&REV_([0-9A-F]{4})`, 'i').exec(stdout);
    return rev ? rev[1].toUpperCase() : null;
  });

  ipcMain.handle('system-keyboards', async () => {
    const chainOf = (d) => (Array.isArray(d.chain) ? d.chain : d.chain ? [d.chain] : [])
      .map((c) => ({ id: String(c.id || ''), name: c.name || '' }));
    return (await windowsList(KEYBOARDS_SCRIPT, 15_000))
      .filter((d) => d && typeof d.id === 'string')
      .map((d) => ({ id: d.id, name: d.name || '', chain: chainOf(d) }));
  });

  ipcMain.handle('bluetooth-batteries', async () => (await windowsList(BT_BATTERY_SCRIPT, 10_000))
    .filter((d) => d && typeof d.name === 'string'));
}

/** Lista devolvida por um script do PowerShell; vazia fora do Windows ou se falhar. */
async function windowsList(script, timeout) {
  if (process.platform !== 'win32') return [];
  const { err, stdout } = await runPowerShell(script, timeout);
  if (err) return [];
  try {
    return jsonList(stdout);
  } catch {
    return [];
  }
}

module.exports = { register };
