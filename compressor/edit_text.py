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


def _cores_da_area(page, area):
    """Cor do papel (lida numa faixa ao redor da linha) e da tinta (pixels mais escuros dentro dela)."""
    fora = area + (-4, -4, 4, 4)
    pix = page.get_pixmap(clip=fora, dpi=150, colorspace=pymupdf.csRGB, alpha=False)
    k = 150 / 72
    ix0, iy0 = (area.x0 - fora.x0) * k, (area.y0 - fora.y0) * k
    ix1, iy1 = (area.x1 - fora.x0) * k, (area.y1 - fora.y0) * k
    borda, dentro = [], []
    for y in range(pix.height):
        for x in range(pix.width):
            c = pix.pixel(x, y)
            (dentro if ix0 <= x <= ix1 and iy0 <= y <= iy1 else borda).append(c)
    if not dentro:
        return (1, 1, 1), (0, 0, 0)

    def mediana(cs):
        return tuple(sorted(c[i] for c in cs)[len(cs) // 2] / 255 for i in range(3))

    # papel: mediana da faixa ao redor, só com os pixels claros (ignora traços que encostem)
    borda.sort(key=sum)
    papel = mediana(borda[len(borda) // 4:] or dentro)
    dentro.sort(key=sum)
    tinta = mediana(dentro[: max(1, len(dentro) // 12)])
    return papel, tinta


_DESCE = set("gjpqyçQ,;()[]{}|/")


def _tinta(pix):
    import numpy as np
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width) < 140


def _encaixe(a, b) -> float:
    """Maior semelhança (interseção/união da tinta) entre a e b, testando deslocamentos de até 3 px."""
    import numpy as np
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    if h < 4 or w < 4:
        return 0.0
    melhor = 0.0
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            ys, yd = (slice(max(0, dy), h + min(0, dy)), slice(max(0, -dy), h + min(0, -dy)))
            xs, xd = (slice(max(0, dx), w + min(0, dx)), slice(max(0, -dx), w + min(0, -dx)))
            pa, pb = a[:h, :w][ys, xs], b[:h, :w][yd, xd]
            uniao = np.logical_or(pa, pb).sum()
            if uniao:
                melhor = max(melhor, np.logical_and(pa, pb).sum() / uniao)
    return float(melhor)


def _fonte_parecida(page, area: pymupdf.Rect, ref: str):
    """Desenha o texto original em cada fonte candidata, no tamanho que ocupa a mesma largura,
    e compara com os pixels do escaneado. Fica com a mais parecida (família, negrito, tamanho)."""
    dpi = 150
    a = _tinta(page.get_pixmap(clip=area, dpi=dpi, colorspace=pymupdf.csGRAY, alpha=False))
    desce = any(c in _DESCE for c in ref)
    notas = {}
    for fam, negrito, nome in (("serif", False, "tiro"), ("serif", True, "tibo"), ("sans", False, "helv"), ("sans", True, "hebo")):
        larg1 = pymupdf.Font(nome).text_length(ref, fontsize=1)
        if larg1 <= 0:
            continue
        tam = max(4.0, min(area.width / larg1, area.height * 1.6))
        tmp = pymupdf.open()
        pg = tmp.new_page(width=area.width, height=area.height)
        pg.insert_text((0, area.height - (tam * 0.21 if desce else tam * 0.02)), ref, fontsize=tam, fontname=nome)
        b = _tinta(pg.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, alpha=False))
        tmp.close()
        notas[(fam, negrito)] = (_encaixe(a, b), tam)
    if not notas:
        return "sans", False, area.height * 0.8
    # a digitalização (JPEG, borrão) engrossa os traços: negrito só com vantagem clara sobre o normal
    for fam in ("serif", "sans"):
        if (fam, True) in notas and (fam, False) in notas and notas[(fam, True)][0] < notas[(fam, False)][0] * 1.10:
            del notas[(fam, True)]
    (fam, negrito), (_, tam) = max(notas.items(), key=lambda kv: kv[1][0])
    return fam, negrito, tam


def _familia_da_pagina(page, contexto: list[dict]) -> str | None:
    """Votação entre várias linhas da página: documentos quase sempre usam uma só fonte no corpo."""
    votos = {"serif": 0, "sans": 0}
    for c in contexto[:10]:
        t = str(c.get("text", "")).strip()
        if len(t) < 6:
            continue
        fam, _, _ = _fonte_parecida(page, pymupdf.Rect(c["rect"]), t)
        votos[fam] += 1
    if not any(votos.values()):
        return None
    return max(votos, key=votos.get)


def _editar_escaneado(page, area: pymupdf.Rect, texto: str, original: str, contexto: list[dict] | None = None):
    """Página escaneada: pinta a linha com a cor do papel (apagando os pixels da foto)
    e escreve o texto novo como texto de verdade, na cor da tinta."""
    # tudo é lido da imagem ANTES de apagar a linha
    papel, tinta = _cores_da_area(page, area)
    ref = (original or texto).strip()
    fam, negrito, tam = _fonte_parecida(page, area, ref)
    fam_pagina = _familia_da_pagina(page, contexto or [])
    if fam_pagina and fam_pagina != fam:
        # a linha sozinha discordou da página: segue a página, recalculando o tamanho pela largura
        fam, negrito = fam_pagina, False
        nome = "tiro" if fam == "serif" else "helv"
        larg1 = pymupdf.Font(nome).text_length(ref, fontsize=1)
        if larg1 > 0:
            tam = area.width / larg1
    page.add_redact_annot(area + (-1.5, -1.5, 1.5, 1.5), fill=papel)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    if not texto.strip():
        return
    tam = max(4.0, min(tam, area.height * 1.6))
    base = area.y1 - (tam * 0.21 if any(c in _DESCE for c in ref) else tam * 0.02)
    for i, linha in enumerate(texto.split("\n")):
        if linha:
            page.insert_text((area.x0, base + i * tam * 1.2), linha, fontsize=tam, color=tinta,
                             **_fonte(fam, negrito, False, linha))


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
        texto = str(e.get("text", ""))
        if e.get("scanned"):
            _editar_escaneado(page, area, texto, str(e.get("original", "")), e.get("context"))
            feitas += 1
            continue
        spans = [s for b in page.get_text("dict", clip=area)["blocks"] for l in b.get("lines", [])
                 for s in l["spans"] if s["text"].strip() and s.get("alpha", 255) > 0]
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


def linhas(entrada: str, pagina: int, tessdata: str | None = None) -> list[dict]:
    """Linhas editáveis de uma página. Texto normal vem como está; página escaneada usa a
    camada de OCR que já existir ou faz o OCR na hora (sem alterar o arquivo)."""
    doc = pymupdf.open(entrada)
    try:
        page = doc[pagina]
        normais = _linhas_da_pagina(page, visiveis=True)
        if normais:
            return normais
        ocr = _linhas_da_pagina(page, visiveis=False)  # camada de OCR já gravada
        if not ocr and tessdata:
            tp = page.get_textpage_ocr(flags=0, language="por+eng", dpi=300, full=True, tessdata=tessdata)
            ocr = _linhas_da_pagina(page, visiveis=False, textpage=tp)
        for l in ocr:
            l["scanned"] = True
        return ocr
    finally:
        doc.close()


def _linhas_da_pagina(page, visiveis: bool, textpage=None) -> list[dict]:
    """Linhas de texto da página, com formatação e caixa (no sistema de coordenadas que o usuário vê).
    visiveis=False pega o texto invisível/OCR (camada sobre a foto escaneada)."""
    rot = page.rotation_matrix if page.rotation else None
    out = []
    for b in page.get_text("dict", textpage=textpage)["blocks"]:
        for l in b.get("lines", []):
            if textpage is not None:
                spans = [s for s in l["spans"] if s["text"].strip()]
            elif visiveis:
                spans = [s for s in l["spans"] if s["text"].strip() and s.get("alpha", 255) > 0]
            else:
                spans = [s for s in l["spans"] if s["text"].strip() and s.get("alpha", 255) == 0]
            if not spans:
                continue
            ref = max(spans, key=lambda s: len(s["text"]))
            fam, negrito, italico = _estilo(ref)
            r = pymupdf.Rect(spans[0]["bbox"])
            for s in spans[1:]:
                r |= pymupdf.Rect(s["bbox"])
            if rot is not None:
                r = r * rot
            out.append({"text": " ".join(s["text"].strip() for s in spans), "bbox": [r.x0, r.y0, r.x1, r.y1],
                        "size": ref["size"], "bold": negrito, "italic": italico, "family": fam,
                        "color": "#%06x" % ref["color"]})
    return out
