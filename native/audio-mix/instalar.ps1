# Instala o efeito de áudio do UniHub em um microfone. Precisa de administrador
# (o UniHub abre este script pelo pedido de permissão do Windows).
#
# Na ordem:
#  1. Copia a DLL para C:\Program Files\UniHub\audio-mix.
#  2. Registra a DLL como componente COM e como efeito de áudio do Windows.
#  3. Guarda a lista atual de efeitos de ponta do microfone num backup (só na primeira vez).
#  4. Acrescenta o efeito no fim dessa lista (os que já estão lá continuam). O efeito de
#     ponta é o primeiro da cadeia e vale para todos os apps e modos do microfone,
#     inclusive o "bruto" que apps de chamada como o Discord usam e que pula os
#     efeitos de fluxo.
#  5. Desfaz o que versões antigas faziam na lista de efeitos de fluxo.
#  6. Reinicia o serviço de áudio do Windows (o som de todos os apps para por uns segundos).
#
# Para desfazer: remover.ps1.

param(
  [Parameter(Mandatory = $true)] [string]$Microfone,  # ID do endpoint de captura, ex.: {9a923b6a-...}
  [string]$Dll = (Join-Path $PSScriptRoot 'build\UniHubAudioMix.dll')
)

$ErrorActionPreference = 'Stop'
$clsid = '{6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}'
$pasta = 'C:\Program Files\UniHub\audio-mix'
$destino = Join-Path $pasta 'UniHubAudioMix.dll'
$base = "SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture\$Microfone"
$efx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},15'   # lista de efeitos de ponta (todos os modos)
$backupEfx = Join-Path $pasta ("backup-efx-" + $Microfone.Trim('{}') + ".json")
$sfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13'   # lista de efeitos de fluxo (versões antigas)
$modos = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},5'   # modos dos efeitos de fluxo (versões antigas)
$backupModos = Join-Path $pasta ("backup-modos-" + $Microfone.Trim('{}') + ".json")

if ($Microfone -notmatch '^\{[0-9a-fA-F-]{36}\}$') { throw "Microfone inválido: $Microfone" }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Rode este script como administrador.' }
if (-not (Test-Path $Dll)) { throw "DLL não encontrada em $Dll. Rode compilar.cmd antes." }
if (-not (Test-Path "HKLM:\$base\FxProperties")) { throw "Microfone $Microfone não encontrado." }

# 1. DLL. Se o serviço de áudio já carregou uma versão anterior, ela está em uso:
#    para o serviço antes de copiar (ele volta no passo 5).
New-Item -ItemType Directory -Force $pasta | Out-Null
try { Copy-Item $Dll $destino -Force -ErrorAction Stop }
catch {
  Stop-Service -Name Audiosrv -Force
  Start-Sleep -Seconds 1
  Copy-Item $Dll $destino -Force
}

# Versão do efeito instalado (versao.txt, um número que sobe quando a DLL muda):
# o app compara com a que veio nele e oferece "Atualizar efeito". Sem o arquivo
# (instalações antigas), vale como versão 1.
$versao = Join-Path $PSScriptRoot 'versao.txt'
if (Test-Path $versao) { Copy-Item $versao (Join-Path $pasta 'versao.txt') -Force }

# Registro de diagnóstico, com escrita liberada para o Serviço Local (S-1-5-19),
# que é quem roda a DLL dentro do serviço de áudio. Fica desligado: só registra se
# existir o arquivo log-ligado nesta pasta. O registro antigo é apagado.
$diag = 'C:\ProgramData\UniHub'
New-Item -ItemType Directory -Force $diag | Out-Null
icacls $diag /grant '*S-1-5-19:(OI)(CI)M' | Out-Null
Remove-Item (Join-Path $diag 'audio-mix.log') -Force -ErrorAction SilentlyContinue

