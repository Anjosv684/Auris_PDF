// Tema da interface: azul (padrão Auris), claro (fundo branco), escuro (grafite) ou automático (segue o Windows).
// A página do PDF continua branca em todos os temas; só muda a moldura do programa.
import { create } from "zustand";

export type ThemeChoice = "azul" | "claro" | "escuro" | "sistema";
export const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "azul", label: "Azul" },
  { id: "claro", label: "Claro" },
  { id: "escuro", label: "Escuro" },
  { id: "sistema", label: "Automático" },
];

const KEY = "auris.theme";
const media = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-color-scheme: light)");

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "azul" || v === "claro" || v === "escuro" || v === "sistema") return v;
  } catch { /* sem localStorage */ }
  return "azul";
}

/** No automático: Windows claro → tema claro; Windows escuro → azul Auris. */
function resolve(c: ThemeChoice) {
  return c === "sistema" ? (media?.matches ? "claro" : "azul") : c;
}

function apply(c: ThemeChoice) {
  document.documentElement.dataset.theme = resolve(c);
}

export const useTheme = create<{ theme: ThemeChoice }>(() => ({ theme: read() }));

export function setTheme(t: ThemeChoice) {
  try { localStorage.setItem(KEY, t); } catch { /* ignora */ }
  useTheme.setState({ theme: t });
  apply(t);
}

apply(read());
media?.addEventListener("change", () => apply(useTheme.getState().theme));
