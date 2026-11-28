import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload, Eraser, X, Check, KeyRound, Stamp, PenLine, CircleCheck, CircleAlert, Loader2, FolderOpen, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { useStore, getActiveTab, type Dialog } from "../lib/store";
import { pickFiles, saveMany, isApp, writePath, openPath } from "../lib/platform";
import { baseName, uid, removeWhite, loadImage, dataUrlToBytes } from "../lib/util";
import { openBytes } from "../lib/actions";
import { buildPdf } from "../lib/export";
import { openPdf, renderPage } from "../lib/pdfjs";
import { signBatch, type BatchFile, type BatchMode, type Place, type PageRule } from "../lib/signbatch";
import { useCertPicker } from "./CertPicker";
import { Modal } from "./Dialogs";
import { SigSvg, TemplatePicker, useMeasure } from "./SigTemplate";
import { savedTemplate, saveTemplate, templateById, type DocMode, type SigData } from "../lib/sigtemplates";

type Item = BatchFile & { id: string; status?: "run" | "ok" | "err"; msg?: string; out?: Uint8Array };
type Mode = "cert" | "stamp" | "hand";

const REASONS = ["", "Concordo com o conteúdo do documento", "Aprovação", "Ciência", "Testemunha", "Sou o autor do documento", "Revisão"];
const close = () => useStore.getState().openDialog(null);

/** Abre a assinatura em lote; com um PDF aberto, ele já entra na lista. */
export async function openBatch(files?: BatchFile[]) {
  const st = useStore.getState();
  const t = getActiveTab();
  if (!files && t) {
    const edited = t.objects.some((o) => o.type !== "sigfield") || t.formDirty;
    files = [{ name: t.name, path: t.path, bytes: edited ? await buildPdf(t) : t.bytes }];
  }
  st.openDialog({ kind: "sign-batch", files });
}

// ------------------------------------------------------------ imagens guardadas
const loadList = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };
const saveList = (k: string, l: string[]) => { try { localStorage.setItem(k, JSON.stringify(l.slice(0, 6))); } catch { /* cheio */ } };

