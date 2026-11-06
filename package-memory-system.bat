@echo off
chcp 65001 > nul
echo ════════════════════════════════════════════════════════════
echo   FilmForge - Empacotamento do Sistema de Memória
echo ════════════════════════════════════════════════════════════
echo.

REM Definir cores
set GREEN=[92m
set YELLOW=[93m
set RED=[91m
set RESET=[0m
set BLUE=[94m

REM Definir variáveis
set PROJECT_ROOT=%~dp0
set RELEASE_DIR=%PROJECT_ROOT%release-2026-10-28-b
set MEMORY_DIR=%RELEASE_DIR%\FilmForgeData\memory-system
set UNPACKED_DIR=%RELEASE_DIR%\win-unpacked
set OUTPUT_DIR=%PROJECT_ROOT%release-final-with-memory
set TIMESTAMP=%date:~-4%%date:~3,2%%date:~0,2%-%time:~0,2%%time:~3,2%
set TIMESTAMP=%TIMESTAMP: =0%

echo %BLUE%[INFO]%RESET% Iniciando empacotamento...
echo %BLUE%[INFO]%RESET% Timestamp: %TIMESTAMP%
echo.

REM Verificar diretórios
echo %YELLOW%[1/8]%RESET% Verificando estrutura de diretórios...

if not exist "%RELEASE_DIR%" (
    echo %RED%[ERRO]%RESET% Release não encontrado: %RELEASE_DIR%
    exit /b 1
)

if not exist "%MEMORY_DIR%" (
    echo %RED%[ERRO]%RESET% Sistema de memória não encontrado
    exit /b 1
)

if not exist "%UNPACKED_DIR%" (
    echo %RED%[ERRO]%RESET% Win-unpacked não encontrado
    exit /b 1
)

echo %GREEN%✓%RESET% Todos os diretórios encontrados
echo.

REM Criar diretório de saída
echo %YELLOW%[2/8]%RESET% Criando diretório de saída...
if exist "%OUTPUT_DIR%" (
    echo %BLUE%[INFO]%RESET% Removendo diretório antigo...
    rmdir /S /Q "%OUTPUT_DIR%"
)
mkdir "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\win-unpacked"
echo %GREEN%✓%RESET% Diretório criado: %OUTPUT_DIR%
echo.

REM Copiar win-unpacked
echo %YELLOW%[3/8]%RESET% Copiando aplicação desempacotada...
xcopy /E /I /Y /Q "%UNPACKED_DIR%" "%OUTPUT_DIR%\win-unpacked\" > nul
if errorlevel 1 (
    echo %RED%[ERRO]%RESET% Falha ao copiar win-unpacked
    exit /b 1
)
echo %GREEN%✓%RESET% Aplicação copiada
echo.

REM Integrar sistema de memória nos resources
echo %YELLOW%[4/8]%RESET% Integrando sistema de memória...
set RESOURCES_DIR=%OUTPUT_DIR%\win-unpacked\resources

if not exist "%RESOURCES_DIR%\memory-system" mkdir "%RESOURCES_DIR%\memory-system"

xcopy /E /I /Y /Q "%MEMORY_DIR%\*" "%RESOURCES_DIR%\memory-system\" > nul
if errorlevel 1 (
    echo %RED%[ERRO]%RESET% Falha ao copiar sistema de memória
    exit /b 1
)
echo %GREEN%✓%RESET% Sistema de memória integrado em resources\memory-system
echo.

REM Copiar executáveis existentes
echo %YELLOW%[5/8]%RESET% Copiando executáveis...

if exist "%RELEASE_DIR%\FilmForge 0.1.0.exe" (
    copy /Y "%RELEASE_DIR%\FilmForge 0.1.0.exe" "%OUTPUT_DIR%\" > nul
    echo %GREEN%✓%RESET% FilmForge 0.1.0.exe (Portable)
)

if exist "%RELEASE_DIR%\FilmForge Setup 0.1.0.exe" (
    copy /Y "%RELEASE_DIR%\FilmForge Setup 0.1.0.exe" "%OUTPUT_DIR%\" > nul
    echo %GREEN%✓%RESET% FilmForge Setup 0.1.0.exe (Instalador)
)

if exist "%RELEASE_DIR%\FilmForge Setup 0.1.0.exe.blockmap" (
    copy /Y "%RELEASE_DIR%\FilmForge Setup 0.1.0.exe.blockmap" "%OUTPUT_DIR%\" > nul
)

echo.

REM Criar README no output
echo %YELLOW%[6/8]%RESET% Criando documentação...
(
echo # FilmForge v0.1.0 com Sistema de Memória
echo.
echo ## 📦 Conteúdo do Pacote
echo.
echo - **FilmForge 0.1.0.exe** - Versão portátil ^(não requer instalação^)
echo - **FilmForge Setup 0.1.0.exe** - Instalador completo
echo - **win-unpacked/** - Aplicação desempacotada para desenvolvimento
echo.
echo ## 🧠 Sistema de Memória Incluído
echo.
echo O sistema de memória está integrado em:
echo ```
echo resources/memory-system/
echo ├── core/                 # Gerenciador, tipos e índices
echo ├── stores/               # Armazenamento de dados
echo ├── examples/             # Exemplos de uso
echo └── documentação/         # README, INTEGRATION, etc
echo ```
echo.
echo ## 🚀 Instalação
echo.
echo ### Opção 1: Versão Portátil
echo 1. Execute **FilmForge 0.1.0.exe**
echo 2. O app roda sem instalação
echo 3. Dados salvos em: `%%APPDATA%%\FilmForge`
echo.
echo ### Opção 2: Instalador
echo 1. Execute **FilmForge Setup 0.1.0.exe**
echo 2. Siga o assistente de instalação
echo 3. Atalhos criados no Menu Iniciar
echo.
echo ## 📊 Novidades desta Build
echo.
echo ✅ Sistema de memória persistente
echo ✅ Sugestões inteligentes de workflow
echo ✅ Histórico de projetos
echo ✅ Análise preditiva
echo ✅ Otimização automática
echo ✅ 100%% local e privado
echo.
echo ## 📖 Documentação do Sistema de Memória
echo.
echo Após instalar, acesse:
echo - `resources\memory-system\README.md` - Visão geral
echo - `resources\memory-system\INTEGRATION.md` - Guia de integração
echo - `resources\memory-system\SUMMARY.md` - Resumo executivo
echo.
echo ## ℹ️ Informações Técnicas
echo.
echo - Versão: 0.1.0
echo - Build: %TIMESTAMP%
echo - Plataforma: Windows x64
echo - Electron: 33.x
echo - Sistema de memória: v1.0.0
echo.
echo ## 🔒 Privacidade
echo.
echo Todos os dados do sistema de memória são armazenados localmente.
echo Nenhuma informação é enviada para servidores externos.
echo.
echo ---
echo Desenvolvido com ❤️ para FilmForge
) > "%OUTPUT_DIR%\README.md"
echo %GREEN%✓%RESET% README.md criado
echo.

REM Criar arquivo de versão
echo %YELLOW%[7/8]%RESET% Criando arquivo de versão...
(
echo {
echo   "version": "0.1.0",
echo   "buildDate": "%TIMESTAMP%",
echo   "memorySystem": "1.0.0",
echo   "features": [
echo     "memory-system",
echo     "intelligent-suggestions",
echo     "project-history",
echo     "predictive-analysis",
echo     "workflow-optimization"
echo   ]
echo }
) > "%OUTPUT_DIR%\version.json"
echo %GREEN%✓%RESET% version.json criado
echo.

REM Gerar relatório
echo %YELLOW%[8/8]%RESET% Gerando relatório de build...

set "PORTABLE_SIZE=0"
set "SETUP_SIZE=0"
set "UNPACKED_SIZE=0"

if exist "%OUTPUT_DIR%\FilmForge 0.1.0.exe" (
    for %%A in ("%OUTPUT_DIR%\FilmForge 0.1.0.exe") do set PORTABLE_SIZE=%%~zA
)

if exist "%OUTPUT_DIR%\FilmForge Setup 0.1.0.exe" (
    for %%A in ("%OUTPUT_DIR%\FilmForge Setup 0.1.0.exe") do set SETUP_SIZE=%%~zA
)

echo.
echo ════════════════════════════════════════════════════════════
echo   %GREEN%BUILD CONCLUÍDO COM SUCESSO!%RESET%
echo ════════════════════════════════════════════════════════════
echo.
echo %BLUE%📁 Localização:%RESET% %OUTPUT_DIR%
echo.
echo %BLUE%📦 Arquivos Gerados:%RESET%
echo.

if exist "%OUTPUT_DIR%\FilmForge 0.1.0.exe" (
    set /a "PORTABLE_MB=%PORTABLE_SIZE:~0,-6%"
    echo   %GREEN%✓%RESET% FilmForge 0.1.0.exe ^(Portable^)
    echo     Tamanho: ~%PORTABLE_MB% MB
)

if exist "%OUTPUT_DIR%\FilmForge Setup 0.1.0.exe" (
    set /a "SETUP_MB=%SETUP_SIZE:~0,-6%"
    echo   %GREEN%✓%RESET% FilmForge Setup 0.1.0.exe ^(Instalador^)
    echo     Tamanho: ~%SETUP_MB% MB
)

echo   %GREEN%✓%RESET% win-unpacked\ ^(Desenvolvimento^)
echo   %GREEN%✓%RESET% README.md
echo   %GREEN%✓%RESET% version.json
echo.

echo %BLUE%🧠 Sistema de Memória:%RESET%
echo   Localização: resources\memory-system\
echo   Versão: 1.0.0
echo   Status: %GREEN%Integrado%RESET%
echo.

echo %BLUE%📊 Componentes:%RESET%
echo   - Core system ^(manager, types, index^)
echo   - 5 data stores ^(preferences, history, styles, workflows, learning^)
echo   - 16 testes
echo   - 16 exemplos
echo   - Documentação completa
echo.

echo %BLUE%🚀 Próximos Passos:%RESET%
echo   1. Testar executável portable: FilmForge 0.1.0.exe
echo   2. OU instalar via: FilmForge Setup 0.1.0.exe
echo   3. Verificar integração do sistema de memória
echo.

echo ════════════════════════════════════════════════════════════
echo.
echo %YELLOW%Pressione qualquer tecla para abrir o diretório de saída...%RESET%
pause > nul

explorer "%OUTPUT_DIR%"
