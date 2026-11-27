import { useEffect, useState } from "react";
import { useStore, useActiveTab, getActiveTab } from "./lib/store";
import { TopBar, Sidebar, SearchBar, SigPanel, Toasts } from "./components/Shell";
import { Toolbar, PropBar, TOOL_KEYS, duplicateSelected } from "./components/Toolbar";
import { Viewer } from "./components/Viewer";
import { Organize } from "./components/Organize";
import { Home } from "./components/Home";
import { Dialogs } from "./components/Dialogs";
import { UpdateUI } from "./components/UpdateUI";
import { PrintJobs } from "./components/PrintJobs";
import { quickPrint, openPrint } from "./lib/print";
import { Tooltip } from "./components/Tooltip";
import { startAutoCheck } from "./lib/updater";
import { setPasswordAsker } from "./lib/pdfjs";
import { viewerApi } from "./lib/viewerApi";
import { addImageAt, closeTabSafe, openBytes, openFiles, openPaths, printTab, saveTab, highlightSelection } from "./lib/actions";
import { isApp, onLaunch, readPath, setWindowTitle, takeLaunch, type Launch } from "./lib/platform";
import type { Obj, Tool } from "./lib/types";
import { uid } from "./lib/util";

let clipboardObj: Obj | null = null;

function isTyping(e: Event) {
  const t = e.target as HTMLElement;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || !!t.closest?.(".annotationLayer");
}

