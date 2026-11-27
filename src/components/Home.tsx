import { useState } from "react";
import { FolderOpen, FileText, FileDown } from "lucide-react";
import { useStore, getActiveTab } from "../lib/store";
import { ocrTab } from "../lib/ocr";
import { convertFilesToWord } from "../lib/word";
import { openFiles, openPaths, recents } from "../lib/actions";
import { isApp } from "../lib/platform";
import { FeatureIcon, type Feature } from "./icons";
import { openBatch } from "./SignBatch";

const CARDS: { icon: Feature; t: string; d: string; a: () => unknown }[] = [
  { icon: "juntar", t: "Juntar PDFs", d: "Una vários arquivos em um só, na ordem que quiser", a: () => useStore.getState().openDialog({ kind: "merge" }) },
  { icon: "dividir", t: "Dividir PDF", d: "Separe por intervalos, a cada N páginas ou página por página", a: () => useStore.getState().openDialog({ kind: "split" }) },
  { icon: "comprimir", t: "Comprimir PDF", d: "Reduza o tamanho para enviar por WhatsApp e e-mail", a: () => useStore.getState().openDialog({ kind: "compress" }) },
  { icon: "assinatura-digital", t: "Assinar PDFs", d: "Um ou vários de uma vez: certificado A1/A3, carimbo ou à mão", a: () => openBatch([]) },
  { icon: "imagens-pdf", t: "Imagens → PDF", d: "Transforme fotos e prints em um PDF", a: () => useStore.getState().openDialog({ kind: "images" }) },
  { icon: "word", t: "PDF → Word", d: "Converta em .docx editável, com tabelas e imagens", a: () => convertFilesToWord() },
  { icon: "ocr", t: "Digitalizar (OCR)", d: "Torne PDFs escaneados pesquisáveis e copiáveis", a: async () => { await openFiles(); if (getActiveTab()) await ocrTab(); } },
  { icon: "organizar", t: "Organizar páginas", d: "Reordene, gire, exclua e insira páginas", a: async () => { await openFiles(); } },
];

export function Home() {
  const [over, setOver] = useState(false);
  const rec = isApp ? recents() : [];
  return (
    <div className="home">
      <div className="sub">Abra, edite, assine e organize seus PDFs — rápido e 100% no seu computador.</div>
      <div className={`drop ${over ? "over" : ""}`} onClick={openFiles}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}>
        <FolderOpen size={34} className="ic-accent" />
        <div className="big">Arraste PDFs aqui ou clique para abrir</div>
      </div>
      <div className="cards">
        {CARDS.map((c) => (
          <button key={c.t} className="card" onClick={c.a}>
            <div className="ic"><FeatureIcon n={c.icon} size={20} /></div>
            <div><b>{c.t}</b><span>{c.d}</span></div>
          </button>
        ))}
      </div>
      {!!rec.length && (
        <div className="recent">
          <h3>Recentes</h3>
          {rec.map((p) => (
            <div key={p} className="recent-item" onClick={() => openPaths([p])}>
              <FileText size={16} className="ic-accent" /> {p.split(/[\\/]/).pop()} <small>{p}</small>
            </div>
          ))}
        </div>
      )}
      <div className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}><FileDown size={14} /> Dica: cole imagens com Ctrl+V direto na página.</div>
    </div>
  );
}
