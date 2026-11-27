// Compressão: recomprime as imagens (onde está quase todo o peso), remove
// objetos órfãos e usa object streams. Roda 100% local.
import { PDFDict, PDFName, PDFNumber, PDFRawStream, PDFArray, PDFBool } from "pdf-lib";
import { inflate } from "pako";
import { loadForEdit, garbageCollect } from "./pdfcore";


export type Level = "Leve" | "Média" | "Forte";
export const LEVELS: Record<Level, { max: number; q: number; min: number; desc: string }> = {
  Leve: { max: 2400, q: 0.85, min: 120_000, desc: "Quase sem perda — bom para impressão" },
  Média: { max: 1600, q: 0.72, min: 60_000, desc: "Equilíbrio entre qualidade e tamanho" },
  Forte: { max: 1100, q: 0.55, min: 25_000, desc: "Máxima redução — WhatsApp e e-mail" },
};

function unPredict(data: Uint8Array, w: number, h: number, ch: number): Uint8Array {
  const bpp = ch;
  const row = w * ch;
  const out = new Uint8Array(row * h);
  let prev = new Uint8Array(row);
  for (let y = 0; y < h; y++) {
    const ft = data[y * (row + 1)];
    const src = data.subarray(y * (row + 1) + 1, (y + 1) * (row + 1));
    const cur = out.subarray(y * row, (y + 1) * row);
    for (let x = 0; x < row; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return out;
}

function channelsOf(cs: unknown, dict: PDFDict): number {
  if (cs instanceof PDFName) {
    const n = cs.asString();
    return n === "/DeviceRGB" || n === "/CalRGB" ? 3 : n === "/DeviceGray" || n === "/CalGray" ? 1 : 0;
  }
  if (cs instanceof PDFArray && cs.size() >= 2) {
    const kind = cs.get(0);
    if (kind instanceof PDFName && kind.asString() === "/ICCBased") {
      const s = dict.context.lookup(cs.get(1));
      const n = (s as PDFRawStream)?.dict?.get(PDFName.of("N"));
      const v = n instanceof PDFNumber ? n.asNumber() : 0;
      return v === 3 || v === 1 ? v : 0;
    }
  }
  return 0;
}

const filterName = (f: unknown): string | null => {
  if (f instanceof PDFName) return f.asString();
  if (f instanceof PDFArray && f.size() === 1 && f.get(0) instanceof PDFName) return (f.get(0) as PDFName).asString();
  return f === undefined ? "" : null;
};

export async function compressPdf(
  bytes: Uint8Array,
  level: Level,
  gray: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; images: number }> {
  const { max, q, min } = LEVELS[level];
  const doc = await loadForEdit(bytes);
  const ctx = doc.context;
  const N = (s: string) => PDFName.of(s);
  const candidates = ctx.enumerateIndirectObjects().filter(([, o]) => {
    if (!(o instanceof PDFRawStream)) return false;
    const st = o.dict.get(N("Subtype"));
    return st instanceof PDFName && st.asString() === "/Image" && o.contents.length >= min;
  }) as [import("pdf-lib").PDFRef, PDFRawStream][];

  let changed = 0;
  for (let i = 0; i < candidates.length; i++) {
    onProgress?.(i, candidates.length);
    const [ref, s] = candidates[i];
    const d = s.dict;
    try {
      if (d.get(N("ImageMask")) === PDFBool.True || d.get(N("Decode"))) continue;
      const bpc = d.lookup(N("BitsPerComponent"));
      if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) continue;
      const w = (d.lookup(N("Width")) as PDFNumber).asNumber();
      const h = (d.lookup(N("Height")) as PDFNumber).asNumber();
      const ch = channelsOf(d.lookup(N("ColorSpace")), d);
      if (!ch) continue;
      const filter = filterName(d.lookup(N("Filter")));

      let bitmap: ImageBitmap;
      if (filter === "/DCTDecode") {
        bitmap = await createImageBitmap(new Blob([s.contents as BlobPart], { type: "image/jpeg" }));
      } else if (filter === "/FlateDecode" || filter === "") {
        let raw = filter ? inflate(s.contents) : s.contents;
        const parms = d.lookup(N("DecodeParms"));
        const pred = parms instanceof PDFDict ? parms.lookup(N("Predictor")) : undefined;
        if (pred instanceof PDFNumber && pred.asNumber() >= 10) raw = unPredict(raw, w, h, ch);
        else if (pred instanceof PDFNumber && pred.asNumber() > 1) continue;
        if (raw.length < w * h * ch) continue;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let p = 0, k = 0; p < w * h; p++, k += ch) {
          rgba[p * 4] = raw[k];
          rgba[p * 4 + 1] = raw[k + (ch === 3 ? 1 : 0)];
          rgba[p * 4 + 2] = raw[k + (ch === 3 ? 2 : 0)];
          rgba[p * 4 + 3] = 255;
        }
        bitmap = await createImageBitmap(new ImageData(rgba, w, h));
      } else continue;

      const sc = Math.min(1, max / Math.max(w, h));
      const nw = Math.max(1, Math.round(w * sc)), nh = Math.max(1, Math.round(h * sc));
      const cv = new OffscreenCanvas(nw, nh);
      const c2 = cv.getContext("2d")!;
      c2.fillStyle = "#fff";
      c2.fillRect(0, 0, nw, nh);
      c2.imageSmoothingQuality = "high";
      c2.drawImage(bitmap, 0, 0, nw, nh);
      bitmap.close();
      if (gray || ch === 1) {
        const id = c2.getImageData(0, 0, nw, nh);
        const p = id.data;
        for (let k = 0; k < p.length; k += 4) p[k] = p[k + 1] = p[k + 2] = (p[k] * 299 + p[k + 1] * 587 + p[k + 2] * 114) / 1000;
        c2.putImageData(id, 0, 0);
      }
      const jpg = new Uint8Array(await (await cv.convertToBlob({ type: "image/jpeg", quality: q })).arrayBuffer());
      if (jpg.length >= s.contents.length * 0.92) continue;

      const nd = d.clone(ctx);
      for (const k of ["Filter", "DecodeParms", "Length", "ColorSpace", "Width", "Height", "BitsPerComponent"]) nd.delete(N(k));
      nd.set(N("Width"), PDFNumber.of(nw));
      nd.set(N("Height"), PDFNumber.of(nh));
      nd.set(N("ColorSpace"), N("DeviceRGB"));
      nd.set(N("BitsPerComponent"), PDFNumber.of(8));
      nd.set(N("Filter"), N("DCTDecode"));
      ctx.assign(ref, PDFRawStream.of(nd, jpg));
      changed++;
    } catch (e) {
      console.warn("imagem ignorada", e);
    }
  }
  onProgress?.(candidates.length, candidates.length);
  garbageCollect(doc);
  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out.length < bytes.length ? out : bytes, images: changed };
}
