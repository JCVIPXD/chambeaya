param(
  [ValidateSet('web-server', 'chrome')]
  [string]$Device = 'web-server',
  [int]$Port = 7357,
  [switch]$UseLocalApi,
  [string]$ApiBaseUrl = 'http://127.0.0.1:4000/api'
)

$bundledFlutter = Join-Path $PSScriptRoot '..\.tools\flutter\bin\flutter.bat'
$flutter = if (Test-Path -LiteralPath $bundledFlutter) {
  (Resolve-Path -LiteralPath $bundledFlutter).Path
} else {
  $command = Get-Command flutter -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw 'Flutter SDK no encontrado. Instala Flutter o agrega flutter a PATH.'
  }
  $command.Source
}

$appDirectory = Join-Path $PSScriptRoot '..\apps\mobile_flutter'
$flutterArgs = @('run', '-d', $Device)
if ($Device -in @('web-server', 'chrome')) {
  $flutterArgs += @('--web-port', $Port)
}
if ($UseLocalApi) {
  $flutterArgs += '--dart-define=USE_LOCAL_API=true'
  $flutterArgs += "--dart-define=API_BASE_URL=$ApiBaseUrl"
}

Push-Location $appDirectory
try {
  Write-Host "Iniciando Flutter en $Device (puerto $Port)..." -ForegroundColor Cyan
  if ($UseLocalApi) {
    Write-Host "API local: $ApiBaseUrl" -ForegroundColor DarkCyan
  } else {
    Write-Host 'Modo demo: no requiere API ni Docker.' -ForegroundColor DarkCyan
  }
  & $flutter @flutterArgs
}
finally {
  Pop-Location
}
