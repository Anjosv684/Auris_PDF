import { useEffect, useRef, useState } from "react";
import { X, Plus, ArrowUp, ArrowDown, Trash2, Upload, Eraser, Check } from "lucide-react";
import { useStore, runTask, getActiveTab, type Dialog } from "../lib/store";
import { mergePdfs, extractPages, imagesToPdf, pdfToImages } from "../lib/pages";
import { compressPdf, LEVELS, type Level } from "../lib/compress";
import { buildPdf } from "../lib/export";
import { pickFiles, saveAs, saveMany, isApp, writePath, compressNative, type PickedFile } from "../lib/platform";
import { fmtSize, baseName, parseRanges, uid, removeWhite, loadImage } from "../lib/util";
import { addImageAt, openBytes } from "../lib/actions";
import { SignBatchDialog } from "./SignBatch";
import { openPdf } from "../lib/pdfjs";
import { appVersion, checkForUpdate } from "../lib/updater";
import { PrintDialog } from "./PrintDialog";
import { FeatureIcon, type Feature } from "./icons";
import type { Tab } from "../lib/types";

export function Modal({ title, icon, children, foot, wide, onClose, cls }: { title: React.ReactNode; icon?: Feature; children: React.ReactNode; foot?: React.ReactNode; wide?: boolean; onClose?: () => void; cls?: string }) {
  const close = onClose ?? (() => useStore.getState().openDialog(null));
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${wide ? "wide" : ""} ${cls ?? ""}`}>
        <div className="modal-head">{icon && <FeatureIcon n={icon} size={18} className="modal-ic" />}<h2>{title}</h2><button className="ib" title="Fechar (Esc)" onClick={close}><X size={17} /></button></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

const close = () => useStore.getState().openDialog(null);
const tabBytes = async (t: Tab) => (t.objects.some((o) => o.type !== "sigfield") || t.formDirty ? buildPdf(t) : t.bytes);

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case "merge": return <MergeDialog d={d} />;
    case "split": return <SplitDialog />;
    case "compress": return <CompressDialog d={d} />;
    case "images": return <ImagesDialog d={d} />;
    case "export-images": return <ExportImagesDialog />;
    case "sign-batch": return <SignBatchDialog d={d} />;
    case "signature-pad": return <SignaturePadDialog />;
    case "password": return <PasswordDialog d={d} />;
    case "print": return <PrintDialog d={d} />;
    case "about": return <AboutDialog />;
  }
}

// ---------------- juntar ----------------
type MItem = { id: string; name: string; bytes: Uint8Array; pages: string; count: number };

function MergeDialog({ d }: { d: Extract<Dialog, { kind: "merge" }> }) {
  const [list, setList] = useState<MItem[]>([]);
  const add = async (files: { name: string; bytes: Uint8Array }[]) => {
    const items = await Promise.all(files.map(async (f) => {
      const pdf = await openPdf(f.bytes).catch(() => null);
      const count = pdf?.numPages ?? 0;
      pdf?.destroy();
      return { id: uid(), name: f.name, bytes: f.bytes, pages: "", count };
    }));
    setList((l) => [...l, ...items.filter((i) => i.count)]);
  };
  useEffect(() => {
    (async () => {
      if (d.files?.length) return add(d.files);
      const t = getActiveTab();
      if (t) add([{ name: t.name, bytes: await tabBytes(t) }]);
    })();
  }, []);
  const move = (i: number, dir: number) => setList((l) => {
    const n = [...l];
    const j = i + dir;
    if (j < 0 || j >= n.length) return l;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const addTabs = async () => {
    const tabs = useStore.getState().tabs.filter((t) => !list.some((l) => l.name === t.name));
    add(await Promise.all(tabs.map(async (t) => ({ name: t.name, bytes: await tabBytes(t) }))));
  };
  const run = async (save: boolean) => {
    await runTask("Juntando…", async () => {
      const out = await mergePdfs(list.map((m) => ({ name: m.name, bytes: m.bytes, pages: m.pages.trim() ? parseRanges(m.pages, m.count) : undefined })));
      const name = `${baseName(list[0].name)} (unido).pdf`;
      if (save) {
        const p = await saveAs(out, name);
        if (!p) return;
        if (isApp) openBytes({ name: p.split(/[\\/]/).pop()!, path: p, bytes: out });
      } else openBytes({ name, bytes: out });
      close();
      useStore.getState().toast(`${list.length} arquivos unidos • ${fmtSize(out.length)}`);
    });
  };
  const total = list.reduce((a, m) => a + (m.pages.trim() ? (() => { try { return parseRanges(m.pages, m.count).length; } catch { return 0; } })() : m.count), 0);
  return (
    <Modal title="Juntar PDFs" icon="juntar" wide foot={<>
      <span className="muted" style={{ marginRight: "auto" }}>{list.length} arquivos • {total} páginas</span>
      <button className="btn ghost" disabled={list.length < 2} onClick={() => run(false)}>Juntar e abrir</button>
      <button className="btn" disabled={list.length < 2} onClick={() => run(true)}>Juntar e salvar…</button>
    </>}>
      <div className="row" style={{ flex: "none" }}>
        <button className="btn ghost" style={{ flex: "none" }} onClick={async () => add(await pickFiles("pdf"))}><Plus size={16} /> Adicionar arquivos</button>
        {useStore.getState().tabs.length > 1 && <button className="btn ghost" style={{ flex: "none" }} onClick={addTabs}>Adicionar abas abertas</button>}
      </div>
      <div className="filelist">
        {list.map((m, i) => (
          <div key={m.id} className="fileitem">
            <span className="pdf-badge">PDF</span>
            <span className="nm" title={m.name}>{m.name}</span>
            <span className="muted">{m.count} pág.</span>
            <input placeholder="todas (ex.: 1-3, 5)" value={m.pages} onChange={(e) => setList((l) => l.map((x) => (x.id === m.id ? { ...x, pages: e.target.value } : x)))} title="Páginas a incluir" />
            <button className="ib" title="Mover para cima" onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
            <button className="ib" title="Mover para baixo" onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
            <button className="ib" title="Remover da lista" onClick={() => setList((l) => l.filter((x) => x.id !== m.id))}><Trash2 size={15} /></button>
          </div>
        ))}
        {!list.length && <div className="muted">Adicione pelo menos dois PDFs.</div>}
      </div>
    </Modal>
  );
}

// ---------------- dividir ----------------
function SplitDialog() {
  const [src, setSrc] = useState<{ name: string; bytes: Uint8Array; count: number } | null>(null);
  const [mode, setMode] = useState<"ranges" | "every" | "each" | "extract">("ranges");
  const [ranges, setRanges] = useState("");
  const [every, setEvery] = useState(2);
  const load = async (f: { name: string; bytes: Uint8Array }) => {
    const pdf = await openPdf(f.bytes);
    setSrc({ ...f, count: pdf.numPages });
    pdf.destroy();
  };
  useEffect(() => {
    const t = getActiveTab();
    if (t) tabBytes(t).then((b) => load({ name: t.name, bytes: b }));
  }, []);
  const groups = (): number[][] => {
    if (!src) return [];
    const n = src.count;
    if (mode === "each") return Array.from({ length: n }, (_, i) => [i]);
    if (mode === "every") return Array.from({ length: Math.ceil(n / every) }, (_, g) => Array.from({ length: Math.min(every, n - g * every) }, (_, i) => g * every + i));
    if (mode === "extract") return [parseRanges(ranges, n)];
    return ranges.split(/[;,]/).map((r) => r.trim()).filter(Boolean).map((r) => parseRanges(r, n));
  };
  let preview = "";
  try {
    const g = groups().filter((x) => x.length);
    preview = g.length ? `Vai gerar ${g.length} arquivo(s)` : "";
  } catch (e) {
    preview = (e as Error).message;
  }
  const run = async () => {
    await runTask("Dividindo…", async () => {
      const g = groups().filter((x) => x.length);
      if (!g.length) throw new Error("Informe as páginas.");
      const outs = await extractPages(src!.bytes, g);
      const b = baseName(src!.name);
      const files = outs.map((bytes, i) => ({
        bytes,
        name: mode === "extract" ? `${b} - extraído.pdf` : g[i].length === 1 ? `${b} - pag ${g[i][0] + 1}.pdf` : `${b} - pag ${g[i][0] + 1}-${g[i][g[i].length - 1] + 1}.pdf`,
      }));
      if (await saveMany(files, `${b} - dividido.zip`)) {
        close();
        useStore.getState().toast(`${files.length} arquivo(s) gerado(s)`);
      }
    });
  };
  return (
    <Modal title="Dividir PDF" icon="dividir" foot={<><span className="muted" style={{ marginRight: "auto" }}>{preview}</span><button className="btn" disabled={!src} onClick={run}><Check size={16} /> Dividir</button></>}>
      <div className="fileitem">
        <span className="pdf-badge">PDF</span>
        <span className="nm">{src ? `${src.name} • ${src.count} páginas` : "Nenhum arquivo"}</span>
        <button className="btn ghost" style={{ height: 30 }} onClick={async () => { const [f] = await pickFiles("pdf", false); if (f) load(f); }}>Escolher…</button>
      </div>
      <div className="seg">
        {([["ranges", "Por intervalos"], ["every", "A cada N páginas"], ["each", "Página por página"], ["extract", "Extrair páginas"]] as const).map(([k, l]) => (
          <button key={k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      {(mode === "ranges" || mode === "extract") && (
        <div className="field">
          <label>{mode === "ranges" ? "Intervalos (cada vírgula = um arquivo)" : "Páginas a extrair (num único arquivo)"}</label>
          <input type="text" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder={mode === "ranges" ? "ex.: 1-3, 4-8, 9-" : "ex.: 1, 3, 5-7"} autoFocus />
        </div>
      )}
      {mode === "every" && (
        <div className="field">
          <label>Páginas por arquivo</label>
          <input type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, +e.target.value))} />
        </div>
      )}
    </Modal>
  );
}

// ---------------- comprimir ----------------
type CItem = { id: string; name: string; path?: string; bytes: Uint8Array; out?: Uint8Array; status?: string };

function CompressDialog({ d }: { d: Extract<Dialog, { kind: "compress" }> }) {
  const [list, setList] = useState<CItem[]>([]);
  const [level, setLevel] = useState<Level>("Média");
  const [gray, setGray] = useState(false);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    (async () => {
      if (d.files?.length) return;
      const t = getActiveTab();
      if (t) setList([{ id: uid(), name: t.name, path: t.path, bytes: await tabBytes(t) }]);
    })();
  }, []);
  // arquivos que chegam pelo Explorer (botão direito) entram na lista, mesmo com a janela já aberta
  useEffect(() => {
    if (!d.files?.length) return;
    setList((l) => [...l, ...d.files!.filter((f) => !l.some((x) => (x.path ? x.path === f.path : x.bytes === f.bytes))).map((f) => ({ ...f, id: uid() }))]);
  }, [d.files]);
  const run = async () => {
    setRunning(true);
    for (const it of list) {
      setList((l) => l.map((x) => (x.id === it.id ? { ...x, status: "Comprimindo…", out: undefined } : x)));
      try {
        let out: Uint8Array, note: string | undefined;
        if (isApp) {
          // motor PyMuPDF (auris-compress.exe)
          const r = await compressNative(it.bytes, level, gray);
          out = r.bytes;
          note = r.mode === "imagem" ? "páginas convertidas em imagem" : r.mode === "original" ? "já estava otimizado" : undefined;
        } else {
          const r = await compressPdf(it.bytes, level, gray, (a, b) =>
            setList((l) => l.map((x) => (x.id === it.id ? { ...x, status: b ? `Imagens ${a}/${b}` : "Otimizando…" } : x))));
          out = r.bytes;
        }
        setList((l) => l.map((x) => (x.id === it.id ? { ...x, out, status: note } : x)));
      } catch (e) {
        setList((l) => l.map((x) => (x.id === it.id ? { ...x, status: "Erro: " + (e as Error).message } : x)));
      }
    }
    setRunning(false);
  };
  const done = list.filter((i) => i.out);
  const save = async () => {
    await runTask("Salvando…", async () => {
      const pending: { name: string; bytes: Uint8Array }[] = [];
      for (const it of done) {
        const name = `${baseName(it.name)}_comprimido.pdf`;
        if (isApp && it.path) await writePath(it.path.replace(/[^\\/]+$/, name), it.out!);
        else pending.push({ name, bytes: it.out! });
      }
      if (pending.length) await saveMany(pending, "comprimidos.zip");
      const a = done.reduce((s, i) => s + i.bytes.length, 0), b = done.reduce((s, i) => s + i.out!.length, 0);
      useStore.getState().toast(`Pronto! ${fmtSize(a - b)} economizados`);
      close();
    });
  };
  return (
    <Modal title="Comprimir PDF" icon="comprimir" wide foot={<>
      <button className="btn ghost" style={{ marginRight: "auto" }} onClick={async () => { const f = await pickFiles("pdf"); setList((l) => [...l, ...f.map((x) => ({ ...x, id: uid() }))]); }}><Plus size={16} /> Adicionar</button>
      <button className="btn ghost" disabled={!list.length || running} onClick={run}>{running ? "Comprimindo…" : "Comprimir"}</button>
      <button className="btn" disabled={!done.length || running} onClick={save}>Salvar {done.length > 1 ? "todos" : ""}</button>
    </>}>
      <div className="seg">
        {(Object.keys(LEVELS) as Level[]).map((l) => <button key={l} className={level === l ? "on" : ""} onClick={() => setLevel(l)}>{l}</button>)}
      </div>
      <div className="row" style={{ flex: "none" }}>
        <span className="muted">{LEVELS[level].desc}</span>
        <label className="check" style={{ flex: "none" }}><input type="checkbox" checked={gray} onChange={(e) => setGray(e.target.checked)} /> Tons de cinza</label>
      </div>
      <div className="filelist">
        {list.map((it) => (
          <div key={it.id} className="fileitem">
            <span className="pdf-badge">PDF</span>
            <span className="nm">{it.name}</span>
            <span className="muted">{fmtSize(it.bytes.length)}</span>
            {it.out && <span className="res">→ {fmtSize(it.out.length)} (-{Math.round((1 - it.out.length / it.bytes.length) * 100)}%)</span>}
            {it.status && <span className="muted">{it.status}</span>}
            <button className="ib" title="Remover da lista" onClick={() => setList((l) => l.filter((x) => x.id !== it.id))} disabled={running}><Trash2 size={15} /></button>
          </div>
        ))}
        {!list.length && <div className="muted">Adicione os PDFs que deseja comprimir.</div>}
      </div>
      <div className="muted">{isApp ? "Os arquivos são salvos ao lado do original como “nome_comprimido.pdf”." : "Os arquivos serão baixados."} Assinaturas digitais deixam de valer em arquivos comprimidos.</div>
    </Modal>
  );
}

// ---------------- imagens → PDF ----------------
function ImagesDialog({ d }: { d: Extract<Dialog, { kind: "images" }> }) {
  const [list, setList] = useState<(PickedFile & { id: string; url: string })[]>([]);
  const [mode, setMode] = useState<"a4" | "image">("a4");
  const push = (f: PickedFile[]) =>
    setList((l) => [...l, ...f.map((x) => ({ ...x, id: uid(), url: URL.createObjectURL(new Blob([x.bytes as BlobPart])) }))]);
  const add = async () => push(await pickFiles("image"));
  useEffect(() => { if (d.files?.length) push(d.files); else add(); }, []);
  const run = async () => {
    await runTask("Criando PDF…", async () => {
      const out = await imagesToPdf(list, mode);
      openBytes({ name: `${baseName(list[0].name.replace(/\.\w+$/, ""))}.pdf`, bytes: out });
      useStore.getState().patchTab(useStore.getState().activeId!, { dirty: true });
      close();
    });
  };
  return (
    <Modal title="Imagens → PDF" icon="imagens-pdf" wide foot={<>
      <button className="btn ghost" style={{ marginRight: "auto" }} onClick={add}><Plus size={16} /> Adicionar imagens</button>
      <button className="btn" disabled={!list.length} onClick={run}>Criar PDF</button>
    </>}>
      <div className="seg">
        <button className={mode === "a4" ? "on" : ""} onClick={() => setMode("a4")}>Página A4 (ajustada)</button>
        <button className={mode === "image" ? "on" : ""} onClick={() => setMode("image")}>Tamanho da imagem</button>
      </div>
      <div className="filelist">
        {list.map((it, i) => (
          <div key={it.id} className="fileitem">
            <img src={it.url} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
            <span className="nm">{it.name}</span>
            <button className="ib" title="Mover para cima" onClick={() => setList((l) => { const n = [...l]; if (i > 0) [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}><ArrowUp size={15} /></button>
            <button className="ib" title="Mover para baixo" onClick={() => setList((l) => { const n = [...l]; if (i < n.length - 1) [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}><ArrowDown size={15} /></button>
            <button className="ib" title="Remover da lista" onClick={() => setList((l) => l.filter((x) => x.id !== it.id))}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------- exportar imagens ----------------
function ExportImagesDialog() {
  const t = getActiveTab();
  const [fmt, setFmt] = useState<"png" | "jpeg">("png");
  const [dpi, setDpi] = useState(150);
  const [pages, setPages] = useState("");
  const [prog, setProg] = useState<number | null>(null);
  if (!t) return <Modal title="Exportar como imagem"><div className="muted">Abra um PDF primeiro.</div></Modal>;
  const run = async () => {
    try {
      const idx = pages.trim() ? parseRanges(pages, t.pageCount) : Array.from({ length: t.pageCount }, (_, i) => i);
      setProg(0);
      const imgs = await pdfToImages(await tabBytes(t), idx, dpi, fmt, (i) => setProg(i / idx.length));
      const ext = fmt === "png" ? "png" : "jpg";
      const files = imgs.map((bytes, i) => ({ bytes, name: `${baseName(t.name)} - pag ${idx[i] + 1}.${ext}` }));
      if (await saveMany(files, `${baseName(t.name)} - imagens.zip`)) {
        useStore.getState().toast(`${files.length} imagem(ns) exportada(s)`);
        close();
      }
    } catch (e) {
      useStore.getState().toast((e as Error).message, "err");
    } finally {
      setProg(null);
    }
  };
  return (
    <Modal title="Exportar páginas como imagem" foot={<button className="btn" disabled={prog !== null} onClick={run}>Exportar</button>}>
      <div className="seg">
        <button className={fmt === "png" ? "on" : ""} onClick={() => setFmt("png")}>PNG</button>
        <button className={fmt === "jpeg" ? "on" : ""} onClick={() => setFmt("jpeg")}>JPG</button>
      </div>
      <div className="seg">
        {[72, 150, 300].map((d) => <button key={d} className={dpi === d ? "on" : ""} onClick={() => setDpi(d)}>{d} dpi{d === 150 ? " (recomendado)" : ""}</button>)}
      </div>
      <div className="field"><label>Páginas (vazio = todas)</label><input type="text" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="ex.: 1-3, 5" /></div>
      {prog !== null && <div className="progress"><div style={{ width: `${prog * 100}%` }} /></div>}
    </Modal>
  );
}

// ---------------- assinatura manuscrita ----------------
function SignaturePadDialog() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState("#0B2E8A");
  const [empty, setEmpty] = useState(true);
  const [keep, setKeep] = useState(true);
  const [saved, setSaved] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("auris.sigs") || "[]"); } catch { return []; } });
  const last = useRef<{ x: number; y: number; mx: number; my: number } | null>(null);

  useEffect(() => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2;
    c.height = r.height * 2;
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2 };
  };
  const down = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    const p = pos(e);
    last.current = { ...p, mx: p.x, my: p.y };
    const ctx = canvas.current!.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    setEmpty(false);
  };
  const move = (e: React.PointerEvent) => {
    const l = last.current;
    if (!l) return;
    const p = pos(e);
    const ctx = canvas.current!.getContext("2d")!;
    const mx = (l.x + p.x) / 2, my = (l.y + p.y) / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.4, 5.5 - Math.hypot(p.x - l.x, p.y - l.y) * 0.08);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(l.mx, l.my);
    ctx.quadraticCurveTo(l.x, l.y, mx, my);
    ctx.stroke();
    last.current = { ...p, mx, my };
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };
  const trimmed = () => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const pad = 8;
    const o = document.createElement("canvas");
    o.width = x1 - x0 + pad * 2;
    o.height = y1 - y0 + pad * 2;
    o.getContext("2d")!.drawImage(c, x0 - pad, y0 - pad, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL("image/png");
  };
  const persist = (list: string[]) => {
    setSaved(list);
    try { localStorage.setItem("auris.sigs", JSON.stringify(list)); } catch { /* cheio */ }
  };
  const use = async (src: string) => {
    close();
    await addImageAt(src, undefined, 160);
  };
  const confirmPad = () => {
    const src = trimmed();
    if (keep) persist([src, ...saved].slice(0, 6));
    use(src);
  };
  const importImg = async () => {
    const [f] = await pickFiles("image", false);
    if (!f) return;
    const ext = f.name.split(".").pop()!.toLowerCase();
    const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }));
    const img = await loadImage(url);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const src = await removeWhite(c.toDataURL("image/png"));
    if (keep) persist([src, ...saved].slice(0, 6));
    use(src);
  };
  return (
    <Modal title="Assinatura manuscrita / rubrica" icon="assinatura-manuscrita" wide foot={<>
      <button className="btn ghost" style={{ marginRight: "auto" }} onClick={importImg}><Upload size={15} /> Importar imagem (remove o fundo)</button>
      <button className="btn ghost" onClick={clear}><Eraser size={15} /> Limpar</button>
      <button className="btn" disabled={empty} onClick={confirmPad}><Check size={16} /> Inserir</button>
    </>}>
      {!!saved.length && (
        <div className="field">
          <label>Minhas assinaturas (clique para inserir)</label>
          <div className="saved-sigs">
            {saved.map((s, i) => (
              <div key={i} className="saved-sig" onClick={() => use(s)}>
                <img src={s} />
                <button className="del" onClick={(e) => { e.stopPropagation(); persist(saved.filter((_, k) => k !== i)); }}><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      <canvas ref={canvas} className="pad-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={() => (last.current = null)} />
      <div className="row" style={{ flex: "none" }}>
        <span className="muted" style={{ flex: "none" }}>Cor:</span>
        {["#0B2E8A", "#111111", "#185FA5"].map((c) => <button key={c} className={`swatch ${color === c ? "on" : ""}`} style={{ background: c, flex: "none" }} onClick={() => setColor(c)} />)}
        <label className="check" style={{ marginLeft: "auto", flex: "none" }}><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Guardar para reutilizar</label>
      </div>
      <div className="muted">Assine com o mouse, touchpad ou caneta. Depois de inserir, arraste e redimensione; use “Em todas as páginas” para rubricar o documento inteiro.</div>
    </Modal>
  );
}

// ---------------- senha ----------------
function PasswordDialog({ d }: { d: Extract<Dialog, { kind: "password" }> }) {
  const [p, setP] = useState("");
  const done = (v: string | null) => {
    useStore.getState().openDialog(null);
    d.resolve(v);
  };
  return (
    <Modal title="PDF protegido por senha" onClose={() => done(null)} foot={<>
      <button className="btn ghost" onClick={() => done(null)}>Cancelar</button>
      <button className="btn" onClick={() => done(p)}>Abrir</button>
    </>}>
      {d.retry && <div className="muted" style={{ color: "var(--red)" }}>Senha incorreta. Tente novamente.</div>}
      <div className="field"><label>Senha do documento</label><input type="password" autoFocus value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === "Enter" && done(p)} /></div>
    </Modal>
  );
}

function AboutDialog() {
  const [ver, setVer] = useState("");
  useEffect(() => { appVersion().then(setVer); }, []);
  return (
    <Modal title="Sobre o Auris PDF" foot={<button className="btn" onClick={close}>Fechar</button>}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ flex: "none" }}><b>Auris PDF</b> • versão {ver}</div>
        {isApp && <button className="btn ghost" style={{ flex: "none" }} onClick={() => { close(); checkForUpdate(true); }}>Verificar atualizações</button>}
      </div>
      <div className="muted">
        Leitor e editor de PDF: visualização rápida, formulários, anotações, imagens, carimbos, assinatura manuscrita e digital (ICP-Brasil A1/A3),
        organizar, juntar, dividir, comprimir e converter. Tudo é processado localmente — nenhum arquivo sai do seu computador.
      </div>
      <div className="muted">Motor de renderização: PDF.js (Apache 2.0) • Edição: pdf-lib (MIT) • Criptografia: node-forge (BSD).</div>
    </Modal>
  );
}
