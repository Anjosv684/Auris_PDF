# -*- mode: python ; coding: utf-8 -*-
# Motor de compressão do Auris PDF (sidecar). Gere com build.bat.
EXCLUIR_MOD = ['tkinter', 'customtkinter', 'numpy', 'onnxruntime', 'pymupdf4llm', 'pymupdf_layout',
               'pymupdf.layout', 'networkx', 'pandas', 'matplotlib', 'ssl', '_ssl', 'PIL._avif',
               'PIL.AvifImagePlugin', 'unittest', 'pydoc', 'xmlrpc', 'http', 'email']
# arquivos do PyMuPDF/Pillow que o motor não usa (modelos de IA, headers, libs de desenvolvimento)
EXCLUIR_ARQ = ('pymupdf\layout', 'pymupdf/layout', 'mupdf-devel', '_avif', 'libcrypto', 'libssl', '.onnx', '.lib', '.h')

a = Analysis(['cli.py'], pathex=[], binaries=[], datas=[], hiddenimports=[], hookspath=[],
             hooksconfig={}, runtime_hooks=[], excludes=EXCLUIR_MOD, noarchive=False, optimize=1)

def manter(entry):
    nome = entry[0].lower()
    return not any(x in nome for x in EXCLUIR_ARQ)

a.binaries = [b for b in a.binaries if manter(b)]
a.datas = [d for d in a.datas if manter(d)]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='auris-compress', debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, runtime_tmpdir=None,
          console=True, disable_windowed_traceback=False)
