// Atualização automática: consulta o GitHub Releases (endereço em tauri.conf.json → plugins.updater),
// baixa o instalador assinado, instala e reinicia o app.
import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { isApp } from "./platform";
import { useStore } from "./store";

type Status = "idle" | "checking" | "available" | "downloading" | "installing";

type UpdState = {
  status: Status;
  version?: string;
  notes?: string;
  downloaded: number;
  total?: number;
  /** usuário fechou o aviso desta versão */
  dismissed: boolean;
};

export const useUpdate = create<UpdState>(() => ({ status: "idle", downloaded: 0, dismissed: false }));

let pending: Update | null = null;

export async function appVersion(): Promise<string> {
  if (!isApp) return "web";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Procura atualização. `manual` mostra o resultado mesmo quando não há nada novo. */
export async function checkForUpdate(manual = false) {
  if (!isApp) {
    if (manual) useStore.getState().toast("Atualizações automáticas só funcionam no app instalado.", "info");
    return;
  }
  const s = useUpdate.getState();
  if (s.status === "checking" || s.status === "downloading" || s.status === "installing") return;
  if (s.status === "available") {
    if (manual) useUpdate.setState({ dismissed: false });
    return;
  }
  useUpdate.setState({ status: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const upd = await check({ timeout: 20000 });
    if (upd) {
      pending = upd;
      useUpdate.setState({ status: "available", version: upd.version, notes: upd.body, dismissed: false });
    } else {
      useUpdate.setState({ status: "idle" });
      if (manual) useStore.getState().toast(`Você já está na versão mais recente (${await appVersion()}).`, "ok");
    }
  } catch (e) {
    useUpdate.setState({ status: "idle" });
    if (manual) useStore.getState().toast("Não foi possível verificar atualizações. Confira a conexão com a internet.", "err");
    console.warn("updater:", e);
  }
}

/** Baixa, instala e reinicia. */
export async function installUpdate() {
  if (!pending) return;
  if (useStore.getState().tabs.some((t) => t.dirty) &&
      !confirm("Existem documentos com alterações não salvas. Elas serão perdidas ao atualizar. Continuar?")) return;
  useUpdate.setState({ status: "downloading", downloaded: 0, total: undefined });
  try {
    await pending.downloadAndInstall((ev) => {
      if (ev.event === "Started") useUpdate.setState({ total: ev.data.contentLength });
      else if (ev.event === "Progress") useUpdate.setState((s) => ({ downloaded: s.downloaded + ev.data.chunkLength }));
      else if (ev.event === "Finished") useUpdate.setState({ status: "installing" });
    });
    // no Windows o instalador fecha e reabre o app sozinho; nos demais, reinicia aqui
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdate.setState({ status: "available", dismissed: false });
    useStore.getState().toast("Falha ao atualizar: " + ((e as Error)?.message || String(e)), "err");
  }
}

/** Verifica alguns segundos após abrir e depois a cada 6 horas. */
export function startAutoCheck() {
  if (!isApp) return () => {};
  const first = window.setTimeout(() => checkForUpdate(false), 4000);
  const every = window.setInterval(() => checkForUpdate(false), 6 * 60 * 60 * 1000);
  return () => { clearTimeout(first); clearInterval(every); };
}
