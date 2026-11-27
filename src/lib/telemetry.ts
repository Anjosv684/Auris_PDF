// Estatísticas de uso (PostHog): quais ferramentas são usadas, erros e quem usa (nome + filial).
// Nunca envia nome de arquivo nem conteúdo de documento. Pode ser desligado em Configurações.
import { create } from "zustand";
import { useStore } from "./store";
import { appVersion } from "./updater";

// Chave do projeto PostHog (começa com "phc_"). É uma chave pública de envio, pode ficar no código.
// Enquanto estiver vazia, nada é enviado e o nome/filial não é pedido.
const POSTHOG_KEY = "phc_s2jkpuohKWQXdykmt4Jia8ATHsEYPXooFJZwbpmBP9DP";
const POSTHOG_HOST = "https://us.i.posthog.com";

export type Profile = { nome: string; filial: string };

const K_ID = "auris.machine";
const K_PROFILE = "auris.profile";
const K_OFF = "auris.telemetry.off";

function load<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}

function machineId() {
  let id = localStorage.getItem(K_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(K_ID, id);
  }
  return id;
}

export const telemetryOn = !!POSTHOG_KEY;

export const useProfile = create<{ profile: Profile | null; asking: boolean; enabled: boolean }>(() => ({
  profile: load<Profile>(K_PROFILE),
  asking: false,
  enabled: localStorage.getItem(K_OFF) !== "1",
}));

export function saveProfile(p: Profile) {
  localStorage.setItem(K_PROFILE, JSON.stringify(p));
  useProfile.setState({ profile: p, asking: false });
  track("perfil_atualizado");
}

export function askProfile() {
  useProfile.setState({ asking: true });
}

export function setTelemetry(on: boolean) {
  if (on) localStorage.removeItem(K_OFF); else localStorage.setItem(K_OFF, "1");
  useProfile.setState({ enabled: on });
}

// ---------------- envio ----------------
type Ev = { event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> };
let queue: Ev[] = [];
let version = "";
appVersion().then((v) => (version = v)).catch(() => {});

/** Registra um uso. `props` não deve conter nome de arquivo nem texto do documento. */
export function track(event: string, props: Record<string, unknown> = {}) {
  if (!telemetryOn || !useProfile.getState().enabled) return;
  const p = useProfile.getState().profile;
  queue.push({
    event,
    distinct_id: machineId(),
    timestamp: new Date().toISOString(),
    properties: {
      ...props,
      versao: version,
      nome: p?.nome,
      filial: p?.filial,
      // aparece no cadastro da pessoa no PostHog (para o ranking de quem mais usa)
      $set: p ? { name: `${p.nome} (${p.filial})`, nome: p.nome, filial: p.filial, versao: version } : { versao: version },
      $process_person_profile: true,
    },
  });
  if (queue.length >= 20) flush();
}

function flush() {
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  fetch(`${POSTHOG_HOST}/batch/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
    keepalive: true,
  }).catch(() => {
    // sem internet: guarda para a próxima (até 200 eventos)
    queue = [...batch, ...queue].slice(-200);
  });
}

/** Liga a coleta: abertura do app, troca de ferramenta, erros. Chamado uma vez no início. */
export function startTelemetry() {
  if (!telemetryOn) return;
  if (!useProfile.getState().profile) askProfile();
  appVersion().then((v) => { version = v; track("app_aberto"); }).catch(() => track("app_aberto"));

  let lastTool = useStore.getState().tool;
  let lastToasts = new Set(useStore.getState().toasts.map((t) => t.id));
  useStore.subscribe((s) => {
    if (s.tool !== lastTool) {
      lastTool = s.tool;
      if (s.tool !== "select") track("ferramenta", { ferramenta: s.tool });
    }
    for (const t of s.toasts) {
      if (lastToasts.has(t.id)) continue;
      // mensagens de erro mostradas ao usuário (sem nomes de arquivo: corta caminhos)
      if (t.kind === "err") track("erro", { mensagem: clean(t.text), origem: "aviso" });
    }
    lastToasts = new Set(s.toasts.map((t) => t.id));
  });
  window.addEventListener("error", (e) => track("erro", { mensagem: clean(e.message), origem: "programa", local: `${e.filename?.split("/").pop()}:${e.lineno}` }));
  window.addEventListener("unhandledrejection", (e) => track("erro", { mensagem: clean(String((e.reason as Error)?.message ?? e.reason)), origem: "programa" }));
  setInterval(flush, 30_000);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

/** Tira caminhos e nomes de arquivo das mensagens de erro. */
function clean(s: string) {
  return String(s || "")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<caminho>")
    .replace(/[^\s"'/\\]+\.(pdf|docx?|png|jpe?g|tiff?|pfx|p12)\b/gi, "<arquivo>")
    .slice(0, 300);
}
