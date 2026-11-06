@echo off
REM Script de empacotamento do FilmForge com sistema de memória integrado
echo ==================================================
echo  FilmForge - Package with Memory System
echo ==================================================
echo.

REM 1. Compilar o projeto
echo [1/5] Compilando o projeto...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERRO: Falha na compilacao!
    pause
    exit /b 1
)

REM 2. Criar estrutura FilmForgeData temporária para o build
echo [2/5] Criando estrutura FilmForgeData...
if not exist "release-2026-10-28-b\FilmForgeData" (
    mkdir "release-2026-10-28-b\FilmForgeData"
)
if not exist "release-2026-10-28-b\FilmForgeData\memory-system" (
    mkdir "release-2026-10-28-b\FilmForgeData\memory-system"
)
if not exist "release-2026-10-28-b\FilmForgeData\appdata" (
    mkdir "release-2026-10-28-b\FilmForgeData\appdata"
)
if not exist "release-2026-10-28-b\FilmForgeData\workspace" (
    mkdir "release-2026-10-28-b\FilmForgeData\workspace"
)

REM 3. Copiar memórias de exemplo
echo [3/5] Copiando memorias de exemplo...
echo {"name":"project-filmforge","description":"Information about FilmForge project","metadata":{"type":"project"},"content":"FilmForge is an AI-powered video studio focused on scene-based composition with configurable routes and ComfyUI integration.","timestamp":"%date% %time%","tags":["filmforge","project","video"],"related":[]} > "release-2026-10-28-b\FilmForgeData\memory-system\project-filmforge.json"
echo {"name":"user-preferences","description":"User preferences for FilmForge","metadata":{"type":"user"},"content":"User prefers detailed logging and step-by-step explanations.","timestamp":"%date% %time%","tags":["user","preferences"],"related":[]} > "release-2026-10-28-b\FilmForgeData\memory-system\user-preferences.json"

REM 4. Empacotar com electron-builder
echo [4/5] Empacotando com electron-builder...
call npm run dist
if %ERRORLEVEL% NEQ 0 (
    echo ERRO: Falha no empacotamento!
    pause
    exit /b 1
)

REM 5. Verificar estrutura final
echo [5/5] Verificando estrutura...
if exist "release\win-unpacked\resources\FilmForgeData\memory-system" (
    echo OK: Sistema de memoria presente em release\win-unpacked\resources\FilmForgeData\memory-system
    dir "release\win-unpacked\resources\FilmForgeData\memory-system"
) else (
    echo AVISO: Sistema de memoria nao encontrado no pacote final!
)

echo.
echo ==================================================
echo  Build concluido!
echo ==================================================
echo.
pause
