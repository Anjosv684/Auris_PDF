import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload, Eraser, X, Check, KeyRound, Stamp, PenLine, CircleCheck, CircleAlert, Loader2, FolderOpen, FileText } from "lucide-react";
import { useStore, getActiveTab, type Dialog } from "../lib/store";
import { pickFiles, saveMany, isApp, writePath, openPath } from "../lib/platform";
import { baseName, uid, removeWhite, loadImage, dataUrlToBytes } from "../lib/util";
import { openBytes } from "../lib/actions";
import { buildPdf } from "../lib/export";
import { openPdf, renderPage } from "../lib/pdfjs";
import { signBatch, type BatchFile, type BatchMode, type Place, type PageRule } from "../lib/signbatch";
import { useCertPicker } from "./CertPicker";
import { Modal } from "./Dialogs";

type Item = BatchFile & { id: string; status?: "run" | "ok" | "err"; msg?: string; out?: Uint8Array };
type Mode = "cert" | "stamp" | "hand";

const REASONS = ["Concordo com o conteúdo do documento", "Aprovação", "Ciência", "Testemunha", "Sou o autor do documento", "Revisão"];
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
function PlacePreview({ file, rule, place, setPlace, aspect, solid, children }: {
  file?: BatchFile; rule: PageRule; place: Place | null; setPlace: (p: Place) => void; aspect: number | null; solid: boolean; children: React.ReactNode;
}) {
  const [shot, setShot] = useState<{ url: string; W: number; H: number; n: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "move" | "size"; x: number; y: number; p: Place } | null>(null);

  useEffect(() => {
    if (!file) { setShot(null); return; }
    let alive = true;
    (async () => {
      const pdf = await openPdf(file.bytes);
      try {
        const n = pdf.numPages;
        const no = rule === "ultima" ? n : rule === "primeira" || rule === "todas" ? 1 : Math.min(Math.max(1, rule), n);
        const vp = (await pdf.getPage(no)).getViewport({ scale: 1 });
        const c = await renderPage(pdf, no, { width: 560 });
        if (alive) setShot({ url: c.toDataURL("image/jpeg", 0.85), W: vp.width, H: vp.height, n });
      } finally {
        pdf.destroy();
      }
    })().catch(() => alive && setShot(null));
    return () => { alive = false; };
  }, [file?.bytes, rule]);

  // posição inicial: canto inferior direito
  useEffect(() => {
    if (!shot || place) return;
    const w = Math.min(190, shot.W * 0.4), h = aspect ? w / aspect : 62;
    setPlace({ page: rule, rx: (shot.W - w - 36) / shot.W, ry: (shot.H - h - 50) / shot.H, w, h });
  }, [shot, place]);

  if (!file) return <div className="sb-preview empty"><FileText size={28} /><span>Adicione um PDF para escolher o local da assinatura</span></div>;
  if (!shot || !place) return <div className="sb-preview empty"><Loader2 size={22} className="sb-spin" /><span>Carregando a página…</span></div>;
  const { W, H } = shot;
  const preset = (fx: number, fy: number) => setPlace({ ...place, rx: (fx * (W - place.w)) / W, ry: (fy * (H - place.h)) / H });

  const down = (e: React.PointerEvent, kind: "move" | "size") => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, p: place };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !box.current) return;
    const k = W / box.current.getBoundingClientRect().width; // px da tela → pontos
    const dx = (e.clientX - d.x) * k, dy = (e.clientY - d.y) * k;
    if (d.kind === "move") {
      const x = Math.min(Math.max(0, d.p.rx * W + dx), W - d.p.w);
      const y = Math.min(Math.max(0, d.p.ry * H + dy), H - d.p.h);
      setPlace({ ...d.p, rx: x / W, ry: y / H });
    } else {
      let w = Math.min(Math.max(40, d.p.w + dx), W - d.p.rx * W);
      let h = aspect ? w / aspect : Math.min(Math.max(20, d.p.h + dy), H - d.p.ry * H);
      if (aspect && h > H - d.p.ry * H) { h = H - d.p.ry * H; w = h * aspect; }
      setPlace({ ...d.p, w, h });
    }
  };

  return <>
    <div className="sb-preview" ref={box} onPointerMove={move} onPointerUp={() => (drag.current = null)}>
      <img src={shot.url} draggable={false} />
      <div className={`sb-rect ${solid ? "solid" : ""}`} style={{ left: `${place.rx * 100}%`, top: `${place.ry * 100}%`, width: `${(place.w / W) * 100}%`, height: `${(place.h / H) * 100}%` }}
        onPointerDown={(e) => down(e, "move")} title="Arraste para posicionar">
        {children}
        <span className="sb-handle" onPointerDown={(e) => down(e, "size")} title="Arraste para redimensionar" />
      </div>
    </div>
    <div className="sb-presets">
      <span className="muted">Atalhos:</span>
      <button onClick={() => preset(0.06, 0.94)}>↙ Esquerda</button>
      <button onClick={() => preset(0.5, 0.94)}>↓ Centro</button>
      <button onClick={() => preset(0.94, 0.94)}>↘ Direita</button>
    </div>
    <div className="muted" style={{ fontSize: 11.5 }}>Prévia de <b>{file.name}</b> ({shot.n} pág.). A mesma posição vale para todos os PDFs.</div>
  </>;
}

