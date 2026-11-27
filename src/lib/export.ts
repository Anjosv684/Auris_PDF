// Grava os objetos (imagens, formas, textos, carimbos...) dentro do PDF.
import {
  PDFDocument, PDFFont, PDFImage, StandardFonts, rgb, degrees, LineCapStyle, BlendMode,
} from "pdf-lib";
import { loadForEdit, sanitize, wrapText, TEXT_PAD, LINE_H } from "./pdfcore";
export { loadForEdit, sanitize, wrapText, TEXT_PAD, LINE_H };
import type { PDFDoc } from "./pdfjs";
import type { Obj, Tab, TextObj } from "./types";
import { dataUrlToBytes, hexToRgb01 } from "./util";
import { getDoc } from "./docs";
import { hasSignatures, incrementalSave, snapshot } from "./incremental";

const col = (hex: string) => rgb(...hexToRgb01(hex));

export async function bakeObjects(doc: PDFDocument, objects: Obj[], pdf: PDFDoc) {
  if (!objects.length) return;
  const fonts: Record<string, PDFFont> = {};
  const font = async (bold: boolean) => {
    const k = bold ? "b" : "r";
    return (fonts[k] ??= await doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica));
  };
  const images = new Map<string, PDFImage>();
  const pages = doc.getPages();

  for (const o of objects) {
    if (o.type === "sigfield") continue;
    const page = pages[o.page];
    if (!page) continue;
    const vp = (await pdf.getPage(o.page + 1)).getViewport({ scale: 1 });
    const rot = degrees(vp.rotation);
    const pt = (x: number, y: number) => {
      const [px, py] = vp.convertToPdfPoint(x, y);
      return { x: px, y: py };
    };
    const bl = pt(o.x, o.y + o.h); // canto inferior esquerdo visual
    const opacity = o.opacity ?? 1;

    switch (o.type) {
      case "image": {
        let img = images.get(o.src);
        if (!img) {
          const { bytes, mime } = dataUrlToBytes(o.src);
          img = mime === "image/jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
          images.set(o.src, img);
        }
        page.drawImage(img, { ...bl, width: o.w, height: o.h, rotate: rot, opacity });
        break;
      }
      case "highlight":
        page.drawRectangle({ ...bl, width: o.w, height: o.h, rotate: rot, color: col(o.color), opacity: 0.45 * opacity, blendMode: BlendMode.Multiply });
        break;
      case "rect":
        page.drawRectangle({
          ...bl, width: o.w, height: o.h, rotate: rot,
          borderColor: col(o.stroke), borderWidth: o.strokeWidth, borderOpacity: opacity,
          color: o.fill ? col(o.fill) : undefined, opacity,
        });
        break;
      case "ellipse": {
        const c = pt(o.x + o.w / 2, o.y + o.h / 2);
        page.drawEllipse({
          ...c, xScale: o.w / 2, yScale: o.h / 2, rotate: rot,
          borderColor: col(o.stroke), borderWidth: o.strokeWidth, borderOpacity: opacity,
          color: o.fill ? col(o.fill) : undefined, opacity,
        });
        break;
      }
      case "line": {
        const a = o.dir === 0 ? [o.x, o.y] : [o.x, o.y + o.h];
        const b = o.dir === 0 ? [o.x + o.w, o.y + o.h] : [o.x + o.w, o.y];
        const [s, e] = o.rev ? [b, a] : [a, b];
        const S = pt(s[0], s[1]), E = pt(e[0], e[1]);
        const opts = { thickness: o.strokeWidth, color: col(o.stroke), opacity, lineCap: LineCapStyle.Round };
        page.drawLine({ start: S, end: E, ...opts });
        if (o.arrow) {
          const ang = Math.atan2(E.y - S.y, E.x - S.x);
          const L = Math.max(8, o.strokeWidth * 4);
          for (const d of [Math.PI * 0.82, -Math.PI * 0.82])
            page.drawLine({ start: E, end: { x: E.x + L * Math.cos(ang + d), y: E.y + L * Math.sin(ang + d) }, ...opts });
        }
        break;
      }
      case "ink": {
        const opts = { thickness: o.strokeWidth, color: col(o.stroke), opacity, lineCap: LineCapStyle.Round };
        for (const s of o.points) {
          let prev = pt(o.x + s[0] * o.w, o.y + s[1] * o.h);
          if (s.length === 2) page.drawLine({ start: prev, end: { x: prev.x + 0.01, y: prev.y }, ...opts });
          for (let i = 2; i < s.length; i += 2) {
            const p = pt(o.x + s[i] * o.w, o.y + s[i + 1] * o.h);
            page.drawLine({ start: prev, end: p, ...opts });
            prev = p;
          }
        }
        break;
      }
      case "text":
        await drawTextBox(page, o, await font(o.bold), pt, rot, opacity);
        break;
      case "stamp": {
        const c = col(o.color);
        page.drawRectangle({ ...bl, width: o.w, height: o.h, rotate: rot, borderColor: c, borderWidth: 2.5, opacity: 0, borderOpacity: opacity });
        const fb = await font(true), fr = await font(false);
        const label = sanitize(fb, o.label);
        let size = Math.min(o.h * 0.42, (o.w * 0.86) / Math.max(1, fb.widthOfTextAtSize(label, 1)));
        const lw = fb.widthOfTextAtSize(label, size);
        const dsize = Math.min(o.h * 0.2, size * 0.5);
        const hasDate = !!o.date;
        const ly = o.y + (hasDate ? o.h * 0.55 : o.h / 2 + size * 0.36);
        page.drawText(label, { ...pt(o.x + (o.w - lw) / 2, ly), size, font: fb, color: c, rotate: rot, opacity });
        if (hasDate) {
          const d = sanitize(fr, o.date);
          const dw = fr.widthOfTextAtSize(d, dsize);
          page.drawText(d, { ...pt(o.x + (o.w - dw) / 2, o.y + o.h * 0.82), size: dsize, font: fr, color: c, rotate: rot, opacity });
        }
        break;
      }
    }
  }
}

