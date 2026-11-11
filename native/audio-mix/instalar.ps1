# Instala o efeito de áudio do UnusHub em um microfone. Precisa de administrador
# (o UnusHub abre este script pelo pedido de permissão do Windows).
#
# Na ordem:
#  1. Copia a DLL para a pasta de programas do Windows (Program Files\UniHub\audio-mix).
#  2. Registra a DLL como componente COM e como efeito de áudio do Windows.
#  3. Guarda a lista atual de efeitos de ponta do microfone num backup (só na primeira vez).
#  4. Acrescenta o efeito no fim dessa lista (os que já estão lá continuam). O efeito de
#     ponta é o primeiro da cadeia e vale para todos os apps e modos do microfone,
#     inclusive o "bruto" que apps de chamada como o Discord usam e que pula os
#     efeitos de fluxo.
#  5. Liga as "melhorias de áudio" do microfone, se estavam desligadas (com backup):
#     sem elas o Windows não roda nenhum efeito.
#  6. Desfaz o que versões antigas faziam na lista de efeitos de fluxo.
#  7. Reinicia o serviço de áudio do Windows (o som de todos os apps para por uns segundos).
#
# Se algo falhar depois de o serviço de áudio ter sido parado, ele é religado mesmo assim.
# Para desfazer: remover.ps1.
#
# Este arquivo fica em UTF-8 com BOM: sem o BOM, o PowerShell 5 lê na página de
# código do Windows e os acentos podem quebrar o script em outros idiomas.

param(
  [Parameter(Mandatory = $true)] [string]$Microfone,  # ID do endpoint de captura, ex.: {9a923b6a-...}
  [string]$Dll = (Join-Path $PSScriptRoot 'build\UniHubAudioMix.dll')
)

$ErrorActionPreference = 'Stop'
$clsid = '{6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}'
# Pasta de programas do Windows (não C:\ fixo: o Windows pode estar em outra unidade).
$pasta = Join-Path $env:ProgramFiles 'UniHub\audio-mix'
$destino = Join-Path $pasta 'UniHubAudioMix.dll'
$base = "SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture\$Microfone"
$idCurto = $Microfone.Trim('{}')
$efx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},15'        # lista de efeitos de ponta (todos os modos)
$efxAntigo = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},7'   # efeito de ponta no formato antigo (um só)
$backupEfx = Join-Path $pasta "backup-efx-$idCurto.json"
$sfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13'        # lista de efeitos de fluxo (versões antigas)
$modos = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},5'        # modos dos efeitos de fluxo (versões antigas)
$backupModos = Join-Path $pasta "backup-modos-$idCurto.json"
$melhorias = '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5'    # 1 = "melhorias de áudio" desligadas
$backupMelhorias = Join-Path $pasta "backup-melhorias-$idCurto.json"

# --- Conferências, antes de mudar qualquer coisa --------------------------------------
if ($Microfone -notmatch '^\{[0-9a-fA-F-]{36}\}$') { throw "Microfone inválido: $Microfone" }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Rode este script como administrador.' }
if (-not (Test-Path $Dll)) { throw "DLL não encontrada em $Dll. Rode compilar.cmd antes." }
# A DLL é x64: num Windows ARM64 o serviço de áudio não consegue carregá-la.
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'O efeito no microfone ainda não funciona em computadores com processador ARM. Use um cabo de áudio virtual.' }
if (-not (Test-Path "HKLM:\$base\FxProperties")) { throw "O microfone não foi encontrado no Windows (ele pode ter sido desligado). Feche e abra a aba Sons e tente de novo." }
# Microfone de fone Bluetooth: o Windows não roda efeitos nele.
$barramento = (Get-ItemProperty "HKLM:\$base\Properties" -ErrorAction SilentlyContinue).'{a45c254e-df1c-4efd-8020-67d146a850e0},24'
if ("$barramento" -like 'BTH*') { throw 'Este microfone é de um fone Bluetooth, e nele o Windows não roda efeitos. Use o fone pelo cabo ou pelo dongle, ou um cabo de áudio virtual.' }

# Religa (ou reinicia) o serviço de áudio; tenta algumas vezes. Devolve se deu certo.
function ReiniciarAudio {
  for ($i = 0; $i -lt 3; $i++) {
    try {
      if ((Get-Service Audiosrv).Status -eq 'Running') { Restart-Service -Name Audiosrv -Force -ErrorAction Stop }
      else { Start-Service -Name Audiosrv -ErrorAction Stop }
      return $true
    } catch { Start-Sleep -Seconds 1 }
  }
  return $false
}

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

