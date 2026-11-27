import { useState } from "react";
import { FolderOpen, Combine, Scissors, Minimize2, Images, FileSignature, FileText, LayoutGrid, FileDown } from "lucide-react";
import { useStore } from "../lib/store";
import { openFiles, openPaths, recents } from "../lib/actions";
import { isApp } from "../lib/platform";

const CARDS = [
  { icon: <Combine size={20} />, c: "#2f80ed", t: "Juntar PDFs", d: "Una vários arquivos em um só, na ordem que quiser", a: () => useStore.getState().openDialog({ kind: "merge" }) },
  { icon: <Scissors size={20} />, c: "#8e4ec6", t: "Dividir PDF", d: "Separe por intervalos, a cada N páginas ou página por página", a: () => useStore.getState().openDialog({ kind: "split" }) },
  { icon: <Minimize2 size={20} />, c: "#30a46c", t: "Comprimir PDF", d: "Reduza o tamanho para enviar por WhatsApp e e-mail", a: () => useStore.getState().openDialog({ kind: "compress" }) },
  { icon: <FileSignature size={20} />, c: "#f76808", t: "Assinar digitalmente", d: "Certificado ICP-Brasil A1 (arquivo) ou A3 (token)", a: async () => { await openFiles(); } },
  { icon: <Images size={20} />, c: "#e5484d", t: "Imagens → PDF", d: "Transforme fotos e prints em um PDF", a: () => useStore.getState().openDialog({ kind: "images" }) },
  { icon: <LayoutGrid size={20} />, c: "#0091ff", t: "Organizar páginas", d: "Reordene, gire, exclua e insira páginas", a: async () => { await openFiles(); } },
];

export function Home() {
  const [over, setOver] = useState(false);
  const rec = isApp ? recents() : [];
  return (
    <div className="home">
      <div style={{ textAlign: "center" }}>
        <h1 className="home-logo"><img src="/brand/logo.png" alt="Auris" draggable={false} /><span>PDF</span></h1>
      </div>
      <div className="sub">Abra, edite, assine e organize seus PDFs — rápido e 100% no seu computador.</div>
      <div className={`drop ${over ? "over" : ""}`} onClick={openFiles}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}>
        <FolderOpen size={34} color="#5aa2f5" />
        <div className="big">Arraste PDFs aqui ou clique para abrir</div>
        <div className="hint">Vários arquivos abrem em abas • Ctrl+O</div>
      </div>
      <div className="cards">
        {CARDS.map((c) => (
          <button key={c.t} className="card" onClick={c.a}>
            <div className="ic" style={{ background: c.c + "26", color: c.c }}>{c.icon}</div>
            <div><b>{c.t}</b><span>{c.d}</span></div>
          </button>
        ))}
      </div>
      {!!rec.length && (
        <div className="recent">
          <h3>Recentes</h3>
          {rec.map((p) => (
            <div key={p} className="recent-item" onClick={() => openPaths([p])}>
              <FileText size={16} color="#e5484d" /> {p.split(/[\\/]/).pop()} <small>{p}</small>
            </div>
          ))}
        </div>
      )}
      <div className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}><FileDown size={14} /> Dica: cole imagens com Ctrl+V direto na página.</div>
    </div>
  );
}
