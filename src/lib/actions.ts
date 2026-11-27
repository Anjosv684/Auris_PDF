// Ações de alto nível usadas pela interface.
import { useStore, getActiveTab, runTask } from "./store";
import { viewerApi } from "./viewerApi";
import { blobToDataUrl, normalizeImage, uid, todayBR, baseName, clamp } from "./util";
import type { Obj, StampObj } from "./types";
import { buildPdf } from "./export";
import { isApp, pickFiles, readPath, saveAs, writePath } from "./platform";
import { getDoc, dropDoc } from "./docs";
import { capture, posthogLog } from "./analytics";

const st = () => useStore.getState();

export async function openFiles() {
  const files = await pickFiles("pdf", true);
  files.forEach(openBytes);
}

export function openBytes(f: { name: string; path?: string; bytes: Uint8Array }) {
  st().openTab(f);
  if (f.path) rememberRecent(f.path);
  const source = f.path ? "local_file" : "generated_or_downloaded";
  capture("pdf_opened", { source });
  posthogLog.info("PDF opened", { source });
}

export async function openPaths(paths: string[]) {
  for (const p of paths) {
    try {
      openBytes(await readPath(p));
    } catch (e) {
      st().toast(`Não foi possível abrir ${p}: ${(e as Error).message}`, "err");
    }
  }
}

// ---------- recentes ----------
export function recents(): string[] {
  try {
    return JSON.parse(localStorage.getItem("auris.recent") || "[]");
  } catch {
    return [];
  }
}
function rememberRecent(p: string) {
  try {
    localStorage.setItem("auris.recent", JSON.stringify([p, ...recents().filter((x) => x !== p)].slice(0, 8)));
  } catch { /* ignore */ }
}

// ---------- objetos ----------
function place(page: number, x: number, y: number, w: number, h: number) {
  const ps = viewerApi.pageSize(page);
  const sc = Math.min(1, (ps.w * 0.6) / w, (ps.h * 0.6) / h);
  w *= sc;
  h *= sc;
  return { page, w, h, x: clamp(x - w / 2, 0, Math.max(0, ps.w - w)), y: clamp(y - h / 2, 0, Math.max(0, ps.h - h)) };
}

export async function addImageAt(src: Blob | string, pt = viewerApi.insertPoint(), maxW = 220) {
  if (!getActiveTab()) return;
  const url = typeof src === "string" ? src : await blobToDataUrl(src);
  const img = await normalizeImage(url);
  const ratio = img.w / img.h;
  const w = Math.min(maxW, img.w * 0.75);
  const obj: Obj = { id: uid(), type: "image", src: img.src, ratio, opacity: 1, ...place(pt.page, pt.x, pt.y, w, w / ratio) };
  st().addObj(obj);
  st().setTool("select");
}

export async function pickAndAddImage() {
  const files = await pickFiles("image", true);
  let pt = viewerApi.insertPoint();
  for (const f of files) {
    const ext = f.name.split(".").pop()!.toLowerCase();
    await addImageAt(new Blob([f.bytes as BlobPart], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }), pt);
    pt = { ...pt, x: pt.x + 16, y: pt.y + 16 };
  }
}

export const STAMPS: { label: string; color: string }[] = [
  { label: "APROVADO", color: "#1E9E5A" },
  { label: "RECEBIDO", color: "#185FA5" },
  { label: "CONFERIDO", color: "#185FA5" },
  { label: "PAGO", color: "#1E9E5A" },
  { label: "REPROVADO", color: "#D93025" },
  { label: "CANCELADO", color: "#D93025" },
  { label: "URGENTE", color: "#E8710A" },
  { label: "CONFIDENCIAL", color: "#8E24AA" },
  { label: "CÓPIA", color: "#5F6B7A" },
];

export function addStamp(label: string, color: string, withDate = true) {
  if (!getActiveTab()) return;
  const pt = viewerApi.insertPoint();
  const w = Math.max(120, label.length * 13 + 30), h = withDate ? 54 : 40;
  const obj: StampObj = { id: uid(), type: "stamp", label, color, date: withDate ? todayBR() : "", opacity: 1, ...place(pt.page, pt.x, pt.y, w, h) };
  st().addObj(obj);
  st().setTool("select");
}

