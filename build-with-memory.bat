@echo off
echo ==========================================
echo FilmForge Build Script with Memory System
echo ==========================================
echo.

REM Definir variáveis
set PROJECT_ROOT=%~dp0
set RELEASE_DIR=%PROJECT_ROOT%release-2026-10-28-b
set MEMORY_SYSTEM_DIR=%RELEASE_DIR%\FilmForgeData\memory-system
set OUTPUT_DIR=%PROJECT_ROOT%release-with-memory

echo [1/6] Verificando sistema de memória...
if not exist "%MEMORY_SYSTEM_DIR%" (
    echo ERRO: Sistema de memória não encontrado em %MEMORY_SYSTEM_DIR%
    exit /b 1
)
echo ✓ Sistema de memória encontrado

echo.
echo [2/6] Criando diretório de saída...
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
echo ✓ Diretório criado: %OUTPUT_DIR%

echo.
echo [3/6] Copiando sistema de memória para extraResources...
xcopy /E /I /Y "%MEMORY_SYSTEM_DIR%" "%PROJECT_ROOT%\memory-system-temp\" > nul
echo ✓ Sistema de memória copiado

echo.
echo [4/6] Compilando TypeScript e construindo app...
call npm run build
if errorlevel 1 (
    echo ERRO: Falha na compilação
    exit /b 1
)
echo ✓ Build concluído

echo.
echo [5/6] Gerando instaladores com electron-builder...
echo    - NSIS (instalador)
echo    - Portable (executável)
call npm run dist
if errorlevel 1 (
    echo ERRO: Falha ao gerar instaladores
    exit /b 1
)
echo ✓ Instaladores gerados

echo.
echo [6/6] Movendo builds para diretório de saída...
if exist "%PROJECT_ROOT%\release\*.exe" (
    copy "%PROJECT_ROOT%\release\*.exe" "%OUTPUT_DIR%\" > nul
    copy "%PROJECT_ROOT%\release\*.blockmap" "%OUTPUT_DIR%\" 2>nul
    copy "%PROJECT_ROOT%\release\*.yml" "%OUTPUT_DIR%\" 2>nul
    echo ✓ Arquivos copiados para %OUTPUT_DIR%
)

echo.
echo [7/7] Limpando arquivos temporários...
if exist "%PROJECT_ROOT%\memory-system-temp\" rmdir /S /Q "%PROJECT_ROOT%\memory-system-temp\"
echo ✓ Limpeza concluída

echo.
echo ==========================================
echo BUILD CONCLUÍDO COM SUCESSO!
echo ==========================================
echo.
echo Arquivos gerados em: %OUTPUT_DIR%
echo.
dir /B "%OUTPUT_DIR%\*.exe"
echo.
echo Sistema de memória incluído em:
echo   resources\memory-system\
echo.
echo Para instalar:
echo   1. Execute "FilmForge Setup X.X.X.exe" (instalador)
echo   OU
echo   2. Execute "FilmForge X.X.X.exe" (portable)
echo.
pause
