import { memo, useEffect, useRef, useState } from "react";
import {
  X, Plus, Settings, ChevronUp, ChevronDown, CheckCircle2, AlertCircle, Info, MonitorCheck, ExternalLink, ShieldCheck, RefreshCw,
} from "lucide-react";
import { useStore, useActiveTab } from "../lib/store";
import { closeTabSafe, openFiles } from "../lib/actions";
import { getDoc } from "../lib/docs";
import { renderPage } from "../lib/pdfjs";
import { viewerApi } from "../lib/viewerApi";
import { isApp, openDefaultAppsSettings, openExternal } from "../lib/platform";
import { verifyPdf, type SigCheck } from "../lib/sign";
import { checkForUpdate, useUpdate } from "../lib/updater";
import { Menu } from "./Toolbar";
import type { Tab } from "../lib/types";

export function TopBar() {
  const hasUpdate = useUpdate((s) => s.status === "available");
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  return (
    <div className="topbar">
      <div className="brand" onClick={() => useStore.getState().set({ activeId: null })} title="Início">
        <img src="/brand/logo.png" alt="Auris" className="brand-logo" draggable={false} />
        <small className="brand-pdf">PDF</small>
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`tab ${t.id === activeId ? "active" : ""}`} onClick={() => setActive(t.id)} title={t.path || t.name}
            onAuxClick={(e) => e.button === 1 && closeTabSafe(t.id)}>
            <span className="name">{t.name}</span>
            {t.dirty && <span className="dot" title="Alterações não salvas" />}
            <button className="x" title="Fechar aba (Ctrl+W)" onClick={(e) => { e.stopPropagation(); closeTabSafe(t.id); }}><X size={14} /></button>
          </div>
        ))}
        <button className="ib" title="Abrir PDF (Ctrl+O)" onClick={openFiles} style={{ alignSelf: "center" }}><Plus size={17} /></button>
      </div>
      <div className="top-actions">
        <Menu icon={<span style={{ position: "relative", display: "grid" }}><Settings size={17} />{hasUpdate && <span className="upd-dot" />}</span>} title={hasUpdate ? "Configurações • atualização disponível" : "Configurações"} right>
          {(close) => <>
            {isApp && <button onClick={() => { openDefaultAppsSettings(); close(); }}><MonitorCheck size={16} /> Definir como leitor padrão de PDF</button>}
            <button onClick={() => { openExternal("https://validar.iti.gov.br"); close(); }}><ExternalLink size={16} /> Validador oficial do ITI</button>
            <hr />
            <button onClick={() => { checkForUpdate(true); close(); }}><RefreshCw size={16} /> Verificar atualizações</button>
            <button onClick={() => { useStore.getState().openDialog({ kind: "about" }); close(); }}><Info size={16} /> Sobre o Auris PDF</button>
          </>}
        </Menu>
      </div>
    </div>
  );
}

// ---------------- miniaturas ----------------
export function Sidebar() {
  const tab = useActiveTab();
  if (!tab?.pageCount) return <div className="sidebar" />;
  return (
    <div className="sidebar">
      {Array.from({ length: tab.pageCount }, (_, i) => <Thumb key={`${tab.id}-${tab.version}-${i}`} tab={tab} n={i + 1} on={tab.page === i + 1} />)}
    </div>
  );
}

const Thumb = memo(function Thumb({ tab, n, on }: { tab: Tab; n: number; on: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(1.414);
  useEffect(() => {
    const el = ref.current!;
    let done = false;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || done) return;
      done = true;
      io.disconnect();
      try {
        const pdf = await getDoc(tab);
        const c = await renderPage(pdf, n, { width: 256 });
        setRatio(c.height / c.width);
        el.replaceChildren(c);
      } catch { /* aba fechada */ }
    }, { root: el.closest(".sidebar"), rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [on]);
  return (
    <div className={`thumb ${on ? "on" : ""}`} onClick={() => viewerApi.goTo(n)}>
      <div className="img" ref={ref} style={{ height: 128 * ratio }} />
      <span>{n}</span>
    </div>
  );
});

// ---------------- busca ----------------
export function SearchBar() {
  const [q, setQ] = useState("");
  const [count, setCount] = useState<{ current: number; total: number } | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inp.current?.focus();
    const bus = viewerApi.eventBus;
    const f = (e: { matchesCount: { current: number; total: number } }) => setCount(e.matchesCount);
    bus?.on("updatefindmatchescount", f as never);
    bus?.on("updatefindcontrolstate", f as never);
    return () => {
      viewerApi.find("");
      (bus as unknown as { off: (n: string, f: unknown) => void })?.off("updatefindmatchescount", f);
      (bus as unknown as { off: (n: string, f: unknown) => void })?.off("updatefindcontrolstate", f);
    };
  }, []);
  return (
    <div className="searchbar">
      <input ref={inp} placeholder="Buscar no documento…" value={q}
        onChange={(e) => { setQ(e.target.value); viewerApi.find(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") viewerApi.find(q, e.shiftKey, true);
          if (e.key === "Escape") useStore.getState().set({ search: false });
        }} />
      <span className="count">{q && count ? (count.total ? `${count.current} de ${count.total}` : "Nada") : ""}</span>
      <button className="ib" onClick={() => viewerApi.find(q, true, true)} title="Anterior (Shift+Enter)"><ChevronUp size={16} /></button>
      <button className="ib" onClick={() => viewerApi.find(q, false, true)} title="Próximo (Enter)"><ChevronDown size={16} /></button>
      <button className="ib" title="Fechar busca (Esc)" onClick={() => useStore.getState().set({ search: false })}><X size={16} /></button>
    </div>
  );
}

