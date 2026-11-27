import { Printer, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useJobs, cancelJob } from "../lib/print";

/** Trabalhos de impressão em segundo plano: barra de progresso discreta com Cancelar. */
export function PrintJobs() {
  const jobs = useJobs((s) => s.jobs);
  if (!jobs.length) return null;
  return (
    <div className="print-jobs">
      {jobs.map((j) => {
        const pct = j.total ? (j.page / j.total) * 100 : 0;
        const active = j.state === "preparing" || j.state === "printing";
        return (
          <div key={j.id} className={`print-job ${j.state}`}>
            {j.state === "done" ? <CheckCircle2 size={17} className="ic ok" /> : j.state === "error" ? <AlertCircle size={17} className="ic err" /> : <Printer size={17} className="ic" />}
            <div className="txt">
              <div className="nm" title={j.name}>{j.name}</div>
              <div className="muted">
                {j.message ?? (j.state === "preparing" ? "Preparando…" : j.state === "printing" ? `Imprimindo ${j.page}/${j.total}…` : j.state === "done" ? "Enviado para a impressora" : "Cancelada")}
              </div>
              {active && <div className="update-bar" style={{ margin: "6px 0 0", height: 5 }}><div className={j.total ? "" : "indet"} style={j.total ? { width: pct + "%" } : undefined} /></div>}
            </div>
            {active && <button className="ib" title="Cancelar impressão" onClick={() => cancelJob(j.id)}><X size={15} /></button>}
          </div>
        );
      })}
    </div>
  );
}
