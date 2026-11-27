import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen, Save, FilePenLine, TextCursorInput, Undo2, Redo2, MousePointer2, Hand, Highlighter, Type, PenLine, Square, Circle, Minus, MoveUpRight, ImagePlus, FileSignature, MoreHorizontal, ZoomIn, ZoomOut, Search, PanelLeft, Trash2, Copy, Eraser, Bold, FileDown, Maximize,
} from "lucide-react";
import { useStore, useActiveTab } from "../lib/store";
import { isApp } from "../lib/platform";
import { FeatureIcon } from "./icons";
import { ocrTab } from "../lib/ocr";
import { exportWord } from "../lib/word";
import type { Obj, Tool } from "../lib/types";
import { viewerApi } from "../lib/viewerApi";
import {
  openFiles, saveTab, printTab, pickAndAddImage, addStamp, STAMPS, addSigField, highlightSelection, flatten,
} from "../lib/actions";
import { removeWhite, uid } from "../lib/util";
import { runTask } from "../lib/store";

/** Botão com menu suspenso. O menu abre por cima de tudo (portal + posição fixa), assim não é
 *  cortado pela barra de ferramentas, que rola na horizontal. */
export function Menu({ icon, label, title, children, right }: { icon: React.ReactNode; label?: string; title: string; children: (close: () => void) => React.ReactNode; right?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", f);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", f);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const toggle = () => {
    const r = ref.current!.getBoundingClientRect();
    setPos(right ? { top: r.bottom + 6, right: Math.max(6, window.innerWidth - r.right) } : { top: r.bottom + 6, left: Math.max(6, Math.min(r.left, window.innerWidth - 246)) });
    setOpen(!open);
  };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`ib ${label ? "label" : ""} ${open ? "on" : ""}`} title={title} onClick={toggle}>
        {icon}{label}
      </button>
      {open && createPortal(<div ref={pop} className="menu menu-pop" style={pos}>{children(() => setOpen(false))}</div>, document.body)}
    </div>
  );
}

const TOOLS: { t: Tool; icon: React.ReactNode; title: string; key?: string }[] = [
  { t: "select", icon: <MousePointer2 size={17} />, title: "Selecionar (V)", key: "v" },
  { t: "hand", icon: <Hand size={17} />, title: "Mão — arrastar a página (H)", key: "h" },
  { t: "highlight", icon: <Highlighter size={17} />, title: "Destacar (selecione o texto ou arraste)", key: "m" },
  { t: "text", icon: <Type size={17} />, title: "Caixa de texto (T)", key: "t" },
  { t: "ink", icon: <PenLine size={17} />, title: "Desenho à mão livre (D)", key: "d" },
  { t: "rect", icon: <Square size={17} />, title: "Retângulo (R)", key: "r" },
  { t: "ellipse", icon: <Circle size={17} />, title: "Elipse (E)", key: "e" },
  { t: "line", icon: <Minus size={17} style={{ transform: "rotate(-45deg)" }} />, title: "Linha (L)", key: "l" },
  { t: "arrow", icon: <MoveUpRight size={17} />, title: "Seta (A)", key: "a" },
  ...(isApp ? [{ t: "edittext" as Tool, icon: <TextCursorInput size={17} />, title: "Editar o texto do PDF (X): clique numa linha para alterar", key: "x" }] : []),
];
export const TOOL_KEYS = Object.fromEntries(TOOLS.filter((x) => x.key).map((x) => [x.key!, x.t]));

