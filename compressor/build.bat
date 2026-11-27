@echo off
rem Gera o executavel do motor de compressao usado pelo Auris PDF (sidecar do Tauri).
cd /d "%~dp0"
python -m pip install --quiet --upgrade pymupdf pillow pyinstaller pdf2docx || exit /b 1
python -m PyInstaller --noconfirm --distpath build\dist --workpath build\work auris-compress.spec || exit /b 1
if not exist ..\src-tauri\binaries mkdir ..\src-tauri\binaries
copy /y build\dist\auris-compress.exe ..\src-tauri\binaries\auris-compress-x86_64-pc-windows-msvc.exe >nul
echo Motor de compressao pronto.