async function drawTextBox(
  page: ReturnType<PDFDocument["getPages"]>[number],
  o: TextObj,
  f: PDFFont,
  pt: (x: number, y: number) => { x: number; y: number },
  rot: ReturnType<typeof degrees>,
  opacity: number,
) {
  if (o.bg) page.drawRectangle({ ...pt(o.x, o.y + o.h), width: o.w, height: o.h, rotate: rot, color: col(o.bg), opacity });
  const lines = wrapText(sanitize(f, o.text), o.w - TEXT_PAD * 2, (s) => f.widthOfTextAtSize(s, o.size));
  // mesma posição de linha de base que o CSS (métricas Arial ≈ Helvetica)
  const first = ((LINE_H - 1.117) / 2 + 0.905) * o.size;
  lines.forEach((line, i) => {
    if (!line) return;
    const baseline = o.y + TEXT_PAD + i * o.size * LINE_H + first;
    page.drawText(line, { ...pt(o.x + TEXT_PAD, baseline), size: o.size, font: f, color: col(o.color), rotate: rot, opacity });
  });
}

/** Gera os bytes finais da aba: formulários preenchidos + objetos gravados. */
export async function buildPdf(tab: Tab): Promise<Uint8Array> {
  const pdf = await getDoc(tab);
  let base = tab.bytes;
  if (pdf.annotationStorage.size > 0) base = await pdf.saveDocument();
  const objs = tab.objects.filter((o) => o.type !== "sigfield");
  if (!objs.length) return base;
  const signed = hasSignatures(base);
  const doc = await loadForEdit(base);
  const snap = signed ? snapshot(doc) : null;
  await bakeObjects(doc, objs, pdf);
  return snap ? incrementalSave(doc, base, snap) : doc.save({ useObjectStreams: true });
}
