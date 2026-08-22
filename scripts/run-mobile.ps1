$flutter = Join-Path $PSScriptRoot '..\.tools\flutter\bin\flutter.bat'
$appDirectory = Join-Path $PSScriptRoot '..\apps\mobile_flutter'

if (-not (Test-Path $flutter)) {
  throw 'Flutter SDK no encontrado. Espera que termine su descarga o instala Flutter y ajusta esta ruta.'
}

Push-Location $appDirectory
try {
  & $flutter run
}
finally {
  Pop-Location
}
