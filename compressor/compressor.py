"""Núcleo de compressão de PDF (sem interface). Usa PyMuPDF."""
import io
import os

import pymupdf
from PIL import Image

# nível -> (dpi_limite, dpi_alvo, qualidade_jpeg)
NIVEIS = {
    "Leve":   (200, 150, 85),   # quase sem perda visível
    "Média":  (150, 120, 70),   # bom equilíbrio (padrão)
    "Forte":  (110, 96, 55),    # máximo de redução, p/ e-mail/WhatsApp
}


def tamanho_fmt(n: int) -> str:
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {u}" if u != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} TB"


def comprimir(entrada: str, saida: str, nivel: str = "Média", cinza: bool = False) -> dict:
    """Comprime `entrada` em `saida`. Retorna dict com tamanhos.
    Se o resultado ficar maior que o original, copia o original."""
    dpi_lim, dpi_alvo, qualidade = NIVEIS[nivel]
    antes = os.path.getsize(entrada)

    doc = pymupdf.open(entrada)
    if doc.needs_pass:
        doc.close()
        raise ValueError("PDF protegido por senha")

    # Reamostra e recomprime as imagens (onde está quase todo o peso)
    doc.rewrite_images(
        dpi_threshold=dpi_lim,
        dpi_target=dpi_alvo,
        quality=qualidade,
        lossy=True,
        lossless=True,
        bitonal=True,
        color=True,
        gray=True,
        set_to_gray=cinza,
    )
    # Segunda passada: imagens que o rewrite_images não alcançou
    # (ex.: PDFs de sistemas web com recursos herdados entre páginas)
    _reduzir_imagens(doc, dpi_lim, dpi_alvo, qualidade, cinza)
    # Solta as imagens originais que ficam presas em recursos herdados
    _limpar_recursos_herdados(doc)

    # Remove dados mortos, fontes duplicadas, metadados XML
    doc.subset_fonts()
    doc.scrub(metadata=False, xml_metadata=True, thumbnails=True,
              embedded_files=False, attached_files=False, javascript=True,
              reset_fields=False, reset_responses=False, redactions=False,
              redact_images=0, remove_links=False, hidden_text=False)
    doc.save(saida, garbage=4, deflate=True, deflate_images=True,
             deflate_fonts=True, clean=True, use_objstms=1)
    doc.close()

    depois = os.path.getsize(saida)
    modo = "normal"

    # Pouco ganho? Tenta converter as páginas em imagem (PDFs vetoriais/sistemas)
    if depois > antes * 0.90:
        tmp = saida + ".tmp"
        try:
            _rasterizar(entrada, tmp, dpi_alvo, qualidade, cinza)
            if os.path.getsize(tmp) < min(depois, antes * 0.90):
                os.replace(tmp, saida)
                depois = os.path.getsize(saida)
                modo = "imagem"
        except Exception:  # noqa: BLE001
            pass
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    if depois >= antes:  # não piorou: mantém o original
        with open(entrada, "rb") as f_in, open(saida, "wb") as f_out:
            f_out.write(f_in.read())
        depois = antes
        modo = "original"

    return {"antes": antes, "depois": depois, "modo": modo,
            "reducao": 0 if antes == 0 else (1 - depois / antes) * 100}


def _limpar_recursos_herdados(doc):
    """Se toda página já tem /Resources próprio, remove o /Resources dos nós /Pages.
    Sem isso, as imagens originais continuam referenciadas e não saem do arquivo."""
    try:
        if any(doc.xref_get_key(p.xref, "Resources")[0] == "null" for p in doc):
            return
        for x in range(1, doc.xref_length()):
            if doc.xref_get_key(x, "Type")[1] == "/Pages" and \
                    doc.xref_get_key(x, "Resources")[0] != "null":
                doc.xref_set_key(x, "Resources", "null")
    except Exception:  # noqa: BLE001
        pass


def _reduzir_imagens(doc, dpi_lim: int, dpi_alvo: int, qualidade: int, cinza: bool):
    """Reamostra manualmente imagens acima do DPI limite, mantendo texto intacto."""
    # maior DPI efetivo de cada imagem (pode aparecer em várias páginas)
    usos: dict[int, tuple] = {}
    for page in doc:
        for info in page.get_image_info(xrefs=True):
            x = info.get("xref")
            larg_pt = abs(info["bbox"][2] - info["bbox"][0])
            alt_pt = abs(info["bbox"][3] - info["bbox"][1])
            if not x or larg_pt < 1 or alt_pt < 1:
                continue
            dpi = max(info["width"] / (larg_pt / 72), info["height"] / (alt_pt / 72))
            if x not in usos or dpi > usos[x][0]:
                usos[x] = (dpi, page)
    for x, (dpi, page) in usos.items():
        try:
            if dpi <= dpi_lim:
                continue
            if doc.xref_get_key(x, "SMask")[0] != "null" or doc.xref_get_key(x, "Mask")[0] != "null":
                continue  # imagens com transparência: não mexe
            img = Image.open(io.BytesIO(doc.extract_image(x)["image"]))
            img = img.convert("L" if cinza or img.mode in ("L", "1") else "RGB")
            fator = dpi_alvo / dpi
            img = img.resize((max(1, round(img.width * fator)), max(1, round(img.height * fator))),
                             Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=qualidade, optimize=True)
            if len(buf.getvalue()) < len(doc.xref_stream_raw(x)):
                page.replace_image(x, stream=buf.getvalue())
        except Exception:  # noqa: BLE001
            continue


def _rasterizar(entrada: str, saida: str, dpi: int, qualidade: int, cinza: bool):
    """Recria o PDF com cada página como uma imagem JPEG."""
    src = pymupdf.open(entrada)
    out = pymupdf.open()
    cs = pymupdf.csGRAY if cinza else pymupdf.csRGB
    for pg in src:
        pix = pg.get_pixmap(dpi=dpi, colorspace=cs, alpha=False)
        nova = out.new_page(width=pg.rect.width, height=pg.rect.height)
        nova.insert_image(nova.rect, stream=pix.tobytes("jpg", jpg_quality=qualidade))
    out.save(saida, garbage=4, deflate=True)
    out.close()
    src.close()


def nome_saida(entrada: str, pasta_saida: str | None = None) -> str:
    base, _ = os.path.splitext(os.path.basename(entrada))
    pasta = pasta_saida or os.path.dirname(entrada)
    return os.path.join(pasta, f"{base}_comprimido.pdf")
