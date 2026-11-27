import { createRoot } from "react-dom/client";
import posthog from "posthog-js";
import "./styles.css";
import "./lib/theme"; // aplica o tema salvo e acompanha o modo do Windows
import App from "./App";

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

if (posthogKey && posthogHost) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: "auris-pdf-web",
      environment: import.meta.env.PROD ? "production" : "development",
    },
  });
} else if (import.meta.env.DEV) {
  const missingVariables = [
    !posthogKey && "VITE_POSTHOG_KEY",
    !posthogHost && "VITE_POSTHOG_HOST",
  ].filter(Boolean);
  missingVariables.forEach((missingVariable) =>
    console.error(
      new Error(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
      ),
    ),
  );
}

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