/** Converte qualquer imagem em PNG (até 1200 px), opcionalmente sem o fundo branco. */
async function toPng(bytes: Uint8Array, name: string, noWhite: boolean) {
  const ext = name.split(".").pop()!.toLowerCase();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }));
  try {
    const img = await loadImage(url);
    const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const png = c.toDataURL("image/png");
    return noWhite ? removeWhite(png) : png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Gallery({ list, value, onPick, onDelete }: { list: string[]; value: string | null; onPick: (s: string) => void; onDelete?: (i: number) => void }) {
  if (!list.length) return null;
  return (
    <div className="saved-sigs">
      {list.map((s, i) => (
        <div key={i} className={`saved-sig ${value === s ? "on" : ""}`} onClick={() => onPick(s)}>
          <img src={s} />
          {onDelete && <button className="del" title="Apagar" onClick={(e) => { e.stopPropagation(); onDelete(i); }}><X size={12} /></button>}
        </div>
      ))}
    </div>
  );
}

/** Quadro para assinar com o mouse/caneta. Entrega o PNG recortado a cada traço. */
function SigPad({ onChange }: { onChange: (png: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState("#0B2E8A");
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
  const trimmed = () => {
    const c = canvas.current!;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const pad = 8;
    const o = document.createElement("canvas");
    o.width = x1 - x0 + pad * 2;
    o.height = y1 - y0 + pad * 2;
    o.getContext("2d")!.drawImage(c, x0 - pad, y0 - pad, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL("image/png");
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
  const up = () => {
    if (!last.current) return;
    last.current = null;
    onChange(trimmed());
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    onChange(null);
  };
  return <>
    <canvas ref={canvas} className="pad-canvas sb-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    <div className="row" style={{ flex: "none" }}>
      <span className="muted" style={{ flex: "none" }}>Cor:</span>
      {["#0B2E8A", "#111111", "#185FA5"].map((c) => <button key={c} className={`swatch ${color === c ? "on" : ""}`} style={{ background: c, flex: "none" }} onClick={() => setColor(c)} />)}
      <button className="btn ghost" style={{ marginLeft: "auto", flex: "none", height: 30 }} onClick={clear}><Eraser size={14} /> Limpar</button>
    </div>
  </>;
}

// ------------------------------------------------------------ prévia / posição
type Corner = "nw" | "ne" | "sw" | "se";

function PlacePreview({ files, idx, setIdx, rule, setRule, place, setPlace, aspect, size, show, children }: {
  files: BatchFile[]; idx: number; setIdx: (i: number) => void; rule: PageRule; setRule: (r: PageRule) => void;
  place: Place | null; setPlace: (p: Place) => void; aspect: number | null; size: [number, number]; show: boolean; children: React.ReactNode;
}) {
  const file = files[idx];
  const [shot, setShot] = useState<{ url: string; W: number; H: number; n: number; no: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ kind: "move" | Corner; x: number; y: number; p: Place } | null>(null);

  useEffect(() => {
    if (!file) { setShot(null); return; }
    let alive = true;
    (async () => {
      const pdf = await openPdf(file.bytes);
      try {
        const n = pdf.numPages;
        const no = rule === "ultima" ? n : rule === "primeira" || rule === "todas" ? 1 : Math.min(Math.max(1, rule), n);
        const vp = (await pdf.getPage(no)).getViewport({ scale: 1 });
        const c = await renderPage(pdf, no, { width: Math.min(1400, Math.round(vp.width * 2)) });
        if (alive) setShot({ url: c.toDataURL("image/jpeg", 0.88), W: vp.width, H: vp.height, n, no });
      } finally {
        pdf.destroy();
      }
    })().catch(() => alive && setShot(null));
    return () => { alive = false; };
  }, [file?.bytes, rule]);

  // página cabe inteira no espaço disponível
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !shot) return;
    const calc = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / shot.W, r.height / shot.H);
      setFit({ w: shot.W * k, h: shot.H * k });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shot?.W, shot?.H]);

  // posição inicial (canto inferior direito) e correção quando sai da página
  useEffect(() => {
    if (!shot) return;
    const { W, H } = shot;
    if (!place) {
      const w = Math.min(size[0], W * 0.45), h = aspect ? w / aspect : size[1] * (w / size[0]);
      setPlace({ page: rule, rx: (W - w - 36) / W, ry: (H - h - 46) / H, w, h });
      return;
    }
    const k = Math.min(1, W / place.w, H / place.h);
    const w = place.w * k, h = place.h * k;
    const rx = Math.min(Math.max(0, place.rx), (W - w) / W), ry = Math.min(Math.max(0, place.ry), (H - h) / H);
    if (w !== place.w || h !== place.h || rx !== place.rx || ry !== place.ry) setPlace({ ...place, rx, ry, w, h });
  }, [shot, place]);

  const head = (
    <div className="sb-prevhead">
      {files.length > 1 ? <>
        <button className="ib" disabled={idx === 0} onClick={() => setIdx(idx - 1)} title="PDF anterior"><ChevronLeft size={16} /></button>
        <span className="nm" title={file?.name}>{file?.name}</span>
        <span className="muted" style={{ flex: "none" }}>{idx + 1}/{files.length}</span>
        <button className="ib" disabled={idx >= files.length - 1} onClick={() => setIdx(idx + 1)} title="Próximo PDF"><ChevronRight size={16} /></button>
      </> : <span className="nm">{file?.name ?? "Pré-visualização"}</span>}
      {shot && <span className="sb-pages">
        <button className="ib" disabled={shot.no <= 1} onClick={() => setRule(shot.no - 1)} title="Página anterior"><ChevronLeft size={15} /></button>
        Pág. {shot.no} de {shot.n}
        <button className="ib" disabled={shot.no >= shot.n} onClick={() => setRule(shot.no + 1)} title="Próxima página"><ChevronRight size={15} /></button>
      </span>}
    </div>
  );

  if (!file) return <>{head}<div className="sb-stage"><div className="sb-preview empty"><FileText size={28} /><span>Adicione um PDF para escolher o local da assinatura</span></div></div></>;
  if (!shot || !place) return <>{head}<div className="sb-stage" ref={stage}><div className="sb-preview empty"><Loader2 size={22} className="sb-spin" /><span>Carregando a página…</span></div></div></>;
  const { W, H } = shot;
  const preset = (fx: number, fy: number) => setPlace({ ...place, rx: (fx * (W - place.w)) / W, ry: (fy * (H - place.h)) / H });

  const down = (e: React.PointerEvent, kind: "move" | Corner) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, p: place };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !fit) return;
    const k = W / fit.w; // px da tela → pontos
    const dx = (e.clientX - d.x) * k, dy = (e.clientY - d.y) * k;
    const r0 = { x: d.p.rx * W, y: d.p.ry * H, w: d.p.w, h: d.p.h };
    if (d.kind === "move") {
      const x = Math.min(Math.max(0, r0.x + dx), W - r0.w);
      const y = Math.min(Math.max(0, r0.y + dy), H - r0.h);
      setPlace({ ...d.p, rx: x / W, ry: y / H });
      return;
    }
    const c = d.kind;
    const maxW = c.includes("e") ? W - r0.x : r0.x + r0.w;
    const maxH = c.includes("s") ? H - r0.y : r0.y + r0.h;
    let w = Math.max(36, c.includes("e") ? r0.w + dx : r0.w - dx);
    let h = Math.max(14, c.includes("s") ? r0.h + dy : r0.h - dy);
    if (aspect) h = w / aspect;
    if (w > maxW) { w = maxW; if (aspect) h = w / aspect; }
    if (h > maxH) { h = maxH; if (aspect) w = h * aspect; }
    const x = c.includes("w") ? r0.x + r0.w - w : r0.x;
    const y = c.includes("n") ? r0.y + r0.h - h : r0.y;
    setPlace({ ...d.p, rx: x / W, ry: y / H, w, h });
  };

  return <>
    {head}
    <div className="sb-stage" ref={stage}>
      <div className="sb-preview" style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }} onPointerMove={move} onPointerUp={() => (drag.current = null)}>
        <img src={shot.url} draggable={false} />
        {show && <div className="sb-rect" style={{ left: `${place.rx * 100}%`, top: `${place.ry * 100}%`, width: `${(place.w / W) * 100}%`, height: `${(place.h / H) * 100}%` }}
          onPointerDown={(e) => down(e, "move")} title="Arraste para posicionar">
          {children}
          {(["nw", "ne", "sw", "se"] as Corner[]).map((c) => <span key={c} className={`sb-handle ${c}`} onPointerDown={(e) => down(e, c)} title="Arraste para redimensionar" />)}
        </div>}
      </div>
    </div>
    {show && <div className="sb-presets">
      <span className="muted">Posição rápida:</span>
      <button onClick={() => preset(0.06, 0.06)} title="Canto superior esquerdo">↖</button>
      <button onClick={() => preset(0.94, 0.06)} title="Canto superior direito">↗</button>
      <button onClick={() => preset(0.06, 0.94)} title="Canto inferior esquerdo">↙</button>
      <button onClick={() => preset(0.5, 0.94)} title="Embaixo, no centro">↓</button>
      <button onClick={() => preset(0.94, 0.94)} title="Canto inferior direito">↘</button>
      <span className="muted" style={{ marginLeft: "auto" }}>Arraste o quadro e puxe os cantos para mudar o tamanho.</span>
    </div>}
    {files.length > 1 && <div className="muted" style={{ fontSize: 11.5 }}>A mesma posição vale para todos os {files.length} PDFs. Use as setas para conferir como fica em cada um.</div>}
  </>;
}

