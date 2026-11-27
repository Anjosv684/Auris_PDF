import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, BringToFront, SendToBack, ArrowUp, ArrowDown,
  Copy, Trash2, Eraser, Files,
} from "lucide-react";
import { useStore } from "../lib/store";
import { rotateImage, flipImage, reorderObj, duplicateObj, onAllPages, removeImageBackground } from "../lib/objects";
import type { Obj } from "../lib/types";

export type ObjMenuState = { id: string; x: number; y: number } | null;

/** Menu do botão direito sobre um objeto (imagem colada, forma, texto, carimbo…). */
export function ObjMenu({ menu, onClose }: { menu: NonNullable<ObjMenuState>; onClose: () => void }) {
  const o = useStore((s) => s.tabs.find((t) => t.id === s.activeId)?.objects.find((x) => x.id === menu.id));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  // mantém o menu dentro da janela
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(6, Math.min(menu.x, window.innerWidth - r.width - 6)),
      top: Math.max(6, Math.min(menu.y, window.innerHeight - r.height - 6)),
    });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const out = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", out, true);
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", out, true);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, []);

  if (!o) return null;
  const run = (fn: (o: Obj) => unknown) => () => { onClose(); fn(o); };
  const img = o.type === "image" ? o : null;
  const fixed = o.type === "sigfield";

  return createPortal(
    <div ref={ref} className="menu ctx-menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {img && <>
        <button onClick={run(() => rotateImage(img, 1))}><RotateCw size={16} /> Girar 90° à direita</button>
        <button onClick={run(() => rotateImage(img, -1))}><RotateCcw size={16} /> Girar 90° à esquerda</button>
        <button onClick={run(() => flipImage(img, "h"))}><FlipHorizontal2 size={16} /> Espelhar na horizontal</button>
        <button onClick={run(() => flipImage(img, "v"))}><FlipVertical2 size={16} /> Espelhar na vertical</button>
        <hr />
      </>}
      <button onClick={run((x) => reorderObj(x, "front"))}><BringToFront size={16} /> Trazer para a frente</button>
      <button onClick={run((x) => reorderObj(x, "forward"))}><ArrowUp size={16} /> Avançar uma camada</button>
      <button onClick={run((x) => reorderObj(x, "backward"))}><ArrowDown size={16} /> Recuar uma camada</button>
      <button onClick={run((x) => reorderObj(x, "back"))}><SendToBack size={16} /> Enviar para trás</button>
      <hr />
      {img && <button onClick={run(() => removeImageBackground(img))}><Eraser size={16} /> Remover fundo branco</button>}
      {!fixed && <button onClick={run(onAllPages)}><Files size={16} /> Repetir em todas as páginas</button>}
      {!fixed && <button onClick={run(duplicateObj)}><Copy size={16} /> Duplicar <span className="k">Ctrl+D</span></button>}
      <button onClick={run((x) => useStore.getState().removeObj(x.id))}><Trash2 size={16} /> Excluir <span className="k">Delete</span></button>
    </div>,
    document.body,
  );
}
