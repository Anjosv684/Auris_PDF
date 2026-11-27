import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pdfjsLib, viewerLib } from "../lib/pdfjs";
import { getDoc } from "../lib/docs";
import { useStore, useActiveTab } from "../lib/store";
import { viewerApi } from "../lib/viewerApi";
import { Overlay } from "./Overlay";
import { addImageAt } from "../lib/actions";

type Host = { el: HTMLDivElement; w: number; h: number };

export function Viewer() {
  const tab = useActiveTab();
  const tool = useStore((s) => s.tool);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerDivRef = useRef<HTMLDivElement>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const hostsRef = useRef<Host[]>([]);
  const loadedRef = useRef<{ id: string; version: number } | null>(null);

  // cria o visualizador do pdf.js uma vez
  useEffect(() => {
    const container = containerRef.current!;
    const eventBus = new viewerLib.EventBus();
    const linkService = new viewerLib.PDFLinkService({ eventBus });
    const findController = new viewerLib.PDFFindController({ eventBus, linkService });
    const viewer = new viewerLib.PDFViewer({
      container,
      viewer: viewerDivRef.current!,
      eventBus,
      linkService,
      findController,
      annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
      textLayerMode: 1,
      removePageBorders: true,
    });
    linkService.setViewer(viewer);
    Object.assign(viewerApi, { viewer, eventBus, container, linkService });

    const ensure = (n: number) => {
      const h = hostsRef.current[n - 1];
      const pv = viewer.getPageView(n - 1);
      if (h && pv && !pv.div.contains(h.el)) pv.div.append(h.el);
    };
    const reattach = (e: { pageNumber: number }) => ensure(e.pageNumber);
    eventBus.on("pagerender", reattach);
    eventBus.on("pagerendered", reattach);
    eventBus.on("textlayerrendered", reattach);
    eventBus.on("annotationlayerrendered", reattach);
    eventBus.on("pagesinit", () => {
      const st = useStore.getState();
      const t = st.tabs.find((x) => x.id === st.activeId);
      viewer.currentScaleValue = "page-width";
      if (viewer.currentScale > 1.25) viewer.currentScaleValue = "1.25";
      if (t && t.page > 1) viewer.currentPageNumber = Math.min(t.page, viewer.pagesCount);
      const list: Host[] = [];
      for (let i = 0; i < viewer.pagesCount; i++) {
        const pv = viewer.getPageView(i);
        const el = document.createElement("div");
        el.className = "ov-host";
        pv.div.append(el);
        list.push({ el, w: pv.viewport.width / pv.viewport.scale, h: pv.viewport.height / pv.viewport.scale });
      }
      hostsRef.current = list;
      setHosts(list);
    });
    eventBus.on("pagechanging", (e: { pageNumber: number }) => {
      const st = useStore.getState();
      if (st.activeId) st.patchTab(st.activeId, { page: e.pageNumber });
    });
    eventBus.on("scalechanging", () => useStore.getState().set({}));
    // o pdf.js marca formulários alterados no annotationStorage
    const onForm = () => {
      const st = useStore.getState();
      const t = st.tabs.find((x) => x.id === st.activeId);
      if (t && !t.formDirty) st.patchTab(t.id, { formDirty: true, dirty: true });
    };
    container.addEventListener("input", onForm, true);
    container.addEventListener("change", onForm, true);

    // Ctrl + roda = zoom suave
    let pending = 0, raf = 0;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      pending += e.deltaY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        viewerApi.setScale(viewer.currentScale * Math.exp(-pending * 0.0025));
        pending = 0;
        raf = 0;
      });
    };
    container.addEventListener("wheel", wheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", wheel);
      container.removeEventListener("input", onForm, true);
      container.removeEventListener("change", onForm, true);
      viewer.setDocument(null as never);
      viewerApi.viewer = null;
    };
  }, []);

  // carrega o documento da aba ativa
  useEffect(() => {
    if (!tab) return;
    const cur = loadedRef.current;
    if (cur && cur.id === tab.id && cur.version === tab.version) return;
    let cancel = false;
    getDoc(tab)
      .then((pdf) => {
        if (cancel || !viewerApi.viewer) return;
        loadedRef.current = { id: tab.id, version: tab.version };
        hostsRef.current = [];
        setHosts([]);
        viewerApi.pdf = pdf;
        viewerApi.lastPointer = null;
        (viewerApi.viewer as unknown as { setDocument: (d: unknown) => void }).setDocument(pdf);
        (viewerApi as unknown as { linkService: { setDocument: (d: unknown) => void } }).linkService.setDocument(pdf);
        useStore.getState().patchTab(tab.id, { pageCount: pdf.numPages });
      })
      .catch((e) => {
        if (cancel) return;
        const st = useStore.getState();
        if (/password|senha/i.test(String(e?.message)) || e?.name === "PasswordException") st.toast("Documento não aberto: senha não informada.", "err");
        else st.toast("Não foi possível abrir o PDF: " + (e?.message || e), "err");
        st.closeTab(tab.id);
      });
    return () => {
      cancel = true;
    };
  }, [tab?.id, tab?.version]);

  // ferramenta "mão": arrastar para rolar
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const c = containerRef.current!;
    const pageEl = (e.target as HTMLElement).closest(".page") as HTMLElement | null;
    if (pageEl) {
      const n = Number(pageEl.dataset.pageNumber) - 1;
      const r = pageEl.getBoundingClientRect();
      const { w, h } = viewerApi.pageSize(n);
      viewerApi.lastPointer = { page: n, x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
    }
    if (!(e.target as HTMLElement).closest(".obj, .propbar")) {
      const st = useStore.getState();
      if (st.selected && st.tool === "select") st.select(null);
    }
    if (tool !== "hand" && e.button !== 1) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, l: c.scrollLeft, t: c.scrollTop };
    c.classList.add("dragging");
    c.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const c = containerRef.current!;
    c.scrollLeft = d.l - (e.clientX - d.x);
    c.scrollTop = d.t - (e.clientY - d.y);
  };
  const onPointerUp = () => {
    drag.current = null;
    containerRef.current?.classList.remove("dragging");
  };

  // soltar imagens em cima da página
  const onDragOver = (e: React.DragEvent) => {
    if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const pageEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement)?.closest(".page") as HTMLElement | null;
    const n = pageEl ? Number(pageEl.dataset.pageNumber) - 1 : viewerApi.current();
    let pt = viewerApi.insertPoint();
    if (pageEl) {
      const r = pageEl.getBoundingClientRect();
      const { w, h } = viewerApi.pageSize(n);
      pt = { page: n, x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
    }
    for (const f of files) {
      await addImageAt(f, pt);
      pt = { ...pt, x: pt.x + 16, y: pt.y + 16 };
    }
  };

  return (
    <div className="viewer-wrap" onDragOver={onDragOver} onDrop={onDrop}>
      <div
        ref={containerRef}
        className={`viewer-container ${tool === "hand" ? "hand" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div ref={viewerDivRef} className="pdfViewer" />
      </div>
      {tab && hosts.map((h, i) => createPortal(<Overlay key={`${tab.id}-${tab.version}-${i}`} page={i} w={h.w} h={h.h} />, h.el, `${tab.id}-${i}`))}
    </div>
  );
}
