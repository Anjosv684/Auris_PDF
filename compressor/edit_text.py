"""Edição do texto original do PDF.

Para cada edição: lê a formatação da linha (fonte, tamanho, cor, posição), apaga só os
caracteres daquela linha (imagens e desenhos ficam) e escreve o texto novo no mesmo
lugar, com a fonte padrão mais parecida (Helvetica/Arial, Times, Courier).
"""
import os

import pymupdf

_FONTES = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
# família -> (normal, negrito, itálico, negrito+itálico): arquivo do Windows e Base-14 de reserva
_FAMILIAS = {
    "sans": (("arial.ttf", "helv"), ("arialbd.ttf", "hebo"), ("ariali.ttf", "heit"), ("arialbi.ttf", "hebi")),
    "serif": (("times.ttf", "tiro"), ("timesbd.ttf", "tibo"), ("timesi.ttf", "tiit"), ("timesbi.ttf", "tibi")),
    "mono": (("cour.ttf", "cour"), ("courbd.ttf", "cobo"), ("couri.ttf", "coit"), ("courbi.ttf", "cobi")),
}
_SERIF = ("times", "serif", "georgia", "garamond", "cambria", "book", "minion", "roman")
_BOLD = ("bold", "black", "heavy", "semibold", "demi")


def _estilo(span) -> tuple[str, bool, bool]:
    nome, flags = span["font"].lower(), span["flags"]
    if flags & 8 or "cour" in nome or "mono" in nome:
        fam = "mono"
    elif flags & 4 or any(k in nome for k in _SERIF):
        fam = "serif"
    else:
        fam = "sans"
    negrito = bool(flags & 16) or any(k in nome for k in _BOLD)
    italico = bool(flags & 2) or "italic" in nome or "oblique" in nome
    return fam, negrito, italico


def _fonte(fam: str, negrito: bool, italico: bool, texto: str) -> dict:
    """Fonte padrão do PDF (Helvetica = Arial, Times, Courier) quando o texto cabe no Latin-1
    (todo o português): copiar/buscar sai exatamente igual ao digitado. Com travessão, aspas
    curvas, reticências etc., usa a fonte TrueType equivalente do Windows."""
    arquivo, base14 = _FAMILIAS[fam][(1 if negrito else 0) + (2 if italico else 0)]
    caminho = os.path.join(_FONTES, arquivo)
    if any(ord(c) > 255 for c in texto) and os.path.exists(caminho):
        return {"fontname": "AU" + arquivo.split(".")[0], "fontfile": caminho}
    return {"fontname": base14}


def _rgb(cor: int) -> tuple:
    return ((cor >> 16) & 255) / 255, ((cor >> 8) & 255) / 255, (cor & 255) / 255


def editar(entrada: str, saida: str, edicoes: list[dict]) -> dict:
    doc = pymupdf.open(entrada)
    if doc.needs_pass:
        doc.close()
        raise ValueError("PDF protegido por senha")
    feitas = 0
    for e in edicoes:
        page = doc[int(e["page"])]
        area = pymupdf.Rect(e["rect"])
        if page.rotation:
            area = area * page.derotation_matrix
        spans = [s for b in page.get_text("dict", clip=area)["blocks"] for l in b.get("lines", [])
                 for s in l["spans"] if s["text"].strip()]
        if not spans:
            continue
        ref = max(spans, key=lambda s: len(s["text"]))
        alvo = pymupdf.Rect()
        for s in spans:
            alvo |= pymupdf.Rect(s["bbox"])
        # encolhe um pouco na vertical para não pegar as linhas vizinhas
        m = alvo.height * 0.18
        apagar = pymupdf.Rect(alvo.x0, alvo.y0 + m, alvo.x1, alvo.y1 - m)
        page.add_redact_annot(apagar, fill=False)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                              text=pymupdf.PDF_REDACT_TEXT_REMOVE)
        texto = str(e.get("text", ""))
        if texto.strip():
            fam, negrito, italico = _estilo(ref)
            if e.get("bold") is not None:
                negrito = bool(e["bold"])
            tam = float(e.get("size") or ref["size"])
            x, y = spans[0]["origin"]
            for i, linha in enumerate(texto.split("\n")):
                if linha:
                    page.insert_text((x, y + i * tam * 1.2), linha, fontsize=tam, color=_rgb(ref["color"]),
                                     rotate=page.rotation, **_fonte(fam, negrito, italico, linha))
        feitas += 1
    doc.save(saida, garbage=3, deflate=True)
    doc.close()
    return {"editadas": feitas}


def todas_linhas(entrada: str) -> list[list[dict]]:
    """Linhas de todas as páginas (uma lista por página)."""
    doc = pymupdf.open(entrada)
    try:
        return [_linhas_da_pagina(page) for page in doc]
    finally:
        doc.close()


def linhas(entrada: str, pagina: int) -> list[dict]:
    doc = pymupdf.open(entrada)
    try:
        return _linhas_da_pagina(doc[pagina])
    finally:
        doc.close()


def _linhas_da_pagina(page) -> list[dict]:
    """Linhas de texto da página, com formatação e caixa (no sistema de coordenadas que o usuário vê)."""
    rot = page.rotation_matrix if page.rotation else None
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            # ignora texto invisível (camada de OCR sobre página escaneada)
            spans = [s for s in l["spans"] if s["text"].strip() and s.get("alpha", 255) > 0]
            if not spans:
                continue
            ref = max(spans, key=lambda s: len(s["text"]))
            fam, negrito, italico = _estilo(ref)
            r = pymupdf.Rect(l["bbox"])
            if rot is not None:
                r = r * rot
            out.append({"text": "".join(s["text"] for s in l["spans"]).strip(), "bbox": [r.x0, r.y0, r.x1, r.y1],
                        "size": ref["size"], "bold": negrito, "italic": italico, "family": fam,
                        "color": "#%06x" % ref["color"]})
    return out