export function Toolbar() {
  const tab = useActiveTab();
  const s = useStore();
  const [scale, setScale] = useState(100);
  const [page, setPage] = useState("1");

  useEffect(() => {
    const id = setInterval(() => {
      const v = viewerApi.viewer;
      if (v) setScale(Math.round(v.currentScale * 100));
    }, 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setPage(String(tab?.page ?? 1)), [tab?.page]);

  const pickTool = (t: Tool) => {
    if (t === "highlight" && highlightSelection()) return;
    s.setTool(t);
  };

  const organize = async () => {
    if (s.view === "organize") return s.setView("doc");
    if ((await runTask("Preparando…", flatten)) !== undefined) s.setView("organize");
  };

  return (
    <div className="toolbar">
      <button className="ib" title="Abrir (Ctrl+O)" onClick={openFiles}><FolderOpen size={17} /></button>
      <button className="ib" title="Salvar (Ctrl+S)" onClick={() => saveTab()} disabled={!tab}><Save size={17} /></button>
      <button className="ib" title="Salvar como… (Ctrl+Shift+S)" onClick={() => saveTab(true)} disabled={!tab}><FilePenLine size={17} /></button>
      <button className="ib" title={"Imprimir (Ctrl+P)\nImpressão rápida: Ctrl+Shift+P"} onClick={printTab} disabled={!tab}><FeatureIcon n="imprimir" /></button>
      <div className="sep" />
      <button className="ib" title="Desfazer (Ctrl+Z)" onClick={s.undo} disabled={!tab?.past.length}><Undo2 size={17} /></button>
      <button className="ib" title="Refazer (Ctrl+Y)" onClick={s.redo} disabled={!tab?.future.length}><Redo2 size={17} /></button>
      <div className="sep" />
      {s.view === "doc" && TOOLS.map((x) => (
        <button key={x.t} className={`ib ${s.tool === x.t ? "on" : ""}`} title={x.title} onClick={() => pickTool(x.t)}>{x.icon}</button>
      ))}
      {s.view === "doc" && <>
        <button className="ib" title="Inserir imagem (ou cole com Ctrl+V / arraste)" onClick={pickAndAddImage}><ImagePlus size={17} /></button>
        <Menu icon={<FeatureIcon n="carimbo" />} title="Carimbos">
          {(close) => <>
            {STAMPS.map((x) => (
              <button key={x.label} onClick={() => { addStamp(x.label, x.color); close(); }}>
                <span style={{ color: x.color, fontWeight: 800, border: `2px solid ${x.color}`, padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>{x.label}</span>
              </button>
            ))}
            <hr />
            <button onClick={() => { const l = prompt("Texto do carimbo:"); if (l) addStamp(l.toUpperCase(), "#185FA5"); close(); }}>Personalizado…</button>
          </>}
        </Menu>
        <button className="ib" title="Assinatura manuscrita / rubrica" onClick={() => s.openDialog({ kind: "signature-pad" })}><FeatureIcon n="assinatura-manuscrita" /></button>
        <div className="sep" />
        <button className="ib label" title="Assinar com certificado digital ICP-Brasil (A1/A3)" onClick={() => { addSigField(); s.openDialog({ kind: "sign" }); }}>
          <FeatureIcon n="assinatura-digital" /> Assinar
        </button>
        <button className={`ib ${s.sigPanel ? "on" : ""}`} title="Verificar assinaturas digitais" onClick={() => s.set({ sigPanel: !s.sigPanel })}><FeatureIcon n="verificar" /></button>
      </>}
      <div className="sep" />
      <button className={`ib label ${s.view === "organize" ? "on" : ""}`} title="Organizar páginas" onClick={organize}><FeatureIcon n="organizar" /> Organizar</button>
      <button className="ib" title="Juntar PDFs" onClick={() => s.openDialog({ kind: "merge" })}><FeatureIcon n="juntar" /></button>
      <button className="ib" title="Dividir PDF" onClick={() => s.openDialog({ kind: "split" })}><FeatureIcon n="dividir" /></button>
      <button className="ib" title="Comprimir PDF" onClick={() => s.openDialog({ kind: "compress" })}><FeatureIcon n="comprimir" /></button>
      <button className="ib" title="Reconhecer texto (OCR): torna PDFs escaneados pesquisáveis e copiáveis" onClick={() => ocrTab()} disabled={!tab}><FeatureIcon n="ocr" /></button>
      <button className="ib" title="Converter para Word (.docx)" onClick={() => exportWord()} disabled={!tab}><FeatureIcon n="word" /></button>
      <button className="ib" title="Fotos e imagens → PDF" onClick={() => s.openDialog({ kind: "images" })}><FeatureIcon n="imagens-pdf" /></button>
      <Menu icon={<MoreHorizontal size={17} />} title="Mais ferramentas">
        {(close) => <>
          <button onClick={() => { s.openDialog({ kind: "export-images" }); close(); }}><FileDown size={16} /> Exportar páginas como imagem</button>
          <button onClick={() => { s.openDialog({ kind: "images" }); close(); }}><FeatureIcon n="imagens-pdf" size={16} /> Imagens → PDF</button>
          <hr />
          <button onClick={() => { saveTab(true); close(); }}><Save size={16} /> Salvar como… <span className="k">Ctrl+Shift+S</span></button>
        </>}
      </Menu>

      <div className="grow" />
      {s.view === "doc" && <>
        <div className="page-box">
          <input value={page} onChange={(e) => setPage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && viewerApi.goTo(parseInt(page) || 1)} onBlur={() => setPage(String(tab?.page ?? 1))} />
          <span>/ {tab?.pageCount ?? 0}</span>
        </div>
        <div className="sep" />
        <div className="zoom-box">
          <button className="ib" title="Diminuir zoom (Ctrl -)" onClick={() => viewerApi.zoom(-1)}><ZoomOut size={16} /></button>
          <input className="zoom-val" value={`${scale}%`} onChange={() => {}} onKeyDown={(e) => {
            if (e.key === "Enter") viewerApi.setScale(parseInt((e.target as HTMLInputElement).value) / 100 || 1);
          }} onFocus={(e) => e.target.select()} />
          <button className="ib" title="Aumentar zoom (Ctrl +)" onClick={() => viewerApi.zoom(1)}><ZoomIn size={16} /></button>
          <Menu icon={<Maximize size={15} />} title="Ajustar" right>
            {(close) => <>
              <button onClick={() => { viewerApi.setScale("page-width"); close(); }}>Ajustar à largura</button>
              <button onClick={() => { viewerApi.setScale("page-fit"); close(); }}>Página inteira</button>
              <button onClick={() => { viewerApi.setScale(1); close(); }}>Tamanho real (100%)</button>
            </>}
          </Menu>
        </div>
        <button className={`ib ${s.search ? "on" : ""}`} title="Buscar (Ctrl+F)" onClick={() => s.set({ search: !s.search })}><Search size={17} /></button>
        <button className={`ib ${s.sidebar ? "on" : ""}`} title="Miniaturas" onClick={() => s.set({ sidebar: !s.sidebar })}><PanelLeft size={17} /></button>
      </>}
    </div>
  );
}


// ---------------- barra de propriedades ----------------
const COLORS = ["#111111", "#E5484D", "#F76808", "#FFC53D", "#30A46C", "#0091FF", "#185FA5", "#8E4EC6", "#FFFFFF"];
const HL = ["#FFE066", "#9BE15D", "#7FDBFF", "#FF8FAB", "#FFB347"];
const COLOR_NAMES: Record<string, string> = {
  "#111111": "Preto", "#E5484D": "Vermelho", "#F76808": "Laranja", "#FFC53D": "Amarelo", "#30A46C": "Verde",
  "#0091FF": "Azul claro", "#185FA5": "Azul", "#8E4EC6": "Roxo", "#FFFFFF": "Branco",
  "#FFE066": "Amarelo", "#9BE15D": "Verde", "#7FDBFF": "Azul", "#FF8FAB": "Rosa", "#FFB347": "Laranja",
  "#FFF3B0": "Amarelo claro", "#D6ECFF": "Azul claro",
};
const colorName = (c: string) => COLOR_NAMES[c.toUpperCase()] ?? c;

export function PropBar() {
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const setStyle = useStore((s) => s.setStyle);
  const sel = useStore((s) => s.tabs.find((t) => t.id === s.activeId)?.objects.find((o) => o.id === s.selected));
  const upd = (p: Partial<Obj>) => {
    if (!sel) return;
    const st = useStore.getState();
    st.checkpoint();
    st.updateObj(sel.id, p);
  };

  const kind = sel?.type ?? (["rect", "ellipse", "line", "arrow", "ink", "text", "highlight"].includes(tool) ? tool : null);
  if (!kind)
    return (
      <div className="propbar idle">
        <span className="lbl">
          {tool === "hand" ? "Arraste para navegar pela página." : "Clique num objeto para editar • Ctrl+V cola imagens • arraste arquivos de imagem para a página • Ctrl+roda do mouse = zoom"}
        </span>
      </div>
    );
  const isShape = ["rect", "ellipse", "line", "arrow", "ink"].includes(kind);

  const strokeVal = sel && "stroke" in sel ? sel.stroke : style.stroke;
  const fillVal = sel && "fill" in sel ? sel.fill : style.fill;
  const widthVal = sel && "strokeWidth" in sel ? sel.strokeWidth : style.strokeWidth;
  const textColor = sel?.type === "text" ? sel.color : style.textColor;
  const textSize = sel?.type === "text" ? sel.size : style.textSize;
  const hl = sel?.type === "highlight" ? sel.color : style.highlight;

  const setStroke = (c: string) => (sel ? upd({ stroke: c } as Partial<Obj>) : setStyle({ stroke: c }));
  const setFill = (c: string | null) => (sel ? upd({ fill: c } as Partial<Obj>) : setStyle({ fill: c }));
  const setWidth = (v: number) => (sel ? useStore.getState().updateObj(sel.id, { strokeWidth: v } as Partial<Obj>) : setStyle({ strokeWidth: v }));

  const names: Record<string, string> = {
    rect: "Retângulo", ellipse: "Elipse", line: "Linha", arrow: "Seta", ink: "Desenho", text: "Texto", highlight: "Destaque",
    image: "Imagem", stamp: "Carimbo", sigfield: "Assinatura digital",
  };

  return (
    <div className="propbar">
      <b style={{ marginRight: 6 }}>{names[kind]}</b>
      {isShape && <>
        <span className="lbl">Cor</span>
        {COLORS.slice(0, 8).map((c) => <button key={c} className={`swatch ${strokeVal === c ? "on" : ""}`} style={{ background: c }} title={colorName(c)} onClick={() => setStroke(c)} />)}
        <div className="sep" />
        <span className="lbl">Espessura</span>
        <input type="range" min={0.5} max={12} step={0.5} value={widthVal}
          onPointerDown={() => sel && useStore.getState().checkpoint()}
          onChange={(e) => setWidth(parseFloat(e.target.value))} />
      </>}
      {(kind === "rect" || kind === "ellipse") && <>
        <div className="sep" />
        <span className="lbl">Preenchimento</span>
        <button className={`swatch none ${!fillVal ? "on" : ""}`} onClick={() => setFill(null)} title="Sem preenchimento" />
        {COLORS.map((c) => <button key={c} className={`swatch ${fillVal === c ? "on" : ""}`} style={{ background: c }} title={"Preencher: " + colorName(c)} onClick={() => setFill(c)} />)}
      </>}
      {kind === "highlight" && <>
        <span className="lbl">Cor</span>
        {HL.map((c) => <button key={c} className={`swatch ${hl === c ? "on" : ""}`} style={{ background: c }} title={colorName(c)} onClick={() => (sel ? upd({ color: c } as Partial<Obj>) : setStyle({ highlight: c }))} />)}
        {!sel && <span className="lbl" style={{ marginLeft: 8 }}>Dica: selecione um texto e clique no marcador</span>}
      </>}
      {kind === "text" && <>
        <span className="lbl">Cor</span>
        {COLORS.map((c) => <button key={c} className={`swatch ${textColor === c ? "on" : ""}`} style={{ background: c }} title={colorName(c)} onClick={() => (sel ? upd({ color: c } as Partial<Obj>) : setStyle({ textColor: c }))} />)}
        <div className="sep" />
        <select value={textSize} onChange={(e) => (sel ? upd({ size: +e.target.value } as Partial<Obj>) : setStyle({ textSize: +e.target.value }))}>
          {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map((n) => <option key={n} value={n}>{n} pt</option>)}
        </select>
        {sel?.type === "text" && <>
          <button className={`ib ${sel.bold ? "on" : ""}`} onClick={() => upd({ bold: !sel.bold } as Partial<Obj>)} title="Negrito"><Bold size={15} /></button>
          <span className="lbl">Fundo</span>
          <button className={`swatch none ${!sel.bg ? "on" : ""}`} title="Sem fundo" onClick={() => upd({ bg: null } as Partial<Obj>)} />
          {["#FFFFFF", "#FFF3B0", "#D6ECFF"].map((c) => <button key={c} className={`swatch ${sel.bg === c ? "on" : ""}`} style={{ background: c }} title={"Fundo: " + colorName(c)} onClick={() => upd({ bg: c } as Partial<Obj>)} />)}
        </>}
      </>}
      {sel?.type === "image" && <>
        <button className="ib label" onClick={async () => upd({ src: await removeWhite(sel.src) } as Partial<Obj>)} title="Deixa o fundo branco transparente">
          <Eraser size={15} /> Remover fundo branco
        </button>
        <button className="ib label" onClick={() => {
          const st = useStore.getState();
          const t = st.tabs.find((x) => x.id === st.activeId)!;
          st.checkpoint();
          const copies = Array.from({ length: t.pageCount }, (_, p) => p).filter((p) => p !== sel.page).map((p) => ({ ...sel, id: uid(), page: p }));
          st.patchTab(t.id, { objects: [...t.objects, ...copies], dirty: true });
          st.toast(`Imagem aplicada em ${copies.length + 1} páginas`);
        }} title="Repete esta imagem na mesma posição em todas as páginas">
          <Copy size={15} /> Em todas as páginas
        </button>
      </>}
      {sel?.type === "sigfield" && (
        <button className="btn" style={{ height: 30 }} onClick={() => useStore.getState().openDialog({ kind: "sign" })}><FileSignature size={15} /> Assinar agora</button>
      )}
      {sel && sel.type !== "sigfield" && <>
        <div className="sep" />
        <span className="lbl">Opacidade</span>
        <input type="range" min={0.1} max={1} step={0.05} value={sel.opacity}
          onPointerDown={() => useStore.getState().checkpoint()}
          onChange={(e) => useStore.getState().updateObj(sel.id, { opacity: parseFloat(e.target.value) })} />
      </>}
      <div style={{ flex: 1 }} />
      {sel && <>
        <button className="ib" title="Duplicar (Ctrl+D)" onClick={() => duplicateSelected()}><Copy size={16} /></button>
        <button className="ib" title="Excluir (Delete)" onClick={() => useStore.getState().removeObj(sel.id)}><Trash2 size={16} /></button>
      </>}
    </div>
  );
}

export function duplicateSelected() {
  const st = useStore.getState();
  const t = st.tabs.find((x) => x.id === st.activeId);
  const o = t?.objects.find((x) => x.id === st.selected);
  if (!o || o.type === "sigfield") return;
  st.addObj({ ...o, id: uid(), x: o.x + 12, y: o.y + 12 });
}
