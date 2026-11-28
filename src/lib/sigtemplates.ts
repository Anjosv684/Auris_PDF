// Modelos do quadro visível da assinatura. Cada modelo devolve uma lista de
// primitivas (retângulo, traço, texto, imagem) em pontos, origem no canto
// inferior esquerdo; a mesma lista vira o desenho no PDF e a prévia em SVG.
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { sanitize } from "./pdfcore";

export type FontKey = "H" | "HB" | "HI" | "T" | "TB" | "TI";
export const FONT_NAMES: Record<FontKey, StandardFonts> = {
  H: StandardFonts.Helvetica, HB: StandardFonts.HelveticaBold, HI: StandardFonts.HelveticaOblique,
  T: StandardFonts.TimesRoman, TB: StandardFonts.TimesRomanBold, TI: StandardFonts.TimesRomanItalic,
};
export type RGB = readonly [number, number, number];
export type Prim =
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: RGB; stroke?: RGB; lw?: number }
  | { k: "path"; pts: [number, number][]; stroke?: RGB; fill?: RGB; lw?: number; close?: boolean }
  | { k: "text"; x: number; y: number; t: string; f: FontKey; size: number; c: RGB }
  | { k: "img"; x: number; y: number; w: number; h: number };

export type DocMode = "full" | "mask" | "none";
export type SigData = {
  name: string;
  doc?: string; // só dígitos
  docMode: DocMode;
  date: Date;
  location?: string;
  icp: boolean;
  /** proporção (largura/altura) da rubrica/carimbo, se houver */
  img?: number;
};
export type Measure = (t: string, f: FontKey, size: number) => number;
export type Template = { id: string; label: string; size: [number, number]; draw: (w: number, h: number, d: SigData, m: Measure) => Prim[] };

// ------------------------------------------------------------------ medidas
let fontsP: Promise<Record<FontKey, PDFFont>> | null = null;
/** Métricas das fontes padrão do PDF (as mesmas para a prévia e para o arquivo). */
export function loadMeasure(): Promise<Measure> {
  fontsP ??= (async () => {
    const doc = await PDFDocument.create();
    const out = {} as Record<FontKey, PDFFont>;
    for (const k of Object.keys(FONT_NAMES) as FontKey[]) out[k] = await doc.embedFont(FONT_NAMES[k]);
    return out;
  })();
  return fontsP.then((fonts) => (t, f, size) => fonts[f].widthOfTextAtSize(sanitize(fonts[f], t), size));
}

// ------------------------------------------------------------------ textos
export function fmtDoc(doc: string | undefined, mode: DocMode) {
  if (!doc || mode === "none") return "";
  if (doc.length === 11) return mode === "mask" ? `CPF: ***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**` : `CPF: ${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`;
  if (doc.length === 14) return `CNPJ: ${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}`;
  return doc;
}
const pad = (n: number) => String(n).padStart(2, "0");
function tz(d: Date, sep = ":") {
  const off = -d.getTimezoneOffset();
  return `${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}${sep}${pad(Math.abs(off) % 60)}`;
}
const dBR = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const hBR = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dateFull = (d: Date) => `${dBR(d)} ${hBR(d)} ${tz(d)}`;
const dateAdobe = (d: Date) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${hBR(d)} ${tz(d, "'")}'`;
const withLoc = (s: string, d: SigData) => (d.location ? `${s} • ${d.location}` : s);

// ------------------------------------------------------------------ ajudantes
type Line = { t: string; f: FontKey; k?: number; c: RGB };
const NAVY: RGB = [0.05, 0.1, 0.2];
const GRAY: RGB = [0.3, 0.35, 0.45];
const BLUE: RGB = [0.094, 0.373, 0.647];

