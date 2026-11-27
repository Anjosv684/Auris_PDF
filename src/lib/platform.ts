// Camada de plataforma: no app (Tauri) usa disco/diálogos nativos;
// no navegador cai para <input type=file> e download.
import JSZip from "jszip";
import type { CertInfo } from "./types";
import { track } from "./telemetry";

export const isApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type PickedFile = { name: string; path?: string; bytes: Uint8Array };

async function tauri() {
  const core = await import("@tauri-apps/api/core");
  const dialog = await import("@tauri-apps/plugin-dialog");
  return { invoke: core.invoke, dialog };
}

const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

export async function readPath(path: string): Promise<PickedFile> {
  const { invoke } = await tauri();
  const buf = await invoke<ArrayBuffer>("read_file", { path });
  return { name: fileName(path), path, bytes: new Uint8Array(buf) };
}

export async function writePath(path: string, bytes: Uint8Array) {
  const { invoke } = await tauri();
  await invoke("write_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

function browserPick(accept: string, multiple: boolean): Promise<PickedFile[]> {
  return new Promise((res) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      res(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    };
    inp.click();
  });
}

export async function pickFiles(kind: "pdf" | "image" | "pfx", multiple = true): Promise<PickedFile[]> {
  const ext = { pdf: ["pdf"], image: ["png", "jpg", "jpeg", "webp", "gif", "bmp"], pfx: ["pfx", "p12"] }[kind];
  if (!isApp) return browserPick(ext.map((e) => "." + e).join(","), multiple);
  const { dialog } = await tauri();
  const sel = await dialog.open({
    multiple,
    filters: [{ name: kind === "pdf" ? "PDF" : kind === "pfx" ? "Certificado A1" : "Imagens", extensions: ext }],
  });
  if (!sel) return [];
  const paths = Array.isArray(sel) ? sel : [sel];
  return Promise.all(paths.map(readPath));
}

function download(bytes: Uint8Array, name: string, mime = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Salva com diálogo. Retorna o caminho escolhido (app) ou o nome (navegador). */
export async function saveAs(bytes: Uint8Array, suggested: string, ext = "pdf"): Promise<string | null> {
  if (!isApp) {
    download(bytes, suggested, ext === "pdf" ? "application/pdf" : ext === "zip" ? "application/zip" : "image/" + ext);
    return suggested;
  }
  const { dialog } = await tauri();
  const path = await dialog.save({ defaultPath: suggested, filters: [{ name: ext === "docx" ? "Documento do Word" : ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return null;
  await writePath(path, bytes);
  return path;
}

/** Salva vários arquivos: numa pasta escolhida (app) ou num .zip (navegador). */
export async function saveMany(files: { name: string; bytes: Uint8Array }[], zipName: string): Promise<string | null> {
  if (files.length === 1) return saveAs(files[0].bytes, files[0].name, files[0].name.split(".").pop());
  if (isApp) {
    const { dialog } = await tauri();
    const dir = await dialog.open({ directory: true, title: "Escolha a pasta de destino" });
    if (!dir || Array.isArray(dir)) return null;
    const sep = dir.includes("\\") ? "\\" : "/";
    for (const f of files) await writePath(dir.replace(/[\\/]$/, "") + sep + f.name, f.bytes);
    return dir;
  }
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.bytes));
  download(await zip.generateAsync({ type: "uint8array" }), zipName, "application/zip");
  return zipName;
}

// ---------- integração com o Windows ----------
export type Launch = { action: "abrir" | "comprimir" | "juntar" | "imprimir" | "imagens"; paths: string[] };

export async function takeLaunch(): Promise<Launch[]> {
  if (!isApp) return [];
  const { invoke } = await tauri();
  return invoke<Launch[]>("take_launch");
}

export async function onLaunch(cb: (l: Launch) => void) {
  if (!isApp) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<Launch>("launch", (e) => cb(e.payload));
}

export async function openDefaultAppsSettings() {
  const { invoke } = await tauri();
  await invoke("open_default_apps");
}

export async function setWindowTitle(title: string) {
  if (isApp) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().setTitle(title).catch(() => {});
  } else document.title = title;
}

// ---------- certificados do Windows (A1 instalado / A3 token) ----------
export async function listCertificates(): Promise<CertInfo[]> {
  if (!isApp) throw new Error("Certificados instalados (token A3) só estão disponíveis no app para Windows.");
  const { invoke } = await tauri();
  return invoke<CertInfo[]>("list_certificates");
}

/** Gera a assinatura CMS (PKCS#7 destacada) com o certificado do Windows. Pode pedir o PIN do token. */
export async function signWithStore(thumbprint: string, data: Uint8Array, essAttrB64: string): Promise<Uint8Array> {
  const { invoke } = await tauri();
  const { bytesToB64, b64ToBytes } = await import("./util");
  const out = await invoke<string>("sign_with_certificate", { thumbprint, data: bytesToB64(data), essAttr: essAttrB64 });
  return b64ToBytes(out);
}

export async function openExternal(url: string) {
  if (isApp) {
    const { invoke } = await tauri();
    await invoke("open_url", { url });
  } else window.open(url, "_blank");
}

// ---------- compressão com o motor PyMuPDF (sidecar auris-compress.exe) ----------
export type NativeCompress = { bytes: Uint8Array; mode: "normal" | "imagem" | "original" };

export async function compressNative(bytes: Uint8Array, level: "Leve" | "Média" | "Forte", gray: boolean): Promise<NativeCompress> {
  track("comprimir", { nivel: level, cinza: gray });
  const { invoke } = await tauri();
  const lv = { Leve: "leve", Média: "media", Forte: "forte" }[level];
  const buf = new Uint8Array(await invoke<ArrayBuffer>("compress_pdf", bytes, { headers: { level: lv, gray: gray ? "1" : "0" } }));
  return { mode: (["normal", "imagem", "original"] as const)[buf[0]] ?? "normal", bytes: buf.subarray(1) };
}

// ---------- impressão nativa (PDFium + spooler do Windows) ----------
export type PrinterInfo = { name: string; port: string; isDefault: boolean; status: string; ready: boolean };
export type PrinterCaps = {
  duplex: boolean; color: boolean;
  paperW: number; paperH: number; // pontos, retrato
  marginL: number; marginT: number; marginR: number; marginB: number;
};
export type Duplex = "none" | "long" | "short";
export type Orientation = "auto" | "portrait" | "landscape";
export type Scaling = "fit" | "actual" | "shrink" | "custom";
export type NativePrintOptions = {
  pages?: number[]; copies: number; collate: boolean; duplex: Duplex; gray: boolean;
  orientation: Orientation; scaling: Scaling; scale: number; devmode?: string | null;
  jobName: string; password?: string | null;
};
export type PrinterPrefs = { devmode: string; duplex: Duplex | "keep"; gray: boolean; orientation: "landscape" | "keep" };
export type PrintEvent = { job: string; page: number; total: number; message?: string | null };

export async function listPrinters(): Promise<PrinterInfo[]> {
  const { invoke } = await tauri();
  return invoke<PrinterInfo[]>("list_printers");
}
export async function printerCaps(p: PrinterInfo, devmode?: string | null): Promise<PrinterCaps> {
  const { invoke } = await tauri();
  return invoke<PrinterCaps>("printer_caps", { name: p.name, port: p.port, devmode: devmode ?? null });
}
/** Abre as preferências do driver da impressora. null = cancelado. */
export async function printerPreferences(name: string, devmode?: string | null): Promise<PrinterPrefs | null> {
  const { invoke } = await tauri();
  return invoke<PrinterPrefs | null>("printer_preferences", { name, devmode: devmode ?? null });
}
/** Envia o trabalho e retorna na hora; o progresso chega pelos eventos. */
export async function printNative(job: string, printer: string, opts: NativePrintOptions, bytes: Uint8Array) {
  const { invoke } = await tauri();
  await invoke("print_pdf", bytes, {
    headers: { job: encodeURIComponent(job), printer: encodeURIComponent(printer), options: encodeURIComponent(JSON.stringify(opts)) },
  });
}
export async function cancelPrint(job: string) {
  const { invoke } = await tauri();
  return invoke<boolean>("cancel_print", { job });
}
export async function onPrintEvents(h: { progress: (e: PrintEvent) => void; done: (e: PrintEvent) => void; error: (e: PrintEvent) => void }) {
  const { listen } = await import("@tauri-apps/api/event");
  const un = await Promise.all([
    listen<PrintEvent>("print-progress", (e) => h.progress(e.payload)),
    listen<PrintEvent>("print-done", (e) => h.done(e.payload)),
    listen<PrintEvent>("print-error", (e) => h.error(e.payload)),
  ]);
  return () => un.forEach((f) => f());
}

// ---------- OCR (Tesseract embutido no motor PyMuPDF) ----------
/** Reconhece o texto das páginas escaneadas. Retorna o PDF pesquisável e quantas páginas foram reconhecidas. */
/** Chama um comando do motor PyMuPDF repassando o progresso (evento engine-progress). */
async function engineCall(cmd: string, bytes: Uint8Array, headers: Record<string, string>, onProgress: (page: number, total: number) => void) {
  const { invoke } = await tauri();
  const { listen } = await import("@tauri-apps/api/event");
  const job = Math.random().toString(36).slice(2);
  const un = await listen<{ job: string; page: number; total: number }>("engine-progress", (e) => {
    if (e.payload.job === job) onProgress(e.payload.page, e.payload.total);
  });
  try {
    const buf = new Uint8Array(await invoke<ArrayBuffer>(cmd, bytes, { headers: { job, ...headers } }));
    return { count: (buf[0] << 8) | buf[1], bytes: buf.subarray(2) };
  } finally {
    un();
  }
}

export async function ocrNative(bytes: Uint8Array, force: boolean, onProgress: (page: number, total: number) => void) {
  const r = await engineCall("ocr_pdf", bytes, { force: force ? "1" : "0" }, onProgress);
  return { recognized: r.count, bytes: r.bytes };
}

/** PDF → Word (.docx). `scanned` = páginas que passaram por OCR. */
export async function wordNative(bytes: Uint8Array, onProgress: (page: number, total: number) => void) {
  const r = await engineCall("pdf_to_word", bytes, {}, onProgress);
  return { scanned: r.count, bytes: r.bytes };
}

/** Abre no programa padrão um arquivo que o app acabou de gerar (.docx/.pdf). */
export async function openPath(path: string) {
  const { invoke } = await tauri();
  await invoke("open_path", { path });
}

// ---------- edição do texto original (motor em modo servidor) ----------
export type TextLine = { text: string; bbox: [number, number, number, number]; size: number; bold: boolean; italic: boolean; family: "sans" | "serif" | "mono"; color: string; scanned?: boolean };
export type TextEdit = { page: number; rect: [number, number, number, number]; text: string; scanned?: boolean; original?: string; context?: { rect: [number, number, number, number]; text: string }[] };

export async function engineWarmup() {
  const { invoke } = await tauri();
  await invoke("engine_warmup").catch(() => {});
}
/** Linhas editáveis de uma página. Página escaneada: o motor faz OCR na hora (linhas com `scanned`). */
export async function textLines(bytes: Uint8Array, page: number): Promise<TextLine[]> {
  const { invoke } = await tauri();
  return (await invoke<TextLine[] | null>("text_lines", bytes, { headers: { page: String(page) } })) ?? [];
}
export async function editTextNative(bytes: Uint8Array, edits: TextEdit[]): Promise<Uint8Array> {
  const { invoke } = await tauri();
  return new Uint8Array(await invoke<ArrayBuffer>("edit_text", bytes, { headers: { edits: encodeURIComponent(JSON.stringify(edits)) } }));
}
