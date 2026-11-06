@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo  FilmForge - gerando executavel para Windows
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale o Node 20+ em https://nodejs.org e rode de novo.
  pause & exit /b 1
)

echo.
echo [1/3] Instalando dependencias...
call npm install
if errorlevel 1 ( echo [ERRO] npm install falhou. & pause & exit /b 1 )

echo.
echo [2/3] Verificando tipos e compilando...
call npm run typecheck
if errorlevel 1 ( echo [ERRO] typecheck falhou. & pause & exit /b 1 )
call npm run build
if errorlevel 1 ( echo [ERRO] build falhou. & pause & exit /b 1 )

echo.
echo [3/3] Empacotando com electron-builder (instalador NSIS + portatil)...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win
if errorlevel 1 (
  echo.
  echo [ERRO] electron-builder falhou. Se a mensagem mencionar "symbolic link",
  echo        ative o Modo de Desenvolvedor do Windows ou rode este .bat como Administrador.
  pause & exit /b 1
)

echo.
echo ============================================
echo  Pronto! Arquivos gerados na pasta "release":
dir /b release\*.exe
echo ============================================
explorer release
pause
