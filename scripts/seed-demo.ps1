$ErrorActionPreference = 'Stop'

$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $projectDirectory
try {
  $null = Get-Command docker -ErrorAction Stop
  $services = docker compose ps --services --status running 2>$null
  if ($LASTEXITCODE -ne 0 -or $services -notcontains 'api') {
    throw 'La API local no está en ejecución. Inicia primero: docker compose up -d --build'
  }

  $nodeEnvironment = docker compose exec -T api sh -lc 'printf "%s" "${NODE_ENV:-}"'
  if ($LASTEXITCODE -ne 0 -or $nodeEnvironment -cne 'development') {
    throw 'La API activa no está declarada como development. La semilla demo no se ejecutó.'
  }

  Write-Host 'Preparando datos demo locales…' -ForegroundColor Cyan
  docker compose exec -T -e CUMPLENOW_ALLOW_DEMO_SEED=true api npm run demo:seed
  if ($LASTEXITCODE -ne 0) {
    throw 'La preparación de datos demo no terminó correctamente.'
  }
  Write-Host 'Datos demo listos. Consulta docs/guides/client-demo.md para las cuentas y el recorrido.' -ForegroundColor Green
}
finally {
  Pop-Location
}
