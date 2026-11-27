// Acesso global ao visualizador ativo (zoom, páginas, busca...).
import type { PDFDoc } from "./pdfjs";

type AnyViewer = {
  currentScale: number;
  currentScaleValue: string;
  currentPageNumber: number;
  pagesCount: number;
  getPageView: (i: number) => { div: HTMLDivElement; viewport: { width: number; height: number; scale: number; rotation: number } } | undefined;
  scrollPageIntoView: (o: { pageNumber: number; destArray?: unknown[] }) => void;
};

export const viewerApi = {
  viewer: null as AnyViewer | null,
  eventBus: null as { dispatch: (n: string, d: object) => void; on: (n: string, f: (e: never) => void) => void } | null,
  container: null as HTMLDivElement | null,
  pdf: null as PDFDoc | null,
  lastPointer: null as { page: number; x: number; y: number } | null,

  pageSize(i: number) {
    const v = this.viewer?.getPageView(i)?.viewport;
    if (!v) return { w: 595, h: 842 };
    return { w: v.width / v.scale, h: v.height / v.scale };
  },
  current() {
    return (this.viewer?.currentPageNumber ?? 1) - 1;
  },
  goTo(n: number) {
    if (!this.viewer) return;
    this.viewer.currentPageNumber = Math.max(1, Math.min(this.viewer.pagesCount, n));
  },
  setScale(v: number | string) {
    if (!this.viewer) return;
    if (typeof v === "number") this.viewer.currentScale = Math.max(0.1, Math.min(8, v));
    else this.viewer.currentScaleValue = v;
  },
  zoom(dir: 1 | -1) {
    if (!this.viewer) return;
    const s = this.viewer.currentScale;
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
    const next = dir > 0 ? steps.find((x) => x > s + 0.001) ?? 8 : [...steps].reverse().find((x) => x < s - 0.001) ?? 0.25;
    this.setScale(next);
  },
  find(query: string, prev = false, again = false) {
    this.eventBus?.dispatch("find", {
      source: null, type: again ? "again" : "", query, caseSensitive: false, entireWord: false,
      highlightAll: true, findPrevious: prev, matchDiacritics: false,
    });
  },
  /** Ponto (em unidades PDF) para inserir algo: último clique ou centro visível da página atual. */
  insertPoint(): { page: number; x: number; y: number } {
    const page = this.current();
    if (this.lastPointer && this.lastPointer.page === page) return this.lastPointer;
    const pv = this.viewer?.getPageView(page);
    const { w, h } = this.pageSize(page);
    if (!pv || !this.container) return { page, x: w / 2, y: h / 2 };
    const r = pv.div.getBoundingClientRect();
    const c = this.container.getBoundingClientRect();
    const top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom);
    const cy = (top + bottom) / 2 - r.top;
    return { page, x: w / 2, y: Math.max(0, Math.min(h, (cy / r.height) * h)) };
  },
};
