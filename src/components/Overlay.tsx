import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import type { Obj, TextObj } from "../lib/types";
import { uid } from "../lib/util";
import { viewerApi } from "../lib/viewerApi";
import { FeatureIcon } from "./icons";
import { TextEditLayer } from "./TextEditLayer";
import { ObjMenu, type ObjMenuState } from "./ObjMenu";

const CREATE_TOOLS = new Set(["highlight", "rect", "ellipse", "line", "arrow", "ink", "text"]);
const STICKY = new Set(["ink", "highlight"]);
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];

type Guides = { v: number[]; h: number[] };

export const Overlay = memo(function Overlay({ page, w, h }: { page: number; w: number; h: number }) {
  const objects = useStore(useShallow((s) => s.tabs.find((t) => t.id === s.activeId)?.objects.filter((o) => o.page === page) ?? []));
  const tool = useStore((s) => s.tool);
  const selected = useStore((s) => s.selected);
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ink, setInk] = useState<number[] | null>(null);
  const [guides, setGuides] = useState<Guides>({ v: [], h: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<ObjMenuState>(null);
  const openMenu = useCallback((e: React.MouseEvent, o: Obj) => {
    if (editing === o.id) return; // no texto em edição, mantém o menu de copiar/colar
    e.preventDefault();
    e.stopPropagation();
    useStore.getState().select(o.id);
    setMenu({ id: o.id, x: e.clientX, y: e.clientY });
  }, [editing]);
  const creating = CREATE_TOOLS.has(tool);

  const toPdf = (e: { clientX: number; clientY: number }) => {
    const r = ref.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: w, height: h };
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h, k: w / r.width };
  };

  // ---------------- criação ----------------
  const start = useRef<{ x: number; y: number } | null>(null);
  const onCreateDown = (e: React.PointerEvent) => {
    if (!creating || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPdf(e);
    start.current = p;
    if (tool === "ink") setInk([p.x, p.y]);
    else setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onCreateMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = toPdf(e);
    if (tool === "ink") {
      setInk((pts) => (pts ? [...pts, p.x, p.y] : pts));
      return;
    }
    let x2 = p.x, y2 = p.y;
    if (e.shiftKey && (tool === "rect" || tool === "ellipse")) {
      const d = Math.max(Math.abs(x2 - start.current.x), Math.abs(y2 - start.current.y));
      x2 = start.current.x + Math.sign(x2 - start.current.x) * d;
      y2 = start.current.y + Math.sign(y2 - start.current.y) * d;
    }
    setDraft({ x: start.current.x, y: start.current.y, w: x2 - start.current.x, h: y2 - start.current.y });
  };
  const onCreateUp = () => {
    const s0 = start.current;
    start.current = null;
    if (!s0) return;
    const st = useStore.getState();
    const style = st.style;
    if (tool === "ink") {
      const pts = ink || [];
      setInk(null);
      if (pts.length < 2) return;
      const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
      const pad = style.strokeWidth;
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
      const bw = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 1), bh = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 1);
      const norm = pts.map((v, i) => (i % 2 === 0 ? (v - x) / bw : (v - y) / bh));
      st.addObj({ id: uid(), type: "ink", page, x, y, w: bw, h: bh, opacity: 1, stroke: style.stroke, strokeWidth: style.strokeWidth, points: [norm] });
      st.select(null);
      return;
    }
    const d = draft!;
    setDraft(null);
    let x = Math.min(d.x, d.x + d.w), y = Math.min(d.y, d.y + d.h);
    let bw = Math.abs(d.w), bh = Math.abs(d.h);
    const tiny = bw < 4 && bh < 4;
    const id = uid();
    const base = { id, page, opacity: 1 };
    let obj: Obj | null = null;
    switch (tool) {
      case "highlight":
        if (tiny) return;
        obj = { ...base, type: "highlight", color: style.highlight, x, y, w: bw, h: Math.max(bh, 6) };
        break;
      case "rect":
      case "ellipse":
        if (tiny) [bw, bh, x, y] = [120, 80, d.x - 60, d.y - 40];
        obj = { ...base, type: tool, x, y, w: bw, h: bh, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth };
        break;
      case "line":
      case "arrow": {
        if (tiny) return;
        const dir: 0 | 1 = Math.sign(d.w) === Math.sign(d.h) || d.h === 0 ? 0 : 1;
        const rev = d.w < 0 || (d.w === 0 && d.h < 0);
        obj = { ...base, type: "line", x, y, w: Math.max(bw, 0.5), h: Math.max(bh, 0.5), dir, rev, arrow: tool === "arrow", stroke: style.stroke, strokeWidth: style.strokeWidth };
        break;
      }
      case "text": {
        const size = style.textSize;
        if (tiny || bw < 30) [bw, bh] = [220, size * 1.25 + 8];
        obj = { ...base, type: "text", x, y, w: bw, h: Math.max(bh, size * 1.25 + 8), text: "", size, color: style.textColor, bold: false, bg: null };
        setEditing(id);
        break;
      }
    }
    if (!obj) return;
    st.addObj(obj);
    if (!STICKY.has(tool)) st.setTool("select");
    st.select(id);
  };

  // ---------------- mover / redimensionar ----------------
  const drag = useRef<{
    id: string; mode: "move" | Handle; sx: number; sy: number; o: Obj; started: boolean; k: number;
  } | null>(null);

  const snapTargets = (self: string) => {
    const v = [0, w / 2, w], hh = [0, h / 2, h];
    for (const o of objects) if (o.id !== self) {
      v.push(o.x, o.x + o.w / 2, o.x + o.w);
      hh.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    return { v, h: hh };
  };

  const onObjDown = (e: React.PointerEvent, o: Obj, mode: "move" | Handle) => {
    if (e.button !== 0 || editing === o.id) return;
    e.stopPropagation();
    e.preventDefault();
    useStore.getState().select(o.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPdf(e);
    drag.current = { id: o.id, mode, sx: p.x, sy: p.y, o: { ...o }, started: false, k: p.k };
  };

  const onObjMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPdf(e);
    let dx = p.x - d.sx, dy = p.y - d.sy;
    if (!d.started) {
      if (Math.hypot(dx, dy) < 2 * d.k) return;
      d.started = true;
      useStore.getState().checkpoint();
    }
    const o = d.o;
    const upd = useStore.getState().updateObj;
    const thr = 6 * d.k;
    if (d.mode === "move") {
      const t = snapTargets(o.id);
      const g: Guides = { v: [], h: [] };
      let nx = o.x + dx, ny = o.y + dy;
      if (!e.altKey) {
        for (const [off, ax] of [[0, 0], [o.w / 2, 1], [o.w, 2]] as const) {
          const c = t.v.find((v) => Math.abs(nx + off - v) < thr);
          if (c !== undefined) { nx = c - off; g.v.push(c); break; }
          void ax;
        }
        for (const off of [0, o.h / 2, o.h]) {
          const c = t.h.find((v) => Math.abs(ny + off - v) < thr);
          if (c !== undefined) { ny = c - off; g.h.push(c); break; }
        }
      }
      setGuides(g);
      if (o.type === "ink") upd(o.id, { x: nx, y: ny });
      else upd(o.id, { x: nx, y: ny });
      return;
    }
    // redimensionar
    let { x, y, w: ow, h: oh } = o;
    const m = d.mode;
    if (m.includes("e")) ow = o.w + dx;
    if (m.includes("s")) oh = o.h + dy;
    if (m.includes("w")) { x = o.x + dx; ow = o.w - dx; }
    if (m.includes("n")) { y = o.y + dy; oh = o.h - dy; }
    const keep = (o.type === "image" || o.type === "stamp" || o.type === "sigfield") !== e.shiftKey && m.length === 2;
    if (keep) {
      const r = o.w / o.h;
      if (Math.abs(ow - o.w) / o.w > Math.abs(oh - o.h) / o.h) oh = ow / r;
      else ow = oh * r;
      if (m.includes("w")) x = o.x + o.w - ow;
      if (m.includes("n")) y = o.y + o.h - oh;
    }
    const min = o.type === "line" ? 0.5 : 8;
    if (ow < min || oh < min) return;
    upd(o.id, { x, y, w: ow, h: oh });
  };

  const onObjUp = () => {
    drag.current = null;
    setGuides({ v: [], h: [] });
  };

  // termina a edição de texto ao trocar seleção
  useEffect(() => {
    if (editing && selected !== editing) finishEdit(editing);
  }, [selected]);

  const finishEdit = (id: string) => {
    setEditing(null);
    const st = useStore.getState();
    const o = st.tabs.find((t) => t.id === st.activeId)?.objects.find((x) => x.id === id) as TextObj | undefined;
    if (o && !o.text.trim()) st.removeObj(id);
  };

  // ---------------- render ----------------
  const pct = (v: number, base: number) => `${(v / base) * 100}%`;
  return (
    <div
      ref={ref}
      className={`ov ${creating ? "create" : ""} ${tool === "text" ? "text" : ""}`}
      onPointerDown={onCreateDown}
      onPointerMove={onCreateMove}
      onPointerUp={onCreateUp}
    >
      {objects.map((o) => (
        <ObjView
          key={o.id}
          o={o}
          sel={selected === o.id}
          editing={editing === o.id}
          style={{ left: pct(o.x, w), top: pct(o.y, h), width: pct(o.w, w), height: pct(o.h, h) }}
          onDown={onObjDown}
          onMove={onObjMove}
          onUp={onObjUp}
          onEdit={() => o.type === "text" && setEditing(o.id)}
          onMenu={openMenu}
          onEditEnd={() => finishEdit(o.id)}
        />
      ))}
      {draft && (
        <div className="draft" style={{
          left: pct(Math.min(draft.x, draft.x + draft.w), w), top: pct(Math.min(draft.y, draft.y + draft.h), h),
          width: pct(Math.abs(draft.w), w), height: pct(Math.abs(draft.h), h),
          ...(tool === "highlight" ? { background: useStore.getState().style.highlight + "88", border: "none" } : {}),
          ...(tool === "ellipse" ? { borderRadius: "50%" } : {}),
        }} />
      )}
      {ink && (
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <polyline points={ink.join(" ")} fill="none" stroke={useStore.getState().style.stroke} strokeWidth={useStore.getState().style.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {tool === "edittext" && <TextEditLayer page={page} w={w} h={h} />}
      {menu && <ObjMenu menu={menu} onClose={() => setMenu(null)} />}
      {guides.v.map((v, i) => <div key={"v" + i} className="guide v" style={{ left: pct(v, w) }} />)}
      {guides.h.map((v, i) => <div key={"h" + i} className="guide h" style={{ top: pct(v, h) }} />)}
    </div>
  );
});

// ---------------- objeto individual ----------------
const measureCanvas = document.createElement("canvas").getContext("2d")!;
function textWidth(t: string, bold: boolean) {
  measureCanvas.font = `${bold ? "bold " : ""}100px Arial, Helvetica, sans-serif`;
  return measureCanvas.measureText(t).width / 100;
}

type ObjProps = {
  o: Obj;
  sel: boolean;
  editing: boolean;
  style: React.CSSProperties;
  onDown: (e: React.PointerEvent, o: Obj, m: "move" | Handle) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: () => void;
  onEdit: () => void;
  onEditEnd: () => void;
  onMenu: (e: React.MouseEvent, o: Obj) => void;
};

const ObjView = memo(function ObjView({ o, sel, editing, style, onDown, onMove, onUp, onEdit, onEditEnd, onMenu }: ObjProps) {
  const sf = "var(--scale-factor, 1)";
  const common = {
    style: { ...style, opacity: o.opacity },
    onPointerDown: (e: React.PointerEvent) => onDown(e, o, "move"),
    onPointerMove: onMove,
    onPointerUp: onUp,
    onDoubleClick: onEdit,
    onContextMenu: (e: React.MouseEvent) => onMenu(e, o),
  };
  const handles = sel && !editing && (
    <>
      {(o.type === "line" ? (["nw", "se", "ne", "sw"] as Handle[]).filter((x) => (o.dir === 0 ? x === "nw" || x === "se" : x === "ne" || x === "sw")) : HANDLES).map((hd) => (
        <div key={hd} className={`h ${hd}`} onPointerDown={(e) => onDown(e, o, hd)} onPointerMove={onMove} onPointerUp={onUp} />
      ))}
    </>
  );
  const cls = `obj ${sel ? "sel" : ""}`;

  switch (o.type) {
    case "image":
      return <div className={cls} {...common}><img src={o.src} alt="" draggable={false} />{handles}</div>;
    case "highlight":
      return <div className={cls} {...common} style={{ ...common.style, background: o.color, opacity: 0.45 * o.opacity, mixBlendMode: "multiply" }}>{handles}</div>;
    case "rect":
    case "ellipse": {
      const sw = o.strokeWidth;
      return (
        <div className={cls} {...common}>
          <svg viewBox={`0 0 ${o.w} ${o.h}`} preserveAspectRatio="none">
            {o.type === "rect"
              ? <rect x={sw / 2} y={sw / 2} width={Math.max(0, o.w - sw)} height={Math.max(0, o.h - sw)} fill={o.fill ?? "none"} stroke={o.stroke} strokeWidth={sw} />
              : <ellipse cx={o.w / 2} cy={o.h / 2} rx={Math.max(0, o.w / 2 - sw / 2)} ry={Math.max(0, o.h / 2 - sw / 2)} fill={o.fill ?? "none"} stroke={o.stroke} strokeWidth={sw} />}
          </svg>
          {handles}
        </div>
      );
    }
    case "line": {
      const a = o.dir === 0 ? [0, 0] : [0, o.h], b = o.dir === 0 ? [o.w, o.h] : [o.w, 0];
      const [s, e] = o.rev ? [b, a] : [a, b];
      const ang = Math.atan2(e[1] - s[1], e[0] - s[0]);
      const L = Math.max(8, o.strokeWidth * 4);
      return (
        <div className={cls} {...common} style={{ ...common.style, outline: sel ? undefined : "none" }}>
          <svg viewBox={`0 0 ${o.w} ${o.h}`} preserveAspectRatio="none">
            <line x1={s[0]} y1={s[1]} x2={e[0]} y2={e[1]} stroke="transparent" strokeWidth={Math.max(10, o.strokeWidth + 8)} />
            <line x1={s[0]} y1={s[1]} x2={e[0]} y2={e[1]} stroke={o.stroke} strokeWidth={o.strokeWidth} strokeLinecap="round" />
            {o.arrow && [Math.PI * 0.82, -Math.PI * 0.82].map((d) => (
              <line key={d} x1={e[0]} y1={e[1]} x2={e[0] + L * Math.cos(ang + d)} y2={e[1] + L * Math.sin(ang + d)} stroke={o.stroke} strokeWidth={o.strokeWidth} strokeLinecap="round" />
            ))}
          </svg>
          {handles}
        </div>
      );
    }
    case "ink":
      return (
        <div className={cls} {...common}>
          <svg viewBox={`0 0 ${o.w} ${o.h}`} preserveAspectRatio="none">
            {o.points.map((s, i) => (
              <polyline key={i} points={s.map((v, k) => (k % 2 === 0 ? v * o.w : v * o.h)).join(" ")} fill="none" stroke={o.stroke} strokeWidth={o.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </svg>
          {handles}
        </div>
      );
    case "text":
      return (
        <div className={`${cls} text-obj`} {...common}>
          {editing ? (
            <TextEditor o={o} onDone={onEditEnd} sf={sf} />
          ) : (
            <div className="content" style={{ fontSize: `calc(${sf} * ${o.size}px)`, color: o.color, fontWeight: o.bold ? 700 : 400, background: o.bg ?? "transparent" }}>
              {o.text || <span style={{ opacity: 0.4 }}>Texto</span>}
            </div>
          )}
          {handles}
        </div>
      );
    case "stamp": {
      const lw = textWidth(o.label, true);
      const size = Math.min(o.h * 0.42, (o.w * 0.86) / lw);
      return (
        <div className={`${cls} stamp-obj`} {...common} style={{ ...common.style, color: o.color, borderColor: o.color, borderWidth: `calc(${sf} * 2.5px)` }}>
          <div style={{ fontSize: `calc(${sf} * ${size}px)`, marginTop: o.date ? `calc(${sf} * ${o.h * 0.04}px)` : 0 }}>{o.label}</div>
          {o.date && <div style={{ fontSize: `calc(${sf} * ${Math.min(o.h * 0.2, size * 0.5)}px)`, fontWeight: 400, marginTop: `calc(${sf} * ${o.h * 0.08}px)` }}>{o.date}</div>}
          {handles}
        </div>
      );
    }
    case "sigfield":
      return (
        <div className={`${cls} sig-obj`} {...common}>
          <div><FeatureIcon n="assinatura-digital" size={16} className="sig-obj-ic" /> Assinatura digital<br /><span style={{ fontWeight: 400, opacity: 0.8 }}>posicione e clique em “Assinar”</span></div>
          {handles}
        </div>
      );
  }
});

function TextEditor({ o, onDone, sf }: { o: TextObj; onDone: () => void; sf: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current!;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);
  const grow = () => {
    const t = ref.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    if (t.scrollHeight > t.clientHeight + 1) {
      const k = o.h / r.height;
      useStore.getState().updateObj(o.id, { h: t.scrollHeight * k + 2 });
    }
  };
  return (
    <textarea
      ref={ref}
      value={o.text}
      placeholder="Digite o texto…"
      style={{ fontSize: `calc(${sf} * ${o.size}px)`, color: o.color, fontWeight: o.bold ? 700 : 400 }}
      onChange={(e) => {
        useStore.getState().updateObj(o.id, { text: e.target.value });
        requestAnimationFrame(grow);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onDone();
      }}
      onBlur={onDone}
    />
  );
}

export { viewerApi };
