// Assinar vários PDFs de uma vez: com certificado digital (PAdES) ou com uma imagem
// (carimbo pessoal em PNG / assinatura feita à mão), sempre no mesmo lugar da página.
import { degrees } from "pdf-lib";
import { openPdf } from "./pdfjs";
import { loadForEdit } from "./pdfcore";
import { hasSignatures, incrementalSave, snapshot } from "./incremental";
import { finishSignature, prepareSignature, type PreparedSig, type Signer } from "./sign";
import { track } from "./telemetry";

export type PageRule = "primeira" | "ultima" | "todas" | number;

/** Onde assinar: posição em fração da página (canto superior esquerdo) e tamanho em pontos. */
export type Place = { page: PageRule; rx: number; ry: number; w: number; h: number };

export type BatchFile = { name: string; path?: string; bytes: Uint8Array };

export type BatchMode =
  | { kind: "cert"; signer: Signer; reason: string; location: string; showDoc: boolean; visible: boolean; image?: Uint8Array }
  | { kind: "image"; png: Uint8Array };

export function pagesFor(rule: PageRule, n: number): number[] {
  if (rule === "todas") return Array.from({ length: n }, (_, i) => i);
  if (rule === "primeira") return [0];
  if (rule === "ultima") return [n - 1];
  return [Math.min(Math.max(1, rule), n) - 1];
}

/** Retângulo (em unidades da página como é vista) para uma página de tamanho W×H. */
export function rectOn(p: Place, W: number, H: number) {
  const k = Math.min(1, W / p.w, H / p.h); // página menor: encolhe mantendo a proporção
  const w = p.w * k, h = p.h * k;
  const x = Math.min(Math.max(0, p.rx * W), W - w);
  const y = Math.min(Math.max(0, p.ry * H), H - h);
  return { x, y, w, h };
}

type Viewport = { width: number; height: number; rotation: number; convertToPdfPoint: (x: number, y: number) => number[] };

async function viewports(bytes: Uint8Array) {
  const pdf = await openPdf(bytes);
  try {
    const vps: Viewport[] = [];
    for (let i = 1; i <= pdf.numPages; i++) vps.push((await pdf.getPage(i)).getViewport({ scale: 1 }));
    return vps;
  } finally {
    pdf.destroy();
  }
}

/** Grava a imagem nas páginas escolhidas. */
async function stampImage(bytes: Uint8Array, png: Uint8Array, place: Place): Promise<Uint8Array> {
  const vps = await viewports(bytes);
  const signed = hasSignatures(bytes);
  const doc = await loadForEdit(bytes);
  const snap = signed ? snapshot(doc) : null;
  let img;
  try { img = await doc.embedPng(png); } catch { img = await doc.embedJpg(png); }
  const pages = doc.getPages();
  for (const i of pagesFor(place.page, pages.length)) {
    const vp = vps[i];
    const r = rectOn(place, vp.width, vp.height);
    const [x, y] = vp.convertToPdfPoint(r.x, r.y + r.h); // canto inferior esquerdo visual
    pages[i].drawImage(img, { x, y, width: r.w, height: r.h, rotate: degrees(vp.rotation) });
  }
  return snap ? incrementalSave(doc, bytes, snap) : doc.save({ useObjectStreams: true });
}

export type Progress = (i: number, status: "ok" | "err" | "run", msg?: string) => void;

/**
 * Processa a lista. Devolve o resultado de cada arquivo (bytes assinados ou erro).
 * Com certificado: prepara todos, assina todos numa só chamada (um PIN) e finaliza.
 */
export async function signBatch(files: BatchFile[], mode: BatchMode, place: Place, progress: Progress): Promise<(Uint8Array | Error)[]> {
  const res: (Uint8Array | Error)[] = files.map(() => new Error("não processado"));
  const fail = (i: number, e: unknown) => {
    res[i] = e instanceof Error ? e : new Error(String(e));
    progress(i, "err", res[i].message);
  };

  if (mode.kind === "image") {
    for (let i = 0; i < files.length; i++) {
      progress(i, "run");
      try {
        res[i] = await stampImage(files[i].bytes, mode.png, place);
        progress(i, "ok");
      } catch (e) { fail(i, e); }
    }
    track("assinar_lote", { tipo: "imagem", arquivos: files.length });
    return res;
  }

  const prep: (PreparedSig | null)[] = [];
  for (let i = 0; i < files.length; i++) {
    progress(i, "run");
    try {
      const vps = await viewports(files[i].bytes);
      const page = pagesFor(place.page === "todas" ? "ultima" : place.page, vps.length)[0];
      const vp = vps[page];
      prep[i] = await prepareSignature(files[i].bytes, mode.signer.summary, {
        page,
        rect: mode.visible ? rectOn(place, vp.width, vp.height) : null,
        viewport: vp,
        reason: mode.reason,
        location: mode.location,
        showDoc: mode.showDoc,
        image: mode.image,
      });
    } catch (e) {
      prep[i] = null;
      fail(i, e);
    }
  }
  const idx = prep.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return res;

  let cms: Uint8Array[];
  try {
    const data = idx.map((i) => prep[i]!.toSign);
    cms = mode.signer.signMany ? await mode.signer.signMany(data) : await Promise.all(data.map((d) => mode.signer.sign(d)));
  } catch (e) {
    idx.forEach((i) => fail(i, e));
    return res;
  }
  idx.forEach((i, k) => {
    try {
      res[i] = finishSignature(prep[i]!, cms[k]);
      progress(i, "ok");
    } catch (e) { fail(i, e); }
  });
  track("assinar_lote", { tipo: "certificado", arquivos: idx.length });
  return res;
}
