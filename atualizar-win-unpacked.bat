@echo off
setlocal
title Atualizar o FilmForge (win-unpacked)
rem Troca o pacote do app em release-2026-10-28-b\win-unpacked pela versao nova (com o app FECHADO).
cd /d "%~dp0"
set "SRC=release-staging-20261028\win-unpacked\resources"
set "DST=release-2026-10-28-b\win-unpacked\resources"

:espera
tasklist /FI "IMAGENAME eq FilmForge.exe" 2>nul | find /I "FilmForge.exe" >nul
if not errorlevel 1 (
  echo Feche o FilmForge para atualizar. Verificando de novo em 3 s...
  timeout /t 3 /nobreak >nul
  goto espera
)
copy /Y "%SRC%\app.asar" "%DST%\app.asar" >nul || (echo [ERRO] nao consegui copiar o app.asar & pause & exit /b 1)
robocopy "%SRC%\plugins-bundled" "%DST%\plugins-bundled" /E /NFL /NDL /NJH /NJS >nul
echo FilmForge atualizado. Abrindo...
start "" "release-2026-10-28-b\win-unpacked\FilmForge.exe"
timeout /t 2 >nul
