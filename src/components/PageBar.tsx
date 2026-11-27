import { RotateCcw, RotateCw, X } from "lucide-react";
import { useStore, useActiveTab, getActiveTab, runTask } from "../lib/store";
import { buildPdf } from "../lib/export";
import { applyOrganize } from "../lib/pages";

export function setPageBar(on: boolean) {
  localStorage.setItem("auris.pagebar", on ? "1" : "0");
  useStore.getState().set({ pageBar: on });
}

/** Gira todas as páginas do documento (fica gravado; Ctrl+Z desfaz). */
export async function rotateDocument(delta: 90 | -90) {
  const t = getActiveTab();
  if (!t) return;
  await runTask("Girando o documento…", async () => {
    const base = await buildPdf(t); // anotações e formulários giram junto com a página
    const items = Array.from({ length: t.pageCount }, (_, i) => ({ kind: "page" as const, index: i, rot: delta, key: String(i) }));
    const out = await applyOrganize(base, items, new Map());
    useStore.getState().replaceBytes(t.id, out, { record: true });
  });
}

/** Barrinha discreta no centro inferior: quase transparente até passar o mouse. */
export function PageBar() {
  const tab = useActiveTab();
  const on = useStore((s) => s.pageBar);
  if (!tab || !on) return null;
  return (
    <div className="page-bar" onPointerDown={(e) => e.stopPropagation()}>
      <button className="ib" title="Girar o documento para a esquerda" onClick={() => rotateDocument(-90)}><RotateCcw size={15} /></button>
      <span className="pb-sep" />
      <button className="ib" title="Girar o documento para a direita" onClick={() => rotateDocument(90)}><RotateCw size={15} /></button>
      <button className="ib pb-close" title="Esconder esta barra (dá para reativar em Configurações)" onClick={() => {
        setPageBar(false);
        useStore.getState().toast("Barra de giro escondida. Para mostrar de novo: Configurações → Barra de giro do documento.", "info");
      }}><X size={13} /></button>
    </div>
  );
}
