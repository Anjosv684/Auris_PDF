// Edição do texto original do PDF: o motor apaga a linha e reescreve no mesmo lugar.
// Em páginas escaneadas, a linha vem do OCR e a edição repinta o papel e escreve por cima.
import { useStore } from "./store";
import { buildPdf } from "./export";
import { editTextNative, textLines, type TextLine } from "./platform";
import type { Tab } from "./types";
import { track } from "./telemetry";

const cache = new Map<string, Promise<TextLine[]>>();

/** Linhas editáveis de uma página (em cache por versão do documento). */
export function linesOf(t: Tab, page: number): Promise<TextLine[]> {
  const key = `${t.id}:${t.version}:${page}`;
  let p = cache.get(key);
  if (!p) {
    p = textLines(t.bytes, page);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export async function applyTextEdit(t: Tab, page: number, line: TextLine, text: string, pageLines: TextLine[]) {
  track("editar_texto", { escaneado: !!line.scanned });
  const st = useStore.getState();
  st.set({ busy: "Aplicando a edição…" });
  try {
    // formulários preenchidos entram no PDF antes; anotações continuam como objetos
    const base = t.formDirty ? await buildPdf({ ...t, objects: [] }) : t.bytes;
    const edit = line.scanned
      ? {
          page, rect: line.bbox, text, scanned: true, original: line.text,
          // outras linhas da página: ajudam o motor a reconhecer a fonte do documento
          context: pageLines.filter((l) => l !== line && l.text.length >= 6).slice(0, 10).map((l) => ({ rect: l.bbox, text: l.text })),
        }
      : { page, rect: line.bbox, text };
    const out = await editTextNative(base, [edit]);
    useStore.getState().replaceBytes(t.id, out, { record: true, keepObjects: true });
  } catch (e) {
    st.toast((e as Error).message || String(e), "err");
  } finally {
    useStore.getState().set({ busy: null });
  }
}
