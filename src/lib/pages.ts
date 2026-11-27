// Operações de páginas: organizar, juntar, dividir, converter.
import {
  PDFDocument, PDFName, PDFNumber, PDFRef, PDFDict, PDFPage, degrees, PageSizes,
} from "pdf-lib";
import { loadForEdit, garbageCollect } from "./pdfcore";
export { garbageCollect };
import { normalizeImage, dataUrlToBytes, blobToDataUrl } from "./util";

export type OrgItem =
  | { kind: "page"; index: number; rot: number; key: string }
  | { kind: "ext"; file: string; index: number; rot: number; key: string }
  | { kind: "blank"; w: number; h: number; rot: number; key: string };

const INHERIT = ["Resources", "MediaBox", "CropBox", "Rotate"].map((n) => PDFName.of(n));

export async function applyOrganize(
  bytes: Uint8Array,
  items: OrgItem[],
  ext: Map<string, Uint8Array>,
): Promise<Uint8Array> {
  if (!items.length) throw new Error("O documento precisa ter pelo menos uma página.");
  const doc = await loadForEdit(bytes);
  const pages = doc.getPages();
  const used = new Set<number>();
  const extDocs = new Map<string, PDFDocument>();
  const final: PDFPage[] = [];

  for (const it of items) {
    let page: PDFPage;
    if (it.kind === "page") {
      if (used.has(it.index)) [page] = await doc.copyPages(doc, [it.index]);
      else page = pages[it.index];
      used.add(it.index);
    } else if (it.kind === "ext") {
      let src = extDocs.get(it.file);
      if (!src) extDocs.set(it.file, (src = await loadForEdit(ext.get(it.file)!)));
      [page] = await doc.copyPages(src, [it.index]);
    } else {
      page = PDFPage.create(doc);
      page.setSize(it.w, it.h);
    }
    for (const n of INHERIT) {
      if (!page.node.get(n)) {
        const v = page.node.getInheritableAttribute(n);
        if (v) page.node.set(n, v);
      }
    }
    if (it.rot) page.setRotation(degrees((((page.getRotation().angle + it.rot) % 360) + 360) % 360));
    final.push(page);
  }

  const rootRef = doc.catalog.get(PDFName.of("Pages")) as PDFRef;
  const root = doc.catalog.lookup(PDFName.of("Pages"), PDFDict);
  for (const p of final) p.node.set(PDFName.of("Parent"), rootRef);
  root.set(PDFName.of("Kids"), doc.context.obj(final.map((p) => p.ref)));
  root.set(PDFName.of("Count"), PDFNumber.of(final.length));
  garbageCollect(doc);
  return doc.save({ useObjectStreams: true });
}

export type MergeInput = { name: string; bytes: Uint8Array; pages?: number[] };

export async function mergePdfs(files: MergeInput[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await loadForEdit(f.bytes);
    const idx = f.pages ?? src.getPageIndices();
    const copied = await out.copyPages(src, idx);
    copied.forEach((p) => out.addPage(p));
  }
  out.setProducer("Auris PDF");
  return out.save({ useObjectStreams: true });
}

export async function extractPages(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const src = await loadForEdit(bytes);
  const res: Uint8Array[] = [];
  for (const g of groups) {
    const out = await PDFDocument.create();
    (await out.copyPages(src, g)).forEach((p) => out.addPage(p));
    res.push(await out.save({ useObjectStreams: true }));
  }
  return res;
}

export async function imagesToPdf(
  images: { name: string; bytes: Uint8Array }[],
  mode: "a4" | "image",
  margin = 24,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const ext = im.name.split(".").pop()!.toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : `image/${ext}`;
    const url = await blobToDataUrl(new Blob([im.bytes as BlobPart], { type: mime }));
    const n = await normalizeImage(url);
    const { bytes, mime: m } = dataUrlToBytes(n.src);
    const img = m === "image/jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    if (mode === "image") {
      const w = img.width * 0.75, h = img.height * 0.75;
      doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    } else {
      const land = img.width > img.height;
      const [W, H] = land ? [PageSizes.A4[1], PageSizes.A4[0]] : PageSizes.A4;
      const s = Math.min((W - margin * 2) / img.width, (H - margin * 2) / img.height);
      const w = img.width * s, h = img.height * s;
      doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
    }
  }
  doc.setProducer("Auris PDF");
  return doc.save({ useObjectStreams: true });
}

export async function pdfToImages(
  bytes: Uint8Array,
  pages: number[],
  dpi: number,
  format: "png" | "jpeg",
  onProgress?: (i: number) => void,
): Promise<Uint8Array[]> {
  const { openPdf, renderPage } = await import("./pdfjs");
  const pdf = await openPdf(bytes);
  const out: Uint8Array[] = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i);
    const c = await renderPage(pdf, pages[i] + 1, { scale: dpi / 72 });
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), `image/${format}`, 0.9));
    out.push(new Uint8Array(await blob.arrayBuffer()));
    c.width = c.height = 0;
  }
  await pdf.destroy();
  return out;
}
