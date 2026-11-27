// Ações sobre objetos (imagens coladas, formas, textos, carimbos) usadas pelo menu do botão direito.
import { useStore } from "./store";
import { loadImage, removeWhite, uid } from "./util";
import type { ImageObj, Obj } from "./types";

const st = () => useStore.getState();
const activeTab = () => st().tabs.find((t) => t.id === st().activeId);

/** Redesenha a imagem num canvas aplicando a transformação (girar/espelhar os próprios pixels). */
async function transformSrc(src: string, kind: "cw" | "ccw" | "h" | "v"): Promise<string> {
  const img = await loadImage(src);
  const w = img.naturalWidth, h = img.naturalHeight;
  const turn = kind === "cw" || kind === "ccw";
  const c = document.createElement("canvas");
  c.width = turn ? h : w;
  c.height = turn ? w : h;
  const g = c.getContext("2d")!;
  if (kind === "cw") { g.translate(h, 0); g.rotate(Math.PI / 2); }
  if (kind === "ccw") { g.translate(0, w); g.rotate(-Math.PI / 2); }
  if (kind === "h") { g.translate(w, 0); g.scale(-1, 1); }
  if (kind === "v") { g.translate(0, h); g.scale(1, -1); }
  g.drawImage(img, 0, 0);
  // PNG mantém transparência (ex.: assinatura com fundo removido)
  return c.toDataURL(src.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png", 0.95);
}

/** Gira 90° mantendo o centro no mesmo lugar. */
export async function rotateImage(o: ImageObj, dir: 1 | -1) {
  const src = await transformSrc(o.src, dir === 1 ? "cw" : "ccw");
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  st().checkpoint();
  st().updateObj(o.id, { src, w: o.h, h: o.w, x: cx - o.h / 2, y: cy - o.w / 2, ratio: 1 / o.ratio } as Partial<Obj>);
}

export async function flipImage(o: ImageObj, axis: "h" | "v") {
  const src = await transformSrc(o.src, axis);
  st().checkpoint();
  st().updateObj(o.id, { src } as Partial<Obj>);
}

export async function removeImageBackground(o: ImageObj) {
  st().checkpoint();
  st().updateObj(o.id, { src: await removeWhite(o.src) } as Partial<Obj>);
}

export function onAllPages(o: Obj) {
  const t = activeTab();
  if (!t) return;
  st().checkpoint();
  const copies = Array.from({ length: t.pageCount }, (_, p) => p).filter((p) => p !== o.page).map((p) => ({ ...o, id: uid(), page: p }));
  st().patchTab(t.id, { objects: [...t.objects, ...copies], dirty: true });
  st().toast(`Aplicado em ${copies.length + 1} páginas`);
}

export function duplicateObj(o: Obj) {
  if (o.type === "sigfield") return;
  st().addObj({ ...o, id: uid(), x: o.x + 12, y: o.y + 12 });
}

/** Ordem das camadas: os objetos são desenhados na ordem da lista (o último fica por cima). */
export function reorderObj(o: Obj, where: "front" | "back" | "forward" | "backward") {
  const t = activeTab();
  if (!t) return;
  const list = [...t.objects];
  const i = list.findIndex((x) => x.id === o.id);
  if (i < 0) return;
  // só conta os objetos da mesma página para "avançar/recuar" um passo
  const samePage = list.map((x, k) => (x.page === o.page ? k : -1)).filter((k) => k >= 0);
  const pos = samePage.indexOf(i);
  let target = i;
  if (where === "front") target = list.length - 1;
  if (where === "back") target = 0;
  if (where === "forward" && pos < samePage.length - 1) target = samePage[pos + 1];
  if (where === "backward" && pos > 0) target = samePage[pos - 1];
  if (target === i) return;
  st().checkpoint();
  const [it] = list.splice(i, 1);
  list.splice(target, 0, it);
  st().patchTab(t.id, { objects: list, dirty: true });
}
