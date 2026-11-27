// Impressão: no app usa o motor nativo (PDFium → spooler do Windows) em segundo plano;
// no navegador, cai para window.print() com as páginas pré-renderizadas.
import { create } from "zustand";
import { useStore, getActiveTab } from "./store";
import { buildPdf } from "./export";
import { getDoc } from "./docs";
import { openPdf, passwordOf, renderPage } from "./pdfjs";
import {
  isApp, listPrinters, printNative, cancelPrint, onPrintEvents,
  type PrinterInfo, type NativePrintOptions, type Duplex, type Orientation, type Scaling,
} from "./platform";
import { uid } from "./util";
import type { Tab } from "./types";
import { track } from "./telemetry";

// ---------------------------------------------------------------- fontes
/** Um documento a imprimir: aba aberta ou arquivo vindo do Explorer. */
export type PrintSource = {
  key: string;
  name: string;
  /** bytes finais (com anotações, imagens e formulários) */
  bytes: () => Promise<Uint8Array>;
  password?: string;
  currentPage?: number; // 1..n
};

export function sourceFromTab(t: Tab): PrintSource {
  let cache: Promise<Uint8Array> | null = null;
  return {
    key: `tab:${t.id}:${t.version}:${t.objects.length}`,
    name: t.name,
    bytes: () => (cache ??= buildPdf(t)),
    currentPage: t.page,
  };
}

async function resolvePassword(t: Tab) {
  try { return passwordOf(await getDoc(t)); } catch { return undefined; }
}

export async function sourcesFromTabs(tabs: Tab[]): Promise<PrintSource[]> {
  return Promise.all(tabs.map(async (t) => ({ ...sourceFromTab(t), password: await resolvePassword(t) })));
}

export function sourceFromFile(f: { name: string; bytes: Uint8Array }): PrintSource {
  return { key: `file:${uid()}`, name: f.name, bytes: async () => f.bytes };
}

// ---------------------------------------------------------------- configurações lembradas
export type PrintSettings = {
  copies: number; collate: boolean; duplex: Duplex; gray: boolean;
  orientation: Orientation; scaling: Scaling; scale: number; devmode?: string | null;
};
export const DEFAULT_SETTINGS: PrintSettings = {
  copies: 1, collate: true, duplex: "none", gray: false, orientation: "auto", scaling: "fit", scale: 100, devmode: null,
};
const LAST_KEY = "auris.print.last";
const optsKey = (p: string) => `auris.print.opts:${p}`;

export const lastPrinter = () => localStorage.getItem(LAST_KEY) || "";
export function loadSettings(printer: string): PrintSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(optsKey(printer)) || "{}"), copies: 1 };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(printer: string, s: PrintSettings) {
  localStorage.setItem(LAST_KEY, printer);
  localStorage.setItem(optsKey(printer), JSON.stringify(s));
}

// lista de impressoras em cache: o diálogo abre na hora e atualiza em segundo plano
let printersCache: PrinterInfo[] | null = null;
export const cachedPrinters = () => printersCache;
export async function refreshPrinters() {
  printersCache = await listPrinters();
  return printersCache;
}

// ---------------------------------------------------------------- fila de trabalhos
export type Job = { id: string; name: string; page: number; total: number; state: "preparing" | "printing" | "done" | "error" | "canceled"; message?: string };
export const useJobs = create<{ jobs: Job[] }>(() => ({ jobs: [] }));

const patchJob = (id: string, p: Partial<Job>) => useJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));
const dropJobLater = (id: string, ms: number) => setTimeout(() => useJobs.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })), ms);

let listening: Promise<unknown> | null = null;
function ensureEvents() {
  listening ??= onPrintEvents({
    progress: (e) => patchJob(e.job, { state: "printing", page: e.page, total: e.total }),
    done: (e) => { patchJob(e.job, { state: "done" }); dropJobLater(e.job, 3500); },
    error: (e) => {
      const canceled = /cancelad/i.test(e.message || "");
      patchJob(e.job, { state: canceled ? "canceled" : "error", message: e.message || "Falha ao imprimir." });
      dropJobLater(e.job, canceled ? 2500 : 8000);
    },
  });
  return listening;
}

export async function cancelJob(id: string) {
  patchJob(id, { message: "Cancelando…" });
  if (!(await cancelPrint(id).catch(() => false))) {
    patchJob(id, { state: "canceled" });
    dropJobLater(id, 1500);
  }
}

/** Páginas (índices 0-based) conforme a escolha do usuário. */
export type PageChoice = { mode: "all" | "current" | "range"; range: string };

/** Dispara a impressão em segundo plano. Retorna na hora. */
export function startPrint(sources: PrintSource[], printer: string, s: PrintSettings, pages: (src: PrintSource) => number[] | undefined) {
  track("imprimir", { arquivos: sources.length });
  saveSettings(printer, s);
  for (const src of sources) {
    const id = uid();
    useJobs.setState((st) => ({ jobs: [...st.jobs, { id, name: src.name, page: 0, total: 0, state: "preparing" }] }));
    (async () => {
      try {
        await ensureEvents();
        const bytes = await src.bytes();
        const opts: NativePrintOptions = { ...s, pages: pages(src), jobName: src.name, password: src.password ?? null };
        await printNative(id, printer, opts, bytes);
      } catch (e) {
        patchJob(id, { state: "error", message: (e as Error)?.message || String(e) });
        dropJobLater(id, 8000);
      }
    })();
  }
}

// ---------------------------------------------------------------- entradas
/** Ctrl+P / botão Imprimir. */
export async function openPrint(files?: { name: string; bytes: Uint8Array }[]) {
  if (!isApp) return printBrowser();
  useStore.getState().openDialog({ kind: "print", files });
}

/** Ctrl+Shift+P: imprime direto com a última impressora/configuração. */
export async function quickPrint() {
  track("impressao_rapida");
  const t = getActiveTab();
  if (!t) return;
  if (!isApp) return printBrowser();
  const printer = lastPrinter();
  const list = printersCache ?? (await refreshPrinters().catch(() => []));
  if (!printer || !list.some((p) => p.name === printer)) return openPrint();
  const [src] = await sourcesFromTabs([t]);
  startPrint([src], printer, loadSettings(printer), () => undefined);
  useStore.getState().toast(`Imprimindo em ${printer}…`, "info");
}

// ---------------------------------------------------------------- navegador (fallback)
/** Impressão do navegador: páginas em JPEG via blob (sem data URL), cedendo a vez à interface entre páginas. */
export async function printBrowser() {
  const t = getActiveTab();
  if (!t) return;
  const st = useStore.getState();
  const root = document.getElementById("print-root")!;
  const urls: string[] = [];
  try {
    st.set({ busy: "Preparando impressão…" });
    const pdf = await openPdf(await buildPdf(t));
    root.innerHTML = "";
    const canvas = document.createElement("canvas");
    for (let i = 1; i <= pdf.numPages; i++) {
      st.set({ busy: `Preparando impressão… ${i}/${pdf.numPages}` });
      await renderPage(pdf, i, { scale: 2, canvas });
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.9));
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      root.append(img);
      await new Promise((r) => setTimeout(r)); // mantém a interface respondendo
    }
    await pdf.destroy();
    await Promise.all([...root.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  } catch (e) {
    st.toast((e as Error).message || String(e), "err");
    return;
  } finally {
    st.set({ busy: null });
  }
  const done = () => {
    root.innerHTML = "";
    urls.forEach(URL.revokeObjectURL);
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
