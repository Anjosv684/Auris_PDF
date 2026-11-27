import { createRoot } from "react-dom/client";
import "./styles.css";
import "./lib/theme"; // aplica o tema salvo e acompanha o modo do Windows
import App from "./App";

// bloqueia o menu de contexto padrão do navegador e o zoom do webview (o app tem o seu)
window.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest("input, textarea, .textLayer")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);

// some com a tela de abertura depois do primeiro desenho do app
requestAnimationFrame(() => requestAnimationFrame(() => {
  const s = document.getElementById("splash");
  if (!s) return;
  setTimeout(() => { s.classList.add("hide"); setTimeout(() => s.remove(), 400); }, 250);
}));
