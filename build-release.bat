@echo off
echo ========================================
echo FilmForge - Gerador de Build
echo ========================================
echo.
echo Este script ira gerar os arquivos .exe, instalador e versao portable.
echo Certifique-se de que o Node.js e npm estao instalados.
echo.
pause

cd /d "%~dp0"

echo [1/3] Instalando dependencias...
call npm install
if %errorlevel% neq 0 (
 echo ERRO: Falha ao instalar dependencias. Verifique se o Node.js esta instalado.
 pause
 exit /b 1
)

echo.
echo [2/3] Gerando build de producao...
call npm run dist
if %errorlevel% neq 0 (
 echo ERRO: Falha ao gerar o build. Verifique os logs acima.
 pause
 exit /b 1
)

echo.
echo [3/3] Build concluido com sucesso!
echo Os arquivos gerados estao na pasta 'dist' ou 'release'.
echo.
pause