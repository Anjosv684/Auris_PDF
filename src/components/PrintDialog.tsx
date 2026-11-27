import { useEffect, useMemo, useRef, useState } from "react";
import { X, Printer, ChevronLeft, ChevronRight, SlidersHorizontal, Trash2, Plus, RefreshCw } from "lucide-react";
import { useStore, getActiveTab, type Dialog } from "../lib/store";
import { getDoc } from "../lib/docs";
import { openPdf, renderPage, type PDFDoc } from "../lib/pdfjs";
import { parseRanges } from "../lib/util";
import {
  pickFiles, printerCaps, printerPreferences,
  type PrinterInfo, type PrinterCaps, type Duplex, type Orientation, type Scaling,
} from "../lib/platform";
import {
  cachedPrinters, refreshPrinters, lastPrinter, loadSettings, startPrint, sourcesFromTabs, sourceFromFile,
  type PrintSettings, type PrintSource, type PageChoice,
} from "../lib/print";
import type { Tab } from "../lib/types";

type Item = { src: PrintSource; tab?: Tab };
const A4: PrinterCaps = { duplex: false, color: true, paperW: 595.3, paperH: 841.9, marginL: 12, marginT: 12, marginR: 12, marginB: 12 };
const capsCache = new Map<string, PrinterCaps>();
const close = () => useStore.getState().openDialog(null);

/** Mesmo cálculo do backend (print.rs → place): papel, área imprimível e página, em pontos. */
function layout(pw: number, ph: number, caps: PrinterCaps, s: PrintSettings) {
  const land = s.orientation === "landscape" || (s.orientation === "auto" && pw > ph);
  const W = land ? caps.paperH : caps.paperW, H = land ? caps.paperW : caps.paperH;
  const m = land ? { l: caps.marginT, t: caps.marginR, r: caps.marginB, b: caps.marginL } : { l: caps.marginL, t: caps.marginT, r: caps.marginR, b: caps.marginB };
  const aw = W - m.l - m.r, ah = H - m.t - m.b;
  const fit = Math.min(aw / pw, ah / ph);
  let k = fit, inArea = true;
  if (s.scaling === "actual") { k = 1; inArea = false; }
  else if (s.scaling === "custom") { k = Math.min(10, Math.max(0.05, s.scale / 100)); inArea = false; }
  else if (s.scaling === "shrink" && fit >= 1) { k = 1; inArea = false; }
  const w = pw * k, h = ph * k;
  const x = inArea ? m.l + (aw - w) / 2 : (W - w) / 2, y = inArea ? m.t + (ah - h) / 2 : (H - h) / 2;
  return { W, H, m, x, y, w, h, land };
}

