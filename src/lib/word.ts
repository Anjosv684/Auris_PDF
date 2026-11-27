// PDF → Word (.docx): motor pdf2docx; páginas escaneadas passam por OCR antes.
import { useStore, getActiveTab } from "./store";
import { buildPdf } from "./export";
import { isApp, pickFiles, saveAs, writePath, wordNative, openPath, type PickedFile } from "./platform";
import { baseName } from "./util";

const docxName = (name: string) => `${baseName(name)}.docx`;

async function convert(name: string, bytes: Uint8Array, label: string) {
  const st = useStore.getState();
  st.set({ busy: `${label}…` });
  return wordNative(bytes, (page, total) =>
    useStore.getState().set({ busy: `${label}… ${Math.round((page / Math.max(1, total)) * 100)}%` }));
}

function done(saved: string[], scanned: number) {
  if (!saved.length) return;
  const st = useStore.getState();
  st.toast(saved.length === 1
    ? `Convertido para Word${scanned ? " (com reconhecimento de texto)" : ""}. Abrindo…`
    : `${saved.length} arquivos convertidos para Word.`);
  openPath(saved[0]).catch(() => {});
}

/** Converte a aba atual (com anotações e formulários) e pergunta onde salvar. */
export async function exportWord() {
  const st = useStore.getState();
  const t = getActiveTab();
  if (!t) return;
  if (!isApp) return st.toast("A conversão para Word está disponível no app instalado.", "info");
  try {
    const r = await convert(t.name, await buildPdf(t), "Convertendo para Word");
    st.set({ busy: null });
    const path = await saveAs(r.bytes, docxName(t.name), "docx");
    if (path) done([path], r.scanned);
  } catch (e) {
    st.toast((e as Error).message || String(e), "err");
  } finally {
    useStore.getState().set({ busy: null });
  }
}

/** Tela inicial: escolhe um ou mais PDFs e salva cada .docx ao lado do original. */
export async function convertFilesToWord(files?: PickedFile[]) {
  const st = useStore.getState();
  if (!isApp) return st.toast("A conversão para Word está disponível no app instalado.", "info");
  const list = files ?? (await pickFiles("pdf", true));
  const saved: string[] = [];
  let scanned = 0;
  try {
    for (const [i, f] of list.entries()) {
      const label = list.length > 1 ? `Convertendo ${i + 1} de ${list.length} para Word` : "Convertendo para Word";
      const r = await convert(f.name, f.bytes, label);
      scanned += r.scanned;
      st.set({ busy: null });
      if (f.path) {
        const out = f.path.replace(/\.pdf$/i, "") + ".docx";
        await writePath(out, r.bytes);
        saved.push(out);
      } else {
        const p = await saveAs(r.bytes, docxName(f.name), "docx");
        if (p) saved.push(p);
      }
    }
    done(saved, scanned);
  } catch (e) {
    st.toast((e as Error).message || String(e), "err");
  } finally {
    useStore.getState().set({ busy: null });
  }
}
