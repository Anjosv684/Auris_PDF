import { useEffect, useMemo, useState } from "react";
import { Usb, FileKey, Upload, KeyRound } from "lucide-react";
import { isApp, listCertificates, pickFiles, type PickedFile } from "../lib/platform";
import { signerFromPfx, signerFromStore, describeCert, certFromDer, type Signer, type CertSummary } from "../lib/sign";
import type { CertInfo } from "../lib/types";

/** Escolha do certificado: token A3 / instalado no Windows, ou arquivo A1 (.pfx). */
export function useCertPicker(onEnter?: () => void) {
  const [src, setSrc] = useState<"store" | "pfx">(() => (isApp && localStorage.getItem("auris.cert.src") !== "pfx" ? "store" : "pfx"));
  const [certs, setCerts] = useState<CertInfo[] | null>(null);
  const [certErr, setCertErr] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [pfx, setPfx] = useState<PickedFile | null>(null);
  const [pwd, setPwd] = useState("");

  const loadCerts = () => {
    setCerts(null);
    setCertErr("");
    listCertificates().then((c) => {
      setCerts(c);
      const lastTp = localStorage.getItem("auris.cert.last");
      if (c.length === 1) setPicked(c[0].thumbprint);
      else if (lastTp && c.some((x) => x.thumbprint === lastTp)) setPicked(lastTp);
    }).catch((e) => setCertErr(String(e?.message || e)));
  };
  useEffect(() => { if (src === "store" && isApp && !certs) loadCerts(); }, [src]);
  // lembra o último certificado usado
  useEffect(() => { try { localStorage.setItem("auris.cert.src", src); if (picked) localStorage.setItem("auris.cert.last", picked); } catch { /* */ } }, [src, picked]);

  const ready = src === "store" ? !!picked : !!pfx;
  /** dados do certificado escolhido (para a prévia do quadro); null se ainda não dá para ler */
  const summary = useMemo<CertSummary | null>(() => {
    try {
      if (src === "store") {
        const c = certs?.find((x) => x.thumbprint === picked);
        return c ? describeCert(certFromDer(c.der)) : null;
      }
      return pfx && pwd ? signerFromPfx(pfx.bytes, pwd).summary : null;
    } catch {
      return null;
    }
  }, [src, certs, picked, pfx, pwd]);
  const isStore = src === "store";

  /** Cria o assinador (lança erro com mensagem amigável). */
  const signer = (): Signer => {
    let s: Signer;
    if (src === "pfx") {
      if (!pfx) throw new Error("Escolha o arquivo do certificado A1 (.pfx).");
      s = signerFromPfx(pfx.bytes, pwd);
    } else {
      const c = certs?.find((x) => x.thumbprint === picked);
      if (!c) throw new Error("Escolha um certificado.");
      s = signerFromStore(c);
    }
    if (s.summary.validTo < new Date()) throw new Error(`Certificado vencido em ${s.summary.validTo.toLocaleDateString("pt-BR")}.`);
    return s;
  };

  const fmtD = (s: string) => new Date(s).toLocaleDateString("pt-BR");
  const ui = <>
    <div className="seg">
      <button className={src === "store" ? "on" : ""} onClick={() => setSrc("store")}><Usb size={15} style={{ verticalAlign: -3 }} /> Token A3 / certificado instalado</button>
      <button className={src === "pfx" ? "on" : ""} onClick={() => setSrc("pfx")}><FileKey size={15} style={{ verticalAlign: -3 }} /> Arquivo A1 (.pfx)</button>
    </div>
    {src === "store" && (
      <div className="field">
        <label>Certificados encontrados no Windows {isApp && <a href="#" style={{ color: "var(--blue-3)", fontWeight: 400 }} onClick={(e) => { e.preventDefault(); loadCerts(); }}>atualizar</a>}</label>
        {!isApp && <div className="muted">Tokens A3 só podem ser usados no app instalado no Windows. Aqui no navegador, use o arquivo A1.</div>}
        {isApp && !certs && !certErr && <div className="muted">Procurando certificados… conecte o token USB.</div>}
        {certErr && <div className="muted" style={{ color: "var(--red)" }}>{certErr}</div>}
        {certs && !certs.length && <div className="muted">Nenhum certificado com chave privada encontrado. Conecte o token e clique em atualizar.</div>}
        <div className="cert-list">
          {certs?.map((c) => {
            let s;
            try { s = describeCert(certFromDer(c.der)); } catch { s = null; }
            const exp = new Date(c.notAfter) < new Date();
            return (
              <div key={c.thumbprint} className={`cert ${picked === c.thumbprint ? "on" : ""}`} onClick={() => setPicked(c.thumbprint)}>
                <KeyRound size={18} className="ic-accent" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{s?.name || c.subject}</div>
                  <div className="meta">{s?.doc ? (s.doc.length === 14 ? "CNPJ " : "CPF ") + s.doc + " • " : ""}{s?.issuer || c.issuer} • válido até {fmtD(c.notAfter)}</div>
                </div>
                {s?.icp && <span className="badge ok">ICP-Brasil</span>}
                {exp && <span className="badge err">Vencido</span>}
              </div>
            );
          })}
        </div>
      </div>
    )}
    {src === "pfx" && (
      <div className="row">
        <div className="field">
          <label>Arquivo do certificado</label>
          <button className="btn ghost" onClick={async () => { const [f] = await pickFiles("pfx", false); if (f) setPfx(f); }}><Upload size={15} /> {pfx ? pfx.name : "Escolher .pfx / .p12"}</button>
        </div>
        <div className="field">
          <label>Senha do certificado</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} placeholder="••••••" />
        </div>
      </div>
    )}
  </>;

  return { ui, signer, ready, isStore, summary };
}
