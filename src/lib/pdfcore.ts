// Funções básicas de PDF sem dependência do pdf.js (usadas por várias ferramentas).
import { PDFDocument, PDFRef, PDFDict, PDFArray, PDFStream, type PDFFont } from "pdf-lib";

export const TEXT_PAD = 4;
export const LINE_H = 1.25;

export async function loadForEdit(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e))) throw new Error("Este PDF é protegido por senha. Remova a proteção para poder editá-lo.");
    throw e;
  }
}

/** Troca caracteres que a fonte padrão não consegue escrever. */
export function sanitize(font: PDFFont, s: string) {
  const set = new Set(font.getCharacterSet());
  return [...s].map((c) => (c === "\n" || set.has(c.codePointAt(0)!) ? c : c === "—" ? "-" : "?")).join("");
}

export function wrapText(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const test = line + w;
      if (measure(test.trimEnd()) <= maxW || !line.trim()) line = test;
      else {
        out.push(line.trimEnd());
        line = w.trimStart();
      }
      while (measure(line) > maxW && line.length > 1) {
        // palavra maior que a caixa: quebra no meio
        let k = line.length - 1;
        while (k > 1 && measure(line.slice(0, k)) > maxW) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}


/** Remove objetos que não são mais referenciados (páginas excluídas etc.). */
export function garbageCollect(doc: PDFDocument) {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: unknown[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  while (stack.length) {
    const v = stack.pop();
    if (!v) continue;
    if (v instanceof PDFRef) {
      const k = v.tag;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(ctx.lookup(v));
    } else if (v instanceof PDFDict) stack.push(...v.values());
    else if (v instanceof PDFArray) stack.push(...v.asArray());
    else if (v instanceof PDFStream) stack.push(...v.dict.values());
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref);
}

