import { useEffect, useRef, useState } from "react";
import { Move } from "lucide-react";
import { useActiveTab, useStore } from "../lib/store";
import { engineWarmup, type TextLine } from "../lib/platform";
import { applyTextEdit, linesOf } from "../lib/textedit";

const FAMILY = {
  sans: "Arial, Helvetica, sans-serif",
  serif: "\"Times New Roman\", Times, serif",
  mono: "\"Courier New\", Courier, monospace",
};
let warmed = false;

type Edit = { i: number; text: string; dx: number; dy: number };
type Drag = { i: number; x: number; y: number; dx0: number; dy0: number; dx: number; dy: number; moved: boolean; fromBox: boolean };

/**
 * Ferramenta "Editar texto":
 * passar o mouse destaca a linha • clicar edita • arrastar move o texto para outro lugar.
 * Durante a edição, a alça no canto do quadro também arrasta.
 */
export function TextEditLayer({ page, w, h }: { page: number; w: number; h: number }) {
  const tab = useActiveTab();
  const [lines, setLines] = useState<TextLine[] | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!warmed) {
      warmed = true;
      engineWarmup();
    }
  }, []);
  // só lê as páginas perto da que está na tela (em escaneados, cada leitura é um OCR)
  const near = !!tab && Math.abs(page + 1 - tab.page) <= 1;
  useEffect(() => {
    if (!tab || !near) return;
    let alive = true;
    setLines(null);
    setEdit(null);
    linesOf(tab, page).then((l) => alive && setLines(l)).catch((e) => {
      if (!alive) return;
      setLines([]);
      useStore.getState().toast("Não foi possível ler o texto da página: " + ((e as Error)?.message || String(e)), "err");
    });
    return () => { alive = false; };
  }, [tab?.id, tab?.version, page, near]);
  useEffect(() => {
    if (edit && ta.current) {
      ta.current.focus();
      ta.current.select();
    }
  }, [edit?.i]);

  if (!tab || !near) return null;
  if (!lines) return <div className="te-layer"><div className="te-reading">Lendo o texto da página…</div></div>;
  const pct = (v: number, b: number) => `${(v / b) * 100}%`;
  const sf = "var(--scale-factor, 1)";
  /** pixels da tela → pontos do PDF */
  const toPt = () => {
    const r = layer.current?.getBoundingClientRect();
    return r && r.width ? w / r.width : 1;
  };

  const commit = (e: Edit | null = edit) => {
    if (!e) return;
    const line = lines[e.i];
    const text = e.text.replace(/\s+$/, "");
    setEdit(null);
    const moved = Math.abs(e.dx) > 0.5 || Math.abs(e.dy) > 0.5;
    if (line && (text !== line.text || moved)) applyTextEdit(tab, page, line, text, lines, moved ? [e.dx, e.dy] : undefined);
  };

  const startDrag = (ev: React.PointerEvent, i: number, fromBox: boolean) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); // mantém o foco no campo de texto ao pegar a alça
    ev.stopPropagation();
    try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch { /* sem captura: segue sem */ }
    const dx0 = fromBox && edit ? edit.dx : 0, dy0 = fromBox && edit ? edit.dy : 0;
    setDrag({ i, x: ev.clientX, y: ev.clientY, dx0, dy0, dx: dx0, dy: dy0, moved: false, fromBox });
  };
  const moveDrag = (ev: React.PointerEvent) => {
    if (!drag) return;
    const px = ev.clientX - drag.x, py = ev.clientY - drag.y;
    const moved = drag.moved || Math.hypot(px, py) > 4;
    const k = toPt();
    setDrag({ ...drag, moved, dx: drag.dx0 + px * k, dy: drag.dy0 + py * k });
  };
  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.fromBox) {
      if (edit) setEdit({ ...edit, dx: d.dx, dy: d.dy });
      ta.current?.focus();
      return;
    }
    if (!d.moved) {
      // clique simples: abre a edição (se havia outra aberta, grava ela primeiro)
      if (edit) return commit();
      setEdit({ i: d.i, text: lines[d.i].text, dx: 0, dy: 0 });
      return;
    }
    // havia outra edição aberta: grava só ela (duas gravações seguidas perderiam a primeira)
    if (edit) return commit();
    // arrastou a linha sem editar: só move
    commit({ i: d.i, text: lines[d.i].text, dx: d.dx, dy: d.dy });
  };

  const box = (l: TextLine, dx = 0, dy = 0) => {
    const [x0, y0, x1, y1] = l.bbox;
    return { left: pct(x0 + dx, w), top: pct(y0 + dy, h), width: pct(x1 - x0, w), height: pct(y1 - y0, h) };
  };
  const font = (l: TextLine): React.CSSProperties => ({
    fontSize: `calc(${sf} * ${l.size}px)`, fontFamily: FAMILY[l.family],
    fontWeight: l.bold ? 700 : 400, fontStyle: l.italic ? "italic" : "normal", color: l.color,
  });

  // linha sendo arrastada (fora da edição): fantasma no destino e o lugar original apagado
  const ghost = drag && !drag.fromBox && drag.moved ? lines[drag.i] : null;
  const busyIdx = edit?.i ?? (ghost ? drag!.i : -1);

  return (
    <div ref={layer} className={`te-layer ${edit || ghost ? "te-editing" : ""}`} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
      {lines.map((l, i) => (
        <div key={i} className={`te-line ${i === busyIdx ? "hidden" : ""}`} style={box(l)} title="Clique para editar • arraste para mover"
          onPointerDown={(e) => startDrag(e, i, false)} />
      ))}

      {ghost && <>
        <div className="te-mask" style={box(ghost)} />
        <div className="te-ghost" style={{ ...box(ghost, drag!.dx, drag!.dy), ...font(ghost) }}>{ghost.text}</div>
      </>}

      {edit && (() => {
        const l = lines[edit.i];
        const dx = drag?.fromBox ? drag.dx : edit.dx, dy = drag?.fromBox ? drag.dy : edit.dy;
        const rows = edit.text.split("\n");
        const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
        return <>
          {moved && <div className="te-mask" style={box(l)} />}
          <div className="te-box" style={{ left: box(l, dx, dy).left, top: box(l, dx, dy).top }}>
            <button className="te-grip" title="Arraste para mover o texto" tabIndex={-1}
              onPointerDown={(e) => startDrag(e, edit.i, true)}><Move size={13} /></button>
            <textarea ref={ta} className="te-input" spellCheck={false} value={edit.text}
              rows={rows.length} cols={Math.max(...rows.map((x) => x.length), 1) + 2}
              style={{ minWidth: `calc(${sf} * ${l.bbox[2] - l.bbox[0] + 4}px)`, ...font(l) }}
              onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              onBlur={() => !drag && commit()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
                if (e.key === "Escape") { e.preventDefault(); setEdit(null); }
              }} />
            <div className="te-tip">Enter para aplicar • Esc cancela • Shift+Enter quebra linha</div>
          </div>
        </>;
      })()}
    </div>
  );
}
