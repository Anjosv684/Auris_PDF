import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
// O pdf_viewer.mjs lê a biblioteca do escopo global
(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib;

export { pdfjsLib };
export const viewerLib = await import("pdfjs-dist/web/pdf_viewer.mjs");

export type PDFDoc = pdfjsLib.PDFDocumentProxy;

type PasswordAsker = (retry: boolean) => Promise<string | null>;
let askPassword: PasswordAsker = async () => null;
export const setPasswordAsker = (fn: PasswordAsker) => (askPassword = fn);

// senha usada para abrir cada documento (repassada à impressão nativa)
const passwords = new WeakMap<PDFDoc, string>();
export const passwordOf = (pdf: PDFDoc) => passwords.get(pdf);

export async function openPdf(bytes: Uint8Array): Promise<PDFDoc> {
  // o pdf.js transfere o buffer para o worker; mandamos uma cópia
  const task = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false });
  let used: string | undefined;
  task.onPassword = async (update: (p: string) => void, reason: number) => {
    const pwd = await askPassword(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
    if (pwd === null) task.destroy();
    else update((used = pwd));
  };
  const pdf = await task.promise;
  if (used !== undefined) passwords.set(pdf, used);
  return pdf;
}

/** Renderiza uma página em canvas (miniaturas, impressão, exportar imagem). */
export async function renderPage(
  pdf: PDFDoc,
  pageNo: number,
  opts: { width?: number; scale?: number; rotation?: number; canvas?: HTMLCanvasElement },
) {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1, rotation: ((page.rotate + (opts.rotation ?? 0)) % 360 + 360) % 360 });
  const scale = opts.scale ?? (opts.width ? opts.width / base.width : 1);
  const vp = page.getViewport({ scale, rotation: base.rotation });
  const canvas = opts.canvas ?? document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE }).promise;
  return canvas;
}
