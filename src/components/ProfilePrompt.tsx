import { useEffect, useRef, useState } from "react";
import { Check, UserRound } from "lucide-react";
import { saveProfile, useProfile } from "../lib/telemetry";
import { THEMES, setTheme, useTheme, type ThemeChoice } from "../lib/theme";

// cores das miniaturas (barra do topo, fundo, lateral)
const PREVIEW: Record<Exclude<ThemeChoice, "sistema">, { top: string; bg: string; side: string; line: string; thumb?: string }> = {
  azul: { top: "linear-gradient(90deg, #042c53, #185fa5)", bg: "#0b2440", side: "#042c53", line: "rgba(255,255,255,.18)" },
  claro: { top: "linear-gradient(90deg, #e4ecf6, #d8e6f5)", bg: "#e3e8ef", side: "#ffffff", line: "rgba(15,40,70,.14)", thumb: "#d5dde8" },
  escuro: { top: "linear-gradient(90deg, #1c1e22, #24272c)", bg: "#2a2c30", side: "#1c1e22", line: "rgba(255,255,255,.14)" },
};

function Mini({ t }: { t: Exclude<ThemeChoice, "sistema"> }) {
  const c = PREVIEW[t];
  return (
    <div className="th-mini" style={{ background: c.bg }}>
      <div className="th-top" style={{ background: c.top }}><i style={{ background: c.line }} /><i style={{ background: c.line }} /></div>
      <div className="th-body">
        <div className="th-side" style={{ background: c.side }}>{[0, 1, 2].map((i) => <b key={i} style={c.thumb ? { background: c.thumb, opacity: 1 } : undefined} />)}</div>
        <div className="th-page"><s /><s /><s /><s style={{ width: "55%" }} /></div>
      </div>
    </div>
  );
}

const HINT: Record<ThemeChoice, string> = {
  azul: "O visual Auris",
  claro: "Fundo branco",
  escuro: "Grafite, descansa a vista",
  sistema: "Segue o Windows",
};

/** Boas-vindas depois da atualização: nome, filial e tema. Também abre em Configurações → Meu nome e filial. */
export function ProfilePrompt() {
  const { asking, profile } = useProfile();
  const theme = useTheme((s) => s.theme);
  const [nome, setNome] = useState("");
  const [filial, setFilial] = useState("");
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!asking) return;
    setNome(profile?.nome ?? "");
    setFilial(profile?.filial ?? "");
    setTimeout(() => first.current?.focus(), 50);
  }, [asking]);

  if (!asking) return null;
  const welcome = !profile; // primeira vez: obrigatório e com texto de boas-vindas
  const ok = nome.trim().length >= 2 && filial.trim().length >= 2;
  const save = () => ok && saveProfile({ nome: nome.trim(), filial: filial.trim() });
  const cancel = welcome ? undefined : () => useProfile.setState({ asking: false });

  return (
    <div className="backdrop" style={{ zIndex: 260 }}>
      <div className="modal welcome" onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel?.(); }}>
        {welcome ? (
          <div className="welcome-head">
            <img src="/brand/mark.png" alt="" />
            <div>
              <h2>Bem-vindo ao novo Auris PDF</h2>
              <div className="muted">Só dois passos rápidos e pronto.</div>
            </div>
          </div>
        ) : (
          <div className="modal-head"><UserRound size={18} className="modal-ic" /><h2>Seu nome, filial e tema</h2></div>
        )}
        <div className="modal-body">
          <div className="step"><span>1</span> Quem é você?</div>
          <div className="row">
            <div className="field">
              <label>Seu nome</label>
              <input ref={first} type="text" value={nome} maxLength={60} placeholder="Ex.: Maria Silva" onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="field">
              <label>Filial</label>
              <input type="text" value={filial} maxLength={60} placeholder="Ex.: Matriz" onChange={(e) => setFilial(e.target.value)} />
            </div>
          </div>

          <div className="step"><span>2</span> Escolha o visual <small>— dá para trocar depois na engrenagem ⚙</small></div>
          <div className="th-grid">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className={`th-card ${theme === t.id ? "on" : ""}`} onClick={() => setTheme(t.id)}>
                {t.id === "sistema" ? (
                  <div className="th-split"><Mini t="claro" /><div className="th-half"><Mini t="azul" /></div></div>
                ) : <Mini t={t.id} />}
                <div className="th-label">
                  <b>{t.label}</b>
                  <small>{HINT[t.id]}</small>
                </div>
                {theme === t.id && <span className="th-check"><Check size={13} strokeWidth={3} /></span>}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>Seus documentos nunca saem do computador. O nome e a filial servem só para sabermos quem usa e onde melhorar.</div>
        </div>
        <div className="modal-foot">
          {cancel && <button className="btn ghost" onClick={cancel}>Cancelar</button>}
          <button className="btn" disabled={!ok} onClick={save}>{welcome ? "Começar" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
