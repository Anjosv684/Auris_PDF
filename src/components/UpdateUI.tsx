import { Download, X, Sparkles } from "lucide-react";
import { useUpdate, installUpdate } from "../lib/updater";
import { fmtSize } from "../lib/util";

/** Aviso discreto no canto + tela de progresso durante a atualização. */
export function UpdateUI() {
  const { status, version, notes, downloaded, total, dismissed } = useUpdate();

  if (status === "downloading" || status === "installing") {
    const pct = total ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
    return (
      <div className="update-screen">
        <div className="update-card">
          <div className="brand-mark big">A</div>
          <h2>Atualizando o Auris PDF</h2>
          <div className="muted">Versão {version}</div>
          <div className="update-bar"><div className={pct === null ? "indet" : ""} style={pct === null ? undefined : { width: pct + "%" }} /></div>
          <div className="muted">
            {status === "installing"
              ? "Instalando… o programa vai reabrir sozinho em instantes."
              : pct === null ? `Baixando… ${fmtSize(downloaded)}` : `Baixando… ${pct}% (${fmtSize(downloaded)} de ${fmtSize(total!)})`}
          </div>
        </div>
      </div>
    );
  }

  if (status !== "available" || dismissed) return null;
  return (
    <div className="update-toast">
      <Sparkles size={20} className="ic" />
      <div className="txt">
        <b>Nova versão disponível: {version}</b>
        {notes && <span className="notes">{notes}</span>}
        <div className="row" style={{ justifyContent: "flex-start", gap: 8, marginTop: 8 }}>
          <button className="btn" style={{ flex: "none" }} onClick={installUpdate}><Download size={15} /> Atualizar agora</button>
          <button className="btn ghost" style={{ flex: "none" }} onClick={() => useUpdate.setState({ dismissed: true })}>Depois</button>
        </div>
      </div>
      <button className="ib" onClick={() => useUpdate.setState({ dismissed: true })}><X size={15} /></button>
    </div>
  );
}