// ---------------- painel de assinaturas ----------------
export function SigPanel() {
  const tab = useActiveTab();
  const [list, setList] = useState<SigCheck[] | null>(null);
  useEffect(() => {
    setList(null);
    if (tab) verifyPdf(tab.bytes).then(setList).catch(() => setList([]));
  }, [tab?.id, tab?.version]);
  const fmt = (d?: Date) => (d ? d.toLocaleString("pt-BR") : "—");
  return (
    <div className="sig-panel">
      <div className="row" style={{ flex: "none" }}>
        <img className="modal-ic" src="/icons/verificar.png" alt="" draggable={false} style={{ flex: "none" }} /><b style={{ flex: 1, fontSize: 14 }}>Assinaturas</b>
        <button className="ib" title="Fechar painel" style={{ flex: "none" }} onClick={() => useStore.getState().set({ sigPanel: false })}><X size={16} /></button>
      </div>
      {!list && <div className="muted">Verificando…</div>}
      {list && !list.length && <div className="muted">Este documento não possui assinaturas digitais.</div>}
      {list?.map((s, i) => {
        const ok = s.intact && s.cryptoOk !== false && !s.error;
        const cls = !ok ? "bad" : s.modifiedAfter || s.certExpiredAtSigning ? "warn" : "";
        return (
          <div key={i} className={`sig-card ${cls}`}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div className="t">{s.name}</div>
                {s.doc && <div className="l">{s.doc.length === 14 ? "CNPJ" : "CPF"}: {s.doc}</div>}
              </div>
              <span className={`badge ${ok ? "ok" : "err"}`} style={{ flex: "none" }}>{ok ? "Íntegra" : "Inválida"}</span>
            </div>
            <div className="l">Assinado em: {fmt(s.date)}</div>
            <div className="l">Emissor: {s.issuer || "—"} {s.icp && <span className="badge ok">ICP-Brasil</span>}</div>
            <div className="l">Validade do certificado: {fmt(s.validFrom)} a {fmt(s.validTo)}</div>
            {s.reason && <div className="l">Motivo: {s.reason}</div>}
            {s.error && <div className="l" style={{ color: "var(--red)" }}>{s.error}</div>}
            {ok && s.modifiedAfter && <div className="l" style={{ color: "var(--amber)" }}>O documento recebeu alterações depois desta assinatura (ex.: outras assinaturas).</div>}
            {!ok && !s.error && <div className="l" style={{ color: "var(--red)" }}>O conteúdo foi alterado após a assinatura.</div>}
            {s.certExpiredAtSigning && <div className="l" style={{ color: "var(--amber)" }}>Certificado fora da validade na data da assinatura.</div>}
          </div>
        );
      })}
      {!!list?.length && (
        <div className="muted">
          A verificação aqui confere a integridade e a assinatura criptográfica. Para a validação oficial da cadeia ICP-Brasil, use o
          {" "}<a href="#" style={{ color: "var(--blue-3)" }} onClick={(e) => { e.preventDefault(); openExternal("https://validar.iti.gov.br"); }}>validar.iti.gov.br</a>.
        </div>
      )}
    </div>
  );
}

// ---------------- avisos ----------------
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const busy = useStore((s) => s.busy);
  return (
    <>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "ok" ? <CheckCircle2 size={18} /> : t.kind === "err" ? <AlertCircle size={18} /> : <Info size={18} />}
            {t.text}
          </div>
        ))}
      </div>
      {busy && <div className="busy"><div className="busy-card"><div className="spin" />{busy}</div></div>}
    </>
  );
}
