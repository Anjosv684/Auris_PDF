// Edição do texto original do PDF: o motor apaga a linha e reescreve no mesmo lugar.
import { useStore } from "./store";
import { buildPdf } from "./export";
import { editTextNative, textLines, type TextLine } from "./platform";
import type { Tab } from "./types";

const cache = new Map<string, Promise<TextLine[][]>>();

/** Linhas de todas as páginas da aba (em cache por versão do documento). */
export function linesOf(t: Tab): Promise<TextLine[][]> {
  const key = `${t.id}:${t.version}`;
  let p = cache.get(key);
  if (!p) {
    p = textLines(t.bytes);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export async function applyTextEdit(t: Tab, page: number, line: TextLine, text: string) {
  const st = useStore.getState();
  st.set({ busy: "Aplicando a edição…" });
  try {
    // formulários preenchidos entram no PDF antes; anotações continuam como objetos
    const base = t.formDirty ? await buildPdf({ ...t, objects: [] }) : t.bytes;
    const out = await editTextNative(base, [{ page, rect: line.bbox, text }]);
    useStore.getState().replaceBytes(t.id, out, { record: true, keepObjects: true });
  } catch (e) {
    st.toast((e as Error).message || String(e), "err");
  } finally {
    useStore.getState().set({ busy: null });
  }
}
