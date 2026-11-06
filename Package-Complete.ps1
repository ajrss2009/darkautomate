# Script de empacotamento completo do FilmForge com sistema de memória
# PowerShell 5.1+

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "  ✓ $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "  ✗ $Message" -ForegroundColor Red
}

Write-Host "=" * 60 -ForegroundColor Yellow
Write-Host " FilmForge - Package with Memory System" -ForegroundColor Yellow
Write-Host "=" * 60 -ForegroundColor Yellow

try {
    # 1. Compilar o projeto
    Write-Step "Compilando o projeto TypeScript..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Falha na compilação do projeto"
    }
    Write-Success "Projeto compilado com sucesso"

    # 2. Criar estrutura FilmForgeData
    Write-Step "Criando estrutura FilmForgeData..."

    $baseDir = "release-2026-10-28-b\FilmForgeData"
    $dirs = @(
        "$baseDir",
        "$baseDir\memory-system",
        "$baseDir\appdata",
        "$baseDir\workspace"
    )

    foreach ($dir in $dirs) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Success "Criado: $dir"
        } else {
            Write-Success "Existe: $dir"
        }
    }

    # 3. Criar memórias de exemplo
    Write-Step "Criando memórias de exemplo..."

    $memoryDir = "$baseDir\memory-system"
    $timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"

    $memories = @{
        "project-filmforge" = @{
            name = "project-filmforge"
            description = "Information about FilmForge project"
            metadata = @{
                type = "project"
                version = "0.1.0"
                created = $timestamp
            }
            content = "FilmForge is an AI-powered video studio focused on scene-based composition with configurable routes, harnesses and ComfyUI integration. It provides a comprehensive memory system for storing user preferences, project data, feedback and reference materials."
            timestamp = $timestamp
            tags = @("filmforge", "project", "video", "ai")
            related = @()
        }

        "user-preferences" = @{
            name = "user-preferences"
            description = "Default user preferences"
            metadata = @{
                type = "user"
                created = $timestamp
            }
            content = "Default preferences: detailed logging enabled, step-by-step explanations preferred, ComfyUI integration enabled."
            timestamp = $timestamp
            tags = @("user", "preferences", "settings")
            related = @("project-filmforge")
        }

        "system-info" = @{
            name = "system-info"
            description = "Memory system information"
            metadata = @{
                type = "reference"
                created = $timestamp
            }
            content = "The FilmForge memory system stores data in JSON files within the FilmForgeData/memory-system directory. Each memory entry contains name, description, metadata, content, timestamp, tags and related entries."
            timestamp = $timestamp
            tags = @("system", "memory", "reference")
            related = @("project-filmforge")
        }
    }

    foreach ($key in $memories.Keys) {
        $filePath = Join-Path $memoryDir "$key.json"
        $memories[$key] | ConvertTo-Json -Depth 10 | Set-Content $filePath -Encoding UTF8
        Write-Success "Criado: $key.json"
    }

    # 4. Verificar se dist/main/main.js existe
    Write-Step "Verificando arquivos compilados..."

    $mainJs = "dist\main\main.js"
    if (Test-Path $mainJs) {
        $size = (Get-Item $mainJs).Length
        Write-Success "main.js encontrado (${size} bytes)"
    } else {
        Write-Error-Custom "main.js não encontrado em dist/main/"
        throw "Arquivo principal não compilado"
    }

    # 5. Empacotar com electron-builder
    Write-Step "Empacotando com electron-builder..."
    npm run dist
    if ($LASTEXITCODE -ne 0) {
        throw "Falha no empacotamento com electron-builder"
    }
    Write-Success "Empacotamento concluído"

    # 6. Verificar estrutura final
    Write-Step "Verificando estrutura do pacote final..."

    $releasePaths = @(
        "release\win-unpacked\resources\FilmForgeData",
        "release\win-unpacked\resources\FilmForgeData\memory-system",
        "release\win-unpacked\resources\FilmForgeData\appdata",
        "release\win-unpacked\resources\FilmForgeData\workspace"
    )

    $allGood = $true
    foreach ($path in $releasePaths) {
        if (Test-Path $path) {
            $count = (Get-ChildItem $path -File -ErrorAction SilentlyContinue).Count
            Write-Success "$path ($count arquivos)"
        } else {
            Write-Error-Custom "$path não encontrado"
            $allGood = $false
        }
    }

    # 7. Contar memórias no pacote final
    Write-Step "Memórias no pacote final..."

    $finalMemoryPath = "release\win-unpacked\resources\FilmForgeData\memory-system"
    if (Test-Path $finalMemoryPath) {
        $memoryFiles = Get-ChildItem $finalMemoryPath -Filter "*.json"
        foreach ($file in $memoryFiles) {
            Write-Success $file.Name
        }
        Write-Host "`n  Total: $($memoryFiles.Count) memórias" -ForegroundColor Cyan
    }

    # 8. Resumo final
    Write-Host "`n" + ("=" * 60) -ForegroundColor Yellow
    if ($allGood) {
        Write-Host " ✓ Build concluído com sucesso!" -ForegroundColor Green
    } else {
        Write-Host " ⚠ Build concluído com avisos" -ForegroundColor Yellow
    }
    Write-Host ("=" * 60) -ForegroundColor Yellow

    Write-Host "`nLocalização do executável:" -ForegroundColor Cyan
    Write-Host "  release\win-unpacked\FilmForge.exe"
    Write-Host "  release\FilmForge Setup X.X.X.exe"

} catch {
    Write-Host "`n" + ("=" * 60) -ForegroundColor Red
    Write-Host " ✗ ERRO: $_" -ForegroundColor Red
    Write-Host ("=" * 60) -ForegroundColor Red
    exit 1
}
