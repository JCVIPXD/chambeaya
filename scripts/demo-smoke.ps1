$ErrorActionPreference = 'Stop'

$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$seedScript = Join-Path $PSScriptRoot 'seed-demo.ps1'
Push-Location $projectDirectory
try {
  & $seedScript
  if ($LASTEXITCODE -ne 0) {
    throw 'No fue posible restablecer los datos demo antes del smoke.'
  }

  Write-Host 'Verificando contratos de empresa, trabajador y superadmin…' -ForegroundColor Cyan
  docker compose exec -T -e CUMPLENOW_DEMO_SMOKE=true api npm run demo:smoke
  if ($LASTEXITCODE -ne 0) {
    throw 'El smoke de demostración falló. Revisa que la API local esté saludable y vuelve a ejecutar el comando.'
  }
  Write-Host 'Smoke local completado. El escenario queda listo para la presentación.' -ForegroundColor Green
}
finally {
  Pop-Location
}
