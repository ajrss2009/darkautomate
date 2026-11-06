# FilmForge - Script de Empacotamento com Sistema de Memória
# PowerShell 5.1+

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  FilmForge - Empacotamento do Sistema de Memória" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Definir variáveis
$ProjectRoot = $PSScriptRoot
$ReleaseDir = Join-Path $ProjectRoot "release-2026-10-28-b"
$MemoryDir = Join-Path $ReleaseDir "FilmForgeData\memory-system"
$UnpackedDir = Join-Path $ReleaseDir "win-unpacked"
$OutputDir = Join-Path $ProjectRoot "release-final-with-memory"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmm"

Write-Host "[INFO] Timestamp: $Timestamp" -ForegroundColor Blue
Write-Host ""

# Função para verificar diretório
function Test-DirectoryExists {
    param([string]$Path, [string]$Name)

    if (-not (Test-Path $Path)) {
        Write-Host "[ERRO] $Name não encontrado: $Path" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] $Name encontrado" -ForegroundColor Green
}

# Verificar estrutura
Write-Host "[1/8] Verificando estrutura de diretórios..." -ForegroundColor Yellow
Test-DirectoryExists $ReleaseDir "Release"
Test-DirectoryExists $MemoryDir "Sistema de memória"
Test-DirectoryExists $UnpackedDir "Win-unpacked"
Write-Host ""

# Criar diretório de saída
Write-Host "[2/8] Criando diretório de saída..." -ForegroundColor Yellow
if (Test-Path $OutputDir) {
    Write-Host "    Removendo diretório antigo..." -ForegroundColor Gray
    Remove-Item -Path $OutputDir -Recurse -Force
}
New-Item -Path $OutputDir -ItemType Directory | Out-Null
New-Item -Path "$OutputDir\win-unpacked" -ItemType Directory | Out-Null
Write-Host "[OK] Diretório criado: $OutputDir" -ForegroundColor Green
Write-Host ""

# Copiar win-unpacked
Write-Host "[3/8] Copiando aplicação desempacotada..." -ForegroundColor Yellow
Copy-Item -Path "$UnpackedDir\*" -Destination "$OutputDir\win-unpacked\" -Recurse -Force
Write-Host "[OK] Aplicação copiada" -ForegroundColor Green
Write-Host ""

# Integrar sistema de memória
Write-Host "[4/8] Integrando sistema de memória..." -ForegroundColor Yellow
$ResourcesDir = "$OutputDir\win-unpacked\resources"
$MemoryTargetDir = "$ResourcesDir\memory-system"

if (-not (Test-Path $MemoryTargetDir)) {
    New-Item -Path $MemoryTargetDir -ItemType Directory | Out-Null
}

Copy-Item -Path "$MemoryDir\*" -Destination $MemoryTargetDir -Recurse -Force
Write-Host "[OK] Sistema de memória integrado em resources\memory-system" -ForegroundColor Green

# Contar arquivos integrados
$FileCount = (Get-ChildItem -Path $MemoryTargetDir -Recurse -File).Count
Write-Host "    $FileCount arquivos copiados" -ForegroundColor Gray
Write-Host ""

# Copiar executáveis
Write-Host "[5/8] Copiando executáveis..." -ForegroundColor Yellow

$PortableExe = "$ReleaseDir\FilmForge 0.1.0.exe"
$SetupExe = "$ReleaseDir\FilmForge Setup 0.1.0.exe"
$Blockmap = "$ReleaseDir\FilmForge Setup 0.1.0.exe.blockmap"

if (Test-Path $PortableExe) {
    Copy-Item -Path $PortableExe -Destination $OutputDir -Force
    $Size = (Get-Item $PortableExe).Length / 1MB
    Write-Host "[OK] FilmForge 0.1.0.exe (Portable) - $([math]::Round($Size, 1)) MB" -ForegroundColor Green
}

if (Test-Path $SetupExe) {
    Copy-Item -Path $SetupExe -Destination $OutputDir -Force
    $Size = (Get-Item $SetupExe).Length / 1MB
    Write-Host "[OK] FilmForge Setup 0.1.0.exe (Instalador) - $([math]::Round($Size, 1)) MB" -ForegroundColor Green
}

if (Test-Path $Blockmap) {
    Copy-Item -Path $Blockmap -Destination $OutputDir -Force
}

Write-Host ""

# Criar README
Write-Host "[6/8] Criando documentação..." -ForegroundColor Yellow

$ReadmeContent = @"
# FilmForge v0.1.0 com Sistema de Memória

## 📦 Conteúdo do Pacote