# 2. Registro COM e de efeito de áudio
$com = "HKLM:\SOFTWARE\Classes\CLSID\$clsid"
New-Item -Force "$com\InprocServer32" | Out-Null
Set-ItemProperty $com '(default)' 'UniHub Audio Mix'
Set-ItemProperty "$com\InprocServer32" '(default)' $destino
Set-ItemProperty "$com\InprocServer32" 'ThreadingModel' 'Both'

$apo = "HKLM:\SOFTWARE\Classes\AudioEngine\AudioProcessingObjects\$clsid"
New-Item -Force $apo | Out-Null
$valores = [ordered]@{
  FriendlyName = 'UniHub Audio Mix'; Copyright = 'UniHub (MIT)'
  MajorVersion = 1; MinorVersion = 0; Flags = 0xF
  MinInputConnections = 1; MaxInputConnections = 1; MinOutputConnections = 1; MaxOutputConnections = 1
  MaxInstances = [uint32]::MaxValue; NumAPOInterfaces = 1
}
foreach ($k in $valores.Keys) {
  $v = $valores[$k]
  if ($v -is [string]) { New-ItemProperty $apo $k -Value $v -PropertyType String -Force | Out-Null }
  else { New-ItemProperty $apo $k -Value ([BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$v), 0)) -PropertyType DWord -Force | Out-Null }
}
New-ItemProperty $apo 'APOInterface0' -Value '{FD7F2B29-24D0-4B5C-B177-592C39F9CA10}' -PropertyType String -Force | Out-Null

# 3 e 4. Administradores só têm "definir valor" na chave de efeitos do microfone:
#        abre pedindo só isso (o New-ItemProperty pede mais e é recusado).
$k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey("$base\FxProperties",
  [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [Security.AccessControl.RegistryRights]'SetValue, QueryValues')
$multi = [Microsoft.Win32.RegistryValueKind]::MultiString

# Itens de uma lista de GUIDs do registro, sem o efeito. @(...) por fora: com um
# item só o PowerShell devolveria texto e o += colaria os dois. O -split separa
# uma lista que tenha sido gravada colada.
function Itens($valor) {
  if ($null -eq $valor) { return ,@() }
  return ,@(@($valor) | ForEach-Object { $_ -split '(?<=\})(?=\{)' } | Where-Object { $_ -and $_ -ne $clsid })
}
function Guardar($arquivo, $valor) {
  if (Test-Path $arquivo) { return }
  $dados = if ($null -eq $valor) { @{ existia = $false } } else { @{ existia = $true; valor = @($valor) } }
  $dados | ConvertTo-Json | Set-Content $arquivo -Encoding UTF8
}

$atualEfx = $k.GetValue($efx)
Guardar $backupEfx $atualEfx
$lista = Itens $atualEfx
$lista += $clsid
$k.SetValue($efx, [string[]]$lista, $multi)

# 5. Versões antigas punham o efeito na lista de fluxo e ligavam o modo comunicação
#    nela. Com o efeito de ponta isso sobra (e somaria o som duas vezes): desfaz.
$atualSfx = $k.GetValue($sfx)
if ($null -ne $atualSfx -and (@($atualSfx) -join '') -match [regex]::Escape($clsid)) {
  $restante = Itens $atualSfx
  if ($restante.Count) { $k.SetValue($sfx, [string[]]$restante, $multi) } else { $k.DeleteValue($sfx, $false) }
}
if (Test-Path $backupModos) {
  $b = Get-Content $backupModos -Raw | ConvertFrom-Json
  if ($b.existia) { $k.SetValue($modos, [string[]]$b.valor, $multi) } else { $k.DeleteValue($modos, $false) }
  Remove-Item $backupModos -Force
}
$k.Close()

# 6. Reinicia o áudio
if ((Get-Service Audiosrv).Status -eq 'Running') { Restart-Service -Name Audiosrv -Force } else { Start-Service -Name Audiosrv }
Write-Host ("Efeito instalado. Efeitos de ponta do microfone: " + ($lista -join ', '))