export function PrintDialog({ d }: { d: Extract<Dialog, { kind: "print" }> }) {
  const tabs = useStore((s) => s.tabs);
  const [printers, setPrinters] = useState<PrinterInfo[]>(cachedPrinters() ?? []);
  const [printer, setPrinter] = useState("");
  const [caps, setCaps] = useState<PrinterCaps | null>(null);
  const [s, setS] = useState<PrintSettings>(loadSettings(""));
  const [choice, setChoice] = useState<PageChoice>({ mode: "all", range: "" });
  const [allTabs, setAllTabs] = useState(false);
  const [files, setFiles] = useState<Item[]>(() => (d.files ?? []).map((f) => ({ src: sourceFromFile(f) })));
  const [cur, setCur] = useState<Item[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0); // qual documento
  const [pageIdx, setPageIdx] = useState(0); // posição dentro das páginas escolhidas
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sizes, setSizes] = useState<Record<string, [number, number]>>({});
  const [img, setImg] = useState<string | null>(null);
  const docs = useRef(new Map<string, Promise<PDFDoc>>());
  const owned = useRef<Promise<PDFDoc>[]>([]);
  const thumbs = useRef(new Map<string, string>());
  const isFiles = !!d.files;
  const set = (p: Partial<PrintSettings>) => setS((x) => ({ ...x, ...p }));

  // impressoras: usa o cache na hora e atualiza em segundo plano
  useEffect(() => {
    const pick = (list: PrinterInfo[]) => {
      setPrinters(list);
      setPrinter((p) => p || (list.find((x) => x.name === lastPrinter()) ?? list.find((x) => x.isDefault) ?? list[0])?.name || "");
    };
    if (cachedPrinters()) pick(cachedPrinters()!);
    refreshPrinters().then(pick).catch((e) => useStore.getState().toast("Não foi possível listar as impressoras: " + (e as Error).message, "err"));
  }, []);

  // configurações lembradas + capacidades da impressora escolhida
  useEffect(() => {
    if (!printer) return;
    setS(loadSettings(printer));
    const p = printers.find((x) => x.name === printer);
    if (!p) return;
    const c = capsCache.get(printer);
    setCaps(c ?? null);
    if (!c) printerCaps(p, loadSettings(printer).devmode).then((r) => { capsCache.set(printer, r); setCaps(r); }).catch(() => setCaps(A4));
  }, [printer, printers.length]);

  // documentos: arquivos do Explorer, aba atual ou todas as abas
  useEffect(() => {
    if (isFiles) return;
    const list = allTabs ? tabs : [getActiveTab()].filter(Boolean) as Tab[];
    sourcesFromTabs(list).then((srcs) => setCur(srcs.map((src, i) => ({ src, tab: list[i] }))));
  }, [allTabs, isFiles]);
  const items = isFiles ? files : cur;
  const multi = items.length > 1;

  const docFor = (it: Item) => {
    let p = docs.current.get(it.src.key);
    if (!p) {
      // aba sem alterações: reaproveita o documento já aberto
      const reuse = !!it.tab && !it.tab.objects.some((o) => o.type !== "sigfield") && !it.tab.formDirty;
      p = reuse ? getDoc(it.tab!) : it.src.bytes().then(openPdf);
      if (!reuse) owned.current.push(p);
      docs.current.set(it.src.key, p);
    }
    return p;
  };
  useEffect(() => () => {
    owned.current.forEach((p) => p.then((x) => x.destroy()).catch(() => {}));
    thumbs.current.forEach(URL.revokeObjectURL);
  }, []);

  // número de páginas de cada documento
  useEffect(() => {
    items.forEach((it) => {
      if (counts[it.src.key]) return;
      docFor(it).then((pdf) => setCounts((c) => ({ ...c, [it.src.key]: pdf.numPages }))).catch(() => {});
    });
  }, [items]);

  const pagesOf = (it: Item): number[] | undefined => {
    const n = counts[it.src.key] ?? 0;
    if (choice.mode === "current" && !multi) return [Math.max(0, (it.src.currentPage ?? 1) - 1)];
    if (choice.mode === "range" && choice.range.trim()) return parseRanges(choice.range, n);
    return undefined;
  };
  let rangeError = "";
  let pv: Item | undefined = items[Math.min(previewIdx, items.length - 1)];
  let pvPages: number[] = [];
  try {
    pvPages = pv ? pagesOf(pv) ?? Array.from({ length: counts[pv.src.key] ?? 0 }, (_, i) => i) : [];
  } catch (e) {
    rangeError = (e as Error).message;
  }
  const pageNo = pvPages[Math.min(pageIdx, pvPages.length - 1)];
  useEffect(() => setPageIdx(0), [choice.mode, choice.range, previewIdx]);

  // pré-visualização: cada página é renderizada uma vez (cache); as opções só mudam o CSS → instantâneo
  useEffect(() => {
    if (!pv || pageNo === undefined) return setImg(null);
    const key = `${pv.src.key}:${pageNo}`;
    const hit = thumbs.current.get(key);
    if (hit) return setImg(hit);
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const pdf = await docFor(pv!);
        const page = await pdf.getPage(pageNo + 1);
        const vp = page.getViewport({ scale: 1 });
        setSizes((z) => ({ ...z, [key]: [vp.width, vp.height] }));
        const c = await renderPage(pdf, pageNo + 1, { width: 640 });
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
        const url = URL.createObjectURL(blob);
        thumbs.current.set(key, url);
        if (alive) setImg(url);
      } catch { /* documento fechado */ }
    }, 60);
    return () => { alive = false; clearTimeout(t); };
  }, [pv?.src.key, pageNo]);

  const c = caps ?? A4;
  const size = pv && pageNo !== undefined ? sizes[`${pv.src.key}:${pageNo}`] : undefined;
  const L = layout(size?.[0] ?? 595, size?.[1] ?? 842, c, s);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const sheets = pvPages.length * Math.max(1, s.copies);
  const pinfo = printers.find((p) => p.name === printer);

  const prefs = async () => {
    try {
      const r = await printerPreferences(printer, s.devmode);
      if (!r) return;
      set({
        devmode: r.devmode,
        ...(r.duplex !== "keep" ? { duplex: r.duplex } : {}),
        gray: r.gray || s.gray,
        ...(r.orientation === "landscape" ? { orientation: "landscape" as Orientation } : {}),
      });
      capsCache.delete(printer);
      if (pinfo) printerCaps(pinfo, r.devmode).then((x) => { capsCache.set(printer, x); setCaps(x); }).catch(() => {});
    } catch (e) {
      useStore.getState().toast((e as Error).message, "err");
    }
  };

  const go = () => {
    if (!printer || !items.length || rangeError) return;
    const list = items;
    const pick = (src: PrintSource) => {
      const it = list.find((x) => x.src === src)!;
      try { return pagesOf(it); } catch { return undefined; }
    };
    close(); // fecha na hora; o trabalho segue em segundo plano
    startPrint(list.map((x) => x.src), printer, s, pick);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Enter" && !(e.target as HTMLElement).closest("input, select, button")) go();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const duplexOk = !caps || caps.duplex;
  const colorOk = !caps || caps.color;
  useEffect(() => { if (caps && !caps.duplex && s.duplex !== "none") set({ duplex: "none" }); if (caps && !caps.color && !s.gray) set({ gray: true }); }, [caps]);

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal print-modal">
        <div className="modal-head">
          <img className="modal-ic" src="/icons/imprimir.png" alt="" draggable={false} /><h2>Imprimir</h2>
          <button className="ib" title="Fechar (Esc)" onClick={close}><X size={17} /></button>
        </div>
        <div className="print-body">
          <div className="print-opts">
            <div className="field">
              <label>Impressora</label>
              <div className="row">
                <select value={printer} onChange={(e) => setPrinter(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                  {!printers.length && <option value="">Carregando…</option>}
                  {printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? " (padrão)" : ""}</option>)}
                </select>
                <button className="ib" style={{ flex: "none" }} title="Atualizar lista de impressoras" onClick={() => refreshPrinters().then(setPrinters)}><RefreshCw size={15} /></button>
              </div>
              {pinfo && <div className="row" style={{ justifyContent: "space-between" }}>
                <span className={`badge ${pinfo.ready ? "ok" : "err"}`} style={{ flex: "none" }}>{pinfo.status}</span>
                <button className="link-btn" style={{ flex: "none" }} onClick={prefs} title="Abre as configurações do driver (papel, bandeja, qualidade…)"><SlidersHorizontal size={13} /> Preferências da impressora…</button>
              </div>}
            </div>

            {isFiles ? (
              <div className="field">
                <label>Arquivos ({files.length})</label>
                <div className="filelist" style={{ maxHeight: 120 }}>
                  {files.map((it, i) => (
                    <div key={it.src.key} className={`fileitem ${i === previewIdx ? "over" : ""}`} onClick={() => setPreviewIdx(i)} style={{ cursor: "pointer" }}>
                      <span className="pdf-badge">PDF</span><span className="nm">{it.src.name}</span>
                      <span className="muted">{counts[it.src.key] ? `${counts[it.src.key]} pág.` : ""}</span>
                      <button className="ib" title="Remover da fila" onClick={(e) => { e.stopPropagation(); setFiles((l) => l.filter((x) => x !== it)); }}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
                <button className="link-btn" onClick={async () => { const f = await pickFiles("pdf"); setFiles((l) => [...l, ...f.map((x) => ({ src: sourceFromFile(x) }))]); }}><Plus size={13} /> Adicionar arquivos</button>
              </div>
            ) : tabs.length > 1 && (
              <label className="check"><input type="checkbox" checked={allTabs} onChange={(e) => { setAllTabs(e.target.checked); setPreviewIdx(0); }} /> Imprimir todas as abas abertas ({tabs.length})</label>
            )}

            <div className="field">
              <label>Páginas</label>
              <div className="seg">
                <button className={choice.mode === "all" ? "on" : ""} onClick={() => setChoice({ ...choice, mode: "all" })}>Todas</button>
                {!multi && <button className={choice.mode === "current" ? "on" : ""} onClick={() => setChoice({ ...choice, mode: "current" })}>Atual</button>}
                <button className={choice.mode === "range" ? "on" : ""} onClick={() => setChoice({ ...choice, mode: "range" })}>Intervalo</button>
              </div>
              {choice.mode === "range" && <input type="text" autoFocus placeholder="Ex.: 1-3, 5, 8-" value={choice.range} onChange={(e) => setChoice({ ...choice, range: e.target.value })} />}
              {rangeError && <span className="muted" style={{ color: "var(--red)" }}>{rangeError}</span>}
            </div>

            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field">
                <label>Cópias</label>
                <input type="number" min={1} max={999} value={s.copies} onChange={(e) => set({ copies: Math.max(1, Math.min(999, parseInt(e.target.value) || 1)) })} />
              </div>
              <label className="check" style={{ paddingBottom: 9 }} title="Imprime cada cópia completa (1,2,3 · 1,2,3) em vez de (1,1 · 2,2 · 3,3)">
                <input type="checkbox" checked={s.collate} disabled={s.copies < 2} onChange={(e) => set({ collate: e.target.checked })} /> Agrupar
              </label>
            </div>

            <div className="field">
              <label>Frente e verso {!duplexOk && <span className="muted">(não suportado por esta impressora)</span>}</label>
              <div className="seg">
                {([["none", "Não"], ["long", "Borda longa"], ["short", "Borda curta"]] as [Duplex, string][]).map(([v, l]) => (
                  <button key={v} disabled={v !== "none" && !duplexOk} className={s.duplex === v ? "on" : ""} onClick={() => set({ duplex: v })}
                    title={v === "long" ? "Vira como um livro" : v === "short" ? "Vira como um bloco (calendário)" : "Só a frente"}>{l}</button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Cor</label>
              <div className="seg">
                <button disabled={!colorOk} className={!s.gray ? "on" : ""} onClick={() => set({ gray: false })}>Colorido</button>
                <button className={s.gray ? "on" : ""} onClick={() => set({ gray: true })}>Preto e branco</button>
              </div>
            </div>

            <div className="field">
              <label>Orientação</label>
              <div className="seg">
                {([["auto", "Automática"], ["portrait", "Retrato"], ["landscape", "Paisagem"]] as [Orientation, string][]).map(([v, l]) => (
                  <button key={v} className={s.orientation === v ? "on" : ""} onClick={() => set({ orientation: v })} title={v === "auto" ? "Cada página na orientação que combina com ela" : undefined}>{l}</button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Dimensionamento</label>
              <div className="row">
                <select value={s.scaling} onChange={(e) => set({ scaling: e.target.value as Scaling })} style={{ flex: 1 }}>
                  <option value="fit">Ajustar à área imprimível</option>
                  <option value="actual">Tamanho real</option>
                  <option value="shrink">Reduzir só páginas grandes</option>
                  <option value="custom">Personalizado</option>
                </select>
                {s.scaling === "custom" && <div className="row" style={{ flex: "none", gap: 4 }}>
                  <input type="number" min={5} max={1000} value={s.scale} style={{ width: 70 }} onChange={(e) => set({ scale: Math.max(5, Math.min(1000, parseInt(e.target.value) || 100)) })} /> %
                </div>}
              </div>
            </div>
          </div>

          <div className="print-preview">
            <div className="paper-wrap">
              <div className="paper" style={{ aspectRatio: `${L.W} / ${L.H}`, [L.W >= L.H ? "width" : "height"]: "100%" }}>
                <div className="printable" style={{ left: pct(L.m.l, L.W), top: pct(L.m.t, L.H), right: pct(L.m.r, L.W), bottom: pct(L.m.b, L.H) }} />
                {img && <img src={img} alt="" draggable={false}
                  style={{ left: pct(L.x, L.W), top: pct(L.y, L.H), width: pct(L.w, L.W), height: pct(L.h, L.H), filter: s.gray ? "grayscale(1)" : undefined }} />}
              </div>
            </div>
            <div className="row" style={{ justifyContent: "center", flex: "none", gap: 6 }}>
              <button className="ib" title="Página anterior" disabled={pageIdx <= 0} onClick={() => setPageIdx((i) => i - 1)}><ChevronLeft size={16} /></button>
              <span className="muted" style={{ flex: "none", minWidth: 120, textAlign: "center" }}>
                {pvPages.length ? `Página ${pageNo + 1} · ${Math.min(pageIdx, pvPages.length - 1) + 1} de ${pvPages.length}` : "—"}
              </span>
              <button className="ib" title="Próxima página" disabled={pageIdx >= pvPages.length - 1} onClick={() => setPageIdx((i) => i + 1)}><ChevronRight size={16} /></button>
            </div>
            {multi && !isFiles && <div className="row" style={{ justifyContent: "center", flex: "none" }}>
              <select value={previewIdx} onChange={(e) => setPreviewIdx(+e.target.value)} style={{ flex: "none", maxWidth: 260 }}>
                {items.map((it, i) => <option key={it.src.key} value={i}>{it.src.name}</option>)}
              </select>
            </div>}
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ marginRight: "auto" }}>
            {multi ? `${items.length} documentos` : `${sheets} página${sheets === 1 ? "" : "s"} no total`}
            {s.duplex !== "none" ? " · frente e verso" : ""}
          </span>
          <button className="btn ghost" onClick={close}>Cancelar</button>
          <button className="btn" disabled={!printer || !items.length || !!rangeError} onClick={go}><Printer size={16} /> Imprimir</button>
        </div>
      </div>
    </div>
  );
}
