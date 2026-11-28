import { create } from "zustand";
import type { Obj, Tab, Tool } from "./types";
import { uid } from "./util";

export type Dialog =
  | { kind: "merge"; files?: { name: string; bytes: Uint8Array }[] }
  | { kind: "split" }
  | { kind: "compress"; files?: { name: string; path?: string; bytes: Uint8Array }[] }
  | { kind: "images"; files?: { name: string; path?: string; bytes: Uint8Array }[] }
  | { kind: "export-images" }
  | { kind: "sign-batch"; files?: { name: string; path?: string; bytes: Uint8Array }[] }
  | { kind: "signature-pad" }
  | { kind: "password"; retry: boolean; resolve: (p: string | null) => void }
  | { kind: "print"; files?: { name: string; bytes: Uint8Array }[] }
  | { kind: "about" };

export type Toast = { id: string; text: string; kind: "ok" | "err" | "info" };

export type Style = { stroke: string; fill: string | null; strokeWidth: number; textColor: string; textSize: number; highlight: string };

type State = {
  tabs: Tab[];
  activeId: string | null;
  view: "doc" | "organize";
  tool: Tool;
  selected: string | null;
  style: Style;
  dialog: Dialog | null;
  toasts: Toast[];
  sidebar: boolean;
  search: boolean;
  sigPanel: boolean;
  /** barrinha flutuante de giro do documento (preferência do usuário) */
  pageBar: boolean;
  busy: string | null;

  openTab: (t: { name: string; path?: string; bytes: Uint8Array }) => string;
  closeTab: (id: string) => void;
  setActive: (id: string | null) => void;
  patchTab: (id: string, p: Partial<Tab>) => void;
  replaceBytes: (id: string, bytes: Uint8Array, opts?: { record?: boolean; keepObjects?: boolean; name?: string; path?: string }) => void;

  checkpoint: () => void; // guarda o estado atual para o "desfazer"
  addObj: (o: Obj) => void;
  updateObj: (id: string, p: Partial<Obj>) => void;
  removeObj: (id: string) => void;
  undo: () => void;
  redo: () => void;

  setTool: (t: Tool) => void;
  select: (id: string | null) => void;
  setStyle: (p: Partial<Style>) => void;
  setView: (v: State["view"]) => void;
  openDialog: (d: Dialog | null) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  set: (p: Partial<State>) => void;
};

const HIST = 80;

export const useStore = create<State>((set, get) => {
  const active = () => get().tabs.find((t) => t.id === get().activeId);
  const mapActive = (fn: (t: Tab) => Tab) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === s.activeId ? fn(t) : t)) }));

  return {
    tabs: [],
    activeId: null,
    view: "doc",
    tool: "select",
    selected: null,
    style: { stroke: "#E5484D", fill: null, strokeWidth: 2, textColor: "#111111", textSize: 14, highlight: "#FFE066" },
    dialog: null,
    toasts: [],
    sidebar: true,
    search: false,
    sigPanel: false,
    pageBar: typeof localStorage === "undefined" || localStorage.getItem("auris.pagebar") !== "0",
    busy: null,

    openTab: ({ name, path, bytes }) => {
      if (path) {
        const ex = get().tabs.find((t) => t.path === path);
        if (ex) {
          set({ activeId: ex.id, view: "doc" });
          return ex.id;
        }
      }
      const tab: Tab = {
        id: uid(), name, path, bytes, version: 1, objects: [], past: [], future: [],
        dirty: false, page: 1, pageCount: 0, formDirty: false,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id, view: "doc", selected: null }));
      return tab.id;
    },
    closeTab: (id) =>
      set((s) => {
        const i = s.tabs.findIndex((t) => t.id === id);
        const tabs = s.tabs.filter((t) => t.id !== id);
        const activeId = s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.activeId;
        return { tabs, activeId, selected: null, view: "doc" };
      }),
    setActive: (id) => set({ activeId: id, selected: null, view: "doc" }),
    patchTab: (id, p) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...p } : t)) })),
    replaceBytes: (id, bytes, opts = {}) =>
      set((s) => ({
        selected: null,
        tabs: s.tabs.map((t) =>
          t.id !== id
            ? t
            : {
                ...t,
                bytes,
                version: t.version + 1,
                objects: opts.keepObjects ? t.objects : [],
                past: opts.record === false ? t.past : [...t.past, { objects: t.objects, bytes: t.bytes }].slice(-HIST),
                future: [],
                dirty: true,
                formDirty: false,
                name: opts.name ?? t.name,
                path: opts.path ?? t.path,
              },
        ),
      })),

    checkpoint: () =>
      mapActive((t) => ({ ...t, past: [...t.past, { objects: t.objects }].slice(-HIST), future: [] })),
    addObj: (o) => {
      get().checkpoint();
      mapActive((t) => ({ ...t, objects: [...t.objects, o], dirty: true }));
      set({ selected: o.id });
    },
    updateObj: (id, p) =>
      mapActive((t) => ({ ...t, dirty: true, objects: t.objects.map((o) => (o.id === id ? ({ ...o, ...p } as Obj) : o)) })),
    removeObj: (id) => {
      get().checkpoint();
      mapActive((t) => ({ ...t, dirty: true, objects: t.objects.filter((o) => o.id !== id) }));
      if (get().selected === id) set({ selected: null });
    },
    undo: () => {
      const t = active();
      if (!t || !t.past.length) return;
      const prev = t.past[t.past.length - 1];
      mapActive((t) => ({
        ...t,
        past: t.past.slice(0, -1),
        future: [{ objects: t.objects, bytes: prev.bytes ? t.bytes : undefined }, ...t.future],
        objects: prev.objects,
        ...(prev.bytes ? { bytes: prev.bytes, version: t.version + 1 } : {}),
        dirty: true,
      }));
      set({ selected: null });
    },
    redo: () => {
      const t = active();
      if (!t || !t.future.length) return;
      const next = t.future[0];
      mapActive((t) => ({
        ...t,
        future: t.future.slice(1),
        past: [...t.past, { objects: t.objects, bytes: next.bytes ? t.bytes : undefined }],
        objects: next.objects,
        ...(next.bytes ? { bytes: next.bytes, version: t.version + 1 } : {}),
        dirty: true,
      }));
      set({ selected: null });
    },

    setTool: (tool) => set({ tool, selected: tool === "select" ? get().selected : null }),
    select: (selected) => set({ selected }),
    setStyle: (p) => set((s) => ({ style: { ...s.style, ...p } })),
    setView: (view) => set({ view, selected: null }),
    openDialog: (dialog) => set({ dialog }),
    toast: (text, kind = "ok") => {
      const id = uid();
      set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "err" ? 6000 : 3500);
    },
    set: (p) => set(p),
  };
});

export const useActiveTab = () => useStore((s) => s.tabs.find((t) => t.id === s.activeId));
export const getActiveTab = () => {
  const s = useStore.getState();
  return s.tabs.find((t) => t.id === s.activeId);
};

/** Executa uma tarefa pesada mostrando o indicador de "carregando" e erros em toast. */
export async function runTask<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const st = useStore.getState();
  st.set({ busy: label });
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    st.toast((e as Error).message || String(e), "err");
    return undefined;
  } finally {
    useStore.getState().set({ busy: null });
  }
}
