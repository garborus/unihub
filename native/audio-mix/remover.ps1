# Remove o efeito de áudio do UniHub e devolve a lista de efeitos original de
# cada microfone em que ele estava. Precisa de administrador.

$ErrorActionPreference = 'Stop'
$clsid = '{6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}'
$pasta = 'C:\Program Files\UniHub\audio-mix'
$capturas = 'SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture'
$sfx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13'
$modos = '{d3993a3f-99c2-4402-b5ec-a92a0367664b},5'
$efx = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},15'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Rode este script como administrador.' }

$multi = [Microsoft.Win32.RegistryValueKind]::MultiString
foreach ($id in (Get-ChildItem "HKLM:\$capturas" | ForEach-Object PSChildName)) {
  if (-not (Test-Path "HKLM:\$capturas\$id\FxProperties")) { continue }
  # Administradores só têm "definir valor" nesta chave: abre pedindo só isso.
  $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey("$capturas\$id\FxProperties",
    [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [Security.AccessControl.RegistryRights]'SetValue, QueryValues')
  $atual = $k.GetValue($sfx)
  $backup = Join-Path $pasta ("backup-" + $id.Trim('{}') + ".json")
  if (Test-Path $backup) {
    $b = Get-Content $backup -Raw | ConvertFrom-Json
    if ($b.existia) { $k.SetValue($sfx, [string[]]$b.valor, $multi) } else { $k.DeleteValue($sfx, $false) }
    Write-Host "Microfone ${id}: lista de efeitos restaurada do backup."
  } elseif ($null -ne $atual -and (@($atual) -join '') -match [regex]::Escape($clsid)) {
    $lista = @(@($atual) | ForEach-Object { $_ -split '(?<=\})(?=\{)' } | Where-Object { $_ -and $_ -ne $clsid })
    if ($lista.Count) { $k.SetValue($sfx, [string[]]$lista, $multi) } else { $k.DeleteValue($sfx, $false) }
    Write-Host "Microfone ${id}: efeito tirado da lista (sem backup)."
  }
  # Efeitos de ponta: onde o instalar.ps1 põe o efeito.
  $backupEfx = Join-Path $pasta ("backup-efx-" + $id.Trim('{}') + ".json")
  $atualEfx = $k.GetValue($efx)
  if (Test-Path $backupEfx) {
    $b = Get-Content $backupEfx -Raw | ConvertFrom-Json
    if ($b.existia) { $k.SetValue($efx, [string[]]$b.valor, $multi) } else { $k.DeleteValue($efx, $false) }
    Write-Host "Microfone ${id}: efeitos de ponta restaurados do backup."
  } elseif ($null -ne $atualEfx -and (@($atualEfx) -join '') -match [regex]::Escape($clsid)) {
    $lista = @(@($atualEfx) | ForEach-Object { $_ -split '(?<=\})(?=\{)' } | Where-Object { $_ -and $_ -ne $clsid })
    if ($lista.Count) { $k.SetValue($efx, [string[]]$lista, $multi) } else { $k.DeleteValue($efx, $false) }
    Write-Host "Microfone ${id}: efeito tirado dos efeitos de ponta (sem backup)."
  }
  # Modos dos efeitos de fluxo (versões antigas do instalar.ps1 mexiam neles).
  $backupModos = Join-Path $pasta ("backup-modos-" + $id.Trim('{}') + ".json")
  if (Test-Path $backupModos) {
    $b = Get-Content $backupModos -Raw | ConvertFrom-Json
    if ($b.existia) { $k.SetValue($modos, [string[]]$b.valor, $multi) } else { $k.DeleteValue($modos, $false) }
    Write-Host "Microfone ${id}: modos dos efeitos restaurados do backup."
  }
  $k.Close()
}

Remove-Item "HKLM:\SOFTWARE\Classes\AudioEngine\AudioProcessingObjects\$clsid" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "HKLM:\SOFTWARE\Classes\CLSID\$clsid" -Recurse -Force -ErrorAction SilentlyContinue

Restart-Service -Name Audiosrv -Force
Start-Sleep -Seconds 2
Remove-Item $pasta -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item 'C:\ProgramData\UniHub\audio-mix.log' -Force -ErrorAction SilentlyContinue
if (Test-Path $pasta) { Write-Host "Não deu para apagar $pasta agora (DLL em uso); apague depois de reiniciar o PC." }
else { Write-Host 'Efeito removido.' }
