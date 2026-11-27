import { openPdf, type PDFDoc } from "./pdfjs";
import type { Tab } from "./types";

// Cache dos documentos do pdf.js por aba (id + versão dos bytes).
const cache = new Map<string, { version: number; promise: Promise<PDFDoc> }>();

export function getDoc(tab: Pick<Tab, "id" | "version" | "bytes">): Promise<PDFDoc> {
  const c = cache.get(tab.id);
  if (c && c.version === tab.version) return c.promise;
  if (c) c.promise.then((d) => d.destroy()).catch(() => {});
  const promise = openPdf(tab.bytes);
  cache.set(tab.id, { version: tab.version, promise });
  promise.catch(() => cache.delete(tab.id));
  return promise;
}

export function dropDoc(id: string) {
  const c = cache.get(id);
  if (c) c.promise.then((d) => d.destroy()).catch(() => {});
  cache.delete(id);
}

export function peekDoc(id: string) {
  return cache.get(id)?.promise;
}
