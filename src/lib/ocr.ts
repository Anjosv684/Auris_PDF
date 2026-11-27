// OCR: transforma PDFs escaneados em pesquisáveis (texto selecionável e com busca).
import { useStore, getActiveTab } from "./store";
import { flatten } from "./actions";
import { getDoc } from "./docs";
import { isApp, ocrNative } from "./platform";
import type { Tab } from "./types";

export async function ocrTab(force = false): Promise<void> {
  const st = useStore.getState();
  const t = getActiveTab();
  if (!t) return;
  if (!isApp) return st.toast("O reconhecimento de texto (OCR) está disponível no app instalado.", "info");
  st.set({ busy: "Preparando o reconhecimento de texto…" });
  try {
    const bytes = await flatten(); // grava anotações/formulários antes
    if (!bytes) return;
    const r = await ocrNative(bytes, force, (page, total) =>
      useStore.getState().set({ busy: total > 1 ? `Reconhecendo texto… página ${Math.min(page + 1, total)} de ${total}` : "Reconhecendo texto…" }));
    if (!r.recognized) {
      useStore.getState().set({ busy: null });
      if (!force && confirm("Este PDF já tem texto em todas as páginas. Reconhecer novamente mesmo assim?")) return ocrTab(true);
      return;
    }
    useStore.getState().replaceBytes(t.id, r.bytes, { record: true });
    useStore.getState().toast(`Texto reconhecido em ${r.recognized} ${r.recognized === 1 ? "página" : "páginas"}. Agora dá para buscar e copiar.`);
    scanned.set(t.id, false);
  } catch (e) {
    useStore.getState().toast((e as Error).message || String(e), "err");
  } finally {
    useStore.getState().set({ busy: null });
  }
}

/** Cache: o PDF desta aba parece escaneado (sem texto nas primeiras páginas)? */
const scanned = new Map<string, boolean>();
export async function looksScanned(t: Tab): Promise<boolean> {
  const key = `${t.id}`;
  if (scanned.has(key)) return scanned.get(key)!;
  try {
    const pdf = await getDoc(t);
    let chars = 0;
    for (let i = 1; i <= Math.min(3, pdf.numPages); i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      chars += tc.items.reduce((n, it) => n + ("str" in it ? it.str.trim().length : 0), 0);
    }
    const res = chars < 20;
    scanned.set(key, res);
    return res;
  } catch {
    return false;
  }
}
