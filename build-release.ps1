# Script para gerar builds do FilmForge
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "FilmForge - Gerador de Build Automatico" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Encontrar o npm
$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmPath) {
    # Tentar caminhos comuns
    $commonPaths = @(
        "C:\Program Files\nodejs\npm.cmd",
        "C:\Program Files (x86)\nodejs\npm.cmd",
        "$env:APPDATA\npm\npm.cmd"
    )

    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            $npmPath = $path
            break
        }
    }
}

if (-not $npmPath) {
    Write-Host "ERRO: Nao foi possivel encontrar o npm. Verifique se o Node.js esta instalado." -ForegroundColor Red
    pause
    exit 1
}

Write-Host "NPM encontrado em: $npmPath" -ForegroundColor Green
Write-Host ""

# Mudar para o diretorio do projeto
Set-Location $PSScriptRoot

Write-Host "[1/2] Instalando dependencias..." -ForegroundColor Yellow
& $npmPath install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Falha ao instalar dependencias." -ForegroundColor Red
    pause
    exit 1
}

Write-Host ""
Write-Host "[2/2] Gerando build de producao (.exe, instalador, portable)..." -ForegroundColor Yellow
& $npmPath run dist
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Falha ao gerar o build." -ForegroundColor Red
    pause
    exit 1
}

Write-Host ""
Write-Host "Build concluido com sucesso!" -ForegroundColor Green
Write-Host "Verifique a pasta 'dist' ou 'release' para os arquivos gerados." -ForegroundColor Green
pause