/** Empilha linhas no retângulo (x, y, w, h), do topo para baixo, com o maior tamanho que couber. */
function stack(m: Measure, lines: Line[], x: number, y: number, w: number, h: number, o: { max?: number; align?: "left" | "center"; lh?: number } = {}): Prim[] {
  const ls = lines.filter((l) => l.t);
  if (!ls.length || w <= 4 || h <= 4) return [];
  const lh = o.lh ?? 1.28;
  const totalK = ls.reduce((a, l) => a + (l.k ?? 1) * lh, 0);
  const base = Math.min(h / totalK, o.max ?? 11);
  const used = ls.reduce((a, l) => a + base * (l.k ?? 1) * lh, 0);
  let cy = y + h - (h - used) / 2;
  const out: Prim[] = [];
  for (const l of ls) {
    let size = base * (l.k ?? 1);
    const tw = m(l.t, l.f, size);
    if (tw > w) size *= w / tw;
    const step = base * (l.k ?? 1) * lh;
    cy -= step;
    const width = m(l.t, l.f, size);
    out.push({ k: "text", t: l.t, f: l.f, size, c: l.c, x: o.align === "center" ? x + (w - width) / 2 : x, y: cy + step * 0.26 });
  }
  return out;
}

/** Texto corrido com quebra de linha: o maior tamanho (até `max`) em que tudo cabe. */
function flow(m: Measure, paras: { t: string; f: FontKey; c: RGB }[], x: number, y: number, w: number, h: number, max = 10, lh = 1.18): Prim[] {
  const ps = paras.filter((p) => p.t);
  const wrap = (p: { t: string; f: FontKey }, size: number) => {
    const out: string[] = [];
    let cur = "";
    for (const word of p.t.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && m(next, p.f, size) > w) { out.push(cur); cur = word; } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  for (let size = max; size >= 3; size -= 0.25) {
    const rows = ps.flatMap((p) => wrap(p, size).map((t) => ({ ...p, t })));
    if (rows.length * size * lh > h || rows.some((r) => m(r.t, r.f, size) > w)) continue;
    let cy = y + h - (h - rows.length * size * lh) / 2;
    return rows.map((r) => {
      cy -= size * lh;
      return { k: "text", t: r.t, f: r.f, size, c: r.c, x, y: cy + size * lh * 0.24 } as Prim;
    });
  }
  return stack(m, ps.map((p) => ({ ...p, k: 1 })), x, y, w, h);
}

/** Nome grande quebrado em até 3 linhas, no maior tamanho possível. */
function bigName(m: Measure, name: string, f: FontKey, c: RGB, x: number, y: number, w: number, h: number, max = 30): Prim[] {
  const words = name.split(/\s+/).filter(Boolean);
  let best: { size: number; rows: string[] } = { size: 0, rows: [name] };
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const per = Math.ceil(words.length / n);
    const rows = Array.from({ length: n }, (_, i) => words.slice(i * per, (i + 1) * per).join(" ")).filter(Boolean);
    const wMax = Math.max(...rows.map((r) => m(r, f, 1)));
    const size = Math.min(max, w / wMax, h / (rows.length * 1.12));
    if (size > best.size) best = { size, rows };
  }
  const { size, rows } = best;
  let cy = y + h - (h - rows.length * size * 1.12) / 2;
  return rows.map((t) => {
    cy -= size * 1.12;
    return { k: "text", t, f, size, c, x, y: cy + size * 0.25 } as Prim;
  });
}

/** Rubrica/carimbo contido na caixa; devolve a largura usada. */
function image(d: SigData, x: number, y: number, w: number, h: number, align: "left" | "center" = "left"): [Prim[], number] {
  if (!d.img) return [[], 0];
  let iw = w, ih = w / d.img;
  if (ih > h) { ih = h; iw = h * d.img; }
  return [[{ k: "img", x: align === "center" ? x + (w - iw) / 2 : x, y: y + (h - ih) / 2, w: iw, h: ih }], iw];
}

function circle(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 32 }, (_, i) => [cx + r * Math.cos((i / 32) * Math.PI * 2), cy + r * Math.sin((i / 32) * Math.PI * 2)]);
}

/** Área de texto à direita da rubrica, quando houver. */
function withImage(d: SigData, x: number, y: number, w: number, h: number, maxFrac = 0.4): { prims: Prim[]; x: number; w: number } {
  if (!d.img) return { prims: [], x, w };
  const [p, used] = image(d, x, y + h * 0.06, w * maxFrac, h * 0.88);
  const gap = Math.max(4, w * 0.03);
  return { prims: p, x: x + used + gap, w: w - used - gap };
}

