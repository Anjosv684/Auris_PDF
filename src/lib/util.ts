export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function fmtSize(n: number) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i ? n.toFixed(1).replace(".", ",") : n} ${u[i]}`;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function baseName(name: string) {
  return name.replace(/\.pdf$/i, "");
}

export function dataUrlToBytes(url: string): { bytes: Uint8Array; mime: string } {
  const [head, b64] = url.split(",");
  const mime = head.slice(5, head.indexOf(";"));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

export function bytesToBinary(b: Uint8Array) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH) as unknown as number[]);
  return s;
}

export function binaryToBytes(s: string) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
}

export const b64ToBytes = (b64: string) => binaryToBytes(atob(b64));
export const bytesToB64 = (b: Uint8Array) => btoa(bytesToBinary(b));

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** Converte qualquer imagem (inclusive webp/gif/bmp) em PNG ou JPEG aceitos pelo PDF. */
export async function normalizeImage(src: string): Promise<{ src: string; w: number; h: number }> {
  const img = await loadImage(src);
  if (/^data:image\/(png|jpeg)/.test(src)) return { src, w: img.naturalWidth, h: img.naturalHeight };
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return { src: c.toDataURL("image/png"), w: c.width, h: c.height };
}

/** Deixa transparentes os pixels quase brancos (útil para assinaturas escaneadas). */
export async function removeWhite(src: string, threshold = 235): Promise<string> {
  const img = await loadImage(src);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const m = Math.min(p[i], p[i + 1], p[i + 2]);
    if (m >= threshold) p[i + 3] = 0;
    else if (m > threshold - 40) p[i + 3] = Math.round(p[i + 3] * ((threshold - m) / 40));
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL("image/png");
}

export function todayBR() {
  return new Date().toLocaleDateString("pt-BR");
}

/** Interpreta "1-3, 5, 8-" em índices 0-based. */
export function parseRanges(input: string, total: number): number[] {
  const out: number[] = [];
  for (const part of input.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      const a = m[1] ? parseInt(m[1]) : 1;
      const b = m[2] ? parseInt(m[2]) : total;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= total) out.push(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part);
      if (n >= 1 && n <= total) out.push(n - 1);
    } else throw new Error(`Intervalo inválido: "${part}"`);
  }
  return out;
}
