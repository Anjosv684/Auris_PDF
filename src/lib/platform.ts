// Camada de plataforma: no app (Tauri) usa disco/diálogos nativos;
// no navegador cai para <input type=file> e download.
import JSZip from "jszip";
import type { CertInfo } from "./types";

export const isApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type PickedFile = { name: string; path?: string; bytes: Uint8Array };

async function tauri() {
  const core = await import("@tauri-apps/api/core");
  const dialog = await import("@tauri-apps/plugin-dialog");
  return { invoke: core.invoke, dialog };
}

const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

export async function readPath(path: string): Promise<PickedFile> {
  const { invoke } = await tauri();
  const buf = await invoke<ArrayBuffer>("read_file", { path });
  return { name: fileName(path), path, bytes: new Uint8Array(buf) };
}

export async function writePath(path: string, bytes: Uint8Array) {
  const { invoke } = await tauri();
  await invoke("write_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

function browserPick(accept: string, multiple: boolean): Promise<PickedFile[]> {
  return new Promise((res) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      res(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    };
    inp.click();
  });
}

export async function pickFiles(kind: "pdf" | "image" | "pfx", multiple = true): Promise<PickedFile[]> {
  const ext = { pdf: ["pdf"], image: ["png", "jpg", "jpeg", "webp", "gif", "bmp"], pfx: ["pfx", "p12"] }[kind];
  if (!isApp) return browserPick(ext.map((e) => "." + e).join(","), multiple);
  const { dialog } = await tauri();
  const sel = await dialog.open({
    multiple,
    filters: [{ name: kind === "pdf" ? "PDF" : kind === "pfx" ? "Certificado A1" : "Imagens", extensions: ext }],
  });
  if (!sel) return [];
  const paths = Array.isArray(sel) ? sel : [sel];
  return Promise.all(paths.map(readPath));
}

function download(bytes: Uint8Array, name: string, mime = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Salva com diálogo. Retorna o caminho escolhido (app) ou o nome (navegador). */
export async function saveAs(bytes: Uint8Array, suggested: string, ext = "pdf"): Promise<string | null> {
  if (!isApp) {
    download(bytes, suggested, ext === "pdf" ? "application/pdf" : ext === "zip" ? "application/zip" : "image/" + ext);
    return suggested;
  }
  const { dialog } = await tauri();
  const path = await dialog.save({ defaultPath: suggested, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return null;
  await writePath(path, bytes);
  return path;
}

/** Salva vários arquivos: numa pasta escolhida (app) ou num .zip (navegador). */
export async function saveMany(files: { name: string; bytes: Uint8Array }[], zipName: string): Promise<string | null> {
  if (files.length === 1) return saveAs(files[0].bytes, files[0].name, files[0].name.split(".").pop());
  if (isApp) {
    const { dialog } = await tauri();
    const dir = await dialog.open({ directory: true, title: "Escolha a pasta de destino" });
    if (!dir || Array.isArray(dir)) return null;
    const sep = dir.includes("\\") ? "\\" : "/";
    for (const f of files) await writePath(dir.replace(/[\\/]$/, "") + sep + f.name, f.bytes);
    return dir;
  }
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.bytes));
  download(await zip.generateAsync({ type: "uint8array" }), zipName, "application/zip");
  return zipName;
}

// ---------- integração com o Windows ----------
export type Launch = { action: "abrir" | "comprimir" | "juntar"; paths: string[] };

export async function takeLaunch(): Promise<Launch[]> {
  if (!isApp) return [];
  const { invoke } = await tauri();
  return invoke<Launch[]>("take_launch");
}

export async function onLaunch(cb: (l: Launch) => void) {
  if (!isApp) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<Launch>("launch", (e) => cb(e.payload));
}

export async function openDefaultAppsSettings() {
  const { invoke } = await tauri();
  await invoke("open_default_apps");
}

export async function setWindowTitle(title: string) {
  if (isApp) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().setTitle(title).catch(() => {});
  } else document.title = title;
}

// ---------- certificados do Windows (A1 instalado / A3 token) ----------
export async function listCertificates(): Promise<CertInfo[]> {
  if (!isApp) throw new Error("Certificados instalados (token A3) só estão disponíveis no app para Windows.");
  const { invoke } = await tauri();
  return invoke<CertInfo[]>("list_certificates");
}

/** Gera a assinatura CMS (PKCS#7 destacada) com o certificado do Windows. Pode pedir o PIN do token. */
export async function signWithStore(thumbprint: string, data: Uint8Array, essAttrB64: string): Promise<Uint8Array> {
  const { invoke } = await tauri();
  const { bytesToB64, b64ToBytes } = await import("./util");
  const out = await invoke<string>("sign_with_certificate", { thumbprint, data: bytesToB64(data), essAttr: essAttrB64 });
  return b64ToBytes(out);
}

export async function openExternal(url: string) {
  if (isApp) {
    const { invoke } = await tauri();
    await invoke("open_url", { url });
  } else window.open(url, "_blank");
}