// ------------------------------------------------------------ diálogo
export function SignBatchDialog({ d }: { d: Extract<Dialog, { kind: "sign-batch" }> }) {
  const [list, setList] = useState<Item[]>(() => (d.files ?? []).map((f) => ({ ...f, id: uid() })));
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("auris.batch.mode") as Mode) || "cert");
  const [rule, setRule] = useState<PageRule>("ultima");
  const [pageNo, setPageNo] = useState(1);
  const [place, setPlace] = useState<Place | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [location, setLocation] = useState(() => localStorage.getItem("auris.loc") || "");
  const [visible, setVisible] = useState(true);
  const [showDoc, setShowDoc] = useState(true);
  const [withImg, setWithImg] = useState(false);
  const [stamps, setStamps] = useState(() => loadList("auris.stamps"));
  const [sigs, setSigs] = useState(() => loadList("auris.sigs"));
  const [img, setImg] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [noWhite, setNoWhite] = useState(true);
  const [aspect, setAspect] = useState<number | null>(null);
  const [beside, setBeside] = useState(true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ dir?: string } | null>(null);
  const cert = useCertPicker();

  const certMode = mode === "cert";
  // imagem em uso: carimbo PNG, desenho, ou rubrica dentro do quadro do certificado
  const image = mode === "stamp" ? img : mode === "hand" ? drawn : withImg ? img : null;

  useEffect(() => { localStorage.setItem("auris.batch.mode", mode); }, [mode]);
  useEffect(() => { if (certMode && rule === "todas") setRule("ultima"); }, [mode]);
  // proporção da imagem → o quadro segue a forma dela
  useEffect(() => {
    if (!image || certMode) { setAspect(null); return; }
    loadImage(image).then((i) => setAspect(i.naturalWidth / i.naturalHeight)).catch(() => setAspect(null));
  }, [image, certMode]);
  useEffect(() => {
    if (!place) return;
    if (aspect) setPlace({ ...place, h: place.w / aspect });
    else if (certMode) setPlace({ ...place, w: Math.max(place.w, 150), h: Math.max(62, Math.min(place.h, 90)) });
  }, [aspect, certMode]);

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
  const keepDrawn = () => {
    if (!drawn) return;
    const l = [drawn, ...sigs.filter((x) => x !== drawn)];
    setSigs(l);
    saveList("auris.sigs", l);
    useStore.getState().toast("Assinatura guardada em “Minhas assinaturas”.", "info");
  };

  const ready = list.length > 0 && !!place && (certMode ? cert.ready && (!withImg || !!img) : !!image);
  const status = (i: number, s: Item["status"], msg?: string) => setList((l) => l.map((x, k) => (k === i ? { ...x, status: s, msg } : x)));

  const run = async () => {
    const st = useStore.getState();
    let m: BatchMode;
    try {
      if (certMode) {
        localStorage.setItem("auris.loc", location);
        m = { kind: "cert", signer: cert.signer(), reason, location, showDoc, visible, image: image ? dataUrlToBytes(image).bytes : undefined };
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
      setDone({ dir });
    } finally {
      setRunning(false);
    }
  };

  const openAll = () => {
    list.forEach((it) => it.out && openBytes({ name: `${baseName(it.name)} (assinado).pdf`, bytes: it.out }));
    close();
  };

  // conteúdo dentro do quadro da prévia
  const inner = certMode ? (
    visible ? <div className="sb-cert">
      {withImg && img && <img src={img} />}
      <div><small>Assinado digitalmente por</small><b>{cert.ready ? "Titular do certificado" : "Seu nome"}</b><small>Data: {new Date().toLocaleDateString("pt-BR")}</small></div>
    </div> : <div className="sb-cert invisible">Assinatura invisível<br /><small>(só os dados digitais)</small></div>
  ) : image ? <img src={image} className="sb-img" /> : <div className="sb-cert invisible">{mode === "hand" ? "Desenhe sua assinatura" : "Escolha a imagem"}</div>;

  return (
    <Modal title="Assinar PDFs" icon="assinatura-digital" cls="sb-modal" onClose={running ? () => {} : undefined} foot={<>
      {isApp && <label className="check" style={{ marginRight: "auto" }} title="Desmarcado: você escolhe a pasta">
        <input type="checkbox" checked={beside} onChange={(e) => setBeside(e.target.checked)} /> Salvar ao lado do original como “nome (assinado).pdf”
      </label>}
      {done ? <>
        {done.dir && <button className="btn ghost" onClick={() => openPath(done.dir!)}><FolderOpen size={15} /> Abrir pasta</button>}
        <button className="btn ghost" onClick={openAll}>Abrir no Auris</button>
        <button className="btn" onClick={close}><Check size={16} /> Concluir</button>
      </> : (
        <button className="btn" onClick={run} disabled={!ready || running}>
          {running ? <><Loader2 size={16} className="sb-spin" /> Assinando…</> : <><KeyRound size={16} /> Assinar {list.length > 1 ? `${list.length} PDFs` : "PDF"}</>}
        </button>
      )}
    </>}>
      <div className="sb-grid">
        <div className="sb-col">
          <div className="step"><span>1</span> PDFs para assinar</div>
          <div className="filelist sb-files">
            {list.map((it) => (
              <div key={it.id} className="fileitem">
                <span className="pdf-badge">PDF</span>
                <span className="nm" title={it.path || it.name}>{it.name}</span>
                {it.status === "run" && <Loader2 size={15} className="sb-spin ic-accent" />}
                {it.status === "ok" && <CircleCheck size={16} style={{ color: "var(--green)" }} />}
                {it.status === "err" && <span title={it.msg} style={{ color: "var(--red)", display: "flex", gap: 4, alignItems: "center", fontSize: 12, maxWidth: 220 }}><CircleAlert size={16} style={{ flex: "none" }} /><span className="nm">{it.msg}</span></span>}
                {!running && <button className="ib" title="Tirar da lista" onClick={() => { setList((l) => l.filter((x) => x.id !== it.id)); setDone(null); }}><Trash2 size={15} /></button>}
              </div>
            ))}
            {!list.length && <button className="sb-add-big" onClick={add}><Plus size={18} /> Escolher PDFs (pode selecionar vários)</button>}
          </div>
          {!!list.length && <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={add} disabled={running}><Plus size={15} /> Adicionar mais</button>}

          <div className="step"><span>2</span> Como assinar</div>
          <div className="seg">
            <button className={mode === "cert" ? "on" : ""} onClick={() => setMode("cert")}><KeyRound size={15} style={{ verticalAlign: -3 }} /> Certificado digital</button>
            <button className={mode === "stamp" ? "on" : ""} onClick={() => { setMode("stamp"); if (!img || !stamps.includes(img)) setImg(stamps[0] ?? null); }}><Stamp size={15} style={{ verticalAlign: -3 }} /> Carimbo (imagem)</button>
            <button className={mode === "hand" ? "on" : ""} onClick={() => setMode("hand")}><PenLine size={15} style={{ verticalAlign: -3 }} /> À mão</button>
          </div>

          {certMode && <>
            {cert.ui}
            <div className="row">
              <div className="field">
                <label>Motivo</label>
                <select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              </div>
              <div className="field">
                <label>Local (opcional)</label>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="ex.: Aracaju/SE" />
              </div>
            </div>
            <div className="row" style={{ flex: "none", gap: 16, flexWrap: "wrap" }}>
              <label className="check" style={{ flex: "none" }}><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Quadro visível na página</label>
              <label className="check" style={{ flex: "none" }}><input type="checkbox" checked={showDoc} onChange={(e) => setShowDoc(e.target.checked)} /> Mostrar CPF/CNPJ (parcial)</label>
              {visible && <label className="check" style={{ flex: "none" }}><input type="checkbox" checked={withImg} onChange={(e) => { setWithImg(e.target.checked); if (e.target.checked && !img) setImg(sigs[0] ?? stamps[0] ?? null); }} /> Incluir minha rubrica/carimbo no quadro</label>}
            </div>
            {visible && withImg && <>
              <Gallery list={[...sigs, ...stamps]} value={img} onPick={setImg} />
              {!sigs.length && !stamps.length && <div className="muted">Nenhuma imagem guardada ainda.</div>}
              <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => importImg("sig")}><Upload size={15} /> Escolher imagem…</button>
            </>}
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
            {drawn && !sigs.includes(drawn) && <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={keepDrawn}><Check size={15} /> Guardar esta assinatura</button>}
          </>}
        </div>

        <div className="sb-col sb-side">
          <div className="step"><span>3</span> Onde assinar</div>
          <div className="row field" style={{ flex: "none", flexDirection: "row", alignItems: "center" }}>
            <select style={{ flex: 1 }} value={typeof rule === "number" ? "num" : rule} onChange={(e) => setRule(e.target.value === "num" ? pageNo : (e.target.value as PageRule))}>
              <option value="ultima">Última página</option>
              <option value="primeira">Primeira página</option>
              {!certMode && <option value="todas">Todas as páginas</option>}
              <option value="num">Página número…</option>
            </select>
            {typeof rule === "number" && <input type="number" min={1} value={pageNo} style={{ width: 76, flex: "none" }}
              onChange={(e) => { const n = Math.max(1, +e.target.value || 1); setPageNo(n); setRule(n); }} />}
          </div>
          <PlacePreview file={list[0]} rule={rule} place={place} setPlace={setPlace} aspect={aspect} solid={certMode && visible}>{inner}</PlacePreview>
        </div>
      </div>
    </Modal>
  );
}
