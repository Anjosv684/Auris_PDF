import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useActiveTab } from "../lib/store";
import { looksScanned, ocrTab } from "../lib/ocr";
import { isApp } from "../lib/platform";
import { FeatureIcon } from "./icons";

const dismissed = new Set<string>();

/** Aviso discreto quando o PDF aberto parece digitalizado (sem texto). */
export function OcrHint() {
  const tab = useActiveTab();
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(false);
    if (!isApp || !tab || dismissed.has(tab.id)) return;
    let alive = true;
    looksScanned(tab).then((s) => alive && setShow(s));
    return () => { alive = false; };
  }, [tab?.id, tab?.version]);
  if (!show || !tab) return null;
  const close = () => { dismissed.add(tab.id); setShow(false); };
  return (
    <div className="ocr-hint">
      <FeatureIcon n="ocr" size={16} className="ic-accent" />
      <span>Este PDF parece ser digitalizado: o texto não pode ser buscado nem copiado.</span>
      <button className="btn" style={{ height: 28 }} onClick={() => { close(); ocrTab(); }}>Reconhecer texto (OCR)</button>
      <button className="ib" title="Fechar aviso" onClick={close}><X size={15} /></button>
    </div>
  );
}
