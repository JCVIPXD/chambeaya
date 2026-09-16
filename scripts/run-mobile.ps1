param(
  [ValidateSet('web-server', 'chrome')]
  [string]$Device = 'web-server',
  [int]$Port = 7357,
  [switch]$Demo,
  [string]$ApiBaseUrl = 'http://127.0.0.1:4000/api',
  [string]$GoogleWebClientId = ''
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
  $flutterArgs += @('--web-hostname', 'localhost', '--web-port', $Port)
}
if ($Demo) {
  $flutterArgs += '--dart-define=CUMPLENOW_DEMO_MODE=true'
} else {
  if ([string]::IsNullOrWhiteSpace($GoogleWebClientId)) {
    $environmentFile = Join-Path $PSScriptRoot '..\.env'
    if (Test-Path -LiteralPath $environmentFile) {
      $googleLine = Select-String -LiteralPath $environmentFile -Pattern '^GOOGLE_OAUTH_WEB_CLIENT_ID=(.+)$' | Select-Object -First 1
      if ($null -ne $googleLine) {
        $GoogleWebClientId = $googleLine.Matches[0].Groups[1].Value.Trim()
      }
    }
  }
  $flutterArgs += "--dart-define=API_BASE_URL=$ApiBaseUrl"
  if (![string]::IsNullOrWhiteSpace($GoogleWebClientId)) {
    $flutterArgs += "--dart-define=GOOGLE_OAUTH_WEB_CLIENT_ID=$GoogleWebClientId"
  }
  $healthUrl = "$($ApiBaseUrl.TrimEnd('/'))/health"
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 8
    if ($health.status -ne 'ok') { throw 'Respuesta de healthcheck no válida.' }
  } catch {
    throw "La API no responde en $healthUrl. Iníciala antes de abrir Flutter o usa npm run dev:mobile -- -Demo para una demostración aislada. Detalle: $($_.Exception.Message)"
  }
}

Push-Location $appDirectory
try {
  Write-Host "Iniciando Flutter en $Device (puerto $Port)..." -ForegroundColor Cyan
  if (!$Demo) {
    Write-Host "API local: $ApiBaseUrl" -ForegroundColor DarkCyan
  } else {
    Write-Host 'Modo demo explícito: no requiere API ni Docker.' -ForegroundColor DarkCyan
  }
  & $flutter @flutterArgs
}
finally {
  Pop-Location
}
