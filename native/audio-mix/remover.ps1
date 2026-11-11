# Remove o efeito de áudio do UnusHub e devolve a lista de efeitos original de
# cada microfone em que ele estava. Precisa de administrador.
#
# Um microfone que não puder ser aberto não impede a remoção dos outros.
#
# Este arquivo fica em UTF-8 com BOM (ver instalar.ps1).

$ErrorActionPreference = 'Stop'
$clsid = '{6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}'
# Pasta de programas do Windows (não C:\ fixo: o Windows pode estar em outra unidade).
$pasta = Join-Path $env:ProgramFiles 'UniHub\audio-mix'
$capturas = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture'
$sfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13'
$modos = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},5'
$efx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},15'
$melhorias = '{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Rode este script como administrador.' }

$multi = [Microsoft.Win32.RegistryValueKind]::MultiString
$semEfeito = { param($valor) @(@($valor) | ForEach-Object { $_ -split '(?<=\})(?=\{)' } | Where-Object { $_ -and $_ -ne $clsid }) }
$falhas = @()

foreach ($id in (Get-ChildItem "HKLM:\$capturas" | ForEach-Object PSChildName)) {
  if (-not (Test-Path "HKLM:\$capturas\$id\FxProperties")) { continue }
  $curto = $id.Trim('{}')
  $k = $null
  try {
    # Administradores só têm "definir valor" nesta chave: abre pedindo só isso.
    $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey("$capturas\$id\FxProperties",
      [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [Security.AccessControl.RegistryRights]'SetValue, QueryValues')
    if ($null -eq $k) { continue }

    # Efeitos de fluxo (versões antigas do instalar.ps1 punham o efeito aqui).
    $atual = $k.GetValue($sfx)
    $backup = Join-Path $pasta "backup-$curto.json"
    if (Test-Path $backup) {
      $b = Get-Content $backup -Raw | ConvertFrom-Json
      if ($b.existia) { $k.SetValue($sfx, [string[]]$b.valor, $multi) } else { $k.DeleteValue($sfx, $false) }
      Write-Host "Microfone ${id}: lista de efeitos restaurada do backup."
    } elseif ($null -ne $atual -and (@($atual) -join '') -match [regex]::Escape($clsid)) {
      $lista = & $semEfeito $atual
      if ($lista.Count) { $k.SetValue($sfx, [string[]]$lista, $multi) } else { $k.DeleteValue($sfx, $false) }
      Write-Host "Microfone ${id}: efeito tirado da lista (sem backup)."
    }

    # Efeitos de ponta: onde o instalar.ps1 põe o efeito.
    $backupEfx = Join-Path $pasta "backup-efx-$curto.json"
    $atualEfx = $k.GetValue($efx)
    if (Test-Path $backupEfx) {
      $b = Get-Content $backupEfx -Raw | ConvertFrom-Json
      if ($b.existia) { $k.SetValue($efx, [string[]]$b.valor, $multi) } else { $k.DeleteValue($efx, $false) }
      Write-Host "Microfone ${id}: efeitos de ponta restaurados do backup."
    } elseif ($null -ne $atualEfx -and (@($atualEfx) -join '') -match [regex]::Escape($clsid)) {
      $lista = & $semEfeito $atualEfx
      if ($lista.Count) { $k.SetValue($efx, [string[]]$lista, $multi) } else { $k.DeleteValue($efx, $false) }
      Write-Host "Microfone ${id}: efeito tirado dos efeitos de ponta (sem backup)."
    }

    # Modos dos efeitos de fluxo (versões antigas do instalar.ps1 mexiam neles).
    $backupModos = Join-Path $pasta "backup-modos-$curto.json"
    if (Test-Path $backupModos) {
      $b = Get-Content $backupModos -Raw | ConvertFrom-Json
      if ($b.existia) { $k.SetValue($modos, [string[]]$b.valor, $multi) } else { $k.DeleteValue($modos, $false) }
      Write-Host "Microfone ${id}: modos dos efeitos restaurados do backup."
    }

    # "Melhorias de áudio": se o instalar.ps1 ligou, volta a ficar como estava.
    $backupMelhorias = Join-Path $pasta "backup-melhorias-$curto.json"
    if (Test-Path $backupMelhorias) {
      $b = Get-Content $backupMelhorias -Raw | ConvertFrom-Json
      if ($b.existia) { $k.SetValue($melhorias, [int]@($b.valor)[0], [Microsoft.Win32.RegistryValueKind]::DWord) }
      Write-Host "Microfone ${id}: melhorias de áudio como estavam antes."
    }
  } catch {
    $falhas += $id
    Write-Host "Microfone ${id}: não foi possível restaurar ($($_.Exception.Message))."
  } finally {
    if ($k) { $k.Close() }
  }
}

Remove-Item "HKLM:\SOFTWARE\Classes\AudioEngine\AudioProcessingObjects\$clsid" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "HKLM:\SOFTWARE\Classes\CLSID\$clsid" -Recurse -Force -ErrorAction SilentlyContinue

# Reinicia o áudio para soltar a DLL; tenta algumas vezes.
$audioVoltou = $false
for ($i = 0; $i -lt 3 -and -not $audioVoltou; $i++) {
  try {
    if ((Get-Service Audiosrv).Status -eq 'Running') { Restart-Service -Name Audiosrv -Force -ErrorAction Stop }
    else { Start-Service -Name Audiosrv -ErrorAction Stop }
    $audioVoltou = $true
  } catch { Start-Sleep -Seconds 1 }
}
Start-Sleep -Seconds 2
Remove-Item $pasta -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:ProgramData 'UniHub\audio-mix.log') -Force -ErrorAction SilentlyContinue

if ($falhas.Count) { throw "O efeito foi removido, mas não deu para restaurar os efeitos de: $($falhas -join ', ')." }
if (-not $audioVoltou) { throw 'O efeito foi removido, mas não foi possível reiniciar o som do Windows. Reinicie o computador para terminar.' }
if (Test-Path $pasta) { Write-Host "Não deu para apagar $pasta agora (DLL em uso); apague depois de reiniciar o PC." }
else { Write-Host 'Efeito removido.' }