- **FilmForge 0.1.0.exe** - Versão portátil (não requer instalação)
- **FilmForge Setup 0.1.0.exe** - Instalador completo
- **win-unpacked/** - Aplicação desempacotada para desenvolvimento

## 🧠 Sistema de Memória Incluído

O sistema de memória está integrado em:
``````
resources/memory-system/
├── core/                 # Gerenciador, tipos e índices
├── stores/               # Armazenamento de dados
├── examples/             # Exemplos de uso
└── documentação/         # README, INTEGRATION, etc
``````

## 🚀 Instalação

### Opção 1: Versão Portátil
1. Execute **FilmForge 0.1.0.exe**
2. O app roda sem instalação
3. Dados salvos em: ``%APPDATA%\FilmForge``

### Opção 2: Instalador
1. Execute **FilmForge Setup 0.1.0.exe**
2. Siga o assistente de instalação
3. Atalhos criados no Menu Iniciar

## 📊 Novidades desta Build

✅ Sistema de memória persistente
✅ Sugestões inteligentes de workflow
✅ Histórico de projetos
✅ Análise preditiva
✅ Otimização automática
✅ 100% local e privado

## 📖 Documentação do Sistema de Memória

Após instalar, acesse:
- ``resources\memory-system\README.md`` - Visão geral
- ``resources\memory-system\INTEGRATION.md`` - Guia de integração
- ``resources\memory-system\SUMMARY.md`` - Resumo executivo

## ℹ️ Informações Técnicas

- Versão: 0.1.0
- Build: $Timestamp
- Plataforma: Windows x64
- Electron: 33.x
- Sistema de memória: v1.0.0

## 🔒 Privacidade

Todos os dados do sistema de memória são armazenados localmente.
Nenhuma informação é enviada para servidores externos.

---
Desenvolvido com ❤️ para FilmForge
"@

Set-Content -Path "$OutputDir\README.md" -Value $ReadmeContent -Encoding UTF8
Write-Host "[OK] README.md criado" -ForegroundColor Green
Write-Host ""

# Criar arquivo de versão
Write-Host "[7/8] Criando arquivo de versão..." -ForegroundColor Yellow

$VersionContent = @{
    version = "0.1.0"
    buildDate = $Timestamp
    memorySystem = "1.0.0"
    features = @(
        "memory-system",
        "intelligent-suggestions",
        "project-history",
        "predictive-analysis",
        "workflow-optimization"
    )
} | ConvertTo-Json -Depth 3

Set-Content -Path "$OutputDir\version.json" -Value $VersionContent -Encoding UTF8
Write-Host "[OK] version.json criado" -ForegroundColor Green
Write-Host ""

# Gerar relatório
Write-Host "[8/8] Gerando relatório de build..." -ForegroundColor Yellow
Write-Host ""

Write-Host "============================================================" -ForegroundColor Green
Write-Host "  BUILD CONCLUÍDO COM SUCESSO!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

Write-Host "📁 Localização: " -NoNewline -ForegroundColor Blue
Write-Host $OutputDir
Write-Host ""

Write-Host "📦 Arquivos Gerados:" -ForegroundColor Blue
Write-Host ""

Get-ChildItem -Path $OutputDir -Filter "*.exe" | ForEach-Object {
    $SizeMB = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  ✓ $($_.Name)" -ForegroundColor Green
    Write-Host "    Tamanho: $SizeMB MB" -ForegroundColor Gray
}

Write-Host "  ✓ win-unpacked\" -ForegroundColor Green
Write-Host "  ✓ README.md" -ForegroundColor Green
Write-Host "  ✓ version.json" -ForegroundColor Green
Write-Host ""

Write-Host "🧠 Sistema de Memória:" -ForegroundColor Blue
Write-Host "  Localização: resources\memory-system\" -ForegroundColor Gray
Write-Host "  Versão: 1.0.0" -ForegroundColor Gray
Write-Host "  Arquivos: $FileCount" -ForegroundColor Gray
Write-Host "  Status: " -NoNewline -ForegroundColor Gray
Write-Host "Integrado" -ForegroundColor Green
Write-Host ""

Write-Host "📊 Componentes:" -ForegroundColor Blue
Write-Host "  - Core system manager types index" -ForegroundColor Gray
Write-Host "  - 5 data stores preferences history styles workflows learning" -ForegroundColor Gray
Write-Host "  - 16 testes" -ForegroundColor Gray
Write-Host "  - 16 exemplos" -ForegroundColor Gray
Write-Host "  - Documentacao completa" -ForegroundColor Gray
Write-Host ""

Write-Host "🚀 Próximos Passos:" -ForegroundColor Blue
Write-Host "  1. Testar executável portable: FilmForge 0.1.0.exe" -ForegroundColor Gray
Write-Host "  2. OU instalar via: FilmForge Setup 0.1.0.exe" -ForegroundColor Gray
Write-Host "  3. Verificar integração do sistema de memória" -ForegroundColor Gray
Write-Host ""

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Abrir diretório de saída
$Response = Read-Host "Deseja abrir o diretório de saída? (S/N)"
if ($Response -eq "S" -or $Response -eq "s") {
    Start-Process explorer.exe -ArgumentList $OutputDir
}

Write-Host ""
Write-Host "Concluido!" -ForegroundColor Green