$audioParado = $false
$instalado = $false
$lista = @()
try {
  # 1. DLL. Se o serviço de áudio já carregou uma versão anterior, ela está em uso:
  #    para o serviço e tenta de novo por alguns segundos (ele volta no fim).
  New-Item -ItemType Directory -Force $pasta | Out-Null
  try { Copy-Item $Dll $destino -Force -ErrorAction Stop }
  catch {
    Stop-Service -Name Audiosrv -Force
    $audioParado = $true
    $copiou = $false
    for ($i = 0; $i -lt 10 -and -not $copiou; $i++) {
      try { Copy-Item $Dll $destino -Force -ErrorAction Stop; $copiou = $true }
      catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $copiou) { throw 'Não foi possível trocar o arquivo do efeito, porque ele está em uso. Feche os apps que usam o microfone e tente de novo, ou reinicie o computador.' }
  }

  # Versão do efeito instalado (versao.txt, um número que sobe quando a DLL muda):
  # o app compara com a que veio nele e oferece "Atualizar efeito". Sem o arquivo
  # (instalações antigas), vale como versão 1.
  $versao = Join-Path $PSScriptRoot 'versao.txt'
  if (Test-Path $versao) { Copy-Item $versao (Join-Path $pasta 'versao.txt') -Force }

  # Registro de diagnóstico, com escrita liberada para o Serviço Local (S-1-5-19),
  # que é quem roda a DLL dentro do serviço de áudio. Fica desligado: só registra se
  # existir o arquivo log-ligado nesta pasta. O registro antigo é apagado. Se esta
  # parte falhar, a instalação segue: é só diagnóstico.
  try {
    $diag = Join-Path $env:ProgramData 'UniHub'
    New-Item -ItemType Directory -Force $diag | Out-Null
    icacls $diag /grant '*S-1-5-19:(OI)(CI)M' | Out-Null
    Remove-Item (Join-Path $diag 'audio-mix.log') -Force -ErrorAction SilentlyContinue
  } catch { }

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
  foreach ($nome in $valores.Keys) {
    $v = $valores[$nome]
    if ($v -is [string]) { New-ItemProperty $apo $nome -Value $v -PropertyType String -Force | Out-Null }
    else { New-ItemProperty $apo $nome -Value ([BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$v), 0)) -PropertyType DWord -Force | Out-Null }
  }
  New-ItemProperty $apo 'APOInterface0' -Value '{FD7F2B29-24D0-4B5C-B177-592C39F9CA10}' -PropertyType String -Force | Out-Null

  # 3 e 4. Administradores só têm "definir valor" na chave de efeitos do microfone:
  #        abre pedindo só isso (o New-ItemProperty pede mais e é recusado).
  $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey("$base\FxProperties",
    [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [Security.AccessControl.RegistryRights]'SetValue, QueryValues')
  if ($null -eq $k) { throw 'Não foi possível abrir os efeitos do microfone no Windows.' }
  $multi = [Microsoft.Win32.RegistryValueKind]::MultiString
  try {
    $atualEfx = $k.GetValue($efx)
    Guardar $backupEfx $atualEfx
    $lista = Itens $atualEfx
    # Microfone que só tem o efeito de ponta no formato antigo (um só, no valor ,7): com
    # a lista nova criada, o Windows passa a seguir a lista. O efeito antigo entra nela
    # primeiro, para continuar rodando antes do nosso. O valor antigo fica como está, e
    # volta a valer quando a lista for removida.
    if ($null -eq $atualEfx) {
      $antigo = [string]$k.GetValue($efxAntigo)
      if ($antigo -match '^\{[0-9a-fA-F-]{36}\}$' -and $antigo -ne '{00000000-0000-0000-0000-000000000000}' -and $antigo -ne $clsid) { $lista = @($antigo) }
    }
    $lista += $clsid
    $k.SetValue($efx, [string[]]$lista, $multi)
    if ((@($k.GetValue($efx)) -join ' ') -notmatch [regex]::Escape($clsid)) { throw 'O Windows não guardou o efeito na lista do microfone.' }

    # 5. "Melhorias de áudio" desligadas neste microfone: o Windows não rodaria o efeito.
    #    Liga, guardando como estava para o remover.ps1 devolver.
    $desligadas = $k.GetValue($melhorias)
    if ($null -ne $desligadas -and [int]$desligadas -ne 0) {
      Guardar $backupMelhorias ([int]$desligadas)
      $k.SetValue($melhorias, 0, [Microsoft.Win32.RegistryValueKind]::DWord)
    }

    # 6. Versões antigas punham o efeito na lista de fluxo e ligavam o modo comunicação
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
  } finally {
    $k.Close()
  }
  $instalado = $true
} finally {
  # 7. Reinicia o áudio: para o efeito valer, ou para devolver o som se a instalação
  #    parou no meio com o serviço desligado.
  $audioVoltou = $true
  if ($instalado -or $audioParado) { $audioVoltou = ReiniciarAudio }
}

if (-not $audioVoltou) { throw 'O efeito foi instalado, mas não foi possível reiniciar o som do Windows. Reinicie o computador para terminar.' }
Write-Host ("Efeito instalado. Efeitos de ponta do microfone: " + ($lista -join ', '))