const docLine = (d: SigData) => fmtDoc(d.doc, d.docMode);

// ------------------------------------------------------------------ modelos
export const TEMPLATES: Template[] = [
  {
    id: "adobe", label: "Estilo Adobe", size: [210, 54],
    draw: (w, h, d, m) => {
      const half = w * 0.48;
      const left = d.img ? image(d, 0, 0, half - 4, h, "center")[0] : bigName(m, d.name, "H", [0, 0, 0], 0, 0, half - 4, h);
      const right = flow(m, [
        { t: `Assinado de forma digital por ${d.name}`, f: "H", c: [0, 0, 0] },
        { t: docLine(d), f: "H", c: [0, 0, 0] },
        { t: `Dados: ${dateAdobe(d.date)}`, f: "H", c: [0, 0, 0] },
        { t: d.location ? `Local: ${d.location}` : "", f: "H", c: [0, 0, 0] },
      ], half + 2, 0, w - half - 2, h, 9);
      return [...left, ...right];
    },
  },
  {
    id: "classico", label: "Clássico azul", size: [190, 62],
    draw: (w, h, d, m) => {
      const bar = Math.max(3, w * 0.015);
      const p = Math.max(5, Math.min(w, h) * 0.08);
      const a = withImage(d, bar + p, p, w - bar - p * 2, h - p * 2);
      return [
        { k: "rect", x: 0.4, y: 0.4, w: w - 0.8, h: h - 0.8, stroke: BLUE, lw: 0.8 },
        { k: "rect", x: 0, y: 0, w: bar, h, fill: BLUE },
        ...a.prims,
        ...stack(m, [
          { t: "Assinado digitalmente por", f: "H", k: 0.8, c: [0.35, 0.4, 0.5] },
          { t: d.name, f: "HB", k: 1.15, c: NAVY },
          { t: docLine(d), f: "H", k: 0.9, c: [0.15, 0.2, 0.3] },
          { t: withLoc(`Data: ${dateFull(d.date)}`, d), f: "H", k: 0.9, c: [0.15, 0.2, 0.3] },
        ], a.x, p, a.w, h - p * 2),
      ];
    },
  },
  {
    id: "selo", label: "Moderno com selo", size: [200, 56],
    draw: (w, h, d, m) => {
      const p = Math.max(5, h * 0.1);
      const green: RGB = [0.13, 0.55, 0.33];
      let x = p;
      const out: Prim[] = [
        { k: "rect", x: 0.4, y: 0.4, w: w - 0.8, h: h - 0.8, stroke: [0.78, 0.82, 0.88], lw: 0.7 },
      ];
      if (d.img) {
        const [ip, used] = image(d, p, p, w * 0.38, h - p * 2);
        out.push(...ip);
        x += used + p;
      } else {
        const r = Math.min(h * 0.32, w * 0.12);
        const cx = p + r, cy = h / 2;
        out.push(
          { k: "path", pts: circle(cx, cy, r), fill: green, close: true },
          { k: "path", pts: [[cx - r * 0.45, cy + r * 0.02], [cx - r * 0.1, cy - r * 0.35], [cx + r * 0.5, cy + r * 0.38]], stroke: [1, 1, 1], lw: Math.max(1, r * 0.22) },
        );
        x += r * 2 + p;
      }
      out.push(...stack(m, [
        { t: d.name, f: "HB", k: 1.1, c: NAVY },
        { t: docLine(d), f: "H", k: 0.85, c: GRAY },
        { t: withLoc(`Assinado digitalmente em ${dateFull(d.date)}`, d), f: "H", k: 0.8, c: GRAY },
        { t: d.icp ? "Certificado ICP-Brasil" : "", f: "HB", k: 0.72, c: green },
      ], x, p * 0.7, w - x - p, h - p * 1.4));
      return out;
    },
  },
  {
    id: "linha", label: "Linha de assinatura", size: [200, 72],
    draw: (w, h, d, m) => {
      const lineY = h * 0.46;
      const top = d.img
        ? image(d, w * 0.1, lineY + 1, w * 0.8, h - lineY - 2, "center")[0]
        : bigName(m, d.name, "TI", [0.04, 0.12, 0.42], w * 0.06, lineY + 1, w * 0.88, h - lineY - 2, 26).map((p) =>
          p.k === "text" ? { ...p, x: (w - m(p.t, p.f, p.size)) / 2 } : p);
      return [
        ...top,
        { k: "path", pts: [[w * 0.04, lineY], [w * 0.96, lineY]], stroke: [0.2, 0.2, 0.25], lw: 0.7 },
        ...stack(m, [
          { t: d.name, f: "HB", k: 1, c: NAVY },
          { t: docLine(d), f: "H", k: 0.9, c: GRAY },
          { t: withLoc(`Assinado digitalmente em ${dateFull(d.date)}`, d), f: "H", k: 0.8, c: GRAY },
        ], w * 0.04, 1, w * 0.92, lineY - 3, { align: "center" }),
      ];
    },
  },
  {
    id: "faixa", label: "Faixa azul", size: [190, 66],
    draw: (w, h, d, m) => {
      const band = h * 0.24;
      const p = Math.max(5, h * 0.08);
      const navy: RGB = [0.04, 0.16, 0.36];
      const a = withImage(d, p, p * 0.6, w - p * 2, h - band - p * 1.2);
      return [
        { k: "rect", x: 0, y: h - band, w, h: band, fill: navy },
        { k: "rect", x: 0.4, y: 0.4, w: w - 0.8, h: h - 0.8, stroke: navy, lw: 0.8 },
        ...stack(m, [{ t: "ASSINATURA DIGITAL", f: "HB", c: [1, 1, 1] }], p, h - band + band * 0.12, w - p * 2, band * 0.76),
        ...a.prims,
        ...stack(m, [
          { t: d.name, f: "HB", k: 1.1, c: NAVY },
          { t: docLine(d), f: "H", k: 0.9, c: GRAY },
          { t: withLoc(`Data: ${dateFull(d.date)}`, d), f: "H", k: 0.85, c: GRAY },
        ], a.x, p * 0.6, a.w, h - band - p * 1.2),
      ];
    },
  },
  {
    id: "compacto", label: "Compacto (1 linha)", size: [240, 30],
    draw: (w, h, d, m) => {
      const bar = Math.max(2, h * 0.08);
      const p = Math.max(3, h * 0.12);
      const a = withImage(d, bar + p, p * 0.5, w - bar - p * 2, h - p, 0.3);
      const doc = docLine(d);
      return [
        { k: "rect", x: 0, y: 0, w: bar, h, fill: BLUE },
        ...a.prims,
        ...stack(m, [
          { t: doc ? `${d.name}  •  ${doc}` : d.name, f: "HB", k: 1, c: NAVY },
          { t: withLoc(`Assinado digitalmente em ${dateFull(d.date)}`, d), f: "H", k: 0.85, c: GRAY },
        ], a.x, p * 0.5, a.w, h - p),
      ];
    },
  },
  {
    id: "carimbo", label: "Carimbo", size: [190, 68],
    draw: (w, h, d, m) => {
      const ink: RGB = [0.1, 0.22, 0.55];
      const g = Math.max(2, Math.min(w, h) * 0.05);
      const a = withImage(d, g * 2.5, g * 2, w - g * 5, h - g * 4, 0.3);
      return [
        { k: "rect", x: 0.6, y: 0.6, w: w - 1.2, h: h - 1.2, stroke: ink, lw: 1.2 },
        { k: "rect", x: g, y: g, w: w - g * 2, h: h - g * 2, stroke: ink, lw: 0.5 },
        ...a.prims,
        ...stack(m, [
          { t: "DOCUMENTO ASSINADO DIGITALMENTE", f: "HB", k: 0.8, c: ink },
          { t: d.name.toUpperCase(), f: "HB", k: 1.1, c: ink },
          { t: docLine(d), f: "H", k: 0.85, c: ink },
          { t: withLoc(dateFull(d.date), d), f: "H", k: 0.85, c: ink },
        ], a.x, g * 2, a.w, h - g * 4, { align: d.img ? "left" : "center" }),
      ];
    },
  },
  {
    id: "icp", label: "Verde ICP-Brasil", size: [190, 62],
    draw: (w, h, d, m) => {
      const green: RGB = [0.1, 0.5, 0.3];
      const bar = Math.max(3, w * 0.018);
      const p = Math.max(5, Math.min(w, h) * 0.08);
      const a = withImage(d, bar + p, p, w - bar - p * 2, h - p * 2);
      return [
        { k: "rect", x: 0.4, y: 0.4, w: w - 0.8, h: h - 0.8, stroke: green, lw: 0.8 },
        { k: "rect", x: 0, y: 0, w: bar, h, fill: green },
        ...a.prims,
        ...stack(m, [
          { t: d.icp ? "Assinatura digital ICP-Brasil" : "Assinatura digital", f: "HB", k: 0.8, c: green },
          { t: d.name, f: "HB", k: 1.15, c: NAVY },
          { t: docLine(d), f: "H", k: 0.9, c: [0.15, 0.2, 0.3] },
          { t: withLoc(`Data: ${dateFull(d.date)}`, d), f: "H", k: 0.9, c: [0.15, 0.2, 0.3] },
        ], a.x, p, a.w, h - p * 2),
      ];
    },
  },
  {
    id: "formal", label: "Formal (serifado)", size: [200, 72],
    draw: (w, h, d, m) => {
      const p = Math.max(5, Math.min(w, h) * 0.08);
      const a = withImage(d, p, p, w - p * 2, h - p * 2, 0.32);
      return [
        { k: "rect", x: 0.4, y: 0.4, w: w - 0.8, h: h - 0.8, stroke: [0.25, 0.25, 0.25], lw: 0.6 },
        ...a.prims,
        ...stack(m, [
          { t: "Documento assinado digitalmente", f: "TI", k: 0.9, c: [0.2, 0.2, 0.2] },
          { t: d.name, f: "TB", k: 1.2, c: [0, 0, 0] },
          { t: docLine(d), f: "T", k: 0.95, c: [0.15, 0.15, 0.15] },
          { t: withLoc(`Data: ${dateFull(d.date)}`, d), f: "T", k: 0.9, c: [0.15, 0.15, 0.15] },
          { t: "Conforme MP nº 2.200-2/2001", f: "TI", k: 0.75, c: [0.35, 0.35, 0.35] },
        ], a.x, p, a.w, h - p * 2, { align: d.img ? "left" : "center" }),
      ];
    },
  },
  {
    id: "dourado", label: "Elegante dourado", size: [190, 58],
    draw: (w, h, d, m) => {
      const gold: RGB = [0.72, 0.55, 0.2];
      const p = Math.max(5, Math.min(w, h) * 0.09);
      const a = withImage(d, p * 1.4, p, w - p * 2.8, h - p * 2, 0.34);
      return [
        { k: "path", pts: [[p * 0.5, h - p * 0.5], [w - p * 0.5, h - p * 0.5]], stroke: gold, lw: 0.9 },
        { k: "path", pts: [[p * 0.5, p * 0.5], [w - p * 0.5, p * 0.5]], stroke: gold, lw: 0.9 },
        ...a.prims,
        ...stack(m, [
          { t: "ASSINADO DIGITALMENTE", f: "HB", k: 0.75, c: gold },
          { t: d.name, f: "TB", k: 1.2, c: NAVY },
          { t: docLine(d), f: "H", k: 0.88, c: GRAY },
          { t: withLoc(dateFull(d.date), d), f: "H", k: 0.85, c: GRAY },
        ], a.x, p, a.w, h - p * 2),
      ];
    },
  },
];

export const DEFAULT_TEMPLATE = "adobe";
export const templateById = (id?: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
export function savedTemplate() {
  try { return templateById(localStorage.getItem("auris.sig.tpl") || DEFAULT_TEMPLATE).id; } catch { return DEFAULT_TEMPLATE; }
}
export function saveTemplate(id: string) {
  try { localStorage.setItem("auris.sig.tpl", id); } catch { /* sem espaço */ }
}