// ------------------------------------------------------------ diálogo
/** Últimas escolhas: voltam sozinhas na próxima vez. */
type Last = {
  mode?: Mode; rule?: PageRule; place?: Place | null; reason?: string; visible?: boolean; withImg?: boolean;
  img?: string | null; drawn?: string | null; noWhite?: boolean; beside?: boolean;
};
const LAST_KEY = "auris.sign.last";
const loadLast = (): Last => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || "{}"); } catch { return {}; } };
function saveLast(l: Last) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(l)); } catch {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ ...l, img: null, drawn: null })); } catch { /* cheio */ }
  }
}
const DOC_MODES: { v: DocMode; l: string }[] = [
  { v: "full", l: "CPF/CNPJ completo" },
  { v: "mask", l: "CPF parcial (***.456.789-**)" },
  { v: "none", l: "Não mostrar CPF/CNPJ" },
];

export function SignBatchDialog({ d }: { d: Extract<Dialog, { kind: "sign-batch" }> }) {
  const [list, setList] = useState<Item[]>(() => (d.files ?? []).map((f) => ({ ...f, id: uid() })));
  const [last] = useState(loadLast);
  const [prevIdx, setPrevIdx] = useState(0);
  const [mode, setMode] = useState<Mode>(() => last.mode || (localStorage.getItem("auris.batch.mode") as Mode) || "cert");
  const [rule, setRule] = useState<PageRule>(last.rule ?? "ultima");
  const [place, setPlace] = useState<Place | null>(last.place ?? null);
  const [reason, setReason] = useState(last.reason ?? "");
  const [location, setLocation] = useState(() => localStorage.getItem("auris.loc") || "");
  const [visible, setVisible] = useState(last.visible ?? true);
  const [docMode, setDocMode] = useState<DocMode>(() => (localStorage.getItem("auris.sig.doc") as DocMode) || "full");
  const [tpl, setTpl] = useState(savedTemplate);
  const [withImg, setWithImg] = useState(last.withImg ?? false);
  const [stamps, setStamps] = useState(() => loadList("auris.stamps"));
  const [sigs, setSigs] = useState(() => loadList("auris.sigs"));
  const [img, setImg] = useState<string | null>(last.img ?? null);
  const [drawn, setDrawn] = useState<string | null>(last.drawn ?? null);
  const [noWhite, setNoWhite] = useState(last.noWhite ?? true);
  const [aspect, setAspect] = useState<number | null>(null);
  const [imgAspect, setImgAspect] = useState<number | undefined>();
  const [beside, setBeside] = useState(last.beside ?? true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ dir?: string } | null>(null);
  const cert = useCertPicker();
  const measure = useMeasure();

  const certMode = mode === "cert";
  // imagem em uso: carimbo PNG, desenho, ou rubrica dentro do quadro do certificado
  const image = mode === "stamp" ? img : mode === "hand" ? drawn : withImg ? img : null;
  const tplSize = templateById(tpl).size;

  useEffect(() => { localStorage.setItem("auris.batch.mode", mode); }, [mode]);
  useEffect(() => { localStorage.setItem("auris.sig.doc", docMode); }, [docMode]);
  useEffect(() => { if (certMode && rule === "todas") setRule("ultima"); }, [mode]);
  useEffect(() => { if (prevIdx >= list.length) setPrevIdx(Math.max(0, list.length - 1)); }, [list.length]);
  useEffect(() => {
    if (!image) { setImgAspect(undefined); return; }
    loadImage(image).then((i) => setImgAspect(i.naturalWidth / i.naturalHeight)).catch(() => setImgAspect(undefined));
  }, [image]);
  // imagem pura: o quadro segue a proporção dela
  useEffect(() => { setAspect(!certMode && imgAspect ? imgAspect : null); }, [imgAspect, certMode]);
  // guarda as escolhas a cada mudança (sem perguntar)
  useEffect(() => {
    const t = setTimeout(() => saveLast({ mode, rule, place, reason, visible, withImg, img, drawn, noWhite, beside }), 300);
    return () => clearTimeout(t);
  }, [mode, rule, place, reason, visible, withImg, img, drawn, noWhite, beside]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // mantém o tamanho lembrado
    if (!place) return;
    if (aspect) setPlace({ ...place, h: place.w / aspect });
    else if (certMode) setPlace({ ...place, w: tplSize[0], h: tplSize[1] });
  }, [aspect, certMode]);

  const pickTpl = (id: string) => {
    setTpl(id);
    saveTemplate(id);
    const [w, h] = templateById(id).size;
    if (place) setPlace({ ...place, w, h });
  };

  const add = async () => {
    const f = await pickFiles("pdf");
    setList((l) => [...l, ...f.filter((x) => !l.some((y) => y.path && y.path === x.path)).map((x) => ({ ...x, id: uid() }))]);
    setDone(null);
  };
  const importImg = async (into: "stamp" | "sig") => {
    const [f] = await pickFiles("image", false);
    if (!f) return;
    const png = await toPng(f.bytes, f.name, noWhite);
    if (into === "stamp") { const l = [png, ...stamps.filter((x) => x !== png)]; setStamps(l); saveList("auris.stamps", l); }
    else { const l = [png, ...sigs.filter((x) => x !== png)]; setSigs(l); saveList("auris.sigs", l); }
    setImg(png);
  };

  const ready = list.length > 0 && !!place && (certMode ? cert.ready && (!withImg || !!img) : !!image);
  const status = (i: number, s: Item["status"], msg?: string) => setList((l) => l.map((x, k) => (k === i ? { ...x, status: s, msg } : x)));

  const run = async () => {
    const st = useStore.getState();
    let m: BatchMode;
    try {
      if (certMode) {
        localStorage.setItem("auris.loc", location);
        m = { kind: "cert", signer: cert.signer(), reason, location, doc: docMode, template: tpl, visible, image: image ? dataUrlToBytes(image).bytes : undefined };
      } else m = { kind: "image", png: dataUrlToBytes(image!).bytes };
    } catch (e) {
      st.toast((e as Error).message, "err");
      return;
    }
    setRunning(true);
    setDone(null);
    setList((l) => l.map((x) => ({ ...x, status: undefined, msg: undefined, out: undefined })));
    try {
      const files = list.map(({ name, path, bytes }) => ({ name, path, bytes }));
      const res = await signBatch(files, m, { ...place!, page: rule }, (i, s, msg) => status(i, s, msg));
      // salvar
      const outName = (n: string) => `${baseName(n)} (assinado).pdf`;
      const pending: { name: string; bytes: Uint8Array }[] = [];
      let dir: string | undefined;
      for (let i = 0; i < res.length; i++) {
        const r = res[i];
        if (!(r instanceof Uint8Array)) continue;
        const it = list[i];
        setList((l) => l.map((x, k) => (k === i ? { ...x, out: r } : x)));
        if (isApp && beside && it.path) {
          const target = it.path.replace(/[^\\/]+$/, outName(it.name));
          try {
            await writePath(target, r);
            dir ??= it.path.replace(/[\\/][^\\/]+$/, "");
          } catch (e) { status(i, "err", "Não foi possível salvar: " + (e as Error).message); }
        } else pending.push({ name: outName(it.name), bytes: r });
      }
      if (pending.length) {
        const saved = await saveMany(pending, "PDFs assinados.zip");
        if (saved && isApp) dir ??= pending.length === 1 ? saved.replace(/[\\/][^\\/]+$/, "") : saved;
      }
      const ok = res.filter((r) => r instanceof Uint8Array).length;
      const bad = res.length - ok;
      if (ok) st.toast(`${ok} PDF${ok > 1 ? "s" : ""} assinado${ok > 1 ? "s" : ""}${bad ? ` • ${bad} com erro` : ""}`, bad ? "info" : "ok");
      else st.toast("Nenhum PDF foi assinado. Veja o motivo na lista.", "err");
      if (ok && mode === "hand" && drawn && !sigs.includes(drawn)) {
        const l = [drawn, ...sigs];
        setSigs(l);
        saveList("auris.sigs", l);
      }
      setDone({ dir });
    } finally {
      setRunning(false);
    }
  };

  const openAll = () => {
    list.forEach((it) => it.out && openBytes({ name: `${baseName(it.name)} (assinado).pdf`, bytes: it.out }));
    close();
  };

  // dados mostrados na prévia (o nome real aparece quando o certificado é escolhido)
  const sample: SigData = {
    name: cert.summary?.name || "Maria Silva",
    doc: cert.summary ? cert.summary.doc : "12345678909",
    docMode, date: new Date(), location: location || undefined, icp: cert.summary?.icp ?? true,
    img: withImg && img ? imgAspect : undefined,
  };

  // conteúdo dentro do quadro da prévia
  const inner = certMode
    ? (measure && place ? <SigSvg tpl={tpl} w={place.w} h={place.h} data={sample} img={withImg ? img : null} m={measure} /> : null)
    : image ? <img src={image} className="sb-img" /> : <div className="sb-cert invisible">{mode === "hand" ? "Desenhe sua assinatura" : "Escolha a imagem"}</div>;

  const n = list.length;
  return (
    <Modal title={n > 1 ? `Assinar ${n} PDFs` : "Assinar PDF"} icon="assinatura-digital" cls="sb-modal" onClose={running ? () => {} : undefined} foot={<>
      {isApp && <label className="check" style={{ marginRight: "auto" }} title="Desmarcado: você escolhe a pasta">
        <input type="checkbox" checked={beside} onChange={(e) => setBeside(e.target.checked)} /> Salvar ao lado do original como “nome (assinado).pdf”
      </label>}
      {done ? <>
        {done.dir && <button className="btn ghost" onClick={() => openPath(done.dir!)}><FolderOpen size={15} /> Abrir pasta</button>}
        <button className="btn ghost" onClick={openAll}>Abrir no Auris</button>
        <button className="btn" onClick={close}><Check size={16} /> Concluir</button>
      </> : (
        <button className="btn" onClick={run} disabled={!ready || running}>
          {running ? <><Loader2 size={16} className="sb-spin" /> Assinando…</> : <><KeyRound size={16} /> Assinar {n > 1 ? `${n} PDFs` : "PDF"}</>}
        </button>
      )}
    </>}>
      <div className="sb-grid">
        <div className="sb-col sb-left">
          <div className="step"><span>1</span> PDFs para assinar</div>
          <div className="filelist sb-files">
            {list.map((it, i) => (
              <div key={it.id} className={`fileitem ${i === prevIdx ? "on" : ""}`} onClick={() => setPrevIdx(i)} title="Clique para ver na prévia" style={{ cursor: "pointer" }}>
                <span className="pdf-badge">PDF</span>
                <span className="nm" title={it.path || it.name}>{it.name}</span>
                {it.status === "run" && <Loader2 size={15} className="sb-spin ic-accent" />}
                {it.status === "ok" && <CircleCheck size={16} style={{ color: "var(--green)" }} />}
                {it.status === "err" && <span title={it.msg} style={{ color: "var(--red)", display: "flex", gap: 4, alignItems: "center", fontSize: 12, maxWidth: 220 }}><CircleAlert size={16} style={{ flex: "none" }} /><span className="nm">{it.msg}</span></span>}
                {!running && <button className="ib" title="Tirar da lista" onClick={(e) => { e.stopPropagation(); setList((l) => l.filter((x) => x.id !== it.id)); setDone(null); }}><Trash2 size={15} /></button>}
              </div>
            ))}
            {!n && <button className="sb-add-big" onClick={add}><Plus size={18} /> Escolher PDFs (pode selecionar vários)</button>}
          </div>
          {!!n && <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={add} disabled={running}><Plus size={15} /> Adicionar mais PDFs</button>}

          <div className="step"><span>2</span> Como assinar</div>
          <div className="seg">
            <button className={mode === "cert" ? "on" : ""} onClick={() => setMode("cert")}><KeyRound size={15} style={{ verticalAlign: -3 }} /> Certificado</button>
            <button className={mode === "stamp" ? "on" : ""} onClick={() => { setMode("stamp"); if (!img || !stamps.includes(img)) setImg(stamps[0] ?? null); }}><Stamp size={15} style={{ verticalAlign: -3 }} /> Carimbo</button>
            <button className={mode === "hand" ? "on" : ""} onClick={() => setMode("hand")}><PenLine size={15} style={{ verticalAlign: -3 }} /> À mão</button>
          </div>

          {certMode && <>
            {cert.ui}
            <div className="row" style={{ flex: "none", gap: 16, flexWrap: "wrap" }}>
              <label className="check" style={{ flex: "none" }}><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Quadro visível na página</label>
              {visible && <label className="check" style={{ flex: "none" }}><input type="checkbox" checked={withImg} onChange={(e) => { setWithImg(e.target.checked); if (e.target.checked && !img) setImg(sigs[0] ?? stamps[0] ?? null); }} /> Incluir minha rubrica/carimbo</label>}
            </div>
            {visible && <>
              <div className="field"><label>Modelo do quadro <span className="muted" style={{ fontWeight: 400 }}>(o escolhido fica como padrão)</span></label></div>
              <TemplatePicker value={tpl} onPick={pickTpl} data={sample} img={withImg ? img : null} />
              <div className="row">
                <div className="field">
                  <label>CPF/CNPJ no quadro</label>
                  <select value={docMode} onChange={(e) => setDocMode(e.target.value as DocMode)}>{DOC_MODES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
                </div>
                <div className="field">
                  <label>Local (opcional)</label>
                  <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="ex.: Aracaju/SE" />
                </div>
              </div>
              {cert.summary && !cert.summary.doc && docMode !== "none" && <div className="muted" style={{ fontSize: 11.5, color: "var(--amber)" }}>Este certificado não traz CPF/CNPJ, então o quadro sai sem ele.</div>}
            </>}
            {visible && withImg && <>
              <Gallery list={[...sigs, ...stamps]} value={img} onPick={setImg} />
              {!sigs.length && !stamps.length && <div className="muted">Nenhuma imagem guardada ainda.</div>}
              <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => importImg("sig")}><Upload size={15} /> Escolher imagem…</button>
            </>}
            <div className="field">
              <label>Motivo <span className="muted" style={{ fontWeight: 400 }}>(opcional; fica só nos dados da assinatura)</span></label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{r || "Não informar"}</option>)}</select>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              Assinatura PAdES com validade jurídica (ICP-Brasil), conferível em validar.iti.gov.br.
              {cert.isStore && isApp ? " Com token A3, o PIN é pedido uma vez só para todos os arquivos." : ""}
            </div>
          </>}

          {mode === "stamp" && <>
            <Gallery list={stamps} value={img} onPick={setImg} onDelete={(i) => { const l = stamps.filter((_, k) => k !== i); setStamps(l); saveList("auris.stamps", l); if (img === stamps[i]) setImg(null); }} />
            <div className="row" style={{ flex: "none" }}>
              <button className="btn ghost" style={{ flex: "none" }} onClick={() => importImg("stamp")}><Upload size={15} /> {stamps.length ? "Outra imagem…" : "Escolher imagem do carimbo (PNG)…"}</button>
              <label className="check" style={{ flex: "none" }}><input type="checkbox" checked={noWhite} onChange={(e) => setNoWhite(e.target.checked)} /> Tirar o fundo branco</label>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>A imagem fica guardada aqui para as próximas vezes. Não é uma assinatura digital: é a imagem do carimbo aplicada na página.</div>
          </>}

          {mode === "hand" && <>
            {!!sigs.length && <>
              <div className="field"><label>Minhas assinaturas (clique para usar)</label></div>
              <Gallery list={sigs} value={drawn} onPick={setDrawn} onDelete={(i) => { const l = sigs.filter((_, k) => k !== i); setSigs(l); saveList("auris.sigs", l); if (drawn === sigs[i]) setDrawn(null); }} />
            </>}
            <div className="field"><label>Assine no quadro abaixo com o mouse, touchpad ou caneta</label></div>
            <SigPad onChange={setDrawn} />
            {drawn && !sigs.includes(drawn) && <div className="muted" style={{ fontSize: 11.5 }}>Ela fica guardada em “Minhas assinaturas” automaticamente ao assinar.</div>}
          </>}
        </div>

        <div className="sb-col sb-side">
          <div className="row" style={{ flex: "none", alignItems: "center" }}>
            <div className="step" style={{ flex: 1 }}><span>3</span> Onde assinar</div>
            <div className="field" style={{ flex: "none" }}>
              <select value={typeof rule === "number" ? "num" : rule} onChange={(e) => setRule(e.target.value === "num" ? 1 : (e.target.value as PageRule))}>
                <option value="ultima">Última página</option>
                <option value="primeira">Primeira página</option>
                {!certMode && <option value="todas">Todas as páginas</option>}
                <option value="num">Página escolhida (use as setas)</option>
              </select>
            </div>
          </div>
          <PlacePreview files={list} idx={Math.min(prevIdx, Math.max(0, n - 1))} setIdx={setPrevIdx} rule={rule} setRule={setRule}
            place={place} setPlace={setPlace} aspect={aspect} size={certMode ? tplSize : [170, 70]} show={!certMode || visible}>{inner}</PlacePreview>
          {certMode && !visible && <div className="muted" style={{ fontSize: 11.5 }}>Assinatura invisível: só os dados digitais vão no PDF, nada aparece na página.</div>}
        </div>
      </div>
    </Modal>
  );
}
