$envFile = Join-Path $PSScriptRoot '.env.localtest'

if (-not (Test-Path $envFile)) {
    Write-Host 'Fehlende Datei: .env.localtest' -ForegroundColor Yellow
    Write-Host 'Kopiere zuerst .env.localtest.example nach .env.localtest und passe sie bei Bedarf an.' -ForegroundColor Yellow
    exit 1
}

$env:DOTENV_CONFIG_PATH = $envFile
$env:LOCAL_DEV_SAFE_MODE = 'true'
$env:NODE_ENV = 'development'

Write-Host 'Starte Backend im sicheren lokalen Testmodus...' -ForegroundColor Green
Write-Host "Env-Datei: $envFile"

node (Join-Path $PSScriptRoot 'server.js')
