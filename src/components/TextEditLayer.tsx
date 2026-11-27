import { useEffect, useRef, useState } from "react";
import { useActiveTab, useStore } from "../lib/store";
import { engineWarmup, type TextLine } from "../lib/platform";
import { applyTextEdit, linesOf } from "../lib/textedit";

const FAMILY = {
  sans: "Arial, Helvetica, sans-serif",
  serif: "\"Times New Roman\", Times, serif",
  mono: "\"Courier New\", Courier, monospace",
};
let warmed = false;

/** Ferramenta "Editar texto": realça as linhas do PDF e abre um campo no lugar da linha clicada. */
export function TextEditLayer({ page, w, h }: { page: number; w: number; h: number }) {
  const tab = useActiveTab();
  const [lines, setLines] = useState<TextLine[] | null>(null);
  const [edit, setEdit] = useState<{ i: number; text: string } | null>(null);
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

  const commit = () => {
    if (!edit) return;
    const line = lines[edit.i];
    const text = edit.text.replace(/\s+$/, "");
    setEdit(null);
    if (line && text !== line.text) applyTextEdit(tab, page, line, text, lines);
  };

  return (
    <div className="te-layer">
      {lines.map((l, i) => {
        const [x0, y0, x1, y1] = l.bbox;
        const pos = { left: pct(x0, w), top: pct(y0, h), width: pct(x1 - x0, w), height: pct(y1 - y0, h) };
        if (edit?.i === i) {
          const rows = edit.text.split("\n");
          return (
            <textarea key={i} ref={ta} className="te-input" spellCheck={false} value={edit.text}
              rows={rows.length} cols={Math.max(...rows.map((x) => x.length), 1) + 2}
              style={{
                left: pos.left, top: pos.top, minWidth: pos.width, minHeight: pos.height,
                fontSize: `calc(${sf} * ${l.size}px)`, fontFamily: FAMILY[l.family],
                fontWeight: l.bold ? 700 : 400, fontStyle: l.italic ? "italic" : "normal", color: l.color,
              }}
              onChange={(e) => setEdit({ i, text: e.target.value })}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
                if (e.key === "Escape") { e.preventDefault(); setEdit(null); }
              }} />
          );
        }
        return <div key={i} className="te-line" style={pos} title="Clique para editar este texto" onClick={() => setEdit({ i, text: l.text })} />;
      })}
    </div>
  );
}
