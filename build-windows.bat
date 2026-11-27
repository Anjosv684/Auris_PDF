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

rem Motor de impressao (PDFium, licenca BSD/Apache) - baixado uma vez
if not exist "src-tauri\resources\pdfium.dll" (
  echo Baixando o motor de impressao PDFium...
  if not exist "src-tauri\resources" mkdir "src-tauri\resources"
  powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8179/pdfium-win-x64.tgz' -OutFile '%TEMP%\pdfium-win-x64.tgz'" || goto erro
  if not exist "%TEMP%\pdfium-x64" mkdir "%TEMP%\pdfium-x64"
  tar -xzf "%TEMP%\pdfium-win-x64.tgz" -C "%TEMP%\pdfium-x64" || goto erro
  copy /y "%TEMP%\pdfium-x64\bin\pdfium.dll" "src-tauri\resources\pdfium.dll" >nul || goto erro
)

rem Idiomas do OCR (Tesseract, licenca Apache-2.0) - baixados uma vez
if not exist "src-tauri\resources\tessdata" mkdir "src-tauri\resources\tessdata"
for %%L in (por eng) do (
  if not exist "src-tauri\resources\tessdata\%%L.traineddata" (
    echo Baixando idioma do OCR: %%L...
    powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/tesseract-ocr/tessdata_best/raw/4.1.0/%%L.traineddata' -OutFile 'src-tauri\resources\tessdata\%%L.traineddata'" || goto erro
  )
)

rem Motor de compressao (PyMuPDF) - precisa do Python
if not exist "src-tauri\binaries\auris-compress-x86_64-pc-windows-msvc.exe" (
  where python >nul 2>nul || (echo [ERRO] Instale o Python 3 para gerar o motor de compressao & pause & exit /b 1)
  call compressor\build.bat || goto erro
)

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