export function addSigField() {
  if (!getActiveTab()) return;
  const t = getActiveTab()!;
  const old = t.objects.find((o) => o.type === "sigfield");
  if (old) {
    st().select(old.id);
    viewerApi.goTo(old.page + 1);
    return old;
  }
  const page = viewerApi.current();
  const ps = viewerApi.pageSize(page);
  const w = 220, h = 86;
  // evita sobrepor assinaturas já existentes (lado a lado, de baixo para cima)
  const n = (new TextDecoder("latin1").decode(t.bytes).match(/\/ByteRange\s*\[/g) || []).length;
  const col = n % 2, row = Math.floor(n / 2);
  const x = Math.max(10, ps.w - w - 36 - col * (w + 12)), y = Math.max(10, ps.h - h - 40 - row * (h + 12));
  const obj: Obj = { id: uid(), type: "sigfield", page, x, y, w, h, opacity: 1 };
  st().addObj(obj);
  st().setTool("select");
  return obj;
}

/** Cria destaques a partir do texto selecionado com o mouse. */
export function highlightSelection(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 1 && r.height > 1);
  const made: Obj[] = [];
  const color = st().style.highlight;
  for (const r of rects) {
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
    const pageEl = el?.closest(".page") as HTMLElement | null;
    if (!pageEl) continue;
    const n = Number(pageEl.dataset.pageNumber) - 1;
    const pr = pageEl.getBoundingClientRect();
    const { w, h } = viewerApi.pageSize(n);
    const k = w / pr.width;
    made.push({ id: uid(), type: "highlight", color, opacity: 1, page: n, x: (r.left - pr.left) * k, y: (r.top - pr.top) * k, w: r.width * k, h: r.height * (h / pr.height) });
  }
  if (!made.length) return false;
  // junta retângulos da mesma linha
  const merged: Obj[] = [];
  for (const m of made.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
    const p = merged[merged.length - 1];
    if (p && p.page === m.page && Math.abs(p.y - m.y) < m.h * 0.5 && m.x <= p.x + p.w + 4) {
      const r = Math.max(p.x + p.w, m.x + m.w);
      p.w = r - p.x;
      p.h = Math.max(p.h, m.h);
    } else merged.push({ ...m });
  }
  st().checkpoint();
  const t = getActiveTab()!;
  st().patchTab(t.id, { objects: [...t.objects, ...merged], dirty: true });
  sel.removeAllRanges();
  return true;
}

// ---------- salvar / imprimir ----------
export async function saveTab(as = false) {
  const t = getActiveTab();
  if (!t) return;
  if (t.objects.some((o) => o.type === "sigfield") && !as)
    st().toast("O campo de assinatura digital só é gravado ao clicar em “Assinar”.", "info");
  await runTask("Salvando…", async () => {
    const bytes = await buildPdf(t);
    let path: string | null = null;
    if (!as && t.path && isApp) {
      await writePath(t.path, bytes);
      path = t.path;
    } else {
      path = await saveAs(bytes, as ? `${baseName(t.name)} (editado).pdf` : t.name);
      if (!path) return;
    }
    const name = path.split(/[\\/]/).pop()!;
    // recarrega a aba com o PDF gravado (objetos passam a fazer parte do arquivo)
    const keepSig = t.objects.filter((o) => o.type === "sigfield");
    st().replaceBytes(t.id, bytes, { record: true, name: isApp ? name : t.name, path: isApp ? path : t.path });
    st().patchTab(t.id, { dirty: false, objects: keepSig });
    if (isApp) rememberRecent(path);
    const destination = isApp ? "local_file" : "download";
    capture("pdf_saved", { save_as: as, destination });
    posthogLog.info("PDF saved", { save_as: as, destination });
    st().toast(isApp ? `Salvo em ${name}` : "Download iniciado");
  });
}

/** Grava os objetos no PDF da aba (sem salvar em disco). Usado antes de organizar/assinar. */
export async function flatten(): Promise<Uint8Array | undefined> {
  const t = getActiveTab();
  if (!t) return;
  const others = t.objects.filter((o) => o.type !== "sigfield");
  if (!others.length && !t.formDirty) return t.bytes;
  const bytes = await buildPdf(t);
  st().replaceBytes(t.id, bytes, { record: true });
  st().patchTab(t.id, { objects: t.objects.filter((o) => o.type === "sigfield") });
  return bytes;
}

/** Ctrl+P / botão Imprimir: diálogo nativo no app, impressão do navegador fora dele. */
export async function printTab() {
  if (!getActiveTab()) return;
  const { openPrint } = await import("./print");
  return openPrint();
}

export function closeTabSafe(id: string) {
  const t = st().tabs.find((x) => x.id === id);
  if (t?.dirty && !confirm(`"${t.name}" tem alterações não salvas. Fechar mesmo assim?`)) return;
  dropDoc(id);
  st().closeTab(id);
}

export async function currentPdf() {
  const t = getActiveTab();
  return t ? getDoc(t) : null;
}
