import { useEffect, useState } from "react";
import { isApp } from "../lib/platform";

const win = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());

/** Minimizar / maximizar / fechar desenhados na própria barra do Auris (janela sem a barra do Windows). */
export function WindowControls() {
  const [max, setMax] = useState(true);
  useEffect(() => {
    if (!isApp) return;
    let off: (() => void) | undefined;
    win().then(async (w) => {
      setMax(await w.isMaximized());
      off = await w.onResized(async () => setMax(await w.isMaximized()));
    });
    return () => off?.();
  }, []);
  if (!isApp) return null;
  return (
    <div className="win-ctrls">
      <button title="Minimizar" onClick={() => win().then((w) => w.minimize())}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button title={max ? "Restaurar" : "Maximizar"} onClick={() => win().then((w) => w.toggleMaximize())}>
        {max ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" rx="1" /></svg>
        )}
      </button>
      <button className="close" title="Fechar" onClick={() => win().then((w) => w.close())}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1.1" /></svg>
      </button>
    </div>
  );
}
