import { useEffect, useRef, useState } from "react";

/**
 * Dica ao passar o mouse para qualquer elemento com `title`.
 * Troca o tooltip nativo (lento e às vezes invisível no WebView) por um no visual do app.
 * Funciona também em botões desabilitados.
 */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const cur = useRef<Element | null>(null);
  const timer = useRef(0);

  useEffect(() => {
    const hide = () => { clearTimeout(timer.current); cur.current = null; setTip(null); };
    const textOf = (el: Element) => {
      const t = el.getAttribute("title");
      if (t !== null) { // guarda em data-tip para o navegador não mostrar o nativo
        el.removeAttribute("title");
        if (t) el.setAttribute("data-tip", t); else el.removeAttribute("data-tip");
      }
      return el.getAttribute("data-tip") || "";
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[title], [data-tip]") ?? null;
      const text = el ? textOf(el) : "";
      if (el === cur.current && text) return;
      hide();
      if (!el || !text) return;
      cur.current = el;
      timer.current = window.setTimeout(() => {
        if (cur.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.bottom + 40 < window.innerHeight;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, 350);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("wheel", hide, { passive: true });
    window.addEventListener("keydown", hide);
    window.addEventListener("blur", hide);
    document.addEventListener("pointerleave", hide);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("wheel", hide);
      window.removeEventListener("keydown", hide);
      window.removeEventListener("blur", hide);
      document.removeEventListener("pointerleave", hide);
    };
  }, []);

  // mantém dentro da janela
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  useEffect(() => {
    if (!tip || !ref.current) return setDx(0);
    const r = ref.current.getBoundingClientRect();
    setDx(r.left < 6 ? 6 - r.left : r.right > window.innerWidth - 6 ? window.innerWidth - 6 - r.right : 0);
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className="tooltip" role="tooltip"
      style={{ left: tip.x + dx, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}>
      {tip.text}
    </div>
  );
}
