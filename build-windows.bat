@echo off
chcp 65001 >nul
title Auris PDF - gerando instalador
cd /d "%~dp0"

where node >nul 2>nul || (echo [ERRO] Instale o Node.js LTS: https://nodejs.org & pause & exit /b 1)
where cargo >nul 2>nul || (echo [ERRO] Instale o Rust: https://rustup.rs  ^(e o "Desktop development with C++" do Visual Studio Build Tools^) & pause & exit /b 1)

rem Chave que assina as atualizacoes (gerada uma vez; NUNCA perca nem compartilhe)
if not exist "%USERPROFILE%\.tauri\auris-pdf.key" (echo [ERRO] Chave de assinatura nao encontrada em %USERPROFILE%\.tauri\auris-pdf.key & pause & exit /b 1)
set "TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\auris-pdf.key"
set "TAURI_SIGNING_PRIVATE_KEY_PASSWORD="

echo [1/3] Instalando dependencias...
call npm install || goto erro

echo [2/3] Gerando o app (a primeira vez demora ~5-10 min)...
call npx tauri build || goto erro

echo [3/3] Pronto!
echo.
echo Instalador: src-tauri\target\release\bundle\nsis\
explorer "src-tauri\target\release\bundle\nsis"
pause
exit /b 0

:erro
echo.
echo Deu erro. Copie a mensagem acima e me mande.
pause
exit /b 1
