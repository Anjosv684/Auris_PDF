"""PDF → Word (.docx) com o pdf2docx (MIT).

Páginas escaneadas (sem texto) passam antes pelo OCR: a página é remontada só com o
texto reconhecido, visível, para o Word receber texto editável em vez de uma foto.
"""
import logging
import os
import re

import pymupdf

from ocr import _tem_texto


class _Progresso(logging.Handler):
    """Conta as mensagens "(i/n) Page" do pdf2docx (análise + criação de cada página)."""

    def __init__(self, base: int, total: int, progresso):
        super().__init__(logging.INFO)
        self.base, self.total, self.progresso, self.feitas = base, total, progresso, 0

    def emit(self, record):
        try:
            if re.match(r"\(\d+/\d+\) Page", record.getMessage()):
                self.feitas += 1
                self.progresso(min(self.base + self.feitas, self.total - 1), self.total)
        except Exception:  # noqa: BLE001
            pass


def _pagina_do_ocr(destino, page, tessdata: str, idioma: str):
    nova = destino.new_page(width=page.rect.width, height=page.rect.height)
    if page.rotation:
        page.remove_rotation()
    tp = page.get_textpage_ocr(flags=0, language=idioma, dpi=300, full=True, tessdata=tessdata)
    fonte = pymupdf.Font("helv")
    for bloco in page.get_text("dict", textpage=tp)["blocks"]:
        for linha in bloco.get("lines", []):
            spans = [s for s in linha["spans"] if s["text"].strip()]
            if not spans:
                continue
            # uma linha por vez, com espaços reais entre as palavras
            texto = " ".join(s["text"].strip() for s in spans)
            tam = sorted(s["size"] for s in spans)[len(spans) // 2]
            x0, x1 = spans[0]["bbox"][0], spans[-1]["bbox"][2]
            largura = fonte.text_length(texto, fontsize=tam)
            if largura > 0 and x1 > x0:
                tam = min(tam, tam * (x1 - x0) / largura)  # cabe na largura da linha original
            try:
                nova.insert_text((x0, spans[0]["origin"][1]), texto, fontsize=max(4, tam), fontname="helv")
            except Exception:  # noqa: BLE001
                pass


def para_word(entrada: str, saida: str, tessdata: str | None, idioma: str = "por+eng",
              progresso=lambda feitas, total: None) -> dict:
    src = pymupdf.open(entrada)
    if src.needs_pass:
        src.close()
        raise ValueError("PDF protegido por senha")
    n = len(src)
    escaneadas = [i for i, p in enumerate(src) if not _tem_texto(p)] if tessdata else []
    total = len(escaneadas) + 2 * n + 1
    tmp = None
    if escaneadas:
        out = pymupdf.open()
        feitas = 0
        for i, page in enumerate(src):
            if i in escaneadas:
                progresso(feitas, total)
                _pagina_do_ocr(out, page, tessdata, idioma)
                feitas += 1
            else:
                out.insert_pdf(src, from_page=i, to_page=i)
        tmp = saida + ".ocr.pdf"
        out.save(tmp, garbage=3, deflate=True)
        out.close()
    src.close()

    from pdf2docx import Converter

    log = logging.getLogger()
    log.setLevel(logging.INFO)
    for h in list(log.handlers):
        log.removeHandler(h)
    handler = _Progresso(len(escaneadas), total, progresso)
    log.addHandler(handler)
    try:
        cv = Converter(tmp or entrada)
        try:
            cv.convert(saida, multi_processing=False)
        finally:
            cv.close()
    finally:
        log.removeHandler(handler)
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
    progresso(total, total)
    return {"paginas": n, "escaneadas": len(escaneadas)}
