import { memo, useEffect, useMemo, useRef, useState } from "react";
import { RotateCw, RotateCcw, Trash2, Copy, FilePlus2, FileDown, Check, X, Square } from "lucide-react";
import { useStore, useActiveTab, runTask } from "../lib/store";
import { applyOrganize, extractPages, type OrgItem } from "../lib/pages";
import { getDoc } from "../lib/docs";
import { openPdf, renderPage, type PDFDoc } from "../lib/pdfjs";
import { pickFiles, saveAs } from "../lib/platform";
import { uid, baseName } from "../lib/util";

export function Organize() {
  const tab = useActiveTab()!;
  const [items, setItems] = useState<OrgItem[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const ext = useRef(new Map<string, { bytes: Uint8Array; pdf: Promise<PDFDoc> }>());

  useEffect(() => {
    setItems(Array.from({ length: tab.pageCount }, (_, i) => ({ kind: "page", index: i, rot: 0, key: uid() })));
  }, [tab.id, tab.version]);

  const changed = useMemo(() => items.length !== tab.pageCount || items.some((it, i) => it.kind !== "page" || it.index !== i || it.rot), [items]);
  const targets = (key?: string) => (key && !sel.has(key) ? new Set([key]) : sel);

  const rotate = (d: number, key?: string) => {
    const t = targets(key);
    setItems((l) => l.map((it) => (t.has(it.key) ? { ...it, rot: (it.rot + d + 360) % 360 } : it)));
  };
  const remove = (key?: string) => {
    const t = targets(key);
    setItems((l) => l.filter((it) => !t.has(it.key)));
    setSel(new Set());
  };
  const duplicate = (key?: string) => {
    const t = targets(key);
    setItems((l) => l.flatMap((it) => (t.has(it.key) ? [it, { ...it, key: uid() }] : [it])));
  };
  const insertPos = () => {
    const idx = items.map((it, i) => (sel.has(it.key) ? i : -1)).filter((i) => i >= 0);
    return idx.length ? Math.max(...idx) + 1 : items.length;
  };
  const addBlank = async () => {
    const pdf = await getDoc(tab);
    const p = items.find((it) => sel.has(it.key)) ?? items[items.length - 1];
    let w = 595, h = 842;
    if (p?.kind === "page") {
      const vp = (await pdf.getPage(p.index + 1)).getViewport({ scale: 1, rotation: 0 });
      w = vp.width;
      h = vp.height;
    }
    const pos = insertPos();
    setItems((l) => [...l.slice(0, pos), { kind: "blank", w, h, rot: 0, key: uid() }, ...l.slice(pos)]);
  };
  const addFromFile = async () => {
    const files = await pickFiles("pdf", true);
    const pos = insertPos();
    const add: OrgItem[] = [];
    for (const f of files) {
      const id = uid();
      const pdf = openPdf(f.bytes);
      ext.current.set(id, { bytes: f.bytes, pdf });
      const n = (await pdf).numPages;
      for (let i = 0; i < n; i++) add.push({ kind: "ext", file: id, index: i, rot: 0, key: uid() });
    }
    setItems((l) => [...l.slice(0, pos), ...add, ...l.slice(pos)]);
  };
  const extract = async () => {
    const st = useStore.getState();
    const picked = items.filter((it) => sel.has(it.key));
    if (!picked.length) return st.toast("Selecione as páginas para extrair.", "info");
    await runTask("Extraindo páginas…", async () => {
      const bytes = await build(picked);
      const [out] = await extractPages(bytes, [picked.map((_, i) => i)]);
      if (await saveAs(out, `${baseName(tab.name)} - páginas.pdf`)) st.toast("Páginas extraídas");
    });
  };
  const build = (list: OrgItem[]) => applyOrganize(tab.bytes, list, new Map([...ext.current].map(([k, v]) => [k, v.bytes])));

  const apply = async () => {
    const st = useStore.getState();
    await runTask("Aplicando…", async () => {
      const bytes = await build(items);
      st.replaceBytes(tab.id, bytes, { record: true });
      st.setView("doc");
      st.toast("Páginas reorganizadas");
    });
  };

  const click = (e: React.MouseEvent, key: string) => {
    if (e.shiftKey && anchor) {
      const a = items.findIndex((i) => i.key === anchor), b = items.findIndex((i) => i.key === key);
      setSel(new Set(items.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.key)));
    } else if (e.ctrlKey || e.metaKey) {
      const s = new Set(sel);
      s.has(key) ? s.delete(key) : s.add(key);
      setSel(s);
      setAnchor(key);
    } else {
      setSel(new Set([key]));
      setAnchor(key);
    }
  };

  const onDrop = () => {
    if (dropAt === null || !dragKey) return;
    const moving = sel.has(dragKey) ? sel : new Set([dragKey]);
    setItems((l) => {
      const before = l.slice(0, dropAt).filter((i) => !moving.has(i.key));
      const after = l.slice(dropAt).filter((i) => !moving.has(i.key));
      return [...before, ...l.filter((i) => moving.has(i.key)), ...after];
    });
    setDragKey(null);
    setDropAt(null);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Delete" && sel.size) remove();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSel(new Set(items.map((i) => i.key)));
      }
      if (e.key === "Escape") useStore.getState().setView("doc");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return (
    <div className="viewer-wrap" style={{ display: "flex", flexDirection: "column" }}>
      <div className="organize" onClick={(e) => e.target === e.currentTarget && setSel(new Set())}>
        <div className="org-head">
          <span className="info">{items.length} páginas{sel.size ? ` • ${sel.size} selecionada(s)` : ""} — arraste para reordenar; Ctrl/Shift para selecionar várias</span>
          <button className="ib" title="Girar à esquerda" onClick={() => rotate(-90)} disabled={!sel.size}><RotateCcw size={16} /></button>
          <button className="ib" title="Girar à direita" onClick={() => rotate(90)} disabled={!sel.size}><RotateCw size={16} /></button>
          <button className="ib label" onClick={() => duplicate()} disabled={!sel.size}><Copy size={16} /> Duplicar</button>
          <button className="ib label" onClick={() => remove()} disabled={!sel.size}><Trash2 size={16} /> Excluir</button>
          <button className="ib label" onClick={addBlank}><Square size={16} /> Página em branco</button>
          <button className="ib label" onClick={addFromFile}><FilePlus2 size={16} /> Inserir de arquivo</button>
          <button className="ib label" onClick={extract} disabled={!sel.size}><FileDown size={16} /> Extrair</button>
          <div className="sep" />
          <button className="btn ghost" onClick={() => useStore.getState().setView("doc")}><X size={16} /> Cancelar</button>
          <button className="btn" onClick={apply} disabled={!changed || !items.length}><Check size={16} /> Aplicar</button>
        </div>
        <div className="org-grid" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {items.map((it, i) => (
            <div
              key={it.key}
              className={`org-item ${sel.has(it.key) ? "sel" : ""} ${dragKey && (sel.has(dragKey) ? sel.has(it.key) : dragKey === it.key) ? "dragging" : ""} ${dropAt === i ? "drop-before" : ""}`}
              draggable
              onDragStart={(e) => { setDragKey(it.key); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { setDragKey(null); setDropAt(null); }}
              onDragOver={(e) => {
                e.preventDefault();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
              }}
              onClick={(e) => click(e, it.key)}
            >
              <div className="pg"><OrgThumb item={it} tabPdf={() => getDoc(tab)} ext={ext.current} /></div>
              <span className="lbl">{i + 1}{it.kind === "ext" ? " • inserida" : it.kind === "blank" ? " • em branco" : ""}</span>
              <div className="tools" onClick={(e) => e.stopPropagation()}>
                <button title="Girar" onClick={() => rotate(90, it.key)}><RotateCw size={14} /></button>
                <button title="Excluir" onClick={() => remove(it.key)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {dropAt === items.length && <div className="org-item drop-before" />}
        </div>
      </div>
    </div>
  );
}

const OrgThumb = memo(function OrgThumb({ item, tabPdf, ext }: { item: OrgItem; tabPdf: () => Promise<PDFDoc>; ext: Map<string, { pdf: Promise<PDFDoc> }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(item.kind === "blank" ? { w: item.w, h: item.h } : null);
  useEffect(() => {
    if (item.kind === "blank") return;
    const el = ref.current!;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const pdf = item.kind === "page" ? await tabPdf() : await ext.get(item.file)!.pdf;
      const c = await renderPage(pdf, item.index + 1, { width: 300 });
      c.style.width = "100%";
      setDims({ w: c.width, h: c.height });
      el.replaceChildren(c);
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  let style: React.CSSProperties = {};
  if (dims) {
    const s0 = Math.min(150 / dims.w, 200 / dims.h);
    const w = dims.w * s0, h = dims.h * s0;
    const odd = item.rot % 180 !== 0;
    const k = odd ? Math.min(150 / h, 200 / w) : 1;
    style = { width: w, height: h, transform: `rotate(${item.rot}deg) scale(${k})` };
  }
  if (item.kind === "blank") return <div className="blank" style={style} />;
  return <div ref={ref} style={{ ...style, background: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,.4)", transition: "transform .2s", minWidth: 100, minHeight: 140 }} />;
});