export default function App() {
  const tab = useActiveTab();
  const view = useStore((s) => s.view);
  const sidebar = useStore((s) => s.sidebar);
  const search = useStore((s) => s.search);
  const sigPanel = useStore((s) => s.sigPanel);
  const [dragging, setDragging] = useState(false);

  // senha de PDFs protegidos
  useEffect(() => {
    setPasswordAsker((retry) => new Promise((resolve) => useStore.getState().openDialog({ kind: "password", retry, resolve })));
  }, []);

  // procura atualizações ao abrir e periodicamente
  useEffect(() => startAutoCheck(), []);

  // título da janela
  useEffect(() => {
    setWindowTitle(tab ? `${tab.dirty ? "• " : ""}${tab.name} — Auris PDF` : "Auris PDF");
  }, [tab?.name, tab?.dirty]);

  // arquivos vindos do Windows (duplo clique, "Abrir com", menu de contexto)
  useEffect(() => {
    let mergeBuf: string[] = [];
    let mergeTimer = 0;
    let printBuf: string[] = [];
    let printTimer = 0;
    const handle = async (l: Launch) => {
      if (l.action === "abrir") return openPaths(l.paths);
      if (l.action === "comprimir") {
        const files = await Promise.all(l.paths.map(readPath));
        const cur = useStore.getState().dialog;
        if (cur?.kind === "compress" && cur.files) useStore.getState().openDialog({ kind: "compress", files: [...cur.files, ...files] });
        else useStore.getState().openDialog({ kind: "compress", files });
        return;
      }
      if (l.action === "imprimir") {
        printBuf.push(...l.paths);
        clearTimeout(printTimer);
        printTimer = window.setTimeout(async () => {
          const files = await Promise.all(printBuf.map(readPath));
          printBuf = [];
          const cur = useStore.getState().dialog;
          openPrint(cur?.kind === "print" && cur.files ? [...cur.files, ...files] : files);
        }, 700);
        return;
      }
      if (l.action === "juntar") {
        mergeBuf.push(...l.paths);
        clearTimeout(mergeTimer);
        mergeTimer = window.setTimeout(async () => {
          const files = await Promise.all(mergeBuf.map(readPath));
          mergeBuf = [];
          useStore.getState().openDialog({ kind: "merge", files });
        }, 700);
      }
    };
    takeLaunch().then((ls) => ls.forEach(handle));
    const un = onLaunch(handle);
    return () => { un.then((f) => f()); };
  }, []);

  // aviso ao fechar com alterações
  useEffect(() => {
    const dirty = () => useStore.getState().tabs.some((t) => t.dirty);
    if (isApp) {
      let un: (() => void) | undefined;
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((e) => {
          if (dirty() && !confirm("Existem documentos com alterações não salvas. Sair mesmo assim?")) e.preventDefault();
        }).then((f) => (un = f)));
      return () => un?.();
    }
    const f = (e: BeforeUnloadEvent) => { if (dirty()) e.preventDefault(); };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, []);

  // atalhos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "o") { e.preventDefault(); openFiles(); return; }
      if (st.dialog) return;
      const t = getActiveTab();
      if (ctrl && k === "tab" && st.tabs.length > 1) {
        e.preventDefault();
        const i = st.tabs.findIndex((x) => x.id === st.activeId);
        st.setActive(st.tabs[(i + (e.shiftKey ? -1 : 1) + st.tabs.length) % st.tabs.length].id);
        return;
      }
      if (!t) return;
      if (ctrl && k === "s") { e.preventDefault(); saveTab(e.shiftKey); return; }
      if (ctrl && k === "p") { e.preventDefault(); e.shiftKey ? quickPrint() : printTab(); return; }
      if (ctrl && k === "w") { e.preventDefault(); closeTabSafe(t.id); return; }
      if (st.view !== "doc") return;
      if (ctrl && k === "f") { e.preventDefault(); st.set({ search: true }); return; }
      if (ctrl && (k === "=" || k === "+")) { e.preventDefault(); viewerApi.zoom(1); return; }
      if (ctrl && k === "-") { e.preventDefault(); viewerApi.zoom(-1); return; }
      if (ctrl && k === "0") { e.preventDefault(); viewerApi.setScale("page-width"); return; }
      if (isTyping(e)) return;
      if (ctrl && k === "z") { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (ctrl && k === "y") { e.preventDefault(); st.redo(); return; }
      if (ctrl && k === "d") { e.preventDefault(); duplicateSelected(); return; }
      const sel = t.objects.find((o) => o.id === st.selected);
      if (ctrl && k === "c" && sel) { clipboardObj = sel; return; }
      if ((k === "delete" || k === "backspace") && sel) { e.preventDefault(); st.removeObj(sel.id); return; }
      if (k === "escape") { st.select(null); st.setTool("select"); st.set({ search: false }); return; }
      if (sel && k.startsWith("arrow")) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        if (!e.repeat) st.checkpoint();
        st.updateObj(sel.id, {
          x: sel.x + (k === "arrowleft" ? -d : k === "arrowright" ? d : 0),
          y: sel.y + (k === "arrowup" ? -d : k === "arrowdown" ? d : 0),
        });
        return;
      }
      if (!ctrl && !e.altKey && TOOL_KEYS[k]) {
        const tool = TOOL_KEYS[k] as Tool;
        if (tool === "highlight" && highlightSelection()) return;
        st.setTool(tool);
        return;
      }
      if (!sel && (k === "pagedown" || k === "pageup") && viewerApi.viewer) return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // colar imagens (prints, logos, assinaturas)
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const st = useStore.getState();
      if (!getActiveTab() || st.view !== "doc" || st.dialog || isTyping(e)) return;
      const img = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (img) {
        e.preventDefault();
        const f = img.getAsFile();
        if (f) await addImageAt(f);
        return;
      }
      if (clipboardObj) {
        e.preventDefault();
        const pt = viewerApi.insertPoint();
        const o = { ...clipboardObj, id: uid(), page: pt.page, x: clipboardObj.x + (clipboardObj.page === pt.page ? 12 : 0), y: clipboardObj.y + (clipboardObj.page === pt.page ? 12 : 0) };
        st.addObj(o as Obj);
        clipboardObj = o as Obj;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // arrastar PDFs para a janela
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types || [])].includes("Files");
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = async (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
      for (const f of pdfs) openBytes({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (imgs.length && getActiveTab() && useStore.getState().view === "doc") for (const f of imgs) await addImageAt(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      {!tab ? (
        <Home />
      ) : (
        <>
          <Toolbar />
          {view === "doc" && <PropBar />}
          <div className="main">
            {sidebar && view === "doc" && <Sidebar />}
            <div style={{ flex: 1, display: view === "doc" ? "flex" : "none", position: "relative", minWidth: 0 }}>
              <Viewer />
              {search && <SearchBar />}
            </div>
            {view === "organize" && <Organize />}
            {sigPanel && view === "doc" && <SigPanel />}
          </div>
        </>
      )}
      <Dialogs />
      <Toasts />
      <UpdateUI />
      <PrintJobs />
      <Tooltip />
      {dragging && <div className="dropzone-overlay">Solte para abrir</div>}
    </div>
  );
}
