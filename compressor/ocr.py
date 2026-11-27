"""OCR (Tesseract embutido no PyMuPDF): torna PDFs escaneados pesquisáveis.

A página original fica intacta; por cima, cada palavra reconhecida é gravada como
texto invisível (render_mode=3) exatamente na posição dela. Resultado: mesma
aparência, mas com busca, seleção e cópia de texto.
"""
import pymupdf

FONT = pymupdf.Font("helv")
ASC, DESC = FONT.ascender, FONT.descender  # proporções da Helvetica


def _tem_texto(page) -> bool:
    return len(page.get_text("text").strip()) >= 20


def _camada_invisivel(page, words):
    for x0, y0, x1, y1, w, *_ in words:
        w = w.strip()
        if not w or x1 - x0 < 1 or y1 - y0 < 1:
            continue
        fs = (y1 - y0) / (ASC - DESC)
        largura = FONT.text_length(w, fontsize=fs)
        if largura <= 0:
            continue
        base = pymupdf.Point(x0, y1 + DESC * fs)
        escala = (x1 - x0) / largura
        try:
            page.insert_text(base, w, fontname="helv", fontsize=fs, render_mode=3,
                             morph=(base, pymupdf.Matrix(escala, 1)))
        except Exception:  # noqa: BLE001  (caractere fora da fonte etc.)
            continue


def ocr(entrada: str, saida: str, tessdata: str, idioma: str = "por+eng", forcar: bool = False,
        progresso=lambda feitas, total: None) -> dict:
    doc = pymupdf.open(entrada)
    if doc.needs_pass:
        doc.close()
        raise ValueError("PDF protegido por senha")
    total = len(doc)
    reconhecidas = 0
    for i, page in enumerate(doc):
        progresso(i, total)
        if not forcar and _tem_texto(page):
            continue  # página já tem texto: não mexe
        if page.rotation:
            page.remove_rotation()  # coordenadas do OCR e da escrita no mesmo sistema
        tp = page.get_textpage_ocr(flags=0, language=idioma, dpi=300, full=True, tessdata=tessdata)
        words = page.get_text("words", textpage=tp)
        if words:
            _camada_invisivel(page, words)
            reconhecidas += 1
    progresso(total, total)
    doc.save(saida, garbage=3, deflate=True)
    doc.close()
    return {"paginas": total, "reconhecidas": reconhecidas}
