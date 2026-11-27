import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

// bloqueia o menu de contexto padrão do navegador e o zoom do webview (o app tem o seu)
window.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).closest("input, textarea, .textLayer")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
